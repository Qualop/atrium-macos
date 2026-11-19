// 저장소(store.mjs)의 P8 열(ARCH 4절 K): 판의 명령(atrium child)으로 만든 하위 세션의 기록.
// store.mjs가 이 파일을 불러 열을 만들고 Store에 메서드를 붙인다. 저장소 모듈의 일부라 SQL은 store.mjs와 이 파일에만 둔다(ARCH 5절 "저장소").
// sessions.branch(JSON): { role, depth, by(부모 세션 ID), at, worktree, kind, inherited, via }. 부모는 P4의 parent_session_id 그대로다.
// 옮기기: P7까지의 board.db에는 이 열이 ALTER TABLE로 빈 채 더해진다(store.mjs의 ADDED_COLUMNS와 같은 방법). 그 전의 세션은 하위 세션이 아니다.
// 판에 올린 에이전트(F3)의 parent_session_id는 그대로 두고, 깊이를 셀 때만 같이 따라간다. backend/test/p8.test.mjs가 P7 모양의 board.db로 확인한다.

export const BRANCH_COLUMNS = { sessions: { branch: 'TEXT' } };
// P156: 세션 사이 일 관계(relations.mjs). 쌍마다 한 줄(a, b는 넣은 순서 그대로. 하위면 a가 위). 줄이 없으면 자동이다.
// P157: link_events_kind_t는 assignSenders(최근 지시만 훑기)용. 옛 board.db에도 IF NOT EXISTS로 생긴다
// 옮기기: CREATE TABLE IF NOT EXISTS라 옛 board.db에는 빈 표가 생기고 옛 기록은 모두 자동(띄움·역할 선 = 하위)이다
export const BRANCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS relations (a TEXT NOT NULL, b TEXT NOT NULL, relation TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (a, b)) STRICT;
CREATE INDEX IF NOT EXISTS link_events_kind_t ON link_events(kind, t);
`;

const P = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return null; } };

export function installBranch(Store) {
  Object.assign(Store.prototype, {
    setBranch(sessionId, info) { this.st('UPDATE sessions SET branch = ? WHERE session_id = ?').run(info == null ? null : JSON.stringify(info), sessionId); },
    // 세션마다 부모와 하위 세션 기록(닫힌 세션 포함). 깊이와 자손을 셀 때 닫힌 중간 세션도 따라가야 한다
    branchRows() {
      return this.st('SELECT session_id, name, parent_session_id, branch, closed_at, origin FROM sessions').all()
        .map((r) => ({ sessionId: r.session_id, name: r.name, parentSessionId: r.parent_session_id ?? null, branch: P(r.branch), closedAt: r.closed_at ?? null, origin: r.origin || 'board' }));
    },
    // P157: since 이후 하위에게 지시(꼬리표 assign)를 보낸 세션과 그 마지막 시각. 받는 세션이 닫혔어도 센다(세션 맵의 솔로 판정)
    assignSenders(since = 0) {
      return this.st(`SELECT l.from_session AS s, MAX(e.t) AS at FROM link_events e JOIN links l ON l.link_id = e.link_id WHERE e.kind = 'prompt' AND e.t >= ? AND e.data LIKE '%"tag":"assign"%' GROUP BY l.from_session`).all(since)
        .map((r) => ({ sessionId: r.s, at: Number(r.at) }));
    },
    // P156: 일 관계. 쌍마다 한 줄이라 넣기 전에 두 차례(a,b·b,a)를 모두 지운다
    relationRows() { return this.st('SELECT a, b, relation, source, at FROM relations').all().map((r) => ({ a: r.a, b: r.b, relation: r.relation, source: r.source, at: r.at })); },
    setRelation(a, b, relation, source, at = Date.now()) {
      this.tx(() => {
        this.st('DELETE FROM relations WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').run(a, b, b, a);
        if (relation) this.st('INSERT INTO relations (a, b, relation, source, at) VALUES (?, ?, ?, ?, ?)').run(a, b, relation, source, at);
      });
    },
  });
}
