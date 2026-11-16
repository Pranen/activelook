import type { InputEvent } from '@pranen/activelook';
import { $, setupDemo } from './shared';

const { gl, log, guard } = setupDemo({ controls: ['gon', 'goff', 'version', 'settings', 'battery', 'fonts'] });
const counts = { touch: 0, gesture: 0 };
const stamp = () => new Date().toISOString().slice(11, 23);

const show = guard(async (kind: 'touch' | 'gesture', e: InputEvent) => {
  const n = ++counts[kind];
  $('last').textContent = `${kind} #${n} → ${e.value}`;
  log(`◉ ${stamp()}  ${kind} #${n}: value=${e.value} bytes=[${[...e.bytes].join(', ')}]`);
  await gl.draw(g => {
    void g.text(`${kind.toUpperCase()} #${n}`, 15, 30, { font: 1 });
    void g.text(`value = ${e.value}`, 15, 90, { font: 3 });
  });
});

gl.on('touch', e => void show('touch', e));
gl.on('gesture', e => void show('gesture', e));
gl.on('battery', level => log(`Battery notification: ${level}%`));

$('gon').onclick = guard(async () => { await gl.gestureDetection(true); log('Gesture sensor on.'); });
$('goff').onclick = guard(async () => { await gl.gestureDetection(false); log('Gesture sensor off.'); });
$('version').onclick = guard(async () => log(`Version: ${JSON.stringify(await gl.getVersion())}`));
$('settings').onclick = guard(async () => log(`Settings: ${JSON.stringify(await gl.getSettings())}`));
$('battery').onclick = guard(async () => log(`Battery: ${await gl.getBattery()}%`));
$('fonts').onclick = guard(async () => log(`Fonts: ${JSON.stringify(await gl.listFonts())}`));
