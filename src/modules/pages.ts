import { toAscii } from '../extras/ascii.js';
import { ByteReader, cstring, u16 } from '../protocol/bytes.js';
import { CMD } from '../protocol/commands.js';
import { ALL, Module, checkId, idList } from './shared.js';

export const MAX_PAGE_LAYOUTS = 10;

export interface PageEntry {
  layout: number;
  /** Logical top-left of the layout on this page. */
  x: number;
  y: number;
}

/**
 * Pages group up to 10 stored layouts at fixed positions (needs an open configuration).
 * `display(id, texts)` draws all of them at once; the k-th text goes to the k-th layout.
 */
export class Pages extends Module {
  async save(id: number, entries: readonly PageEntry[]): Promise<void> {
    checkId(id, 'Page');
    if (entries.length > MAX_PAGE_LAYOUTS) throw new RangeError(`A page holds at most ${MAX_PAGE_LAYOUTS} layouts`);
    const data = [id];
    for (const e of entries) {
      const [dx, dy] = await this.gl.layouts.anchor(e.layout, e.x, e.y);
      data.push(e.layout, ...u16(dx), dy);
    }
    return this.gl.send(CMD.pageSave, data);
  }

  /** Layouts and positions of a page (logical coordinates). */
  async get(id: number): Promise<PageEntry[]> {
    const r = new ByteReader(await this.gl.query(CMD.pageGet, [checkId(id, 'Page')]));
    r.u8(); // page id
    const raw: Array<{ layout: number; x: number; y: number }> = [];
    while (r.remaining >= 4) raw.push({ layout: r.u8(), x: r.u16(), y: r.u8() });
    const out: PageEntry[] = [];
    for (const e of raw) {
      const { width, height } = await this.gl.layouts.size(e.layout);
      const [x, y] = this.gl.boxToDevice(e.x, e.y, width, height); // its own inverse
      out.push({ layout: e.layout, x, y });
    }
    return out;
  }

  /** Draws the page; `texts[k]` goes to the k-th layout. */
  display(id: number, texts: readonly string[] = []): Promise<void> {
    return this.gl.send(CMD.pageDisplay, [checkId(id, 'Page'), ...this.strings(texts)]);
  }

  clear(id: number): Promise<void> {
    return this.gl.send(CMD.pageClear, [checkId(id, 'Page')]);
  }

  clearAndDisplay(id: number, texts: readonly string[] = []): Promise<void> {
    return this.gl.send(CMD.pageClearAndDisplay, [checkId(id, 'Page'), ...this.strings(texts)]);
  }

  async list(): Promise<number[]> {
    return idList(await this.gl.query(CMD.pageList));
  }

  delete(id: number): Promise<void> {
    return this.gl.send(CMD.pageDelete, [checkId(id, 'Page')]);
  }

  deleteAll(): Promise<void> {
    return this.gl.send(CMD.pageDelete, [ALL]);
  }

  private strings(texts: readonly string[]): number[] {
    if (!texts.length) return [0];
    return texts.flatMap(t => cstring(this.gl.transliterate ? toAscii(t) : t));
  }
}
