// Generates src/assets/alook-data.ts from the Activelook-Visual-Assets README.
// Usage:
//   curl -sO https://raw.githubusercontent.com/ActiveLook/Activelook-Visual-Assets/main/README.md
//   node scripts/gen-alook-assets.mjs README.md src/assets/alook-data.ts
import { readFileSync, writeFileSync } from 'node:fs';

const [, , readmePath, outPath] = process.argv;
const md = readFileSync(readmePath, 'utf8').replace(/\r/g, '');

function section(title) {
  const start = md.indexOf(`## ${title}\n`);
  if (start < 0) throw new Error(`Section ${title} missing`);
  const rest = md.slice(start + title.length + 4);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

function rows(text) {
  return text
    .split('\n')
    .filter(l => l.startsWith('|') && !/^\|\s*-/.test(l))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
    .filter(cells => /^\d+$/.test(cells[0]));
}

const unquote = s => s.replace(/`/g, '');

// Images: `<id>_<name>_<W>x<H>`
const images = rows(section('Images')).map(([id, raw]) => {
  const name = unquote(raw);
  const m = /^(\d+)_(.+)_(\d+)x(\d+)$/.exec(name);
  if (!m || m[1] !== id) throw new Error(`Bad image row ${id} ${name}`);
  return { key: `${m[2]}_${m[3]}x${m[4]}`, id: +id, width: +m[3], height: +m[4] };
});

// Animations: `<id>_<name>[_x_<X>_y_<Y>][_loop]`
const animations = rows(section('Animation')).map(([id, raw]) => {
  let name = unquote(raw).replace(new RegExp(`^${id}_`), '');
  const loop = name.endsWith('_loop');
  if (loop) name = name.slice(0, -5);
  const pos = /_x_(\d+)_y_(\d+)$/.exec(name);
  if (pos) name = name.slice(0, pos.index);
  return { key: name, id: +id, x: pos ? +pos[1] : 0, y: pos ? +pos[2] : 0, loop };
});

const layouts = rows(section('Layouts')).map(c => {
  const [id, name, x, y, width, height, font, textX, textY, textRotation, textOpaque, useText] = c;
  return {
    key: name, id: +id, x: +x, y: +y, width: +width, height: +height, font: +font,
    textX: +textX, textY: +textY, textRotation: +textRotation,
    textOpaque: textOpaque === 'true', useText: useText === 'true',
  };
});

// Zone table: | Zone | Data type | X | Y | X | Y | X | Y |
const zones = section('Layout position')
  .split('\n')
  .filter(l => /^\|\d?D/.test(l) || /^\|[0-9]D/.test(l))
  .map(l => l.split('|').slice(1, -1).map(c => c.trim()))
  .filter(c => c.length === 8 && /^\d/.test(c[2]))
  .map(([zone, type, x, y, cx, cy, hx, hy]) => ({
    key: zone, type, main: [+x, +y], chronoMinSec: [+cx, +cy], chronoHour: [+hx, +hy],
  }));

const dup = (list, what) => {
  const seen = new Set();
  for (const e of list) { if (seen.has(e.key)) throw new Error(`Duplicate ${what} ${e.key}`); seen.add(e.key); }
};
// Some layouts share a name (e.g. "ready", "target_reached"): keep the first id under the plain name.
const layoutKeys = new Set();
for (const l of layouts) {
  if (layoutKeys.has(l.key)) l.key = `${l.key}_${l.id}`;
  layoutKeys.add(l.key);
}
dup(images, 'image'); dup(animations, 'animation'); dup(layouts, 'layout'); dup(zones, 'zone');

const obj = (list, fields) =>
  '{\n' + list.map(e => `  ${JSON.stringify(e.key)}: { ${fields.map(f => `${f}: ${JSON.stringify(e[f])}`).join(', ')} },`).join('\n') + '\n}';

const out = `// Generated from https://github.com/ActiveLook/Activelook-Visual-Assets (README, CC0-1.0).
// Do not edit by hand: regenerate instead. Positions are device coordinates as stored on the glasses.

/** The configuration that holds these assets on every ActiveLook device (firmware >= 4.2). */
export const ALOOK_CONFIG = { name: 'ALooK', version: 11 } as const;

export const ALOOK_IMAGES = ${obj(images, ['id', 'width', 'height'])} as const;

/** x/y: position the animation was designed for (device coordinates); 0/0 for full screen. */
export const ALOOK_ANIMATIONS = ${obj(animations, ['id', 'x', 'y', 'loop'])} as const;

export const ALOOK_LAYOUTS = ${obj(layouts, ['id', 'x', 'y', 'width', 'height', 'font', 'textX', 'textY', 'textRotation', 'textOpaque', 'useText'])} as const;

/** Layout positions used by the ActiveLook companion app (device coordinates). */
export const ALOOK_ZONES = ${obj(zones, ['type', 'main', 'chronoMinSec', 'chronoHour'])} as const;
`;
writeFileSync(outPath, out);
console.log(`images ${images.length}, animations ${animations.length}, layouts ${layouts.length}, zones ${zones.length}`);
