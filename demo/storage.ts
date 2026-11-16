import type { ImageFormat, ImageInfo, StreamFormat } from '@pranen/activelook';
import { $, setupDemo } from './shared';

const buttons = [
  'cfgOpen', 'cfgList', 'cfgFree', 'cfgDelete', 'imgSave', 'imgShow', 'imgStream', 'gSave', 'gValue',
  'lSave', 'lShow', 'pSave', 'pShow', 'list', 'clear',
  'bCfg', 'bOpen', 'bBack', 'bPrev', 'bNext', 'bFont', 'bLayouts',
];
const { gl, log, guard } = setupDemo({
  controls: buttons,
  // Not awaited: listing configurations can take a while on a full memory.
  onConnect: () => { fillConfigs().catch(e => log(`Could not list configurations: ${(e as Error).message}`)); },
});

const value = (id: string) => $<HTMLInputElement>(id).value;
const num = (id: string) => parseInt(value(id), 10);

// ── 1. Configuration ────────────────────────────────────────────────────
$('cfgOpen').onclick = guard(async () => {
  await gl.configs.write(value('cfgName'), { password: num('cfgPass') });
  log(`Configuration "${value('cfgName')}" open for writing.`);
});
$('cfgList').onclick = guard(async () => {
  for (const c of await gl.configs.list()) {
    log(`  ${c.name}  v${c.version}  size ${c.size}${c.isSystem ? '  (system)' : ''}  used #${c.usageCount}  installed #${c.installCount}`);
    const info = await gl.configs.read(c.name);
    log(`     ${info.images} images, ${info.layouts} layouts, ${info.fonts} fonts, ${info.pages} pages, ${info.gauges} gauges`);
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
  const format = value('streamFormat') as StreamFormat;
  await gl.draw(async g => {
    void g.grey(15);
    await g.images.stream(bitmap(), x, y, { format });
  });
  log(`Image streamed (${format}, not stored).`);
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

// ── 6. Browse a configuration ───────────────────────────────────────────
let systemConfig = 'ALooK';
let images: ImageInfo[] = [];
let imageIndex = -1;
let fontIndex = -1;

async function fillConfigs(): Promise<void> {
  const select = $<HTMLSelectElement>('bCfg');
  const configs = await gl.configs.list();
  systemConfig = configs.find(c => c.isSystem)?.name ?? systemConfig;
  select.innerHTML = '';
  for (const c of configs) select.add(new Option(c.isSystem ? `${c.name} (system)` : c.name, c.name));
  select.value = configs.find(c => !c.isSystem)?.name ?? systemConfig;
}

/** Smallest font of the selected configuration, for labels. */
const labelFont = (): number | undefined =>
  gl.fonts.installed.reduce<{ id: number; height: number } | undefined>((a, f) => (!a || f.height < a.height ? f : a), undefined)?.id;

$('bOpen').onclick = guard(async () => {
  const name = value('bCfg');
  const info = await gl.configs.read(name);
  await gl.configs.select(name); // also reads the fonts of this configuration
  images = (await gl.images.list()).sort((a, b) => a.id - b.id);
  imageIndex = -1;
  fontIndex = -1;
  log(`"${name}" selected: ${images.length} images listed (configuration reports ${info.images}), ` +
    `${info.layouts} layouts, ${info.pages} pages, ${info.gauges} gauges.`);
  log(`  Fonts: ${gl.fonts.installed.map(f => `${f.id} (${f.height} px)`).join(', ') || 'none'}`);
  if (images.length) log(`  Images: ${images.map(i => `${i.id}:${i.width}×${i.height}`).join('  ')}`);
  $('bInfo').textContent = `"${name}" active – use the image and font buttons.`;
});

async function showImage(step: number): Promise<void> {
  if (!images.length) { log('Select a configuration first.'); return; }
  imageIndex = (imageIndex + step + images.length) % images.length;
  const img = images[imageIndex]!;
  const sa = gl.safeArea;
  const font = labelFont();
  const top = font === undefined ? 0 : gl.fontHeight(font) + 6;
  const x = sa.x + Math.max(0, Math.round((sa.width - img.width) / 2));
  const y = sa.y + top + Math.max(0, Math.round((sa.height - top - img.height) / 2));
  const label = `#${img.id}  ${img.width}x${img.height}  (${imageIndex + 1}/${images.length})`;
  await gl.draw(async g => {
    if (font !== undefined) await g.text(label, sa.x + 4, sa.y + 2, { font });
    await g.images.display(img.id, x, y);
  });
  $('bInfo').textContent = `Image ${label}`;
}
$('bPrev').onclick = guard(() => showImage(-1));
$('bNext').onclick = guard(() => showImage(1));

$('bFont').onclick = guard(async () => {
  const fonts = [...gl.fonts.installed].sort((a, b) => a.id - b.id);
  if (!fonts.length) { log('No fonts known – select a configuration first.'); return; }
  fontIndex = (fontIndex + 1) % fonts.length;
  const f = fonts[fontIndex]!;
  const sa = gl.safeArea;
  const small = labelFont() ?? f.id;
  await gl.draw(async g => {
    await g.text(`Font ${f.id}, ${f.height} px`, sa.x + 4, sa.y + 2, { font: small });
    await g.text('12:34', sa.x + 4, sa.y + gl.fontHeight(small) + 10, { font: f.id });
    // Some fonts only contain digits: letters then simply stay empty.
    if (f.height <= 64) await g.text('Abc xyz', sa.x + 4, sa.y + gl.fontHeight(small) + f.height + 16, { font: f.id });
  });
  $('bInfo').textContent = `Font ${f.id} (${f.height} px), ${fontIndex + 1}/${fonts.length}`;
});

$('bLayouts').onclick = guard(async () => {
  const pages = (await gl.pages.list()).sort((a, b) => a - b);
  const layouts = (await gl.layouts.list()).sort((a, b) => a - b);
  log(`${pages.length} pages, ${layouts.length} layouts.`);
  for (const id of pages) log(`  page ${id}: ${JSON.stringify(await gl.pages.get(id))}`);
  const shown = layouts.slice(0, 20);
  for (const id of shown) log(`  layout ${id}: ${JSON.stringify(await gl.layouts.get(id))}`);
  if (layouts.length > shown.length) log(`  … ${layouts.length - shown.length} more layouts not shown.`);
});

$('bBack').onclick = guard(async () => {
  await gl.configs.select(systemConfig);
  images = [];
  await gl.clear();
  $('bInfo').textContent = '';
  log(`System configuration "${systemConfig}" selected again.`);
});
