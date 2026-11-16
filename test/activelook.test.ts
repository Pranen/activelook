import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveLook, CMD, ENGO3, MockTransport, ScreenPager, defineProfile, encodeFrame, visibleArea, type Frame } from '../src/index.js';

async function connected(opts: ConstructorParameters<typeof MockTransport>[0] = {}, profile = ENGO3) {
  const mock = new MockTransport(opts);
  // Without mock answers, reading the device state on connect would only wait for timeouts.
  const gl = new ActiveLook({ transport: mock, profile, readDeviceState: opts.defaultResponses !== false });
  await gl.connect();
  mock.clearLog(); // drop the font/settings queries sent on connect
  return { gl, mock };
}

const bytes = (f: Frame) => [...f.data];

afterEach(() => { vi.useRealTimers(); });

describe('coordinates (ENGO 3: both axes mirrored)', () => {
  it('mirrors points', async () => {
    const { gl, mock } = await connected();
    await gl.point(0, 0);
    expect(mock.frames[0]!.cmd).toBe(CMD.point);
    expect(bytes(mock.frames[0]!)).toEqual([0x01, 0x2f, 0x00, 0xff]); // (303, 255)
  });

  it('does not mirror with a plain profile', async () => {
    const { gl, mock } = await connected({}, defineProfile(ENGO3, { flipX: false, flipY: false }));
    await gl.line(1, 2, 3, 4);
    expect(bytes(mock.frames[0]!)).toEqual([0, 1, 0, 2, 0, 3, 0, 4]);
  });

  it('compensates the font height for text when y is mirrored', async () => {
    const { gl, mock } = await connected();
    await gl.text('Hi', 10, 20, { font: 2 });
    const f = mock.frames[0]!;
    expect(f.cmd).toBe(CMD.txt);
    // x: 303-10 = 293, y: 255-(20+38) = 197 (font 2 height read from the device), rotation 4, font 2, grey 15, "Hi\0"
    expect(bytes(f)).toEqual([0x01, 0x25, 0x00, 0xc5, 4, 2, 15, 0x48, 0x69, 0]);
  });

  it('uses txtColor on colour glasses and transliterates', async () => {
    const { gl, mock } = await connected();
    await gl.text('ä', 0, 0, { font: 0, color: 0x3c });
    const f = mock.frames[0]!;
    expect(f.cmd).toBe(CMD.txtColor);
    expect(bytes(f).slice(4)).toEqual([4, 0, 0x3c, 0x61, 0x65, 0]);
  });

  it('falls back to grey on monochrome glasses', async () => {
    const { gl, mock } = await connected({ info: { hardware: 'ALK01-MDP05' } });
    expect(gl.isColor).toBe(false);
    await gl.color(0xff);
    await gl.text('x', 0, 0, { color: 0xff });
    expect(mock.frames.map(f => f.cmd)).toEqual([CMD.grayscale, CMD.txt]);
  });
});

describe('arc angles', () => {
  it('rotates by 180° when both axes are mirrored', () => {
    const gl = new ActiveLook({ transport: new MockTransport() });
    expect(gl.arcToDevice(0, 90)).toEqual([180, 270]);
    expect(gl.arcToDevice(0, 360)).toEqual([180, 540]);
  });

  it('reverses the start when only one axis is mirrored', () => {
    const gl = new ActiveLook({ transport: new MockTransport(), profile: defineProfile(ENGO3, { flipY: false }) });
    // logical 0→90 (3 → 6 o'clock) mirrored in x is device 90→180
    expect(gl.arcToDevice(0, 90)).toEqual([90, 180]);
  });
});

describe('polyline', () => {
  it('splits long point lists into several commands', async () => {
    const { gl, mock } = await connected();
    const pts = Array.from({ length: 200 }, (_, i) => [i, i] as const);
    await gl.polyline(pts, 2);
    expect(mock.frames).toHaveLength(2);
    expect((mock.frames[0]!.data.length - 3) / 4).toBe(127);
    expect((mock.frames[1]!.data.length - 3) / 4).toBe(74); // 200 - 126 (shared point)
  });
});

describe('queue and flow control', () => {
  it('splits frames into chunks', async () => {
    const { gl, mock } = await connected({ maxChunkSize: 20 });
    await gl.text('A fairly long line of text', 0, 0);
    expect(mock.writes.every(w => w.length <= 20)).toBe(true);
    expect(mock.frames).toHaveLength(1);
  });

  it('pauses on busy and resumes on ready', async () => {
    const { gl, mock } = await connected();
    mock.emitControl(0x02);
    const p = gl.clear();
    await Promise.resolve();
    await Promise.resolve();
    expect(mock.frames).toHaveLength(0);
    mock.emitControl(0x01);
    await p;
    expect(mock.frames).toHaveLength(1);
  });

  it('reports control errors as events', async () => {
    const { gl, mock } = await connected();
    const errors: unknown[] = [];
    gl.on('error', e => errors.push(e));
    mock.emitControl(0x04);
    expect(errors).toEqual([{ source: 'control', code: 4, message: 'Receive queue overflow' }]);
  });

  it('keeps command order without awaiting', async () => {
    const { gl, mock } = await connected();
    void gl.hold(); void gl.clear(); void gl.grey(3); await gl.flush();
    expect(mock.frames.map(f => f.cmd)).toEqual([CMD.holdFlush, CMD.clear, CMD.grayscale, CMD.holdFlush]);
  });
});

describe('queries', () => {
  it('matches responses by query id', async () => {
    const { gl } = await connected({
      respond: f => (f.cmd === CMD.version ? [4, 12, 0, 0x62, 24, 7, 0, 1, 2] : f.cmd === CMD.settings ? [0xfe, 3, 10, 0, 1] : undefined),
    });
    expect(await gl.getVersion()).toEqual({ firmware: '4.12.0b', manufacturingYear: 24, manufacturingWeek: 7, serialNumber: 258 });
    expect(await gl.getSettings()).toEqual({ shiftX: -2, shiftY: 3, luma: 10, ambientLight: false, gesture: true });
  });

  it('times out without response', async () => {
    vi.useFakeTimers();
    const { gl } = await connected({ defaultResponses: false });
    const p = gl.query(CMD.battery, [], 100);
    const check = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(150);
    await check;
  });

  it('rejects on an async device error for the same command', async () => {
    const { gl, mock } = await connected({ defaultResponses: false });
    const errors: unknown[] = [];
    gl.on('error', e => errors.push(e));
    const p = gl.query(CMD.fontList);
    mock.emitData(encodeFrame(CMD.error, [CMD.fontList, 4, 0]));
    await expect(p).rejects.toMatchObject({ code: 'device' });
    expect(errors).toHaveLength(1);
  });

  it('rejects pending queries on disconnect', async () => {
    const { gl, mock } = await connected({ defaultResponses: false });
    const onDisc = vi.fn();
    gl.on('disconnect', onDisc);
    const p = gl.query(CMD.battery);
    mock.disconnect();
    await expect(p).rejects.toMatchObject({ code: 'disconnected' });
    expect(onDisc).toHaveBeenCalledOnce();
  });
});

describe('device state on connect', () => {
  it('reads fonts and settings', async () => {
    const { gl } = await connected();
    expect(gl.fontHeight(3)).toBe(64);
    expect(gl.fonts.installed).toHaveLength(8);
    expect(gl.settings).toEqual({ shiftX: 3, shiftY: 30, luma: 10, ambientLight: false, gesture: true });
  });

  it('falls back to profile font heights without answers', async () => {
    vi.useFakeTimers();
    const mock = new MockTransport({ defaultResponses: false });
    const gl = new ActiveLook({ transport: mock, queryTimeoutMs: 50 });
    const p = gl.connect();
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(gl.fonts.installed).toEqual([]);
    expect(gl.fontHeight(2)).toBe(ENGO3.fontHeights[2]);
    expect(gl.settings).toBeNull();
  });

  it('sends shift in device units, as getSettings reports it', async () => {
    const { gl, mock } = await connected();
    await gl.shift(3, -30);
    expect(bytes(mock.frames[0]!)).toEqual([0x00, 0x03, 0xff, 0xe2]);
  });
});

describe('visible area follows the picture shift', () => {
  it('matches the measurement at the stored shift (3, 30)', async () => {
    const { gl } = await connected(); // the mock reports shift (3, 30) like the real glasses
    expect(gl.safeArea).toEqual({ x: 3, y: 30, width: 268, height: 226 }); // x 3–270, y 30–255
  });

  it('moves with the shift (mirrored axes) and clips to the panel', () => {
    expect(visibleArea(ENGO3, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 268, height: 250 });
    expect(visibleArea(ENGO3, { x: 13, y: 40 })).toEqual({ x: 13, y: 40, width: 268, height: 216 });
    expect(visibleArea(ENGO3, null)).toEqual(ENGO3.safeArea);
  });

  it('moves the other way without mirroring', () => {
    const plain = defineProfile(ENGO3, { flipX: false, flipY: false, safeArea: { x: 10, y: 10, width: 100, height: 100 }, safeAreaShift: { x: 0, y: 0 } });
    expect(visibleArea(plain, { x: 5, y: 0 })).toEqual({ x: 5, y: 10, width: 100, height: 100 });
  });

  it('updates after shift() and getSettings()', async () => {
    const { gl, mock } = await connected();
    await gl.shift(0, 0);
    expect(gl.safeArea).toEqual({ x: 0, y: 0, width: 268, height: 250 });
    expect(mock.shift).toEqual({ x: 0, y: 0 });
    expect((await gl.getSettings()).shiftY).toBe(0);
  });
});

describe('events and draw', () => {
  it('emits input and battery events', async () => {
    const { gl, mock } = await connected({ battery: 80 });
    expect(gl.battery).toBe(80);
    const seen: string[] = [];
    gl.on('gesture', e => seen.push(`g${e.value}`));
    const off = gl.on('touch', e => seen.push(`t${e.value}`));
    gl.on('battery', l => seen.push(`b${l}`));
    mock.emitGesture(1); mock.emitTouch(1); off(); mock.emitTouch(1); mock.emitBattery(55);
    expect(seen).toEqual(['g1', 't1', 'b55']);
    expect(gl.battery).toBe(55);
  });

  it('wraps draw() in hold/clear/flush and flushes on error', async () => {
    const { gl, mock } = await connected();
    await gl.draw(g => { void g.point(1, 1); });
    await expect(gl.draw(() => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(mock.frames.map(f => f.cmd)).toEqual([
      CMD.holdFlush, CMD.clear, CMD.point, CMD.holdFlush,
      CMD.holdFlush, CMD.clear, CMD.holdFlush,
    ]);
    expect(mock.frames[3]!.data[0]).toBe(1);
  });

  it('rejects commands when not connected', async () => {
    const gl = new ActiveLook({ transport: new MockTransport() });
    await expect(gl.clear()).rejects.toMatchObject({ code: 'not-connected' });
  });
});

describe('ScreenPager', () => {
  it('advances on gesture with debounce', async () => {
    const { gl, mock } = await connected();
    const drawn: string[] = [];
    const pager = new ScreenPager(gl, [
      { name: 'a', render: () => { drawn.push('a'); } },
      { name: 'b', render: () => { drawn.push('b'); } },
    ], { liveIntervalMs: 60_000 });
    pager.start();
    await gl.idle();
    mock.emitGesture(); mock.emitGesture(); // second press is debounced
    await new Promise(r => setTimeout(r, 0));
    await gl.idle();
    pager.stop();
    expect(pager.index).toBe(1);
    expect(drawn).toEqual(['a', 'b']);
  });
});
