import type { ActiveLook } from '../activelook.js';
import { ActiveLookError } from '../errors.js';

/** Highest id for stored objects (images, layouts, gauges, pages, animations, fonts). */
export const MAX_ID = 0xfe;
/** Id value meaning "all" in delete commands. */
export const ALL = 0xff;

export function checkId(id: number, what: string): number {
  if (!Number.isInteger(id) || id < 0 || id > MAX_ID) throw new RangeError(`${what} id must be 0–${MAX_ID}, got ${id}`);
  return id;
}

/** Response made of single id bytes (list commands). */
export const idList = (data: Uint8Array): number[] => [...data];

export function requireColor(gl: ActiveLook, what: string): void {
  if (!gl.isColor) throw new ActiveLookError(`${what} needs colour glasses`, 'device');
}

/** Base class for the stored-object modules. */
export abstract class Module {
  constructor(protected readonly gl: ActiveLook) {}
}
