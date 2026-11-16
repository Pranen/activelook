// Command frame: 0xFF | cmdId | format | length (1 or 2 bytes) | queryId (0–15 bytes) | data | 0xAA
//
// format: bit 0x10 set → length field is 2 bytes; low nibble = query-id length.
// length: size of the whole frame, header and footer included.

export const FRAME_START = 0xff;
export const FRAME_END = 0xaa;
export const MAX_FRAME_SIZE = 533;
export const MAX_DATA_SIZE = 512;
export const MAX_QUERY_ID_LENGTH = 15;

export interface Frame {
  cmd: number;
  queryId: Uint8Array;
  data: Uint8Array;
}

export function encodeFrame(cmd: number, data: ArrayLike<number> = [], queryId: ArrayLike<number> = []): Uint8Array {
  if (queryId.length > MAX_QUERY_ID_LENGTH) throw new RangeError(`Query id too long (${queryId.length} > ${MAX_QUERY_ID_LENGTH})`);
  if (data.length > MAX_DATA_SIZE) throw new RangeError(`Command data too long (${data.length} > ${MAX_DATA_SIZE} bytes)`);
  const short = 5 + queryId.length + data.length;
  const long = short > 0xff;
  const total = long ? short + 1 : short;

  const out = new Uint8Array(total);
  let i = 0;
  out[i++] = FRAME_START;
  out[i++] = cmd & 0xff;
  out[i++] = (long ? 0x10 : 0x00) | queryId.length;
  if (long) { out[i++] = total >> 8; out[i++] = total & 0xff; } else out[i++] = total;
  out.set(queryId, i); i += queryId.length;
  out.set(data, i); i += data.length;
  out[i] = FRAME_END;
  return out;
}

/**
 * Reassembles frames from a byte stream (notifications may split or join frames).
 * Garbage bytes are skipped until the next valid frame.
 */
export class FrameDecoder {
  private buf = new Uint8Array(0);

  push(chunk: ArrayLike<number>): Frame[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const frames: Frame[] = [];
    for (;;) {
      const start = this.buf.indexOf(FRAME_START);
      if (start < 0) { this.buf = new Uint8Array(0); break; }
      if (start > 0) this.buf = this.buf.slice(start);
      if (this.buf.length < 4) break;

      const fmt = this.buf[2]!;
      const long = (fmt & 0x10) !== 0;
      const qLen = fmt & 0x0f;
      const headerLen = long ? 5 : 4;
      if (this.buf.length < headerLen) break;
      const total = long ? (this.buf[3]! << 8) | this.buf[4]! : this.buf[3]!;

      if ((fmt & 0xe0) !== 0 || total < headerLen + qLen + 1 || total > MAX_FRAME_SIZE) { this.skip(); continue; }
      if (this.buf.length < total) break;
      if (this.buf[total - 1] !== FRAME_END) { this.skip(); continue; }

      frames.push({
        cmd: this.buf[1]!,
        queryId: this.buf.slice(headerLen, headerLen + qLen),
        data: this.buf.slice(headerLen + qLen, total - 1),
      });
      this.buf = this.buf.slice(total);
    }
    return frames;
  }

  reset(): void { this.buf = new Uint8Array(0); }

  private skip(): void { this.buf = this.buf.slice(1); }
}
