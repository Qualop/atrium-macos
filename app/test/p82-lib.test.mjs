// P82 창 쪽 순수 함수: 짧은 끊김에 띠를 미루기(bannerDue), 직전 닫힘을 연결 주소로(prevCloseParam, 백엔드 parsePrevClose와 맞물림),
// 연결 기록 화면의 소켓 글(sockLabel, logRow), 다시 붙은 뒤 첫 full 프레임 앞에 붙이는 바이트
import test from 'node:test';
import assert from 'node:assert/strict';
import { connInit, connStep, bannerDue, dropShown, prevCloseParam, SHORT_DROP_MS } from '../src/renderer/lib/reconnect.js';
import { sockLabel, logRow } from '../src/renderer/lib/remote.js';
import { REDRAW_PREFIX, joinBytes } from '../src/renderer/lib/term-input.js';
import { parsePrevClose } from '../../backend/src/remote-ws.mjs';

test('짧은 끊김: 끊긴 뒤 2초 안에는 띠를 띄우지 않고, 넘으면 띄운다. PC에서 끊음(4402)은 바로, 처음 붙는 중은 띠 없음', () => {
  let s = connStep(connInit(), { type: 'open' }, 0);
  assert.equal(bannerDue(s, 0), null, '열려 있으면 띄울 일이 없다');
  s = connStep(s, { type: 'close', code: 1006 }, 10_000);
  assert.equal(s.phase, 'reconnecting');
  assert.equal(bannerDue(s, 10_000), SHORT_DROP_MS);
  assert.equal(bannerDue(s, 11_500), 500);
  assert.equal(dropShown(s, 11_999), false);
  assert.equal(dropShown(s, 12_000), true);
  // 다시 시도가 실패해도 처음 끊긴 때부터 센다
  s = connStep(s, { type: 'close', code: 1006 }, 10_600);
  assert.equal(bannerDue(s, 11_000), 1000);
  // 다시 붙으면 띠가 없다
  s = connStep(s, { type: 'open' }, 11_200);
  assert.equal(bannerDue(s, 11_200), null);
  // PC에서 끊음은 바로
  const k = connStep(connStep(connInit(), { type: 'open' }, 0), { type: 'close', code: 4402 }, 5000);
  assert.equal(bannerDue(k, 5000), 0);
  // 처음 붙는 중(한 번도 열리지 않음)은 다시 연결 띠가 아니다
  assert.equal(bannerDue(connStep(connInit(), { type: 'close', code: 1006 }, 0), 0), null);
  assert.equal(bannerDue(null), null);
});

test('직전 닫힘: 연결 주소 값은 백엔드가 그대로 읽는다. 모양이 다른 코드는 보내지 않는다', () => {
  assert.equal(prevCloseParam({ code: 1006, wasClean: false, ms: 3400.6 }), '1006.0.3401');
  assert.deepEqual(parsePrevClose(prevCloseParam({ code: 1006, wasClean: false, ms: 3400 })), { code: 1006, clean: false, ms: 3400 });
  assert.deepEqual(parsePrevClose(prevCloseParam({ code: 1000, wasClean: true, ms: 12 })), { code: 1000, clean: true, ms: 12 });
  assert.deepEqual(parsePrevClose(prevCloseParam({ code: 'timeout', wasClean: false, ms: 23000 })), { code: 'timeout', clean: false, ms: 23000 });
  assert.deepEqual(parsePrevClose(prevCloseParam({ code: 'open_timeout', ms: 0 })), { code: 'open_timeout', clean: false, ms: 0 });
  assert.equal(prevCloseParam({ code: 'backend' }), null);
  assert.equal(prevCloseParam({ code: undefined }), null);
  assert.equal(prevCloseParam(null), null);
  assert.equal(prevCloseParam({ code: 1006, ms: -5 }), '1006.0.0');
  assert.equal(prevCloseParam({ code: 1006, ms: 9e9 }), '1006.0.86400000', '하루로 자른다');
});

test('연결 기록 화면: disconnect는 서버가 받은 코드·시간·압축, connect는 창이 본 직전 닫힘', () => {
  assert.equal(sockLabel({ code: 1006, ms: 3400, deflate: true }), '1006 · 3.4s · deflate');
  assert.equal(sockLabel({ code: 1000, ms: 125000, deflate: false }), '1000 · 125s · plain');
  assert.equal(sockLabel({ code: 1002, err: 'WS_ERR_UNEXPECTED_RSV_1', ms: 900 }), '1002 · WS_ERR_UNEXPECTED_RSV_1 · 0.9s');
  assert.equal(sockLabel(null), '');
  const d = logRow({ at: 1, event: 'disconnect', reason: 'closed', deviceName: 'Phone', ws: { code: 1006, ms: 3400, deflate: false, out: 3 } });
  assert.equal(d.sock, '1006 · 3.4s · plain'); assert.equal(d.prev, undefined);
  const c = logRow({ at: 1, event: 'connect', deviceName: 'Phone', ws: { deflate: false }, prev: { code: 1006, clean: false, ms: 3400 } });
  assert.equal(c.prev, '1006 · 3.4s'); assert.equal(c.sock, undefined);
  assert.equal(logRow({ at: 1, event: 'connect' }).prev, undefined, '옛 기록(값 없음)');
});

test('다시 붙은 뒤 첫 full 프레임: 글자 속성 초기화·맨 위·보이는 화면 지우기를 앞에 붙인다', () => {
  assert.equal(new TextDecoder().decode(REDRAW_PREFIX), '\x1b[0m\x1b[H\x1b[2J');
  const out = joinBytes(REDRAW_PREFIX, new TextEncoder().encode('hi'));
  assert.equal(new TextDecoder().decode(out), '\x1b[0m\x1b[H\x1b[2Jhi');
});
