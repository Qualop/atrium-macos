// 저장소(store.mjs)의 P37 메서드: 워크스페이스 키 옮기기(폴더 워크스페이스가 저장소가 되면 합치기). 새 표는 없다.
// store.mjs가 이 파일을 불러 Store에 메서드를 붙인다. 저장소 모듈의 일부라 SQL은 store*.mjs에만 둔다(ARCH 5절 "저장소").
// 무엇을 옮기는지와 줄을 어떻게 합치는지는 workspace-merge.mjs(순수 함수 rekeyBoard, mergedWorkspaceRow)와 같다.
import { mergedWorkspaceRow, rekeyKey, rekeyList } from './workspace-merge.mjs';
import { GROUPS_META, rekeyGroups } from './ws-groups.mjs';

export function installMerge(Store) {
  Object.assign(Store.prototype, {
    // from 키의 워크스페이스를 ws({ key, kind, root })로 옮긴다. 한 트랜잭션. 옮긴 수를 돌려준다. from 줄이 없으면 null(여러 번 불러도 같다)
    // - 세션 행(닫힌 세션도), 덩어리, 메모, 칸반, 대화 노드의 workspace_key. 노드 자리와 area는 그대로
    // - 워크트리 상자 자리: 저장소로 가면 함께(대상에 같은 상자가 있으면 대상 것), 폴더로 가면 지운다
    // - 워크스페이스 줄: 대상 줄이 없으면 옛 줄의 자리·순서·뷰포트로 새로 만들고, 있으면 합친다. 옛 줄은 지운다
    // - meta: 지금 워크스페이스, 저절로 열지 않을 목록, 가상 그룹 소속·순서. 정리 되돌리기는 두 키와 판 전체(*)에서 지운다
    rekeyWorkspace(from, ws) {
      const fromRow = this.getWorkspace(from);
      if (!fromRow || from === ws.key) return null;
      const toRow = this.getWorkspace(ws.key);
      const row = mergedWorkspaceRow(fromRow, toRow, ws);
      const n = {};
      const upd = (table) => { n[table] = Number(this.db.prepare(`UPDATE ${table} SET workspace_key = ? WHERE workspace_key = ?`).run(ws.key, from).changes); };
      this.tx(() => {
        if (toRow) {
          this.st('UPDATE workspaces SET kind = ?, root = ?, x = ?, y = ?, viewport = ?, created_at = ?, auto_opened = ?, updated_at = ? WHERE workspace_key = ?')
            .run(row.kind, row.root, row.x, row.y, row.viewport ? JSON.stringify(row.viewport) : null, row.createdAt, row.auto ? 1 : null, Date.now(), ws.key);
        } else {
          this.st('INSERT INTO workspaces (workspace_key, kind, root, viewport, created_at, updated_at, x, y, auto_opened) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(row.key, row.kind, row.root, row.viewport ? JSON.stringify(row.viewport) : null, row.createdAt, Date.now(), row.x, row.y, row.auto ? 1 : null);
        }
        for (const t of ['sessions', 'docks', 'memos', 'kanbans', 'convo_nodes']) upd(t);
        if (ws.kind === 'repo') n.worktree_areas = Number(this.st('UPDATE OR IGNORE worktree_areas SET workspace_key = ? WHERE workspace_key = ?').run(ws.key, from).changes);
        this.st('DELETE FROM worktree_areas WHERE workspace_key = ?').run(from);
        this.st('DELETE FROM workspaces WHERE workspace_key = ?').run(from);
        const cur = this.getMeta('currentWorkspace');
        if (cur === from) this.setMeta('currentWorkspace', rekeyKey(cur, from, ws.key));
        const declined = this.getMeta('autoOpenDeclined');
        if (Array.isArray(declined) && declined.includes(from)) this.setMeta('autoOpenDeclined', rekeyList(declined, from, ws.key).filter((k) => k !== ws.key));
        const groups = this.getMeta(GROUPS_META);
        if (groups != null) this.setMeta(GROUPS_META, rekeyGroups(groups, from, ws.key));
        for (const k of [from, ws.key, '*']) if (this.getMeta(`arrangeUndo:${k}`)) this.setMeta(`arrangeUndo:${k}`, null);
      });
      return { from, to: ws.key, merged: !!toRow, ...n };
    },
  });
}
