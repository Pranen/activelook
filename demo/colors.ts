import { RG_PALETTE, rgLevels, rgToCss, sleep } from '@pranen/activelook';
import { $, setupDemo } from './shared';

const { gl, log, guard } = setupDemo({ controls: ['all', 'clear'] });
const hex = (v: number) => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;

const showColor = guard(async (value: number) => {
  if (!gl.connected) { log('Connect first, then tap a swatch.'); return; }
  const { x, y, width, height } = gl.safeArea;
  await gl.draw(g => {
    void g.color(value);
    void g.fillRect(x, y, x + width - 1, y + height - 48);
    void g.text(hex(value), x + 15, y + height - 40, { font: 2 });
  });
  log(`Showing ${hex(value)}`);
});

// Browser reference grid: rows = red 0→8, columns = green 0→8.
for (const row of RG_PALETTE) {
  for (const value of row) {
    const cell = document.createElement('button');
    const { red, green } = rgLevels(value)!;
    cell.className = 'swatch';
    cell.style.background = rgToCss(value);
    cell.style.color = red * 0.4 + green * 0.7 > 4 ? '#000' : '#fff';
    cell.textContent = hex(value);
    cell.title = `red ${red}, green ${green}`;
    cell.onclick = () => void showColor(value);
    $('grid').appendChild(cell);
  }
}

// Same layout as the browser grid: rows = red 0→8 (top→bottom), columns = green 0→8 (left→right).
// A light frame marks the grid, because black (red 0, green 0, top-left) is invisible on the glasses.
$('all').onclick = guard(async () => {
  const sa = gl.safeArea;
  const n = RG_PALETTE.length;
  const header = 26; // room for the axis label
  const x0 = sa.x + 2, y0 = sa.y + header + 2;
  const cell = Math.floor(Math.min(sa.width - 4, sa.height - header - 4) / n);
  const gap = 2;
  await gl.draw(async g => {
    void g.text('G 0 > 8, R 0 v 8', sa.x + 4, sa.y, { font: 0 });
    void g.grey(15);
    void g.rect(x0 - 2, y0 - 2, x0 + n * cell + 1, y0 + n * cell + 1);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const cx = x0 + c * cell, cy = y0 + r * cell;
        void g.color(RG_PALETTE[r]![c]!);
        void g.fillRect(cx + gap, cy + gap, cx + cell - 1, cy + cell - 1);
      }
      await sleep(0); // let the queue drain a little between rows
    }
  });
  log('✓ All 81 colors drawn: top-left black (invisible), top-right green, bottom-left red, bottom-right yellow.');
});

$('clear').onclick = guard(async () => { await gl.clear(); log('✓ Cleared.'); });
