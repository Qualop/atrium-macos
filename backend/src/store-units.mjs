// 저장소(store.mjs)의 P180 표: 일 단위(work_units)와 시도(unit_tries). 하네스 0단계(docs research harness-arch.md 9·12절).
// 일 단위: 위 세션이 하위에게 맡긴 일 하나(atrium child --prompt, 일 관계의 하위에게 가는 atrium prompt, 잠든 하위를 깨우며 맡긴 일).
// 시도: 그 일을 한 세션이 맡은 한 번(첫 요청 앞머리를 받았는지, 시작·끝, 결과 ok|failed, done 글, 멈춘 까닭, 알린 때).
// 옮기기: CREATE TABLE IF NOT EXISTS라 옛 board.db에는 빈 표가 생긴다. 백엔드가 다시 떠도 일과 시도는 이 표에서 이어진다.
// SQL은 store.mjs와 store-*.mjs에만 둔다(ARCH 5절 "저장소").

// work_units.status: open | done | failed | cancelled. origin: child | prompt | wake
// unit_tries.result: ok | failed | null. claimed_by: wait | queue | record(상위가 닫혀 기록만) | null
// unit_tries.delivery_id: 앞머리를 붙인 첫 요청의 전달. notice_delivery_id: done 값을 상위에게 보낸 전달(대기열 길)
export const UNITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS work_units (id TEXT PRIMARY KEY, from_session TEXT NOT NULL, to_session TEXT NOT NULL, origin TEXT NOT NULL, spec TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER) STRICT;
CREATE INDEX IF NOT EXISTS work_units_to ON work_units(to_session, status);
CREATE INDEX IF NOT EXISTS work_units_from ON work_units(from_session, created_at);
CREATE TABLE IF NOT EXISTS unit_tries (id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, session_id TEXT NOT NULL, header INTEGER NOT NULL DEFAULT 0, delivery_id TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, result TEXT, done_text TEXT, stop_reason TEXT, notified_at INTEGER, claimed_by TEXT, notice_delivery_id TEXT) STRICT;
CREATE INDEX IF NOT EXISTS unit_tries_session ON unit_tries(session_id, ended_at);
CREATE INDEX IF NOT EXISTS unit_tries_unit ON unit_tries(unit_id);
`;

const unitRow = (r) => (r ? { id: r.id, from: r.from_session, to: r.to_session, origin: r.origin, spec: r.spec, status: r.status, createdAt: r.created_at, closedAt: r.closed_at ?? null } : null);
const tryRow = (r) => (r ? { id: r.id, unitId: r.unit_id, sessionId: r.session_id, header: !!r.header, deliveryId: r.delivery_id ?? null, startedAt: r.started_at, endedAt: r.ended_at ?? null, result: r.result ?? null, doneText: r.done_text ?? null, stopReason: r.stop_reason ?? null, notifiedAt: r.notified_at ?? null, claimedBy: r.claimed_by ?? null, noticeDeliveryId: r.notice_delivery_id ?? null } : null);
const TRY_COLS = { endedAt: 'ended_at', result: 'result', doneText: 'done_text', stopReason: 'stop_reason', notifiedAt: 'notified_at', claimedBy: 'claimed_by', noticeDeliveryId: 'notice_delivery_id', deliveryId: 'delivery_id', startedAt: 'started_at' };
const UNIT_COLS = { status: 'status', closedAt: 'closed_at' };

function setter(table, cols, store, id, fields) {
  const sets = []; const vals = [];
  for (const [k, v] of Object.entries(fields)) { if (!cols[k]) throw new Error('unknown field ' + k); sets.push(`${cols[k]} = ?`); vals.push(v ?? null); }
  if (sets.length) store.st(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

export function installUnits(Store) {
  Object.assign(Store.prototype, {
    insertUnit(u) { this.st('INSERT INTO work_units (id, from_session, to_session, origin, spec, status, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(u.id, u.from, u.to, u.origin, u.spec, u.status || 'open', u.createdAt, u.closedAt ?? null); },
    updateUnit(id, fields) { setter('work_units', UNIT_COLS, this, id, fields); },
    getUnit(id) { return unitRow(this.st('SELECT * FROM work_units WHERE id = ?').get(id)); },
    insertTry(t) { this.st('INSERT INTO unit_tries (id, unit_id, session_id, header, delivery_id, started_at) VALUES (?, ?, ?, ?, ?, ?)').run(t.id, t.unitId, t.sessionId, t.header ? 1 : 0, t.deliveryId ?? null, t.startedAt); },
    updateTry(id, fields) { setter('unit_tries', TRY_COLS, this, id, fields); },
    getTry(id) { return tryRow(this.st('SELECT * FROM unit_tries WHERE id = ?').get(id)); },
    // 그 세션의 열린 시도(하나뿐이어야 한다. 여럿이면 가장 늦은 것)
    openTryOf(sessionId) { return tryRow(this.st('SELECT * FROM unit_tries WHERE session_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(sessionId)); },
    // 열린 시도가 있는 세션들(백엔드가 다시 뜰 때)
    openTries() { return this.st('SELECT * FROM unit_tries WHERE ended_at IS NULL').all().map(tryRow); },
    triesOfUnit(unitId) { return this.st('SELECT * FROM unit_tries WHERE unit_id = ? ORDER BY started_at').all(unitId).map(tryRow); },
    // 그 세션에 줄 선 일(열렸지만 시도가 한 번도 없는 일), 먼저 온 것부터
    queuedUnitsOf(sessionId) { return this.st("SELECT u.* FROM work_units u WHERE u.to_session = ? AND u.status = 'open' AND NOT EXISTS (SELECT 1 FROM unit_tries t WHERE t.unit_id = u.id) ORDER BY u.created_at").all(sessionId).map(unitRow); },
    queuedUnitSessions() { return this.st("SELECT DISTINCT u.to_session AS s FROM work_units u WHERE u.status = 'open' AND NOT EXISTS (SELECT 1 FROM unit_tries t WHERE t.unit_id = u.id)").all().map((r) => r.s); },
    // 그 세션이 맡긴 일(최근 것부터)
    unitsFrom(sessionId, limit = 50) { return this.st('SELECT * FROM work_units WHERE from_session = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit).map(unitRow); },
    // 그 세션이 맡긴 일 가운데 아직 열린 것의 수(하위를 기다리며 쉬는 워커인가)
    openUnitsFromCount(sessionId) { return Number(this.st("SELECT COUNT(*) AS n FROM work_units WHERE from_session = ? AND status = 'open'").get(sessionId).n); },
    // from → to로 맡긴 일의 마지막으로 done이 닫은 시도
    lastDoneTry(fromId, toId) {
      return tryRow(this.st('SELECT t.* FROM unit_tries t JOIN work_units u ON u.id = t.unit_id WHERE u.from_session = ? AND t.session_id = ? AND t.result IS NOT NULL ORDER BY t.ended_at DESC LIMIT 1').get(fromId, toId));
    },
    lastTryOfUnit(unitId) { return tryRow(this.st('SELECT * FROM unit_tries WHERE unit_id = ? ORDER BY started_at DESC LIMIT 1').get(unitId)); },
  });
}
