// Byte helpers. The ActiveLook protocol is big-endian (MSB first) throughout.

export const u8 = (v: number): number[] => [v & 0xff];
export const u16 = (v: number): number[] => [(v >> 8) & 0xff, v & 0xff];
/** Signed 16-bit, two's complement (same bytes as u16 after masking). */
export const s16 = (v: number): number[] => u16(Math.round(v));
export const u32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
export const bool = (v: boolean): number[] => [v ? 1 : 0];

/** NUL-terminated string. */
export const cstring = (str: string): number[] => [...new TextEncoder().encode(str), 0];

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(v)));

export const toHex = (bytes: ArrayLike<number>): string =>
  Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');

/** Sequential reader for response payloads. */
export class ByteReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number { return this.bytes.length - this.pos; }

  u8(): number { this.need(1); return this.bytes[this.pos++]!; }
  s8(): number { const v = this.u8(); return v > 0x7f ? v - 0x100 : v; }
  u16(): number { this.need(2); const v = (this.bytes[this.pos]! << 8) | this.bytes[this.pos + 1]!; this.pos += 2; return v; }
  s16(): number { const v = this.u16(); return v > 0x7fff ? v - 0x10000 : v; }
  u32(): number { const hi = this.u16(); return hi * 0x10000 + this.u16(); }
  bool(): boolean { return this.u8() !== 0; }
  bytesN(n: number): Uint8Array { this.need(n); const out = this.bytes.slice(this.pos, this.pos + n); this.pos += n; return out; }

  /** Reads up to NUL (consumed) or end of data. */
  cstring(): string {
    let end = this.bytes.indexOf(0, this.pos);
    if (end < 0) end = this.bytes.length;
    const s = new TextDecoder().decode(this.bytes.subarray(this.pos, end));
    this.pos = Math.min(this.bytes.length, end + 1);
    return s;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.length) throw new RangeError(`Response too short: need ${n} byte(s) at offset ${this.pos}`);
  }
}
