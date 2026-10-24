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
  img.onload = () => drawSkinToCanvas(canvas, img);
  img.src = skin.dataUrl;
}
function skinSectionHtml() {
  if (!skinsData) return `<section class="panel skin-panel"><h3>${ic('card-skins')} Skinlerim</h3><div class="empty"><span class="loader"></span> Skinler yükleniyor…</div></section>`;
  const all = skinListFlat();
  const sel = selectedSkin();
  const cells = all.map(s => `<button type="button" class="skin-cell ${sel && s.key === sel.key ? 'selected' : ''}" data-skin-pick="${esc(s.key)}" title="${esc(s.name)}"><img src="${esc(s.dataUrl)}" alt="${esc(s.name)}">${s.builtin ? '' : `<i class="skin-cell-del" data-skin-delete="${esc(s.name)}" title="Skin sil">${ic('act-close')}</i>`}</button>`).join('');
  return `<section class="panel skin-panel"><div class="section-head"><div><h3>${ic('card-skins')} Skinlerim</h3><p>Minecraft skinlerini önizle, profil fotoğrafın olarak kullan ya da kendi skini yükle.</p></div><button class="btn ghost" data-skin-refresh>${ic('act-refresh')} Yenile</button></div><div class="skin-layout"><div class="skin-stage"><canvas id="skin-preview-canvas" width="128" height="256"></canvas><span class="skin-stage-name mono" id="skin-preview-name">${esc(sel ? sel.name : '—')}</span><div class="modal-actions" style="justify-content:center;flex-wrap:wrap"><button class="btn primary" data-skin-avatar ${sel ? '' : 'disabled'}>${ic('card-account')} Profil fotoğrafı yap</button><button class="btn ghost" data-skin-upload>${ic('act-upload')} Skin yükle</button><button class="btn ghost" data-skin-folder>${ic('act-open')} Klasörü aç</button></div><p class="note" style="text-align:center">64×64 PNG skinler kabul edilir; resmî Minecraft biçiminde olmalı.</p></div><div class="skin-gallery">${all.length ? cells : '<div class="empty">Henüz skin yok. Hazır skinler pakete eklenince burada görünür; kendi skinini yükleyebilirsin.</div>'}</div></div></section>`;
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
