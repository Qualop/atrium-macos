// P66: 판의 이름(표시 이름). 세션 요약의 name은 보이는 이름(판의 이름이 있으면 그것), address는 에이전트가 쓰는 주소(herdr 이름), label은 사람이 정한 이름이다.
// 백엔드 규칙(backend/src/session-label.mjs)과 같다. 창은 보내기 전에 미리 보고 이유를 바로 보인다. 확정은 백엔드가 한다.
export const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export const LABEL_MAX = 32;
const lc = (x) => String(x ?? '').toLowerCase();

export const addressOf = (s) => (s ? s.address || s.name : '');
export const renamed = (s) => !!(s && s.label && s.address && s.address !== s.name);

// 입력한 새 이름을 미리 본다 → { ok: true, label: 글 | null(원래 이름) } | { ok: false, key, vars }(사전 backend.<key>)
export function checkLabel(value, sessions, self) {
  const raw = String(value ?? '').trim().replace(/^@/, '');
  if (!raw || (self && raw === addressOf(self))) return { ok: true, label: null };
  if (raw.length > LABEL_MAX) return { ok: false, key: 'labelTooLong', vars: { max: LABEL_MAX } };
  if (!LABEL_RE.test(raw)) return { ok: false, key: 'labelBad', vars: { name: raw } };
  if (lc(raw) === 'all') return { ok: false, key: 'labelAll', vars: { name: raw } };
  const k = lc(raw);
  for (const s of sessions) {
    if (self && s.sessionId === self.sessionId) continue;
    if (lc(addressOf(s)) === k || (s.label && lc(s.label) === k)) return { ok: false, key: 'labelTaken', vars: { name: raw, other: s.name } };
  }
  return { ok: true, label: raw };
}

// 바꾼 것이 없는가(같은 이름을 다시 쳤거나, 원래 이름인데 비웠다)
export const sameLabel = (s, label) => (s ? (s.label || null) === (label || null) : true);

// F2: 고른 세션 노드 하나의 이름을 바꾼다. 대화상자가 열려 있거나, 조합 키, 한글 조합 중, 노드가 둘 이상이면 받지 않는다.
// 입력 칸·터미널 안에서 친 키인지는 부르는 쪽(main.jsx editable)이 먼저 본다 → 세션 ID | null
export function renameKeyTarget(e, { selected = [], sessions = new Map(), dialog = null } = {}) {
  if (!e || e.key !== 'F2' || e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || dialog) return null;
  const ids = selected.filter((id) => sessions.has(id));
  return ids.length === 1 ? ids[0] : null;
}
