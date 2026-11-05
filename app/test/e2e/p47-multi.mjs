// P47 창 시험(원격 R1): 한 백엔드에 창(클라이언트) 둘. 창 A(프로필 app)와 창 B(프로필 app2)를 띄워
//   1. 두 창이 서로를 "다른 기기 1"로 본다
//   2. 두 창이 같은 셸·claude(haiku) 노드를 함께 보고, 한쪽에서 친 글이 양쪽에 보인다. 뺏기 없이 둘 다 계속 화면을 받는다. 제어기는 패널마다 하나
//   3. 한쪽에서 화면을 옮겨도 다른 쪽 화면 위치는 그대로다(클라이언트별 viewport, 다시 읽어도 자기 값)
//   4. 노드 칸 크기가 다른 두 창에서 크기 정하는 기기가 바뀔 때, 두 창의 xterm 크기와 글이 같고 크기를 갖지 않은 창은 비율로 그려 잘리지 않는다
//   5. 알림은 최근에 쓴 창에서만 뜬다(창의 notifyLog와 main의 알림 기록). 한쪽에서 승인 카드에 답하면 다른 쪽 카드도 닫힌다
//   6. 한쪽에서 노드를 옮기거나 메모를 고치면 다른 쪽에 바로 보인다
//   7. 지연 프록시(backend/tools/delay-proxy.mjs) 0·50·100·200ms 위에서 세 번째 클라이언트(시험 하네스)의 입력 → 화면 프레임 시간
// 판: herdr 세션 atrium-dev-p47, 포트 47865, 이 워크트리의 backend/.dev(experiments/p47/tools/env.cjs). claude는 --model haiku.
// 사용: node experiments/p47/tools/e2e.cjs p47-multi.mjs [--fresh] [--no-claude] [--no-latency] [--tag 이름]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p47') throw new Error('MT_E2E_OUT=p47를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p47', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P47_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
const ENV2 = { ...ENV, ATRIUM_APP_USERDATA: path.join(T.DEV, 'app2') };
assertTestBoard(ENV, { root: T.DEV }); assertTestBoard(ENV2, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p47' || ENV.ATRIUM_PORT !== '47865') throw new Error('P47 판(atrium-dev-p47, 47865)만');
if (!/^C:\\Workspace\\mtask-p47-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p47-*만: ${T.DIR}`);
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'p47-multi';
const log = logger(TAG);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const envA = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const envB = { ...cleanEnv(), ...ENV2, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: envA, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 800)); };

if (argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), path.join(T.DEV, 'app2'), T.PROJECTS, T.SESSIONS]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });

const W = {}; // 'A' | 'B' → { app, page, name }
const ready = (page) => page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.getState().conn === 'open', null, { timeout: 90000 });
async function open(key, env, name) {
  const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[${key} pageerror] ${e.message}`));
  await ready(page);
  // 같은 PC의 두 창이라 기기 이름(호스트 이름)이 같다. 시험에서는 창마다 이름을 준다
  await page.evaluate((n) => { localStorage.setItem('mt.clientName', n); window.__mt.pinBottom && window.__mt.pinBottom(true); }, name);
  await page.reload(); await ready(page);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(600);
  W[key] = { app, page, name, mainPid: await app.evaluate(() => process.pid) };
  log(`창 ${key} 열림 main pid=${W[key].mainPid} client=${await page.evaluate(() => window.__mt.api.clientId)}`);
}
const ev = (k, fn, arg) => W[k].page.evaluate(fn, arg);
const call = (k, m, p = {}) => ev(k, ([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const shot = async (k, name) => { const f = path.join(OUT, `${TAG}-${k}-${name}.png`); await W[k].page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };

const ids = {};
async function spawn(name, ...extra) {
  log(lastLine(atrium('spawn', T.DIR, '--name', name, ...extra)));
  ids[name] = await until(() => ev('A', (n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name), 30000);
}
const stateOf = (k, id) => ev(k, (i) => { const s = window.__mt.getState().sessions.get(i); return s ? { state: s.state, ask: !!s.ask } : null; }, id);
async function view(k, id, zoom = 1) {
  await ev(k, ([i, z]) => { const st = window.__mt.getState(); const r = st.nodes.get(i); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - (r.x + r.w / 2) * z, y: el.clientHeight / 2 - (r.y + r.h / 2) * z, zoom: z }); }, [id, zoom]);
  await sleep(900);
}
// 터미널: 칸 수, 보이는 줄 글, 비율, 화면이 칸 안에 들어가는지, 덮개(놓임)
const term = (k, id) => ev(k, (i) => {
  const t = window.__mt.terms.get(i);
  const host = document.querySelector(`.mt-term[data-session="${i}"]`);
  if (!t || !host) return null;
  const b = t.buffer.active, rows = [];
  for (let r = 0; r < t.rows; r++) { const l = b.getLine(b.viewportY + r); rows.push(l ? l.translateToString(true) : ''); }
  const hr = host.getBoundingClientRect(), sr = (host.querySelector('.xterm-screen') || host).getBoundingClientRect();
  const wrap = host.closest('.mt-term-wrap');
  return { cols: t.cols, rows: t.rows, text: rows, scale: Number(host.dataset.scale || 1), fits: sr.right <= hr.right + 1.5 && sr.bottom <= hr.bottom + 1.5 && sr.left >= hr.left - 1.5 && sr.top >= hr.top - 1.5, screen: { w: Math.round(sr.width), h: Math.round(sr.height) }, box: { w: Math.round(hr.width), h: Math.round(hr.height) }, cover: !!(wrap && wrap.querySelector('.mt-term-cover')), sizeBy: !!(wrap && wrap.querySelector('[data-role=term-sizeby]')), typing: wrap && wrap.querySelector('[data-role=term-typing]') ? wrap.querySelector('[data-role=term-typing]').textContent : null };
}, id);
const has = (tm, s) => !!tm && tm.text.some((l) => l.includes(s));
const relayOf = async (id) => ((await call('A', 'backend.status')).relay || []).filter((r) => r.sessionId === id);
async function typeIn(k, id, text) {
  await W[k].page.click(`.mt-term[data-session="${id}"]`, { position: { x: 60, y: 30 } });
  await sleep(150);
  await W[k].page.keyboard.type(text, { delay: 15 });
}
const trimRows = (rows) => { const r = rows.map((l) => l.replace(/\s+$/, '')); while (r.length && !r[r.length - 1]) r.pop(); return r; };

let proxy = null, wsClient = null;
try {
  await open('A', envA, 'PC-A');
  await open('B', envB, 'PC-B');

  // 1. 다른 기기 n
  const peersA = await until(() => ev('A', () => { const el = document.querySelector('[data-role=peers]'); return el ? { n: el.dataset.n, text: el.textContent } : null; }), 15000).catch(() => null);
  const peersB = await until(() => ev('B', () => { const el = document.querySelector('[data-role=peers]'); return el ? { n: el.dataset.n, text: el.textContent } : null; }), 15000).catch(() => null);
  step('1 두 창이 서로를 다른 기기 1로 본다', peersA && peersA.n === '1' && peersB && peersB.n === '1', { peersA, peersB, list: (await call('A', 'clients.list')).clients.map((c) => [c.name, c.kind]) });
  await shot('A', '1-peers');

  // 2. 함께 보기
  if (!(await ev('A', () => [...window.__mt.getState().sessions.values()].some((s) => s.name === 'sh1')))) await spawn('sh1', '--kind', 'shell');
  else ids.sh1 = await ev('A', () => [...window.__mt.getState().sessions.values()].find((s) => s.name === 'sh1').sessionId);
  const SH = ids.sh1;
  await view('A', SH); await view('B', SH);
  await until(async () => (await term('A', SH)) && (await term('B', SH)), 20000);
  await until(async () => { const r = await relayOf(SH); return r.length === 1 && r[0].clients >= 2; }, 15000).catch(() => null);
  const rel = await relayOf(SH);
  step('2a 제어기는 패널 하나에 하나, 두 창이 붙음', rel.length === 1 && rel[0].clients === 2, rel);
  await typeIn('A', SH, 'echo AAA47\r');
  const bothA = await until(async () => has(await term('A', SH), 'AAA47') && has(await term('B', SH), 'AAA47'), 10000).then(() => true, () => false);
  const typingB = await until(async () => (await term('B', SH)).typing, 3000).catch(() => null);
  step('2b A에서 친 글이 두 창에 보이고 B에 "입력 중" 표시', bothA && !!typingB, { typingB });
  await typeIn('B', SH, 'echo BBB47\r');
  const bothB = await until(async () => has(await term('A', SH), 'BBB47') && has(await term('B', SH), 'BBB47'), 10000).then(() => true, () => false);
  const ta = await term('A', SH), tb = await term('B', SH);
  step('2c B에서 친 글도 두 창에 보이고 뺏김(덮개)이 없다', bothB && !ta.cover && !tb.cover, { coverA: ta.cover, coverB: tb.cover });
  await shot('A', '2-shared'); await shot('B', '2-shared');

  // 3. 화면 위치는 창마다
  await sleep(500);
  const vpB0 = await ev('B', () => window.__mt.getState().vpNow);
  await ev('A', () => window.__mt.getState().setViewport({ x: -3000, y: -2000, zoom: 0.4 }));
  await sleep(1500);
  const vpB1 = await ev('B', () => window.__mt.getState().vpNow);
  const gA = (await call('A', 'board.get')).viewport, gB = (await call('B', 'board.get')).viewport;
  step('3a A가 화면을 옮겨도 B의 화면 위치는 그대로, 저장 값도 창마다', JSON.stringify(vpB0) === JSON.stringify(vpB1) && gA && gB && gA.zoom === 0.4 && Math.abs(gB.zoom - vpB0.zoom) < 0.01, { vpB0, vpB1, gA, gB });
  await W.B.page.reload(); await ready(W.B.page); await sleep(800);
  const vpB2 = await ev('B', () => window.__mt.getState().viewport);
  step('3b B를 다시 읽어도 B의 값에서 시작', vpB2 && Math.abs(vpB2.zoom - vpB0.zoom) < 0.01 && Math.abs(vpB2.x - vpB0.x) < 2, { vpB2 });
  await view('A', SH); await view('B', SH);
  await until(async () => (await term('A', SH)) && (await term('B', SH)), 20000);

  // 4. 크기 정하는 기기. B의 칸을 30% 줄여(웹 화면이나 다른 배치를 흉내) 두 창이 바라는 열×행을 다르게 한다
  async function shrinkB(id) {
    await ev('B', (i) => { const st = document.createElement('style'); st.dataset.p47 = i; st.textContent = `.mt-term[data-session="${i}"] { right: 30% !important; bottom: 30% !important; }`; document.head.appendChild(st); }, id);
    await sleep(900);
  }
  async function sizeCheck(label, id, owner) {
    await sleep(1500);
    const a = await term('A', id), b = await term('B', id);
    const r = (await relayOf(id))[0] || {};
    const own = owner === 'A' ? a : b, other = owner === 'A' ? b : a;
    const sameText = JSON.stringify(trimRows(a.text)) === JSON.stringify(trimRows(b.text));
    const ok = a.cols === b.cols && a.rows === b.rows && sameText && own.scale === 1 && other.fits && other.scale !== 1 && other.sizeBy && !own.sizeBy && r.cols === a.cols && r.rows === a.rows;
    step(`4 ${label}`, ok, { owner, relay: { cols: r.cols, rows: r.rows, owner: r.owner, clients: r.clients }, A: { cols: a.cols, rows: a.rows, scale: a.scale, fits: a.fits, box: a.box, screen: a.screen }, B: { cols: b.cols, rows: b.rows, scale: b.scale, fits: b.fits, box: b.box, screen: b.screen }, sameText });
    return { a, b };
  }
  await shrinkB(SH);
  await typeIn('B', SH, 'echo own-B\r');
  await sizeCheck('셸: B가 쳐서 크기를 가짐(A는 늘려 그림)', SH, 'B');
  await shot('A', '4-shell-ownerB'); await shot('B', '4-shell-ownerB');
  await W.A.page.click(`.mt-term[data-session="${SH}"]`, { position: { x: 60, y: 30 } }); // 초점만 준다
  await sizeCheck('셸: A가 초점을 줘서 가져감(B는 줄여 그림)', SH, 'A');
  await shot('A', '4-shell-ownerA'); await shot('B', '4-shell-ownerA');
  await typeIn('B', SH, 'echo back-B\r');
  const sh3 = await sizeCheck('셸: B가 다시 쳐서 가져감', SH, 'B');
  step('4 셸: 바뀌는 동안 친 글이 두 창에 남는다', has(sh3.a, 'back-B') && has(sh3.b, 'back-B'));

  if (!argv.includes('--no-claude')) {
    if (!(await ev('A', () => [...window.__mt.getState().sessions.values()].some((s) => s.name === 'cl1')))) await spawn('cl1', '--model', 'haiku');
    else ids.cl1 = await ev('A', () => [...window.__mt.getState().sessions.values()].find((s) => s.name === 'cl1').sessionId);
    const CL = ids.cl1;
    await until(async () => { const s = await stateOf('A', CL); return s && !['starting', 'working'].includes(s.state); }, 120000).catch(() => null);
    log('cl1', JSON.stringify(await stateOf('A', CL)));
    log(lastLine(atrium('send', '@cl1', 'Reply with the integers from 1 to 25, one per line, plain text only. Do not use any tools.', '--wait')));
    await until(async () => { const s = await stateOf('A', CL); return s && !['working', 'starting'].includes(s.state); }, 120000).catch(() => null);
    await view('A', CL); await view('B', CL);
    await until(async () => (await term('A', CL)) && (await term('B', CL)), 20000);
    await shrinkB(CL);
    await W.B.page.click(`.mt-term[data-session="${CL}"]`, { position: { x: 60, y: 30 } });
    await sizeCheck('claude: B가 초점을 줘서 가져감', CL, 'B');
    await shot('A', '4-claude-ownerB'); await shot('B', '4-claude-ownerB');
    await W.A.page.click(`.mt-term[data-session="${CL}"]`, { position: { x: 60, y: 30 } });
    const c2 = await sizeCheck('claude: A가 초점을 줘서 가져감', CL, 'A');
    await shot('A', '4-claude-ownerA'); await shot('B', '4-claude-ownerA');
    step('4 claude: 답(1~25 가운데 몇 줄)이 두 창에 같은 글로 보인다', c2.a.text.some((l) => /^\s*2[0-5]\s*$/.test(l) || /\b2[0-5]\b/.test(l)), { tail: trimRows(c2.a.text).slice(-12) });

    // 5. 알림: 최근에 쓴 창만. cl1을 두 창 모두 화면 밖에 두고(보이면 알림을 띄우지 않는다) 승인 대기를 만든다
    for (const k of ['A', 'B']) await ev(k, () => window.__mt.getState().setViewport({ x: 4000, y: 4000, zoom: 0.5 }));
    await sleep(800);
    async function notifyRound(activeKey, n, answerFrom) {
      await call(activeKey, 'client.active');
      await sleep(300);
      const peers = await call('A', 'clients.list');
      const activeId = await ev(activeKey, () => window.__mt.api.clientId);
      const before = { A: (await ev('A', () => window.__mt.notifyLog.length)), B: (await ev('B', () => window.__mt.notifyLog.length)) };
      const mainBefore = { A: await W.A.app.evaluate(() => global.__mtNotifications.length), B: await W.B.app.evaluate(() => global.__mtNotifications.length) };
      atrium('send', '@cl1', `Use the Bash tool to run exactly this command: touch p47-notify-${n}.txt`); // echo는 승인 없이 돈다. 파일을 쓰는 명령이라 승인을 묻는다(거절로 답한다)
      await until(async () => (await stateOf('A', CL)).state === 'waiting', 90000);
      await sleep(2500);
      const logs = { A: await ev('A', ([i, from]) => window.__mt.notifyLog.slice(from).filter((x) => x.sessionId === i), [CL, before.A]), B: await ev('B', ([i, from]) => window.__mt.notifyLog.slice(from).filter((x) => x.sessionId === i), [CL, before.B]) };
      const mains = { A: await W.A.app.evaluate((_e, from) => global.__mtNotifications.slice(from).map((r) => ({ sessionId: r.sessionId, source: r.source || 'window' })), mainBefore.A), B: await W.B.app.evaluate((_e, from) => global.__mtNotifications.slice(from).map((r) => ({ sessionId: r.sessionId, source: r.source || 'window' })), mainBefore.B) };
      const other = activeKey === 'A' ? 'B' : 'A';
      const ok = peers.notify === activeId && logs[activeKey].some((x) => x.notify) && logs[other].length > 0 && logs[other].every((x) => !x.notify && x.why === 'other-client') && mains[activeKey].some((r) => r.sessionId === CL) && !mains[other].some((r) => r.sessionId === CL);
      step(`5 알림 ${n}: 최근에 쓴 창 ${activeKey}에서만 뜬다`, ok, { notify: peers.notify, activeId, logs: { A: logs.A.map((x) => [x.notify, x.why]), B: logs.B.map((x) => [x.notify, x.why]) }, mains });
      // 한쪽에서 답하면 다른 쪽 카드도 닫힌다
      const cardBefore = { A: await stateOf('A', CL), B: await stateOf('B', CL) };
      await call(answerFrom, 'session.answer', { session: CL, choice: 'reject' }).catch((e) => log('answer', e.message));
      const closed = await until(async () => { const a = await stateOf('A', CL), b = await stateOf('B', CL); return a.state !== 'waiting' && b.state !== 'waiting' && !a.ask && !b.ask; }, 30000).then(() => true, () => false);
      step(`5 알림 ${n}: ${answerFrom}에서 답하면 두 창 모두 대기·카드가 풀린다`, cardBefore.A.ask && cardBefore.B.ask && closed, { cardBefore, after: { A: await stateOf('A', CL), B: await stateOf('B', CL) } });
      await until(async () => !['working'].includes((await stateOf('A', CL)).state), 60000).catch(() => null);
    }
    await notifyRound('B', 1, 'A');
    await notifyRound('A', 2, 'B');
  }

  // 6. 보드 편집이 두 창에 맞게 보인다
  const nA = await ev('A', (i) => window.__mt.getState().nodes.get(i), SH);
  await call('A', 'board.setNode', { session: SH, x: Math.round(nA.x) + 40, y: Math.round(nA.y) + 20, w: nA.w, h: nA.h, z: nA.z || 0, cause: 'p47-test' });
  const movedB = await until(() => ev('B', ([i, x]) => { const n = window.__mt.getState().nodes.get(i); return n && Math.round(n.x) === x ? n : null; }, [SH, Math.round(nA.x) + 40]), 5000).then(() => true, () => false);
  await call('A', 'board.setNode', { session: SH, x: Math.round(nA.x), y: Math.round(nA.y), w: nA.w, h: nA.h, z: nA.z || 0, cause: 'p47-test' });
  const memo = await call('A', 'memo.create', { text: 'p47 memo', workspace: T.DIR }).catch((e) => ({ error: e.message }));
  const memoId = memo && (memo.memoId || (memo.memo && memo.memo.memoId));
  const memoB = memoId ? await until(() => ev('B', (i) => window.__mt.getState().memos.has(i), memoId), 5000).then(() => true, () => false) : false;
  if (memoId) await call('B', 'memo.update', { memo: memoId, memoId, text: 'p47 memo edited in B' }).catch((e) => log('memo.update', e.message));
  const memoA = memoId ? await until(() => ev('A', (i) => (window.__mt.getState().memos.get(i) || {}).text === 'p47 memo edited in B', memoId), 5000).then(() => true, () => false) : false;
  step('6 노드 옮기기와 메모 만들기·고치기가 다른 창에 바로 보인다', movedB && memoB && memoA, { movedB, memo: memoId || memo, memoB, memoA });
  if (memoId) await call('A', 'memo.delete', { memo: memoId, confirm: true }).catch(() => {});

  // 7. 지연 프록시 위의 세 번째 클라이언트: 입력 → 화면 프레임
  if (!argv.includes('--no-latency')) {
    const { startDelayProxy } = await import(path.join(REPO, 'backend', 'tools', 'delay-proxy.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
    const WS = createRequire(path.join(REPO, 'backend', 'package.json'))('ws');
    const info = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'backend.json'), 'utf8'));
    proxy = startDelayProxy({ listen: 47870, target: Number(ENV.ATRIUM_PORT), delay: 0, jitter: 0, seed: 47, log });
    const port = await proxy.ready;
    await view('A', SH); await view('B', SH);
    const relNow = (await relayOf(SH))[0] || { cols: 100, rows: 30 };
    const lat = [];
    for (const [delay, jitter] of [[0, 0], [50, 5], [100, 10], [200, 20]]) {
      proxy.setDelay(delay, jitter);
      wsClient = new WS(`ws://127.0.0.1:${port}/api?token=${info.token}&client=harness-p47&name=harness&kind=web`);
      await new Promise((res, rej) => { wsClient.once('open', res); wsClient.once('error', rej); });
      let n = 0; const wait = new Map(); const frameWaiters = [];
      wsClient.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.event === 'terminal.frame' && m.data.sessionId === SH) { const w = frameWaiters.shift(); if (w) w(); return; } if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
      const rpc = (method, params) => new Promise((res) => { const id = ++n; wait.set(id, res); wsClient.send(JSON.stringify({ id, method, params })); });
      const tAtt = Date.now();
      await rpc('terminal.attach', { session: SH, cols: relNow.cols, rows: relNow.rows });
      const attachMs = Date.now() - tAtt;
      await sleep(800 + delay * 2);
      frameWaiters.length = 0;
      const samples = [];
      for (let i = 0; i < 16; i++) {
        const ch = i % 2 === 0 ? 'z' : '\x7f';
        const got = new Promise((res) => frameWaiters.push(res));
        const t0 = performance.now();
        wsClient.send(JSON.stringify({ id: ++n, method: 'terminal.input', params: { session: SH, data: ch } }));
        const r = await Promise.race([got.then(() => performance.now() - t0), sleep(3000).then(() => null)]);
        samples.push(r === null ? null : Math.round(r));
        await sleep(150);
      }
      const ok = samples.filter((x) => x !== null).sort((a, b) => a - b);
      const q = (p) => ok.length ? ok[Math.min(ok.length - 1, Math.floor(p * ok.length))] : null;
      const row = { delayOneWay: delay, jitter, attachMs, n: samples.length, missed: samples.filter((x) => x === null).length, median: q(0.5), p90: q(0.9), min: ok[0] ?? null, max: ok.at(-1) ?? null, samples };
      lat.push(row);
      log('지연', JSON.stringify(row));
      await rpc('terminal.detach', { session: SH });
      wsClient.close(); wsClient = null;
      await sleep(300);
    }
    fs.writeFileSync(path.join(OUT, `${TAG}-latency.json`), JSON.stringify(lat, null, 1));
    step('7 지연 프록시 0·50·100·200ms에서 입력 → 프레임을 잼(빠진 것 없음)', lat.every((r) => r.missed === 0), lat.map((r) => [r.delayOneWay, r.median, r.p90]));
    const ta2 = await term('A', SH), tb2 = await term('B', SH);
    step('7 하네스가 붙고 떨어진 뒤에도 두 창은 계속 붙어 있다', ta2 && tb2 && !ta2.cover && !tb2.cover);
  }
} catch (e) {
  step('예외', false, e.stack || e.message);
} finally {
  try { if (wsClient) wsClient.close(); } catch {}
  if (proxy) await proxy.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  const fail = results.filter((r) => !r.ok);
  log(`결과 ${results.length - fail.length}/${results.length} 통과${fail.length ? ` · 실패: ${fail.map((r) => r.name).join(' | ')}` : ''}`);
  for (const k of ['B', 'A']) if (W[k]) await closeApp(W[k].app);
  process.exit(fail.length ? 1 : 0);
}
