import { ByteReader, u16 } from '../protocol/bytes.js';
import { CMD } from '../protocol/commands.js';
import { ALL, Module, checkId } from './shared.js';

export interface FontInfo {
  id: number;
  height: number;
}

/** Fonts on the glasses. The library reads the list on connect to position text correctly. */
export class Fonts extends Module {
  private readonly heights = new Map<number, number>();

  /** Fonts read from the glasses (empty until `list()` ran, which connect() does). */
  get installed(): FontInfo[] {
    return [...this.heights].map(([id, height]) => ({ id, height }));
  }

  /** Line height of a font: from the glasses if known, else from the profile. */
  height(id: number): number {
    const p = this.gl.profile.fontHeights;
    return this.heights.get(id) ?? p[id] ?? p[0] ?? 24;
  }

  async list(): Promise<FontInfo[]> {
    const r = new ByteReader(await this.gl.query(CMD.fontList));
    const fonts: FontInfo[] = [];
    while (r.remaining >= 2) fonts.push({ id: r.u8(), height: r.u8() });
    this.heights.clear();
    for (const f of fonts) this.heights.set(f.id, f.height);
    return fonts;
  }

  /**
   * Uploads a font in the ActiveLook font format (as produced by the ActiveLook
   * Config-Generator). Needs an open configuration. Ids 1–3 replace built-in fonts.
   */
  async save(id: number, fontData: Uint8Array): Promise<void> {
    checkId(id, 'Font');
    if (fontData.length > 0xffff) throw new RangeError('Font data too large');
    const chunks: Array<readonly [number, ArrayLike<number>]> = [[CMD.fontSave, [id, ...u16(fontData.length)]]];
    for (let o = 0; o < fontData.length; o += 512) chunks.push([CMD.fontSave, fontData.subarray(o, o + 512)]);
    await this.gl.sendMany(chunks);
    this.heights.set(id, fontData[1] ?? this.height(id));
  }

  /** Sets the font used by later text commands that do not name one (e.g. layout text). */
  select(id: number): Promise<void> {
    return this.gl.send(CMD.fontSelect, [checkId(id, 'Font')]);
  }

  /** Deletes a font; deleting 1–3 restores the built-in font. */
  delete(id: number): Promise<void> {
    this.heights.delete(checkId(id, 'Font'));
    return this.gl.send(CMD.fontDelete, [id]);
  }

  deleteAll(): Promise<void> {
    this.heights.clear();
    return this.gl.send(CMD.fontDelete, [ALL]);
  }
}
