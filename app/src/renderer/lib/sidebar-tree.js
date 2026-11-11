// P44 사이드바의 순수 함수(단위 시험 app/test/p44-lib.test.mjs). 세션이 200개를 넘어도 훑고 찾기 쉽게:
// - 그룹 → 워크스페이스 → 세션의 나무를 줄 높이가 정해진 평평한 줄 목록으로 편다(가상 스크롤이 보이는 줄만 그린다).
// - 접힌 그룹·워크스페이스 아래에도 사람이 봐야 하는 세션(응답 필요, 오류)은 줄로 남긴다.
// - 거르기: 글(이름, 요청, 질문 등), 상태 묶음, 종류. 거르는 동안에는 접힘을 무시하고 맞는 것만 보인다.
// - 닫힌 세션과 판 밖 대화는 워크스페이스마다 한 줄(닫힘 n · 대화 m)로 접어 두고, 펼치면 SECTION_STEP씩 보인다.
import { matches, sidebarRows, SECTION_STEP } from './sidebar.js';
import { treeOrder, spawnOrder } from './branch.js';
import { askLine } from './labels.js';

// 줄 높이(px). 창의 CSS(sidebar.css .mt-sb2-*)와 같아야 한다
export const ROW_H = { group: 30, ws: 28, session: 28, attn: 44, extra: 24, sec: 22, closed: 28, convo: 28, more: 24, empty: 26 };
export const ATTN_CAP = 6; // 접힌 묶음 아래에 남기는 사람이 봐야 하는 세션 수(넘으면 "n개 더")
// P103: 나무 단계(들여쓰기와 세로 안내선 수). 그룹 → 워크스페이스 → 세션 → 그 하위 세션(최대 MAX_INDENT단계 더),
// 닫힌 세션·판 밖 대화 펼침 줄은 세션과 같은 단계, 그 아래 절 이름과 항목은 한 단계 더
export const MAX_INDENT = 4;
export const TREE = { pad: 8, step: 16 }; // 줄 왼쪽 여백과 단계마다 들여쓰기(px). sidebar.css의 안내선과 같아야 한다
export function levelOf(r) {
  const d = r.depth || 0;
  switch (r.type) {
    case 'session': return d + Math.min(r.indent || 0, MAX_INDENT);
    case 'sec': case 'closed': case 'convo': return d + 1;
    case 'more': return r.pinMore ? d : d + 1;
    default: return d;
  }
}

// P103: 머리줄(그룹·워크스페이스) 오른쪽의 상태 수. 응답 필요·오류는 늘 보이고, 작업 중은 접혔을 때만(펼치면 세션 줄의 점이 말한다).
// 안에 든 수(그룹은 워크스페이스 수, 워크스페이스는 세션 수)는 이름 옆에 옅게 따로 둔다
export function headBadges(c, open) {
  return { need: (c && c.need) || 0, error: (c && c.error) || 0, working: open ? 0 : (c && c.working) || 0 };
}

// 상태 묶음: 거르기 칩과 세는 값에 쓴다
export function bucketOf(s) {
  const st = s && s.state;
  if (st === 'waiting' || st === 'trust_wait') return 'need';
  if (st === 'error' || st === 'exited') return 'error';
  if (st === 'working' || st === 'shell_running' || st === 'starting') return 'working';
  if (st === 'sleeping') return 'sleeping';
  return 'idle';
}
export const BUCKETS = ['need', 'error', 'working', 'idle', 'sleeping'];
export const isAttn = (s) => { const b = bucketOf(s); return b === 'need' || b === 'error'; };
// 종류 거르기: claude, shell, 그 밖(codex 등은 그 이름)
export const kindOf = (s) => (s && s.flavor) || (s && s.kind) || 'claude';

const sessionFields = (s) => [`@${s.name}`, s.name, s.kind, s.flavor, s.lastPrompt, s.lastAnswer, askLine(s), s.branch && s.branch.role];

// 세는 값: 세션 목록 → { sessions, need, error, working, sleeping }
export function countOf(list) {
  const c = { sessions: 0, need: 0, error: 0, working: 0, idle: 0, sleeping: 0 };
  for (const s of list) { c.sessions++; c[bucketOf(s)]++; }
  return c;
}

// 그룹 묶음 순서: 그룹(사람이 정한 순서, 안의 워크스페이스도 그 순서) → 그룹 없음(판의 워크스페이스 순서)
export function groupLayout(workspaces = [], groups = []) {
  const byKey = new Map(workspaces.map((w) => [w.key, w]));
  const used = new Set();
  const out = [];
  for (const g of groups || []) {
    const ws = (g.members || []).map((k) => byKey.get(k)).filter(Boolean);
    ws.forEach((w) => used.add(w.key));
    out.push({ id: g.id, name: g.name, workspaces: ws });
  }
  const rest = workspaces.filter((w) => !used.has(w.key));
  return { groups: out, ungrouped: rest };
}

// opts: { workspaces, groups, sessions(배열), data(recall.list: { workspaces: [{ key, closed, convos, archived }] }),
//         collapsed: { [ws키 | 'g:'+그룹ID]: true }, extra: { [ws키]: true }(닫힘·대화 펼침), more: { [ws키|칸]: n },
//         filter: 글, states: Set(묶음), kind: '' | 종류, selecting }
// → { rows: [{ id, type, h, ... }], counts: 판 전체 세는 값, kinds: [종류], filtering }
export function buildRows(opts) {
  const { workspaces = [], groups = [], sessions = [], data = null, collapsed = {}, extra = {}, more = {}, filter = '', states = null, kind = '' } = opts || {};
  const textOn = !!String(filter || '').trim();
  const stateOn = !!(states && states.size);
  const filtering = textOn || stateOn || !!kind;
  const counts = countOf(sessions);
  const kinds = [...new Set(sessions.map(kindOf))].sort();
  const pass = (s) => (!stateOn || states.has(bucketOf(s))) && (!kind || kindOf(s) === kind) && (!textOn || matches(sessionFields(s), filter));
  const byWs = new Map();
  for (const s of sessions) { const k = s.workspaceKey || ''; if (!byWs.has(k)) byWs.set(k, []); byWs.get(k).push(s); }
  const dataBy = new Map(((data && data.workspaces) || []).map((w) => [w.key, w]));
  const at = (s) => Math.max(s.lastActivityAt || 0, s.createdAt || 0);
  const cmp = (a, b) => (isAttn(b) ? 1 : 0) - (isAttn(a) ? 1 : 0) || at(b) - at(a) || String(a.name).localeCompare(String(b.name));
  const rows = [];
  const push = (r) => { rows.push({ ...r, h: ROW_H[r.type], lv: levelOf(r) }); };
  const sessionRow = (s, depth, indent, pinned = false) => rows.push({ id: `s:${s.sessionId}`, type: 'session', h: isAttn(s) ? ROW_H.attn : ROW_H.session, s, depth, indent, pinned, attn: isAttn(s), lv: depth + Math.min(indent || 0, MAX_INDENT) });
  // 접힌 묶음 아래에 남기는 사람이 봐야 하는 세션
  const pinnedRows = (list, depth, key) => {
    const hot = list.filter(isAttn).sort(cmp);
    hot.slice(0, ATTN_CAP).forEach((s) => sessionRow(s, depth, 0, true));
    if (hot.length > ATTN_CAP) push({ id: `pm:${key}`, type: 'more', depth, key: `pin:${key}`, n: hot.length - ATTN_CAP, pinMore: true });
  };
  const wsBlock = (w, depth) => {
    const all = byWs.get(w.key) || [];
    const shown = filtering ? all.filter(pass) : all;
    const d = dataBy.get(w.key);
    const closedAll = (d && d.closed) || [], convosAll = (d && d.convos) || [];
    // 닫힌 세션과 판 밖 대화는 글로 거를 때만 함께 거른다(상태·종류 칩은 판 세션만 고른다)
    const rest = stateOn || kind ? { closed: [], convos: [] } : sidebarRows({ closed: closedAll, convos: convosAll, filter: textOn ? filter : '' });
    if (filtering && !shown.length && !rest.closed.length && !rest.convos.length) return 0;
    const c = countOf(all);
    const open = filtering || !collapsed[w.key];
    push({ id: `w:${w.key}`, type: 'ws', depth, w, c, open, closedN: closedAll.length, convosN: convosAll.length, archived: (d && d.archived) || 0, matched: filtering ? shown.length : null });
    if (!open) { pinnedRows(all, depth + 1, w.key); return 1; }
    const tree = treeOrder([...shown].sort(cmp), { cmp, kidCmp: spawnOrder((s) => (s.branch && s.branch.order) || null, (s) => s.createdAt, cmp) }); // P75: 하위 세션은 띄운 순서
    for (const { item, indent } of tree) sessionRow(item, depth + 1, indent);
    if (!shown.length && !rest.closed.length && !rest.convos.length && !filtering) push({ id: `e:${w.key}`, type: 'empty', depth: depth + 1, key: w.key });
    const nClosed = rest.closed.length, nConvos = rest.convos.length;
    if (nClosed || nConvos) {
      const xOpen = textOn || !!extra[w.key];
      push({ id: `x:${w.key}`, type: 'extra', depth: depth + 1, key: w.key, open: xOpen, closedN: nClosed, convosN: nConvos });
      if (xOpen) {
        for (const [kindKey, list, type] of [['closed', rest.closed, 'closed'], ['convos', rest.convos, 'convo']]) {
          if (!list.length) continue;
          push({ id: `h:${w.key}|${kindKey}`, type: 'sec', depth: depth + 1, key: w.key, sec: kindKey, n: list.length });
          const n = (textOn ? Math.max(50, SECTION_STEP) : SECTION_STEP) + (more[`${w.key}|${kindKey}`] || 0);
          for (const x of list.slice(0, n)) push({ id: `${type === 'closed' ? 'c' : 'v'}:${x.sessionId || x.convId}`, type, depth: depth + 1, x, ws: w.key });
          if (list.length > n) push({ id: `m:${w.key}|${kindKey}`, type: 'more', depth: depth + 1, key: `${w.key}|${kindKey}`, n: list.length - n });
        }
      }
    }
    return 1;
  };
  const lay = groupLayout(workspaces, groups);
  for (const g of lay.groups) {
    const gk = `g:${g.id}`;
    const all = g.workspaces.flatMap((w) => byWs.get(w.key) || []);
    const open = filtering || !collapsed[gk];
    const start = rows.length;
    push({ id: gk, type: 'group', depth: 0, g, c: countOf(all), open, wsN: g.workspaces.length });
    if (!open) { pinnedRows(all, 1, gk); continue; }
    let any = 0;
    for (const w of g.workspaces) any += wsBlock(w, 1);
    if (filtering && !any) rows.length = start; // 거를 때 맞는 것이 없는 그룹은 뺀다
    else if (!g.workspaces.length) push({ id: `ge:${g.id}`, type: 'empty', depth: 1, group: g.id });
  }
  if (lay.ungrouped.length) {
    const start = rows.length;
    if (lay.groups.length) push({ id: 'g:', type: 'group', depth: 0, g: { id: null, name: null }, c: countOf(lay.ungrouped.flatMap((w) => byWs.get(w.key) || [])), open: true, wsN: lay.ungrouped.length, none: true });
    let any = 0;
    for (const w of lay.ungrouped) any += wsBlock(w, lay.groups.length ? 1 : 0);
    if (filtering && !any) rows.length = start;
  }
  return { rows, counts, kinds, filtering };
}

// 가상 스크롤: 줄 높이 목록과 스크롤 자리 → 그릴 범위
export function offsetsOf(rows) {
  const off = new Array(rows.length + 1);
  off[0] = 0;
  for (let i = 0; i < rows.length; i++) off[i + 1] = off[i] + rows[i].h;
  return off;
}
export function windowOf(off, scrollTop, viewH, overscan = 6) {
  const n = off.length - 1;
  if (n <= 0) return { start: 0, end: 0, total: 0 };
  // 이진 탐색: scrollTop이 든 줄
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (off[mid] <= scrollTop) lo = mid; else hi = mid - 1; }
  let end = lo;
  while (end < n && off[end] < scrollTop + viewH) end++;
  return { start: Math.max(0, lo - overscan), end: Math.min(n, end + overscan), total: off[n] };
}
// 줄 하나가 보이게 하는 scrollTop(이미 보이면 그대로)
export function scrollFor(off, i, scrollTop, viewH) {
  if (i < 0 || i >= off.length - 1) return scrollTop;
  const top = off[i], bot = off[i + 1];
  if (top < scrollTop) return top;
  if (bot > scrollTop + viewH) return bot - viewH;
  return scrollTop;
}

// 키보드 이동: 고를 수 있는 줄(머리줄, 세션, 닫힘·대화, 펼침 줄)만 밟는다
const FOCUSABLE = new Set(['group', 'ws', 'session', 'extra', 'closed', 'convo', 'more']);
export function moveCursor(rows, id, dir) {
  const ok = rows.map((r, i) => (FOCUSABLE.has(r.type) ? i : -1)).filter((i) => i >= 0);
  if (!ok.length) return null;
  const at = rows.findIndex((r) => r.id === id);
  if (dir === 'home') return rows[ok[0]].id;
  if (dir === 'end') return rows[ok[ok.length - 1]].id;
  if (at < 0) return rows[dir < 0 ? ok[ok.length - 1] : ok[0]].id;
  const pos = ok.findIndex((i) => i >= at);
  const cur = pos < 0 ? ok.length - 1 : ok[pos] === at ? pos : dir > 0 ? pos - 1 : pos;
  const next = Math.max(0, Math.min(ok.length - 1, cur + (dir > 0 ? Math.ceil(dir) : Math.floor(dir))));
  return rows[ok[next]].id;
}
// ←: 펼친 머리줄이면 접고, 아니면 위쪽 머리줄(워크스페이스 → 그룹)로
export function parentOf(rows, id) {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const d = rows[i].depth;
  for (let j = i - 1; j >= 0; j--) if ((rows[j].type === 'ws' || rows[j].type === 'group') && rows[j].depth < d) return rows[j].id;
  return null;
}

// 끌어 놓기: 워크스페이스 줄을 놓은 자리 → { group(null이면 그룹 없음), index }. 대상이 그룹 머리줄이면 그 그룹 끝, 워크스페이스 줄이면 그 앞(아래 절반이면 뒤)
export function dropTarget(groups, target, { after = false } = {}) {
  if (!target) return null;
  if (target.type === 'group') return { group: target.groupId ?? null, index: null };
  if (target.type === 'ws') {
    const g = (groups || []).find((x) => (x.members || []).includes(target.wsKey));
    if (!g) return { group: null, index: null };
    const i = g.members.indexOf(target.wsKey);
    return { group: g.id, index: i + (after ? 1 : 0) };
  }
  return null;
}
// 같은 그룹 안에서 아래로 옮기면 빼는 만큼 자리가 당겨진다
export function adjustIndex(groups, wsKey, to) {
  if (!to || to.group == null || to.index == null) return to;
  const g = (groups || []).find((x) => x.id === to.group);
  if (!g) return to;
  const from = g.members.indexOf(wsKey);
  return from >= 0 && from < to.index ? { ...to, index: to.index - 1 } : to;
}

// 새 그룹 이름: "새 그룹", "새 그룹 2", …(이미 있는 이름을 피한다)
export function freshGroupName(groups, base) {
  const taken = new Set((groups || []).map((g) => String(g.name).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return `${base} ${Date.now()}`;
}

// 사이드바 폭
export const SIDE_W = { min: 240, max: 640, def: 340 };
export const clampWidth = (w) => (Number.isFinite(Number(w)) ? Math.round(Math.max(SIDE_W.min, Math.min(SIDE_W.max, Number(w)))) : SIDE_W.def);
