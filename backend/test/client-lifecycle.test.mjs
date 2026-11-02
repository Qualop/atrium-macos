import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ApiClient } from '../src/client.mjs';

test('응답 없는 WebSocket 연결 시도는 제한 시간 안에 실패한다', async () => {
  const peers = new Set();
  const server = net.createServer((s) => { peers.add(s); s.on('error', () => {}); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const client = new ApiClient({ port: server.address().port, token: 'fixture' }, { connectTimeoutMs: 30 });
  let timer;
  try {
    const result = await Promise.race([client.open().then(() => 'open', () => 'failed'), new Promise((r) => { timer = setTimeout(() => r('hung'), 300); })]);
    assert.equal(result, 'failed');
  } finally {
    clearTimeout(timer); client.close(); for (const s of peers) s.destroy(); await new Promise((r) => server.close(r));
  }
});
