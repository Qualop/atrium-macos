// P44: 워크스페이스 가상 그룹. Atrium 판 데이터(meta 'wsGroups')에만 있고 디스크 폴더와 상관없다.
// - 그룹: { id, name, members: [워크스페이스 키] }. 그룹 순서와 그룹 안 순서는 사람이 정한다.
// - 워크스페이스는 그룹 하나에만 속하거나 그룹이 없다. 옛 판(값 없음)은 그룹 없음으로 시작한다.
// 위쪽은 순수 함수(단위 시험 backend/test/p44.test.mjs), 아래쪽 groupHandlers가 판에 붙인다.
// - P91: 폴더가 안팎인 워크스페이스는 저절로 한 묶음(auto)이 된다(ws-nest.mjs). 사람이 바꾼 것이 이긴다(뺀 것, 지운 것, 바꾼 이름, 사람이 만든 그룹).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keyed } from './msg.mjs';
import { nestClusters, syncAutoGroups, groupLabel } from './ws-nest.mjs';

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
    const x = { id, name, members };
    // P91: 저절로 만든 묶음(auto, root: 뿌리 폴더 경로 키, named: 사람이 이름을 바꿈, pinned: 사람이 넣은 워크스페이스)
    if (g.auto && g.root) {
      x.auto = true; x.root = String(g.root);
      if (g.named) x.named = true;
      if (g.ordered) x.ordered = true; // P99: 사람이 묶음 안 순서를 정했다(판 전체 정리가 연결로 순서를 바꾸지 않는다)
      const pinned = [...new Set((Array.isArray(g.pinned) ? g.pinned : []).map(String).filter((k) => members.includes(k)))];
      if (pinned.length) x.pinned = pinned;
    }
    out.push(x);
  }
  const res = { groups: out };
  // P91: 사람이 바꾼 것의 기억(dismissed: 사람이 지운 묶음의 뿌리, excluded: [{ root, ws }] 사람이 묶음에서 뺀 워크스페이스). 판에 없는 워크스페이스도 남긴다
  const dismissed = [...new Set((Array.isArray(raw && raw.dismissed) ? raw.dismissed : []).map(String).filter(Boolean))].slice(-MEMORY_MAX);
  if (dismissed.length) res.dismissed = dismissed;
  const ex = new Map();
  for (const e of Array.isArray(raw && raw.excluded) ? raw.excluded : []) if (e && e.root && e.ws) ex.set(`${e.root}|${e.ws}`, { root: String(e.root), ws: String(e.ws) });
  if (ex.size) res.excluded = [...ex.values()].slice(-MEMORY_MAX);
  return res;
}
const MEMORY_MAX = 500;

// 워크스페이스 키 → { id, index }(그룹 안 순서)
export function groupIndex(state) {
  const m = new Map();
  // P99: loose = 저절로 만든 묶음이고 사람이 순서를 정한 적이 없다(판 전체 정리가 묶음 안 순서를 연결로 고른다). 사람이 만든 그룹의 순서는 늘 사람이 정한 것
  for (const g of (state && state.groups) || []) g.members.forEach((k, i) => m.set(k, { id: g.id, index: i, ...(g.auto && !g.ordered ? { loose: true } : {}) }));
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
  return { ...s, groups, created: g.id }; // P91: 돌려주는 상태는 기억(dismissed, excluded)도 그대로 싣는다
}
export function renameGroup(state, id, name) {
  const s = normalizeGroups(state);
  const g = find(s, id);
  if (!g) return { ...s, error: 'not_found' };
  if (badName(name)) return { ...s, error: 'bad_name' };
  const n = cleanName(name);
  if (s.groups.some((x) => x.id !== g.id && x.name.toLowerCase() === n.toLowerCase())) return { ...s, error: 'name_taken' };
  return { ...s, groups: s.groups.map((x) => (x.id === g.id ? { ...x, name: n, ...(x.auto ? { named: true } : {}) } : x)) }; // P91: 저절로 만든 묶음의 이름을 사람이 바꾸면 다시 덮지 않는다
}
// 그룹을 지우면 안의 워크스페이스는 그룹 없음이 된다(워크스페이스는 그대로). P91: 저절로 만든 묶음이면 그 뿌리를 기억해 다시 만들지 않는다
export function removeGroup(state, id) {
  const s = normalizeGroups(state);
  const g = find(s, id);
  if (!g) return { ...s, error: 'not_found' };
  const out = { ...s, groups: s.groups.filter((x) => x.id !== g.id), released: g.members };
  if (g.auto) out.dismissed = [...new Set([...(s.dismissed || []), g.root])];
  return out;
}
// 워크스페이스를 그룹(null이면 그룹 없음)의 index 자리로 옮긴다. index가 없으면 끝에. 같은 그룹 안에서 옮기면 순서만 바뀐다
export function moveWorkspace(state, wsKey, groupId, index = null) {
  const s = normalizeGroups(state);
  const key = String(wsKey || '');
  if (!key) return { ...s, error: 'not_found' };
  if (groupId != null && !find(s, groupId)) return { ...s, error: 'not_found' };
  // P91: 저절로 만든 묶음에서 사람이 뺀 워크스페이스는 기억해 다시 넣지 않는다(excluded). 사람이 다른 곳에서 묶음에 넣은 것은 그 묶음 밖 폴더여도 둔다(pinned)
  const from = s.groups.find((g) => g.members.includes(key)) || null;
  const groups = s.groups.map((g) => ({ ...g, members: g.members.filter((k) => k !== key) }));
  let excluded = s.excluded || [];
  if (groupId != null) {
    const g = groups.find((x) => x.id === String(groupId));
    const at = index == null ? g.members.length : Math.max(0, Math.min(g.members.length, Number(index) || 0));
    g.members.splice(at, 0, key);
    if (g.auto && index != null) g.ordered = true; // P99: 자리를 정해 넣거나 옮겼다 = 사람이 순서를 정했다
    if (g.auto && (!from || from.id !== g.id)) { g.pinned = [...new Set([...(g.pinned || []), key])]; excluded = excluded.filter((e) => !(e.root === g.root && e.ws === key)); }
  }
  if (from && from.auto && (groupId == null || String(groupId) !== from.id)) excluded = [...excluded.filter((e) => !(e.root === from.root && e.ws === key)), { root: from.root, ws: key }];
  return pinTidy({ ...s, groups, excluded });
}
// pinned는 구성 안의 것만, 빈 목록과 빈 기억은 뺀다
function pinTidy(s) {
  for (const g of s.groups) if (g.pinned) { g.pinned = g.pinned.filter((k) => g.members.includes(k)); if (!g.pinned.length) delete g.pinned; }
  if (s.excluded && !s.excluded.length) delete s.excluded;
  return s;
}
// 그룹 순서 바꾸기
export function moveGroup(state, id, index) {
  const s = normalizeGroups(state);
  const g = find(s, id);
  if (!g) return { ...s, error: 'not_found' };
  const groups = s.groups.filter((x) => x.id !== g.id);
  groups.splice(Math.max(0, Math.min(groups.length, Number(index) || 0)), 0, g);
  return { ...s, groups };
}
// 워크스페이스가 판에서 빠지면 그룹에서도 뺀다(다시 열면 그룹 없음으로 돌아온다)
export function dropWorkspaces(state, keys) {
  const gone = new Set(keys || []);
  const s = normalizeGroups(state);
  return pinTidy({ ...s, groups: s.groups.map((g) => ({ ...g, members: g.members.filter((k) => !gone.has(k)) })) });
}

// Keep the target's chosen group/order if both keys are already grouped.
// Otherwise the replacement inherits the source's exact position.
export function rekeyGroups(state, from, to) {
  const s = normalizeGroups(state);
  if (from === to) return s;
  const targetGrouped = s.groups.some((g) => g.members.includes(to));
  const groups = s.groups.map((g) => ({ ...g,
    members: g.members.flatMap((k) => k === from ? (targetGrouped ? [] : [to]) : [k]),
    ...(g.pinned ? { pinned: g.pinned.map((k) => k === from ? to : k) } : {}),
  }));
  return pinTidy(normalizeGroups({ ...s, groups, ...(s.excluded ? { excluded: s.excluded.map((e) => ({ ...e, ws: e.ws === from ? to : e.ws })) } : {}) }));
}

// ---------- 판에 붙이기 ----------
const ERR = {
  bad_name: () => keyed(apiError('bad_request', `그룹 이름은 1~${GROUP_NAME_MAX}자`), 'groupBadName', { max: GROUP_NAME_MAX }),
  name_taken: (name) => keyed(apiError('conflict', `이미 사용 중인 그룹 이름입니다: ${name}`), 'groupNameTaken', { name }),
  not_found: (ref) => keyed(apiError('not_found', `그룹이나 프로젝트를 찾을 수 없습니다: ${ref}`), 'groupNotFound', { ref }),
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

// ---------- P91: 폴더 위계 묶음 ----------
// 프로젝트 폴더의 표시(ws-nest.mjs PROJECT_MARKS)를 디스크에서 본다. 폴더마다 30초 담아 둔다(워크스페이스 목록을 알릴 때마다 부른다)
const MARK_TTL = 30000;
const markCache = new Map();
const MARK_FILES = ['.git', 'CLAUDE.md', 'AGENTS.md', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', '.claude'];
export function isProjectDir(dir, now = Date.now()) {
  const hit = markCache.get(dir);
  if (hit && now - hit.at < MARK_TTL) return hit.yes;
  let yes = false;
  try {
    const p = path.resolve(dir);
    yes = MARK_FILES.some((f) => fs.existsSync(path.join(p, f))) || fs.readdirSync(p).some((f) => /^readme/i.test(f));
  } catch { yes = false; }
  markCache.set(dir, { at: now, yes });
  if (markCache.size > 2000) markCache.clear();
  return yes;
}
export const forgetProjectMarks = () => markCache.clear();
// 저절로 만든 묶음을 지금 워크스페이스 폴더에 맞춘다. 바뀌었으면 저장하고 true(알리는 것은 부른 쪽)
export function syncWsGroups(b, why = 'sync', { isProject = isProjectDir, home = os.homedir() } = {}) {
  const ws = b.store.workspaces();
  const cur = readGroups(b);
  const clusters = nestClusters(ws.map((w) => ({ key: w.key, root: w.root })), { isProject, home });
  const next = normalizeGroups(syncAutoGroups(cur, clusters), ws.map((w) => w.key));
  if (JSON.stringify(next) === JSON.stringify(cur)) return false;
  b.store.setMeta(GROUPS_META, next);
  b.store.addEvent(null, 'groups_changed', { why: `auto:${why}`, groups: next.groups.length, auto: next.groups.filter((g) => g.auto).map((g) => ({ root: g.root, n: g.members.length })) });
  return true;
}
// 워크스페이스 키 → 영역 이름표(저절로 만든 묶음 안에서 뿌리에서의 상대 경로). 묶음 밖은 없다
export function wsLabels(state, workspaces) {
  const out = new Map();
  const rootOf = new Map(workspaces.map((w) => [w.key, w.root]));
  for (const g of state.groups || []) {
    if (!g.auto) continue;
    const roots = g.members.map((k) => rootOf.get(k)).filter(Boolean);
    for (const k of g.members) { const r = rootOf.get(k); if (r) { const l = groupLabel(g, r, roots); if (l) out.set(k, l); } }
  }
  return out;
}

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
