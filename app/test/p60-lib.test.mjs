// P60 단위 시험: 패스키를 무엇으로 확인할지 기억(비밀 아님)과 서버에 보내는 via, 연결된 기기 탭의 순수 함수(기기 가르기, 지금 붙은 기기, 진단 문제, 패스키 종류 글)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { savedVia, saveVia, PASSKEY_VIA_KEY, registerPasskey, loginPasskey } from '../src/renderer/lib/passkey.js';
import { groupDevices, connectedIds, diagProblems, kindKey, isRepair } from '../src/renderer/lib/devices-tab.js';

const mem = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('고른 인증기 기억: phone·device만, 모르는 값은 지운다, 저장소가 막혀도 던지지 않는다', () => {
  const st = mem();
  assert.equal(savedVia(st), null);
  saveVia('phone', st); assert.equal(savedVia(st), 'phone'); assert.equal(st.m.get(PASSKEY_VIA_KEY), 'phone');
  saveVia('device', st); assert.equal(savedVia(st), 'device');
  saveVia('nope', st); assert.equal(savedVia(st), null); assert.equal(st.m.size, 0);
  st.m.set(PASSKEY_VIA_KEY, '<x>'); assert.equal(savedVia(st), null);
  assert.equal(savedVia({ getItem: () => { throw new Error('blocked'); } }), null);
  assert.doesNotThrow(() => saveVia('phone', { setItem: () => { throw new Error('blocked'); } }));
});

test('등록·로그인 선택 사항 요청에 via를 싣는다(고르지 않았으면 싣지 않는다)', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: false, status: 400, json: async () => ({ error: { code: 'stop', message: 'stop' } }) }; };
  try {
    await assert.rejects(registerPasskey('g', {}, 'phone'));
    await assert.rejects(registerPasskey('g', {}, null));
    await assert.rejects(loginPasskey('c', {}, 'device'));
    await assert.rejects(loginPasskey('c', {}, 'bogus'));
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(sent.map((x) => [x.url, x.body.via]), [['/web/passkey/register/options', 'phone'], ['/web/passkey/register/options', undefined], ['/web/passkey/login/options', 'device'], ['/web/passkey/login/options', undefined]]);
  assert.ok(!('via' in sent[1].body) && !('via' in sent[3].body));
});

test('기기 가르기: 다시 짝 맺기 필요는 따로, 지금 붙은 기기 먼저, 그다음 마지막 접속이 늦은 차례', () => {
  const devs = [
    { id: 'a', tsNode: { id: 'n1' }, origin: 'tailscale', lastSeenAt: 10 },
    { id: 'b', tsNode: { id: 'n2' }, origin: 'tailscale', lastSeenAt: 30 },
    { id: 'c', origin: 'local', lastSeenAt: 20 },
    { id: 'old', needsRepair: true, lastSeenAt: 99 },
    { id: 'unbound', origin: 'tailscale', lastSeenAt: 5 },
  ];
  const g = groupDevices(devs, new Set(['a']));
  assert.deepEqual(g.ok.map((d) => d.id), ['a', 'b', 'c']);
  assert.deepEqual(g.repair.map((d) => d.id), ['old', 'unbound']);
  assert.equal(isRepair({ origin: 'local' }), false);
  assert.deepEqual(groupDevices(null), { ok: [], repair: [] });
});

test('지금 붙은 기기: 짝 맺은 기기로 붙은 웹 클라이언트만', () => {
  const peers = { me: 'x', clients: [{ clientId: 'x', kind: 'desktop' }, { clientId: 'w1', kind: 'web', deviceId: 'd1' }, { clientId: 'w2', kind: 'web', deviceId: 'd1' }, { clientId: 'w3', kind: 'web' }, { clientId: 'c', kind: 'cli', deviceId: 'zz' }] };
  assert.deepEqual([...connectedIds(peers)], ['d1']);
  assert.equal(connectedIds(null).size, 0);
});

test('진단 문제: 안 됨 먼저, 주의 다음, 괜찮음·건너뜀은 빼고', () => {
  const checks = [{ id: 'installed', level: 'ok' }, { id: 'serve', level: 'warn' }, { id: 'https', level: 'fail' }, { id: 'built', level: 'skip' }];
  assert.deepEqual(diagProblems(checks).map((c) => c.id), ['https', 'serve']);
  assert.deepEqual(diagProblems(undefined), []);
});

test('패스키 종류 글 열쇠', () => {
  assert.equal(kindKey({ kind: 'phone' }), 'devTab.kind_phone');
  assert.equal(kindKey({ kind: 'device' }), 'devTab.kind_device');
  assert.equal(kindKey({ kind: 'key' }), 'devTab.kind_key');
  assert.equal(kindKey({ kind: 'unknown' }), 'devTab.kind_unknown');
  assert.equal(kindKey({}), 'devTab.kind_unknown');
  assert.equal(kindKey(null), null);
});

test('설정 창: 탭 내용만 스크롤하고 배율 칸에 스핀 단추가 없다(스타일 규칙)', () => {
  const css = fs.readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
  const p60 = css.slice(css.indexOf('/* P60: 설정 창 크기와 스크롤'));
  assert.match(p60, /\.mt-set-body \{ overflow-y: auto;/);
  assert.match(p60, /::-webkit-inner-spin-button[^{]*\{[^}]*appearance: none/);
  assert.match(p60, /prefers-reduced-motion: reduce/);
  const src = fs.readFileSync(new URL('../src/renderer/Settings.jsx', import.meta.url), 'utf8');
  assert.match(src, /mt-scale-num mt-nospin/);
});
