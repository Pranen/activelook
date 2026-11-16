/**
 * Serialises writes to the glasses and honours flow control.
 *
 * Web Bluetooth rejects overlapping GATT operations, so every frame goes through this
 * queue. Frames longer than the transport's chunk size are split. When the Control
 * characteristic reports "busy" (0x02), writing pauses until "ready" (0x01) arrives or
 * `pauseTimeoutMs` elapses.
 */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private paused = false;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly write: (chunk: Uint8Array) => Promise<void>,
    private readonly chunkSize: () => number,
    private readonly pauseTimeoutMs = 3000,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  get isPaused(): boolean { return this.paused; }

  enqueue(frame: Uint8Array): Promise<void> {
    const run = async () => {
      const size = Math.max(1, this.chunkSize());
      for (let off = 0; off < frame.length; off += size) {
        await this.waitWhilePaused();
        await this.write(frame.subarray(off, off + size));
      }
    };
    const job = this.tail.then(run);
    this.tail = job.catch(() => {}); // one failed write must not block the rest
    return job;
  }

  /** Resolves when everything queued so far has been written. */
  idle(): Promise<void> { return this.tail; }

  pause(): void { this.paused = true; }

  resume(): void {
    this.paused = false;
    const w = this.waiters;
    this.waiters = [];
    w.forEach(fn => fn());
  }

  private waitWhilePaused(): Promise<void> | void {
    if (!this.paused) return;
    return new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(fn => fn !== done);
        this.log(`Flow control: no "ready" after ${this.pauseTimeoutMs} ms, resuming`);
        this.paused = false;
        resolve();
      }, this.pauseTimeoutMs);
      this.waiters.push(done);
    });
  }
}
