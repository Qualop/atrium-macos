// 대화 목록(ARCH 4절 J3·J4, P7): 열린 워크스페이스의 Claude Code 대화 기록(~/.claude/projects/<폴더>/<대화 ID>.jsonl)을 찾고,
// 대화마다 다른 곳(데스크톱 앱, 다른 터미널의 claude)에 묶여 있는지 정한다. 대화 기록과 데스크톱 앱 파일은 읽기만 한다.
// - 파일마다 머리와 꼬리만 읽는다(이 PC는 대화 기록 391개, 4.8GB. 2026-10-31). 경로·크기·수정 시각이 같으면 저장소의 색인(convo_index)을 그대로 쓴다.
// - 리포에 속하는지는 대화 기록 안의 cwd를 워크스페이스 키 규칙(git 공통 폴더, git이 아니면 그 폴더)으로 풀어 맞춘다. 폴더 이름(경로를 바꾼 이름)은 되돌릴 수 없어 쓰지 않는다.
// - 묶여 있는지는 docs/log/p7-recall-sidebar.md 보고 5절에서 고른 방법이다. 확실하지 않으면 묶여 있다고 보고 열지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readPosixProcesses } from './processes.mjs';
import { isSyntheticUserText } from './transcript.mjs';
import { unwrapPasted, clip } from './text.mjs';
import { pathKey, normPath } from './workspaces.mjs';
import { promptKey, spawnsInLines, SPAWN_KEEP } from './spawns.mjs';

// 3(P13): 시작 시각(startAt), 첫 지시 열쇠(promptKey), 띄움 줄(spawns, 늘어난 부분만 읽음), 하위 에이전트 수
export const CONVO_PARSER = 3; // 대화 기록 요약 방법이 바뀌면 올린다(저장한 색인을 버리고 다시 읽는다)
export const HEAD_BYTES = 128 * 1024;
export const TAIL_BYTES = 128 * 1024;
export const RECENT_WRITE_MS = 30000; // 판정할 데가 없는데 이만큼 안에 기록된 대화는 어딘가 열려 있을 수 있다
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_ARG_RE = /(?:--resume|--session-id|-r)(?:=|\s+)"?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n') : '');

// P53(#8): Claude Code는 저장소 밖의 폴더와 분리된 HEAD에서 gitBranch에 "HEAD"를 쓴다. 브랜치 이름이 아니므로 버린다.
// 색인에 이미 HEAD로 남은 줄도 있어 보여줄 때도 이것을 거친다(CONVO_PARSER는 올리지 않는다)
export function branchName(b) {
  const s = typeof b === 'string' ? b.trim() : '';
  return s && s !== 'HEAD' ? s : null;
}

// 머리와 꼬리의 글 → 대화 요약. 사람이 쓴 지시(첫 것과 마지막 것), 마지막 답, 제목(Claude Code가 남긴 이름·요약), cwd, 브랜치, 출처(entrypoint)
export function parseTranscriptChunks(head, tail = '') {
  const out = { cwd: null, branch: null, entrypoints: [], title: null, titleSource: null, firstPrompt: null, firstAt: null, startAt: null, promptKey: null, lastPrompt: null, lastPromptAt: null, lastAnswer: null, lastAnswerAt: null, lastAt: null, prompts: 0, answers: 0, tailAnswers: 0, lastPromptLine: null };
  const ents = new Set();
  const titles = {};
  const seen = new Set();
  const take = (text, isTail) => {
    const lines = String(text || '').split('\n');
    if (isTail) lines.shift(); // 꼬리의 첫 줄은 잘린 줄일 수 있다
    for (const line of lines) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.uuid) { if (seen.has(o.uuid)) continue; seen.add(o.uuid); } // 머리와 꼬리가 겹친 줄
      if (o.entrypoint) ents.add(o.entrypoint);
      if (o.cwd && !out.cwd) out.cwd = o.cwd;
      if (branchName(o.gitBranch)) out.branch = branchName(o.gitBranch);
      const at = o.timestamp ? Date.parse(o.timestamp) : null;
      if (at && (!out.lastAt || at > out.lastAt)) out.lastAt = at;
      if (at && !isTail && (!out.startAt || at < out.startAt)) out.startAt = at; // P13: 대화가 시작한 시각(머리의 가장 이른 줄)
      if (o.type === 'custom-title' && o.customTitle) titles.custom = o.customTitle;
      else if (o.type === 'ai-title' && o.aiTitle) titles.ai = o.aiTitle;
      else if (o.type === 'summary' && o.summary) titles.summary = o.summary;
      else if (o.type === 'last-prompt' && o.lastPrompt) out.lastPromptLine = o.lastPrompt;
      if (o.isSidechain || o.isMeta) continue;
      if (o.type === 'user' && o.message) {
        const c = o.message.content;
        const text = typeof c === 'string' ? c : Array.isArray(c) && !c.some((p) => p && p.type === 'tool_result') ? textOf(c) : '';
        if (!text || isSyntheticUserText(text)) continue;
        const t = unwrapPasted(text);
        out.prompts++;
        if (!out.firstPrompt) { out.firstPrompt = clip(t, 300); out.firstAt = at; out.promptKey = promptKey(t); }
        out.lastPrompt = clip(t, 300); out.lastPromptAt = at;
        out.lastAnswer = null; out.lastAnswerAt = null;
      } else if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
        const t = textOf(o.message.content);
        if (t) { out.answers++; if (isTail) out.tailAnswers++; out.lastAnswer = clip(t, 300); out.lastAnswerAt = at; }
      }
    }
  };
  take(head, false);
  if (tail) take(tail, true);
  out.entrypoints = [...ents].sort();
  if (titles.custom) { out.title = clip(titles.custom, 120); out.titleSource = 'custom'; }
  else if (titles.ai) { out.title = clip(titles.ai, 120); out.titleSource = 'ai'; }
  else if (titles.summary) { out.title = clip(titles.summary, 120); out.titleSource = 'summary'; }
  else if (out.firstPrompt) { out.title = clip(out.firstPrompt.replace(/\s+/g, ' '), 80); out.titleSource = 'prompt'; }
  if (!out.lastPrompt && out.lastPromptLine) out.lastPrompt = clip(out.lastPromptLine, 300);
  return out;
}

// 파일 하나의 머리와 꼬리를 읽어 요약한다(읽기만). 턴 끝에 큰 첨부 줄(150KB가 넘는 prompt_snapshot 등)이 붙어 마지막 답이 꼬리 128KB 밖에 있을 수 있다.
// 그래서 꼬리는 답이 나올 때까지 뒤에서부터 128KB씩 넓혀 읽는다(TAIL_MAX_BYTES까지)
export const TAIL_MAX_BYTES = 1024 * 1024;
export async function readTranscriptSummary(file, { size = null } = {}) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const st = size == null ? (await fh.stat()).size : size;
    const hb = Buffer.alloc(Math.min(st, HEAD_BYTES));
    await fh.read(hb, 0, hb.length, 0);
    const head = hb.toString('utf8');
    if (st <= HEAD_BYTES) return parseTranscriptChunks(head, '');
    let n = 0, sum = null;
    while (n < Math.min(TAIL_MAX_BYTES, st - HEAD_BYTES)) {
      n = Math.min(n + TAIL_BYTES, TAIL_MAX_BYTES, st - HEAD_BYTES);
      const tb = Buffer.alloc(n);
      await fh.read(tb, 0, n, st - n);
      sum = parseTranscriptChunks(head, tb.toString('utf8'));
      if (sum.tailAnswers) break;
    }
    return sum;
  } finally { await fh.close(); }
}

// P13: 띄움 줄(spawns.mjs). 대화 기록은 덧붙기만 하므로 from(지난번에 읽은 바이트, 줄 끝)부터 size까지만 읽는다.
// 끝의 덜 쓴 줄은 다음에 읽도록 마지막 줄바꿈까지만 넘긴다 → { spawns, off }. 파일이 줄었으면(다시 쓴 파일) 처음부터
export const SPAWN_CHUNK = 4 * 1024 * 1024;
export async function readSpawns(file, { from = 0, size = null } = {}) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const st = size == null ? (await fh.stat()).size : size;
    let off = from > st ? 0 : from;
    const spawns = [];
    let carry = '';
    while (off < st) {
      const n = Math.min(SPAWN_CHUNK, st - off);
      const b = Buffer.alloc(n);
      await fh.read(b, 0, n, off);
      const nl = b.lastIndexOf(10);
      if (nl < 0) { if (off + n >= st) break; carry += b.toString('utf8'); off += n; continue; } // 아주 긴 줄
      const text = carry + b.subarray(0, nl + 1).toString('utf8');
      carry = '';
      spawns.push(...spawnsInLines(text));
      off += nl + 1;
    }
    return { spawns, off };
  } finally { await fh.close(); }
}
export const mergeSpawns = (prev, add) => [...(prev || []), ...(add || [])].slice(-SPAWN_KEEP);

// P13: 하위 에이전트(<대화 ID>/subagents/agent-*.jsonl). 수만 색인에 두고, 목록(설명, 시각)은 부를 때 읽는다
export function subagentDir(file) { return path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents'); }
export async function countSubagents(file) {
  try { return (await fs.promises.readdir(subagentDir(file))).filter((f) => /^agent-.*\.jsonl$/.test(f)).length; } catch { return 0; }
}
export async function listSubagents(file) {
  const dir = subagentDir(file);
  let names; try { names = (await fs.promises.readdir(dir)).filter((f) => /^agent-.*\.jsonl$/.test(f)); } catch { return []; }
  const out = [];
  for (const f of names) {
    const id = f.slice(0, -6);
    let at = null; try { at = Math.round((await fs.promises.stat(path.join(dir, f))).mtimeMs); } catch {}
    let meta = {}; try { meta = JSON.parse(await fs.promises.readFile(path.join(dir, `${id}.meta.json`), 'utf8')) || {}; } catch {}
    out.push({ id, description: typeof meta.description === 'string' ? clip(meta.description, 200) : null, agentType: meta.agentType || null, at });
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}

// 대화 기록 폴더(여럿일 수 있다)의 맨 위 대화 기록 파일들. 하위 폴더(<대화 ID>/subagents 등)는 보조 에이전트라 뺀다
export async function listTranscriptFiles(roots) {
  const out = [];
  for (const root of roots) {
    let dirs; try { dirs = await fs.promises.readdir(root, { withFileTypes: true }); } catch { continue; }
    // P10: 폴더 하나(<폴더 이름>)를 바로 가리켜도 된다(시험이 새로 만든 대화만 보게). 맨 위에 대화 기록이 있으면 그 폴더만 읽고 아래로 내려가지 않는다
    const own = dirs.filter((e) => e.isFile() && e.name.endsWith('.jsonl') && UUID_RE.test(e.name.slice(0, -6)));
    if (own.length) { for (const e of own) out.push({ path: path.join(root, e.name), convId: e.name.slice(0, -6).toLowerCase() }); continue; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dp = path.join(root, d.name);
      let es; try { es = await fs.promises.readdir(dp, { withFileTypes: true }); } catch { continue; }
      for (const e of es) {
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
        const id = e.name.slice(0, -6);
        if (!UUID_RE.test(id)) continue;
        out.push({ path: path.join(dp, e.name), convId: id.toLowerCase() });
      }
    }
  }
  return out;
}

// ---------- 묶여 있는지 알아내는 출처 ----------
// (1) Claude Code가 돌 때 남기는 세션 파일 ~/.claude/sessions/<pid>.json: { pid, sessionId, entrypoint: cli | claude-desktop, kind, … }.
//     pid가 살아 있으면 그 대화는 지금 그 프로세스가 연 것이다. 대화 안에서 /resume으로 바꾸면 sessionId도 바뀐다.
export function readLiveSessions(dir, { alive = pidAlive } = {}) {
  const out = new Map();
  let files; try { files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)); } catch { return out; }
  for (const f of files) {
    let o; try { o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const pid = Number(o.pid || f.split('.')[0]);
    if (!o.sessionId || !alive(pid)) continue;
    out.set(String(o.sessionId).toLowerCase(), { pid, entrypoint: o.entrypoint || null, kind: o.kind || null });
  }
  return out;
}
export function pidAlive(pid) { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// (2) 데스크톱 앱의 세션 목록 %LOCALAPPDATA%\Claude-Data\<프로필>\claude-code-sessions\…\local_<id>.json.
//     cliSessionId(대화 기록의 대화 ID)와 priorCliSessionIds. 터미널에서 연 대화를 앱이 가져간 것도 여기 있다(adoptedFromOtherSurface).
//     파일 수정 시각이 같으면 다시 읽지 않는다(cache: path → { mtime, ids, archived })
// 앱 프로필 폴더(base/<프로필>/claude-code-sessions)만 본다. 프로필 폴더의 나머지(브라우저 캐시 등)는 훑지 않는다
export function desktopSessionRoots(base) {
  const out = [];
  const direct = path.join(base, 'claude-code-sessions');
  try { if (fs.statSync(direct).isDirectory()) out.push(direct); } catch {}
  let ps; try { ps = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const p of ps) { if (!p.isDirectory()) continue; const d = path.join(base, p.name, 'claude-code-sessions'); try { if (fs.statSync(d).isDirectory()) out.push(d); } catch {} }
  return out;
}
// P34: 가져오기(desktop-import.mjs)가 쓰는 앱 세션 한 줄의 필드. 형식이 공개되지 않아 없는 필드는 null로 둔다
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const timeOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
export function desktopInfoOf(o, file = null) {
  if (!o || typeof o !== 'object') return null;
  const id = (x) => (str(x) ? str(x).toLowerCase() : null);
  return {
    provider: 'claude', file, sessionId: str(o.sessionId), cliSessionId: UUID_RE.test(id(o.cliSessionId) || '') ? id(o.cliSessionId) : null, priorCliSessionIds: (Array.isArray(o.priorCliSessionIds) ? o.priorCliSessionIds : []).map(id).filter((v) => UUID_RE.test(v || '')),
    cwd: str(o.cwd), originCwd: str(o.originCwd), title: str(o.title), model: str(o.model), effort: str(o.effort), permissionMode: str(o.permissionMode),
    isArchived: !!o.isArchived, isStarred: !!o.isStarred, lastActivityAt: timeOf(o.lastActivityAt), worktreePath: str(o.worktreePath), worktreeName: str(o.worktreeName),
    branch: str(o.branch), lastAssistantUuid: str(o.lastAssistantUuid), adoptedFromOtherSurface: !!o.adoptedFromOtherSurface,
  };
}
// P34: 앱 세션 목록 전부(보관 포함). readDesktopSessions와 같은 캐시를 쓴다
export function listDesktopSessions(base, cache = new Map()) {
  readDesktopSessions(base, cache);
  return [...cache.values()].map((c) => c.info).filter((x) => x && x.sessionId);
}
export function readDesktopSessions(base, cache = new Map()) {
  const out = new Map();
  const seen = new Set();
  const walk = (d, depth) => {
    if (depth > 4) return;
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/^local_.*\.json$/.test(e.name)) {
        seen.add(p);
        let mtime = 0; try { mtime = fs.statSync(p).mtimeMs; } catch { continue; }
        let c = cache.get(p);
        if (!c || c.mtime !== mtime) {
          try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); c = { mtime, ids: [o.cliSessionId, ...(Array.isArray(o.priorCliSessionIds) ? o.priorCliSessionIds : [])].filter(Boolean).map((x) => String(x).toLowerCase()), archived: !!o.isArchived, info: desktopInfoOf(o, p) }; }
          catch { c = { mtime, ids: [], archived: false, info: null }; }
          cache.set(p, c);
        }
        for (const id of c.ids) out.set(id, { archived: c.archived });
      }
    }
  };
  if (base) for (const d of desktopSessionRoots(base)) walk(d, 0);
  for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
  return out;
}

// (3) 돌고 있는 claude 프로세스의 명령줄에 든 대화 ID(--resume, --session-id). 세션 파일을 쓰기 전의 짧은 틈과 세션 파일이 없는 실행(-p 등)을 메운다.
//     PowerShell 한 번(약 0.3~0.5초)이라 열기 직전과 느린 주기에만 부른다
export function parseClaudeCmdlines(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const cl = String(r.cmd || '');
    for (const m of cl.matchAll(ID_ARG_RE)) out.set(m[1].toLowerCase(), { pid: r.pid });
  }
  return out;
}
export async function claudeProcesses() {
  if (process.platform !== 'win32') {
    const procs = await readPosixProcesses();
    return procs ? [...procs.values()].filter((p) => p.name === 'claude' || /(?:^|\/)claude(?:\s|$)|@anthropic-ai\/claude-code\//.test(p.cmd)).map(({ pid, cmd }) => ({ pid, cmd })) : null;
  }
  const ps = `$ErrorActionPreference = 'SilentlyContinue'; @(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" -Property ProcessId,CommandLine | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; c = $_.CommandLine } }) | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 10000 }, (err, out) => {
      if (err) return resolve(null);
      try { resolve([].concat(JSON.parse(out || '[]') || []).map((x) => ({ pid: x.i, cmd: x.c }))); } catch { resolve(null); }
    });
  });
}

// 대화 하나가 다른 곳에 묶여 있는가. 순서대로 본다(docs/log/p7-recall-sidebar.md 보고 5절).
// live: 세션 파일(살아 있는 pid), procs: 명령줄, desktop: 데스크톱 앱 목록, entrypoints: 대화 기록 안의 출처, mtime: 대화 기록 수정 시각
// → { bound: false } 또는 { bound: true, where: desktop | terminal | unknown, sure, label, pid? }
export function bindingOf({ convId, entrypoints = [], mtime = 0, now = Date.now(), live = new Map(), procs = new Map(), desktop = new Map(), recentMs = RECENT_WRITE_MS }) {
  const id = String(convId || '').toLowerCase();
  const l = live.get(id);
  if (l) {
    if (/desktop/i.test(l.entrypoint || '')) return { bound: true, where: 'desktop', sure: true, open: true, pid: l.pid, label: '데스크톱 앱 · 열려 있음' };
    return { bound: true, where: 'terminal', sure: true, open: true, pid: l.pid, label: `터미널 · pid ${l.pid}` };
  }
  const p = procs.get(id);
  if (p) return { bound: true, where: 'terminal', sure: true, open: true, pid: p.pid, label: `터미널 · pid ${p.pid}` };
  const d = desktop.get(id);
  if (d) return { bound: true, where: 'desktop', sure: true, archived: d.archived, label: d.archived ? '데스크톱 앱 · 보관됨' : '데스크톱 앱' };
  if (entrypoints.some((e) => /desktop/i.test(e))) return { bound: true, where: 'desktop', sure: true, label: '데스크톱 앱' };
  if (!entrypoints.length) return { bound: true, where: 'unknown', sure: false, label: "다른 곳에서 사용 중일 수 있음 · 실행 위치 확인 불가" };
  if (entrypoints.some((e) => e !== 'cli')) return { bound: true, where: 'unknown', sure: false, label: `다른 곳에서 사용 중일 수 있음 · ${entrypoints.filter((e) => e !== 'cli').join(', ')}` };
  if (mtime && now - mtime < recentMs) return { bound: true, where: 'unknown', sure: false, label: "다른 곳에서 사용 중일 수 있음 · 최근 활동 감지" };
  return { bound: false };
}

// 대화 하나가 열린 워크스페이스 w에 드는가. resolved: 대화 cwd를 workspaceOf로 푼 것 { key, kind, root }
// 폴더 워크스페이스는 그 아래 폴더(다른 git 저장소가 아닌 것)의 대화도 담는다(elsewhereOf와 같은 기준)
export function inWorkspace(w, cwd, resolved) {
  if (!w || !resolved) return false;
  if (resolved.key === w.key) return true;
  if (w.kind === 'folder' && resolved.kind === 'folder') { const c = pathKey(cwd); return c.startsWith(w.key + '/'); }
  return false;
}

// 대화 목록의 한 줄(창과 atrium CLI가 보는 모양)
export function convoView(row, { binding, board = null, root = null }) {
  const cwd = row.cwd ? normPath(row.cwd) : null;
  const rel = cwd && root && pathKey(cwd) !== pathKey(root) && pathKey(cwd).startsWith(pathKey(root) + '/') ? cwd.slice(normPath(root).length + 1) : null;
  return {
    convId: row.convId, cwd, folder: rel, branch: branchName(row.branch), worktree: !!row.worktree,
    title: row.title || null, titleSource: row.titleSource || null, firstPrompt: row.firstPrompt || null, lastPrompt: row.lastPrompt || null, lastAnswer: row.lastAnswer || null,
    lastAt: row.lastAt || row.mtime || null, size: row.size, prompts: row.prompts || 0, entrypoints: row.entrypoints || [],
    board, binding, canOpen: !board && !binding.bound,
  };
}
