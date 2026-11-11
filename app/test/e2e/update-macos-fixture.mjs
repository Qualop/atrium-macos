// Render the real updater component with synthetic API/state modules. This
// never starts Atrium, herdr, or a user profile. Browser context is ephemeral.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-updater-ui-'));
const renderer = path.join(appRoot, 'src/renderer');
const output = process.env.ATRIUM_UPDATE_UI_OUTPUT || path.join(scratch, 'screenshots');
fs.mkdirSync(output, { recursive: true });
const stubs = {
  './api.js': "export const api = {info:{appVersion:'0.4.0'},call:async(method,params)=>{window.__calls.push([method,params]);return {ok:true};}};",
  './store.js': 'export const toast = () => {};',
  './web.js': 'export const isWeb = false;',
  './Settings.jsx': `export const SetSub=({children})=><div className="mt-set-sub">{children}</div>;export const SetNote=({children})=><p className="mt-set-note">{children}</p>;export const SetRow=({name,hint,role,children})=><label className="mt-set-row" data-role={role}><span className="mt-set-name">{name}</span><span className="mt-set-value">{children}</span><span className="mt-set-hint">{hint}</span></label>;`,
  './update.js': `import {useSyncExternalStore} from 'react';const subs=new Set();window.__calls=[];let state={view:null,busy:false,restarting:null};window.__put=(v)=>{state={...state,...v};for(const fn of subs)fn();};export const useUpdate=select=>useSyncExternalStore(fn=>{subs.add(fn);return()=>subs.delete(fn);},()=>select(state));export const checkNow=()=>window.__calls.push(['update.check',{}]);export const applyUpdate=p=>window.__calls.push(['update.apply',{confirm:true,...p}]);`,
};
const result = await esbuild.build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{UpdateSettings}from'${renderer}/Update.jsx';import{setLanguage}from'${renderer}/lib/i18n.js';window.__language=setLanguage;createRoot(document.getElementById('root')).render(<section className="mt-modal mt-settings" style={{position:'relative',margin:'32px auto',height:'auto'}}><h2>Updates</h2><div className="mt-set-grid"><UpdateSettings settings={{updateCheck:true,updateChannel:'stable'}}/></div></section>);`, loader: 'jsx', resolveDir: appRoot }, outfile: path.join(scratch, 'fixture.js'), write: false, bundle: true, format: 'iife', jsx: 'automatic', nodePaths: [path.join(appRoot, 'node_modules')], plugins: [{ name: 'fixture-boundary', setup(build) { build.onResolve({ filter: /^\.\/(api\.js|store\.js|web\.js|Settings\.jsx|update\.js)$/ }, args => args.importer === path.join(renderer, 'Update.jsx') ? { path: args.path, namespace: 'fixture' } : null); build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx', resolveDir: appRoot })); } }] });
const script = result.outputFiles[0].text;
const css = ['tokens.css', 'styles.css'].map(f => fs.readFileSync(path.join(renderer, f), 'utf8')).join('\n');
const server = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? script : '<!doctype html><html><head><meta charset="utf-8"><title>Updater fixture</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); });
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ headless: true, ...(process.env.ATRIUM_TEST_BROWSER ? { executablePath: process.env.ATRIUM_TEST_BROWSER } : {}) }); const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' }); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.addStyleTag({ content: css });
  await page.waitForFunction(() => !!window.__put);
  const view = { current: { version: '0.4.0', installed: true }, channel: 'stable', latest: { tag: 'v0.5.0', notes: 'Synthetic release notes.', url: 'https://github.com/Qualop/atrium-macos/releases/tag/v0.5.0' }, available: true, allowed: true, manualUrl: 'https://github.com/Qualop/atrium-macos/releases', job: null };
  await page.evaluate(v => window.__put({ view: v }), view);
  await page.locator('[data-action="update-apply"]').click(); await page.locator('[data-action="update-confirm"]').click();
  assert.deepEqual(await page.evaluate(() => window.__calls.at(-1)), ['update.apply', { confirm: true, tag: 'v0.5.0' }]);
  await page.locator('[data-action="update-apply"]').click(); await page.evaluate(v => window.__put({ view: { ...v, latest: { ...v.latest, tag: 'v0.6.0' } } }), view);
  assert.equal(await page.locator('[data-action="update-confirm"]').isDisabled(), true); await page.locator('[data-action="update-cancel"]').click();
  await page.evaluate(v => window.__put({ view: { ...v, allowed: false, reason: 'source_install' } }), view); assert.match(await page.locator('[data-role="update-actions"]').innerText(), /source checkout/); assert.equal(await page.locator('[data-action="update-download"]').getAttribute('href'), view.manualUrl);
  await page.screenshot({ path: path.join(output, 'source-en.png') });
  await page.evaluate(v => { window.__language('ko'); window.__put({ view: { ...v, job: { phase: 'prepare', step: 'checksum' } } }); }, view);
  assert.match(await page.locator('[data-role="update-progress"]').innerText(), /SHA256/); assert.equal(await page.locator('[data-channel="dev"]').isDisabled(), true);
  await page.screenshot({ path: path.join(output, 'verifying-ko.png') });
  await page.setViewportSize({ width: 780, height: 800 }); await page.screenshot({ path: path.join(output, 'verifying-ko-narrow.png') });
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, checks: ['tag-bound apply', 'stale confirmation disabled', 'source route', 'Korean checksum progress', 'channel locked while preparing', 'no page errors'], screenshots: output }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(scratch, { recursive: true, force: true }); }
