// P44: 워크스페이스 가상 그룹. Atrium 판 데이터(meta 'wsGroups')에만 있고 디스크 폴더와 상관없다.
// - 그룹: { id, name, members: [워크스페이스 키] }. 그룹 순서와 그룹 안 순서는 사람이 정한다.
// - 워크스페이스는 그룹 하나에만 속하거나 그룹이 없다. 옛 판(값 없음)은 그룹 없음으로 시작한다.
// 위쪽은 순수 함수(단위 시험 backend/test/p44.test.mjs), 아래쪽 groupHandlers가 판에 붙인다.
import { keyed } from './msg.mjs';

function apiError(code, message) { return Object.assign(new Error(message), { code }); }

export const GROUPS_META = 'wsGroups';
export const GROUP_NAME_MAX = 40;

const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim();

// 저장된 값을 믿지 않고 고친다: 모르는 키·겹친 키·빈 이름을 걸러 낸다. wsKeys를 주면 판에 없는 워크스페이스를 뺀다
export function normalizeGroups(raw, wsKeys = null) {
  const keys = wsKeys ? new Set(wsKeys) : null;
  const seen = new Set();
  const ids = new Set();
  const out = [];
  for (const g of Array.isArray(raw && raw.groups) ? raw.groups : Array.isArray(raw) ? raw : []) {
    if (!g || typeof g !== 'object') continue;
    const id = String(g.id || '').trim();
    const name = cleanName(g.name).slice(0, GROUP_NAME_MAX);
    if (!id || ids.has(id) || !name) continue;
    ids.add(id);
    const members = [];
    for (const k of Array.isArray(g.members) ? g.members : []) {
      const key = String(k || '');
      if (!key || seen.has(key) || (keys && !keys.has(key))) continue;
      seen.add(key); members.push(key);
    }
    out.push({ id, name, members });
  }
  return { groups: out };
}

// 워크스페이스 키 → { id, index }(그룹 안 순서)
export function groupIndex(state) {
  const m = new Map();
  for (const g of (state && state.groups) || []) g.members.forEach((k, i) => m.set(k, { id: g.id, index: i }));
  return m;
}
export const groupOf = (state, wsKey) => (groupIndex(state).get(wsKey) || {}).id || null;

function badName(name) {
  const n = cleanName(name);
  if (!n || n.length > GROUP_NAME_MAX) return true;
  return false;
}
function nextId(state) {
  let i = 1;
  const ids = new Set(state.groups.map((g) => g.id));
  while (ids.has(`g${i}`)) i++;
  return `g${i}`;
}
const find = (state, id) => state.groups.find((g) => g.id === String(id));

// 아래 함수는 새 상태를 돌려준다(받은 것은 바꾸지 않는다). 잘못된 요청은 { error: 'bad_name' | 'not_found' | 'name_taken' }
export function createGroup(state, name, { at = null } = {}) {
  const s = normalizeGroups(state);
  if (badName(name)) return { ...s, error: 'bad_name' };
  const n = cleanName(name);
  if (s.groups.some((g) => g.name.toLowerCase() === n.toLowerCase())) return { ...s, error: 'name_taken' };
  const g = { id: nextId(s), name: n, members: [] };
  const groups = [...s.groups];
  groups.splice(at == null ? groups.length : Math.max(0, Math.min(groups.length, at)), 0, g);
  return { groups, created: g.id };
}
export function renameGroup(state, id, name) {
  const s = normalizeGroups(state);
  const g = find(s, id);
  if (!g) return { ...s, error: 'not_found' };
  if (badName(name)) return { ...s, error: 'bad_name' };
  const n = cleanName(name);
  if (s.groups.some((x) => x.id !== g.id && x.name.toLowerCase() === n.toLowerCase())) return { ...s, error: 'name_taken' };
  return { groups: s.groups.map((x) => (x.id === g.id ? { ...x, name: n } : x)) };
}
// 그룹을 지우면 안의 워크스페이스는 그룹 없음이 된다(워크스페이스는 그대로)
export function removeGroup(state, id) {
  const s = normalizeGroups(state);
  if (!find(s, id)) return { ...s, error: 'not_found' };
  return { groups: s.groups.filter((g) => g.id !== String(id)), released: find(s, id).members };
}
// 워크스페이스를 그룹(null이면 그룹 없음)의 index 자리로 옮긴다. index가 없으면 끝에. 같은 그룹 안에서 옮기면 순서만 바뀐다
export function moveWorkspace(state, wsKey, groupId, index = null) {
  const s = normalizeGroups(state);
  const key = String(wsKey || '');
  if (!key) return { ...s, error: 'not_found' };
  if (groupId != null && !find(s, groupId)) return { ...s, error: 'not_found' };
  const groups = s.groups.map((g) => ({ ...g, members: g.members.filter((k) => k !== key) }));
  if (groupId != null) {
    const g = groups.find((x) => x.id === String(groupId));
    const at = index == null ? g.members.length : Math.max(0, Math.min(g.members.length, Number(index) || 0));
    g.members.splice(at, 0, key);
  }
  return { groups };
}
// 그룹 순서 바꾸기
export function moveGroup(state, id, index) {
  const s = normalizeGroups(state);
  const g = find(s, id);
  if (!g) return { ...s, error: 'not_found' };
  const groups = s.groups.filter((x) => x.id !== g.id);
  groups.splice(Math.max(0, Math.min(groups.length, Number(index) || 0)), 0, g);
  return { groups };
}
// 워크스페이스가 판에서 빠지면 그룹에서도 뺀다(다시 열면 그룹 없음으로 돌아온다)
export function dropWorkspaces(state, keys) {
  const gone = new Set(keys || []);
  const s = normalizeGroups(state);
  return { groups: s.groups.map((g) => ({ ...g, members: g.members.filter((k) => !gone.has(k)) })) };
}

// Keep the target's chosen group/order if both keys are already grouped.
// Otherwise the replacement inherits the source's exact position.
export function rekeyGroups(state, from, to) {
  const s = normalizeGroups(state);
  if (from === to) return s;
  const targetGrouped = s.groups.some((g) => g.members.includes(to));
  return { groups: s.groups.map((g) => ({ ...g, members: g.members.flatMap((k) => k === from ? (targetGrouped ? [] : [to]) : [k]) })) };
}

// ---------- 판에 붙이기 ----------
const ERR = {
  bad_name: () => keyed(apiError('bad_request', `그룹 이름은 1~${GROUP_NAME_MAX}자`), 'groupBadName', { max: GROUP_NAME_MAX }),
  name_taken: (name) => keyed(apiError('conflict', `이미 있는 그룹 이름: ${name}`), 'groupNameTaken', { name }),
  not_found: (ref) => keyed(apiError('not_found', `없는 그룹이나 워크스페이스: ${ref}`), 'groupNotFound', { ref }),
};
export function readGroups(b) { return normalizeGroups(b.store.getMeta(GROUPS_META), b.store.workspaces().map((w) => w.key)); }
function save(b, next, why) {
  if (next.error) return next;
  const clean = normalizeGroups(next);
  b.store.setMeta(GROUPS_META, clean);
  b.store.addEvent(null, 'groups_changed', { why, groups: clean.groups.length });
  b.broadcastWorkspaces();
  return clean;
}
function check(r, ref) { if (r.error) throw ERR[r.error](ref); return r; }

export function groupHandlers(b) {
  const keyOf = async (ref) => (await b.resolveWorkspace(ref)).key;
  return {
    'group.list': () => readGroups(b),
    'group.create': async (p) => {
      const keys = [];
      for (const ref of p.workspaces || []) keys.push(await keyOf(ref));
      const r = check(createGroup(readGroups(b), p.name, { at: p.at ?? null }), cleanName(p.name));
      let next = r;
      for (const key of keys) {
        if (!b.store.getWorkspace(key)) throw ERR.not_found(key);
        next = check(moveWorkspace(next, key, r.created), key);
      }
      const s = save(b, next, 'create');
      return { ...s, created: r.created };
    },
    'group.rename': (p) => save(b, check(renameGroup(readGroups(b), p.group, p.name), p.group), 'rename'),
    'group.remove': (p) => save(b, check(removeGroup(readGroups(b), p.group), p.group), 'remove'),
    'group.order': (p) => save(b, check(moveGroup(readGroups(b), p.group, p.index), p.group), 'order'),
    'group.move': async (p) => {
      const key = await keyOf(p.workspace);
      if (!b.store.getWorkspace(key)) throw ERR.not_found(key);
      return save(b, check(moveWorkspace(readGroups(b), key, p.group ?? null, p.index ?? null), p.group ?? p.workspace), 'move');
    },
  };
}
