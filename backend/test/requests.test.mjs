import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingRequest } from '../src/requests.mjs';

test('응답 없는 요청은 종료하고 대기 항목을 남기지 않는다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wait = new Map();
  const request = pendingRequest(wait, 1, () => {}, { method: 'board.get', timeoutMs: 100 });
  const rejected = assert.rejects(request, { code: 'timeout' });
  t.mock.timers.tick(101); await rejected;
  assert.equal(wait.size, 0);
});
test('정상 응답과 연결 오류, 전송 예외도 대기 항목을 정리한다', async () => {
  const wait = new Map();
  const response = pendingRequest(wait, 1, () => {}, { method: 'board.get' });
  wait.get(1).res('ok'); assert.equal(await response, 'ok'); assert.equal(wait.size, 0);
  const closed = pendingRequest(wait, 2, () => {}, { method: 'board.get' });
  wait.get(2).rej(new Error('closed')); await assert.rejects(closed, /closed/); assert.equal(wait.size, 0);
  await assert.rejects(pendingRequest(wait, 3, () => { throw new Error('send failed'); }), /send failed/);
  assert.equal(wait.size, 0);
});
