// Heatshrink (LZSS) as used by ActiveLook: window 2^8 = 256 bytes, lookahead 2^4 = 16 bytes.
// Bit stream, MSB first, no header:
//   literal:  1, then 8 bits of the byte
//   backref:  0, then (distance − 1) in windowBits, then (length − 1) in lookaheadBits
// The last byte is padded with zero bits. Matches overlapping the current position are allowed.

export const HEATSHRINK_WINDOW_BITS = 8;
export const HEATSHRINK_LOOKAHEAD_BITS = 4;

class BitWriter {
  readonly bytes: number[] = [];
  private current = 0;
  private mask = 0x80;

  push(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      if ((value >> i) & 1) this.current |= this.mask;
      this.mask >>= 1;
      if (!this.mask) { this.bytes.push(this.current); this.current = 0; this.mask = 0x80; }
    }
  }

  finish(): Uint8Array {
    if (this.mask !== 0x80) this.bytes.push(this.current);
    return Uint8Array.from(this.bytes);
  }
}

export function heatshrinkCompress(
  input: ArrayLike<number>,
  windowBits = HEATSHRINK_WINDOW_BITS,
  lookaheadBits = HEATSHRINK_LOOKAHEAD_BITS,
): Uint8Array {
  const window = 1 << windowBits;
  const maxLength = 1 << lookaheadBits;
  const out = new BitWriter();
  let pos = 0;
  while (pos < input.length) {
    let bestLength = 0;
    let bestDistance = 0;
    const limit = Math.min(maxLength, input.length - pos);
    const start = Math.max(0, pos - window);
    for (let candidate = pos - 1; candidate >= start && bestLength < limit; candidate--) {
      let length = 0;
      while (length < limit && input[candidate + length] === input[pos + length]) length++;
      if (length > bestLength) { bestLength = length; bestDistance = pos - candidate; }
    }
    // A backref costs 1 + windowBits + lookaheadBits bits: worth it from 2 bytes on (like heatshrink).
    if (bestLength * 8 > 1 + windowBits + lookaheadBits) {
      out.push(0, 1);
      out.push(bestDistance - 1, windowBits);
      out.push(bestLength - 1, lookaheadBits);
      pos += bestLength;
    } else {
      out.push(1, 1);
      out.push(input[pos]!, 8);
      pos++;
    }
  }
  return out.finish();
}

/** Decoder, mainly for tests. `expectedLength` stops before the zero padding is misread. */
export function heatshrinkDecompress(
  input: ArrayLike<number>,
  expectedLength: number,
  windowBits = HEATSHRINK_WINDOW_BITS,
  lookaheadBits = HEATSHRINK_LOOKAHEAD_BITS,
): Uint8Array {
  const out: number[] = [];
  let bit = 0;
  const total = input.length * 8;
  const read = (count: number) => {
    let v = 0;
    for (let i = 0; i < count; i++, bit++) v = (v << 1) | ((input[bit >> 3]! >> (7 - (bit & 7))) & 1);
    return v;
  };
  while (out.length < expectedLength && bit < total) {
    if (read(1)) {
      if (bit + 8 > total) break;
      out.push(read(8));
    } else {
      if (bit + windowBits + lookaheadBits > total) break;
      const distance = read(windowBits) + 1;
      const length = read(lookaheadBits) + 1;
      for (let i = 0; i < length; i++) out.push(out[out.length - distance]!);
    }
  }
  return Uint8Array.from(out.slice(0, expectedLength));
}
