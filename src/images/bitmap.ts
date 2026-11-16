import { rg } from '../protocol/palette.js';
import { heatshrinkCompress } from './heatshrink.js';

/**
 * RGBA pixels, row by row: the shape of the browser's `ImageData`
 * (`canvas.getContext('2d').getImageData(...)`), so canvases can be passed directly.
 */
export interface Bitmap {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Image formats of `imgSave` (0x41). */
export const IMAGE_FORMAT = {
  /** 16 grey levels, 2 pixels per byte. */
  grey4: 0x00,
  /** 1 bit per pixel (on/off); converted to 4bpp by the glasses. */
  mono1: 0x01,
  /** grey4, Heatshrink-compressed for a faster upload; stored uncompressed. */
  grey4Compressed: 0x02,
  /** grey4, Heatshrink-compressed and stored compressed (less memory, unpacked when shown). */
  grey4CompressedStored: 0x03,
  /** 16 grey levels plus 16 alpha levels, 1 byte per pixel. */
  greyAlpha8: 0x08,
  /** RG palette colour per pixel, Heatshrink-compressed (colour glasses only). */
  color8: 0x0a,
  /** RG palette colour per pixel plus on/off alpha, Heatshrink-compressed (colour glasses only). */
  colorAlpha8: 0x0c,
} as const;

export type ImageFormat = keyof typeof IMAGE_FORMAT;

/** Formats whose pixel data is sent Heatshrink-compressed. */
const COMPRESSED: ReadonlySet<ImageFormat> = new Set(['grey4Compressed', 'grey4CompressedStored', 'color8', 'colorAlpha8']);

export interface EncodedImage {
  format: ImageFormat;
  width: number;
  height: number;
  /** Bytes per row of the uncompressed pixel data, including padding. */
  rowBytes: number;
  /** Size of the uncompressed pixel data (the `size` field of imgSave). */
  size: number;
  compressed: boolean;
  /** Bytes as sent: pixel data, compressed for the compressed formats. */
  data: Uint8Array;
}

export interface EncodeOptions {
  /** mono1: grey levels above this (0–15) are "on". Default 7. */
  threshold?: number;
}

/** Creates an empty (transparent) bitmap. */
export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Mirrors a bitmap horizontally and/or vertically (both = rotate 180°). */
export function flipBitmap(bitmap: Bitmap, flipX: boolean, flipY: boolean): Bitmap {
  if (!flipX && !flipY) return bitmap;
  const { width: w, height: h, data } = bitmap;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = flipY ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const sx = flipX ? w - 1 - x : x;
      const s = (sy * w + sx) * 4, d = (y * w + x) * 4;
      out[d] = data[s]!; out[d + 1] = data[s + 1]!; out[d + 2] = data[s + 2]!; out[d + 3] = data[s + 3]!;
    }
  }
  return { width: w, height: h, data: out };
}

/** Grey level 0–15 of a pixel; transparency darkens towards black (= invisible on the glasses). */
export function greyAt(bitmap: Bitmap, x: number, y: number, premultiply = true): number {
  const i = (y * bitmap.width + x) * 4;
  const d = bitmap.data;
  const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  const a = premultiply ? d[i + 3]! / 255 : 1;
  return Math.round((lum * a * 15) / 255);
}

const alphaAt = (b: Bitmap, x: number, y: number) => b.data[(y * b.width + x) * 4 + 3]!;

/** RG palette colour of a pixel (blue is ignored, transparent pixels become black). */
export function colorAt(bitmap: Bitmap, x: number, y: number): number {
  const i = (y * bitmap.width + x) * 4;
  const d = bitmap.data;
  if (d[i + 3]! < 128) return 0;
  return rg((d[i]! / 255) * 8, (d[i + 1]! / 255) * 8);
}

/**
 * Encodes pixels as stored by the glasses. Rows are padded to whole bytes
 * (4bpp: even width, 1bpp: multiple of 8); padding pixels are black.
 */
export function encodeImage(bitmap: Bitmap, format: ImageFormat, options: EncodeOptions = {}): EncodedImage {
  const { width: w, height: h } = bitmap;
  if (w < 1 || h < 1) throw new RangeError('Image must be at least 1×1 pixel');
  const threshold = options.threshold ?? 7;
  let rowBytes: number;
  let data: Uint8Array;

  switch (format) {
    case 'grey4':
    case 'grey4Compressed':
    case 'grey4CompressedStored': {
      rowBytes = Math.ceil(w / 2);
      data = new Uint8Array(rowBytes * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // first pixel in the low nibble
          data[y * rowBytes + (x >> 1)]! |= x & 1 ? greyAt(bitmap, x, y) << 4 : greyAt(bitmap, x, y);
        }
      }
      break;
    }
    case 'mono1': {
      rowBytes = Math.ceil(w / 8);
      data = new Uint8Array(rowBytes * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // first pixel in bit 0
          if (greyAt(bitmap, x, y) > threshold) data[y * rowBytes + (x >> 3)]! |= 1 << (x & 7);
        }
      }
      break;
    }
    case 'greyAlpha8': {
      rowBytes = w;
      data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) data[y * w + x] = (greyAt(bitmap, x, y, false) << 4) | (alphaAt(bitmap, x, y) >> 4);
      }
      break;
    }
    case 'color8': {
      rowBytes = w;
      data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = colorAt(bitmap, x, y);
      break;
    }
    case 'colorAlpha8': {
      // per pixel pair: colour 1, colour 2, alpha (high nibble = pixel 2, low nibble = pixel 1; only 0/15)
      const pairs = Math.ceil(w / 2);
      rowBytes = pairs * 3;
      data = new Uint8Array(rowBytes * h);
      const on = (x: number, y: number) => (x < w && alphaAt(bitmap, x, y) >= 128 ? 0x0f : 0);
      for (let y = 0; y < h; y++) {
        for (let p = 0; p < pairs; p++) {
          const x = p * 2, o = y * rowBytes + p * 3;
          data[o] = colorAt(bitmap, x, y);
          data[o + 1] = x + 1 < w ? colorAt(bitmap, x + 1, y) : 0;
          data[o + 2] = (on(x + 1, y) << 4) | on(x, y);
        }
      }
      break;
    }
    default:
      throw new RangeError(`Unknown image format ${String(format)}`);
  }
  const compressed = COMPRESSED.has(format);
  return {
    format,
    width: w,
    height: h,
    rowBytes,
    size: data.length,
    compressed,
    data: compressed ? heatshrinkCompress(data) : data,
  };
}

/**
 * Splits image data into chunks of at most `maxBytes`. Uncompressed data is split at row
 * boundaries (the glasses need whole rows per chunk); compressed data is a plain stream.
 */
export function chunkImage(image: EncodedImage, maxBytes = 512): Uint8Array[] {
  let step = maxBytes;
  if (!image.compressed) {
    if (image.rowBytes > maxBytes) throw new RangeError(`Image row too long (${image.rowBytes} > ${maxBytes} bytes)`);
    step = Math.floor(maxBytes / image.rowBytes) * image.rowBytes;
  }
  const chunks: Uint8Array[] = [];
  for (let o = 0; o < image.data.length; o += step) chunks.push(image.data.subarray(o, o + step));
  return chunks;
}
