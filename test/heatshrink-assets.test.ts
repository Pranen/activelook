import { describe, expect, it } from 'vitest';
import {
  ALOOK_IMAGES,
  ALOOK_LAYOUTS,
  ActiveLook,
  CMD,
  MockTransport,
  chunkImage,
  createBitmap,
  encodeImage,
  heatshrinkCompress,
  heatshrinkDecompress,
  padValue,
  toHex,
} from '../src/index.js';

async function connect() {
  const mock = new MockTransport();
  const gl = new ActiveLook({ transport: mock });
  await gl.connect();
  mock.clearLog();
  return { gl, mock };
}

describe('heatshrink', () => {
  it('encodes literals and back-references bit by bit', () => {
    // "aaaa": literal 'a' (1 + 0x61), then backref distance 1 (0x00 in 8 bits), length 3 (2 in 4 bits)
    // bits: 1 01100001 0 00000000 0010 (+ 2 padding bits) → 10110000 10000000 00001000
    expect(toHex(heatshrinkCompress([0x61, 0x61, 0x61, 0x61]))).toBe('b0 80 08');
  });

  it('round-trips random and repetitive data', () => {
    const inputs = [
      Uint8Array.from({ length: 2000 }, (_, i) => (i * 7919) % 251),
      new Uint8Array(3000),
      Uint8Array.from({ length: 1500 }, (_, i) => (i % 40 < 20 ? 0x00 : 0xff)),
      Uint8Array.from([1]),
    ];
    for (const input of inputs) {
      const packed = heatshrinkCompress(input);
      expect([...heatshrinkDecompress(packed, input.length)]).toEqual([...input]);
    }
    expect(heatshrinkCompress(new Uint8Array(3000)).length).toBeLessThan(400);
  });
});

describe('compressed image formats', () => {
  it('reports the uncompressed size and sends compressed data', () => {
    const e = encodeImage(createBitmap(64, 64), 'grey4Compressed');
    expect(e.size).toBe(64 * 32);
    expect(e.compressed).toBe(true);
    expect(e.data.length).toBeLessThan(e.size);
    expect([...heatshrinkDecompress(e.data, e.size)]).toEqual([...encodeImage(createBitmap(64, 64), 'grey4').data]);
    expect(chunkImage(e).every(c => c.length <= 512)).toBe(true);
  });

  it('compresses colour images and uses the uncompressed size in the header', async () => {
    const { gl, mock } = await connect();
    await gl.images.save(3, createBitmap(64, 64), { format: 'color8' });
    // id 3, size 4096 (64×64, 1 byte per pixel), width 64, format 0x0A
    expect(toHex(mock.frames[0]!.data)).toBe('03 00 00 10 00 00 40 0a');
    const sent = mock.frames.slice(1).reduce((n, f) => n + f.data.length, 0);
    expect(sent).toBeLessThan(4096);
  });

  it('streams 16 grey levels compressed', async () => {
    const { gl, mock } = await connect();
    await gl.images.stream(createBitmap(20, 10), 0, 0, { format: 'grey4Compressed' });
    const head = mock.frames[0]!.data;
    expect(toHex(head.subarray(0, 6))).toBe('00 00 00 64 00 14'); // size 100 (10 rows × 10 bytes), width 20
    expect(head[10]).toBe(0x02);
  });
});

describe('ALooK assets', () => {
  it('pads values with ghost characters', () => {
    expect(padValue('123')).toBe('&$123');
    expect(padValue('1.23', { align: 'left' })).toBe('1.23$');
    expect(padValue('1')).toBe('&$$$1');
    expect(padValue('00:00')).toBe('00:00');
  });

  it('has the tables from the Visual Assets repository', () => {
    expect(ALOOK_IMAGES['heart-beat_40x40']).toEqual({ id: 44, width: 40, height: 40 });
    expect(ALOOK_LAYOUTS.time).toMatchObject({ id: 10, x: 30, y: 205, width: 121, font: 1, useText: true });
    expect(Object.keys(ALOOK_LAYOUTS)).toHaveLength(175);
  });

  it('selects the configuration and shows assets without extra queries', async () => {
    const { gl, mock } = await connect();
    await gl.assets.use();
    await gl.assets.showImage('heart-beat_28x28', 10, 20);
    await gl.assets.showLayout('time', '12:30');
    await gl.assets.playAnimation('dancing_dots');
    expect(mock.frames.map(f => f.cmd)).toEqual([CMD.cfgSet, CMD.imgDisplay, CMD.layoutDisplay, CMD.animDisplay]);
    expect(toHex(mock.frames[0]!.data)).toBe('41 4c 6f 6f 4b 00'); // "ALooK\0"
    expect(toHex(mock.frames[1]!.data)).toBe('0c 01 0a 00 d0'); // id 12 at (304-10-28, 256-20-28) = (266, 208)
    expect(toHex(mock.frames[3]!.data)).toBe('00 02 00 64 ff 00 62 00 70'); // id 2, 100 ms, loop, at (98, 112)
  });
});
