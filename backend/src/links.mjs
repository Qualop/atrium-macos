// 세션끼리 연결(ARCH 4절 F, P4). 순수 함수만 둔다. 창(renderer)도 이 파일을 그대로 묶어 쓴다(node 모듈을 부르지 않는다).
//
// 판은 일을 시키지 않는다. 에이전트가 herdr 스킬로 직접 시킨다. 판은 그 일을 알아채 선으로 보여준다.
// 알아채는 방법(docs/log/p4-links.md 보고 4절): 판이 띄운 Claude Code 세션의 hook(PreToolUse·PostToolUse)에서 셸 명령 글을 읽어
// `herdr agent prompt`, `herdr agent read`, `herdr agent start`, `herdr pane split` 같은 호출을 찾는다(누가, 누구에게, 무엇을).
// 받는 쪽의 상태와 새로 나타난 에이전트는 herdr 이벤트로 본다.

export const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// 셸 명령 글을 명령 단위(단어 목록)로 나눈다. bash와 PowerShell을 대충 함께 다룬다.
// 따옴표 밖의 &&, ||, ;, |, &, 줄바꿈에서 끊는다. 따옴표 안의 줄바꿈은 그대로 둔다. $(…)와 변수는 풀지 않는다.
export function splitCommands(src) {
  const cmds = [];
  let words = [];
  let w = null; // 지금 쌓는 단어(null이면 단어 밖)
  let q = null; // 따옴표 종류
  const push = () => { if (w !== null) { words.push(w); w = null; } };
  const end = () => { push(); if (words.length) cmds.push(words); words = []; };
  const s = String(src || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") { if (s[i + 1] === "'") { w += "'"; i++; } else q = null; } else w += c; continue; } // PowerShell은 ''가 '
    if (q === '"') {
      if (c === '"') { q = null; continue; }
      if ((c === '\\' || c === '`') && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) { w += s[++i]; continue; }
      w += c; continue;
    }
    if (c === "'" || c === '"') { q = c; if (w === null) w = ''; continue; }
    if (c === '\\' && i + 1 < s.length && s[i + 1] !== '\n') { if (w === null) w = ''; w += s[++i]; continue; }
    if (c === '\\' && s[i + 1] === '\n') { i++; continue; } // 줄 잇기
    if (c === '`' && s[i + 1] === '\n') { i++; continue; } // PowerShell 줄 잇기
    if (c === '\n' || c === ';' || c === '|' || c === '&') { end(); if ((c === '&' || c === '|') && s[i + 1] === c) i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { push(); continue; }
    if (w === null) w = '';
    w += c;
  }
  end();
  return cmds;
}

const HERDR_WORD = /(^|[\\/])herdr(\.exe)?$/i;
const isHerdrWord = (x) => HERDR_WORD.test(x) || /^\$\{?(env:)?HERDR_BIN_PATH\}?$/i.test(x);
const GLOBAL_WITH_VALUE = new Set(['--session', '--machine', '--remote', '--remote-keybindings']);
const BOOL_FLAGS = new Set(['--wait', '--ansi', '--focus', '--no-focus', '--current', '--trust-repository', '--json', '--force', '--toggle', '--on', '--off', '--raw', '--verbose', '--clear', '--new-tab', '--new-workspace', '--takeover']);

// 명령 글에서 herdr 호출을 찾아 뜻을 읽는다.
// boardSession: 판 전용 herdr 세션 이름. --session으로 다른 세션을, --machine·--remote로 다른 기계를 부른 호출은 foreign으로 표시한다(판은 보지 않는다).
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

// 일을 시키거나 띄우는 호출만(판이 선으로 보여줄 것)
export const LINK_VERBS = new Set(['agent.prompt', 'agent.read', 'agent.wait', 'agent.send_keys', 'agent.start', 'pane.split', 'pane.run', 'worktree.create', 'workspace.create']);

// PostToolUse의 셸 도구 결과(stdout)에서 herdr CLI의 JSON 응답들을 찾는다. JSON이 아닌 줄은 글로 모은다.
export function parseHerdrOutput(resp) {
  let text = '';
  if (typeof resp === 'string') text = resp;
  else if (resp && typeof resp === 'object') text = [resp.stdout, resp.output, resp.result, resp.stderr].filter((x) => typeof x === 'string').join('\n');
  const results = []; const plain = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}')) { try { const j = JSON.parse(t); results.push(j.result ?? j); continue; } catch {} }
    plain.push(line);
  }
  return { results, text: plain.join('\n').trim() };
}

// `herdr agent read` 결과의 글. CLI가 JSON으로 주면 그 안의 글을, 아니면 출력 그대로
export function readTextOf(out) {
  for (const r of out.results) { const t = r && (r.read ? r.read.text : r.text); if (typeof t === 'string') return t; }
  return out.text;
}

// 화면 글에서 마지막 몇 줄(빈 줄 빼고)
export function tailText(text, n = 12) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).slice(-n).join('\n');
}

// 화면 글에서 마지막 답 부분만. Claude Code 화면은 [대화] ──── ❯ 입력칸 ──── [아래 줄]이라 입력칸 위를 자르고,
// 마지막 사용자 줄(❯ 또는 ›로 시작) 뒤를 답으로 본다. 모르는 화면이면 끝 몇 줄을 준다.
const SEP = /^\s*[─━═-]{12,}\s*$/;
export function screenAnswerText(text, n = 20) {
  // ✻는 Claude Code의 턴 시간 줄, 앞이 30칸 넘게 빈 줄은 오른쪽에 붙인 상태 줄(◐ medium · /effort)
  let L = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => !/^\s*✻ /.test(l) && !/^\s{30,}\S/.test(l));
  const seps = L.map((l, i) => (SEP.test(l) ? i : -1)).filter((i) => i >= 0);
  if (seps.length >= 2 && seps[seps.length - 1] - seps[seps.length - 2] <= 6) L = L.slice(0, seps[seps.length - 2]);
  const PROMPT = /^\s*[❯›>]\s+\S/, BULLET = /^\s*[●•⏺]/;
  let at = -1, end = L.length;
  for (let i = L.length - 1; i >= 0; i--) if (PROMPT.test(L[i])) { at = i; break; }
  // P96: Codex(0.167)의 빈 입력칸은 안내문("› Ask Codex to do anything")이 든 프롬프트 줄이고 그 아래는 상태 줄뿐이다.
  // 마지막 프롬프트 줄 뒤에 답 머리표(•●⏺) 줄이 없고 그 위에 프롬프트 줄이 또 있으면, 마지막 줄을 입력칸으로 보고 그 위 턴을 읽는다
  if (at > 0 && !L.slice(at + 1).some((l) => BULLET.test(l))) {
    let prev = -1;
    for (let i = at - 1; i >= 0; i--) if (PROMPT.test(L[i])) { prev = i; break; }
    if (prev >= 0) { end = at; at = prev; }
  }
  const body = (at >= 0 ? L.slice(at + 1, end) : []).filter((l) => l.trim()).map((l) => l.replace(/^\s*[●•⏺]\s?/, ''));
  return body.length ? body.slice(-n).join('\n') : tailText(L.join('\n'), n);
}

// F2: 판에서 이은 연결을 A에게 알리는 글. 다음 지시("리뷰어에게 맡겨")를 알아듣도록 이름, 패널, 역할, 쓸 명령을 담는다.
// --session·--machine은 쓰지 않는다. 패널 안의 herdr 명령은 판 전용 세션에 붙는다(HERDR_SESSION, HERDR_SOCKET_PATH).
export function roleNotice({ role, agentName, paneId, kind = 'claude' }) {
  return [
    `[Atrium 보드] 연결 알림: herdr 에이전트 \`${agentName}\`(패널 ${paneId}, 종류 ${kind})가 너의 "${role}"이다.`,
    `앞으로 "${role}에게 맡겨"처럼 이 역할을 부르면, herdr 스킬로 이 에이전트에게 일을 시키고 답을 받아 와라.`,
    `일 시키기: herdr agent prompt ${agentName} "<할 일>" --wait`,
    `응답 읽기: herdr agent read ${agentName} --source recent-unwrapped --lines 80`,
    '이 알림에는 "알겠다"고만 답해라.',
  ].join('\n');
}
export function unlinkNotice({ role, agentName }) {
  return `[Atrium 보드] 연결 해제: herdr 에이전트 \`${agentName}\`는 더 이상 너의 "${role}"가 아니다. 이 역할로 일을 시키지 마라. 이 알림에는 "알겠다"고만 답해라.`;
}
export function paneChangedNotice({ role, agentName, paneId }) {
  return `[Atrium 보드] 연결 갱신: 너의 "${role}" \`${agentName}\`의 패널이 ${paneId}로 바뀌었다. 이름(${agentName})으로 부르면 그대로 된다. 이 알림에는 "알겠다"고만 답해라.`;
}

export const ROLE_RE = /^[^\n\r"`$\\]{1,40}$/;

// 노드 하나를 둘 빈자리. anchor(부모 노드) 오른쪽, 아래, 왼쪽, 위 순서로, 그다음 바깥 고리로 넓혀 간다. 다른 것과 겹치지 않는다(BRIEF 4절).
export function freeSlotNear(anchor, taken, size = { w: 720, h: 460 }, gap = 40) {
  const free = (x, y) => !taken.some((n) => x < n.x + n.w + gap && n.x < x + size.w + gap && y < n.y + n.h + gap && n.y < y + size.h + gap);
  const sx = size.w + gap, sy = size.h + gap;
  const ax = anchor.x + (anchor.w || size.w) + gap, ay = anchor.y;
  const order = [[0, 0], [-1, 1], [0, 1], [-2, 0], [-1, -1], [0, -1], [1, 0], [1, 1], [1, -1], [-2, 1], [-2, -1]];
  for (const [dx, dy] of order) { const x = ax + dx * sx, y = ay + dy * sy; if (free(x, y)) return { x, y }; }
  for (let r = 2; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = ax + dx * sx, y = ay + dy * sy;
    if (free(x, y)) return { x, y };
  }
  return { x: ax, y: ay + 12 * sy };
}

// F4: 같은 저장소의 세션끼리 관계. 워크트리 세션마다 선 하나를 본 저장소 쪽 세션(없으면 같은 저장소의 다른 워크트리 세션)으로 긋는다.
// 본 저장소 쪽 세션이 여럿이면 그 워크트리 세션과 이어진 세션, 그다음 가장 늦게 만든 세션을 고른다.
// sessions: [{ sessionId, createdAt, git: { isRepo, commonDir, isWorktree, root, branch } }], linked(a, b) → bool
export function repoEdges(sessions, linked = () => false) {
  const byRepo = new Map();
  for (const s of sessions) {
    const g = s.git;
    if (!g || !g.isRepo || !g.commonDir) continue;
    const k = g.commonDir.toLowerCase();
    if (!byRepo.has(k)) byRepo.set(k, []);
    byRepo.get(k).push(s);
  }
  const edges = [];
  for (const [repo, list] of byRepo) {
    const wts = list.filter((s) => s.git.isWorktree);
    if (!wts.length) continue;
    const mains = list.filter((s) => !s.git.isWorktree).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    wts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    wts.forEach((w, i) => {
      const same = mains.length ? mains : wts.slice(0, i);
      if (!same.length) return;
      const pick = same.find((m) => linked(m.sessionId, w.sessionId) || linked(w.sessionId, m.sessionId)) || same[mains.length ? 0 : same.length - 1];
      edges.push({ id: `repo:${pick.sessionId}:${w.sessionId}`, from: pick.sessionId, to: w.sessionId, repo, branch: w.git.branch || null, worktree: w.git.root || null });
    });
  }
  return edges;
}

// 연결선을 붙일 손잡이: 두 노드가 마주 보는 쪽(가로로 더 떨어졌으면 좌우, 아니면 위아래). 손잡이 ID는 t·r·b·l
export function facingSides(a, b) {
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  const gapX = Math.abs(dx) - (a.w + b.w) / 2, gapY = Math.abs(dy) - (a.h + b.h) / 2;
  if (gapX >= gapY) return dx >= 0 ? { sourceHandle: 'r', targetHandle: 'l' } : { sourceHandle: 'l', targetHandle: 'r' };
  return dy >= 0 ? { sourceHandle: 'b', targetHandle: 't' } : { sourceHandle: 't', targetHandle: 'b' };
}

// 선 위에 보이는 글: 역할, 마지막 지시 앞부분
export function linkLabel(link, max = 48) {
  const parts = [];
  if (link.role) parts.push(link.role);
  else if (link.spawned && !link.lastText) parts.push("세션 생성");
  if (link.lastText) { const t = String(link.lastText).replace(/\s+/g, ' ').trim(); parts.push(`"${t.length > max ? t.slice(0, max - 1) + '…' : t}"`); }
  return parts.join(' · ');
}
