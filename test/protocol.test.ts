import { describe, expect, it } from 'vitest';
import { ByteReader, FrameDecoder, encodeFrame, rg, rgLevels, rgToGrey, s16, toAscii, toHex, COLORS } from '../src/index.js';

describe('encodeFrame', () => {
  // Examples from the ActiveLook API documentation.
  it('encodes clear without query id', () => {
    expect(toHex(encodeFrame(0x01))).toBe('ff 01 00 05 aa');
  });

  it('encodes a query id', () => {
    expect(toHex(encodeFrame(0x01, [], [0x02, 0x01]))).toBe('ff 01 02 07 02 01 aa');
  });

  it('switches to a 2-byte length above 255 bytes', () => {
    const data = new Array(260).fill(7);
    const f = encodeFrame(0x38, data);
    expect(f.length).toBe(266);
    expect([...f.subarray(0, 5)]).toEqual([0xff, 0x38, 0x10, 0x01, 0x0a]);
    expect(f[f.length - 1]).toBe(0xaa);
  });

  it('rejects too much data', () => {
    expect(() => encodeFrame(0x38, new Array(513).fill(0))).toThrow(RangeError);
  });

  it('encodes signed 16-bit values big-endian', () => {
    expect(s16(300)).toEqual([0x01, 0x2c]);
    expect(s16(-1)).toEqual([0xff, 0xff]);
  });
});

describe('FrameDecoder', () => {
  it('reassembles split frames and skips garbage', () => {
    const d = new FrameDecoder();
    const frame = encodeFrame(0x06, [3, 5, 0, 0x62], [9]);
    expect(d.push([0x00, 0x12, ...frame.subarray(0, 4)])).toEqual([]);
    const out = d.push(frame.subarray(4));
    expect(out).toHaveLength(1);
    expect(out[0]!.cmd).toBe(0x06);
    expect([...out[0]!.queryId]).toEqual([9]);
    expect([...out[0]!.data]).toEqual([3, 5, 0, 0x62]);
  });

  it('decodes several frames in one chunk, including 2-byte lengths', () => {
    const d = new FrameDecoder();
    const big = encodeFrame(0x47, new Array(300).fill(1));
    const out = d.push([...encodeFrame(0x01), ...big]);
    expect(out.map(f => f.cmd)).toEqual([0x01, 0x47]);
    expect(out[1]!.data.length).toBe(300);
  });

  it('resyncs after a corrupt frame', () => {
    const d = new FrameDecoder();
    const out = d.push([0xff, 0x01, 0x00, 0x05, 0x00, ...encodeFrame(0x05, [42])]);
    expect(out.map(f => [f.cmd, ...f.data])).toEqual([[0x05, 42]]);
  });
});

describe('ByteReader', () => {
  it('reads big-endian numbers and strings', () => {
    const r = new ByteReader(Uint8Array.from([0xff, 0x01, 0x00, 0x01, 0x00, 0x00, 0x41, 0x42, 0x00, 0x7f]));
    expect(r.s8()).toBe(-1);
    expect(r.u16()).toBe(0x0100);
    expect(r.u32()).toBe(0x01000041);
    expect(r.cstring()).toBe('B');
    expect(r.u8()).toBe(0x7f);
    expect(() => r.u8()).toThrow(RangeError);
  });
});

describe('palette', () => {
  it('maps levels to values and back', () => {
    expect(rg(8, 0)).toBe(COLORS.red);
    expect(rg(8, 8)).toBe(COLORS.yellow);
    expect(rgLevels(COLORS.green)).toEqual({ red: 0, green: 8 });
    expect(rgLevels(0x07)).toBeNull();
  });

  it('approximates grey levels', () => {
    expect(rgToGrey(COLORS.black)).toBe(0);
    expect(rgToGrey(COLORS.yellow)).toBe(15);
  });
});

describe('toAscii', () => {
  it('transliterates German and strips accents', () => {
    expect(toAscii('Grüße aus Zürich – café')).toBe('Gruesse aus Zuerich - cafe');
    expect(toAscii('a\u{1F600}b')).toBe('a?b');
  });
});
