// P113 창 시험: 창을 닫고(트레이 상주) 다시 열어도 판이 그대로이고, 닫을 때 GPU 프로세스 메모리를 돌려준다.
// - 창의 X 단추와 같은 닫기(BrowserWindow.close)는 창을 숨기고 페이지를 내린 뒤 메모리 압박을 알리고 창을 없앤다(main gpu-purge.mjs). 앱은 트레이에 남는다.
// - 다시 연 창(트레이 '열기')의 가까이·중간·멀리 얼굴, 터미널 선명하게 다시 그리기(캔버스 장치 픽셀), 일하는 노드 둘레(.mt-node-run, 가까이 얼굴이 아닐 때만)가 닫기 전과 같다.
// - 창이 닫힌 동안 트레이 메뉴와 트레이 알림(내 차례)이 그대로 돈다. 다시 열기 시간을 적는다.
// 판: herdr 세션 atrium-dev-p113, 포트 47899, backend/.dev(백엔드를 CLI로 먼저 띄운다). 시험 폴더는 새로 만든 C:\Workspace\mtask-p113-e2e(git init 하지 않는다).
// 세션: 셸 e01~e08(가까이 얼굴 터미널 8개), haiku eh1(일하는 둘레와 권한 질문). 끝에 모두 끈다.
// 사용: MT_E2E_OUT=p113 node test/e2e/p113-reopen.mjs   (다른 판: MT_E2E_HERDR_SESSION, MT_E2E_PORT, MT_E2E_DEV, MT_E2E_DIR)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, e2eBoard } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

const B = e2eBoard({ session: 'atrium-dev-p113', port: '47899', dev: path.join(REPO, 'backend', '.dev'), dir: 'C:\\Workspace\\mtask-p113-e2e' });
if (process.env.MT_E2E_OUT !== 'p113') throw new Error('MT_E2E_OUT=p113를 명령줄에서 준다');
const DEV = B.dev;
const DIR = B.dir;
const PROJECT = path.join(os.homedir(), '.claude', 'projects', DIR.replace(/[^A-Za-z0-9]/g, '-'));
const ENV = {
  ATRIUM_HERDR_SESSION: B.session, ATRIUM_PORT: B.port,
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: PROJECT, ATRIUM_CLAUDE_DESKTOP: 'none',
};
assertTestBoard(ENV, { root: DEV });
fs.mkdirSync(DIR, { recursive: true });

const log = logger('p113-reopen');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ATRIUM_|MTASK_|HERDR_|CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env });
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const SHELLS = ['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'e08'];
const AGENT = 'eh1';
const NEAR = '^e0[1-8]$';

const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
const tray = () => app.evaluate(() => global.__mtTray.state());
const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const gpuMB = () => app.evaluate(({ app: a }) => { const g = a.getAppMetrics().find((m) => m.type === 'GPU'); return g ? Math.round(g.memory.privateBytes / 1024) : null; });
const appLog = path.join(ENV.ATRIUM_DATA_DIR, 'logs', 'app-main.log');
const purgeLines = () => { try { return fs.readFileSync(appLog, 'utf8').split('\n').filter((l) => l.includes('gpu purge')); } catch { return []; } };
const sessionOf = (page, n) => page.evaluate((nn) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === nn); return s ? { id: s.sessionId, state: s.state } : null; }, n);

// 고른 노드의 가운데에 배율 zoom으로(zoom이 없으면 다 보이게 맞춘 배율, 가까이 얼굴이 되게 최소 0.26)
const view = (page, src, zoom = null) => page.evaluate(([s, z]) => {
  const re = new RegExp(s); const st = window.__mt.getState(); const el = document.querySelector('.mt-canvas');
  const ns = [...st.sessions.values()].filter((x) => re.test(x.name) && st.nodes.has(x.sessionId)).map((x) => st.nodes.get(x.sessionId));
  const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y)), x1 = Math.max(...ns.map((n) => n.x + n.w)), y1 = Math.max(...ns.map((n) => n.y + n.h));
  const zz = z || Math.max(0.26, Math.min(0.6, Math.min(el.clientWidth / (x1 - x0), el.clientHeight / (y1 - y0)) * 0.97));
  st.setViewport({ x: Math.round(el.clientWidth / 2 - ((x0 + x1) / 2) * zz), y: Math.round(el.clientHeight / 2 - ((y0 + y1) / 2) * zz), zoom: zz });
  return zz;
}, [src, zoom]);
// 얼굴별 노드 수, 붙은 터미널, 터미널 캔버스 장치 픽셀(선명하게 다시 그린 해상도), 일하는 둘레
const look = (page) => page.evaluate((agent) => {
  const faces = {}; for (const n of document.querySelectorAll('.mt-node[data-face]')) faces[n.dataset.face] = (faces[n.dataset.face] || 0) + 1;
  const canv = [...document.querySelectorAll('.mt-node .xterm canvas')].map((c) => `${c.width}x${c.height}`).sort();
  const a = document.querySelector(`.mt-node[data-name="${agent}"]`);
  return { faces, stats: window.__mt.termStats(), canvases: canv, ring: !!(a && (a.closest('.mt-node-run') || a.querySelector('.mt-node-run') || a.parentElement.querySelector('.mt-node-run'))), runCount: document.querySelectorAll('.mt-node-run').length };
}, AGENT);
// 두 PNG의 다른 픽셀 비율(창 안에서 캔버스로 견준다. 채널 차이 24 넘으면 다름)
const diff = (page, a, b) => page.evaluate(async ([x, y]) => {
  const img = (d) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = `data:image/png;base64,${d}`; });
  const [i1, i2] = await Promise.all([img(x), img(y)]);
  if (i1.width !== i2.width || i1.height !== i2.height) return 1;
  const px = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
  const d1 = px(i1), d2 = px(i2); let n = 0;
  for (let k = 0; k < d1.length; k += 4) if (Math.abs(d1[k] - d2[k]) > 24 || Math.abs(d1[k + 1] - d2[k + 1]) > 24 || Math.abs(d1[k + 2] - d2[k + 2]) > 24) n++;
  return n / (d1.length / 4);
}, [a.toString('base64'), b.toString('base64')]);
const ready = async (page) => { await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 }); await page.emulateMedia({ reducedMotion: 'reduce' }); };
const nearReady = async (page) => { await view(page, NEAR); await until(async () => (await page.evaluate(() => window.__mt.termStats().gl)) >= 8, 20000, 200); await sleep(1500); };
// 세 배율에서 그림과 모습
async function scenes(page, tag) {
  const out = {};
  await nearReady(page);
  for (const [name, z] of [['near', null], ['middle', 0.18], ['far', 0.12]]) {
    if (z) { await view(page, NEAR, z); await sleep(1500); }
    const png = await page.screenshot();
    fs.writeFileSync(path.join(OUT, `${tag}-${name}.png`), png);
    out[name] = { png, look: await look(page) };
  }
  await nearReady(page);
  return out;
}
// 트레이 '열기'로 다시 연다. 판을 다 읽을 때와 터미널 8개가 붙을 때까지의 시간
async function reopen() {
  const t0 = Date.now();
  const w = app.waitForEvent('window', { timeout: 60000 });
  await app.evaluate(() => global.__mtTray.run('open'));
  const page = await w;
  await ready(page);
  const loadedMs = Date.now() - t0;
  await view(page, NEAR);
  await until(async () => (await page.evaluate(() => window.__mt.termStats().terms)) >= 8, 20000, 100);
  return { page, loadedMs, attachedMs: Date.now() - t0 };
}
async function closeWin(tag) {
  const g0 = await gpuMB(); const n0 = purgeLines().length; const t0 = Date.now();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); // 창의 X 단추와 같다
  await until(async () => (await windows()) === 0, 10000, 50);
  const goneMs = Date.now() - t0;
  await sleep(5000);
  const lines = purgeLines().slice(n0);
  const r = lines.length ? JSON.parse(lines[lines.length - 1].replace(/^.*gpu purge /, '')) : null;
  const t = await tray();
  step(`${tag}: X로 닫으면 창이 없어지고 앱은 트레이에 남는다`, t.hasTray && t.enabled && t.connected, { goneMs, hasTray: t.hasTray });
  step(`${tag}: 닫을 때 페이지를 내리고 GPU 메모리 압박을 알렸다`, r && r.ok, r);
  const g1 = await gpuMB();
  log(`${tag}: GPU private ${g0} → ${g1}MB (닫고 5초)`);
  return { g0, g1, goneMs, purge: r };
}

const report = { at: new Date().toISOString(), steps: results };
try {
  let page = await app.firstWindow();
  await ready(page);
  await until(async () => (await tray()).connected, 20000);
  // 세션 준비: 셸 8개(조용한 글) + haiku 하나
  for (const n of SHELLS) if (!(await sessionOf(page, n))) atrium('spawn', DIR, '--kind', 'shell', '--name', n);
  if (!(await sessionOf(page, AGENT))) atrium('spawn', DIR, '--name', AGENT, '--model', 'haiku');
  await until(async () => { for (const n of SHELLS) { const s = await sessionOf(page, n); if (!s || s.state !== 'shell_idle') return false; } return true; }, 90000, 500);
  for (const [k, n] of SHELLS.entries()) atrium('input', n, `Clear-Host; Get-ChildItem C:\\Windows -Name | Select-Object -First ${12 + k}\\r`);
  await until(async () => { const s = await sessionOf(page, AGENT); return s && s.state === 'ready'; }, 90000, 500);
  await sleep(3000);

  // 1. 닫기 전 모습
  const before = await scenes(page, 'before');
  step('닫기 전: 가까이 배율에서 터미널 8개가 WebGL로 붙는다', before.near.look.stats.terms === 8 && before.near.look.stats.gl === 8, before.near.look.stats);
  // 일하는 둘레: haiku에게 긴 글을 시킨다(도구 없이)
  atrium('send', `@${AGENT}`, 'Without using any tools, write a detailed 2500-word essay on the history of lighthouses, with many short sections. Write it directly in your reply.');
  await until(async () => (await sessionOf(page, AGENT)).state === 'working', 60000, 300);
  await view(page, `^(e0[1-8]|${AGENT})$`, 0.18); await sleep(1500); // 둘레는 가까이 얼굴이 아닐 때만(lib/overview.js runsRing)
  const ring0 = await look(page);
  fs.writeFileSync(path.join(OUT, 'before-ring.png'), await page.screenshot());
  step('닫기 전: 일하는 노드에 둘레(.mt-node-run)', ring0.runCount >= 1, { runCount: ring0.runCount });

  // 2. 닫기(일하는 중) → 다시 열기
  const c1 = await closeWin('닫기1');
  const r1 = await reopen(); page = r1.page;
  log('다시 열기1', { loadedMs: r1.loadedMs, attachedMs: r1.attachedMs });
  const working = (await sessionOf(page, AGENT)).state === 'working';
  await view(page, `^(e0[1-8]|${AGENT})$`, 0.18); await sleep(1500); // 둘레는 가까이 얼굴이 아닐 때만(lib/overview.js runsRing)
  const ring1 = await look(page);
  fs.writeFileSync(path.join(OUT, 'after-ring.png'), await page.screenshot());
  step('다시 연 창: 일하는 노드에 둘레가 그대로', !working || ring1.runCount >= 1, { working, runCount: ring1.runCount });
  // 3. 다시 연 창의 모습 견주기(셸 글은 그대로)
  await until(async () => (await sessionOf(page, AGENT)).state !== 'working', 180000, 1000);
  const after = await scenes(page, 'after');
  for (const name of ['near', 'middle', 'far']) {
    const a = before[name].look, b = after[name].look;
    step(`다시 연 창 ${name}: 얼굴별 노드 수가 같다`, JSON.stringify(a.faces) === JSON.stringify(b.faces), { before: a.faces, after: b.faces });
  }
  const dn = await diff(page, before.near.png, after.near.png);
  step('다시 연 창 가까이: 붙은 터미널·WebGL·캔버스 장치 픽셀(선명하게)이 같다', JSON.stringify(before.near.look.stats) === JSON.stringify(after.near.look.stats) && JSON.stringify(before.near.look.canvases) === JSON.stringify(after.near.look.canvases), { before: before.near.look.stats, after: after.near.look.stats });
  step('다시 연 창 가까이: 그림이 닫기 전과 같다(다른 픽셀 2% 미만)', dn < 0.02, { diff: +dn.toFixed(4) });
  for (const name of ['middle', 'far']) log(`그림 ${name} 다른 픽셀`, +(await diff(page, before[name].png, after[name].png)).toFixed(4));

  // 4. 닫힌 동안 트레이 알림(내 차례)과 메뉴
  const c2 = await closeWin('닫기2');
  atrium('send', `@${AGENT}`, 'Use the Bash tool to run exactly this command: mkdir p113probe . Then reply done.');
  const waited = await until(async () => (await tray()).needsYou.includes(AGENT), 120000, 500).then(() => true, () => false);
  const trayNotes = () => app.evaluate(() => global.__mtNotifications.filter((n) => n.source === 'tray').length);
  await until(async () => (await trayNotes()) >= 1, 15000, 300).catch(() => {}); // 알림은 NOTIFY_DELAY_MS 뒤에 뜬다
  const t2 = await tray();
  const note = await app.evaluate(() => global.__mtNotifications.filter((n) => n.source === 'tray').map((n) => ({ sessionId: n.sessionId, shown: n.shown })));
  step('닫힌 동안: 내 차례가 트레이 메뉴와 알림에 뜬다', waited && note.length >= 1 && t2.menu.length > 3, { needsYou: t2.needsYou, notes: note.length, icon: t2.icon, menu: t2.menu });
  const r2 = await reopen(); page = r2.page;
  log('다시 열기2', { loadedMs: r2.loadedMs, attachedMs: r2.attachedMs });
  atrium('answer', AGENT, 'reject');
  report.gpu = { close1: c1, close2: c2 };
  report.reopen = [{ loadedMs: r1.loadedMs, attachedMs: r1.attachedMs }, { loadedMs: r2.loadedMs, attachedMs: r2.attachedMs }];
} catch (e) {
  step('오류 없이 끝난다', false, e.stack || e.message);
} finally {
  for (const n of [...SHELLS, AGENT]) { try { atrium('kill', n, '--yes'); } catch {} }
  fs.writeFileSync(path.join(OUT, 'p113-reopen.json'), JSON.stringify(report, null, 1));
  const failed = results.filter((r) => !r.ok);
  log(`결과: 통과 ${results.length - failed.length} / ${results.length}`);
  try { await app.evaluate(({ app: a }) => { setTimeout(() => a.exit(0), 100); }); } catch {}
  await sleep(1500);
  process.exit(failed.length ? 1 : 0);
}
