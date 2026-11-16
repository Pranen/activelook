import type { ImageFormat } from '@pranen/activelook';
import { $, setupDemo } from './shared';

const buttons = ['cfgOpen', 'cfgList', 'cfgFree', 'cfgDelete', 'imgSave', 'imgShow', 'imgStream', 'gSave', 'gValue', 'lSave', 'lShow', 'pSave', 'pShow', 'list', 'clear'];
const { gl, log, guard } = setupDemo({ controls: buttons });

const value = (id: string) => $<HTMLInputElement>(id).value;
const num = (id: string) => parseInt(value(id), 10);

// ── 1. Configuration ────────────────────────────────────────────────────
$('cfgOpen').onclick = guard(async () => {
  await gl.configs.write(value('cfgName'), { password: num('cfgPass') });
  log(`Configuration "${value('cfgName')}" open for writing.`);
});
$('cfgList').onclick = guard(async () => {
  for (const c of await gl.configs.list()) {
    log(`  ${c.name}  v${c.version}  size ${c.size}${c.isSystem ? '  (system)' : ''}`);
  }
});
$('cfgFree').onclick = guard(async () => {
  const { total, free } = await gl.configs.freeSpace();
  log(`Free: ${Math.round(free / 1024)} of ${Math.round(total / 1024)} kB`);
});
$('cfgDelete').onclick = guard(async () => {
  await gl.configs.delete(value('cfgName'));
  log(`Configuration "${value('cfgName')}" deleted.`);
});

// ── 2. Image ────────────────────────────────────────────────────────────
const canvas = $<HTMLCanvasElement>('img');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
(function drawTestImage() {
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 62, 62);
  // arrow into the top-left corner
  ctx.fillStyle = '#ff0000';
  ctx.beginPath();
  ctx.moveTo(4, 4); ctx.lineTo(26, 4); ctx.lineTo(4, 26);
  ctx.fill();
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(10, 10); ctx.lineTo(44, 44);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('TL', 36, 24);
})();
const bitmap = () => ctx.getImageData(0, 0, canvas.width, canvas.height);
const imagePos = () => ({ x: gl.safeArea.x + 20, y: gl.safeArea.y + 20 });

$('imgSave').onclick = guard(async () => {
  const format = value('imgFormat') as ImageFormat;
  await gl.images.save(1, bitmap(), { format });
  log(`Image 1 saved (${format}).`);
});
$('imgShow').onclick = guard(async () => {
  const { x, y } = imagePos();
  await gl.draw(async g => { await g.images.display(1, x, y); });
  log(`Image 1 displayed at (${x}, ${y}).`);
});
$('imgStream').onclick = guard(async () => {
  const { x, y } = imagePos();
  await gl.draw(async g => {
    void g.grey(15);
    await g.images.stream(bitmap(), x, y);
  });
  log('Image streamed (1 bit, not stored).');
});

// ── 3. Gauge ────────────────────────────────────────────────────────────
const gaugeCentre = () => {
  const sa = gl.safeArea;
  return { x: sa.x + Math.round(sa.width / 2), y: sa.y + Math.round(sa.height / 2) };
};
$('gSave').onclick = guard(async () => {
  const { x, y } = gaugeCentre();
  await gl.gauges.save(1, { x, y, radius: 80, innerRadius: 60, start: num('gStart'), end: num('gEnd'), clockwise: true });
  log(`Gauge 1 saved: centre (${x}, ${y}), portions ${num('gStart')}–${num('gEnd')}.`);
});
let gaugeBusy = false;
$('gValue').oninput = async () => {
  $('gValueText').textContent = `${value('gValue')}%`;
  if (gaugeBusy || !gl.connected) return;
  gaugeBusy = true;
  try { await gl.draw(g => g.gauges.display(1, num('gValue'))); }
  catch (e) { log(`Error: ${(e as Error).message}`); }
  finally { gaugeBusy = false; }
};

// ── 4. Layout and page ──────────────────────────────────────────────────
const BOX = { width: 200, height: 70 };
$('lSave').onclick = guard(async () => {
  const sa = gl.safeArea;
  await gl.layouts.save(10, {
    x: sa.x + 20,
    y: sa.y + 20,
    ...BOX,
    font: 2,
    foreColor: 15,
    text: { x: 10, y: 28 },
    commands: [
      { type: 'rect', x0: 0, y0: 0, x1: BOX.width - 1, y1: BOX.height - 1 },
      { type: 'font', id: 0 },
      { type: 'text', x: 10, y: 3, text: 'TEMP' },
    ],
  });
  log('Layout 10 saved.');
});
$('lShow').onclick = guard(async () => {
  await gl.draw(g => g.layouts.display(10, value('lText')));
  log(`Layout 10 displayed with "${value('lText')}".`);
});
$('pSave').onclick = guard(async () => {
  const sa = gl.safeArea;
  await gl.pages.save(1, [
    { layout: 10, x: sa.x + 20, y: sa.y + 10 },
    { layout: 10, x: sa.x + 20, y: sa.y + 100 },
  ]);
  log('Page 1 saved.');
});
$('pShow').onclick = guard(async () => {
  await gl.draw(g => g.pages.display(1, [value('lText'), new Date().toLocaleTimeString('de-CH')]));
  log('Page 1 displayed.');
});

// ── 5. Lists ────────────────────────────────────────────────────────────
$('list').onclick = guard(async () => {
  log(`Images:  ${JSON.stringify(await gl.images.list())}`);
  log(`Layouts: ${JSON.stringify(await gl.layouts.list())}`);
  log(`Gauges:  ${JSON.stringify(await gl.gauges.list())}`);
  log(`Pages:   ${JSON.stringify(await gl.pages.list())}`);
});
$('clear').onclick = guard(async () => { await gl.clear(); log('✓ Cleared.'); });
