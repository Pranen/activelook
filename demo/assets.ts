import {
  ALOOK_ANIMATIONS,
  ALOOK_IMAGES,
  ALOOK_LAYOUTS,
  ALOOK_ZONES,
  padValue,
  type AlookAnimation,
  type AlookImage,
  type AlookLayout,
  type AlookZone,
} from '@pranen/activelook';
import { $, setupDemo } from './shared';

const { gl, log, guard } = setupDemo({ controls: ['use', 'showImage', 'showLayout', 'play', 'stop', 'clear'] });
const RAW = 'https://raw.githubusercontent.com/ActiveLook/Activelook-Visual-Assets/main';

function fill(select: string, names: string[], label: (name: string) => string) {
  const el = $<HTMLSelectElement>(select);
  for (const name of names) el.add(new Option(label(name), name));
}

fill('image', Object.keys(ALOOK_IMAGES), n => `${ALOOK_IMAGES[n as AlookImage].id} · ${n}`);
fill('layout', Object.keys(ALOOK_LAYOUTS), n => {
  const l = ALOOK_LAYOUTS[n as AlookLayout];
  return `${l.id} · ${n}${l.useText ? '' : ' (no text)'}`;
});
fill('anim', Object.keys(ALOOK_ANIMATIONS), n => `${ALOOK_ANIMATIONS[n as AlookAnimation].id} · ${n}`);
fill('zone', Object.keys(ALOOK_ZONES), n => `${n} (${ALOOK_ZONES[n as AlookZone].type})`);

// Previews come straight from the Visual Assets repository.
const imagePreview = () => {
  const name = $<HTMLSelectElement>('image').value as AlookImage;
  $<HTMLImageElement>('imagePreview').src = `${RAW}/images/${ALOOK_IMAGES[name].id}_${name}.png`;
};
const animFile = (name: AlookAnimation) => {
  const a = ALOOK_ANIMATIONS[name];
  const pos = a.x || a.y ? `_x_${a.x}_y_${a.y}` : '';
  return `${RAW}/anim/${a.id}_${name}${pos}${a.loop ? '_loop' : ''}.gif`;
};
const animPreview = () => {
  $<HTMLImageElement>('animPreview').src = animFile($<HTMLSelectElement>('anim').value as AlookAnimation);
};
$('image').onchange = imagePreview;
$('anim').onchange = animPreview;
imagePreview();
animPreview();

$('use').onclick = guard(async () => {
  await gl.assets.use();
  log('ALooK configuration selected.');
});

$('showImage').onclick = guard(async () => {
  const name = $<HTMLSelectElement>('image').value as AlookImage;
  const { x, y } = gl.safeArea;
  await gl.draw(g => g.assets.showImage(name, x + 20, y + 20));
  log(`Image ${name} shown.`);
});

$('showLayout').onclick = guard(async () => {
  const name = $<HTMLSelectElement>('layout').value as AlookLayout;
  const raw = $<HTMLInputElement>('layoutText').value;
  const text = $<HTMLInputElement>('pad').checked ? padValue(raw) : raw;
  const zone = $<HTMLSelectElement>('zone').value as AlookZone | '';
  await gl.draw(g => (zone ? g.assets.showLayoutInZone(name, zone, text) : g.assets.showLayout(name, text)));
  log(`Layout ${name} shown with "${text}"${zone ? ` in zone ${zone}` : ''}.`);
});

$('play').onclick = guard(async () => {
  const name = $<HTMLSelectElement>('anim').value as AlookAnimation;
  await gl.clear();
  await gl.assets.playAnimation(name);
  log(`Animation ${name} playing.`);
});
$('stop').onclick = guard(async () => { await gl.animations.clearAll(); log('Animations stopped.'); });
$('clear').onclick = guard(async () => { await gl.clear(); log('✓ Cleared.'); });
