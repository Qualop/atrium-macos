// P141(#14): 응답 필요가 시작된 때(rt.waitingSince)는 runtime에 남아 백엔드·터미널 서버를 다시 켜도 같은 질문이면 이어진다
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRuntime, applyHook, applyTermStatus, applyTermDisconnected, applyAgentDetected, deriveState, trackWaiting, needKey, upgradeRuntime } from '../src/state.mjs';

const T0 = 1_000_000;
const trustWaiting = () => { const rt = newRuntime({ now: T0 }); applyAgentDetected(rt, T0 + 500); applyTermStatus(rt, 'blocked', T0 + 1000); rt.trustScreen = { at: T0 + 1000 }; return rt; };
// 백엔드를 다시 켬: runtime을 JSON으로 저장했다 읽는다(store.mjs saveRuntime·openSessions)
const reload = (rt) => upgradeRuntime(JSON.parse(JSON.stringify(rt)));

test('신뢰 질문: 처음 본 때를 남기고, 백엔드를 다시 켜고 터미널 상태가 다시 와도 이어진다', () => {
  const rt = trustWaiting();
  assert.equal(deriveState(rt).state, 'trust_wait');
  assert.equal(trackWaiting(rt, deriveState(rt), T0 + 1000), T0 + 1000);
  assert.equal(trackWaiting(rt, deriveState(rt), T0 + 71000), T0 + 1000); // 1분 넘게 지나도 같은 때
  const back = reload(rt);
  applyTermStatus(back, 'blocked', T0 + 80000); // 다시 켠 뒤 터미널이 상태를 다시 알린다(lastActivityAt이 지금이 된다)
  back.trustScreen = { at: T0 + 80000 };
  assert.equal(back.lastActivityAt, T0 + 80000);
  assert.equal(trackWaiting(back, deriveState(back), T0 + 80000), T0 + 1000);
});

test('터미널 서버를 다시 켜는 사이(끝남 terminal_stopped, starting)에도 지우지 않고, 같은 신뢰 질문이 다시 뜨면 잇는다', () => {
  const rt = trustWaiting();
  trackWaiting(rt, deriveState(rt), T0 + 1000);
  applyTermDisconnected(rt, T0 + 50000);
  assert.equal(deriveState(rt).state, 'exited');
  assert.equal(trackWaiting(rt, deriveState(rt), T0 + 50000), null);
  assert.deepEqual(rt.waitingSince, { key: 'trust', at: T0 + 1000 });
  applyAgentDetected(rt, T0 + 52000);
  assert.equal(deriveState(rt).state, 'starting');
  trackWaiting(rt, deriveState(rt), T0 + 52000);
  applyTermStatus(rt, 'blocked', T0 + 55000); rt.trustScreen = { at: T0 + 55000 };
  assert.equal(trackWaiting(rt, deriveState(rt), T0 + 55000), T0 + 1000);
});

test('권한 요청: 같은 tool_use_id면 잇고, 답해서 일하면 지우고, 새 요청은 새 때', () => {
  const rt = newRuntime({ now: T0 });
  applyTermStatus(rt, 'working', T0 + 10);
  applyHook(rt, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu1', tool_input: { command: 'ls' } }, T0 + 100);
  applyHook(rt, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }, T0 + 200);
  applyTermStatus(rt, 'blocked', T0 + 300);
  const d = deriveState(rt);
  assert.equal(needKey(d), 'ask:tu1');
  assert.equal(trackWaiting(rt, d, T0 + 300), T0 + 200); // 요청이 온 때(ask.since)
  const back = reload(rt);
  assert.equal(trackWaiting(back, deriveState(back), T0 + 90000), T0 + 200);
  applyTermStatus(back, 'working', T0 + 91000); // 답함
  assert.equal(trackWaiting(back, deriveState(back), T0 + 91000), null);
  assert.equal(back.waitingSince, null);
  applyHook(back, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu2', tool_input: { command: 'pwd' } }, T0 + 95000);
  applyHook(back, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'pwd' } }, T0 + 95050);
  applyTermStatus(back, 'blocked', T0 + 95100);
  assert.equal(trackWaiting(back, deriveState(back), T0 + 95100), T0 + 95050);
});

test('hook 없는 세션의 화면 질문: 화면 끝이 바뀌어도(다시 그림) 같은 질문으로 잇는다', () => {
  const rt = newRuntime({ now: T0, kind: 'codex', hooked: false });
  applyTermStatus(rt, 'blocked', T0 + 500);
  assert.equal(needKey(deriveState(rt)), 'screen');
  assert.equal(trackWaiting(rt, deriveState(rt), T0 + 500), T0 + 500);
  const back = reload(rt);
  applyTermStatus(back, 'blocked', T0 + 60000); // 다시 켠 뒤 터미널이 다시 알림(ask.since는 h.at으로 바뀐다)
  assert.equal(trackWaiting(back, deriveState(back), T0 + 60000), T0 + 500);
});
