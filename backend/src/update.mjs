// macOS release updates. Downloaded artifacts are complete bundles: never run
// npm, a build script, or repository source from a release during an update.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { supportedNode } from './runtime.mjs';

export const UPDATE_REPO = 'Qualop/atrium-macos';
export const DEFAULT_UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
export const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`;
export const BUNDLE_ID = 'dev.atrium.desktop.local';
export const RESULT_FILE = 'last-update.json';
export const JOB_FILE = 'swap-job.json';
export const CHANNELS = ['stable', 'dev'];
export const LIST_PER_PAGE = 100;
export const channelOf = v => v === 'dev' ? 'dev' : 'stable';
export const envValue = (key, env = process.env) => env[`ATRIUM_${key}`] ?? env[`MTASK_${key}`];
export const defaultInstallDir = () => path.join(os.homedir(), 'Library/Application Support/atrium/updates');
export const installDirOf = (env = process.env, cfg = {}) => path.resolve(envValue('INSTALL_DIR', env) || path.join(cfg.dataDir || path.dirname(defaultInstallDir()), 'updates'));
export const updateApiOf = (env = process.env) => envValue('UPDATE_API', env) || DEFAULT_UPDATE_API;
export const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
export const cleanEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_|DYLD_|NODE_OPTIONS$|NODE_PATH$)/.test(k)));
export const fail = (code, message) => Object.assign(new Error(message), { code });

export function parseVersion(value) {
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value || '').trim());
  if (!m || m.slice(1, 4).some(n => !Number.isSafeInteger(+n))) return null;
  const pre = m[4] ? m[4].split('.') : [];
  if (pre.some(n => /^\d+$/.test(n) && n.length > 1 && n.startsWith('0'))) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre };
}
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return Number(!!x) - Number(!!y);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre.length || !y.pre.length) return Number(!!y.pre.length) - Number(!!x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === q) continue;
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (p.length !== q.length) return p.length - q.length; return p < q ? -1 : 1; }
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
export const versionOfTag = tag => String(tag || '').replace(/^v/, '');
export const nodeSatisfies = (version) => supportedNode(String(version).replace(/^v/, ''));
const loopback = h => ['127.0.0.1', '[::1]', 'localhost'].includes(h);
function parsedUrl(value) { try { return new URL(value); } catch { return null; } }
export function checkApiUrl(value) {
  const u = parsedUrl(value);
  if (!u || u.username || u.password || u.hash) return { ok: false, reason: 'bad_url' };
  if (u.protocol === 'http:' && loopback(u.hostname)) return { ok: true, test: true };
  if (u.protocol !== 'https:' || u.hostname !== 'api.github.com' || u.port || !u.pathname.startsWith(`/repos/${UPDATE_REPO}/releases`)) return { ok: false, reason: 'repo' };
  return { ok: true };
}
export function checkDownloadUrl(value, apiUrl = DEFAULT_UPDATE_API, { redirect = false } = {}) {
  const u = parsedUrl(value), api = parsedUrl(apiUrl);
  if (!u || u.username || u.password || u.hash) return { ok: false, reason: 'bad_url' };
  if (api && checkApiUrl(apiUrl).ok && loopback(api.hostname) && u.origin === api.origin) return { ok: true, test: true };
  if (u.protocol !== 'https:' || u.port) return { ok: false, reason: 'not_https' };
  if (u.hostname === 'github.com' && u.pathname.startsWith(`/${UPDATE_REPO}/releases/download/`) && !/%2f|%5c|%00/i.test(u.pathname)) return { ok: true };
  // GitHub serves assets through its signed CDN. Only accept this after an
  // allowed repository asset URL redirected there, never as a manifest URL.
  if (redirect && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(u.hostname)) return { ok: true };
  return { ok: false, reason: 'repo' };
}
export function parseRelease(j, { prerelease = false } = {}) {
  if (!j || j.draft || !parseVersion(j.tag_name) || (!prerelease && (j.prerelease || parseVersion(j.tag_name).pre.length))) return null;
  const tag = j.tag_name, url = parsedUrl(j.html_url);
  return { tag, version: versionOfTag(tag), name: String(j.name || tag).slice(0, 200),
    url: url?.origin === 'https://github.com' && url.pathname.startsWith(`/${UPDATE_REPO}/releases/`) ? url.href : `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`,
    notes: String(j.body || '').replace(/\r\n/g, '\n').trim().slice(0, 4000), publishedAt: Date.parse(j.published_at) || null,
    prerelease: !!j.prerelease || !!parseVersion(tag).pre.length,
    assets: Array.isArray(j.assets) ? j.assets.filter(a => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string').map(a => ({ name: a.name, url: a.browser_download_url, size: a.size, digest: a.digest || null })) : [] };
}
export function pickRelease(list, channel = 'stable') {
  return (Array.isArray(list) ? list : []).map(j => parseRelease(j, { prerelease: channelOf(channel) === 'dev' })).filter(Boolean).sort((a, b) => compareVersions(b.version, a.version))[0] || null;
}
export function releasesListUrl(apiUrl = DEFAULT_UPDATE_API) {
  const u = parsedUrl(apiUrl);
  if (!u || !/\/releases\/latest\/?$/.test(u.pathname)) return null;
  u.pathname = u.pathname.replace(/\/latest\/?$/, ''); u.search = `?per_page=${LIST_PER_PAGE}`;
  return u.href;
}
export async function fetchLatest(fetchJson, apiUrl = DEFAULT_UPDATE_API, channel = 'stable') {
  if (!checkApiUrl(apiUrl).ok) throw fail('bad_api_url', 'Use the Qualop/atrium-macos releases API.');
  if (channelOf(channel) === 'stable') return parseRelease(await fetchJson(apiUrl));
  const base = releasesListUrl(apiUrl);
  if (!base) throw fail('bad_api_url', 'Invalid releases API.');
  let best = null;
  // Bound pagination, including when stable releases fill the first page.
  for (let page = 1; page <= 5; page++) {
    const u = new URL(base); if (page > 1) u.searchParams.set('page', String(page));
    const list = await fetchJson(u.href), r = pickRelease(list, 'dev');
    if (r && (!best || compareVersions(r.version, best.version) > 0)) best = r;
    if (!Array.isArray(list) || list.length < LIST_PER_PAGE) break;
  }
  return best;
}
export function selectAsset(release, arch = process.arch) {
  if (!['arm64', 'x64'].includes(arch) || !parseVersion(release?.tag)) throw fail('unsupported_arch', 'A macOS arm64 or x64 bundle is required.');
  const expected = `Atrium-${release.version}-macos-${arch}.zip`;
  const assets = release.assets || [], matches = assets.filter(a => a.name === expected), sums = assets.filter(a => a.name === 'SHA256SUMS.txt');
  if (matches.length !== 1 || sums.length !== 1) throw fail('no_bundle_asset', `Release requires ${expected} and SHA256SUMS.txt.`);
  return { asset: matches[0], checksums: sums[0] };
}
export function checksumFor(text, name) {
  const matches = String(text).split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line)).filter(m => m && m[2] === name);
  if (matches.length !== 1) throw fail('bad_checksum', `A unique SHA256 checksum is required for ${name}.`);
  return matches[0][1].toLowerCase();
}
async function response(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), r = (u.protocol === 'https:' ? https : http).get(u, { headers: { 'User-Agent': 'Atrium-macOS-updater', Accept: 'application/vnd.github+json' }, timeout: timeoutMs }, x => { x.setTimeout(timeoutMs, () => x.destroy(new Error('Download timed out.'))); resolve(x); });
    r.on('error', reject); r.on('timeout', () => r.destroy(new Error('Download timed out.')));
  });
}
async function body(x, limit, onBytes) {
  let n = 0; const chunks = [];
  try { for await (const c of x) { n += c.length; if (n > limit) throw fail('download_too_large', 'Download exceeds the size limit.'); chunks.push(c); onBytes?.(n); } }
  catch (e) { x.destroy(); throw e; }
  return Buffer.concat(chunks);
}
export async function httpGetJson(url, { timeoutMs = 20000 } = {}) {
  if (!checkApiUrl(url).ok) throw fail('bad_api_url', 'Invalid releases API.');
  const x = await response(url, timeoutMs);
  if (x.statusCode !== 200) { x.resume(); throw fail(x.statusCode === 404 ? 'no_release' : 'http_error', `Releases API: HTTP ${x.statusCode}`); }
  return JSON.parse((await body(x, 4 * 1024 * 1024)).toString('utf8'));
}
export async function download(url, { apiUrl = DEFAULT_UPDATE_API, maxBytes = 1024 * 1024 * 1024, onBytes, timeoutMs = 120000 } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    if (!checkDownloadUrl(current, apiUrl, { redirect: hop > 0 }).ok) throw fail('bad_download_url', 'Asset URL is outside the release repository.');
    const x = await response(current, timeoutMs);
    if ([301, 302, 303, 307, 308].includes(x.statusCode) && x.headers.location) { x.resume(); current = new URL(x.headers.location, current).href; continue; }
    if (x.statusCode !== 200) { x.resume(); throw fail('http_error', `Asset download: HTTP ${x.statusCode}`); }
    return body(x, maxBytes, onBytes);
  }
  throw fail('redirect_limit', 'Too many asset redirects.');
}

// Preflight the entire ZIP before invoking ditto. In particular, don't let a
// symlink escape the .app or route a subsequent write outside the destination.
export function inspectZip(buf, { maxBytes = 3 * 1024 ** 3, maxEntries = 100000 } = {}) {
  const bad = () => { throw fail('bad_archive', 'Unsafe or unsupported macOS ZIP.'); };
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { end = i; break; }
  if (end < 0 || buf.readUInt16LE(end + 4) || buf.readUInt16LE(end + 6)) bad();
  const count = buf.readUInt16LE(end + 10), size = buf.readUInt32LE(end + 12), start = buf.readUInt32LE(end + 16);
  if (!count || count === 65535 || count > maxEntries || start + size !== end || buf.readUInt16LE(end + 8) !== count) bad();
  // ditto's ZIPs use Unix timestamp extras. Reject alternate path/link
  // encodings that could disagree with the central directory we inspected.
  const checkExtras = (offset, length) => {
    const limit = offset + length;
    while (offset < limit) {
      if (offset + 4 > limit) bad();
      const id = buf.readUInt16LE(offset), n = buf.readUInt16LE(offset + 2);
      if (offset + 4 + n > limit || ![0x5855, 0x5455, 0x7875].includes(id) || n > 32) bad();
      if (id === 0x5855 && ![8, 12].includes(n)) bad();
      offset += 4 + n;
    }
  };
  let off = start, total = 0; const entries = [], names = new Set(), links = new Map();
  for (let i = 0; i < count; i++) {
    if (off + 46 > end || buf.readUInt32LE(off) !== 0x02014b50) bad();
    const flags = buf.readUInt16LE(off + 8), method = buf.readUInt16LE(off + 10), compressed = buf.readUInt32LE(off + 20), bytes = buf.readUInt32LE(off + 24), len = buf.readUInt16LE(off + 28), extra = buf.readUInt16LE(off + 30), comment = buf.readUInt16LE(off + 32), local = buf.readUInt32LE(off + 42);
    if (off + 46 + len + extra + comment > end || local + 30 > start || flags & 1 || ![0, 8].includes(method) || buf.readUInt32LE(local) !== 0x04034b50) bad();
    const name = buf.subarray(off + 46, off + 46 + len).toString('utf8'), parts = name.replace(/\/$/, '').split('/');
    if (!name || name.includes('\ufffd') || /[\\\x00-\x1f\x7f:]/.test(name) || parts.some(p => !p || p === '.' || p === '..') || !['Atrium.app', '__MACOSX'].includes(parts[0])) bad();
    const key = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (names.has(key)) bad(); names.add(key);
    const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (data + compressed > start || buf.readUInt16LE(local + 6) !== flags || buf.readUInt16LE(local + 8) !== method || buf.subarray(local + 30, local + 30 + buf.readUInt16LE(local + 26)).toString('utf8') !== name) bad();
    checkExtras(off + 46 + len, extra);
    checkExtras(local + 30 + buf.readUInt16LE(local + 26), buf.readUInt16LE(local + 28));
    total += bytes; if (total > maxBytes || bytes > 1024 ** 3) bad();
    const mode = buf.readUInt32LE(off + 38) >>> 16, type = mode & 0xf000;
    if ((mode & 0o7000) || (type && ![0x8000, 0x4000, 0xa000].includes(type))) bad();
    if (type === 0xa000) {
      if (bytes > 4096 || parts[0] !== 'Atrium.app') bad();
      const target = (method === 8 ? zlib.inflateRawSync(buf.subarray(data, data + compressed), { maxOutputLength: 4096 }) : buf.subarray(data, data + compressed)).toString('utf8');
      if (!target || target.startsWith('/') || /[\\\x00-\x1f:]/.test(target)) bad();
      links.set(name.normalize('NFC').toLowerCase(), target);
    }
    entries.push(name); off += 46 + len + extra + comment;
  }
  if (off !== end || !entries.some(n => n.startsWith('Atrium.app/Contents/'))) bad();
  const expand = name => {
    const queue = name.split('/'), resolved = []; let hops = 0;
    while (queue.length) {
      const part = queue.shift();
      if (!part || part === '.') continue;
      if (part === '..') { if (resolved.length < 2) bad(); resolved.pop(); continue; }
      resolved.push(part);
      if (resolved[0] !== 'Atrium.app') bad();
      const prefix = resolved.join('/').normalize('NFC').toLowerCase();
      if (links.has(prefix)) {
        if (++hops > 40) bad();
        resolved.pop(); queue.unshift(...links.get(prefix).split('/'));
      }
    }
  };
  for (const name of entries.filter(n => n.startsWith('Atrium.app/'))) expand(name.replace(/\/$/, ''));
  return { entries: entries.length, bytes: total };
}
export function extractZip(archive, dir, { exec = execFileSync } = {}) {
  inspectZip(fs.readFileSync(archive));
  exec('/usr/bin/ditto', ['-x', '-k', archive, dir], { timeout: 120000, stdio: 'pipe' });
  return path.join(dir, 'Atrium.app');
}
export function bundleOfRoot(root) {
  const resolved = path.resolve(root), suffix = `${path.sep}Contents${path.sep}Resources`;
  if (!resolved.endsWith(suffix)) return null;
  const bundle = resolved.slice(0, -suffix.length);
  return bundle.endsWith('.app') ? bundle : null;
}
export const resourcesOf = bundle => path.join(bundle, 'Contents/Resources');
export function versionOfRoot(root) {
  for (const f of ['app/package.json', 'backend/package.json']) { try { const v = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).version; if (parseVersion(v)) return v; } catch {} }
  return null;
}
export function runningVersion(root) {
  const bundle = bundleOfRoot(root), version = versionOfRoot(root);
  return { version, tag: version ? `v${version}` : null, installed: !!bundle, bundle, root: path.resolve(root) };
}
// Only this explicit, isolated dev fixture may exercise a native update using
// loopback release metadata. Merely setting UPDATE_API never enables it.
export function isolatedUpdateTest(cfg, env = process.env, running = {}) {
  if (envValue('UPDATE_TEST', env) !== '1' || cfg.profile !== 'dev' || envValue('PROFILE', env) !== 'dev' || !/^atrium-dev-update-/.test(cfg.herdrSession || '') || [47800, 47811].includes(cfg.port)) return false;
  const root = envValue('UPDATE_TEST_ROOT', env);
  if (!root || !path.isAbsolute(root) || !path.basename(root).startsWith('atrium-update-e2e-')) return false;
  try {
    const tempRoots = [...new Set([fs.realpathSync(os.tmpdir()), fs.realpathSync('/tmp')])];
    if (!samePath(root, fs.realpathSync(root)) || !tempRoots.some(base => root.startsWith(base + path.sep))) return false;
    const locations = [running.bundle, cfg.dataDir, envValue('DATA_DIR', env), envValue('APP_USERDATA', env), env.HOME];
    return locations.every(p => p && path.resolve(p).startsWith(root + path.sep)) && samePath(cfg.dataDir, envValue('DATA_DIR', env));
  } catch { return false; }
}
export function installAllowed(cfg, dir, { running, platform = process.platform, env = process.env } = {}) {
  if (platform !== 'darwin') return { ok: false, reason: 'macos_only', message: 'Install the macOS release on a Mac.' };
  if (!running?.bundle) return { ok: false, reason: 'source_install', message: 'Source checkouts support release checks. Download the packaged macOS ZIP or DMG from Releases and move Atrium.app to Applications.' };
  if (cfg.profile === 'dev' && !isolatedUpdateTest(cfg, env, running)) return { ok: false, reason: 'dev_profile', message: 'Use the installed app’s real board to update.' };
  if (/\/AppTranslocation\/|^\/Volumes\//.test(running.bundle)) return { ok: false, reason: 'move_to_applications', message: 'Move Atrium.app to Applications and reopen it before updating.' };
  try { if (!fs.lstatSync(running.bundle).isDirectory() || fs.lstatSync(running.bundle).isSymbolicLink() || !samePath(fs.realpathSync(running.bundle), running.bundle)) throw Error(); fs.accessSync(path.dirname(running.bundle), fs.constants.W_OK); }
  catch { return { ok: false, reason: 'bundle_not_writable', message: 'Move Atrium.app to a writable Applications folder, then reopen it.' }; }
  if (samePath(dir, running.bundle) || path.resolve(dir).startsWith(running.bundle + path.sep) || path.resolve(cfg.dataDir).startsWith(running.bundle + path.sep)) return { ok: false, reason: 'data_in_bundle', message: 'The update and board data directories must be outside Atrium.app.' };
  return { ok: true };
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
  return value;
}
export function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
export const readResult = dir => readJson(path.join(dir, RESULT_FILE));
export const writeResult = (dir, result) => writeJson(path.join(dir, RESULT_FILE), result);

export async function prepareRelease({ dir, release, apiUrl = DEFAULT_UPDATE_API, arch = process.arch, protocol = null, step = () => {}, fetchBuf = download, extract = extractZip, verify, currentBundle = null }) {
  const { asset, checksums } = selectAsset(release, arch);
  if (!checkDownloadUrl(asset.url, apiUrl).ok || !checkDownloadUrl(checksums.url, apiUrl).ok) throw fail('bad_download_url', 'Release asset URL is outside the repository.');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(dir, '.prepare-'));
  try {
    step('download');
    const sums = await fetchBuf(checksums.url, { apiUrl, maxBytes: 128 * 1024 });
    const digest = checksumFor(sums.toString('utf8'), asset.name);
    if (asset.digest && asset.digest !== `sha256:${digest}`) throw fail('bad_checksum', 'GitHub asset digest and SHA256SUMS.txt disagree.');
    let lastBytes = 0, lastProgress = 0;
    const zip = await fetchBuf(asset.url, { apiUrl, onBytes: bytes => { const now = Date.now(); if (bytes - lastBytes >= 1024 * 1024 || now - lastProgress >= 250) { lastBytes = bytes; lastProgress = now; step('download', { bytes }); } } });
    step('checksum', { bytes: zip.length });
    if ((Number.isFinite(asset.size) && asset.size !== zip.length) || crypto.createHash('sha256').update(zip).digest('hex') !== digest) throw fail('bad_checksum', 'Release ZIP failed SHA256 verification. Nothing was installed.');
    const archive = path.join(staging, asset.name); fs.writeFileSync(archive, zip, { mode: 0o600 });
    // Always preflight, including when tests inject the extractor.
    inspectZip(zip); step('extract');
    const bundle = await extract(archive, path.join(staging, 'extracted'));
    step('verify');
    const verifyBundle = verify || (await import('./update-verify.mjs')).verifyBundle;
    const result = await verifyBundle(bundle, { version: release.version, arch, protocol, currentBundle });
    if (!result.ok) throw fail('bundle_verification_failed', result.problems.join('; '));
    fs.rmSync(archive); step('ready');
    return { bundle, root: resourcesOf(bundle), staging, verification: result.info, digest, asset: asset.name };
  } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); throw e; }
}
