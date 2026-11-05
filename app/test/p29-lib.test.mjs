// P29 창 단위 시험: 공개 이슈 #1 버그 14~16번(api.js 연결 세대와 CONNECTING 기한, pickAttached의 앞세울 노드)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickAttached } from '../src/renderer/lib/faces.js';

const tick = () => new Promise((r) => setImmediate(r));
const API_URL = new URL('../src/renderer/api.js', import.meta.url).href;

// 화면 api.js: window, location, WebSocket을 가짜로 둔다
class FakeWS { static OPEN = 1; constructor(url) { this.url = url; this.readyState = 0; FakeWS.made.push(this); } send() {} close() {} }
FakeWS.made = [];
async function loadApi() {
  globalThis.location = { search: '' };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.WebSocket = FakeWS;
  return (await import(API_URL + '?' + Math.random())).Api;
}

test('14 늦게 끝난 옛 backend 조회가 새 연결을 덮지 않는다', async () => {
  const Api = await loadApi();
  const pending = [];
  globalThis.window = { mt: { backend: () => new Promise((res) => pending.push(res)) } };
  FakeWS.made = [];
  const api = new Api();
  api.connect(); api.connect();
  pending[1]({ port: 2, token: 'new' }); await tick();
  pending[0]({ port: 1, token: 'old' }); await tick();
  try { assert.equal(api.info.port, 2, `소켓 주소: ${FakeWS.made.map((w) => w.url.match(/:(\d+)\//)[1]).join(', ')}`); }
  finally { api.gen++; clearTimeout(api.openTimer); clearTimeout(api.retryTimer); } // 열리지 않는 가짜 소켓의 기한 타이머가 시험 뒤에 돌지 않게
});

test('15 CONNECTING에 멈춘 화면 소켓은 기한 뒤 다시 붙는다', async (t) => {
  const Api = await loadApi();
  let calls = 0;
  globalThis.window = { mt: { backend: async () => { calls++; return { port: 1, token: 'x' }; } } };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const api = new Api();
  await api.connect();
  // Node의 가짜 시계는 tick 한 번 안에서 새로 건 타이머를 돌리지 않는다. 1초씩 60번 나눠 간다(기한 → retry → connect가 이어진다)
  for (let i = 0; i < 60; i++) { t.mock.timers.tick(1000); await tick(); }
  assert.ok(calls >= 2, `60초 동안 backend 조회 ${calls}번`);
  api.gen++; clearTimeout(api.openTimer); clearTimeout(api.retryTimer); // 시험 뒤 남은 연결 시도를 끊는다
});

test('16 상한보다 많은 터미널이 보일 때 고른 노드도 터미널을 받는다', () => {
  // 3×3 격자 9개(가까이 얼굴), 상한 8. 빠지는 노드를 사용자가 골랐다고 친다
  const nodes = []; for (let i = 0; i < 9; i++) nodes.push({ id: `n${i}`, x: (i % 3) * 400, y: Math.floor(i / 3) * 300, w: 380, h: 280 });
  const vp = { x: 0, y: 0, zoom: 1 }, screen = { width: 1180, height: 880 };
  const out = nodes.map((n) => n.id).find((id) => !pickAttached(nodes, vp, screen, { max: 8 }).includes(id));
  const picked = pickAttached(nodes, vp, screen, { max: 8, focus: out, selected: new Set([out]) });
  assert.ok(picked.includes(out), `고른 노드 ${out}가 빠짐(pickAttached에 고른 노드를 앞세울 인자가 없고, Canvas도 넘기지 않는다)`);
});
