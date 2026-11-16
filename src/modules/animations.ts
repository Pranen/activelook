import { ActiveLookError } from '../errors.js';
import { clamp, s16, u16 } from '../protocol/bytes.js';
import { CMD } from '../protocol/commands.js';
import { ALL, Module, checkId, idList } from './shared.js';

export interface AnimationOptions {
  /** Pause between frames in ms. Default 100. */
  delayMs?: number;
  /** Number of repetitions, 0xFF = forever. Default forever. */
  repeat?: number;
  /** Frame size; needed to place the animation on mirrored displays (ENGO 3). */
  width?: number;
  height?: number;
}

/**
 * Animations stored on the glasses. Up to 5 play at once, each in a "handler" slot.
 * Creating animations (animSave) needs Heatshrink-compressed delta frames and is not
 * supported yet; animations from a configuration (e.g. made with the ActiveLook
 * Config-Generator) can be played, listed and deleted.
 */
export class Animations extends Module {
  /** Plays animation `id` in slot `handlerId` with its top-left corner at (x, y). */
  display(handlerId: number, id: number, x: number, y: number, options: AnimationOptions = {}): Promise<void> {
    checkId(id, 'Animation');
    const { flipX, flipY } = this.gl.profile;
    if ((flipX || flipY) && !(options.width && options.height)) {
      throw new ActiveLookError('Animation size (width/height) is needed on mirrored displays', 'device');
    }
    const [dx, dy] = this.gl.boxToDevice(x, y, options.width ?? 1, options.height ?? 1);
    return this.gl.send(CMD.animDisplay, [
      handlerId & 0xff,
      id,
      ...u16(clamp(options.delayMs ?? 100, 0, 0xffff)),
      clamp(options.repeat ?? 0xff, 0, 255),
      ...s16(dx),
      ...s16(dy),
    ]);
  }

  /** Stops the animation in a handler slot. */
  clear(handlerId: number): Promise<void> {
    return this.gl.send(CMD.animClear, [handlerId & 0xff]);
  }

  clearAll(): Promise<void> {
    return this.gl.send(CMD.animClear, [ALL]);
  }

  async list(): Promise<number[]> {
    return idList(await this.gl.query(CMD.animList));
  }

  delete(id: number): Promise<void> {
    return this.gl.send(CMD.animDelete, [checkId(id, 'Animation')]);
  }

  deleteAll(): Promise<void> {
    return this.gl.send(CMD.animDelete, [ALL]);
  }
}
