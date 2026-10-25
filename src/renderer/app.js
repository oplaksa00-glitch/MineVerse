const api = window.mineverse;

let state, page = 'home', currentProfileId = null;
let source = 'All', filters = { gameVersion: '', loader: '', category: '' };
let discoverType = 'mod';
const DISCOVER_TYPES = [
  { id: 'mod', label: 'Modlar', icon: '◈' },
  { id: 'modpack', label: 'Mod paketleri', icon: '📦' },
  { id: 'shader', label: 'Shaderlar', icon: '🌈' },
  { id: 'resourcepack', label: 'Kaynak paketleri', icon: '🎨' },
  { id: 'world', label: 'Dünyalar', icon: '🌍' }
];
const COLLECTION_CHIPS = [['', 'Hepsi'], ['optimization', 'Performans canavarları'], ['decoration', 'Yapı & dekor'], ['adventure', 'Macera & RPG'], ['technology', 'Teknoloji'], ['magic', 'Sihir'], ['worldgen', 'Yeni dünyalar']];
let searchResults = [], searchMode = 'browse', searchQuery = '', resultsLoading = false, browseLoadedFor = '';
let resultsOffset = 0, hasMore = true, loadingMore = false, smartDetected = null;
let mcVersions = { releases: [], snapshots: [], latest: null };
let storageInfo = null;
let librarySuggestions = null, librarySuggestionsFor = '', librarySuggestionsLoading = false;
const loaderOptions = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];
const BLOCK_ICONS = ['grass','stone','dirt','oak','diamond','gold','iron','coal','sand','water','lava','obsidian','emerald','bedrock','redstone','copper','lapis','cobblestone','ice','snow','clay','netherrack','quartz','prismarine','endstone','tnt','hay'];
const BLOCK_LABELS_TR = { grass:'Çim', stone:'Taş', dirt:'Toprak', oak:'Meşe odunu', diamond:'Elmas', gold:'Altın', iron:'Demir', coal:'Kömür', sand:'Kum', water:'Su', lava:'Lav', obsidian:'Obsidyen', emerald:'Zümrüt', bedrock:'Bedrock', redstone:'Kızıltaş', copper:'Bakır', lapis:'Lapis', cobblestone:'Kırıktaş', ice:'Buz', snow:'Kar', clay:'Kil', netherrack:'Netherrack', quartz:'Kuvars', prismarine:'Prizmarin', endstone:'End taşı', tnt:'TNT', hay:'Saman' };
const FUN_ICONS = ['😂','🔥','💀','👑','🚀','⚡','🎉','🐸','🍕','🎯','🌟','😎','🎮','🦄','💎'];
/* İzometrik küp önizlemeleri: blok dokusunun üst/yan yüzlerinden 3B görünümlü
   ikon üretir; "iso:<blok>" değeri profil ikonlarında da kullanılabilir. */
const isoIconCache = new Map();
function makeIsoBlockCanvas(img) {
  const S = 16, W = 2 * S, H = 3 * S;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const A = [S, 0], D = [0, S / 2];
  const face = (p0, pu, pv, dark) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p0[0] + pu[0], p0[1] + pu[1]);
    ctx.lineTo(p0[0] + pu[0] + pv[0], p0[1] + pu[1] + pv[1]);
    ctx.lineTo(p0[0] + pv[0], p0[1] + pv[1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(pu[0] / S, pu[1] / S, pv[0] / S, pv[1] / S, p0[0], p0[1]);
    ctx.drawImage(img, 0, 0, 8, 8, 0, 0, S, S);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dark) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  };
  face(D, [S, -S / 2], [0, S], 0.28);        // sol yüz
  face(A, [S, S / 2], [0, S], 0.12);         // sağ yüz
  face(D, [S, S / 2], [S, -S / 2], 0);       // üst yüz
  return canvas;
}
async function ensureIsoIcons() {
  const missing = BLOCK_ICONS.filter(b => !isoIconCache.has(b));
  if (!missing.length) return;
  for (const name of missing) {
    try {
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = `assets/blocks/${name}.png`; });
      isoIconCache.set(name, makeIsoBlockCanvas(img).toDataURL('image/png'));
    } catch {}
  }
  render();
}
function toFileUrl(p) { return 'file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, ''); }
function renderProfileIcon(icon, cls = '') {
  if (!icon) icon = { type: 'block', value: 'grass' };
  if (icon.type === 'custom' && icon.value) return `<img class="profile-icon-img ${cls}" src="${toFileUrl(icon.value)}" alt="">`;
  if (icon.type === 'image' && icon.value) return `<img class="profile-icon-img ${cls}" src="${String(icon.value).startsWith('assets/') ? icon.value : toFileUrl(icon.value)}" alt="">`;
  if (icon.type === 'fun' && icon.value) return `<div class="profile-icon-fun ${cls}">${icon.value}</div>`;
  if (icon.type === 'block' && String(icon.value).startsWith('iso:')) {
    const base = String(icon.value).slice(4);
    const iso = isoIconCache.get(base);
    if (iso) return `<img class="profile-icon-img profile-icon-iso ${cls}" src="${iso}" alt="">`;
    return `<img class="profile-icon-img ${cls}" src="assets/blocks/${BLOCK_ICONS.includes(base) ? base : 'grass'}.png" alt="">`;
  }
  const block = BLOCK_ICONS.includes(icon.value) ? icon.value : 'grass';
  return `<img class="profile-icon-img ${cls}" src="assets/blocks/${block}.png" alt="">`;
}
let previewData = null;
let pickerData = null, pickerLoader = '', pickerVersion = '', pickerBusy = '';
let updateResults = null, updateChecking = false;
let aiQuery = '', aiExplain = '';
let librarySearch = '', librarySort = 'name', selectedMods = new Set();
let themeName = 'nebula', accentColor = '#f0b429';
let backgroundSaveTimer = null;
let wallpapersData = null, wallpapersLoading = false, wallpaperBusy = '';
const launchState = { busy: false, running: false, progress: null };

const main = document.querySelector('#main');
const q = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const number = value => new Intl.NumberFormat('tr-TR',{notation:'compact',maximumFractionDigits:1}).format(value || 0);
const dateTr = value => value ? new Date(value).toLocaleDateString('tr-TR') : '';
const selectedProfile = () => state.profiles.find(profile => profile.id === currentProfileId) || state.profiles[0];

// ---------- Theme engine ----------
const ACCENTS = [
  { id: 'bal', label: 'Bal', hex: '#f0b429' },
  { id: 'lagun', label: 'Lagün', hex: '#3ddbc4' },
  { id: 'nar', label: 'Nar', hex: '#ff6b57' },
  { id: 'orman', label: 'Orman', hex: '#3fcf8e' },
  { id: 'gece', label: 'Gece Mavisi', hex: '#5aa9ff' },
  { id: 'safak', label: 'Şafak', hex: '#ff7a8e' },
  { id: 'eflatun', label: 'Eflatun', hex: '#a98bff' },
  { id: 'zümrüt', label: 'Zümrüt', hex: '#2ee6a8' },
  { id: 'kehribar', label: 'Kehribar', hex: '#ff9f45' },
  { id: 'gul', label: 'Gül', hex: '#e86aa8' },
  { id: 'titanyum', label: 'Titanyum', hex: '#c9d6e3' },
  { id: 'geceormani', label: 'Gece Ormanı', hex: '#1f9e6f' },
];
/* Hazır profil görselleri: uygulamayla gelen Minecraft temalı kareler (assets/... göreli yolu renderProfileIcon tarafından tanınır). */
const MC_PROFILE_IMAGES = [
  { value: 'assets/wallpapers/nebula-vale.jpg', label: 'Nebula Vadi' },
  { value: 'assets/wallpapers/nether-ember.jpg', label: 'Nether Koru' },
  { value: 'assets/wallpapers/end-void.jpg', label: 'End Uçurumu' },
  { value: 'assets/wallpapers/dawn-taiga.jpg', label: 'Şafak Tayga' },
  { value: 'assets/logo-128.png', label: 'MineVerse' },
];
function shade(hex, percent) {
  try {
    const num = parseInt(String(hex).replace('#', ''), 16);
    let r = (num >> 16) + Math.round(255 * percent / 100), g = ((num >> 8) & 0xff) + Math.round(255 * percent / 100), b = (num & 0xff) + Math.round(255 * percent / 100);
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
  } catch { return hex; }
}
/* Vurgu renginin üstünde okunacak yazı rengi (açıkt koyu, koyuysa beyaz). */
function contrastOn(hex) {
  const num = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(num)) return '#08110f';
  const [r, g, b] = [num >> 16 & 255, num >> 8 & 255, num & 255];
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#111005' : '#ffffff';
}
function applyTheme(name, accent) {
  document.documentElement.setAttribute('data-theme', name || 'nebula');
  const safeAccent = /^#[0-9a-fA-F]{6}$/.test(accent || '') ? accent : '#f0b429';
  document.documentElement.style.setProperty('--violet', safeAccent);
  document.documentElement.style.setProperty('--violet-dark', shade(safeAccent, -20));
  document.documentElement.style.setProperty('--violet-light', shade(safeAccent, 28));
  document.documentElement.style.setProperty('--violet-contrast', contrastOn(safeAccent));
}
function applyBackground(settings) {
  const b = settings?.background || {};
  const image = document.getElementById('bg-image');
  const dim = document.getElementById('bg-dim');
  if (!image || !dim) return;
  if (!b.file || !assetInfo.dir) { image.style.backgroundImage = 'none'; dim.style.opacity = '0'; return; }
  const url = toFileUrl(`${assetInfo.dir}/${b.file}`);
  const tiled = b.size === 'tekrar';
  image.style.backgroundImage = `url("${url}")`;
  image.style.backgroundSize = tiled ? 'auto' : (b.size === 'contain' ? 'contain' : 'cover');
  image.style.backgroundRepeat = tiled ? 'repeat' : 'no-repeat';
  image.style.filter = `blur(${Math.max(0, Math.min(24, +b.blur || 0))}px)`;
  image.style.opacity = String(Math.max(0.2, Math.min(1, b.strength ?? 1)));
  dim.style.opacity = String(Math.max(0, Math.min(0.92, b.dim ?? 0.5)));
}
async function setTheme(name, accent) {
  themeName = name; accentColor = accent;
  applyTheme(themeName, accentColor);
  render();
  try { state = await api.saveSettings({ theme: themeName, accent: accentColor }); } catch {}
  applyBackground(state?.settings);
}
async function saveBackground(patch) {
  const next = { ...(state.settings.background || {}), ...patch };
  try { state = await api.saveSettings({ background: next }); } catch {}
  applyBackground(state.settings);
}
function backgroundCard() {
  const b = state.settings.background || {};
  const has = !!b.file && !!assetInfo.dir;
  const bgUrl = has ? toFileUrl(assetInfo.dir + '/' + b.file) : '';
  const preview = has
    ? `<div class="bg-preview" style="background-image:url('${bgUrl}')"></div>`
    : `<div class="bg-preview empty">${ic('card-assets')}<span>arka plan yok</span></div>`;
  const range = (id, label, value, min, max, unit) => `<div><label class="form-label">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" value="${value}" data-bg-range="${id}"><span class="mono tiny">${value}${unit}</span></div>`;  return `<article class="setting-card wide"><h3>${ic('card-assets')} Kendi arka plan fotoğrafın</h3><p>Bilgisayarından bir resim seç; MineVerse onu tüm sayfaların arkasına koyar. Karartma ve bulanıklık, yazıların okun kalması içindir.</p><div class="bg-row">${preview}<div class="bg-controls"><div class="modal-actions" style="justify-content:flex-start;margin-top:0;flex-wrap:wrap"><button class="btn primary" data-bg-pick>${ic('act-upload')} ${has ? 'Fotoğrafı değiştir' : 'Fotoğraf seç'}</button>${has ? `<button class="btn ghost" data-bg-clear>${ic('act-delete')} Kaldır</button>` : ''}</div><div class="form-row" style="grid-template-columns:1fr 1fr;gap:12px">${range('bg-dim-range', 'KARARTMA', Math.round((b.dim ?? 0.5) * 100), 0, 90, '%')}${range('bg-blur-range', 'BULANIKLIK', b.blur || 0, 0, 24, 'px')}${range('bg-strength-range', 'BELİRGİNLİK', Math.round((b.strength ?? 1) * 100), 20, 100, '%')}<div><label class="form-label">DÖŞEME</label><select id="bg-size" class="form-input"><option value="cover" ${(b.size || 'cover') === 'cover' ? 'selected' : ''}>Ekranı doldur</option><option value="contain" ${b.size === 'contain' ? 'selected' : ''}>Sığdır</option><option value="tekrar" ${b.size === 'tekrar' ? 'selected' : ''}>Döşe (tile)</option></select></div></div>${has ? '' : '<p class="note">İpucu: Resim, Ayarlar → Özel görseller klasöründeki <code>custom-assets/background.png</code> olarak saklanır; dilersen oradan da değiştirebilirsin.</p>'}</div></div><h3 style="margin-top:16px">${ic('card-wallpapers')} Hazır duvar kağıtları</h3><p>Uygulamayla gelen görsellerden birini tek tıkla arka plan yap.</p>${wallpapersGalleryHtml()}</article>`;
}
async function pickBackground() {
  try {
    const picked = await api.pickBackground();
    if (!picked) return;
    assetInfo = await api.getAssetOverrides();
    await saveBackground({ file: picked.file });
    render();
    toast('Arka plan güncellendi.');
  } catch (error) { toast(error.message, true); }
}
/* Hazır duvar kağıtları: uygulamayla gelen görsellerden tek tıkla arka plan. */
async function loadWallpapers(force = false) {
  if (wallpapersLoading || (!force && wallpapersData)) return;
  wallpapersLoading = true;
  try { wallpapersData = await api.listWallpapers(); } catch { wallpapersData = null; }
  wallpapersLoading = false;
  if (page === 'settings') render();
}
async function applyBuiltinWallpaper(name, button) {
  wallpaperBusy = name; render();
  try {
    const applied = await api.applyWallpaper(name);
    assetInfo = await api.getAssetOverrides();
    await saveBackground({ file: applied.file, size: 'cover' });
    wallpaperBusy = '';
    render();
    toast('Duvar kağıdı uygulandı; istersen karartmayı azaltarak rengini açabilirsin.');
  } catch (error) { wallpaperBusy = ''; toast(error.message, true); render(); }
}
function wallpapersGalleryHtml() {
  if (wallpapersLoading) return `<div class="wallpaper-row"><div class="empty" style="width:100%"><span class="loader"></span> Duvar kağıtları yükleniyor…</div></div>`;
  const list = wallpapersData?.wallpapers || [];
  if (!list.length) return '';
  const names = { 'nebula-vale': 'Nebula Vadi', 'nether-ember': 'Nether Koru', 'end-void': 'End Uçurumu', 'dawn-taiga': 'Şafak Tayga' };
  return `<div class="wallpaper-row">${list.map(name => `<button class="wallpaper-cell ${wallpaperBusy === name ? 'busy' : ''}" data-wallpaper="${esc(name)}" title="Arka plan yap"><img src="assets/wallpapers/${esc(name)}" alt="${esc(names[name] || name)}" loading="lazy"><span>${wallpaperBusy === name ? 'Uygulanıyor…' : esc(names[name] || name.replace(/\.(png|jpe?g|webp)$/i, ''))}</span></button>`).join('')}</div>`;
}
async function clearBackground() {
  try {
    await api.clearBackground();
    assetInfo = await api.getAssetOverrides();
    await saveBackground({ file: null });
    render();
    toast('Arka plan kaldırıldı.');
  } catch (error) { toast(error.message, true); }
}

// ---------- Local smart-search parser (runs on-device, no network / no LLM call) ----------
const CATEGORY_DICTIONARY = {
  performans:'optimization', optimizasyon:'optimization', fps:'optimization', hafif:'optimization',
  gölge:'shaders', golge:'shaders', shader:'shaders', shaders:'shaders', görsel:'shaders',
  dekorasyon:'decoration', süsleme:'decoration', susleme:'decoration', mobilya:'decoration',
  macera:'adventure', rpg:'adventure', keşif:'adventure',
  ekipman:'equipment', zırh:'equipment', zirh:'equipment', silah:'equipment',
  depolama:'storage', envanter:'storage', sandık:'storage',
  çiftlik:'farming', ciftlik:'farming', tarım:'farming', tarim:'farming',
  mob:'mobs', canavar:'mobs', yaratık:'mobs', yaratik:'mobs',
  kütüphane:'library', kutuphane:'library',
  teknoloji:'technology', makine:'technology', otomasyon:'technology', fabrika:'technology',
  sihir:'magic', büyü:'magic', buyu:'magic',
  harita:'worldgen', dünya:'worldgen', dunya:'worldgen', boyut:'worldgen',
  minimap:'utility', araç:'utility', arac:'utility', yardımcı:'utility'
};
const CATEGORY_LABELS_TR = { optimization:'Optimizasyon', shaders:'Gölgeler', decoration:'Dekorasyon', adventure:'Macera', equipment:'Ekipman', storage:'Depolama', farming:'Çiftçilik', mobs:'Yaratıklar', library:'Kütüphane', technology:'Teknoloji', magic:'Sihir', worldgen:'Dünya Üretimi', utility:'Araçlar' };
const LOADER_WORDS = { fabric:'Fabric', forge:'Forge', neoforge:'NeoForge', quilt:'Quilt' };

function parseSmartQuery(raw) {
  let text = ' ' + String(raw || '').toLowerCase() + ' ';
  const detected = {};
  const versionMatch = raw.match(/\b1\.\d{1,2}(?:\.\d{1,2})?\b/);
  if (versionMatch) { detected.gameVersion = versionMatch[0]; text = text.split(versionMatch[0]).join(' '); }
  for (const [word, loaderName] of Object.entries(LOADER_WORDS)) {
    if (text.includes(word)) { detected.loader = loaderName; text = text.replace(new RegExp('\\b' + word + '\\b', 'gi'), ' '); break; }
  }
  for (const [word, category] of Object.entries(CATEGORY_DICTIONARY)) {
    if (text.includes(word)) { detected.category = category; text = text.replace(new RegExp(word, 'gi'), ' '); break; }
  }
  detected.query = text.replace(/\s+/g, ' ').trim();
  return detected;
}
function categorySelectOptions(selected) {
  const unique = [...new Set(Object.values(CATEGORY_DICTIONARY))];
  return `<option value="">Tüm kategoriler</option>` + unique.map(cat => `<option value="${cat}" ${cat === selected ? 'selected' : ''}>${CATEGORY_LABELS_TR[cat] || cat}</option>`).join('');
}

function renderBody(text) {
  if (!text) return '';
  let safe = esc(text).slice(0, 4000);
  safe = safe.replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h2>$1</h2>');
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
  safe = safe.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  safe = safe.split(/\n{2,}/).map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
  return safe;
}

function toast(message, error = false) { const node = q('#toast'); node.textContent = message; node.className = `toast show${error ? ' error' : ''}`; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => node.className = 'toast', 3500); }
function pageHeader(title, description, action = '', icon = '') { return `<div class="topline"><div class="topline-main">${icon ? `<div class="page-icon">${icon}</div>` : ''}<div><div class="eyebrow">MINEVERSE // ${page.toUpperCase()}</div><h1 class="h1">${title}</h1><p class="sub">${description}</p></div></div><div class="top-actions">${action}</div></div>`; }
function profileCard(profile) { return `<article class="profile-card"><button class="card-delete" data-delete-profile="${profile.id}" title="Profili sil">${ic('act-delete')}</button><div class="profile-head">${renderProfileIcon(profile.icon, 'md')}<span class="chip">${esc(profile.loader)}</span></div><h3>${esc(profile.name)}</h3><p>${esc(profile.gameVersion)} · ${profile.mods.length} mod</p><div class="card-foot"><span>HAZIR</span><button class="open-btn" data-open-profile="${profile.id}">Aç <i>→</i></button></div></article>`; }
function statCard(value, label, badge) { return `<div class="stat"><strong>${value}</strong><span>${label}</span>${badge ? `<b class="up">${badge}</b>` : ''}</div>`; }
/* Rozetler: yalnızca yerel durumdan türetilir; hiçbir şey gönderilmez.
   Her rozet {eşik, ilerleme} taşır; eşik 1'e eşitse anlık, değilse sayılır. */
function badgeStripHtml() {
  const totalMods = state.profiles.reduce((all, p) => all + p.mods.length, 0);
  const totalProfiles = state.profiles.length;
  const packCount = state.profiles.filter(p => p.mods.some(m => m.source === 'Paket')).length;
  const acc = (state.accounts || []).length;
  const badges = [
    { icon: '🌱', name: 'İlk Adım', desc: 'İlk profilini oluştur', have: totalProfiles, need: 1 },
    { icon: '📦', name: 'Koleksiyoner', desc: '10 mod topla', have: totalMods, need: 10 },
    { icon: '👑', name: 'Mod Canavarı', desc: '50 mod topla', have: totalMods, need: 50 },
    { icon: '🗂️', name: 'Çok Yönlü', desc: '3 ayrı profil kur', have: totalProfiles, need: 3 },
    { icon: '◇', name: 'Paket Kaşifi', desc: 'İçe aktarılan paket kur', have: packCount, need: 1 },
    { icon: '🧑‍‍🧑', name: 'Sosyal', desc: 'Bir arkadaş ekle', have: (state.friends || []).length, need: 1 },
    { icon: '🛟', name: 'Tedbirli', desc: 'Otomatik yedeği aç', have: state.settings.autoBackup !== false ? 1 : 0, need: 1 },
    { icon: '🖼️', name: 'Kişisel', desc: 'Arka plan seç', have: !!(state.settings.background || {}).file ? 1 : 0, need: 1 },
    { icon: '🧍', name: 'Stil Sahibi', desc: 'Skinle profil fotoğrafı yap', have: (state.settings.account || {}).icon?.type === 'custom' ? 1 : 0, need: 1 },
    { icon: '🎨', name: 'Küp Avcısı', desc: 'İzometrik blok simgesi seç', have: String((state.settings.account || {}).icon?.value || '').startsWith('iso:') ? 1 : 0, need: 1 },
    { icon: '🪪', name: 'Sorumlu', desc: 'İkinci hesap aç', have: acc, need: 2 },
    { icon: '◉', name: 'Bağlı', desc: 'Bir launcher bağla', have: state.launchers.length, need: 1 }
  ];
  const got = badges.filter(b => b.have >= b.need).length;
  const cards = badges.map(b => {
    const done = b.have >= b.need;
    const pct = Math.min(100, Math.round(b.have / b.need * 100));
    const counter = b.need > 1 ? `<em>${Math.min(b.have, b.need)}/${b.need}</em>` : '';
    return `<div class="badge-card ${done ? '' : 'locked'}" title="${esc(b.desc)}"><i>${b.icon}</i><div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span>${counter}</div>${done ? '<s class="badge-ok">✓</s>' : `<div class="badge-bar"><i style="width:${pct}%"></i></div>`}</div>`;
  }).join('');
  return `<div class="section-head"><div><h2>${ic('card-badges')} Rozetlerin</h2><p>${got}/${badges.length} kazanıldı. Rozetler bu bilgisayardaki ilerlemenden hesaplanır.</p></div><span class="badge-total ${got === badges.length ? 'all' : ''}">${got === badges.length ? 'TAM KADRO ★' : `%${Math.round(got / badges.length * 100)} tamamlandı`}</span></div><section class="badge-strip">${cards}</section>`;
}

function home() {
  const profile = selectedProfile();
  return `${pageHeader('Kendi evrenini kur.', 'Modlarını keşfet, düzenle ve tek hamlede launchera aktar.', `<button class="btn primary" data-go="discover">◈ Mod keşfet</button>`)}<section class="hero"><div class="hero-badge"><img class="star-icon sm" src="assets/star-32.png" alt=""> v0.12.2 · 3B skin · izometrik bloklar · ilerlemeli rozetler</div><div class="eyebrow">ONE LAUNCHER. EVERY MOD.</div><h2>Mod koleksiyonun, her zamankinden daha akıllı.</h2><p>CurseForge, Modrinth ve kendi <code>.jar</code> dosyaların; sürüm ve launcher ayrıntılarını unutmadan tek yerde.</p><div class="hero-actions"><button class="btn primary" data-go="discover"><img class="star-icon sm" src="assets/star-32.png" alt=""> Hemen Keşfet</button><button class="btn ghost" data-go="launchers">Launcher bağla</button></div></section><section class="stats">${statCard(state.profiles.length,'Aktif profil','+ yeni')}${statCard(state.profiles.reduce((all,p)=>all+p.mods.length,0),'Yönetilen mod')}${statCard(state.launchers.length,'Bağlı launcher')}${statCard(mcVersions.releases.length || '…','Bilinen MC sürümü','✓ canlı')}</section>${badgeStripHtml()}<div class="section-head"><div><h2>Mod profillerin</h2><p>Her oyun sürümü için ayrı evrenler.</p></div><a data-new-profile>+ Yeni profil</a></div><section class="grid">${state.profiles.map(profileCard).join('')}</section>${profile ? `<div class="section-head"><div><h2>Hızlı başlangıç</h2><p>En son profilini devam ettir.</p></div><a data-open-profile="${profile.id}">Kütüphaneyi aç →</a></div><section class="panel"><div class="mod-row"><div class="profile-symbol">▶</div><div><b>${esc(profile.name)}</b><span>${profile.gameVersion} ${profile.loader} · ${profile.mods.length} mod hazır</span></div><button class="btn success row-action" data-play="${profile.id}">▶ Oyna</button></div></section>` : `<div class="section-head"><div><h2>Başlamak için bir profil oluştur</h2><p>Her oyun sürümü için ayrı bir mod profili tutabilirsin.</p></div></div><section class="panel"><div class="empty">Henüz bir mod profilin yok.<br><br><button class="btn primary" data-new-profile>＋ İlk profilini oluştur</button></div></section>`}${typeof newsSection === 'function' ? newsSection() : ''}`;
}

function versionSelectOptions(selected) {
  if (!mcVersions.releases.length) return `<option value="">Sürümler yükleniyor…</option>`;
  return `<option value="">Tüm sürümler</option>` + mcVersions.releases.map(v => `<option value="${v}" ${v === selected ? 'selected' : ''}>${v}</option>`).join('');
}
function loaderSelectOptions(selected) {
  return `<option value="">Tüm yükleyiciler</option>` + loaderOptions.map(l => `<option ${l === selected ? 'selected' : ''}>${l}</option>`).join('');
}

function discoverTypeMeta() { return DISCOVER_TYPES.find(t => t.id === discoverType) || DISCOVER_TYPES[0]; }
/* Dünyalar Modrinth'te yok; o türde aramayı CurseForge'a kilitle. */
function activeSourceForType() { return discoverType === 'world' ? 'CurseForge' : source; }
function discoverFilters() { return discoverType === 'mod' ? filters : { ...filters, projectType: discoverType }; }
function discover() {
  const isSearch = searchMode === 'search';
  const meta = discoverTypeMeta();
  const heading = isSearch ? 'Arama sonuçları' : `Önerilen ${meta.label.toLowerCase()}`;
  const sub = isSearch ? `"${esc(searchQuery)}" için ${searchResults.length} sonuç` : (discoverType === 'mod' ? 'En çok indirilen modlar arasından ilham al. Aşağı kaydırdıkça yeni modlar otomatik yüklenir.' : 'Seçtiğin türe göre içerikler listelenir; indirince oyun klasöründeki doğru alt klasöre kaydedilir.');
  const hint = smartDetected && (smartDetected.gameVersion || smartDetected.loader || smartDetected.category)
    ? `<div class="smart-hint"><img class="star-icon sm" src="assets/star-32.png" alt=""> Akıllı arama algıladı:${smartDetected.gameVersion ? ` <b>${smartDetected.gameVersion}</b>` : ''}${smartDetected.loader ? ` <b>${smartDetected.loader}</b>` : ''}${smartDetected.category ? ` <b>${CATEGORY_LABELS_TR[smartDetected.category] || smartDetected.category}</b>` : ''}</div>`
    : '';
  const typeRow = `<div class="type-row">${DISCOVER_TYPES.map(t => `<button class="type-chip ${discoverType === t.id ? 'active' : ''}" data-discover-type="${t.id}"><span>${t.icon}</span>${t.label}</button>`).join('')}</div>`;
  const collections = discoverType === 'mod' ? `<div class="chip-row">${COLLECTION_CHIPS.map(([value, label]) => `<button class="chip-btn ${(filters.category || '') === value ? 'active' : ''}" data-collection="${esc(value)}">${esc(label)}</button>`).join('')}</div>` : '';
  const sourceSwitch = discoverType === 'world'
    ? `<div class="source-switch"><button class="active" title="Dünyalar yalnızca CurseForge kataloğunda var">CurseForge</button></div>`
    : `<div class="source-switch"><button data-source="All" class="${source==='All'?'active':''}">İkisi</button><button data-source="Modrinth" class="${source==='Modrinth'?'active':''}">Modrinth</button><button data-source="CurseForge" class="${source==='CurseForge'?'active':''}">CurseForge</button></div>`;
  const loaderFilter = discoverType === 'shader' || discoverType === 'resourcepack' || discoverType === 'world'
    ? `<select id="loader-filter" disabled title="Bu içerik türü yükleyici kullanmaz"><option>${meta.label} için geçersiz</option></select>`
    : `<select id="loader-filter">${loaderSelectOptions(filters.loader)}</select>`;
  return `${pageHeader('İçerik keşfet.', 'Mod, mod paketi, shader, kaynak paketi ve dünya — hepsi tek aramada.')}<div class="search-wrap"><img class="star-icon" src="assets/star-32.png" alt=""><input id="search" autocomplete="off" placeholder="Örn: '1.20.1 fabric performans modu' yaz, akıllı arama filtreleri kendisi bulsun" value="${esc(searchQuery)}"/><button id="search-go" class="btn primary">Ara</button></div>${typeRow}${collections}${hint}<div class="filter-row"><select id="version-filter">${versionSelectOptions(filters.gameVersion)}</select>${loaderFilter}<select id="category-filter">${categorySelectOptions(filters.category)}</select>${sourceSwitch}</div><div class="section-head"><div><h2>${heading}</h2><p>${esc(sub)}</p></div>${isSearch ? '<a data-clear-search>← Önerilenlere dön</a>' : ''}</div><div id="results-wrap">${resultsArea(isSearch ? 'Sonuç bulunamadı. Farklı bir terim ya da filtre dene.' : 'Şu an önerilecek içerik yok.')}</div>`;
}

function resultsArea(emptyLabel) {
  if (resultsLoading) return `<div class="empty"><span class="loader"></span> Modlar yükleniyor…</div>`;
  if (!searchResults.length) return `<div class="empty">${emptyLabel}</div>`;
  return modGrid(searchResults);
}
function modCardsHtml(results) {
  return results.map(mod => { const kind = mod.kind || (page === 'discover' ? discoverType : 'mod'); const kindIcon = (DISCOVER_TYPES.find(t => t.id === kind) || DISCOVER_TYPES[0]).icon; return `<article class="mod-card" data-preview-open data-source="${esc(mod.source)}" data-mod-id="${esc(mod.id)}" data-kind="${esc(kind)}"><div class="mod-top">${mod.icon ? `<img class="mod-icon" src="${esc(mod.icon)}" alt="">` : `<div class="mod-icon">${kindIcon}</div>`}<div><h3>${esc(mod.title)}</h3><span class="source">${esc(mod.source)} · ${esc(mod.author)}</span></div></div><p>${esc(mod.summary)}</p><div class="tags">${mod.categories.slice(0,3).map(tag=>`<span class="tag">${esc(tag)}</span>`).join('')}</div><div class="mod-bottom"><small>↓ ${number(mod.downloads)}</small><button class="mini-btn" data-quick-download data-source="${esc(mod.source)}" data-mod-id="${esc(mod.id)}">⇩ İndir</button></div></article>`; }).join('');
}
function modGrid(results) { return `<div class="mod-grid" id="results-grid">${modCardsHtml(results)}</div><div id="load-more-area"></div>`; }
function bindModCardsList(cards) {
  cards.forEach(card => {
    card.addEventListener('click', event => { if (event.target.closest('[data-quick-download]')) return; openPreview(card.dataset.source, card.dataset.modId, card.dataset.kind || 'mod'); });
    const quickBtn = card.querySelector('[data-quick-download]');
    quickBtn?.addEventListener('click', async event => { event.stopPropagation(); const sourceName = quickBtn.dataset.source, id = quickBtn.dataset.modId; toast('Sürümler getiriliyor…'); try { const details = await api.getModDetails(sourceName, id); openPicker(details, card.dataset.kind || 'mod'); } catch (error) { toast(error.message, true); } });
  });
}

const AI_PRESETS = [
  { label: '🗡️ Zorlu Hayatta Kalma', query: 'hardcore survival difficulty', category: 'adventure', explain: 'Zorluk ve hayatta kalma mekaniklerini derinleştiren modlara bakılıyor.' },
  { label: '🏗️ Sakin Yapı & Dekorasyon', query: 'building decoration furniture', category: 'decoration', explain: 'İnşaat ve dekorasyon odaklı modlar listeleniyor.' },
  { label: '⚡ Performans Canavarı', query: '', category: 'optimization', explain: 'FPS ve performans artıran optimizasyon modları öne çıkarılıyor.' },
  { label: '🌈 Görsel Şölen', query: '', category: 'shaders', explain: 'Gölgelendirme ve görsel modlar listeleniyor.' },
  { label: '⚔️ RPG Macera', query: 'rpg classes quests', category: 'adventure', explain: 'Macera ve RPG mekanikleri ekleyen modlar getiriliyor.' },
  { label: '🧪 Teknoloji & Otomasyon', query: '', category: 'technology', explain: 'Otomasyon ve teknoloji odaklı modlar listeleniyor.' },
  { label: '👥 Çok Oyunculu & Sunucu', query: 'multiplayer server', category: '', explain: 'Çok oyunculu ve sunucu odaklı modlar listeleniyor.' },
  { label: '🧭 Keşif & Yeni Dünyalar', query: '', category: 'worldgen', explain: 'Yeni biyomlar ve dünya üretimi modları listeleniyor.' }
];

function ai() {
  return `${pageHeader('AI Önerici', 'Ne tür bir Minecraft deneyimi istediğini anlat, sana uygun modları bulalım.')}<div class="ai-hero"><div class="eyebrow">YEREL ÖNERİ MOTORU</div><h2 style="font-size:20px;margin:8px 0">Nasıl bir deneyim istiyorsun?</h2><p class="sub" style="margin:0 0 4px">Bu motor cihazında çalışır; hiçbir metni dış sunucuya göndermez. Anahtar kelimelerden sürüm, yükleyici ve kategori çıkarır.</p><textarea id="ai-input" placeholder="Örn: 1.20.1 Fabric için zorlu ve gerçekçi bir hayatta kalma deneyimi istiyorum...">${esc(aiQuery)}</textarea><div class="ai-chips">${AI_PRESETS.map((preset,i)=>`<button class="ai-chip" data-ai-preset="${i}">${preset.label}</button>`).join('')}</div><button class="btn primary" id="ai-go"><img class="star-icon sm" src="assets/star-32.png" alt=""> Modları Öner</button></div>${aiExplain ? `<div class="ai-explain"><img class="star-icon sm" src="assets/star-32.png" alt=""> ${esc(aiExplain)}</div>` : ''}<div class="section-head"><div><h2>Öneriler</h2><p>Aşağı kaydırdıkça daha fazla sonuç yüklenir.</p></div></div><div id="results-wrap">${resultsArea('Henüz bir öneri çalıştırılmadı. Yukarıdan bir şablon seç ya da kendi cümleni yaz.')}</div>`;
}
function buildExplain(activeFilters) {
  const bits = [];
  if (activeFilters.category) bits.push(CATEGORY_LABELS_TR[activeFilters.category] || activeFilters.category);
  if (activeFilters.loader) bits.push(activeFilters.loader);
  if (activeFilters.gameVersion) bits.push(activeFilters.gameVersion);
  return bits.length ? `Şuna göre arıyorum: ${bits.join(' · ')}` : 'Yazdığın metne göre en alakalı modlar getiriliyor.';
}
async function runAiSearch(rawQuery, presetCategory, presetExplain) {
  const parsed = parseSmartQuery(rawQuery || '');
  filters = { gameVersion: parsed.gameVersion || '', loader: parsed.loader || '', category: presetCategory || parsed.category || '' };
  aiExplain = presetExplain || buildExplain(filters);
  searchMode = 'ai'; searchQuery = parsed.query || rawQuery || ''; resultsOffset = 0; hasMore = true; resultsLoading = true; render();
  try {
    const data = await api.searchMods(searchQuery, 'Modrinth', filters, 0);
    searchResults = data.results; hasMore = data.results.length >= 20;
  } catch (error) { toast('Öneri alınamadı: ' + error.message, true); searchResults = []; }
  resultsLoading = false; render();
}

function library() {
  const profile = selectedProfile();
  if (!profile) return `${pageHeader('Kütüphane', 'Önce bir mod profili oluştur.')}<div class="empty">Henüz bir profilin yok.<br><br><a data-new-profile class="mini-btn" style="display:inline-block;padding:9px 14px">+ Yeni profil</a></div>`;
  const updatesForProfile = updateResults && updateResults.profileId === profile.id ? updateResults.updates : null;
  const updateBanner = updatesForProfile == null ? '' : updatesForProfile.length
    ? `<section class="panel update-banner"><h3>${ic('st-bell')} ${updatesForProfile.length} mod için güncelleme var</h3>${updatesForProfile.map(u=>`<div class="mod-row"><div class="profile-symbol">↑</div><div><b>${esc(u.name)}</b><span>${esc(u.currentVersion)} → ${esc(u.newVersion)}</span></div><button class="btn primary row-action" data-apply-update="${esc(u.projectId)}" data-new-version="${esc(u.newVersionId)}">Güncelle</button></div>`).join('')}</section>`
    : `<section class="panel"><p class="sub" style="margin:0">Tüm modlar güncel görünüyor. ✓</p></section>`;
  let mods = profile.mods.filter(m => !librarySearch || m.name.toLowerCase().includes(librarySearch.toLowerCase()));
  mods = mods.slice().sort((a, b) => librarySort === 'source' ? a.source.localeCompare(b.source) : librarySort === 'recent' ? new Date(b.downloadedAt || 0) - new Date(a.downloadedAt || 0) : a.name.localeCompare(b.name));
  const allSelected = mods.length > 0 && mods.every(m => selectedMods.has(m.id));
  const bySource = profile.mods.reduce((acc, m) => { acc[m.source] = (acc[m.source] || 0) + 1; return acc; }, {});
  const disabledCount = profile.mods.filter(m => m.enabled === false).length;
  const suggestHtml = librarySuggestionsLoading
    ? `<div class="empty"><span class="loader"></span> Bu profile uygun modlar aranıyor…</div>`
    : (librarySuggestions && librarySuggestions.length)
      ? modGrid(librarySuggestions)
      : (librarySuggestions ? `<div class="empty">Şu an önerecek yeni bir mod bulamadık. <a data-go="discover" style="color:var(--cyan);cursor:pointer">Keşfet'e göz at →</a></div>` : '');
  const profileSwitch = `<div class="profile-switch">${state.profiles.map(p => `<button class="switch-pill ${p.id === profile.id ? 'active' : ''}" data-open-profile="${p.id}" title="${esc(p.name)} · ${p.gameVersion} ${p.loader}">${renderProfileIcon(p.icon, 'xs')}<b>${esc(p.name)}</b><span>${p.mods.length} mod</span></button>`).join('')}<button class="switch-pill add" data-new-profile title="Yeni profil">＋</button></div>`;
  return `${pageHeader(profile.name, `${profile.gameVersion} · ${profile.loader} · ${profile.mods.length} mod`, `<button class="btn ghost" data-import="${profile.id}">${ic('act-upload')} Yerel .jar ekle</button><button class="btn ghost" data-check-updates="${profile.id}" ${updateChecking?'disabled':''}>${updateChecking?`${ic('act-refresh')} Kontrol ediliyor…`:`${ic('act-refresh')} Güncellemeleri kontrol et`}</button><button class="btn ghost" data-share-profile="${profile.id}">${ic('act-share')} Paylaş</button><button class="btn ghost" data-duplicate-profile="${profile.id}">${ic('card-duplicate')} Klonla</button><button class="btn success" data-play="${profile.id}">${ic('act-play')} Oyna</button>`, renderProfileIcon(profile.icon, 'lg'))}${profileSwitch}<div id="launch-progress-slot">${typeof launchProgressHtml === 'function' ? launchProgressHtml() : ''}</div>${updateBanner}<div class="library-toolbar"><input id="lib-search" placeholder="Bu profildeki modlarda ara..." value="${esc(librarySearch)}"><select id="lib-sort"><option value="name" ${librarySort==='name'?'selected':''}>İsme göre</option><option value="source" ${librarySort==='source'?'selected':''}>Kaynağa göre</option><option value="recent" ${librarySort==='recent'?'selected':''}>Son eklenen</option></select></div>${selectedMods.size ? `<div class="bulk-bar"><b>${selectedMods.size} mod seçildi</b><button class="btn danger" data-bulk-delete>Seçilenleri sil</button><button class="btn ghost" data-bulk-clear>Seçimi temizle</button></div>` : ''}<div class="detail-layout"><section class="panel"><div class="section-head"><div><h2>Profil modları</h2><p>${mods.length} / ${profile.mods.length} gösteriliyor.</p></div><label style="font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center;cursor:pointer">${mods.length ? `<input type="checkbox" class="row-check" id="lib-select-all" ${allSelected?'checked':''}> Tümünü seç` : ''}</label></div>${mods.length ? mods.map(mod=>`<div class="mod-row ${mod.enabled===false?'disabled':''}"><input type="checkbox" class="row-check" data-select-mod="${mod.id}" ${selectedMods.has(mod.id)?'checked':''}><div class="mod-icon">${mod.source==='Local'?'↥':mod.source==='Paket'?'◇':'◈'}</div><div><b>${esc(mod.name)}</b><span>${esc(mod.version)} · ${esc(mod.source)} · ${esc(mod.fileName)}</span></div><div class="switch ${mod.enabled===false?'':'on'}" data-toggle-mod="${mod.id}" title="${mod.enabled===false?'Etkinleştir':'Devre dışı bırak'}"></div><button class="btn danger row-action" data-remove-mod="${mod.id}">Sil</button></div>`).join('') : `<div class="empty">${librarySearch ? 'Aramayla eşleşen mod yok.' : 'Bu profilde henüz mod yok.'}<br><br><button class="btn primary" data-go="discover">Mod bul</button></div>`}</section><aside>${typeof analysisCard === 'function' ? analysisCard(profile) : ''}<section class="panel"><h3>Profil özeti</h3>${profile.mods.length ? `<div class="rp-source-bar">${Object.entries(bySource).map(([src,count])=>`<i style="width:${count/profile.mods.length*100}%;background:${{Modrinth:'#54e7cf',CurseForge:'#ff8a5c',Local:'#9b75ff',Paket:'#f5d76e'}[src]||'#888'}"></i>`).join('')}</div><div class="rp-legend">${Object.entries(bySource).map(([src,count])=>`<span><i style="background:${{Modrinth:'#54e7cf',CurseForge:'#ff8a5c',Local:'#9b75ff',Paket:'#f5d76e'}[src]||'#888'}"></i>${esc(src)} · ${count}</span>`).join('')}</div>` : '<p class="sub" style="margin:0">Henüz mod yok.</p>'}<div class="mod-row"><div>⏻</div><div><b>Devre dışı modlar</b><span>${disabledCount} mod devre dışı</span></div></div><div class="mod-row"><div>⟳</div><div><b>Güncelleme kontrolü</b><span>Modrinth modları için aktif</span></div></div></section><section class="upload"><strong>Kendi modunu ekle</strong><span>Yerel bir <code>.jar</code> dosyasını bu profile kopyala.</span><button class="btn primary" data-import="${profile.id}">Dosya seç</button></section></aside></div><div class="section-head"><div><h2>${esc(profile.name)} için öneriler</h2><p>${profile.gameVersion} · ${profile.loader} ile uyumlu, henüz eklemediğin modlar.</p></div><a data-go="discover">Tümünü keşfet →</a></div>${suggestHtml}`;
}

function packs() {
  const profile = selectedProfile();
  return `${pageHeader('Paket Oluştur', 'Profilini standart bir Modrinth paketi (.mrpack) olarak dışa aktar ya da başkasının paketini içe aktar.')}<div class="detail-layout"><section class="panel"><h3>Paket dışa aktar</h3><p class="sub" style="margin:6px 0 16px">Seçtiğin profildeki modlar tek bir <code>.mrpack</code> dosyasına paketlenir. Modrinth kaynaklı modlar orijinal indirme bağlantısıyla, diğerleri doğrudan pakete gömülür. Bu dosya Prism Launcher, Modrinth App ya da başka bir MineVerse kopyasında açılabilir.</p><label class="form-label">PROFİL</label><select id="pack-profile" class="form-input">${state.profiles.map(p=>`<option value="${p.id}" ${p.id===profile?.id?'selected':''}>${esc(p.name)} (${p.mods.length} mod)</option>`).join('')}</select><label class="form-label">PAKET ADI</label><input class="form-input" id="pack-name" placeholder="${esc(profile?.name || 'Paketim')}"><label class="form-label">AÇIKLAMA</label><input class="form-input" id="pack-summary" placeholder="Kısa bir açıklama (opsiyonel)"><button class="btn primary" id="pack-export-btn" style="margin-top:16px;width:100%">⇩ .mrpack olarak dışa aktar</button></section><aside><section class="pack-drop"><strong>Bir paketi içe aktar</strong><span>Herhangi bir .mrpack dosyasını seç; yeni bir profil olarak otomatik kurulsun.</span><button class="btn primary" id="pack-import-btn">Dosya Seç (.mrpack)</button></section><section class="panel" style="margin-top:14px"><h3>Nasıl çalışır?</h3><div class="pack-list-item"><div class="profile-symbol">1</div><div><b>Dışa aktar</b><span>Profilini standart formata paketle.</span></div></div><div class="pack-list-item"><div class="profile-symbol">2</div><div><b>Paylaş</b><span>Dosyayı arkadaşınla ya da başka bir launcher ile paylaş.</span></div></div><div class="pack-list-item"><div class="profile-symbol">3</div><div><b>İçe aktar</b><span>Karşı taraf aynı modları tek tıkla kurar.</span></div></div></section></aside></div>`;
}

function launchers() { return `${pageHeader("Launcher'larını bağla.", 'Profillerini algılanan veya seçtiğin oyun klasörlerine güvenle aktar.', `<button class="btn ghost" data-add-launcher>＋ Klasör seç</button><button class="btn primary" data-detect>⌕ Algıla</button>`)}<section class="hero compact"><div class="eyebrow">AKILLI AKTARIM</div><h2>Elle dosya taşımayı bırak.</h2><p>Bir launcher klasörü bağla, ardından seçtiğin profilin tüm modlarını doğrudan ilgili <code>mods</code> dizinine kopyala. Hedef alt klasörü dilediğin gibi değiştirebilirsin.</p></section><div class="section-head"><div><h2>Bağlı launcher'lar</h2><p>Algılama yaygın klasörleri kontrol eder.</p></div></div><section class="launcher-list">${state.launchers.length ? state.launchers.map(item=>`<article class="launcher-card"><div class="launcher-logo">◉</div><h3>${esc(item.name)} ${item.detected?'<span class="chip">ALGILANDI</span>':''}</h3><p class="path">${esc(item.location)}</p><label class="form-label" style="margin-top:10px">MOD HEDEF ALT KLASÖRÜ</label><input class="form-input mods-path-input" data-launcher-id="${item.id}" value="${esc(item.modsSubpath || 'mods')}" placeholder="mods"><p class="path" style="margin-top:6px;opacity:.7">Modlar buraya yazılır: ${esc(item.modsPath || (item.location + '/' + (item.modsSubpath || 'mods')))}</p><div class="launcher-actions"><button class="btn primary" data-export="${selectedProfile()?.id}" data-launcher="${item.id}">Profili aktar</button><button class="btn ghost" data-path="${esc(item.location)}">Klasörü aç</button><button class="btn danger" data-remove-launcher="${item.id}">Kaldır</button></div></article>`).join('') : `<div class="empty">Henüz launcher bulunamadı.<br><br><button class="btn primary" data-detect>Otomatik algıla</button></div>`}</section><p class="sub" style="margin-top:22px">Not: Kapalı launcher'lar sabit bir oyun dizini sunmayabilir. Böyle durumlarda modları aktarmak istediğin Minecraft örneğinin klasörünü manuel seç. TLauncher ve resmî launcher genelde <code>AppData/Roaming/.minecraft/mods</code> kullanır.</p>`; }

function settings() {
  const s = state.settings;
  const themes = [{id:'nebula',label:'MineVerse'},{id:'nether',label:'Nether'},{id:'overworld',label:'Overworld'},{id:'amoled',label:'AMOLED'},{id:'aurora',label:'Aurora'},{id:'sunset',label:'Sunset'}];
  const versionOpts = (mcVersions.releases.length ? mcVersions.releases : [s.defaultGameVersion || '1.21.1']).map(v => `<option ${v===s.defaultGameVersion?'selected':''}>${v}</option>`).join('');
  const storageRows = storageInfo ? storageInfo.profiles.map(p => `<div class="rp-row"><span>${esc(p.name)}</span><b>${formatBytes(p.bytes)} · ${p.files} dosya</b></div>`).join('') : '';
  return `${pageHeader('Kişiselleştir.', 'MineVerse görünümünü, varsayılanlarını ve verilerini kendine göre ayarla.')}<section class="settings-grid">
  <article class="setting-card"><h3>${ic('card-account')} Hesap</h3><p>Kimliğin, MV kodun ve oyun UUID\u2019n artık <b>Hesabım</b> sayfasında. Arkadaşlarına paket gönderirken bu kodu kullanırsın.</p><div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" data-go="account">Hesabım sayfasını aç ${ic('act-open')}</button></div></article>
  <article class="setting-card"><h3>${ic('card-identity')} Kimliğin ve ilerlemen</h3>${(() => {
    const a = s.account || {};
    const totalMods = state.profiles.reduce((all, p) => all + p.mods.length, 0);
    const skin = (state.accounts || []).find(x => x.id === s.activeAccountId)?.skin;
    return `<div class="identity-mini">${renderProfileIcon(a.icon || { type: 'block', value: 'grass' }, 'md')}<div><b>${esc(a.displayName || 'Yerel Oyuncu')}</b><span class="mono">${esc(a.code || 'MV-····-····')}</span></div></div>
    <div class="mini-stats"><div><b>${state.profiles.length}</b><span>profil</span></div><div><b>${totalMods}</b><span>mod</span></div><div><b>${(state.friends || []).length}</b><span>arkadaş</span></div><div><b>${skin ? '✓' : '—'}</b><span>oyun skin'i</span></div></div>
    <p class="note">${skin ? `Oyunda <b>${esc(skin.name)}</b> skin'i kullanılıyor (${esc(dateTr(skin.at))}).` : 'MineVerse\'ten bir skin yükleyip "Oyuna aktar" dediğinde skin burada görünür.'}</p>
    <div class="modal-actions" style="justify-content:flex-start"><button class="btn ghost" data-go="account">Skin ve hesap ayarları ${ic('act-open')}</button></div>`;
  })()}</article>
  <article class="setting-card wide"><h3>${ic('card-theme')} Tema ve vurgu rengi</h3><p>Önce taban temayı seç, sonra vurgu rengini belirle. Hazır renkler anında uygulanır; kendi rengini de verebilirsin.</p><div class="theme-list">${themes.map(t=>`<button class="theme ${t.id} ${themeName===t.id?'active':''}" data-theme-pick="${t.id}" title="${t.label}"><span>${t.label}</span></button>`).join('')}</div><div class="accent-grid">${ACCENTS.map(a=>`<button class="accent-chip ${accentColor.toLowerCase()===a.hex?'active':''}" data-accent="${a.hex}" style="--chip:${a.hex};--chip2:${shade(a.hex,-22)};--chip-text:${contrastOn(a.hex)}"><i></i><span>${a.label}</span></button>`).join('')}</div><div class="accent-row"><input type="color" id="accent-picker" value="${accentColor}" title="Özel renk"><code class="mono">${esc(accentColor)}</code><button class="btn ghost" data-accent-reset>Varsayılana dön</button></div></article>
  ${backgroundCard()}
  <article class="setting-card"><h3>${ic('card-defaults')} Yeni profil varsayılanları</h3><p>Yeni bir mod profili oluştururken bu sürüm ve yükleyici otomatik seçili gelsin.</p><div class="form-row"><div><label class="form-label">SÜRÜM</label><select id="default-version" class="form-input">${versionOpts}</select></div><div><label class="form-label">YÜKLEYİCİ</label><select id="default-loader" class="form-input">${loaderOptions.map(l=>`<option ${l===s.defaultLoader?'selected':''}>${l}</option>`).join('')}</select></div></div><div class="modal-actions"><button class="btn primary" data-save-defaults>Kaydet</button></div></article>
  <article class="setting-card"><h3>${ic('card-curse')} CurseForge erişimi</h3><p>Resmî CurseForge API kişisel anahtar ister. Anahtar yalnızca bu bilgisayarda tutulur, uygulama kaynak kodunda yer almaz.</p><label class="form-label">API ANAHTARI</label><input id="curse-key" class="form-input" type="password" placeholder="API anahtarını gir" value="${esc(s.curseForgeApiKey)}"><div class="modal-actions"><button class="btn primary" data-save-key>Kaydet</button></div><p class="note tiny">Şu an kullanılan: <b>${esc(s.curseForgeKeySource || 'yok')}</b>. Kaynağı GitHub'a yüklersen buraya kendi anahtarını girmen gerekir; anahtarsız yalnızca Modrinth çalışır.</p></article>
  <article class="setting-card"><h3>${ic('card-versions')} Minecraft sürüm listesi</h3><p>Sürümler Mojang'dan canlı çekilir (${mcVersions.releases.length} sürüm bulundu, en son: ${esc(mcVersions.latest?.release || '—')}).</p><button class="btn ghost" data-refresh-versions>${ic('act-refresh')} Şimdi yenile</button></article>
  <article class="setting-card"><h3>${ic('card-storage')} Depolama</h3><p>${storageInfo ? `Toplam <b style="color:var(--text)">${formatBytes(storageInfo.totalBytes)}</b> yerel mod verisi.` : 'Hesaplanıyor…'}</p>${storageRows ? `<div style="margin:10px 0">${storageRows}</div>` : ''}<div class="modal-actions" style="justify-content:flex-start"><button class="btn ghost" data-open-data>Veri klasörünü aç</button></div></article>
  <article class="setting-card"><h3>${ic('card-about')} Hakkında</h3><p>MineVerse v0.12.2 · yerel çalışan bir mod yöneticisi. Modrinth + CurseForge aramasını birleştirir, sürüm/yükleyici seçerek indirir, istersen Minecraft'ı kendisi başlatır.</p><p style="margin-top:8px">Bu sürümde: 3B dönen skin önizlemesi ve "Oyuna aktar", izometrik blok simgeleri, haber detay penceresi, kütüphanede profil geçiş şeridi, ilerlemeli rozetler ve haber görsellerinin depodan sunulması.</p><p style="margin-top:10px;font-size:10.5px;color:#5f8481">Bu derleme henüz bir kod imzalama sertifikası içermiyor; Windows SmartScreen ilk açılışta uyarı gösterebilir, bu normaldir.</p></article>
  <article class="setting-card danger-card"><h3>${ic('card-danger')} Tehlikeli bölge</h3><p>Tüm profilleri, indirilen modları ve ayarları kalıcı olarak siler. Bu işlem geri alınamaz.</p><div class="modal-actions" style="justify-content:flex-start"><button class="btn danger" data-reset-all>Her şeyi sıfırla</button></div></article>
  ${typeof settingsExtra === 'function' ? settingsExtra() : ''}
  </section>`;
}
function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B','KB','MB','GB'];
  let value = bytes, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function render() {
  try { renderCore(); }
  catch (error) {
    console.error(error);
    main.innerHTML = `<div class="boot-screen"><div class="load-error"><h3>Bu sayfa açılamadı</h3><p>${esc(error.message)}</p><button class="btn primary" id="err-home">Ana sayfaya dön</button></div></div>`;
    q('#err-home')?.addEventListener('click', () => { page = 'home'; document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page)); render(); });
  }
}
function renderCore() { main.innerHTML = ({ home, discover, ai, library, packs, launchers, settings, friends: (typeof friendsPage === 'function' ? friendsPage : home), account: (typeof accountPage === 'function' ? accountPage : home) }[page] || home)(); bind(); renderRightPanel(); renderSidebarExtras(); if (typeof hydrateIcons === 'function') hydrateIcons(main); applyBackground(state?.settings); }
function renderSidebarExtras() {
  const accountEl = q('#sidebar-account');
  if (accountEl) accountEl.innerHTML = typeof accountChipHtml === 'function' ? accountChipHtml(typeof activeAccount === 'function' ? activeAccount() : null) : '';
  if (accountEl && !accountData && typeof loadAccountInfo === 'function') loadAccountInfo().then(() => { const el = q('#sidebar-account'); if (el && typeof accountChipHtml === 'function') el.innerHTML = accountChipHtml(activeAccount()); hydrateIcons(el, true); });
  const widgetsEl = q('#sidebar-widgets');
  if (widgetsEl && storageInfo) {
    const pct = Math.min(100, Math.round((storageInfo.totalBytes / (2 * 1024 * 1024 * 1024)) * 100)) || 2;
    widgetsEl.innerHTML = `<div class="sidebar-storage"><div class="sidebar-storage-top"><span>${ic('card-storage')} Depolama</span><b>${formatBytes(storageInfo.totalBytes)}</b></div><div class="sidebar-storage-bar"><i style="width:${pct}%"></i></div></div>`;
  } else if (widgetsEl && !widgetsEl.dataset.loading) {
    widgetsEl.dataset.loading = '1';
    api.getStorageInfo().then(info => { storageInfo = info; renderSidebarExtras(); }).catch(() => {});
  }
  document.querySelectorAll('#sidebar-account [data-page]').forEach(button => button.onclick = () => { page = button.dataset.page; document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page)); render(); maybeAutoLoadDiscover(); });
  if (typeof hydrateIcons === 'function') hydrateIcons(document.querySelector('#sidebar-account'));
}

function renderRightPanel() {
  const panel = q('#rightpanel');
  if (!panel) return;
  const profile = selectedProfile();
  if (!profile) { panel.innerHTML = `<div class="rp-card"><h4>◫ Profil</h4><p class="rp-empty">Henüz bir mod profilin yok. Ana sayfadan bir tane oluştur.</p></div>`; return; }
  const bySource = profile.mods.reduce((acc, m) => { acc[m.source] = (acc[m.source] || 0) + 1; return acc; }, {});
  const total = profile.mods.length;
  const disabledCount = profile.mods.filter(m => m.enabled === false).length;
  const sourceColors = { Modrinth: '#54e7cf', CurseForge: '#ff8a5c', Local: '#9b75ff', Paket: '#f5d76e' };
  const launcher = state.launchers[0];
  panel.innerHTML = `<div class="rp-card"><h4>${ic('nav-library')} Hızlı profil</h4><select id="rp-profile-select">${state.profiles.map(p=>`<option value="${p.id}" ${p.id===profile.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select><div class="rp-row"><span>Sürüm</span><b>${esc(profile.gameVersion)}</b></div><div class="rp-row"><span>Yükleyici</span><b>${esc(profile.loader)}</b></div><div class="rp-row"><span>Mod sayısı</span><b>${total}</b></div><button class="btn primary" style="width:100%;margin-top:12px" data-rp-open-library>Kütüphaneyi Aç</button></div><div class="rp-card"><h4>${ic('nav-launchers')} Launcher bağlantısı</h4>${launcher ? `<p class="rp-launcher-name">${esc(launcher.name)}</p><span class="rp-launcher-path">${esc(launcher.location)}</span><button class="btn ghost" style="width:100%;margin-top:12px" data-rp-open-launchers>Değiştir</button>` : `<p class="rp-empty">Henüz bir launcher bağlanmadı.</p><button class="btn primary" style="width:100%;margin-top:10px" data-rp-open-launchers>Launcher Bağla</button>`}</div><div class="rp-card"><h4>${ic('act-analyze')} Mod analizi</h4>${total ? `<div class="rp-source-bar">${Object.entries(bySource).map(([src,count])=>`<i style="width:${count/total*100}%;background:${sourceColors[src]||'#888'}"></i>`).join('')}</div><div class="rp-legend">${Object.entries(bySource).map(([src,count])=>`<span><i style="background:${sourceColors[src]||'#888'}"></i>${esc(src)} · ${count}</span>`).join('')}</div>` : `<p class="rp-empty">Bu profilde henüz mod yok.</p>`}<div class="rp-row" style="margin-top:10px"><span>Devre dışı</span><b>${disabledCount}</b></div><div class="rp-row"><span>Güncelleme kontrolü</span><b>${updateResults && updateResults.profileId===profile.id ? updateResults.updates.length+' bulundu' : 'Çalıştırılmadı'}</b></div></div>`;
  q('#rp-profile-select')?.addEventListener('change', event => { currentProfileId = event.target.value; updateResults = null; selectedMods.clear(); render(); });
  q('[data-rp-open-library]')?.addEventListener('click', () => { page = 'library'; render(); });
  q('[data-rp-open-launchers]')?.addEventListener('click', () => { page = 'launchers'; render(); });
}

function bind() {
  document.querySelectorAll('[data-page]').forEach(button => button.onclick = () => { page = button.dataset.page; document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page)); render(); maybeAutoLoadDiscover(); });
  document.querySelectorAll('[data-go]').forEach(button => button.onclick = () => { page = button.dataset.go; document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page)); render(); maybeAutoLoadDiscover(); });
  document.querySelectorAll('[data-new-profile]').forEach(button => button.onclick = profileModal);
  document.querySelectorAll('[data-open-profile]').forEach(button => button.onclick = () => { currentProfileId = button.dataset.openProfile; page = 'library'; updateResults = null; selectedMods.clear(); render(); maybeAutoLoadDiscover(); });
  document.querySelectorAll('[data-delete-profile]').forEach(button => button.onclick = event => { event.stopPropagation(); confirmDeleteProfile(button.dataset.deleteProfile); });
  document.querySelectorAll('[data-play]').forEach(button => button.onclick = () => playProfile(button.dataset.play));
  document.querySelectorAll('[data-import]').forEach(button => button.onclick = () => doImport(button.dataset.import));
  document.querySelectorAll('[data-remove-mod]').forEach(button => button.onclick = () => removeMod(button.dataset.removeMod));
  document.querySelectorAll('[data-export]').forEach(button => button.onclick = () => exportProfile(button.dataset.export, button.dataset.launcher));
  document.querySelectorAll('[data-detect]').forEach(button => button.onclick = detect);
  document.querySelectorAll('[data-add-launcher]').forEach(button => button.onclick = addLauncher);
  document.querySelectorAll('.mods-path-input').forEach(input => input.addEventListener('change', () => saveLauncherModsPath(input.dataset.launcherId, input.value)));
  document.querySelectorAll('[data-remove-launcher]').forEach(button => button.onclick = () => removeLauncher(button.dataset.removeLauncher));
  document.querySelectorAll('[data-path]').forEach(button => button.onclick = () => api.openPath(button.dataset.path));
  document.querySelectorAll('[data-check-updates]').forEach(button => button.onclick = () => checkUpdates(button.dataset.checkUpdates));
  document.querySelectorAll('[data-duplicate-profile]').forEach(button => button.onclick = async () => {
    try { state = await api.duplicateProfile(button.dataset.duplicateProfile); render(); toast('Profil klonlandı; yeni kopya listeye eklendi.'); }
    catch (error) { toast(error.message, true); }
  });
  document.querySelectorAll('[data-apply-update]').forEach(button => button.onclick = () => applyUpdate(button.dataset.applyUpdate, button.dataset.newVersion));
  q('[data-refresh-versions]')?.addEventListener('click', refreshVersions);
  q('#search-go')?.addEventListener('click', doSearch);
  q('#search')?.addEventListener('keydown', event => { if (event.key === 'Enter') doSearch(); });
  q('[data-clear-search]')?.addEventListener('click', () => { searchMode = 'browse'; searchQuery = ''; searchResults = []; smartDetected = null; browseLoadedFor = ''; render(); loadFeatured(); });
  q('#version-filter')?.addEventListener('change', event => { filters.gameVersion = event.target.value; refreshCurrentBrowseOrSearch(); });
  q('#loader-filter')?.addEventListener('change', event => { filters.loader = event.target.value; refreshCurrentBrowseOrSearch(); });
  q('#category-filter')?.addEventListener('change', event => { filters.category = event.target.value; refreshCurrentBrowseOrSearch(); });
  document.querySelectorAll('[data-source]').forEach(button => button.onclick = () => { source = button.dataset.source; refreshCurrentBrowseOrSearch(); });
  document.querySelectorAll('[data-collection]').forEach(button => button.onclick = () => { filters.category = button.dataset.collection; refreshCurrentBrowseOrSearch(); });
  document.querySelectorAll('[data-discover-type]').forEach(button => button.onclick = () => {
    discoverType = button.dataset.discoverType;
    if (discoverType === 'world' && source !== 'CurseForge') source = 'CurseForge';
    if (discoverType === 'shader' || discoverType === 'resourcepack' || discoverType === 'world') filters.loader = '';
    if (discoverType !== 'mod') filters.category = '';
    searchMode = 'browse'; searchQuery = ''; searchResults = []; smartDetected = null; browseLoadedFor = '';
    render(); loadFeatured();
  });
  q('[data-save-key]')?.addEventListener('click', saveKey);
  if (typeof bindAccount === 'function') bindAccount();
  q('[data-open-data]')?.addEventListener('click', () => { if (storageInfo?.userDataPath) api.openPath(storageInfo.userDataPath); else toast('Depolama bilgisi henüz yüklenmedi.'); });
  q('[data-save-defaults]')?.addEventListener('click', saveDefaults);
  q('[data-reset-all]')?.addEventListener('click', confirmResetAll);
  bindModCardsList([...document.querySelectorAll('[data-preview-open]')]);
  document.querySelectorAll('[data-theme-pick]').forEach(button => button.onclick = () => setTheme(button.dataset.themePick, accentColor));
  q('#accent-picker')?.addEventListener('input', event => setTheme(themeName, event.target.value));
  document.querySelectorAll('[data-accent]').forEach(button => button.onclick = () => setTheme(themeName, button.dataset.accent));
  q('[data-accent-reset]')?.addEventListener('click', () => setTheme(themeName, '#f0b429'));
  q('[data-bg-pick]')?.addEventListener('click', pickBackground);
  q('[data-bg-clear]')?.addEventListener('click', clearBackground);
  document.querySelectorAll('[data-wallpaper]').forEach(button => button.onclick = () => applyBuiltinWallpaper(button.dataset.wallpaper, button));
  [['bg-dim-range', 'dim', 100], ['bg-blur-range', 'blur', 1], ['bg-strength-range', 'strength', 100]].forEach(([id, key, divisor]) => q('#' + id)?.addEventListener('input', event => {
    const value = +event.target.value;
    const patch = { [key]: divisor === 1 ? value : value / divisor };
    event.target.nextElementSibling.textContent = `${value}${key === 'blur' ? 'px' : '%'}`;
    applyBackground({ background: { ...(state.settings.background || {}), ...patch } });
    clearTimeout(backgroundSaveTimer); backgroundSaveTimer = setTimeout(() => saveBackground(patch), 400);
  }));
  q('#bg-size')?.addEventListener('change', event => saveBackground({ size: event.target.value }));
  q('#ai-go')?.addEventListener('click', () => { aiQuery = q('#ai-input').value.trim(); runAiSearch(aiQuery); });
  document.querySelectorAll('[data-ai-preset]').forEach(button => button.onclick = () => { const preset = AI_PRESETS[button.dataset.aiPreset]; aiQuery = preset.query; runAiSearch(preset.query, preset.category, preset.explain); });
  q('#lib-search')?.addEventListener('input', event => { librarySearch = event.target.value; render(); const field = q('#lib-search'); if (field) { field.focus(); const pos = librarySearch.length; field.setSelectionRange(pos, pos); } });
  q('#lib-sort')?.addEventListener('change', event => { librarySort = event.target.value; render(); });
  q('#lib-select-all')?.addEventListener('change', event => { const profile = selectedProfile(); const visible = profile.mods.filter(m => !librarySearch || m.name.toLowerCase().includes(librarySearch.toLowerCase())); if (event.target.checked) visible.forEach(m => selectedMods.add(m.id)); else visible.forEach(m => selectedMods.delete(m.id)); render(); });
  document.querySelectorAll('[data-select-mod]').forEach(checkbox => checkbox.onchange = () => { const id = checkbox.dataset.selectMod; if (checkbox.checked) selectedMods.add(id); else selectedMods.delete(id); render(); });
  document.querySelectorAll('[data-toggle-mod]').forEach(sw => sw.onclick = () => toggleModEnabled(sw.dataset.toggleMod));
  q('[data-bulk-delete]')?.addEventListener('click', bulkDeleteSelected);
  q('[data-bulk-clear]')?.addEventListener('click', () => { selectedMods.clear(); render(); });
  q('#pack-export-btn')?.addEventListener('click', exportPackClick);
  q('#pack-import-btn')?.addEventListener('click', importPackClick);
  main.onscroll = () => { if ((page !== 'discover' && page !== 'ai') || loadingMore || !hasMore || resultsLoading) return; if (main.scrollTop + main.clientHeight >= main.scrollHeight - 500) loadMore(); };
  if (typeof bindFeatures === 'function') bindFeatures();
}

function maybeAutoLoadDiscover() {
  if (page === 'discover' && searchMode === 'browse' && browseLoadedFor !== activeSourceForType() + discoverType + filters.gameVersion + filters.loader + filters.category) loadFeatured();
  if (page === 'settings' && !storageInfo) loadStorageInfo();
  if (page === 'settings' && !wallpapersData) loadWallpapers();
  if (typeof featuresAutoLoad === 'function') featuresAutoLoad();
  if (page === 'library') { const profile = selectedProfile(); if (profile && librarySuggestionsFor !== profile.id) loadLibrarySuggestions(profile); }
}
async function loadLibrarySuggestions(profile) {
  librarySuggestionsLoading = true; librarySuggestionsFor = profile.id; render();
  try {
    const data = await api.getFeaturedMods('Modrinth', { gameVersion: profile.gameVersion, loader: profile.loader }, 0);
    const already = new Set(profile.mods.map(m => `${m.source}:${m.projectId || ''}`));
    librarySuggestions = data.results.filter(m => !already.has(`${m.source}:${m.id}`)).slice(0, 6);
  } catch { librarySuggestions = []; }
  librarySuggestionsLoading = false; if (page === 'library') render();
}
async function loadStorageInfo() {
  try { storageInfo = await api.getStorageInfo(); if (page === 'settings') render(); } catch {}
}

async function refresh() { state = await api.getState(); render(); }
function refreshCurrentBrowseOrSearch() { resultsOffset = 0; hasMore = true; if (searchMode === 'search') doSearch(); else if (searchMode === 'ai') runAiSearch(aiQuery); else loadFeatured(); }

async function loadFeatured() {
  resultsLoading = true; searchMode = 'browse'; resultsOffset = 0; hasMore = true; render();
  try {
    const data = await api.getFeaturedMods(activeSourceForType(), discoverFilters(), 0);
    searchResults = data.results; browseLoadedFor = activeSourceForType() + discoverType + filters.gameVersion + filters.loader + filters.category; hasMore = data.results.length >= 20;
    if (data.curseForgeNeedsKey && activeSourceForType() !== 'Modrinth') toast('CurseForge önerileri için Ayarlar’dan API anahtarı ekleyebilirsin.');
  } catch (error) { toast('Öneriler alınamadı: ' + error.message, true); searchResults = []; }
  resultsLoading = false; render();
}

async function doSearch() {
  const raw = q('#search').value.trim();
  if (!raw) return toast('Önce bir arama terimi yaz.');
  const parsed = parseSmartQuery(raw);
  smartDetected = parsed;
  if (parsed.gameVersion) filters.gameVersion = parsed.gameVersion;
  if (parsed.loader) filters.loader = parsed.loader;
  if (parsed.category) filters.category = parsed.category;
  searchQuery = parsed.query || raw; searchMode = 'search'; resultsOffset = 0; hasMore = true; resultsLoading = true; render();
  try {
    const data = await api.searchMods(searchQuery, activeSourceForType(), discoverFilters(), 0);
    searchResults = data.results; hasMore = data.results.length >= 20;
    if (data.curseForgeNeedsKey && activeSourceForType() !== 'Modrinth') toast('CurseForge sonuçları için API anahtarı gerekli. Modrinth araması çalışıyor.');
  } catch (error) { toast('Arama yapılamadı: ' + error.message, true); searchResults = []; }
  resultsLoading = false; render();
}

async function loadMore() {
  loadingMore = true;
  const nextOffset = resultsOffset + 24;
  const area = q('#load-more-area'); if (area) area.innerHTML = `<div class="load-more-spinner"><span class="loader"></span> Daha fazla mod yükleniyor…</div>`;
  try {
    const data = searchMode === 'browse' ? await api.getFeaturedMods(activeSourceForType(), discoverFilters(), nextOffset) : await api.searchMods(searchQuery, searchMode === 'ai' ? 'Modrinth' : activeSourceForType(), searchMode === 'ai' ? filters : discoverFilters(), nextOffset);
    if (data.results.length) {
      const known = new Set(searchResults.map(m => `${m.source}:${m.id}`));
      const fresh = data.results.filter(m => !known.has(`${m.source}:${m.id}`));
      searchResults = searchResults.concat(fresh);
      resultsOffset = nextOffset;
      const grid = q('#results-grid');
      if (grid && fresh.length) { const before = grid.children.length; grid.insertAdjacentHTML('beforeend', modCardsHtml(fresh)); bindModCardsList([...grid.children].slice(before)); }
      hasMore = data.results.length >= 20 && resultsOffset < 400;
    } else { hasMore = false; }
  } catch (error) { toast('Daha fazla mod yüklenemedi: ' + error.message, true); hasMore = false; }
  const areaEnd = q('#load-more-area'); if (areaEnd) areaEnd.innerHTML = '';
  loadingMore = false;
}

async function doImport(profileId) { try { state = await api.importLocal(profileId); render(); toast('Yerel mod dosyası profile eklendi.'); } catch (error) { toast(error.message, true); } }
async function removeMod(modId) { try { state = await api.deleteMod(selectedProfile().id, modId); render(); toast('Mod profilden kaldırıldı.'); } catch (error) { toast(error.message, true); } }
async function toggleModEnabled(modId) { try { state = await api.toggleMod(selectedProfile().id, modId); render(); } catch (error) { toast(error.message, true); } }
async function bulkDeleteSelected() { const ids = [...selectedMods]; if (!ids.length) return; try { state = await api.bulkDeleteMods(selectedProfile().id, ids); selectedMods.clear(); render(); toast(`${ids.length} mod silindi.`); } catch (error) { toast(error.message, true); } }
async function detect() { toast('Yaygın launcher klasörleri aranıyor…'); try { state = await api.detectLaunchers(); render(); toast(`${state.launchers.length} launcher bağlantısı hazır.`); } catch (error) { toast(error.message, true); } }
async function addLauncher() { try { state = await api.addLauncher(); render(); toast('Launcher klasörü eklendi.'); } catch (error) { toast(error.message, true); } }
async function saveLauncherModsPath(launcherId, modsSubpath) { try { state = await api.setLauncherModsPath(launcherId, modsSubpath); render(); toast('Hedef klasör güncellendi.'); } catch (error) { toast(error.message, true); } }
async function removeLauncher(launcherId) { try { state = await api.removeLauncher(launcherId); render(); toast('Launcher bağlantısı kaldırıldı.'); } catch (error) { toast(error.message, true); } }
async function exportProfile(profileId, preferredLauncher) { if (!state.launchers.length) { page = 'launchers'; render(); toast('Önce bir launcher klasörü bağla.'); return; } const launcherId = preferredLauncher || state.launchers[0].id; try { const result = await api.exportProfile(profileId, launcherId); showExportResult(result); } catch (error) { toast(error.message, true); } }
function showExportResult(result) {
  const rows = [
    `<div class="issue ${result.copied ? 'ok' : 'warn'}"><b>${result.copied} mod kopyalandı</b><span>${esc(result.destination)}</span></div>`,
    result.skipped ? `<div class="issue info"><b>${result.skipped} mod atlandı</b><span>Kapalı olan veya dosyası profilde tutulmayan modlar aktarılmaz.</span></div>` : '',
    result.versionJson ? `<div class="issue info"><b>Sürüm dosyası yazıldı</b><span>${esc(result.versionJson)}</span></div>` : '',
    result.note ? `<div class="issue warn"><b>Sürüm dosyası</b><span>${esc(result.note)}</span></div>` : '',
    result.wrongDirHint ? `<div class="issue warn"><b>Klasör kontrolü</b><span>${esc(result.wrongDirHint)}</span></div>` : '',
    ...(result.failed || []).map(f => `<div class="issue error"><b>${esc(f.name)}</b><span>${esc(f.reason)}</span></div>`)
  ].filter(Boolean).join('');
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-export-modal><div class="modal"><h2>${result.copied ? "Launcher'a aktarıldı" : 'Aktarma sonuçsuz kaldı'}</h2><p class="sub">Launcher'ı tamamen kapatıp açtıktan sonra profili ve modlarını görebilirsin. Modlar yine görünmüyorsa altındaki hedef klasörü kontrol et.</p><div class="version-list">${rows}</div><div class="modal-actions"><button class="btn ghost" data-open-dir="${esc(result.destination)}">Mod klasörünü aç</button><button class="btn primary" data-close>Tamam</button></div></div></div>`);
  const back = q('[data-export-modal]');
  back.querySelector('[data-close]').onclick = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  back.querySelector('[data-open-dir]').onclick = () => api.openPath(result.destination);
  toast(`${result.copied} mod ${result.destination} içine aktarıldı.`);
}
function confirmDeleteProfile(profileId) {
  const profile = state.profiles.find(p => p.id === profileId);
  if (!profile) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-del-modal><div class="modal"><h2>"${esc(profile.name)}" silinsin mi?</h2><p>Bu profildeki ${profile.mods.length} mod ve tüm dosyaları kalıcı olarak silinecek. Geri alınamaz.</p><div class="modal-actions"><button class="btn ghost" data-close>Vazgeç</button><button class="btn danger" data-confirm-delete>Profili sil</button></div></div></div>`);
  const backdrop = q('[data-del-modal]');
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-close]').onclick = () => backdrop.remove();
  backdrop.querySelector('[data-confirm-delete]').onclick = async () => {
    try {
      state = await api.deleteProfile(profileId);
      if (currentProfileId === profileId) currentProfileId = state.profiles[0]?.id || null;
      backdrop.remove(); render(); toast('Profil silindi.');
    } catch (error) { toast(error.message, true); }
  };
}
async function playProfile(profileId) {
  if (state.settings.launchMode === 'mineverse') return launchWithMineVerse(profileId);
  if (!state.launchers.length) { page = 'launchers'; render(); toast('Önce bir launcher klasörü bağla.'); return; }
  const launcherId = state.launchers[0].id;
  toast('Modlar aktarılıyor…');
  try {
    const result = await api.playProfile(profileId, launcherId);
    toast(result.launched ? `${result.copied} mod aktarıldı, launcher açılıyor…` : `${result.copied} mod aktarıldı. Launcher otomatik açılamadı, elle başlat.`);
  } catch (error) { toast(error.message, true); }
}
async function launchWithMineVerse(profileId, force = false) {
  if (launchState.busy) return toast('Başlatma zaten sürüyor…', true);
  if (!force && typeof runPreflight === 'function') {
    const check = await runPreflight(profileId);
    if (check && !check.ok) { showPreflightModal(check); return; }
  }
  launchState.busy = true; launchState.progress = { phase: 'resolve', label: 'Hazırlanıyor…' }; render();
  try {
    const result = await api.launchPlay(profileId, { maxMemoryGb: state.settings.maxMemoryGb || 4 });
    launchState.running = true;
    toast(`Minecraft ${result.versionId} açıldı · ${result.mods} mod · Java ${result.java.includes('\\') ? 'yönetilen' : 'sistem'}`);
  } catch (error) { toast(error.message, true); }
  launchState.busy = false; render();
}
function showPreflightModal(check) {
  const rows = check.issues.map(i => `<div class="issue ${i.severity === 'block' ? 'error' : i.severity === 'warn' ? 'warn' : 'info'}"><b>${esc(i.name)}</b><span>${esc(i.reason)}</span></div>`).join('');
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-preflight-modal><div class="modal"><h2>Oyun açılmadan önce</h2><p class="sub">${esc(check.profile.name)} · ${esc(check.profile.gameVersion)} · ${esc(check.profile.loader)} — ${check.blockingModIds.length} mod bu profil ile uyuşmuyor. Uyuşan modlar oyunun hiç pencere açmadan kapanmasına yol açabilir.</p><div class="version-list">${rows}</div><div class="modal-actions"><button class="btn ghost" data-close>Vazgeç</button><button class="btn ghost" data-play-anyway>Yine de başlat</button><button class="btn primary" data-disable-play>Uyumsuz modları kapat ve başlat</button></div></div></div>`);
  const back = document.querySelector('[data-preflight-modal]');
  const close = () => back.remove();
  back.querySelector('[data-close]').onclick = close;
  back.addEventListener('click', e => { if (e.target === back) close(); });
  back.querySelector('[data-play-anyway]').onclick = () => { close(); launchWithMineVerse(check.profile.id, true); };
  back.querySelector('[data-disable-play]').onclick = async () => {
    back.remove();
    await disableIncompatibleMods(check.profile.id, check.blockingModIds);
    toast(`${check.blockingModIds.length} mod kapatıldı, oyun başlatılıyor…`);
    launchWithMineVerse(check.profile.id, true);
  };
}
async function saveKey() { try { state = await api.saveSettings({ curseForgeApiKey: q('#curse-key').value.trim() }); toast('CurseForge anahtarı yerelde kaydedildi.'); } catch (error) { toast(error.message, true); } }
async function saveDefaults() { try { state = await api.saveSettings({ defaultGameVersion: q('#default-version').value, defaultLoader: q('#default-loader').value }); toast('Varsayılanlar kaydedildi.'); } catch (error) { toast(error.message, true); } }
function confirmResetAll() {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-reset-modal><div class="modal"><h2>Her şeyi sıfırla?</h2><p>Tüm profiller, indirilen modlar ve ayarlar kalıcı olarak silinecek. Bu işlem <b style="color:#ffb0bd">geri alınamaz</b>. Onaylamak için aşağıya <b>SİL</b> yaz.</p><input class="form-input" id="reset-confirm-input" placeholder="SİL" style="margin-top:10px"><div class="modal-actions"><button class="btn ghost" data-close>Vazgeç</button><button class="btn danger" id="reset-confirm-btn" disabled>Her şeyi sil</button></div></div></div>`);
  const backdrop = q('[data-reset-modal]');
  const input = q('#reset-confirm-input'); const confirmBtn = q('#reset-confirm-btn');
  input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim().toUpperCase() !== 'SİL'; });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-close]').onclick = () => backdrop.remove();
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true; confirmBtn.textContent = 'Siliniyor…';
    try { state = await api.resetAll(); currentProfileId = state.profiles[0]?.id || null; storageInfo = null; backdrop.remove(); page = 'home'; render(); toast('Her şey sıfırlandı.'); }
    catch (error) { toast(error.message, true); backdrop.remove(); }
  };
}
async function refreshVersions() { toast('Mojang’dan güncel sürüm listesi çekiliyor…'); try { mcVersions = await api.getMinecraftVersions(true); render(); toast(`${mcVersions.releases.length} sürüm yüklendi.`); } catch (error) { toast(error.message, true); } }
async function exportPackClick() { const profileId = q('#pack-profile').value; const name = q('#pack-name').value.trim(); const summary = q('#pack-summary').value.trim(); toast('Paket oluşturuluyor…'); try { const result = await api.exportPack(profileId, { name, summary }); if (result.canceled) return; toast(`Paket hazır: ${result.modCount} mod → ${result.path}`); } catch (error) { toast(error.message, true); } }
async function importPackClick() { toast('Paket içe aktarılıyor…'); try { state = await api.importPack(); currentProfileId = state.profiles[state.profiles.length - 1]?.id || currentProfileId; render(); toast('Paket yeni bir profil olarak eklendi.'); } catch (error) { toast(error.message, true); } }

async function checkUpdates(profileId) {
  updateChecking = true; render();
  try { const updates = await api.checkModUpdates(profileId); updateResults = { profileId, updates }; toast(updates.length ? `${updates.length} mod için güncelleme bulundu.` : 'Tüm modlar güncel.'); }
  catch (error) { toast(error.message, true); }
  updateChecking = false; render();
}
async function applyUpdate(projectId, versionId) {
  const profile = selectedProfile();
  if (!profile) return;
  toast('Güncelleniyor…');
  try { await api.installModrinth(profile.id, projectId, versionId); state = await api.getState(); updateResults = null; render(); toast('Mod güncellendi.'); }
  catch (error) { toast(error.message, true); }
}

async function openPreview(sourceName, id, kind = 'mod') {
  previewData = { loading: true, source: sourceName, id, kind };
  renderPreviewModal();
  try { const details = await api.getModDetails(sourceName, id); previewData = { loading: false, kind, ...details }; }
  catch (error) { previewData = { loading: false, error: error.message, source: sourceName, id, kind }; }
  renderPreviewModal();
}

function renderPreviewModal() {
  q('[data-preview-modal]')?.remove();
  if (!previewData) return;
  const body = previewData.loading
    ? `<div class="empty"><span class="loader"></span> Mod detayları yükleniyor…</div>`
    : previewData.error
      ? `<div class="empty">Detaylar alınamadı: ${esc(previewData.error)}</div>`
      : `<div class="preview-head">${previewData.icon ? `<img class="mod-icon-lg" src="${esc(previewData.icon)}">` : '<div class="mod-icon-lg">◈</div>'}<div><h2>${esc(previewData.title)}</h2><span class="source">${esc(previewData.source)} · ↓ ${number(previewData.downloads)}${previewData.followers ? ` · ${number(previewData.followers)} takipçi` : ''}</span></div></div>${previewData.gallery?.length ? `<div class="gallery">${previewData.gallery.slice(0,6).map(url=>`<img src="${esc(url)}" loading="lazy">`).join('')}</div>` : ''}<div class="tags" style="margin:12px 0">${(previewData.categories||[]).map(tag=>`<span class="tag">${esc(tag)}</span>`).join('')}</div><div class="preview-body">${renderBody(previewData.body || previewData.summary)}</div>`;
  const footer = (previewData.loading || previewData.error) ? `<div class="modal-actions"><button class="btn ghost" data-close>Kapat</button></div>` : `<div class="modal-actions"><button class="btn ghost" data-close>Kapat</button><button class="btn primary" data-open-picker>⇩ Sürüm seç ve ${previewData.kind === 'mod' ? 'indir' : 'kaydet'}</button></div>`;
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-preview-modal><div class="modal modal-lg">${body}${footer}</div></div>`);
  const backdrop = q('[data-preview-modal]');
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closePreview(); });
  backdrop.querySelector('[data-close]')?.addEventListener('click', closePreview);
  backdrop.querySelector('[data-open-picker]')?.addEventListener('click', () => openPicker(previewData, previewData.kind || 'mod'));
}
function closePreview() { previewData = null; q('[data-preview-modal]')?.remove(); }

function openPicker(mod, kind = 'mod') {
  if (!mod.versions?.length) { toast('Bu içerik için indirilebilir sürüm bulunamadı.', true); return; }
  const profile = selectedProfile();
  if (kind === 'mod' && !profile) { toast('Önce bir profil oluştur.', true); return; }
  const allLoaders = [...new Set(mod.versions.flatMap(v => v.loaders || []))].filter(Boolean);
  const allGameVersionsRaw = [...new Set(mod.versions.flatMap(v => v.gameVersions || []))];
  const orderedVersions = mcVersions.releases.length ? mcVersions.releases.filter(v => allGameVersionsRaw.includes(v)) : allGameVersionsRaw;
  pickerLoader = profile && allLoaders.includes(profile.loader.toLowerCase()) ? profile.loader.toLowerCase() : (allLoaders[0] || '');
  pickerVersion = profile && orderedVersions.includes(profile.gameVersion) ? profile.gameVersion : (orderedVersions[0] || '');
  pickerData = { mod, allLoaders, orderedVersions, kind };
  renderPicker();
}

function pickerActionButtons(v) {
  const { kind, mod } = pickerData;
  const busy = pickerBusy === v.id;
  if (kind === 'mod') return `<button class="btn primary row-action" data-install-version="${esc(v.id)}" ${busy?'disabled':''}>${busy?'İndiriliyor…':'Bu sürümü ekle'}</button>`;
  const importBtn = kind === 'modpack' && mod.source === 'Modrinth' ? `<button class="btn success row-action" data-import-version="${esc(v.id)}" ${busy?'disabled':''}>İçe aktar</button>` : '';
  return `${importBtn}<button class="btn primary row-action" data-download-version="${esc(v.id)}" ${busy?'disabled':''}>${busy?'İndiriliyor…':'⇩ Dosyayı kaydet'}</button>`;
}
function renderPicker() {
  q('[data-picker-modal]')?.remove();
  if (!pickerData) return;
  const { mod, allLoaders, orderedVersions, kind } = pickerData;
  const matches = mod.versions.filter(v => (!pickerLoader || (v.loaders||[]).includes(pickerLoader)) && (!pickerVersion || (v.gameVersions||[]).includes(pickerVersion))).sort((a,b) => new Date(b.datePublished||0) - new Date(a.datePublished||0));
  const kindNote = kind === 'mod' ? '' : `<p class="note">${PICKER_KIND_TR[kind] || 'İçerik'} profil yerine oyun klasörüne kaydedilir${kind === 'world' ? ' (saves)' : kind === 'shader' ? ' (shaderpacks)' : kind === 'resourcepack' ? ' (resourcepacks)' : ''}. Bağlı launcher klasörü varsa doğru alt klasör önerilir.</p>`;
  const html = `<div class="modal-backdrop" data-picker-modal><div class="modal modal-lg"><h2>${esc(mod.title)} — sürüm seç</h2><p>Yükleyici ve Minecraft sürümüne göre uygun dosyayı seç, tıpkı Modrinth'te olduğu gibi.</p>${kindNote}<div class="form-row"><div><label class="form-label">YÜKLEYİCİ</label><select id="picker-loader" class="form-input">${allLoaders.length ? allLoaders.map(l => `<option value="${l}" ${l===pickerLoader?'selected':''}>${l.charAt(0).toUpperCase()+l.slice(1)}</option>`).join('') : '<option value="">Bulunamadı</option>'}</select></div><div><label class="form-label">MINECRAFT SÜRÜMÜ</label><select id="picker-version" class="form-input">${orderedVersions.length ? orderedVersions.map(v => `<option value="${v}" ${v===pickerVersion?'selected':''}>${v}</option>`).join('') : '<option value="">Bulunamadı</option>'}</select></div></div><div class="version-list">${matches.length ? matches.map(v => `<div class="mod-row"><div class="profile-symbol">◫</div><div><b>${esc(v.name || v.versionNumber)}</b><span>${esc(v.versionNumber)} · ${(v.loaders||[]).join(', ')} · ${dateTr(v.datePublished)}</span></div>${pickerActionButtons(v)}</div>`).join('') : `<div class="empty">Bu yükleyici/sürüm kombinasyonu için dosya yok. Farklı bir seçim dene.</div>`}</div><div class="modal-actions"><button class="btn ghost" data-close>Kapat</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const backdrop = q('[data-picker-modal]');
  backdrop.addEventListener('click', event => { if (event.target === backdrop) closePicker(); });
  backdrop.querySelector('[data-close]')?.addEventListener('click', closePicker);
  q('#picker-loader').addEventListener('change', event => { pickerLoader = event.target.value; renderPicker(); });
  q('#picker-version').addEventListener('change', event => { pickerVersion = event.target.value; renderPicker(); });
  document.querySelectorAll('[data-install-version]').forEach(button => button.onclick = () => installPickedVersion(button.dataset.installVersion));
  document.querySelectorAll('[data-download-version]').forEach(button => button.onclick = () => savePickedVersion(button.dataset.downloadVersion));
  document.querySelectorAll('[data-import-version]').forEach(button => button.onclick = () => importPickedVersion(button.dataset.importVersion));
}
function closePicker() { pickerData = null; q('[data-picker-modal]')?.remove(); }
function pickedVersionFile(versionId) {
  const v = pickerData.mod.versions.find(item => String(item.id) === String(versionId));
  const file = v?.files?.find(f => f.primary) || v?.files?.[0];
  return { version: v, file };
}
const PICKER_KIND_TR = { modpack: 'Paket', shader: 'Shader', resourcepack: 'Kaynak paketi', world: 'Dünya' };

async function savePickedVersion(versionId) {
  const { kind } = pickerData;
  const { file } = pickedVersionFile(versionId);
  if (!file?.url) { toast('Bu sürüm için indirme bağlantısı bulunamadı.', true); return; }
  pickerBusy = versionId; renderPicker();
  try {
    const result = await api.downloadContentFile(file.url, file.filename || 'icerik.zip', kind);
    if (!result.canceled) toast(`${PICKER_KIND_TR[kind] || 'Dosya'} kaydedildi: ${result.path}`);
    closePicker(); closePreview();
  } catch (error) { toast(error.message, true); }
  pickerBusy = ''; renderPicker();
}
async function importPickedVersion(versionId) {
  const { file } = pickedVersionFile(versionId);
  if (!file?.url) { toast('Bu sürüm için indirme bağlantısı bulunamadı.', true); return; }
  pickerBusy = versionId; renderPicker();
  toast('Paket indirilip içe aktarılıyor…');
  try {
    state = await api.importPackFromUrl(file.url, file.filename || 'paket.mrpack');
    closePicker(); closePreview(); render();
    toast('Paket yeni bir profil olarak içe aktarıldı.');
  } catch (error) { toast(error.message, true); pickerBusy = ''; renderPicker(); }
}

async function installPickedVersion(versionId) {
  const profile = selectedProfile();
  const { mod } = pickerData;
  pickerBusy = versionId; renderPicker();
  toast('Mod indiriliyor ve doğrulanıyor…');
  try {
    if (mod.source === 'Modrinth') await api.installModrinth(profile.id, mod.id, versionId);
    else await api.installCurseForge(profile.id, mod.id, versionId);
    state = await api.getState();
    closePicker(); closePreview(); render();
    toast('Mod profile eklendi.');
  } catch (error) { toast(error.message, true); pickerBusy = ''; renderPicker(); }
}

function iconPickerHtml(currentType, currentValue, photoOnly = false) {
  const type = photoOnly ? 'custom' : (currentType || 'block');
  if (photoOnly) {
    const hasPhoto = currentType === 'custom' && currentValue;
    return `<div class="icon-picker"><div class="icon-panel" data-icon-panel="custom">${hasPhoto ? `<img class="custom-preview" src="${toFileUrl(currentValue)}" alt="">` : ''}<button type="button" class="btn ghost" data-icon-upload>📁 ${hasPhoto ? 'Fotoğrafı değiştir' : 'Bilgisayardan fotoğraf seç'}</button></div><input type="hidden" name="iconType" value="custom"><input type="hidden" name="iconValue" value="${hasPhoto ? esc(currentValue) : ''}"></div>`;
  }
  return `<div class="icon-picker">
    <div class="icon-tabs">
      <button type="button" class="icon-tab ${type==='block'?'active':''}" data-icon-tab="block">${ic('card-blocks')} Bloklar</button>
      <button type="button" class="icon-tab ${type==='fun'?'active':''}" data-icon-tab="fun">${ic('nav-ai')} Eğlenceli</button>
      <button type="button" class="icon-tab ${type==='image'?'active':''}" data-icon-tab="image">${ic('card-wallpapers')} Görseller</button>
      <button type="button" class="icon-tab ${type==='custom'?'active':''}" data-icon-tab="custom">${ic('card-assets')} Kendi fotoğrafın</button>
    </div>
    <div class="icon-panel" data-icon-panel="block" style="${type!=='block'?'display:none':''}"><div class="icon-grid">${BLOCK_ICONS.map(b=>`<button type="button" class="icon-swatch ${type==='block'&&currentValue===b?'selected':''}" data-icon-pick="block:${b}" title="${BLOCK_LABELS_TR[b]}"><img src="assets/blocks/${b}.png" alt=""></button>`).join('')}</div><span class="form-label" style="display:block;margin:14px 0 6px">İZOMETRİK KÜPLER</span><div class="icon-grid icon-grid-iso">${BLOCK_ICONS.map(b=>`<button type="button" class="icon-swatch iso ${type==='block'&&currentValue==='iso:'+b?'selected':''}" data-icon-pick="block:iso:${b}" title="${BLOCK_LABELS_TR[b]} (3B)"><img ${isoIconCache.has(b)?`src="${isoIconCache.get(b)}"`:''} alt=""></button>`).join('')}</div></div>
    <div class="icon-panel" data-icon-panel="fun" style="${type!=='fun'?'display:none':''}"><div class="icon-grid">${FUN_ICONS.map(e=>`<button type="button" class="icon-swatch fun ${type==='fun'&&currentValue===e?'selected':''}" data-icon-pick="fun:${e}">${e}</button>`).join('')}</div></div>
    <div class="icon-panel" data-icon-panel="image" style="${type!=='image'?'display:none':''}"><div class="icon-grid icon-grid-img">${MC_PROFILE_IMAGES.map(m=>`<button type="button" class="icon-swatch img ${type==='image'&&currentValue===m.value?'selected':''}" data-icon-pick="image:${m.value}" title="${m.label}"><img src="${m.value}" alt=""></button>`).join('')}</div></div>
    <div class="icon-panel" data-icon-panel="custom" style="${type!=='custom'?'display:none':''}">${type==='custom'&&currentValue ? `<img class="custom-preview" src="${toFileUrl(currentValue)}" alt="">` : ''}<button type="button" class="btn ghost" data-icon-upload>📁 ${type==='custom'&&currentValue?'Değiştir':'Bilgisayardan seç'}</button></div>
    <input type="hidden" name="iconType" value="${type}"><input type="hidden" name="iconValue" value="${esc(currentValue || (type==='block'?'grass':''))}">
  </div>`;
}
function bindIconPicker(container) {
  const typeInput = container.querySelector('[name="iconType"]');
  const valueInput = container.querySelector('[name="iconValue"]');
  container.querySelectorAll('[data-icon-tab]').forEach(tab => tab.onclick = () => {
    container.querySelectorAll('[data-icon-tab]').forEach(t => t.classList.toggle('active', t === tab));
    container.querySelectorAll('[data-icon-panel]').forEach(panel => panel.style.display = panel.dataset.iconPanel === tab.dataset.iconTab ? '' : 'none');
  });
  container.querySelectorAll('[data-icon-pick]').forEach(swatch => swatch.onclick = () => {
    const [type, ...rest] = swatch.dataset.iconPick.split(':');
    typeInput.value = type; valueInput.value = rest.join(':');
    swatch.closest('.icon-panel').querySelectorAll('.icon-swatch').forEach(s => s.classList.toggle('selected', s === swatch));
  });
  const uploadBtn = container.querySelector('[data-icon-upload]');
  if (uploadBtn) uploadBtn.onclick = async () => {
    const filePath = await api.uploadProfileIcon();
    if (!filePath) return;
    typeInput.value = 'custom'; valueInput.value = filePath;
    container.querySelector('[data-icon-panel="custom"]').innerHTML = `<img class="custom-preview" src="${toFileUrl(filePath)}" alt=""><button type="button" class="btn ghost" data-icon-upload>📁 Değiştir</button>`;
    bindIconPicker(container);
  };
}
function profileModal() {
  const defaultVersion = state.settings.defaultGameVersion;
  const defaultLoader = state.settings.defaultLoader;
  const versionOptions = (mcVersions.releases.length ? mcVersions.releases : ['1.21.1','1.20.1','1.19.2']).map(v => `<option ${v===defaultVersion?'selected':''}>${v}</option>`).join('');
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop"><form class="modal modal-lg" id="profile-form"><h2>Yeni mod profili</h2><p>Bir oyun sürümü, mod yükleyicisi ve profil simgesi seç.</p><label class="form-label">PROFİL ADI</label><input class="form-input" name="name" placeholder="Örn. Korku Macerası" required><div class="form-row"><div><label class="form-label">MINECRAFT</label><select class="form-input" name="gameVersion">${versionOptions}</select></div><div><label class="form-label">YÜKLEYİCİ</label><select class="form-input" name="loader">${loaderOptions.map(l => `<option ${l===defaultLoader?'selected':''}>${l}</option>`).join('')}</select></div></div><label class="form-label" style="margin-top:16px">PROFİL SİMGESİ</label>${iconPickerHtml('block','grass')}<div class="modal-actions"><button class="btn ghost" type="button" data-close>Vazgeç</button><button class="btn primary">Profili oluştur</button></div></form></div>`);
  bindIconPicker(q('.icon-picker'));
  q('[data-close]').onclick = () => q('.modal-backdrop').remove();
  q('#profile-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const draft = Object.fromEntries(form);
    const icon = { type: draft.iconType, value: draft.iconValue };
    try { state = await api.createProfile({ name: draft.name, gameVersion: draft.gameVersion, loader: draft.loader, icon }); currentProfileId = state.profiles[state.profiles.length - 1].id; q('.modal-backdrop').remove(); render(); toast('Yeni profil hazır.'); } catch (error) { toast(error.message, true); }
  };
}

/* ---------------- Komut paleti (Ctrl+K) ---------------- */
let cmdkOpen = false, cmdkIndex = 0, cmdkQuery = '';
function commandList() {
  const profile = selectedProfile();
  const go = target => () => { page = target; document.querySelectorAll('[data-page]').forEach(item => item.classList.toggle('active', item.dataset.page === page)); render(); maybeAutoLoadDiscover(); };
  const cmds = [
    { icon: '⌂', label: 'Ana sayfaya git', hint: 'Sayfa', run: go('home') },
    { icon: '◈', label: 'Keşfet: modlar', hint: 'Sayfa', run: () => { discoverType = 'mod'; go('discover')(); } },
    { icon: '📦', label: 'Keşfet: mod paketleri', hint: 'Sayfa', run: () => { discoverType = 'modpack'; go('discover')(); } },
    { icon: '🌈', label: 'Keşfet: shaderlar', hint: 'Sayfa', run: () => { discoverType = 'shader'; go('discover')(); } },
    { icon: '🎨', label: 'Keşfet: kaynak paketleri', hint: 'Sayfa', run: () => { discoverType = 'resourcepack'; go('discover')(); } },
    { icon: '🌍', label: 'Keşfet: dünyalar', hint: 'Sayfa', run: () => { discoverType = 'world'; go('discover')(); } },
    { icon: '✦', label: 'AI önerici', hint: 'Sayfa', run: go('ai') },
    { icon: '▦', label: 'Kütüphaneye git', hint: 'Sayfa', run: go('library') },
    { icon: '◇', label: 'Paket oluştur / içe aktar', hint: 'Sayfa', run: go('packs') },
    { icon: '◉', label: 'Launcher bağla', hint: 'Sayfa', run: go('launchers') },
    { icon: '☺', label: 'Arkadaşlar', hint: 'Sayfa', run: go('friends') },
    { icon: '☻', label: 'Hesabım (skinler dahil)', hint: 'Sayfa', run: go('account') },
    { icon: '⚙', label: 'Ayarlar', hint: 'Sayfa', run: go('settings') },
    { icon: '＋', label: 'Yeni profil oluştur', hint: 'Eylem', run: () => profileModal() },
    { icon: '⌕', label: 'Launcherları otomatik algıla', hint: 'Eylem', run: () => detect() },
    { icon: '⧉', label: 'Aktif profili klonla', hint: 'Eylem', run: async () => { if (profile) { state = await api.duplicateProfile(profile.id); render(); toast('Profil klonlandı.'); } else toast('Önce bir profil oluştur.', true); } },
    { icon: '↥', label: 'Yerel .jar mod ekle', hint: 'Eylem', run: () => { if (profile) doImport(profile.id); else toast('Önce bir profil oluştur.', true); } },
    { icon: '⟳', label: 'Güncellemeleri kontrol et', hint: 'Eylem', run: () => { if (profile) checkUpdates(profile.id); else toast('Önce bir profil oluştur.', true); } },
    { icon: '🛟', label: 'Şimdi yedek al', hint: 'Eylem', run: async () => { try { await api.backupsCreate(); toast('Yedek alındı.'); } catch (error) { toast(error.message, true); } } },
    { icon: '☕', label: 'Java durumunu yenile', hint: 'Eylem', run: () => { if (typeof loadJavaInfo === 'function') loadJavaInfo(true); toast('Java taraması başladı.'); } }
  ];
  return cmds;
}
function cmdkFiltered() {
  const query = cmdkQuery.toLowerCase();
  const all = commandList();
  return query ? all.filter(c => c.label.toLowerCase().includes(query)) : all;
}
function renderCmdk() {
  q('[data-cmdk]')?.remove();
  if (!cmdkOpen) return;
  const items = cmdkFiltered();
  if (cmdkIndex >= items.length) cmdkIndex = 0;
  document.body.insertAdjacentHTML('beforeend', `<div class="cmdk-backdrop" data-cmdk><div class="cmdk"><input id="cmdk-input" placeholder="Komut ya da sayfa ara… (Enter: çalıştır, Esc: kapat)" value="${esc(cmdkQuery)}" autocomplete="off"><div class="cmdk-list">${items.length ? items.map((c, i) => `<button class="cmdk-item ${i === cmdkIndex ? 'active' : ''}" data-cmdk-run="${i}"><span>${c.icon}</span>${esc(c.label)}<small>${esc(c.hint)}</small></button>`).join('') : '<div class="empty" style="padding:14px">Eşleşen komut yok.</div>'}</div><div class="cmdk-foot">↑↓ ile gez · Enter ile çalıştır · Ctrl+K ile aç/kapat</div></div></div>`);
  const back = q('[data-cmdk]');
  back.addEventListener('click', event => { if (event.target === back) { cmdkOpen = false; renderCmdk(); } });
  const input = q('#cmdk-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener('input', () => { cmdkQuery = input.value; cmdkIndex = 0; const pos = input.selectionStart; renderCmdk(); const next = q('#cmdk-input'); next.focus(); next.setSelectionRange(pos, pos); });
  input.addEventListener('keydown', event => {
    const items = cmdkFiltered();
    if (event.key === 'ArrowDown') { event.preventDefault(); cmdkIndex = Math.min(items.length - 1, cmdkIndex + 1); const pos = input.selectionStart; renderCmdk(); const next = q('#cmdk-input'); next.focus(); next.setSelectionRange(pos, pos); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); cmdkIndex = Math.max(0, cmdkIndex - 1); const pos = input.selectionStart; renderCmdk(); const next = q('#cmdk-input'); next.focus(); next.setSelectionRange(pos, pos); }
    else if (event.key === 'Enter') { event.preventDefault(); if (items[cmdkIndex]) { const run = items[cmdkIndex].run; cmdkOpen = false; cmdkQuery = ''; renderCmdk(); run(); } }
  });
  document.querySelectorAll('[data-cmdk-run]').forEach(button => button.onclick = () => { const item = cmdkFiltered()[+button.dataset.cmdkRun]; if (item) { cmdkOpen = false; cmdkQuery = ''; renderCmdk(); item.run(); } });
}
function toggleCmdk() { cmdkOpen = !cmdkOpen; cmdkQuery = ''; cmdkIndex = 0; renderCmdk(); }

async function bootstrap() {
  try {
    state = await api.getState();
    currentProfileId = state.profiles[0]?.id || null;
    themeName = state.settings.theme || 'nebula';
    accentColor = state.settings.accent || '#f0b429';
    applyTheme(themeName, accentColor);
    applyBackground(state.settings);
    if (typeof loadUiIcons === 'function') await loadUiIcons();
    hydrateIcons(document);
    render();
    ensureIsoIcons();
    loadVersionsInBackground();
    if (typeof loadAccountInfo === 'function') loadAccountInfo();
    if (typeof featuresAutoLoad === 'function') featuresAutoLoad();
  } catch (error) {
    main.innerHTML = `<div class="boot-screen"><div class="load-error"><h3>MineVerse başlatılamadı</h3><p>${esc(error.message)}</p><button class="btn primary" id="retry-boot">↻ Tekrar dene</button> <button class="btn ghost" id="reset-boot">Verileri sıfırla</button></div></div>`;
    q('#reset-boot')?.addEventListener('click', async () => { if (confirm('Tüm profiller ve ayarlar silinecek (önce otomatik yedek alınır). Devam edilsin mi?')) { try { await api.resetAll(); } catch {} bootstrap(); } });
    q('#retry-boot')?.addEventListener('click', () => { main.innerHTML = `<div class="boot-screen"><img src="assets/logo-256.png" alt="MineVerse"><div class="boot-spinner"></div><p>Tekrar deneniyor…</p></div>`; bootstrap(); });
  }
}
async function loadVersionsInBackground() {
  try {
    mcVersions = await api.getMinecraftVersions();
    if (page === 'discover' || page === 'home' || page === 'ai') render();
  } catch { toast('Minecraft sürüm listesi alınamadı; internet bağlantını kontrol et.', true); }
}
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleCmdk(); }
  else if (event.key === 'Escape' && cmdkOpen) { cmdkOpen = false; renderCmdk(); }
});
document.querySelector('#win-min')?.addEventListener('click', () => api.windowMinimize());
document.querySelector('#win-max')?.addEventListener('click', async () => {
  const maximized = await api.windowToggleMaximize();
  document.querySelector('#win-max').textContent = maximized ? '❐' : '▢';
});
document.querySelector('#win-close')?.addEventListener('click', () => api.windowClose());
api.onLaunchProgress?.(payload => {
  launchState.progress = payload;
  if (payload.phase === 'exit' || payload.phase === 'error') { launchState.running = false; toast(payload.label || 'Oyun kapandı.', payload.phase === 'error'); }
  if (payload.phase === 'spawn') launchState.running = true;
  if (typeof renderLaunchProgress === 'function') renderLaunchProgress();
});

bootstrap();
