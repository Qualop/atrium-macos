// P8(K4) 창 쪽 순수 규칙: 하위 세션 머리줄 글, 사이드바·미션 맵의 나무 순서(부모 아래에 자식, 들여 쓰기). 단위 시험이 있다(test/p8-lib.test.mjs).
// 세션 요약의 branch(백엔드 branch.mjs summaryExtra): { depth, parentSessionId, parentName, parentOpen, child, role, worktree, children }

import { t } from './i18n.js';

// 머리줄 글. atrium child로 만든 하위 세션만 "@lead의 워커 · 2단계". 판에 올린 에이전트(F3)는 지금처럼 "@x가 띄움"으로 둔다
export function branchLabel(s) {
  const b = s && s.branch;
  if (!b || !b.child) return null;
  const role = b.role || t('branch.child');
  // P75: 띄운 순서(같은 부모 안 번호)를 역할 뒤에 붙인다("@lead의 워커 3")
  const n = b.order || null;
  const who = n ? (b.parentName ? t('branchOrder.who', { parent: b.parentName, role, n }) : t('branchOrder.whoOrphan', { role, n }))
    : b.parentName ? t('branch.who', { parent: b.parentName, role }) : t('branch.whoOrphan', { role });
  const depth = t('branch.depth', { n: b.depth });
  return { text: `${who} · ${depth}`, short: depth, title: `${who}${t('branch.title')}${n ? t('branchOrder.title', { n }) : ''}${b.parentOpen ? '' : t('branch.parentClosed')}${b.worktree ? t('branch.worktree', { wt: b.worktree }) : ''}` };
}

// P75: 형제(같은 부모의 하위 세션)는 띄운 순서로. order(판이 띄울 때 남긴 번호), 없으면 띄운 때. 둘 다 같으면 rest
export const spawnOrder = (orderOf, bornOf, rest = () => 0) => (a, b) => (orderOf(a) ?? Infinity) - (orderOf(b) ?? Infinity) || (bornOf(a) || 0) - (bornOf(b) || 0) || rest(a, b);

// 나무 순서: 부모가 목록에 있으면 그 바로 아래에(형제끼리는 kidCmp, 없으면 cmp 순서), 없으면 뿌리. → [{ item, indent }]
// idOf·parentOf로 요약(sessionId, parentSessionId)과 미션 맵 노드(id, parentId) 모두에 쓴다. 고리는 끊는다
export function treeOrder(list, { cmp = () => 0, kidCmp = null, idOf = (x) => x.sessionId, parentOf = (x) => x.parentSessionId || null } = {}) {
  const ids = new Set(list.map(idOf));
  const kids = new Map();
  const roots = [];
  for (const x of list) {
    const p = parentOf(x);
    if (p && ids.has(p) && p !== idOf(x)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(x); } else roots.push(x);
  }
  const out = []; const seen = new Set();
  const walk = (x, indent) => {
    if (seen.has(idOf(x))) return;
    seen.add(idOf(x)); out.push({ item: x, indent });
    for (const k of (kids.get(idOf(x)) || []).sort(kidCmp || cmp)) walk(k, indent + 1);
  };
  for (const r of roots.sort(cmp)) walk(r, 0);
  for (const x of list) if (!seen.has(idOf(x))) walk(x, 0); // 고리에 든 것
  return out;
}
