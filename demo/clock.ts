import { COLORS } from '@pranen/activelook';
import { $, setupDemo } from './shared';

const { gl, log } = setupDemo({ controls: ['start', 'stop'] });
let timer: ReturnType<typeof setTimeout> | null = null;

const batteryColor = () => {
  const b = gl.battery;
  return b == null ? COLORS.yellow : b > 50 ? COLORS.green : b > 20 ? COLORS.amber : COLORS.red;
};

async function tick() {
  const now = new Date();
  const time = now.toLocaleTimeString('de-CH');
  const date = now.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const batt = gl.battery == null ? '--' : `${gl.battery}%`;
  $('preview').textContent = `${time} · battery ${batt}`;

  // Layout relative to the visible area of the glasses (gl.safeArea).
  const { x, y, width, height } = gl.safeArea;
  const right = x + width - 1, bottom = y + height - 1;
  const barW = Math.round((now.getSeconds() / 60) * (width - 6));

  // Everything inside draw() appears at once (hold/flush).
  await gl.draw(g => {
    void g.text(`Batt ${batt}`, right - 110, y + 4, { font: 0, color: batteryColor() });
    void g.text(time, x + 12, y + 45, { font: 2 });
    void g.text(date, x + 12, y + 95, { font: 0 });
    void g.grey(15);
    void g.rect(x, bottom - 18, right, bottom - 4);
    void g.color(COLORS.green);
    if (barW > 0) void g.fillRect(x + 2, bottom - 16, x + 2 + barW, bottom - 6);
  });
}

// Aligned to the full second; the next tick starts only after the previous one finished.
async function loop() {
  if (!timer) return;
  try { await tick(); } catch (e) { log(`Error: ${(e as Error).message}`); stop(); return; }
  if (timer) timer = setTimeout(loop, 1000 - (Date.now() % 1000));
}

function start() {
  if (timer) return;
  timer = setTimeout(loop, 0);
  $<HTMLButtonElement>('start').disabled = true;
  $<HTMLButtonElement>('stop').disabled = false;
  log('▶ Clock running.');
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  $<HTMLButtonElement>('start').disabled = !gl.connected;
  $<HTMLButtonElement>('stop').disabled = true;
  log('⏸ Clock stopped.');
}

$('start').onclick = start;
$('stop').onclick = stop;
gl.on('connect', () => { $<HTMLButtonElement>('stop').disabled = true; });
gl.on('disconnect', () => { if (timer) stop(); });
