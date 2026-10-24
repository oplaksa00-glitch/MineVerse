/* MineVerse ikon kayıt sistemi (v0.9).
   Arayüzdeki her ikon bir ANAHTARDIR ve tek yerden yönetilir: bu dosya.
   IC('nav-home') çağrısı şunu yapar:
     1) assets/ui/nav-home.png  VEYA  özel görsel klasöründeki ui/nav-home.png varsa -> <img>
     2) yoksa aşağıdaki ICON_FALLBACK emojisini -> <span>
   Yani fotoğraf eklemek için resmi "ui/nav-home.png" adıyla özel görsel klasörüne
   atman yeterlidir; kodu değiştirmene gerek yok. (npm run asset -- ui:nav-home ./resim.png
   ile kaynak koduna da yazabilirsin.) Tam anahtar listesi: npm run icons */

const ICON_FALLBACK = {
  // --- kenar çubuğu gezinme ---
  'nav-home': '⌂', 'nav-discover': '◈', 'nav-ai': '✦', 'nav-library': '▦',
  'nav-packs': '◇', 'nav-launchers': '◉', 'nav-friends': '☺', 'nav-account': '☻', 'nav-settings': '⚙',
  // --- eylemler ---
  'act-play': '▶', 'act-download': '⇩', 'act-add': '＋', 'act-refresh': '⟳', 'act-delete': '🗑',
  'act-share': '🔗', 'act-copy': '⧉', 'act-search': '⌕', 'act-open': '→', 'act-upload': '↥',
  'act-close': '✕', 'act-check': '✓', 'act-arrow': '›', 'act-star': '✨', 'act-back': '←',
  'act-analyze': '🔍', 'act-pack': '📦', 'act-export': '📤', 'act-import': '📥', 'act-code': '🆔',
  // --- durum ---
  'st-error': '⛔', 'st-warn': '⚠️', 'st-info': 'ℹ️', 'st-ok': '✅', 'st-update': '↑',
  'st-bell': '🔔', 'st-disabled': '⏻', 'st-local': '↥', 'st-frompack': '◇', 'st-mod': '◈',
  // --- ayarlar / bölüm kartları ---
  'card-account': '👤', 'card-theme': '🎨', 'card-defaults': '🧩', 'card-curse': '🔑',
  'card-versions': '🌍', 'card-storage': '💾', 'card-about': 'ℹ️', 'card-danger': '⚠️',
  'card-java': '☕', 'card-backup': '🛟', 'card-assets': '🖼️', 'card-news': '📰',
  'card-friends': '👥', 'card-inbox': '📬', 'card-launch': '🚀', 'card-blocks': '🧱',
  'card-play-mode': '🎮', 'card-deps': '🧬', 'card-uuid': '🪪', 'card-accounts': '🗂️',
  'card-code': '🏷️', 'card-export': '📦', 'card-import': '📥',
  'card-skins': '🧍', 'card-wallpapers': '🌌', 'card-badges': '🏆', 'card-palette': '⌘',
  'card-duplicate': '⧉'
};

let uiIconSet = null;

function ic(key, extraClass = '') {
  const known = Object.prototype.hasOwnProperty.call(ICON_FALLBACK, key);
  const glyph = known ? ICON_FALLBACK[key] : '◈';
  if (uiIconSet && uiIconSet.has(key)) return `<img class="ui-icon ${extraClass}" src="assets/ui/${key}.png" alt="" draggable="false">`;
  return `<span class="ui-emoji ${extraClass}">${glyph}</span>`;
}
function icLabel(key, text, extraClass = '') { return `${ic(key, extraClass)}<span>${text}</span>`; }

async function loadUiIcons(force = false) {
  try { uiIconSet = new Set(await window.mineverse.getUiIcons(!!force)); }
  catch { uiIconSet = null; }
  return uiIconSet;
}

/* Statik HTML'deki <i data-ic="nav-home"></i> yerlerini doldurur. */
function hydrateIcons(root = document, force = false) {
  const nodes = [...(root.querySelectorAll ? root.querySelectorAll('[data-ic]') : [])];
  if (root instanceof HTMLElement && root.hasAttribute?.('data-ic')) nodes.push(root);
  for (const node of nodes) {
    if (!force && node.dataset.icDone === '1') continue;
    node.innerHTML = ic(node.dataset.ic, node.dataset.icClass || '');
    node.dataset.icDone = '1';
  }
}
function iconKeyList() { return Object.keys(ICON_FALLBACK); }
