// P113: 창을 닫고 트레이에 남을 때 GPU 프로세스 메모리 돌려주기(src/main/gpu-purge.mjs). Electron 없이 가짜 창으로 순서와 실패 처리를 본다
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPurgeOnClose, pressureSteps, purgeAndDestroy } from '../src/main/gpu-purge.mjs';

function fakeWin({ loadFails = false, loadHangs = false, attached = false, sendFails = false } = {}) {
  const calls = [];
  let destroyed = false, isAtt = attached;
  const win = {
    calls,
    hide: () => calls.push('hide'),
    isDestroyed: () => destroyed,
    destroy: () => { calls.push('destroy'); destroyed = true; },
    webContents: {
      loadURL: (u) => { calls.push(`load ${u}`); return loadHangs ? new Promise(() => {}) : loadFails ? Promise.reject(new Error('load failed')) : Promise.resolve(); },
      debugger: {
        isAttached: () => isAtt,
        attach: (v) => { calls.push(`attach ${v}`); isAtt = true; },
        detach: () => { calls.push('detach'); isAtt = false; },
        sendCommand: (m, p) => { calls.push(`${m} ${p.level}`); return sendFails ? Promise.reject(new Error('no target')) : Promise.resolve({}); },
      },
    },
  };
  return win;
}
const noSleep = async () => {};

test('트레이에 남을 때만 한다(끝내는 중, 업데이트, 트레이 끔, off는 하지 않는다)', () => {
  const base = { keepRunning: true, quitting: false, updating: false, level: 'critical' };
  assert.equal(shouldPurgeOnClose(base), true);
  assert.equal(shouldPurgeOnClose({ ...base, level: 'moderate' }), true);
  assert.equal(shouldPurgeOnClose({ ...base, keepRunning: false }), false);
  assert.equal(shouldPurgeOnClose({ ...base, keepRunning: null }), false);
  assert.equal(shouldPurgeOnClose({ ...base, quitting: true }), false);
  assert.equal(shouldPurgeOnClose({ ...base, updating: true }), false);
  assert.equal(shouldPurgeOnClose({ ...base, level: 'off' }), false);
  assert.equal(shouldPurgeOnClose({ ...base, level: undefined }), false);
});

test('같은 단계는 거듭 전해지지 않으므로 다른 단계를 먼저 보낸다', () => {
  assert.deepEqual(pressureSteps('critical'), ['moderate', 'critical']);
  assert.deepEqual(pressureSteps('moderate'), ['critical', 'moderate']);
});

test('숨기기 → about:blank → 압박 두 단계 → 떼기 → 창 없애기 순서', async () => {
  const w = fakeWin();
  const r = await purgeAndDestroy(w, { level: 'critical', sleep: noSleep });
  assert.equal(r.ok, true);
  assert.deepEqual(w.calls, ['hide', 'load about:blank', 'attach 1.3', 'Memory.simulatePressureNotification moderate', 'Memory.simulatePressureNotification critical', 'detach', 'destroy']);
});

test('이미 붙은 디버거(시험 도구 등)는 그대로 두고 떼지 않는다', async () => {
  const w = fakeWin({ attached: true });
  const r = await purgeAndDestroy(w, { sleep: noSleep });
  assert.equal(r.ok, true);
  assert.ok(!w.calls.some((c) => c.startsWith('attach') || c === 'detach'));
  assert.equal(w.calls.at(-1), 'destroy');
});

test('페이지 바꾸기나 명령이 실패해도 창은 늘 없앤다', async () => {
  const a = fakeWin({ loadFails: true });
  const ra = await purgeAndDestroy(a, { sleep: noSleep });
  assert.equal(ra.ok, false); assert.match(ra.error, /load failed/);
  assert.deepEqual(a.calls, ['hide', 'load about:blank', 'destroy']);
  const b = fakeWin({ sendFails: true });
  const rb = await purgeAndDestroy(b, { sleep: noSleep });
  assert.equal(rb.ok, false); assert.equal(b.calls.at(-2), 'detach'); assert.equal(b.calls.at(-1), 'destroy');
});

test('페이지가 끝나지 않으면 시간 제한 뒤 창을 없앤다', async () => {
  const w = fakeWin({ loadHangs: true });
  const r = await purgeAndDestroy(w, { sleep: noSleep, timeoutMs: 30 });
  assert.equal(r.ok, false); assert.match(r.error, /timeout/);
  assert.equal(w.calls.at(-1), 'destroy');
});

test('기다리는 동안 창이 없어졌으면 명령을 보내지 않는다', async () => {
  const w = fakeWin();
  const r = await purgeAndDestroy(w, { sleep: async () => { w.destroy(); } });
  assert.equal(r.ok, false);
  assert.ok(!w.calls.some((c) => c.startsWith('Memory.')));
  assert.equal(w.calls.filter((c) => c === 'destroy').length, 1);
});
