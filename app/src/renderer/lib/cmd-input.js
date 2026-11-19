// P142: 아래 명령 바 입력칸의 순수 함수(단위 시험 test/p142-lib.test.mjs).
// - @태그 가르기: 글 앞머리의 @이름 묶음이 받는 세션이다(백엔드 text.mjs parseTargets와 같은 규칙). 글 중간의 @이름은 받는 세션이 아니다
// - 받는 세션 목록: 앞머리 태그를 판의 세션에 맞춰 본다(있음·@all·없음·셸)
// - 줄바꿈 키: Shift+Enter와 Alt+Enter
// - 높이: 그려진 글 높이(꺾인 줄 포함)로 늘고, 상한(줄 수·창 높이)에 닿으면 안쪽만 스크롤된다

// 백엔드 parseTargets와 같은 앞머리: 공백, 그리고 (@이름 공백*)의 반복
const LEAD_RE = /^\s*((?:@[^\s@]+\s*)+)/;
const TOKEN_RE = /@[^\s@]+/g;

const lc = (s) => String(s ?? '').toLowerCase();

// ref(@ 뺀 이름)를 판 세션에서 찾는다. 백엔드 findSession처럼 이름, 옛 주소(P66), 라벨을 본다
export function findTarget(ref, sessions) {
  const key = String(ref ?? '').replace(/^@/, '');
  if (!key) return null;
  const list = [...(sessions || [])];
  const k = lc(key);
  return list.find((s) => s.sessionId === key)
    || list.find((s) => s.name === key)
    || list.find((s) => s.address && s.address === key)
    || list.find((s) => s.label && s.label === key)
    || list.find((s) => lc(s.name) === k || (s.address && lc(s.address) === k) || (s.label && lc(s.label) === k))
    || null;
}

// 한 태그의 상태. 'all' | 'ok' | 'shell'(셸은 받지 않는다) | 'unknown'
export function tagState(ref, sessions) {
  const key = String(ref ?? '').replace(/^@/, '');
  if (key === 'all') return 'all';
  const s = findTarget(key, sessions);
  if (!s) return 'unknown';
  return s.kind === 'shell' ? 'shell' : 'ok';
}

// 글을 @태그 조각으로 가른다 → [{ start, end, ref, lead, state }]
// lead: 앞머리 묶음 안(받는 세션). 글 중간의 태그는 판에 있는 이름일 때만 'inline'으로 돌려준다(받지 않는다는 표시)
export function mentionTokens(text, sessions) {
  const s = String(text ?? '');
  const out = [];
  const m = s.match(LEAD_RE);
  const leadEnd = m ? m[0].length : 0;
  TOKEN_RE.lastIndex = 0;
  let t;
  while ((t = TOKEN_RE.exec(s))) {
    const start = t.index, end = start + t[0].length;
    const before = start === 0 ? '' : s[start - 1];
    if (before && !/\s/.test(before)) continue; // 메일 주소처럼 낱말 가운데의 @는 태그가 아니다
    const ref = t[0].slice(1);
    if (end <= leadEnd) out.push({ start, end, ref, lead: true, state: tagState(ref, sessions) });
    else {
      const st = tagState(ref, sessions);
      if (st !== 'unknown') out.push({ start, end, ref, lead: false, state: 'inline' });
    }
  }
  return out;
}

// 받는 세션 목록(앞머리 태그 차례, 같은 세션은 한 번) → [{ ref, name, state, count? }]
// count: @all이 받는 에이전트 수
export function recipients(text, sessions) {
  const list = [...(sessions || [])];
  const seen = new Set();
  const out = [];
  for (const tk of mentionTokens(text, list)) {
    if (!tk.lead) continue;
    if (tk.state === 'all') {
      if (seen.has('@all')) continue;
      seen.add('@all');
      out.push({ ref: tk.ref, name: 'all', state: 'all', count: list.filter((x) => x.kind !== 'shell').length });
      continue;
    }
    const one = tk.state === 'unknown' ? null : findTarget(tk.ref, list);
    const key = one ? 's:' + (one.sessionId ?? one.name) : 'u:' + tk.ref;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref: tk.ref, name: one ? one.name : tk.ref, state: tk.state });
  }
  return out;
}

// 글을 겹(mirror)에 그릴 조각으로 나눈다 → [{ text, tag? }] (tag: mentionTokens의 한 조각)
export function mirrorParts(text, tokens) {
  const s = String(text ?? '');
  const parts = [];
  let at = 0;
  for (const tk of tokens || []) {
    if (tk.start > at) parts.push({ text: s.slice(at, tk.start) });
    parts.push({ text: s.slice(tk.start, tk.end), tag: tk });
    at = tk.end;
  }
  if (at < s.length) parts.push({ text: s.slice(at) });
  return parts;
}

// 줄바꿈 키인가: Shift+Enter, Alt+Enter(Ctrl·Meta와 함께면 아니다)
export function isNewlineKey(e) {
  if (!e || e.key !== 'Enter') return false;
  if (e.ctrlKey || e.metaKey) return false;
  return !!(e.shiftKey || e.altKey);
}

// 커서 자리(start~end)에 줄바꿈을 넣는다 → { text, caret }
export function insertNewline(text, start, end) {
  const s = String(text ?? '');
  const a = Math.max(0, Math.min(start ?? s.length, s.length));
  const b = Math.max(a, Math.min(end ?? a, s.length));
  return { text: s.slice(0, a) + '\n' + s.slice(b), caret: a + 1 };
}

// 높이 상한: 줄 수(지금의 6줄 → 3배 18줄)와 창 높이의 비율 가운데 작은 것. 한 줄보다 작아지지는 않는다
export const MAX_LINES = 18;
export const MAX_VIEW_RATIO = 0.42;
export function maxFieldHeight({ lineHeight, viewportHeight, maxLines = MAX_LINES, ratio = MAX_VIEW_RATIO }) {
  const byLines = lineHeight * maxLines;
  const byView = Number.isFinite(viewportHeight) && viewportHeight > 0 ? Math.floor(viewportHeight * ratio) : Infinity;
  return Math.max(lineHeight, Math.min(byLines, byView));
}

// 글칸 높이: 그려진 글 높이(contentHeight, 패딩 없는 scrollHeight)를 한 줄~상한 안에 둔다 → { height, scroll }
// scroll: 상한에 닿아 안쪽 스크롤이 필요한가
export function fieldHeight({ contentHeight, lineHeight, maxHeight }) {
  const min = lineHeight;
  const h = Math.max(min, Math.ceil(contentHeight || 0));
  if (h > maxHeight) return { height: maxHeight, scroll: true };
  return { height: h, scroll: false };
}

// P153: 세션 맵에서 카드를 누르면 받는 세션을 넣고 뺀다(단위 시험 test/p153-lib.test.mjs).
// 앞머리 @태그 이름들(@ 뺀 것, 차례대로)
export function leadTags(text) {
  const m = String(text ?? '').match(LEAD_RE);
  return m ? (m[1].match(TOKEN_RE) || []).map((x) => x.slice(1)) : [];
}
// P153 r6: 판 ↔ 세션 맵을 오갈 때 명령줄 글 정리(사용자 규칙). 태그만 있으면(글 없음) 카드 누르기로 생긴 것으로 보고 지운다.
// 태그와 글이 함께 있으면 그대로 둔다. 글만 있으면 그대로 둔다(더블클릭의 첫 클릭이 남긴 태그는 MissionLineage.jsx가 더블클릭을 알아보면 되돌린다)
export function switchText(text) {
  const s = String(text ?? '');
  const m = s.match(LEAD_RE);
  if (m && !s.slice(m[0].length).trim()) return '';
  return s;
}
// 앞머리 태그에 name이 있으면 빼고 없으면 끝에 더한다. 뒤의 글은 그대로. 태그가 남으면 "@a @b " 꼴로 끝이 공백 하나
export function toggleTag(text, name) {
  const s = String(text ?? '');
  const m = s.match(LEAD_RE);
  const tags = m ? (m[1].match(TOKEN_RE) || []).map((x) => x.slice(1)) : [];
  const rest = m ? s.slice(m[0].length) : s.replace(/^\s+/, '');
  const has = tags.some((x) => lc(x) === lc(name));
  const next = has ? tags.filter((x) => lc(x) !== lc(name)) : [...tags, name];
  return (next.length ? next.map((x) => `@${x}`).join(' ') + ' ' : '') + rest;
}

// P155: 태그 칩 한 번에 지우기(단위 시험 test/p155-lib.test.mjs). 커서가 칩 바로 뒤에서 Backspace, 바로 앞에서 Delete를 누르면
// 그 칩(@이름)과 뒤따르는 빈칸 하나를 통째로 지운다 → 지울 범위 { start, end } 또는 null(기본 동작).
// 칩은 겹에 그려지는 태그(mentionTokens) 가운데 판에 있는 이름·@all이다(앞머리의 없는 이름은 치는 중일 수 있어 뺀다).
// Backspace는 "@a |"처럼 칩 뒤 빈칸 하나 다음의 커서에서도 그 칩을 지운다(카드로 태그를 넣으면 커서가 거기 남는다).
// 고른 글이 있으면(start≠end) 기본 동작. 함께 지우는 빈칸은 ' ' 하나뿐이다(줄바꿈은 남긴다)
export function tagDeleteRange(text, start, end, key, tokens) {
  const s = String(text ?? '');
  if (start == null || start !== end) return null;
  const list = (tokens || []).filter((x) => x.state !== 'unknown'); // 판에 없는 이름(치는 중인 "@al", 오타)은 한 글자씩 고친다
  const span =(tk) => ({ start: tk.start, end: s[tk.end] === ' ' ? tk.end + 1 : tk.end });
  if (key === 'Backspace') {
    const tk = list.find((x) => x.end === start || (x.end + 1 === start && s[x.end] === ' '));
    return tk ? span(tk) : null;
  }
  if (key === 'Delete') {
    const tk = list.find((x) => x.start === start);
    return tk ? span(tk) : null;
  }
  return null;
}
