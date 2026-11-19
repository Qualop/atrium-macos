// P164: 세션의 뒤 일(뒤 셸·뒤 하위 에이전트) 표시 판정. 세션 맵 PC(MissionLineage.jsx, 미리 보기 Peek 포함)·얇은 줄 판정(mission-lineage.js)이 같이 쓴다. 순수 함수
// 판의 요약·그래프 필드 background: { n, kinds: ['shell'|'agent'|'other'], items: [{ kind, label }], at } | null(backend sleep.mjs backgroundList)

// 등급(mission-model.js nodeTier): 작업 중(work)은 턴이 도는 빛이 있어 표시를 겹치지 않는다. 잠듦·끝남에는 뒤 일이 없다(판이 비운다)
const SHOW_TIERS = new Set(['rest', 'review', 'turn', 'alert']);

// 노드(그래프)나 판의 세션 요약에서 뒤 일을 고른다. 요약이 더 새것이라 먼저 본다
export function bgOf(n, live = null) {
  const g = live && live.background !== undefined ? live.background : (n && n.background) || null;
  return g && g.n > 0 ? g : null;
}

// 카드에 보일 뒤 일 { n, kinds, items } | null
export function bgShow(n, live, tier) {
  if (!SHOW_TIERS.has(tier)) return null;
  return bgOf(n, live);
}

// 뒤 일이 있는 세션은 얇은 줄(P163)로 줄이지 않는다
export const keepCard = (n, live = null) => !!bgOf(n, live);

// 카드 표시 글: "백그라운드 2". 풍선·aria에는 종류별 수 "셸 1 · 에이전트 1"
export function bgText(g, t) {
  if (!g) return '';
  return t('mmBg.badge', { n: g.n });
}
export function bgKindsText(g, t) {
  if (!g) return '';
  const c = {};
  for (const x of g.items && g.items.length ? g.items : (g.kinds || []).map((kind) => ({ kind }))) c[x.kind] = (c[x.kind] || 0) + 1;
  return Object.entries(c).map(([k, n]) => t('mmBg.kindN', { kind: t(`mmBg.kind.${k in KIND ? k : 'other'}`), n })).join(' · ');
}
const KIND = { shell: 1, agent: 1, other: 1 };
