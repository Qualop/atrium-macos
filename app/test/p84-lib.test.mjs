// P84 단위 시험: 죽기 전 기록(lib/crumbs.js)과 정상 떠남·죽음 판단, 가벼운 화면 판단, 백엔드로 보낼 직전 상태(내용 없음),
// 휴대폰 터미널 예산(수, 캔버스 픽셀 상한, WebGL 끔), 연결 기록 줄(lib/remote.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCrumbs, bootDecide, reportOf, crumbAlive, crumbLeave, crumbBack, chooseBoard, termBudget, CRASH_WINDOW_MS, CRASH_KEEP_MS, RETRY_OK_MS, PHONE_MAX_TERMS, WEB_SHARP_MAX_PX } from '../src/renderer/lib/crumbs.js';
import { logRow, crashText, LOG_EVENTS } from '../src/renderer/lib/remote.js';

const SAMPLE = { view: 'board', terms: 2, px: 9.4e6, atlas: 262144, gl: 2, dpr: 3, inB: 230000, hidden: false };
// 한 페이지의 삶: 부팅 → 살아 있음(몇 번) → 정상 떠남 또는 죽음(아무것도 적지 않음)
const life = (s, t, { up = 6000, leave = false, sample = SAMPLE } = {}) => {
  const d = bootDecide(s, t);
  let x = d.state;
  for (let a = 2000; a <= up; a += 2000) x = crumbAlive(x, sample, t + a);
  if (leave) x = crumbLeave(x, t + up + 10);
  return { d, s: JSON.parse(JSON.stringify(x)) }; // localStorage를 거친 것처럼
};

test('parseCrumbs: 없거나 깨진 값은 처음 상태', () => {
  for (const v of [null, '', 'x', '{"v":2}', '[]', '{"v":1,"cur":{"boot":"a"}}']) {
    const s = parseCrumbs(v);
    assert.equal(s.cur, null); assert.deepEqual(s.crashes, []); assert.equal(s.light, false); assert.equal(s.retry, null);
  }
});

test('처음 부팅은 죽음이 아니다. 정상으로 떠난 뒤 다시 읽으면 죽음이 아니다', () => {
  const a = life(null, 1e6, { leave: true });
  assert.equal(a.d.crashed, false); assert.equal(a.d.report, null);
  assert.equal(a.s.cur.clean, true);
  const b = bootDecide(a.s, 1e6 + 20000);
  assert.equal(b.crashed, false); assert.equal(b.light, false); assert.equal(b.report, null);
});

test('정상 떠남 없이 다시 읽히면 죽음: 직전 상태(화면, 터미널, 픽셀, WebGL, DPR, 받은 바이트)를 보낸다', () => {
  const a = life(null, 1e6, { up: 6000 });
  assert.equal(a.s.cur.clean, false);
  const b = bootDecide(a.s, 1e6 + 7500);
  assert.equal(b.crashed, true); assert.equal(b.hidden, false); assert.equal(b.light, false); // 한 번은 가벼운 화면이 아니다
  assert.deepEqual(b.report, { ago: 1500, up: 6000, boots: 1, terms: 2, px: 9.4e6, atlas: 262144, gl: 2, dpr: 3, inB: 230000, view: 'board' });
  // 보내는 값은 숫자와 짧은 코드만(글·화면 내용이 들어갈 자리가 없다)
  for (const v of Object.values(b.report)) assert.ok(typeof v === 'number' || typeof v === 'boolean' || ['board', 'list', 'session', 'full'].includes(v));
});

test('1분 안에 두 번 죽으면 다음 부팅은 가벼운 화면, 사이가 길면 아니다', () => {
  let t = 1e6;
  let x = life(null, t, { up: 6000 }).s; // 1번째 페이지가 죽는다
  t += 8000; let r = life(x, t, { up: 6000 }); assert.equal(r.d.crashed, true); assert.equal(r.d.light, false); x = r.s; // 2번째 부팅(죽음 1), 또 죽는다
  t += 8000; r = life(x, t, { up: 4000, leave: true }); assert.equal(r.d.crashed, true); assert.equal(r.d.light, true); assert.equal(r.d.report.boots, 2); // 3번째 부팅(죽음 2) → 가벼운 화면
  // 가벼운 화면은 정상으로 다시 읽어도 이어진다(사람이 보드로 다시 열 때까지)
  const again = bootDecide(r.s, t + 60000);
  assert.equal(again.crashed, false); assert.equal(again.light, true);
  // 사이가 1분보다 길면 가벼운 화면이 아니다
  let y = life(null, 2e6, { up: 6000 }).s;
  let q = life(y, 2e6 + 8000, { up: 6000 + CRASH_WINDOW_MS }); assert.equal(q.d.light, false); y = q.s;
  q = life(y, 2e6 + 8000 + 6000 + CRASH_WINDOW_MS + 9000); assert.equal(q.d.crashed, true); assert.equal(q.d.light, false);
  // 오래된 죽음(CRASH_KEEP_MS 넘음)은 세지 않는다
  const old = { v: 1, cur: { boot: 0, alive: 5000, clean: false }, crashes: [3000], light: false, retry: null };
  assert.equal(bootDecide(old, 3000 + CRASH_KEEP_MS + 10).light, false);
});

test('가려진(백그라운드) 채 죽은 것은 기록만 하고 가벼운 화면 판단에는 세지 않는다', () => {
  let x = life(null, 1e6, { up: 4000, sample: { ...SAMPLE, hidden: true } }).s;
  let r = life(x, 1e6 + 5000, { up: 4000, sample: { ...SAMPLE, hidden: true } });
  assert.equal(r.d.crashed, true); assert.equal(r.d.hidden, true); assert.equal(r.d.report.hidden, true);
  r = life(r.s, 1e6 + 10000);
  assert.equal(r.d.crashed, true); assert.equal(r.d.light, false); assert.deepEqual(r.s.crashes, []);
});

test('"보드로 다시 열기": 보드로 열고, 그 보드가 또 죽으면 한 번으로도 다시 가벼운 화면. 정상으로 떠나면 다시 열기를 마친다', () => {
  // 가벼운 화면에서 보드로 다시 열기 → 페이지를 다시 읽는다(pagehide)
  const lightState = { v: 1, cur: { boot: 1e6, alive: 1e6 + 3000, clean: false, light: true }, crashes: [], light: true, retry: null };
  let x = crumbLeave(chooseBoard(lightState, 1e6 + 4000), 1e6 + 4010);
  assert.equal(x.light, false); assert.equal(x.retry, 1e6 + 4000);
  let r = life(x, 1e6 + 4500, { up: 6000 }); // 다시 연 보드(죽는다)
  assert.equal(r.d.crashed, false); assert.equal(r.d.light, false); assert.equal(r.s.cur.retryBoot, true);
  const back = bootDecide(r.s, 1e6 + 12000);
  assert.equal(back.crashed, true); assert.equal(back.light, true); assert.equal(back.report.retry, true);
  // 다시 연 보드가 정상으로 떠나면 다음 죽음은 다시 두 번을 센다
  r = life(crumbLeave(chooseBoard(lightState, 2e6), 2e6 + 10), 2e6 + 500, { up: 4000, leave: true });
  assert.equal(r.s.retry, null);
  r = life(r.s, 2e6 + 9000, { up: 4000 });
  assert.equal(bootDecide(r.s, 2e6 + 15000).light, false);
  // 다시 연 보드가 RETRY_OK_MS 넘게 살아 있으면 다시 열기를 마친 것으로 본다
  r = life(crumbLeave(chooseBoard(lightState, 3e6), 3e6 + 10), 3e6 + 500, { up: RETRY_OK_MS + 2000 });
  assert.equal(r.s.retry, null); assert.equal(r.s.cur.retryBoot, false);
  assert.equal(bootDecide(r.s, 3e6 + RETRY_OK_MS + 5000).light, false);
});

test('bfcache: pagehide(persisted) 뒤 돌아오면 다시 살아 있는 페이지', () => {
  const a = life(null, 1e6, { leave: true });
  const back = crumbBack(a.s, 1e6 + 9000);
  assert.equal(back.cur.clean, false);
  assert.equal(bootDecide(back, 1e6 + 20000).crashed, true);
});

test('reportOf: 직전 상태가 없으면 null, 화면 이름과 숫자만', () => {
  assert.equal(reportOf(null, 1), null);
  const r = reportOf({ boot: 100, alive: 600, clean: false, view: 'full', terms: 1, px: 0, gl: 0, dpr: 3, title: 'secret', text: 'x' }, 1000, { boots: 1 });
  assert.deepEqual(r, { ago: 400, up: 500, boots: 1, terms: 1, px: 0, gl: 0, dpr: 3, view: 'full' });
});

test('휴대폰 터미널 예산: 손가락 웹은 WebGL 끔·3개, 가벼운 화면은 1개, 웹은 캔버스 픽셀 상한, PC 창은 그대로', () => {
  assert.equal(PHONE_MAX_TERMS, 3);
  assert.deepEqual(termBudget({ web: true, coarse: true, maxControllers: 8, webglBudget: 8 }), { max: 3, webgl: 0, maxPx: WEB_SHARP_MAX_PX });
  assert.deepEqual(termBudget({ web: true, coarse: true, maxControllers: 2, webglBudget: 8 }), { max: 2, webgl: 0, maxPx: WEB_SHARP_MAX_PX });
  assert.deepEqual(termBudget({ web: true, coarse: false, light: true, maxControllers: 8, webglBudget: 8 }), { max: 1, webgl: 0, maxPx: WEB_SHARP_MAX_PX });
  assert.deepEqual(termBudget({ web: true, coarse: false, maxControllers: 8, webglBudget: 8 }), { max: 8, webgl: 8, maxPx: WEB_SHARP_MAX_PX });
  assert.deepEqual(termBudget({ web: false, coarse: false, maxControllers: 8, webglBudget: 8 }), { max: 8, webgl: 8, maxPx: null });
  assert.deepEqual(termBudget({ web: false, coarse: true, maxControllers: 8, webglBudget: 8 }), { max: 8, webgl: 8, maxPx: null }); // 터치 PC의 창도 그대로
  assert.ok(WEB_SHARP_MAX_PX <= 4e6);
});

test('연결 기록 줄: boot는 닫히기 전 상태와 가벼운 화면을 보인다', () => {
  assert.ok(LOG_EVENTS.includes('boot'));
  const r = logRow({ at: 1, event: 'boot', deviceName: 'iPhone', remote: true, browser: 'Safari 18 · iOS', crashed: true, light: true, crash: { view: 'board', terms: 1, px: 1e7, gl: 1, dpr: 3, up: 5800 } });
  assert.equal(r.key, 'remoteCrash.ev_boot'); assert.equal(r.bad, true); assert.equal(r.light, true);
  assert.equal(r.crash, 'board · 1 term · 10.0M px · gl 1 · dpr 3 · 5.8s');
  assert.equal(crashText(null), '');
  assert.equal(logRow({ at: 1, event: 'connect' }).crash, undefined);
});
