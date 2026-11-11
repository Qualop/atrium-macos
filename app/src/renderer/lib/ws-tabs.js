// P98: 위 바의 워크스페이스 칩. 묶음(사람이 만든 가상 그룹 P44, 저절로 만든 폴더 묶음 P91)에 든 워크스페이스는 대표 칩 하나로 모은다.
// 순수 함수만 둔다(단위 시험 app/test/p98-lib.test.mjs).
// - 칩 순서는 워크스페이스 목록 순서이고, 묶음 칩은 그 묶음의 첫 구성이 있던 자리에 놓는다.
// - 판에 있는 구성이 둘 이상인 묶음만 모은다. 하나뿐이면 그 워크스페이스 칩 그대로다(펼칠 것이 없다).
// - 묶음 안 순서는 그룹의 구성 순서(사람이 정한 순서, 저절로 만든 묶음은 상대 경로 순)다.
import { workspaceCounts } from '../../../../backend/src/workspaces.mjs';

// workspaces: [{ key, … }], groups: [{ id, name, members, auto?, root? }]
// → [{ type: 'ws', key, w } | { type: 'group', id, name, auto, root, keys: [워크스페이스 키], ws: [워크스페이스] }]
export function wsTabs(workspaces, groups) {
  const list = (workspaces || []).filter((w) => w && w.key);
  const byKey = new Map(list.map((w) => [w.key, w]));
  const groupOf = new Map();
  for (const g of groups || []) {
    if (!g || !Array.isArray(g.members)) continue;
    const keys = g.members.filter((k) => byKey.has(k) && !groupOf.has(k));
    if (keys.length < 2) continue;
    const tab = { type: 'group', id: g.id, name: g.name, auto: !!g.auto, root: g.root || null, keys, ws: keys.map((k) => byKey.get(k)) };
    for (const k of keys) groupOf.set(k, tab);
  }
  const out = [];
  const placed = new Set();
  for (const w of list) {
    const g = groupOf.get(w.key);
    if (!g) { out.push({ type: 'ws', key: w.key, w }); continue; }
    if (placed.has(g.id)) continue;
    placed.add(g.id);
    out.push(g);
  }
  return out;
}

// 이전·다음 워크스페이스(←·→)의 순서: 칩 순서 그대로, 묶음 칩 자리에는 그 구성을 묶음 안 순서로 편다
export const tabKeys = (tabs) => (tabs || []).flatMap((t) => (t.type === 'group' ? t.keys : [t.key]));

// 워크스페이스 여럿의 세는 값 합(workspaceCounts와 같은 칸)
export function sumCounts(sessions, keys) {
  const c = { sessions: 0, working: 0, needsYou: 0, review: 0, shells: 0 };
  for (const k of keys || []) { const x = workspaceCounts(sessions, k); for (const f of Object.keys(c)) c[f] += x[f]; }
  return c;
}

// 지금 고른 워크스페이스가 든 칩(묶음 칩이면 그 묶음). 없으면 null
export const tabOf = (tabs, key) => (tabs || []).find((t) => (t.type === 'group' ? t.keys.includes(key) : t.key === key)) || null;

// 묶음 칩을 누르면 고를 워크스페이스: 지금 고른 것이 묶음 안이면 그대로, 아니면 그 묶음에서 마지막으로 고른 것, 그것도 없으면 첫 구성
export function groupPick(tab, current, last = null) {
  if (!tab || tab.type !== 'group' || !tab.keys.length) return null;
  if (tab.keys.includes(current)) return current;
  if (last && tab.keys.includes(last)) return last;
  return tab.keys[0];
}

// 묶음 칩에 작게 보일 안의 이름: 저절로 만든 묶음은 뿌리에서의 상대 경로(label), 그 밖은 워크스페이스 이름
export const memberLabel = (w) => (w && (w.label || w.name)) || '';
