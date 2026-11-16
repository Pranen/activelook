export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Describes a model of glasses. All drawing methods take logical coordinates
 * (origin top-left, x → right, y → down, as seen by the wearer); the profile says how
 * they map to device coordinates.
 */
export interface DeviceProfile {
  name: string;
  /** Display resolution in pixels. */
  width: number;
  height: number;
  /** Part of the display that is actually visible through the optics (logical coordinates). */
  safeArea: Rect;
  /** Mirror x / y when converting to device coordinates. */
  flipX: boolean;
  flipY: boolean;
  /** Line height per font id (0–3 are the built-in fonts). */
  fontHeights: readonly number[];
  /** Text rotation value that renders upright for the wearer. */
  textRotation: number;
  /** Colour display? 'auto' detects it from the hardware string (MDP08 = colour). */
  color: boolean | 'auto';
}

/**
 * ENGO 3 (ActiveLook, red-green colour display). Calibrated empirically:
 * both axes are mirrored, and only about x 3–270, y 30–255 is inside the eye box
 * (measured with the calibrate demo).
 */
export const ENGO3: DeviceProfile = {
  name: 'ENGO 3',
  width: 304,
  height: 256,
  safeArea: { x: 3, y: 30, width: 268, height: 226 },
  flipX: true,
  flipY: true,
  fontHeights: [24, 24, 35, 49],
  textRotation: 4,
  color: 'auto',
};

/** Create a profile from an existing one, e.g. to adjust the safe area after calibrating. */
export function defineProfile(base: DeviceProfile, overrides: Partial<DeviceProfile>): DeviceProfile {
  return { ...base, ...overrides, safeArea: { ...base.safeArea, ...overrides.safeArea } };
}

/** Colour support from the hardware string of the Device Information service. */
export function detectColor(profile: DeviceProfile, hardware: string | undefined): boolean {
  if (profile.color !== 'auto') return profile.color;
  if (hardware?.includes('MDP05')) return false;
  return true; // MDP08 or unknown: assume colour, the safer choice for ENGO 3
}
