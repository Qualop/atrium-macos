// Real built renderer + full Backend, behind a loopback HTTPS proxy simulating
// Tailscale Serve headers. All storage and certificates are temporary; no real
// herdr, agents, Tailscale binary, user profiles, or provider configuration run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { isolatedBackend, until } from '../../../backend/test/fixtures/isolated-backend.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('full built web UI pairs and connects through synthetic HTTPS/WSS Tailscale', { timeout: 60000 }, async t => {
  execFileSync(process.execPath, [path.join(root, 'app/scripts/build.mjs')], { cwd: root, stdio: 'pipe' });
  const f = await isolatedBackend(t, { dist: path.join(root, 'app/dist') });
  const pc = await f.desktop('desktop-web-fixture'); await pc.call('events.subscribe');
  const key = path.join(f.dir, 'test.key'), cert = path.join(f.dir, 'test.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${f.hostname}`], { stdio: 'ignore' });
  let host;
  const sockets = new Set();
  const headers = req => ({ ...req.headers, host, 'tailscale-user-login': 'owner@example.com', 'x-forwarded-proto': 'https' });
  const proxy = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const upstream = http.request({ host: '127.0.0.1', port: f.port, path: req.url, method: req.method, headers: headers(req) }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  proxy.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  proxy.on('upgrade', (req, client, head) => {
    const upstream = http.request({ host: '127.0.0.1', port: f.port, path: req.url, method: 'GET', headers: headers(req) });
    upstream.on('upgrade', (reply, socket, upstreamHead) => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      client.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(reply.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      if (upstreamHead.length) client.write(upstreamHead); if (head.length) socket.write(head);
      socket.pipe(client); client.pipe(socket); client.on('error', () => socket.destroy()); socket.on('error', () => client.destroy());
    });
    upstream.on('response', reply => { client.end(`HTTP/1.1 ${reply.statusCode} Rejected\r\nConnection: close\r\n\r\n`); reply.resume(); });
    upstream.on('error', () => client.destroy()); upstream.end();
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const proxyPort = proxy.address().port; host = `${f.hostname}:${proxyPort}`;
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(r => proxy.close(r)); });
  // Make the synthetic read-only Tailscale status advertise this proxy's HTTPS port.
  const fake = path.join(f.dir, 'synthetic-tailscale.mjs'); fs.writeFileSync(fake, fs.readFileSync(fake, 'utf8').replaceAll('443', String(proxyPort)));
  await pc.call('remote.configure', { enabled: true });
  assert.equal((await pc.call('remote.status', { fresh: true })).url, `https://${host}/`);
  const session = f.seedSession();
  await pc.call('terminal.attach', { session: session.sessionId, cols: 100, rows: 30, attachmentId: 'desktop-browser-peer' });
  const browser = await chromium.launch({ channel: process.env.ATRIUM_TEST_BROWSER || 'chrome', headless: true, args: [`--host-resolver-rules=MAP ${f.hostname} 127.0.0.1`, '--no-proxy-server'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await context.newPage();
  const errors = [], failedAssets = [], apiFailures = [], wsUrls = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400 && /\.(?:js|css|woff2|png|svg|webmanifest)(?:\?|$)/.test(r.url())) failedAssets.push([r.status(), r.url()]); });
  page.on('websocket', ws => { wsUrls.push(ws.url()); ws.on('framereceived', ({ payload }) => { try { const m = JSON.parse(String(payload)); if (m.error) apiFailures.push(m.error); } catch {} }); });
  await page.goto(`https://${host}/`); await page.waitForSelector('[data-role=pair]');
  const code = await pc.call('device.code');
  await page.fill('[data-field=pair-name]', 'Full browser fixture'); await page.fill('[data-field=pair-code]', code.code); await page.click('[data-action=pair-submit]');
  await page.waitForFunction(() => window.__mt?.getState().boardLoaded, null, { timeout: 15000 });
  await page.waitForFunction(() => {
    const term = window.__mt?.terms.get('fixture-session');
    return term && !term.options.disableStdin && term.buffer.active.getLine(term.buffer.active.baseY)?.translateToString(true).includes('isolated terminal');
  }, null, { timeout: 15000 });
  assert.equal(f.controllers.length, 1, 'desktop and real browser share one controller');
  assert.equal(f.b.relay.stats()[0].clients, 2);
  await page.evaluate(() => window.__mt.terms.get('fixture-session').focus());
  await page.keyboard.type('browser-input');
  assert.equal(f.controllers[0].inputs.join(''), 'browser-input', 'real xterm sends input through WSS and Backend handlers');
  const generation = await page.evaluate(() => window.__mt.api.generation);
  const oldAttachment = [...f.b.relay.attached.values()][0].attachments;
  const oldIds = [...oldAttachment.values()];
  for (const c of f.b.api.clients) if (c.auth.kind === 'device') c.ws.terminate();
  await page.waitForFunction(generation => {
    const app = window.__mt;
    return app.api.generation > generation && app.api.status === 'open' && app.terms.get('fixture-session') && !app.terms.get('fixture-session').options.disableStdin;
  }, generation, { timeout: 15000 });
  await until(() => f.b.relay.stats()[0]?.clients === 2);
  assert.equal(f.controllers.length, 1, 'reconnect keeps the desktop controller alive');
  const reattached = f.b.relay.attached.get(session.sessionId);
  assert.ok([...reattached.attachments.values()].some(id => !oldIds.includes(id)), 'reconnected browser has a fresh attachment generation');
  assert.ok(wsUrls.some(u => u.startsWith(`wss://${host}/api?device=`)), 'CSP permits same-origin WSS');
  assert.ok(f.b.api.clients.size >= 2);
  const assets = await page.evaluate(async () => {
    const manifest = await (await fetch('assets/pwa/manifest.webmanifest')).json();
    const paths = ['renderer.js', 'renderer.css', 'assets/brand/atrium-icon.svg', ...manifest.icons.map(i => 'assets/pwa/' + i.src)];
    return { manifest, responses: await Promise.all(paths.map(async p => { const r = await fetch(p); return { path: p, status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }; })) };
  });
  assert.equal(assets.manifest.display, 'standalone');
  for (const asset of assets.responses) { assert.equal(asset.status, 200, asset.path); assert.ok(asset.bytes > 0, asset.path); }
  for (const icon of assets.responses.filter(a => a.path.endsWith('.png'))) assert.equal(icon.type, 'image/png');
  const fonts = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('/fonts/')).map(r => r.name)); assert.ok(fonts.length > 0, 'bundled fonts requested');
  assert.deepEqual(failedAssets, [], 'no missing browser assets');
  assert.deepEqual(errors, [], 'no runtime/module errors in built renderer');
  assert.deepEqual(apiFailures, [], 'initial board data APIs all resolve');
  const upload = await page.evaluate(async () => {
    const response = await fetch('/web/upload?name=from-browser.txt', { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('atrium.deviceToken')}`, 'content-type': 'text/plain' }, body: 'full browser upload' });
    return { status: response.status, ...(await response.json()) };
  });
  assert.equal(upload.status, 200); assert.equal(path.dirname(upload.path), path.join(f.cfg.dataDir, 'uploads')); assert.equal(fs.readFileSync(upload.path, 'utf8'), 'full browser upload');
  const devices = await pc.call('device.list'); const paired = devices.devices.find(d => d.name === 'Full browser fixture'); assert.ok(paired);
  await pc.call('device.revoke', { id: paired.id });
  await page.waitForSelector('[data-role=pair]', { timeout: 15000 });
  assert.equal((await pc.call('ping')).at > 0, true, 'desktop remains connected after browser revoke');
  assert.ok(fs.readFileSync(f.reads, 'utf8').trim().split('\n').every(s => ['status --json', 'serve status --json'].includes(s)));
  assert.deepEqual(f.unexpected, []);
});
