#!/usr/bin/env node
/* Herhangi bir resmi (PNG/JPG/BMP/GIF/TIFF) uygulamanın istediği biçim ve boyuta çevirir.
 *
 *   npm run asset -- logo ./benim-logom.jpg      -> logo + uygulama ikonu (.ico) hepsi
 *   npm run asset -- icon ./resim.png            -> sadece build/icon.ico
 *   npm run asset -- star ./yildiz.png           -> yıldız ikonu
 *   npm run asset -- block:grass ./cim.jpg       -> blocks/grass.png (64x64)
 *   npm run asset -- ui:nav-home ./ev.png        -> arayüz ikonu (ui/nav-home.png, 48x48)
 *   npm run icons                                -> değiştirilebilir tüm ikon anahtarları
 */
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const root = path.join(__dirname, '..');
const assets = path.join(root, 'src', 'renderer', 'assets');
const [, , target, input] = process.argv;

function iconKeys() {
  const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'icons.js'), 'utf8');
  const block = /ICON_FALLBACK\s*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!block) return [];
  return [...block[1].matchAll(/'([^']+)'\s*:/g)].map(match => match[1]);
}

function usage(message) {
  if (message) console.error('\nHata: ' + message);
  console.error(`
Kullanım: npm run asset -- <hedef> <resim-yolu>
  hedefler: logo | icon | star | block:<ad> | ui:<anahtar>   (ör. ui:nav-home)
  npm run icons  ->  ui:<anahtar> olarak kullanılabilecek tüm isimler
`);
  process.exit(1);
}

async function writePng(image, size, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await image.clone().cover(size, size).writeAsync(out);
  console.log('yazıldı:', path.relative(root, out));
}

async function writeIco(image, out) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) pngs.push(await image.clone().cover(size, size).getBufferAsync(Jimp.MIME_PNG));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(pngs[i].length, 8); entry.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return entry;
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.concat([header, ...entries, ...pngs]));
  console.log('yazıldı:', path.relative(root, out));
}

(async () => {
  if (target === 'list') {
    const keys = iconKeys();
    const uiDir = path.join(assets, 'ui');
    console.log(`\nDeğiştirilebilir arayüz ikonları (${keys.length} adet)\n`);
    for (const key of keys) {
      const has = fs.existsSync(path.join(uiDir, `${key}.png`));
      console.log(`  ${has ? '✓' : '·'} ${key.padEnd(16)} npm run asset -- ui:${key} ./resim.png`);
    }
    console.log(`
Fotoğrafı iki yerden birine koyabilirsin:
  1) ${path.join(uiDir, '<anahtar>.png')}  (kaynak kodu — derleme gerekir)
  2) Ayarlar → Özel görseller → ui/<anahtar>.png  (derleme gerekmez, önerilen)
`);
    return;
  }
  if (!target || !input) usage();
  if (!fs.existsSync(input)) usage(`Dosya bulunamadı: ${input}`);
  let image;
  try { image = await Jimp.read(input); }
  catch { usage('Bu resim okunamadı. PNG veya JPG olarak kaydedip tekrar dene (WEBP desteklenmez).'); }

  if (target === 'logo') {
    await writePng(image, 128, path.join(assets, 'logo-128.png'));
    await writePng(image, 256, path.join(assets, 'logo-256.png'));
    await writePng(image, 1024, path.join(root, 'build', 'icon-source.png'));
    await writeIco(image, path.join(root, 'build', 'icon.ico'));
  } else if (target === 'icon') {
    await writePng(image, 1024, path.join(root, 'build', 'icon-source.png'));
    await writeIco(image, path.join(root, 'build', 'icon.ico'));
  } else if (target === 'star') {
    await writePng(image, 32, path.join(assets, 'star-32.png'));
    await writePng(image, 64, path.join(assets, 'star-64.png'));
  } else if (target.startsWith('block:')) {
    const name = target.slice(6).replace(/[^\w-]/g, '');
    if (!name) usage('Blok adı boş.');
    await writePng(image, 64, path.join(assets, 'blocks', `${name}.png`));
  } else if (target.startsWith('ui:')) {
    const name = target.slice(3).replace(/[^\w-]/g, '');
    if (!name) usage('İkon anahtarı boş.');
    if (!iconKeys().includes(name)) usage(`Bilinmeyen ikon anahtarı: ${name}\n\nnpm run icons ile tüm anahtarları görebilirsin.`);
    await writePng(image, 48, path.join(assets, 'ui', `${name}.png`));
  } else usage(`Bilinmeyen hedef: ${target}`);
  console.log('Tamam. Uygulamayı yeniden başlat.');
})().catch(error => usage(error.message));
