/* MineVerse v0.8 arayüz modülü. app.js'den ÖNCE yüklenir; app.js'in global
   değişkenlerini (state, api, esc, toast, render ...) yalnızca çağrı anında kullanır. */
let newsData = null, newsLoading = false, newsTab = 'minecraft';
let javaInfo = null, javaBusy = '', backupsData = null, backupBusy = false;
let analysisByProfile = {}, analyzingId = '', depsBusy = '';
let friendsData = null, friendsPaste = null, friendsBusy = '', friendsInviteCode = '';
let assetInfo = { dir: '', files: [] };
let launchInfo = null;
let launchLogInfo = null, preflightInfo = null, preflightBusy = false;
let ownerInfo = null, ownerDraft = [], ownerBusy = '', ownerImageData = '';

const mv = () => window.mineverse;

/* ---------------- Özel görseller: bozuk resim uygulamayı bozmaz ---------------- */
function fixAssetImg(img) {
  if (img.dataset.mvFixed === '1') return;
  const src = img.getAttribute('src') || '';
  const match = /^assets\/(.+)$/.exec(src);
  if (!match) return;
  img.dataset.mvFixed = '1';
  img.dataset.mvBuiltin = src;
  if (assetInfo.files.includes(match[1])) img.src = toFileUrl(assetInfo.dir + '/' + match[1]);
}
function fixAssetsIn(root) {
  if (!root || !root.querySelectorAll) return;
  if (root.tagName === 'IMG') fixAssetImg(root);
  root.querySelectorAll('img').forEach(fixAssetImg);
}
document.addEventListener('error', event => {
  const img = event.target;
  if (!img || img.tagName !== 'IMG' || img.dataset.mvFallback === '2') return;
  const builtin = img.dataset.mvBuiltin;
  if (builtin && img.dataset.mvFallback !== '1' && !img.getAttribute('src').startsWith('assets/')) { img.dataset.mvFallback = '1'; img.src = builtin; return; }
  img.dataset.mvFallback = '2';
  if (/assets\/blocks\//.test(builtin || img.getAttribute('src') || '')) img.src = 'assets/blocks/grass.png';
  else img.style.visibility = 'hidden';
}, true);
new MutationObserver(records => { for (const r of records) r.addedNodes.forEach(n => n.nodeType === 1 && fixAssetsIn(n)); }).observe(document.documentElement, { childList: true, subtree: true });
async function loadAssetOverrides() {
  try { assetInfo = await mv().getAssetOverrides(); fixAssetsInReset(); } catch {}
  if (typeof applyBackground === 'function' && typeof state !== 'undefined' && state?.settings) applyBackground(state.settings);
}
function fixAssetsInReset() { document.querySelectorAll('img[data-mv-fixed="1"]').forEach(i => { delete i.dataset.mvFixed; }); fixAssetsIn(document.body); }
if (window.mineverse?.onShareProgress) window.mineverse.onShareProgress(p => { if (typeof toast === 'function') toast(`Paket indiriliyor ${p.done + 1}/${p.total}: ${p.name}`); });
loadAssetOverrides();

/* ---------------- Yardımcılar ---------------- */
function confirmModal(title, text, label, onConfirm, danger = false) {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-confirm-modal><div class="modal"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="modal-actions"><button class="btn ghost" data-close>Vazgeç</button><button class="btn ${danger ? 'danger' : 'primary'}" data-do>${esc(label)}</button></div></div></div>`);
  const back = q('[data-confirm-modal]');
  const close = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back) close(); });
  back.querySelector('[data-close]').onclick = close;
  back.querySelector('[data-do]').onclick = async () => { close(); await onConfirm(); };
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Panoya kopyalandı.'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast('Panoya kopyalandı.'); } catch { toast('Kopyalanamadı; kodu elle seç.', true); } t.remove(); }
}
const shortPath = p => (String(p).length > 38 ? '…' + String(p).slice(-36) : String(p));

/* ---------------- Haberler & güncellemeler (Ana Sayfa altı) ---------------- */
async function loadNews(force) {
  newsLoading = true; if (page === 'home') render();
  try {
    const profile = typeof selectedProfile === 'function' ? selectedProfile() : null;
    newsData = await mv().getNews(!!force, profile ? { gameVersion: profile.gameVersion, loader: profile.loader } : {});
  } catch { newsData = { minecraft: [], mods: [], mineverse: [], errors: ['all'] }; }
  newsLoading = false; if (page === 'home') render();
}
function newsCard(it, i) {
  const featured = i === 0 && it.kind !== 'mod' ? ' featured' : '';
  const img = it.image ? `<img class="news-img" src="${esc(it.image)}" alt="" loading="lazy">` : `<div class="news-img placeholder">${esc(it.emoji || '⛏️')}</div>`;
  const tag = it.tag ? `<span class="news-tag ${esc(it.tagClass || '')}">${esc(it.tag)}</span>` : '';
  const date = it.date ? `<span class="news-date">${esc(dateTr(it.date))}</span>` : '';
  return `<article class="news-card ${esc(it.kind)}${featured}" data-news-kind="${esc(it.kind)}" data-news-id="${esc(it.id || '')}" data-news-source="${esc(it.source || '')}" data-news-url="${esc(it.url || '')}">${img}<div class="news-shade"></div><div class="news-body">${tag}${date}<h3>${esc(it.title)}</h3><p>${esc(it.summary || '')}</p></div></article>`;
}
function newsSection() {
  const tabs = [['minecraft', 'Minecraft'], ['mods', 'Güncellenen modlar'], ['mineverse', 'MineVerse']];
  let body;
  if (newsLoading && !newsData) body = `<div class="empty"><span class="loader"></span> Haberler yükleniyor…</div>`;
  else if (!newsData) body = `<div class="empty">Haberler henüz yüklenmedi.</div>`;
  else { const items = newsData[newsTab] || []; body = items.length ? `<div class="news-grid">${items.map(newsCard).join('')}</div>` : `<div class="empty">Bu bölüm için içerik alınamadı. İnternet bağlantını kontrol edip yenilemeyi dene.</div>`; }
  if (newsTab === 'mineverse' && newsData) body += `<p class="note">${ownerFeedNote(newsData.feed)}</p>`;
  return `<div class="section-head"><div><h2>${ic('card-news')} Haberler & Güncellemeler</h2><p>Minecraft ve mod dünyasından son gelişmeler.</p></div><a data-news-refresh>${ic('act-refresh')} Yenile</a></div><div class="news-tabs">${tabs.map(([id, label]) => `<button class="news-tab ${newsTab === id ? 'active' : ''}" data-news-tab="${id}">${label}</button>`).join('')}</div>${body}`;
}

/* ---------------- Akıllı uyumluluk analizi (Kütüphane) ---------------- */
function issueRow(i) {
  const icon = i.severity === 'error' ? ic('st-error') : i.severity === 'warn' ? ic('st-warn') : ic('st-info');
  return `<div class="issue ${esc(i.severity)}"><b>${icon} ${esc(i.title)}</b><span>${esc(i.detail)}</span>${i.projectId ? `<button class="mini-btn" data-open-mod="${esc(i.projectId)}">Modu gör</button>` : ''}</div>`;
}
function analysisCard(profile) {
  const res = analysisByProfile[profile.id];
  let list = '';
  if (analyzingId === profile.id) list = `<div class="rp-empty"><span class="loader"></span> Modlar inceleniyor…</div>`;
  else if (res) list = res.issues.length ? res.issues.map(issueRow).join('') : `<div class="issue ok">${ic('st-ok')} Sorun bulunmadı (${res.checked} mod incelendi).</div>`;
  const deps = res?.missingDeps?.length ? `<button class="btn success" data-install-deps="${profile.id}" ${depsBusy === profile.id ? 'disabled' : ''}>${depsBusy === profile.id ? 'Kuruluyor…' : `${ic('act-download')} ${res.missingDeps.length} eksik bağımlılığı kur`}</button>` : '';
  const note = res && !res.online && res.checked ? `<p class="note" style="margin-top:10px">Bağımlılık kontrolü internet gerektirir; şu an yalnızca yerel dosyalar incelendi.</p>` : '';
  return `<section class="panel analysis-card"><h3>${ic('act-analyze')} Akıllı uyumluluk analizi</h3><p class="sub" style="margin:0 0 12px;font-size:11px">Sürüm, yükleyici, eksik bağımlılık ve çakışan mod kontrolü.</p><button class="btn primary" data-analyze="${profile.id}" ${analyzingId ? 'disabled' : ''}>${analyzingId === profile.id ? 'İnceleniyor…' : 'Analiz et'}</button>${deps}${list}${note}</section>`;
}
async function runAnalysis(profileId) {
  analyzingId = profileId; render();
  try { analysisByProfile[profileId] = await mv().analyzeProfile(profileId); }
  catch (error) { toast(error.message, true); }
  analyzingId = ''; render();
}
async function runInstallDeps(profileId) {
  depsBusy = profileId; render();
  try {
    const result = await mv().installDependencies(profileId);
    state = result.state;
    toast(result.installed.length ? `${result.installed.length} bağımlılık kuruldu${result.failed.length ? `, ${result.failed.length} tanesi kurulamadı` : ''}.` : 'Kurulacak bir şey bulunamadı.', result.failed.length > 0);
    if (result.failed.length) showImportFailures(result.failed);
    analysisByProfile[profileId] = null;
  } catch (error) { toast(error.message, true); }
  depsBusy = ''; render(); runAnalysis(profileId);
}

/* ---------------- Paylaşım penceresi ---------------- */
async function openShareModal(profileId, friendId) {
  const friend = (friendsData?.friends || []).find(f => f.id === friendId) || null;
  const friendName = friend?.name || '';
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-share-modal><div class="modal modal-lg"><h2>Profili paylaş</h2><p id="share-info"><span class="loader"></span> Paylaşım kodu hazırlanıyor…</p><textarea class="share-code" id="share-code" readonly></textarea><p class="note" id="share-note"></p><div class="modal-actions"><button class="btn ghost" data-close>Kapat</button><button class="btn primary" id="share-copy" disabled>Kodu kopyala</button></div></div></div>`);
  const back = q('[data-share-modal]');
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  back.querySelector('[data-close]').onclick = () => back.remove();
  try {
    const result = await mv().shareCreate(profileId, friendId || '');
    q('#share-code').value = result.code;
    q('#share-info').textContent = `${result.shared} mod paylaşıma dahil${friendName ? ` · ${friendName} için hazırlandı (onun davetin otomatik kapanır)` : ''}. Kodu Discord, WhatsApp vb. ile gönder; alıcı Arkadaşlar sayfasından içe aktarır.`;
    q('#share-note').textContent = result.skipped ? `${result.skipped} yerel/paket modu kod ile paylaşılamaz (yalnızca Modrinth ve CurseForge modları dahil).` : '';
    const copy = q('#share-copy'); copy.disabled = false; copy.onclick = () => copyText(result.code);
  } catch (error) { q('#share-info').textContent = error.message; }
}

/* ---------------- Arkadaşlar sayfası ---------------- */
async function loadFriends() {
  try { friendsData = await mv().friendsMe(); } catch (error) { toast(error.message, true); friendsData = { code: '—', friends: [], inbox: [], outgoing: [], incoming: [] }; }
  if (page === 'friends') render();
}
const friendStatusLabel = { pending: 'bekliyor', accepted: 'kabul edildi', revoked: 'vazgeçildi', rejected: 'reddedildi' };
function statusChip(status) { return `<span class="chip">${friendStatusLabel[status] || status}</span>`; }
function friendsPage() {
  const header = pageHeader('Arkadaşlar & Davetler.', 'Davet kodunu gönder, arkadaşın kabul etsin; paketleri önizleyerek al.');
  const d = friendsData;
  if (!d) return `${header}<div class="empty"><span class="loader"></span> Yükleniyor…</div>`;
  const friends = d.friends || [], outgoing = d.outgoing || [], incoming = d.incoming || [];
  const pendingIn = incoming.filter(r => r.status === 'pending');
  const doneIn = incoming.filter(r => r.status !== 'pending');
  const profileOpts = state.profiles.map(p => `<option value="${p.id}">${esc(p.name)} · ${esc(p.gameVersion)} ${esc(p.loader)}</option>`).join('');
  const friendOpts = `<option value="">— arkadaş seç (isteğe bağlı) —</option>${friends.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}`;
  const friendRows = friends.length ? friends.map(f => `<div class="friend-row"><div class="friend-avatar">${esc((f.name || '?').charAt(0).toUpperCase())}</div><div><b>${esc(f.name)}</b><span class="mono">${esc(f.code)} · ${f.via === 'invite' ? 'davetle eklendi' : 'elle eklendi'}${f.mutual ? ' · karşılıklı' : ''}</span></div><div class="row-action" style="display:flex;gap:6px"><button class="btn ghost row-action" data-friend-send="${f.id}">${ic('act-share')} Paket gönder</button><button class="btn ghost row-action" data-friend-recv="${f.id}">${ic('act-import')} Paket al</button><button class="btn danger" data-friend-remove="${f.id}">Sil</button></div></div>`).join('') : '<div class="empty">Henüz arkadaşın yok. Yukarıdan bir davet kodu oluştur, arkadaşına gönder.</div>';
  const outRows = outgoing.length ? outgoing.map(i => `<div class="friend-row"><div><b>${esc(i.label || 'Davet')}</b><span class="mono">${esc(i.code)} · ${esc(dateTr(i.at))}</span></div><div class="row-action" style="display:flex;gap:6px;align-items:center">${statusChip(i.status)}${i.status === 'pending' ? `<button class="btn ghost" data-invite-confirm="${i.id}">Kabul edildi işaretle</button><button class="btn ghost" data-invite-cancel="${i.id}">Vazgeç</button>` : `<button class="btn ghost" data-copy="${esc(i.codeText || '')}">${ic('act-copy')} Kod</button>`}</div></div>`).join('') : '<div class="empty">Gönderdiğin bir davet yok.</div>';
  const inRows = pendingIn.length ? pendingIn.map(r => inviteCard(r)) : (doneIn.length ? '' : '<div class="empty">Sana gelmiş bekleyen davet yok.</div>');
  const doneRows = doneIn.length ? doneIn.map(r => `<div class="friend-row"><div class="friend-avatar">${r.status === 'accepted' ? ic('st-ok') : ic('st-disabled')}</div><div><b>${esc(r.name)}</b><span class="mono">${esc(r.code)} · ${esc(dateTr(r.receivedAt))} · ${friendStatusLabel[r.status]}</span></div></div>`).join('') : '<div class="tiny note">Kabul/ret ettiklerin burada birikir; aynı davet kodu ikinci kez işlenmez.</div>';
  const inboxRows = (d.inbox || []).length ? d.inbox.map(i => `<div class="friend-row"><div class="friend-avatar">${ic('act-pack')}</div><div><b>${esc(i.profileName)}</b><span>${esc(i.from)}${i.fromCode ? ` · ${esc(i.fromCode)}` : ''} · ${i.count} mod${i.failed ? ` · ${i.failed} hata` : ''} · ${esc(dateTr(i.at))}</span></div></div>`).join('') : '<div class="empty">Henüz paket almadın.</div>';
  return `${header}<div class="friends-grid">
  <article class="setting-card"><h3>${ic('card-code')} Senin arkadaş kodun</h3><p>Davet kodu oluşturup gönderdiğinde arkadaşın bu kodla seni bulur.</p><div class="code-box"><code>${esc(d.code)}</code><button class="btn ghost" data-copy="${esc(d.code)}">Kopyala</button></div><p class="note">Rehber bu bilgisayarda tutulur; çevrimiçi hesap/sunucu yoktur. Arkadaşın sana paket gönderdiğinde davetin otomatik "kabul edildi" olur.</p></article>
  <article class="setting-card"><h3>${ic('act-share')} Davet gönder</h3><label class="form-label">KİME (isteğe bağlı etiket)</label><input id="invite-label" class="form-input" maxlength="30" placeholder="Örneğin: Emre"><div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" data-invite-new ${friendsBusy ? 'disabled' : ''}>${friendsBusy === 'invite' ? 'Oluşturuluyor…' : 'Davet kodu oluştur'}</button></div>${friendsInviteCode ? `<textarea class="share-code" id="invite-code-out" readonly rows="4">${esc(friendsInviteCode)}</textarea><div class="modal-actions" style="justify-content:flex-start"><button class="btn ghost" data-copy="${esc(friendsInviteCode)}">${ic('act-copy')} Davet kodunu kopyala</button></div><p class="note tiny">Bu kodu arkadaşına aynen gönder; MVINV1: ile başlar ve tek bir kişiyi davet eder.</p>` : '<p class="note tiny">Kod üretildiğinde burada belirir; kopyalayıp arkadaşına atarsın.</p>'}</article>
  <article class="setting-card wide"><h3>${ic('card-import')} Kod yapıştır (davet veya paket)</h3><p>MineVerse kodu kendisi tanır: davetse <b>Kabul et / Reddet</b>, paketse içindeki modların listesi ve <b>İçe aktar</b> çıkar.</p><label class="form-label">GELEN KİŞİ (isteğe bağlı)</label><select id="import-friend" class="form-input">${friendOpts}</select><textarea id="friends-code-in" class="share-code" placeholder="MVINV1:… veya MV1:…"></textarea><div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" data-code-read ${friendsBusy ? 'disabled' : ''}>${friendsBusy === 'read' ? 'Okunuyor…' : ic('act-check') + ' Kodu oku'}</button>${friendsPaste ? '<button class="btn ghost" data-code-clear>Temizle</button>' : ''}</div>${friendsPaste ? pastePreviewHtml(friendsPaste) : ''}</article>
  <article class="setting-card wide"><h3>${ic('st-bell')} Sana gelen davetler</h3>${inRows}</article>
  <article class="setting-card wide"><h3>${ic('card-friends')} Arkadaşların (${friends.length})</h3>${friendRows}</article>
  <article class="setting-card wide"><h3>${ic('act-export')} Gönderdiğin davetler</h3>${outRows}</article>
  <article class="setting-card wide"><h3>${ic('card-inbox')} Gelen kutusu</h3>${inboxRows}</article>
  <article class="setting-card wide"><h3>${ic('act-code')} İstek geçmişi</h3>${doneRows}</article>
  <article class="setting-card"><h3>${ic('card-export')} Profil paylaşımı</h3><p>Davetten bağımsız: bir profilinin mod listeyi kod olarak üret, yapıştıran kişi indirsin.</p><label class="form-label">PROFİL</label><select id="share-profile" class="form-input">${profileOpts}</select><label class="form-label">KİME (daveti otomatik kapatmak için)</label><select id="share-friend" class="form-input">${friendOpts}</select><div class="modal-actions"><button class="btn primary" data-share-selected>Paylaşım kodu oluştur</button></div></article>
  <article class="setting-card"><h3>${ic('act-add')} Elle arkadaş ekle</h3><p>Kodunu yazılıp gönderdiğin kişi için kısa yol; davet akışı yerine geçer.</p><label class="form-label">AD</label><input id="friend-name" class="form-input" maxlength="30" placeholder="Arkadaşın adı"><label class="form-label">ARKADAŞ KODU</label><input id="friend-code" class="form-input mono" placeholder="MV-XXXX-XXXX"><div class="modal-actions"><button class="btn ghost" data-friend-add>Rehbere ekle</button></div></article></div>`;
}
function inviteCard(r) {
  return `<div class="friend-row"><div class="friend-avatar">${esc((r.name || '?').charAt(0).toUpperCase())}</div><div><b>${esc(r.name)}</b><span class="mono">${esc(r.code)} · ${esc(dateTr(r.receivedAt))}</span></div><div class="row-action" style="display:flex;gap:6px"><button class="btn success" data-request-accept="${r.id}">${ic('act-check')} Kabul et</button><button class="btn ghost" data-request-reject="${r.id}">Reddet</button></div></div>`;
}
function pastePreviewHtml(p) {
  if (p.kind === 'invite') {
    const r = p.request;
    return `<div class="version-list"><div class="issue ${r.status === 'pending' ? 'info' : 'ok'}"><b>${esc(r.name)} seni arkadaşlığa davet ediyor</b><span class="mono">${esc(r.code)}${p.already ? ' · bu davet zaten işlenmişti' : ''}</span></div></div>${r.status === 'pending' ? `<div class="modal-actions" style="justify-content:flex-start"><button class="btn success" data-request-accept="${r.id}">Kabul et</button><button class="btn ghost" data-request-reject="${r.id}">Reddet</button></div>` : ''}`;
  }
  const pack = p.pack;
  const rows = pack.mods.slice(0, 12).map(m => `<div class="issue info"><b>${esc(m.name)}</b><span>${esc(m.source)}</span></div>`).join('');
  return `<div class="version-list"><div class="issue ok"><b>${esc(pack.name)}</b><span>${esc(pack.gameVersion)} · ${esc(pack.loader)} · ${pack.count} mod${pack.from ? ` · gelen: <span class="mono">${esc(pack.fromName)} (${esc(pack.from)})</span>` : ''}</span></div>${rows}${pack.count > 12 ? `<p class="tiny note">+${pack.count - 12} mod daha.</p>` : ''}</div><p class="note tiny">Henüz hiçbir şey inmez. Onaylarsan yeni profil kurulur ve modlar indirilir.</p><div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" data-pack-import ${friendsBusy === 'import' ? 'disabled' : ''}>${friendsBusy === 'import' ? 'İndiriliyor…' : ic('act-download') + ' Profil kur ve indir'}</button></div>`;
}
async function friendsMakeInvite() {
  friendsBusy = 'invite'; render();
  try { const r = await mv().friendsInvite(q('#invite-label')?.value || ''); friendsInviteCode = r.code; friendsData = null; await loadFriends(); toast('Davet kodu hazır — arkadaşına gönder.'); }
  catch (error) { toast(error.message, true); }
  friendsBusy = ''; render();
}
async function friendsReadCode() {
  const raw = (q('#friends-code-in')?.value || '').trim();
  if (!raw) return toast('Önce bir kod yapıştır.', true);
  friendsBusy = 'read';
  try { const info = await mv().friendsDecode(raw); friendsPaste = { raw, ...info }; if (info.kind === 'pack' && info.pack.from) friendsAutoSelectFriend(info.pack.from); }
  catch (error) { friendsPaste = null; toast(error.message, true); }
  friendsBusy = ''; render();
}
function friendsAutoSelectFriend(code) {
  const friend = (friendsData?.friends || []).find(f => f.code === code);
  const select = q('#import-friend');
  if (friend && select) select.value = friend.id;
}
async function friendsAcceptRequest(id) {
  try {
    const r = await mv().friendsAccept(id);
    toast(r.already ? `${r.friend?.name || 'Arkadaş'} zaten rehberinde.` : `${r.friend?.name || 'Arkadaş'} arkadaşların arasına katıldı.`);
    friendsPaste = null; friendsData = null; await loadFriends(); render();
  } catch (error) { toast(error.message, true); }
}
async function friendsRejectRequest(id) {
  try { await mv().friendsReject(id); friendsPaste = null; friendsData = null; await loadFriends(); toast('Davet reddedildi.'); }
  catch (error) { toast(error.message, true); }
}
async function friendsImportPack() {
  if (!friendsPaste?.raw) return;
  friendsBusy = 'import'; render();
  try { await importShareCode(friendsPaste.raw, q('#import-friend')?.value || ''); friendsPaste = null; }
  catch (error) { toast(error.message, true); }
  friendsBusy = ''; render();
}
async function importShareCode(code, friendId) {
  code = (code || q('#import-code')?.value || '').trim();
  if (!code) return toast('Önce bir paylaşım kodu yapıştır.', true);
  toast('Profil oluşturuluyor, modlar indiriliyor…');
  try {
    const result = await mv().shareImport(code, friendId || q('#import-friend')?.value || '');
    state = result.state; currentProfileId = result.profileId; friendsData = null;
    toast(`${result.ok} mod indirildi${result.failed.length ? `, ${result.failed.length} mod indirilemedi` : ''}.`, result.failed.length > 0);
    if (result.failed.length) showImportFailures(result.failed);
    loadFriends(); render();
  } catch (error) { toast(error.message, true); }
}
function showImportFailures(failed) {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-fail-modal><div class="modal"><h2>Bazı modlar indirilemedi</h2><div class="version-list">${failed.map(f => `<div class="issue warn"><b>${esc(f.name)}</b><span>${esc(f.reason)}</span></div>`).join('')}</div><div class="modal-actions"><button class="btn primary" data-close>Tamam</button></div></div></div>`);
  const back = q('[data-fail-modal]'); back.querySelector('[data-close]').onclick = () => back.remove(); back.addEventListener('click', e => { if (e.target === back) back.remove(); });
}

/* ---------------- Ayarlar: Java, Yedekleme, Özel görseller ---------------- */
async function loadJavaInfo(force) { try { javaInfo = await mv().javaStatus(!!force); if (page === 'settings') render(); } catch {} }
async function loadBackups() { try { backupsData = await mv().backupsList(); if (page === 'settings') render(); } catch {} }
function settingsExtra() {
  const s = state.settings;
  const j = javaInfo;
  const missing = j ? [...new Set(j.profiles.filter(p => !p.ready).map(p => p.required))] : [];
  const javaRows = j ? j.profiles.map(p => `<div class="rp-row"><span>${esc(p.name)} · MC ${esc(p.gameVersion)}</span><b>Java ${p.required} ${p.ready ? '✓' : '⬇ gerekli'}</b></div>`).join('') : '';
  const found = j ? j.detected.map(d => `<div class="rp-row"><span>Java ${d.major} · ${esc(d.source)}</span><b class="mono" title="${esc(d.exe)}">${esc(shortPath(d.exe))}</b></div>`).join('') : '';
  const javaCard = `<article class="setting-card wide"><h3>${ic('card-java')} Java yönetimi</h3><p>Her Minecraft sürümü için doğru Java otomatik belirlenir (1.16 ve altı → Java 8, 1.17–1.20.4 → 17, 1.20.5+ → 21). Eksikse buradan ya da "Oyna" ile indirilir.</p>${j ? `<div style="margin:10px 0">${javaRows || '<div class="rp-empty">Profil yok.</div>'}</div><h3 style="font-size:11.5px;margin:14px 0 4px">Algılanan Java kurulumları</h3>${found || '<div class="rp-empty">Bilgisayarda Java bulunamadı.</div>'}` : '<p><span class="loader"></span> Java kurulumları taranıyor…</p>'}<div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap">${missing.map(m => `<button class="btn primary" data-java-ensure="${m}" ${javaBusy ? 'disabled' : ''}>${javaBusy === String(m) ? 'İndiriliyor…' : `Java ${m} indir`}</button>`).join('')}<button class="btn ghost" data-java-refresh>⟳ Yeniden tara</button></div><p class="note">Resmî launcher ve TLauncher oyun için kendi Java'sını seçer. MineVerse bu Java'yı Java tabanlı launcher'ları (ör. TLauncher.jar) başlatırken kullanır; yolu launcher ayarlarına elle de girebilirsin.</p></article>`;
  const rows = (backupsData || []).map(b => `<div class="backup-row"><div><b>${esc(dateTr(b.createdAt))} ${esc(new Date(b.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }))}</b><span>${esc(b.reason)} · ${formatBytes(b.size)}</span></div><button class="btn ghost" data-backup-restore="${esc(b.name)}">Geri yükle</button><button class="btn danger" data-backup-delete="${esc(b.name)}">Sil</button></div>`).join('');
  const sel = (id, value, opts) => `<select id="${id}" class="form-input">${opts.map(o => `<option value="${o[0]}" ${+value === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  const backupCard = `<article class="setting-card wide"><h3>${ic('card-backup')} Yedekleme ve kurtarma</h3><p>Profillerin, indirilen modların ve ayarların zip yedeği alınır. Silme/sıfırlama/geri yükleme öncesinde otomatik güvenlik yedeği de alınır.</p><div class="form-row" style="grid-template-columns:auto 1fr 1fr;align-items:end"><label class="check-row"><input type="checkbox" id="backup-auto" ${s.autoBackup === false ? '' : 'checked'}> Otomatik yedekle</label><div><label class="form-label">SIKLIK</label>${sel('backup-interval', s.backupIntervalHours || 24, [[6, '6 saatte bir'], [12, '12 saatte bir'], [24, 'Günde bir'], [72, '3 günde bir']])}</div><div><label class="form-label">SAKLANACAK OTOMATİK YEDEK</label>${sel('backup-keep', s.backupKeep || 5, [[3, '3'], [5, '5'], [10, '10'], [20, '20']])}</div></div><div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn primary" data-backup-save>Ayarları kaydet</button><button class="btn success" data-backup-now ${backupBusy ? 'disabled' : ''}>${backupBusy ? 'Yedekleniyor…' : '＋ Şimdi yedekle'}</button><button class="btn ghost" data-backup-folder>Klasörü aç</button></div><div style="margin-top:12px">${backupsData ? (rows || '<div class="rp-empty">Henüz yedek yok.</div>') : '<p><span class="loader"></span> Yedekler okunuyor…</p>'}</div></article>`;
  const assetCard = `<article class="setting-card wide"><h3>${ic('card-assets')} Özel görseller ve ikonlar</h3><p>Buraya koyduğun resimler uygulamadaki ikonların/logoların yerine geçer; bozuk resim uygulamayı açılmaz yapmaz. Arayüz ikonlarının tamamı <code>ui/&lt;anahtar&gt;.png</code> adıyla buraya konarak fotoğrafla değiştirilebilir (ör. <code>ui/nav-home.png</code>). Kullanılabilir anahtarların listesi: <code>npm run icons</code>.</p><p class="note">${assetInfo.dir ? esc(assetInfo.dir) : ''} · ${assetInfo.files.length} özel görsel bulundu. Değişiklik sonrası uygulamayı yeniden aç.</p><div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" data-assets-open>Özel görsel klasörünü aç</button><button class="btn ghost" data-assets-rescan>${ic('act-refresh')} Yeniden tara</button></div></article>`;
  const mode = state.settings.launchMode === 'mineverse' ? 'mineverse' : 'launcher';
  const launchCard = `<article class="setting-card wide"><h3>${ic('card-play-mode')} Oyna düğmesi ne yapsın?</h3><p><b>MineVerse başatsın</b>: Oyun Mojang'dan indirilir (sürüm dosyası, kütüphaneler, sesler/dokular), doğru Java seçilir ve Minecraft doğrudan açılır. İlk seferde birkaç yüz MB indirir; sonrakiler hızlıdır. Hesabın <i>offline</i> çalışır: MV kodun ve oyun UUID'n Hesabım sayfasından gelir.</p><p><b>Launcher'a aktar</b>: Modlar bağladığın klasöre kopyalanır, oyun başlatıcıyı sen açarsın. Forge/NeoForge profilleri için önerilen yol budur.</p><div class="form-row"><div><label class="form-label">YÖNTEM</label><select id="launch-mode" class="form-input"><option value="launcher" ${mode === 'launcher' ? 'selected' : ''}>Launcher'a aktar ve aç</option><option value="mineverse" ${mode === 'mineverse' ? 'selected' : ''}>MineVerse başatsın</option></select></div><div><label class="form-label">AZAMİ BELLEK</label><select id="launch-memory" class="form-input">${[2, 4, 6, 8, 12, 16].map(gb => `<option value="${gb}" ${(state.settings.maxMemoryGb || 4) === gb ? 'selected' : ''}>${gb} GB</option>`).join('')}</select></div></div><div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn primary" data-launch-save>Kaydet</button><button class="btn ghost" data-launch-dir>Oyun klasörünü aç</button>${launchState?.running ? `<button class="btn danger" data-launch-stop>${ic('act-close')} Oyunu durdur</button>` : ''}</div><div id="launch-progress-slot">${launchProgressHtml()}</div><p class="note">Forge ve NeoForge sürümlerini MineVerse başlatamaz; o profillerde "Launcher'a aktar" kullan ya da Fabric'e geç.</p></article>`;
  const logCard = launchLogCardHtml();
  const ownerCard = ownerCardHtml();
  return launchCard + logCard + ownerCard + javaCard + backupCard + assetCard;
}

/* ---------------- Yönetici haber paneli ---------------- */
async function loadOwnerInfo() {
  try {
    ownerInfo = await mv().ownerStatus();
    if (!ownerInfo.unlocked) ownerDraft = [];
    else if (!ownerDraft.length) ownerDraft = (ownerInfo.items || []).map(item => ({ ...item }));
  } catch { ownerInfo = null; }
  if (page === 'settings') render();
}
function ownerSourceLabel(info) {
  if (!info) return 'durum okunamadı';
  const map = { online: 'GitHub’dan canlı', offline: 'son kayıttan (çevrimdışı)', none: (info.feedUrl || info.url) ? 'henüz çekilemedi' : 'bağlantı tanımlı değil' };
  return `${map[info.source] || info.source}${info.error ? ` · ${info.error}` : ''}`;
}
function ownerFeedNote(feed) {
  if (!feed || feed.source === 'none') return 'Bu bölümdeki duyurular MineVerse ile birlikte gelir.';
  return `Duyurular ${ownerSourceLabel(feed)} okundu · ${feed.count || 0} haber.`;
}
function ownerCardHtml() {
  const info = ownerInfo;
  if (!info || !info.panelVisible) return '';
  const draftRows = ownerDraft.length ? ownerDraft.map((item, index) => {
    const thumb = item.imageData || item.image ? `<img class="owner-draft-thumb" src="${esc(item.imageData || item.image)}" alt="">` : '';
    return `<div class="backup-row">${thumb}<div><b>${esc(item.title)}</b><span>${esc(item.tag || 'Duyuru')} · ${esc((item.date || '').slice(0, 10))}${item.url ? ' · bağlantılı' : ''}${item.imageData || item.image ? ' · görselli' : ''}</span></div><button class="btn ghost" data-owner-drop="${index}">${ic('act-delete')}</button></div>`;
  }).join('') : '<div class="rp-empty">Listede haber yok. Soldan ekleyip sağdan yayımla.</div>';
  const uploadBox = ownerImageData
    ? `<div class="owner-upload has-image" data-owner-image><img src="${esc(ownerImageData)}" alt=""><span class="owner-upload-change">${ic('act-refresh')} Değiştir</span><button class="mini-btn owner-upload-clear" data-owner-image-clear title="Görseli kaldır">${ic('act-close')}</button></div>`
    : `<div class="owner-upload" data-owner-image>${ic('act-upload')}<span>Görsel yükle<br><em>PNG/JPG · en fazla 1 MB</em></span></div>`;
  return `<article class="setting-card wide owner-panel" data-owner-editor><h3>${ic('card-news')} Yönetici paneli · MineVerse haberleri</h3><p class="note" style="margin-bottom:12px">Akış: ${ownerSourceLabel(info)} · Gist: <span class="mono">${esc(info.gistId || '—')}</span> · Token: <span class="mono">${esc(info.tokenHint || 'yok')}</span></p><div class="owner-grid"><div class="owner-form"><div><label class="form-label">BAŞLIK</label><input class="form-input" id="owner-title" maxlength="120" placeholder="MineVerse 0.12 çıktı"></div><div><label class="form-label">BAĞLANTI</label><input class="form-input mono" id="owner-url" placeholder="https://… (isteğe bağlı)"></div><div><label class="form-label">ETİKET</label><input class="form-input" id="owner-tag" maxlength="24" placeholder="Duyuru / Sürüm / Rehber"></div><div><label class="form-label">ÖZET</label><textarea class="form-input" id="owner-summary" rows="4" maxlength="400" placeholder="Kısa ve net haber metni"></textarea></div><div class="modal-actions owner-actions"><button class="btn primary" data-owner-add>${ic('act-add')} Listeye ekle</button><button class="btn ghost" data-owner-reset>Sunucudan yeniden al</button><button class="btn primary" data-owner-publish ${ownerBusy === 'publish' ? 'disabled' : ''}>${ownerBusy === 'publish' ? 'Yayımlanıyor…' : ic('act-upload') + ' Githuba yükle'}</button></div></div><div class="owner-side">${uploadBox}<span class="form-label">ÖNİZLEME PENCERESİ</span><div class="owner-preview" id="owner-preview-slot">${newsCard(ownerBlankItem(), 1)}</div></div></div><input type="file" id="owner-image-input" accept="image/png,image/jpeg" style="display:none"><details class="owner-settings"><summary>${ic('nav-settings')} Bağlantı ve güvenlik ayarları</summary><div class="form-row" style="grid-template-columns:1fr 1fr;margin-top:10px"><div><label class="form-label">GITHUB TOKEN (repo/gist izni)</label><input class="form-input" type="password" id="owner-token" placeholder="${info.tokenSet ? 'değiştirmek için yeni token yaz' : 'ghp_…'}"></div><div><label class="form-label">GİST KİMLİĞİ</label><input class="form-input mono" id="owner-gist" value="${esc(info.gistId)}" placeholder="gist oluşturunca kendisi dolar"></div></div><div class="form-row" style="grid-template-columns:1fr"><div><label class="form-label">HERKESİN OKUYACAĞI HAM BAĞLANTI (raw)</label><input class="form-input mono" id="owner-feed" value="${esc(info.feedUrl)}" placeholder="https://gist.githubusercontent.com/…/raw/mineverse-news.json"></div></div><div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn primary" data-owner-save ${ownerBusy === 'save' ? 'disabled' : ''}>Ayarları kaydet</button>${info.tokenSet ? '' : '<button class="btn success" data-owner-create>Gist oluştur</button>'}</div></details><h3 style="margin-top:16px">Yayımlanacak liste (${ownerDraft.length})</h3><div style="margin-top:8px">${draftRows}</div><p class="note">Token yalnız bu bilgisayarda, arayüzün okuyamadığı ayrı bir dosyada (<span class="mono">owner-secret.json</span>) durur. Görsel eklenen haberlerde resim Gist’e ayrı dosya olarak yüklenir; diğer MineVerse’ler 30 dakika içinde görür.</p></article>`;
}
function ownerBlankItem() {
  return { kind: 'mv', id: 'preview', title: 'Haber başlığı', summary: 'Özet metni burada görünür…', url: '', tag: 'Duyuru', image: ownerImageData || '', date: new Date().toISOString() };
}
function ownerPreviewItem() {
  return {
    ...ownerBlankItem(),
    title: q('#owner-title')?.value.trim() || 'Haber başlığı',
    summary: q('#owner-summary')?.value.trim() || 'Özet metni burada görünür…',
    url: q('#owner-url')?.value.trim() || '',
    tag: q('#owner-tag')?.value.trim() || 'Duyuru'
  };
}
function ownerRefreshPreview() {
  const slot = q('#owner-preview-slot');
  if (slot) slot.innerHTML = newsCard(ownerPreviewItem(), 1);
}
async function ownerSaveSettings() {
  const patch = {
    newsGistId: q('#owner-gist').value.trim(),
    newsFeedUrl: q('#owner-feed').value.trim()
  };
  const token = q('#owner-token').value.trim(); if (token) patch.githubToken = token;
  ownerBusy = 'save';
  try { await mv().ownerSave(patch); await loadOwnerInfo(); toast('Panel ayarları kaydedildi.'); }
  catch (error) { toast(error.message, true); }
  ownerBusy = ''; render();
}
async function ownerCreateGist() {
  try {
    const result = await mv().ownerCreateGist(ownerDraft);
    ownerDraft = result.items.map(item => ({ ...item }));
    toast(`Gist hazır: ${result.gistId}`);
    await loadOwnerInfo();
  } catch (error) { toast(error.message, true); }
}
async function ownerPublishNews() {
  if (!ownerDraft.length) return toast('Önce en az bir haber ekle.', true);
  ownerBusy = 'publish'; render();
  try {
    await mv().ownerPublish(ownerDraft);
    toast(`${ownerDraft.length} haber yayımlandı. Diğer MineVerse’ler 30 dakika içinde görür.`);
  } catch (error) { toast(error.message, true); }
  ownerBusy = '';
  await loadOwnerInfo();
}
function ownerAddDraft() {
  const title = q('#owner-title').value.trim();
  if (title.length < 3) return toast('Başlık en az 3 karakter olmalı.', true);
  ownerDraft.unshift({
    id: 'mv-' + Date.now().toString(36), title,
    summary: q('#owner-summary').value.trim(),
    url: q('#owner-url').value.trim(),
    tag: q('#owner-tag').value.trim() || 'Duyuru',
    imageData: ownerImageData || '',
    date: new Date().toISOString()
  });
  ownerImageData = '';
  render();
}
/* Yönetici haberine eklenecek görsel: 960px’e küçültülüp PNG data-url olur. */
function ownerPickImage() { q('#owner-image-input')?.click(); }
function ownerReadImage(file) {
  if (!file || !/^image\/(png|jpeg)$/.test(file.type)) return toast('PNG veya JPG görsel seç.', true);
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 960 / Math.max(img.width, img.height, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png');
      if (data.length > 900 * 1024) return toast('Görsel hâlâ 1 MB üstünde; daha küçük bir resim dene.', true);
      ownerImageData = data;
      render();
    };
    img.onerror = () => toast('Görsel okunamadı; başka bir dosya dene.', true);
    img.src = reader.result;
  };
  reader.onerror = () => toast('Görsel okunamadı; başka bir dosya dene.', true);
  reader.readAsDataURL(file);
}

/* Son başlatma logu + profili baslatmadan once uyumluluk kontrolu. */
function launchLogCardHtml() {
  const l = launchLogInfo;
  const exit = l?.lastExit;
  const status = exit
    ? `<div class="issue ${exit.code === 0 ? 'ok' : 'error'}"><b>Çıkış kodu ${exit.code}</b><span>${esc(exit.at || '')}${exit.lines ? ` · ${exit.lines} satır log yazıldı` : ''}</span></div>`
    : '<div class="issue info"><b>Henüz kayıtlı bir başlatma yok</b><span>Oyna düğmesine bastığında tüm oyun çıktısı buraya yazılır.</span></div>';
  const hint = l?.hint ? `<div class="issue warn"><b>Logdaki olası hata satırları</b><span class="mono" style="white-space:pre-wrap">${esc(l.hint)}</span></div>` : '';
  const pathRow = l?.path ? `<p class="note">${l.exists ? 'Log dosyası' : 'Log dosyası (henüz oluşmadı)'}: <span class="mono">${esc(l.path)}</span></p>` : '';
  const pf = preflightInfo;
  const pfBlock = pf
    ? `<div class="version-list">${pf.ok
        ? `<div class="issue ok"><b>${pf.checked} mod kontrol edildi</b><span>${esc(pf.profile.name)} · ${esc(pf.profile.gameVersion)} · ${esc(pf.profile.loader)} için sorun görünmüyor.</span></div>`
        : pf.issues.map(i => `<div class="issue ${i.severity === 'block' ? 'error' : i.severity === 'warn' ? 'warn' : 'info'}"><b>${esc(i.name)}</b><span>${esc(i.reason)}</span></div>`).join('')}</div>${pf.ok ? '' : `<div class="modal-actions" style="justify-content:flex-start"><button class="btn danger" data-preflight-disable>Uyumsuz modları kapat</button></div>`}`
    : '<p class="note">Deneyince profilin modları tek tek açılır ve sürüm/yükleyici uyumu okunur.</p>';
  return `<article class="setting-card wide"><h3>${ic('card-launch')} Başlatma günlüğü ve ön kontrol</h3><p>Oyun açılmıyorsa nedeni burada yazar. MineVerse, oyunun kendi çıktısını olduğu gibi bu dosyaya kaydeder; arkadaşına gönderip yardım isteyebilirsin.</p><div class="version-list">${status}${hint}</div>${pathRow}<div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn primary" data-launch-log-show>${ic('act-analyze')} Logu göster</button><button class="btn ghost" data-launch-log-copy>${ic('act-copy')} Kopyala</button><button class="btn ghost" data-launch-log-open>${ic('act-open')} Log dosyasını aç</button></div><h3 style="margin-top:18px">${ic('card-deps')} Başlatmadan önce uyumluluk</h3><div class="modal-actions" style="justify-content:flex-start;margin-bottom:10px"><button class="btn ghost" data-launch-preflight ${preflightBusy ? 'disabled' : ''}>${preflightBusy ? 'Kontrol ediliyor…' : ic('act-check') + ' Profili kontrol et'}</button></div>${pfBlock}</article>`;
}

function showLaunchLogModal() {
  const close = () => document.querySelector('[data-log-modal]')?.remove();
  const body = launchLogInfo?.text
    ? `<pre class="log-view">${esc(launchLogInfo.text)}</pre>`
    : '<div class="empty">Log dosyası boş ya da henüz oluşmadı.</div>';
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-log-modal><div class="modal modal-lg"><h2>${ic('card-launch')} Son başlatma logu</h2><p class="sub mono">${esc(launchLogInfo?.path || '')} · ${launchLogInfo?.lines || 0} satır</p>${body}<div class="modal-actions"><button class="btn ghost" data-log-refresh>${ic('act-refresh')} Yenile</button><button class="btn primary" data-close>Tamam</button></div></div></div>`);
  const back = document.querySelector('[data-log-modal]');
  back.querySelector('[data-close]').onclick = close;
  back.querySelector('[data-log-refresh]').onclick = async () => { await refreshLaunchLog(); close(); showLaunchLogModal(); };
  back.addEventListener('click', e => { if (e.target === back) close(); });
}
async function refreshLaunchLog() {
  try { launchLogInfo = await mv().launchLog(); } catch { launchLogInfo = null; }
  if (page === 'settings') render();
}
async function copyLaunchLog() {
  try {
    const data = await mv().launchLog();
    launchLogInfo = data;
    if (!data.text) return toast('Kopyalanacak log yok.', true);
    await mv().copyToClipboard(data.text);
    toast('Log panoya kopyalandı.');
  } catch (error) { toast(error.message, true); }
}
async function runPreflight(profileId) {
  preflightBusy = true;
  if (page === 'settings') render();
  try {
    preflightInfo = await mv().launchPreflight(profileId);
    preflightBusy = false;
    if (page === 'settings') render();
    return preflightInfo;
  } catch (error) {
    preflightBusy = false;
    toast(error.message, true);
    if (page === 'settings') render();
    return null;
  }
}
async function disableIncompatibleMods(profileId, modIds) {
  for (const modId of modIds) { try { await mv().toggleMod(profileId, modId); } catch {} }
  state = await mv().getState();
  preflightInfo = null;
  render();
}

/* Başlatma ilerlemesi: tüm sayfayı yeniden çizmeden rozeti güncelle. */
function renderLaunchProgress() {
  const node = q('#launch-progress-slot');
  if (!node) return;
  node.innerHTML = launchProgressHtml();
  node.querySelector('[data-launch-stop]')?.addEventListener('click', stopLaunch);
}
async function stopLaunch() {
  try { await mv().launchStop(); toast('Oyun kapatılıyor…'); }
  catch (error) { toast(error.message, true); }
}
function launchProgressHtml() {
  const p = launchState?.progress;
  if (!launchState?.busy && !launchState?.running && !p) return '';
  const pct = p && p.total ? Math.min(100, Math.round(p.done / p.total * 100)) : null;
  const labels = { resolve: 'Sürüm çözülüyor', libraries: 'Kütüphaneler', jar: 'Oyun dosyası', assets: 'Varlıklar', mods: 'Modlar eşitleniyor', java: 'Java', spawn: 'Oyun açılıyor', exit: 'Oyun kapandı', error: 'Başlatma hatası' };
  return `<div class="launch-progress"><span class="loader"></span><div><b>${esc(labels[p?.phase] || p?.phase || '')}</b>${p?.total ? `<em>${pct}% · ${p.done}/${p.total}</em>` : ''}</div><button class="btn ghost row-action" data-launch-stop>${ic('act-close')} Durdur</button></div>`;
}
async function loadLaunchInfo() {
  const profile = typeof selectedProfile === 'function' ? selectedProfile() : null;
  try { launchLogInfo = await mv().launchLog(); } catch { launchLogInfo = null; }
  if (!profile) { if (page === 'settings') render(); return; }
  try { launchInfo = await mv().launchPrepare(profile.id); } catch { launchInfo = null; }
  if (page === 'settings') render();
}

/* ---------------- Olay bağlama (her render sonrası app.js çağırır) ---------------- */
function bindFeatures() {
  const on = (selector, handler) => document.querySelectorAll(selector).forEach(el => el.onclick = () => handler(el));
  on('[data-news-tab]', el => { newsTab = el.dataset.newsTab; render(); });
  on('[data-news-refresh]', () => loadNews(true));
  on('.news-card', el => {
    if (el.dataset.newsKind === 'mc' && el.dataset.newsUrl) mv().openExternal(el.dataset.newsUrl).catch(e => toast(e.message, true));
    else if (el.dataset.newsKind === 'mod') openPreview(el.dataset.newsSource || 'Modrinth', el.dataset.newsId);
  });
  on('[data-analyze]', el => runAnalysis(el.dataset.analyze));
  on('[data-install-deps]', el => runInstallDeps(el.dataset.installDeps));
  on('[data-launch-save]', async () => { try { state = await api.saveSettings({ launchMode: q('#launch-mode').value, maxMemoryGb: +q('#launch-memory').value }); toast(q('#launch-mode').value === 'mineverse' ? 'Minecraft artık MineVerse tarafından başlatılacak.' : 'Oyna düğmesi modları launchera aktaracak.'); render(); } catch (error) { toast(error.message, true); } });
  on('[data-launch-dir]', () => mv().launchOpenGameDir());
  on('[data-launch-log-show]', () => showLaunchLogModal());
  on('[data-launch-log-copy]', () => copyLaunchLog());
  on('[data-launch-log-open]', () => mv().launchOpenLog());
  on('[data-launch-preflight]', () => { const p = typeof selectedProfile === 'function' ? selectedProfile() : state.profiles[0]; if (p) runPreflight(p.id); });
  on('[data-preflight-disable]', async () => {
    const info = preflightInfo;
    if (!info?.profile) return;
    await disableIncompatibleMods(info.profile.id, info.blockingModIds);
    toast(`${info.blockingModIds.length} mod kapatıldı.`);
  });
  on('[data-launch-stop]', stopLaunch);
  on('[data-open-mod]', el => openPreview('Modrinth', el.dataset.openMod));
  on('[data-share-profile]', el => openShareModal(el.dataset.shareProfile));
  on('[data-copy]', el => copyText(el.dataset.copy));
  on('[data-friend-add]', async () => { try { const list = await mv().friendsAdd(q('#friend-name').value, q('#friend-code').value); friendsData = { ...friendsData, friends: list }; q('#friend-name').value = ''; q('#friend-code').value = ''; toast('Arkadaş rehbere eklendi.'); render(); } catch (error) { toast(error.message, true); } });
  on('[data-friend-remove]', el => confirmModal('Arkadaş silinsin mi?', 'Kendi rehberinden çıkarırsın; arkadaşının listesi değişmez.', 'Sil', async () => { try { friendsData.friends = await mv().friendsRemove(el.dataset.friendRemove); render(); toast('Rehberden silindi.'); } catch (error) { toast(error.message, true); } }, true));
  on('[data-friend-send]', el => { const f = (friendsData?.friends || []).find(x => x.id === el.dataset.friendSend); const pid = q('#share-profile')?.value || state.profiles[0]?.id; if (!pid) return toast('Önce bir profil oluştur.', true); openShareModal(pid, f?.id); });
  on('[data-friend-recv]', el => { const s = q('#import-friend'); if (s) s.value = el.dataset.friendRecv; q('#friends-code-in')?.focus(); toast('Arkadaşının kodunu yapıştır — paketse önizleme çıkar.'); });
  on('[data-invite-new]', () => friendsMakeInvite());
  on('[data-invite-cancel]', async el => { try { await mv().friendsInviteCancel(el.dataset.inviteCancel); friendsData = null; await loadFriends(); toast('Davetten vazgeçildi.'); } catch (error) { toast(error.message, true); } });
  on('[data-invite-confirm]', async el => { try { await mv().friendsInviteConfirm(el.dataset.inviteConfirm); friendsData = null; await loadFriends(); toast('Davet "kabul edildi" olarak işaretlendi.'); } catch (error) { toast(error.message, true); } });
  on('[data-code-read]', () => friendsReadCode());
  on('[data-code-clear]', () => { friendsPaste = null; render(); });
  on('[data-request-accept]', el => friendsAcceptRequest(el.dataset.requestAccept));
  on('[data-request-reject]', el => friendsRejectRequest(el.dataset.requestReject));
  on('[data-pack-import]', () => friendsImportPack());
  on('[data-share-selected]', () => openShareModal(q('#share-profile').value, q('#share-friend')?.value || ''));
  on('[data-java-refresh]', () => { javaInfo = null; render(); loadJavaInfo(true); });
  on('[data-java-ensure]', async el => {
    const major = el.dataset.javaEnsure; javaBusy = major; render(); toast(`Java ${major} indiriliyor…`);
    try { await mv().javaEnsure(major); toast(`Java ${major} hazır.`); javaInfo = null; } catch (error) { toast(error.message, true); }
    javaBusy = ''; render(); loadJavaInfo(true);
  });
  on('[data-backup-now]', async () => { backupBusy = true; render(); try { await mv().backupsCreate(); toast('Yedek alındı.'); } catch (error) { toast(error.message, true); } backupBusy = false; await loadBackups(); render(); });
  on('[data-backup-folder]', () => mv().backupsOpenFolder());
  on('[data-backup-save]', async () => { try { state = await api.saveSettings({ autoBackup: q('#backup-auto').checked, backupIntervalHours: +q('#backup-interval').value, backupKeep: +q('#backup-keep').value }); toast('Yedekleme ayarları kaydedildi.'); } catch (error) { toast(error.message, true); } });
  on('[data-backup-delete]', el => confirmModal('Yedek silinsin mi?', 'Bu yedek dosyası kalıcı olarak silinecek.', 'Sil', async () => { try { backupsData = await mv().backupsDelete(el.dataset.backupDelete); render(); toast('Yedek silindi.'); } catch (error) { toast(error.message, true); } }, true));
  on('[data-backup-restore]', el => confirmModal('Bu yedek geri yüklensin mi?', 'Mevcut profillerin ve ayarların bu yedekteki hâle döner. Önce otomatik bir güvenlik yedeği alınır.', 'Geri yükle', async () => {
    try { toast('Yedek geri yükleniyor…'); state = await mv().backupsRestore(el.dataset.backupRestore); currentProfileId = state.profiles[0]?.id || null; storageInfo = null; backupsData = null; page = 'home'; render(); toast('Yedek geri yüklendi.'); loadBackups(); }
    catch (error) { toast(error.message, true); }
  }));
  on('[data-owner-save]', () => ownerSaveSettings());
  on('[data-owner-create]', () => ownerCreateGist());
  on('[data-owner-add]', () => ownerAddDraft());
  on('[data-owner-publish]', () => ownerPublishNews());
  on('[data-owner-reset]', async () => { ownerDraft = []; await loadOwnerInfo(); toast('Liste sunucudan yeniden alındı.'); });
  on('[data-owner-drop]', el => { ownerDraft.splice(+el.dataset.ownerDrop, 1); render(); });
  on('[data-owner-image]', () => ownerPickImage());
  document.querySelectorAll('[data-owner-image-clear]').forEach(el => el.addEventListener('click', event => { event.stopPropagation(); ownerImageData = ''; render(); }));
  const ownerEditor = q('[data-owner-editor]');
  if (ownerEditor) ownerEditor.addEventListener('input', ownerRefreshPreview);
  const ownerImageInput = q('#owner-image-input');
  if (ownerImageInput) ownerImageInput.onchange = () => { ownerReadImage(ownerImageInput.files?.[0]); ownerImageInput.value = ''; };
  on('[data-assets-open]', () => mv().openAssetsFolder());
  on('[data-assets-rescan]', async () => { await loadAssetOverrides(); toast(`${assetInfo.files.length} özel görsel bulundu.`); if (page === 'settings') render(); });
}
function featuresAutoLoad() {
  if (page === 'home' && !newsData && !newsLoading) loadNews(false);
  if (page === 'settings') { loadJavaInfo(); loadBackups(); loadLaunchInfo(); loadOwnerInfo(); }
  if (page === 'friends') loadFriends();
  if (typeof accountAutoLoad === 'function') accountAutoLoad();
}
