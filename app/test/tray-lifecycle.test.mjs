import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let tmp, startTray;
before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-tray-test-'));
  const outfile = path.join(tmp, 'tray.mjs');
  await build({ entryPoints: [fileURLToPath(new URL('../src/main/tray.mjs', import.meta.url))], bundle: true, platform: 'node', format: 'esm', outfile,
    plugins: [{ name: 'isolated-main-dependencies', setup(b) {
      b.onResolve({ filter: /^electron$|backend\/src\/client\.mjs$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: p }) => ({ contents: p === 'electron' ? `
        export class Tray { on() {} setImage() {} setToolTip() {} setContextMenu() {} destroy() {} }
        export const Menu = { buildFromTemplate: x => x };
        const image = () => ({ isEmpty: () => true, addRepresentation() {} });
        export const nativeImage = { createEmpty: image, createFromPath: image, createFromBuffer: image };
        export class Notification { static isSupported() { return true; } on() {} show() { globalThis.__trayTest.notifications++; } }
      ` : `
        export const backendInfo = () => ({ port: 1 });
        export const health = async () => true;
        export class ApiClient { constructor() { return globalThis.__trayTest.makeClient(); } }
      ` }));
    } }],
  });
  ({ startTray } = await import(pathToFileURL(outfile)));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function fixture({ opening = Promise.resolve(), failSubscribe = false } = {}) {
  const clients = [];
  globalThis.__trayTest = { notifications: 0, makeClient() {
    const c = { ws: new EventEmitter(), closed: false, open: () => opening, on(fn) { this.event = fn; }, close() { if (!this.closed) { this.closed = true; this.ws.emit('close'); } },
      async call(method) {
        if (method === 'events.subscribe') { if (failSubscribe) throw new Error('fixture subscribe failure'); return { sessions: [] }; }
        if (method === 'settings.get') return { settings: { tray: true, language: 'en' } };
        return {};
      },
    }; clients.push(c); return c;
  } };
  const tray = startTray({ cfg: { profile: 'dev' }, log() {}, hasWindow: () => false, showNode() {}, quit() {} });
  return { tray, clients };
}

test('tray closes a client when subscribing fails, with only one retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { tray, clients } = fixture({ failSubscribe: true }); t.after(() => tray.stop());
  await flush();
  assert.equal(clients[0].closed, true);
  t.mock.timers.tick(2000); await flush();
  assert.equal(clients.length, 2);
});

test('stopping the tray while connecting cannot resurrect a connected client', async (t) => {
  let resolve; const opening = new Promise((r) => { resolve = r; });
  const { tray, clients } = fixture({ opening }); t.after(() => tray.stop());
  await flush(); tray.stop(); resolve(); await flush();
  assert.equal(tray.state().connected, false);
  assert.equal(clients[0].closed, true);
});

test('stopping the tray cancels queued notifications', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { tray, clients } = fixture(); t.after(() => tray.stop());
  await flush();
  clients[0].event('session.updated', { sessionId: 'a', name: 'fixture', state: 'waiting', ask: { since: 1 } });
  tray.stop(); t.mock.timers.tick(1300);
  assert.equal(globalThis.__trayTest.notifications, 0);
});
