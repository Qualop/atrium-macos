// P74 홈 화면 웹 앱: 서비스 워커 스크립트 요청은 sw.js만 받고, sw.js와 매니페스트는 다른 화면 파일처럼 다시 확인한다(no-cache)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StaticFiles, cacheControl, swScriptOk, SW_FILE } from '../src/web.mjs';

function fakeRes() {
  const r = { status: null, headers: null, body: null };
  return { r, writeHead(s, h) { r.status = s; r.headers = h; }, end(b) { r.body = b; } };
}
const get = (files, url, headers = {}) => { const res = fakeRes(); const ok = files.serve({ method: 'GET', url, headers }, res); return { ok, ...res.r }; };

test('서비스 워커 스크립트: Service-Worker: script 요청은 sw.js만 내주고, 그 밖의 파일은 거절한다', () => {
  assert.equal(SW_FILE, 'sw.js');
  assert.equal(swScriptOk('sw.js', { 'service-worker': 'script' }), true);
  assert.equal(swScriptOk('renderer.js', { 'service-worker': 'script' }), false);
  assert.equal(swScriptOk('assets/pwa/icon-192.png', { 'service-worker': 'Script' }), false);
  assert.equal(swScriptOk('renderer.js', {}), true, '보통 요청은 그대로');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p74-'));
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("fetch",()=>{})');
    fs.writeFileSync(path.join(dir, 'renderer.js'), 'console.log(1)');
    fs.mkdirSync(path.join(dir, 'assets', 'pwa'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'pwa', 'manifest.webmanifest'), '{"name":"Atrium"}');
    const files = new StaticFiles(dir);
    const sw = get(files, '/sw.js', { 'service-worker': 'script' });
    assert.equal(sw.ok, true); assert.equal(sw.status, 200);
    assert.match(sw.headers['content-type'], /javascript/);
    assert.equal(sw.headers['cache-control'], 'no-cache', 'sw.js는 늘 다시 확인한다(새 버전)');
    assert.equal(sw.headers['service-worker-allowed'], undefined, '범위를 넓히지 않는다');
    assert.equal(get(files, '/renderer.js', { 'service-worker': 'script' }).ok, false, '다른 스크립트를 서비스 워커로 등록하지 못한다');
    assert.equal(get(files, '/renderer.js').status, 200);
    const m = get(files, '/assets/pwa/manifest.webmanifest');
    assert.equal(m.status, 200);
    assert.match(m.headers['content-type'], /application\/manifest\+json/);
    assert.equal(cacheControl('sw.js'), 'no-cache');
    assert.equal(cacheControl('assets/pwa/manifest.webmanifest'), 'no-cache');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
