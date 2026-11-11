// 격리된 원격 회귀 시험. 예시 노드와 메모리 저장소만 쓰며 외부 푸시는 흉내 전송으로 막는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebServer } from '../src/web.mjs';
import { Pusher, pushKindOf } from '../src/web-push.mjs';
import { sessionCookie } from '../src/web-auth.mjs';
import { fakeWhois } from './fake-tailnet.mjs';
import { parseWhois } from '../src/tailscale.mjs';

const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function board(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-v04-remote-'));
  const data = new Map();
  const store = { getMeta: (k) => structuredClone(data.get(k)), setMeta: (k, v) => data.set(k, structuredClone(v)) };
  const st = { remoteAccess: true, remotePasskey: false };
  const ts = { hosts: () => ['pc.example.ts.net'], selfLogin: () => 'me@example.com', start() {}, stop() {}, whois: async () => ({ ok: true, who: parseWhois(fakeWhois('100.64.0.2')) }) };
  const web = new WebServer({ cfg: { port: 47899, profile: 'dev', dataDir: dir }, store, tailscale: ts, settings: () => st });
  t.after(() => { web.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const req = (cookie) => ({ url: '/api', headers: { host: 'pc.example.ts.net', origin: 'https://pc.example.ts.net', 'tailscale-user-login': 'me@example.com', 'x-forwarded-for': '100.64.0.2', cookie }, socket: { remoteAddress: '127.0.0.1' } });
  return { web, st, ts, store, req };
}
function subscription() {
  const key = crypto.createECDH('prime256v1'); key.generateKeys();
  return { endpoint: 'https://web.push.apple.com/synthetic', keys: { p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
}

test('remote opt-in defaults off, and disabling invalidates grants and challenges before re-enable', (t) => {
  const { web } = board(t);
  assert.equal(web.remoteEnabled(), false); assert.equal(web.accepting(), false);
  web.configure({ enabled: true });
  const grant = web.auth.grants.issue({ name: 'fixture', origin: 'https://pc.example.ts.net' });
  web.auth.challenges.issue({ kind: 'login' });
  web.pairing.newCode(); web.pairing.request({ name: 'pending', ip: 'synthetic' });
  web.configure({ enabled: false }); web.configure({ enabled: true });
  assert.equal(web.auth.grants.peek(grant.grant), null);
  assert.equal(web.auth.challenges.map.size, 0);
  assert.equal(web.pairing.requests.size, 0); assert.equal(web.pairing.currentCode(), null);
});

test('revocation during asynchronous whois cannot authorize a socket with an old cookie', async (t) => {
  const { web, ts, req } = board(t); web.configure({ enabled: true });
  const device = web.devices.add({ name: 'fixture', via: 'code', extra: { pairOnly: true, origin: 'tailscale', tsNode: { id: 'nFAKE0002CNTRL', login: 'me@example.com' } } });
  const session = web.auth.sessions.create(device.id);
  const cookie = sessionCookie({ port: 47899, id: session.id, secure: true, maxAgeSec: 43200 }).split(';')[0];
  const gate = defer(); ts.whois = () => gate.promise;
  const pending = web.authorize(req(cookie), 'fixture-local-token');
  web.revoke(device.id);
  gate.resolve({ ok: true, who: parseWhois(fakeWhois('100.64.0.2')) });
  assert.equal(await pending, null);
});

test('push test honors the disabled remote gate without creating VAPID credentials or sending', async () => {
  let sends = 0;
  const p = new Pusher({ store: null, enabled: () => false, transport: async () => { sends++; return { status: 201 }; }, timers: false });
  p.subscribe('device-a', subscription(), 'en');
  assert.deepEqual(await p.test('device-a'), { ok: false, reason: 'blocked' });
  assert.equal(p._keys, null); assert.equal(sends, 0); p.stop();
});

test('late push response cannot remove a new subscription using the same service endpoint', async () => {
  const gate = defer(); let sends = 0;
  const p = new Pusher({ store: null, transport: async () => { sends++; return gate.promise; }, timers: false });
  p.subscribe('device-a', subscription(), 'en');
  const pending = p.test('device-a');
  const replacement = subscription(); p.subscribe('device-a', replacement, 'ko');
  gate.resolve({ status: 410 });
  assert.deepEqual(await pending, { ok: false, reason: 'changed' });
  assert.equal(p.status('device-a').on, true); assert.equal(p.rec('device-a').p256dh, replacement.keys.p256dh); assert.equal(sends, 1); p.stop();
});

test('notifications classify each managed provider without assuming Claude', () => {
  for (const kind of ['claude', 'codex', 'gemini', 'agy']) {
    assert.equal(pushKindOf({ sessionId: kind, kind, state: 'waiting' }, 'working'), 'need');
    assert.equal(pushKindOf({ sessionId: kind, kind, state: 'error' }, 'working'), 'error');
  }
  assert.equal(pushKindOf({ kind: 'shell', state: 'waiting' }, 'working'), null);
});

test('macOS Tailscale discovery prefers PATH, then installed app, and honors explicit disable', async () => {
  const { tailscaleBin, runTailscale } = await import('../src/tailscale.mjs');
  const app = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  const opts = { env: '', platform: 'darwin', pathEnv: '/fixture/bin:/usr/bin', userHome: '/fixture/home' };
  assert.equal(tailscaleBin({ ...opts, exists: (p) => p === '/fixture/bin/tailscale' || p === app }), '/fixture/bin/tailscale');
  assert.equal(tailscaleBin({ ...opts, exists: (p) => p === app }), app);
  assert.equal(tailscaleBin({ ...opts, exists: (p) => p === '/fixture/home/Applications/Tailscale.app/Contents/MacOS/Tailscale' }), '/fixture/home/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  assert.equal(tailscaleBin({ ...opts, env: 'none', exists: () => true }), null);
  assert.equal(tailscaleBin({ ...opts, env: '/explicit/cli', exists: () => false }), '/explicit/cli');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-v04-tailscale-cli-'));
  try {
    const fake = path.join(dir, 'cli.mjs');
    fs.writeFileSync(fake, 'console.log(JSON.stringify({cli:process.env.TAILSCALE_BE_CLI,args:process.argv.slice(2)}));');
    assert.deepEqual(JSON.parse(await runTailscale(fake, ['status', '--json'])), { cli: '1', args: ['status', '--json'] });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
