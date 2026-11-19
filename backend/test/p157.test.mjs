// P157 단위 시험: 세션 맵 솔로 판정에 쓰는 "하위를 불렀던" 기록.
// mission.graph 노드의 closedKids(기간 안에 닫힌 계보 자식), assignAt(기간 안의 마지막 assign 지시), parentClosed(계보 부모가 닫힘)와 저장소 assignSenders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { missionGraph, CALLED_MS } from '../src/mission.mjs';

const NOW = 1_800_000_000_000;
const sess = (sessionId, extra = {}) => ({ sessionId, name: sessionId, state: 'idle', workspaceKey: 'w', ...extra });

test('missionGraph: 닫힌 하위·assign 지시·닫힌 상위를 노드에 붙이고, 기간 밖은 보지 않는다', () => {
  const sessions = [sess('lead'), sess('old'), sess('boss'), sess('alone'), sess('orphan', { parentSessionId: 'gone' }), sess('kid', { parentSessionId: 'lead' })];
  const kids = [
    { sessionId: 'w1', parentSessionId: 'lead', closedAt: NOW - 1000 },
    { sessionId: 'w2', parentSessionId: 'lead', closedAt: NOW - 2000 },
    { sessionId: 'kid', parentSessionId: 'lead', closedAt: null }, // 열린 하위는 세지 않는다(나무가 보인다)
    { sessionId: 'w3', parentSessionId: 'old', closedAt: NOW - CALLED_MS - 1 }, // 기간 밖
    { sessionId: 'gone', parentSessionId: null, closedAt: NOW - 5 },
  ];
  const assigns = [{ sessionId: 'boss', at: NOW - 60_000 }, { sessionId: 'old', at: NOW - CALLED_MS - 10 }];
  const g = missionGraph({ sessions, called: { kids, assigns }, now: NOW });
  const n = (id) => g.nodes.find((x) => x.sessionId === id);
  assert.equal(n('lead').closedKids, 2);
  assert.equal(n('old').closedKids, 0);
  assert.equal(n('old').assignAt, null);
  assert.equal(n('boss').assignAt, NOW - 60_000);
  assert.equal(n('alone').closedKids, 0); assert.equal(n('alone').assignAt, null); assert.equal(n('alone').parentClosed, false);
  assert.equal(n('orphan').parentClosed, true);
  assert.equal(n('kid').parentClosed, false);
  // called 없이 불러도 된다(옛 호출)
  const g0 = missionGraph({ sessions, now: NOW });
  assert.equal(g0.nodes.find((x) => x.sessionId === 'lead').closedKids, 0);
});

test('Store.assignSenders: 꼬리표 assign 지시를 보낸 세션의 마지막 시각(받은 세션이 닫혀도), since 밖과 다른 꼬리표는 빠진다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p157-'));
  const st = new Store(path.join(dir, 'board.db'));
  try {
    const link = (linkId, from, to) => st.insertLink({ linkId, from, to, role: null, spawned: false, observed: false, createdAt: 1 });
    link('l1', 'a', 'b'); link('l2', 'a', 'c'); link('l3', 'p', 'q'); link('l4', 'r', 's');
    st.addLinkEvent('l1', 'prompt', 'x', { via: 'atrium', tag: 'assign' }, 100);
    st.addLinkEvent('l2', 'prompt', 'y', { via: 'atrium', tag: 'assign' }, 300);
    st.addLinkEvent('l3', 'prompt', 'z', { via: 'atrium', tag: 'share' }, 400);
    st.addLinkEvent('l4', 'prompt', 'w', { via: 'atrium', tag: 'assign' }, 10);
    st.addLinkEvent('l4', 'reply', 'v', { via: 'atrium', tag: 'assign' }, 500);
    const rows = st.assignSenders(50);
    assert.deepEqual(rows, [{ sessionId: 'a', at: 300 }]);
    assert.deepEqual(st.assignSenders(0).map((r) => r.sessionId).sort(), ['a', 'r']);
    // 색인이 생겼다
    assert.ok(st.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'link_events_kind_t'").get());
  } finally { st.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
