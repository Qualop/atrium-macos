// P91 창 시험: 폴더가 안팎인 워크스페이스 묶음과 화면 비율 정리.
// 판: herdr 세션 atrium-dev-p91, 포트 47891, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9371.
// 장면(새로 만든 시험 폴더, git 저장소가 아니다):
//   C:\Workspace\mtask-p91-ms\browser(s2: claude haiku), ...\browser\collector(archive-scraper: s2가 atrium child --cwd로 띄운 haiku 워커),
//   ...\rea(rea-head: 셸), 다른 프로젝트 C:\Workspace\mtask-p91-alpha(a-lead: haiku, 셸 aw1~aw8을 역할 선 "worker"로 이음), C:\Workspace\mtask-p91-beta(셸 b1, b2).
//   묶음 뿌리 표시: P91_MARK=0이면 mtask-p91-ms에 README.md가 없고(browser·collector만 묶인다), 1이면 있다(셋이 묶인다).
// P91_STAGE=before(고치기 전 코드: 정리 결과만 찍는다) | after(고친 코드: 묶음, 이름표, 끌기, 사람이 바꾼 것, 정리 비율) | clean(세션 끄기, 판 멈추기, 시험 폴더 지우기)
// 결과는 experiments/p91/(git 밖). 신뢰 질문이 뜨면 backend/.dev/p91-need-trust.txt에 한 줄을 두고 멈춘다.
// 실행(워크트리 루트): sh backend/.dev/clean-env.sh env P91_STAGE=before node app/test/e2e/p91-groups.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const STAGE = process.env.P91_STAGE || 'after';
if (!['before', 'after', 'clean'].includes(STAGE)) throw new Error('P91_STAGE=before|after|clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p91');
const CONVOS = path.join(OUT, 'convos');
const MS = 'C:\\Workspace\\mtask-p91-ms';
const F = { browser: path.join(MS, 'browser'), collector: path.join(MS, 'browser', 'collector'), rea: path.join(MS, 'rea'), alpha: 'C:\\Workspace\\mtask-p91-alpha', beta: 'C:\\Workspace\\mtask-p91-beta' };
const BOARD = { session: 'atrium-dev-p91', port: 47891, cdp: 9371 };
const ENV = {
  ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p91',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, until, APP_ROOT, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p91' || ENV.ATRIUM_PORT !== '47891') throw new Error('P91 판(atrium-dev-p91, 47891)만');
const { pathKey } = await import(pathToFileURL(path.join(REPO, 'backend', 'src', 'workspaces.mjs')).href);

const log = logger(`p91-groups-${STAGE}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== '' ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { log(`지우기 실패 ${p}: ${e.message.slice(0, 120)}`); } };
const MARK = path.join(MS, 'README.md');
const setMark = (on) => { if (on) fs.writeFileSync(MARK, '# p91 test project root\n'); else rmrf(MARK); };

// ---------- 정리 ----------
if (STAGE === 'clean') {
  try { for (const s of sessions()) { try { log('끄기', atrium('kill', s.sessionId, '--yes', '--delete').trim().split('\n').slice(-1)[0]); } catch (e) { log('끄기 실패', s.name, e.message.slice(0, 160)); } } } catch (e) { log('목록 실패', e.message.slice(0, 160)); }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  for (const p of [MS, F.alpha, F.beta]) rmrf(p);
  process.exit(0);
}

// ---------- 장면 ----------
function spawn(folder, name, extra = []) { const r = JSON.parse(atrium('--json', 'spawn', folder, '--name', name, ...extra)); log(`띄움 ${name} ${r.sessionId}`); return r; }
const trustStop = (name, folder) => { fs.writeFileSync(path.join(DEV, 'p91-need-trust.txt'), `Dev board atrium-dev-p91 (port 47891): ${name} in ${folder} asks the folder trust question\n`); throw new Error(`trust question (backend/.dev/p91-need-trust.txt): ${name}`); };
async function readyOf(name, ms = 150000) {
  const s = await until(() => { const x = byName(name); return x && ['ready', 'trust_wait', 'working', 'waiting'].includes(x.state) ? x : null; }, ms, 1500).catch(() => null);
  if (s && s.state === 'trust_wait') trustStop(name, s.cwd);
  return s;
}
const envOf = (name) => {
  const s = byName(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.sessionId}.json`), 'utf8'));
  const e = { ...process.env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (e.ATRIUM_SESSION_ID !== s.sessionId || !e.ATRIUM_SESSION_TOKEN) throw new Error(`${name} 설정 파일에 세션 env가 없다`);
  return e;
};
const child = (pe, n, extra = []) => { const out = execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', n, ...extra, '--model', 'haiku', '--no-wait', '--json'], { encoding: 'utf8', env: pe, timeout: 120000 }); log(`atrium child ${n}`, out.trim().slice(0, 300)); };
const WORKERS = ['aw1', 'aw2', 'aw3', 'aw4', 'aw5', 'aw6', 'aw7', 'aw8'];

async function setupScene() {
  for (const f of Object.values(F)) fs.mkdirSync(f, { recursive: true });
  fs.writeFileSync(path.join(F.alpha, 'README.md'), '# p91 alpha\n');
  setMark(false);
  for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('옛 세션 끄기 실패', s.name, e.message.slice(0, 120)); } }
  await sleep(1500);
  spawn(F.browser, 's2', ['--model', 'haiku']);
  spawn(F.rea, 'rea-head', ['--kind', 'shell']);
  spawn(F.alpha, 'a-lead', ['--model', 'haiku']);
  for (const n of WORKERS) spawn(F.alpha, n, ['--kind', 'shell']);
  spawn(F.beta, 'b1', ['--kind', 'shell']);
  spawn(F.beta, 'b2', ['--kind', 'shell']);
  for (const n of ['s2', 'a-lead']) { const s = await readyOf(n); log(`준비 ${n}: ${s ? s.state : '없음'}`); }
  // s2가 collector에 워커를 띄운다(사용자 그림: browser의 s2가 띄운 archive-scraper가 collector 영역에)
  child(envOf('s2'), 'archive-scraper', ['--cwd', F.collector.replace(/\\/g, '/')]);
  const w = await readyOf('archive-scraper'); log(`준비 archive-scraper: ${w ? w.state : '없음'}`);
  // a-lead → aw1~aw8 역할 선(띄운 순서 = 하위 세션 순서). 역할 알림은 a-lead(haiku)에게 간다
  for (const n of WORKERS) { try { atrium('link', 'a-lead', n, '--role', 'worker'); } catch (e) { log('잇기 실패', n, e.message.slice(0, 160)); } }
}

// ---------- 창 ----------
let app = null, page = null;
const shot = async (name) => { const f = path.join(OUT, `${STAGE}-${name}.png`); await page.screenshot({ path: f }); log(`스크린숏 experiments/p91/${STAGE}-${name}.png`); };
const fitAll = async () => { await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200); };
// 판의 영역(창이 그리는 것과 같은 계산)
const regionsNow = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node-region')].map((n) => { const el = n.querySelector('.mt-region'); const tr = n.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/); return { ws: el && el.dataset.ws, name: el && el.dataset.name, label: (n.querySelector('.mt-region-name') || {}).textContent || '', title: (n.querySelector('.mt-region-head') || {}).title || '', x: tr ? +tr[1] : null, y: tr ? +tr[2] : null, w: parseFloat(n.style.width) || n.offsetWidth, h: parseFloat(n.style.height) || n.offsetHeight }; }));
const framesNow = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node-wsgroup')].map((n) => { const el = n.querySelector('.mt-wsgroup'); const tr = n.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/); return { group: el && el.dataset.group, name: (n.querySelector('.mt-wsgroup-name') || {}).textContent || '', auto: el && el.dataset.auto, x: tr ? +tr[1] : null, y: tr ? +tr[2] : null, w: parseFloat(n.style.width), h: parseFloat(n.style.height) }; }));
const canvasAspect = () => page.evaluate(() => { const r = document.querySelector('.react-flow').getBoundingClientRect(); return r.width / r.height; });
const bboxOf = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h)); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const keyOf = (folder) => pathKey(folder);
const pos = () => Object.fromEntries(call('board.get').nodes.map((n) => [n.session_id, [n.x, n.y, n.w, n.h]]));
async function arrangeAll(label) {
  const btn = page.locator('[data-action="chip-arrange"]').first();
  let how = 'button';
  try { await btn.click({ timeout: 3000 }); } catch { how = 'api'; await page.evaluate(() => window.__mt.arrangeBoard ? window.__mt.arrangeBoard() : window.__mt.api.call('board.arrange', { all: true, apply: true })); }
  await sleep(2500);
  await fitAll();
  await shot(label);
  const rs = (await regionsNow()).filter((r) => r.ws);
  const fr = STAGE === 'after' ? await framesNow() : [];
  const all = bboxOf([...rs, ...fr]);
  const ratio = all.w / all.h;
  log(`정리(${how}) ${label}: 영역 ${rs.length}, 전체 ${Math.round(all.w)}×${Math.round(all.h)} 비율 ${ratio.toFixed(2)}, 캔버스 ${(await canvasAspect()).toFixed(2)}`, rs.map((r) => [r.name, r.label, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]));
  return { rs, fr, all, ratio, how };
}

const report = { stage: STAGE };
try {
  log(atrium('backend', 'start').trim().slice(0, 300));
  try { atrium('settings', 'set', 'tray', 'off'); } catch (e) { log('트레이 끄기 실패', e.message.slice(0, 120)); }
  try { atrium('settings', 'set', 'language', 'ko'); } catch {}
  const have = sessions().map((s) => s.name);
  if (process.env.P91_FRESH === '1' || !['s2', 'archive-scraper', 'rea-head', 'a-lead', 'aw8', 'b2'].every((n) => have.includes(n))) await setupScene();
  setMark(false);
  try { call('workspace.list'); } catch {}

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
  report.canvasAspect = await canvasAspect();

  // 1. 처음 판(띄운 자리)
  await fitAll();
  await shot('1-initial');
  report.initial = await regionsNow();

  // 2. 판 전체 정리(뿌리 표시 없음)
  const a1 = await arrangeAll('2-arranged-nomark');
  report.arranged = { ratio: a1.ratio, all: a1.all, how: a1.how };
  const okRatio = (r) => Math.abs(Math.log(r / report.canvasAspect)) < Math.log(1.45);
  const noOverlap = (rs) => { for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (overlap(rs[i], rs[j])) return false; return true; };
  if (STAGE === 'before') {
    check('[전] 정리 결과의 비율', true, { ratio: +a1.ratio.toFixed(2), canvas: +report.canvasAspect.toFixed(2) });
  } else {
    check('정리 결과 전체 비율이 캔버스 비율 근처', okRatio(a1.ratio), { ratio: +a1.ratio.toFixed(2), canvas: +report.canvasAspect.toFixed(2) });
    check('정리 뒤 영역끼리 겹치지 않는다', noOverlap(a1.rs), a1.rs.length);
  }

  // 3. 하위 세션 여덟 개인 부모(a-lead)의 영역 정리
  const alphaKey = keyOf(F.alpha);
  await page.evaluate((k) => window.__mt.api.call('board.arrange', { workspace: k, apply: true }), alphaKey);
  await sleep(2000);
  await page.evaluate((k) => window.__mt.getState().fitWorkspace(k), alphaKey);
  await sleep(1500);
  await shot('3-alpha-8-workers');
  const ps = pos();
  const ids = Object.fromEntries(sessions().map((s) => [s.name, s.sessionId]));
  const wr = WORKERS.map((n) => ps[ids[n]]).filter(Boolean);
  const cols = [...new Set(wr.map((r) => r[0]))].sort((a, b) => a - b);
  const lead = ps[ids['a-lead']];
  const regA = (await regionsNow()).find((r) => r.ws === alphaKey);
  log('alpha 워커 자리', WORKERS.map((n, i) => [n, ...(wr[i] || [])]), 'lead', lead, 'region', regA);
  const colMajor = WORKERS.every((n, i) => i === 0 || (() => { const a = ps[ids[WORKERS[i - 1]]], b = ps[ids[n]]; return b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]); })());
  if (STAGE === 'before') check('[전] 여덟 워커의 열 수', true, { cols: cols.length, region: regA && +(regA.w / regA.h).toFixed(2) });
  else {
    check('여덟 워커가 두 열 이상으로 접힌다', cols.length >= 2, { cols: cols.length, region: regA && +(regA.w / regA.h).toFixed(2) });
    check('띄운 순서 그대로(위 → 아래, 다음 열)', colMajor, WORKERS.map((n) => ps[ids[n]].slice(0, 2)));
    check('워커 열은 부모 오른쪽', wr.every((r) => r[0] >= lead[0] + lead[2]));
  }

  if (STAGE === 'after') {
    // 4. 저절로 만든 묶음(표시 없음: browser와 collector만)
    const g1 = call('group.list');
    log('묶음(표시 없음)', g1);
    const auto1 = g1.groups.find((g) => g.auto);
    const kB = keyOf(F.browser), kC = keyOf(F.collector), kR = keyOf(F.rea);
    check('표시 없는 뿌리: browser·collector만 한 묶음', auto1 && auto1.members.includes(kB) && auto1.members.includes(kC) && !auto1.members.includes(kR), auto1);
    check('다른 프로젝트(alpha, beta)와 rea는 묶지 않는다', !g1.groups.some((g) => g.members.includes(alphaKey) || g.members.includes(keyOf(F.beta)) || g.members.includes(kR)));
    await fitAll();
    let fr = await framesNow();
    let rs = await regionsNow();
    const memberRegs = rs.filter((r) => auto1 && auto1.members.includes(r.ws));
    check('캔버스에 묶음 테두리', fr.length === 1 && memberRegs.every((r) => inside(r, fr[0])), { fr, members: memberRegs.map((r) => r.name) });
    check('묶음 테두리가 다른 영역과 겹치지 않는다', fr.length === 1 && rs.filter((r) => !memberRegs.includes(r)).every((r) => !overlap(r, fr[0])));
    const lc = rs.find((r) => r.ws === kC);
    check('영역 이름표는 상대 경로(browser/collector), 마우스를 올리면 전체 경로', lc && lc.label === 'browser/collector' && /mtask-p91-ms[\\/]browser[\\/]collector/i.test(lc.title), lc && { label: lc.label, title: lc.title });

    // 5. 뿌리에 README.md를 두면 셋이 한 묶음(MTASK-P91-MS)
    // 판은 폴더 표시를 30초 담아 두므로(ws-groups.mjs MARK_TTL) 목록을 다시 불러 가며 기다린다
    setMark(true);
    const t5 = Date.now();
    await until(() => { call('workspace.list'); const g = call('group.list').groups.find((x) => x.auto); return g && g.members.includes(kR); }, 60000, 3000).catch(() => null);
    log(`뿌리 표시를 알아보기까지 ${((Date.now() - t5) / 1000).toFixed(1)}초`);
    await sleep(1500);
    const g2 = call('group.list');
    const auto2 = g2.groups.find((g) => g.auto);
    check('표시가 있는 뿌리: browser·collector·rea가 한 묶음', auto2 && [kB, kC, kR].every((k) => auto2.members.includes(k)), auto2);
    const a2 = await arrangeAll('4-arranged-mark');
    fr = a2.fr;
    rs = a2.rs;
    const labels = Object.fromEntries(rs.filter((r) => auto2 && auto2.members.includes(r.ws)).map((r) => [r.ws, r.label]));
    check('상대 경로 이름표 browser, browser/collector, rea', labels[kB] === 'browser' && labels[kC] === 'browser/collector' && labels[kR] === 'rea', labels);
    check('정리 뒤 묶음 테두리가 세 영역을 감싸고 다른 영역과 겹치지 않는다', fr.length === 1 && rs.filter((r) => labels[r.ws]).every((r) => inside(r, fr[0])) && rs.filter((r) => !labels[r.ws]).every((r) => !overlap(r, fr[0])), fr);
    check('정리 결과 전체 비율이 캔버스 비율 근처(묶음 있음)', okRatio(a2.ratio), { ratio: +a2.ratio.toFixed(2) });
    const p1 = pos();
    await arrangeAll('5-arranged-again');
    const p2 = pos();
    check('정리를 두 번 눌러도 같다', JSON.stringify(p1) === JSON.stringify(p2));
    // 6. 묶음 이름표 끌기. 이름표를 화면 가운데에 두고(가장자리에서 끌면 React Flow가 화면을 밀어 버린다) 왼쪽 위 빈 곳으로, 그다음 다른 영역 위로(되돌아온다)
    const zoom = 0.12;
    await page.evaluate(([f, z]) => { const c = document.querySelector('.react-flow').getBoundingClientRect(); window.__mt.getState().setViewport({ x: c.width / 2 - (f.x + 200) * z, y: c.height / 2 - (f.y + 30) * z, zoom: z }); }, [fr[0], zoom]);
    await sleep(1500);
    const dragHead = async (ddx, ddy, label) => {
      const hb = await page.locator('.mt-wsgroup-head').first().boundingBox();
      const before = pos();
      const sx = hb.x + Math.min(40, hb.width / 2), sy = hb.y + hb.height / 2;
      await page.mouse.move(sx, sy); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(sx + (i * ddx) / 10, sy + (i * ddy) / 10); await sleep(30); }
      await page.mouse.up();
      await sleep(2500);
      await shot(label);
      const after = pos();
      const members = sessions().filter((s) => auto2.members.includes(s.workspaceKey)).map((s) => s.sessionId);
      const others = sessions().filter((s) => !auto2.members.includes(s.workspaceKey)).map((s) => s.sessionId);
      const d = members.map((id) => [after[id][0] - before[id][0], after[id][1] - before[id][1]]);
      return { d, same: d.every((x) => x[0] === d[0][0] && x[1] === d[0][1]), othersStill: others.every((id) => after[id][0] === before[id][0] && after[id][1] === before[id][1]) };
    };
    const m1 = await dragHead(-60, -40, '6-group-dragged');
    check('묶음 이름표를 끌면 구성 영역이 함께 움직인다', m1.same && m1.d[0][0] < -0.7 * 60 / zoom && m1.d[0][0] > -1.1 * 60 / zoom && m1.d[0][1] < -0.7 * 40 / zoom && m1.d[0][1] > -1.1 * 40 / zoom, { note: "끌기 시작 문턱만큼 덜 간다", d: m1.d[0], expect: [Math.round(-60 / zoom), Math.round(-40 / zoom)] });
    check('다른 영역은 그대로', m1.othersStill);
    const alphaR = (await regionsNow()).find((r) => r.ws === alphaKey), msR = (await regionsNow()).find((r) => r.ws === kB);
    const m2 = await dragHead((alphaR.x - msR.x) * zoom, (alphaR.y - msR.y) * zoom, '6b-group-drag-onto-alpha');
    check('다른 영역 위에 놓으면 되돌아온다', m2.d.every((x) => x[0] === 0 && x[1] === 0) && m2.othersStill, m2.d[0]);
    // 7. 사람이 바꾼 것이 이긴다
    call('group.move', { workspace: kR, group: null });
    call('workspace.list'); await sleep(800);
    const g3 = call('group.list');
    check('사람이 뺀 rea는 다시 넣지 않는다', !g3.groups.find((g) => g.id === auto2.id).members.includes(kR), g3);
    call('group.rename', { group: auto2.id, name: 'Renamed' });
    call('workspace.list'); await sleep(800);
    const g4 = call('group.list');
    check('사람이 바꾼 이름을 덮지 않는다', g4.groups.find((g) => g.id === auto2.id).name === 'Renamed', g4);
    await fitAll();
    await shot('7-human-changes');
    call('group.remove', { group: auto2.id });
    call('workspace.list'); await sleep(800);
    const g5 = call('group.list');
    check('사람이 지운 묶음은 다시 만들지 않는다', !g5.groups.some((g) => g.auto), g5);
  }
} catch (e) {
  log('오류', e.stack || e.message);
  check('시험이 끝까지 돌았다', false, e.message.slice(0, 300));
} finally {
  if (app) await closeApp(app);
  const pass = results.filter((r) => r.ok).length;
  report.results = results;
  fs.writeFileSync(path.join(OUT, `p91-groups-${STAGE}.json`), JSON.stringify(report, null, 1));
  log(`결과 ${pass}/${results.length}`);
  process.exit(0);
}
