// P16 화면 언어: 판 설정 language(기본 en), 확인 문구·오류·복귀 요약·루프 확인에 붙는 화면 글 열쇠(msg.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Settings, normalizePatch, DEFAULTS, LANGUAGES } from '../src/settings.mjs';
import { m, confirmResult, keyed } from '../src/msg.mjs';
import { summarizeChanges } from '../src/changes.mjs';
import { describeLoop, describeLoopMsg } from '../src/loops.mjs';

const fakeStore = () => { const meta = new Map(); return { getMeta: (k) => meta.get(k), setMeta: (k, v) => meta.set(k, v) }; };

test('설정 language: 새 판은 영어, en과 ko만 받고, 바꾸면 남고 알린다', () => {
  assert.equal(DEFAULTS.language, 'en');
  assert.deepEqual(LANGUAGES, ['en', 'ko']);
  assert.deepEqual(normalizePatch({ language: 'ko' }), { language: 'ko' });
  assert.throws(() => normalizePatch({ language: 'fr' }), (e) => e.code === 'bad_request');
  const sent = [];
  const s = new Settings({ store: fakeStore(), broadcast: (ev, d) => sent.push([ev, d.language]) });
  assert.equal(s.get().language, 'en');
  s.set({ key: 'language', value: 'ko' });
  assert.equal(s.get().language, 'ko');
  assert.deepEqual(sent, [['settings.updated', 'ko']]);
  assert.equal(s.describe().language.default, 'en');
});

test('화면 글 열쇠: 확인 결과는 한국어 message와 msg를 함께, 오류는 key·vars를 단다', () => {
  const r = confirmResult('한국어', m('outer', { name: 'a', inner: m('inner', { n: 2 }) }), { count: 1 });
  assert.deepEqual(r, { needsConfirm: true, message: '한국어', msg: { key: 'outer', vars: { name: 'a', inner: { key: 'inner', vars: { n: 2 } } } }, count: 1 });
  const e = keyed(Object.assign(new Error('이미 있는 이름: x'), { code: 'name_taken' }), 'nameTaken', { name: 'x' });
  assert.equal(e.key, 'nameTaken'); assert.deepEqual(e.vars, { name: 'x' }); assert.equal(e.message, '이미 있는 이름: x');
});

test('복귀 요약 줄에도 열쇠가 붙는다(사용자 내용인 마지막 답은 글 그대로)', () => {
  const ev = [
    { sessionId: 'a', t: 1, kind: 'state', data: { from: 'working', to: 'waiting', ask: { kind: 'permission', tool: 'Bash', summary: 'Bash: ls' } } },
    { sessionId: 'b', t: 2, kind: 'closed', data: { reason: 'killed' } },
    { sessionId: 'c', t: 3, kind: 'hook', data: { ev: 'Stop', lastAnswer: '다 했다' } },
    { sessionId: null, t: 4, kind: 'herdr_disconnected', data: {} }, // 업데이트 전 기록
  ];
  const lines = summarizeChanges(ev, { nameOf: (s) => s });
  const by = (k) => lines.find((l) => l.kind === k);
  assert.deepEqual(by('needs_you').msg, { key: 'chgPermission', vars: { what: 'Bash: ls' } });
  assert.equal(by('needs_you').text, '권한: Bash: ls');
  assert.deepEqual(by('exited').msg, { key: 'chgKilled', vars: {} });
  assert.equal(by('turn_done').msg, null);
  assert.equal(by('terminal').msg.key, 'chgTerminalDown'); // P129: 옛 이벤트 이름(herdr_disconnected)도 읽는다. P53: 터미널과 백엔드 줄을 나눠 목록(chgList)으로 묶지 않는다
});

test('루프 확인 문구: 한국어 글과 같은 짜임의 열쇠', () => {
  const trigger = { type: 'interval', everyMs: 300000, immediate: true }, stop = { maxRuns: 3 };
  assert.match(describeLoop({ targetLabel: '@w', prompt: 'go', trigger, stop }), /5분마다\(지금 한 번 전송한 뒤\)/);
  const msg = describeLoopMsg({ target: '@w', prompt: 'go', trigger, stop });
  assert.equal(msg.key, 'loopConfirm');
  assert.deepEqual(msg.vars.when, { key: 'loopEveryNow', vars: { every: { key: 'dur.m', vars: { n: 5 } } } });
  assert.deepEqual(msg.vars.stops, [{ key: 'loopStopRuns', vars: { n: 3 } }]);
  assert.equal(describeLoopMsg({ target: '@w', prompt: 'x', trigger: { type: 'idle' }, stop: {} }).vars.stops.key, 'loopStopManual');
});
