import { ActiveLookError } from '../errors.js';
import { FrameDecoder, encodeFrame, type Frame } from '../protocol/frame.js';
import type { DeviceInfo, Transport, TransportEvents } from './types.js';

export interface MockTransportOptions {
  info?: DeviceInfo;
  battery?: number | null;
  maxChunkSize?: number;
  /**
   * Answers queries. Return the response payload (the mock wraps it in a frame with the
   * same command and query id) or undefined for no response.
   */
  respond?: (frame: Frame) => ArrayLike<number> | undefined;
}

/** In-memory transport for tests and for running demos without glasses. */
export class MockTransport implements Transport {
  connected = false;
  readonly maxChunkSize: number;
  /** Every chunk passed to write(), in order. */
  readonly writes: Uint8Array[] = [];
  /** Every decoded command frame, in order. */
  readonly frames: Frame[] = [];

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
      const payload = this.options.respond?.(frame);
      if (payload) {
        const reply = encodeFrame(frame.cmd, payload, frame.queryId);
        queueMicrotask(() => this.events?.onData(reply));
      }
    }
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
