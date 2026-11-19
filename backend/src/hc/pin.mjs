// P114: 판이 쓰는 herdr-core(hc)를 버전과 SHA-256으로 고정해 판 폴더에 받는다. macOS 판: <데이터 폴더>/hc/bin/herdr-core(단독 실행 파일, Developer ID 서명 그대로)와 hc 링크.
// macOS 앱 번들은 고정 tar.gz를 자료로 싣는다(Resources/.tools/hc). 있으면 받지 않고 그것을 SHA-256·서명 확인 뒤 푼다.
// - PATH·레지스트리·설치 스크립트(install.ps1)는 쓰지 않는다. install.ps1은 사용자 PATH(HKCU\Environment)에 폴더를 더한다(P114 1단계)
// - 자리: <판 데이터 폴더>\hc\bin\(herdr-core.exe, hc.exe, conpty\conpty.dll, conpty\x64\OpenConsole.exe, VERSION). 경로는 버전과 상관없이 같다:
//   hc update는 도는 실행 파일 자리를 바꾸고 코어만 다시 띄운다(터미널은 산다). 그래서 버전을 올릴 때는 새 빌드를 staging에 받은 뒤
//   `hc update --from <staging>\herdr-core.exe`를 bin의 hc로 부른다(core.mjs upgradeCore). 코어가 꺼져 있으면 파일을 바로 바꾼다
// - 받은 zip은 manifest를 믿지 않고 여기 적은 SHA-256과 맞춘다. 풀기는 Windows의 tar.exe(System32, zip을 연다)
// - ATRIUM_HC로 실행 파일을 주면 받지 않고 그것을 쓴다(개발·시험)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const WIN_PIN = {
  version: '0.1.20',
  generation: 1,
  target: 'windows-x86_64',
  url: 'https://releases.herdr.dev/core/0.1.20/herdr-core-windows-x86_64.zip',
  sha256: '13b29c61a9932ea028c36ccc419bcf3ec679f2fd6c528f93c8fbd1d7331ee20b',
  // herdr-core.exe의 Authenticode 서명자(P114 1단계: CN=herdr, 유효). 릴리스 검사가 본다
  signer: 'CN=herdr',
};
// macOS: 공식 tar.gz(herdr-core 단독 실행 파일 + Herdr Core.app). 판은 단독 실행 파일만 쓴다(번들 설치는 ~/.local/share를 건드린다).
// 단독 실행 파일은 Developer ID(Herdr, Inc., 팀 2W9652Q7QR)로 서명·공증되어 있다. 판은 다시 서명하지 않는다(서명이 바뀌면 개인정보 보호 권한의 주인이 바뀐다)
const MAC_PINS = {
  arm64: { version: '0.1.20', generation: 1, target: 'macos-aarch64', url: 'https://releases.herdr.dev/core/0.1.20/herdr-core-macos-aarch64.tar.gz', sha256: 'e58985d3fef6e909f33d3c5a4426e4898c81564a557d4636591cec9e3a06af26', signer: 'TeamIdentifier=2W9652Q7QR', identifier: 'dev.herdr.core' },
  x64: { version: '0.1.20', generation: 1, target: 'macos-x86_64', url: 'https://releases.herdr.dev/core/0.1.20/herdr-core-macos-x86_64.tar.gz', sha256: '36c0331c3ffea0ffaada195b89a3c7496f7f3fc5bf35e4605c19c84e5c205a56', signer: 'TeamIdentifier=2W9652Q7QR', identifier: 'dev.herdr.core' },
};
export const pinFor = (platform = process.platform, arch = process.arch) => Object.freeze(platform === 'darwin' ? MAC_PINS[arch] || MAC_PINS.arm64 : WIN_PIN);
export const HC_PIN = pinFor();
export const MAC_HC_PINS = Object.freeze({ arm64: Object.freeze(MAC_PINS.arm64), x64: Object.freeze(MAC_PINS.x64) });
const WIN = process.platform === 'win32';
export const HC_FILES = WIN ? ['herdr-core.exe', path.join('conpty', 'conpty.dll'), path.join('conpty', 'x64', 'OpenConsole.exe')] : ['herdr-core'];

export const hcRoot = (dataDir) => path.join(dataDir, 'hc');
const HC_ALIAS = WIN ? 'hc.exe' : 'hc';
export const hcBinDir = (dataDir) => path.join(hcRoot(dataDir), 'bin');
export const hcExeIn = (dir) => path.join(dir, WIN ? 'herdr-core.exe' : 'herdr-core');

const run = (file, args, opts = {}) => new Promise((res) => execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, ...opts }, (err, so, se) => res({ code: err ? (err.code ?? 1) : 0, out: String(so || '').trim(), err: String(se || '').trim() })));

// `hc --version`의 출력("hc 0.1.20") → '0.1.20'
export const parseHcVersion = (s) => { const m = String(s || '').match(/^hc\s+v?(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)/m); return m ? m[1] : null; };
export async function hcVersionOf(exe) { const r = await run(exe, ['--version'], { timeout: 10000 }); return r.code === 0 ? parseHcVersion(r.out) : null; }

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// 폴더에 hc가 다 있는가(실행 파일과 ConPTY 두 파일)
export const hasHcFiles = (dir) => HC_FILES.every((f) => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } });

// P117: 네트워크 오류(오프라인, 이름 풀기 실패)도 download_failed로(판의 띠가 "받지 못함"을 보인다)
async function download(url, file, fetchImpl = globalThis.fetch) {
  let r;
  try { r = await fetchImpl(url, { redirect: 'follow' }); }
  catch (e) { throw Object.assign(new Error(`download failed: ${(e.cause && (e.cause.code || e.cause.message)) || e.message} ${url}`), { code: 'download_failed' }); }
  if (!r.ok) throw Object.assign(new Error(`download failed: HTTP ${r.status} ${url}`), { code: 'download_failed' });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
// P117: 앱 업데이트가 새 버전의 고정 hc를 미리 받아 두는 곳(<데이터>\hc\cache\<버전>-<sha 앞 8자>). 검증한 뒤 푼 폴더다. ensureHc가 받기 전에 먼저 본다
export const hcCacheDir = (dataDir, pin = HC_PIN) => path.join(hcRoot(dataDir), 'cache', `${pin.version}-${pin.sha256.slice(0, 8)}`);
export async function prefetchHc({ dataDir, pin = HC_PIN, fetchImpl, log = () => {} }) {
  const dir = hcCacheDir(dataDir, pin);
  if (hasHcFiles(dir) && (await hcVersionOf(hcExeIn(dir))) === pin.version) return { dir, version: pin.version, cached: true };
  const st = await stageHc({ dataDir, pin, fetchImpl, log });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.renameSync(st.dir, dir);
  fs.rmSync(st.staging, { recursive: true, force: true });
  // 다른 버전의 미리 받은 것은 지운다(하나만 둔다)
  for (const n of fs.readdirSync(path.dirname(dir))) if (path.join(path.dirname(dir), n) !== dir) fs.rmSync(path.join(path.dirname(dir), n), { recursive: true, force: true });
  log(`hc ${pin.version} prefetched at ${dir}`);
  return { dir, version: pin.version, cached: false };
}
// 미리 받은 것이 있으면 staging 모양으로 돌려준다(없으면 null)
async function fromCache(dataDir, pin) {
  const dir = hcCacheDir(dataDir, pin);
  if (!hasHcFiles(dir) || (await hcVersionOf(hcExeIn(dir))) !== pin.version) return null;
  const staging = path.join(hcRoot(dataDir), `staging-${pin.version}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(staging, { recursive: true });
  fs.renameSync(dir, path.join(staging, 'x'));
  return { dir: path.join(staging, 'x'), staging, version: pin.version, cached: true };
}
function extract(zip, dir) {
  if (!WIN) return run('/usr/bin/tar', ['-xzf', zip, '-C', dir, 'herdr-core', 'LICENSE'], { timeout: 120000 }); // macOS: 단독 실행 파일과 사용권만 푼다(Herdr Core.app은 쓰지 않는다)
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); // Git Bash의 tar는 zip을 못 연다
  return run(tar, ['-xf', zip, '-C', dir], { timeout: 120000 });
}
// macOS: 푼 실행 파일이 고정한 팀·식별자로 서명된 그대로인가(codesign). 맞지 않으면 쓰지 않는다
export async function codesignOf(exe) {
  const v = await run('/usr/bin/codesign', ['--verify', '--strict', exe], { timeout: 60000 });
  const d = await run('/usr/bin/codesign', ['-dv', '--verbose=2', exe], { timeout: 30000 });
  const text = `${d.out}\n${d.err}`;
  const team = (/^TeamIdentifier=(.+)$/m.exec(text) || [])[1] || null;
  const id = (/^Identifier=(.+)$/m.exec(text) || [])[1] || null;
  return { status: v.code === 0 ? 'Valid' : 'Invalid', subject: [team ? `TeamIdentifier=${team}` : null, id ? `Identifier=${id}` : null].filter(Boolean).join(', ') || null };
}
async function checkSigned(exe, pin) {
  if (WIN) return;
  const s = await codesignOf(exe);
  const parts = String(s.subject || '').split(',').map((x) => x.trim());
  if (s.status !== 'Valid' || !parts.includes(pin.signer) || (pin.identifier && !parts.includes(`Identifier=${pin.identifier}`))) throw Object.assign(new Error(`hc ${pin.version}: signature check failed (${s.status} ${s.subject || 'unsigned'})`), { code: 'bad_signature' });
}
// bin 옆에 hc.exe 이름을 둔다(터미널 안 에이전트가 치는 `hc`). 하드링크, 안 되면 복사
function linkHcName(dir) {
  if (!WIN) { const alias = path.join(dir, 'hc'); try { fs.rmSync(alias, { force: true }); } catch {} fs.symlinkSync('herdr-core', alias); return; } // macOS: 같은 폴더의 상대 링크(서명한 파일은 그대로)
  const exe = hcExeIn(dir), alias = path.join(dir, 'hc.exe');
  try { fs.rmSync(alias, { force: true }); } catch {}
  try { fs.linkSync(exe, alias); } catch { fs.copyFileSync(exe, alias); }
}

// 고정한 빌드를 staging 폴더에 받아 검증하고 푼다 → { dir, version }. 실패하면 던지고 staging을 지운다
export async function stageHc({ dataDir, pin = HC_PIN, fetchImpl, bundled = null, log = () => {} }) {
  const staging = path.join(hcRoot(dataDir), `staging-${pin.version}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    const zip = path.join(staging, WIN ? 'hc.zip' : 'hc.tar.gz');
    // macOS: 앱 번들에 든 고정 tar.gz가 있으면 그것을 쓴다(받지 않는다). 아래에서 SHA-256을 똑같이 맞춘다
    if (bundled && fs.existsSync(bundled)) { log(`hc ${pin.version}: using bundled ${bundled}`); fs.copyFileSync(bundled, zip); }
    else { log(`hc ${pin.version}: downloading ${pin.url}`); await download(pin.url, zip, fetchImpl); }
    const got = await sha256File(zip);
    if (got !== pin.sha256) throw Object.assign(new Error(`hc ${pin.version}: SHA-256 mismatch (got ${got})`), { code: 'checksum_mismatch' });
    const out = path.join(staging, 'x');
    fs.mkdirSync(out);
    const x = await extract(zip, out);
    if (x.code !== 0 || !hasHcFiles(out)) throw Object.assign(new Error(`hc ${pin.version}: archive does not hold a complete hc (${x.err || x.code})`), { code: 'bad_archive' });
    await checkSigned(hcExeIn(out), pin);
    const v = await hcVersionOf(hcExeIn(out));
    if (v !== pin.version) throw Object.assign(new Error(`hc ${pin.version}: unpacked build reports ${v}`), { code: 'bad_version' });
    fs.rmSync(zip, { force: true });
    return { dir: out, staging, version: v };
  } catch (e) { fs.rmSync(staging, { recursive: true, force: true }); throw e; }
}

// 판의 hc를 준비한다 → { exe, dir, version, source: 'env'|'installed'|'fetched'|'pending', pending? }
// - 이미 bin에 고정 버전이 있으면 그대로(받지 않는다)
// - 없으면 받아서 bin에 둔다
// - bin에 다른 버전이 있고 코어가 그 파일로 돌면(coreRunning) 바꾸지 않고 pending(staging 폴더)을 돌려준다. 바꾸기는 upgradeCore가 한다
export async function ensureHc({ dataDir, pin = HC_PIN, envExe = null, coreRunning = false, fetchImpl, bundled = null, log = () => {} }) {
  if (envExe) {
    const v = await hcVersionOf(envExe);
    if (!v) throw Object.assign(new Error(`ATRIUM_HC is not a working hc: ${envExe}`), { code: 'not_found' });
    return { exe: envExe, dir: path.dirname(envExe), version: v, source: 'env' };
  }
  const bin = hcBinDir(dataDir);
  let current = null;
  if (hasHcFiles(bin)) current = (fs.existsSync(path.join(bin, 'VERSION')) ? fs.readFileSync(path.join(bin, 'VERSION'), 'utf8').trim() : null) || (await hcVersionOf(hcExeIn(bin)));
  if (current === pin.version) { if (!fs.existsSync(path.join(bin, HC_ALIAS))) linkHcName(bin); return { exe: hcExeIn(bin), dir: bin, version: current, source: 'installed' }; }
  let st = await fromCache(dataDir, pin).catch(() => null); // P117: 앱 업데이트가 미리 받아 둔 것
  if (!st) {
    try { st = await stageHc({ dataDir, pin, fetchImpl, bundled, log }); }
    catch (e) {
      // P117: 새 고정 버전을 받지 못했다(오프라인 등). 전에 놓인 hc가 온전하면 그것으로 돈다(판은 검증하지 않은 버전으로 경고하고, 다음에 뜰 때 다시 받는다)
      if (current && hasHcFiles(bin)) { log(`hc ${pin.version} not available (${e.code || e.message}); running ${current} from ${bin}`); if (!fs.existsSync(path.join(bin, HC_ALIAS))) linkHcName(bin); return { exe: hcExeIn(bin), dir: bin, version: current, source: 'stale', error: e.message }; }
      throw e;
    }
  }
  if (current && coreRunning) { log(`hc ${current} is running from ${bin}; ${pin.version} staged at ${st.dir}`); return { exe: hcExeIn(bin), dir: bin, version: current, source: 'pending', pending: st }; }
  // 코어가 쓰지 않는 bin: 옛 것을 비키고 새 것을 놓는다
  if (fs.existsSync(bin)) { const old = path.join(hcRoot(dataDir), `old-${Date.now()}`); fs.renameSync(bin, old); fs.rmSync(old, { recursive: true, force: true }); }
  fs.renameSync(st.dir, bin);
  fs.rmSync(st.staging, { recursive: true, force: true });
  fs.writeFileSync(path.join(bin, 'VERSION'), pin.version + '\n');
  linkHcName(bin);
  log(`hc ${pin.version} installed at ${bin}`);
  return { exe: hcExeIn(bin), dir: bin, version: pin.version, source: 'fetched' };
}

// ---------- P117: 릴리스 검사(scripts/release-check.mjs) ----------
// 실행 파일의 Authenticode 서명(Windows PowerShell). → { status: 'Valid' 등, subject: 'CN=herdr, …' } | null
export async function authenticodeOf(exe) {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${String(exe).replace(/'/g, "''")}'; Write-Output ("{0}|{1}" -f $s.Status, $s.SignerCertificate.Subject)`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000 });
  if (r.code !== 0 || !r.out) return null;
  const [status, subject] = r.out.split(/\r?\n/).pop().trim().split('|');
  return { status: status || null, subject: subject || null };
}
// 고정 hc가 맞는지(순수 함수): 받은 zip의 SHA-256, 푼 빌드의 버전, 서명 상태와 서명자(CN)
export function checkHcPin({ pin = HC_PIN, sha256 = null, version = null, signature = null }) {
  const problems = [];
  if (sha256 !== pin.sha256) problems.push(`고정 hc zip의 SHA-256이 다릅니다: ${sha256 || '없음'} (고정 ${pin.sha256})`);
  if (version !== pin.version) problems.push(`고정 hc 빌드의 버전이 다릅니다: ${version || '없음'} (고정 ${pin.version})`);
  if (!signature || signature.status !== 'Valid') problems.push(`herdr-core의 서명이 유효하지 않습니다: ${signature ? signature.status : '읽지 못함'}`);
  else if (!String(signature.subject || '').split(',').map((x) => x.trim()).includes(pin.signer)) problems.push(`herdr-core의 서명자가 ${pin.signer}가 아닙니다: ${signature.subject || '없음'}`);
  return problems;
}
// 고정 주소에서 받아(임시 폴더) 확인하고 지운다 → { problems, sha256, version, signature }
export async function verifyPinnedHc({ pin = HC_PIN, tmpRoot, fetchImpl, signatureOf = WIN ? authenticodeOf : codesignOf, log = () => {} }) {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'atrium-hc-check-'));
  try {
    const zip = path.join(root, WIN ? 'hc.zip' : 'hc.tar.gz');
    let sha256 = null, version = null, signature = null;
    try { await download(pin.url, zip, fetchImpl); sha256 = await sha256File(zip); }
    catch (e) { return { problems: [`고정 hc를 받지 못했습니다: ${e.message}`], sha256, version, signature }; }
    if (sha256 === pin.sha256) {
      const out = path.join(root, 'x'); fs.mkdirSync(out);
      const x = await extract(zip, out);
      if (x.code === 0 && hasHcFiles(out)) { version = await hcVersionOf(hcExeIn(out)); signature = await signatureOf(hcExeIn(out)); }
      else return { problems: [`고정 hc zip에 hc가 다 들어 있지 않습니다(${x.err || x.code})`], sha256, version, signature };
    }
    log(`hc ${pin.version}: sha256 ${sha256}, version ${version}, signature ${signature && signature.status} ${signature && signature.subject}`);
    return { problems: checkHcPin({ pin, sha256, version, signature }), sha256, version, signature };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
