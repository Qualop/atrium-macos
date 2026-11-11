// 저장소(store.mjs)의 P7 표와 열(ARCH 4절 J): 대화 기록 색인(convo_index)과 닫힌 세션의 닫힌 까닭·목록에서 빼기.
// store.mjs가 이 파일을 불러 표와 열을 만들고 Store에 메서드를 붙인다. 저장소 모듈의 일부라 SQL은 store.mjs와 이 파일에만 둔다(ARCH 5절 "저장소").
// 옮기기: P6까지의 board.db에는 convo_index가 빈 표로 생기고, sessions에 열 셋이 ALTER TABLE로 더해진다(store.mjs의 ADDED_COLUMNS와 같은 방법).
// 그 전에 닫힌 세션의 닫힌 까닭은 판 이벤트(closed)에서 읽는다(closedSessions). backend/test/p7.test.mjs가 P6 모양의 board.db로 확인한다.

export const RECALL_SCHEMA = `
CREATE TABLE IF NOT EXISTS convo_index (
  path TEXT PRIMARY KEY, convo_id TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL,
  cwd TEXT, branch TEXT, entrypoints TEXT, title TEXT, title_source TEXT, first_prompt TEXT, last_prompt TEXT, last_answer TEXT,
  first_at INTEGER, last_at INTEGER, prompts INTEGER NOT NULL DEFAULT 0, answers INTEGER NOT NULL DEFAULT 0, has_text INTEGER NOT NULL DEFAULT 0, scanned_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS convo_index_id ON convo_index(convo_id);
CREATE TABLE IF NOT EXISTS archive (item TEXT PRIMARY KEY, kind TEXT NOT NULL, item_id TEXT NOT NULL, archived_at INTEGER, restored_at INTEGER, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS convo_nodes (convo_id TEXT PRIMARY KEY, workspace_key TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, shown INTEGER NOT NULL DEFAULT 1, placed_at INTEGER NOT NULL, moved_at INTEGER) STRICT;
`;
// P13: convo_nodes는 캔버스에 올린 판 밖 대화 노드의 자리(대화 ID마다). shown이 0이면 지금은 올리지 않는 것(보관, 판 세션이 됨, 상한 밖)이고 자리는 남긴다.
// convo_index에 더한 열: 시작 시각, 첫 지시 열쇠(해시), 띄움 줄(JSON, 늘어난 부분만 읽고 읽은 바이트 위치 spawn_off), 하위 에이전트 수
// P10: 보관 표 archive(항목 'convo:<대화 ID>' 또는 'session:<세션 ID>'마다 손으로 보관한 시각과 꺼낸 시각). 판정은 archive.mjs.
// P7의 "빼기"(sessions.dismissed_at)는 손 보관으로 읽는다. workspaces.auto_opened는 리포 스스로 찾기가 연 워크스페이스(빈 영역을 작게)
// sessions에 더하는 열: 닫힌 까닭, 사이드바 목록에서 뺀 시각, 다시 열 때 다른 세션으로 옮겨 간 경우 그 세션 ID(판에 올린 claude, J2)
export const RECALL_COLUMNS = { sessions: { close_reason: 'TEXT', dismissed_at: 'INTEGER', reopened_as: 'TEXT' }, workspaces: { auto_opened: 'INTEGER' }, convo_index: { start_at: 'INTEGER', prompt_key: 'TEXT', spawns: 'TEXT', spawn_off: 'INTEGER', subagents: 'INTEGER' } };
export const RECALL_SESSION_FIELDS = { closeReason: 'close_reason', dismissedAt: 'dismissed_at', reopenedAs: 'reopened_as', settingsPath: 'settings_path', hookToken: 'hook_token', name: 'name', label: 'label', permissionMode: 'permission_mode', model: 'model', effort: 'effort' };

const J = (v) => (v == null ? null : JSON.stringify(v));
const P = (s, d = null) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };

function convoRow(r) {
  if (!r) return null;
  return { path: r.path, convId: r.convo_id, size: r.size, mtime: r.mtime, cwd: r.cwd, branch: r.branch, entrypoints: P(r.entrypoints, []), title: r.title, titleSource: r.title_source, firstPrompt: r.first_prompt, lastPrompt: r.last_prompt, lastAnswer: r.last_answer, firstAt: r.first_at, lastAt: r.last_at, prompts: r.prompts, answers: r.answers, hasText: !!r.has_text, scannedAt: r.scanned_at,
    startAt: r.start_at ?? null, promptKey: r.prompt_key ?? null, spawns: P(r.spawns, []), spawnOff: r.spawn_off ?? 0, subagents: r.subagents ?? 0 };
}
const convoNodeRow = (r) => (r ? { convId: r.convo_id, workspaceKey: r.workspace_key, x: r.x, y: r.y, w: r.w, h: r.h, shown: !!r.shown, placedAt: r.placed_at, movedAt: r.moved_at ?? null, area: r.area || '' } : null); // P27: area(놓인 워크트리 영역)

export function installRecall(Store) {
  Object.assign(Store.prototype, {
    // 대화 기록 색인: 파일 하나에 한 줄. 경로·크기·수정 시각이 같으면 다시 읽지 않는다
    convoIndex() { return this.st('SELECT * FROM convo_index').all().map(convoRow); },
    getConvoById(id) { return convoRow(this.st('SELECT * FROM convo_index WHERE convo_id = ? ORDER BY last_at DESC LIMIT 1').get(String(id).toLowerCase())); },
    putConvo(c) {
      this.st(`INSERT INTO convo_index (path, convo_id, size, mtime, cwd, branch, entrypoints, title, title_source, first_prompt, last_prompt, last_answer, first_at, last_at, prompts, answers, has_text, scanned_at, start_at, prompt_key, spawns, spawn_off, subagents)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(path) DO UPDATE SET convo_id = excluded.convo_id, size = excluded.size, mtime = excluded.mtime, cwd = excluded.cwd, branch = excluded.branch, entrypoints = excluded.entrypoints,
                 title = excluded.title, title_source = excluded.title_source, first_prompt = excluded.first_prompt, last_prompt = excluded.last_prompt, last_answer = excluded.last_answer,
                 first_at = excluded.first_at, last_at = excluded.last_at, prompts = excluded.prompts, answers = excluded.answers, has_text = excluded.has_text, scanned_at = excluded.scanned_at,
                 start_at = excluded.start_at, prompt_key = excluded.prompt_key, spawns = excluded.spawns, spawn_off = excluded.spawn_off, subagents = excluded.subagents`)
        .run(c.path, c.convId, c.size, Math.round(c.mtime), c.cwd ?? null, c.branch ?? null, J(c.entrypoints || []), c.title ?? null, c.titleSource ?? null, c.firstPrompt ?? null, c.lastPrompt ?? null, c.lastAnswer ?? null, c.firstAt ?? null, c.lastAt ?? null, c.prompts || 0, c.answers || 0, c.hasText ? 1 : 0, c.scannedAt || Date.now(),
          c.startAt ?? null, c.promptKey ?? null, J(c.spawns || []), c.spawnOff ?? 0, c.subagents ?? 0);
    },
    setConvoSpawns(p, spawns, off) { this.st('UPDATE convo_index SET spawns = ?, spawn_off = ? WHERE path = ?').run(J(spawns || []), off || 0, p); },
    // ---------- P13: 대화 노드 ----------
    convoNodes() { return this.st('SELECT * FROM convo_nodes').all().map(convoNodeRow); },
    shownConvoNodes() { return this.st('SELECT * FROM convo_nodes WHERE shown = 1').all().map(convoNodeRow); },
    putConvoNode(n) {
      this.st(`INSERT INTO convo_nodes (convo_id, workspace_key, x, y, w, h, shown, placed_at, moved_at, area) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(convo_id) DO UPDATE SET workspace_key = excluded.workspace_key, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h, shown = excluded.shown, moved_at = COALESCE(excluded.moved_at, convo_nodes.moved_at), area = COALESCE(excluded.area, convo_nodes.area)`)
        .run(String(n.convId).toLowerCase(), n.workspaceKey, n.x, n.y, n.w, n.h, n.shown === false ? 0 : 1, n.placedAt || Date.now(), n.movedAt ?? null, n.area ?? null);
    },
    setConvoNodesShown(ids, on) { for (const id of ids) this.st('UPDATE convo_nodes SET shown = ? WHERE convo_id = ?').run(on ? 1 : 0, String(id).toLowerCase()); },
    deleteConvoNodes(ids) { for (const id of ids) this.st('DELETE FROM convo_nodes WHERE convo_id = ?').run(String(id).toLowerCase()); },
    dropConvos(paths) { for (const p of paths) this.st('DELETE FROM convo_index WHERE path = ?').run(p); },
    clearConvos() { this.db.exec('DELETE FROM convo_index'); }, // 읽는 방법(convos.mjs CONVO_PARSER)이 바뀌면 색인을 다시 만든다

    // 닫힌 세션(J2): 판에서 빠진 것(다른 세션으로 옮겨 간 것은 빼고). 닫힌 까닭은 열(P7부터)이나 판 이벤트(P6까지). 보관 여부는 부르는 쪽이 archiveMarks로 가린다(P10)
    closedSessions() {
      return this.st('SELECT * FROM sessions WHERE closed_at IS NOT NULL AND reopened_as IS NULL ORDER BY closed_at DESC').all().map((r) => {
        let reason = r.close_reason ?? null;
        if (!reason) { const e = this.st("SELECT data FROM events WHERE session_id = ? AND kind = 'closed' ORDER BY id DESC LIMIT 1").get(r.session_id); reason = e ? (P(e.data, {}) || {}).reason || null : null; }
        return { sessionId: r.session_id, name: r.name, label: r.label ?? null, cwd: r.cwd, kind: r.kind || 'claude', origin: r.origin || 'board', workspaceKey: r.workspace_key ?? null, createdAt: r.created_at, closedAt: r.closed_at, dismissedAt: r.dismissed_at ?? null, reason, runtime: P(r.runtime, null), permissionMode: r.permission_mode, model: r.model, effort: r.effort };
      });
    },
    // 판이 아는 대화 ID(열린 세션, 닫힌 세션, 목록에서 뺀 세션 모두): 판 밖 대화 목록에서 뺀다
    boardConversations() {
      const out = new Map();
      for (const r of this.st("SELECT session_id, kind, origin, closed_at, dismissed_at, reopened_as, runtime FROM sessions WHERE kind = 'claude'").all()) {
        const rt = P(r.runtime, {}) || {};
        const ids = new Set([r.origin === 'board' || !r.origin ? r.session_id : null, rt.claudeSessionId, rt.herdr && rt.herdr.agentSessionId].filter(Boolean).map((x) => String(x).toLowerCase()));
        for (const id of ids) { const prev = out.get(id); const v = { sessionId: r.session_id, open: r.closed_at == null, dismissed: r.dismissed_at != null, movedTo: r.reopened_as ?? null }; if (!prev || (v.open && !prev.open)) out.set(id, v); }
      }
      return out;
    },
    // 다시 열 세션 하나(닫힌 것만)
    closedSession(id) { const r = this.st('SELECT * FROM sessions WHERE session_id = ? AND closed_at IS NOT NULL').get(id); return r ? { ...this.getSession(id), closeReason: r.close_reason ?? null, dismissedAt: r.dismissed_at ?? null, reopenedAs: r.reopened_as ?? null } : null; },
    // 세션이 띄워질 때의 실행 인자(다른 종류의 이어 가기·다시 띄우기). spawn 이벤트에 남아 있다
    spawnInfo(id) { const e = this.st("SELECT data FROM events WHERE session_id = ? AND kind = 'spawn' ORDER BY id LIMIT 1").get(id); return e ? P(e.data, null) : null; },
    nodeOf(id) { const r = this.st('SELECT * FROM nodes WHERE session_id = ?').get(id); return r ? { ...r } : null; },
    // P15: 닫으면서 삭제한 세션은 판 기록에서 지운다(닫힌 목록, 노드 자리, 선, 보관 표시). 이벤트 기록은 남긴다
    deleteClosedSession(id) {
      const r = this.st('SELECT session_id FROM sessions WHERE session_id = ? AND closed_at IS NOT NULL').get(id);
      if (!r) return false;
      this.st('DELETE FROM nodes WHERE session_id = ?').run(id);
      this.st('DELETE FROM link_events WHERE link_id IN (SELECT link_id FROM links WHERE from_session = ? OR to_session = ?)').run(id, id);
      this.st('DELETE FROM links WHERE from_session = ? OR to_session = ?').run(id, id);
      this.st('DELETE FROM archive WHERE item = ?').run(`session:${String(id).toLowerCase()}`);
      this.st('DELETE FROM sessions WHERE session_id = ?').run(id);
      return true;
    },
    // ---------- 보관(P10) ----------
    // 항목 → { archivedAt, restoredAt }. P7의 빼기(dismissed_at)는 표에 줄이 없으면 손 보관으로 친다
    archiveMarks() {
      const out = new Map();
      for (const r of this.st("SELECT session_id, dismissed_at FROM sessions WHERE dismissed_at IS NOT NULL").all()) out.set(`session:${String(r.session_id).toLowerCase()}`, { archivedAt: r.dismissed_at, restoredAt: null, legacy: true });
      for (const r of this.st('SELECT * FROM archive').all()) out.set(r.item, { archivedAt: r.archived_at ?? null, restoredAt: r.restored_at ?? null });
      return out;
    },
    setArchive(kind, id, { archivedAt = null, restoredAt = null }) {
      const item = `${kind}:${String(id).toLowerCase()}`;
      this.st(`INSERT INTO archive (item, kind, item_id, archived_at, restored_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(item) DO UPDATE SET archived_at = excluded.archived_at, restored_at = excluded.restored_at, updated_at = excluded.updated_at`).run(item, kind, String(id).toLowerCase(), archivedAt, restoredAt, Date.now());
      if (kind === 'session' && !archivedAt) this.st('UPDATE sessions SET dismissed_at = NULL WHERE lower(session_id) = ?').run(String(id).toLowerCase());
    },
    // 색인에서 크기·수정 시각만 고친다(손으로 보관한 대화는 바뀌어도 글을 다시 읽지 않는다)
    touchConvo(p, size, mtime) { this.st('UPDATE convo_index SET size = ?, mtime = ?, last_at = MAX(COALESCE(last_at, 0), ?), scanned_at = ? WHERE path = ?').run(size, Math.round(mtime), Math.round(mtime), Date.now(), p); },
    setWorkspaceAuto(key, on) { this.st('UPDATE workspaces SET auto_opened = ? WHERE workspace_key = ?').run(on ? 1 : null, key); },

    // 판으로 다시 열기: 닫힘을 풀고 새 패널·설정을 넣는다
    reopenRow(id, f) {
      this.st('UPDATE sessions SET closed_at = NULL, close_reason = NULL, dismissed_at = NULL WHERE session_id = ?').run(id);
      this.st('UPDATE archive SET archived_at = NULL, restored_at = ?, updated_at = ? WHERE item = ?').run(Date.now(), Date.now(), `session:${String(id).toLowerCase()}`); // P10: 다시 열면 보관도 풀린다
      if (Object.keys(f).length) this.updateSession(id, f);
    },
  });
}
