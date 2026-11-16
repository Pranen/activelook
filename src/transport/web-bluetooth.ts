import { ActiveLookError } from '../errors.js';
import type { DeviceInfo, Transport, TransportEvents } from './types.js';

const std = (short: number) => `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

export const UUIDS = {
  service: '0783b03e-8535-b5a0-7140-a304d2495cb7',
  tx: '0783b03e-8535-b5a0-7140-a304d2495cb8', // notify: responses
  control: '0783b03e-8535-b5a0-7140-a304d2495cb9', // notify: flow control
  rx: '0783b03e-8535-b5a0-7140-a304d2495cba', // write: commands
  gesture: '0783b03e-8535-b5a0-7140-a304d2495cbb', // notify
  touch: '0783b03e-8535-b5a0-7140-a304d2495cbc', // notify
  batteryService: std(0x180f),
  batteryLevel: std(0x2a19),
  deviceInfoService: std(0x180a),
  manufacturer: std(0x2a29),
  model: std(0x2a24),
  hardware: std(0x2a27),
  firmware: std(0x2a26),
  software: std(0x2a28),
} as const;

/**
 * How commands are written to RX.
 * - `response` (default): always write with response, as the API docs recommend. Each write is
 *   acknowledged, so the glasses cannot be flooded and drop commands.
 * - `auto`: write without response, fall back to write with response. Faster, but long command
 *   bursts can be dropped by the glasses.
 * - `noResponse`: always write without response.
 */
export type WriteMode = 'auto' | 'response' | 'noResponse';

export interface WebBluetoothOptions {
  /** Device name prefixes for the chooser. Default: ENGO and ActiveLook default names. */
  namePrefixes?: string[];
  /** Full override of the `requestDevice` filters. */
  filters?: BluetoothLEScanFilter[];
  /** Use an already selected device instead of opening the chooser. */
  device?: BluetoothDevice;
  writeMode?: WriteMode;
  /**
   * Largest single write. Default 512: frames are sent whole and the size shrinks
   * automatically (244 → 182 → 128 → 64 → 20) if the connection rejects long writes.
   */
  chunkSize?: number;
  /** Read the Device Information service (needs it in optionalServices). Default true. */
  deviceInfo?: boolean;
}

export const DEFAULT_NAME_PREFIXES = ['ENGO', 'engo', 'A.Look', 'A.LooK'];

type Char = BluetoothRemoteGATTCharacteristic;

export class WebBluetoothTransport implements Transport {
  device: BluetoothDevice | null = null;
  private rx: Char | null = null;
  private battery: Char | null = null;
  private onGattDisconnect: (() => void) | null = null;
  private chunkSize: number;
  private log: (message: string) => void = () => {};

  constructor(private readonly options: WebBluetoothOptions = {}) {
    this.chunkSize = options.chunkSize ?? 512;
  }

  static get available(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  get connected(): boolean {
    return !!this.device?.gatt?.connected && !!this.rx;
  }

  /** Current largest write; shrinks automatically when the connection rejects long writes. */
  get maxChunkSize(): number {
    return this.chunkSize;
  }

  async connect(events: TransportEvents): Promise<DeviceInfo> {
    const log = (m: string) => events.onLog?.(m);
    this.log = log;
    if (!WebBluetoothTransport.available) {
      throw new ActiveLookError(
        'Web Bluetooth is not available. It needs a secure context (https or localhost) and a supporting browser (Chrome/Edge; on iOS: Bluefy).',
        'unsupported',
      );
    }

    const wantInfo = this.options.deviceInfo ?? true;
    let device = this.options.device ?? null;
    if (!device) {
      // Bluefy (iOS) does not support acceptAllDevices, so always use filters.
      const prefixes = this.options.namePrefixes ?? DEFAULT_NAME_PREFIXES;
      try {
        device = await navigator.bluetooth.requestDevice({
          filters: this.options.filters ?? prefixes.map(namePrefix => ({ namePrefix })),
          optionalServices: [UUIDS.service, UUIDS.batteryService, ...(wantInfo ? [UUIDS.deviceInfoService] : [])],
        });
      } catch (e) {
        throw new ActiveLookError(`Device selection failed: ${errorText(e)}`, 'cancelled', e);
      }
    }
    this.device = device;
    if (!device.gatt) throw new ActiveLookError('Device has no GATT server', 'gatt');

    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(UUIDS.service);
    this.rx = await svc.getCharacteristic(UUIDS.rx);

    this.onGattDisconnect = () => {
      this.rx = null;
      this.battery = null;
      if (this.onGattDisconnect) device.removeEventListener('gattserverdisconnected', this.onGattDisconnect);
      this.onGattDisconnect = null;
      events.onDisconnect();
    };
    device.addEventListener('gattserverdisconnected', this.onGattDisconnect);

    const sub = async (uuid: string, label: string, cb: (bytes: Uint8Array) => void) => {
      try {
        const ch = await svc.getCharacteristic(uuid);
        ch.addEventListener('characteristicvaluechanged', e => {
          const dv = (e.target as Char).value;
          if (dv) cb(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice());
        });
        await ch.startNotifications();
      } catch (e) {
        log(`${label} not available (${errorText(e)})`);
      }
    };
    await sub(UUIDS.tx, 'TX characteristic', b => events.onData(b));
    await sub(UUIDS.control, 'Control characteristic', b => { if (b.length) events.onControl(b[0]!); });
    await sub(UUIDS.gesture, 'Gesture event', b => events.onGesture(b));
    await sub(UUIDS.touch, 'Touch event', b => events.onTouch(b));

    try {
      const bsvc = await server.getPrimaryService(UUIDS.batteryService);
      this.battery = await bsvc.getCharacteristic(UUIDS.batteryLevel);
      this.battery.addEventListener('characteristicvaluechanged', e => {
        const dv = (e.target as Char).value;
        if (dv?.byteLength) events.onBattery(dv.getUint8(0));
      });
      await this.battery.startNotifications(); // device notifies every 30 s
    } catch (e) {
      log(`Battery service not available (${errorText(e)})`);
    }

    const info: DeviceInfo = { name: device.name };
    if (wantInfo) {
      try {
        const dis = await server.getPrimaryService(UUIDS.deviceInfoService);
        const read = async (uuid: string): Promise<string | undefined> => {
          try { return new TextDecoder().decode(await (await dis.getCharacteristic(uuid)).readValue()).replace(/\0+$/, ''); }
          catch { return undefined; }
        };
        info.manufacturer = await read(UUIDS.manufacturer);
        info.model = await read(UUIDS.model);
        info.hardware = await read(UUIDS.hardware);
        info.firmware = await read(UUIDS.firmware);
        info.software = await read(UUIDS.software);
      } catch (e) {
        log(`Device information not available (${errorText(e)})`);
      }
    }
    return info;
  }

  /**
   * Writes a frame (or part of one). The glasses reassemble frames split over several
   * writes, so if a write is too long for the connection ("Not supported": no long-write
   * support), it is retried in smaller pieces and the working size is kept for later writes.
   */
  async write(data: Uint8Array): Promise<void> {
    for (let off = 0; off < data.length;) {
      const piece = data.subarray(off, off + this.chunkSize);
      try {
        await this.writeOnce(piece);
        off += piece.length;
      } catch (e) {
        const smaller = CHUNK_STEPS.find(s => s < piece.length);
        if (smaller === undefined || !isTooLong(e)) throw e;
        this.chunkSize = smaller;
        this.log(`Write of ${piece.length} bytes not supported, using ${smaller}-byte pieces`);
      }
    }
  }

  private async writeOnce(data: Uint8Array): Promise<void> {
    const chunk = new Uint8Array(data); // copy: subarray views must not be sent with their full buffer
    const rx = this.rx;
    if (!rx) throw new ActiveLookError('Not connected', 'not-connected');
    const mode = this.options.writeMode ?? 'response';
    const withResponse = () => (rx.writeValueWithResponse ? rx.writeValueWithResponse(chunk) : rx.writeValue(chunk));
    if (mode === 'response') return withResponse();
    if (mode === 'noResponse') return rx.writeValueWithoutResponse(chunk);
    try { await rx.writeValueWithoutResponse(chunk); }
    catch { await withResponse(); }
  }

  async readBattery(): Promise<number | null> {
    if (!this.battery) return null;
    return (await this.battery.readValue()).getUint8(0);
  }

  disconnect(): void {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
  }
}

/** Write sizes to fall back to: common MTU payloads (247/185 − 3), then the BLE minimum (23 − 3). */
const CHUNK_STEPS = [244, 182, 128, 64, 20];

/** Errors browsers report when a value exceeds what a single (or long) write allows. */
function isTooLong(e: unknown): boolean {
  if (!(e instanceof Error) && !(typeof e === 'object' && e && 'name' in e)) return false;
  const { name = '', message = '' } = e as { name?: string; message?: string };
  return name === 'NotSupportedError' || name === 'InvalidModificationError' || /not supported|too long|length/i.test(message);
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}
