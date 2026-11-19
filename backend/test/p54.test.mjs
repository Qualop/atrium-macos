// P54 단위 시험: 개발용 판 CLI 오류 둘
// 1) 백엔드를 띄운 직후 `atrium backend start`가 `Cannot read properties of undefined (reading 'stats')`: 판 API가 start()가 끝나기 전 요청을 처리했다(relay 없음)
// 2) 그 사이 `atrium herdr stop --yes`가 `herdr not found`: 실행 파일을 고르기 전(herdrPath null)의 어댑터로 서버 끄기를 불렀다
// 3) 같은 판을 둘이 함께 띄우면 늦은 쪽이 EADDRINUSE로 실패했다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import WebSocket from 'ws';
import { ApiServer } from '../src/api.mjs';
import { Backend } from '../src/backend.mjs';
import { loadConfig } from '../src/config.mjs';
import { startBackend } from '../src/client.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p54-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiOn(api) {
  const srv = http.createServer((q, s) => { s.end(); });
  srv.on('upgrade', (req, sock, head) => api.handleUpgrade(req, sock, head));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api?token=t`);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  const got = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(String(raw)); got.set(m.id, m); });
  return { srv, ws, got, close: () => { ws.close(); api.close(); srv.close(); } };
}

test('판 API는 ready가 풀릴 때까지 요청을 처리하지 않고, 뜨는 동안 더한 처리기도 찾는다', async () => {
  let markReady; const ready = new Promise((r) => { markReady = r; });
  const state = { relay: null };
  const api = new ApiServer({ token: 't', ready, onClose: () => {}, handlers: { 'backend.status': () => ({ relay: state.relay.stats() }) } });
  const c = await apiOn(api);
  c.ws.send(JSON.stringify({ id: 1, method: 'backend.status', params: {} }));
  c.ws.send(JSON.stringify({ id: 2, method: 'late.added', params: {} }));
  await sleep(150);
  assert.equal(c.got.size, 0, '뜨는 중에는 답하지 않는다(전에는 relay가 없어 internal 오류)');
  state.relay = { stats: () => [] }; // start()가 끝날 때쯤 만들어진다
  api.handlers['late.added'] = () => 'ok'; // 뜨는 동안 Object.assign으로 더하는 처리기
  markReady();
  for (let i = 0; i < 50 && c.got.size < 2; i++) await sleep(20);
  assert.deepEqual(c.got.get(1).result, { relay: [] });
  assert.equal(c.got.get(2).result, 'ok', '전에는 unknown_method');
  c.close();
});

test('ready 없이 만든 판 API는 전처럼 바로 처리한다', async () => {
  const api = new ApiServer({ token: 't', onClose: () => {}, handlers: { ping: () => 'pong' } });
  const c = await apiOn(api);
  c.ws.send(JSON.stringify({ id: 1, method: 'ping', params: {} }));
  for (let i = 0; i < 50 && !c.got.size; i++) await sleep(20);
  assert.equal(c.got.get(1).result, 'pong');
  c.close();
});

test('백엔드 start()가 실패해도 ready는 풀린다(기다리던 요청이 매달리지 않는다)', async () => {
  const dir = tmp();
  const file = path.join(dir, 'not-a-dir');
  fs.writeFileSync(file, '');
  const b = new Backend({ dataDir: path.join(file, 'data'), sessionsDir: path.join(file, 'data', 's'), logDir: path.join(file, 'data', 'logs') });
  await assert.rejects(b.start());
  const r = await Promise.race([b.ready.then(() => 'ready'), sleep(1000).then(() => 'hang')]);
  assert.equal(r, 'ready');
});

// 가짜 백엔드: herdrControl만 쓴다
function fakeBackend() {
  const b = Object.create(Backend.prototype);
  const calls = [];
  b.cfg = { terminalSession: 'atrium-test-p54' };
  b.adapter = { stopServer: async () => { calls.push('stopServer'); return { stopped: true, out: '' }; }, probe: async () => ({ running: true }) };
  b.log = () => {};
  return { b, calls };
}

test('터미널 stop(P129): 확인 없이는 끄지 않고, 확인하면 어댑터의 서버를 곧바로 끈다(실행 파일 다시 찾기 없음)', async () => {
  const { b, calls } = fakeBackend();
  const c = await b.terminalControl('stop', false);
  assert.equal(c.needsConfirm, true); assert.equal(c.msg.key, 'terminalStop'); assert.deepEqual(calls, []);
  const r = await b.terminalControl('stop', true);
  assert.deepEqual(calls, ['stopServer']);
  assert.equal(r.stop.stopped, true); assert.equal(b.termStopping, false);
});

test('backend start: 같은 판의 다른 백엔드가 먼저 떠서 포트를 못 열면 그 백엔드를 쓴다', async () => {
  // 먼저 뜬 백엔드 흉내: /health에 답하는 서버. 띄운 백엔드는 이 포트를 못 열거나(EADDRINUSE) 이미 돈다(already_running)며 끝난다
  const fake = http.createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ ok: true })); });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const port = fake.address().port;
  const dir = tmp();
  const cfg = loadConfig({ argv: ['--dev'], env: { ATRIUM_HERDR_SESSION: 'atrium-test-p54', ATRIUM_PORT: String(port), ATRIUM_DATA_DIR: path.join(dir, 'data') } });
  setTimeout(() => { fs.mkdirSync(cfg.dataDir, { recursive: true }); fs.writeFileSync(cfg.backendFile, JSON.stringify({ pid: process.pid, port, token: 'x' })); }, 300);
  try {
    const r = await startBackend(cfg);
    assert.deepEqual(r, { already: true, pid: process.pid, port }, '전에는 "백엔드가 뜨지 않았다: listen EADDRINUSE"');
  } finally { fake.close(); }
});
