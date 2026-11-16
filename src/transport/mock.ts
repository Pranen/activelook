import { ActiveLookError } from '../errors.js';
import { CMD } from '../protocol/commands.js';
import { FrameDecoder, encodeFrame, type Frame } from '../protocol/frame.js';
import type { DeviceInfo, Transport, TransportEvents } from './types.js';

export interface MockTransportOptions {
  info?: DeviceInfo;
  battery?: number | null;
  maxChunkSize?: number;
  /**
   * Answers queries. Return the response payload (the mock wraps it in a frame with the
   * same command and query id) or undefined to fall back to the default answers.
   */
  respond?: (frame: Frame) => ArrayLike<number> | undefined;
  /** Answer version, settings, battery and font queries like an ENGO 3. Default true. */
  defaultResponses?: boolean;
}

/** Answers of a real ENGO 3 (firmware 4.13.15). */
const DEFAULT_RESPONSES: Record<number, number[]> = {
  [CMD.version]: [4, 13, 15, 0, 26, 20, 0x00, 0xc5, 0x3e],
  [CMD.battery]: [84],
  [CMD.fontList]: [1, 24, 2, 38, 3, 64, 4, 75, 5, 82, 6, 32, 7, 48, 0, 24],
};

/** In-memory transport for tests and for running demos without glasses. */
export class MockTransport implements Transport {
  connected = false;
  readonly maxChunkSize: number;
  /** Every chunk passed to write(), in order. */
  readonly writes: Uint8Array[] = [];
  /** Every decoded command frame, in order. */
  readonly frames: Frame[] = [];

  /** Picture shift "stored on the device"; changed by shift commands, reported by settings. */
  shift = { x: 3, y: 30 };

  private events: TransportEvents | null = null;
  private readonly decoder = new FrameDecoder();

  constructor(private readonly options: MockTransportOptions = {}) {
    this.maxChunkSize = options.maxChunkSize ?? 512;
  }

  async connect(events: TransportEvents): Promise<DeviceInfo> {
    this.events = events;
    this.connected = true;
    return { name: 'Mock ActiveLook', hardware: 'ALK03-MDP08ACRG', ...this.options.info };
  }

  async write(chunk: Uint8Array): Promise<void> {
    if (!this.connected) throw new ActiveLookError('Not connected', 'not-connected');
    this.writes.push(chunk.slice());
    for (const frame of this.decoder.push(chunk)) {
      this.frames.push(frame);
      if (frame.cmd === CMD.shift && frame.data.length >= 4) {
        const s16 = (hi: number, lo: number) => { const v = (hi << 8) | lo; return v > 0x7fff ? v - 0x10000 : v; };
        this.shift = { x: s16(frame.data[0]!, frame.data[1]!), y: s16(frame.data[2]!, frame.data[3]!) };
      }
      if (!frame.queryId.length) continue; // only queries carry a query id
      const payload =
        this.options.respond?.(frame) ??
        ((this.options.defaultResponses ?? true) ? this.defaultResponse(frame.cmd) : undefined);
      if (payload) {
        const reply = encodeFrame(frame.cmd, payload, frame.queryId);
        queueMicrotask(() => this.events?.onData(reply));
      }
    }
  }

  private defaultResponse(cmd: number): number[] | undefined {
    if (cmd === CMD.settings) return [this.shift.x & 0xff, this.shift.y & 0xff, 10, 0, 1];
    return DEFAULT_RESPONSES[cmd];
  }

  async readBattery(): Promise<number | null> {
    return this.options.battery ?? null;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.events?.onDisconnect();
  }

  // ── Simulate the glasses ───────────────────────────────────────────────
  emitData(bytes: ArrayLike<number>): void { this.events?.onData(Uint8Array.from(bytes)); }
  emitControl(code: number): void { this.events?.onControl(code); }
  emitGesture(value = 1): void { this.events?.onGesture(Uint8Array.of(value)); }
  emitTouch(value = 1): void { this.events?.onTouch(Uint8Array.of(value)); }
  emitBattery(level: number): void { this.events?.onBattery(level); }

  /** Forget recorded writes and frames. */
  clearLog(): void {
    this.writes.length = 0;
    this.frames.length = 0;
  }
}
