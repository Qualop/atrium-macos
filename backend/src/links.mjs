// 세션끼리 연결(ARCH 4절 F, P4). 순수 함수만 둔다. 창(renderer)도 이 파일을 그대로 묶어 쓴다(node 모듈을 부르지 않는다).
//
// 판은 일을 시키지 않는다. 에이전트가 판의 atrium 명령(P116: atrium prompt|wait|read)으로 직접 시킨다. 판은 그 일을 선으로 보여준다.
// P116: atrium 명령은 판을 거치므로 판이 바로 남긴다(agent-verbs.mjs). P129: 셸 명령 글에서 옛 터미널 명령을 읽던 것(F1)은 없앴다.
// 받는 쪽의 상태와 새로 나타난 에이전트는 터미널 백엔드 이벤트로 본다.

// 셸 명령 글을 명령 단위(단어 목록)로 나눈다(지난 대화의 띄움 줄 읽기, spawns.mjs). bash와 PowerShell을 대충 함께 다룬다.
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
  let top = false;
  if (at > 0 && !L.slice(at + 1).some((l) => BULLET.test(l))) {
    let prev = -1;
    for (let i = at - 1; i >= 0; i--) if (PROMPT.test(L[i])) { prev = i; break; }
    if (prev >= 0) { end = at; at = prev; }
    // P136: 판은 에이전트 화면을 지금 화면만 읽는다(기록 읽기가 전체 화면 앱을 휠로 굴려 입력 칸에 찌꺼기를 남겼다). 긴 답이면 그 턴의
    // 프롬프트 줄이 화면 위로 지나가 없다. 그때는 입력 칸 위 화면 전체를 답의 끝 부분으로 본다(전에는 입력 칸 아래 상태 줄을 답으로 냈다)
    else { end = at; top = true; }
  }
  const body = (top ? L.slice(0, end) : at >= 0 ? L.slice(at + 1, end) : []).filter((l) => l.trim()).map((l) => l.replace(/^\s*[●•⏺]\s?/, ''));
  return body.length ? body.slice(-n).join('\n') : tailText(L.join('\n'), n);
}

// F2: 판에서 이은 연결을 A에게 알리는 글. 다음 지시("리뷰어에게 맡겨")를 알아듣도록 이름, 역할, 쓸 명령을 담는다.
// P116: 일 시키기·기다리기·읽기는 판의 atrium 명령이고 이름은 판의 세션 이름(name, 없으면 옛 호출의 agentName)이다. 패널 ID는 쓰지 않는다
export function roleNotice({ role, agentName, name = agentName, kind = 'claude' }) {
  return [
    `[Atrium 보드] 연결 알림: \`@${name}\`(종류 ${kind})가 너의 "${role}"이다.`,
    `앞으로 "${role}에게 맡겨"처럼 이 역할을 부르면, atrium 명령으로 이 에이전트에게 일을 시키고 답을 받아 와라.`,
    `일 시키기: atrium prompt ${name} "<할 일>" --wait`,
    `끝나기 기다리기: atrium wait ${name} · 화면 읽기: atrium read ${name}`,
    '이 알림에는 "알겠다"고만 답해라.',
  ].join('\n');
}
export function unlinkNotice({ role, agentName, name = agentName }) {
  return `[Atrium 보드] 연결 해제: \`@${name}\`는 더 이상 너의 "${role}"가 아니다. 이 역할로 일을 시키지 마라. 이 알림에는 "알겠다"고만 답해라.`;
}
// P116: 판은 이 알림을 보내지 않는다(이름으로 부르므로 패널이 바뀌어도 할 일이 없다). 옛 호출과 시험을 위해 글만 남긴다
export function paneChangedNotice({ role, agentName, name = agentName, paneId }) {
  return `[Atrium 보드] 연결 갱신: 너의 "${role}" \`@${name}\`의 터미널이 바뀌었다(${paneId}). 이름(${name})으로 부르면 그대로 된다. 이 알림에는 "알겠다"고만 답해라.`;
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
