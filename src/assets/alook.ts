import { CMD } from '../protocol/commands.js';
import { clamp, s16, u16 } from '../protocol/bytes.js';
import { Module } from '../modules/shared.js';
import { ALOOK_ANIMATIONS, ALOOK_CONFIG, ALOOK_IMAGES, ALOOK_LAYOUTS, ALOOK_ZONES } from './alook-data.js';

export { ALOOK_ANIMATIONS, ALOOK_CONFIG, ALOOK_IMAGES, ALOOK_LAYOUTS, ALOOK_ZONES };

export type AlookImage = keyof typeof ALOOK_IMAGES;
export type AlookAnimation = keyof typeof ALOOK_ANIMATIONS;
export type AlookLayout = keyof typeof ALOOK_LAYOUTS;
export type AlookZone = keyof typeof ALOOK_ZONES;

export interface PadOptions {
  /** Default 'right'. */
  align?: 'left' | 'right';
  /** Digits the layout is made for. Default 4. */
  digits?: number;
}

/**
 * Pads a value with the "ghost" characters of the ALooK fonts so it lines up in the
 * ALooK layouts (made for 4 digits plus one `.` or `:`): `$` is an invisible digit,
 * `&` an invisible separator. `padValue('123')` → `'&$123'`, `padValue('1.23', { align: 'left' })` → `'1.23$'`.
 */
export function padValue(value: string, options: PadOptions = {}): string {
  const digits = (value.match(/[0-9]/g) ?? []).length;
  const pad = (/[.:,]/.test(value) ? '' : '&') + '$'.repeat(Math.max(0, (options.digits ?? 4) - digits));
  return (options.align ?? 'right') === 'right' ? pad + value : value + pad;
}

/**
 * The visual assets built into every ActiveLook device (configuration "ALooK"): sport icons,
 * status images, animations and ready-made layouts for one to six values.
 * Source: https://github.com/ActiveLook/Activelook-Visual-Assets (CC0).
 *
 * Call `use()` first: it selects the ALooK configuration. Layouts and animations are shown
 * where ActiveLook designed them; images can be placed anywhere.
 */
export class Assets extends Module {
  readonly config = ALOOK_CONFIG;
  readonly images = ALOOK_IMAGES;
  readonly animations = ALOOK_ANIMATIONS;
  readonly layouts = ALOOK_LAYOUTS;
  readonly zones = ALOOK_ZONES;

  /** Selects the ALooK configuration so its images, layouts and animations can be used. */
  async use(): Promise<void> {
    await this.gl.configs.select(ALOOK_CONFIG.name);
    for (const img of Object.values(ALOOK_IMAGES)) this.gl.images.remember(img.id, img.width, img.height);
  }

  /** Shows an ALooK image with its top-left corner at logical (x, y). */
  showImage(name: AlookImage, x: number, y: number): Promise<void> {
    const img = ALOOK_IMAGES[name];
    this.gl.images.remember(img.id, img.width, img.height);
    return this.gl.images.display(img.id, x, y);
  }

  /** Shows an ALooK layout at its designed position; pad numbers with `padValue()`. */
  showLayout(name: AlookLayout, text = ''): Promise<void> {
    return this.gl.layouts.display(ALOOK_LAYOUTS[name].id, text);
  }

  /** Shows an ALooK layout at one of the companion app's zones (see ALOOK_ZONES). */
  showLayoutInZone(name: AlookLayout, zone: AlookZone, text = '', variant: 'main' | 'chronoMinSec' | 'chronoHour' = 'main'): Promise<void> {
    const [x, y] = ALOOK_ZONES[zone][variant];
    // Zone positions are device coordinates, like the layouts themselves.
    return this.gl.send(CMD.layoutDisplayExtended, [ALOOK_LAYOUTS[name].id, ...u16(x), clamp(y, 0, 255), ...this.text(text)]);
  }

  /** Plays an ALooK animation at its designed position in handler slot `handlerId`. */
  playAnimation(name: AlookAnimation, options: { handlerId?: number; delayMs?: number; repeat?: number } = {}): Promise<void> {
    const anim = ALOOK_ANIMATIONS[name];
    return this.gl.send(CMD.animDisplay, [
      (options.handlerId ?? 0) & 0xff,
      anim.id,
      ...u16(clamp(options.delayMs ?? 100, 0, 0xffff)),
      clamp(options.repeat ?? (anim.loop ? 0xff : 1), 0, 255),
      ...s16(anim.x),
      ...s16(anim.y),
    ]);
  }

  private text(text: string): number[] {
    return [...new TextEncoder().encode(text), 0];
  }
}
