export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Picture shift stored on the device (device units, as reported by the settings query). */
export interface Shift {
  x: number;
  y: number;
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
  /** Part of the display that is visible to the wearer (logical coordinates), measured at `safeAreaShift`. */
  safeArea: Rect;
  /**
   * Picture shift stored on the device when `safeArea` was measured. If the glasses report a
   * different shift, the library moves the safe area accordingly. Omit to never adjust.
   */
  safeAreaShift?: Shift;
  /** Mirror x / y when converting to device coordinates. */
  flipX: boolean;
  flipY: boolean;
  /** Line height per font id; fallback when the device's font list cannot be read. */
  fontHeights: readonly number[];
  /** Text rotation value that renders upright for the wearer. */
  textRotation: number;
  /** Colour display? 'auto' detects it from the hardware string (MDP08 = colour). */
  color: boolean | 'auto';
}

/**
 * ENGO 3 (ActiveLook, red-green colour display). Calibrated empirically: both axes are mirrored.
 *
 * Visible area measured with the calibrate demo at two stored picture shifts (set e.g. by the
 * ENGO app's display position):
 * - shift (0, 0):  x 0–274, y 0–249
 * - shift (3, 30): x 3–270, y 30–255 (bottom clipped by the panel)
 * The profile uses the (0, 0) measurement with the more cautious right edge of both (267).
 * For other shifts the library moves the area, see `visibleArea()`.
 */
export const ENGO3: DeviceProfile = {
  name: 'ENGO 3',
  width: 304,
  height: 256,
  safeArea: { x: 0, y: 0, width: 268, height: 250 },
  safeAreaShift: { x: 0, y: 0 },
  flipX: true,
  flipY: true,
  // As reported by fontList on firmware 4.13 (the API docs list 24/24/35/49 for ids 0–3).
  // Only a fallback: the library reads the real heights on connect.
  fontHeights: [24, 24, 38, 64, 75, 82, 32, 48],
  textRotation: 4,
  color: 'auto',
};

/** Create a profile from an existing one, e.g. to adjust the safe area after calibrating. */
export function defineProfile(base: DeviceProfile, overrides: Partial<DeviceProfile>): DeviceProfile {
  return { ...base, ...overrides, safeArea: { ...base.safeArea, ...overrides.safeArea } };
}

/**
 * Visible area for the given stored picture shift.
 *
 * Shifting the picture by d device pixels moves the logical content by d (or −d when the axis
 * is mirrored), so the window the wearer sees moves the opposite way over the logical
 * coordinates. The result is clipped to the panel.
 */
export function visibleArea(profile: DeviceProfile, shift: Shift | null | undefined): Rect {
  const base = profile.safeArea;
  const ref = profile.safeAreaShift;
  if (!shift || !ref) return { ...base };
  const dx = (shift.x - ref.x) * (profile.flipX ? 1 : -1);
  const dy = (shift.y - ref.y) * (profile.flipY ? 1 : -1);
  const x0 = Math.max(0, base.x + dx);
  const y0 = Math.max(0, base.y + dy);
  const x1 = Math.min(profile.width - 1, base.x + base.width - 1 + dx);
  const y1 = Math.min(profile.height - 1, base.y + base.height - 1 + dy);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0 + 1), height: Math.max(0, y1 - y0 + 1) };
}

/** Colour support from the hardware string of the Device Information service. */
export function detectColor(profile: DeviceProfile, hardware: string | undefined): boolean {
  if (profile.color !== 'auto') return profile.color;
  if (hardware?.includes('MDP05')) return false;
  return true; // MDP08 or unknown: assume colour, the safer choice for ENGO 3
}
