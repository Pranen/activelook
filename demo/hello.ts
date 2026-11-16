import { $, setupDemo } from './shared';

const { gl, log, guard } = setupDemo({ controls: ['send', 'grid', 'clear'] });
const num = (id: string) => parseInt($<HTMLInputElement>(id).value, 10);

$('send').onclick = guard(async () => {
  const text = $<HTMLInputElement>('text').value;
  await gl.draw(g => g.text(text, num('x'), num('y'), { rotation: num('rot'), font: num('font') }));
  log(`✓ "${text}" at x=${num('x')} y=${num('y')}`);
});

// Grid A1 (top-left) … D4 (bottom-right) filling the visible area (gl.safeArea).
// If the calibration is right, the outer frame sits just inside the visible edges on all four sides.
// To find the edges in the first place, use the ruler in the calibrate demo.
$('grid').onclick = guard(async () => {
  const { x, y, width, height } = gl.safeArea;
  const n = 4;
  const xs = Array.from({ length: n + 1 }, (_, i) => x + Math.round((i * (width - 1)) / n));
  const ys = Array.from({ length: n + 1 }, (_, i) => y + Math.round((i * (height - 1)) / n));
  await gl.draw(g => {
    // No await needed per command: the queue keeps the order.
    for (const lx of xs) void g.line(lx, ys[0]!, lx, ys[n]!);
    for (const ly of ys) void g.line(xs[0]!, ly, xs[n]!, ly);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) void g.text('ABCD'[c]! + (r + 1), xs[c]! + 4, ys[r]! + 4, { font: 0 });
    }
  });
  log(`✓ Test grid sent: visible area x ${xs[0]}–${xs[n]}, y ${ys[0]}–${ys[n]}.`);
});

$('clear').onclick = guard(async () => { await gl.clear(); log('✓ Cleared.'); });
