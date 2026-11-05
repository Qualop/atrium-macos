// P45: scaling, thread actions, and session entry without automatic briefing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampScale, pctOf, parsePct, stepScale, readScale, saveScale, termFontSize, SCALE_MIN, SCALE_MAX, SCALE_KEYS } from '../src/renderer/lib/scale.js';
import { itemNames, threadSessions, filterThread, isLong, oneLine, resendLine, resultTone, threadSummary, sameDay } from '../src/renderer/lib/thread.js';

const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('배율: 70~150%, 5% 단위, 숫자가 아니면 100%', () => {
  assert.equal(clampScale(1), 1);
  assert.equal(clampScale('1.2'), 1.2);
  assert.equal(clampScale(0.83), 0.85);
  assert.equal(clampScale(0.82), 0.8);
  assert.equal(clampScale(0.1), SCALE_MIN);
  assert.equal(clampScale(9), SCALE_MAX);
  for (const bad of [null, undefined, '', 'abc', NaN, Infinity]) assert.equal(clampScale(bad), 1);
  assert.equal(pctOf(1.1), 110);
  assert.equal(pctOf(0.9), 90);
});

test('배율: 입력칸 글 읽기와 −·+ 단계', () => {
  assert.equal(parsePct('120'), 1.2);
  assert.equal(parsePct(' 85% '), 0.85);
  assert.equal(parsePct('300'), 1.5);
  assert.equal(parsePct('40'), 0.7);
  assert.equal(parsePct(''), null);
  assert.equal(parsePct('abc'), null);
  assert.equal(parsePct('-5'), null);
  assert.equal(stepScale(1, 1), 1.05);
  assert.equal(stepScale(1, -1), 0.95);
  assert.equal(stepScale(1.5, 1), 1.5);
  assert.equal(stepScale(0.7, -1), 0.7);
  // 여러 번 눌러도 소수 오차가 쌓이지 않는다
  let f = 1; for (let i = 0; i < 7; i++) f = stepScale(f, -1);
  assert.equal(f, 0.7);
  f = 0.7; for (let i = 0; i < 16; i++) f = stepScale(f, 1);
  assert.equal(f, 1.5);
});

test('배율: 저장과 읽기(100%는 지운다, 저장소가 없거나 막혀도 100%)', () => {
  const s = mem();
  assert.equal(readScale(s, SCALE_KEYS.term), 1);
  assert.equal(saveScale(s, SCALE_KEYS.term, 1.2), 1.2);
  assert.equal(s.m.get('mt.termScale'), '1.2');
  assert.equal(readScale(s, SCALE_KEYS.term), 1.2);
  saveScale(s, SCALE_KEYS.ui, 0.9);
  assert.equal(readScale(s, SCALE_KEYS.ui), 0.9);
  saveScale(s, SCALE_KEYS.term, 1);
  assert.equal(s.m.has('mt.termScale'), false);
  s.setItem('mt.uiScale', 'garbage');
  assert.equal(readScale(s, SCALE_KEYS.ui), 1);
  s.setItem('mt.uiScale', '7');
  assert.equal(readScale(s, SCALE_KEYS.ui), 1.5);
  assert.equal(readScale(null, SCALE_KEYS.ui), 1);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(readScale(broken, SCALE_KEYS.ui), 1);
  assert.equal(saveScale(broken, SCALE_KEYS.ui, 1.1), 1.1);
});

test('배율: 터미널 글자 크기는 기준 × 배율(0.1px 단위)', () => {
  assert.equal(termFontSize(14, 1), 14);
  assert.equal(termFontSize(14, 0.8), 11.2);
  assert.equal(termFontSize(14, 1.2), 16.8);
  assert.equal(termFontSize(14, 1.05), 14.7);
  assert.equal(termFontSize(14, 'x'), 14);
});

const R = (name, phase, extra = {}) => ({ deliveryId: `d-${name}-${Math.random()}`, sessionId: `s-${name}`, name, status: 'confirmed', phase, ...extra });
const items = [
  { itemId: 'i1', t: 1000, source: 'bar', text: 'one', targets: ['@alpha'], results: [R('alpha', 'done', { report: { text: 'ok', state: 'ready' } })], phase: 'done' },
  { itemId: 'i2', t: 2000, source: 'bar', text: 'two', targets: ['@all'], results: [R('alpha', 'done'), R('beta', 'running'), R('gamma', 'failed')], phase: 'active' },
  { itemId: 'i3', t: 3000, source: 'output', text: 'three', targets: ['@beta'], results: [R('beta', 'done')], phase: 'done' },
  { itemId: 'i4', t: 4000, source: 'bar', text: 'four', targets: ['@delta'], results: [], phase: 'failed' },
];

test('스레드: 받은 세션 이름(@all은 푼 이름, 결과가 없으면 대상)', () => {
  assert.deepEqual(itemNames(items[1]), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(itemNames(items[3]), ['delta']);
  assert.deepEqual(itemNames({ targets: ['@all'], results: [] }), []);
  assert.deepEqual(itemNames(null), []);
});

test('스레드: 세션으로 묶기(단추 목록과 거르기)', () => {
  const g = threadSessions(items);
  assert.deepEqual(g.map((x) => x.name), ['delta', 'beta', 'alpha', 'gamma']); // 가장 최근에 받은 세션이 앞
  const beta = g.find((x) => x.name === 'beta');
  assert.equal(beta.count, 2);
  assert.equal(beta.active, 1);
  assert.equal(g.find((x) => x.name === 'alpha').count, 2);
  const only = filterThread(items, 'beta');
  assert.deepEqual(only.map((x) => x.itemId), ['i2', 'i3']);
  assert.deepEqual(only[0].results.map((r) => r.name), ['beta']); // 그 세션의 결과만
  assert.equal(only[0].hiddenResults, 2);
  assert.equal(filterThread(items, '').length, 4);
  assert.equal(filterThread(items, 'nobody').length, 0);
  assert.equal(items[1].results.length, 3); // 원래 줄은 그대로
});

test('스레드: 긴 글 접기와 한 줄 미리보기', () => {
  assert.equal(isLong('short'), false);
  assert.equal(isLong('a\nb\nc'), false);
  assert.equal(isLong('a\nb\nc\nd'), true);
  assert.equal(isLong('x'.repeat(241)), true);
  assert.equal(isLong('x'.repeat(240)), false);
  assert.equal(oneLine('  a\n\n b  c '), 'a b c');
  assert.equal(oneLine('abcdef', 3), 'abc…');
  assert.equal(oneLine('😀😀😀', 2), '😀😀…');
  assert.equal(oneLine(null), '');
});

test('스레드: 다시 보내기·고쳐 보내기 글은 처음 대상과 글', () => {
  assert.equal(resendLine(items[1]), '@all two');
  assert.equal(resendLine({ targets: ['@a', 'b'], text: 'line1\nline2' }), '@a @b line1\nline2');
  assert.equal(resendLine({ targets: [], text: 'x' }), 'x');
});

test('스레드: 결과 색과 요약, 같은 날', () => {
  assert.equal(resultTone({ phase: 'done', report: { state: 'ready' } }), 'ok');
  assert.equal(resultTone({ phase: 'done', report: { state: 'error' } }), 'bad');
  assert.equal(resultTone({ phase: 'running' }), 'run');
  assert.equal(resultTone({ phase: 'delivering' }), 'run');
  assert.equal(resultTone({ phase: 'abandoned' }), 'bad');
  assert.equal(resultTone({ phase: 'cancelled' }), 'dim');
  assert.deepEqual(threadSummary(items), { total: 4, active: 1, failed: 1 });
  const d = new Date(2026, 10, 5, 9, 0).getTime();
  assert.equal(sameDay(d, d + 3600e3), true);
  assert.equal(sameDay(d, d - 10 * 3600e3), false);
});

test('P45 entry records touch without requesting an automatic briefing', async (t) => {
  globalThis.location = { search: '' };
  globalThis.window = { mt: { log() {} } };
  globalThis.requestAnimationFrame = () => {};
  const { api } = await import('../src/renderer/api.js');
  const { enterSession, markInteracted } = await import('../src/renderer/touch.js');
  const calls = [];
  t.mock.method(api, 'call', async (method, params) => { calls.push({ method, params }); return {}; });
  enterSession('briefing-fixture'); markInteracted('briefing-fixture');
  assert.deepEqual(calls, [{ method: 'session.touch', params: { session: 'briefing-fixture' } }]);
});
