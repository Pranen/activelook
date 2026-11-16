import { describe, expect, it } from 'vitest';
import {
  ActiveLook,
  CMD,
  ENGO3,
  MockTransport,
  chunkImage,
  createBitmap,
  defineProfile,
  encodeImage,
  heatshrinkDecompress,
  toHex,
  type Bitmap,
  type Frame,
  type MockTransportOptions,
} from '../src/index.js';

/** Profile without mirroring: frames must match the examples in the API docs. */
const PLAIN = defineProfile(ENGO3, { flipX: false, flipY: false });

async function connect(profile = ENGO3, opts: MockTransportOptions = {}) {
  const mock = new MockTransport(opts);
  const gl = new ActiveLook({ transport: mock, profile });
  await gl.connect();
  mock.clearLog();
  return { gl, mock };
}

const data = (f: Frame) => toHex(f.data);

/** Bitmap from grey levels 0–15, rows top to bottom. */
function greyBitmap(rows: number[][]): Bitmap {
  const b = createBitmap(rows[0]!.length, rows.length);
  const d = b.data as Uint8ClampedArray;
  rows.forEach((row, y) => row.forEach((g, x) => {
    const i = (y * b.width + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = g * 17;
    d[i + 3] = 255;
  }));
  return b;
}

describe('configurations', () => {
  it('encodes cfgWrite like the docs example', async () => {
    const { gl, mock } = await connect();
    await gl.configs.write('Demo', { version: 0, password: 123456 });
    expect(toHex(mock.writes[0]!)).toBe('ff d0 00 12 44 65 6d 6f 00 00 00 00 00 00 01 e2 40 aa');
  });

  it('rejects invalid names', async () => {
    const { gl } = await connect();
    expect(() => gl.configs.write('a-very-long-name')).toThrow(RangeError);
    expect(() => gl.configs.write('')).toThrow(RangeError);
  });

  it('parses list, read and free space', async () => {
    const { gl } = await connect(ENGO3, {
      respond: f =>
        f.cmd === CMD.cfgList ? [0x41, 0x42, 0, 0, 0, 0x10, 0, 0, 0, 0, 2, 3, 1, 0, 0x53, 0x59, 0x53, 0, 0, 0, 0, 1, 0, 0, 0, 1, 9, 9, 1]
        : f.cmd === CMD.cfgRead ? [0, 0, 0, 7, 1, 2, 3, 4, 5]
        : f.cmd === CMD.cfgFreeSpace ? [0, 0x30, 0, 0, 0, 0x10, 0, 0]
        : undefined,
    });
    expect(await gl.configs.list()).toEqual([
      { name: 'AB', size: 4096, version: 2, usageCount: 3, installCount: 1, isSystem: false },
      { name: 'SYS', size: 1, version: 1, usageCount: 9, installCount: 9, isSystem: true },
    ]);
    expect(await gl.configs.read('AB')).toEqual({ version: 7, images: 1, layouts: 2, fonts: 3, pages: 4, gauges: 5 });
    expect(await gl.configs.freeSpace()).toEqual({ total: 0x300000, free: 0x100000 });
  });
});

describe('image encoding', () => {
  it('puts the first pixel in the low nibble (4bpp) and pads odd widths', () => {
    const e = encodeImage(greyBitmap([[0, 2, 15]]), 'grey4');
    expect(e.rowBytes).toBe(2);
    expect([...e.data]).toEqual([0x20, 0x0f]);
  });

  it('puts the first pixel in bit 0 (1bpp) and pads rows to 8 pixels', () => {
    const e = encodeImage(greyBitmap([[15, 0, 0, 0, 0, 0, 0, 0, 15]]), 'mono1');
    expect([...e.data]).toEqual([0x01, 0x01]);
  });

  it('encodes grey + alpha and RG colour', () => {
    const b = greyBitmap([[15]]);
    expect([...encodeImage(b, 'greyAlpha8').data]).toEqual([0xff]);
    const c = createBitmap(2, 1);
    (c.data as Uint8ClampedArray).set([255, 0, 0, 255, 255, 255, 0, 0]); // red, transparent yellow
    const raw = (f: 'color8' | 'colorAlpha8') => { const e = encodeImage(c, f); return [...heatshrinkDecompress(e.data, e.size)]; };
    expect(raw('color8')).toEqual([0x3c, 0x00]);
    expect(raw('colorAlpha8')).toEqual([0x3c, 0x00, 0x0f]);
  });

  it('chunks whole rows', () => {
    const e = encodeImage(createBitmap(100, 20), 'grey4'); // 50 bytes per row
    const chunks = chunkImage(e);
    expect(chunks.map(c => c.length)).toEqual([500, 500]);
  });
});

describe('images', () => {
  it('sends imgSave like the docs example (15×10, 4bpp)', async () => {
    const { gl, mock } = await connect(PLAIN);
    await gl.images.save(10, createBitmap(15, 10));
    expect(toHex(mock.writes[0]!)).toBe('ff 41 00 0d 0a 00 00 00 50 00 0f 00 aa');
    expect(mock.frames[1]!.cmd).toBe(CMD.imgSave);
    expect(mock.frames[1]!.data.length).toBe(80);
    expect(mock.writes[1]![3]).toBe(0x55); // length byte as in the docs
  });

  it('mirrors pixels and anchors at the far corner on ENGO 3', async () => {
    const { gl, mock } = await connect();
    await gl.images.save(1, greyBitmap([[15, 0]])); // white, black → stored black, white
    expect(data(mock.frames[1]!)).toBe('f0');
    await gl.images.display(1, 10, 20);
    expect(data(mock.frames[2]!)).toBe('01 01 24 00 eb'); // (304-10-2, 256-20-1) = (292, 235)
  });

  it('looks up the size on the glasses when unknown', async () => {
    const { gl, mock } = await connect(ENGO3, { respond: f => (f.cmd === CMD.imgList ? [5, 0, 10, 0, 20] : undefined) });
    await gl.images.display(5, 0, 0);
    const show = mock.frames.find(f => f.cmd === CMD.imgDisplay)!;
    expect(data(show)).toBe('05 01 1c 00 f6'); // (304-20, 256-10) = (284, 246)
  });

  it('keeps upload frames together', async () => {
    const { gl, mock } = await connect();
    const save = gl.images.save(2, createBitmap(100, 20));
    void gl.clear();
    await save;
    await gl.idle();
    expect(mock.frames.map(f => f.cmd)).toEqual([CMD.imgSave, CMD.imgSave, CMD.imgSave, CMD.clear]);
  });

  it('refuses colour formats on grey glasses', async () => {
    const { gl } = await connect(ENGO3, { info: { hardware: 'ALK01-MDP05' } });
    await expect(gl.images.save(1, createBitmap(2, 2), { format: 'color8' })).rejects.toThrow(/colour/);
  });

  it('streams 1bpp images like the docs example', async () => {
    const { gl, mock } = await connect(PLAIN);
    await gl.images.stream(createBitmap(15, 10), 50, 80);
    expect(data(mock.frames[0]!)).toBe('00 00 00 14 00 0f 00 32 00 50 01');
    expect(mock.frames[1]!.data.length).toBe(20);
  });
});

describe('layouts', () => {
  it('encodes layoutSave like the docs example', async () => {
    const { gl, mock } = await connect(PLAIN);
    await gl.layouts.save(10, {
      x: 0, y: 0, width: 303, height: 255, foreColor: 15, backColor: 0, font: 1,
      text: { x: 238, y: 30, rotation: 4, opaque: true },
    });
    expect(data(mock.frames[0]!)).toBe('0a 00 00 00 00 01 2f ff 0f 00 01 01 00 ee 1e 04 01');
  });

  it('encodes additional commands like the docs example', async () => {
    const { gl, mock } = await connect(PLAIN);
    await gl.layouts.save(20, {
      x: 0, y: 0, width: 303, height: 230, foreColor: 15, backColor: 0, font: 2,
      text: { x: 175, y: 135, rotation: 4, opaque: true },
      commands: [{ type: 'gauge', id: 1 }, { type: 'text', x: 108, y: 135, text: '%' }],
    });
    expect(data(mock.frames[0]!)).toBe('14 09 00 00 00 01 2f e6 0f 00 02 01 00 af 87 04 01 0a 01 09 00 6c 00 87 01 25');
  });

  it('mirrors the clip region and positions inside it on ENGO 3', async () => {
    const { gl, mock } = await connect();
    await gl.layouts.save(3, {
      x: 10, y: 20, width: 100, height: 50, font: 1, text: { x: 0, y: 0 },
      commands: [{ type: 'line', x0: 0, y0: 0, x1: 99, y1: 0 }],
    });
    // clip at (304-10-100, 256-20-50) = (194, 186); text anchor (99, 49-24) = (99, 25)
    expect(data(mock.frames[0]!)).toBe('03 09 00 c2 ba 00 64 32 0f 00 01 01 00 63 19 04 01 05 00 63 00 31 00 00 00 31');
  });

  it('sends display, position and lists', async () => {
    const { gl, mock } = await connect(PLAIN, { respond: f => (f.cmd === CMD.layoutList ? [10, 20] : undefined) });
    await gl.layouts.display(10, '15:38');
    await gl.layouts.position(10, 30, 25);
    expect(data(mock.frames[0]!)).toBe('0a 31 35 3a 33 38 00');
    expect(data(mock.frames[1]!)).toBe('0a 00 1e 19');
    expect(await gl.layouts.list()).toEqual([10, 20]);
  });

  it('positions mirrored layouts with their stored size', async () => {
    const { gl, mock } = await connect(ENGO3, {
      respond: f => (f.cmd === CMD.layoutGet ? [0, 0, 0, 0, 0, 100, 50, 15, 0, 1, 0, 0, 0, 0, 4, 0] : undefined),
    });
    await gl.layouts.position(7, 10, 20);
    const pos = mock.frames.find(f => f.cmd === CMD.layoutPosition)!;
    expect(data(pos)).toBe('07 00 c2 ba');
  });
});

describe('gauges', () => {
  it('encodes gaugeSave and gaugeDisplay like the docs examples', async () => {
    const { gl, mock } = await connect(PLAIN);
    await gl.gauges.save(1, { x: 151, y: 127, radius: 110, innerRadius: 75, start: 3, end: 14, clockwise: true });
    await gl.gauges.display(1, 85);
    expect(data(mock.frames[0]!)).toBe('01 00 97 00 7f 00 6e 00 4b 03 0e 01');
    expect(data(mock.frames[1]!)).toBe('01 55');
  });

  it('rotates centre and portions by half a turn on ENGO 3', async () => {
    const { gl, mock } = await connect();
    await gl.gauges.save(1, { x: 151, y: 127, radius: 110, innerRadius: 75, start: 3, end: 14 });
    expect(data(mock.frames[0]!)).toBe('01 00 98 00 80 00 6e 00 4b 0b 06 01');
  });
});

describe('pages', () => {
  it('saves layout positions and displays texts', async () => {
    const { gl, mock } = await connect(PLAIN);
    await gl.layouts.save(1, { x: 0, y: 0, width: 50, height: 30 });
    await gl.pages.save(2, [{ layout: 1, x: 10, y: 20 }, { layout: 1, x: 10, y: 60 }]);
    await gl.pages.display(2, ['A', 'B']);
    expect(data(mock.frames[1]!)).toBe('02 01 00 0a 14 01 00 0a 3c');
    expect(data(mock.frames[2]!)).toBe('02 41 00 42 00');
  });

  it('rejects more than 10 layouts', async () => {
    const { gl } = await connect(PLAIN);
    const many = Array.from({ length: 11 }, () => ({ layout: 1, x: 0, y: 0 }));
    await expect(gl.pages.save(1, many)).rejects.toThrow(RangeError);
  });
});

describe('animations, fonts and device', () => {
  it('needs the size of an animation on mirrored displays', async () => {
    const { gl, mock } = await connect();
    expect(() => gl.animations.display(0, 1, 0, 0)).toThrow(/size/);
    await gl.animations.display(0, 1, 10, 20, { width: 30, height: 40, delayMs: 50, repeat: 2 });
    expect(data(mock.frames[0]!)).toBe('00 01 00 32 02 01 08 00 c4'); // (304-10-30, 256-20-40)
  });

  it('uploads fonts in chunks', async () => {
    const { gl, mock } = await connect();
    const font = new Uint8Array(600);
    font[0] = 2; font[1] = 30;
    await gl.fonts.save(9, font);
    expect(data(mock.frames[0]!)).toBe('09 02 58');
    expect(mock.frames.slice(1).map(f => f.data.length)).toEqual([512, 88]);
    expect(gl.fontHeight(9)).toBe(30);
  });

  it('sends device commands', async () => {
    const { gl, mock } = await connect(ENGO3, { respond: f => (f.cmd === CMD.pixelCount ? [0, 0, 1, 0] : undefined) });
    await gl.shutdown();
    await gl.fill(5);
    expect(data(mock.frames[0]!)).toBe('6f 7f c4 ee');
    expect(data(mock.frames[1]!)).toBe('05');
    expect(await gl.pixelCount()).toBe(256);
  });
});
