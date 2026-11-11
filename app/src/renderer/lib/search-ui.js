// P61: 찾기 창(Search.jsx SearchBox)의 화면 판단. 순수 함수만 둔다(단위 시험 test/p61-lib.test.mjs).

// 찾기 창이 닫힐 때 위로 올라가며 흐려지는 시간(styles.css 끝 mt-search-out과 맞춘다). 움직임 줄이기면 바로 닫는다
export const SEARCH_LEAVE_MS = 150;

// 결과 종류마다 아이콘(lib/icons.jsx 이름)
export const KIND_ICON = { session: 'terminal', workspace: 'folder', memo: 'note', kanban: 'kanban' };
export const kindIcon = (kind) => KIND_ICON[kind] || 'search';

// 찾는 말(빈칸으로 나눈 낱말들)이 text 안에서 맞는 곳을 조각으로 나눈다. 대소문자는 가리지 않고, 겹치거나 붙은 곳은 하나로 합친다.
// → [{ text, hit }] (이어 붙이면 text 그대로)
export function markRanges(text, q) {
  const s = String(text ?? '');
  const terms = [...new Set(String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean))];
  if (!s || !terms.length) return s ? [{ text: s, hit: false }] : [];
  const low = s.toLowerCase();
  const spans = [];
  for (const term of terms) {
    for (let i = low.indexOf(term); i >= 0; i = low.indexOf(term, i + term.length)) spans.push([i, i + term.length]);
  }
  if (!spans.length) return [{ text: s, hit: false }];
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const sp of spans) {
    const last = merged[merged.length - 1];
    if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
    else merged.push([...sp]);
  }
  const out = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: s.slice(at, a), hit: false });
    out.push({ text: s.slice(a, b), hit: true });
    at = b;
  }
  if (at < s.length) out.push({ text: s.slice(at), hit: false });
  return out;
}

// 줄의 필드 이름을 따로 보일지: 종류 표시와 같은 말이면(메모의 '메모', 프로젝트의 '프로젝트') 한 번만 보인다
export const showField = (fieldText, kindText) => !!fieldText && String(fieldText).trim().toLowerCase() !== String(kindText || '').trim().toLowerCase();

// 줄 둘째 줄의 글(snippet)을 보일지: 이름과 같은 글이면(칸반 제목이 맞은 때) 되풀이하지 않는다
export const showSnip = (snippet, name) => !!String(snippet ?? '').trim() && String(snippet).trim().toLowerCase() !== String(name ?? '').trim().toLowerCase();

// 위아래 키로 고른 줄을 옮긴다(끝에서 처음으로 돈다). n이 0이면 0
export function movePick(pick, n, dir) {
  if (!n) return 0;
  return ((pick + (dir > 0 ? 1 : -1)) % n + n) % n;
}
