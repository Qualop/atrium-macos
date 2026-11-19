// P22 단위 시험: 그룹·묶음 실행·한 줄 메모 빼기. 옛 판(그룹이 있던 board.db)을 처음 열 때 그룹을 지우고 노드는 그 자리에 둔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.mjs';
import { blockReason, DeliveryQueue } from '../src/delivery.mjs';
import { missionGraph } from '../src/mission.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p22-'));
const tables = (st) => st.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);

// P21까지의 판: 그룹 둘(하나는 영역 있음), 그룹에 든 세션 둘과 밖의 세션 하나, 묶음 항목, 그룹 대상 루프와 세션 대상 루프, 한 줄 메모
async function oldBoard() {
  const file = path.join(tmp(), 'board.db');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(path.join(HERE, 'fixtures', 'p4-schema.sql'), 'utf8'));
  db.exec('ALTER TABLE groups ADD COLUMN workspace_key TEXT'); // P5에서 더한 열
  const sess = (id, name, group, closed = null) => db.prepare("INSERT INTO sessions (session_id, name, cwd, group_id, pane_id, workspace_id, agent_name, permission_mode, settings_path, hook_token, created_at, closed_at, kind, origin) VALUES (?, ?, 'C:/w', ?, 'w1:p1', 'w1', ?, 'manual', '', '', 1, ?, 'claude', 'board')").run(id, name, group, name, closed);
  sess('s-a', 'a', 'g1'); sess('s-b', 'b', 'g1'); sess('s-c', 'c', null); sess('s-old', 'old', 'g2', 5);
  db.prepare("INSERT INTO groups (group_id, name, color, cwd, created_at, x, y, w, h, max_concurrent, workspace_key) VALUES ('g1', 'team', '#61afef', 'C:/w', 1, -20, -64, 1560, 1040, 3, 'k')").run();
  db.prepare("INSERT INTO groups (group_id, name, color, cwd, created_at) VALUES ('g2', 'cli', NULL, NULL, 2)").run(); // P1 CLI --group(영역 없음)
  for (const [sid, x, y] of [['s-a', 0, 0], ['s-b', 760, 0], ['s-c', 3000, 0]]) db.prepare('INSERT INTO nodes (session_id, x, y, w, h, z) VALUES (?, ?, ?, 720, 460, 0)').run(sid, x, y);
  db.prepare("INSERT INTO batch_items (item_id, group_id, seq, name, prompt, status, created_at, updated_at) VALUES ('i1', 'g1', 1, 'team-1', 'p', 'queued', 1, 1), ('i2', 'g1', 2, 'team-2', 'p', 'spawned', 1, 1)").run();
  db.prepare("INSERT INTO notes (session_id, group_id, text, created_at) VALUES ('s-a', NULL, '떠나며 한 줄', 1)").run();
  db.close();
  const st = new Store(file);
  const loop = (id, kind, target) => st.insertLoop({ loopId: id, target: { kind, id: target }, prompt: 'x', trigger: { type: 'idle' }, stop: {}, status: 'active', nextAt: null, per: {}, history: [], createdAt: 1 });
  loop('r-g', 'group', 'g1'); loop('r-s', 'session', 's-c');
  return { st, file };
}

test('P22 옮기기: 처음 열 때 그룹·묶음 항목·그룹 대상 루프를 지우고, 세션의 소속을 풀고, 노드는 그 자리에 둔다. 두 번째는 할 일이 없다', async () => {
  const { st, file } = await oldBoard();
  const nodesBefore = st.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h]);
  const r = st.dropGroups();
  assert.deepEqual(r.groups, [{ groupId: 'g1', name: 'team' }, { groupId: 'g2', name: 'cli' }]);
  assert.deepEqual(r.members.map((x) => [x.name, x.groupId]), [['a', 'g1'], ['b', 'g1']], '열린 세션의 소속만 센다');
  assert.deepEqual(r.loops.map((l) => l.loopId), ['r-g']);
  assert.deepEqual(r.batchItems, { queued: 1, spawned: 1 });
  assert.ok(!tables(st).includes('groups') && !tables(st).includes('batch_items'), '그룹 표와 묶음 항목 표는 지운다');
  assert.equal(st.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE group_id IS NOT NULL').get().n, 0, '닫힌 세션의 소속도 푼다');
  assert.deepEqual(st.loops().map((l) => l.loopId), ['r-s'], '세션 대상 루프는 남는다');
  assert.deepEqual(st.nodes().map((n) => [n.session_id, n.x, n.y, n.w, n.h]), nodesBefore, '노드 자리와 크기는 그대로');
  assert.equal(st.getSession('s-a').groupId, undefined, '세션 행에 그룹이 없다');
  assert.ok(tables(st).includes('notes'), '옛 한 줄 메모 표는 지우지 않고 읽지 않는다');
  assert.equal(st.dropGroups(), null);
  st.close();
  // 다시 열어도 그룹 표를 만들지 않는다
  const again = new Store(file);
  assert.ok(!tables(again).includes('groups'));
  assert.equal(again.dropGroups(), null);
  again.close();
});

test('P22 옮기기: 새 판에는 그룹·묶음 항목·한 줄 메모 표가 생기지 않는다', () => {
  const st = new Store(path.join(tmp(), 'board.db'));
  const t = tables(st);
  for (const name of ['groups', 'batch_items', 'notes']) assert.ok(!t.includes(name), name);
  assert.equal(st.dropGroups(), null);
  assert.equal(typeof st.addNote, 'undefined');
  assert.equal(typeof st.insertGroup, 'undefined');
  // 전달과 Thread 결과는 그룹 없이 쓰고 읽는다
  st.insertDelivery({ deliveryId: 'd1', sessionId: 's', text: 'hi', status: 'queued', createdAt: 1 });
  assert.equal('groupId' in st.getDelivery('d1'), false);
  st.close();
});

test('P22: 전달 대기열에는 그룹 상한(batch_limit)이 없다', async () => {
  const cfg = { inputQuietMs: 0, deliveryMaxWaitMs: 60000, submitConfirmMs: 30000 };
  assert.equal(blockReason({ state: 'ready', agentPresent: true, termConnected: true, closed: false, batchFull: true }, 0, cfg), null, '옛 batchFull 값은 보지 않는다');
  const store = new Store(path.join(tmp(), 'b.db'));
  const sent = [];
  const q = new DeliveryQueue({ store, cfg, view: () => ({ state: 'ready', agentPresent: true, termConnected: true, closed: false }), send: async (sid, text) => sent.push([sid, text]) });
  const d = q.enqueue('x', 'job', { groupId: 'g1' }); // 옛 호출 모양이 와도 그룹을 남기지 않는다
  q.pump(); await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sent, [['x', 'job']]);
  assert.equal(d.groupId, undefined);
  store.close();
});

test('P22: 미션 맵은 두 열(사람과 지시하는 세션, 세션)이고 그룹 노드와 소속 선이 없다', () => {
  const sessions = [{ sessionId: 'A', name: 'lead', state: 'ready', groupId: 'G' }, { sessionId: 'B', name: 'w', state: 'working' }];
  const links = [{ linkId: 'l', from: 'A', to: 'B', role: '워커', count: 0 }];
  const loops = [{ loopId: 'r', target: { kind: 'group', id: 'G' }, prompt: 'x', status: 'active' }];
  const m = missionGraph({ sessions, links, thread: [], loops });
  assert.deepEqual(m.nodes.map((n) => [n.id, n.column]), [['human', 0], ['s:A', 0], ['s:B', 1]]);
  assert.deepEqual(m.edges.map((e) => e.kind), ['role'], '옛 그룹 대상 루프는 긋지 않는다');
});
