// 백엔드 끝내기와 붙잡힌 요청(2026-11-07): 하위 세션을 띄우며 기다리던 atrium child 요청 때문에 http.close가 1분 넘게 끝나지 않아
// 업데이트의 바꾸기가 옛 백엔드를 기다리다 포기했다. 기다리는 /branch 요청에는 다시 시작한다고 답하고, 남은 연결은 끊는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Branch } from '../src/branch.mjs';
import { closeHttp } from '../src/backend.mjs';

// handleHttp만 쓰는 Branch: 인증은 통과, 처리(dispatch)는 끝나지 않는다(준비를 기다리는 atrium child 흉내)
function stuckBranch() {
  const br = Object.create(Branch.prototype);
  br.b = { cfg: { herdrSession: 'atrium-test', port: 0 }, log() {} };
  br.auth = () => ({ s: { sessionId: 's1' } });
  br.dispatch = () => new Promise(() => {});
  return br;
}
function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
function post(port, pathName) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

test('끝낼 때 기다리던 /branch 요청에 다시 시작한다고 답하고(503 backend_restarting), 서버는 곧 닫힌다', async () => {
  const br = stuckBranch();
  const server = await listen((req, res) => { if (!br.handleHttp(req, res)) { res.writeHead(404); res.end(); } });
  const { port } = server.address();
  const pending = post(port, '/branch/child');
  assert.ok(await until(() => br.inflight && br.inflight.size === 1), '요청이 붙잡혀 있다');
  const t0 = Date.now();
  assert.equal(br.abortInflight(), 1);
  const r = await pending;
  assert.equal(r.status, 503);
  const j = JSON.parse(r.body);
  assert.equal(j.error.code, 'backend_restarting');
  assert.match(j.error.message, /atrium children/);
  await closeHttp(server, 500);
  assert.ok(Date.now() - t0 < 3000, `서버가 곧 닫힌다(${Date.now() - t0}ms)`);
  assert.equal(br.inflight.size, 0);
  assert.equal(br.abortInflight(), 0, '이미 답한 요청은 다시 답하지 않는다');
});

test('closeHttp: 답하지 않은 채 열린 연결이 있어도 forceMs 뒤 닫힌다', async () => {
  const server = await listen(() => {}); // 답하지 않는다
  const { port } = server.address();
  const pending = post(port, '/x').catch((e) => ({ error: e.code || e.message }));
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  await closeHttp(server, 300);
  const ms = Date.now() - t0;
  assert.ok(ms < 2000, `붙잡힌 연결이 있어도 닫힌다(${ms}ms)`);
  const r = await pending;
  assert.ok(r.error, '클라이언트는 연결이 끊겼다');
});
