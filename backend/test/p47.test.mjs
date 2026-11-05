// P47 단위 시험(원격 R1): 클라이언트 알아보기, 알림 받을 클라이언트 고르기, 클라이언트별 viewport,
// 터미널 나눠 보내기의 상태 바꾸기(크기 정하는 기기, full 프레임 기다리기), 가짜 제어기로 돌린 중계(뺏기 없이 둘 다 받기)
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseClientHello, clientList, pickNotifyClient, viewportKey, viewportFor, shareEmpty, shareJoin, shareLeave, shareActive, shareWant, shareSize, shareFrame, shareNeedsFull, shareOwnerView, ACTIVE_MS } from '../src/multiclient.mjs';
import { TerminalRelay } from '../src/relay.mjs';
import { Peers } from '../src/peers.mjs';
import net from 'node:net';
import { deliverAt, seeded, startDelayProxy } from '../tools/delay-proxy.mjs';

test('P47 클라이언트 알아보기: 연결 주소의 값', () => {
  assert.deepEqual(parseClientHello(new URLSearchParams('client=pc-1234abcd&name=Desk&kind=desktop')), { clientId: 'pc-1234abcd', name: 'Desk', kind: 'desktop' });
  assert.deepEqual(parseClientHello(new URLSearchParams('client=web-5678efgh&kind=web')), { clientId: 'web-5678efgh', name: null, kind: 'web' });
  // ID가 없거나 이상하면 익명(CLI)
  assert.deepEqual(parseClientHello(new URLSearchParams('token=x')), { clientId: null, name: null, kind: 'cli' });
  assert.equal(parseClientHello({ client: 'a b<script>' }).clientId, null);
  assert.equal(parseClientHello({ client: 'abcd1234', kind: 'evil' }).kind, 'desktop');
  assert.equal(parseClientHello({ client: 'abcd1234', name: 'x'.repeat(200) }).name.length, 60);
});

test('P47 클라이언트 목록: 익명은 빼고 같은 ID는 합친다', () => {
  const l = clientList([
    { clientId: 'a', name: 'A', kind: 'desktop', connectedAt: 10, lastInputAt: 50 },
    { clientId: null, kind: 'cli', connectedAt: 5 },
    { clientId: 'b', name: 'B', kind: 'web', connectedAt: 20, lastInputAt: null },
    { clientId: 'a', name: 'A2', kind: 'desktop', connectedAt: 30, lastInputAt: 90 },
  ]);
  assert.deepEqual(l.map((c) => [c.clientId, c.name, c.conns, c.lastInputAt, c.connectedAt]), [['a', 'A2', 2, 90, 10], ['b', 'B', 1, null, 20]]);
});

test('P47 알림 받을 클라이언트: 활성 → PC 창 → 트레이', () => {
  const now = 1_000_000;
  const desk = { clientId: 'desk', kind: 'desktop', connectedAt: 1, lastInputAt: now - 60_000 };
  const web = { clientId: 'web', kind: 'web', connectedAt: 2, lastInputAt: now - 1_000 };
  const tray = { clientId: 'tray', kind: 'tray', connectedAt: 0, lastInputAt: now };
  // 가장 최근에 입력한 활성 클라이언트(트레이는 활성이 되지 않는다)
  assert.equal(pickNotifyClient([desk, web, tray], now), 'web');
  assert.equal(pickNotifyClient([{ ...desk, lastInputAt: now - 10 }, web, tray], now), 'desk');
  // 활성이 없으면 PC 창. 웹만 있고 오래 쉬었으면 트레이
  const old = now - ACTIVE_MS - 1;
  assert.equal(pickNotifyClient([{ ...desk, lastInputAt: old - 5 }, { ...web, lastInputAt: old }, tray], now), 'desk');
  assert.equal(pickNotifyClient([{ ...web, lastInputAt: old }, tray], now), 'tray');
  // 창 둘이 다 쉬면 더 최근에 쓴 쪽, 둘 다 입력이 없으면 먼저 붙은 쪽
  assert.equal(pickNotifyClient([{ clientId: 'd1', kind: 'desktop', connectedAt: 1, lastInputAt: old - 100 }, { clientId: 'd2', kind: 'desktop', connectedAt: 2, lastInputAt: old }], now), 'd2');
  assert.equal(pickNotifyClient([{ clientId: 'd1', kind: 'desktop', connectedAt: 1 }, { clientId: 'd2', kind: 'desktop', connectedAt: 2 }], now), 'd1');
  assert.equal(pickNotifyClient([], now), null);
});

test('P47 클라이언트별 viewport: 없으면 보드 값(옛 판 값)', () => {
  assert.equal(viewportKey('pc-1'), 'viewport:pc-1');
  const board = { x: 1, y: 2, zoom: 0.5 };
  assert.deepEqual(viewportFor(null, board), board);
  assert.deepEqual(viewportFor({ x: 9, y: 9, zoom: 1 }, board), { x: 9, y: 9, zoom: 1 });
  assert.equal(viewportFor(null, null), null);
});

test('P47 나눠 보내기: 크기 정하는 기기(latest)와 떠날 때 넘기기', () => {
  let st = shareEmpty();
  st = shareJoin(st, { key: 'A', clientId: 'pc', cols: 120, rows: 40, now: 1 });
  assert.equal(st.owner, 'A');
  st = shareJoin(st, { key: 'B', clientId: 'lap', cols: 80, rows: 24, now: 2 });
  assert.equal(st.owner, 'A', '붙기만 해서는 크기를 가져가지 않는다');
  assert.deepEqual(shareSize(st), { cols: 120, rows: 40 });
  st = shareActive(st, 'B', 3);
  assert.equal(st.owner, 'B');
  assert.deepEqual(shareSize(st), { cols: 80, rows: 24 });
  st = shareWant(st, 'B', 90, 30);
  assert.deepEqual(shareSize(st), { cols: 90, rows: 30 });
  st = shareWant(st, 'A', 130, 42); // 크기를 갖지 않은 쪽의 바람은 패널 크기를 바꾸지 않는다
  assert.deepEqual(shareSize(st), { cols: 90, rows: 30 });
  assert.deepEqual(shareOwnerView(st), { clientId: 'lap', name: null, cols: 90, rows: 30 });
  st = shareLeave(st, 'B');
  assert.equal(st.owner, 'A');
  assert.deepEqual(shareSize(st), { cols: 130, rows: 42 });
  st = shareLeave(st, 'A');
  assert.equal(st.owner, null);
  assert.equal(shareSize(st), null);
  // 붙지 않은 키의 활성은 무시
  assert.deepEqual(shareActive(shareEmpty(), 'X', 1), shareEmpty());
});

test('P47 나눠 보내기: 남은 쪽 가운데 가장 최근에 쓴 쪽이 가져간다', () => {
  let st = shareEmpty();
  for (const [k, n] of [['A', 1], ['B', 2], ['C', 3]]) st = shareJoin(st, { key: k, cols: 100, rows: 30, now: n });
  st = shareActive(st, 'B', 10); st = shareActive(st, 'C', 20); st = shareActive(st, 'B', 5); // B가 마지막에 썼지만 시각은 C가 늦다(시계 순서대로 부른다고 가정하지 않는다)
  assert.equal(st.owner, 'B');
  st = shareLeave(st, 'B');
  assert.equal(st.owner, 'C');
});

test('P47 나눠 보내기: 새로 붙은 클라이언트는 full 프레임부터', () => {
  let st = shareJoin(shareEmpty(), { key: 'A', cols: 100, rows: 30, now: 1 });
  let r = shareFrame(st, true); st = r.st;
  assert.deepEqual(r.to, ['A']);
  st = shareJoin(st, { key: 'B', cols: 80, rows: 24, now: 2 });
  assert.equal(shareNeedsFull(st), true);
  r = shareFrame(st, false); st = r.st;
  assert.deepEqual(r.to, ['A'], 'B는 앞 화면이 없으니 변경 프레임을 받지 않는다');
  r = shareFrame(st, true); st = r.st;
  assert.deepEqual(r.to, ['A', 'B']);
  assert.equal(shareNeedsFull(st), false);
  r = shareFrame(st, false);
  assert.deepEqual(r.to, ['A', 'B']);
  // 다시 붙으면(같은 키) 다시 full을 기다린다
  st = shareJoin(st, { key: 'A', cols: 100, rows: 30, now: 3 });
  assert.deepEqual(shareFrame(st, false).to, ['B']);
});

// 가짜 herdr 제어기: resize하면 그 크기로 full 프레임을 낸다(P47 실험: 같은 크기여도 full)
class FakeCtl extends EventEmitter {
  constructor(pid, cols, rows) { super(); this.pid = pid; this.exited = null; this.cols = cols; this.rows = rows; this.inputs = []; this.resizes = []; this.seq = 0; setImmediate(() => this.frame(true)); }
  frame(full, text = '.') { this.emit('frame', { seq: ++this.seq, full, width: this.cols, height: this.rows, bytes: Buffer.from(text).toString('base64') }); }
  input(t) { this.inputs.push(t); }
  resize(c, r) { this.cols = c; this.rows = r; this.resizes.push([c, r]); this.frame(true); }
  close() { this.exited = 0; this.emit('exit', 0); }
}
const fakeClient = (clientId, name) => { const ev = []; return { clientId, name, kind: 'desktop', ev, sendEvent: (e, d) => ev.push([e, d]) }; };
const tick = () => new Promise((r) => setImmediate(r));

test('P47 중계: 두 클라이언트가 뺏기 없이 같은 패널을 받고, 크기는 마지막에 쓴 쪽', async () => {
  const ctls = [];
  const adapter = { openController: (pane, c, r) => { const x = new FakeCtl(100 + ctls.length, c, r); ctls.push(x); return x; } };
  const inputs = [];
  let now = 1000;
  const relay = new TerminalRelay({ adapter, onInput: (sid, d, c) => inputs.push([sid, d, c && c.clientId]), now: () => now });
  const A = fakeClient('pc', 'PC'), B = fakeClient('lap', 'Laptop');
  const s = { sessionId: 's1', paneId: 'w1:p1' };
  const ra = relay.attach(s, 120, 40, A);
  assert.equal(ra.ownerIsMe, true);
  await tick();
  const rb = relay.attach(s, 80, 24, B);
  assert.equal(ctls.length, 1, '제어기는 패널마다 하나');
  assert.equal(rb.controllerPid, ra.controllerPid);
  assert.equal(rb.ownerIsMe, false);
  assert.deepEqual([rb.cols, rb.rows], [120, 40], '패널 크기는 크기를 가진 A의 것');
  assert.deepEqual(ctls[0].resizes, [[120, 40]], 'B를 위해 같은 크기로 full 프레임을 부른다');
  const frames = (c) => c.ev.filter(([e]) => e === 'terminal.frame').map(([, d]) => d);
  assert.equal(frames(B).length, 1); assert.equal(frames(B)[0].full, true);
  ctls[0].frame(false, 'x');
  assert.equal(frames(A).length, 3); assert.equal(frames(B).length, 2, '둘 다 계속 받는다');
  // B가 친다 → B가 크기를 가져가고, A에게 "다른 기기가 입력" 알림
  now = 2000;
  relay.input('s1', 'hi', B);
  assert.deepEqual(ctls[0].inputs, ['hi']);
  assert.deepEqual(inputs, [['s1', 'hi', 'lap']]);
  assert.deepEqual(ctls[0].resizes.at(-1), [80, 24]);
  const owner = (c) => c.ev.filter(([e]) => e === 'terminal.owner').map(([, d]) => d).at(-1);
  assert.equal(owner(A).owner, 'lap'); assert.equal(owner(A).ownerIsMe, false); assert.equal(owner(B).ownerIsMe, true);
  assert.deepEqual(A.ev.filter(([e]) => e === 'terminal.input_by').map(([, d]) => d.name), ['Laptop']);
  assert.equal(B.ev.filter(([e]) => e === 'terminal.input_by').length, 0);
  relay.input('s1', 'x', B); // 1초 안에 다시 쳐도 알림은 한 번
  assert.equal(A.ev.filter(([e]) => e === 'terminal.input_by').length, 1);
  // A가 초점을 주면 A가 가져간다
  relay.focus('s1', A);
  assert.deepEqual(ctls[0].resizes.at(-1), [120, 40]);
  // 크기를 가진 A가 떠나면 B가 가져가고, 제어기는 남는다
  relay.detachClient(A);
  assert.deepEqual(ctls[0].resizes.at(-1), [80, 24]);
  assert.equal(ctls[0].exited, null);
  assert.equal(owner(B).ownerIsMe, true);
  // 붙지 않은 클라이언트는 칠 수 없다
  assert.throws(() => relay.input('s1', 'no', A), /not attached/);
  // 마지막이 떠나면 제어기를 놓는다
  relay.detach('s1', B);
  assert.equal(ctls[0].exited, 0);
  assert.equal(relay.stats().length, 0);
});

test('P47 중계: 제어기가 끝나면 붙은 클라이언트 모두에게 알린다', async () => {
  const ctls = [];
  const relay = new TerminalRelay({ adapter: { openController: (p, c, r) => { const x = new FakeCtl(7, c, r); ctls.push(x); return x; } }, onInput: () => {} });
  const A = fakeClient('a1234', 'A'), B = fakeClient('b1234', 'B');
  const s = { sessionId: 's2', paneId: 'w1:p2' };
  relay.attach(s, 100, 30, A); relay.attach(s, 100, 30, B);
  ctls[0].emit('record', { type: 'terminal.closed', reason: 'terminal attach taken over' });
  ctls[0].close();
  for (const c of [A, B]) assert.deepEqual(c.ev.filter(([e]) => e === 'terminal.detached').map(([, d]) => d.reason), ['takeover']);
  // 끝난 제어기 위에 다시 붙으면 새 제어기
  relay.attach(s, 100, 30, A);
  assert.equal(ctls.length, 2);
});

test('P47 붙은 클라이언트: 바뀐 때만 알리고 알림 받을 클라이언트를 함께 보낸다', () => {
  let now = 10_000;
  const sent = [];
  const api = { clients: new Set(), broadcast: (e, d) => sent.push([e, d]) };
  const peers = new Peers({ api, now: () => now });
  try {
    const A = { clientId: 'desk1', name: 'PC', kind: 'desktop', connectedAt: 1, lastInputAt: null };
    const B = { clientId: 'web1', name: 'Laptop', kind: 'web', connectedAt: 2, lastInputAt: null };
    api.clients.add(A); peers.opened();
    api.clients.add(B); peers.opened();
    assert.equal(sent.length, 2);
    assert.equal(sent.at(-1)[1].notify, 'desk1');
    peers.touch(B);
    assert.equal(sent.at(-1)[1].notify, 'web1');
    const n = sent.length;
    now += 1000; peers.touch(B); // 알림 받을 쪽이 그대로면 보내지 않는다
    assert.equal(sent.length, n);
    now += ACTIVE_MS + 1; peers.publish(); // 활성이 끝나면 PC로 돌아온다
    assert.equal(sent.at(-1)[1].notify, 'desk1');
    api.clients.delete(A); peers.closed();
    assert.deepEqual(sent.at(-1)[1].clients.map((c) => c.clientId), ['web1']);
  } finally { peers.stop(); }
});

test('P47 지연 프록시: 보낼 시각은 지연 ± 흔들림이고 순서를 지킨다', () => {
  assert.equal(deliverAt({ now: 1000, delay: 100 }), 1100);
  assert.equal(deliverAt({ now: 1000, delay: 100, jitter: 20, rand: 0 }), 1080);
  assert.equal(deliverAt({ now: 1000, delay: 100, jitter: 20, rand: 1 }), 1120);
  assert.equal(deliverAt({ now: 1000, prev: 1150, delay: 100 }), 1150, '앞 조각보다 먼저 보내지 않는다');
  assert.equal(deliverAt({ now: 1000, delay: 5, jitter: 50, rand: 0 }), 1000, '음수 지연은 0');
  const r1 = seeded(7), r2 = seeded(7);
  const a = [r1(), r1(), r1()], b = [r2(), r2(), r2()];
  assert.deepEqual(a, b);
  assert.ok(a.every((x) => x >= 0 && x < 1));
});

test('P47 지연 프록시: 127.0.0.1에서 받아 넘기고 지연을 넣는다', async () => {
  const echo = net.createServer((s) => s.on('data', (d) => s.write(d)));
  await new Promise((r) => echo.listen(0, '127.0.0.1', r));
  const p = startDelayProxy({ listen: 0, target: echo.address().port, delay: 60 });
  const port = await p.ready;
  try {
    const rtt = await new Promise((res, rej) => {
      const c = net.connect(port, '127.0.0.1', () => { const t0 = Date.now(); c.once('data', (d) => { res({ ms: Date.now() - t0, text: String(d) }); c.destroy(); }); c.write('ping'); });
      c.on('error', rej);
    });
    assert.equal(rtt.text, 'ping');
    assert.ok(rtt.ms >= 110, `왕복 ${rtt.ms}ms는 두 방향 지연(120ms)에 가깝다`);
  } finally { await p.close(); echo.close(); }
});
