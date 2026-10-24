const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const APP_DIR = () => path.join(app.getPath('userData'), 'mineverse');
const STATE_FILE = () => path.join(APP_DIR(), 'state.json');
const PROFILES_DIR = () => path.join(APP_DIR(), 'profiles');
const CACHE_FILE = () => path.join(APP_DIR(), 'cache.json');

const defaults = {
  settings: { theme: 'nebula', curseForgeApiKey: '', accent: '#f0b429', defaultGameVersion: '1.21.1', defaultLoader: 'Fabric', autoBackup: true, backupIntervalHours: 24, backupKeep: 5, launchMode: 'launcher', maxMemoryGb: 4, account: { displayName: 'Yerel Oyuncu', icon: { type: 'block', value: 'grass' } } },
  profiles: [
    { id: 'starter-survival', name: 'Survival+', gameVersion: '1.21.1', loader: 'Fabric', icon: { type: 'block', value: 'grass' }, mods: [] }
  ],
  accounts: [],
  launchers: []
};

/* CurseForge anahtarı kaynakta durmaz: sırayla kullanıcının girdiği değer,
   CURSEFORGE_API_KEY ortam değişkeni, derlemedeki build/secrets.json (gitignore'lı). */
const PLACEHOLDER_KEY = /^(REPLACE|BURAYA|XXXX|senin)/i;
let bundledCurseKey;
function readBundledCurseKey() {
  if (bundledCurseKey !== undefined) return bundledCurseKey;
  const envKey = String(process.env.CURSEFORGE_API_KEY || '').trim();
  if (envKey && !PLACEHOLDER_KEY.test(envKey)) { bundledCurseKey = { key: envKey, source: 'ortam değişkeni' }; return bundledCurseKey; }
  try {
    const data = JSON.parse(fsSync.readFileSync(path.join(__dirname, '..', 'build', 'secrets.json'), 'utf8'));
    const value = String(data.curseForgeApiKey || '').trim();
    bundledCurseKey = value && !PLACEHOLDER_KEY.test(value) ? { key: value, source: 'derleme dosyası' } : { key: '', source: 'yok' };
  } catch { bundledCurseKey = { key: '', source: 'yok' }; }
  return bundledCurseKey;
}
const curseKey = state => String(state?.settings?.curseForgeApiKey || '').trim() || readBundledCurseKey().key;

async function ensureStore() {
  await fs.mkdir(PROFILES_DIR(), { recursive: true });
  try { await fs.access(STATE_FILE()); } catch { await saveState(defaults); }
}
async function getState() {
  await ensureStore();
  /* Bozuk/eksik state.json (elektrik kesintisi, yarıda yazım) uygulamayı düşürmesin: varsayılana dön. */
  let raw;
  try { raw = JSON.parse(await fs.readFile(STATE_FILE(), 'utf8')); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') raw = structuredClone(defaults);
  const merged = {
    ...raw,
    settings: { ...defaults.settings, ...raw.settings, curseForgeApiKey: String(raw.settings?.curseForgeApiKey || '').trim(), curseForgeKeySource: String(raw.settings?.curseForgeApiKey || '').trim() ? 'senin girdiğin' : readBundledCurseKey().source, account: { ...defaults.settings.account, ...(raw.settings?.account || {}) } },
    profiles: (raw.profiles || []).map(profile => ({ icon: { type: 'block', value: 'grass' }, ...profile })),
    accounts: raw.accounts || [],
    launchers: (raw.launchers || []).map(entry => ({ ...entry, name: entry.name || launcherName(entry.location), modsPath: launcherModsDir(entry) })),
  };
  delete merged.settings.githubToken; // yönetici tokenı arayüze hiç inmez; owner-secret.json'da durur
  await features.ensureAccounts(merged);
  return merged;
}
async function saveState(state) {
  await fs.mkdir(APP_DIR(), { recursive: true });
  /* Atomik yazım: yarıda kesilen state.json bir daha uygulamayı bozamasın. */
  const tmp = STATE_FILE() + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, STATE_FILE());
}
const clean = (value) => String(value || '').replace(/[\\/:*?"<>|]/g, '-').trim();
const profileDir = (id) => path.join(PROFILES_DIR(), id, 'mods');
async function ensureProfileDir(id) { await fs.mkdir(profileDir(id), { recursive: true }); }

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'MineVerse/0.3 (local desktop app)', ...options.headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`Servis isteği başarısız: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Sunucu zamanında yanıt vermedi. İnternet bağlantını kontrol et.');
    if (error.message === 'fetch failed' || error.code === 'ENOTFOUND') throw new Error('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.');
    throw error;
  } finally { clearTimeout(timer); }
}

const isSafeRemoteUrl = url => { try { return new URL(String(url)).protocol === 'https:'; } catch { return false; } };
async function downloadBinary(url, options = {}) {
  if (!isSafeRemoteUrl(url)) throw new Error('Yalnızca https bağlantılarından indirme yapılır.');
  const maxBytes = options.maxBytes || 512 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'MineVerse/0.3 (local desktop app)', ...options.headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`Dosya indirilemedi (HTTP ${response.status}).`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('Dosya beklenenden büyük; indirme reddedildi.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('Dosya beklenenden büyük; indirme reddedildi.');
    return buffer;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('İndirme zaman aşımına uğradı. Bağlantın yavaş olabilir, tekrar dene.');
    if (error.message === 'fetch failed' || error.code === 'ENOTFOUND') throw new Error('Dosyaya ulaşılamadı. İnternet bağlantını kontrol et.');
    throw error;
  } finally { clearTimeout(timer); }
}

// ---------- Minecraft version manifest (always live from Mojang, short cache to stay fast) ----------
let mcVersionsMemCache = { fetchedAt: 0, all: [], releases: [], snapshots: [] };
async function getMinecraftVersions(force = false) {
  const now = Date.now();
  if (!force && mcVersionsMemCache.all.length && (now - mcVersionsMemCache.fetchedAt) < 1000 * 60 * 30) return mcVersionsMemCache;
  try {
    const data = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const releases = data.versions.filter(v => v.type === 'release').map(v => v.id);
    const snapshots = data.versions.filter(v => v.type === 'snapshot').map(v => v.id);
    mcVersionsMemCache = { fetchedAt: now, all: [...releases, ...snapshots], releases, snapshots, latest: data.latest };
    try { await fs.mkdir(APP_DIR(), { recursive: true }); await fs.writeFile(CACHE_FILE(), JSON.stringify(mcVersionsMemCache)); } catch {}
    return mcVersionsMemCache;
  } catch (error) {
    // Fall back to last known-good cache on disk if Mojang is unreachable, so the list is never empty.
    try { mcVersionsMemCache = JSON.parse(await fs.readFile(CACHE_FILE(), 'utf8')); return mcVersionsMemCache; } catch { throw error; }
  }
}

// ---------- Modrinth ----------
const LOADER_TAGS = ['fabric', 'forge', 'neoforge', 'quilt'];
const MODRINTH_TYPES = ['mod', 'modpack', 'resourcepack', 'shader'];

async function searchModrinth(query, filters = {}, sort = 'relevance', offset = 0) {
  const projectType = MODRINTH_TYPES.includes(filters.projectType) ? filters.projectType : 'mod';
  const facets = [[`project_type:${projectType}`]];
  if (filters.gameVersion) facets.push([`versions:${filters.gameVersion}`]);
  if (filters.loader) facets.push([`categories:${String(filters.loader).toLowerCase()}`]);
  if (filters.category) facets.push([`categories:${String(filters.category).toLowerCase()}`]);
  const url = new URL('https://api.modrinth.com/v2/search');
  url.searchParams.set('query', query || '');
  url.searchParams.set('limit', '24');
  url.searchParams.set('offset', String(offset || 0));
  url.searchParams.set('index', sort);
  url.searchParams.set('facets', JSON.stringify(facets));
  const data = await fetchJson(url);
  return data.hits.map(hit => ({
    source: 'Modrinth', id: hit.project_id, title: hit.title, summary: hit.description,
    icon: hit.icon_url, downloads: hit.downloads, categories: hit.categories || [],
    versions: hit.versions || [], author: hit.author, color: hit.color || 0x7755ff
  }));
}

async function modrinthProjectDetails(projectId) {
  const [project, versions] = await Promise.all([
    fetchJson(`https://api.modrinth.com/v2/project/${projectId}`),
    fetchJson(`https://api.modrinth.com/v2/project/${projectId}/version`)
  ]);
  return {
    source: 'Modrinth', id: project.id, slug: project.slug, title: project.title,
    summary: project.description, body: project.body || '', icon: project.icon_url,
    downloads: project.downloads, followers: project.followers,
    categories: project.categories || [], gallery: (project.gallery || []).map(g => g.url),
    updated: project.updated,
    versions: versions.map(v => ({
      id: v.id, name: v.name, versionNumber: v.version_number,
      gameVersions: v.game_versions, loaders: v.loaders, datePublished: v.date_published,
      files: (v.files || []).map(f => ({ url: f.url, filename: f.filename, primary: f.primary, size: f.size, sha1: f.hashes?.sha1 }))
    }))
  };
}

async function installModrinthVersion(profileId, projectId, versionId) {
  const state = await getState();
  const profile = state.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('Mod profili bulunamadı.');
  const version = versionId
    ? await fetchJson(`https://api.modrinth.com/v2/version/${versionId}`)
    : (await fetchJson(`https://api.modrinth.com/v2/project/${projectId}/version`))[0];
  if (!version) throw new Error('Bu mod için sürüm bulunamadı.');
  const file = version.files?.find(item => item.primary) || version.files?.[0];
  if (!file) throw new Error('Bu mod için indirilebilir bir dosya bulunamadı.');
  await ensureProfileDir(profile.id);
  const fileName = clean(file.filename);
  const destination = path.join(profileDir(profile.id), fileName);
  const buffer = await downloadBinary(file.url);
  if (file.hashes?.sha1 && crypto.createHash('sha1').update(buffer).digest('hex') !== file.hashes.sha1) throw new Error('İndirilen dosyanın doğrulaması başarısız oldu.');
  await fs.writeFile(destination, buffer);
  await addMod(state, profileId, {
    id: crypto.randomUUID(), source: 'Modrinth', projectId, versionId: version.id,
    name: version.name, version: version.version_number, fileName, localPath: destination,
    gameVersions: version.game_versions, loaders: version.loaders, downloadedAt: new Date().toISOString()
  });
  return getState();
}

// ---------- CurseForge ----------
/* İçerik türü -> CurseForge sınıf kimliği (Minecraft oyun kimliği 432). */
const CURSE_CLASS_IDS = { mod: 6, modpack: 4471, resourcepack: 12, world: 17, shader: 6552 };

async function searchCurseForge(query, filters, apiKey, sort, offset = 0) {
  if (!apiKey) return { needsKey: true, results: [] };
  const url = new URL('https://api.curseforge.com/v1/mods/search');
  url.searchParams.set('gameId', '432');
  url.searchParams.set('searchFilter', query || '');
  url.searchParams.set('pageSize', '24');
  url.searchParams.set('index', String(offset || 0));
  if (sort === 'downloads') url.searchParams.set('sortField', '2');
  const classId = CURSE_CLASS_IDS[filters.projectType];
  if (classId) url.searchParams.set('classId', String(classId));
  if (filters.gameVersion) url.searchParams.set('gameVersion', filters.gameVersion);
  const data = await fetchJson(url, { headers: { 'x-api-key': apiKey } });
  return { needsKey: false, results: data.data.map(mod => ({
    source: 'CurseForge', id: String(mod.id), title: mod.name, summary: mod.summary,
    icon: mod.logo?.thumbnailUrl, downloads: mod.downloadCount, categories: mod.categories?.map(c => c.name) || [],
    author: mod.authors?.[0]?.name || 'Unknown', versions: mod.latestFilesIndexes?.map(f => f.gameVersion) || []
  })) };
}

async function curseForgeProjectDetails(projectId, apiKey) {
  if (!apiKey) throw new Error('CurseForge için Ayarlar’dan bir API anahtarı ekle.');
  const [modData, filesData] = await Promise.all([
    fetchJson(`https://api.curseforge.com/v1/mods/${projectId}`, { headers: { 'x-api-key': apiKey } }),
    fetchJson(`https://api.curseforge.com/v1/mods/${projectId}/files?pageSize=50`, { headers: { 'x-api-key': apiKey } })
  ]);
  const mod = modData.data;
  return {
    source: 'CurseForge', id: String(mod.id), title: mod.name, summary: mod.summary,
    body: mod.summary || '', icon: mod.logo?.thumbnailUrl, downloads: mod.downloadCount,
    categories: mod.categories?.map(c => c.name) || [], gallery: (mod.screenshots || []).map(s => s.url),
    versions: filesData.data.map(file => ({
      id: String(file.id), name: file.displayName, versionNumber: file.displayName,
      gameVersions: (file.gameVersions || []).filter(v => /^\d/.test(v)),
      loaders: (file.gameVersions || []).map(v => v.toLowerCase()).filter(v => LOADER_TAGS.includes(v)),
      datePublished: file.fileDate,
      files: [{ url: file.downloadUrl, filename: file.fileName, primary: true, size: file.fileLength }]
    }))
  };
}

async function installCurseForgeFile(profileId, projectId, fileId, apiKey) {
  if (!apiKey) throw new Error('CurseForge için Ayarlar’dan bir API anahtarı ekle.');
  const state = await getState();
  const profile = state.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('Mod profili bulunamadı.');
  const fileInfo = await fetchJson(`https://api.curseforge.com/v1/mods/${projectId}/files/${fileId}`, { headers: { 'x-api-key': apiKey } });
  const file = fileInfo.data;
  if (!file?.downloadUrl) throw new Error('Bu dosya için indirme bağlantısı yok (CurseForge bazı modlarda 3. parti indirmeyi engelliyor).');
  await ensureProfileDir(profile.id);
  const fileName = clean(file.fileName);
  const destination = path.join(profileDir(profile.id), fileName);
  const buffer = await downloadBinary(file.downloadUrl);
  await fs.writeFile(destination, buffer);
  await addMod(state, profileId, {
    id: crypto.randomUUID(), source: 'CurseForge', projectId, versionId: String(file.id),
    name: file.displayName, version: file.displayName, fileName, localPath: destination,
    gameVersions: (file.gameVersions || []).filter(v => /^\d/.test(v)), downloadedAt: new Date().toISOString()
  });
  return getState();
}

async function addMod(state, profileId, mod) {
  const profile = state.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('Mod profili bulunamadı.');
  const existingIndex = profile.mods.findIndex(item => item.source === mod.source && item.projectId === mod.projectId);
  if (existingIndex >= 0) {
    const old = profile.mods[existingIndex];
    if (old.localPath && old.localPath !== mod.localPath) await fs.rm(old.localPath, { force: true });
    profile.mods[existingIndex] = mod;
  } else {
    profile.mods.push(mod);
  }
  await saveState(state); return profile;
}

// ---------- Enable / disable / bulk remove ----------
async function toggleMod(profileId, modId) {
  const state = await getState();
  const profile = state.profiles.find(item => item.id === profileId);
  const mod = profile?.mods.find(item => item.id === modId);
  if (!profile || !mod || !mod.localPath) throw new Error('Mod bulunamadı.');
  const nowDisabled = !mod.fileName.endsWith('.disabled');
  const nextPath = nowDisabled ? mod.localPath + '.disabled' : mod.localPath.replace(/\.disabled$/, '');
  await fs.rename(mod.localPath, nextPath);
  mod.localPath = nextPath;
  mod.fileName = path.basename(nextPath);
  mod.enabled = !nowDisabled;
  await saveState(state);
  return state;
}

async function bulkDeleteMods(profileId, modIds) {
  const state = await getState();
  const profile = state.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('Mod profili bulunamadı.');
  for (const modId of modIds) {
    const mod = profile.mods.find(item => item.id === modId);
    if (mod?.localPath) await fs.rm(mod.localPath, { force: true });
  }
  profile.mods = profile.mods.filter(item => !modIds.includes(item.id));
  await saveState(state);
  return state;
}

// ---------- Pack builder (.mrpack, Modrinth's standard modpack format) ----------
const AdmZip = require('adm-zip');
const LOADER_DEP_KEY = { fabric: 'fabric-loader', forge: 'forge', quilt: 'quilt-loader', neoforge: 'neoforge' };
const LOADER_DEP_KEY_REV = { 'fabric-loader': 'Fabric', forge: 'Forge', 'quilt-loader': 'Quilt', neoforge: 'NeoForge' };

async function exportPack(profileId, meta = {}) {
  const state = await getState();
  const profile = state.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('Mod profili bulunamadı.');
  if (!profile.mods.length) throw new Error('Bu profilde paketlenecek mod yok.');
  const chosen = await dialog.showSaveDialog({
    title: 'Paketi kaydet', defaultPath: `${clean(meta.name || profile.name)}.mrpack`,
    filters: [{ name: 'Modrinth paketi', extensions: ['mrpack'] }]
  });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  const zip = new AdmZip();
  const files = [];
  for (const mod of profile.mods) {
    let addedAsDownload = false;
    if (mod.source === 'Modrinth' && mod.versionId) {
      try {
        const version = await fetchJson(`https://api.modrinth.com/v2/version/${mod.versionId}`);
        const file = version.files?.find(item => item.primary) || version.files?.[0];
        if (file?.url && file?.hashes?.sha1) {
          files.push({
            path: `mods/${file.filename}`, hashes: { sha1: file.hashes.sha1, sha512: file.hashes.sha512 || file.hashes.sha1 },
            downloads: [file.url], fileSize: file.size || 0, env: { client: 'required', server: 'required' }
          });
          addedAsDownload = true;
        }
      } catch {}
    }
    if (!addedAsDownload && mod.localPath) {
      try { const buffer = await fs.readFile(mod.localPath); zip.addFile(`overrides/mods/${mod.fileName.replace(/\.disabled$/, '')}`, buffer); } catch {}
    }
  }
  const index = {
    formatVersion: 1, game: 'minecraft', versionId: '1.0.0',
    name: meta.name || profile.name, summary: meta.summary || `MineVerse ile oluşturuldu · ${profile.gameVersion} ${profile.loader}`,
    files, dependencies: { minecraft: profile.gameVersion, [LOADER_DEP_KEY[profile.loader.toLowerCase()] || 'fabric-loader']: '*' }
  };
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)));
  zip.writeZip(chosen.filePath);
  return { canceled: false, path: chosen.filePath, modCount: profile.mods.length };
}

async function importPack() {
  const chosen = await dialog.showOpenDialog({ title: 'Paket seç', properties: ['openFile'], filters: [{ name: 'Modrinth paketi', extensions: ['mrpack', 'zip'] }] });
  if (chosen.canceled || !chosen.filePaths[0]) return getState();
  return importPackFromFile(chosen.filePaths[0]);
}

/* İndirilen .mrpack dosyalarını (Keşfet -> mod paketi) de aynı akışla içe aktarır. */
async function importPackFromFile(filePath) {
  const zip = new AdmZip(filePath);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('Geçerli bir .mrpack dosyası değil (modrinth.index.json bulunamadı).');
  const index = JSON.parse(zip.readAsText(indexEntry));
  const loaderKey = Object.keys(index.dependencies || {}).find(key => LOADER_DEP_KEY_REV[key]);
  if ((index.files || []).length > 400) throw new Error('Paket beklenenden fazla dosya içeriyor; içe alma reddedildi.');
  const state = await getState();
  const profile = {
    id: crypto.randomUUID(), name: clean(index.name) || 'İçe aktarılan paket',
    gameVersion: index.dependencies?.minecraft || 'bilinmiyor', loader: LOADER_DEP_KEY_REV[loaderKey] || 'Fabric', mods: []
  };
  state.profiles.push(profile);
  await ensureProfileDir(profile.id);
  const packFiles = index.files || [];
  for (const file of packFiles) {
    const url = file.downloads?.[0];
    if (!url) continue;
    try {
      const buffer = await downloadBinary(url, { maxBytes: 100 * 1024 * 1024, timeoutMs: 180000 });
      if (file.hashes?.sha1 && crypto.createHash('sha1').update(buffer).digest('hex') !== file.hashes.sha1) continue;
      const fileName = clean(path.basename(file.path));
      const destination = path.join(profileDir(profile.id), fileName);
      await fs.writeFile(destination, buffer);
      profile.mods.push({ id: crypto.randomUUID(), source: 'Paket', name: path.parse(fileName).name, version: index.versionId || '—', fileName, localPath: destination, downloadedAt: new Date().toISOString() });
    } catch {}
  }
  let overrideCount = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('overrides/mods/')) continue;
    if (overrideCount >= 400) break;
    if ((entry.header?.size || 0) > 100 * 1024 * 1024) continue;
    overrideCount++;
    const fileName = clean(path.basename(entry.entryName));
    const destination = path.join(profileDir(profile.id), fileName);
    await fs.writeFile(destination, entry.getData());
    if (!profile.mods.some(item => item.fileName === fileName)) profile.mods.push({ id: crypto.randomUUID(), source: 'Paket', name: path.parse(fileName).name, version: 'Paket dosyası', fileName, localPath: destination, downloadedAt: new Date().toISOString() });
  }
  await saveState(state);
  return state;
}

// ---------- Update checking ----------
async function checkModUpdates(profileId) {
  const state = await getState();
  const profile = state.profiles.find(item => item.id === profileId);
  if (!profile) throw new Error('Mod profili bulunamadı.');
  const updates = [];
  for (const mod of profile.mods) {
    if (mod.source !== 'Modrinth' || !mod.projectId) continue;
    try {
      const versions = await fetchJson(`https://api.modrinth.com/v2/project/${mod.projectId}/version`);
      const compatible = versions.find(v => v.game_versions.includes(profile.gameVersion) && v.loaders.includes(profile.loader.toLowerCase()));
      if (compatible && compatible.id !== mod.versionId) {
        updates.push({ modId: mod.id, projectId: mod.projectId, name: mod.name, currentVersion: mod.version, newVersion: compatible.version_number, newVersionId: compatible.id });
      }
    } catch {}
  }
  return updates;
}

// ---------- Launchers ----------
async function findLaunchers() {
  const home = app.getPath('home');
  const vanillaDir = process.platform === 'darwin'
    ? path.join(app.getPath('appData'), 'minecraft')
    : process.platform === 'linux'
      ? path.join(home, '.minecraft')
      : path.join(app.getPath('appData'), '.minecraft');
  const candidates = [
    ['Minecraft / TLauncher', vanillaDir],
    ['Prism Launcher', path.join(app.getPath('appData'), 'PrismLauncher', 'instances')],
    ['MultiMC', path.join(app.getPath('appData'), 'MultiMC', 'instances')],
    ['GDLauncher', path.join(app.getPath('appData'), 'gdlauncher_next', 'instances')],
    ['ATLauncher', path.join(app.getPath('appData'), 'ATLauncher', 'instances')],
    ['Modrinth App', path.join(app.getPath('appData'), 'ModrinthApp', 'profiles')],
    ['CurseForge', path.join(home, 'curseforge', 'minecraft', 'Instances')]
  ];
  const found = [];
  for (const [name, location] of candidates) { try { await fs.access(location); found.push({ id: crypto.randomUUID(), name, location, modsSubpath: 'mods', detected: true }); } catch {} }
  return found;
}

/* Kullanıcı .minecraft yerine alt klasör seçmiş olabilir (versions/mods): köke çık. */
function launcherRoot(location) {
  const base = path.basename(String(location || '')).toLowerCase();
  return base === 'versions' || base === 'mods' || base === 'profiles' || base === 'instances' ? path.dirname(String(location)) : String(location || '');
}
function launcherModsDir(entry) {
  const sub = entry.modsSubpath && entry.modsSubpath !== 'mods' ? entry.modsSubpath : 'mods';
  return path.join(launcherRoot(entry.location), sub);
}
function launcherName(location) {
  const base = path.basename(launcherRoot(location));
  if (base === '.minecraft') return 'Minecraft / TLauncher';
  if (/prism/i.test(base)) return 'Prism Launcher';
  if (/multimc/i.test(base)) return 'MultiMC';
  if (/atlauncher/i.test(base)) return 'ATLauncher';
  if (/gdlauncher/i.test(base)) return 'GDLauncher';
  if (/modrinth/i.test(base)) return 'Modrinth App';
  if (/curseforge/i.test(base)) return 'CurseForge';
  return base || 'Özel oyun klasörü';
}

let mainWindow = null;
function windowIconOption() {
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
    /* asar içinde nativeImage.createFromPath okuyamaz; fs üzerinden bayt olarak yükle. */
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) image = nativeImage.createFromBuffer(fsSync.readFileSync(iconPath));
    return image.isEmpty() ? {} : { icon: image };
  } catch { return {}; }
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 1100, minHeight: 700, backgroundColor: '#081514', titleBarStyle: 'hidden', show: false, ...windowIconOption(), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  const page = path.join(__dirname, 'renderer', 'index.html');
  const allowedUrl = pathToFileURL(page).href;
  mainWindow.webContents.on('will-navigate', (event, target) => { if (target !== allowedUrl) event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.loadFile(page);
}

const features = require('./features.cjs');
const launcher = require('./launch.cjs');
const sharedContext = { app, ipcMain, dialog, shell, getState, saveState, APP_DIR, STATE_FILE, PROFILES_DIR, fetchJson, downloadBinary, installModrinthVersion, installCurseForgeFile, searchModrinth, clean, curseForgeKey: curseKey, requiredJava: features._internal.requiredJava, offlineUuid: features._internal.offlineUuid, resolveJava: features.resolveJava };
features.register(sharedContext);
launcher.register(sharedContext);
app.whenReady().then(() => { ensureStore(); createWindow(); features.startAuto(); getMinecraftVersions().catch(() => {}); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function dedupeMods(list) {
  const seenTitles = new Set();
  const seenIds = new Set();
  const out = [];
  for (const mod of list) {
    const idKey = `${mod.source}:${mod.id}`;
    const titleKey = String(mod.title || '').trim().toLowerCase();
    if (seenIds.has(idKey) || (titleKey && seenTitles.has(titleKey))) continue;
    seenIds.add(idKey);
    if (titleKey) seenTitles.add(titleKey);
    out.push(mod);
  }
  return out;
}
ipcMain.handle('app:state', () => getState());
ipcMain.handle('settings:save', async (_, patch) => { const state = await getState(); state.settings = { ...state.settings, ...patch }; await saveState(state); return state; });
ipcMain.handle('mc:versions', (_, force) => getMinecraftVersions(!!force));
ipcMain.handle('mods:search', async (_, query, source, filters, offset) => {
  const state = await getState(); const selected = source || 'All'; const results = []; let curseForgeNeedsKey = false;
  if (selected === 'All' || selected === 'Modrinth') results.push(...await searchModrinth(query, filters, 'relevance', offset));
  if (selected === 'All' || selected === 'CurseForge') { const curse = await searchCurseForge(query, filters, curseKey(state), 'relevance', offset); curseForgeNeedsKey = curse.needsKey; results.push(...curse.results); }
  return { results: dedupeMods(results), curseForgeNeedsKey };
});
ipcMain.handle('mods:featured', async (_, source, filters, offset) => {
  const state = await getState(); const selected = source || 'All'; const results = []; let curseForgeNeedsKey = false;
  if (selected === 'All' || selected === 'Modrinth') results.push(...await searchModrinth('', filters, 'downloads', offset));
  if (selected === 'All' || selected === 'CurseForge') { const curse = await searchCurseForge('', filters, curseKey(state), 'downloads', offset); curseForgeNeedsKey = curse.needsKey; results.push(...curse.results); }
  return { results: dedupeMods(results), curseForgeNeedsKey };
});
ipcMain.handle('mods:details', async (_, source, projectId) => {
  const state = await getState();
  return source === 'CurseForge' ? curseForgeProjectDetails(projectId, curseKey(state)) : modrinthProjectDetails(projectId);
});
ipcMain.handle('profiles:create', async (_, draft) => { const state = await getState(); const profile = { id: crypto.randomUUID(), name: clean(draft.name) || 'Yeni profil', gameVersion: draft.gameVersion || '1.21.1', loader: draft.loader || 'Fabric', icon: draft.icon || { type: 'block', value: 'grass' }, mods: [] }; state.profiles.push(profile); await saveState(state); return state; });
ipcMain.handle('profiles:delete', async (_, profileId) => { await features.backupBefore('pre-delete'); const state = await getState(); await fs.rm(path.join(PROFILES_DIR(), profileId), { recursive: true, force: true }); state.profiles = state.profiles.filter(item => item.id !== profileId); await saveState(state); return state; });
ipcMain.handle('profiles:setIcon', async (_, profileId, icon) => { const state = await getState(); const profile = state.profiles.find(item => item.id === profileId); if (!profile) throw new Error('Profil bulunamadı.'); profile.icon = icon; await saveState(state); return state; });
ipcMain.handle('profiles:uploadIcon', async () => {
  const chosen = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Görsel', extensions: ['png','jpg','jpeg','gif','webp'] }] });
  if (chosen.canceled) return null;
  const source = chosen.filePaths[0];
  const iconsDir = path.join(APP_DIR(), 'profile-icons');
  await fs.mkdir(iconsDir, { recursive: true });
  const destination = path.join(iconsDir, `${crypto.randomUUID()}${path.extname(source)}`);
  await fs.copyFile(source, destination);
  return destination;
});
ipcMain.handle('profiles:deleteMod', async (_, profileId, modId) => { const state = await getState(); const profile = state.profiles.find(item => item.id === profileId); const mod = profile?.mods.find(item => item.id === modId); if (mod?.localPath) await fs.rm(mod.localPath, { force: true }); if (profile) profile.mods = profile.mods.filter(item => item.id !== modId); await saveState(state); return state; });
ipcMain.handle('mods:installModrinth', (_, profileId, projectId, versionId) => installModrinthVersion(profileId, projectId, versionId));
ipcMain.handle('mods:installCurseForge', async (_, profileId, projectId, fileId) => { const state = await getState(); return installCurseForgeFile(profileId, projectId, fileId, curseKey(state)); });
ipcMain.handle('mods:checkUpdates', (_, profileId) => checkModUpdates(profileId));
ipcMain.handle('mods:importLocal', async (_, profileId) => { const chosen = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Minecraft mod', extensions: ['jar'] }] }); if (chosen.canceled) return getState(); const state = await getState(); const profile = state.profiles.find(item => item.id === profileId); if (!profile) throw new Error('Mod profili bulunamadı.'); await ensureProfileDir(profile.id); for (const sourceFile of chosen.filePaths) { const fileName = clean(path.basename(sourceFile)); const destination = path.join(profileDir(profile.id), fileName); await fs.copyFile(sourceFile, destination); if (!profile.mods.some(item => item.fileName === fileName)) profile.mods.push({ id: crypto.randomUUID(), source: 'Local', name: path.parse(fileName).name, version: 'Yerel dosya', fileName, localPath: destination, downloadedAt: new Date().toISOString() }); } await saveState(state); return state; });
ipcMain.handle('launchers:detect', async () => {
  const state = await getState();
  const found = await findLaunchers();
  for (const item of found) {
    const root = launcherRoot(item.location).toLowerCase();
    if (!state.launchers.some(existing => launcherRoot(existing.location).toLowerCase() === root)) state.launchers.push(item);
  }
  state.launchers = state.launchers.map(entry => ({ ...entry, name: entry.name || launcherName(entry.location), modsPath: launcherModsDir(entry) }));
  await saveState(state);
  return state;
});
ipcMain.handle('launchers:add', async () => {
  const chosen = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (chosen.canceled) return getState();
  const state = await getState();
  const location = launcherRoot(chosen.filePaths[0]);
  if (!state.launchers.some(item => launcherRoot(item.location).toLowerCase() === location.toLowerCase())) {
    state.launchers.push({ id: crypto.randomUUID(), name: launcherName(location), location, modsSubpath: 'mods', detected: false });
  }
  state.launchers = state.launchers.map(entry => ({ ...entry, modsPath: launcherModsDir(entry) }));
  await saveState(state);
  return state;
});
ipcMain.handle('launchers:setModsPath', async (_, launcherId, modsSubpath) => { const state = await getState(); const entry = state.launchers.find(item => item.id === launcherId); if (!entry) throw new Error('Launcher bulunamadı.'); entry.modsSubpath = clean(modsSubpath) || 'mods'; entry.modsPath = launcherModsDir(entry); await saveState(state); return state; });
ipcMain.handle('launchers:remove', async (_, launcherId) => { const state = await getState(); state.launchers = state.launchers.filter(item => item.id !== launcherId); await saveState(state); return state; });
ipcMain.handle('launchers:export', async (_, profileId, launcherId) => {
  const state = await getState();
  const profile = state.profiles.find(item => item.id === profileId);
  const target = state.launchers.find(item => item.id === launcherId);
  if (!profile || !target) throw new Error('Profil veya launcher bulunamadı.');
  const root = launcherRoot(target.location);
  const destination = launcherModsDir(target);
  await fs.mkdir(destination, { recursive: true });
  let copied = 0, skipped = 0;
  const failed = [];
  for (const mod of profile.mods) {
    if (mod.enabled === false || !mod.localPath) { skipped++; continue; }
    try { await fs.copyFile(mod.localPath, path.join(destination, mod.fileName)); copied++; }
    catch (error) { failed.push({ name: mod.name || mod.fileName, reason: error.message }); }
  }
  // Sürüm dosyasını da yaz: launcher profilleri listesinde görünsün (varsa dokunmayız).
  let versionJson = null, jsonNote = '';
  try {
    const resolved = await launcher._internal.resolveClient(profile.gameVersion, profile.loader);
    const dir = path.join(root, 'versions', resolved.id);
    const file = path.join(dir, `${resolved.id}.json`);
    let exists = false;
    try { await fs.access(file); exists = true; } catch {}
    if (exists) jsonNote = `${resolved.id} sürüm dosyası zaten vardı, ona dokunmadım.`;
    else {
      await fs.mkdir(dir, { recursive: true });
      const json = { ...resolved.json, _mineverse: { profile: profile.name, exportedAt: new Date().toISOString() } };
      await fs.writeFile(file, JSON.stringify(json, null, 2));
      versionJson = file;
    }
  } catch (error) { jsonNote = `Sürüm dosyası üretilemedi (${error.message}); modlar yine de aktarıldı.`; }
  const hints = [];
  if (copied === 0) hints.push('Hiç mod kopyalanmadı. Profilinde kapalı olmayan ve dosyası bulunan mod olmalı.');
  if (path.basename(String(target.location)).toLowerCase() === 'versions') hints.push('Launcher kaydı ...\\versions klasörünü gösteriyordu; modlar oyun kökündeki mods klasörüne yazıldı.');
  return { copied, skipped, failed, destination, versionJson, note: jsonNote, wrongDirHint: hints.join(' ') };
});

async function findLauncherExecutable(launcher) {
  const roots = [launcher.location, path.dirname(launcher.location), path.dirname(path.dirname(launcher.location))];
  const knownNames = ['MinecraftLauncher.exe', 'minecraft-launcher.exe', 'TLauncher.jar', 'PrismLauncher.exe', 'prismlauncher.exe', 'MultiMC.exe', 'ATLauncher.exe', 'ATLauncher.jar', 'GDLauncher.exe'];
  for (const root of roots) {
    for (const name of knownNames) {
      const candidate = path.join(root, name);
      try { await fs.access(candidate); return candidate; } catch {}
    }
  }
  return null;
}
ipcMain.handle('launchers:play', async (_, profileId, launcherId) => {
  const state = await getState();
  const profile = state.profiles.find(item => item.id === profileId);
  const launcher = state.launchers.find(item => item.id === launcherId);
  if (!profile || !launcher) throw new Error('Profil veya launcher bulunamadı.');
  const destination = launcherModsDir(launcher);
  await fs.mkdir(destination, { recursive: true });
  let copied = 0;
  const failed = [];
  for (const mod of profile.mods) {
    if (!mod.localPath || mod.enabled === false) continue;
    try { await fs.copyFile(mod.localPath, path.join(destination, mod.fileName)); copied++; }
    catch (error) { failed.push({ name: mod.name || mod.fileName, reason: error.message }); }
  }
  const executable = await findLauncherExecutable(launcher);
  if (!executable) return { copied, failed, destination, launched: false };
  try {
    if (executable.toLowerCase().endsWith('.jar')) { let javaExe = 'java'; try { javaExe = (await features.resolveJava(profile.gameVersion)).exe; } catch {} spawn(javaExe, ['-jar', executable], { detached: true, stdio: 'ignore', cwd: path.dirname(executable) }).unref(); }
    else spawn(executable, [], { detached: true, stdio: 'ignore', cwd: path.dirname(executable) }).unref();
    return { copied, failed, destination, launched: true };
  } catch { return { copied, failed, destination, launched: false }; }
});
ipcMain.handle('mods:toggle', (_, profileId, modId) => toggleMod(profileId, modId));
ipcMain.handle('mods:bulkDelete', (_, profileId, modIds) => bulkDeleteMods(profileId, modIds));
ipcMain.handle('packs:export', (_, profileId, meta) => exportPack(profileId, meta));
ipcMain.handle('packs:import', () => importPack());
ipcMain.handle('packs:importFile', async (_, filePath) => { if (!/\.(mrpack|zip)$/i.test(String(filePath || '')) || String(filePath).includes('\0')) throw new Error('Geçersiz paket dosyası.'); return importPackFromFile(filePath); });
ipcMain.handle('packs:importUrl', async (_, url, fileName) => {
  if (!isSafeRemoteUrl(url)) throw new Error('Yalnızca https bağlantılarından indirme yapılır.');
  const temp = path.join(app.getPath('temp'), `mineverse-pack-${crypto.randomUUID()}.mrpack`);
  const buffer = await downloadBinary(url, { maxBytes: 300 * 1024 * 1024, timeoutMs: 300000 });
  await fs.writeFile(temp, buffer);
  try { return await importPackFromFile(temp); }
  finally { await fs.rm(temp, { force: true }); }
});
ipcMain.handle('profiles:duplicate', async (_, profileId) => {
  const state = await getState();
  const source = state.profiles.find(item => item.id === profileId);
  if (!source) throw new Error('Mod profili bulunamadı.');
  const copy = { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} (kopya)`.slice(0, 40), mods: [] };
  state.profiles.push(copy);
  await ensureProfileDir(copy.id);
  for (const mod of source.mods) {
    if (!mod.localPath) continue;
    try {
      const destination = path.join(profileDir(copy.id), mod.fileName);
      await fs.copyFile(mod.localPath, destination);
      copy.mods.push({ ...mod, id: crypto.randomUUID(), localPath: destination, downloadedAt: new Date().toISOString() });
    } catch {}
  }
  await saveState(state);
  return state;
});
/* Shader / kaynak paketi / dünya gibi tek dosyalık içerikleri diske kaydeder.
   Bağlı launcher varken ilgili alt klasör (shaderpacks/resourcepacks/saves) önerilir. */
ipcMain.handle('mods:downloadFile', async (_, url, fileName, kind) => {
  if (!isSafeRemoteUrl(url)) throw new Error('Yalnızca https bağlantılarından indirme yapılır.');
  const cleanName = clean(path.basename(String(fileName || 'dosya.zip'))) || 'dosya.zip';
  const SUBDIRS = { shader: 'shaderpacks', resourcepack: 'resourcepacks', world: 'saves', modpack: '' };
  const state = await getState();
  const launcher = state.launchers[0];
  const subdir = SUBDIRS[kind] || '';
  const suggestedDir = launcher && subdir ? path.join(launcherRoot(launcher.location), subdir) : null;
  const chosen = await dialog.showSaveDialog({ title: 'Dosyayı kaydet', defaultPath: suggestedDir ? path.join(suggestedDir, cleanName) : cleanName });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  const buffer = await downloadBinary(url, { maxBytes: 512 * 1024 * 1024 });
  await fs.writeFile(chosen.filePath, buffer);
  return { canceled: false, path: chosen.filePath, size: buffer.length };
});
async function folderSize(dir) {
  let total = 0, files = 0;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return { total, files }; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const sub = await folderSize(full); total += sub.total; files += sub.files; }
    else { try { const stat = await fs.stat(full); total += stat.size; files++; } catch {} }
  }
  return { total, files };
}
ipcMain.handle('system:storageInfo', async () => {
  const state = await getState();
  const perProfile = [];
  for (const profile of state.profiles) {
    const { total, files } = await folderSize(path.join(PROFILES_DIR(), profile.id));
    perProfile.push({ id: profile.id, name: profile.name, bytes: total, files });
  }
  const grand = perProfile.reduce((sum, item) => sum + item.bytes, 0);
  return { userDataPath: APP_DIR(), totalBytes: grand, profiles: perProfile };
});
ipcMain.handle('app:resetAll', async () => {
  await features.backupBefore('pre-reset');
  await fs.rm(PROFILES_DIR(), { recursive: true, force: true });
  await fs.mkdir(PROFILES_DIR(), { recursive: true });
  const fresh = structuredClone(defaults);
  await saveState(fresh);
  return fresh;
});
const EXECUTABLE_EXT = /\.(exe|com|scr|msi|pif|cmd|bat|vbs|vbe|wsf|wsh|lnk|jar|ps1|psm1|hta|reg|cpl|msix|appx)$/i;
async function openPathRoots() {
  const roots = [app.getPath('userData'), APP_DIR(), path.join(app.getPath('home'), '.minecraft')];
  const state = await getState().catch(() => null);
  for (const entry of state?.launchers || []) roots.push(launcherRoot(entry.location));
  return roots.filter(Boolean).map(root => path.resolve(root));
}
function isUnderAny(target, roots) {
  const win = process.platform === 'win32';
  const norm = p => (win ? p.toLowerCase() : p).replace(/[\\/]+$/g, '');
  const probe = norm(target);
  return roots.some(root => { const base = norm(root); return probe === base || probe.startsWith(base + path.sep) || probe.startsWith(base + (win ? '\\' : '/')); });
}
ipcMain.handle('system:openPath', async (_, target) => {
  const raw = String(target ?? '');
  if (!raw.trim() || raw.includes('\0')) throw new Error('Geçersiz yol.');
  const resolved = path.resolve(raw);
  if (EXECUTABLE_EXT.test(resolved)) throw new Error('Güvenlik: çalıştırılabilir dosya klasörde açılamaz.');
  if (!isUnderAny(resolved, await openPathRoots())) throw new Error('Güvenlik: yalnızca MineVerse klasörleri ve tanımlı oyun launcherları açılabilir.');
  const exists = await fs.stat(resolved).then(() => true, () => false);
  if (!exists) throw new Error('Klasör bulunamadı: ' + resolved);
  return shell.openPath(resolved);
});
ipcMain.handle('system:copy', (_, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggleMaximize', () => { if (!mainWindow) return false; if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); return mainWindow.isMaximized(); });
ipcMain.handle('window:close', () => mainWindow?.close());
