// P66: 판의 이름(표시 이름). 세션마다 사람이 정한 이름(label)을 판 기록에 두고, 에이전트가 쓰는 주소(name, herdr 에이전트 이름)는 그대로 둔다.
// - 보이는 이름은 label이 있으면 label, 없으면 name이다(shownName). 이름을 비우면 원래 이름(name)으로 돌아간다.
// - 이름으로 부르기(@이름, CLI의 세션 지정)는 새 이름과 옛 주소를 둘 다 받는다(findSession). 주소가 먼저다: 일하던 에이전트의 명령이 깨지지 않게.
// - 판 안에서 이름은 대소문자를 무시하고 겹치지 않는다(takenNames). 새로 짓는 이름(spawn, 하위 세션, 올리기, 다시 열기)도 남의 label을 피한다.
// - herdr 이름이 바뀌는 동기화(backend.mjs renamed)는 name만 바꾸고 label은 덮지 않는다.
import { keyed } from './msg.mjs';

export const LABEL_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]*$/u; // 표시 이름은 한글도 허용한다. 에이전트 주소의 ASCII 규칙은 그대로다.
export const LABEL_MAX = 32;

const lc = (x) => String(x ?? '').normalize('NFC').toLowerCase();
function apiError(code, message) { return Object.assign(new Error(message), { code }); }

export const shownName = (s) => (s ? s.label || s.name || null : null);

// 판에서 쓰는 이름(주소와 label)을 대소문자 없이 모은다. has·add는 Set처럼 쓴다(옛 taken.has(name) 자리에 그대로 넣는다)
export function takenNames(sessions, extra = []) {
  const set = new Set();
  for (const s of sessions) { if (s.name) set.add(lc(s.name)); if (s.label) set.add(lc(s.label)); }
  for (const n of extra) if (n) set.add(lc(n));
  const api = { has: (n) => set.has(lc(n)), add: (n) => { set.add(lc(n)); return api; }, delete: (n) => set.delete(lc(n)), get size() { return set.size; } };
  return api;
}

// 다른 세션이 이 이름(주소나 label)을 쓰는가. 쓰면 그 세션
export function nameOwner(sessions, name, self = null) {
  const k = lc(name);
  for (const s of sessions) if (s !== self && (s.sessionId !== (self && self.sessionId)) && (lc(s.name) === k || (s.label && lc(s.label) === k))) return s;
  return null;
}

// 새 label을 확인한다. → { label: 글 | null(비움) }. 틀리면 이유를 단 오류(창이 열쇠로 번역한다)
export function checkLabel(want, sessions, self) {
  const raw = want == null ? '' : String(want).trim().replace(/^@/, '').normalize('NFC');
  if (!raw) return { label: null };
  if (self && raw === self.name) return { label: null }; // 원래 이름과 같으면 비운 것과 같다
  if ([...raw].length > LABEL_MAX) throw keyed(apiError('bad_request', `이름은 ${LABEL_MAX}자까지 입력할 수 있습니다: ${raw.slice(0, 40)}`), 'labelTooLong', { max: LABEL_MAX });
  if (!LABEL_RE.test(raw)) throw keyed(apiError('bad_request', `이름은 글자나 숫자로 시작해야 하며 글자, 숫자, -, _만 사용할 수 있습니다: ${raw}`), 'labelBad', { name: raw });
  if (lc(raw) === 'all') throw keyed(apiError('bad_request', 'all은 모든 세션을 부르는 이름이라 사용할 수 없습니다.'), 'labelAll', { name: raw });
  const other = nameOwner(sessions, raw, self);
  if (other) throw keyed(apiError('name_taken', `다른 세션(@${shownName(other)})이 이미 사용 중인 이름입니다: ${raw}`), 'labelTaken', { name: raw, other: shownName(other) });
  return { label: raw };
}

// 이름이나 ID로 세션을 찾는다. 차례: 세션 ID → 주소(정확히) → label(정확히) → label(대소문자 무시) → 주소(대소문자 무시, 하나일 때만)
export function findSession(sessions, ref) {
  const key = String(ref ?? '').replace(/^@/, '');
  if (!key) return null;
  const list = [...sessions];
  const k = lc(key);
  return list.find((s) => s.sessionId === key)
    || list.find((s) => s.name === key)
    || list.find((s) => s.label && s.label === key)
    || list.find((s) => s.label && lc(s.label) === k)
    || (() => { const ci = list.filter((s) => lc(s.name) === k); return ci.length === 1 ? ci[0] : null; })();
}

// 이름 바꾸기. b: 백엔드(sessions, store, resolve, broadcastSession, log). by: human(창) | cli. → { sessionId, name(보이는 이름), address, label, from, changed }
export function renameSession(b, p) {
  const s = b.resolve(p.session);
  const by = p.by === 'human' ? 'human' : 'cli';
  const { label } = p.clear ? { label: null } : checkLabel(p.name, b.sessions.values(), s);
  const before = s.label || null;
  const from = shownName(s);
  if (before !== label) {
    b.store.tx(() => {
      b.store.setSessionLabel(s.sessionId, label);
      b.store.addEvent(s.sessionId, 'renamed', { from, to: label || s.name, label, address: s.name, by });
    });
    s.label = label;
    b.log(`session label ${s.name} ${before || '-'} -> ${label || '-'} by=${by}`);
    b.broadcastSession(s, { cause: `rename:${by}` });
    // 하위 세션 요약의 부모 이름(branch.parentName)도 바뀐다
    for (const x of b.sessions.values()) if (x !== s && x.parentSessionId === s.sessionId) b.broadcastSession(x, { cause: 'rename:parent' });
  }
  return { sessionId: s.sessionId, name: shownName(s), address: s.name, label, from, changed: before !== label };
}

// 다시 열거나 올릴 때: 저장된 label이 이제 다른 세션과 겹치면 버린다
export function keepLabel(label, sessions, self) {
  if (!label) return null;
  try { return checkLabel(label, sessions, self).label; } catch { return null; }
}
