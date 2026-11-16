import { describe, expect, it } from 'vitest';
import { WebBluetoothTransport } from '../src/index.js';

/** RX characteristic that rejects writes longer than `limit`, like glasses without long-write support. */
function fakeRx(limit: number) {
  const written: number[][] = [];
  const write = async (v: BufferSource) => {
    const bytes = [...new Uint8Array(v as ArrayBuffer)];
    if (bytes.length > limit) throw new DOMException('GATT Error: Not supported.', 'NotSupportedError');
    written.push(bytes);
  };
  return { written, rx: { writeValueWithResponse: write, writeValue: write, writeValueWithoutResponse: write } };
}

function transport(limit: number, options = {}) {
  const t = new WebBluetoothTransport(options);
  const fake = fakeRx(limit);
  (t as unknown as { rx: unknown }).rx = fake.rx;
  return { t, written: fake.written };
}

describe('WebBluetoothTransport.write', () => {
  it('splits into smaller pieces when long writes are not supported, and keeps the size', async () => {
    const { t, written } = transport(100);
    const data = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
    await t.write(data);
    expect(written.every(w => w.length <= 64)).toBe(true);
    expect(written.flat()).toEqual([...data]);
    expect(t.maxChunkSize).toBe(64);

    written.length = 0;
    await t.write(data.subarray(0, 70));
    expect(written.map(w => w.length)).toEqual([64, 6]);
  });

  it('writes up to 512 bytes at once when the connection allows it', async () => {
    const { t, written } = transport(1000);
    await t.write(new Uint8Array(517));
    expect(written.map(w => w.length)).toEqual([512, 5]);
    expect(t.maxChunkSize).toBe(512);
  });

  it('gives up below 20 bytes and passes other errors through', async () => {
    const { t } = transport(10);
    await expect(t.write(new Uint8Array(30))).rejects.toThrow('Not supported');

    const other = new WebBluetoothTransport();
    const fail = async () => { throw new DOMException('GATT Server is disconnected.', 'NetworkError'); };
    (other as unknown as { rx: unknown }).rx = { writeValueWithResponse: fail, writeValue: fail, writeValueWithoutResponse: fail };
    await expect(other.write(new Uint8Array(300))).rejects.toThrow('disconnected');
    expect(other.maxChunkSize).toBe(512);
  });
});
