import { ByteReader, bool, clamp, s16, u16 } from '../protocol/bytes.js';
import { CMD } from '../protocol/commands.js';
import { ALL, Module, checkId, idList } from './shared.js';

/** A full circle has 16 portions. */
export const GAUGE_PORTIONS = 16;

export interface GaugeDefinition {
  /** Centre (logical coordinates). */
  x: number;
  y: number;
  /** Outer and inner radius in px. */
  radius: number;
  innerRadius: number;
  /** First and last portion (0–15) of the ring, as seen by the wearer. */
  start: number;
  end: number;
  /** Fill direction. Default true. */
  clockwise?: boolean;
}

/**
 * Ring gauges stored on the glasses (needs an open configuration). A gauge is a ring of
 * 16 portions; `display(id, percent)` fills the part from `start` to `end`.
 *
 * Portion numbering follows the device; on mirrored displays (ENGO 3) the library rotates
 * portions by half a turn so they keep their place as seen by the wearer. Which portion sits
 * at which clock position is not documented: try it with the demo.
 */
export class Gauges extends Module {
  save(id: number, gauge: GaugeDefinition): Promise<void> {
    checkId(id, 'Gauge');
    const [dx, dy] = this.gl.toDevice(gauge.x, gauge.y);
    return this.gl.send(CMD.gaugeSave, [
      id,
      ...s16(dx),
      ...s16(dy),
      ...u16(clamp(gauge.radius, 0, 0xffff)),
      ...u16(clamp(gauge.innerRadius, 0, 0xffff)),
      this.portion(gauge.start),
      this.portion(gauge.end),
      ...bool(gauge.clockwise ?? true),
    ]);
  }

  /** Fills the gauge to `percent` (0–100). */
  display(id: number, percent: number): Promise<void> {
    return this.gl.send(CMD.gaugeDisplay, [checkId(id, 'Gauge'), clamp(percent, 0, 100)]);
  }

  async get(id: number): Promise<GaugeDefinition> {
    const r = new ByteReader(await this.gl.query(CMD.gaugeGet, [checkId(id, 'Gauge')]));
    const [x, y] = this.gl.toDevice(r.s16(), r.s16()); // the mapping is its own inverse
    return {
      x,
      y,
      radius: r.u16(),
      innerRadius: r.u16(),
      start: this.portion(r.u8()),
      end: this.portion(r.u8()),
      clockwise: r.bool(),
    };
  }

  async list(): Promise<number[]> {
    return idList(await this.gl.query(CMD.gaugeList));
  }

  delete(id: number): Promise<void> {
    return this.gl.send(CMD.gaugeDelete, [checkId(id, 'Gauge')]);
  }

  deleteAll(): Promise<void> {
    return this.gl.send(CMD.gaugeDelete, [ALL]);
  }

  /** Logical ↔ device portion (half a turn when both axes are mirrored; its own inverse). */
  private portion(p: number): number {
    const { flipX, flipY } = this.gl.profile;
    const n = ((Math.round(p) % GAUGE_PORTIONS) + GAUGE_PORTIONS) % GAUGE_PORTIONS;
    return flipX && flipY ? (n + GAUGE_PORTIONS / 2) % GAUGE_PORTIONS : n;
  }
}
