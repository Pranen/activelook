// Red-green palette of ActiveLook colour glasses: 9 red × 9 green levels = 81 colours (no blue, no white).
// Values from the ActiveLook API documentation. Row = red 0→8, column = green 0→8.

export const RG_PALETTE: readonly (readonly number[])[] = [
  [0x00, 0x01, 0x02, 0x41, 0x81, 0x82, 0x43, 0x83, 0xc3],
  [0x04, 0x05, 0x06, 0x45, 0x85, 0x86, 0x47, 0x87, 0xc7],
  [0x20, 0x21, 0x22, 0x61, 0xa1, 0xa2, 0x63, 0xa3, 0xe3],
  [0x14, 0x15, 0x16, 0x55, 0x95, 0x96, 0x57, 0x97, 0xd7],
  [0x18, 0x19, 0x1a, 0x59, 0x99, 0x9a, 0x5b, 0x9b, 0xdb],
  [0x28, 0x29, 0x2a, 0x69, 0xa9, 0xaa, 0x6b, 0xab, 0xeb],
  [0x1c, 0x1d, 0x1e, 0x5d, 0x9d, 0x9e, 0x5f, 0x9f, 0xdf],
  [0x38, 0x39, 0x3a, 0x79, 0xb9, 0xba, 0x7b, 0xbb, 0xfb],
  [0x3c, 0x3d, 0x3e, 0x7d, 0xbd, 0xbe, 0x7f, 0xbf, 0xff],
];

export const RG_LEVELS = 9;

/** Colour value for red and green levels 0–8. */
export function rg(red: number, green: number): number {
  const r = Math.min(8, Math.max(0, Math.round(red)));
  const g = Math.min(8, Math.max(0, Math.round(green)));
  return RG_PALETTE[r]![g]!;
}

/** Red/green levels of a palette value, or null if the value is not one of the 81 colours. */
export function rgLevels(value: number): { red: number; green: number } | null {
  for (let red = 0; red < RG_LEVELS; red++) {
    const green = RG_PALETTE[red]!.indexOf(value);
    if (green >= 0) return { red, green };
  }
  return null;
}

/** Approximate CSS colour for previews in the browser. */
export function rgToCss(value: number): string {
  const l = rgLevels(value);
  if (!l) return 'rgb(0, 0, 0)';
  return `rgb(${Math.round((l.red / 8) * 255)}, ${Math.round((l.green / 8) * 255)}, 0)`;
}

/** Approximate grey level 0–15, used as fallback on monochrome glasses. */
export function rgToGrey(value: number): number {
  const l = rgLevels(value);
  if (!l) return 15;
  return Math.round(((l.red * 0.3 + l.green * 0.59) / (8 * 0.89)) * 15);
}

/** A few named colours, calibrated by eye on ENGO 3. */
export const COLORS = {
  black: 0x00,
  red: 0x3c,
  orange: 0x3e,
  amber: 0xbd,
  yellow: 0xff,
  lime: 0x87,
  green: 0xc3,
} as const;

export type ColorName = keyof typeof COLORS;
