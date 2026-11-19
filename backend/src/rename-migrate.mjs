// P18 이름 옮기기: multitask → Atrium. 실제 판 프로필에서 백엔드가 뜰 때 한 번(옮길 옛 판은 config.mjs legacyOf가 정한다).
// 1) 판 기록(데이터 폴더): 새 폴더에 board.db가 없고 옛 폴더에 있으면 옮긴다.
//    - 옛 백엔드가 돌면 backend.shutdown으로 끈다. 끄지 못하면 옮기지 않고 LegacyBlocked를 던진다(백엔드가 뜨지 않고 다음에 다시 해 본다).
//    - 옛 백엔드를 끄자마자 옛 backend.json을 이 프로세스(새 백엔드)의 pid로 덮는다. 열린 옛 창이 옛 백엔드를 다시 띄워도 "이미 돈다"로 바로 끝난다.
//    - 폴더를 통째로 이름 바꾼다. 안 되면(새 폴더가 이미 있다: 창과 CLI가 백엔드를 띄우며 logs를 먼저 만든다, 파일이 잡혀 있다) 항목마다 옮기고, 그것도 안 되면 복사한다.
//      판 기록(board.db와 -wal, -shm)을 먼저 옮기고, 이것이 실패하면 옮긴 것을 되돌리고 LegacyBlocked를 던진다.
//    - 옛 폴더에는 옮겼다는 표시 파일(MOVED-TO-ATRIUM.json)과 새 백엔드를 가리키는 backend.json을 둔다. 다시 켜도 두 번 옮기지 않는다.
//    - 기록 속 경로(세션 설정 파일, 플러그인 폴더, 이어 가기 인자)는 Backend.start가 store를 연 뒤 fixLegacyRecords로 고친다.
// 2) 터미널: P129에서 옛 터미널 세션 옮기기를 뺐다. 옮긴 판의 세션은 옛 판 옮기기(herdr-migrate)와 J1 되살리기가 새 터미널 서버에서 같은 대화로 이어 간다.
// 창 프로필은 Electron main이 옮긴다(app/src/main/main.mjs migrateAppProfile).
import fs from 'node:fs';
import { resolvePath, windowsPath } from './platform.mjs';
import path from 'node:path';
import { backendInfo, health, ApiClient } from './client.mjs';
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from './launch.mjs';

export const MARKER = 'MOVED-TO-ATRIUM.json';
const DB_FILES = ['board.db', 'board.db-wal', 'board.db-shm'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LegacyBlocked extends Error { constructor(code, message) { super(message); this.code = code; } }

export function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// 옛 백엔드를 끈다 → { running: false } | { stopped: true, pid } | { stopped: false, pid, error }
export async function shutdownLegacyBackend(legacyDataDir, { waitMs = 15000 } = {}) {
  const lcfg = { backendFile: path.join(legacyDataDir, 'backend.json') };
  const info = backendInfo(lcfg);
  if (!info || !info.pid || info.pid === process.pid || !pidAlive(info.pid)) return { running: false };
  let error = null;
  try {
    if (!(await health(info.port))) throw new Error(`옛 백엔드(pid ${info.pid})가 포트 ${info.port}에서 응답하지 않습니다.`);
    const c = new ApiClient(info); await c.open();
    await c.call('backend.shutdown').catch(() => {}); // 끄면서 연결이 끊길 수 있다
    try { c.close(); } catch {}
  } catch (e) { error = e.message; }
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) { if (!pidAlive(info.pid)) return { stopped: true, pid: info.pid, ms: Date.now() - t0 }; await sleep(200); }
  return { stopped: false, pid: info.pid, error: error || `옛 백엔드(pid ${info.pid})가 ${waitMs / 1000}초 안에 종료되지 않았습니다.` };
}

// 옛 폴더에서 새 폴더로 옮긴다. rename(a, b)는 시험이 실패를 흉내 내려고 바꾼다. → { method: 'rename'|'merge', moved, copied: [], failed: [], leftover }
export function moveDataDir(src, dst, { rename = fs.renameSync, retries = 5 } = {}) {
  const r = { method: 'rename', moved: 0, copied: [], failed: [], leftover: false };
  if (!fs.existsSync(dst)) {
    for (let i = 0; i < retries; i++) {
      try { rename(src, dst); r.moved = 1; return r; } catch (e) { r.renameError = e.code || e.message; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); // 잠깐 잡힌 파일(옛 창이 막 띄운 옛 백엔드의 로그)을 기다린다
    }
  }
  r.method = 'merge';
  fs.mkdirSync(dst, { recursive: true });
  // 판 기록부터. 하나라도 옮기지 못하면 되돌리고 멈춘다(옛 판을 그대로 둔다)
  const done = [];
  for (const f of DB_FILES) {
    const a = path.join(src, f);
    if (!fs.existsSync(a)) continue;
    const b = path.join(dst, f);
    try {
      if (fs.existsSync(b)) throw new Error(`새 폴더에 ${f} 파일이 이미 있습니다.`);
      try { rename(a, b); done.push([a, b, 'moved']); r.moved++; }
      catch { fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL); done.push([a, b, 'copied']); r.copied.push(f); }
    } catch (e) {
      for (const [x, y, how] of done.reverse()) { try { if (how === 'moved') rename(y, x); else fs.rmSync(y, { force: true }); } catch {} }
      throw new LegacyBlocked('data_move_failed', `보드 기록(${f})을 이전하지 못했습니다: ${e.message}`);
    }
  }
  mergeInto(src, dst, '', r, rename);
  r.leftover = fs.existsSync(src) && !removeEmptyDirs(src);
  return r;
}
function mergeInto(src, dst, rel, r, rename) {
  for (const name of fs.readdirSync(src)) {
    const a = path.join(src, name), b = path.join(dst, name), relName = rel ? `${rel}/${name}` : name;
    if (!rel && DB_FILES.includes(name) && r.copied.includes(name)) continue; // 판 기록은 이미 복사했다(원본은 옛 폴더에 남긴다)
    const st = fs.lstatSync(a);
    if (st.isDirectory() && fs.existsSync(b) && fs.statSync(b).isDirectory()) { mergeInto(a, b, relName, r, rename); continue; }
    const target = fs.existsSync(b) ? legacyName(b) : b; // 같은 이름(새 백엔드 로그 등)이 있으면 옛 것을 x.legacy.ext로
    try { rename(a, target); r.moved++; }
    catch {
      try { fs.cpSync(a, target, { recursive: true, errorOnExist: false, force: false }); r.copied.push(relName); }
      catch (e) { r.failed.push({ name: relName, error: e.code || e.message }); }
    }
  }
}
function legacyName(p) {
  const ext = path.extname(p); const base = p.slice(0, p.length - ext.length);
  let n = `${base}.legacy${ext}`, i = 2;
  while (fs.existsSync(n)) n = `${base}.legacy${i++}${ext}`;
  return n;
}
// 빈 폴더만 지운다(아래부터). 다 지웠으면 참
function removeEmptyDirs(dir) {
  let empty = true;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.lstatSync(p).isDirectory() && removeEmptyDirs(p)) continue;
    empty = false;
  }
  if (empty) { try { fs.rmdirSync(dir); } catch { return false; } }
  return empty;
}

// 기록 속 경로 고치기: 옛 데이터 폴더(역슬래시, 슬래시, JSON 안의 두 역슬래시 꼴, 대소문자 무시)를 새 폴더로, 옛 플러그인 폴더 이름을 새 이름으로
export function pathFixer(oldDir, newDir) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const o = resolvePath(oldDir), n = resolvePath(newDir);
  const forms = [
    [o.replace(/\//g, '\\\\'), n.replace(/\//g, '\\\\')],
    [o.replace(/\//g, '\\'), n.replace(/\//g, '\\')],
    [o, n],
  ];
  const seps = ['\\\\', '\\', '/'];
  const rules = forms.map(([a, b], i) => [new RegExp(`${esc(a)}(?=[\\\\/"']|$)`, windowsPath(oldDir) ? 'gi' : 'g'), b, seps[i]]);
  return (text) => {
    if (typeof text !== 'string' || !text) return text;
    let s = text;
    for (const [re, b, sep] of rules) {
      s = s.replace(re, () => b);
      // 새 폴더 아래 옛 플러그인 폴더(…/plugin/multitask-herdr) → 새 이름
      const old = `${b}${sep}plugin${sep}${LEGACY_PLUGIN_NAME}`;
      if (s.includes(old)) s = s.split(old).join(`${b}${sep}plugin${sep}${PLUGIN_NAME}`);
    }
    return s;
  };
}

// 1). Backend.start가 store를 열기 전에 부른다. cfg.legacy가 없으면 아무것도 하지 않는다. opts.shutdown, opts.rename은 시험이 바꾼다
// → null | { from, to, data: 'moved'|'already'|'none', move?, legacyBackend?, problems: [] }
export async function migrateLegacyData(cfg, { log = () => {}, shutdown = shutdownLegacyBackend, rename } = {}) {
  const lg = cfg.legacy;
  if (!lg) return null;
  const from = lg.dataDir, to = cfg.dataDir;
  if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return null;
  const res = { from, to, at: Date.now(), data: 'none', problems: [] };
  const marked = fs.existsSync(path.join(from, MARKER));
  const hasOld = fs.existsSync(path.join(from, 'board.db')) && !marked;
  if (fs.existsSync(cfg.dbFile)) res.data = 'already';
  else if (hasOld) {
    // 옛 백엔드를 끈다
    const sd = await shutdown(from);
    res.legacyBackend = sd;
    if (sd.stopped === false) { log(`rename: legacy backend still running: ${sd.error}`); throw new LegacyBlocked('legacy_backend_running', `이전 보드의 백엔드를 종료하지 못해 데이터를 이전하지 않았습니다. 다음에 다시 시도합니다: ${sd.error}`); }
    if (sd.stopped) log(`rename: legacy backend pid ${sd.pid} stopped`);
    writeTombstone(from, { pid: process.pid, port: cfg.port, token: '', movedTo: to });
    try { res.move = moveDataDir(from, to, rename ? { rename } : {}); }
    catch (e) { log(`rename: data move failed ${e.message}`); throw e; }
    res.data = 'moved';
    if (res.move.failed.length) res.problems.push(`옮기지 못한 파일 ${res.move.failed.length}개 (이전 폴더에 유지): ${res.move.failed.map((f) => f.name).slice(0, 5).join(', ')}`);
    fs.mkdirSync(from, { recursive: true });
    fs.writeFileSync(path.join(from, MARKER), JSON.stringify({ movedTo: to, at: res.at, method: res.move.method, copied: res.move.copied, failed: res.move.failed, note: "이 보드의 데이터를 Atrium으로 이전했습니다. 이 폴더에 남은 파일은 삭제해도 됩니다." }, null, 2));
    writeTombstone(from, { pid: process.pid, port: cfg.port, token: '', movedTo: to });
    log(`rename: data ${from} → ${to} ${JSON.stringify(res.move)}`);
  }
  return res;
}

// 옛 폴더의 backend.json: 이 프로세스(새 백엔드)를 가리킨다. 옛 백엔드는 pid가 살아 있으면 뜨지 않고, 열린 옛 창은 새 백엔드에 붙는다
export function writeTombstone(dir, info) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'backend.json'), JSON.stringify({ ...info, startedAt: Date.now(), profile: 'real', legacyTombstone: true }, null, 2)); } catch {}
}

// Backend.start가 store를 연 뒤: 기록 속 경로와 세션 설정 파일을 새 폴더로 고친다.
// → { sessions: 고친 행, settingsFiles: 고친 파일 }
export function fixLegacyRecords(store, cfg, mig) {
  const out = { sessions: 0, settingsFiles: 0 };
  if (!mig) return out;
  if (mig.data === 'moved') {
    const fix = pathFixer(mig.from, mig.to);
    out.sessions = store.rewriteSessionText(fix);
    for (const name of fs.existsSync(cfg.sessionsDir) ? fs.readdirSync(cfg.sessionsDir) : []) {
      if (!name.endsWith('.json')) continue;
      const f = path.join(cfg.sessionsDir, name);
      try { const t = fs.readFileSync(f, 'utf8'); const u = fix(t); if (u !== t) { fs.writeFileSync(f, u); out.settingsFiles++; } } catch {}
    }
    store.setMeta('renamedFrom', { from: mig.from, at: mig.at, method: mig.move && mig.move.method });
  }
  return out;
}
