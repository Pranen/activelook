import type { ActiveLook } from '../activelook.js';

export interface Screen {
  name: string;
  /** Draws the screen. Called inside `gl.draw()`, so the display is already cleared and held. */
  render(gl: ActiveLook): void | Promise<void>;
  /** Redraw periodically while visible (e.g. clocks). */
  live?: boolean;
}

export interface PagerOptions {
  /** Which input turns the page. Default 'both'. On ENGO 3 the temple press arrives as a gesture. */
  input?: 'gesture' | 'touch' | 'both' | 'none';
  /** Ignore inputs closer together than this (one press can notify several times). Default 500 ms. */
  debounceMs?: number;
  /** Redraw interval for live screens, aligned to wall-clock multiples. Default 1000 ms. */
  liveIntervalMs?: number;
  /** Called after the page changed. */
  onChange?: (index: number, screen: Screen) => void;
  /** Called when rendering fails. */
  onError?: (error: unknown) => void;
}

/**
 * Switches between screens with the temple button and redraws live screens.
 * Inputs only advance (left/right presses are not distinguishable on ENGO 3).
 */
export class ScreenPager {
  private _index = 0;
  private lastInput = 0;
  private rendering = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: Array<() => void> = [];

  constructor(
    readonly gl: ActiveLook,
    readonly screens: readonly Screen[],
    private readonly options: PagerOptions = {},
  ) {
    if (!screens.length) throw new Error('ScreenPager needs at least one screen');
  }

  get index(): number { return this._index; }
  get current(): Screen { return this.screens[this._index]!; }
  get running(): boolean { return this.unsubscribe.length > 0; }

  /** Subscribes to inputs, starts the live timer and draws the current screen. */
  start(): void {
    if (this.running) return;
    const input = this.options.input ?? 'both';
    const onInput = () => {
      const now = Date.now();
      if (now - this.lastInput < (this.options.debounceMs ?? 500)) return;
      this.lastInput = now;
      this.next();
    };
    if (input === 'gesture' || input === 'both') this.unsubscribe.push(this.gl.on('gesture', onInput));
    if (input === 'touch' || input === 'both') this.unsubscribe.push(this.gl.on('touch', onInput));
    this.unsubscribe.push(() => {}); // marks running even with input 'none'
    this.scheduleLive();
    void this.render();
  }

  stop(): void {
    this.unsubscribe.forEach(fn => fn());
    this.unsubscribe = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  next(): void { this.go(this._index + 1); }
  prev(): void { this.go(this._index - 1); }

  go(index: number): void {
    const n = this.screens.length;
    this._index = ((index % n) + n) % n;
    this.options.onChange?.(this._index, this.current);
    void this.render();
  }

  /** Draws the current screen. If a render is in progress, one more render follows it. */
  async render(): Promise<void> {
    if (!this.gl.connected) return;
    if (this.rendering) { this.dirty = true; return; }
    this.rendering = true;
    try {
      do {
        this.dirty = false;
        const screen = this.current;
        await this.gl.draw(gl => screen.render(gl));
      } while (this.dirty && this.gl.connected);
    } catch (e) {
      this.options.onError?.(e);
    } finally {
      this.rendering = false;
    }
  }

  private scheduleLive(): void {
    const interval = this.options.liveIntervalMs ?? 1000;
    this.timer = setTimeout(() => {
      if (!this.running) return;
      if (this.current.live) void this.render();
      this.scheduleLive();
    }, interval - (Date.now() % interval));
  }
}
