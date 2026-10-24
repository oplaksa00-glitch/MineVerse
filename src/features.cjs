'use strict';
// MineVerse v0.8 özellik modülü: Java yönetimi, yedekleme, paylaşım, arkadaşlar,
// uyumluluk analizi, haber akışı, özel görsel klasörü.
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');

let ctx = null;
const isWin = process.platform === 'win32';
const javaBin = isWin ? 'java.exe' : 'java';
const nowIso = () => new Date().toISOString();

/* ====================== JAVA ====================== */
function requiredJava(mc) {
  const m = String(mc || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return 21; // snapshot / bilinmeyen: en güncel kararlı Java
  const a = +m[1], b = +m[2], c = +m[3] || 0;
  if (a >= 26) return 25; // yeni yıl tabanlı sürüm numaraları
  if (a === 1) {
    if (b <= 16) return 8;
    if (b < 20 || (b === 20 && c < 5)) return 17; // 1.17 – 1.20.4
    return 21; // 1.20.5+
  }
  return 21;
}
function parseJavaMajor(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  if (!m) return null;
  return m[1] === '1' ? +m[2] : +m[1];
}
function probeJava(exe) {
  return new Promise(resolve => {
    try {
      execFile(exe, ['-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
        const major = parseJavaMajor((stderr || '') + (stdout || ''));
        resolve(major ? { major, exe } : null);
      });
    } catch { resolve(null); }
  });
}
async function findJavaExe(dir, depth = 0) {
  const direct = path.join(dir, 'bin', javaBin);
  try { await fs.access(direct); return direct; } catch {}
  if (depth >= 2) return null;
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findJavaExe(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}
let javaCache = { at: 0, list: [] };
async function detectJava(force = false) {
  if (!force && Date.now() - javaCache.at < 20000) return javaCache.list;
  const candidates = [];
  const push = (exe, source) => { if (exe && !candidates.some(c => c.exe === exe)) candidates.push({ exe, source }); };
  const scanRoot = async (root, source) => {
    let entries = [];
    try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) if (entry.isDirectory()) { const exe = await findJavaExe(path.join(root, entry.name)); if (exe) push(exe, source); }
  };
  await scanRoot(path.join(ctx.APP_DIR(), 'java'), 'MineVerse');
  if (process.env.JAVA_HOME) push(path.join(process.env.JAVA_HOME, 'bin', javaBin), 'JAVA_HOME');
  try { await scanRoot(path.join(ctx.app.getPath('appData'), '.minecraft', 'runtime'), 'Minecraft Launcher'); } catch {}
  if (isWin) {
    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean)) {
      for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru']) await scanRoot(path.join(base, vendor), 'Sistem');
    }
  } else {
    await scanRoot('/usr/lib/jvm', 'Sistem');
    await scanRoot('/Library/Java/JavaVirtualMachines', 'Sistem');
  }
  push('java', 'PATH');
  const probed = await Promise.all(candidates.map(async c => { const r = await probeJava(c.exe); return r ? { ...r, source: c.source } : null; }));
  const list = probed.filter(Boolean).sort((a, b) => a.major - b.major);
  javaCache = { at: Date.now(), list };
  return list;
}
async function downloadJava(major) {
  if (!isWin) throw new Error(`Bu platformda otomatik Java indirme desteklenmiyor. Lütfen Java ${major} kur.`);
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  let link = '', checksum = '';
  try {
    const assets = await ctx.fetchJson(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=windows&vendor=eclipse`);
    const pkg = assets?.[0]?.binary?.package;
    link = pkg?.link || ''; checksum = pkg?.checksum || '';
  } catch {}
  if (!link) link = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/${arch}/jre/hotspot/normal/eclipse`;
  const buffer = await ctx.downloadBinary(link, { timeoutMs: 600000 });
  if (checksum && crypto.createHash('sha256').update(buffer).digest('hex') !== checksum.toLowerCase()) throw new Error('Java arşivinin doğrulaması başarısız oldu.');
  const dest = path.join(ctx.APP_DIR(), 'java', `jre-${major}`);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  extractZipTo(new AdmZip(buffer), dest, { maxEntryBytes: 120 * 1024 * 1024 });
  const exe = await findJavaExe(dest);
  if (!exe) throw new Error('İndirilen Java paketinde java.exe bulunamadı.');
  javaCache.at = 0;
  return { major, exe, source: 'MineVerse', downloaded: true };
}
async function ensureJava(major) {
  const list = await detectJava(true);
  const exact = list.find(j => j.major === major);
  if (exact) return { ...exact, downloaded: false };
  if (major >= 17) { const newer = list.find(j => j.major >= major); if (newer) return { ...newer, downloaded: false }; }
  return downloadJava(major);
}
async function resolveJava(gameVersion) { return ensureJava(requiredJava(gameVersion)); }

/* Zip açarken yol geçişini, aşırı büyük kaydı ve istenmeyen girdiyi engeller. */
function extractZipTo(zip, dest, options = {}) {
  const root = path.resolve(dest);
  const maxEntry = options.maxEntryBytes || 200 * 1024 * 1024;
  const wanted = options.only;
  let total = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (entry.header && entry.header.size > maxEntry) continue;
    if (wanted && !wanted(entry.entryName)) continue;
    const target = path.resolve(root, entry.entryName);
    if (target !== root && !target.startsWith(root + path.sep)) continue;
    total += entry.header?.size || 0;
    if (total > 2 * 1024 * 1024 * 1024) break;
    fsSync.mkdirSync(path.dirname(target), { recursive: true });
    fsSync.writeFileSync(target, entry.getData());
  }
}

/* ====================== YEDEKLEME ====================== */
const BACKUP_DIR = () => path.join(ctx.APP_DIR(), 'backups');
const safeBackupName = name => /^backup-[\w.\-]+\.zip$/.test(String(name || ''));
async function createBackup(reason = 'manual') {
  await fs.mkdir(BACKUP_DIR(), { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const name = `backup-${stamp}-${reason}.zip`;
  const zip = new AdmZip();
  if (fsSync.existsSync(ctx.STATE_FILE())) zip.addLocalFile(ctx.STATE_FILE());
  if (fsSync.existsSync(ctx.PROFILES_DIR())) zip.addLocalFolder(ctx.PROFILES_DIR(), 'profiles');
  const state = await ctx.getState();
  zip.addFile('backup-meta.json', Buffer.from(JSON.stringify({ app: 'MineVerse', createdAt: nowIso(), reason, profiles: state.profiles.length })));
  await fs.writeFile(path.join(BACKUP_DIR(), name), zip.toBuffer());
  await rotateBackups();
  return name;
}
async function listBackups() {
  let files = [];
  try { files = (await fs.readdir(BACKUP_DIR())).filter(safeBackupName); } catch { return []; }
  const out = [];
  for (const name of files) {
    try {
      const stat = await fs.stat(path.join(BACKUP_DIR(), name));
      const reason = (/-(manual|auto|pre-[a-z]+)\.zip$/.exec(name) || [])[1] || 'manual';
      out.push({ name, size: stat.size, createdAt: stat.mtime.toISOString(), reason });
    } catch {}
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function rotateBackups() {
  const state = await ctx.getState();
  const keep = Math.max(1, +state.settings.backupKeep || 5);
  const automatic = (await listBackups()).filter(b => b.reason !== 'manual');
  for (const old of automatic.slice(keep)) await fs.rm(path.join(BACKUP_DIR(), old.name), { force: true });
}
async function restoreBackup(name) {
  if (!safeBackupName(name)) throw new Error('Geçersiz yedek adı.');
  const file = path.join(BACKUP_DIR(), name);
  if (!fsSync.existsSync(file)) throw new Error('Yedek dosyası bulunamadı.');
  await createBackup('pre-restore');
  const zip = new AdmZip(file);
  const stateEntry = zip.getEntry('state.json');
  if (!stateEntry) throw new Error('Yedekte state.json yok; dosya bozuk olabilir.');
  const restored = JSON.parse(stateEntry.getData().toString('utf8'));
  await fs.rm(ctx.PROFILES_DIR(), { recursive: true, force: true });
  await fs.mkdir(ctx.PROFILES_DIR(), { recursive: true });
  const appDir = path.resolve(ctx.APP_DIR());
  extractZipTo(zip, appDir, { only: name => name.startsWith('profiles/'), maxEntryBytes: 200 * 1024 * 1024 });
  const rebase = p => { const parts = String(p).split(/[\\/]profiles[\\/]/); return parts.length > 1 ? path.join(ctx.PROFILES_DIR(), ...parts[parts.length - 1].split(/[\\/]/)) : p; };
  for (const profile of restored.profiles || []) for (const mod of profile.mods || []) if (mod.localPath) mod.localPath = rebase(mod.localPath);
  await ctx.saveState(restored);
  return ctx.getState();
}
async function maybeAutoBackup() {
  try {
    const state = await ctx.getState();
    if (state.settings.autoBackup === false) return;
    const hours = Math.max(1, +state.settings.backupIntervalHours || 24);
    const latest = (await listBackups()).find(b => b.reason === 'auto');
    if (!latest || Date.now() - new Date(latest.createdAt).getTime() > hours * 3600e3) await createBackup('auto');
  } catch {}
}
function startAuto() {
  setTimeout(maybeAutoBackup, 30000);
  setInterval(maybeAutoBackup, 3600e3).unref?.();
}
async function backupBefore(reason) { try { await createBackup(reason); } catch {} }

/* ====================== PAYLAŞIM ====================== */
const LOADERS = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];
function encodeShare(obj) { return 'MV1:' + zlib.deflateSync(Buffer.from(JSON.stringify(obj))).toString('base64url'); }
function decodeShare(code) {
  const text = String(code || '').trim();
  if (!text.startsWith('MV1:')) throw new Error('Geçersiz paylaşım kodu (MV1: ile başlamalı).');
  let obj;
  try { obj = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(4), 'base64url'), { maxOutputLength: 1 << 20 }).toString('utf8')); }
  catch { throw new Error('Paylaşım kodu okunamadı; eksik ya da bozuk olabilir.'); }
  if (!obj || obj.v !== 1 || typeof obj.name !== 'string' || typeof obj.gameVersion !== 'string' || !LOADERS.includes(obj.loader) || !Array.isArray(obj.mods) || obj.mods.length > 300) throw new Error('Paylaşım kodunun içeriği geçersiz.');
  obj.name = obj.name.slice(0, 60); obj.gameVersion = obj.gameVersion.slice(0, 20);
  obj.mods = obj.mods.filter(m => m && (m.s === 'Modrinth' || m.s === 'CurseForge') && typeof m.p === 'string' && typeof m.v === 'string' && m.p.length <= 64 && m.v.length <= 64).map(m => ({ s: m.s, p: m.p, v: m.v, n: String(m.n || m.p).slice(0, 80) }));
  obj.from = FRIEND_CODE_RE.test(String(obj.from || '')) ? obj.from : '';
  obj.to = FRIEND_CODE_RE.test(String(obj.to || '')) ? obj.to : '';
  obj.via = /^[A-Za-z0-9-]{1,40}$/.test(String(obj.via || '')) ? obj.via : '';
  obj.fromName = String(obj.fromName || 'Arkadaş').slice(0, 30);
  return obj;
}

/* ====================== ARKADAŞLIK ====================== */
/* Sunucu yok: davet kodu davet edenin MV kodunu taşır, tek kullanımlıktır ve
   arkadaşın sana gönderdiği paket kodu senin bekleyen davetini kendiliğinden kapatır. */
const FRIEND_CODE_RE = /^MV-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
function normalizeFriendCode(raw) {
  const upper = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const compact = upper.replace(/-/g, '');
  const shaped = /^MV[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(compact)
    ? `MV-${compact.slice(2, 6)}-${compact.slice(6, 10)}` : upper;
  if (!FRIEND_CODE_RE.test(shaped)) throw new Error('Arkadaş kodu MV-XXXX-XXXX biçiminde olmalı (0 yerine O, 1 yerine I olabilir, tekrar kontrol et).');
  return shaped;
}
function encodeInvite(invite) { return 'MVINV1:' + zlib.deflateSync(Buffer.from(JSON.stringify(invite))).toString('base64url'); }
function decodeInvite(code) {
  const text = String(code || '').trim();
  if (!text.startsWith('MVINV1:')) throw new Error('Bu bir davet kodu değil; davet kodu MVINV1: ile başlar.');
  let obj;
  try { obj = JSON.parse(zlib.inflateSync(Buffer.from(text.slice(7), 'base64url'), { maxOutputLength: 1 << 16 }).toString('utf8')); }
  catch { throw new Error('Davet kodu okunamadı; eksik ya da bozuk olabilir.'); }
  if (!obj || obj.v !== 1 || typeof obj.id !== 'string' || !FRIEND_CODE_RE.test(String(obj.code || ''))) throw new Error('Davet kodunun içeriği geçersiz.');
  return { v: 1, id: String(obj.id).slice(0, 40), name: String(obj.name || 'Arkadaş').slice(0, 30), code: obj.code, at: String(obj.at || '').slice(0, 32) };
}
function ensureRequests(state) {
  if (!Array.isArray(state.friends)) state.friends = [];
  if (!Array.isArray(state.outgoingInvites)) state.outgoingInvites = [];
  if (!Array.isArray(state.incomingRequests)) state.incomingRequests = [];
  state.friends = state.friends.filter(f => f && typeof f.id === 'string' && FRIEND_CODE_RE.test(String(f.code || '')));
  state.outgoingInvites = state.outgoingInvites.filter(i => i && typeof i.id === 'string');
  state.incomingRequests = state.incomingRequests.filter(r => r && typeof r.id === 'string');
}
function friendRow(state, code) { return (state.friends || []).find(f => f.code === code); }
function addFriend(state, { name, code, via, inviteId }) {
  ensureRequests(state);
  if (!FRIEND_CODE_RE.test(code)) throw new Error('Arkadaş kodu geçersiz.');
  const existing = friendRow(state, code);
  if (existing) { if (inviteId) { existing.via = existing.via || via; existing.inviteId = inviteId; } return { friend: existing, created: false }; }
  const friend = { id: crypto.randomUUID(), name: String(name || 'Arkadaş').slice(0, 30), code, via: via || 'manual', inviteId: inviteId || '', addedAt: nowIso() };
  state.friends = [friend, ...state.friends];
  return { friend, created: true };
}
function settleOutgoingInvite(state, key, how) {
  const invite = (state.outgoingInvites || []).find(i => i.status === 'pending' && (i.id === key || i.code === key));
  if (!invite) return null;
  invite.status = 'accepted';
  invite.answeredAt = nowIso();
  invite.answeredBy = how;
  return invite;
}

/* ====================== UYUMLULUK ANALİZİ ====================== */
function inspectJar(file) {
  try {
    const stat = fsSync.statSync(file);
    if (stat.size > 90 * 1024 * 1024) return null;
    const zip = new AdmZip(file);
    const has = n => !!zip.getEntry(n);
    let loader = null, modId = null;
    if (has('fabric.mod.json')) {
      loader = 'fabric';
      try { modId = JSON.parse(zip.getEntry('fabric.mod.json').getData().toString('utf8').replace(/^\uFEFF/, '')).id || null; } catch {}
    } else if (has('quilt.mod.json')) {
      loader = 'quilt';
      try { modId = JSON.parse(zip.getEntry('quilt.mod.json').getData().toString('utf8').replace(/^\uFEFF/, '')).quilt_loader?.id || null; } catch {}
    } else if (has('META-INF/neoforge.mods.toml')) {
      loader = 'neoforge';
      modId = (/modId\s*=\s*"([^"]+)"/.exec(zip.getEntry('META-INF/neoforge.mods.toml').getData().toString('utf8')) || [])[1] || null;
    } else if (has('META-INF/mods.toml')) {
      loader = 'forge';
      modId = (/modId\s*=\s*"([^"]+)"/.exec(zip.getEntry('META-INF/mods.toml').getData().toString('utf8')) || [])[1] || null;
    } else if (has('mcmod.info')) loader = 'forge';
    return { loader, modId };
  } catch { return null; }
}
const loaderCompatible = (modLoader, profileLoader) => modLoader === profileLoader || (profileLoader === 'quilt' && modLoader === 'fabric');
async function analyzeProfile(profileId) {
  const state = await ctx.getState();
  const profile = state.profiles.find(p => p.id === profileId);
  if (!profile) throw new Error('Profil bulunamadı.');
  const loader = String(profile.loader).toLowerCase();
  const mods = profile.mods.filter(m => m.enabled !== false);
  const issues = [];
  const byProject = new Map();
  for (const mod of mods) if (mod.projectId) { const key = `${mod.source}:${mod.projectId}`; byProject.set(key, [...(byProject.get(key) || []), mod]); }
  for (const list of byProject.values()) if (list.length > 1) issues.push({ severity: 'error', type: 'duplicate', title: `${list[0].name} birden fazla kez eklenmiş`, detail: 'Aynı mod iki ayrı dosya olarak profilde duruyor; oyun açılırken çakışabilir. Birini sil.' });
  const jarIds = new Map();
  for (const mod of mods) {
    if (mod.gameVersions?.length && !mod.gameVersions.includes(profile.gameVersion)) issues.push({ severity: 'warn', type: 'version', title: `${mod.name}: Minecraft sürümü uyumsuz olabilir`, detail: `Bu mod ${mod.gameVersions.slice(0, 4).join(', ')} için yayınlanmış; profil ${profile.gameVersion}.` });
    if (mod.loaders?.length && !mod.loaders.some(l => loaderCompatible(l, loader))) issues.push({ severity: 'error', type: 'loader', title: `${mod.name}: yükleyici uyumsuz`, detail: `Mod ${mod.loaders.join('/')} için; profil ${profile.loader} kullanıyor.` });
    if (mod.localPath) {
      const info = inspectJar(mod.localPath);
      if (info?.loader && !loaderCompatible(info.loader, loader) && !(mod.loaders?.length)) issues.push({ severity: 'error', type: 'loader', title: `${mod.name}: dosya ${info.loader} modu`, detail: `Profil ${profile.loader} kullanıyor; bu jar yüklenmeyebilir.` });
      if (info?.modId) { jarIds.set(info.modId, [...(jarIds.get(info.modId) || []), mod]); }
    }
  }
  for (const [id, list] of jarIds) if (list.length > 1) issues.push({ severity: 'error', type: 'duplicate-id', title: `"${id}" kimlikli mod birden fazla jar'da`, detail: `${list.map(m => m.fileName).join(', ')} aynı modu içeriyor; yalnızca birini tut.` });
  let online = false;
  const missingDeps = [];
  const versionIds = [...new Set(mods.filter(m => m.source === 'Modrinth' && m.versionId).map(m => m.versionId))].slice(0, 100);
  if (versionIds.length) {
    try {
      const versions = await ctx.fetchJson(`https://api.modrinth.com/v2/versions?ids=${encodeURIComponent(JSON.stringify(versionIds))}`);
      online = true;
      const present = new Set(mods.map(m => m.projectId).filter(Boolean));
      const missing = new Map();
      for (const version of versions) {
        const owner = mods.find(m => m.versionId === version.id);
        for (const dep of version.dependencies || []) {
          if (!dep.project_id) continue;
          if (dep.dependency_type === 'required' && !present.has(dep.project_id)) missing.set(dep.project_id, [...(missing.get(dep.project_id) || []), owner?.name || version.name]);
          if (dep.dependency_type === 'incompatible' && present.has(dep.project_id)) issues.push({ severity: 'error', type: 'incompatible', title: `${owner?.name || version.name} bir modla uyumsuz`, detail: 'Profildeki başka bir mod, bu modun resmî uyumsuzluk listesinde.', projectId: dep.project_id });
        }
      }
      if (missing.size) {
        let titles = {};
        try { for (const p of await ctx.fetchJson(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify([...missing.keys()]))}`)) titles[p.id] = p.title; } catch {}
        for (const [projectId, owners] of missing) {
          const title = titles[projectId] || projectId;
          issues.push({ severity: 'error', type: 'missing', title: `Eksik bağımlılık: ${title}`, detail: `${[...new Set(owners)].slice(0, 3).join(', ')} bu modu zorunlu istiyor.`, projectId });
          missingDeps.push({ projectId, title, requiredBy: [...new Set(owners)].slice(0, 3) });
        }
      }
    } catch {}
  }
  const rank = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { issues, missingDeps, checked: mods.length, online, at: nowIso() };
}

/* Eksik bağımlılıkları profilin sürümüne/yükleyicisine uygun sürümle otomatik kurar. */
async function installMissingDeps(profileId) {
  const state = await ctx.getState();
  const profile = state.profiles.find(p => p.id === profileId);
  if (!profile) throw new Error('Profil bulunamadı.');
  const analysis = await analyzeProfile(profileId);
  const installed = []; const failed = [];
  for (const dep of analysis.missingDeps) {
    try {
      const versions = await ctx.fetchJson(`https://api.modrinth.com/v2/project/${dep.projectId}/version`);
      const loader = String(profile.loader).toLowerCase();
      const match = versions.find(v => v.game_versions?.includes(profile.gameVersion) && v.loaders?.includes(loader))
        || versions.find(v => v.game_versions?.includes(profile.gameVersion));
      if (!match) throw new Error(`${profile.gameVersion} / ${profile.loader} için uygun sürüm yok.`);
      await ctx.installModrinthVersion(profileId, dep.projectId, match.id);
      installed.push({ title: dep.title, version: match.version_number });
    } catch (error) { failed.push({ name: dep.title, reason: error.message }); }
  }
  return { installed, failed, state: await ctx.getState() };
}

/* ====================== HABERLER ====================== */
let newsCache = { key: '', at: 0, data: null };
const MV_NOTES = [
  { kind: 'mv', id: 'v11', title: 'MineVerse 0.11: davetle arkadaşlık + güvenlik kilitleri', summary: 'Tek adımlı davet kodu, kabul/ret ve istek geçmişi; arkadaşından paketi önizleyerek kur. CurseForge anahtarın artık kaynakta değil, gelen kodlarda yol denetimi, CSP ve sandbox.', tag: 'MineVerse', emoji: '🤝', date: '2026-10-24T00:00:00Z' },
  { kind: 'mv', id: 'v10', title: 'MineVerse 0.10: sağlam başlatma, doğru aktarım, kendi haberlerin', summary: 'Oyun kendi içinde açılıyor, modlar launcher’ın okuduğu klasöre gidiyor; arka planına fotoğrafını koy, vurgu rengini seç ve haberleri yönetici panelinden yayımla.', tag: 'MineVerse', emoji: '🛰️', date: '2026-10-24T00:00:00Z' },
  { kind: 'mv', id: 'v09', title: 'MineVerse 0.9: hesaplar, gerçek başlatma, ikonlar', summary: 'Kalıcı UUID ve MV kodunla Hesabım sayfası, tek tıkla eksik bağımlılık kurulumu ve istersen Minecraft’ı doğrudan açan başlatıcı.', tag: 'MineVerse', emoji: '🚀', date: '2026-10-24T00:00:00Z' },
  { kind: 'mv', id: 'icons', title: 'Her ikonu fotoğraf yapabilirsin', summary: 'npm run icons ile anahtarları gör, resmi ui/nav-home.png gibi özel görsel klasörüne at; kod değiştirmeye gerek yok.', tag: 'Yeni', emoji: '🎨', date: '2026-10-24T00:00:00Z' },
  { kind: 'mv', id: 'deps', title: 'Eksik kütüphaneleri kendisi kurar', summary: 'Uyumluluk analizi artık eksik bağımlılıkları bulmakla kalmaz, profilinin sürümüne uygun sürümünü tek tıkla indirir.', tag: 'Yeni', emoji: '🧬', date: '2026-10-24T00:00:00Z' },
  { kind: 'mv', id: 'v08', title: 'MineVerse 0.8: paylaşım, yedekleme, Java yönetimi', summary: 'Profilini paylaşım koduyla arkadaşlarına gönder, otomatik yedekle, doğru Java sürümünü otomatik kur.', tag: 'MineVerse', emoji: '☕', date: '2026-10-20T00:00:00Z' },
  { kind: 'mv', id: 'analysis', title: 'Akıllı uyumluluk analizi', summary: 'Eksik bağımlılık, yükleyici/sürüm uyumsuzluğu ve çakışan modlar tek tıkla bulunur.', tag: 'MineVerse', emoji: '🔍', date: '2026-10-20T00:00:00Z' }
];
/* ====================== YÖNETİCİ HABER PANELİ ======================
   Haberler GitHub Gist üzerinde durur: sen yayımlarsın, kurulu her MineVerse o
   bağlantıdan çeker. Başkasının bilgisayarında panel görünmez çünkü token yalnız
   senin state.json'unda. Herkeste otomatik görünsün istersen gist ham bağlantısını
   aşağıdaki sabite yaz (veya Ayarlar → Yönetici paneli → "herkeste" alanına kurallar). */
const DEFAULT_NEWS_FEED_URL = '';
/* Yönetici paneli artık koda değil, "sahip makinesi" işaretine bağlı:
   APP_DIR içinde owner.flag dosyası olan bilgisayarda panel görünür ve otomatik açık olur.
   Başka hiçbir kurulumda (indirilen .exe / kaynak) bu dosya olmadığı için panel hiç gözükmaz. */
const OWNER_FLAG_FILE = () => path.join(ctx.APP_DIR(), 'owner.flag');
function isOwnerMachine() { try { return fsSync.existsSync(OWNER_FLAG_FILE()); } catch { return false; } }
let ownerUnlocked = false;
const NEWS_FILE_NAME = 'mineverse-news.json';
const NEWS_LOCAL_COPY = () => path.join(ctx.APP_DIR(), 'news-feed.json');
/* Token, state.json'a hiç yazılmaz: state tüm sayfalara IPC ile dağıtılıyor.
   Bu yüzden ayrı bir dosyada durur ve yalnızca ana süreçte okunur. */
const OWNER_SECRET_FILE = () => path.join(ctx.APP_DIR(), 'owner-secret.json');
async function readOwnerSecret() {
  try { return JSON.parse(await fs.readFile(OWNER_SECRET_FILE(), 'utf8')) || {}; } catch { return {}; }
}
async function saveOwnerSecret(patch) {
  const current = await readOwnerSecret();
  const next = { ...current, ...patch };
  for (const [key, value] of Object.entries(next)) if (!value) delete next[key];
  await fs.writeFile(OWNER_SECRET_FILE(), JSON.stringify(next, null, 2));
  return next;
}
async function migrateOwnerToken() {
  try {
    const file = ctx.STATE_FILE();
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    const legacy = String(raw?.settings?.githubToken || '').trim();
    if (!legacy) return;
    await saveOwnerSecret({ githubToken: legacy });
    delete raw.settings.githubToken;
    await fs.writeFile(file, JSON.stringify(raw, null, 2));
  } catch {}
}
const feedUrlOf = state => String(state?.settings?.newsFeedUrl || DEFAULT_NEWS_FEED_URL || '').trim();
function normalizeOwnerNews(item) {
  return {
    kind: 'mv', id: String(item?.id || crypto.randomUUID()), title: String(item?.title || '').slice(0, 120),
    summary: String(item?.summary || '').slice(0, 400), url: /^https:\/\//i.test(item?.url || '') ? item.url : '',
    image: /^https:\/\//i.test(item?.image || '') ? item.image : '',
    tag: String(item?.tag || 'Duyuru').slice(0, 24), emoji: String(item?.emoji || '📰').slice(0, 4),
    date: String(item?.date || new Date().toISOString())
  };
}
/* Haber görseli data-url olarak gelirse (yönetici panelinden) Gist'e ayrı bir
   dosya (mv-img-<id>.png) olarak yüklenir ve habere ham bağlantısı yazılır. */
function splitImageData(item) {
  const dataUrl = String(item?.imageData || '');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return { item: normalizeOwnerNews(item), imageBuffer: null };
  const buffer = Buffer.from(match[1], 'base64');
  if (buffer.length > 1024 * 1024) throw new Error('Haber görseli 1 MB sınırını aşıyor; daha küçük bir resim seç.');
  return { item: normalizeOwnerNews(item), imageBuffer: buffer };
}
async function uploadNewsImages(token, gistId, prepared) {
  const files = {};
  for (const { item, imageBuffer } of prepared) {
    if (!imageBuffer) continue;
    files[`mv-img-${item.id}.png`] = { content: imageBuffer.toString('base64') };
  }
  if (!Object.keys(files).length) return;
  const gist = await githubRequest('/gists/' + encodeURIComponent(gistId), 'PATCH', token, { files });
  for (const { item, imageBuffer } of prepared) {
    if (!imageBuffer) continue;
    const file = gist.files?.[`mv-img-${item.id}.png`];
    if (file?.raw_url) item.image = file.raw_url;
  }
}
async function loadOwnerNews(state) {
  const url = feedUrlOf(state);
  if (!url) return { items: [], source: 'none' };
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'MineVerse', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = JSON.parse(await response.text());
    const items = (Array.isArray(parsed) ? parsed : parsed.items || []).map(normalizeOwnerNews);
    await fs.writeFile(NEWS_LOCAL_COPY(), JSON.stringify(items, null, 2));
    return { items, source: 'online', url };
  } catch (error) {
    try {
      const items = JSON.parse(await fs.readFile(NEWS_LOCAL_COPY(), 'utf8')).map(normalizeOwnerNews);
      return { items, source: 'offline', url, error: error.message };
    } catch { return { items: [], source: 'none', url, error: error.message }; }
  }
}
async function githubRequest(pathname, method, token, body) {
  const response = await fetch('https://api.github.com' + pathname, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'MineVerse', Accept: 'application/vnd.github+json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    const reason = data?.message ? (data.message + (data.errors?.length ? ` (${data.errors.map(e => e.message).join(', ')})` : '')) : `HTTP ${response.status}`;
    throw new Error(reason === 'Bad credentials' ? 'GitHub tokenın reddedildi (eski ya da silinmiş). Yeni bir token oluştur.' : reason);
  }
  return data;
}

async function getNews(force, filters = {}) {
  const key = JSON.stringify(filters || {});
  if (!force && newsCache.data && newsCache.key === key && Date.now() - newsCache.at < 30 * 60e3) return newsCache.data;
  const out = { minecraft: [], mods: [], mineverse: MV_NOTES, errors: [] };
  const state = await ctx.getState();
  const ownerNews = await loadOwnerNews(state);
  out.mineverse = [...ownerNews.items, ...MV_NOTES.filter(note => !ownerNews.items.some(o => o.id === note.id))];
  out.feed = { source: ownerNews.source, url: feedUrlOf(state), count: ownerNews.items.length, error: ownerNews.error || '' };
  try {
    const json = await ctx.fetchJson('https://launchercontent.mojang.com/v2/javaPatchNotes.json');
    out.minecraft = (json.entries || []).slice(0, 8).map(e => ({
      kind: 'mc', id: String(e.id || e.version), title: e.title || `Minecraft ${e.version}`, summary: e.shortText || '', date: e.date || '',
      image: e.image?.url ? 'https://launchercontent.mojang.com' + e.image.url : '',
      tag: e.type === 'release' ? 'Sürüm' : 'Snapshot', tagClass: e.type === 'release' ? 'rel' : 'snap',
      url: `https://minecraft.wiki/w/Java_Edition_${encodeURIComponent(e.version || '')}`
    }));
    if (!out.minecraft.length) out.errors.push('minecraft');
  } catch { out.errors.push('minecraft'); }
  try {
    const mods = await ctx.searchModrinth('', filters || {}, 'updated', 0);
    out.mods = mods.slice(0, 9).map(m => ({ kind: 'mod', id: m.id, source: m.source, title: m.title, summary: m.summary, image: m.icon, tag: m.author || 'Modrinth' }));
  } catch { out.errors.push('mods'); }
  newsCache = { key, at: Date.now(), data: out };
  return out;
}

/* ====================== ÖZEL GÖRSELLER ====================== */
const ASSET_DIR = () => path.join(ctx.APP_DIR(), 'custom-assets');
const BUILTIN_SKINS_DIR = () => path.join(__dirname, 'renderer', 'assets', 'skins');
const CUSTOM_SKINS_DIR = () => path.join(ASSET_DIR(), 'skins');
const BUILTIN_WALLPAPERS_DIR = () => path.join(__dirname, 'renderer', 'assets', 'wallpapers');
function parsePngSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < pngMagic.length; i++) if (buffer[i] !== pngMagic[i]) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
function isUnderAnyPath(target, root) {
  const resolved = path.resolve(String(target || ''));
  const base = path.resolve(String(root || ''));
  return resolved === base || resolved.startsWith(base + path.sep);
}
const ASSET_README = `MineVerse özel görsel klasörü
=============================
Buraya koyduğun resimler uygulamanın kendi görsellerinin yerine geçer.
Dosya adı ve alt klasör, uygulamadaki (src/renderer/assets) ile AYNI olmalı:

  blocks/grass.png      -> çim bloğu ikonu   (diğer bloklar: stone, dirt, diamond ...)
  logo-128.png          -> kenar çubuğu logosu
  logo-256.png          -> açılış ekranı logosu
  star-32.png           -> yıldız ikonu

Biçim: PNG, JPG, GIF, WEBP veya SVG olabilir. Kare resim en iyisidir.
Bozuk ya da okunamayan bir resim koyarsan uygulama açılmaya devam eder ve
orijinal görsel kullanılır. Değişiklik için uygulamayı yeniden aç.
`;
async function listOverrides() {
  const dir = ASSET_DIR();
  await fs.mkdir(dir, { recursive: true });
  const readme = path.join(dir, 'OKU-BENI.txt');
  if (!fsSync.existsSync(readme)) await fs.writeFile(readme, ASSET_README, 'utf8');
  const files = [];
  const walk = async (current, rel, depth) => {
    if (depth > 4) return;
    let entries = [];
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), r, depth + 1);
      else if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(entry.name)) files.push(r);
    }
  };
  await walk(dir, '', 0);
  return { dir, files };
}

/* ====================== HESAP: kalıcı kimlik + MV kodu ======================
   İki kimlik vardır ve ikisi farklı işe yarar:
   - account.id  : hesap oluşturulurken üretilen rastgele UUID. ASLA değişmez.
                   MV-XXXX-XXXX arkadaş kodu bundan türetilir (kod = UUID'nin okunur hâli).
   - account.uuid: oyundaki Mojang "offline" UUID'si, görünen adından türetilir
                   (md5("OfflinePlayer:"+ad), UUID v3). Ad değişirse bu da değişir;
                   Minecraft'taki envanter/ilerleme adınla eşleştiği için bu davranış doğrudur. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function dashedUuid(hex32) {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}
function offlineUuid(name) {
  const digest = crypto.createHash('md5').update(`OfflinePlayer:${String(name || 'Oyuncu')}`, 'utf8').digest();
  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return dashedUuid(digest.toString('hex'));
}
function mvCodeFromId(id) {
  const hex = String(id).replace(/-/g, '').slice(0, 8);
  const letters = Array.from(hex, ch => CODE_ALPHABET[parseInt(ch, 16)]).join('');
  return `MV-${letters.slice(0, 4)}-${letters.slice(4, 8)}`;
}
function newAccount(name, icon) {
  const cleanName = String(name || '').trim().slice(0, 16) || 'Yerel Oyuncu';
  const id = crypto.randomUUID();
  return {
    id, code: mvCodeFromId(id), displayName: cleanName,
    uuid: offlineUuid(cleanName),
    icon: icon && icon.type ? icon : { type: 'block', value: 'grass' },
    createdAt: nowIso(), lastUsedAt: null
  };
}
const accountView = account => ({ ...account, offline: true });
function publicAccount(account) {
  return { displayName: account.displayName, icon: account.icon, code: account.code, id: account.id, uuid: account.uuid };
}
async function ensureAccounts(state) {
  if (!Array.isArray(state.accounts)) state.accounts = [];
  state.accounts = state.accounts.filter(a => a && typeof a.id === 'string');
  for (const account of state.accounts) {
    account.displayName = String(account.displayName || 'Yerel Oyuncu').slice(0, 16);
    account.uuid = offlineUuid(account.displayName);
    account.code = account.code || mvCodeFromId(account.id);
    if (!account.icon || !account.icon.type) account.icon = { type: 'block', value: 'grass' };
  }
  if (!state.accounts.length) {
    const first = newAccount(state.settings?.account?.displayName || 'Yerel Oyuncu', state.settings?.account?.icon);
    state.accounts.push(first);
    state.settings.activeAccountId = first.id;
  }
  let active = state.accounts.find(a => a.id === state.settings.activeAccountId) || state.accounts[0];
  state.settings.activeAccountId = active.id;
  state.settings.account = publicAccount(active);
  return active;
}
async function accountMutate(accountId, edit) {
  const state = await ctx.getState();
  await ensureAccounts(state);
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) throw new Error('Hesap bulunamadı.');
  edit(account);
  account.displayName = String(account.displayName || 'Yerel Oyuncu').trim().slice(0, 16) || 'Yerel Oyuncu';
  account.uuid = offlineUuid(account.displayName);
  account.code = mvCodeFromId(account.id);
  state.settings.account = publicAccount(state.accounts.find(a => a.id === state.settings.activeAccountId) || account);
  await ctx.saveState(state);
  return state;
}

/* ====================== ARAYÜZ İKONLARI (fotoğrafla değiştirilebilir) ====================== */
const BUILTIN_UI_DIR = () => path.join(__dirname, 'renderer', 'assets', 'ui');
let uiIconCache = { at: 0, list: [] };
async function listUiIcons(force = false) {
  if (!force && Date.now() - uiIconCache.at < 15000) return uiIconCache.list;
  const found = new Set();
  for (const dir of [BUILTIN_UI_DIR(), path.join(ASSET_DIR(), 'ui')]) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const match = /^(.+)\.(png|jpe?g|gif|webp|svg)$/i.exec(entry.name);
      if (entry.isFile() && match) found.add(match[1]);
    }
  }
  uiIconCache = { at: Date.now(), list: [...found].sort() };
  return uiIconCache.list;
}

/* ====================== IPC ====================== */
const friendCode = () => { const alphabet = CODE_ALPHABET; const pick = n => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); return `MV-${pick(4)}-${pick(4)}` };

function register(context) {
  ctx = context;
  migrateOwnerToken().catch(() => {});
  const { ipcMain, shell } = ctx;
  // Java
  ipcMain.handle('java:status', async (_, force) => {
    const state = await ctx.getState();
    const detected = await detectJava(!!force);
    return {
      detected, managedDir: path.join(ctx.APP_DIR(), 'java'),
      profiles: state.profiles.map(p => { const required = requiredJava(p.gameVersion); return { id: p.id, name: p.name, gameVersion: p.gameVersion, required, ready: detected.some(j => j.major === required || (required >= 17 && j.major >= required)) }; })
    };
  });
  ipcMain.handle('java:ensure', (_, major) => ensureJava(+major));
  // Yedekleme
  ipcMain.handle('backups:list', () => listBackups());
  ipcMain.handle('backups:create', async () => { const name = await createBackup('manual'); return { name, list: await listBackups() }; });
  ipcMain.handle('backups:restore', (_, name) => restoreBackup(name));
  ipcMain.handle('backups:delete', async (_, name) => { if (!safeBackupName(name)) throw new Error('Geçersiz yedek adı.'); await fs.rm(path.join(BACKUP_DIR(), name), { force: true }); return listBackups(); });
  ipcMain.handle('backups:openFolder', async () => { await fs.mkdir(BACKUP_DIR(), { recursive: true }); return shell.openPath(BACKUP_DIR()); });
  // Paylaşım
  ipcMain.handle('share:create', async (_, profileId, friendId) => {
    const state = await ctx.getState();
    const profile = state.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Profil bulunamadı.');
    const active = await ensureAccounts(state);
    const target = friendId ? (state.friends || []).find(f => f.id === friendId) : null;
    const shareable = profile.mods.filter(m => (m.source === 'Modrinth' || m.source === 'CurseForge') && m.projectId && m.versionId);
    const code = encodeShare({ v: 1, name: profile.name, gameVersion: profile.gameVersion, loader: profile.loader, icon: profile.icon?.type === 'custom' ? null : (profile.icon || null), from: active.code, fromName: active.displayName, to: target?.code || '', via: target?.inviteId || '', mods: shareable.map(m => ({ s: m.source, p: String(m.projectId), v: String(m.versionId), n: String(m.name || '').slice(0, 80) })) });
    return { code, shared: shareable.length, skipped: profile.mods.length - shareable.length, from: active.code, fromName: active.displayName, to: target?.code || '', forFriend: target ? target.name : '' };
  });
  ipcMain.handle('share:preview', (_, code) => {
    const pack = decodeShare(code);
    return { name: pack.name, gameVersion: pack.gameVersion, loader: pack.loader, from: pack.from, fromName: pack.fromName, count: pack.mods.length, mods: pack.mods.map(m => ({ name: m.n, source: m.s })) };
  });
  ipcMain.handle('share:import', async (event, code, friendId) => {
    const pack = decodeShare(code);
    let state = await ctx.getState();
    const profile = { id: crypto.randomUUID(), name: ctx.clean(pack.name) || 'Paylaşılan profil', gameVersion: pack.gameVersion, loader: pack.loader, icon: pack.icon && pack.icon.type && pack.icon.type !== 'custom' ? pack.icon : { type: 'block', value: 'grass' }, mods: [] };
    state.profiles.push(profile);
    await ctx.saveState(state);
    const failed = []; let ok = 0;
    for (let i = 0; i < pack.mods.length; i++) {
      const m = pack.mods[i];
      try { event.sender.send('share:progress', { done: i, total: pack.mods.length, name: m.n }); } catch {}
      try {
        if (m.s === 'Modrinth') await ctx.installModrinthVersion(profile.id, m.p, m.v);
        else { const st = await ctx.getState(); await ctx.installCurseForgeFile(profile.id, m.p, m.v, ctx.curseForgeKey(st)); }
        ok++;
      } catch (error) { failed.push({ name: m.n, reason: error.message }); }
    }
    state = await ctx.getState();
    const active = await ensureAccounts(state);
    ensureRequests(state);
    let friend = (state.friends || []).find(f => f.id === friendId) || null;
    if (pack.from) {
      const added = addFriend(state, { name: friend?.name || pack.fromName, code: pack.from, via: 'invite', inviteId: friend?.inviteId || '' });
      friend = added.friend;
      const settled = settleOutgoingInvite(state, pack.via, 'paket') || (pack.to ? settleOutgoingInvite(state, pack.to, 'paket') : null);
      if (settled) settled.answeredWith = profile.name;
      if (!settled) {
        const known = (state.friends || []).find(f => f.code === pack.from);
        if (known && known.inviteId) known.mutual = true;
      }
      if (pack.to && pack.to === active.code) friend.mutual = true;
    }
    state.inbox = [{ id: crypto.randomUUID(), from: friend?.name || pack.fromName || 'Bilinmeyen', fromCode: friend?.code || pack.from || '', toCode: active?.code || '', profileName: profile.name, count: ok, failed: failed.length, at: nowIso() }, ...(state.inbox || [])].slice(0, 50);
    await ctx.saveState(state);
    return { state, profileId: profile.id, ok, failed, friend: friend ? { id: friend.id, name: friend.name, code: friend.code } : null };
  });
  // Hesap (kalıcı UUID + MV kodu)
  ipcMain.handle('account:list', async () => {
    const state = await ctx.getState();
    const active = await ensureAccounts(state);
    await ctx.saveState(state);
    return {
      active: accountView(active), accounts: state.accounts.map(accountView),
      inbox: state.inbox || [], friends: state.friends || [],
      offlineNote: 'Bu kimlik bu bilgisayarda üretilir; MV kodun kalıcı hesabının (UUID) okunabilir hâlidir.'
    };
  });
  ipcMain.handle('account:create', async (_, name, icon) => {
    const state = await ctx.getState();
    await ensureAccounts(state);
    const account = newAccount(name, icon);
    if (state.accounts.some(a => a.displayName.toLowerCase() === account.displayName.toLowerCase())) throw new Error('Bu görünen ada sahip bir hesap zaten var; oyun ilerlemesi ad ile eşleştiği için adlar benzersiz olmalı.');
    state.accounts.push(account);
    state.settings.activeAccountId = account.id;
    state.settings.account = publicAccount(account);
    await ctx.saveState(state);
    return state;
  });
  ipcMain.handle('account:rename', (_, accountId, name) => accountMutate(accountId, account => { account.displayName = name; }));
  ipcMain.handle('account:setIcon', (_, accountId, icon) => accountMutate(accountId, account => { if (icon && icon.type) account.icon = icon; }));
  ipcMain.handle('account:use', async (_, accountId) => {
    const state = await ctx.getState();
    await ensureAccounts(state);
    const account = state.accounts.find(a => a.id === accountId);
    if (!account) throw new Error('Hesap bulunamadı.');
    state.settings.activeAccountId = account.id;
    account.lastUsedAt = nowIso();
    state.settings.account = publicAccount(account);
    await ctx.saveState(state);
    return state;
  });
  ipcMain.handle('account:delete', async (_, accountId) => {
    const state = await ctx.getState();
    await ensureAccounts(state);
    if (state.accounts.length <= 1) throw new Error('Son hesabını silemezsin; önce yeni bir hesap oluştur.');
    state.accounts = state.accounts.filter(a => a.id !== accountId);
    if (state.settings.activeAccountId === accountId) state.settings.activeAccountId = state.accounts[0].id;
    await ensureAccounts(state);
    await ctx.saveState(state);
    return state;
  });
  // Arkadaşlar (yerel rehber + davet/istek)
  const friendsSnapshot = state => ({
    code: state.code, uuid: state.uuid, name: state.name,
    friends: state.friends || [], inbox: state.inbox || [],
    outgoing: (state.outgoingInvites || []).slice(0, 40), incoming: (state.incomingRequests || []).slice(0, 40)
  });
  ipcMain.handle('friends:me', async () => {
    const state = await ctx.getState();
    const active = await ensureAccounts(state);
    ensureRequests(state);
    await ctx.saveState(state);
    return friendsSnapshot({ ...state, code: active.code, uuid: active.uuid, name: active.displayName });
  });
  ipcMain.handle('friends:add', async (_, name, code) => {
    const clean = String(name || '').trim().slice(0, 30);
    const normalized = normalizeFriendCode(code);
    if (!clean) throw new Error('Arkadaşın adını yaz.');
    const state = await ctx.getState();
    const active = await ensureAccounts(state);
    ensureRequests(state);
    if (active.code === normalized) throw new Error('Bu senin kendi kodun; kendinle arkadaş olunmaz.');
    if (state.accounts.some(a => a.code === normalized)) throw new Error('Bu kod bu bilgisayardaki başka bir hesaba ait.');
    if (friendRow(state, normalized)) throw new Error('Bu arkadaş zaten rehberinde.');
    addFriend(state, { name: clean, code: normalized, via: 'manual' });
    await ctx.saveState(state);
    return state.friends;
  });
  ipcMain.handle('friends:remove', async (_, id) => {
    const state = await ctx.getState();
    ensureRequests(state);
    const gone = (state.friends || []).find(f => f.id === id);
    state.friends = (state.friends || []).filter(f => f.id !== id);
    for (const invite of state.outgoingInvites) if (gone && invite.code === gone.code && invite.status === 'accepted') invite.status = 'revoked';
    await ctx.saveState(state);
    return state.friends;
  });
  ipcMain.handle('friends:invite', async (_, label) => {
    const state = await ctx.getState();
    const active = await ensureAccounts(state);
    ensureRequests(state);
    const invite = { v: 1, id: crypto.randomUUID(), name: active.displayName, code: active.code, at: nowIso() };
    state.outgoingInvites = [{
      id: invite.id, code: invite.code, label: String(label || '').trim().slice(0, 30),
      at: invite.at, status: 'pending', codeText: encodeInvite(invite)
    }, ...state.outgoingInvites].slice(0, 60);
    await ctx.saveState(state);
    return { inviteCode: invite.id, code: encodeInvite(invite), outgoing: state.outgoingInvites, me: active.code };
  });
  ipcMain.handle('friends:inviteCancel', async (_, inviteId) => {
    const state = await ctx.getState();
    ensureRequests(state);
    const invite = state.outgoingInvites.find(i => i.id === inviteId);
    if (!invite) throw new Error('Davet bulunamadı.');
    if (invite.status === 'accepted') throw new Error('Bu davet zaten kabul edilmiş.');
    invite.status = 'revoked';
    invite.revokedAt = nowIso();
    await ctx.saveState(state);
    return state.outgoingInvites;
  });
  ipcMain.handle('friends:inviteConfirm', async (_, inviteId) => {
    const state = await ctx.getState();
    ensureRequests(state);
    const invite = state.outgoingInvites.find(i => i.id === inviteId);
    if (!invite) throw new Error('Davet bulunamadı.');
    if (invite.status !== 'pending') throw new Error('Bu davet bekliyor değil.');
    addFriend(state, { name: invite.label || 'Arkadaş', code: invite.code, via: 'invite', inviteId: invite.id });
    invite.status = 'accepted';
    invite.answeredAt = nowIso();
    invite.answeredBy = 'elle';
    await ctx.saveState(state);
    return state.friends;
  });
  ipcMain.handle('friends:decode', async (_, raw) => {
    const state = await ctx.getState();
    const active = await ensureAccounts(state);
    ensureRequests(state);
    const text = String(raw || '').trim();
    if (text.startsWith('MVINV1:')) {
      const invite = decodeInvite(text);
      if (invite.code === active.code || state.accounts.some(a => a.code === invite.code)) throw new Error('Bu kod bu bilgisayardaki bir hesaba ait; kendi davetini kabul edemezsin.');
      const seen = state.incomingRequests.find(r => r.id === invite.id);
      if (seen && seen.status !== 'pending') throw new Error(seen.status === 'accepted' ? 'Bu davet zaten kabul edilmişti.' : 'Bu davet daha önce reddedilmiş.');
      const pending = state.incomingRequests.find(r => r.id === invite.id && r.status === 'pending');
      if (pending) return { kind: 'invite', already: true, request: pending };
      const request = { id: invite.id, code: invite.code, name: invite.name, at: invite.at, receivedAt: nowIso(), status: 'pending' };
      state.incomingRequests = [request, ...state.incomingRequests].slice(0, 60);
      await ctx.saveState(state);
      return { kind: 'invite', already: false, request };
    }
    const pack = decodeShare(text);
    return { kind: 'pack', pack: { name: pack.name, gameVersion: pack.gameVersion, loader: pack.loader, from: pack.from, fromName: pack.fromName, count: pack.mods.length, mods: pack.mods.map(m => ({ name: m.n, source: m.s })) } };
  });
  ipcMain.handle('friends:accept', async (_, requestId) => {
    const state = await ctx.getState();
    const active = await ensureAccounts(state);
    ensureRequests(state);
    const request = state.incomingRequests.find(r => r.id === requestId);
    if (!request) throw new Error('İstek bulunamadı; kodu yeniden yapıştır.');
    if (request.status === 'accepted') return { friends: state.friends, friend: friendRow(state, request.code), already: true };
    if (request.code === active.code) throw new Error('Kendi davet kodun.');
    const added = addFriend(state, { name: request.name, code: request.code, via: 'invite', inviteId: request.id });
    request.status = 'accepted';
    request.answeredAt = nowIso();
    await ctx.saveState(state);
    return { friends: state.friends, friend: added.friend, already: !added.created };
  });
  ipcMain.handle('friends:reject', async (_, requestId) => {
    const state = await ctx.getState();
    ensureRequests(state);
    const request = state.incomingRequests.find(r => r.id === requestId);
    if (!request) throw new Error('İstek bulunamadı.');
    request.status = 'rejected';
    request.answeredAt = nowIso();
    await ctx.saveState(state);
    return state.incomingRequests;
  });
  // Analiz, haberler, görseller, dış bağlantı
  ipcMain.handle('profiles:analyze', (_, profileId) => analyzeProfile(profileId));
  ipcMain.handle('profiles:installDeps', (_, profileId) => installMissingDeps(profileId));
  ipcMain.handle('news:get', (_, force, filters) => getNews(!!force, filters));
  ipcMain.handle('owner:status', async () => {
    const state = await ctx.getState();
    const s = state.settings || {};
    const secret = await readOwnerSecret();
    const feed = await loadOwnerNews(state);
    ownerUnlocked = isOwnerMachine();
    return {
      unlocked: ownerUnlocked,
      tokenSet: !!secret.githubToken, tokenHint: secret.githubToken ? `****${String(secret.githubToken).slice(-4)}` : '',
      gistId: s.newsGistId || '', feedUrl: feedUrlOf(state), defaultFeedUrl: DEFAULT_NEWS_FEED_URL,
      newsFile: NEWS_FILE_NAME, items: feed.items, source: feed.source, error: feed.error || '',
      panelVisible: ownerUnlocked
    };
  });
  ipcMain.handle('owner:unlock', async () => { ownerUnlocked = isOwnerMachine(); return { unlocked: ownerUnlocked }; });
  ipcMain.handle('owner:lock', async () => ({ unlocked: ownerUnlocked }));
  ipcMain.handle('owner:save', async (_, patch) => {
    if (!ownerUnlocked) throw new Error('Önce yönetici koduyla giriş yap.');
    const state = await ctx.getState();
    if (typeof patch.newsGistId === 'string') state.settings.newsGistId = patch.newsGistId.trim();
    if (typeof patch.newsFeedUrl === 'string') state.settings.newsFeedUrl = patch.newsFeedUrl.trim();
    await ctx.saveState(state);
    const token = typeof patch.githubToken === 'string' ? patch.githubToken.trim() : '';
    const secret = token ? await saveOwnerSecret({ githubToken: token }) : await readOwnerSecret();
    newsCache = { key: '', at: 0, data: null };
    return { ok: true, tokenSet: !!secret.githubToken, tokenHint: secret.githubToken ? `****${String(secret.githubToken).slice(-4)}` : '' };
  });
  ipcMain.handle('owner:createGist', async (_, items) => {
    if (!ownerUnlocked) throw new Error('Önce yönetici koduyla giriş yap.');
    const state = await ctx.getState();
    const token = String((await readOwnerSecret()).githubToken || '').trim();
    if (!token) throw new Error('Önce GitHub tokenını kaydet.');
    const prepared = (Array.isArray(items) && items.length ? items : [{ title: 'MineVerse haberleri hazır', summary: 'Bu dosyayı MineVerse yönetici panelinden yayımlıyorsun.', tag: 'Duyuru', emoji: '📰' }]).map(splitImageData);
    const gist = await githubRequest('/gists', 'POST', token, {
      description: 'MineVerse haber akışı', public: true,
      files: { [NEWS_FILE_NAME]: { content: JSON.stringify(prepared.map(p => p.item), null, 2) } }
    });
    state.settings.newsGistId = gist.id;
    state.settings.newsFeedUrl = gist.raw_url || `${gist.html_url}/raw/${NEWS_FILE_NAME}`;
    await ctx.saveState(state);
    try {
      await uploadNewsImages(token, gist.id, prepared);
      await githubRequest('/gists/' + encodeURIComponent(gist.id), 'PATCH', token, { files: { [NEWS_FILE_NAME]: { content: JSON.stringify(prepared.map(p => p.item), null, 2) } } });
    } catch {}
    newsCache = { key: '', at: 0, data: null };
    return { gistId: gist.id, feedUrl: state.settings.newsFeedUrl, htmlUrl: gist.html_url, items: prepared.map(p => p.item) };
  });
  ipcMain.handle('owner:publish', async (_, items) => {
    if (!ownerUnlocked) throw new Error('Önce yönetici koduyla giriş yap.');
    const state = await ctx.getState();
    const token = String((await readOwnerSecret()).githubToken || '').trim();
    const gistId = String(state.settings.newsGistId || '').trim();
    if (!token || !gistId) throw new Error('Token ve gist kimliği gerekli.');
    const prepared = (Array.isArray(items) ? items : []).map(splitImageData).sort((a, b) => String(b.item.date).localeCompare(String(a.item.date))).slice(0, 40);
    try { await uploadNewsImages(token, gistId, prepared); } catch {}
    await githubRequest('/gists/' + encodeURIComponent(gistId), 'PATCH', token, { files: { [NEWS_FILE_NAME]: { content: JSON.stringify(prepared.map(p => p.item), null, 2) } } });
    const list = prepared.map(p => p.item);
    await fs.writeFile(NEWS_LOCAL_COPY(), JSON.stringify(list, null, 2));
    newsCache = { key: '', at: 0, data: null };
    return { ok: true, items: list, feedUrl: feedUrlOf(state) };
  });
  ipcMain.handle('assets:overrides', () => listOverrides());
  ipcMain.handle('assets:pickBackground', async () => {
    const chosen = await ctx.dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Resim', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    if (chosen.canceled) return null;
    const source = chosen.filePaths[0];
    if (!fsSync.existsSync(source)) throw new Error('Seçilen dosya bulunamadı.');
    await fs.mkdir(ASSET_DIR(), { recursive: true });
    for (const entry of await fs.readdir(ASSET_DIR())) if (/^background\./i.test(entry)) await fs.rm(path.join(ASSET_DIR(), entry), { force: true });
    const ext = (path.extname(source) || '.png').toLowerCase();
    const target = path.join(ASSET_DIR(), 'background' + ext);
    await fs.copyFile(source, target);
    await listOverrides();
    return { file: 'background' + ext, path: target };
  });
  ipcMain.handle('assets:clearBackground', async () => {
    try {
      for (const entry of await fs.readdir(ASSET_DIR())) if (/^background\./i.test(entry)) await fs.rm(path.join(ASSET_DIR(), entry), { force: true });
    } catch {}
    await listOverrides();
    return true;
  });
  ipcMain.handle('assets:openFolder', async () => { await listOverrides(); return shell.openPath(ASSET_DIR()); });
  ipcMain.handle('assets:uiIcons', (_, force) => listUiIcons(!!force));
  // Hazır duvar kağıtları (uygulamayla gelen görseller) + arka plan olarak uygulama
  ipcMain.handle('assets:wallpapers', async () => {
    let entries = [];
    try { entries = (await fs.readdir(BUILTIN_WALLPAPERS_DIR())).filter(name => /\.(png|jpe?g|webp)$/i.test(name)); } catch {}
    return { wallpapers: entries.sort(), customDir: ASSET_DIR() };
  });
  ipcMain.handle('assets:applyWallpaper', async (_, name) => {
    const safe = path.basename(String(name || ''));
    const source = path.join(BUILTIN_WALLPAPERS_DIR(), safe);
    if (safe === '..' || !fsSync.existsSync(source)) throw new Error('Duvar kağıdı bulunamadı.');
    await fs.mkdir(ASSET_DIR(), { recursive: true });
    for (const entry of await fs.readdir(ASSET_DIR())) if (/^background\./i.test(entry)) await fs.rm(path.join(ASSET_DIR(), entry), { force: true });
    const target = path.join(ASSET_DIR(), 'background' + (path.extname(safe) || '.png'));
    await fs.copyFile(source, target);
    await listOverrides();
    return { file: path.basename(target) };
  });
  // Skinler: hazır (uygulamayla gelen) + kullanıcının yükledikleri; PNG 64x64/64x32 olmalı.
  // dataUrl alanı, renderer'ın file:// kaynaklı görseli canvas'a çizip okuyabilmesi içindir.
  ipcMain.handle('skins:list', async () => {
    const dataUrl = async file => 'data:image/png;base64,' + (await fs.readFile(file)).toString('base64');
    let builtin = [], custom = [];
    try { builtin = (await fs.readdir(BUILTIN_SKINS_DIR())).filter(name => /\.png$/i.test(name)).sort(); } catch {}
    await fs.mkdir(CUSTOM_SKINS_DIR(), { recursive: true });
    try {
      for (const entry of await fs.readdir(CUSTOM_SKINS_DIR())) if (/\.png$/i.test(entry)) custom.push({ name: entry, path: path.join(CUSTOM_SKINS_DIR(), entry) });
    } catch {}
    custom = custom.sort((a, b) => a.name.localeCompare(b.name));
    const out = { builtin: [], custom: [], customDir: CUSTOM_SKINS_DIR() };
    for (const name of builtin) { try { out.builtin.push({ name, dataUrl: await dataUrl(path.join(BUILTIN_SKINS_DIR(), name)) }); } catch {} }
    for (const item of custom) { try { out.custom.push({ name: item.name, path: item.path, dataUrl: await dataUrl(item.path) }); } catch {} }
    return out;
  });
  ipcMain.handle('skins:upload', async () => {
    const chosen = await ctx.dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Minecraft skin (PNG)', extensions: ['png'] }] });
    if (chosen.canceled) return null;
    const source = chosen.filePaths[0];
    const buffer = await fs.readFile(source);
    if (buffer.length > 2 * 1024 * 1024) throw new Error('Skin dosyası 2 MB sınırını aşıyor.');
    const size = parsePngSize(buffer);
    if (!size) throw new Error('Bu dosya geçerli bir PNG değil.');
    if (!(size.width === 64 && (size.height === 64 || size.height === 32)) && !(size.width === 128 && size.height === 128)) throw new Error(`Skin 64x64 (ya da 64x32) olmalı; bu dosya ${size.width}x${size.height}.`);
    await fs.mkdir(CUSTOM_SKINS_DIR(), { recursive: true });
    const target = path.join(CUSTOM_SKINS_DIR(), `${crypto.randomUUID()}.png`);
    await fs.writeFile(target, buffer);
    return { name: path.basename(target), path: target, size };
  });
  ipcMain.handle('skins:delete', async (_, name) => {
    const safe = path.basename(String(name || ''));
    if (!/^[\w.-]+\.png$/i.test(safe)) throw new Error('Geçersiz dosya adı.');
    const target = path.join(CUSTOM_SKINS_DIR(), safe);
    if (!isUnderAnyPath(target, CUSTOM_SKINS_DIR())) throw new Error('Geçersiz yol.');
    await fs.rm(target, { force: true });
    return true;
  });
  // Skin kafasını (canvas'tan gelen PNG data-url) profil fotoğrafı yapar.
  ipcMain.handle('skins:applyAvatar', async (_, accountId, dataUrl) => {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('Geçersiz görsel verisi.');
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > 512 * 1024) throw new Error('Profil fotoğrafı çok büyük.');
    const iconsDir = path.join(ctx.APP_DIR(), 'profile-icons');
    await fs.mkdir(iconsDir, { recursive: true });
    const destination = path.join(iconsDir, `${crypto.randomUUID()}.png`);
    await fs.writeFile(destination, buffer);
    return accountMutate(accountId, account => { account.icon = { type: 'custom', value: destination }; });
  });
  ipcMain.handle('system:openExternal', (_, url) => { if (!/^https:\/\//i.test(String(url))) throw new Error('Yalnızca https bağlantıları açılabilir.'); return shell.openExternal(url); });
}

/* Basit önbellek: dosya sistemi taraması her render'da tekrarlanmasın. */
const assetIconCache = { at: 0, list: [] };
async function listUiIconsCached(force = false) {
  if (!force && Date.now() - assetIconCache.at < 15000) return assetIconCache.list;
  assetIconCache = { at: Date.now(), list: await listUiIcons() };
  return assetIconCache.list;
}

module.exports = {
  register, startAuto, backupBefore, resolveJava, ensureAccounts, offlineUuid, requiredJava, mvCodeFromId,
  gameDir: () => path.join(ctx.APP_DIR(), 'minecraft'),
  _internal: { requiredJava, parseJavaMajor, encodeShare, decodeShare, inspectJar, createBackup, listBackups, restoreBackup, analyzeProfile, installMissingDeps, detectJava, findJavaExe, listOverrides, listUiIcons, offlineUuid, mvCodeFromId, newAccount, ensureAccounts, normalizeFriendCode, encodeInvite, decodeInvite, addFriend, ensureRequests, extractZipTo }
};
