import type { Point } from '../activelook.js';
import { ActiveLookError } from '../errors.js';
import { toAscii } from '../extras/ascii.js';
import { ByteReader, bool, clamp, cstring, s16, u16 } from '../protocol/bytes.js';
import { CMD } from '../protocol/commands.js';
import { ALL, Module, checkId, idList, requireColor } from './shared.js';

/**
 * Drawing commands stored inside a layout. Coordinates are relative to the layout's
 * top-left corner (logical, as seen by the wearer).
 */
export type LayoutCommand =
  | { type: 'image'; id: number; x: number; y: number; width?: number; height?: number }
  | { type: 'circle'; x: number; y: number; r: number }
  | { type: 'fillCircle'; x: number; y: number; r: number }
  /** Grey level (grey layouts) or RG colour (colour layouts) for the following commands. */
  | { type: 'color'; value: number }
  | { type: 'font'; id: number }
  | { type: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'point'; x: number; y: number }
  | { type: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'fillRect'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'text'; x: number; y: number; text: string }
  | { type: 'gauge'; id: number }
  | {
      type: 'anim';
      handlerId: number;
      id: number;
      x: number;
      y: number;
      delayMs?: number;
      repeat?: number;
      /** Frame size; needed to place the animation on mirrored displays. */
      width?: number;
      height?: number;
    }
  | { type: 'polyline'; points: readonly Point[]; thickness?: number };

export interface LayoutText {
  /** Position of the argument text inside the layout. Default (0, 0). */
  x?: number;
  y?: number;
  /** Default: the profile's upright rotation. */
  rotation?: number;
  /** Fill each character's background with `backColor`. Default true. */
  opaque?: boolean;
}

export interface LayoutDefinition {
  /** Clip region (logical). Everything the layout draws stays inside it. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Grey 0–15, or RG colour when `color` is true. Default 15 / yellow. */
  foreColor?: number;
  /** Background, same scale as `foreColor`. Default 0 (black = transparent on the glasses). */
  backColor?: number;
  /** Font of the argument text. Default 1. */
  font?: number;
  /** Where the text passed to display() goes; `false` for layouts without text. */
  text?: LayoutText | false;
  /** Save as colour layout (0x6B): colours are RG palette values. Colour glasses only. */
  color?: boolean;
  /** Additional drawing commands, drawn each time the layout is displayed. */
  commands?: readonly LayoutCommand[];
}

/** Layout parameters as stored on the glasses (device coordinates). */
export interface RawLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  foreColor: number;
  backColor: number;
  font: number;
  textValid: boolean;
  textX: number;
  textY: number;
  rotation: number;
  opaque: boolean;
  commands: Uint8Array;
}

const SUB = { image: 0, circle: 1, fillCircle: 2, color: 3, font: 4, line: 5, point: 6, rect: 7, fillRect: 8, text: 9, gauge: 10, anim: 11, polyline: 12 } as const;

/**
 * Layouts: a clip region with an optional text slot and drawing commands, stored on the
 * glasses (needs an open configuration). `display(id, text)` then redraws it with a new
 * text in one short command, which saves Bluetooth traffic for values that change often.
 */
export class Layouts extends Module {
  private readonly sizes = new Map<number, { width: number; height: number; font: number }>();

  save(id: number, layout: LayoutDefinition): Promise<void> {
    checkId(id, 'Layout');
    if (layout.color) requireColor(this.gl, 'Colour layout');
    const width = clamp(layout.width, 1, this.gl.width);
    const height = clamp(layout.height, 1, 255);
    const font = layout.font ?? 1;
    const [dx, dy] = this.gl.boxToDevice(layout.x, layout.y, width, height);
    const rel = this.relative(width, height);
    const text = layout.text === false ? null : { x: 0, y: 0, opaque: true, ...layout.text };
    const fh = this.gl.profile.flipY ? this.gl.fontHeight(font) : 0;
    const [tx, ty] = text ? rel(text.x, text.y + fh) : [0, 0];
    const commands = this.encodeCommands(layout.commands ?? [], width, height, font);
    if (commands.length > 255) throw new RangeError(`Layout commands too long (${commands.length} > 255 bytes)`);

    const data = [
      id,
      commands.length,
      ...u16(clamp(dx, 0, 0xffff)),
      clamp(dy, 0, 255),
      ...u16(width),
      height,
      clamp(layout.foreColor ?? (layout.color ? 0xff : 15), 0, 255),
      clamp(layout.backColor ?? 0, 0, 255),
      font & 0xff,
      ...bool(!!text),
      ...u16(clamp(tx, 0, 0xffff)),
      clamp(ty, 0, 255),
      (text?.rotation ?? this.gl.profile.textRotation) & 0xff,
      ...bool(text?.opaque ?? false),
      ...commands,
    ];
    this.sizes.set(id, { width, height, font });
    return this.gl.send(layout.color ? CMD.layoutSaveInColor : CMD.layoutSave, data);
  }

  /** Draws the layout with `text` in its text slot. */
  display(id: number, text = ''): Promise<void> {
    return this.gl.send(CMD.layoutDisplay, [checkId(id, 'Layout'), ...this.str(text)]);
  }

  /** Clears the layout's area. */
  clear(id: number): Promise<void> {
    return this.gl.send(CMD.layoutClear, [checkId(id, 'Layout')]);
  }

  clearAndDisplay(id: number, text = ''): Promise<void> {
    return this.gl.send(CMD.layoutClearAndDisplay, [checkId(id, 'Layout'), ...this.str(text)]);
  }

  /** Moves the layout (stored). (x, y) is the logical top-left corner. */
  async position(id: number, x: number, y: number): Promise<void> {
    const [dx, dy] = await this.anchor(id, x, y);
    return this.gl.send(CMD.layoutPosition, [id, ...u16(dx), dy]);
  }

  /** Draws the layout at another position (not stored), optionally with extra commands. */
  async displayAt(id: number, x: number, y: number, text = '', extra: readonly LayoutCommand[] = []): Promise<void> {
    const [dx, dy] = await this.anchor(id, x, y);
    const extraBytes = await this.extra(id, extra);
    return this.gl.send(CMD.layoutDisplayExtended, [id, ...u16(dx), dy, ...this.str(text), ...extraBytes]);
  }

  async clearAt(id: number, x: number, y: number): Promise<void> {
    const [dx, dy] = await this.anchor(id, x, y);
    return this.gl.send(CMD.layoutClearExtended, [id, ...u16(dx), dy]);
  }

  async clearAndDisplayAt(id: number, x: number, y: number, text = '', extra: readonly LayoutCommand[] = []): Promise<void> {
    const [dx, dy] = await this.anchor(id, x, y);
    const extraBytes = await this.extra(id, extra);
    return this.gl.send(CMD.layoutClearAndDisplayExtended, [id, ...u16(dx), dy, ...this.str(text), ...extraBytes]);
  }

  async list(): Promise<number[]> {
    return idList(await this.gl.query(CMD.layoutList));
  }

  /** Stored parameters (device coordinates, as the glasses keep them). */
  async get(id: number): Promise<RawLayout> {
    const r = new ByteReader(await this.gl.query(CMD.layoutGet, [checkId(id, 'Layout')]));
    const size = r.u8();
    const raw: RawLayout = {
      x: r.u16(),
      y: r.u8(),
      width: r.u16(),
      height: r.u8(),
      foreColor: r.u8(),
      backColor: r.u8(),
      font: r.u8(),
      textValid: r.bool(),
      textX: r.u16(),
      textY: r.u8(),
      rotation: r.u8(),
      opaque: r.bool(),
      commands: r.bytesN(Math.min(size, r.remaining)),
    };
    this.sizes.set(id, { width: raw.width, height: raw.height, font: raw.font });
    return raw;
  }

  delete(id: number): Promise<void> {
    this.sizes.delete(checkId(id, 'Layout'));
    return this.gl.send(CMD.layoutDelete, [id]);
  }

  deleteAll(): Promise<void> {
    this.sizes.clear();
    return this.gl.send(CMD.layoutDelete, [ALL]);
  }

  /** Size of a layout (cached, else read from the glasses). */
  async size(id: number): Promise<{ width: number; height: number; font: number }> {
    checkId(id, 'Layout');
    const known = this.sizes.get(id);
    if (known) return known;
    await this.get(id);
    return this.sizes.get(id)!;
  }

  /** Device position (u16 x, u8 y) for a layout whose logical top-left is (x, y). */
  async anchor(id: number, x: number, y: number): Promise<[number, number]> {
    const { flipX, flipY } = this.gl.profile;
    const { width, height } = flipX || flipY ? await this.size(id) : { width: 1, height: 1 };
    const [dx, dy] = this.gl.boxToDevice(x, y, width, height);
    return [clamp(dx, 0, 0xffff), clamp(dy, 0, 255)];
  }

  // ── Encoding ──────────────────────────────────────────────────────────

  private str(text: string): number[] {
    return cstring(this.gl.transliterate ? toAscii(text) : text);
  }

  private async extra(id: number, commands: readonly LayoutCommand[]): Promise<number[]> {
    if (!commands.length) return [];
    const { width, height, font } = await this.size(id);
    return this.encodeCommands(commands, width, height, font);
  }

  /** Logical position inside a layout → device position relative to the layout origin. */
  private relative(width: number, height: number) {
    const { flipX, flipY } = this.gl.profile;
    return (x: number, y: number): [number, number] => [flipX ? width - 1 - x : x, flipY ? height - 1 - y : y];
  }

  /** Encodes layout sub-commands. Exposed for tests and custom use. */
  encodeCommands(commands: readonly LayoutCommand[], width: number, height: number, font = 1): number[] {
    const { flipX, flipY } = this.gl.profile;
    const rel = this.relative(width, height);
    const xy = (x: number, y: number) => { const [a, b] = rel(x, y); return [...s16(a), ...s16(b)]; };
    // Top-left of a w×h object at logical (x, y), relative to the layout.
    const box = (x: number, y: number, w: number, h: number) =>
      [...s16(flipX ? width - x - w : x), ...s16(flipY ? height - y - h : y)];
    const out: number[] = [];
    let currentFont = font;

    for (const c of commands) {
      switch (c.type) {
        case 'image': {
          const size = c.width && c.height ? { width: c.width, height: c.height } : this.gl.images.size(c.id);
          if ((flipX || flipY) && !size) {
            throw new ActiveLookError(`Size of image ${c.id} unknown: save or list images first, or pass width/height`, 'device');
          }
          out.push(SUB.image, checkId(c.id, 'Image'), ...box(c.x, c.y, size?.width ?? 1, size?.height ?? 1));
          break;
        }
        case 'circle':
        case 'fillCircle':
          out.push(SUB[c.type], ...xy(c.x, c.y), ...u16(clamp(c.r, 0, 0xffff)));
          break;
        case 'color':
          out.push(SUB.color, clamp(c.value, 0, 255));
          break;
        case 'font':
          currentFont = c.id;
          out.push(SUB.font, c.id & 0xff);
          break;
        case 'line':
        case 'rect':
        case 'fillRect':
          out.push(SUB[c.type], ...xy(c.x0, c.y0), ...xy(c.x1, c.y1));
          break;
        case 'point':
          out.push(SUB.point, ...xy(c.x, c.y));
          break;
        case 'text': {
          const bytes = [...new TextEncoder().encode(this.gl.transliterate ? toAscii(c.text) : c.text)];
          if (bytes.length > 255) throw new RangeError('Layout text command longer than 255 bytes');
          const fh = flipY ? this.gl.fontHeight(currentFont) : 0;
          out.push(SUB.text, ...xy(c.x, c.y + fh), bytes.length, ...bytes);
          break;
        }
        case 'gauge':
          out.push(SUB.gauge, checkId(c.id, 'Gauge'));
          break;
        case 'anim': {
          if ((flipX || flipY) && !(c.width && c.height)) {
            throw new ActiveLookError('Animation in a layout needs width/height on mirrored displays', 'device');
          }
          out.push(
            SUB.anim, c.handlerId & 0xff, checkId(c.id, 'Animation'), ...u16(clamp(c.delayMs ?? 100, 0, 0xffff)),
            clamp(c.repeat ?? 0xff, 0, 255), ...box(c.x, c.y, c.width ?? 1, c.height ?? 1),
          );
          break;
        }
        case 'polyline': {
          // nb_points: the docs are ambiguous between points and segments; we send the number of points.
          out.push(SUB.polyline, c.points.length & 0xff, clamp(c.thickness ?? 1, 1, 255), 0, 0);
          for (const [px, py] of c.points) out.push(...xy(px, py));
          break;
        }
      }
    }
    return out;
  }
}
