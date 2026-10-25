/* MineVerse v0.9 hesap sistemi.
   Her hesabın iki kimliği vardır:
   - MV kodu  : kalıcı hesap UUID'sinden türetilir, ASLA değişmez. Arkadaşların sana
                paket gönderirken kullandığı adres budur.
   - Oyun UUID: görünen adından türetilir (md5("OfflinePlayer:"+ad)). Adını değiştirirsen
                bu da değişir; Minecraft ilerlemesi adınla eşleştiği için bu beklenen davranıştır. */
let accountData = null, accountLoading = false;
let skinsData = null, skinsLoading = false, selectedSkinKey = '';
const mvAccount = () => window.mineverse;

/* ---------------- Skinler: paperdoll önizleme + galeri ---------------- */
function skinListFlat() {
  if (!skinsData) return [];
  return [
    ...skinsData.builtin.map(b => ({ key: `b:${b.name}`, name: b.name, dataUrl: b.dataUrl, builtin: true })),
    ...skinsData.custom.map(c => ({ key: `c:${c.name}`, name: c.name, dataUrl: c.dataUrl, builtin: false }))
  ];
}
function selectedSkin() {
  const all = skinListFlat();
  if (!all.length) return null;
  return all.find(s => s.key === selectedSkinKey) || all[0];
}
async function loadSkins(force = false) {
  if (skinsLoading) return skinsData;
  skinsLoading = true;
  try { skinsData = await mvAccount().listSkins(); if (force) selectedSkinKey = selectedSkinKey && skinListFlat().some(s => s.key === selectedSkinKey) ? selectedSkinKey : ''; }
  catch (error) { skinsData = null; if (force) toast(error.message, true); }
  skinsLoading = false;
  if (page === 'account') render();
  return skinsData;
}
/* Minecraft skin yerleşiminden önden görünüm çizer (64x64 ve eski 64x32 biçimi). */
function drawSkinToCanvas(canvas, img) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const S = canvas.width / 16;
  const px = (sx, sy, sw, sh, dx, dy) => ctx.drawImage(img, sx, sy, sw, sh, dx * S, dy * S, sw * S, sh * S);
  const legacy = img.naturalHeight === 32;
  px(8, 8, 8, 8, 4, 0);       // kafa
  px(40, 8, 8, 8, 4, 0);      // şapka katmanı
  px(20, 20, 8, 12, 4, 8);    // gövde
  if (legacy) {
    px(44, 20, 4, 12, 0, 8);  // sağ kol (tek kol dokusu)
    px(44, 20, 4, 12, 12, 8); // sol kol aynı doku
    px(4, 20, 4, 12, 4, 20);  // bacaklar aynı doku
    px(4, 20, 4, 12, 8, 20);
  } else {
    px(36, 52, 4, 12, 0, 8);  // sağ kol
    px(44, 20, 4, 12, 12, 8); // sol kol
    px(4, 20, 4, 12, 4, 20);  // sağ bacak
    px(20, 52, 4, 12, 8, 20); // sol bacak
  }
}

/* ---------------- 3B skin görüntüleyici ----------------
   Skin dokusundaki kutuları (kafa/gövde/kol/bacak) gerçek 3B köşelere
   dönüştürüp Y ekseninde döndürerek çizer; yüzler derinliğe göre sıralanır. */
const skinViewer = { angle: -0.6, spinning: true, raf: 0, img: null, dragging: false, lastX: 0, front: false };
const SKIN_BOXES = [
  { uv: [0, 0], size: [8, 8, 8], at: [0, 24, 0] },        // kafa
  { uv: [16, 16], size: [8, 12, 4], at: [0, 12, 0] },     // gövde
  { uv: [40, 16], size: [4, 12, 4], at: [-6, 12, 0] },    // sağ kol
  { uv: [40, 16], size: [4, 12, 4], at: [6, 12, 0], mirror: true }, // sol kol
  { uv: [0, 16], size: [4, 12, 4], at: [-2, 0, 0] },      // sağ bacak
  { uv: [0, 16], size: [4, 12, 4], at: [2, 0, 0], mirror: true }  // sol bacak
];
function skinFaceRect(box, face) {
  const [u, v] = box.uv, [w, h, d] = box.size;
  const x2 = w + 2 * d;
  const rects = {
    front: [u, v, w, h],
    back: [u + w + d, v, w, h],
    left: [u + w, v, d, h],
    right: [u + x2, v, d, h],
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d]
  };
  return rects[face];
}
function drawSkin3D(canvas, img) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = canvas.height / 44;
  const cx = canvas.width / 2, cy = canvas.height * 0.56;
  const cos = Math.cos(skinViewer.angle), sin = Math.sin(skinViewer.angle);
  const tilt = 0.16;
  const project = (x, y, z) => {
    const rx = x * cos + z * sin;
    const rz = -x * sin + z * cos;
    return { sx: cx + rx * scale, sy: cy - (y * Math.cos(tilt) - rz * Math.sin(tilt)) * scale, depth: rz * Math.cos(tilt) + y * Math.sin(tilt) };
  };
  /* yer gölgesi */
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 0.5 * scale, 7 * scale, 2.4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const light = { x: -0.45, y: 0.85, z: 0.6 };
  const quads = [];
  for (const box of SKIN_BOXES) {
    const [w, h, d] = box.size, [bx, by, bz] = box.at;
    const x0 = bx - w / 2, x1 = bx + w / 2, y0 = by, y1 = by + h, z0 = bz - d / 2, z1 = bz + d / 2;
    const V = { a: [x0, y1, z1], b: [x1, y1, z1], c: [x1, y0, z1], e: [x0, y0, z1], f: [x0, y1, z0], g: [x1, y1, z0], i: [x1, y0, z0], j: [x0, y0, z0] };
    const face = (name, corners, normal, flip) => {
      const pts = corners.map(k => project(...V[k]));
      const depth = pts.reduce((s, p) => s + p.depth, 0) / 4;
      const nd = normal[0] * cos + normal[2] * sin;
      const shadeLevel = Math.max(0.42, Math.min(1, 0.62 + 0.38 * (nd * light.x + normal[1] * light.y + (normal[2] * cos - normal[0] * sin) * light.z)));
      quads.push({ pts, rect: skinFaceRect(box, name), flip, depth, shade: shadeLevel });
    };
    face('front', ['a', 'b', 'c', 'e'], [0, 0, 1]);
    face('back', ['g', 'f', 'j', 'i'], [0, 0, -1]);
    face('right', ['b', 'g', 'i', 'c'], [1, 0, 0]);
    face('left', ['f', 'a', 'e', 'j'], [-1, 0, 0]);
    face('top', ['f', 'g', 'b', 'a'], [0, 1, 0]);
    face('bottom', ['e', 'c', 'i', 'j'], [0, -1, 0], true);
  }
  quads.sort((a, b) => a.depth - b.depth);
  for (const quad of quads) {
    const [sx, sy, sw, sh] = quad.rect;
    const dw = quad.flip ? sw : sw;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(quad.pts[0].sx, quad.pts[0].sy);
    ctx.lineTo(quad.pts[1].sx, quad.pts[1].sy);
    ctx.lineTo(quad.pts[2].sx, quad.pts[2].sy);
    ctx.lineTo(quad.pts[3].sx, quad.pts[3].sy);
    ctx.closePath();
    ctx.clip();
    const k = (quad.pts[1].sx - quad.pts[0].sx) / dw, m = (quad.pts[1].sy - quad.pts[0].sy) / dw;
    const n = (quad.pts[3].sx - quad.pts[0].sx) / sh, o = (quad.pts[3].sy - quad.pts[0].sy) / sh;
    ctx.setTransform(k, m, n, o, quad.pts[0].sx, quad.pts[0].sy);
    ctx.drawImage(img, sx, sy, dw, sh, 0, 0, dw, sh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${(1 - quad.shade).toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
}
function skinViewerFrame() {
  if (!skinViewer.spinning || skinViewer.dragging || page !== 'account') { skinViewer.raf = 0; return; }
  skinViewer.angle += 0.012;
  const canvas = q('#skin-preview-canvas');
  if (canvas && skinViewer.img) drawSkin3D(canvas, skinViewer.img);
  skinViewer.raf = requestAnimationFrame(skinViewerFrame);
}
function skinViewerStart() {
  if (!skinViewer.raf && skinViewer.spinning) skinViewer.raf = requestAnimationFrame(skinViewerFrame);
}
function skinHeadDataUrl(img) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
  ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
  return canvas.toDataURL('image/png');
}
function renderSkinPreview() {
  const canvas = q('#skin-preview-canvas');
  const skin = selectedSkin();
  if (!canvas || !skin) return;
  const label = q('#skin-preview-name');
  if (label) label.textContent = skin.name.replace(/\.png$/i, '').replace(/^[0-9a-f-]{8,}$/i, 'Yüklenen skin');
  const img = new Image();
  img.onload = () => {
    skinViewer.img = img;
    drawSkin3D(canvas, img);
    skinViewerStart();
  };
  img.src = skin.dataUrl;
}
function skinSectionHtml() {
  if (!skinsData) return `<section class="panel skin-panel"><h3>${ic('card-skins')} Skinlerim</h3><div class="empty"><span class="loader"></span> Skinler yükleniyor…</div></section>`;
  const all = skinListFlat();
  const sel = selectedSkin();
  const cells = all.map(s => `<button type="button" class="skin-cell ${sel && s.key === sel.key ? 'selected' : ''}" data-skin-pick="${esc(s.key)}" title="${esc(s.name)}"><img src="${esc(s.dataUrl)}" alt="${esc(s.name)}">${s.builtin ? '' : `<i class="skin-cell-del" data-skin-delete="${esc(s.name)}" title="Skin sil">${ic('act-close')}</i>`}</button>`).join('');
  const inGame = accountData?.active?.skin;
  const selBase = sel ? sel.name.replace(/\.png$/i, '') : '';
  const gameChip = inGame ? `<span class="chip ${inGame.name === selBase ? 'skin-live' : ''}" title="Oyunda şu an bu skin kullanılıyor">${inGame.name === selBase ? '▶ OYUNDA' : 'oyunda: ' + esc(inGame.name)}</span>` : '';
  return `<section class="panel skin-panel"><div class="section-head"><div><h3>${ic('card-skins')} Skinlerim</h3><p>Skinini 3B döner önizlemede incele, profil fotoğrafın yap ya da doğrudan oyuna aktar.</p></div><button class="btn ghost" data-skin-refresh>${ic('act-refresh')} Yenile</button></div><div class="skin-layout"><div class="skin-stage"><div class="skin-stage-top"><span class="chip">3B</span>${gameChip}<button class="mini-btn" data-skin-spin>${skinViewer.spinning ? '⏸ Döndürmeyi durdur' : '▶ Otomatik döndür'}</button></div><canvas id="skin-preview-canvas" width="220" height="330"></canvas><span class="skin-stage-hint">sürükleyerek kendin çevir</span><span class="skin-stage-name mono" id="skin-preview-name">${esc(sel ? sel.name : '—')}</span><div class="modal-actions" style="justify-content:center;flex-wrap:wrap"><button class="btn success" data-skin-apply-game ${sel ? '' : 'disabled'}>${ic('act-play')} Oyuna aktar</button><button class="btn primary" data-skin-avatar ${sel ? '' : 'disabled'}>${ic('card-account')} Profil fotoğrafı yap</button><button class="btn ghost" data-skin-upload>${ic('act-upload')} Skin yükle</button><button class="btn ghost" data-skin-folder>${ic('act-open')} Klasörü aç</button></div><p class="note" style="text-align:center">64×64 PNG skinler kabul edilir. "Oyuna aktar", skin'i MineVerse'ün başlattığı oyunun klasörüne yazar.</p></div><div class="skin-gallery">${all.length ? cells : '<div class="empty">Henüz skin yok. Hazır skinler pakete eklenince burada görünür; kendi skinini yükleyebilirsin.</div>'}</div></div></section>`;
}

async function loadAccountInfo(force = false) {
  if (accountLoading) return accountData;
  accountLoading = true;
  try { accountData = await mvAccount().accountList(); }
  catch (error) { accountData = null; if (force) toast(error.message, true); }
  accountLoading = false;
  if (accountData && page === 'account') render();
  return accountData;
}
function activeAccount() { return accountData?.active || null; }
function accountChipHtml(account) {
  const a = account || { displayName: 'Hesap yükleniyor…', icon: { type: 'block', value: 'grass' } };
  return `<button class="sidebar-account-chip" data-page="account">
    ${renderProfileIcon(a.icon, 'sm')}
    <div class="sidebar-account-text"><b>${esc(a.displayName)}</b><span class="mono">${esc(a.code || 'MV-····-····')}</span></div>
    <i class="sidebar-account-go" data-ic="act-open"></i>
  </button>`;
}

function identityRow(label, value, copyValue, hint) {
  return `<div class="identity-row"><div><span>${esc(label)}</span><b class="mono">${esc(value)}</b>${hint ? `<em>${esc(hint)}</em>` : ''}</div><button class="mini-btn" data-copy="${esc(copyValue)}">${ic('act-copy')} Kopyala</button></div>`;
}
function accountRowHtml(account) {
  const isActive = account.id === accountData.active.id;
  return `<div class="mod-row account-row ${isActive ? 'active' : ''}">
    ${renderProfileIcon(account.icon, 'sm')}
    <div class="account-row-main"><b>${esc(account.displayName)}</b><span class="mono">${esc(account.code)}</span><em>${account.lastUsedAt ? `son kullanım ${esc(dateTr(account.lastUsedAt))}` : 'henüz kullanılmadı'}</em></div>
    ${isActive ? `<span class="chip">AKTİF</span>` : `<button class="btn ghost row-action" data-account-use="${esc(account.id)}">Geç</button>`}
    <button class="btn ghost row-action" data-account-icon="${esc(account.id)}">${ic('card-theme')}</button>
    ${accountData.accounts.length > 1 ? `<button class="btn danger row-action" data-account-delete="${esc(account.id)}">${ic('act-delete')}</button>` : ''}
  </div>`;
}
function inboxRowHtml(item) {
  return `<div class="friend-row"><div class="friend-avatar">${ic('act-import')}</div><div><b>${esc(item.profileName)}</b><span>${esc(item.from)}${item.fromCode ? ` · ${esc(item.fromCode)}` : ''} → ${esc(item.toCode || '—')} · ${item.count} mod${item.failed ? ` · ${item.failed} hata` : ''} · ${esc(dateTr(item.at))}</span></div></div>`;
}

function accountPage() {
  const d = accountData;
  const header = pageHeader('Hesabım', 'Kalıcı kimliğin, MV kodun ve arkadaşlarına paket gönderirken kullanacağın adresin.', `<button class="btn ghost" data-account-refresh>${ic('act-refresh')} Yenile</button><button class="btn primary" data-account-new>${ic('act-add')} Yeni hesap</button>`);
  if (!d) return `${header}<div class="empty"><span class="loader"></span> Hesap bilgisi getiriliyor…</div>`;
  const a = d.active;
  return `${header}
  <section class="account-hero">
    <div class="account-hero-icon">${renderProfileIcon(a.icon, 'xl')}</div>
    <div class="account-hero-main">
      <div class="eyebrow">MINEVERSE KİMLİĞİ</div>
      <h2>${esc(a.displayName)}</h2>
      <div class="code-box big"><code>${esc(a.code)}</code><button class="btn ghost" data-copy="${esc(a.code)}">${ic('act-copy')} Kodu kopyala</button></div>
      <p class="sub">Arkadaşların rehberine bu kodu ekler, paketlerini doğrudan senin adresine gönderirler. Kod kalıcıdır: adını değiştirsen bile değişmez.</p>
    </div>
    <div class="account-hero-actions">
      <button class="btn ghost" data-account-rename>${ic('card-account')} Adını değiştir</button>
      <button class="btn ghost" data-account-icon="${esc(a.id)}">${ic('card-theme')} Simge değiştir</button>
      <button class="btn ghost" data-copy="${esc(a.uuid)}">${ic('card-uuid')} Oyun UUID</button>
    </div>
  </section>
  <div class="detail-layout">
    <section class="panel"><div class="section-head"><div><h2>${ic('card-accounts')} Hesapların</h2><p>Aynı bilgisayarda birden çok oyuncu kimliği tutabilirsin.</p></div></div>
      ${d.accounts.map(accountRowHtml).join('')}
    </section>
    <aside>
      <section class="panel"><h3>${ic('card-uuid')} İki kimlik, iki iş</h3>
        ${identityRow('MV kodu (kalıcı)', a.code, a.code, 'Hesap UUID\u2019inden türetilir, ad değişse de sabit kalır.')}
        ${identityRow('Oyun UUID (ada bağlı)', a.uuid, a.uuid, 'Envanterin ve ilerlemen bu UUID ile eşleşir.')}
        <p class="note">Adını değiştirdiğinde oyun UUID\u2019n de değişir — bu Minecraft\u2019ın kendi davranışıdır. MV kodun etkilenmez.</p>
      </section>
      <section class="panel"><h3>${ic('card-inbox')} Gelen paketler</h3>${d.inbox.length ? d.inbox.map(inboxRowHtml).join('') : `<div class="empty">Henüz paket almadın.<br><br><a data-go="friends" class="mini-btn" style="display:inline-block;padding:9px 14px">Arkadaşlar sayfasından içe aktar</a></div>`}</section>
      <section class="panel"><h3>${ic('card-friends')} Rehberindeki arkadaşlar</h3>${d.friends.length ? d.friends.map(f => `<div class="friend-row"><div class="friend-avatar">${esc(f.name.charAt(0).toUpperCase())}</div><div><b>${esc(f.name)}</b><span class="mono">${esc(f.code)}</span></div></div>`).join('') : `<div class="empty">Rehberin boş.</div>`}</section>
    </aside>
  </div>
  ${skinSectionHtml()}`;
}

/* ---------- modallar ---------- */
function accountNameModal(title, label, initial, onSubmit) {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-name-modal><form class="modal" id="account-name-form"><h2>${esc(title)}</h2><p class="sub">${esc(label)}</p><label class="form-label">GÖRÜNEN AD</label><input class="form-input" name="name" maxlength="16" minlength="2" required value="${esc(initial)}" placeholder="Minecraft oyuncu adı gibi: harf, rakam, alt çizgi"><div class="modal-actions"><button type="button" class="btn ghost" data-close>Vazgeç</button><button class="btn primary">Kaydet</button></div></form></div>`);
  const back = q('[data-name-modal]');
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  back.querySelector('[data-close]').onclick = () => back.remove();
  back.querySelector('#account-name-form').onsubmit = async event => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('name');
    try { await onSubmit(value); back.remove(); await loadAccountInfo(); state = await api.getState(); renderSidebarExtras(); render(); }
    catch (error) { toast(error.message, true); }
  };
}
function accountCreateModal() {
  accountNameModal('Yeni hesap oluştur', 'Her hesap kendi MV koduna ve kendi oyun UUID\u2019sine sahiptir.', 'Yeni Oyuncu', async value => { state = await mvAccount().accountCreate(value, { type: 'block', value: 'grass' }); toast('Hesap hazır.'); });
}
function accountRenameModal(accountId) {
  const account = accountData.accounts.find(a => a.id === accountId);
  accountNameModal('Görünen adı değiştir', 'Oyun UUID bu ada göre hesaplanır; envanterin adınla eşleşir.', account?.displayName || '', value => mvAccount().accountRename(accountId, value));
}
function accountIconModal(accountId) {
  const account = accountData.accounts.find(a => a.id === accountId);
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-icon-modal><form class="modal modal-lg" id="account-icon-form"><h2>Hesap simgesi</h2><p>${esc(account?.displayName || '')} için blok, emoji ya da kendi fotoğrafını seç.</p>${iconPickerHtml(account?.icon?.type, account?.icon?.value)}<div class="modal-actions"><button type="button" class="btn ghost" data-close>Vazgeç</button><button class="btn primary">Kaydet</button></div></form></div>`);
  const back = q('[data-icon-modal]');
  bindIconPicker(back.querySelector('.icon-picker'));
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  back.querySelector('[data-close]').onclick = () => back.remove();
  back.querySelector('#account-icon-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try { state = await mvAccount().accountSetIcon(accountId, { type: form.get('iconType'), value: form.get('iconValue') }); back.remove(); await loadAccountInfo(); state = await api.getState(); renderSidebarExtras(); render(); toast('Simge güncellendi.'); }
    catch (error) { toast(error.message, true); }
  };
}
function accountDeleteModal(accountId) {
  const account = accountData.accounts.find(a => a.id === accountId);
  confirmModal('Hesap silinsin mi?', `${account?.displayName || ''} hesabı ve MV kodu bu bilgisayardan kaldırılacak. Mod profillerin silinmez.`, 'Hesabı sil', async () => {
    try { state = await mvAccount().accountDelete(accountId); await loadAccountInfo(); state = await api.getState(); renderSidebarExtras(); render(); toast('Hesap silindi.'); }
    catch (error) { toast(error.message, true); }
  }, true);
}

/* ---------- olay bağlama ---------- */
function bindAccount() {
  const on = (selector, handler) => document.querySelectorAll(selector).forEach(el => el.onclick = event => { event.stopPropagation(); handler(el); });
  on('[data-account-refresh]', () => { accountData = null; render(); loadAccountInfo(true); });
  on('[data-account-new]', accountCreateModal);
  on('[data-account-rename]', () => accountRenameModal(accountData.active.id));
  on('[data-account-use]', el => mvAccount().accountUse(el.dataset.accountUse).then(async next => { state = next; await loadAccountInfo(); renderSidebarExtras(); render(); toast('Aktif hesap değişti.'); }).catch(error => toast(error.message, true)));
  on('[data-account-icon]', el => accountIconModal(el.dataset.accountIcon));
  on('[data-account-delete]', el => accountDeleteModal(el.dataset.accountDelete));
  /* Skinler */
  renderSkinPreview();
  const stage = q('#skin-preview-canvas');
  if (stage) {
    stage.onpointerdown = event => { skinViewer.dragging = true; skinViewer.lastX = event.clientX; stage.setPointerCapture(event.pointerId); };
    stage.onpointermove = event => { if (!skinViewer.dragging) return; skinViewer.angle += (event.clientX - skinViewer.lastX) * 0.016; skinViewer.lastX = event.clientX; if (skinViewer.img) drawSkin3D(stage, skinViewer.img); };
    stage.onpointerup = () => { skinViewer.dragging = false; skinViewerStart(); };
    stage.onpointercancel = () => { skinViewer.dragging = false; };
  }
  on('[data-skin-spin]', el => {
    skinViewer.spinning = !skinViewer.spinning;
    el.textContent = skinViewer.spinning ? '⏸ Döndürmeyi durdur' : '▶ Otomatik döndür';
    skinViewerStart();
  });
  on('[data-skin-apply-game]', async el => {
    const skin = selectedSkin();
    if (!skin) return;
    el.disabled = true;
    try {
      const result = await mvAccount().applySkinToGame(skin.name);
      await loadAccountInfo(true);
      render(); renderSkinPreview();
      toast(`Skin oyuna aktarıldı: ${result.displayName} · ${result.gameDir}`);
    } catch (error) { toast(error.message, true); el.disabled = false; }
  });
  on('[data-skin-refresh]', async () => { await loadSkins(true); render(); renderSkinPreview(); });
  on('[data-skin-upload]', async () => {
    try {
      const result = await mvAccount().uploadSkin();
      if (!result) return;
      toast(`Skin yüklendi (${result.size.width}×${result.size.height}).`);
      await loadSkins(true);
      selectedSkinKey = `c:${result.name}`;
      render(); renderSkinPreview();
    } catch (error) { toast(error.message, true); }
  });
  on('[data-skin-folder]', () => { if (skinsData?.customDir) mvAccount().openPath(skinsData.customDir); });
  on('[data-skin-pick]', el => {
    selectedSkinKey = el.dataset.skinPick;
    document.querySelectorAll('.skin-cell').forEach(cell => cell.classList.toggle('selected', cell.dataset.skinPick === selectedSkinKey));
    renderSkinPreview();
  });
  on('[data-skin-delete]', el => {
    confirmModal('Skin silinsin mi?', 'Bu skin dosyası kalıcı olarak silinecek.', 'Sil', async () => {
      try { await mvAccount().deleteSkin(el.dataset.skinDelete); if (selectedSkinKey === `c:${el.dataset.skinDelete}`) selectedSkinKey = ''; await loadSkins(true); render(); renderSkinPreview(); toast('Skin silindi.'); }
      catch (error) { toast(error.message, true); }
    }, true);
  });
  on('[data-skin-avatar]', async () => {
    const skin = selectedSkin();
    if (!skin) return;
    const img = new Image();
    img.onload = async () => {
      try {
        state = await mvAccount().applySkinAvatar(accountData.active.id, skinHeadDataUrl(img));
        await loadAccountInfo(true);
        renderSidebarExtras(); render(); renderSkinPreview();
        toast('Skin kafası profil fotoğrafın oldu.');
      } catch (error) { toast(error.message, true); }
    };
    img.onerror = () => toast('Skin okunamadı.', true);
    img.src = skin.dataUrl;
  });
}
function accountAutoLoad() {
  if (page === 'account' && !accountData) loadAccountInfo(true);
  if (page === 'account' && !skinsData && !skinsLoading) loadSkins();
}
