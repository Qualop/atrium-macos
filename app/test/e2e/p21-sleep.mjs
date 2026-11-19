// P21 창 시험(ARCH 4절 D4 잠재우기): 쉬는 Claude 세션 잠재우기와 깨우기. P24에서 리포 단위로 고쳤다.
// 잠재우기는 리포 단위이므로 세션마다 리포를 하나씩 준다(시험 폴더 r1, r2, r3, git이 아닌 폴더라 폴더 하나가 리포 하나). 그러면 P21의 확인이 리포 하나씩에 그대로 맞는다.
// 손으로 잠재우기는 노드 메뉴가 아니라 영역 이름표 메뉴, 저절로 잠재우지 않는 까닭은 리포마다(sleep.status repos)다.
// 판: experiments/<MT_E2E_OUT>/tools/env.cjs(DIRS.r1~r3가 있는 판. P24: atrium-dev-p24, 47842). 시험 claude는 haiku 셋(s1, s2, s3)에 짧은 지시
// 사용: node experiments/p24/tools/e2e.cjs p21-sleep.mjs
// 차례: 1 손으로 잠재우기(프로세스·메모리) → 2 잠든 얼굴 → 3 눌러 깨우기(기억) → 4 저절로 잠재우기와 막는 조건 → 5 글 보내 깨우기 → 6 herdr·백엔드 다시 켜기 → 7 트레이로 모두 잠재우기 → 8 잠든 세션 보관·삭제
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';
import { readProcessTable, descendants } from '../../../backend/src/resources.mjs';

if (!['p24'].includes(process.env.MT_E2E_OUT)) throw new Error('MT_E2E_OUT=p24를 명령줄에서 준다(리포 단위 시험 폴더 r1~r3가 있는 판)');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', process.env.MT_E2E_OUT, 'tools', 'env.cjs'));
if (!T.DIRS || !T.DIRS.r1 || !T.DIRS.r2 || !T.DIRS.r3) throw new Error('판 값에 리포 단위 시험 폴더(DIRS.r1~r3)가 없다');
const DIR_OF = { s1: T.DIRS.r1, s2: T.DIRS.r2, s3: T.DIRS.r3 };
const projectOf = (dir) => path.join(os.homedir(), '.claude', 'projects', dir.replace(/[^A-Za-z0-9]/g, '-'));
const ENV = { ...Object.fromEntries(Object.entries(T.P21_ENV).filter(([k]) => k.startsWith('ATRIUM_'))), ATRIUM_SLEEP_TICK_MS: '3000' };
assertTestBoard(ENV, { root: T.DEV });
fs.mkdirSync(OUT, { recursive: true });
for (const d of Object.values(DIR_OF)) fs.mkdirSync(d, { recursive: true });

const log = logger('p21-sleep');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 180000 });
const herdr = (method, params = {}) => JSON.parse(execFileSync(process.execPath, [path.join(REPO, 'experiments', 'p4', 'tools', 'h.mjs'), method, JSON.stringify(params)], { encoding: 'utf8', env }));
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sess = (page, name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, waking: s.waking, sleep: s.sleep, paneId: s.paneId, lastAnswer: s.lastAnswer, lastAnswerAt: s.lastAnswerAt, ask: s.ask, memMB: s.memMB } : null; }, name);
const transcriptOf = (id, n = 's1') => path.join(projectOf(DIR_OF[n]), `${id}.jsonl`);
const toMB = (t) => { const m = /([\d.]+)\s*(GB|MB)/.exec(t || ''); return m ? Number(m[1]) * (m[2] === 'GB' ? 1024 : 1) : null; };
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const WORD = { s1: 'PELICAN-41', s2: 'MAPLE-72', s3: 'COBALT-15' };

const results = [];
const measures = {};
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const waitState = (page, n, states, ms = 120000) => until(async () => { const x = await sess(page, n); return x && [].concat(states).includes(x.state) && !x.waking ? x : null; }, ms, 300);
const pillText = (page) => page.evaluate(() => { const p = document.querySelector('[data-role="resources"] .mono'); return p ? p.textContent : null; });
// 노드 하나에 화면을 맞춘다(노드 너비가 화면에서 px가 되는 배율)
async function viewNode(page, n, px) {
  await page.evaluate(([nn, w]) => {
    const st = window.__mt.getState();
    const s = [...st.sessions.values()].find((x) => x.name === nn);
    const r = st.nodes.get(s.sessionId);
    const el = document.querySelector('.mt-canvas');
    const zoom = w / r.w;
    st.setViewport({ x: el.clientWidth / 2 - (r.x + r.w / 2) * zoom, y: el.clientHeight / 2 - (r.y + r.h / 2) * zoom, zoom });
  }, [n, px]);
  await sleep(900);
}
const face = (page, n) => page.evaluate((nn) => { const el = document.querySelector(`.mt-node[data-name="${nn}"]`); return el ? { face: el.dataset.face, asleep: el.dataset.asleep || null, sleepFace: !!el.querySelector('[data-role="sleep-face"]'), moon: !!el.querySelector('[data-role="icon-moon"], .mt-sleep-moon, .mt-pill .mt-i'), terminal: !!el.querySelector('.xterm'), pill: (el.querySelector('.mt-pill') || {}).textContent || null } : null; }, n);
// 패널의 프로세스(셸과 그 아래 모두): 백엔드의 자원 감시와 같은 셈
async function paneProcs(page, n) {
  const r = await call(page, 'resources.get', { fresh: true });
  const row = r.sessions.find((x) => x.name === n);
  if (!row || !row.shellPid) return { row, procs: [] };
  const table = await readProcessTable();
  return { row, procs: descendants(table.procs, row.shellPid).map((p) => ({ pid: p.pid, name: p.name, mb: Math.round(p.ws / 1048576) })), sessionsMB: r.sessionsMB };
}

try { log('앞 판 백엔드 끄기(지금 코드로 띄우게)', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 끄기 실패', e.message); }
const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
const page = await app.firstWindow();
page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
try {
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await call(page, 'settings.set', { key: 'language', value: 'ko' });
  await call(page, 'settings.set', { key: 'sleepAfterMin', value: 0 });
  for (const d of Object.values(DIR_OF)) await call(page, 'workspace.open', { path: d });

  // 0. haiku claude 셋(리포마다 하나). 준비된 뒤 첫 지시(atrium send --wait), 노드는 세로로 멀리 둔다(한 노드를 볼 때 이웃이 화면에 붙지 않게)
  for (const n of ['s1', 's2', 's3']) if (!(await sess(page, n))) atrium('spawn', DIR_OF[n], '--name', n, '--model', 'haiku');
  for (const n of ['s1', 's2', 's3']) await waitState(page, n, 'ready', 120000);
  const ids = {};
  for (const [i, n] of ['s1', 's2', 's3'].entries()) {
    const s = await sess(page, n); ids[n] = s.id;
    const st = await page.evaluate((id) => window.__mt.getState().nodes.get(id), s.id);
    await call(page, 'board.setNode', { session: s.id, x: st.x, y: i * 1400, w: 720, h: 460, cause: 'p21 test' });
  }
  // board.setNode는 창에 알리지 않으므로 판을 다시 읽는다(창을 다시 불러온다)
  await page.reload();
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  for (const n of ['s1', 's2', 's3']) atrium('send', `@${n}`, `Remember this codeword for later: ${WORD[n]}. Reply with the single word OK.`, '--wait');
  for (const n of ['s1', 's2', 's3']) await until(async () => { const x = await sess(page, n); return x && x.state === 'ready' && x.lastAnswer && fs.existsSync(transcriptOf(x.id, n)); }, 120000, 500);
  step('준비: haiku 셋이 첫 지시에 답하고 대화 기록이 생겼다', true, ids);

  // 1. 손으로 잠재우기(P24: s1 리포의 영역 이름표 메뉴): claude·셸·aside 등 패널 프로세스가 없어지고 메모리 알약이 준다
  await viewNode(page, 's1', 900);
  const before = await paneProcs(page, 's1');
  await sleep(1500);
  const pill0 = await pillText(page);
  log('잠재우기 전', { row: before.row, procs: before.procs, pill: pill0 });
  const r1 = path.basename(DIR_OF.s1);
  await page.click(`.mt-region[data-name="${r1}"] .mt-region-head [data-action="region-acts"]`);
  await sleep(300);
  await page.click(`.mt-region[data-name="${r1}"] .mt-region-head [data-action="region-sleep"]`);
  await until(async () => { const x = await sess(page, 's1'); return x && x.state === 'sleeping' && x.sleep && x.sleep.memMB != null; }, 30000, 200);
  await sleep(1500);
  const alive = before.procs.filter((p) => pidAlive(p.pid));
  const ev1 = (await call(page, 'session.events', { session: 's1', limit: 50 })).filter((e) => e.kind === 'slept').pop();
  await call(page, 'resources.get', { fresh: true });
  await sleep(800);
  const pill1 = await pillText(page);
  const s1z = await sess(page, 's1');
  const agents = herdr('agent.list');
  measures.sleep1 = { procsBefore: before.procs, memBeforeMB: before.row && before.row.memMB, sleptEvent: ev1 && ev1.data, pillBefore: pill0, pillAfter: pill1, alive };
  step('손으로 잠재우기: 패널의 프로세스(셸, claude, MCP 서버)가 모두 끝났다', before.procs.length >= 2 && alive.length === 0, { procs: before.procs.map((p) => p.name), alive });
  step('손으로 잠재우기: 잠든 세션은 패널이 없고 herdr 에이전트 목록에도 없다', s1z.paneId == null && !(agents.agents || []).some((a) => a.name === 's1'), { paneId: s1z.paneId, agents: (agents.agents || []).map((a) => a.name) });
  step('손으로 잠재우기: 메모리 알약이 줄었다', toMB(pill0) != null && toMB(pill1) != null && toMB(pill1) < toMB(pill0), { pill0, pill1 });
  step('잠든 동안 상태 알약은 잠듦, 터미널 대신 잠든 얼굴', (await face(page, 's1')).sleepFace && !(await face(page, 's1')).terminal, await face(page, 's1'));

  // 2. 잠든 얼굴: 가까이, 중간, 멀리, 아이콘
  await shot(page, 'p21-1-close');
  const faces = {};
  for (const [name, px] of [['close', 900], ['middle', 280], ['far', 170], ['icon', 100]]) {
    await viewNode(page, 's1', px);
    faces[name] = await face(page, 's1');
    await shot(page, `p21-2-face-${name}`);
  }
  step('잠든 얼굴: 가까이·중간·멀리는 잠든 요약 얼굴, 아이콘은 달 표시', faces.close.sleepFace && faces.middle.sleepFace && faces.far.sleepFace && faces.icon.face === 'icon' && faces.icon.moon, faces);
  await page.click('[data-role="resources"]');
  await sleep(400);
  await shot(page, 'p21-2-memory-list');
  const memList = await page.evaluate(() => { const l = document.querySelector('[data-role="resources-list"]'); return l ? l.innerText : null; });
  step('메모리 알약 목록에 잠든 세션 수와 아낀 메모리', /잠든 세션 1개/.test(memList || '') && /s1 잠듦/.test(memList || ''), memList);
  await page.keyboard.press('Escape');

  // 3. 눌러 깨우기: 같은 대화 ID로 이어 가고 깨기 전 대화를 기억한다
  await viewNode(page, 's1', 900);
  const tx0 = fs.statSync(transcriptOf(ids.s1)).size;
  const tClick = Date.now();
  await page.click('.mt-node[data-name="s1"] [data-role="sleep-answer"]');
  await until(async () => (await sess(page, 's1')).waking, 5000, 100).catch(() => {});
  await sleep(300);
  await shot(page, 'p21-3-waking');
  await waitState(page, 's1', 'ready', 120000);
  const clickReadyMs = Date.now() - tClick;
  const woke1 = (await call(page, 'session.events', { session: 's1', limit: 80 })).filter((e) => e.kind === 'woke').pop();
  await sleep(1500);
  await shot(page, 'p21-3-awake');
  const term = await face(page, 's1');
  atrium('send', '@s1', 'What codeword did I ask you to remember earlier? Reply with only the codeword.', '--wait');
  await until(async () => { const x = await sess(page, 's1'); return x.state === 'ready' && (x.lastAnswerAt || 0) > tClick && /PELICAN/i.test(x.lastAnswer || '') ? x : null; }, 90000, 500).catch(() => null);
  const s1a = await sess(page, 's1');
  measures.wakeClick = { clickToReadyMs: clickReadyMs, event: woke1 && woke1.data };
  step('눌러 깨우기: 같은 세션·대화 ID로 이어 가고(--resume) 같은 대화 기록에 이어 쓴다', woke1 && woke1.data.plan === 'resume' && woke1.data.convId === ids.s1 && s1a.id === ids.s1 && fs.statSync(transcriptOf(ids.s1)).size > tx0, { woke: woke1 && woke1.data, size0: tx0, size1: fs.statSync(transcriptOf(ids.s1)).size });
  step('눌러 깨우기: 깬 뒤 같은 자리에서 터미널이 된다', term.terminal && !term.sleepFace, term);
  step('눌러 깨우기: 깨기 전 대화를 기억한다', /PELICAN-41/i.test(s1a.lastAnswer || ''), s1a.lastAnswer);

  // 4. 저절로 잠재우기(1분). s2의 리포는 보는 노드(초점·터미널), s3의 리포는 내 차례(권한 요청), s1의 리포는 쉰다 → s1만 잠든다
  await call(page, 'settings.set', { key: 'sleepAfterMin', value: 1 });
  atrium('send', '@s3', 'Use the Bash tool to run exactly this command and nothing else: npm test -- p21-check', '--wait');
  await waitState(page, 's3', 'waiting', 90000);
  await page.evaluate((id) => window.__mt.getState().navigateTo(id, { focusTerminal: true }), ids.s2);
  await sleep(1500);
  const attached = await page.evaluate(() => window.__mt.getState().attached);
  log('붙은 노드', attached);
  // s2가 일하는 동안의 까닭(working)
  atrium('send', '@s2', 'Count from 1 to 15, one number per line.');
  const repoOf = (st, n) => st.repos.find((x) => x.name === path.basename(DIR_OF[n]));
  const whyWorking = await until(async () => { const r = repoOf(await call(page, 'sleep.status'), 's2'); return r && r.why === 'working' ? r : null; }, 30000, 250).catch(() => null);
  step('저절로 잠재우기: 일하는 세션은 잠재우지 않는다(까닭 working)', !!whyWorking, whyWorking);
  const tAuto = Date.now();
  const slept = await until(async () => { const x = await sess(page, 's1'); return x.state === 'sleeping' ? x : null; }, 150000, 1000).catch(() => null);
  const st4 = await call(page, 'sleep.status');
  log('저절로 잠든 때의 까닭', st4);
  // s2는 방금까지 일했으므로, 1분을 넘게 쉰 뒤에도 보는 노드라 깨어 있는지 본다
  // 리포의 쉰 시간은 보는 동안 다시 세므로(busyAt), s2 자신의 마지막 활동이 1분을 넘은 뒤에도 보는 노드라 깨어 있는지 본다
  const idle2 = async () => { const g = await call(page, 'session.get', { session: 's2', screen: false }); return Date.now() - Math.max(g.lastActivityAt || 0, (g.turn && g.turn.endedAt) || 0); };
  const st4b = await until(async () => ((await idle2()) > 65000 ? call(page, 'sleep.status') : null), 90000, 1000).catch(() => st4);
  const s2idle = await idle2();
  const g3 = await call(page, 'session.get', { session: 's3', screen: false });
  const w2 = { ...repoOf(st4b, 's2'), idleMs: s2idle }, w3 = { ...repoOf(st4, 's3'), idleMs: Date.now() - Math.max(g3.lastActivityAt || 0, g3.touchedAt || 0) };
  step('저절로 잠재우기: 1분 쉰 s1이 저절로 잠들었다', !!slept && slept.sleep.by !== 'hand', { ms: Date.now() - tAuto, by: slept && slept.sleep });
  step('저절로 잠재우기: 보는 노드는 잠재우지 않는다(까닭 viewing)', w2 && w2.why === 'viewing' && w2.idleMs > 60000, w2);
  step('저절로 잠재우기: 내 차례인 세션은 잠재우지 않는다(까닭 needs_you)', w3 && w3.why === 'needs_you' && w3.idleMs > 60000, w3);
  const inbox = await call(page, 'inbox.list');
  step('내 차례 목록에 잠든 세션이 없다', !inbox.needsYou.some((x) => x.name === 's1') && inbox.needsYou.some((x) => x.name === 's3'), inbox.needsYou.map((x) => x.name));
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(800);
  await shot(page, 'p21-4-auto');
  atrium('answer', 's3', 'reject');
  await waitState(page, 's3', 'ready', 60000);

  // 5. 글 보내 깨우기(명령 바 @s1). 전달은 깨어 준비된 뒤 들어간다
  await call(page, 'settings.set', { key: 'sleepAfterMin', value: 0 });
  const tSend = Date.now();
  await page.fill('[data-role="command"]', '@s1 What codeword did I ask you to remember earlier? Reply with only the codeword.');
  await page.click('[data-action="send"]');
  await until(async () => (await sess(page, 's1')).waking, 10000, 100).catch(() => {});
  await sleep(500);
  await shot(page, 'p21-5-send-waking');
  const dl = await until(async () => { const d = await call(page, 'delivery.list', { session: 's1', limit: 3 }); return d[0] && ['confirmed', 'failed', 'cancelled', 'unconfirmed'].includes(d[0].status) ? d[0] : null; }, 150000, 500);
  const woke2 = (await call(page, 'session.events', { session: 's1', limit: 120 })).filter((e) => e.kind === 'woke').pop();
  const dEv = (await call(page, 'session.events', { session: 's1', limit: 120 })).filter((e) => e.kind === 'delivery' && e.data.deliveryId === dl.deliveryId).map((e) => `${e.data.status}:${e.data.reason || ''}`);
  await until(async () => { const x = await sess(page, 's1'); return x.state === 'ready' && (x.lastAnswerAt || 0) > tSend && /PELICAN/i.test(x.lastAnswer || '') ? x : null; }, 90000, 500).catch(() => null);
  const s1b = await sess(page, 's1');
  measures.wakeSend = { sendToConfirmedMs: Date.now() - tSend, event: woke2 && woke2.data, delivery: dEv };
  step('글 보내 깨우기: 전달은 sleeping으로 기다리다 깬 뒤 들어갔다', dl.status === 'confirmed' && dEv.includes('queued:sleeping') && woke2 && woke2.data.why === 'delivery', { status: dl.status, dEv });
  step('글 보내 깨우기: 깨기 전 대화를 기억한다', /PELICAN-41/i.test(s1b.lastAnswer || ''), s1b.lastAnswer);

  // 6. 잠든 채로 herdr와 백엔드를 다시 켠다
  await call(page, 'workspace.sleep', { session: 's1' });
  await until(async () => (await sess(page, 's1')).state === 'sleeping', 30000);
  atrium('herdr', 'restart', '--yes');
  await until(async () => page.evaluate(() => window.__mt.getState().terminal.connected), 60000, 500);
  for (const n of ['s2', 's3']) await waitState(page, n, 'ready', 120000);
  const afterHerdr = await sess(page, 's1');
  const agents2 = herdr('agent.list');
  step('herdr를 다시 켜도 잠든 채로 남고 되살리지 않는다', afterHerdr.state === 'sleeping' && afterHerdr.paneId == null && !(agents2.agents || []).some((a) => a.name === 's1'), { s1: afterHerdr.state, agents: (agents2.agents || []).map((a) => a.name) });
  await call(page, 'backend.shutdown').catch(() => {});
  await sleep(3000);
  await until(async () => page.evaluate(() => window.__mt.getState().conn === 'open' && window.__mt.getState().sessions.size >= 3), 90000, 500);
  await sleep(4000);
  const afterBackend = await sess(page, 's1');
  const closedNow = (await call(page, 'recall.closed').catch(() => [])) || [];
  step('백엔드를 다시 켜도 잠든 채로 남고 닫히지 않는다', afterBackend.state === 'sleeping' && !JSON.stringify(closedNow).includes(ids.s1), { s1: afterBackend.state });
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(800);
  await shot(page, 'p21-6-after-restart');

  // 7. 트레이 메뉴 "쉬는 리포 모두 잠재우기": 초점을 내리고(보는 노드 없음) s2, s3의 리포를 잠재운다
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await until(async () => (await page.evaluate(() => window.__mt.getState().attached.length)) === 0, 15000, 300).catch(() => {}); // 멀리 보면 터미널이 떨어진다
  await page.evaluate(() => window.__mt.api.call('board.viewing', { focus: null }));
  const trayMenu = await app.evaluate(() => global.__mtTray && global.__mtTray.state().menu);
  await app.evaluate(() => global.__mtTray.run('sleep-idle'));
  await until(async () => { const t = await app.evaluate(() => global.__mtTray.state()); return !t.busy && t.lastSleep ? t.lastSleep : null; }, 90000, 500);
  const tl = await app.evaluate(() => global.__mtTray.state().lastSleep);
  step('트레이 메뉴로 쉬는 리포 모두 잠재우기', (trayMenu || []).some((x) => /쉬는 리포 모두 잠재우기/.test(x)) && tl.slept === 2 && tl.repos === 2, { menu: trayMenu, slept: tl.slept, savedMB: tl.savedMB, skipped: tl.skipped });
  await sleep(1000);
  await page.click('[data-role="resources"]');
  await sleep(400);
  await shot(page, 'p21-7-all-asleep');
  await page.keyboard.press('Escape');

  // 8. 잠든 세션 보관·삭제(노드의 X)
  for (const [n, act] of [['s2', 'close-archive'], ['s3', 'close-delete']]) {
    await viewNode(page, n, 900);
    await page.click(`.mt-node[data-name="${n}"] [data-action="kill"]`);
    await page.waitForFunction((nn) => { const k = document.querySelector(`.mt-node[data-name="${nn}"] [data-role="kill-confirm"]`); return k && k.getAttribute('data-loading') === '0'; }, n, { timeout: 10000 });
    await page.click(`.mt-node[data-name="${n}"] [data-action="${act}"]`);
    await until(async () => !(await sess(page, n)), 30000, 300);
  }
  const arch = await call(page, 'archive.list');
  const archived = JSON.stringify(arch).includes(ids.s2);
  step('잠든 세션 보관: 판에서 빠지고 보관함에 있다', archived, null);
  // 노드는 닫는 즉시 빠지고, 삭제(휴지통)는 그 뒤에 끝난다
  const deleted = await until(async () => !fs.existsSync(transcriptOf(ids.s3, 's3')) && !JSON.stringify(await call(page, 'recall.closed')).includes(ids.s3), 30000, 500).catch(() => false);
  step('잠든 세션 삭제: 대화 기록을 휴지통으로 보내고 닫힌 목록에도 없다', deleted, { transcript: fs.existsSync(transcriptOf(ids.s3, 's3')) });
  await shot(page, 'p21-8-closed');
} catch (e) {
  step('예외', false, e.stack);
  await shot(page, 'p21-error').catch(() => {});
} finally {
  // 정리: 남은 시험 세션 끄기(잠든 것은 판에서만 닫힌다). 백엔드·herdr·폴더는 정리 순서대로 바깥에서 지운다
  for (const n of ['s1', 's2', 's3']) { try { atrium('kill', n, '--yes'); } catch {} }
  fs.writeFileSync(path.join(OUT, 'p21-sleep.json'), JSON.stringify({ results, measures }, null, 2));
  const fail = results.filter((r) => !r.ok);
  log(`끝: 통과 ${results.length - fail.length}/${results.length}`);
  await closeApp(app);
  process.exit(fail.length ? 1 : 0);
}
