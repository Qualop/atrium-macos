// P90 시험: 휴대폰 입력 줄의 보내기 계획(Claude Code는 일하는 중이면 바로 넣기), 목록 순서(작업 중·프로젝트별은 시작한 순으로 고정), 전달 표시
import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneList, sendPlan } from '../src/renderer/lib/phone.js';
import { deliveryText } from '../src/renderer/lib/labels.js';
import { setLanguage } from '../src/renderer/lib/i18n.js';

const S = (id, f = {}) => ({ sessionId: id, name: id, state: 'ready', kind: 'claude', workspaceKey: 'C:/w/a/.git', createdAt: 1, lastActivityAt: 1, ...f });

test('P90 보내기 계획: Claude Code는 whileWorking: type(판단은 백엔드), 셸은 터미널 입력, 다른 종류는 전달 대기열 그대로', () => {
  assert.deepEqual(sendPlan(S('a'), 'fix it\r\nplease\n'), { method: 'session.send', text: 'fix it\nplease\n', whileWorking: 'type' });
  assert.deepEqual(sendPlan(S('a', { kind: undefined }), 'x'), { method: 'session.send', text: 'x', whileWorking: 'type' }, '종류가 없으면 Claude Code');
  for (const state of ['working', 'waiting', 'trust_wait', 'ready']) assert.equal(sendPlan(S('a', { state }), 'x').whileWorking, 'type', `${state}: 상태는 백엔드가 보낼 때 본다`);
  assert.deepEqual(sendPlan(S('c', { kind: 'codex', state: 'working' }), 'x'), { method: 'session.send', text: 'x' }, '다른 종류는 지금대로');
  assert.deepEqual(sendPlan(S('sh', { kind: 'shell', state: 'working' }), 'ls\n'), { method: 'terminal.input', data: 'ls\r' }, '셸은 지금대로');
});

test('P90 목록 순서: 작업 중은 시작한 지 오래된 순이고 활동 시각이 바뀌어도 그대로, 프로젝트별 목록도 같은 기준', () => {
  const base = [
    S('late', { state: 'working', createdAt: 300, lastActivityAt: 310 }),
    S('first', { state: 'working', createdAt: 100, lastActivityAt: 120 }),
    S('mid', { state: 'working', createdAt: 200, lastActivityAt: 205 }),
    S('rB', { createdAt: 50, lastActivityAt: 900 }),
    S('rA', { createdAt: 10, lastActivityAt: 20 }),
    S('zz', { createdAt: 5, lastActivityAt: 999, state: 'sleeping' }),
    S('ask2', { state: 'waiting', ask: { kind: 'permission', since: 500 }, createdAt: 1 }),
    S('ask1', { state: 'waiting', ask: { kind: 'question', since: 400 }, createdAt: 2 }),
  ];
  const a = phoneList(base, [{ key: 'C:/w/a/.git', name: 'a' }]);
  assert.deepEqual(a.working.map((s) => s.sessionId), ['first', 'mid', 'late']);
  assert.deepEqual(a.groups[0].sessions.map((s) => s.sessionId), ['rA', 'rB', 'zz'], '살아 있는 것 먼저, 그 안은 시작 순');
  assert.deepEqual(a.needs.map((s) => s.sessionId), ['ask1', 'ask2'], '응답 필요는 묻기 시작한 순(그대로)');
  // 활동이 생긴다: 마지막 활동 시각, 마지막 답, 턴이 바뀐다
  const busier = base.map((s) => ({ ...s, lastActivityAt: s.sessionId === 'first' ? 5 : s.sessionId === 'late' ? 99999 : s.lastActivityAt + 1000, lastAnswerAt: 77777, turn: { endedAt: s.sessionId === 'mid' ? 88888 : null } }));
  const b = phoneList(busier.reverse(), [{ key: 'C:/w/a/.git', name: 'a' }]);
  assert.deepEqual(b.working.map((s) => s.sessionId), ['first', 'mid', 'late'], '활동 시각이 바뀌어도 그대로');
  assert.deepEqual(b.groups[0].sessions.map((s) => s.sessionId), ['rA', 'rB', 'zz']);
  // 상태가 바뀌면 다른 칸으로 옮긴다
  const c = phoneList(base.map((s) => (s.sessionId === 'mid' ? { ...s, state: 'ready' } : s)), [{ key: 'C:/w/a/.git', name: 'a' }]);
  assert.deepEqual(c.working.map((s) => s.sessionId), ['first', 'late']);
  assert.deepEqual(c.groups[0].sessions.map((s) => s.sessionId), ['rA', 'rB', 'mid', 'zz']);
});

test('P90 전달 표시: Claude Code 대기열에 넣었으면 그렇게, 입력 칸에 쓰던 글이 있어 기다리면 그렇게 보인다', () => {
  setLanguage('ko');
  assert.equal(deliveryText({ status: 'confirmed', reason: 'typed' }), '제출 확인됨 (Claude Code 대기열에 추가됨)');
  assert.equal(deliveryText({ status: 'sent', reason: 'typed' }), '전송됨 (Claude Code 대기열에 추가됨)');
  assert.equal(deliveryText({ status: 'queued', reason: 'draft' }), '전송 대기 중 (입력란에 작성 중인 글 있음)');
  assert.equal(deliveryText({ status: 'queued', reason: 'working' }), '전송 대기 중 (이전 요청 처리 중)');
  setLanguage('en');
  assert.equal(deliveryText({ status: 'confirmed', reason: 'typed' }), 'Submitted (queued in Claude Code)');
  assert.equal(deliveryText({ status: 'queued', reason: 'draft' }), 'Queued (text in the input box)');
});
