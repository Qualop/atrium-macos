// P24 창 시험(ARCH 4절 D4): 리포(워크스페이스) 단위 잠재우기와 깨우기. 판: herdr 세션 atrium-dev-p24, 포트 47842, 이 워크트리의 backend/.dev(experiments/p24/tools/env.cjs).
// 시험 폴더는 새로 만든 C:\Workspace\mtask-p24-ws\ra, rb(git이 아닌 폴더라 폴더 하나가 리포 하나), 리포마다 haiku claude 둘(a1, a2 / b1, b2).
// 사용: node experiments/p24/tools/e2e.cjs p24-repo.mjs
// 차례: 0 준비 → 1 저절로(ra는 쉬어 잠들고 rb는 보는 중·내 차례·초안·일하는 중이라 깨어 있다가, 일이 끝난 뒤 통째로 잠든다) → 2 영역 이름표와 메모리 목록
//       → 3 노드를 눌러 ra 깨우기, 글을 보내 rb 깨우기(전달) → 4 이름표 메뉴로 잠재우기·깨우기, 트레이로 쉬는 리포 모두 → 5 herdr·백엔드를 다시 켜도 잠든 채
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p24') throw new Error('MT_E2E_OUT=p24를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p24', 'tools', 'env.cjs'));
const ENV = { ...Object.fromEntries(Object.entries(T.P24_ENV).filter(([k]) => k.startsWith('ATRIUM_'))), ATRIUM_SLEEP_TICK_MS: '3000' };
assertTestBoard(ENV, { root: T.DEV });
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['ra', 'rb']) fs.mkdirSync(T.DIRS[f], { recursive: true });

const log = logger('p24-repo');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 180000 });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sess = (page, name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, waking: s.waking, sleep: s.sleep, paneId: s.paneId, lastAnswer: s.lastAnswer, lastAnswerAt: s.lastAnswerAt, ws: s.workspaceKey } : null; }, name);
const NAMES = { ra: ['a1', 'a2'], rb: ['b1', 'b2'] };
const ALL = [...NAMES.ra, ...NAMES.rb];
const DIR_OF = { a1: 'ra', a2: 'ra', b1: 'rb', b2: 'rb' };
const transcriptOf = (n, id) => path.join(T.PROJECTS[DIR_OF[n]], `${id}.jsonl`);
const WORD = { a1: 'PELICAN-41', a2: 'MAPLE-72', b1: 'COBALT-15', b2: 'ORCHID-88' };
const toMB = (t) => { const m = /([\d.]+)\s*(GB|MB)/.exec(t || ''); return m ? Number(m[1]) * (m[2] === 'GB' ? 1024 : 1) : null; };

const results = [];
const measures = {};
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const waitState = (page, n, states, ms = 120000) => until(async () => { const x = await sess(page, n); return x && [].concat(states).includes(x.state) && !x.waking ? x : null; }, ms, 300);
const states = async (page, names = ALL) => { const o = {}; for (const n of names) { const x = await sess(page, n); o[n] = x ? (x.waking ? 'waking' : x.state) : null; } return o; };
const repoOf = async (page, name) => (await call(page, 'sleep.status')).repos.find((r) => r.name === name);
const pillText = (page) => page.evaluate(() => { const p = document.querySelector('[data-role="resources"] .mono'); return p ? p.textContent : null; });
const regionHead = (page, name) => page.evaluate((nn) => { const el = document.querySelector(`.mt-region[data-name="${nn}"]`); if (!el) return null; const c = el.querySelector('[data-count="asleep"]'); return { asleep: el.dataset.asleep || null, cls: el.className, badge: c ? c.textContent : null, acts: [...el.querySelectorAll('.mt-region-acts [data-action]')].map((b) => b.dataset.action) }; }, name);
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
// 아무 노드도 보지 않는다: 판 전체를 멀리서 보고(터미널이 떨어진다) 초점을 내린다
async function lookAway(page) {
  await page.evaluate(() => { const st = window.__mt.getState(); st.focusId = null; st.fitAll(0); });
  await sleep(400);
  // 모든 노드가 멀리 얼굴이 되게 아주 멀리서 본다(노드가 적으면 모두 보기도 가까이 얼굴이다)
  await page.evaluate(() => { const st = window.__mt.getState(); const el = document.querySelector('.mt-canvas'); const rs = [...st.nodes.values()]; const x0 = Math.min(...rs.map((r) => r.x)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y0 = Math.min(...rs.map((r) => r.y)), y1 = Math.max(...rs.map((r) => r.y + r.h)); const z = 0.12; st.setViewport({ x: el.clientWidth / 2 - ((x0 + x1) / 2) * z, y: el.clientHeight / 2 - ((y0 + y1) / 2) * z, zoom: z }); });
  await sleep(600);
  await until(async () => (await page.evaluate(() => window.__mt.getState().attached.length)) === 0, 15000, 300).catch(() => {});
  await call(page, 'board.viewing', { focus: null });
}
async function regionMenu(page, name, action) {
  const head = `.mt-region[data-name="${name}"] .mt-region-head`;
  if (!(await page.$(`${head}.acts`))) await page.click(`${head} [data-action="region-acts"]`);
  await sleep(300);
  await page.click(`${head} [data-action="${action}"]`);
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

  // 0. 리포 둘에 haiku claude 둘씩. 준비된 뒤 첫 지시(atrium send --wait)
  for (const f of ['ra', 'rb']) await call(page, 'workspace.open', { path: T.DIRS[f] });
  for (const n of ALL) if (!(await sess(page, n))) atrium('spawn', T.DIRS[DIR_OF[n]], '--name', n, '--model', 'haiku');
  for (const n of ALL) await waitState(page, n, 'ready', 120000);
  const ids = {};
  for (const n of ALL) ids[n] = (await sess(page, n)).id;
  // 리포 rb의 노드를 아래로 멀리 둔다(한 리포의 노드를 볼 때 다른 리포 노드가 가까이 얼굴로 화면에 들어오지 않게)
  for (const n of NAMES.rb) { const r = await page.evaluate((id) => window.__mt.getState().nodes.get(id), ids[n]); await call(page, 'board.setNode', { session: ids[n], x: r.x, y: r.y + 2600, w: r.w, h: r.h, cause: 'p24 test' }); }
  await page.reload();
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  for (const n of ALL) atrium('send', `@${n}`, `Remember this codeword for later: ${WORD[n]}. Reply with the single word OK.`, '--wait');
  for (const n of ALL) await until(async () => { const x = await sess(page, n); return x && x.state === 'ready' && x.lastAnswer && fs.existsSync(transcriptOf(n, x.id)); }, 120000, 500);
  const wsKeys = Object.fromEntries(await Promise.all(ALL.map(async (n) => [n, (await sess(page, n)).ws])));
  step('준비: 리포 둘(ra, rb)에 haiku 둘씩, 첫 지시에 답하고 대화 기록이 생겼다', wsKeys.a1 === wsKeys.a2 && wsKeys.b1 === wsKeys.b2 && wsKeys.a1 !== wsKeys.b1, { ids, wsKeys });
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(800);
  await shot(page, 'p24-0-ready');
  await call(page, 'resources.get', { fresh: true });
  await sleep(800);
  const pill0 = await pillText(page);

  // 1. 저절로(1분). rb의 b1을 본다(초점·터미널) → ra만 통째로 잠든다
  await call(page, 'settings.set', { key: 'sleepAfterMin', value: 1 });
  await page.evaluate((id) => window.__mt.getState().navigateTo(id, { focusTerminal: true }), ids.b1);
  await sleep(1500);
  log('붙은 노드', await page.evaluate(() => window.__mt.getState().attached));
  const tAuto = Date.now();
  await until(async () => { const s = await states(page); return s.a1 === 'sleeping' && s.a2 === 'sleeping'; }, 150000, 1000).catch(() => null);
  const s1 = await states(page);
  const rb1 = await repoOf(page, 'rb');
  measures.autoRa = { ms: Date.now() - tAuto, states: s1, rb: rb1 };
  step('저절로: 쉰 리포 ra는 통째로 잠든다', s1.a1 === 'sleeping' && s1.a2 === 'sleeping', s1);
  step('저절로: 보는 노드가 있는 리포 rb는 하나도 잠들지 않는다(까닭 viewing)', s1.b1 === 'ready' && s1.b2 === 'ready' && rb1.why === 'viewing', rb1);
  await shot(page, 'p24-1-viewing-rb');
  await lookAway(page);
  await sleep(500);
  await shot(page, 'p24-1-ra-asleep');

  // 내 차례: b2가 권한을 묻는 동안 rb는 깨어 있다
  atrium('send', '@b2', 'Use the Bash tool to run exactly this command and nothing else: npm test -- p24-check', '--wait');
  await waitState(page, 'b2', 'waiting', 90000);
  const tNeed = Date.now();
  // b2가 1분 넘게 묻는 동안(sleepAfterMin을 넘겨도) rb는 깨어 있어야 한다
  const rbNeed = await until(async () => { const r = await repoOf(page, 'rb'); return r && r.why === 'needs_you' && Date.now() - tNeed > 70000 ? r : null; }, 150000, 1000).catch(() => null);
  const s2 = await states(page, NAMES.rb);
  step('저절로: 내 차례(b2)가 있는 리포 rb는 1분 넘게 지나도 잠들지 않는다(까닭 needs_you)', !!rbNeed && rbNeed.who === 'b2' && s2.b1 === 'ready' && s2.b2 === 'waiting', { rb: rbNeed, states: s2, ms: Date.now() - tNeed });
  await shot(page, 'p24-1-needs-you');
  atrium('answer', 'b2', 'reject');
  await waitState(page, 'b2', 'ready', 60000);

  // 초안: b1의 판 터미널에 친 글이 남아 있으면 잠들지 않는다. Ctrl+U로 지우면 그 뒤로 센다
  atrium('input', 'b1', 'draft text not sent');
  const rbDraft = await until(async () => { const r = await repoOf(page, 'rb'); return r && r.why === 'draft' ? r : null; }, 15000, 500).catch(() => null);
  step('저절로: 보내지 않은 초안이 있는 리포는 잠들지 않는다(까닭 draft)', !!rbDraft && rbDraft.who === 'b1', rbDraft);
  atrium('input', 'b1', '\\x15');
  // 일하는 중
  atrium('send', '@b1', 'Count from 1 to 60, one number per line.');
  const rbWork = await until(async () => { const r = await repoOf(page, 'rb'); return r && r.why === 'working' ? r : null; }, 30000, 250).catch(() => null);
  step('저절로: 일하는 세션이 있는 리포는 잠들지 않는다(까닭 working)', !!rbWork && rbWork.who === 'b1', rbWork);
  await waitState(page, 'b1', 'ready', 90000);
  // 일이 모두 끝난 뒤 1분이 지나면 rb도 통째로 잠든다
  const tIdle = Date.now();
  await until(async () => { const s = await states(page, NAMES.rb); return s.b1 === 'sleeping' && s.b2 === 'sleeping'; }, 150000, 1000).catch(() => null);
  const s3 = await states(page);
  measures.autoRb = { msAfterLastWork: Date.now() - tIdle, states: s3 };
  step('저절로: 일이 끝나고 1분 뒤 rb도 통째로 잠든다', s3.b1 === 'sleeping' && s3.b2 === 'sleeping' && Date.now() - tIdle >= 55000, measures.autoRb);
  await call(page, 'settings.set', { key: 'sleepAfterMin', value: 0 });

  // 2. 영역 이름표(잠듦, 아낀 메모리)와 메모리 알약 목록(리포별)
  await lookAway(page);
  await call(page, 'resources.get', { fresh: true });
  await sleep(1200);
  const pill1 = await pillText(page);
  const heads = { ra: await regionHead(page, 'ra'), rb: await regionHead(page, 'rb') };
  step('영역 이름표: 잠든 리포에 잠듦 표시와 아낀 메모리', ['ra', 'rb'].every((k) => heads[k] && heads[k].asleep === '2' && /잠듦 · [\d.]+(MB|GB) 아낌/.test(heads[k].badge || '') && /asleep/.test(heads[k].cls)), heads);
  step('메모리 알약이 줄었다(네 세션이 모두 잠듦)', toMB(pill0) > 0 && toMB(pill1) < toMB(pill0), { pill0, pill1 });
  await shot(page, 'p24-2-regions-asleep');
  await page.click('[data-role="resources"]');
  await sleep(400);
  const memList = await page.evaluate(() => [...document.querySelectorAll('[data-role="res-repo"]')].map((g) => ({ name: g.dataset.name, text: g.innerText })));
  await shot(page, 'p24-2-memory-list');
  step('메모리 알약 목록은 리포별로 묶여 잠든 수와 아낀 메모리를 보인다', ['ra', 'rb'].every((k) => memList.some((g) => g.name === k && /2개 잠듦/.test(g.text))), memList);
  await page.keyboard.press('Escape');

  // 3. 노드를 눌러 ra 깨우기(a1을 누르면 a2도 깬다). rb는 그대로 잔다
  await viewNode(page, 'a1', 900);
  const tClick = Date.now();
  await page.click('.mt-node[data-name="a1"] [data-role="sleep-face"]');
  await until(async () => (await sess(page, 'a2')).waking, 5000, 100).catch(() => {});
  const wakingNow = await states(page);
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(300);
  await shot(page, 'p24-3-waking-ra');
  const a1r = await waitState(page, 'a1', 'ready', 120000).then(() => Date.now() - tClick);
  const a2r = await waitState(page, 'a2', 'ready', 120000).then(() => Date.now() - tClick);
  const s4 = await states(page);
  const woke = {};
  for (const n of NAMES.ra) woke[n] = (await call(page, 'session.events', { session: n, limit: 80 })).filter((e) => e.kind === 'woke').pop();
  measures.wakeClick = { a1ReadyMs: a1r, a2ReadyMs: a2r, a1: woke.a1 && woke.a1.data, a2: woke.a2 && woke.a2.data };
  step('눌러 깨우기: a1을 누르면 리포 ra의 a1·a2가 모두 깬다(같은 대화 ID로 이어 감), rb는 잔다', s4.a1 === 'ready' && s4.a2 === 'ready' && s4.b1 === 'sleeping' && s4.b2 === 'sleeping' && wakingNow.a2 !== 'sleeping'
    && NAMES.ra.every((n) => woke[n] && woke[n].data.plan === 'resume' && woke[n].data.convId === ids[n]), { wakingNow, s4, woke: measures.wakeClick });
  step('눌러 깨우기: 누른 세션이 먼저, 같은 리포의 나머지는 뒤따라 깬다', woke.a1 && woke.a2 && woke.a1.data.why === 'click' && /^repo:/.test(woke.a2.data.why), { a1: woke.a1 && woke.a1.data.why, a2: woke.a2 && woke.a2.data.why });
  atrium('send', '@a2', 'What codeword did I ask you to remember earlier? Reply with only the codeword.', '--wait');
  const a2m = await until(async () => { const x = await sess(page, 'a2'); return x.state === 'ready' && (x.lastAnswerAt || 0) > tClick && /MAPLE/i.test(x.lastAnswer || '') ? x : null; }, 90000, 500).catch(() => null);
  step('눌러 깨우기: 함께 깬 a2가 잠들기 전 대화를 기억한다', !!a2m, a2m && a2m.lastAnswer);

  // 글 보내 깨우기(명령 바 @b2): rb의 b1·b2가 깨고, 글은 b2가 준비된 뒤 들어간다
  await lookAway(page);
  const tSend = Date.now();
  await page.fill('[data-role="command"]', '@b2 What codeword did I ask you to remember earlier? Reply with only the codeword.');
  await page.click('[data-action="send"]');
  await until(async () => (await sess(page, 'b1')).waking, 10000, 100).catch(() => {});
  await sleep(500);
  await shot(page, 'p24-3-send-waking-rb');
  const dl = await until(async () => { const d = await call(page, 'delivery.list', { session: 'b2', limit: 3 }); return d[0] && ['confirmed', 'failed', 'cancelled', 'unconfirmed'].includes(d[0].status) ? d[0] : null; }, 150000, 500);
  const dEv = (await call(page, 'session.events', { session: 'b2', limit: 120 })).filter((e) => e.kind === 'delivery' && e.data.deliveryId === dl.deliveryId).map((e) => `${e.data.status}:${e.data.reason || ''}`);
  await waitState(page, 'b1', 'ready', 120000);
  const b2m = await until(async () => { const x = await sess(page, 'b2'); return x.state === 'ready' && (x.lastAnswerAt || 0) > tSend && /ORCHID/i.test(x.lastAnswer || '') ? x : null; }, 90000, 500).catch(() => null);
  const s5 = await states(page);
  measures.wakeSend = { sendToConfirmedMs: (dl.confirmedAt || Date.now()) - tSend, delivery: dEv };
  step('글 보내 깨우기: rb의 b1·b2가 모두 깨고, 글은 sleeping으로 기다리다 깬 뒤 들어갔다', s5.b1 === 'ready' && s5.b2 === 'ready' && dl.status === 'confirmed' && dEv.includes('queued:sleeping'), { s5, status: dl.status, dEv });
  step('글 보내 깨우기: 깨기 전 대화를 기억한다', !!b2m, b2m && b2m.lastAnswer);
  await shot(page, 'p24-3-awake');

  // 4. 손으로: 영역 이름표 메뉴의 잠재우기(보고 있어도)·깨우기, 트레이의 쉬는 리포 모두
  await viewNode(page, 'a1', 600); // ra를 보고 있다
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(600);
  const actsAwake = await regionHead(page, 'ra');
  await regionMenu(page, 'ra', 'region-sleep');
  await until(async () => { const s = await states(page, NAMES.ra); return s.a1 === 'sleeping' && s.a2 === 'sleeping'; }, 60000, 500).catch(() => null);
  const s6 = await states(page);
  await sleep(500);
  await shot(page, 'p24-4-menu-sleep');
  const actsAsleep = await regionHead(page, 'ra');
  step('이름표 메뉴: 이 리포 잠재우기로 ra의 둘이 잠들고 rb는 그대로', s6.a1 === 'sleeping' && s6.a2 === 'sleeping' && s6.b1 === 'ready' && s6.b2 === 'ready' && actsAwake.acts.includes('region-sleep') && actsAsleep.acts.includes('region-wake'), { s6, actsAwake: actsAwake.acts, actsAsleep: actsAsleep.acts });
  // 일하는 세션이 있으면 거부한다
  atrium('send', '@b1', 'Count from 1 to 60, one number per line.');
  await until(async () => (await sess(page, 'b1')).state === 'working', 30000, 200).catch(() => {});
  const refused = await call(page, 'workspace.sleep', { workspace: 'rb' }).then((r) => ({ ok: r }), (e) => ({ code: e.code, key: e.key, vars: e.vars, message: e.message }));
  step('이름표 메뉴: 일하는 세션이 있는 리포는 잠재우지 않고 까닭을 알린다', /리포 rb는 지금 잠재우지 않는다: @b1 /.test(refused.message || ''), refused);
  await waitState(page, 'b1', 'ready', 90000);
  const tw = Date.now();
  await regionMenu(page, 'ra', 'region-wake');
  await until(async () => { const s = await states(page, NAMES.ra); return s.a1 === 'ready' && s.a2 === 'ready'; }, 120000, 500).catch(() => null);
  const s7 = await states(page);
  measures.wakeMenu = { ms: Date.now() - tw };
  step('이름표 메뉴: 이 리포 깨우기로 ra의 둘이 깬다', s7.a1 === 'ready' && s7.a2 === 'ready', { s7, ms: measures.wakeMenu.ms });
  // 트레이: 쉬는 리포 모두
  await lookAway(page);
  const trayMenu = await app.evaluate(() => global.__mtTray && global.__mtTray.state().menu);
  await app.evaluate(() => global.__mtTray.run('sleep-idle'));
  await until(async () => { const t = await app.evaluate(() => global.__mtTray.state()); return !t.busy && t.lastSleep ? t.lastSleep : null; }, 120000, 500);
  const tl = await app.evaluate(() => global.__mtTray.state().lastSleep);
  const s8 = await states(page);
  step('트레이 메뉴: 쉬는 리포 모두 잠재우기로 두 리포의 넷이 잠든다', (trayMenu || []).some((x) => /쉬는 리포 모두 잠재우기/.test(x)) && tl.repos === 2 && tl.slept === 4 && Object.values(s8).every((x) => x === 'sleeping'), { menu: trayMenu, repos: tl.repos, slept: tl.slept, savedMB: tl.savedMB, skipped: tl.skipped, s8 });
  measures.tray = { repos: tl.repos, slept: tl.slept, savedMB: tl.savedMB };
  await sleep(800);
  await page.click('[data-role="resources"]');
  await sleep(400);
  await shot(page, 'p24-4-tray-all-asleep');
  await page.keyboard.press('Escape');

  // 5. 잠든 채로 herdr와 백엔드를 다시 켠다
  atrium('herdr', 'restart', '--yes');
  await until(async () => page.evaluate(() => window.__mt.getState().terminal.connected), 60000, 500);
  await sleep(5000);
  const s9 = await states(page);
  step('herdr를 다시 켜도 네 세션 모두 잠든 채로 남는다', Object.values(s9).every((x) => x === 'sleeping'), s9);
  await call(page, 'backend.shutdown').catch(() => {});
  await sleep(3000);
  await until(async () => page.evaluate(() => window.__mt.getState().conn === 'open' && window.__mt.getState().sessions.size >= 4), 90000, 500);
  await sleep(6000);
  const s10 = await states(page);
  const closedNow = JSON.stringify((await call(page, 'recall.closed').catch(() => [])) || []);
  step('백엔드를 다시 켜도 잠든 채로 남고 닫히지 않는다', Object.values(s10).every((x) => x === 'sleeping') && !ALL.some((n) => closedNow.includes(ids[n])), s10);
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(800);
  await shot(page, 'p24-5-after-restart');
} catch (e) {
  step('예외', false, e.stack);
  await shot(page, 'p24-error').catch(() => {});
} finally {
  for (const n of ALL) { try { atrium('kill', n, '--yes'); } catch {} }
  fs.writeFileSync(path.join(OUT, 'p24-repo.json'), JSON.stringify({ results, measures }, null, 2));
  const fail = results.filter((r) => !r.ok);
  log(`끝: 통과 ${results.length - fail.length}/${results.length}`);
  await closeApp(app);
  process.exit(fail.length ? 1 : 0);
}
