// P137: 하네스가 지금 쓰는 모델(과 노력 수준). 판이 띄운 값(s.model·s.effort)은 처음 값이라 /model·모델 바꾸기를 따라가지 않는다.
// 하네스마다 자기 기록 파일에 지금 값을 남긴다. 읽기만 한다.
// - Claude Code: 대화 기록(.jsonl)의 assistant 줄 message.model(<synthetic> 빼고, 하위 에이전트 isSidechain 빼고),
//   /model·/effort의 출력 줄(<local-command-stdout>Set model to `X` …, Set effort level to Y …). 둘 중 나중 줄이 이긴다
// - Codex: rollout의 turn_context(payload.model, payload.effort)와 /model로 바꾼 그때의 event_msg thread_settings_applied(model, reasoning_effort)
// - pi: 세션 파일의 model_change(modelId), thinking_level_change(thinkingLevel, off는 없음으로)
// - opencode: 기록이 SQLite라 읽지 않는다(띄운 값을 보인다)
// 파일은 처음에 끝에서부터 조각으로 거슬러 읽고(값을 찾을 때까지, 64MB까지), 그 뒤에는 늘어난 만큼만 읽는다.
import fs from 'node:fs';
import path from 'node:path';

const CHUNK = 4 * 1024 * 1024;
const BACK_MAX = 64 * 1024 * 1024;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (isObj(x) && typeof x.text === 'string' ? x.text : typeof x === 'string' ? x : isObj(x) && x.content ? textOf(x.content) : '')).join('\n');
  return '';
}
const clean = (v) => (typeof v === 'string' ? v.replace(ANSI, '').trim() : '');

// 줄 하나 → { model?, effort? } 또는 null. kind: claude | codex | pi
export function lineModel(kind, line) {
  if (!line) return null;
  if (kind === 'claude') {
    // 빠른 거르기: 모델·노력 수준이 들어갈 수 없는 줄은 파싱하지 않는다
    const asst = line.includes('"assistant"') && line.includes('"model"');
    const cmd = line.includes('Set model to') || line.includes('Set effort level to');
    if (!asst && !cmd) return null;
    let o; try { o = JSON.parse(line); } catch { return null; }
    if (!isObj(o) || o.isSidechain) return null;
    if (o.type === 'assistant' && isObj(o.message)) {
      const m = clean(o.message.model);
      return m && m !== '<synthetic>' ? { model: m } : null;
    }
    if (!cmd) return null;
    const t = clean(textOf(isObj(o.message) ? o.message.content : o.content));
    const out = {};
    // 이름은 백틱 안(`Opus 5.5`, `GPT 6.1 Terra (native)`). 백틱이 없으면 " and saved"·"·"·줄 끝 앞까지
    const mm = /<local-command-stdout>\s*Set model to\s+(?:`([^`\n]+)`|([^\n<·]+?)(?=\s+and saved\b|\s*·|\s*<|\s*$))/m.exec(t);
    if (mm) out.model = (mm[1] || mm[2]).trim();
    const em = /<local-command-stdout>\s*Set effort level to\s+([A-Za-z]+)/.exec(t);
    if (em) out.effort = em[1].toLowerCase();
    return out.model || out.effort ? out : null;
  }
  if (kind === 'codex') {
    // turn_context(턴마다) 또는 thread_settings_applied(/model로 바꾼 바로 그때, event_msg의 payload.thread_settings)
    const tc = line.includes('"turn_context"'), ts = line.includes('"thread_settings_applied"');
    if (!tc && !ts) return null;
    let o; try { o = JSON.parse(line); } catch { return null; }
    if (!isObj(o) || !isObj(o.payload)) return null;
    let p = null;
    if (o.type === 'turn_context') p = o.payload;
    else if (o.type === 'event_msg' && o.payload.type === 'thread_settings_applied' && isObj(o.payload.thread_settings)) { p = { ...o.payload.thread_settings }; p.effort = p.reasoning_effort; }
    if (!p) return null;
    const s = isObj(p.collaboration_mode) && isObj(p.collaboration_mode.settings) ? p.collaboration_mode.settings : {};
    const model = clean(p.model) || clean(s.model);
    const effort = clean(p.effort) || clean(s.reasoning_effort);
    return model || effort ? { ...(model ? { model } : {}), effort: effort || null } : null;
  }
  if (kind === 'pi') {
    if (!line.includes('model_change') && !line.includes('thinking_level_change')) return null;
    let o; try { o = JSON.parse(line); } catch { return null; }
    if (!isObj(o)) return null;
    if (o.type === 'model_change' && clean(o.modelId)) return { model: clean(o.modelId) };
    if (o.type === 'thinking_level_change' && typeof o.thinkingLevel === 'string') return { effort: o.thinkingLevel === 'off' ? null : o.thinkingLevel };
    return null;
  }
  return null;
}

// 여러 줄을 차례로 겹친다. Codex의 turn_context는 노력 수준을 늘 함께 쓰므로(없으면 null) 그 줄의 값으로 바꾼다
export function foldLines(kind, lines, acc = {}) {
  let out = { ...acc };
  for (const l of lines) {
    const r = lineModel(kind, l);
    if (!r) continue;
    if (r.model) out.model = r.model;
    if ('effort' in r) out.effort = r.effort;
  }
  return out;
}

// macOS 판: Claude Code의 출력 속도(초당 토큰). 대화 기록의 api-request 줄(요청 시작)과 그 응답의 assistant 줄(message.id, usage.output_tokens, 마지막 줄 시각)로 잰다.
// 같은 응답의 줄(생각, 글, 도구 호출)은 usage가 같으니 가장 큰 output_tokens를 쓴다. 하위 에이전트 줄(isSidechain)은 뺀다.
// sp: { reqTs, id, start, end, out, tps, at } → 새 sp. 처음 거슬러 읽을 때는 재지 않고, 늘어난 줄만 본다(지금 속도)
const SPEED_MIN_TOKENS = 20, SPEED_MIN_MS = 500;
export function foldSpeed(lines, sp = null) {
  let o = sp ? { ...sp } : { reqTs: null, id: null, start: null, end: null, out: 0, tps: null, at: null };
  for (const l of lines) {
    const req = l.includes('"api-request"');
    if (!req && !(l.includes('"assistant"') && l.includes('"output_tokens"'))) continue;
    let d; try { d = JSON.parse(l); } catch { continue; }
    if (!isObj(d) || d.isSidechain) continue;
    const ts = Date.parse(d.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (d.type === 'api-request') { o.reqTs = ts; continue; }
    const m = isObj(d.message) ? d.message : null;
    const out = m && isObj(m.usage) ? Number(m.usage.output_tokens) : NaN;
    if (d.type !== 'assistant' || !m || !m.id || !Number.isFinite(out)) continue;
    if (m.id !== o.id) { o.id = m.id; o.start = o.reqTs ?? o.end; o.out = 0; }
    o.end = ts; o.out = Math.max(o.out, out);
    const ms = o.start != null ? o.end - o.start : 0;
    if (o.out >= SPEED_MIN_TOKENS && ms >= SPEED_MIN_MS) { o.tps = Math.round(o.out / (ms / 1000)); o.at = ts; }
  }
  return o;
}

// macOS 판: 사람이 턴을 멈춘 때(Esc). Claude Code는 이때 Stop hook을 보내지 않고 대화 기록에 "[Request interrupted by user" 줄만 남긴다 → 마지막 그 줄의 시각
export function foldInterrupt(lines, prev = null) {
  let at = prev;
  for (const l of lines) {
    if (!l.includes('[Request interrupted by user')) continue;
    let d; try { d = JSON.parse(l); } catch { continue; }
    if (!isObj(d) || d.isSidechain || d.type !== 'user') continue;
    const txt = textOf(isObj(d.message) ? d.message.content : d.content);
    const ts = Date.parse(d.timestamp);
    if (txt.trimStart().startsWith('[Request interrupted by user') && Number.isFinite(ts)) at = Math.max(at || 0, ts);
  }
  return at;
}

// macOS 판: Claude Code가 API 오류로 턴을 끊은 줄(isApiErrorMessage). 잠들기·네트워크 끊김이면 StopFailure hook도
// 판에 닿지 못할 수 있어(2026-11-19 StockD: "Your computer went to sleep mid-response", hook은 proxy refused) 기록에서 본다
export function foldApiError(lines, prev = null) {
  let got = prev;
  for (const l of lines) {
    if (!l.includes('"isApiErrorMessage":true')) continue;
    let d; try { d = JSON.parse(l); } catch { continue; }
    if (!isObj(d) || d.isSidechain || d.type !== 'assistant' || d.isApiErrorMessage !== true) continue;
    const at = Date.parse(d.timestamp);
    if (!Number.isFinite(at) || (got && got.at >= at)) continue;
    const msg = isObj(d.message) ? textOf(d.message.content) : '';
    got = { at, type: typeof d.error === 'string' ? d.error : 'api_error', message: String(msg || '').slice(0, 300) };
  }
  return got;
}

function readRange(file, start, end) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    const n = fs.readSync(fd, buf, 0, buf.length, start);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

// 끝에서부터 거슬러 읽어 마지막 모델 값을 찾는다. 노력 수준이 아직 없으면 더 앞에서 찾는다
// → { model, effort, pos(다 읽은 마지막 줄 끝) }
export function scanBack(kind, file, size) {
  const got = {};
  let end = size, pos = null, read = 0, carry = Buffer.alloc(0);
  while (end > 0 && read < BACK_MAX) {
    const start = Math.max(0, end - CHUNK);
    let buf = Buffer.concat([readRange(file, start, end), carry]);
    read += end - start;
    if (pos === null) { // 맨 끝 조각: 줄바꿈으로 끝나지 않은 마지막 조각(쓰는 중)은 다음 읽기로 미룬다
      const nl = buf.lastIndexOf(10);
      pos = nl < 0 ? start : start + nl + 1;
      buf = buf.subarray(0, nl < 0 ? 0 : nl);
    }
    if (start > 0) { // 첫 줄은 잘렸을 수 있다: 다음(앞) 조각에 붙여 읽는다
      const first = buf.indexOf(10);
      if (first < 0) { carry = buf; end = start; continue; }
      carry = Buffer.from(buf.subarray(0, first)); buf = buf.subarray(first + 1);
    } else carry = Buffer.alloc(0);
    const r = foldLines(kind, buf.toString('utf8').split('\n'));
    // 앞 조각은 뒤 조각보다 옛 값이다: 뒤에서 이미 찾은 값은 두고 빈 것만 채운다
    if (!got.model && r.model) got.model = r.model;
    if (!('effort' in got) && 'effort' in r) got.effort = r.effort;
    if (got.model && ('effort' in got || kind === 'claude')) break; // Claude Code 노력 수준은 /effort를 쓸 때만 남는다
    end = start;
  }
  return { ...got, pos: pos ?? 0 };
}

// 세션 하나의 읽기 상태. st: { file, pos, size, model, effort } (없으면 새로)
export function refreshModel(kind, file, st = null) {
  let stat; try { stat = fs.statSync(file); } catch { return st && st.file === file ? st : null; }
  if (!st || st.file !== file || stat.size < st.pos) {
    const r = scanBack(kind, file, stat.size);
    return { file, pos: r.pos, size: stat.size, model: r.model || null, effort: r.effort ?? null };
  }
  if (stat.size === st.size) return st;
  const buf = readRange(file, st.pos, stat.size);
  const nl = buf.lastIndexOf(10);
  if (nl < 0) return { ...st, size: stat.size };
  const lines = buf.subarray(0, nl).toString('utf8').split('\n');
  const r = foldLines(kind, lines, { model: st.model, effort: st.effort });
  const speed = kind === 'claude' ? foldSpeed(lines, st.speed || null) : null; // macOS 판: 출력 속도(Claude Code만)
  const interruptAt = kind === 'claude' ? foldInterrupt(lines, st.interruptAt || null) : null; // macOS 판: 사람이 멈춘 때
  const apiError = kind === 'claude' ? foldApiError(lines, st.apiError || null) : null; // macOS 판: API 오류로 끊긴 턴
  return { file, pos: st.pos + nl + 1, size: stat.size, model: r.model || null, effort: r.effort ?? null, ...(speed ? { speed } : {}), ...(interruptAt ? { interruptAt } : {}), ...(apiError ? { apiError } : {}) };
}

// Codex rollout 파일: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl. 새 날짜 폴더부터 본다(이어 가면 옛 파일에 덧붙는다)
export function findCodexRollout(home, id) {
  if (!home || !id) return null;
  const want = String(id).toLowerCase();
  const root = path.join(home, 'sessions');
  const ls = (d) => { try { return fs.readdirSync(d).sort().reverse(); } catch { return []; } };
  for (const y of ls(root)) for (const m of ls(path.join(root, y))) for (const d of ls(path.join(root, y, m))) {
    const dir = path.join(root, y, m, d);
    const hit = ls(dir).find((n) => n.toLowerCase().endsWith(`${want}.jsonl`) && n.startsWith('rollout-'));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

// pi 세션 파일: ~/.pi/agent/sessions/<폴더>/<시각>_<id>.jsonl
export function findPiSession(dir, id) {
  if (!dir || !id) return null;
  const want = `_${String(id).toLowerCase()}.jsonl`;
  let subs = []; try { subs = fs.readdirSync(dir); } catch { return null; }
  for (const s of subs) {
    let names = []; try { names = fs.readdirSync(path.join(dir, s)); } catch { continue; }
    const hit = names.find((n) => n.toLowerCase().endsWith(want));
    if (hit) return path.join(dir, s, hit);
  }
  return null;
}

// 띄운 값과 지금 값 → 보일 값. 모르는 것은 띄운 값
export function shownModel(launched = {}, now = null) {
  return { model: (now && now.model) || launched.model || null, effort: (now && now.effort) || launched.effort || null };
}

// P227: 하네스가 보여 준 모델 이름 → 명령줄 --model에 넣을 수 있는 이름. 모르면 null.
// Claude Code /model 출력은 표시 이름(`Fable 5.2`, `Opus 5.5 (1M context)`)이고 assistant 줄은 ID(claude-fable-5-2)다.
// 빈칸 없는 이름(ID, 별명, 프록시 모델 이름 x--y[1m])은 그대로, Claude 표시 이름은 ID로, 그 밖(빈칸 든 표시 이름)은 모른다
export function cliModelName(name) {
  const t = String(name || '').trim();
  if (!t) return null;
  if (!/\s/.test(t)) return t;
  const m = /^(opus|sonnet|haiku|fable)\s+(\d+)(?:\.(\d+))?(\s*\(1m context\))?$/i.exec(t);
  if (m) return `claude-${m[1].toLowerCase()}-${m[2]}${m[3] ? `-${m[3]}` : ''}${m[4] ? '[1m]' : ''}`;
  return null;
}

// P227: 판이 있던 대화를 다시 띄울 때(깨우기·되살리기·다시 열기) 넘길 모델과 노력 수준. 순수 함수.
// launched: 띄운 값 { model, effort }(s.model·s.effort, 하네스는 harnessPlan.model), now: 지금 값(s.rt.modelNow, 대화 기록에서 읽음)
// → { model, effort, from: { model: 'now'|'launched', effort: 'now'|'launched'|'none' } }
// - 모델: 지금 값이 띄운 값과 같은 모델이면 띄운 값(별명·[1m]을 지킨다), 다르면 지금 값(명령줄 이름으로 바꿀 수 없으면 띄운 값)
// - 노력 수준: 지금 값을 알면 그것. 모르는데 모델이 바뀌었으면 넘기지 않는다(옛 노력 수준을 새 모델에 억지로 붙이지 않는다.
//   Claude Code는 /model 고르기 창의 노력 수준을 기본값으로 저장하므로 넘기지 않으면 그 값을 쓴다). 모델이 그대로면 띄운 값
// - pi: 노력 수준(생각 수준)은 넘기지 않는다(띄울 때도 넘기지 않는다. 세션 파일이 갖고 있다). AGY·opencode는 부르지 않는다
export function resumeModel(kind, launched = {}, now = null) {
  const lm = (launched && launched.model) || null, le = (launched && launched.effort) || null;
  const nm = now && now.model ? (kind === 'claude' ? cliModelName(now.model) : String(now.model).trim() || null) : null;
  let model = lm, mFrom = 'launched';
  if (nm && !sameModel(lm, nm)) { model = nm; mFrom = 'now'; }
  if (kind === 'pi') return { model, effort: null, from: { model: mFrom, effort: 'none' } };
  const ne = now && now.effort ? String(now.effort) : null;
  if (ne) return { model, effort: ne, from: { model: mFrom, effort: 'now' } };
  if (mFrom === 'now') return { model, effort: null, from: { model: mFrom, effort: 'none' } };
  return { model, effort: le, from: { model: mFrom, effort: le ? 'launched' : 'none' } };
}

// 같은 모델을 다르게 쓴 이름인가(판 이벤트를 남길지): haiku ≈ claude-haiku-5-5 ≈ Haiku 5.5, Sonnet 5.5 ≈ claude-sonnet-5-5.
// 짧은 이름(별명)이 긴 이름의 앞 낱말이면 같다고 본다
const normModel = (m) => String(m || '').trim().toLowerCase().replace(/^[a-z0-9._-]+\//, '').replace(/^claude-/, '').replace(/\[.*\]$/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1');
export function sameModel(a, b) {
  const x = normModel(a), y = normModel(b);
  if (!x || !y) return !x && !y;
  return x === y || y.startsWith(`${x} `) || x.startsWith(`${y} `);
}
