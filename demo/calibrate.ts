import { $, setupDemo } from './shared';

type Edge = 'left' | 'right' | 'top' | 'bottom';
const edges: Edge[] = ['left', 'right', 'top', 'bottom'];
const val = (id: string) => parseInt($<HTMLInputElement>(id).value, 10);

let originalShift: { x: number; y: number } | null = null;

const { gl, log, guard } = setupDemo({
  controls: ['ruler', 'frame', 'textcheck', 'left', 'right', 'top', 'bottom', 'shiftSet', 'shiftZero', 'shiftRestore', 'shiftX', 'shiftY'],
  onConnect: ({ gl }) => {
    const s = gl.settings;
    if (s) {
      originalShift ??= { x: s.shiftX, y: s.shiftY };
      log(`Stored picture shift: (${s.shiftX}, ${s.shiftY})`);
    } else {
      log('Could not read the picture shift.');
    }
    syncFromLibrary();
  },
});

/** Shift fields and edge sliders show what the library currently assumes. */
function syncFromLibrary() {
  const s = gl.settings;
  if (s) {
    $<HTMLInputElement>('shiftX').value = String(s.shiftX);
    $<HTMLInputElement>('shiftY').value = String(s.shiftY);
  }
  $('shiftInfo').textContent = s
    ? `Current shift (${s.shiftX}, ${s.shiftY}), shown in the ENGO app as x ${-s.shiftX}, y ${s.shiftY}` +
      `${originalShift ? `; originally (${originalShift.x}, ${originalShift.y})` : ''}.`
    : 'Connect to read the shift.';
  const sa = gl.safeArea;
  const initial: Record<Edge, number> = {
    left: sa.x,
    right: sa.x + sa.width - 1,
    top: sa.y,
    bottom: sa.y + sa.height - 1,
  };
  for (const e of edges) $<HTMLInputElement>(e).value = String(initial[e]);
  showResult();
}

function showResult() {
  const x = val('left'), y = val('top');
  const width = val('right') - x + 1, height = val('bottom') - y + 1;
  for (const e of edges) $(`${e}Val`).textContent = String(val(e));
  const sa = gl.safeArea;
  const s = gl.settings;
  $('result').textContent =
    `Measured:  x ${x}–${val('right')}, y ${y}–${val('bottom')}\n` +
    `Predicted: x ${sa.x}–${sa.x + sa.width - 1}, y ${sa.y}–${sa.y + sa.height - 1} (from the profile and the shift)\n\n` +
    `const profile = defineProfile(ENGO3, {\n` +
    `  safeArea: { x: ${x}, y: ${y}, width: ${width}, height: ${height} },\n` +
    (s ? `  safeAreaShift: { x: ${s.shiftX}, y: ${s.shiftY} },\n` : '') +
    `});`;
}

// Redraw at most one frame at a time; slider moves in between collapse into one more redraw.
let view: 'frame' | 'text' | 'ruler' = 'frame';
let busy = false, dirty = false;
async function redraw() {
  if (!gl.connected) return;
  if (busy) { dirty = true; return; }
  busy = true;
  try {
    do { dirty = false; await gl.draw(render); } while (dirty);
  } catch (e) {
    log(`Error: ${(e as Error).message}`);
  } finally {
    busy = false;
  }
}

function render() {
  const l = val('left'), r = val('right'), t = val('top'), b = val('bottom');
  void gl.grey(15);
  if (view === 'ruler') {
    for (let x = 0; x < gl.width; x += 50) {
      void gl.line(x, 0, x, gl.height - 1);
      void gl.text(String(x), x + 3, 60, { font: 0 });
    }
    for (let y = 0; y < gl.height; y += 50) {
      void gl.line(0, y, gl.width - 1, y);
      if (y > 0) void gl.text(String(y), 3, y + 3, { font: 0 });
    }
  } else if (view === 'frame') {
    void gl.rect(l, t, r, b);
    const cx = Math.round((l + r) / 2), cy = Math.round((t + b) / 2);
    void gl.line(cx - 10, cy, cx + 10, cy);
    void gl.line(cx, cy - 10, cx, cy + 10);
    void gl.text(`${l},${t}`, l + 4, t + 4, { font: 0 });
    void gl.text(`${r},${b}`, r - 90, b - 28, { font: 0 });
  } else {
    // Box and text share the same top-left corner for each font.
    let y = t + 4;
    for (const font of [0, 1, 2, 3]) {
      const h = gl.fontHeight(font);
      if (y + h > b) break;
      void gl.rect(l + 4, y, l + 4 + 120, y + h);
      void gl.text(`F${font} Ag`, l + 4, y, { font });
      y += h + 6;
    }
  }
}

for (const e of edges) {
  $<HTMLInputElement>(e).oninput = () => { showResult(); view = 'frame'; void redraw(); };
}
syncFromLibrary();

const applyShift = guard(async (x: number, y: number) => {
  await gl.shift(x, y);
  const read = await gl.getSettings(); // read back what the glasses stored
  log(`Picture shift set to (${read.shiftX}, ${read.shiftY}).`);
  syncFromLibrary();
  view = 'ruler';
  await redraw();
});

$('shiftSet').onclick = () => void applyShift(val('shiftX'), val('shiftY'));
$('shiftZero').onclick = () => void applyShift(0, 0);
$('shiftRestore').onclick = () => {
  if (!originalShift) { log('Original shift unknown.'); return; }
  void applyShift(originalShift.x, originalShift.y);
};
$('ruler').onclick = guard(() => { view = 'ruler'; return redraw(); });
$('frame').onclick = guard(() => { view = 'frame'; return redraw(); });
$('textcheck').onclick = guard(() => { view = 'text'; return redraw(); });
