import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null };
globalThis.window = { mt: { log() {} } };
globalThis.requestAnimationFrame = () => {};
const { Api } = await import('../src/renderer/api.js');
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
class Socket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; }
  close() { this.readyState = 3; this.onclose?.(); }
  send() {}
}
globalThis.WebSocket = Socket;

test('겹친 재연결에서 늦게 돌아온 옛 백엔드 주소를 무시한다', async () => {
  const a = defer(), b = defer(); let i = 0;
  window.mt.backend = () => (++i === 1 ? a.promise : b.promise);
  const api = new Api(); const old = api.connect(), current = api.connect();
  b.resolve({ port: 2, token: 'new' }); await current;
  a.resolve({ port: 1, token: 'old' }); await old;
  assert.match(api.ws.url, /:2\/api/);
  api.close?.();
});

test('WebSocket 연결이 열리지 않으면 시간 초과 후 재시도한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  window.mt.backend = async () => ({ port: 3, token: 'fixture' });
  const api = new Api({ connectTimeoutMs: 50 }); let retries = 0;
  api.retry = () => { retries++; };
  await api.connect(); t.mock.timers.tick(51);
  assert.equal(retries, 1);
  assert.notEqual(api.status, 'connecting');
  api.close?.();
});
