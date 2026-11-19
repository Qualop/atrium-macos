// P3 창 쪽 순수 규칙: OS 알림(A1), 다시 들어가기 브리핑(E2), 복귀 요약(A3)
import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyKey, nodeVisible, shouldNotify, briefingDue, awayLongEnough, NOTIFY_MIN_VISIBLE_PX } from '../src/renderer/lib/attention.js';
import { deliveryText } from '../src/renderer/lib/labels.js';
import { setLanguage } from '../src/renderer/lib/i18n.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const canvas = rect(0, 44, 1600, 830);

test('A1: 같은 대기에는 열쇠가 같고, 요청이 바뀌면 새 대기다', () => {
  const s = { sessionId: 'a', state: 'waiting', ask: { toolUseId: 'tu1', since: 5 } };
  assert.equal(notifyKey(s), 'a|waiting|tu1');
  assert.equal(notifyKey({ ...s, ask: { toolUseId: 'tu2' } }), 'a|waiting|tu2');
  assert.equal(notifyKey({ ...s, ask: { since: 9 } }), 'a|waiting|9');
  assert.equal(notifyKey({ sessionId: 't', state: 'trust_wait', ask: null }), 't|trust_wait|x');
  assert.equal(notifyKey({ ...s, state: 'ready' }), null);
});

test('A1: 창에 초점이 있고 노드가 보이면 띄우지 않는다. 멀리 얼굴(작게 보임)이나 화면 밖이면 띄운다', () => {
  const near = rect(100, 100, 720, 460);
  assert.ok(nodeVisible(near, canvas));
  assert.equal(shouldNotify({ focused: true, nodeRect: near, canvasRect: canvas }).notify, false);
  assert.equal(shouldNotify({ focused: false, nodeRect: near, canvasRect: canvas }).notify, true);
  assert.equal(shouldNotify({ focused: true, pageVisible: false, nodeRect: near, canvasRect: canvas }).notify, true);
  const tiny = rect(100, 100, NOTIFY_MIN_VISIBLE_PX - 1, 120);
  assert.equal(shouldNotify({ focused: true, nodeRect: tiny, canvasRect: canvas }).why, 'node not visible');
  const offscreen = rect(1700, 100, 720, 460);
  assert.equal(shouldNotify({ focused: true, nodeRect: offscreen, canvasRect: canvas }).notify, true);
  const halfOut = rect(1300, 100, 720, 460); // 300px만 보임(42%)
  assert.equal(shouldNotify({ focused: true, nodeRect: halfOut, canvasRect: canvas }).notify, true);
  assert.equal(shouldNotify({ focused: true, nodeRect: null, canvasRect: canvas }).notify, true);
});

test('E2: 오래 손대지 않은 세션에 들어가면 브리핑, A3: 오래 비웠으면 복귀 요약', () => {
  const now = 10_000_000;
  assert.equal(briefingDue({ touchedAt: now - 31 * 60000 }, now), true);
  assert.equal(briefingDue({ touchedAt: now - 5 * 60000 }, now), false);
  assert.equal(briefingDue({ touchedAt: null, createdAt: now - 3600e3 }, now), true);
  assert.equal(briefingDue({ touchedAt: now - 20000 }, now, 10000), true);
  assert.equal(awayLongEnough(now - 6 * 60000, now), true);
  assert.equal(awayLongEnough(now - 60000, now), false);
  assert.equal(awayLongEnough(null, now), false);
});

test('E5 2.5 방어: 얼굴 경계에 이력을 두어 배율이 조금 흔들려도 모든 터미널이 한꺼번에 놓이지 않는다', async () => {
  const { faceFor, pickAttached, FACE_HYSTERESIS_PX } = await import('../src/renderer/lib/faces.js');
  assert.equal(faceFor(720, 0.5), 'close'); // 정확히 경계(360px)
  assert.equal(faceFor(720, 0.4999), 'middle'); // 이력 없이는 0.0001 흔들림에 얼굴이 바뀐다
  assert.equal(faceFor(720, 0.4999, 'close'), 'close');
  assert.equal(faceFor(720, (360 - FACE_HYSTERESIS_PX - 1) / 720, 'close'), 'middle');
  assert.equal(faceFor(720, 0.27, 'middle'), 'middle'); // 194px, 중간 경계도 같다
  const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, x: (i % 4) * 760, y: Math.floor(i / 4) * 500, w: 720, h: 460 }));
  // P124: 터미널 붙이기는 거리 단계(터미널 240px, 경계 여유 88%)를 따른다. 경계 바로 아래(239.9px)
  const vp = { x: 40, y: 140, zoom: 239.9 / 720 };
  const screen = { width: 1584, height: 828 };
  assert.equal(pickAttached(nodes, vp, screen).length, 0);
  assert.equal(pickAttached(nodes, vp, screen, { prev: new Set(nodes.map((n) => n.id)) }).length, 8);
});

