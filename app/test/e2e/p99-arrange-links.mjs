// P99 창 시험: 판 전체 정리가 다른 워크스페이스끼리의 연결(하위 세션, 역할 선)을 보고 이어진 영역을 가까이 놓는다.
// 판: herdr 세션 atrium-dev-p99, 포트 47898, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9378.
// 장면(새로 만든 시험 폴더, git 저장소가 아니다, 세션은 모두 셸):
//   C:\Workspace\mtask-p99-a … -h(여덟), C:\Workspace\mtask-p99-suite\core와 ...\core\plugin(안팎 폴더라 저절로 한 묶음).
//   이은 것: a-lead가 h에 띄운 하위 세션 h-child(부모), b-lead → g-rev 역할 선 "reviewer", plugin-lead가 e에 띄운 하위 세션 e-child(묶음 안 → 묶음 밖)
// P99_STAGE=run(장면을 만들고 처음 판, 정리 뒤를 찍는다) | clean(세션 끄기, 판 멈추기, 시험 폴더 지우기)
// 결과는 experiments/p99/(git 밖).
// 실행(워크트리 루트): sh backend/.dev/clean-env.sh env P99_STAGE=run node app/test/e2e/p99-arrange-links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const STAGE = process.env.P99_STAGE || 'run';
if (!['run', 'clean'].includes(STAGE)) throw new Error('P99_STAGE=run|clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p99');
const CONVOS = path.join(OUT, 'convos');
const BASE = 'C:\\Workspace';
const SUITE = path.join(BASE, 'mtask-p99-suite');
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const F = { ...Object.fromEntries(LETTERS.map((l) => [l, path.join(BASE, `mtask-p99-${l}`)])), core: path.join(SUITE, 'core'), plugin: path.join(SUITE, 'core', 'plugin') };
const BOARD = { session: 'atrium-dev-p99', port: 47898, cdp: 9378 };
const ENV = {
  ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p99',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, APP_ROOT } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p99' || ENV.ATRIUM_PORT !== '47898') throw new Error('P99 판(atrium-dev-p99, 47898)만');
const { pathKey } = await import(pathToFileURL(path.join(REPO, 'backend', 'src', 'workspaces.mjs')).href);

const log = logger(`p99-arrange-${STAGE}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { log(`지우기 실패 ${p}: ${e.message.slice(0, 120)}`); } };

if (STAGE === 'clean') {
  try { for (const s of sessions()) { try { log('끄기', atrium('kill', s.sessionId, '--yes', '--delete').trim().split('\n').slice(-1)[0]); } catch (e) { log('끄기 실패', s.name, e.message.slice(0, 160)); } } } catch (e) { log('목록 실패', e.message.slice(0, 160)); }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  for (const p of [SUITE, ...LETTERS.map((l) => F[l])]) rmrf(p);
  process.exit(0);
}

// ---------- 장면 ----------
const shell = (folder, name, extra = {}) => { const r = call('session.spawn', { cwd: folder, name, kind: 'shell', ...extra }); log(`띄움 ${name} ${r.sessionId}${extra.parentSessionId ? ` (부모 ${extra.parentSessionId})` : ''}`); return r; };
async function setupScene() {
  for (const f of Object.values(F)) fs.mkdirSync(f, { recursive: true });
  for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('옛 세션 끄기 실패', s.name, e.message.slice(0, 120)); } }
  await sleep(1500);
  // 워크스페이스를 a, b, …, h, core, plugin 차례로 연다(영역은 연 차례로 빈자리에 놓인다)
  const ids = {};
  for (const l of LETTERS) ids[`${l}-lead`] = shell(F[l], `${l}-lead`).sessionId;
  ids['core-lead'] = shell(F.core, 'core-lead').sessionId;
  ids['plugin-lead'] = shell(F.plugin, 'plugin-lead').sessionId;
  await sleep(1500);
  // 다른 워크스페이스로 띄운 하위 세션 둘, 사람이 이은 역할 선 하나
  shell(F.h, 'h-child', { parentSessionId: ids['a-lead'] });
  shell(F.e, 'e-child', { parentSessionId: ids['plugin-lead'] });
  ids['g-rev'] = shell(F.g, 'g-rev').sessionId;
  await sleep(1000);
  try { log('잇기', atrium('link', 'b-lead', 'g-rev', '--role', 'reviewer').trim().slice(0, 200)); } catch (e) { log('잇기 실패', e.message.slice(0, 200)); }
  await sleep(1500);
}

// ---------- 창 ----------
let app = null, page = null;
const shot = async (name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log(`스크린숏 experiments/p99/${name}.png`); };
const fitAll = async () => { await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200); };
const regionsNow = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node-region')].map((n) => { const el = n.querySelector('.mt-region'); const tr = n.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/); return { ws: el && el.dataset.ws, name: el && el.dataset.name, x: tr ? +tr[1] : null, y: tr ? +tr[2] : null, w: parseFloat(n.style.width) || n.offsetWidth, h: parseFloat(n.style.height) || n.offsetHeight }; }));
const framesNow = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node-wsgroup')].map((n) => { const tr = n.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/); return { name: (n.querySelector('.mt-wsgroup-name') || {}).textContent || '', x: tr ? +tr[1] : null, y: tr ? +tr[2] : null, w: parseFloat(n.style.width), h: parseFloat(n.style.height) }; }));
const canvasAspect = () => page.evaluate(() => { const r = document.querySelector('.react-flow').getBoundingClientRect(); return r.width / r.height; });
const bboxOf = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const edge = (a, b) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)));
const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
const K = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, pathKey(f)]));
const PAIRS = [['a', 'h', '하위 세션 h-child'], ['b', 'g', '역할 선 reviewer'], ['plugin', 'e', '묶음 안 → 밖 하위 세션 e-child']];
const dists = (rs, fr) => {
  const by = new Map(rs.map((r) => [r.ws, r]));
  const g = fr[0] || null;
  return PAIRS.map(([x, y, why]) => { const ra = x === 'plugin' && g ? g : by.get(K[x]); const rb = by.get(K[y]); return { pair: `${x}↔${y}`, why, edge: ra && rb ? Math.round(edge(ra, rb)) : null }; });
};

try {
  log(atrium('backend', 'start').trim().slice(0, 300));
  try { atrium('settings', 'set', 'tray', 'off'); } catch (e) { log('트레이 끄기 실패', e.message.slice(0, 120)); }
  try { atrium('settings', 'set', 'language', 'ko'); } catch {}
  const have = sessions().map((s) => s.name);
  if (process.env.P99_FRESH === '1' || !['a-lead', 'h-child', 'e-child', 'g-rev', 'plugin-lead'].every((n) => have.includes(n))) await setupScene();
  try { call('workspace.list'); } catch {}
  const gl = call('group.list');
  log('묶음', gl.groups.map((g) => [g.name, g.auto, g.members]));
  check('안팎 폴더(core, core/plugin)가 저절로 한 묶음', gl.groups.some((g) => g.auto && g.members.includes(K.core) && g.members.includes(K.plugin)), gl.groups.map((g) => g.name));

  const { _electron: electron } = await import('playwright');
  app = await electron.launch({ args: ['.', '--dev', `--remote-debugging-port=${BOARD.cdp}`], cwd: APP_ROOT, env: process.env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 891)); // 창 안쪽 16:9쯤
  await page.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  await sleep(2500);
  const aspect = await canvasAspect();

  // 1. 정리 전(연 차례로 놓인 판)
  await fitAll();
  await shot('1-before');
  const r0 = (await regionsNow()).filter((r) => r.ws);
  const d0 = dists(r0, await framesNow());
  log('정리 전 거리', d0);

  // 2. 미리 보기: 연결 항(고치기 전 계산으로 놓았을 때 → 고른 결과)
  const pv = await page.evaluate((a) => window.__mt.api.call('board.arrange', { all: true, aspect: a }), aspect);
  log('미리 보기 link', pv.link);
  check('묶음 사이 연결 셋을 센다', pv.link && pv.link.pairs === 3, pv.link);
  check('연결 항이 고치기 전 배치보다 작다', pv.link && pv.link.now < pv.link.plain, pv.link);

  // 3. 판 전체 정리(아래 칩)
  const btn = page.locator('[data-action="chip-arrange"]').first();
  let how = 'button';
  try { await btn.click({ timeout: 3000 }); } catch { how = 'api'; await page.evaluate((a) => window.__mt.api.call('board.arrange', { all: true, apply: true, aspect: a }), aspect); }
  await sleep(2500);
  await fitAll();
  await shot('2-after');
  const rs = (await regionsNow()).filter((r) => r.ws);
  const fr = await framesNow();
  const d1 = dists(rs, fr);
  const all = bboxOf([...rs, ...fr]);
  log(`정리(${how}) 뒤: 영역 ${rs.length}, 전체 ${Math.round(all.w)}×${Math.round(all.h)} 비율 ${(all.w / all.h).toFixed(2)}, 캔버스 ${aspect.toFixed(2)}`, rs.map((r) => [r.name, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]));
  log('정리 뒤 거리', d1);
  for (const d of d1) check(`이어진 영역이 이웃: ${d.pair} (${d.why})`, d.edge != null && d.edge <= 241, d);
  check('결과 전체 비율이 캔버스 비율 근처', Math.abs(Math.log(all.w / all.h / aspect)) < Math.log(1.45), { ratio: +(all.w / all.h).toFixed(2), canvas: +aspect.toFixed(2) });
  let clean = true;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (overlap(rs[i], rs[j])) clean = false;
  check('영역끼리 겹치지 않는다', clean, rs.length);
  const members = rs.filter((r) => r.ws === K.core || r.ws === K.plugin);
  check('묶음 테두리가 그대로(구성 영역을 감싸고 다른 영역과 겹치지 않는다)', fr.length === 1 && members.length === 2 && members.every((r) => inside(r, fr[0])) && rs.filter((r) => !members.includes(r)).every((r) => !overlap(r, fr[0])), { fr, members: members.map((r) => r.name) });

  // 4. 연결이 보이게 가까이(a ↔ h)
  await page.evaluate((k) => window.__mt.getState().fitWorkspace && window.__mt.getState().fitWorkspace(k), K.a);
  await sleep(1200);
  await shot('3-after-a-zoom');

  // 5. 두 번 눌러도 같다
  const pos = () => JSON.stringify(call('board.get').nodes.map((n) => [n.session_id, n.x, n.y]).sort());
  const p1 = pos();
  await page.evaluate((a) => window.__mt.api.call('board.arrange', { all: true, apply: true, aspect: a }), aspect);
  await sleep(1500);
  check('두 번 정리해도 같은 자리(결정적)', pos() === p1);
} catch (e) {
  log('오류', e.stack || e.message);
  check('시험이 끝까지 돌았다', false, e.message);
} finally {
  if (app) { try { await app.close(); } catch {} }
  const fails = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ stage: STAGE, results }, null, 2));
  log(`결과 ${results.length - fails.length}/${results.length}`);
  process.exit(fails.length ? 1 : 0);
}
