// 대화끼리의 띄움 관계(P13, BRIEF "판 밖 대화", ARCH 5절 "판 밖 대화 노드·missed"). 순수 함수만 둔다(node 모듈을 부르지 않는다).
// 한 대화의 셸 도구 호출(Bash, PowerShell, 터미널 MCP의 run_in_terminal 등 input.command가 글인 호출) 명령 글에서 새 claude를 띄운 줄을 찾고,
// 그 뒤 짧은 시간 안에 시작한 다른 대화가 워크트리 이름·폴더나 첫 지시 글에 맞으면 그 대화를 하위로 본다. 기록만으로 알 수 있는 것만 쓴다.
// - 띄움 명령: `claude … -w|--worktree <이름>`, `herdr agent start <이름>`(뒤따르는 `herdr agent prompt <이름> "…"`가 첫 지시), `atrium child|spawn`(옛 이름 mtask도.
//   P116: --prompt 없이 띄웠으면 뒤따르는 `atrium prompt <이름> "…"`가 첫 지시)
// - 글은 판 기록에 옮기지 않는다. 첫 지시는 앞 40자의 해시(promptKey)만 둔다
import { splitCommands } from './links.mjs';

export const SPAWN_WINDOW_MS = 120000; // 띄운 뒤 이 안에 시작한 대화만 맞춘다(claude가 뜨고 첫 지시를 받기까지, P8 atrium child는 준비까지 기다린다)
export const SPAWN_EARLY_MS = 5000; // 기록 시각이 띄운 줄보다 조금 이를 수 있다(도구 호출 줄은 명령이 끝난 뒤 쓰이기도 한다)
export const HERDR_PROMPT_MS = 10 * 60 * 1000; // herdr agent start 뒤 이 안의 첫 agent prompt를 그 에이전트의 첫 지시로 본다
export const PROMPT_KEY_CHARS = 40;
export const SPAWN_KEEP = 200; // 대화 하나에 기억하는 띄움 줄 수(최근 것)

// 첫 지시의 열쇠: 따옴표·공백을 고르고 앞 40자를 해시한다(FNV-1a 두 번, 16진 12자리). 같은 글이면 같고, 글은 되돌릴 수 없다
export function promptKey(text) {
  let s = String(text || '').replace(/<\/?pasted_content[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!s) return null;
  s = s.slice(0, PROMPT_KEY_CHARS).toLowerCase();
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ (c + 31), 0x01000193) >>> 0; }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

const CLAUDE_WORD = /(^|[\\/])claude(\.exe|\.cmd|\.ps1)?$/i;
const CLI_WORD = /(^|[\\/])(atrium|mtask)(\.mjs|\.cmd|\.ps1)?$/i; // P18: atrium CLI와 옛 이름 mtask
const CHILD_SCRIPT = /(atrium|mtask)-child\.mjs$/i;
const MENTION = /claude|herdr|atrium|mtask/i;
// claude의 값 있는 플래그(값을 첫 지시로 잘못 읽지 않게)
const CLAUDE_VALUE_FLAGS = new Set(['--model', '--effort', '--settings', '--permission-mode', '--session-id', '--resume', '-r', '--append-system-prompt', '--append-system-prompt-file', '--system-prompt', '--system-prompt-file', '--plugin-dir', '--add-dir', '--allowedTools', '--allowed-tools', '--disallowedTools', '--disallowed-tools', '--mcp-config', '-n', '--name', '--agent', '--agents', '--fallback-model', '--output-format', '--input-format', '--max-turns', '--setting-sources', '--betas', '--debug-file', '--tools', '--permission-prompt-tool', '--json-schema', '--max-budget-usd']);
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const HERDR_WORD = /(^|[\\/])herdr(\.exe)?$/i;
const isHerdrWord = (x) => HERDR_WORD.test(x) || /^\$\{?(env:)?HERDR_BIN_PATH\}?$/i.test(x);
const GLOBAL_WITH_VALUE = new Set(['--session', '--machine', '--remote', '--remote-keybindings']);
const BOOL_FLAGS = new Set(['--wait', '--ansi', '--focus', '--no-focus', '--current', '--trust-repository', '--json', '--force', '--toggle', '--on', '--off', '--raw', '--verbose', '--clear', '--new-tab', '--new-workspace', '--takeover']);

// P129: 지난 대화 기록 속 옛 터미널(herdr) 명령을 읽는다(옛 기록 읽기. P4 links.mjs에서 옮겼다). 판의 세션은 이제 이 명령을 쓰지 않는다.
// boardSession: 판 전용 세션 이름. --session으로 다른 세션을, --machine·--remote로 다른 기계를 부른 호출은 foreign으로 표시한다.
export function parseHerdrCommands(command, { boardSession = null } = {}) {
  const out = [];
  for (const words of splitCommands(command)) {
    const at = words.findIndex(isHerdrWord);
    if (at < 0) continue;
    let i = at + 1;
    let foreign = false;
    while (i < words.length && words[i].startsWith('--') && GLOBAL_WITH_VALUE.has(words[i])) {
      const k = words[i], v = words[i + 1];
      if (k === '--session' ? v !== boardSession : true) foreign = true;
      i += 2;
    }
    const group = words[i], sub = words[i + 1];
    if (!group) continue;
    const pos = []; const flags = {}; let native = null;
    for (let j = i + 2; j < words.length; j++) {
      const x = words[j];
      if (x === '--') { native = words.slice(j + 1); break; }
      if (x.startsWith('--') && x.length > 2) {
        const eq = x.indexOf('=');
        if (eq > 0) { flags[x.slice(2, eq)] = x.slice(eq + 1); continue; }
        if (BOOL_FLAGS.has(x) || j + 1 >= words.length) { flags[x.slice(2)] = true; continue; }
        const k = x.slice(2);
        if (flags[k] !== undefined) flags[k] = [].concat(flags[k], words[++j]); else flags[k] = words[++j];
        continue;
      }
      pos.push(x);
    }
    const verb = `${group}.${(sub || '').replace(/-/g, '_')}`;
    const r = { verb, foreign, raw: words.slice(at).join(' ') };
    switch (verb) {
      case 'agent.prompt': Object.assign(r, { target: pos[0] || null, text: pos.slice(1).join(' '), wait: !!flags.wait, timeout: flags.timeout ? Number(flags.timeout) : null }); break;
      case 'agent.read': Object.assign(r, { target: pos[0] || null, source: flags.source || null, lines: flags.lines ? Number(flags.lines) : null }); break;
      case 'agent.wait': case 'agent.get': case 'agent.focus': case 'agent.attach': case 'agent.explain': Object.assign(r, { target: pos[0] || null }); break;
      case 'agent.send_keys': Object.assign(r, { target: pos[0] || null, keys: pos.slice(1) }); break;
      case 'agent.rename': Object.assign(r, { target: pos[0] || null, name: pos[1] || null }); break;
      case 'agent.start': Object.assign(r, { name: pos[0] || null, kind: flags.kind || null, pane: flags.pane || null, args: native || [] }); break;
      case 'pane.split': Object.assign(r, { pane: pos[0] || flags.pane || (flags.current ? 'current' : null), direction: flags.direction || null, cwd: flags.cwd || null }); break;
      case 'pane.run': Object.assign(r, { pane: pos[0] || null, text: pos.slice(1).join(' ') }); break;
      case 'pane.send_text': Object.assign(r, { pane: pos[0] || null, text: pos.slice(1).join(' ') }); break;
      case 'pane.close': case 'pane.read': Object.assign(r, { pane: pos[0] || null }); break;
      case 'worktree.create': case 'worktree.open': Object.assign(r, { branch: flags.branch || null, path: flags.path || null, cwd: flags.cwd || null, workspace: flags.workspace || null }); break;
      case 'workspace.create': Object.assign(r, { cwd: flags.cwd || null, label: flags.label || null }); break;
      default:
    }
    out.push(r);
  }
  return out;
}

// claude 실행 단어 목록(claude 다음부터) → { wt: 워크트리로 띄웠나, worktree: 이름(없을 수 있다), prompt: 첫 지시 }
export function parseClaudeArgs(args) {
  let worktree = null, wt = false, prompt = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-w' || a === '--worktree') { wt = true; const nx = args[i + 1]; if (nx != null && !nx.startsWith('-') && NAME_RE.test(nx)) { worktree = nx; i++; } continue; }
    if (a.startsWith('--worktree=')) { wt = true; worktree = a.slice(11) || null; continue; }
    if (a.startsWith('--') && a.includes('=')) continue;
    if (CLAUDE_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    if (prompt == null) prompt = a;
  }
  return { wt, worktree, prompt };
}

function cliArgs(args) {
  const flags = {}; const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { const k = a.slice(2); const nx = args[i + 1]; if (nx != null && !nx.startsWith('--') && !['json', 'no-wait', 'wait', 'yes', 'allow-herdr', 'dev'].includes(k)) { flags[k] = nx; i++; } else flags[k] = true; continue; }
    pos.push(a);
  }
  return { flags, pos };
}

// 셸 명령 글 하나 → 띄움 줄 목록 [{ via, name?, worktree?, cwd?, promptKey?, kind: 'start' | 'prompt' }]
// 따옴표 안의 글(powershell -Command "…", herdr pane run p "…", Start-Process … -ArgumentList '…')도 한 단계 더 풀어 본다
export function spawnsInCommand(command, { depth = 0 } = {}) {
  const out = [];
  const src = String(command || '');
  if (!MENTION.test(src)) return out;
  for (const words of splitCommands(src)) {
    // claude … -w 이름
    const ci = words.findIndex((w) => CLAUDE_WORD.test(w));
    if (ci >= 0) { const c = parseClaudeArgs(words.slice(ci + 1)); if (c.wt) out.push({ kind: 'start', via: 'claude', worktree: c.worktree, name: c.worktree, promptKey: promptKey(c.prompt) }); }
    // atrium child|spawn(옛 이름 mtask도 같다. via는 atrium-child|atrium-spawn)
    let sub = null, rest = null;
    const mi = words.findIndex((w) => CLI_WORD.test(w));
    const ki = words.findIndex((w) => CHILD_SCRIPT.test(w));
    if (mi >= 0) { let j = mi + 1; while (j < words.length && words[j] === '--dev') j++; sub = words[j]; rest = words.slice(j + 1); }
    else if (ki >= 0) { const w = words[ki + 1]; sub = w === 'child' ? 'child' : ['children', 'child-kill'].includes(w) ? w : 'child'; rest = words.slice(ki + (w === 'child' ? 2 : 1)); } // shim이 부르는 꼴: node …/atrium-child.mjs child <이름>
    {
      if (sub === 'child' || sub === 'spawn') {
        const { flags, pos } = cliArgs(rest);
        const cwd = sub === 'spawn' ? pos[0] || null : typeof flags.cwd === 'string' ? flags.cwd : null;
        const worktree = typeof flags.worktree === 'string' ? flags.worktree : null;
        out.push({ kind: 'start', via: `atrium-${sub}`, name: (sub === 'child' ? pos[0] : flags.name) || worktree || null, worktree, cwd, promptKey: promptKey(typeof flags.prompt === 'string' ? flags.prompt : null) });
      }
      // P116: atrium prompt <이름> "<글>"(atrium child를 첫 요청 없이 띄운 뒤의 첫 지시)
      if (sub === 'prompt' && mi >= 0) {
        const { flags, pos } = cliArgs(rest);
        if (pos[0] && typeof flags.file !== 'string') out.push({ kind: 'prompt', via: 'atrium', name: String(pos[0]).replace(/^@/, ''), promptKey: promptKey(pos.slice(1).join(' ')) });
      }
    }
    // 따옴표 안의 명령 글(claude가 든 낱말)은 한 번 더 푼다
    if (depth < 2) for (const w of words) if (/\s/.test(w) && MENTION.test(w) && w !== src) out.push(...spawnsInCommand(w, { depth: depth + 1 }));
  }
  // herdr agent start / agent prompt / pane run
  for (const h of parseHerdrCommands(src)) {
    if (h.foreign) continue;
    if (h.verb === 'agent.start') {
      const inner = h.args && h.args.length ? parseClaudeArgs(h.args.slice(1)) : null; // -- 뒤는 에이전트 실행 명령(claude …)
      out.push({ kind: 'start', via: 'herdr', name: h.name || null, worktree: inner && inner.wt ? inner.worktree : null, promptKey: promptKey(inner && inner.prompt) });
    } else if (h.verb === 'agent.prompt' && h.target) out.push({ kind: 'prompt', via: 'herdr', name: h.target, promptKey: promptKey(h.text) });
  }
  // 같은 줄이 겹쳐 잡힌 것(바깥 글과 안의 글)을 하나로
  const seen = new Set();
  const viaHerdr = new Set(out.filter((s) => s.via === 'herdr' && s.kind === 'start').map((s) => `${s.worktree}|${s.promptKey}`));
  return out.filter((s) => !(s.via === 'claude' && viaHerdr.has(`${s.worktree}|${s.promptKey}`))).filter((s) => { const k = `${s.kind}|${s.via}|${s.name}|${s.worktree}|${s.promptKey}|${s.cwd || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// 대화 기록 줄 글(여러 줄) → 띄움 줄 [{ at, kind, via, name, worktree, cwd, toolCwd, promptKey }]. 사람 쪽 줄과 하위 에이전트 줄은 보지 않는다
export function spawnsInLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.includes('"tool_use"') || !MENTION.test(line)) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'assistant' || o.isSidechain || !o.message || !Array.isArray(o.message.content)) continue;
    const at = o.timestamp ? Date.parse(o.timestamp) : null;
    if (!at) continue;
    for (const p of o.message.content) {
      if (!p || p.type !== 'tool_use' || !p.input || typeof p.input.command !== 'string') continue;
      for (const s of spawnsInCommand(p.input.command)) out.push({ at, ...s, toolCwd: typeof p.input.cwd === 'string' ? p.input.cwd : null });
    }
  }
  return out;
}

const keyOf = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
const isWorktreeOf = (cwd, name) => !!name && keyOf(cwd).endsWith(`/.claude/worktrees/${String(name).toLowerCase()}`);

// 띄움 맞추기. convos: [{ convId, cwd, startAt, promptKey, spawns: [...] }] → Map 자식 대화 ID → { parent, at, via, name, by: 'worktree' | 'cwd' | 'prompt' }
// 띄움 하나에 자식 하나, 자식 하나에 부모 하나. 띄운 시각과 자식 시작이 가까운 쌍부터 정한다. 자기 자신은 자식이 될 수 없다
export function matchSpawns(convos, { windowMs = SPAWN_WINDOW_MS, earlyMs = SPAWN_EARLY_MS } = {}) {
  const starts = [];
  for (const c of convos) {
    const list = Array.isArray(c.spawns) ? c.spawns : [];
    for (const s of list) {
      if (s.kind !== 'start') continue;
      const tries = [{ at: s.at, promptKey: s.promptKey }];
      // 그 에이전트에 처음 보낸 지시(herdr agent prompt, P116: atrium child를 첫 요청 없이 띄운 뒤의 atrium prompt)
      if (s.name && (s.via === 'herdr' || (s.via === 'atrium-child' && !s.promptKey))) {
        const p = list.find((x) => x.kind === 'prompt' && x.name === s.name && x.at >= s.at && x.at - s.at <= HERDR_PROMPT_MS);
        if (p) tries.push({ at: p.at, promptKey: p.promptKey });
      }
      starts.push({ parent: c.convId, s, tries });
    }
  }
  if (!starts.length) return new Map();
  const pairs = [];
  for (const st of starts) {
    for (const c of convos) {
      if (c.convId === st.parent || !c.startAt) continue;
      for (const t of st.tries) {
        const d = c.startAt - t.at;
        if (d < -earlyMs || d > windowMs) continue;
        // 워크트리 이름이 있는 띄움은 그 워크트리 폴더의 대화만 자식이다(첫 지시가 같아도 다른 폴더면 아니다)
        let by = null;
        if (st.s.worktree) { if (isWorktreeOf(c.cwd, st.s.worktree)) by = 'worktree'; }
        else if (st.s.cwd && c.cwd && keyOf(st.s.cwd) === keyOf(c.cwd)) by = 'cwd';
        else if (t.promptKey && c.promptKey && t.promptKey === c.promptKey) by = 'prompt';
        if (by) { pairs.push({ child: c.convId, parent: st.parent, st, at: st.s.at, d: Math.abs(d), by }); break; }
      }
    }
  }
  const STRENGTH = { worktree: 0, prompt: 1, cwd: 2 }; // 폴더만 맞는 것은 같은 폴더의 다른 대화일 수 있어 가장 약하다
  pairs.sort((a, b) => STRENGTH[a.by] - STRENGTH[b.by] || a.d - b.d || a.at - b.at);
  const out = new Map(), used = new Set();
  for (const p of pairs) {
    if (out.has(p.child) || used.has(p.st)) continue;
    out.set(p.child, { parent: p.parent, at: p.at, via: p.st.s.via, name: p.st.s.name || p.st.s.worktree || null, by: p.by });
    used.add(p.st);
  }
  return out;
}
