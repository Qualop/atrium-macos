// P67 시험: 연결 선 이름표(lib/link-labels.js). 한 쌍에 이름표 하나와 지시 수, 물러나는 조건(도는 중, 안 본 결과, 시간), 배율, 비켜 놓기
import test from 'node:test';
import assert from 'node:assert/strict';
import { pairLabels, pairKey, labelAwake, pairAwake, linkLabelLevel, dockRestLevel, spreadLabels, decorateEdges, REST_MS, SEND_MS } from '../src/renderer/lib/link-labels.js';

const MIN = 60 * 1000;
const NOW = 1_000_000_000;

test('P67: 한 쌍(방향 상관없이)의 연결은 가장 최근 것 하나가 이름표를 맡고, 나머지 지시 수를 센다', () => {
  const links = [
    { linkId: 'l1', from: 'lead', to: 'w1', spawned: true, createdAt: NOW - 30 * MIN, lastAt: NOW - 3 * MIN, lastText: 'third', prompts: 3 },
    { linkId: 'l2', from: 'w1', to: 'lead', observed: true, createdAt: NOW - 20 * MIN, lastAt: NOW - 10 * MIN, lastText: 'report', prompts: 1 },
    { linkId: 'l3', from: 'lead', to: 'w2', spawned: true, createdAt: NOW - 5 * MIN, prompts: 0 },
  ];
  const pairs = pairLabels(links);
  assert.equal(pairs.size, 2);
  const p1 = pairs.get(pairKey('w1', 'lead'));
  assert.equal(p1.primary.linkId, 'l1');
  assert.deepEqual(p1.links.map((l) => l.linkId), ['l1', 'l2']);
  assert.equal(p1.prompts, 4);
  assert.equal(p1.more, 3); // 보인 것(third) 빼고 셋
  const p2 = pairs.get(pairKey('lead', 'w2'));
  assert.equal(p2.primary.linkId, 'l3');
  assert.equal(p2.more, 0); // 띄움만, 지시 없음
  // 지시 수가 없으면(옛 백엔드) 마지막 글이 있는 연결을 하나로 센다
  assert.equal(pairLabels([{ linkId: 'x', from: 'a', to: 'b', lastAt: 1, lastText: 'hi' }]).get(pairKey('a', 'b')).more, 0);
  // 자기 자신과 이어진 줄, 빈 값은 건너뛴다
  assert.equal(pairLabels([{ linkId: 'y', from: 'a', to: 'a' }, null]).size, 0);
});

test('P67: 물러나는 조건 — 도는 중과 보내는 중, 안 본 결과(REST_MS까지)에만 깨어 있다', () => {
  const sent = { linkId: 'l', from: 'a', to: 'b', createdAt: NOW - 20 * MIN, lastAt: NOW - 2 * MIN, lastKind: 'prompt', lastText: 'do it' };
  // 받는 쪽이 그 지시로 일하는 중
  assert.deepEqual(labelAwake(sent, { state: 'working', turn: { endedAt: NOW - 5 * MIN } }, NOW), { awake: true, why: 'running' });
  assert.equal(labelAwake(sent, { state: 'waiting', turn: {} }, NOW).why, 'running'); // 허락을 기다려도 그 일은 도는 중
  // 보낸 지 얼마 안 됐거나 전달 대기 중(아직 일을 시작하지 않음)
  assert.equal(labelAwake({ ...sent, lastAt: NOW - 10 * 1000 }, { state: 'ready', turn: { endedAt: NOW - 5 * MIN } }, NOW).why, 'sending');
  assert.equal(labelAwake(sent, { state: 'ready', delivering: 1, turn: { endedAt: NOW - 5 * MIN } }, NOW).why, 'sending');
  assert.equal(labelAwake({ ...sent, lastAt: NOW - SEND_MS - 1 }, { state: 'ready', turn: { endedAt: NOW - 5 * MIN } }, NOW).awake, false);
  // 끝났고 결과를 아직 안 봤다 → REST_MS까지 깨어 있다
  const doneUnseen = { state: 'ready', unseen: true, turn: { endedAt: NOW - 1 * MIN } };
  assert.equal(labelAwake(sent, doneUnseen, NOW).why, 'unseen');
  assert.equal(labelAwake(sent, { ...doneUnseen, turn: { endedAt: NOW - REST_MS - 1 } }, NOW + 0).awake, false); // 끝난 지 오래(지시보다 앞이면 그 지시의 결과가 아니다)
  assert.equal(labelAwake(sent, doneUnseen, NOW - 1 * MIN + REST_MS + 1).awake, false); // 몇 분 지나면 물러난다
  // 리드가 답을 읽어(reply) lastAt이 턴 끝보다 늦어도, 지시 시각(promptAt)으로 보므로 안 본 결과는 그대로 깨어 있다
  assert.equal(labelAwake({ ...sent, lastKind: 'reply', lastAt: NOW - 30 * 1000, promptAt: NOW - 2 * MIN }, doneUnseen, NOW).why, 'unseen');
  // 결과를 봤다 → 바로 물러난다
  assert.deepEqual(labelAwake(sent, { state: 'ready', unseen: false, turn: { endedAt: NOW - 1 * MIN } }, NOW), { awake: false, why: null });
  // 지시 뒤에 받는 쪽이 이미 턴을 끝냈으면, 다시 일해도 그 지시의 일이 아니다
  assert.equal(labelAwake(sent, { state: 'working', turn: { endedAt: NOW - 1 * MIN } }, NOW).awake, false);
  // 띄움만 있는 선: 받는 쪽이 뜨는 중·첫 일을 하는 동안 깨어 있다
  const spawn = { linkId: 's', from: 'a', to: 'c', spawned: true, createdAt: NOW - 1 * MIN };
  assert.equal(labelAwake(spawn, { state: 'starting', turn: {} }, NOW).why, 'running');
  assert.equal(labelAwake(spawn, { state: 'ready', turn: {} }, NOW).awake, false);
  // 받는 쪽이 없으면 물러난다
  assert.equal(labelAwake(sent, null, NOW).awake, false);
  // 쌍: 하나라도 깨어 있으면
  const pair = pairLabels([sent, { linkId: 'r', from: 'b', to: 'a', createdAt: NOW - 30 * MIN, lastAt: NOW - 25 * MIN, lastKind: 'prompt', lastText: 'x' }]).get(pairKey('a', 'b'));
  const sessions = new Map([['a', { state: 'ready', turn: { endedAt: NOW - 20 * MIN } }], ['b', { state: 'working', turn: { endedAt: NOW - 30 * MIN } }]]);
  assert.equal(pairAwake(pair, sessions, NOW).awake, true);
  sessions.set('b', { state: 'ready', turn: { endedAt: NOW - 1 * MIN } });
  assert.equal(pairAwake(pair, sessions, NOW).awake, false);
});

test('P67: 보일 모양 — 배율 경계는 P46과 같고, 물러난 이름표는 칩, 올리거나 고르면 다 보인다', () => {
  assert.equal(linkLabelLevel({ zoom: 1, awake: true }), 'full');
  assert.equal(linkLabelLevel({ zoom: 1, awake: false }), 'chip');
  assert.equal(linkLabelLevel({ zoom: 0.6, awake: true }), 'chip');
  assert.equal(linkLabelLevel({ zoom: 0.3, awake: true }), 'dot');
  assert.equal(linkLabelLevel({ zoom: 1, awake: true, compact: true }), 'dot');
  assert.equal(linkLabelLevel({ zoom: 0.3, awake: false, hot: true }), 'full');
  assert.equal(linkLabelLevel({ zoom: 1, awake: false, hot: true }), 'full');
  // 덩어리 안 글: 물러나면 역할 이름(short)까지만
  assert.equal(dockRestLevel('full', { awake: false }), 'short');
  assert.equal(dockRestLevel('full', { awake: true }), 'full');
  assert.equal(dockRestLevel('full', { awake: false, hot: true }), 'full');
  assert.equal(dockRestLevel('short', { awake: false }), 'short');
  assert.equal(dockRestLevel('mini', { awake: false }), 'mini');
});

test('P67: 서로 다른 선의 이름표가 한 자리에 겹치면 선을 따라 비켜 놓는다', () => {
  const a = { id: 'a', x: 0, y: 0, ux: 1, uy: 0, w: 200, h: 26, room: 400, prio: 3 };
  const b = { id: 'b', x: 10, y: 4, ux: 1, uy: 0, w: 170, h: 26, room: 400, prio: 0 };
  const s = spreadLabels([b, a]);
  assert.deepEqual(s.get('a'), { dx: 0, dy: 0 }); // 먼저 놓이는 쪽(prio 큰 것)은 제자리
  const sb = s.get('b');
  assert.ok(Math.abs(sb.dx) >= 170, `밀린 거리 ${sb.dx}`);
  assert.equal(sb.dy, 0);
  // 세로 선은 세로로 민다
  const v = spreadLabels([{ ...a, ux: 0, uy: 1 }, { ...b, ux: 0, uy: 1 }]);
  assert.equal(v.get('b').dx, 0);
  assert.ok(Math.abs(v.get('b').dy) >= 26);
  // 밀 자리가 없으면 제자리
  assert.deepEqual(spreadLabels([a, { ...b, room: 20 }]).get('b'), { dx: 0, dy: 0 });
  // 겹치지 않으면 그대로
  assert.deepEqual(spreadLabels([a, { ...b, y: 300 }]).get('b'), { dx: 0, dy: 0 });
});

test('P67: 선 목록 꾸미기 — 쌍의 대표만 이름표, 같은 쌍의 같은 저장소 선 이름표는 비켜 놓는다', () => {
  const rects = { lead: { x: 0, y: 0, w: 400, h: 300 }, w1: { x: 1000, y: 0, w: 400, h: 300 } };
  const links = new Map([
    ['l1', { linkId: 'l1', from: 'lead', to: 'w1', spawned: true, createdAt: NOW - 30 * MIN, lastAt: NOW - 1 * MIN, lastKind: 'reply', promptAt: NOW - 2 * MIN, lastText: 'third', prompts: 3 }],
    ['l2', { linkId: 'l2', from: 'w1', to: 'lead', observed: true, createdAt: NOW - 20 * MIN, lastAt: NOW - 10 * MIN, lastText: 'r', prompts: 1 }],
  ]);
  const sessions = new Map([['w1', { state: 'working', turn: {} }], ['lead', { state: 'ready', turn: { endedAt: NOW - 30 * MIN } }]]);
  const edge = (id, type, source, target) => ({ id, type, source, target, sourceHandle: source === 'lead' ? 'r' : 'l', targetHandle: source === 'lead' ? 'l' : 'r', data: { gap: 600, horizontal: true } });
  const edges = [edge('l1', 'link', 'lead', 'w1'), edge('l2', 'link', 'w1', 'lead'), edge('repo:lead:w1', 'repo', 'lead', 'w1')];
  decorateEdges(edges, { rectOf: (id) => rects[id], links, sessions, now: NOW });
  assert.equal(edges[0].data.label.awake, true);
  assert.equal(edges[0].data.label.why, 'running');
  assert.equal(edges[0].data.label.more, 3);
  assert.deepEqual(edges[0].data.label.pair, ['l1', 'l2']);
  assert.equal(edges[1].data.label, null);
  assert.equal(edges[0].data.shift, undefined); // 깨어 있는 이름표는 제자리
  assert.ok(edges[2].data.shift && Math.abs(edges[2].data.shift.dx) > 0, '같은 저장소 이름표를 선을 따라 민다');
});
