// P104 단위 시험: 휴대폰 키 줄의 session.keys. 허용 목록(받는 키, 거부하는 키, 개수), 원격 기기에서 부를 수 있음(web.mjs가 막지 않는다),
// 세션 이벤트 기록(키 이름과 보낸 쪽만), 세션마다 차례(겹쳐 불러도 보낸 순서), 잠든 세션
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KEY_NAMES, KEYS_MAX, checkKeys, keyChain, keysBy } from '../src/keys.mjs';
import { Backend } from '../src/backend.mjs';
import { Store } from '../src/store.mjs';
import { WebServer } from '../src/web.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p104-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('허용 목록: 방향키, enter, esc, tab, space, 숫자만 받는다', () => {
  assert.deepEqual([...KEY_NAMES], ['up', 'down', 'left', 'right', 'enter', 'esc', 'tab', 'space', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(checkKeys(['down', 'down', 'enter']), ['down', 'down', 'enter']);
  assert.deepEqual(checkKeys(['left', 'right', 'up', 'esc', 'tab', 'space']), ['left', 'right', 'up', 'esc', 'tab', 'space']);
  assert.deepEqual(checkKeys([1, '2', 9]), ['1', '2', '9'], '숫자는 수로 와도 받는다');
  assert.equal(checkKeys(Array(KEYS_MAX).fill('down')).length, KEYS_MAX);
});

test('허용 목록: 그 밖의 키, 글, ctrl·shift 조합, 빈 목록, 너무 많은 키는 거부한다', () => {
  const rejects = (keys, key) => assert.throws(() => checkKeys(keys), (e) => e.code === 'bad_request' && e.key === key, JSON.stringify(keys));
  for (const k of ['ctrl+c', 'ctrl+g', 'shift+tab', 'alt+x', 'backspace', 'f5', 'home', 'pageup', 'a', 'y', '/', 'hello', '10', '-1', 'Enter', ' enter', '\r', '\x1b[A', '']) rejects([k], 'keysBad');
  rejects(['down', 'ctrl+c'], 'keysBad'); // 하나라도 틀리면 하나도 보내지 않는다
  for (const k of [null, undefined, {}, [], 1.5, true]) rejects([k], 'keysBad');
  rejects([], 'keysEmpty');
  rejects(undefined, 'keysEmpty');
  rejects('enter', 'keysEmpty');
  rejects(Array(KEYS_MAX + 1).fill('down'), 'keysTooMany');
});

test('keyChain: 한 세션의 일은 차례로, 앞 일이 실패해도 다음 일은 한다. 세션끼리는 기다리지 않는다', async () => {
  const run = keyChain();
  const log = [];
  const job = (tag, ms, fail = false) => async () => { log.push(`${tag}+`); await sleep(ms); log.push(`${tag}-`); if (fail) throw new Error(tag); return tag; };
  const a = run('s1', job('a', 30));
  const b = run('s1', job('b', 1, true));
  const c = run('s1', job('c', 1));
  const x = run('s2', job('x', 1));
  assert.equal(await a, 'a');
  await assert.rejects(b, /b/);
  assert.equal(await c, 'c');
  assert.equal(await x, 'x');
  assert.deepEqual(log.filter((l) => !l.startsWith('x')), ['a+', 'a-', 'b+', 'b-', 'c+', 'c-']);
  assert.ok(log.indexOf('x-') < log.indexOf('a-'), 's2는 s1을 기다리지 않는다');
  await sleep(5);
  assert.equal(run.pending(), 0, '끝나면 줄을 지운다');
});

test('keysBy: 이 PC는 local, 짝 맺은 기기는 기기 ID와 이름', () => {
  assert.deepEqual(keysBy(null), { via: 'local' });
  assert.deepEqual(keysBy({ auth: { kind: 'local' } }), { via: 'local' });
  assert.deepEqual(keysBy({ auth: { kind: 'device', device: { id: 'd1', name: 'iPhone' }, remote: true } }), { via: 'device', deviceId: 'd1', deviceName: 'iPhone' });
});

// 가짜 판: pane.send_keys는 calls에, 이벤트는 events에 남는다
function fakeB({ paneId = 'p1', delay = () => 0 } = {}) {
  const calls = [], events = [], touched = [];
  const s = { sessionId: 's1', name: 'w1', kind: 'codex', paneId, agentName: 'w1', rt: {} };
  const b = {
    sessions: new Map([['s1', s]]),
    keyChain: keyChain(), killing: new Set(), currentSession: Backend.prototype.currentSession,
    resolve: (q) => { if (q !== 's1' && q !== 'w1') throw Object.assign(new Error('no session'), { code: 'not_found' }); return s; },
    requireHerdr: () => {},
    touch: (x) => touched.push(x.sessionId),
    peers: { touch: (c) => touched.push(c ? 'peer' : 'none') },
    store: { addEvent: (sid, kind, data) => events.push({ sid, kind, data }) },
    adapter: { paneKeys: async (p, k) => { await sleep(delay(k)); calls.push([p, k.join('+')]); return {}; } },
  };
  return { b, s, calls, events, touched };
}
const send = (b, p, c) => Backend.prototype.sendKeysTo.call(b, p, c);

test('session.keys: 패널에 키를 그대로 보내고 이벤트에 키 이름과 보낸 쪽을 남긴다(원격 기기도)', async () => {
  const { b, s, calls, events, touched } = fakeB();
  const device = { auth: { kind: 'device', device: { id: 'dev1', name: 'phone' }, remote: true } };
  assert.deepEqual(await send(b, { session: 's1', keys: ['down', 'enter'] }, device), { sent: true, keys: ['down', 'enter'] });
  assert.deepEqual(calls, [['p1', 'down+enter']]);
  assert.deepEqual(events, [{ sid: 's1', kind: 'keys', data: { keys: ['down', 'enter'], via: 'device', deviceId: 'dev1', deviceName: 'phone' } }]);
  assert.ok(s.lastUserInputAt > 0);
  assert.deepEqual(touched, ['s1', 'peer']);
  // target으로도 부른다, 이 PC에서 부르면 local
  await send(b, { target: 'w1', keys: [2] }, { auth: { kind: 'local' } });
  assert.deepEqual(calls[1], ['p1', '2']);
  assert.deepEqual(events[1].data, { keys: ['2'], via: 'local' });
});

test('session.keys: 허용하지 않은 키는 herdr를 부르지 않고 기록도 남기지 않는다. 잠든 세션은 sleeping', async () => {
  const { b, calls, events } = fakeB();
  await assert.rejects(send(b, { session: 's1', keys: ['enter', 'ctrl+c'] }, null), (e) => e.code === 'bad_request' && e.key === 'keysBad');
  await assert.rejects(send(b, { session: 's1', keys: [] }, null), (e) => e.key === 'keysEmpty');
  await assert.rejects(send(b, { session: 'nope', keys: ['enter'] }, null), (e) => e.code === 'not_found');
  assert.deepEqual(calls, []);
  assert.deepEqual(events, []);
  const z = fakeB({ paneId: null });
  await assert.rejects(send(z.b, { session: 's1', keys: ['enter'] }, null), (e) => e.code === 'sleeping' && e.key === 'sleepingNoPane');
  assert.deepEqual(z.calls, []);
});

test('session.keys: 겹쳐 불러도 부른 순서대로 패널에 닿는다(앞 요청이 늦게 끝나도)', async () => {
  const { b, calls, events } = fakeB({ delay: (k) => (k[0] === 'down' ? 40 : 0) });
  const ps = [send(b, { session: 's1', keys: ['down'] }, null), send(b, { session: 's1', keys: ['down', 'down'] }, null), send(b, { session: 's1', keys: ['enter'] }, null), send(b, { session: 's1', keys: ['3'] }, null)];
  await Promise.all(ps);
  assert.deepEqual(calls.map((c) => c[1]), ['down', 'down+down', 'enter', '3']);
  assert.deepEqual(events.map((e) => e.data.keys.join('+')), ['down', 'down+down', 'enter', '3']);
});

test('session.keys는 판 API에 있고, 원격 기기에도 막지 않는다(web.mjs에 같은 이름의 localOnly가 없다)', async () => {
  const dir = tmp();
  const store = new Store(path.join(dir, 'board.db'));
  const web = new WebServer({ cfg: { port: 47999, dataDir: dir, profile: 'dev', herdrSession: 'atrium-dev-test' }, store, api: null });
  try {
    const wh = web.handlers();
    assert.equal(wh['session.keys'], undefined, 'web.mjs가 session.keys를 덮지 않는다');
    // 같은 web의 localOnly 처리기는 기기를 막는다(대조)
    assert.throws(() => wh['device.code']({}, { auth: { kind: 'device', device: { id: 'd' } } }), (e) => e.code === 'forbidden');
    const bh = Backend.prototype.handlers.call({});
    assert.equal(typeof bh['session.keys'], 'function');
    // 합친 처리기(backend.mjs ApiServer와 같은 순서)로 기기가 부르면 보낸다
    const { b, calls } = fakeB();
    b.sendKeysTo = Backend.prototype.sendKeysTo;
    const merged = { ...Backend.prototype.handlers.call(b), ...wh };
    const r = await merged['session.keys']({ session: 's1', keys: ['up'] }, { auth: { kind: 'device', device: { id: 'd1', name: 'p' }, remote: true } });
    assert.deepEqual(r, { sent: true, keys: ['up'] });
    assert.deepEqual(calls, [['p1', 'up']]);
  } finally { web.stop(); store.close(); }
});

test('queued keys cannot reach a replacement pane or runtime', async () => {
  for (const change of ['pane', 'runtime']) {
    const { b, s, calls } = fakeB();
    let release, started;
    const entered = new Promise(r => { started = r; });
    const held = new Promise(r => { release = r; });
    b.adapter.paneKeys = async (pane, keys) => { started(); await held; calls.push([pane, keys.join('+')]); };
    const first = send(b, { session: 's1', keys: ['up'] });
    await entered;
    const second = send(b, { session: 's1', keys: ['enter'] });
    const rejected = assert.rejects(second, { code: 'closed' });
    if (change === 'pane') s.paneId = 'replacement'; else s.rt = {};
    release();
    await first; await rejected;
    assert.deepEqual(calls, [['p1', 'up']]);
  }
});
