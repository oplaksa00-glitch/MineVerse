'use strict';
/* MineVerse v0.9 — gerçek oyun başlatıcı.
   profile -> Mojang sürüm JSON'u -> kütüphaneler + natives + assetler -> java.
   Yükleme dizini yönetilen bir .minecraft kopyasıdır (APP_DIR/minecraft);
   kullanıcının kendi Minecraft kurulumuna dokunulmaz, yalnızca oradaki kurulu
   sürüm JSON'ları (Fabric/Forge yüklemişse) okunur. */
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

let ctx = null;
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const osName = isMac ? 'osx' : isWin ? 'windows' : 'linux';

const GAME_DIR = () => path.join(ctx.APP_DIR(), 'minecraft');
const LIB_DIR = () => path.join(GAME_DIR(), 'libraries');
const ASSET_DIR = () => path.join(GAME_DIR(), 'assets');
const VERSION_DIR = id => path.join(GAME_DIR(), 'versions', id);
const LOG_FILE = () => path.join(GAME_DIR(), 'logs', 'mineverse-son-baslatma.log');

let running = null;
let lastRun = null;
let lastProgress = { phase: 'idle', done: 0, total: 0, label: '' };
const nowIso = () => new Date().toISOString();

function emit(webContents, phase, done, total, label) {
  lastProgress = { phase, done, total, label: label || '' };
  try { webContents.send('launch:progress', lastProgress); } catch {}
}

/* ---------- yardımcı: sınırlı eşzamanlı iş koşucu ---------- */
async function runPool(items, size, worker, onEach) {
  let index = 0; let done = 0;
  const errors = [];
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      try { await worker(items[current], current); }
      catch (error) { errors.push(error); }
      done++;
      onEach?.(done);
    }
  });
  await Promise.all(runners);
  if (errors.length) throw errors[0];
  return done;
}

async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function writeFileAtomic(file, buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, file);
}
async function fetchBuffer(url, timeoutMs = 120000) {
  const buffer = await ctx.downloadBinary(url, { timeoutMs });
  return buffer;
}
async function sha1Of(buffer) { return crypto.createHash('sha1').update(buffer).digest('hex'); }

/* ---------- sürüm JSON'u çözümü ---------- */
async function vanillaManifest() {
  return ctx.fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
}
function jsonLoader(json) {
  const hay = [json.mainClass || '', ...(json.libraries || []).map(lib => lib.name || '')].join(' ').toLowerCase();
  if (hay.includes('net.fabricmc') || hay.includes('fabric-loader')) return 'fabric';
  if (hay.includes('net.neoforged') || hay.includes('neoforged')) return 'neoforge';
  if (hay.includes('net.minecraftforge') || hay.includes('cpw.mods') || hay.includes('minecraftforge')) return 'forge';
  return 'vanilla';
}
async function externalVersionJson(gameVersion, wantedLoader) {
  // Kullanıcının kendi .minecraft/versions dizini (Fabric/Forge kurmuş olabilir) — salt okunur.
  const home = ctx.app.getPath('home');
  const roots = [
    isWin ? path.join(ctx.app.getPath('appData'), '.minecraft') : path.join(home, '.minecraft'),
    path.join(home, '.prismlauncher'), path.join(ctx.app.getPath('appData') || home, 'PrismLauncher')
  ];
  const wanted = String(wantedLoader || 'vanilla').toLowerCase();
  const base = gameVersion.toLowerCase();
  const score = (id, json) => {
    const lower = id.toLowerCase();
    const loader = jsonLoader(json);
    const linked = lower === base || lower.startsWith(base + '-') || String(json.inheritsFrom || '').toLowerCase() === base
      || String(json.inheritsFrom || '').toLowerCase().startsWith(base + '-');
    if (!linked) return 0;
    if (wanted === 'vanilla') return lower === base && loader === 'vanilla' ? 5 : 0;
    if (loader === wanted) return lower === base ? 4 : 5;
    if (lower.includes(wanted)) return 3;
    return 0;
  };
  for (const root of roots) {
    let ids = [];
    try { ids = await fs.readdir(root + path.sep + 'versions'); } catch { continue; }
    const candidates = [];
    for (const id of ids) {
      const candidate = path.join(root, 'versions', id, `${id}.json`);
      if (!(await exists(candidate))) continue;
      let json;
      try { json = JSON.parse(await fs.readFile(candidate, 'utf8')); } catch { continue; }
      const value = score(id, json);
      if (value) candidates.push({ id, json, value });
    }
    candidates.sort((a, b) => b.value - a.value);
    if (candidates.length) return { json: candidates[0].json, id: candidates[0].id };
  }
  return null;
}
async function vanillaJson(gameVersion) {
  const manifest = await vanillaManifest();
  const entry = manifest.versions.find(v => v.id === gameVersion);
  if (!entry) throw new Error(`Minecraft ${gameVersion} sürümü Mojang listesinde bulunamadı.`);
  return ctx.fetchJson(entry.url);
}
/* inheritsFrom zincirini Mojang sürüm JSON'larıyla kapatır (Forge/Fabric bunu kullanır). */
async function withInheritance(json, depth = 0) {
  if (!json.inheritsFrom || depth > 3) { if (json.inheritsFrom) throw new Error('Sürüm miras zinciri çok uzun.'); return json; }
  const parent = await vanillaJson(json.inheritsFrom);
  const merged = mergeClient(json, parent);
  merged._parentId = parent.id;
  return merged;
}
function mergeArguments(child, parent) {
  const out = {};
  for (const key of ['jvm', 'game']) {
    const a = parent?.[key] || []; const b = child?.[key] || [];
    out[key] = Array.isArray(a) && Array.isArray(b) ? [...a, ...b] : (b.length ? b : a);
  }
  return out;
}
function mergeClient(child, parent) {
  return {
    ...parent, ...child,
    id: child.id || parent.id,
    inheritsFrom: undefined,
    libraries: [...(child.libraries || []), ...(parent.libraries || [])],
    arguments: child.arguments || parent.arguments ? mergeArguments(child.arguments, parent.arguments) : undefined,
    mainClass: child.mainClass || parent.mainClass,
    downloads: child.downloads?.client ? child.downloads : parent.downloads,
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
    javaVersion: child.javaVersion || parent.javaVersion,
    logging: child.logging || parent.logging,
    _parentId: parent.id
  };
}
async function resolveClient(gameVersion, loader) {
  const wantedLoader = String(loader || 'vanilla').toLowerCase();

  // 1) Bizim yönetilen dizinde daha önce çözülmüş bir sürüm varsa onu kullan.
  const localCandidates = wantedLoader === 'fabric' ? [`${gameVersion}-fabric`] : [gameVersion];
  for (const id of localCandidates) {
    const file = path.join(VERSION_DIR(id), `${id}.json`);
    if (await exists(file)) {
      try { return { json: await withInheritance(JSON.parse(await fs.readFile(file, 'utf8'))), id, via: 'managed' }; } catch {}
    }
  }
  // 2) Kullanıcının kurulu sürümleri (Fabric/Forge yüklemiş olabilir).
  if (wantedLoader !== 'vanilla') {
    const external = await externalVersionJson(gameVersion, wantedLoader);
    if (external) return { json: await withInheritance(external.json), id: external.id, via: 'external' };
    if (wantedLoader !== 'fabric') throw new Error(`${gameVersion} için kurulu bir ${loader} profili bulunamadı. Önce resmî launcher veya kurulucu ile bu sürümü bir kez başlat, sonra burada Forge/NeoForge modunu seç.`);
  }
  // 3) Fabric: resmî meta API'sinden tam client JSON üret.
  if (wantedLoader === 'fabric') {
    const loaders = await ctx.fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`);
    const loaderVersion = loaders?.[0]?.loader?.version;
    if (!loaderVersion) throw new Error(`${gameVersion} için Fabric yükleyici bulunamadı.`);
    const [fabricJson, vanilla] = await Promise.all([
      ctx.fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}/${loaderVersion}/profile/json`),
      vanillaJson(gameVersion)
    ]);
    const merged = mergeClient(fabricJson, vanilla);
    merged._fabricLoader = loaderVersion;
    return { json: merged, id: fabricJson.id, via: 'fabric' };
  }
  // 4) Vanilla.
  return { json: await vanillaJson(gameVersion), id: gameVersion, via: 'vanilla' };
}

/* ---------- kütüphaneler ---------- */
function rulesAllow(rules) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    const osMatch = !rule.os || (rule.os.name === osName && (!rule.os.version || new RegExp(rule.os.version).test(os.release())) && (!rule.os.arch || rule.os.arch.replace('x86', 'ia32') === process.arch));
    const featureMatch = !rule.features || Object.keys(rule.features).every(key => !rule.features[key]);
    if (osMatch && featureMatch) allowed = rule.action === 'allow';
  }
  return allowed;
}
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const tail = classifier ? `-${classifier}` : '';
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}${tail}.jar`;
}
function libraryEntries(json) {
  const out = [];
  for (const lib of json.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const downloads = lib.downloads;
    if (downloads?.artifact) {
      const nativeKey = lib.natives?.[osName]?.replace('${arch}', process.arch === 'x64' ? '64' : '32');
      const classifier = nativeKey ? (downloads.classifiers?.[nativeKey] || downloads.artifact) : downloads.artifact;
      out.push({ path: classifier.path || mavenPath(lib.name), url: classifier.url, sha1: classifier.sha1, size: classifier.size, extract: !!nativeKey || /-natives-/.test(classifier.path || '') });
      if (nativeKey && downloads.artifact) out.push({ path: downloads.artifact.path, url: downloads.artifact.url, sha1: downloads.artifact.sha1, size: downloads.artifact.size, extract: false });
      continue;
    }
    // Fabric/Forge tarzı: yalnızca maven adı + (varsa) özel url
    const base = lib.url || 'https://libraries.minecraft.net/';
    const rel = mavenPath(lib.name);
    out.push({ path: rel, url: base.replace(/\/$/, '') + '/' + rel, sha1: '', size: 0, extract: /-natives-/.test(rel) });
  }
  return out;
}
async function installLibraries(json, nativesDir, onProgress) {
  const entries = libraryEntries(json);
  const classpath = [];
  for (const entry of entries) classpath.push(path.join(LIB_DIR(), entry.path));
  let done = 0;
  await runPool(entries, 8, async entry => {
    const target = path.join(LIB_DIR(), entry.path);
    if (!(await exists(target))) {
      const buffer = await fetchBuffer(entry.url);
      if (entry.sha1 && (await sha1Of(buffer)) !== entry.sha1) throw new Error(`${path.basename(entry.path)} doğrulanamadı.`);
      await writeFileAtomic(target, buffer);
    }
    if (entry.extract) {
      const marker = path.join(nativesDir, path.basename(entry.path) + '.ok');
      if (!(await exists(marker))) {
        await fs.mkdir(nativesDir, { recursive: true });
        try {
          const zip = new AdmZip(target);
          for (const item of zip.getEntries()) {
            if (item.isDirectory || /^META-INF\//i.test(item.entryName)) continue;
            const out = path.join(nativesDir, item.entryName);
            if (!out.startsWith(path.resolve(nativesDir) + path.sep)) continue;
            await fs.mkdir(path.dirname(out), { recursive: true });
            await fs.writeFile(out, item.getData());
          }
          await fs.writeFile(marker, '');
        } catch (error) { throw new Error(`Native açılamadı (${path.basename(entry.path)}): ${error.message}`); }
      }
    }
    onProgress?.(++done);
  }, d => onProgress?.(d));
  return classpath;
}
/* Native jar'ları klasör içinde alt dizine açabilir (windows/x86...); JVM'e gerçek klasörü ver. */
async function nativeLoadDir(nativesDir) {
  const sub = isWin ? 'windows' : isMac ? 'macos' : 'linux';
  const candidates = [nativesDir, path.join(nativesDir, sub), path.join(nativesDir, sub, 'x86_64'), path.join(nativesDir, sub, 'x86'), path.join(nativesDir, sub, 'arm64')];
  for (const dir of candidates) {
    let files = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    if (files.some(f => /\.(dll|so|dylib)$/i.test(f))) return dir;
  }
  return nativesDir;
}

/* Mojang'ın log4j yapılandırması XML bastığı için kendi sade ayarımızı yazıyoruz:
   hem konsol (burada topladığımız log) hem de oyunun kendi logs/latest.log dosyası düz metin olur. */
const LOG4J_CONFIG = `<?xml version="1.0" encoding="UTF-8"?>
<Configuration status="3" packages="net.minecraft,com.mojang">
  <Appenders>
    <Console name="SysOut" target="SYSTEM_OUT"><PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level]: %msg{nolookups}%n"/></Console>
    <RollingRandomAccessFile name="File" fileName="logs/latest.log" filePattern="logs/%d{yyyy-MM-dd}-%i.log.gz">
      <PatternLayout pattern="[%d{HH:mm:ss}] [%t/%level]: %msg{nolookups}%n"/>
      <Policies><TimeBasedRolloverStrategy/></Policies>
      <DefaultRolloverStrategy max="10"/>
    </RollingRandomAccessFile>
  </Appenders>
  <Loggers>
    <Root level="info"><AppenderRef ref="SysOut"/><AppenderRef ref="File"/></Root>
  </Loggers>
</Configuration>
`;
async function installLogging(json, gameDir) {
  if (!json.logging?.client) return null;
  const target = path.join(gameDir, 'logs', 'mineverse-log4j2.xml');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, LOG4J_CONFIG);
  return `-Dlog4j.configurationFile=${target}`;
}

async function installClientJar(json, parentId) {
  const client = json.downloads?.client;
  const id = parentId || json.id;
  const target = path.join(VERSION_DIR(id), `${id}.jar`);
  if (await exists(target)) return target;
  if (!client?.url) throw new Error('Sürüm JSON\u2019unda client jar bağlantısı yok.');
  const buffer = await fetchBuffer(client.url, 600000);
  if (client.sha1 && (await sha1Of(buffer)) !== client.sha1) throw new Error('Oyun dosyası doğrulanamadı.');
  await writeFileAtomic(target, buffer);
  return target;
}
async function installAssets(json, onProgress) {
  if (!json.assetIndex?.url) return json.assets || 'legacy';
  const indexTarget = path.join(ASSET_DIR(), 'indexes', `${json.assets}.json`);
  let index;
  if (await exists(indexTarget)) index = JSON.parse(await fs.readFile(indexTarget, 'utf8'));
  else {
    index = await ctx.fetchJson(json.assetIndex.url);
    await writeFileAtomic(indexTarget, Buffer.from(JSON.stringify(index)));
  }
  const objects = Object.entries(index.objects || {});
  const already = async hash => exists(path.join(ASSET_DIR(), 'objects', hash.slice(0, 2), hash));
  const missing = [];
  for (const [, obj] of objects) if (!(await already(obj.hash))) missing.push(obj);
  let done = objects.length - missing.length;
  const total = objects.length;
  await runPool(missing, 12, async obj => {
    const buffer = await fetchBuffer(`https://resources.download.minecraft.net/${obj.hash.slice(0, 2)}/${obj.hash}`, 60000);
    await writeFileAtomic(path.join(ASSET_DIR(), 'objects', obj.hash.slice(0, 2), obj.hash), buffer);
  }, () => onProgress?.(++done, total));
  return json.assets;
}

/* ---------- argümanlar ---------- */
function flatten(list, features) {
  if (typeof list === 'string') return [list];
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') { out.push(item); continue; }
    if (Array.isArray(item)) { out.push(...flatten(item, features)); continue; }
    if (item && typeof item === 'object') {
      const allow = rulesAllow(item.rules);
      const wanted = Object.keys(item.features || {}).every(key => !!features[key] === !!item.features[key]);
      if (allow && wanted) out.push(...flatten(item.value, features));
    }
  }
  return out;
}
function substitute(token, map) {
  return token.replace(/\$\{([^}]+)\}/g, (_, key) => (map[key] === undefined ? '' : String(map[key])));
}
function buildArguments(json, opts) {
  const map = {
    auth_player_name: opts.username,
    version_name: opts.versionId,
    game_directory: opts.gameDir,
    assets_root: ASSET_DIR(),
    assets_index_name: opts.assetsId,
    auth_uuid: opts.uuid.replace(/-/g, ''),
    auth_uuid_with_dashes: opts.uuid,
    auth_access_token: '0',
    auth_xuid: opts.uuid.replace(/-/g, ''),
    clientid: opts.uuid,
    auth_session: '0',
    user_type: 'legacy',
    user_properties: '{}',
    profile_name: opts.profileName,
    profile_id: opts.profileName.replace(/\s+/g, '').toLowerCase(),
    version_type: json.type || 'release',
    native_path: opts.nativesDir,
    launch_cooperative_data: 'false',
    resolution_width: '1280', resolution_height: '720',
    quickPlayPath: '', quickPlaySingleplayer: '', quickPlayMultiplayer: '', quickPlayRealms: ''
  };
  const features = { 'is_demo': false, 'has_custom_resolution': false, 'is_quick_play_singleplayer': false, 'is_quick_play_multiplayer': false, 'is_quick_play_realms': false };
  let gameArgs;
  if (json.arguments?.game) gameArgs = flatten(json.arguments.game, features);
  else gameArgs = String(json.minecraftArguments || '').split(/\s+/).filter(Boolean);
  let jvmArgs;
  if (json.arguments?.jvm) jvmArgs = flatten(json.arguments.jvm, features);
  else jvmArgs = ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
  const classpath = [...opts.classpath, opts.jar].join(path.delimiter);
  const jvmFeatureMap = { ...features, natives_directory: opts.nativesDir, classpath, launcher_name: 'MineVerse', launcher_version: '0.10' };
  const mapped = jvmArgs.map(arg => substitute(arg, { ...map, ...jvmFeatureMap, natives_directory: opts.nativesDir, classpath }));
  const finalJvm = mapped.filter(arg => arg && !arg.includes('${'));
  const defaults = (json.mavenArguments || []).flatMap(entry => (entry.rules ? [] : entry.arguments)).filter(Boolean);
  return [...defaults, ...finalJvm, json.mainClass, ...gameArgs.map(arg => substitute(arg, map)).filter(arg => arg && !arg.includes('${') && arg !== '--')];
}

/* ---------- profil modlarını yönetilen klasöre koy ---------- */
async function syncMods(profile) {
  const modsDir = path.join(GAME_DIR(), 'mods');
  await fs.mkdir(modsDir, { recursive: true });
  for (const entry of await fs.readdir(modsDir)) await fs.rm(path.join(modsDir, entry), { force: true, recursive: true });
  let copied = 0;
  for (const mod of profile.mods) {
    if (!mod.localPath || mod.enabled === false) continue;
    try { await fs.copyFile(mod.localPath, path.join(modsDir, mod.fileName)); copied++; } catch {}
  }
  return { copied, modsDir };
}

/* ---------- ana giriş noktası ---------- */
async function launchProfile(profileId, options, event) {
  if (running?.child && !running.child.killed) throw new Error('Minecraft zaten çalışıyor. Önce kapat ya da durdur.');
  const state = await ctx.getState();
  const profile = state.profiles.find(p => p.id === profileId);
  if (!profile) throw new Error('Profil bulunamadı.');
  const account = state.accounts?.find(a => a.id === state.settings.activeAccountId) || state.accounts?.[0];
  const username = (options.username || account?.displayName || 'MineVerse').trim().slice(0, 16);
  const uuid = account?.uuid || ctx.offlineUuid(username);

  const gameDir = GAME_DIR();
  await fs.mkdir(gameDir, { recursive: true });
  const report = (phase, done, total, label) => emit(event.sender, phase, done, total, label);

  report('resolve', 0, 0, 'Sürüm hazırlanıyor…');
  const { json, id, via } = await resolveClient(profile.gameVersion, profile.loader);
  const nativesDir = path.join(VERSION_DIR(id), 'natives');

  report('libraries', 0, 0, 'Kütüphaneler indiriliyor…');
  const classpath = await installLibraries(json, nativesDir, done => report('libraries', done, (json.libraries || []).length, 'Kütüphaneler'));

  report('jar', 0, 0, 'Oyun dosyası indiriliyor…');
  const jar = await installClientJar(json, json._parentId || id);

  report('assets', 0, 0, 'Varlıklar (ses/doku) indiriliyor…');
  const assetsId = await installAssets(json, (done, total) => report('assets', done, total, 'Varlıklar'));

  report('mods', 0, 0, 'Profil modları eşitleniyor…');
  const { copied } = await syncMods(profile);

  report('java', 0, 0, 'Java hazırlanıyor…');
  const java = await ctx.resolveJava(profile.gameVersion);
  const maxGb = Math.max(2, Math.min(16, +options.maxMemoryGb || 4));
  const nativesForJvm = await nativeLoadDir(nativesDir);
  const args = buildArguments(json, {
    username, uuid, versionId: id, gameDir, nativesDir: nativesForJvm, classpath, jar, assetsId, profileName: profile.name
  });
  // Sürüm JSON'unun sabit bellek ayarları ve log4j yapılandırması bizimkilerle değiştirilir.
  const filtered = [];
  for (let i = 0; i < args.length; i++) {
    if (/^-Xm[xs]\d+G$/.test(args[i])) continue;
    if (args[i] === '-Dlog4j.configurationFile') { i += 1; continue; }
    filtered.push(args[i]);
  }
  const command = [`-Xmx${maxGb}G`, `-Xms${Math.max(1, Math.round(maxGb / 4))}G`, ...filtered];
  const logArg = await installLogging(json, gameDir).catch(() => null);
  if (logArg && !command.some(a => String(a).startsWith('-Dlog4j.configurationFile'))) {
    const at = command.indexOf(json.mainClass);
    command.splice(at >= 0 ? at : 0, 0, logArg);
  }

  report('spawn', 0, 0, 'Oyun açılıyor…');
  const child = spawn(java.exe, command, { cwd: gameDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const logTail = [];
  const logFile = LOG_FILE();
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  const stream = fsSync.createWriteStream(logFile, { flags: 'w' });
  stream.write(`# MineVerse son başlatma logu\n# tarih: ${nowIso()}\n# profil: ${profile.name} (${profile.gameVersion} / ${profile.loader})\n# sürüm: ${id} (${via})\n# java: ${java.exe}\n# oyun klasörü: ${gameDir}\n# mod: ${copied}\n# komut: ${java.exe} ${command.map(a => (a.includes(' ') || a.includes(';')) ? `"${a}"` : a).join(' ')}\n\n`);
  let recorded = 0;
  const capture = s => s.on('data', chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      recorded++;
      stream.write(line + '\n');
      logTail.push(line);
      if (logTail.length > 120) logTail.shift();
    }
  });
  capture(child.stdout); capture(child.stderr);
  running = { child, profileId, startedAt: nowIso(), logTail, logFile, stream };
  child.on('error', error => {
    lastRun = { exitCode: -1, log: [error.message], endedAt: nowIso(), logFile, lines: recorded, command: java.exe };
    stream.write(`\n# HATA: ${error.message}\n`); stream.end();
    running = null;
    emit(event.sender, 'error', 0, 0, `${error.message} (log: ${logFile})`);
  });
  child.on('exit', code => {
    lastRun = { exitCode: code, log: logTail.slice(-30), endedAt: nowIso(), versionId: id, gameDir, logFile, lines: recorded };
    stream.write(`\n# çıkış kodu: ${code} · satır: ${recorded}\n`); stream.end();
    const tail = logTail.filter(line => /error|exception|caused by|failed|cannot|unable|no such|missing/i.test(line)).slice(-1)[0];
    emit(event.sender, 'exit', 0, 0, code === 0 ? 'Oyun kapandı.' : `Oyun beklenmedik biçimde kapandı (kod ${code}).${tail ? ' Son hata: ' + tail.slice(0, 180) : ''} Logu Ayarlar → Başlatma bölümünden açabilirsin.`);
    running = null;
  });
  return { launched: true, versionId: id, via, java: java.exe, mods: copied, gameDir, username, uuid, logFile };
}

/* ---------- ön uyumluluk kontrolü ---------- */
function versionParts(value) {
  const m = String(value || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
}
function compareVersions(a, b) {
  const pa = versionParts(a), pb = versionParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}
function gradleRangeOk(token, version) {
  const open = token[0], close = token[token.length - 1];
  const parts = token.slice(1, -1).split(',').map(s => s.trim());
  if (parts.length < 2) return parts[0] ? compareVersions(parts[0], version) === 0 : true;
  const [lo, hi] = parts;
  let ok = true;
  if (lo) ok = ok && (open === '[' ? compareVersions(version, lo) >= 0 : compareVersions(version, lo) > 0);
  if (hi && hi !== '*') ok = ok && (close === ']' ? compareVersions(version, hi) <= 0 : compareVersions(version, hi) < 0);
  return ok;
}
function simpleConstraintOk(token, version) {
  const t = token.trim();
  if (!t || t === '*' || /^any$/i.test(t)) return true;
  const wildcard = t.match(/^(\d+)\.(\d+)\.(?:x|\*)$/i);
  const pv = versionParts(version);
  if (wildcard) {
    const v = versionParts(t);
    return !!pv && !!v && pv[0] === +wildcard[1] && pv[1] === +wildcard[2];
  }
  const op = (t.match(/^(>=|<=|=>|=<|>|<|\^|~)/) || [''])[0];
  const target = op ? t.slice(op.length).trim() : t;
  const pt = versionParts(target);
  if (!pv || !pt) return true;
  const vcmp = compareVersions(version, target);
  const minorCount = (target.match(/\./g) || []).length;
  if (op === '>=' || op === '=>') return vcmp >= 0;
  if (op === '>') return vcmp > 0;
  if (op === '<=' || op === '=<') return vcmp <= 0;
  if (op === '<') return vcmp < 0;
  if (op === '^') return pt[0] > 0 ? pv[0] === pt[0] && vcmp >= 0 : pv[1] === pt[1] && vcmp >= 0;
  if (op === '~') return minorCount >= 1 ? pv[0] === pt[0] && pv[1] === pt[1] && vcmp >= 0 : pv[0] === pt[0] && vcmp >= 0;
  if (minorCount >= 2) return pv[0] === pt[0] && pv[1] === pt[1] && pv[2] === pt[2];
  if (minorCount === 1) return pv[0] === pt[0] && pv[1] === pt[1];
  return pv[0] === pt[0];
}
function rangeSatisfies(range, version) {
  const text = String(range || '').trim();
  if (!text || text === '*' || /^any$/i.test(text)) return true;
  return text.split('||').some(group => {
    const brackets = group.match(/[\[(][^\])]*[\])]/g) || [];
    const rest = group.replace(/[\[(][^\])]*[\])]/g, ' ');
    const tokens = rest.split(/[\s,]+/).filter(Boolean);
    return [...brackets.map(b => gradleRangeOk(b, version)), ...tokens.map(tok => simpleConstraintOk(tok, version))].every(Boolean);
  });
}

const MOD_MANIFESTS = { 'fabric.mod.json': 'fabric', 'quilt.mod.json': 'quilt', 'META-INF/neoforge.mods.toml': 'neoforge', 'META-INF/mods.toml': 'forge', 'mcmod.info': 'forge' };

function rangesFromFabric(json) {
  const out = [];
  const dep = json?.depends?.minecraft ?? json?.depends?.['minecraft'];
  if (typeof dep === 'string') out.push(dep);
  if (Array.isArray(dep)) out.push(...dep.filter(x => typeof x === 'string'));
  return out;
}
function rangesFromToml(text) {
  const out = [];
  for (const m of String(text).matchAll(/^mcVersion\s*=\s*(.+)$/gmi)) {
    const value = m[1].trim().replace(/^["']|["']$/g, '');
    if (value) out.push(value);
  }
  return out;
}
function rangesFromMcmod(text) {
  try {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : [data];
    return list.map(e => e?.mcversion).filter(v => typeof v === 'string' && v);
  } catch { return []; }
}

/* Bir jar'ın içine bakıp yükleyici ve istenen Minecraft sürümünü çıkarır. */
async function inspectModJar(file) {
  const info = { loaders: [], ranges: [], manifest: false, note: '' };
  let zip;
  try { zip = new AdmZip(file); } catch { info.note = 'Dosya okunamadı (bozuk jar?).'; return info; }
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    const loader = MOD_MANIFESTS[name];
    if (!loader) continue;
    info.manifest = true;
    const content = entry.getData().toString('utf8');
    let detected = loader;
    if (name === 'META-INF/mods.toml' && /neoforge/i.test(content)) detected = 'neoforge';
    if (!info.loaders.includes(detected)) info.loaders.push(detected);
    try {
      if (name === 'fabric.mod.json') info.ranges.push(...rangesFromFabric(JSON.parse(content)));
      if (name === 'quilt.mod.json') {
        const json = JSON.parse(content);
        const deps = json?.quilt_metadata?.depends || json?.depends || [];
        for (const d of Array.isArray(deps) ? deps : []) if (d?.id === 'minecraft' && d.versions) info.ranges.push(String(d.versions));
      }
      if (name.endsWith('mods.toml')) info.ranges.push(...rangesFromToml(content));
      if (name === 'mcmod.info') info.ranges.push(...rangesFromMcmod(content));
    } catch {}
  }
  if (!info.manifest) {
    const base = path.basename(file);
    if (/fabric/i.test(base)) info.loaders.push('fabric');
    if (/neoforge/i.test(base)) info.loaders.push('neoforge');
    else if (/\bforge\b|\b.forge./i.test(base)) info.loaders.push('forge');
    const ver = base.match(/\b(\d+\.\d+(?:\.\d+)?)\b/);
    if (ver) info.ranges.push(ver[1]);
    info.note = info.loaders.length || ver ? 'Sürüm bilgisi dosya adından alındı.' : 'Bu dosya Minecraft modu gibi görünmüyor (mod tanıtım dosyası yok).';
  }
  return info;
}

const LOADER_LABEL = { vanilla: 'Vanilla', Fabric: 'Fabric', Quilt: 'Quilt', Forge: 'Forge', NeoForge: 'NeoForge' };
function loadersCompatible(profileLoader, modLoader) {
  const p = String(profileLoader || 'vanilla').toLowerCase(), m = String(modLoader).toLowerCase();
  if (p === 'vanilla') return { ok: false, soft: true };
  if (p === 'fabric') return { ok: m === 'fabric' || m === 'quilt' };
  if (p === 'quilt') return { ok: m === 'quilt' || m === 'fabric' };
  if (p === 'neoforge') return { ok: m === 'neoforge' };
  if (p === 'forge') return { ok: m === 'forge' };
  return { ok: true };
}

async function preflight(profileId) {
  const state = await ctx.getState();
  const profile = state.profiles.find(p => p.id === profileId);
  if (!profile) throw new Error('Profil bulunamadı.');
  const issues = [];
  let checked = 0;
  for (const mod of profile.mods || []) {
    if (mod.enabled === false) continue;
    if (!mod.localPath) continue;
    checked++;
    const info = await inspectModJar(mod.localPath);
    const blockIds = [];
    for (const loader of info.loaders) {
      const cmp = loadersCompatible(profile.loader, loader);
      if (cmp.ok) continue;
      issues.push({
        modId: mod.id, name: mod.name || mod.fileName, fileName: mod.fileName, severity: cmp.soft ? 'warn' : 'block',
        reason: cmp.soft
          ? `Profil yükleyicisi Vanilla; "${loader}" modları çalışmaz. Forge/NeoForge/Fabric profilinden birini kullan.`
          : `Bu mod ${LOADER_LABEL[loader] || loader} için; profil ${LOADER_LABEL[profile.loader] || profile.loader} kullanıyor.`
      });
      if (!cmp.soft) blockIds.push(loader);
    }
    for (const range of info.ranges) {
      if (rangeSatisfies(range, profile.gameVersion)) continue;
      issues.push({
        modId: mod.id, name: mod.name || mod.fileName, fileName: mod.fileName,
        severity: info.manifest ? 'block' : 'warn',
        reason: `Mod Minecraft ${range} istiyor, profil sürümü ${profile.gameVersion}.` + (info.manifest ? '' : ' (dosya adından tahmin edildi)')
      });
    }
    if (!info.manifest && !info.loaders.length && !info.ranges.length && info.note) {
      issues.push({ modId: mod.id, name: mod.name || mod.fileName, fileName: mod.fileName, severity: 'info', reason: info.note });
    }
  }
  const blocking = issues.filter(i => i.severity === 'block');
  return {
    ok: blocking.length === 0, checked, issues,
    blockingModIds: [...new Set(blocking.map(i => i.modId))],
    profile: { id: profile.id, name: profile.name, gameVersion: profile.gameVersion, loader: profile.loader }
  };
}

function lastErrorHint(lines) {
  const hits = (lines || []).filter(line => /error|exception|caused by|failed|cannot|unable|no such|missing|incompatible|crash/i.test(line));
  return hits.slice(-6).join('\n');
}

function register(context) {
  ctx = context;
  const { ipcMain } = ctx;
  ipcMain.handle('launch:prepare', async (_, profileId) => {
    const state = await ctx.getState();
    const profile = state.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('Profil bulunamadı.');
    const requiredJava = ctx.requiredJava(profile.gameVersion);
    return { gameVersion: profile.gameVersion, loader: profile.loader, requiredJava, gameDir: GAME_DIR(), running: !!running, mode: state.settings.launchMode };
  });
  ipcMain.handle('launch:play', (event, profileId, options) => launchProfile(profileId, options || {}, event));
  ipcMain.handle('launch:status', () => ({ running: !!running, progress: lastProgress, startedAt: running?.startedAt || null, log: running ? running.logTail.slice(-25) : (lastRun?.log || []), logFile: lastRun?.logFile || LOG_FILE(), lastExit: lastRun ? { code: lastRun.exitCode, at: lastRun.endedAt, gameDir: lastRun.gameDir, lines: lastRun.lines } : null }));
  ipcMain.handle('launch:log', async () => {
    const file = lastRun?.logFile || LOG_FILE();
    let text = '';
    let exists = true;
    try { text = await fs.readFile(file, 'utf8'); } catch { exists = false; }
    const lines = text.split(/\r?\n/);
    return { exists, path: file, size: text.length, lines: lines.length, text: lines.slice(-500).join('\n'), lastExit: lastRun ? { code: lastRun.exitCode, at: lastRun.endedAt, lines: lastRun.lines } : null, hint: lastErrorHint(lines) };
  });
  ipcMain.handle('launch:openLog', async () => {
    const file = lastRun?.logFile || LOG_FILE();
    try { await fs.access(file); } catch { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '# Henüz bu bilgisayarda MineVerse ile oyun başlatılmadı.\n'); }
    return ctx.shell.openPath(file);
  });
  ipcMain.handle('launch:preflight', (_, profileId) => preflight(profileId));
  ipcMain.handle('launch:stop', async () => {
    if (!running?.child) return { stopped: false };
    running.child.kill();
    return { stopped: true };
  });
  ipcMain.handle('launch:openGameDir', async () => { await fs.mkdir(GAME_DIR(), { recursive: true }); return ctx.shell.openPath(GAME_DIR()); });
}

module.exports = { register, GAME_DIR, _internal: { resolveClient, libraryEntries, rulesAllow, buildArguments, mergeClient, externalVersionJson, syncMods, installLibraries, installLogging, nativeLoadDir, preflight, inspectModJar, rangeSatisfies, lastErrorHint } };
