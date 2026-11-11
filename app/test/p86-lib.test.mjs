// P86 단위 시험: 보드를 여는 단계 기록(lib/crumbs.js stepOf·crumbStep, 크기 상한, 내용 없음), 죽을 때마다 한 단계씩 가벼워지는 보드와
// 살아남은 단계 기억·한 단계 무겁게·처음으로(bootDecide, crumbAlive, crumbLeave, levelHeavier, levelReset), 단계마다 끄는 것(levelPlan),
// 웹 터미널 칸·줄 상한(capDims), 연결 기록 줄(lib/remote.js, backend/src/web-crash.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCrumbs, bootDecide, reportOf, crumbAlive, crumbLeave, chooseBoard, crumbStep, stepOf, levelHeavier, levelReset, levelPlan, capDims, LEVEL_MAX, LEVEL_OK_MS, STEP_KEEP, STEP_REPORT, WEB_MAX_COLS, WEB_MAX_ROWS } from '../src/renderer/lib/crumbs.js';
import { logRow, crashText, LOG_EVENTS } from '../src/renderer/lib/remote.js';
import { crashInfo, stepsInfo, stepsLabel, crashLabel } from '../../backend/src/web-crash.mjs';

const json = (x) => JSON.parse(JSON.stringify(x)); // localStorage를 거친 것처럼
// 보드 부팅 하나: 부팅 → 보드 그림(paint) → 살아 있음 → 정상 떠남 또는 죽음(아무것도 적지 않음)
function boardLife(s, t, { up = 3000, leave = false, paint = true, view = 'board' } = {}) {
  const d = bootDecide(s, t);
  let x = crumbStep(d.state, 'open', { in: 0 }, t + 200);
  if (paint) x = crumbStep(x, 'paint', { n: 40 }, t + 400);
  for (let a = 2000; a <= up; a += 2000) x = crumbAlive(x, { view, terms: 0 }, t + a);
  if (leave) x = crumbLeave(x, t + up + 10);
  return { d, s: json(x) };
}

test('stepOf: 이름·숫자·종류 이름(k)만, 값은 8개까지, 글은 버린다', () => {
  assert.deepEqual(stepOf('msg', { k: 'board.get', b: 26401 }, 812.4), { s: 'msg', t: 812, k: 'board.get', b: 26401 });
  assert.deepEqual(stepOf('term', { c: 175, r: 33, cw: 8.40625, ch: 18, z: 0.30000001 }, 5), { s: 'term', t: 5, c: 175, r: 33, cw: 8.406, ch: 18, z: 0.3 });
  // 글(제목, 화면 글), 긴 키, 이상한 이름은 남지 않는다
  const o = stepOf('fw0', { b: 100, title: 'secret', text: 'ls -la', k: 'has space', veryLongKey: 1, n: NaN, i: Infinity }, 1);
  assert.deepEqual(o, { s: 'fw0', t: 1, b: 100 });
  assert.equal(stepOf('Bad Name', {}), null);
  assert.equal(stepOf('x'.repeat(13), {}), null);
  const many = stepOf('x', Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`v${i}`, i])), 0);
  assert.equal(Object.keys(many).length, 2 + 8);
  for (const v of Object.values(stepOf('msg', { k: 'terminal.frame', b: 1 }, 0))) assert.ok(typeof v === 'number' || /^[a-z0-9._:-]+$/i.test(v));
});

test('crumbStep: 그 자리에서 더하고 마지막 STEP_KEEP개만 남긴다. paint는 보드가 선 때를 적는다', () => {
  let s = bootDecide(null, 1000).state;
  for (let i = 0; i < STEP_KEEP + 5; i++) s = crumbStep(s, 'msg', { b: i }, 1000 + i);
  assert.equal(s.cur.steps.length, STEP_KEEP);
  assert.equal(s.cur.steps[0].b, 5); assert.equal(s.cur.steps.at(-1).b, STEP_KEEP + 4);
  assert.equal(s.cur.steps.at(-1).t, STEP_KEEP + 4); // 부팅부터 ms
  assert.equal(s.cur.boardAt, undefined);
  s = crumbStep(s, 'paint', { n: 3 }, 2000);
  assert.equal(s.cur.boardAt, 2000);
  assert.equal(crumbStep(s, 'paint', {}, 3000).cur.boardAt, 2000); // 처음 것만
  // 적어 둔 글 크기: 단계 16개를 채워도 몇 KB 안
  assert.ok(JSON.stringify(s).length < 4000, JSON.stringify(s).length);
  // 살아 있다는 기록(2초 주기)은 단계를 지우지 않는다
  assert.equal(crumbAlive(s, { view: 'board' }, 4000).cur.steps.length, STEP_KEEP);
  const empty = parseCrumbs(null);
  assert.equal(crumbStep(empty, 'open', {}, 1), empty); // 부팅 전(기록 없음)에는 그대로
});

test('죽은 다음 부팅의 boot 줄: 마지막 STEP_REPORT개 단계와 그 페이지의 보드 단계', () => {
  let s = bootDecide(null, 1e6).state;
  for (let i = 0; i < 14; i++) s = crumbStep(s, 'msg', { k: 'terminal.history', b: 40000 + i }, 1e6 + 100 * i);
  s = crumbStep(s, 'term', { c: 175, r: 33, cw: 8.4 }, 1e6 + 2000);
  const d = bootDecide(json(s), 1e6 + 3000);
  assert.equal(d.crashed, true);
  assert.equal(d.report.steps.length, STEP_REPORT);
  assert.deepEqual(d.report.steps.at(-1), { s: 'term', t: 2000, c: 175, r: 33, cw: 8.4 });
  assert.equal(d.report.level, undefined); // 단계 0은 적지 않는다
  // 이정표(부팅, 소켓 열림, 판 적용, 첫 그리기, 화면 맞춤)는 뒤의 단계가 많아도 남는다
  let m = bootDecide(null, 2e6).state;
  for (const n of ['boot', 'open', 'board', 'paint', 'fit']) m = crumbStep(m, n, {}, 2e6 + 10);
  for (let i = 0; i < 40; i++) m = crumbStep(m, 'fw0', { b: i }, 2e6 + 100 + i);
  assert.equal(m.cur.steps.length, STEP_KEEP);
  assert.deepEqual(m.cur.steps.slice(0, 5).map((x) => x.s), ['boot', 'open', 'board', 'paint', 'fit']);
  assert.equal(m.cur.steps.at(-1).b, 39);
  const mr = bootDecide(json(m), 2e6 + 5000).report.steps;
  assert.equal(mr.length, STEP_REPORT);
  assert.deepEqual(mr.slice(0, 5).map((x) => x.s), ['boot', 'open', 'board', 'paint', 'fit']);
  assert.equal(mr.at(-1).b, 39); assert.equal(mr[5].b, 39 - (STEP_REPORT - 6));
  // 백엔드가 같은 것만 받는다(내용 없음)
  const info = crashInfo({ ...d.report, steps: [...d.report.steps, { s: 'x', t: 1, title: 'secret', k: 'a b' }] });
  assert.equal(info.steps.length, STEP_REPORT);
  assert.ok(info.steps.every((x) => Object.keys(x).every((k) => /^[a-z][a-z0-9]{0,5}$/.test(k))));
  assert.ok(!JSON.stringify(info).includes('secret'));
  // 옛 화면(P84)의 boot 줄은 그대로(steps, level 없음)
  assert.deepEqual(reportOf({ boot: 100, alive: 600, view: 'full', terms: 1 }, 1000, { boots: 1 }), { ago: 400, up: 500, boots: 1, terms: 1, view: 'full' });
});

test('보드가 죽을 때마다 다음 보드는 한 단계 가볍게(L1 → L2 …, LEVEL_MAX에서 멈춤). 가려진 채 죽음과 목록에서 죽음은 단계를 바꾸지 않는다', () => {
  let t = 1e6;
  let r = boardLife(null, t); assert.equal(r.d.level, 0);
  const seen = [];
  for (let i = 0; i < 6; i++) { t += 70000; r = boardLife(r.s, t); seen.push(r.d.level); } // 1분보다 띄워 가벼운 화면(P84)이 끼지 않게
  assert.deepEqual(seen, [1, 2, 3, 4, 4, 4]);
  assert.equal(LEVEL_MAX, 4);
  // 가려진 채 죽음: 그대로
  let h = boardLife(null, 2e6).s; h = boardLife(h, 2e6 + 70000).s; // L1
  const hid = json(crumbAlive(h, { view: 'board', hidden: true }, 2e6 + 70000 + 2500));
  assert.equal(bootDecide(hid, 2e6 + 80000).level, 1);
  // 목록에서 죽음: 그대로
  const list = json(crumbAlive(h, { view: 'list' }, 2e6 + 70000 + 2500));
  assert.equal(bootDecide(list, 2e6 + 80000).level, 1);
  // 그리기 전에 죽어도(소켓 열림·큰 메시지에서) 한 단계 내린다
  const early = boardLife(null, 3e6, { paint: false, up: 0 }).s;
  assert.equal(bootDecide(early, 3e6 + 2000).level, 1);
});

test('가벼운 화면(목록)에서 "보드로 다시 열기"는 지금 단계의 보드로 연다. 또 죽으면 다시 한 단계', () => {
  let t = 1e6;
  let r = boardLife(null, t); // L0 죽음
  t += 8000; r = boardLife(r.s, t); assert.equal(r.d.level, 1); assert.equal(r.d.light, false); // L1 죽음(1분 안 두 번)
  t += 8000; r = boardLife(r.s, t, { paint: false, view: 'list' }); assert.equal(r.d.light, true); assert.equal(r.d.level, 2); // 가벼운 화면(목록), 다음 보드는 L2
  let x = json(crumbLeave(chooseBoard(r.s, t + 3000), t + 3010)); // 보드로 다시 열기
  r = boardLife(x, t + 4000); assert.equal(r.d.light, false); assert.equal(r.d.level, 2);
  const again = bootDecide(r.s, t + 12000); // 다시 연 L2 보드가 또 죽음 → 가벼운 화면, 다음 보드는 L3
  assert.equal(again.light, true); assert.equal(again.level, 3);
  assert.equal(again.report.level, 2); assert.equal(again.report.retry, true);
});

test('살아남은 단계를 기억한다: 보드를 그린 뒤 1분 넘게 살거나 정상으로 떠나면 ok, 다음 부팅도 그 단계', () => {
  const T0 = 1e6 + 140000;
  let r = boardLife(null, 1e6); r = boardLife(r.s, 1e6 + 70000); r = boardLife(r.s, T0); // L2로 연 보드
  assert.equal(r.d.level, 2); assert.equal(r.s.ok, false);
  const s0 = r.s;
  // 1분이 안 되면 아직
  assert.equal(crumbAlive(s0, { view: 'board' }, T0 + 400 + LEVEL_OK_MS - 100).ok, false);
  const alive = crumbAlive(s0, { view: 'board' }, T0 + 400 + LEVEL_OK_MS + 10);
  assert.equal(alive.ok, true); assert.equal(alive.level, 2);
  // 정상 떠남도 살아남음(보드를 그린 뒤)
  assert.equal(crumbLeave(s0, T0 + 5000).ok, true);
  // 보드를 그리기 전에 떠나면 아니다
  const np = boardLife(null, 5e6, { paint: false }).s;
  assert.equal(crumbLeave(np, 5e6 + 3000).ok, false);
  // 다음 부팅은 기억한 단계와 ok
  const next = bootDecide(json(crumbLeave(alive, T0 + 90000)), T0 + 100000);
  assert.equal(next.crashed, false); assert.equal(next.level, 2); assert.equal(next.ok, true);
  // 기억한 단계에서 다시 죽으면 한 단계 내리고 ok를 지운다
  const died = bootDecide(json(crumbStep(next.state, 'paint', {}, T0 + 100500)), T0 + 110000);
  assert.equal(died.level, 3); assert.equal(died.ok, false);
});

test('한 단계 무겁게, 처음으로: 단계와 ok를 바꾸고 다시 읽을 때 죽음으로 세지 않는다', () => {
  let r = boardLife(null, 1e6); r = boardLife(r.s, 1e6 + 70000); r = boardLife(r.s, 1e6 + 140000);
  const ok = json(crumbAlive(r.s, { view: 'board' }, 1e6 + 140000 + LEVEL_OK_MS + 1000));
  assert.equal(ok.level, 2); assert.equal(ok.ok, true);
  const h = json(crumbLeave(levelHeavier(ok, 2e6), 2e6 + 5));
  assert.equal(h.level, 1); assert.equal(h.ok, false); assert.equal(h.light, false); assert.equal(h.cur.clean, true);
  const hb = bootDecide(h, 2e6 + 1000); assert.equal(hb.crashed, false); assert.equal(hb.level, 1);
  // 무겁게 연 L1이 또 죽으면 L2로 돌아간다
  const back = bootDecide(json(crumbStep(hb.state, 'paint', {}, 2e6 + 1500)), 2e6 + 9000);
  assert.equal(back.level, 2);
  // 처음으로
  const z = json(crumbLeave(levelReset(ok, 3e6), 3e6 + 5));
  assert.equal(z.level, 0); assert.equal(z.ok, false);
  assert.equal(bootDecide(z, 3e6 + 1000).level, 0);
  assert.equal(levelHeavier({ ...parseCrumbs(null) }).level, 0); // 0보다 가볍게 내려가지 않는다
});

test('parseCrumbs: 옛 기록(P84)과 깨진 단계 값은 단계 0', () => {
  assert.equal(parseCrumbs('{"v":1,"cur":null,"crashes":[],"light":false,"retry":null}').level, 0);
  assert.equal(parseCrumbs('{"v":1,"level":9}').level, LEVEL_MAX);
  assert.equal(parseCrumbs('{"v":1,"level":-1}').level, 0);
  assert.equal(parseCrumbs('{"v":1,"level":"2"}').level, 0);
  assert.equal(parseCrumbs('{"v":1,"level":2,"ok":true}').ok, true);
});

test('levelPlan: 단계마다 끄는 것', () => {
  assert.deepEqual(levelPlan(0), { level: 0, terms: true, items: true, fancyEdges: true, effects: true, allWs: true });
  assert.deepEqual(levelPlan(1), { level: 1, terms: false, items: true, fancyEdges: true, effects: true, allWs: true });
  assert.deepEqual(levelPlan(2), { level: 2, terms: false, items: false, fancyEdges: false, effects: true, allWs: true });
  assert.deepEqual(levelPlan(3), { level: 3, terms: false, items: false, fancyEdges: false, effects: false, allWs: true });
  assert.deepEqual(levelPlan(4), { level: 4, terms: false, items: false, fancyEdges: false, effects: false, allWs: false });
  assert.deepEqual(levelPlan(undefined), levelPlan(0));
});

test('capDims: 웹 화면 터미널의 칸·줄 상한(PC 창은 그대로)', () => {
  assert.deepEqual(capDims({ cols: 175, rows: 33 }), { cols: 175, rows: 33 });
  assert.deepEqual(capDims({ cols: 5000, rows: 900 }), { cols: WEB_MAX_COLS, rows: WEB_MAX_ROWS });
  assert.deepEqual(capDims({ cols: 5000, rows: 900 }, false), { cols: 5000, rows: 900 });
  assert.deepEqual(capDims({ cols: NaN, rows: undefined }), { cols: 100, rows: 30 });
  assert.ok(WEB_MAX_COLS >= 300 && WEB_MAX_ROWS >= 100);
});

test('연결 기록: boot 줄의 마지막 단계·보드 단계, level 줄', () => {
  assert.ok(LOG_EVENTS.includes('level'));
  const steps = [{ s: 'open', t: 1200, in: 0 }, { s: 'msg', t: 1300, k: 'board.get', b: 26401 }, { s: 'term', t: 1500, c: 175, r: 33, cw: 8.4 }];
  const r = logRow({ at: 1, event: 'boot', crashed: true, level: 2, crash: { view: 'board', terms: 0, dpr: 3, up: 900, level: 1, steps } });
  assert.equal(r.key, 'remoteCrash.ev_boot'); assert.equal(r.level, 2);
  assert.equal(r.crash, 'board · 0 term · dpr 3 · 0.9s · L1');
  assert.equal(r.steps, 'open in 0 1.2s › msg board.get 26K 1.3s › term 175x33 cw 8.4 1.5s');
  assert.equal(stepsLabel(stepsInfo(steps)), r.steps);
  assert.equal(crashText({ view: 'board', level: 3 }), crashLabel({ view: 'board', level: 3 }));
  const lv = logRow({ at: 1, event: 'level', level: 1 });
  assert.equal(lv.key, 'remoteSteps.ev_level'); assert.equal(lv.level, 1); assert.equal(lv.steps, undefined);
  assert.equal(logRow({ at: 1, event: 'boot', crashed: true, level: 0, crash: { view: 'list' } }).level, undefined); // 단계 0은 보이지 않는다
  assert.equal(stepsInfo('x'), null); assert.equal(stepsInfo([{ s: 'BAD' }]), null);
});
