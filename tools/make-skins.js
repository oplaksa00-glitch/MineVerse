/* MineVerse hazır skin üretici.
   Uygulamayla gelen skinleri (src/renderer/assets/skins) prosedürel olarak üretir.
   Çalıştır: node tools/make-skins.js */
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

const OUT_DIR = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'skins');

/* 64x64 Minecraft skin yerleşimi: [x, y, w, h] */
const R = {
  headTop: [8, 0, 8, 8], headBottom: [16, 0, 8, 8], headRight: [0, 8, 8, 8],
  headFront: [8, 8, 8, 8], headLeft: [16, 8, 8, 8], headBack: [24, 8, 8, 8],
  torsoTop: [20, 16, 8, 4], torsoBottom: [28, 16, 8, 4], torsoRight: [16, 20, 4, 12],
  torsoFront: [20, 20, 8, 12], torsoLeft: [28, 20, 4, 12], torsoBack: [32, 20, 8, 12],
  legRTop: [4, 16, 4, 4], legRFront: [4, 20, 4, 12], legROuter: [0, 20, 4, 12],
  legRInner: [8, 20, 4, 12], legRBack: [12, 20, 4, 12],
  armRTop: [36, 48, 4, 4], armRFront: [36, 52, 4, 12], armROuter: [32, 52, 4, 12],
  armRInner: [40, 52, 4, 12], armRBack: [44, 48, 4, 4],
  armLTop: [44, 16, 4, 4], armLFront: [44, 20, 4, 12], armLOuter: [40, 20, 4, 12],
  armLInner: [48, 20, 4, 12], armLBack: [52, 16, 4, 4],
  legLTop: [20, 48, 4, 4], legLFront: [20, 52, 4, 12], legLOuter: [16, 52, 4, 12],
  legLInner: [24, 52, 4, 12], legLBack: [28, 48, 4, 4],
};

function hex(c) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(c));
  if (!m) return 0xff0000ff;
  const rgb = parseInt(m[1], 16);
  const a = m[2] ? parseInt(m[2], 16) : 255;
  return Jimp.rgbaToInt((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, a);
}
function fill(img, region, color) {
  const [x, y, w, h] = region;
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) img.setPixelColor(hex(color), x + dx, y + dy);
}
function pset(img, x, y, color) { img.setPixelColor(hex(color), x, y); }

/* Temel insan silüeti: ten rengi kafa, tişört, pantolon, ayakkabı; saç + yüz. */
function buildBase(t) {
  return new Promise((resolve, reject) => new Jimp(64, 64, 0x00000000, (err, img) => {
    if (err) return reject(err);
    const skin = t.skin, hair = t.hair, shirt = t.shirt, sleeve = t.sleeve || t.shirt,
      pants = t.pants, shoes = t.shoes || t.pants;
    for (const key of ['headTop', 'headBottom', 'headRight', 'headFront', 'headLeft', 'headBack']) fill(img, R[key], skin);
    /* saç: kafanın üst sıraları + yanlar */
    const [fx, fy] = R.headFront;
    for (let x = 0; x < 8; x++) { pset(img, fx + x, fy, hair); pset(img, fx + x, fy + 1, hair); }
    for (const key of ['headTop', 'headBack']) fill(img, R[key], hair);
    fill(img, [R.headRight[0], R.headRight[1], 8, 2], hair);
    fill(img, [R.headLeft[0], R.headLeft[1], 8, 2], hair);
    /* yüz: gözler + ağız */
    pset(img, fx + 2, fy + 3, '#ffffff'); pset(img, fx + 3, fy + 3, '#ffffff');
    pset(img, fx + 5, fy + 3, '#ffffff'); pset(img, fx + 6, fy + 3, '#ffffff');
    pset(img, fx + 2, fy + 4, t.eye || '#3a5fd9'); pset(img, fx + 5, fy + 4, t.eye || '#3a5fd9');
    pset(img, fx + 3, fy + 6, '#c98a6b'); pset(img, fx + 4, fy + 6, '#c98a6b');
    /* gövde */
    for (const key of ['torsoTop', 'torsoRight', 'torsoFront', 'torsoLeft', 'torsoBack']) fill(img, R[key], shirt);
    fill(img, R.torsoBottom, pants);
    if (t.belt) fill(img, [R.torsoFront[0], R.torsoFront[1] + 10, 8, 2], t.belt);
    /* kollar */
    for (const key of ['armRTop', 'armRFront', 'armROuter', 'armRInner', 'armRBack']) fill(img, R[key], sleeve);
    fill(img, [R.armRFront[0], R.armRFront[1] + 10, 4, 2], skin);
    for (const key of ['armLTop', 'armLFront', 'armLOuter', 'armLInner', 'armLBack']) fill(img, R[key], sleeve);
    fill(img, [R.armLFront[0], R.armLFront[1] + 10, 4, 2], skin);
    /* bacaklar */
    for (const key of ['legRTop', 'legRFront', 'legROuter', 'legRInner', 'legRBack']) fill(img, R[key], pants);
    fill(img, [R.legRFront[0], R.legRFront[1] + 10, 4, 2], shoes);
    fill(img, [R.legROuter[0], R.legROuter[1] + 10, 4, 2], shoes);
    for (const key of ['legLTop', 'legLFront', 'legLOuter', 'legLInner', 'legLBack']) fill(img, R[key], pants);
    fill(img, [R.legLFront[0], R.legLFront[1] + 10, 4, 2], shoes);
    fill(img, [R.legLOuter[0], R.legLOuter[1] + 10, 4, 2], shoes);
    if (t.pattern === 'stripes') {
      for (let y = 2; y < 12; y += 3) fill(img, [R.torsoFront[0], R.torsoFront[1] + y, 8, 1], t.stripe || '#ffffff22');
    }
    if (t.pattern === 'vest') {
      fill(img, [R.torsoFront[0], R.torsoFront[1], 3, 12], t.vest || t.belt || '#333333');
      fill(img, [R.torsoFront[0] + 5, R.torsoFront[1], 3, 12], t.vest || t.belt || '#333333');
    }
    resolve(img);
  }));
}

const THEMES = [
  { file: 'classic-steve.png', name: 'Klasik Steve', skin: '#c98e6b', hair: '#4a2f1b', shirt: '#0fa7a3', sleeve: '#0fa7a3', pants: '#3d3ddb', shoes: '#6b6b6b', eye: '#3a5fd9' },
  { file: 'madenci.png', name: 'Madenci', skin: '#d9a077', hair: '#2b2119', shirt: '#e07b26', sleeve: '#c96a1d', pants: '#4a3d33', shoes: '#3a2f28', belt: '#26201a', vest: '#33302b', eye: '#4a3d2b', pattern: 'vest' },
  { file: 'sürgün.png', name: 'Sürgün', skin: '#b98a68', hair: '#1e1e24', shirt: '#3b3f4a', sleeve: '#333740', pants: '#2c2f38', shoes: '#20232b', belt: '#191b21', eye: '#7fd4c1' },
  { file: 'kırmız-mühendis.png', name: 'Kırmızı Mühendis', skin: '#cf9a72', hair: '#5c3a1e', shirt: '#a83232', sleeve: '#8f2b2b', pants: '#33394a', shoes: '#262b38', belt: '#1d212c', eye: '#5a2f2f', pattern: 'stripes', stripe: '#ffffff' },
  { file: 'okyanus.png', name: 'Okyanus', skin: '#caa27e', hair: '#0f4c5c', shirt: '#1f9db4', sleeve: '#1b8ba0', pants: '#0e3a49', shoes: '#0a2b36', belt: '#092530', eye: '#27e0c8', pattern: 'stripes', stripe: '#a7ecf5' },
  { file: 'ender.png', name: 'Ender', skin: '#a98bb0', hair: '#17131f', shirt: '#2c2140', sleeve: '#251b36', pants: '#1d1630', shoes: '#141021', belt: '#0e0b18', eye: '#c86bf0' },
];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const theme of THEMES) {
    const img = await buildBase(theme);
    await img.writeAsync(path.join(OUT_DIR, theme.file));
    console.log('skin:', theme.file);
  }
  console.log('OK ->', OUT_DIR);
})().catch(error => { console.error(error); process.exit(1); });
