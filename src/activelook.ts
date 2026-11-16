import { ENGO3, detectColor, visibleArea, type DeviceProfile, type Rect } from './devices/profiles.js';
import { ActiveLookError } from './errors.js';
import { Emitter } from './events.js';
import { toAscii } from './extras/ascii.js';
import { keepScreenAwake } from './extras/wake-lock.js';
import { ByteReader, bool, clamp, cstring, s16, toHex, u8 } from './protocol/bytes.js';
import { CMD, CONTROL, CONTROL_MESSAGES, DEVICE_ERRORS, HOLD, type LedState } from './protocol/commands.js';
import { FrameDecoder, MAX_DATA_SIZE, encodeFrame, type Frame } from './protocol/frame.js';
import { rgToGrey } from './protocol/palette.js';
import { WriteQueue } from './queue.js';
import { Animations } from './modules/animations.js';
import { Configs } from './modules/configs.js';
import { Fonts, type FontInfo } from './modules/fonts.js';
import { Gauges } from './modules/gauges.js';
import { Images } from './modules/images.js';
import { Layouts } from './modules/layouts.js';
import { Pages } from './modules/pages.js';
import { Assets } from './assets/alook.js';
import type { DeviceInfo, Transport } from './transport/types.js';
import { WebBluetoothTransport, type WebBluetoothOptions } from './transport/web-bluetooth.js';

export type Point = readonly [x: number, y: number];

export interface InputEvent {
  /** First byte of the notification (1 for a press / gesture). */
  value: number;
  bytes: Uint8Array;
  timestamp: number;
}

export interface DeviceError {
  /** `control`: Control characteristic code. `command`: async error frame 0xE2. */
  source: 'control' | 'command';
  code: number;
  /** Failing command id (command errors only). */
  cmd?: number;
  subCode?: number;
  message: string;
}

export interface ActiveLookEvents {
  touch: InputEvent;
  gesture: InputEvent;
  battery: number;
  connect: DeviceInfo;
  disconnect: void;
  error: DeviceError;
  /** Raw Control characteristic value (0x01 ready, 0x02 busy, ≥ 0x03 error). */
  flow: number;
}

export interface ActiveLookOptions {
  /** Device profile; default ENGO 3. */
  profile?: DeviceProfile;
  /** Custom transport; default Web Bluetooth. */
  transport?: Transport;
  /** Options for the default Web Bluetooth transport. */
  bluetooth?: WebBluetoothOptions;
  /** Log sink for status messages. */
  log?: (message: string) => void;
  /** Log every frame sent and received (hex). */
  verbose?: boolean;
  /** Timeout for queries in ms. Default 3000. */
  queryTimeoutMs?: number;
  /** Max wait for flow control "ready" before resuming anyway. Default 3000. */
  flowTimeoutMs?: number;
  /** Convert text to ASCII before sending (umlauts → ae/oe/ue). Default true. */
  transliterate?: boolean;
  /** Keep the phone screen on while connected (Screen Wake Lock). Default false. */
  keepAwake?: boolean;
  /** Read fonts and settings from the device on connect. Default true. */
  readDeviceState?: boolean;
}

export interface TextOptions {
  /** Font id, 0–3 are built in. Default 1. */
  font?: number;
  /** Rotation 0–7. Default from the profile (upright). */
  rotation?: number;
  /** Grey level 0–15 (ignored when `color` is set). Default 15. */
  grey?: number;
  /** RG palette colour 0–255 (colour glasses; falls back to grey on monochrome glasses). */
  color?: number;
  /** Override the instance's transliterate setting. */
  transliterate?: boolean;
}

export interface DrawOptions {
  /** Clear the display before rendering. Default true. */
  clear?: boolean;
}

export interface VersionInfo {
  firmware: string;
  manufacturingYear: number;
  manufacturingWeek: number;
  serialNumber: number;
}

export interface Settings {
  /**
   * Stored picture shift in device units, as passed to shift(). Moves the visible area.
   * The ENGO app shows the same shift as x = −shiftX, y = shiftY (right and up positive, as seen).
   */
  shiftX: number;
  shiftY: number;
  luma: number;
  ambientLight: boolean;
  gesture: boolean;
}

export type { FontInfo };

/** Parameter ids of rdDevInfo (0xE3). */
export const DEVICE_INFO = {
  hardwarePlatform: 0,
  manufacturer: 1,
  advertisingManufacturerId: 2,
  model: 3,
  subModel: 4,
  firmwareVersion: 5,
  serialNumber: 6,
  batteryModel: 7,
  lensModel: 8,
  displayModel: 9,
  displayOrientation: 10,
  certification1: 11,
} as const;

const SHUTDOWN_KEY = [0x6f, 0x7f, 0xc4, 0xee];
const RESET_KEY = [0x5c, 0x1e, 0x2d, 0xe9];

interface PendingQuery {
  cmd: number;
  resolve: (data: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const POLYLINE_MAX_POINTS = Math.floor((MAX_DATA_SIZE - 3) / 4); // 127

/**
 * High-level API for ActiveLook glasses.
 *
 * All coordinates are logical: origin top-left as seen by the wearer. Commands are
 * queued and sent in order, so awaiting each call is optional; await the last one (or
 * `idle()`) to know everything has been written.
 */
export class ActiveLook {
  readonly profile: DeviceProfile;
  readonly transport: Transport;
  verbose: boolean;
  transliterate: boolean;

  /** Configurations: open one with `configs.write()` before saving anything below. */
  readonly configs = new Configs(this);
  /** Stored and streamed images. */
  readonly images = new Images(this);
  /** Stored layouts (clip region + text slot + drawing commands). */
  readonly layouts = new Layouts(this);
  /** Pages: up to 10 layouts shown together. */
  readonly pages = new Pages(this);
  /** Ring gauges. */
  readonly gauges = new Gauges(this);
  /** Stored animations. */
  readonly animations = new Animations(this);
  /** Fonts on the glasses. */
  readonly fonts = new Fonts(this);
  /** Icons, layouts and animations built into every ActiveLook device (configuration "ALooK"). */
  readonly assets = new Assets(this);

  private readonly emitter = new Emitter<ActiveLookEvents>();
  private readonly queue: WriteQueue;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<number, PendingQuery>();
  private readonly logFn: (message: string) => void;
  private readonly queryTimeoutMs: number;
  private readonly keepAwake: boolean;
  private releaseWakeLock: (() => void) | null = null;
  private nextQueryId = 1;
  private drawChain: Promise<void> = Promise.resolve();
  private _battery: number | null = null;
  private _info: DeviceInfo | null = null;
  private _isColor: boolean;
  /** Whether fonts and settings are read from the device (option `readDeviceState`). */
  readonly readDeviceState: boolean;
  private _settings: Settings | null = null;

  constructor(options: ActiveLookOptions = {}) {
    this.profile = options.profile ?? ENGO3;
    this.transport = options.transport ?? new WebBluetoothTransport(options.bluetooth);
    this.logFn = options.log ?? (() => {});
    this.verbose = options.verbose ?? false;
    this.transliterate = options.transliterate ?? true;
    this.queryTimeoutMs = options.queryTimeoutMs ?? 3000;
    this.keepAwake = options.keepAwake ?? false;
    this.readDeviceState = options.readDeviceState ?? true;
    this._isColor = detectColor(this.profile, undefined);
    this.queue = new WriteQueue(
      chunk => this.transport.write(chunk),
      () => this.transport.maxChunkSize,
      options.flowTimeoutMs ?? 3000,
      m => this.log(m),
    );
  }

  // ── State ─────────────────────────────────────────────────────────────

  get connected(): boolean { return this.transport.connected; }
  /** Last known battery level in % (null if unknown). Updated by notifications. */
  get battery(): number | null { return this._battery; }
  get deviceInfo(): DeviceInfo | null { return this._info; }
  get isColor(): boolean { return this._isColor; }
  /** Last settings read from the device (on connect and by getSettings()). */
  get settings(): Settings | null { return this._settings; }
  /** Line height of a font: from the device if known, else from the profile. */
  fontHeight(font: number): number { return this.fonts.height(font); }
  get width(): number { return this.profile.width; }
  get height(): number { return this.profile.height; }
  /**
   * Visible part of the display in logical coordinates. Follows the picture shift stored on
   * the device (read on connect, updated by shift()).
   */
  get safeArea(): Rect {
    const s = this._settings;
    return visibleArea(this.profile, s ? { x: s.shiftX, y: s.shiftY } : null);
  }

  on<K extends keyof ActiveLookEvents>(type: K, fn: (payload: ActiveLookEvents[K]) => void): () => void {
    return this.emitter.on(type, fn);
  }
  once<K extends keyof ActiveLookEvents>(type: K, fn: (payload: ActiveLookEvents[K]) => void): () => void {
    return this.emitter.once(type, fn);
  }
  off<K extends keyof ActiveLookEvents>(type: K, fn: (payload: ActiveLookEvents[K]) => void): void {
    this.emitter.off(type, fn);
  }

  // ── Connection ────────────────────────────────────────────────────────

  /** Opens the device chooser (Web Bluetooth) and connects. Must be called from a user gesture. */
  async connect(): Promise<DeviceInfo> {
    this.log('Searching for glasses…');
    const info = await this.transport.connect({
      onData: bytes => this.handleData(bytes),
      onControl: code => this.handleControl(code),
      onGesture: bytes => this.emitter.emit('gesture', inputEvent(bytes)),
      onTouch: bytes => this.emitter.emit('touch', inputEvent(bytes)),
      onBattery: level => { this._battery = level; this.emitter.emit('battery', level); },
      onDisconnect: () => this.handleDisconnect(),
      onLog: m => this.log(m),
    });
    this._info = info;
    this._isColor = detectColor(this.profile, info.hardware);
    try { this._battery = await this.transport.readBattery(); } catch { /* keep null */ }
    if (this.readDeviceState) {
      // Real font heights (they differ from the API docs on ENGO 3) and the stored picture shift.
      try { await this.listFonts(); } catch (e) { this.log(`Could not read fonts (${(e as Error).message}), using profile values`); }
      try { await this.getSettings(); } catch (e) { this.log(`Could not read settings (${(e as Error).message})`); }
    }
    if (this.keepAwake) this.releaseWakeLock = keepScreenAwake();
    this.log(`Connected to ${info.name ?? 'glasses'}${info.firmware ? ` (firmware ${info.firmware})` : ''}`);
    this.emitter.emit('connect', info);
    return info;
  }

  disconnect(): void {
    this.transport.disconnect();
  }

  // ── Raw protocol access ──────────────────────────────────────────────

  /** Sends a command frame. Resolves when it has been written. */
  send(cmd: number, data: ArrayLike<number> = []): Promise<void> {
    return this.write(encodeFrame(cmd, data));
  }

  /** Sends a command that expects a response; resolves with the response payload. */
  query(cmd: number, data: ArrayLike<number> = [], timeoutMs = this.queryTimeoutMs): Promise<Uint8Array> {
    const qid = this.allocQueryId();
    const frame = encodeFrame(cmd, data, [qid]);
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(qid);
        reject(new ActiveLookError(`No response to command 0x${hex2(cmd)} within ${timeoutMs} ms`, 'timeout'));
      }, timeoutMs);
      this.pending.set(qid, { cmd, resolve, reject, timer });
      this.write(frame).catch(err => {
        clearTimeout(timer);
        this.pending.delete(qid);
        reject(err);
      });
    });
  }

  /**
   * Queues several commands back to back, so no other command can come in between
   * (needed for multi-frame uploads). Resolves when all have been written.
   */
  async sendMany(commands: ReadonlyArray<readonly [cmd: number, data: ArrayLike<number>]>): Promise<void> {
    const frames = commands.map(([cmd, data]) => encodeFrame(cmd, data)); // encode first: fail before sending anything
    await Promise.all(frames.map(f => this.write(f)));
  }

  /** Resolves once all queued commands have been written. */
  idle(): Promise<void> { return this.queue.idle(); }

  /** Logical → device coordinates. */
  toDevice(x: number, y: number): [number, number] {
    const { width, height, flipX, flipY } = this.profile;
    return [flipX ? width - 1 - x : x, flipY ? height - 1 - y : y];
  }

  /**
   * Device top-left corner of a w×h box whose logical top-left corner is (x, y)
   * (images, layouts, animations). Applying it to device values gives logical values back.
   */
  boxToDevice(x: number, y: number, w: number, h: number): [number, number] {
    const { width, height, flipX, flipY } = this.profile;
    return [flipX ? width - x - w : x, flipY ? height - y - h : y];
  }

  // ── Display & device ─────────────────────────────────────────────────

  /** Turns the display on or off. */
  power(on: boolean): Promise<void> { return this.send(CMD.power, bool(on)); }
  clear(): Promise<void> { return this.send(CMD.clear); }
  /** Display brightness 0–15 (persisted on the device). */
  luma(level: number): Promise<void> { return this.send(CMD.luma, u8(clamp(level, 0, 15))); }
  led(state: LedState): Promise<void> { return this.send(CMD.led, u8(state)); }
  /**
   * Shifts the whole picture (persisted on the device, also set by the ENGO app's display
   * position). Device units, the same values getSettings() reports; range about ±128 px.
   */
  shift(x: number, y: number): Promise<void> {
    const sent = this.send(CMD.shift, [...s16(x), ...s16(y)]);
    if (this._settings) this._settings = { ...this._settings, shiftX: Math.round(x), shiftY: Math.round(y) };
    return sent;
  }
  /** Gesture sensor on/off (persisted). */
  gestureDetection(enabled: boolean): Promise<void> { return this.send(CMD.gesture, bool(enabled)); }
  /** Ambient light sensor (auto brightness) on/off (persisted). */
  ambientLight(enabled: boolean): Promise<void> { return this.send(CMD.als, bool(enabled)); }

  /** Starts buffering drawing commands (nestable). */
  hold(): Promise<void> { return this.send(CMD.holdFlush, [HOLD.hold]); }
  /** Shows everything drawn since the matching hold(). */
  flush(): Promise<void> { return this.send(CMD.holdFlush, [HOLD.flush]); }
  /** Discards all nested holds and shows the buffer. */
  resetHold(): Promise<void> { return this.send(CMD.holdFlush, [HOLD.reset]); }

  /**
   * Renders a frame without flicker: hold → (clear) → render → flush.
   * Concurrent draw() calls run one after another.
   */
  draw(render: (gl: this) => void | Promise<void>, options: DrawOptions = {}): Promise<void> {
    const run = async () => {
      await this.hold();
      try {
        if (options.clear ?? true) await this.clear();
        await render(this);
      } finally {
        if (this.connected) await this.flush();
      }
    };
    const job = this.drawChain.then(run);
    this.drawChain = job.catch(() => {});
    return job;
  }

  // ── Graphics (logical coordinates) ──────────────────────────────────

  /** Grey level 0–15 for the following drawings. */
  grey(level: number): Promise<void> { return this.send(CMD.grayscale, u8(clamp(level, 0, 15))); }

  /** RG palette colour for the following drawings. Falls back to a grey level on monochrome glasses. */
  color(value: number): Promise<void> {
    if (!this._isColor) return this.grey(rgToGrey(value));
    return this.send(CMD.rgColor, u8(value));
  }

  point(x: number, y: number): Promise<void> {
    return this.send(CMD.point, this.xy(x, y));
  }

  line(x0: number, y0: number, x1: number, y1: number): Promise<void> {
    return this.send(CMD.line, [...this.xy(x0, y0), ...this.xy(x1, y1)]);
  }

  rect(x0: number, y0: number, x1: number, y1: number): Promise<void> {
    return this.send(CMD.rect, [...this.xy(x0, y0), ...this.xy(x1, y1)]);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number): Promise<void> {
    return this.send(CMD.rectFull, [...this.xy(x0, y0), ...this.xy(x1, y1)]);
  }

  circle(x: number, y: number, r: number): Promise<void> {
    return this.send(CMD.circ, [...this.xy(x, y), clamp(r, 0, 255)]);
  }

  fillCircle(x: number, y: number, r: number): Promise<void> {
    return this.send(CMD.circFull, [...this.xy(x, y), clamp(r, 0, 255)]);
  }

  /**
   * Arc around (x, y). Angles in degrees, 0° = 3 o'clock, increasing clockwise, as seen
   * by the wearer; converted to the device's convention according to the profile.
   * Not yet verified on hardware.
   */
  arc(x: number, y: number, r: number, startDeg: number, endDeg: number, thickness = 1): Promise<void> {
    const [s, e] = this.arcToDevice(startDeg, endDeg);
    return this.send(CMD.arc, [...this.xy(x, y), clamp(r, 0, 255), ...s16(s), ...s16(e), clamp(thickness, 1, 255)]);
  }

  /** Connected line through the points. Long lists are split into several commands. */
  async polyline(points: readonly Point[], thickness = 1): Promise<void> {
    if (points.length < 2) return;
    let last: Promise<void> = Promise.resolve();
    for (let i = 0; i < points.length - 1; i += POLYLINE_MAX_POINTS - 1) {
      const part = points.slice(i, i + POLYLINE_MAX_POINTS);
      const data = [clamp(thickness, 1, 255), 0, 0];
      for (const [px, py] of part) data.push(...this.xy(px, py));
      last = this.send(CMD.polyline, data);
    }
    return last;
  }

  /** Text with (x, y) at the top-left corner of the first character. */
  text(str: string, x: number, y: number, options: TextOptions = {}): Promise<void> {
    const font = options.font ?? 1;
    const rotation = options.rotation ?? this.profile.textRotation;
    const fontHeight = this.fontHeight(font);
    // The device anchors text at the opposite corner when y is mirrored.
    const anchorY = this.profile.flipY ? y + fontHeight : y;
    const s = (options.transliterate ?? this.transliterate) ? toAscii(str) : str;
    const head = [...this.xy(x, anchorY), rotation & 0xff, font & 0xff];
    if (options.color != null && this._isColor) {
      return this.send(CMD.txtColor, [...head, options.color & 0xff, ...cstring(s)]);
    }
    const grey = options.color != null ? rgToGrey(options.color) : (options.grey ?? 15);
    return this.send(CMD.txt, [...head, clamp(grey, 0, 15), ...cstring(s)]);
  }

  /** Approximate text width in px (built-in fonts are not monospaced). */
  measureText(str: string, font = 1): number {
    const h = this.fontHeight(font);
    return Math.round(str.length * h * 0.5);
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /** Battery level in % via the ActiveLook command (the BLE battery service is used for `battery`). */
  async getBattery(): Promise<number> {
    const level = new ByteReader(await this.query(CMD.battery)).u8();
    this._battery = level;
    return level;
  }

  async getVersion(): Promise<VersionInfo> {
    const r = new ByteReader(await this.query(CMD.version));
    const [major, minor, patch, build] = [r.u8(), r.u8(), r.u8(), r.u8()];
    const suffix = build >= 0x20 && build <= 0x7e ? String.fromCharCode(build) : build ? `.${build}` : '';
    const year = r.u8();
    const week = r.u8();
    const serialNumber = r.remaining >= 3 ? (r.u8() << 16) | (r.u8() << 8) | r.u8() : 0;
    return { firmware: `${major}.${minor}.${patch}${suffix}`, manufacturingYear: year, manufacturingWeek: week, serialNumber };
  }

  async getSettings(): Promise<Settings> {
    const r = new ByteReader(await this.query(CMD.settings));
    this._settings = { shiftX: r.s8(), shiftY: r.s8(), luma: r.u8(), ambientLight: r.bool(), gesture: r.bool() };
    return this._settings;
  }

  /** Fonts installed on the device (same as `fonts.list()`). */
  listFonts(): Promise<FontInfo[]> { return this.fonts.list(); }

  /** Raw value of a device parameter (rdDevInfo), see `DEVICE_INFO` for ids. */
  readDeviceInfo(id: number): Promise<Uint8Array> {
    return this.query(CMD.rdDevInfo, [id & 0xff]);
  }

  /** Number of pixels currently lit on the display. */
  async pixelCount(): Promise<number> {
    return new ByteReader(await this.query(CMD.pixelCount)).u32();
  }

  // ── Device ────────────────────────────────────────────────────────────

  /** Fills the whole display with a grey level (0x02). */
  fill(level: number): Promise<void> { return this.send(CMD.grey, u8(clamp(level, 0, 15))); }

  /** Built-in test patterns: 0 fill, 1 rectangle with cross, 2 next stored image. */
  demo(pattern: 0 | 1 | 2): Promise<void> { return this.send(CMD.demo, u8(pattern)); }

  /** Switches the glasses off. Not possible while charging (USB). */
  shutdown(): Promise<void> { return this.send(CMD.shutdown, SHUTDOWN_KEY); }

  /** Restarts the glasses. Only possible while charging (USB). */
  reset(): Promise<void> { return this.send(CMD.reset, RESET_KEY); }

  // ── Internals ────────────────────────────────────────────────────────

  private write(frame: Uint8Array): Promise<void> {
    if (!this.connected) return Promise.reject(new ActiveLookError('Not connected', 'not-connected'));
    if (this.verbose) this.log(`→ ${toHex(frame)}`);
    return this.queue.enqueue(frame);
  }

  private xy(x: number, y: number): number[] {
    const [dx, dy] = this.toDevice(x, y);
    return [...s16(dx), ...s16(dy)];
  }

  /** Maps a logical arc to device angles, keeping the sweep direction clockwise. */
  arcToDevice(startDeg: number, endDeg: number): [number, number] {
    const { flipX, flipY } = this.profile;
    const sweep = endDeg - startDeg;
    // A single mirror reverses the direction: the device arc starts at the logical end.
    const base = flipX !== flipY ? endDeg : startDeg;
    let a = base;
    if (flipX) a = 180 - a;
    if (flipY) a = -a;
    const s = ((Math.round(a) % 360) + 360) % 360;
    return [s, s + Math.round(sweep)];
  }

  private allocQueryId(): number {
    for (let i = 0; i < 255; i++) {
      const id = this.nextQueryId;
      this.nextQueryId = (this.nextQueryId % 255) + 1;
      if (!this.pending.has(id)) return id;
    }
    throw new ActiveLookError('Too many pending queries', 'device');
  }

  private handleData(bytes: Uint8Array): void {
    if (this.verbose) this.log(`← ${toHex(bytes)}`);
    for (const frame of this.decoder.push(bytes)) this.handleFrame(frame);
  }

  private handleFrame(frame: Frame): void {
    if (frame.cmd === CMD.error) {
      const r = new ByteReader(frame.data);
      const cmd = r.remaining ? r.u8() : 0;
      const code = r.remaining ? r.u8() : 0;
      const subCode = r.remaining ? r.u8() : 0;
      const message = `${DEVICE_ERRORS[code] ?? `Error ${code}`} (command 0x${hex2(cmd)}${subCode ? `, sub-error ${subCode}` : ''})`;
      this.log(`Device error: ${message}`);
      this.emitter.emit('error', { source: 'command', code, cmd, subCode, message });
      for (const [id, p] of this.pending) {
        if (p.cmd === cmd) this.settle(id, p, new ActiveLookError(message, 'device'));
      }
      return;
    }
    const qid = frame.queryId.length ? frame.queryId[0]! : undefined;
    let entry: [number, PendingQuery] | undefined;
    if (qid !== undefined) {
      const p = this.pending.get(qid);
      if (p) entry = [qid, p];
    } else {
      entry = [...this.pending].find(([, p]) => p.cmd === frame.cmd); // device did not echo the query id
    }
    if (entry) this.settle(entry[0], entry[1], frame.data);
  }

  private settle(id: number, p: PendingQuery, result: Uint8Array | Error): void {
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (result instanceof Error) p.reject(result);
    else p.resolve(result);
  }

  private handleControl(code: number): void {
    if (this.verbose) this.log(`⚑ control 0x${hex2(code)}`);
    this.emitter.emit('flow', code);
    if (code === CONTROL.busy) this.queue.pause();
    else if (code === CONTROL.ready) this.queue.resume();
    else {
      this.queue.resume();
      const message = CONTROL_MESSAGES[code] ?? `Control error 0x${hex2(code)}`;
      this.log(`Device: ${message}`);
      this.emitter.emit('error', { source: 'control', code, message });
    }
  }

  private handleDisconnect(): void {
    this.queue.resume();
    this.decoder.reset();
    for (const [id, p] of this.pending) this.settle(id, p, new ActiveLookError('Disconnected', 'disconnected'));
    this.releaseWakeLock?.();
    this.releaseWakeLock = null;
    this.log('Disconnected');
    this.emitter.emit('disconnect', undefined);
  }

  private log(message: string): void {
    this.logFn(message);
  }
}

function inputEvent(bytes: Uint8Array): InputEvent {
  return { value: bytes.length ? bytes[0]! : 0, bytes, timestamp: Date.now() };
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');
