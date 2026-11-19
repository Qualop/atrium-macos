// P146: 성능 기록(진단 스위치) 백엔드. 받는 값은 숫자와 정한 낱말만, 꺼져 있으면 버림, 켠 뒤 정한 시간이 지나면 저절로 끔
import test from 'node:test';
import assert from 'node:assert/strict';
import { PerfTrace, sanitizeReport, TRACE_MS } from '../src/perf-trace.mjs';
import { SETTINGS, normalizePatch } from '../src/settings.mjs';

function fakeSettings(init = {}) {
  let v = { perfTrace: false, ...init };
  return { get: () => ({ ...v }), set: (p) => { v = { ...v, ...normalizePatch(p) }; return v; } };
}

test('설정 perfTrace: 불 값, 기본 꺼짐, 10분', () => {
  assert.equal(SETTINGS.perfTrace.type, 'boolean');
  assert.equal(SETTINGS.perfTrace.default, false);
  assert.deepEqual(normalizePatch({ perfTrace: 'on' }), { perfTrace: true });
  assert.equal(TRACE_MS, 10 * 60_000);
});

test('sanitizeReport: 정한 숫자만 남기고 글·모르는 필드는 버린다', () => {
  const r = sanitizeReport({
    sec: 30, frames: { n: 100, p50: 6.94, p95: 13.9, over33: 2, name: 'secret' }, wheel: { n: 5, p95: 18.4 },
    nodes: { total: 57, visible: 20, terms: 8, title: 'my convo' }, renders: { session: 3, text: 'x' }, rebuild: { n: 2, changed: 1 },
    view: { zoom: 0.28, w: 2560, h: 1345 }, reason: 'tick', screen: 'hello world', convo: { text: 'secret' },
  }, 'web');
  assert.equal(r.kind, 'web');
  assert.deepEqual(r.frames, { n: 100, p50: 6.94, p95: 13.9, over33: 2 });
  assert.deepEqual(r.nodes, { total: 57, visible: 20, terms: 8 });
  assert.deepEqual(r.renders, { session: 3 });
  assert.equal(r.reason, 'tick');
  assert.ok(!('screen' in r) && !('convo' in r));
  assert.ok(!JSON.stringify(r).includes('secret') && !JSON.stringify(r).includes('hello'));
  assert.equal(sanitizeReport({ reason: 'Bad Words!' }).reason, undefined);
  assert.equal(sanitizeReport({}, 'evil').kind, 'app');
  assert.equal(sanitizeReport({ frames: { p95: Infinity, n: '3' } }).frames, undefined);
});

test('PerfTrace: 꺼져 있으면 버리고, 켜면 로그 한 줄(perf <종류> {...})', () => {
  const lines = [];
  const s = fakeSettings();
  const pt = new PerfTrace({ settings: s, log: (m) => lines.push(m) });
  assert.deepEqual(pt.report({ frames: { n: 1 } }, { kind: 'desktop' }), { ok: false, off: true });
  assert.equal(lines.length, 0);
  s.set({ perfTrace: true }); pt.changed();
  assert.deepEqual(pt.report({ frames: { n: 1, p95: 7 } }, { kind: 'desktop' }), { ok: true });
  assert.deepEqual(pt.report({ frames: { n: 2 }, phone: true }, { kind: 'web' }), { ok: true });
  const perf = lines.filter((l) => /^perf (app|web|phone) /.test(l));
  assert.equal(perf.length, 2);
  assert.match(perf[0], /^perf app \{"kind":"app","sec":null,"frames":\{"n":1,"p95":7\}\}$/);
  assert.match(perf[1], /^perf phone /);
  assert.equal(pt.status().reports, 2);
  s.set({ perfTrace: false }); pt.changed();
  assert.match(lines.at(-1), /perf trace: off \(2 reports\)/);
  // 끈 직후(GRACE_MS 안) 창이 보내는 마지막 요약은 받고, 그 뒤는 버린다
  assert.deepEqual(pt.report({ reason: 'stop' }, { kind: 'desktop' }), { ok: true });
  pt.offAt -= 10_000;
  assert.deepEqual(pt.report({ reason: 'stop' }, { kind: 'desktop' }), { ok: false, off: true });
  pt.stop();
});

test('PerfTrace: 켠 뒤 정한 시간이 지나면 저절로 끄고, 백엔드가 뜰 때 켜져 있으면 끈다', async () => {
  const lines = [];
  const s = fakeSettings();
  const pt = new PerfTrace({ settings: s, log: (m) => lines.push(m), traceMs: 30 });
  s.set({ perfTrace: true }); pt.changed();
  assert.equal(s.get().perfTrace, true);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(s.get().perfTrace, false);
  assert.ok(lines.some((l) => /time is up/.test(l)));
  const s2 = fakeSettings({ perfTrace: true });
  new PerfTrace({ settings: s2 }).start();
  assert.equal(s2.get().perfTrace, false);
});
