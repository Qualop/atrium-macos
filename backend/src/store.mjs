// 저장소(ARCH 5절): 판 배치, 노드와 세션 ID 연결, 이벤트, 전달, 봤음 기록(P3), 세션끼리 연결과 오간 일(P4),
// 리포지토리 워크스페이스(P5), 단일 캔버스의 영역 자리·붙여 묶기·크기 단계·검색(P6a). sessions.workspace_id는 herdr 작업 공간 ID다(코드에서는 herdrWorkspaceId). 판의 워크스페이스는 workspace_key다.
// E8 결과로 Node 내장 node:sqlite를 쓴다. node:sqlite 호출과 SQL은 이 파일 안에만 둔다.
import fs from 'node:fs';
import path from 'node:path';
import { RECORDS_SCHEMA, installRecords } from './store-records.mjs'; // P6b: Thread, 메모, 칸반, 루프 표
import { RECALL_SCHEMA, RECALL_COLUMNS, RECALL_SESSION_FIELDS, installRecall } from './store-recall.mjs'; // P7: 대화 기록 색인, 닫힌 세션
import { BRANCH_COLUMNS, installBranch } from './store-branch.mjs'; // P8: 하위 세션 기록
import { WORKTREE_SCHEMA, WORKTREE_COLUMNS, installWorktrees } from './store-worktrees.mjs'; // P27: 워크트리 영역
import { IMPORTS_SCHEMA, installImports } from './store-imports.mjs'; // P34: 데스크톱 앱 가져오기 장부
import { installMerge } from './store-merge.mjs'; // P37: 워크스페이스 키 옮기기(폴더가 저장소가 되면 합치기)
import { normalize, fromLine, leaves, isLeaf } from './dock-tree.mjs'; // P17: 덩어리 분할 나무

let DatabaseSync;
try { const sqlite = await import('node:sqlite'); DatabaseSync = sqlite.Database || sqlite.DatabaseSync; } catch (e) { throw new Error(`node:sqlite를 불러오지 못했습니다. Node.js 22.13+ / 24.x / 26.x가 필요합니다: ${e.message}`); }

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 2000;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY, name TEXT NOT NULL, cwd TEXT NOT NULL,
  pane_id TEXT, workspace_id TEXT, agent_name TEXT,
  model TEXT, effort TEXT, permission_mode TEXT NOT NULL, settings_path TEXT NOT NULL, hook_token TEXT NOT NULL,
  resume_argv TEXT, resume_verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, closed_at INTEGER, seen_at INTEGER, runtime TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_open ON sessions(closed_at);
CREATE TABLE IF NOT EXISTS nodes (session_id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, z INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, t INTEGER NOT NULL, session_id TEXT, kind TEXT NOT NULL, data TEXT) STRICT;
CREATE INDEX IF NOT EXISTS events_session ON events(session_id, id);
CREATE INDEX IF NOT EXISTS events_t ON events(t);
CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, reason TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sent_at INTEGER, confirmed_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS deliveries_session ON deliveries(session_id, created_at);
CREATE TABLE IF NOT EXISTS links (
  link_id TEXT PRIMARY KEY, from_session TEXT NOT NULL, to_session TEXT NOT NULL, role TEXT,
  spawned INTEGER NOT NULL DEFAULT 0, observed INTEGER NOT NULL DEFAULT 0, count INTEGER NOT NULL DEFAULT 0,
  last_text TEXT, last_kind TEXT, last_at INTEGER, notify_delivery TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, removed_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS links_pair ON links(from_session, to_session);
CREATE TABLE IF NOT EXISTS link_events (id INTEGER PRIMARY KEY, link_id TEXT NOT NULL, t INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT, data TEXT) STRICT;
CREATE INDEX IF NOT EXISTS link_events_link ON link_events(link_id, id);
CREATE TABLE IF NOT EXISTS workspaces (workspace_key TEXT PRIMARY KEY, kind TEXT NOT NULL, root TEXT NOT NULL, viewport TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS docks (dock_id TEXT PRIMARY KEY, workspace_key TEXT, dir TEXT NOT NULL, members TEXT NOT NULL, origin TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
`;

// P3에서 더한 열. P1·P2에서 만든 board.db에는 ALTER TABLE로 더한다.
// P22: 그룹·묶음 실행·한 줄 메모를 뺐다. 옛 판의 sessions.group_id, deliveries.group_id, thread_results.group_id 열과 notes 표는 남지만 읽지도 쓰지도 않는다(dropGroups)
const ADDED_COLUMNS = {
  sessions: { touched_at: 'INTEGER', kind: 'TEXT', origin: 'TEXT', parent_session_id: 'TEXT', workspace_key: 'TEXT', flavor: 'TEXT', extra_args: 'TEXT' }, // extra_args(호출자의 claude 추가 인자, JSON 배열)는 P33 // kind·origin·parent는 P4, workspace_key는 P5, flavor(띄운 방법, 예: deepseek)는 P25
  workspaces: { x: 'REAL', y: 'REAL' }, // P6a: 영역의 자리(빈 워크스페이스, 영역 옮기기)
  nodes: { size: 'TEXT' }, // P6a: 크기 단계(large, normal, small)
  docks: { tree: 'TEXT' }, // P17: 분할 나무(dock-tree.mjs). 없으면 옛 한 줄 덩어리(dir, members)이고 뜰 때 나무로 바꾼다(canvas-ops migrateDocks)
};

const plain = (r) => (r ? { ...r } : null); // node:sqlite 행은 프로토타입이 없다(E8 2.2)

function sessionRow(r) {
  if (!r) return null;
  return {
    sessionId: r.session_id, name: r.name, cwd: r.cwd, paneId: r.pane_id, herdrWorkspaceId: r.workspace_id, agentName: r.agent_name,
    model: r.model, effort: r.effort, permissionMode: r.permission_mode, settingsPath: r.settings_path, hookToken: r.hook_token,
    resumeArgv: r.resume_argv ? JSON.parse(r.resume_argv) : null, resumeVerified: !!r.resume_verified,
    createdAt: r.created_at, closedAt: r.closed_at, seenAt: r.seen_at, touchedAt: r.touched_at ?? null, runtime: r.runtime ? JSON.parse(r.runtime) : null,
    kind: r.kind || 'claude', origin: r.origin || 'board', parentSessionId: r.parent_session_id ?? null, workspaceKey: r.workspace_key ?? null, flavor: r.flavor ?? null, extraArgs: r.extra_args ? JSON.parse(r.extra_args) : [],
  };
}
function linkRow(r) {
  if (!r) return null;
  return { linkId: r.link_id, from: r.from_session, to: r.to_session, role: r.role ?? null, spawned: !!r.spawned, observed: !!r.observed, count: r.count, lastText: r.last_text ?? null, lastKind: r.last_kind ?? null, lastAt: r.last_at ?? null, notifyDelivery: r.notify_delivery ?? null, createdAt: r.created_at, updatedAt: r.updated_at, removedAt: r.removed_at ?? null };
}
function deliveryRow(r) {
  if (!r) return null;
  return { deliveryId: r.delivery_id, sessionId: r.session_id, text: r.text, status: r.status, reason: r.reason, createdAt: r.created_at, updatedAt: r.updated_at, sentAt: r.sent_at, confirmedAt: r.confirmed_at, attempts: r.attempts };
}
function workspaceRow(r) {
  if (!r) return null;
  return { key: r.workspace_key, kind: r.kind, root: r.root, viewport: r.viewport ? JSON.parse(r.viewport) : null, createdAt: r.created_at, updatedAt: r.updated_at, x: r.x ?? null, y: r.y ?? null, auto: !!r.auto_opened };
}
// P17: tree가 있으면 그것이 덩어리다. members(잎 차례)와 dir(뿌리 마디 방향)은 나무에서 다시 만든다. 옛 행(tree 없음)은 고른 비율의 한 줄 나무로 읽는다
function dockRow(r) {
  if (!r) return null;
  let tree = null;
  try { tree = r.tree ? normalize(JSON.parse(r.tree)) : null; } catch { tree = null; }
  const legacy = !tree;
  if (legacy) tree = fromLine(r.dir, JSON.parse(r.members));
  return { dockId: r.dock_id, workspaceKey: r.workspace_key ?? null, tree, dir: tree && !isLeaf(tree) ? tree.dir : r.dir, members: leaves(tree), legacy, origin: r.origin ?? null, createdAt: r.created_at, updatedAt: r.updated_at };
}
const dockCols = (d) => { const tree = d.tree ? normalize(d.tree) : fromLine(d.dir, d.members || []); return { tree: JSON.stringify(tree), dir: tree && !isLeaf(tree) ? tree.dir : d.dir || 'row', members: JSON.stringify(leaves(tree)) }; };
const eventRow = (r) => ({ id: r.id, t: r.t, sessionId: r.session_id, kind: r.kind, data: r.data ? JSON.parse(r.data) : null });

export class Store {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    this.db.exec(RECORDS_SCHEMA);
    this.db.exec(RECALL_SCHEMA);
    this.db.exec(WORKTREE_SCHEMA);
    this.db.exec(IMPORTS_SCHEMA);
    for (const [table, cols] of [...Object.entries(ADDED_COLUMNS), ...Object.entries(RECALL_COLUMNS), ...Object.entries(BRANCH_COLUMNS), ...Object.entries(WORKTREE_COLUMNS)]) {
      const have = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      for (const [col, type] of Object.entries(cols)) if (!have.has(col)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
    this.q = {};
  }
  close() { this.db.close(); }
  st(sql) { return (this.q[sql] ||= this.db.prepare(sql)); }
  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  getMeta(key) { const r = this.st('SELECT value FROM meta WHERE key = ?').get(key); return r ? JSON.parse(r.value) : null; }
  setMeta(key, value) { this.st('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)); }

  insertSession(s) {
    this.st(`INSERT INTO sessions (session_id, name, cwd, pane_id, workspace_id, agent_name, model, effort, permission_mode, settings_path, hook_token, resume_argv, created_at, touched_at, runtime, kind, origin, parent_session_id, workspace_key, flavor, extra_args)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      s.sessionId, s.name, s.cwd, s.paneId ?? null, s.herdrWorkspaceId ?? null, s.agentName ?? null, s.model ?? null, s.effort ?? null,
      s.permissionMode, s.settingsPath ?? '', s.hookToken ?? '', s.resumeArgv ? JSON.stringify(s.resumeArgv) : null, s.createdAt, s.touchedAt ?? null, JSON.stringify(s.runtime || null),
      s.kind || 'claude', s.origin || 'board', s.parentSessionId ?? null, s.workspaceKey ?? null, s.flavor ?? null, s.extraArgs && s.extraArgs.length ? JSON.stringify(s.extraArgs) : null);
  }
  updateSession(sessionId, fields) {
    const map = { paneId: 'pane_id', herdrWorkspaceId: 'workspace_id', agentName: 'agent_name', resumeVerified: 'resume_verified', closedAt: 'closed_at', seenAt: 'seen_at', touchedAt: 'touched_at', resumeArgv: 'resume_argv', runtime: 'runtime', cwd: 'cwd', parentSessionId: 'parent_session_id', workspaceKey: 'workspace_key', kind: 'kind', origin: 'origin', flavor: 'flavor', ...RECALL_SESSION_FIELDS };
    const sets = []; const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (!map[k]) throw new Error('unknown field ' + k);
      sets.push(`${map[k]} = ?`);
      vals.push(k === 'runtime' || k === 'resumeArgv' ? JSON.stringify(v) : typeof v === 'boolean' ? Number(v) : v ?? null);
    }
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE session_id = ?`).run(...vals, sessionId);
  }
  renameSession(sessionId, name) { this.st('UPDATE sessions SET name = ? WHERE session_id = ?').run(name, sessionId); }
  saveRuntime(sessionId, runtime) { this.st('UPDATE sessions SET runtime = ? WHERE session_id = ?').run(JSON.stringify(runtime), sessionId); }
  getSession(sessionId) { return sessionRow(this.st('SELECT * FROM sessions WHERE session_id = ?').get(sessionId)); }
  openSessions() { return this.st('SELECT * FROM sessions WHERE closed_at IS NULL ORDER BY created_at').all().map(sessionRow); }
  // P18(이름 옮기기): 데이터 폴더를 옮긴 뒤 세션 행의 글(settings_path, resume_argv, runtime)을 fix(글) → 글로 고친다. 닫힌 세션도. 고친 행 수
  rewriteSessionText(fix) {
    let n = 0;
    for (const r of this.st('SELECT session_id, settings_path, resume_argv, runtime FROM sessions').all()) {
      const next = { settings_path: fix(r.settings_path), resume_argv: r.resume_argv == null ? null : fix(r.resume_argv), runtime: r.runtime == null ? null : fix(r.runtime) };
      if (next.settings_path === r.settings_path && next.resume_argv === r.resume_argv && next.runtime === r.runtime) continue;
      this.st('UPDATE sessions SET settings_path = ?, resume_argv = ?, runtime = ? WHERE session_id = ?').run(next.settings_path, next.resume_argv, next.runtime, r.session_id); n++;
    }
    return n;
  }
  // P18: 옛 herdr 세션의 패널 ID에 prefix를 붙인다(열린 세션만, 이미 붙은 것은 그대로). 새 herdr가 같은 ID를 다시 써도 판이 옛 패널로 착각하지 않게. 붙인 수
  markPanesGone(prefix) {
    return Number(this.st("UPDATE sessions SET pane_id = ? || pane_id WHERE closed_at IS NULL AND pane_id IS NOT NULL AND pane_id <> '' AND substr(pane_id, 1, length(?)) <> ?").run(prefix, prefix, prefix).changes);
  }

  addEvent(sessionId, kind, data, t = Date.now()) { this.st('INSERT INTO events (t, session_id, kind, data) VALUES (?, ?, ?, ?)').run(t, sessionId ?? null, kind, data === undefined ? null : JSON.stringify(data)); }
  events({ sessionId, since = 0, limit = 200 } = {}) {
    const rows = sessionId
      ? this.st('SELECT * FROM events WHERE session_id = ? AND t >= ? ORDER BY id DESC LIMIT ?').all(sessionId, since, limit)
      : this.st('SELECT * FROM events WHERE t >= ? ORDER BY id DESC LIMIT ?').all(since, limit);
    return rows.reverse().map(eventRow);
  }
  // A3 복귀 요약: 시각 뒤의 이벤트를 오래된 순서로. 종류를 고를 수 있다.
  eventsAfter(t, kinds = null, limit = 20000) {
    const rows = kinds
      ? this.db.prepare(`SELECT * FROM events WHERE t > ? AND kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY id LIMIT ?`).all(t, ...kinds, limit)
      : this.st('SELECT * FROM events WHERE t > ? ORDER BY id LIMIT ?').all(t, limit);
    return rows.map(eventRow);
  }

  insertDelivery(d) {
    this.st('INSERT INTO deliveries (delivery_id, session_id, text, status, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(d.deliveryId, d.sessionId, d.text, d.status, d.reason ?? null, d.createdAt, d.createdAt);
  }
  updateDelivery(id, f) {
    this.st('UPDATE deliveries SET status = ?, reason = ?, updated_at = ?, sent_at = COALESCE(?, sent_at), confirmed_at = COALESCE(?, confirmed_at), attempts = attempts + ? WHERE delivery_id = ?')
      .run(f.status, f.reason ?? null, Date.now(), f.sentAt ?? null, f.confirmedAt ?? null, f.attempt ? 1 : 0, id);
  }
  getDelivery(id) { return deliveryRow(this.st('SELECT * FROM deliveries WHERE delivery_id = ?').get(id)); }
  activeDeliveries() { return this.st("SELECT * FROM deliveries WHERE status IN ('queued', 'sending', 'sent') ORDER BY created_at").all().map(deliveryRow); }
  deliveries({ sessionId, limit = 50 } = {}) {
    const rows = sessionId ? this.st('SELECT * FROM deliveries WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit) : this.st('SELECT * FROM deliveries ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(deliveryRow);
  }

  // 판 배치(9.4). P5: 노드마다 세션의 워크스페이스를 붙인다(판은 워크스페이스마다 하나)
  nodes() { return this.st('SELECT n.*, s.workspace_key FROM nodes n JOIN sessions s ON s.session_id = n.session_id WHERE s.closed_at IS NULL').all().map(plain); }
  // P27: area(놓인 워크트리 영역, 본 저장소는 '')는 주지 않으면 그대로 둔다
  setNode(n) { this.st('INSERT INTO nodes (session_id, x, y, w, h, z, size, area) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, z = excluded.z, size = COALESCE(excluded.size, nodes.size), area = COALESCE(excluded.area, nodes.area)').run(n.session_id, n.x, n.y, n.w, n.h, n.z ?? 0, n.size ?? null, n.area ?? null); }
  // 세션끼리 연결(P4, ARCH 4절 F). 순서 있는 쌍(A → B)마다 한 줄. 판에서 정한 역할(F2), 오간 지시를 알아챔(F1), A가 띄움(F3)을 같은 줄에 모은다.
  // 지운 연결은 removed_at만 남긴다. 같은 쌍에 새 일이 오가면 다시 연다.
  linkByPair(from, to) { return linkRow(this.st('SELECT * FROM links WHERE from_session = ? AND to_session = ? ORDER BY created_at DESC LIMIT 1').get(from, to)); }
  getLink(id) { return linkRow(this.st('SELECT * FROM links WHERE link_id = ?').get(id)); }
  links({ all = false } = {}) { return (all ? this.st('SELECT * FROM links ORDER BY created_at') : this.st('SELECT * FROM links WHERE removed_at IS NULL ORDER BY created_at')).all().map(linkRow); }
  insertLink(l) {
    this.st('INSERT INTO links (link_id, from_session, to_session, role, spawned, observed, count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .run(l.linkId, l.from, l.to, l.role ?? null, l.spawned ? 1 : 0, l.observed ? 1 : 0, l.createdAt, l.createdAt);
  }
  updateLink(id, f) {
    const map = { role: 'role', spawned: 'spawned', observed: 'observed', count: 'count', lastText: 'last_text', lastKind: 'last_kind', lastAt: 'last_at', notifyDelivery: 'notify_delivery', removedAt: 'removed_at' };
    const sets = ['updated_at = ?']; const vals = [Date.now()];
    for (const [k, v] of Object.entries(f)) { if (!map[k]) throw new Error('unknown field ' + k); sets.push(`${map[k]} = ?`); vals.push(typeof v === 'boolean' ? Number(v) : v ?? null); }
    this.db.prepare(`UPDATE links SET ${sets.join(', ')} WHERE link_id = ?`).run(...vals, id);
  }
  addLinkEvent(linkId, kind, text = null, data = null, t = Date.now()) {
    const r = this.st('INSERT INTO link_events (link_id, t, kind, text, data) VALUES (?, ?, ?, ?, ?)').run(linkId, t, kind, text, data == null ? null : JSON.stringify(data));
    return { id: Number(r.lastInsertRowid), linkId, t, kind, text, data };
  }
  linkEvents(linkId, limit = 200) { return this.st('SELECT * FROM link_events WHERE link_id = ? ORDER BY id DESC LIMIT ?').all(linkId, limit).reverse().map((r) => ({ id: r.id, linkId: r.link_id, t: r.t, kind: r.kind, text: r.text, data: r.data ? JSON.parse(r.data) : null })); }

  // 리포지토리 워크스페이스(P5, ARCH 4절 G). 줄의 순서는 처음 생긴 순서(created_at)로 고정한다. 닫으면 줄을 지운다
  workspaces() { return this.st('SELECT * FROM workspaces ORDER BY created_at, workspace_key').all().map(workspaceRow); }
  getWorkspace(key) { return workspaceRow(this.st('SELECT * FROM workspaces WHERE workspace_key = ?').get(key)); }
  insertWorkspace(w) { this.st('INSERT INTO workspaces (workspace_key, kind, root, created_at, updated_at, auto_opened) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_key) DO NOTHING').run(w.key, w.kind, w.root, w.createdAt, w.createdAt, w.auto ? 1 : null); } // auto: P10 리포 스스로 찾기
  setWorkspaceViewport(key, vp) { this.st('UPDATE workspaces SET viewport = ?, updated_at = ? WHERE workspace_key = ?').run(JSON.stringify(vp), Date.now(), key); }
  deleteWorkspace(key) { this.st('DELETE FROM workspaces WHERE workspace_key = ?').run(key); }
  // 키가 없는 열린 세션(P4까지의 board.db). 옮기기에 쓴다
  sessionsWithoutWorkspace() { return this.st('SELECT * FROM sessions WHERE closed_at IS NULL AND workspace_key IS NULL ORDER BY created_at').all().map(sessionRow); }

  // P22: 그룹과 묶음 실행을 뺐다. 옛 판이면 처음 뜰 때 한 번 그룹 표(groups)와 묶음 항목 표(batch_items)를 지우고, 세션의 그룹 소속을 풀고,
  // 그룹 대상 루프를 지운다. 노드 자리는 그대로다. 지운 것을 돌려준다(부르는 쪽이 판 이벤트로 남긴다). 옮길 것이 없으면 null
  dropGroups() {
    const has = (t) => !!this.st("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    if (!has('groups') && !has('batch_items')) return null;
    const cols = (t) => new Set(this.db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
    const groups = has('groups') ? this.db.prepare('SELECT group_id, name FROM groups ORDER BY created_at').all().map((r) => ({ groupId: r.group_id, name: r.name })) : [];
    const items = has('batch_items') ? this.db.prepare("SELECT status, COUNT(*) AS n FROM batch_items GROUP BY status").all().reduce((o, r) => ({ ...o, [r.status]: Number(r.n) }), {}) : {};
    const sessionCol = cols('sessions').has('group_id');
    const members = sessionCol ? this.db.prepare('SELECT session_id, name, group_id FROM sessions WHERE group_id IS NOT NULL AND closed_at IS NULL').all().map((r) => ({ sessionId: r.session_id, name: r.name, groupId: r.group_id })) : [];
    const loops = this.db.prepare("SELECT loop_id, target_id, status FROM loops WHERE target_kind = 'group'").all().map((r) => ({ loopId: r.loop_id, groupId: r.target_id, status: r.status }));
    this.tx(() => {
      if (sessionCol) this.db.exec('UPDATE sessions SET group_id = NULL WHERE group_id IS NOT NULL');
      this.db.exec("DELETE FROM loops WHERE target_kind = 'group'");
      this.db.exec('DROP TABLE IF EXISTS batch_items');
      this.db.exec('DROP TABLE IF EXISTS groups');
    });
    return { groups, members, loops, batchItems: items };
  }

  // ---------- P6a: 단일 캔버스(ARCH 4절 H) ----------
  setWorkspaceAnchor(key, x, y) { this.st('UPDATE workspaces SET x = ?, y = ?, updated_at = ? WHERE workspace_key = ?').run(x, y, Date.now(), key); }
  // 붙여 묶기 덩어리(H5): 구성 노드(순서대로)와 방향. 자리와 크기는 nodes 표에 있다
  docks() { return this.st('SELECT * FROM docks ORDER BY created_at').all().map(dockRow); }
  getDock(id) { return dockRow(this.st('SELECT * FROM docks WHERE dock_id = ?').get(id)); }
  // P17: tree를 주면 그것을, 없으면 dir·members로 한 줄 나무를 만들어 둔다. dir·members 열도 나무에 맞춰 함께 쓴다(옛 백엔드가 읽어도 순서는 맞다)
  insertDock(d) { const c = dockCols(d); this.st('INSERT INTO docks (dock_id, workspace_key, dir, members, tree, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(d.dockId, d.workspaceKey ?? null, c.dir, c.members, c.tree, d.origin ?? null, d.createdAt, d.createdAt); }
  updateDock(id, f) { const c = dockCols(f); this.st('UPDATE docks SET dir = ?, members = ?, tree = ?, updated_at = ? WHERE dock_id = ?').run(c.dir, c.members, c.tree, Date.now(), id); }
  deleteDock(id) { this.st('DELETE FROM docks WHERE dock_id = ?').run(id); }
  // 검색(H2): 판 기록에서 q가 든 글. 판이 보낸 글(전달), hook 이벤트(지시와 답), 연결로 오간 지시. LIKE는 영문만 대소문자를 가리지 않는다
  searchText(q, limit = 200) {
    const like = `%${String(q).replace(/[!%_]/g, (c) => '!' + c)}%`;
    const rows = [
      ...this.st("SELECT 'delivery' AS src, session_id, text, created_at AS t FROM deliveries WHERE text LIKE ? ESCAPE '!' ORDER BY created_at DESC LIMIT ?").all(like, limit),
      ...this.st("SELECT 'hook' AS src, session_id, data AS text, t FROM events WHERE kind = 'hook' AND (CASE WHEN json_valid(data) THEN json_extract(data, '$.prompt') END LIKE ? ESCAPE '!' OR CASE WHEN json_valid(data) THEN json_extract(data, '$.lastAnswer') END LIKE ? ESCAPE '!') ORDER BY id DESC LIMIT ?").all(like, like, limit),
      ...this.st("SELECT 'link' AS src, l.to_session AS session_id, e.text, e.t FROM link_events e JOIN links l ON l.link_id = e.link_id WHERE e.kind = 'prompt' AND e.text LIKE ? ESCAPE '!' ORDER BY e.id DESC LIMIT ?").all(like, limit),
    ];
    return rows.map(plain);
  }
  // 화면 답과 제공자별 완료 답. JSON 표현 대신 본문에서 찾아 따옴표·역슬래시도 그대로 검색한다.
  searchOutputs(q, limit = 100) {
    const like = `%${String(q).replace(/[!%_]/g, (c) => '!' + c)}%`;
    return this.st("SELECT session_id, data AS text, t FROM events WHERE kind IN ('answer_screen', 'answer_gemini', 'answer_agy') AND CASE WHEN json_valid(data) THEN json_extract(data, '$.text') END LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT ?").all(like, limit).map(plain);
  }
}
installRecords(Store);
installRecall(Store); // P7
installBranch(Store); // P8
installWorktrees(Store); // P27
installImports(Store); // P34
installMerge(Store); // P37
