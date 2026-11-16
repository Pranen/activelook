import { ByteReader, s16, u16, u32 } from '../protocol/bytes.js';
import { CMD } from '../protocol/commands.js';
import {
  IMAGE_FORMAT,
  chunkRows,
  encodeImage,
  flipBitmap,
  type Bitmap,
  type EncodeOptions,
  type ImageFormat,
} from '../images/bitmap.js';
import { ActiveLookError } from '../errors.js';
import { ALL, Module, checkId, requireColor } from './shared.js';

export interface ImageInfo {
  id: number;
  width: number;
  height: number;
}

export interface SaveImageOptions extends EncodeOptions {
  /** Default 'grey4'. Colour formats need colour glasses. */
  format?: ImageFormat;
}

/**
 * Images stored on the glasses (needs an open configuration, see `gl.configs.write()`),
 * and images streamed directly to the display.
 *
 * Bitmaps are given as seen by the wearer; the library mirrors them for the optics.
 * Positions are the logical top-left corner.
 */
export class Images extends Module {
  /** Sizes of images saved or listed in this session (needed to place them on mirrored displays). */
  private readonly sizes = new Map<number, { width: number; height: number }>();

  async save(id: number, bitmap: Bitmap, options: SaveImageOptions = {}): Promise<void> {
    checkId(id, 'Image');
    const format = options.format ?? 'grey4';
    if (format === 'color8' || format === 'colorAlpha8') requireColor(this.gl, `Image format ${format}`);
    const { flipX, flipY } = this.gl.profile;
    const encoded = encodeImage(flipBitmap(bitmap, flipX, flipY), format, options);
    const header = [id, ...u32(encoded.data.length), ...u16(encoded.width), IMAGE_FORMAT[format]];
    // Header and data must reach the glasses back to back: queue them together.
    await this.gl.sendMany([[CMD.imgSave, header], ...chunkRows(encoded).map(c => [CMD.imgSave, c] as const)]);
    this.sizes.set(id, { width: bitmap.width, height: bitmap.height });
  }

  /** Shows a stored image with its top-left corner at (x, y). */
  async display(id: number, x: number, y: number): Promise<void> {
    checkId(id, 'Image');
    const [dx, dy] = await this.anchor(id, x, y);
    return this.gl.send(CMD.imgDisplay, [id, ...s16(dx), ...s16(dy)]);
  }

  /**
   * Sends a 1-bit image straight to the display without storing it (no configuration
   * needed). "On" pixels are drawn with the current grey level / colour.
   */
  async stream(bitmap: Bitmap, x: number, y: number, options: EncodeOptions = {}): Promise<void> {
    const { flipX, flipY } = this.gl.profile;
    const encoded = encodeImage(flipBitmap(bitmap, flipX, flipY), 'mono1', options);
    const [dx, dy] = this.gl.boxToDevice(x, y, bitmap.width, bitmap.height);
    const header = [...u32(encoded.data.length), ...u16(encoded.width), ...s16(dx), ...s16(dy), IMAGE_FORMAT.mono1];
    await this.gl.sendMany([[CMD.imgStream, header], ...chunkRows(encoded).map(c => [CMD.imgStream, c] as const)]);
  }

  async list(): Promise<ImageInfo[]> {
    const r = new ByteReader(await this.gl.query(CMD.imgList));
    const out: ImageInfo[] = [];
    while (r.remaining >= 5) {
      const id = r.u8(), height = r.u16(), width = r.u16();
      out.push({ id, width, height });
      this.sizes.set(id, { width, height });
    }
    return out;
  }

  delete(id: number): Promise<void> {
    this.sizes.delete(checkId(id, 'Image'));
    return this.gl.send(CMD.imgDelete, [id]);
  }

  deleteAll(): Promise<void> {
    this.sizes.clear();
    return this.gl.send(CMD.imgDelete, [ALL]);
  }

  /** Known size of an image, if it was saved or listed in this session. */
  size(id: number): { width: number; height: number } | undefined {
    return this.sizes.get(id);
  }

  /** Device position of an image's anchor; looks the size up on the glasses if needed. */
  async anchor(id: number, x: number, y: number): Promise<[number, number]> {
    const { flipX, flipY } = this.gl.profile;
    if (!flipX && !flipY) return this.gl.boxToDevice(x, y, 1, 1);
    let size = this.sizes.get(id);
    if (!size) {
      await this.list();
      size = this.sizes.get(id);
    }
    if (!size) throw new ActiveLookError(`Image ${id} is not stored on the glasses`, 'device');
    return this.gl.boxToDevice(x, y, size.width, size.height);
  }
}
