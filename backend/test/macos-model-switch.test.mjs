// macOS 판: 노드 머리의 출력 속도(model-now.mjs foldSpeed)와 모델·추론 바꾸기(model-switch.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldSpeed } from '../src/model-now.mjs';
import { ModelSwitch, modelChoice, switchLines } from '../src/model-switch.mjs';
import { newRuntime } from '../src/state.mjs';

const L = (o) => JSON.stringify(o);
const at = (s) => `2026-11-18T07:48:${s}Z`;

test('출력 속도: 요청 시작(api-request)부터 그 응답의 마지막 줄까지, 같은 응답 줄은 한 번만, 하위 에이전트·작은 응답은 빼고 이어 읽는다', () => {
  const a = [
    L({ type: 'api-request', timestamp: at('10.000') }),
    L({ type: 'assistant', timestamp: at('12.000'), message: { id: 'm1', usage: { output_tokens: 1000 } } }),
    L({ type: 'assistant', timestamp: at('20.000'), message: { id: 'm1', usage: { output_tokens: 2000 } } }),
    L({ type: 'assistant', isSidechain: true, timestamp: at('21.000'), message: { id: 'x', usage: { output_tokens: 9 } } }),
    'not json',
  ];
  const sp = foldSpeed(a);
  assert.equal(sp.tps, 200); assert.equal(sp.out, 2000); assert.equal(sp.at, Date.parse(at('20.000')));
  // 다음 응답이 이어 읽기로 온다. 아주 작은 응답(20토큰 아래)은 속도를 바꾸지 않는다
  const sp2 = foldSpeed([L({ type: 'api-request', timestamp: at('30.000') }), L({ type: 'assistant', timestamp: at('31.000'), message: { id: 'm2', usage: { output_tokens: 5 } } })], sp);
  assert.equal(sp2.tps, 200);
  const sp3 = foldSpeed([L({ type: 'api-request', timestamp: at('40.000') }), L({ type: 'assistant', timestamp: at('44.000'), message: { id: 'm3', usage: { output_tokens: 400 } } })], sp2);
  assert.equal(sp3.tps, 100);
});

test('모델·추론 고르기: 별칭·모델 ID·추론 수준만, 명령은 /model 다음 /effort', () => {
  assert.deepEqual(modelChoice({ model: 'opus' }), { model: 'opus', effort: null });
  assert.deepEqual(modelChoice({ effort: 'XHigh' }), { model: null, effort: 'xhigh' });
  assert.throws(() => modelChoice({}), /바꿀/);
  assert.throws(() => modelChoice({ model: 'opus; rm -rf' }), /올바르지/);
  assert.throws(() => modelChoice({ effort: 'ultra' }), /추론 수준/);
  assert.deepEqual(switchLines({ model: 'sonnet', effort: 'low' }), ['/model sonnet', '/effort low']);
});

const fake = (state) => {
  const rt = newRuntime({ kind: 'claude' }); rt.phase = 'running'; rt.term.present = true; rt.term.status = state === 'working' ? 'working' : 'idle';
  const s = { sessionId: 'S', name: 'main', kind: 'claude', rt };
  const b = { sent: [], events: [], log: () => {}, store: { addEvent: (sid, k, d) => b.events.push([k, d]) }, sendPrompt: async (sid, text) => { b.sent.push(text); } };
  return { s, b, sw: new ModelSwitch(b, { stepMs: 1 }) };
};

test('쉬는 세션은 바로 치고, 일하는 세션은 마지막으로 고른 값을 남겨 쉬게 될 때 친다. 끝나면 버린다. Claude Code만', async () => {
  const f = fake('ready');
  assert.equal((await f.sw.request(f.s, { model: 'opus', effort: 'high' })).applied, true);
  assert.deepEqual(f.b.sent, ['/model opus', '/effort high']);
  const g = fake('working');
  const r = await g.sw.request(g.s, { model: 'sonnet' });
  assert.equal(r.applied, false);
  await g.sw.request(g.s, { effort: 'low' });
  assert.deepEqual(g.sw.pending.get('S'), { model: 'sonnet', effort: 'low' });
  g.sw.onState(g.s, 'working'); assert.deepEqual(g.b.sent, []);
  g.sw.onState(g.s, 'ready'); await new Promise((res) => setTimeout(res, 20));
  assert.deepEqual(g.b.sent, ['/model sonnet', '/effort low']); assert.equal(g.sw.pending.size, 0);
  const h = fake('working'); await h.sw.request(h.s, { model: 'haiku' }); h.sw.onState(h.s, 'exited'); assert.equal(h.sw.pending.size, 0);
  const c = fake('ready'); c.s.kind = 'codex';
  await assert.rejects(c.sw.request(c.s, { model: 'x' }), (e) => e.code === 'not_claude');
});

test('화면의 추론 수준: 시작 머리와 일하는 줄의 "with X effort", 마지막 것을 쓴다', async () => {
  const { effortOnScreen } = await import('../src/backend.mjs');
  assert.equal(effortOnScreen('Opus 5.5 with xhigh effort · Claude Ultra'), 'xhigh');
  assert.equal(effortOnScreen('Opus 5.5 with xhigh effort\n✶ Catapulting… (thinking some more with MAX effort)'), 'max');
  assert.equal(effortOnScreen('no effort here'), null); assert.equal(effortOnScreen(null), null);
});
