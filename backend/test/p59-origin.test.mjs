// P59: 기기 연결의 Origin은 요청 Host와 포트까지 같아야 한다.
// 같은 Tailscale 이름의 다른 포트(serve의 다른 항목)에서 온 페이지는 쿠키를 실어 보낼 수 있으므로 막는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { originOk } from '../src/web.mjs';

const hosts = new Set(['localhost:47879', '127.0.0.1:47879', 'pc.example.ts.net', 'pc.example.ts.net:443', 'pc.example.ts.net:10000']);
const req = (host, origin) => ({ headers: { host, ...(origin === undefined ? {} : { origin }) } });

test('same origin as the request Host passes', () => {
  assert.equal(originOk(req('pc.example.ts.net:10000', 'https://pc.example.ts.net:10000'), hosts), true);
  assert.equal(originOk(req('pc.example.ts.net', 'https://pc.example.ts.net'), hosts), true);
  assert.equal(originOk(req('localhost:47879', 'http://localhost:47879'), hosts), true);
});

test('a page on another port of the same Tailscale name is refused', () => {
  // 판은 10000, 같은 이름의 443·8443은 다른 서비스
  assert.equal(originOk(req('pc.example.ts.net:10000', 'https://pc.example.ts.net'), hosts), false);
  assert.equal(originOk(req('pc.example.ts.net:10000', 'https://pc.example.ts.net:8443'), hosts), false);
  assert.equal(originOk(req('pc.example.ts.net:10000', 'https://pc.example.ts.net:443'), hosts), false);
});

test('allowed but different host, missing or bad Origin is refused', () => {
  assert.equal(originOk(req('localhost:47879', 'http://127.0.0.1:47879'), hosts), false);
  assert.equal(originOk(req('localhost:47879', undefined), hosts), false);
  assert.equal(originOk(req('localhost:47879', 'null'), hosts), false);
  assert.equal(originOk(req('localhost:47879', 'file://'), hosts), false);
  assert.equal(originOk(req('evil.example:47879', 'http://evil.example:47879'), hosts), false);
});
