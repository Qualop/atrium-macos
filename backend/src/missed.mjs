// 판 밖 대화의 분류와 missed 지우기(P13, BRIEF "판 밖 대화", ARCH 5절 "판 밖 대화 노드·missed").
// - 분류(classifyConvo, 순수 함수): 판에 올림(board), 보관(archived), missed(지울 대화), 도는 시험 대화(live), 데스크톱(desktop), 판 세션(boardSession), 그 밖.
//   missed는 보관(오래돼서 접어 둔 것)과 다르다. 폴더가 없어졌거나 이 앱의 시험 폴더에서 한 CLI·SDK 대화이고, 사용자가 처음부터 지울 것이라 부른 이름 그대로다.
// - 지우기(trashPlan은 순수 함수, trashPaths는 PowerShell): 대화 기록 <대화 ID>.jsonl과 옆의 <대화 ID>/ 폴더만 Windows 휴지통으로 보낸다(바로 지우지 않는다).
//   대화 기록 폴더 뿌리(ATRIUM_CLAUDE_PROJECTS) 밖, 이름이 UUID가 아닌 파일, 지우는 순간 도는 대화·묶인 대화·데스크톱 대화는 거부한다.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pathKey } from './workspaces.mjs';

export const TEST_PREFIX = 'mtask-'; // 이 이름으로 시작하는 폴더(경로의 어느 마디든)는 이 앱의 시험 폴더다(C:\Workspace\mtask-p10-cli 등)
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const under = (k, root) => !!root && (k === root || k.startsWith(root + '/'));
// 판 코드 저장소(와 그 워크트리)의 시험 폴더: backend/.dev, experiments 아래
const CODE_TEST = /^(?:\/\.claude\/worktrees\/[^/]+)?\/(?:backend\/\.dev|experiments)(?:\/|$)/;

// 이 앱의 시험 폴더인가 → 'code' | 'tmp' | 'prefix' | null. codeRoots: 판 코드 저장소 폴더들(본 저장소와 이 워크트리), tmp: OS 임시 폴더
export function testDirKind(cwd, { codeRoots = [], tmp = null, prefix = TEST_PREFIX } = {}) {
  const k = pathKey(cwd);
  if (!k) return null;
  for (const r of codeRoots) { const rk = pathKey(r); if (rk && under(k, rk) && CODE_TEST.test(k.slice(rk.length))) return 'code'; }
  if (tmp && under(k, pathKey(tmp))) return 'tmp';
  const pf = String(prefix || '').toLowerCase();
  if (pf && k.split('/').slice(1).some((seg) => seg.startsWith(pf))) return 'prefix';
  return null;
}

const isDesktop = (eps) => (eps || []).some((e) => /desktop/i.test(e));
const isCliOrSdk = (eps) => (eps || []).some((e) => e === 'cli' || /^sdk/i.test(e));

// 대화 하나의 분류. row: 색인 줄(entrypoints, prompts, cwd), binding: convos.mjs bindingOf 결과, boardKnown: 판 세션(열림·닫힘)이 아는 대화인가,
// archived: archive.mjs archiveState().archived, exists: cwd가 남아 있나, testDir: testDirKind 결과
// → { cls, why? }. cls: board | archived | missed | live | desktop | boardSession | sdk | noPrompt | other
//   live: 지금 도는데 폴더가 없거나 시험 폴더(missed가 되지 않고 캔버스에도 올리지 않는다)
export function classifyConvo({ row, binding = { bound: false }, boardKnown = false, archived = false, exists = true, testDir = null }) {
  const eps = row.entrypoints || [];
  if (!row.prompts) return { cls: 'noPrompt' };
  if (isDesktop(eps) || (binding.bound && binding.where === 'desktop')) return { cls: 'desktop' };
  if (boardKnown) return { cls: 'boardSession' };
  if (!isCliOrSdk(eps)) return { cls: 'other' };
  const gone = !row.cwd || !exists;
  if (gone || testDir) {
    if (binding.bound && binding.open) return { cls: 'live', why: gone ? 'gone' : testDir };
    return { cls: 'missed', why: gone ? 'gone' : testDir };
  }
  if (!eps.includes('cli')) return { cls: 'sdk' };
  if (archived) return { cls: 'archived' };
  return { cls: 'board' };
}

// 지울 계획(순수 함수). items: [{ convId, path, cwd?, cls, binding, boardKnown, desktop }] (부르는 쪽이 지우기 직전에 다시 판정한 값),
// roots: 대화 기록 폴더 뿌리들, dirExists(p): 옆 폴더가 있는가 → { ok: [{ convId, file, dir }], refused: [{ convId, reason }] }
export function trashPlan(items, { roots = [], dirExists = () => false } = {}) {
  const rootKeys = roots.map(pathKey).filter(Boolean);
  const ok = [], refused = [];
  for (const it of items) {
    const file = String(it.path || '');
    const k = pathKey(file);
    const base = file.split(/[\\/]/).pop() || '';
    const no = (reason) => refused.push({ convId: it.convId, reason });
    if (!path.isAbsolute(file) || k.split('/').includes('..')) { no('bad_path'); continue; }
    if (!rootKeys.some((r) => k.startsWith(r + '/'))) { no('outside_root'); continue; }
    if (!UUID_FILE.test(base) || !UUID.test(String(it.convId || '')) || base.slice(0, -6).toLowerCase() !== String(it.convId).toLowerCase()) { no('not_uuid'); continue; }
    if (it.desktop) { no('desktop'); continue; }
    if (it.boardKnown) { no('board_session'); continue; }
    // binding은 지우기용 판정(출처 추측은 빼고 세션 파일, 명령줄, 데스크톱 목록, 방금 기록됨만): 도는 중이거나 어딘가 묶였으면 지우지 않는다
    if (it.binding && it.binding.bound) { no(it.binding.open ? 'running' : it.binding.where === 'desktop' ? 'desktop' : 'bound'); continue; }
    if (it.cls !== 'missed') { no('not_missed'); continue; }
    const dir = file.slice(0, -6);
    ok.push({ convId: it.convId, file, dir: dirExists(dir) ? dir : null });
  }
  return { ok, refused };
}
export const REFUSE_LABEL = { trash_failed: "휴지통으로 이동 실패", bad_path: "유효하지 않은 경로", outside_root: "대화 기록 폴더 외부의 파일", not_uuid: "파일명이 대화 ID(UUID) 형식과 다름", desktop: '데스크톱 앱 대화', board_session: '보드 세션의 대화', running: "실행 중인 대화", bound: "다른 터미널에서 사용 중인 대화", not_missed: "정리 대상이 아닌 대화", not_found: "대화 목록에서 찾을 수 없음" };

// 파일과 폴더를 Windows 휴지통으로(Microsoft.VisualBasic FileSystem, 대화상자 없이). 경로 목록은 JSON 파일로 넘긴다(따옴표 문제 없이).
// → { trashed: [path], failed: [{ path, error }] }. 지운 뒤 그 경로가 남아 있으면 실패로 본다
export function trashPaths(paths, { tmpDir }) {
  if (!paths.length) return Promise.resolve({ trashed: [], failed: [] });
  if (process.platform === 'darwin') {
    const script = fileURLToPath(new URL('../scripts/trash-macos.js', import.meta.url));
    return new Promise((resolve) => {
      execFile('/usr/bin/osascript', ['-l', 'JavaScript', script, JSON.stringify(paths)], { encoding: 'utf8', timeout: 120000 }, (err, out) => {
        try { if (!err) return resolve(JSON.parse(out)); } catch {}
        resolve({ trashed: [], failed: paths.map((p) => ({ path: p, error: err?.message || 'Invalid Trash response' })) });
      });
    });
  }
  if (process.platform !== 'win32') return Promise.resolve({ trashed: [], failed: paths.map((p) => ({ path: p, error: 'Trash is not supported on this platform' })) });
  fs.mkdirSync(tmpDir, { recursive: true });
  const list = path.join(tmpDir, `trash-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(list, JSON.stringify(paths), 'utf8');
  const ps = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName Microsoft.VisualBasic
$out = @(); foreach ($p in (Get-Content -Raw -Encoding UTF8 -LiteralPath $env:MT_TRASH_LIST | ConvertFrom-Json)) {
  try {
    if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
    elseif (Test-Path -LiteralPath $p -PathType Leaf) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
    $out += [pscustomobject]@{ p = $p; e = $null }
  } catch { $out += [pscustomobject]@{ p = $p; e = $_.Exception.Message } }
}
ConvertTo-Json -Compress -InputObject @($out)`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 120000, env: { ...process.env, MT_TRASH_LIST: list } }, (err, out) => {
      try { fs.unlinkSync(list); } catch {}
      let rows = [];
      try { rows = [].concat(JSON.parse(out || '[]') || []); } catch {}
      const errs = new Map(rows.filter((r) => r && r.e).map((r) => [r.p, r.e]));
      const trashed = [], failed = [];
      for (const p of paths) {
        if (fs.existsSync(p)) failed.push({ path: p, error: errs.get(p) || (err ? err.message : 'still there') });
        else trashed.push(p);
      }
      resolve({ trashed, failed });
    });
  });
}

// 지운 뒤 비게 된 프로젝트 폴더(대화 기록 폴더 뿌리 바로 아래 <폴더 이름>)를 지운다. 뿌리 자체는 지우지 않는다
export function removeEmptyProjectDirs(files, roots) {
  const rootKeys = new Set(roots.map(pathKey));
  const removed = [];
  for (const d of new Set(files.map((f) => path.dirname(f)))) {
    if (rootKeys.has(pathKey(d))) continue;
    if (!rootKeys.has(pathKey(path.dirname(d)))) continue; // 뿌리 바로 아래 폴더만
    try { if (!fs.readdirSync(d).length) { fs.rmdirSync(d); removed.push(d); } } catch {}
  }
  return removed;
}
