// P85 창 시험: 멀리 보기에서 일하는 세션과 쉬는 세션이 갈라 보이는지 잰다(PC 창과 휴대폰 보드 화면).
// 판: herdr 세션 atrium-dev-p85, 포트 47898, 이 워크트리의 backend/.dev(data, app). 창의 원격 디버깅 포트 9378. 휴대폰 흉내 프록시 47908.
// 장면(시험 저장소 C:\Workspace\mtask-p75-repo, 새로 만든 git 저장소, 사람이 이 경로의 신뢰를 이미 주었다):
//   w-lead·w-coder(claude --model haiku, Bash ping 도는 중 = working), q-ask(Bash 권한 질문 = waiting), r-idle(ready, 봤음), r-review(ready, 안 봄),
//   x-done(/exit = exited), sh-run(셸, ping 도는 중), sh-idle(셸), 덩어리(w-coder + r-idle), 워크트리 상자 둘(셸 도는 중, 셸 쉼),
//   잠든 세션(새 폴더 C:\Workspace\mtask-p85-nap의 z-nap, atrium sleep). 신뢰 질문이 뜨면 backend/.dev/p85-need-trust.txt에 한 줄을 두고 멈춘다.
// 배율 네 단계(가까이 0.42, 중간 0.2, 멀리 0.12, 가장 멀리 0.07)로 찍고, 스크린숏 픽셀에서 노드 테두리 둘레의 눈에 띔(바탕과의 색 거리)을 잰다.
// 성능: 창 안에 가짜 세션 100개를 더해(화면 안 상태만, 백엔드는 모른다) 멈춘 화면과 휠 줌 동안의 프레임 간격을 잰다(움직임 줄이기와 견준다).
// P85_STAGE=before | after | clean. 결과는 experiments/p85/(git 밖).
// 실행(워크트리 루트): sh backend/.dev/clean-env.sh env P85_STAGE=before node app/test/e2e/p85-overview.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const STAGE = process.env.P85_STAGE || 'after';
if (!['before', 'after', 'clean'].includes(STAGE)) throw new Error('P85_STAGE=before|after|clean');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p85');
const CONVOS = path.join(OUT, 'convos');
const TREPO = 'C:\\Workspace\\mtask-p75-repo';
const NAP = 'C:\\Workspace\\mtask-p85-nap';
const WT1 = 'C:\\Workspace\\mtask-p85-wt1', WT2 = 'C:\\Workspace\\mtask-p85-wt2';
const BOARD = { session: 'atrium-dev-p85', port: 47898, sim: 47908, cdp: 9378 };
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
export const ENV = {
  ATRIUM_HERDR_SESSION: BOARD.session, ATRIUM_PORT: String(BOARD.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p85',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(BOARD.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${BOARD.sim},localhost:${BOARD.sim}`,
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
for (const k of Object.keys(process.env)) if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)) delete process.env[k];
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, until, APP_ROOT } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');

const log = logger(`p85-overview-${STAGE}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const judge = (name, ok, detail) => (STAGE === 'before' ? check(`[전] ${name}`, true, detail) : check(name, ok, detail));
const GIT_ID = ['-c', 'user.name=p85', '-c', 'user.email=p85@example.invalid'];
const git = (...a) => execFileSync('git', ['-C', TREPO, ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { log(`지우기 실패 ${p}: ${e.message.slice(0, 120)}`); } };

// ---------- 정리 ----------
if (STAGE === 'clean') {
  try { for (const s of sessions()) { try { log('끄기', atrium('kill', s.sessionId, '--yes', '--delete').trim().split('\n').slice(-1)[0]); } catch (e) { log('끄기 실패', s.name, e.message.slice(0, 160)); } } } catch (e) { log('목록 실패', e.message.slice(0, 160)); }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  try { git('worktree', 'remove', '--force', WT1); } catch {}
  try { git('worktree', 'remove', '--force', WT2); } catch {}
  for (const p of [WT1, WT2, NAP, TREPO]) rmrf(p);
  process.exit(0);
}

// ---------- 장면 ----------
// 오래 도는 턴: Claude Code는 단독 sleep을 막고, 긴 명령은 뒤로 돌리기도 해서 ping을 앞에서(timeout 600000) 돌게 한다
const LONG = (n) => `Use the Bash tool to run this command in the foreground, not in the background, with timeout 600000: ping -n ${n} 127.0.0.1 . Wait for it to finish. Then reply with the single word done.`;
function spawn(folder, name, extra = []) { const r = JSON.parse(atrium('--json', 'spawn', folder, '--name', name, ...extra)); log(`띄움 ${name} ${r.sessionId}`); return r; }
const trustStop = (name, folder) => { fs.writeFileSync(path.join(DEV, 'p85-need-trust.txt'), `${name} in ${folder} asks the folder trust question\n`); throw new Error(`trust question (backend/.dev/p85-need-trust.txt): ${name}`); };
async function readyOf(name, ms = 150000) {
  const s = await until(() => { const x = byName(name); return x && ['ready', 'trust_wait', 'working', 'waiting'].includes(x.state) ? x : null; }, ms, 1500).catch(() => null);
  if (s && s.state === 'trust_wait') trustStop(name, s.cwd);
  return s;
}

async function setupScene() {
  if (!fs.existsSync(path.join(TREPO, '.git'))) {
    fs.mkdirSync(TREPO, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', TREPO]);
    fs.writeFileSync(path.join(TREPO, 'README.md'), '# p85 test repo\n');
    git('add', 'README.md'); git(...GIT_ID, 'commit', '-q', '-m', 'init');
  }
  // 시험 저장소의 프로젝트 설정(git에 넣지 않는 local): ping만 묻지 않고 돈다(판의 spawn --args는 Claude Code 세션에 넘어가지 않는다)
  fs.mkdirSync(path.join(TREPO, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(TREPO, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)', 'Bash(ping *)'] } }, null, 1));
  if (!fs.existsSync(WT1)) git('worktree', 'add', '-q', '-b', 'p85-wt1', WT1);
  if (!fs.existsSync(WT2)) git('worktree', 'add', '-q', '-b', 'p85-wt2', WT2);
  fs.mkdirSync(NAP, { recursive: true });
  for (const f of [TREPO, NAP]) log(`신뢰 예상 ${f}: ${atrium('trust', f).trim().replace(/\s+/g, ' ').slice(0, 200)}`);
  for (const s of sessions()) { try { atrium('kill', s.sessionId, '--yes', '--delete'); } catch (e) { log('옛 세션 끄기 실패', s.name, e.message.slice(0, 120)); } }
  await sleep(1500);
  // 에이전트
  spawn(TREPO, 'w-lead', ['--model', 'haiku']);
  spawn(TREPO, 'w-coder', ['--model', 'haiku']);
  spawn(TREPO, 'q-ask', ['--model', 'haiku']);
  spawn(TREPO, 'r-idle', ['--model', 'haiku']);
  spawn(TREPO, 'r-review', ['--model', 'haiku']);
  spawn(TREPO, 'x-done', ['--model', 'haiku']);
  spawn(NAP, 'z-nap', ['--model', 'haiku']);
  // 셸
  spawn(TREPO, 'sh-run', ['--kind', 'shell']);
  spawn(TREPO, 'sh-idle', ['--kind', 'shell']);
  spawn(WT1, 'wt-run', ['--kind', 'shell']);
  spawn(WT2, 'wt-idle', ['--kind', 'shell']);
  for (const n of ['w-lead', 'w-coder', 'q-ask', 'r-idle', 'r-review', 'x-done', 'z-nap']) { const s = await readyOf(n); log(`준비 ${n}: ${s ? s.state : '없음'}`); }
  // 잠든 세션: 첫 답을 받은 뒤 잠재운다
  atrium('send', '@z-nap', 'Reply with the single word ok.', '--wait');
  await until(() => byName('z-nap').state === 'ready', 90000, 1500).catch(() => {});
  for (let i = 0; i < 8; i++) { try { log('잠재우기', atrium('sleep', NAP).trim().slice(0, 300)); break; } catch (e) { log('잠재우기 실패(다시)', e.message.slice(-160)); await sleep(5000); } }
  // 쉬는 것과 검토 대기: 한 번 답을 받는다(r-idle만 봤음으로)
  atrium('send', '@r-idle', '@r-review', 'Reply with the single word ok.');
  await until(() => ['r-idle', 'r-review'].every((n) => { const s = byName(n); return s && s.state === 'ready' && s.lastAnswer; }), 120000, 1500).catch(() => {});
  atrium('seen', 'r-idle');
  // 끝남
  atrium('input', 'x-done', '/exit\\r');
  await until(() => byName('x-done').state === 'exited', 60000, 1000).catch(() => {});
  // 셸 명령
  atrium('input', 'sh-run', 'ping -n 1200 127.0.0.1\\r');
  atrium('input', 'wt-run', 'ping -n 1200 127.0.0.1\\r');
  // 덩어리: w-coder 오른쪽에 r-idle
  try { log('덩어리', atrium('dock', 'r-idle', 'w-coder', '--side', 'right').trim().slice(0, 200)); } catch (e) { log('덩어리 실패', e.message.slice(0, 200)); }
}
// 찍기 직전에 일하는 것과 묻는 것을 다시 돌린다(ping 약 500초)
async function drive() {
  for (const n of ['w-lead', 'w-coder']) { const s = byName(n); if (s.state !== 'working') atrium('send', `@${n}`, LONG(500)); }
  const q = byName('q-ask'); if (q.state !== 'waiting') atrium('send', '@q-ask', 'Use the Bash tool to run exactly: mkdir p85-ask-dir . Then reply with the single word done.');
  await until(() => byName('w-lead').state === 'working' && byName('w-coder').state === 'working' && byName('q-ask').state === 'waiting', 120000, 1500).catch(() => {});
  const st = Object.fromEntries(sessions().map((s) => [s.name, `${s.state}${s.unseen ? '+unseen' : ''}`]));
  log(`상태 ${JSON.stringify(st)}`);
  return st;
}

// ---------- 화면 재기 ----------
// 새 세션 노드(16:9 보통)는 월드 1440px 폭이라 얼굴 경계(화면 360·200·140px)가 배율 0.25·0.139·0.097쯤이다
const ZOOMS = [['close', 0.42], ['middle', 0.2], ['far', 0.12], ['farthest', 0.07]];
// 판 위 시험 장면의 테두리 상자 가운데에 배율 z로 맞춘다
const centerAt = (pg, z) => pg.evaluate((zz) => {
  const st = window.__mt.getState();
  const rs = [...st.nodes].filter(([id]) => st.sessions.has(id) && !String(id).startsWith('p85fake-')).map(([, r]) => r);
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  const c = document.querySelector('.react-flow').getBoundingClientRect();
  st.setViewport({ x: c.width / 2 - ((x0 + x1) / 2) * zz, y: c.height / 2 - ((y0 + y1) / 2) * zz, zoom: zz });
}, z);
// 스크린숏 픽셀에서 노드마다: 테두리 둘레(바깥 1~7px, 테두리 2px)의 바탕과의 색 거리 평균, 안쪽 밝기 평균
const MEASURE = async ({ png, bg }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/png;base64,${png}`; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, cv.width, cv.height).data;
  const k = img.width / window.innerWidth;
  const px = (x, y) => { const X = Math.round(x * k), Y = Math.round(y * k); if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) return null; const i = (Y * cv.width + X) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const dist = (c) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sat = (c) => Math.max(...c) - Math.min(...c);
  const out = [];
  for (const el of document.querySelectorAll('.mt-node[data-name], .mt-cv[data-convo]')) {
    const r = el.getBoundingClientRect();
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight || r.width < 4) continue;
    let ring = [], border = [], fill = [];
    const step = Math.max(2, Math.min(r.width, r.height) / 40);
    for (let d = 1; d <= 7; d += 2) for (let t = 0; t <= 1.0001; t += step / Math.max(r.width, r.height)) {
      for (const p of [[r.left + t * r.width, r.top - d], [r.left + t * r.width, r.bottom + d], [r.left - d, r.top + t * r.height], [r.right + d, r.top + t * r.height]]) { const c = px(...p); if (c) ring.push(c); }
    }
    for (let t = 0.1; t <= 0.9; t += 0.04) for (const p of [[r.left + t * r.width, r.top + 1], [r.left + t * r.width, r.bottom - 1], [r.left + 1, r.top + t * r.height], [r.right - 1, r.top + t * r.height]]) { const c = px(...p); if (c) border.push(c); }
    for (let a = 0.15; a < 0.9; a += 0.1) for (let b = 0.2; b < 0.9; b += 0.1) { const c = px(r.left + a * r.width, r.top + b * r.height); if (c) fill.push(c); }
    const mean = (xs, f) => (xs.length ? xs.reduce((s, c) => s + f(c), 0) / xs.length : 0);
    out.push({ name: el.dataset.name || `convo:${el.dataset.convo}`, state: [...el.classList].find((c) => c.startsWith('st-')) || 'convo', face: el.dataset.face, w: Math.round(r.width),
      ring: +mean(ring, dist).toFixed(1), border: +mean(border, dist).toFixed(1), borderSat: +mean(border, sat).toFixed(1), fill: +mean(fill, lum).toFixed(1) });
  }
  return out;
};
const TIER = (st) => (/working|starting|shell_running/.test(st) ? 'work' : /waiting|trust_wait/.test(st) ? 'turn' : /sleeping/.test(st) ? 'sleep' : /exited/.test(st) ? 'done' : st === 'convo' ? 'convo' : 'rest');
function summarize(rows) {
  const g = {};
  for (const r of rows) { const t = TIER(r.state); (g[t] ||= []).push(r); }
  const avg = (xs, k) => +(xs.reduce((s, r) => s + r[k], 0) / xs.length).toFixed(1);
  const sum = Object.fromEntries(Object.entries(g).map(([t, xs]) => [t, { n: xs.length, ring: avg(xs, 'ring'), border: avg(xs, 'border'), borderSat: avg(xs, 'borderSat'), fill: avg(xs, 'fill') }]));
  const w = sum.work, rest = sum.rest;
  if (w && rest) sum.ratio = { ring: +(w.ring / Math.max(1, rest.ring)).toFixed(2), border: +(w.border / Math.max(1, rest.border)).toFixed(2) };
  return sum;
}
async function measureShot(pg, file, bg = [7, 7, 5]) {
  const buf = await pg.screenshot({ path: path.join(OUT, `${file}.png`) });
  log(`스크린숏 experiments/p85/${file}.png`);
  const rows = await pg.evaluate(MEASURE, { png: buf.toString('base64'), bg });
  return { rows, sum: summarize(rows) };
}

// ---------- 성능: 가짜 세션 100개 ----------
const ADD_FAKES = (n) => {
  const st = window.__mt.getState();
  const real = [...st.sessions.values()].filter((s) => s.kind !== 'shell' && s.state !== 'sleeping');
  const tmpl = real[0];
  const tn = st.nodes.get(tmpl.sessionId);
  const xs = [...st.nodes.values()]; const right = Math.max(...xs.map((r) => r.x + r.w)) + 400, top = Math.min(...xs.map((r) => r.y));
  const states = ['working', 'ready', 'working', 'shell_running', 'ready', 'waiting', 'ready', 'exited', 'ready', 'working'];
  const sessions = new Map(st.sessions), nodes = new Map(st.nodes);
  for (let i = 0; i < n; i++) {
    const id = `p85fake-${i}`; const state = states[i % states.length];
    sessions.set(id, { ...tmpl, sessionId: id, name: `fake-${i}`, state, kind: state === 'shell_running' ? 'shell' : tmpl.kind, unseen: false, ask: null, delivering: 0, quiet: false });
    nodes.set(id, { ...tn, w: 640, h: 360, x: right + (i % 10) * 700, y: top + Math.floor(i / 10) * 420 });
  }
  st.sessions = sessions; st.nodes = nodes; window.__mt.setFocus(null);
  return { n, w: tn.w, h: tn.h };
};
const DROP_FAKES = () => { const st = window.__mt.getState(); const s = new Map(st.sessions), nd = new Map(st.nodes); for (const id of [...s.keys()]) if (String(id).startsWith('p85fake-')) { s.delete(id); nd.delete(id); } st.sessions = s; st.nodes = nd; window.__mt.setFocus(null); };
async function frames(pg, ms, during) {
  await pg.evaluate(() => { window.__fr = []; let last = performance.now(); window.__frOn = true; const tick = (t) => { window.__fr.push(t - last); last = t; if (window.__frOn) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const t0 = Date.now();
  if (during) await during(); else await sleep(ms);
  const el = Date.now() - t0;
  const f = await pg.evaluate(() => { window.__frOn = false; return window.__fr.slice(2); });
  const s = [...f].sort((a, b) => a - b);
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
  return { ms: el, frames: f.length, fps: +(f.length / (el / 1000)).toFixed(1), p50: q(0.5), p95: q(0.95), max: +s[s.length - 1].toFixed(1), over50: f.filter((x) => x > 50).length };
}
async function perf(pg, label) {
  const out = {};
  out.fakes = await pg.evaluate(ADD_FAKES, 100);
  await sleep(2500);
  await pg.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1500);
  const info = () => pg.evaluate(() => ({ zoom: +window.__mt.getState().vpNow.zoom.toFixed(3), nodes: document.querySelectorAll('.mt-node').length, faces: [...document.querySelectorAll('.mt-node')].reduce((m, e) => { m[e.dataset.face] = (m[e.dataset.face] || 0) + 1; return m; }, {}), anims: document.getAnimations().length, run: document.querySelectorAll('.mt-node-run').length }));
  out.fit = await info();
  await measureShot(pg, `${STAGE}-perf-fit`);
  out.idleFit = await frames(pg, 5000);
  // 멀리 얼굴이 되는 배율(0.3)로 가짜 판 가운데
  await pg.evaluate(() => { const st = window.__mt.getState(); const r = st.nodes.get('p85fake-55'); const c = document.querySelector('.react-flow').getBoundingClientRect(); st.setViewport({ x: c.width / 2 - (r.x + r.w / 2) * 0.3, y: c.height / 2 - (r.y + r.h / 2) * 0.3, zoom: 0.3 }); });
  await sleep(1500);
  out.far = await info();
  await measureShot(pg, `${STAGE}-perf-far`);
  out.idleFar = await frames(pg, 5000);
  // 휠 줌(들어가고 나오기)
  await pg.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(800);
  const box = await pg.$eval('.react-flow', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + r.height / 2 }; });
  await pg.mouse.move(box.x, box.y);
  out.wheel = await frames(pg, 0, async () => { for (let i = 0; i < 24; i++) { await pg.mouse.wheel(0, -100); await sleep(30); } for (let i = 0; i < 24; i++) { await pg.mouse.wheel(0, 100); await sleep(30); } await sleep(400); });
  await pg.evaluate(DROP_FAKES); await sleep(1500);
  log(`성능 ${label} ${JSON.stringify(out)}`);
  return out;
}

// ---------- 휴대폰 ----------
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
async function phone(report) {
  const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
  const { chromium } = await import('playwright');
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  const sim = startTsSim({ listen: BOARD.sim, target: BOARD.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const BASE = baseOf(BOARD.sim);
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const browser = await chromium.launch({ headless: true, ...(found ? { executablePath: found } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  try {
    const ctx = await browser.newContext(PHONE);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => log(`[phone pageerror] ${e.message}`));
    await pg.goto(`${BASE}/`);
    await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
    await pg.fill('[data-field=pair-code]', call('device.code').code);
    await pg.tap('[data-action=pair-submit]');
    await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 });
    await pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    report.phone = {};
    for (const [label, z] of [['close', 0.26], ['middle', 0.12], ['farthest', 0.06]]) {
      await centerAt(pg, z); await sleep(1800);
      const m = await measureShot(pg, `${STAGE}-phone-${label}`);
      report.phone[label] = m.sum;
      log(`휴대폰 ${label} ${JSON.stringify(m.sum)}`);
    }
    if (STAGE === 'after') {
      // 레일의 "작업 중만 또렷하게" 단추(휴대폰 보드 화면에도 레일이 있다)
      const btn = await pg.$('[data-action=spotlight]');
      check('휴대폰: 레일에 작업 중만 또렷하게 단추', !!btn);
      if (btn) {
        await btn.tap(); await sleep(800);
        await centerAt(pg, 0.12); await sleep(1500);
        const m = await measureShot(pg, `${STAGE}-phone-middle-spotlight`);
        report.phone.middleSpotlight = m.sum;
        await pg.$eval('[data-action=spotlight]', (e) => e.click()); await sleep(400);
      }
    }
  } finally { await browser.close().catch(() => {}); try { sim.close && sim.close(); } catch {} }
}

// ---------- 본 시험 ----------
let app = null, page = null;
const report = { stage: STAGE };
try {
  log(atrium('backend', 'start').trim().slice(0, 300));
  try { atrium('settings', 'set', 'tray', 'off'); } catch (e) { log('트레이 끄기 실패', e.message.slice(0, 120)); }
  try { atrium('settings', 'set', 'language', 'ko'); } catch {}
  const have = sessions().map((s) => s.name);
  if (process.env.P85_FRESH === '1' || !['w-lead', 'q-ask', 'sh-run', 'z-nap'].every((n) => have.includes(n))) await setupScene();
  report.states = await drive();

  const { _electron: electron } = await import('playwright');
  app = await electron.launch({ args: ['.', '--dev', `--remote-debugging-port=${BOARD.cdp}`], cwd: APP_ROOT, env: process.env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await page.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  if (STAGE === 'after') await page.evaluate(() => { try { localStorage.removeItem('mt.spotlight'); } catch {} });

  // 1. 배율 네 단계
  report.pc = {};
  for (const [label, z] of ZOOMS) {
    await centerAt(page, z); await sleep(2000);
    const m = await measureShot(page, `${STAGE}-pc-${label}`);
    report.pc[label] = m;
    log(`PC ${label} ${JSON.stringify(m.sum)}`);
  }
  // 2. 움직임과 규칙(고친 뒤): 일하는 노드는 멀리서 둘레가 돈다, 쉬는 노드는 뒤로, 내 차례는 깜빡임(주황), 움직임 줄이기면 멈춘다
  await centerAt(page, 0.12); await sleep(1500);
  const look = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.mt-node[data-name]')].map((e) => { const cs = getComputedStyle(e); const run = e.querySelector('.mt-node-run'); const rcs = run ? getComputedStyle(run) : null; const sp = run && run.firstElementChild ? getComputedStyle(run.firstElementChild) : null; return [e.dataset.name, { tier: e.dataset.tier || null, face: e.dataset.face, borderColor: cs.borderTopColor, borderW: cs.borderTopWidth, shadow: cs.boxShadow.slice(0, 80), anim: cs.animationName, opacity: cs.opacity, run: !!run, runAnim: sp ? sp.animationName : null, runShown: rcs ? rcs.display !== 'none' : false }]; })));
  report.look = await look();
  log(`모습 ${JSON.stringify(report.look)}`);
  const L0 = report.look;
  judge('일하는 노드(w-lead, sh-run)는 멀리서 둘레가 돈다', L0['w-lead'] && L0['w-lead'].runAnim && L0['w-lead'].runAnim !== 'none' && L0['sh-run'] && L0['sh-run'].runAnim && L0['sh-run'].runAnim !== 'none', { lead: L0['w-lead'], sh: L0['sh-run'] });
  judge('쉬는·끝난·잠든 노드는 둘레가 없다', ['r-idle', 'x-done', 'sh-idle', 'z-nap'].every((n) => !L0[n] || !L0[n].run), {});
  judge('내 차례(q-ask)는 일하는 것과 다른 표시(주황 깜빡임, 둘레 없음)', L0['q-ask'] && L0['q-ask'].anim === 'mt-wait' && !L0['q-ask'].run, L0['q-ask']);
  judge('덩어리 안 일하는 칸(w-coder)도 둘레가 돈다', L0['w-coder'] && L0['w-coder'].runAnim && L0['w-coder'].runAnim !== 'none', L0['w-coder']);
  const wt = await page.evaluate(() => [...document.querySelectorAll('.mt-wtarea')].map((e) => ({ branch: e.dataset.branch, cls: e.className, line: getComputedStyle(e.querySelector('.mt-region-box')).borderTopColor, shadow: getComputedStyle(e.querySelector('.mt-region-box')).boxShadow.slice(0, 60) })));
  report.wt = wt; log(`워크트리 상자 ${JSON.stringify(wt)}`);
  judge('워크트리 상자: 도는 상자와 쉬는 상자가 다르게 보인다', wt.length >= 2 && new Set(wt.map((w) => w.line + w.shadow)).size >= 2, wt);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await sleep(600);
  report.lookReduced = await look();
  const LR = report.lookReduced;
  judge('움직임 줄이기: 둘레와 깜빡임이 멈춘다', LR['w-lead'] && (!LR['w-lead'].runAnim || LR['w-lead'].runAnim === 'none') && LR['q-ask'] && LR['q-ask'].anim === 'none', { lead: LR['w-lead'], ask: LR['q-ask'] });
  await measureShot(page, `${STAGE}-pc-far-reduced`);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await sleep(400);

  // 3. 작업 중만 또렷하게(고친 뒤): 레일 단추, 창 프로필에 남음
  if (STAGE === 'after') {
    const btn = page.locator('[data-action=spotlight]');
    check('레일에 작업 중만 또렷하게 단추', (await btn.count()) === 1);
    await btn.click(); await sleep(600);
    const on = await page.evaluate(() => ({ cls: document.documentElement.classList.contains('mt-spot'), saved: localStorage.getItem('mt.spotlight'), pressed: document.querySelector('[data-action=spotlight]').getAttribute('aria-pressed') }));
    check('누르면 켜지고 창 프로필(localStorage)에 남는다', on.cls && on.saved === '1' && on.pressed === 'true', on);
    for (const [label, z] of [['middle', 0.2], ['far', 0.12]]) { await centerAt(page, z); await sleep(1500); const m = await measureShot(page, `${STAGE}-pc-${label}-spotlight`); report.pc[`${label}Spotlight`] = m; log(`PC ${label} 또렷하게 ${JSON.stringify(m.sum)}`); }
    await page.reload(); await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 60000 }); await sleep(2500);
    const kept = await page.evaluate(() => document.documentElement.classList.contains('mt-spot'));
    check('다시 열어도 켜진 채', kept, { kept });
    await page.locator('[data-action=spotlight]').click(); await sleep(400);
    const off = await page.evaluate(() => ({ cls: document.documentElement.classList.contains('mt-spot'), saved: localStorage.getItem('mt.spotlight') }));
    check('다시 누르면 꺼진다', !off.cls && off.saved !== '1', off);
  }

  // 4. 성능
  report.perf = await perf(page, 'motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  report.perfReduced = await perf(page, 'reduced');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (STAGE === 'after') {
    const a = report.perf, b = report.perfReduced;
    judge('성능: 가짜 세션 100개, 멈춘 화면 p95가 움직임 줄이기와 비슷하다(+8ms 안)', a.idleFit.p95 <= b.idleFit.p95 + 8 && a.idleFar.p95 <= b.idleFar.p95 + 8, { motion: [a.idleFit, a.idleFar], reduced: [b.idleFit, b.idleFar] });
    judge('성능: 휠 줌 p95가 움직임 줄이기와 비슷하다(+8ms 안)', a.wheel.p95 <= b.wheel.p95 + 8, { motion: a.wheel, reduced: b.wheel });
  }

  // 5. 휴대폰 보드 화면
  await phone(report);
} catch (e) {
  log(`오류 ${e.stack || e.message}`);
  check('시험이 끝까지 돌았다', false, e.message);
} finally {
  if (app) { try { await app.close(); } catch {} }
  fs.writeFileSync(path.join(OUT, `p85-${STAGE}.json`), JSON.stringify({ report, results }, null, 1));
  const fail = results.filter((r) => !r.ok).length;
  log(`끝: ${results.length}개 중 실패 ${fail}`);
  process.exitCode = fail ? 1 : 0;
}
