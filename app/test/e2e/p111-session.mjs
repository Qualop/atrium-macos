// P111 창 시험(ARCH 4절 D4): 세션 혼자 잠재우기. 판: herdr 세션 atrium-dev-p111, 포트 47899, 이 워크트리의 backend/.dev(experiments/p111/tools/env.cjs).
// 시험 폴더는 새로 만든 C:\Workspace\mtask-p111-ws\rh 하나(git이 아닌 폴더라 폴더 하나가 리포 하나). 헤드 lead와 그 하위 세션 c1·c2·c3(모두 haiku).
// 사용: node experiments/p111/tools/e2e.cjs p111-session.mjs
// 차례: 0 준비 → 1 헤드가 일하는 동안 쉬는 하위 세션 셋이 하나씩 혼자 잠든다(헤드는 남는다) → 2 잠든 c1을 누르면 c1만 깨고 같은 대화로 이어진다
//       → 3 잠든 c2에 명령 바로 글을 보내면 c2만 깨고 글이 들어간다 → 4 c1이 일하는 동안 쉬는 헤드는 잠들지 않는다(child_busy)
//       → 5 모두 쉬면 리포 규칙으로 리포째 잠들되 앞서 혼자 잠든 세션은 session 그대로, 헤드를 누르면 리포째 잠든 세션만 깨고 혼자 잠든 c2는 눌러야 혼자 깬다.
// 잠들 때마다 PC 커밋(Win32_OperatingSystem: 커밋 한도 - 남은 커밋)이 줄어든 값을 잰다(잠들기 전 3초 평균 - 잠든 뒤 7~11초 평균)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p111') throw new Error('MT_E2E_OUT=p111를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p111', 'tools', 'env.cjs'));
const ENV = { ...Object.fromEntries(Object.entries(T.P111_ENV).filter(([k]) => k.startsWith('ATRIUM_'))), ATRIUM_SLEEP_TICK_MS: '3000' };
assertTestBoard(ENV, { root: T.DEV });
fs.mkdirSync(OUT, { recursive: true });
const DIR = T.DIRS.rh;
fs.mkdirSync(path.join(DIR, '.claude'), { recursive: true });
// 오래 도는 턴: ping만 묻지 않고 허용한다(P85)
fs.writeFileSync(path.join(DIR, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)', 'Bash(ping *)', 'PowerShell(ping *)'] } }, null, 2));

const log = logger('p111-session');
const env = { ...T.cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 240000 });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sess = (page, name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, waking: s.waking, sleep: s.sleep, paneId: s.paneId, lastAnswer: s.lastAnswer, lastAnswerAt: s.lastAnswerAt, ws: s.workspaceKey, parent: s.parentSessionId || null } : null; }, name);
const KIDS = ['c1', 'c2', 'c3'];
const ALL = ['lead', ...KIDS];
const WORD = { lead: 'HARBOR-27', c1: 'PELICAN-41', c2: 'MAPLE-72', c3: 'COBALT-15' };
const transcriptOf = (id) => path.join(T.PROJECTS.rh, `${id}.jsonl`);
const LONG = (n) => `Use your shell tool to run exactly this command and wait for it to finish: ping -n 80 127.0.0.1 . It takes about 80 seconds. Run it ${n} times, one after another, as separate commands (set the tool timeout to 120000 ms if you can). Do not run anything else. When all ${n} runs are done, reply with the single word DONE.`;

const results = [];
const measures = { sleeps: [] };
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const waitState = (page, n, states, ms = 120000) => until(async () => { const x = await sess(page, n); return x && [].concat(states).includes(x.state) && !x.waking ? x : null; }, ms, 300);
const states = async (page, names = ALL) => { const o = {}; for (const n of names) { const x = await sess(page, n); o[n] = x ? (x.waking ? 'waking' : x.state) : null; } return o; };
const status = async (page) => (await call(page, 'sleep.status')).repos.find((r) => r.each && r.each.some((x) => x.name === 'lead'));
const eachOf = (r, n) => (r && r.each ? r.each.find((x) => x.name === n) : null) || {};
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
// 아무 노드도 보지 않는다: 판 전체를 아주 멀리서 보고(터미널이 떨어진다) 초점을 내린다(P24 lookAway)
async function lookAway(page) {
  await page.evaluate(() => { const st = window.__mt.getState(); st.focusId = null; st.fitAll(0); });
  await sleep(400);
  await page.evaluate(() => { const st = window.__mt.getState(); const el = document.querySelector('.mt-canvas'); const rs = [...st.nodes.values()]; const x0 = Math.min(...rs.map((r) => r.x)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y0 = Math.min(...rs.map((r) => r.y)), y1 = Math.max(...rs.map((r) => r.y + r.h)); const z = 0.12; st.setViewport({ x: el.clientWidth / 2 - ((x0 + x1) / 2) * z, y: el.clientHeight / 2 - ((y0 + y1) / 2) * z, zoom: z }); });
  await sleep(600);
  await until(async () => (await page.evaluate(() => window.__mt.getState().attached.length)) === 0, 15000, 300).catch(() => {});
  await call(page, 'board.viewing', { focus: null });
}
// 잠깐 판 전체를 보고 찍은 뒤 다시 눈을 돌린다
async function look(page, name) { await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(900); await shot(page, name); await lookAway(page); }

// ---------- PC 커밋 표본(0.5초마다) ----------
const commits = [];
const sampler = spawn('powershell.exe', ['-NoProfile', '-Command', 'while ($true) { $o = Get-CimInstance Win32_OperatingSystem; "$([DateTimeOffset]::Now.ToUnixTimeMilliseconds()) $($o.TotalVirtualMemorySize - $o.FreeVirtualMemory)"; Start-Sleep -Milliseconds 500 }'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
let buf = '';
sampler.stdout.on('data', (d) => { buf += d; const ls = buf.split(/\r?\n/); buf = ls.pop(); for (const l of ls) { const m = /^(\d+) (\d+)$/.exec(l.trim()); if (m) commits.push({ t: Number(m[1]), mb: Number(m[2]) / 1024 }); } });
const commitAvg = (a, b) => { const xs = commits.filter((c) => c.t >= a && c.t <= b); return xs.length ? xs.reduce((s, c) => s + c.mb, 0) / xs.length : null; };
const dropAt = (t0, t1 = t0) => { const before = commitAvg(t0 - 3000, t0), after = commitAvg(t1 + 7000, t1 + 11000); return before != null && after != null ? Math.round(before - after) : null; };

// ---------- 상태 바뀜 기록(0.3초마다) ----------
const trans = [];
const lastSt = {};
let polling = null;
function startPoll(page) {
  polling = setInterval(async () => {
    try {
      for (const n of ALL) {
        const x = await sess(page, n); if (!x) continue;
        const st = x.waking ? 'waking' : x.state;
        if (st !== lastSt[n]) { trans.push({ n, st, t: Date.now(), scope: x.sleep ? x.sleep.scope : null }); lastSt[n] = st; }
      }
    } catch {}
  }, 300);
}
const sleptSince = (n, t) => trans.filter((x) => x.n === n && x.st === 'sleeping' && x.t >= t);
const wokeEvents = async (page, n) => (await call(page, 'session.events', { session: n, limit: 120 })).filter((e) => e.kind === 'woke');
const sleptEvents = async (page, n) => (await call(page, 'session.events', { session: n, limit: 120 })).filter((e) => e.kind === 'slept');
const askWord = async (page, n, since) => { atrium('send', `@${n}`, 'What codeword did I ask you to remember earlier? Reply with only the codeword.', '--wait'); return until(async () => { const x = await sess(page, n); return x.state === 'ready' && (x.lastAnswerAt || 0) > since && new RegExp(WORD[n].split('-')[0], 'i').test(x.lastAnswer || '') ? x : null; }, 120000, 500).catch(() => null); };

try { log('앞 판 백엔드 끄기(지금 코드로 띄우게)', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 끄기 실패', e.message); }
const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
const page = await app.firstWindow();
page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
try {
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await call(page, 'settings.set', { key: 'language', value: 'ko' });
  await call(page, 'settings.set', { key: 'sleepAfterMin', value: 0 });
  await call(page, 'settings.set', { key: 'sessionSleepAfterMin', value: 0 });

  // 0. 리포 하나에 헤드 lead와 하위 세션 c1·c2·c3(haiku). 준비된 뒤 암호를 기억하게 한다
  await call(page, 'workspace.open', { path: DIR });
  if (!(await sess(page, 'lead'))) atrium('spawn', DIR, '--name', 'lead', '--model', 'haiku');
  const lead0 = await until(async () => { const x = await sess(page, 'lead'); return x && ['ready', 'trust_wait'].includes(x.state) ? x : null; }, 120000, 300);
  if (lead0.state === 'trust_wait') { fs.writeFileSync(path.join(T.DEV, 'p111-need-trust.txt'), `개발용 판(atrium-dev-p111)의 @lead 카드(${DIR})에 신뢰 질문이 떴다\n`); throw new Error('신뢰 질문: 사람이 답해야 한다'); }
  for (const c of KIDS) if (!(await sess(page, c))) await call(page, 'session.spawn', { cwd: DIR, name: c, model: 'haiku', parentSessionId: lead0.id });
  for (const n of ALL) await waitState(page, n, 'ready', 120000);
  const ids = {};
  for (const n of ALL) ids[n] = (await sess(page, n)).id;
  for (const n of ALL) atrium('send', `@${n}`, `Remember this codeword for later: ${WORD[n]}. Reply with the single word OK.`, '--wait');
  for (const n of ALL) await until(async () => { const x = await sess(page, n); return x && x.state === 'ready' && x.lastAnswer && fs.existsSync(transcriptOf(x.id)); }, 120000, 500);
  const info0 = {}; for (const n of ALL) { const x = await sess(page, n); info0[n] = { ws: x.ws, parent: x.parent }; }
  step('준비: 리포 하나에 헤드 lead와 하위 세션 셋, 모두 첫 지시에 답했다', KIDS.every((c) => info0[c].ws === info0.lead.ws && info0[c].parent === ids.lead), info0);
  await look(page, 'p111-0-ready');
  startPoll(page);

  // 1. 헤드가 일하는 동안(긴 ping 턴) 쉬는 하위 세션 셋이 하나씩 혼자 잠든다
  await call(page, 'settings.set', { key: 'sleepAfterMin', value: 3 });
  await call(page, 'settings.set', { key: 'sessionSleepAfterMin', value: 1 });
  const t1 = Date.now();
  atrium('send', '@lead', LONG(5), '--wait');
  await waitState(page, 'lead', 'working', 60000);
  // 하위 세션의 쉬기 시작한 때를 20초씩 벌린다(하나씩 잠드는지 보고, 잠들 때마다 커밋을 따로 잰다)
  for (const c of KIDS) {
    const tc = Date.now();
    atrium('send', `@${c}`, 'Reply with the single word OK.', '--wait');
    await until(async () => { const x = await sess(page, c); return x.state === 'ready' && (x.lastAnswerAt || 0) > tc; }, 90000, 300);
    await lookAway(page);
    if (c !== 'c3') await sleep(20000);
  }
  await lookAway(page);
  await until(async () => KIDS.every((c) => sleptSince(c, t1).length) || null, 420000, 1000).catch(() => null);
  await sleep(12000); // 마지막 잠들기 뒤 커밋을 잴 동안 다음 깨우기를 미룬다
  const s1 = await states(page);
  const r1 = await status(page);
  const leadStAtSleeps = KIDS.map((c) => { const ts = (sleptSince(c, t1)[0] || {}).t; const l = trans.filter((x) => x.n === 'lead' && x.t <= ts).pop(); return { child: c, at: ts, lead: l ? l.st : null }; });
  measures.phase1 = { states: s1, repo: r1 && { why: r1.why, who: r1.who, each: r1.each }, leadStAtSleeps, sleptAt: KIDS.map((c) => (sleptSince(c, t1)[0] || {}).t - t1) };
  step('1 세션 규칙: 헤드가 일하는 동안 쉬는 하위 세션 셋이 모두 혼자 잠든다(scope session)', KIDS.every((c) => s1[c] === 'sleeping' && eachOf(r1, c).scope === 'session'), { s1, each: r1 && r1.each });
  step('1 세션 규칙: 하위 세션이 잠들 때마다 헤드는 일하는 중이고 잠들지 않았다', leadStAtSleeps.every((x) => x.lead === 'working') && !sleptSince('lead', t1).length && s1.lead !== 'sleeping', leadStAtSleeps);
  const at1 = leadStAtSleeps.map((x) => x.at).sort((a, b) => a - b);
  step('1 세션 규칙: 하나씩 잠든다(잠든 때가 서로 다르다)', at1[1] - at1[0] > 5000 && at1[2] - at1[1] > 5000, measures.phase1.sleptAt);
  step('1 리포 규칙은 걸리지 않는다(리포는 lead가 일해서 working)', r1 && r1.why === 'working' && r1.who === 'lead', r1 && { why: r1.why, who: r1.who });
  for (const c of KIDS) { const t0 = (sleptSince(c, t1)[0] || {}).t; const ev = (await sleptEvents(page, c)).pop(); measures.sleeps.push({ phase: 1, name: c, scope: 'session', at: t0, commitDropMB: dropAt(t0, t0 + ((ev && ev.data.ms) || 3000)), paneMemMB: ev && ev.data.memMB, ms: ev && ev.data.ms }); }
  log('커밋(잠들 때마다)', measures.sleeps);
  await look(page, 'p111-1-children-asleep');

  // 2. 잠든 c1을 누르면 c1만 깨고 같은 대화로 이어진다
  await viewNode(page, 'c1', 900);
  await shot(page, 'p111-2-c1-asleep-face');
  const t2 = Date.now();
  await page.click('.mt-node[data-name="c1"] [data-role="sleep-face"]');
  await waitState(page, 'c1', 'ready', 120000);
  const s2 = await states(page);
  const w2 = (await wokeEvents(page, 'c1')).pop();
  const others2 = trans.filter((x) => (x.n === 'c2' || x.n === 'c3') && x.t >= t2);
  step('2 누르기: 혼자 잠든 c1만 깨고 c2·c3는 그대로 잔다(깨우는 중도 아니다)', s2.c1 === 'ready' && s2.c2 === 'sleeping' && s2.c3 === 'sleeping' && !others2.length, { s2, others2 });
  step('2 누르기: 같은 대화 ID로 이어 간다', w2 && w2.data.why === 'click' && w2.data.plan === 'resume' && w2.data.convId === ids.c1, w2 && w2.data);
  measures.phase2 = { wakeMs: w2 && w2.data.ms, clickToReadyMs: Date.now() - t2 };
  await lookAway(page);
  const c1m = await askWord(page, 'c1', t2);
  step('2 누르기: 깬 c1이 잠들기 전 대화(암호)를 기억한다', !!c1m, c1m && c1m.lastAnswer);
  await lookAway(page);

  // 3. 잠든 c2에 명령 바로 글을 보내면 c2만 깨고 글이 들어간다
  const t3 = Date.now();
  await page.fill('[data-role="command"]', '@c2 What codeword did I ask you to remember earlier? Reply with only the codeword.');
  await page.click('[data-action="send"]');
  await lookAway(page);
  const dl = await until(async () => { const d = await call(page, 'delivery.list', { session: 'c2', limit: 3 }); const x = d.find((y) => (y.createdAt || 0) >= t3 - 1000); return x && ['confirmed', 'failed', 'cancelled', 'unconfirmed'].includes(x.status) ? x : null; }, 180000, 500).catch(() => null);
  const dEv = dl ? (await call(page, 'session.events', { session: 'c2', limit: 160 })).filter((e) => e.kind === 'delivery' && e.data.deliveryId === dl.deliveryId).map((e) => `${e.data.status}:${e.data.reason || ''}`) : [];
  const c2m = await until(async () => { const x = await sess(page, 'c2'); return x.state === 'ready' && (x.lastAnswerAt || 0) > t3 && /MAPLE/i.test(x.lastAnswer || '') ? x : null; }, 120000, 500).catch(() => null);
  const s3 = await states(page);
  const others3 = trans.filter((x) => x.n === 'c3' && x.t >= t3);
  const w3 = (await wokeEvents(page, 'c2')).pop();
  step('3 글 보내기: 잠든 c2가 깨고 글이 들어가 암호로 답한다', dl && dl.status === 'confirmed' && !!c2m && w3 && w3.data.why === 'delivery', { dEv, answer: c2m && c2m.lastAnswer, woke: w3 && w3.data });
  step('3 글 보내기: c2만 깬다(c3는 그대로 잔다)', s3.c3 === 'sleeping' && !others3.length, { s3, others3 });
  measures.phase3 = { dEv, wakeMs: w3 && w3.data.ms, sendToAnswerMs: c2m ? c2m.lastAnswerAt - t3 : null };
  await look(page, 'p111-3-after-send');

  // 4. c1이 일하는 동안 쉬는 헤드는 잠들지 않는다(일하는 자손)
  await waitState(page, 'lead', 'ready', 600000);
  const t4 = Date.now();
  atrium('send', '@c1', LONG(3), '--wait');
  await waitState(page, 'c1', 'working', 60000);
  await lookAway(page);
  await until(async () => { const x = await sess(page, 'c1'); return Date.now() - t4 > 170000 || x.state !== 'working' ? true : null; }, 240000, 1000).catch(() => null);
  const r4 = await status(page);
  const s4 = await states(page);
  measures.phase4 = { states: s4, lead: eachOf(r4, 'lead'), waitedMs: Date.now() - t4 };
  for (const c of KIDS) for (const x of sleptSince(c, t4)) { const ev = (await sleptEvents(page, c)).pop(); measures.sleeps.push({ phase: 4, name: c, scope: x.scope || 'session', at: x.t, commitDropMB: Date.now() - x.t > 11000 ? dropAt(x.t, x.t + ((ev && ev.data.ms) || 3000)) : null, paneMemMB: ev && ev.data.memMB, ms: ev && ev.data.ms }); }
  step('4 일하는 자손: c1이 일하는 동안 쉰 헤드는 잠들지 않는다(까닭 child_busy)',s4.c1 === 'working' && !sleptSince('lead', t4).length && s4.lead === 'ready' && eachOf(r4, 'lead').why === 'child_busy', measures.phase4);
  await look(page, 'p111-4-lead-awake-child-working');

  // 5. 모두 쉬면 리포 규칙(1분)이 세션 규칙(3분)보다 먼저 lead·c1을 리포째 잠재운다. 앞서 혼자 잠든 c2·c3는 session 그대로.
  //    lead를 누르면 리포 규칙이 잠재운 lead·c1만 깨고 c2·c3는 잔다. 그 뒤 c2를 누르면 c2만 깬다
  await call(page, 'settings.set', { key: 'sessionSleepAfterMin', value: 3 });
  await call(page, 'settings.set', { key: 'sleepAfterMin', value: 1 });
  await waitState(page, 'c1', 'ready', 420000);
  const t5 = Date.now();
  await lookAway(page);
  await until(async () => { const s = await states(page); return ALL.every((n) => s[n] === 'sleeping') || null; }, 360000, 1000).catch(() => null);
  await sleep(12000); // 리포째 잠든 뒤 커밋을 잴 동안 깨우기를 미룬다
  const s5 = await states(page);
  const r5 = await status(page);
  const repoEv = {}; for (const n of ['lead', 'c1']) repoEv[n] = ((await sleptEvents(page, n)).pop() || {}).data;
  measures.phase5 = { states: s5, each: r5 && r5.each, why: r5 && r5.why, slept: repoEv };
  const scope5 = Object.fromEntries(ALL.map((n) => [n, eachOf(r5, n).scope]));
  step('5 리포 규칙: 모두 쉬면 넷 모두 잠들고 리포 판정은 asleep', ALL.every((n) => s5[n] === 'sleeping') && r5.why === 'asleep', { s5, why: r5 && r5.why });
  step('5 리포 규칙: lead·c1은 리포 규칙으로(scope repo), 앞서 혼자 잠든 c2·c3는 session 그대로', scope5.lead === 'repo' && scope5.c1 === 'repo' && scope5.c2 === 'session' && scope5.c3 === 'session' && repoEv.lead && repoEv.lead.scope === 'repo' && repoEv.c1 && repoEv.c1.scope === 'repo', { scope5, slept: repoEv });
  const g5 = ['lead', 'c1'].map((n) => sleptSince(n, t5)[0]).filter(Boolean).sort((a, b) => a.t - b.t);
  if (g5.length) measures.sleeps.push({ phase: 5, name: g5.map((x) => x.n).join('+'), scope: 'repo', at: g5[0].t, commitDropMB: dropAt(g5[0].t, g5[g5.length - 1].t + 3000) });
  log('커밋(리포째)', measures.sleeps.filter((x) => x.phase === 5));
  await look(page, 'p111-5-repo-asleep');
  await viewNode(page, 'lead', 900);
  const t6 = Date.now();
  await page.click('.mt-node[data-name="lead"] [data-role="sleep-face"]');
  for (const n of ['lead', 'c1']) await waitState(page, n, 'ready', 150000);
  await sleep(3000); // 늦게 깨는 세션이 없는지 잠깐 더 본다
  const s6 = await states(page);
  const w6 = {}; for (const n of ['lead', 'c1']) w6[n] = ((await wokeEvents(page, n)).pop() || {}).data;
  const others6 = trans.filter((x) => (x.n === 'c2' || x.n === 'c3') && x.t >= t6);
  step('5 리포째 깨우기: lead를 누르면 lead(click)와 c1(repo:click)만 같은 대화 ID로 깬다', ['lead', 'c1'].every((n) => s6[n] === 'ready' && w6[n] && w6[n].convId === ids[n] && w6[n].plan === 'resume') && w6.lead.why === 'click' && /^repo:/.test(w6.c1.why), { s6, w6 });
  step('5 리포째 깨우기: 혼자 잠든 c2·c3는 깨지 않는다(깨우는 중도 아니다, scope session 그대로)', s6.c2 === 'sleeping' && s6.c3 === 'sleeping' && !others6.length && eachOf(await status(page), 'c2').scope === 'session', { s6, others6 });
  measures.phase5.wake = Object.fromEntries(['lead', 'c1'].map((n) => [n, w6[n] && { why: w6[n].why, ms: w6[n].ms }]));
  await lookAway(page);
  const leadm = await askWord(page, 'lead', t6);
  step('5 리포째 깨우기: lead가 잠들기 전 대화(암호)를 기억한다', !!leadm, leadm && leadm.lastAnswer);
  await look(page, 'p111-5-repo-awake');
  // 그 뒤 혼자 잠든 c2를 누르면 c2만 깬다
  await viewNode(page, 'c2', 900);
  const t7 = Date.now();
  await page.click('.mt-node[data-name="c2"] [data-role="sleep-face"]');
  await waitState(page, 'c2', 'ready', 120000);
  await sleep(2000);
  const s7 = await states(page);
  const w7 = ((await wokeEvents(page, 'c2')).pop() || {}).data;
  const others7 = trans.filter((x) => x.n === 'c3' && x.t >= t7);
  step('5 혼자 깨우기: 그 뒤 c2를 누르면 c2만 같은 대화로 깨고 c3는 잔다', s7.c2 === 'ready' && s7.c3 === 'sleeping' && !others7.length && w7 && w7.why === 'click' && w7.convId === ids.c2, { s7, w7, others7 });
  measures.phase5.wakeC2 = w7 && { why: w7.why, ms: w7.ms };
  await lookAway(page);
  const c2m7 = await askWord(page, 'c2', t7);
  step('5 혼자 깨우기: 깬 c2가 잠들기 전 대화(암호)를 기억한다', !!c2m7, c2m7 && c2m7.lastAnswer);
  await look(page, 'p111-5-c2-awake');
} catch (e) {
  step('예외', false, e.stack);
  await shot(page, 'p111-error').catch(() => {});
} finally {
  clearInterval(polling);
  // 잠든 뒤 11초가 지나지 않아 재지 못한 값을 끝에서 다시 잰다(잴 때까지 다음 잠들기가 없었는지는 trans로 본다)
  await sleep(12000);
  for (const x of measures.sleeps) if (x.commitDropMB == null && x.at) x.commitDropMB = dropAt(x.at, x.at + (x.ms || 3000));
  try { sampler.kill(); } catch {}
  fs.writeFileSync(path.join(OUT, 'p111-commits.json'), JSON.stringify(commits));
  for (const n of ALL) { try { atrium('kill', n, '--yes'); } catch {} }
  fs.writeFileSync(path.join(OUT, 'p111-session.json'), JSON.stringify({ results, measures, trans }, null, 2));
  const fail = results.filter((r) => !r.ok);
  log(`끝: 통과 ${results.length - fail.length}/${results.length}`);
  await closeApp(app);
  process.exit(fail.length ? 1 : 0);
}
