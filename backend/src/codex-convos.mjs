// P133: Codex 대화 기록(Codex CLI와 Codex 데스크톱 앱이 함께 쓰는 $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<시각>-<대화 ID>.jsonl[.zst])을
// Claude Code 대화(convos.mjs)와 같은 모양의 요약으로 읽고, 대화마다 다른 곳에 묶여 있는지 정한다. 모든 파일은 읽기만 한다.
// - 대화 기록 한 줄: { timestamp, ordinal?, type, payload }. 첫 줄은 session_meta(payload.id, cwd, originator, source, cli_version).
//   사람이 쓴 지시는 event_msg의 item_completed(item.type UserMessage)나 옛 판의 user_message, 답은 AgentMessage나 agent_message·task_complete다.
//   response_item의 user 메시지에는 Codex가 넣은 지시문(AGENTS.md, 환경)이 섞여 있어 다른 것이 없을 때만 본다(content_item_kinds 'user.text').
// - Codex는 오래된 대화를 zstd로 눌러 둔다(.jsonl.zst, 이 PC는 2026-11-13에 1500여 개·2.2GB). 눌린 파일은 머리(HEAD_BYTES)까지만 풀어 읽고,
//   마지막 답은 비워 둔다(끝까지 풀면 너무 크다). 마지막 활동은 파일 수정 시각이다.
// - 출처: originator codex-tui(터미널 codex. 0.167은 앱 데몬을 거쳐 source가 vscode다) → 'cli', originator "Codex Desktop" → 'codex-desktop',
//   source exec(codex exec, 자동 실행) → 'sdk-codex-exec', 그 밖의 vscode(편집기 확장) → 'codex-vscode'. 하위 에이전트 대화(source가 객체,
//   파일 이름에 대화 ID가 둘)는 목록에 올리지 않는다.
// - 제목: Codex가 남기는 $CODEX_HOME/session_index.jsonl의 thread_name(대화 ID마다 마지막 줄).
// - 묶임(codexBindingOf): Codex는 대화를 쓰는 동안 $CODEX_HOME/thread-writer-locks/<대화 ID>.lock에 OS 잠금을 걸고 끝나면 파일을 지운다
//   (2026-11-13 codex-cli 0.167.2 실측: 도는 동안 그 파일 0바이트 읽기가 EBUSY, 끝나면 파일이 없다). 잠금 읽기는 1바이트 읽기 시도뿐이다(쓰지 않는다).
//   그 밖에 도는 codex 프로세스 명령줄의 `resume <ID>`·`fork <ID>`, 데스크톱 앱·편집기 확장 출처, 방금 기록됨을 본다. 확실하지 않으면 묶여 있다고 본다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { unwrapPasted, clip, isBoardNotice, promptTask } from './text.mjs';
import { promptKey } from './spawns.mjs';
import { HEAD_BYTES, TAIL_BYTES, TAIL_MAX_BYTES, RECENT_WRITE_MS } from './convos.mjs';

export const CODEX_HARNESS = 'codex';
export const CODEX_PARSER = 2; // Codex 대화 요약 방법이 바뀌면 올린다(색인의 Codex 줄만 버리고 다시 읽는다)
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// rollout-2026-11-13T09-38-21-<대화 ID>.jsonl(.zst). 하위 에이전트는 rollout-…-<부모 ID>_<자식 ID>.jsonl
const ROLLOUT_RE = new RegExp(`^rollout-.*?(${UUID})(_${UUID})?\\.jsonl(\\.zst)?$`, 'i');
const CMD_ID_RE = new RegExp(`(?:^|\\s)(?:resume|fork)\\s+"?(${UUID})`, 'gi');

const textOfItems = (content) => (Array.isArray(content) ? content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).filter(Boolean).join('\n') : typeof content === 'string' ? content : '');

// session_meta의 출처 → entrypoints(missed.mjs classifyConvo가 읽는 이름). subagent: 하위 에이전트 대화
export function codexEntrypoint(meta = {}) {
  const src = meta.source;
  if (src && typeof src === 'object') return { entrypoints: ['codex-subagent'], subagent: true };
  const s = String(src || '').toLowerCase();
  const orig = String(meta.originator || '');
  // 0.167의 터미널 codex는 앱 데몬을 거쳐 source가 vscode로 남는다(originator codex-tui). 그래서 originator를 먼저 본다
  if (/^codex[-_]?tui$/i.test(orig)) return { entrypoints: ['cli'], subagent: false };
  // 갈라 연 대화(forked_from_id)는 originator를 원본에서 물려받는다. 터미널에서 갈라 열었으면 source가 cli다
  if (meta.forked_from_id && s === 'cli') return { entrypoints: ['cli'], subagent: false };
  if (/desktop/i.test(orig)) return { entrypoints: ['codex-desktop'], subagent: false };
  if (s === 'cli') return { entrypoints: ['cli'], subagent: false };
  if (s === 'exec') return { entrypoints: ['sdk-codex-exec'], subagent: false };
  if (s === 'vscode') return { entrypoints: [/desktop/i.test(orig) ? 'codex-desktop' : 'codex-vscode'], subagent: false };
  if (!s && /tui|cli/i.test(orig)) return { entrypoints: ['cli'], subagent: false };
  return { entrypoints: [s ? `codex-${s}` : 'codex-unknown'], subagent: false };
}

// 머리와 꼬리의 글 → 대화 요약(convos.mjs parseTranscriptChunks와 같은 모양) + convId(session_meta의 id)
export function parseCodexChunks(head, tail = '') {
  const out = { convId: null, cwd: null, branch: null, entrypoints: [], title: null, titleSource: null, firstPrompt: null, firstAt: null, startAt: null, promptKey: null, lastPrompt: null, lastPromptAt: null, lastAnswer: null, lastAnswerAt: null, lastAt: null, prompts: 0, answers: 0, tailAnswers: 0, subagent: false };
  const seen = new Set();
  // 같은 지시·답이 여러 줄 모양으로 남는다(item_completed, 옛 user_message·agent_message, response_item). 줄 모양마다 따로 모아 가장 믿을 만한 것을 쓴다
  const users = { item: [], event: [], resp: [] };
  const answers = { item: [], event: [], resp: [] };
  let metaSeen = false;
  const take = (text, isTail) => {
    const lines = String(text || '').split('\n');
    if (isTail) lines.shift(); // 꼬리의 첫 줄은 잘린 줄일 수 있다
    for (const line of lines) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const key = o.ordinal != null ? `o${o.ordinal}` : `${line.length}:${line.slice(0, 160)}`; // 머리와 꼬리가 겹친 줄
      if (seen.has(key)) continue; seen.add(key);
      const at = o.timestamp ? Date.parse(o.timestamp) : null;
      if (at && (!out.lastAt || at > out.lastAt)) out.lastAt = at;
      if (at && !isTail && (!out.startAt || at < out.startAt)) out.startAt = at;
      const p = o.payload || {};
      if (o.type === 'session_meta' && !metaSeen) {
        metaSeen = true;
        if (typeof p.id === 'string') out.convId = p.id.toLowerCase();
        if (typeof p.cwd === 'string' && p.cwd) out.cwd = p.cwd;
        if (p.git && typeof p.git.branch === 'string' && p.git.branch) out.branch = p.git.branch;
        const ep = codexEntrypoint(p);
        out.entrypoints = ep.entrypoints; out.subagent = ep.subagent;
        continue;
      }
      if (o.type === 'turn_context' && !out.cwd && typeof p.cwd === 'string') out.cwd = p.cwd;
      if (o.type === 'event_msg') {
        if (p.type === 'item_completed' && p.item) {
          if (p.item.type === 'UserMessage') users.item.push({ text: textOfItems(p.item.content), at, isTail });
          else if (p.item.type === 'AgentMessage') answers.item.push({ text: textOfItems(p.item.content), at, isTail });
        } else if (p.type === 'user_message' && typeof p.message === 'string') users.event.push({ text: p.message, at, isTail });
        else if (p.type === 'agent_message' && typeof p.message === 'string') answers.event.push({ text: p.message, at, isTail });
        else if (p.type === 'task_complete' && typeof p.last_agent_message === 'string') answers.event.push({ text: p.last_agent_message, at, isTail });
      } else if (o.type === 'response_item' && p.type === 'message') {
        const kinds = (p.internal_chat_message_metadata_passthrough || {}).content_item_kinds || [];
        if (p.role === 'user') { const t = textOfItems(p.content); if (kinds.includes('user.text') || (!kinds.length && t && !/^\s*</.test(t) && !/^# AGENTS\.md/.test(t))) users.resp.push({ text: t, at, isTail }); }
        else if (p.role === 'assistant') answers.resp.push({ text: textOfItems(p.content), at, isTail });
      }
    }
  };
  take(head, false);
  if (tail) take(tail, true);
  const pick = (g) => (g.item.length ? g.item : g.event.length ? g.event : g.resp).filter((x) => x.text && x.text.trim());
  const us = pick(users), as = pick(answers);
  // 머리에서 읽은 지시 수(꼬리만 본 가운데는 모른다. Claude Code 쪽과 같이 읽은 것만 센다)
  out.prompts = us.length; out.answers = as.length; out.tailAnswers = as.filter((x) => x.isTail).length; out.tailPrompts = us.filter((x) => x.isTail).length;
  if (us.length) {
    const f = unwrapPasted(us[0].text);
    out.firstPrompt = clip(f, 300); out.firstAt = us[0].at; out.promptKey = promptKey(f);
    // P153 r13: 판 알림은 마지막 지시가 아니다(그 앞 지시)
    const lu = [...us].reverse().find((x) => !isBoardNotice(x.text));
    if (lu) { out.lastPrompt = clip(promptTask(lu.text), 300); out.lastPromptAt = lu.at; } // P159: 관계 줄은 뗀다
  }
  // 마지막 답은 마지막 지시 뒤의 것만
  const lastU = us.length ? us[us.length - 1] : null;
  const after = as.filter((a) => !lastU || !lastU.at || !a.at || a.at >= lastU.at);
  if (after.length) { const a = after[after.length - 1]; out.lastAnswer = clip(a.text, 300); out.lastAnswerAt = a.at; }
  if (out.firstPrompt) { out.title = clip(out.firstPrompt.replace(/\s+/g, ' '), 80); out.titleSource = 'prompt'; }
  if (out.subagent) out.prompts = 0; // 하위 에이전트 대화는 목록·캔버스에 올리지 않는다
  return out;
}

// 눌린 대화 기록(.jsonl.zst)의 앞 max바이트(푼 글)
export function readZstHead(file, max = HEAD_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0; let done = false;
    const src = fs.createReadStream(file);
    const z = zlib.createZstdDecompress();
    const finish = () => { if (done) return; done = true; src.destroy(); z.destroy(); resolve(Buffer.concat(chunks).subarray(0, max).toString('utf8')); };
    z.on('data', (d) => { chunks.push(d); n += d.length; if (n >= max) finish(); });
    z.on('end', finish);
    z.on('error', (e) => { if (done) return; done = true; src.destroy(); if (n) resolve(Buffer.concat(chunks).toString('utf8')); else reject(e); });
    src.on('error', (e) => { if (done) return; done = true; z.destroy(); reject(e); });
    src.pipe(z);
  });
}

// 파일 하나를 읽어 요약한다(읽기만). 꼬리는 지시와 답이 나올 때까지 뒤에서부터 넓혀 읽는다(TAIL_MAX_BYTES까지, convos.mjs readTranscriptSummary와 같은 방법)
export async function readCodexSummary(file, { size = null, mtime = null } = {}) {
  if (/\.zst$/i.test(file)) {
    const head = await readZstHead(file);
    // 끝이 잘린 머리의 마지막 줄은 버린다
    const cut = head.length >= HEAD_BYTES ? head.slice(0, head.lastIndexOf('\n') + 1) : head;
    const sum = parseCodexChunks(cut, '');
    let mt = mtime; if (mt == null) { try { mt = Math.round(fs.statSync(file).mtimeMs); } catch {} }
    if (mt && (!sum.lastAt || mt > sum.lastAt)) sum.lastAt = mt;
    sum.compressed = true;
    return sum;
  }
  const fh = await fs.promises.open(file, 'r');
  try {
    const st = size == null ? (await fh.stat()).size : size;
    const hb = Buffer.alloc(Math.min(st, HEAD_BYTES));
    await fh.read(hb, 0, hb.length, 0);
    const head = hb.toString('utf8');
    if (st <= HEAD_BYTES) return parseCodexChunks(head, '');
    const headCut = head.slice(0, head.lastIndexOf('\n') + 1);
    let n = 0, sum = null;
    while (n < Math.min(TAIL_MAX_BYTES, st - HEAD_BYTES)) {
      n = Math.min(n + TAIL_BYTES, TAIL_MAX_BYTES, st - HEAD_BYTES);
      const tb = Buffer.alloc(n);
      await fh.read(tb, 0, n, st - n);
      sum = parseCodexChunks(headCut, tb.toString('utf8'));
      if (sum.tailAnswers && sum.tailPrompts) break; // 마지막 지시와 그 뒤 답이 모두 꼬리에 들 때까지(도구 출력 줄이 커서 지시가 멀 수 있다)
    }
    return sum;
  } finally { await fh.close(); }
}

// Codex 홈의 대화 기록 파일들(sessions/YYYY/MM/DD). 하위 에이전트 대화(대화 ID가 둘)는 뺀다. 보관(archived_sessions)은 읽지 않는다
export async function listCodexFiles(home) {
  const out = [];
  if (!home) return out;
  const root = path.join(home, 'sessions');
  const dirs = async (d) => { try { return (await fs.promises.readdir(d, { withFileTypes: true })).filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => path.join(d, e.name)); } catch { return []; } };
  for (const y of await dirs(root)) for (const m of await dirs(y)) for (const d of await dirs(m)) {
    let es; try { es = await fs.promises.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) {
      if (!e.isFile()) continue;
      const mm = ROLLOUT_RE.exec(e.name);
      if (!mm || mm[2]) continue;
      out.push({ path: path.join(d, e.name), convId: mm[1].toLowerCase(), harness: CODEX_HARNESS });
    }
  }
  // 같은 대화가 눌린 것과 안 눌린 것 둘로 있으면(누르는 중) 안 눌린 것
  const plain = new Set(out.filter((f) => !/\.zst$/i.test(f.path)).map((f) => f.convId));
  return out.filter((f) => !/\.zst$/i.test(f.path) || !plain.has(f.convId));
}

// session_index.jsonl → 대화 ID → thread_name. 파일 크기·시각이 같으면 다시 읽지 않는다(cache: { stamp, map })
export function readCodexTitles(home, cache = {}) {
  const file = home ? path.join(home, 'session_index.jsonl') : null;
  let st = null; try { st = file ? fs.statSync(file) : null; } catch {}
  const stamp = st ? `${st.size}:${st.mtimeMs}` : '-';
  if (cache.stamp === stamp && cache.map) return cache.map;
  const map = new Map();
  if (st) {
    let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch {}
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o && typeof o.id === 'string' && typeof o.thread_name === 'string' && o.thread_name.trim()) map.set(o.id.toLowerCase(), clip(o.thread_name.trim(), 120));
    }
  }
  cache.stamp = stamp; cache.map = map;
  return map;
}

// 지금 잠긴(Codex가 쓰고 있는) 대화 ID. 잠금 파일 0번 바이트를 1바이트 읽어 본다: 잠겨 있으면 EBUSY(Windows 바이트 범위 잠금). 파일은 고치지 않는다
export function readCodexLocks(home, { probe = probeLock } = {}) {
  const out = new Set();
  if (!home) return out;
  const dir = path.join(home, 'thread-writer-locks');
  let names; try { names = fs.readdirSync(dir); } catch { return out; }
  const re = new RegExp(`^(${UUID})\\.lock$`, 'i');
  for (const n of names) { const m = re.exec(n); if (m && probe(path.join(dir, n))) out.add(m[1].toLowerCase()); }
  return out;
}
export function probeLock(file) {
  let fd; try { fd = fs.openSync(file, 'r'); } catch { return false; }
  try { fs.readSync(fd, Buffer.alloc(1), 0, 1, 0); return false; } catch (e) { return e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES'; } finally { try { fs.closeSync(fd); } catch {} }
}

// 도는 codex 프로세스 명령줄의 대화 ID(`codex resume <ID>`, `codex fork <ID>`, `codex exec resume <ID>`) → Map(ID → { pid })
export function parseCodexCmdlines(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (r.name && !/codex/i.test(r.name)) continue;
    for (const m of String(r.cmd || '').matchAll(CMD_ID_RE)) out.set(m[1].toLowerCase(), { pid: r.pid });
  }
  return out;
}

// Codex 대화 하나가 다른 곳에 묶여 있는가. → { bound: false } | { bound: true, where: desktop | terminal | unknown, sure, open?, label, harness: 'codex' }
// locks: 지금 잠긴 대화 ID, procs: 명령줄의 대화 ID, entrypoints: 대화 기록의 출처, mtime: 대화 기록 수정 시각
export function codexBindingOf({ convId, entrypoints = [], mtime = 0, now = Date.now(), locks = new Set(), procs = new Map(), recentMs = RECENT_WRITE_MS }) {
  const id = String(convId || '').toLowerCase();
  const desk = entrypoints.some((e) => /desktop/i.test(e));
  const p = procs.get(id);
  if (p) return { bound: true, where: 'terminal', sure: true, open: true, pid: p.pid, harness: CODEX_HARNESS, label: `터미널 · pid ${p.pid}` };
  if (locks.has(id)) return desk ? { bound: true, where: 'desktop', sure: true, open: true, harness: CODEX_HARNESS, label: 'Codex 앱 · 열려 있음' } : { bound: true, where: 'codex', sure: true, open: true, harness: CODEX_HARNESS, label: 'Codex · 열려 있음' };
  if (desk) return { bound: true, where: 'desktop', sure: true, harness: CODEX_HARNESS, label: 'Codex 앱' };
  if (!entrypoints.length) return { bound: true, where: 'unknown', sure: false, harness: CODEX_HARNESS, label: '다른 곳에서 사용 중일 수 있음 · 실행 위치 확인 불가' };
  if (entrypoints.some((e) => e !== 'cli' && !/^sdk/i.test(e))) return { bound: true, where: 'unknown', sure: false, harness: CODEX_HARNESS, label: `다른 곳에서 사용 중일 수 있음 · ${entrypoints.filter((e) => e !== 'cli').join(', ')}` };
  if (mtime && now - mtime < recentMs) return { bound: true, where: 'unknown', sure: false, harness: CODEX_HARNESS, label: '다른 곳에서 사용 중일 수 있음 · 최근 활동 감지' };
  return { bound: false };
}
