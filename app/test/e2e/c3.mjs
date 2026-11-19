// P3 완료 기준 1(C3): herdr 서버가 다시 뜬 뒤 "재시작으로 끊긴 턴" 표시와 대화 기록 꼬리를 노드에서 보여준다.
// 자기 개발용 herdr 서버 PID만 강제 종료한다. 2부는 resume_argv 등록 직후(session.json 저장 전)에 강제 종료해 등록을 잃는 경우와 판의 대책을 본다.
// 시험 세션 a, b, c, d(haiku)가 판에 있어야 한다.
import { execFileSync } from 'node:child_process';
import { launch, shot, logger, sleep, until, sessionsOf } from './harness.mjs';

const log = logger('c3');
const { app, page } = await launch({ log });
const call = (m, p) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const S = async (name) => (await sessionsOf(page)).find((s) => s.name === name);
const full = (name) => page.evaluate((n) => [...window.__mt.getState().sessions.values()].find((s) => s.name === n), name);
const killHerdr = async () => { const st = await call('terminal.status'); execFileSync('taskkill', ['/PID', String(st.serverPid), '/F']); return st.serverPid; };
const view = async (names) => {
  const ns = await page.evaluate(() => [...window.__mt.getState().nodes.entries()].map(([id, r]) => ({ id, ...r })));
  const ids = new Set((await sessionsOf(page)).filter((s) => names.includes(s.name)).map((s) => s.id));
  const pick = ns.filter((n) => ids.has(n.id));
  const minX = Math.min(...pick.map((n) => n.x)), minY = Math.min(...pick.map((n) => n.y)), maxX = Math.max(...pick.map((n) => n.x + n.w)), maxY = Math.max(...pick.map((n) => n.y + n.h));
  const area = await page.evaluate(() => { const r = document.querySelector('.mt-canvas').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  const zoom = Math.min(1, Math.min(area.w / (maxX - minX + 80), area.h / (maxY - minY + 80)));
  await page.evaluate((vp) => window.__mt.getState().setViewport(vp), { x: (area.w - (maxX - minX) * zoom) / 2 - minX * zoom, y: (area.h - (maxY - minY) * zoom) / 2 - minY * zoom, zoom });
};

// ---------- 1부: 턴 도중 herdr 서버 강제 종료 ----------
await view(['a', 'b', 'c', 'd']);
await call('session.send', { text: '@b Use the Write tool to create c3-b.txt containing hi. Use no other tool.' });
await until(async () => (await S('b')).state === 'waiting', 90000);
await call('session.send', { text: '@c Write the numbers from 1 to 400, one per line, with no other text.' });
await until(async () => (await S('c')).state === 'working', 60000);
await sleep(1500);
log('끄기 전', (await sessionsOf(page)).map((s) => `${s.name}:${s.state}`).join(' '));
const pid = await killHerdr();
log('강제 종료한 herdr 서버 pid(개발용 atrium-dev)', pid);
await until(() => page.evaluate(() => window.__mt.getState().terminal.connected === false), 10000);
await sleep(1500);
log('끈 뒤', (await sessionsOf(page)).map((s) => `${s.name}:${s.state}`).join(' '), (await full('c')).interruptedTurn);
await shot(page, 'c3-1-herdr-down', log);
// 창의 "herdr 켜기"로 다시 띄운다
await page.click('[data-action="terminal-start"]');
await until(async () => { const ss = await sessionsOf(page); return ss.filter((s) => ['a', 'b', 'c', 'd'].includes(s.name)).every((s) => s.state === 'ready'); }, 90000);
await sleep(3000);
const b = await full('b'), c = await full('c');
log('다시 뜬 뒤 b', { state: b.state, interruptedTurn: b.interruptedTurn, resume: b.resume }, 'c', { state: c.state, interruptedTurn: c.interruptedTurn });
const banners = await page.evaluate(() => [...document.querySelectorAll('.mt-node')].filter((n) => n.querySelector('[data-role="interrupted"]')).map((n) => n.dataset.name));
log('끊긴 턴 표시가 있는 노드', banners);
await view(['b', 'c']);
await sleep(2500);
const tails = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.mt-node')].filter((n) => n.querySelector('[data-role="interrupted"]')).map((n) => [n.dataset.name, [...n.querySelectorAll('.mt-tail > div')].map((d) => d.textContent.slice(0, 110))])));
log('노드의 대화 기록 꼬리', tails);
await shot(page, 'c3-2-interrupted-turns', log);
const ev = await call('session.events', { session: 'c', limit: 40 });
log('c 이벤트', ev.filter((e) => ['turn_interrupted', 'state', 'recover_check', 'recovered_by_board', 'resume_registered', 'resume_verified'].includes(e.kind)).map((e) => `${new Date(e.t).toISOString().slice(11, 23)} ${e.kind} ${JSON.stringify(e.data).slice(0, 120)}`));
// hook이 판의 토큰으로 다시 오는가
const r = await call('session.send', { text: '@b Reply with exactly: after-restart-b' });
await until(async () => { const d = await call('delivery.list', { session: 'b', limit: 1 }); return d[0] && ['confirmed', 'unconfirmed', 'failed'].includes(d[0].status) && d[0].deliveryId === r.deliveries[0].deliveryId; }, 60000);
await until(async () => (await S('b')).state === 'ready' && (await S('b')).lastAnswer, 60000);
const bb = await call('session.get', { session: 'b', screen: false });
log('다시 뜬 뒤 b에 보낸 글', { delivery: (await call('delivery.list', { session: 'b', limit: 1 }))[0].status, lastAnswer: bb.lastAnswer, hookAuth: bb.hooks, interruptedTurn: bb.interruptedTurn });

// ---------- 2부: resume_argv 등록 직후(session.json 저장 전) 강제 종료 ----------
await call('session.spawn', { cwd: 'C:/Workspace/multitask/backend/.dev/proj', name: 'k2', model: 'haiku', prompt: 'Reply with exactly: k2-first' });
let reg = null;
const t0 = Date.now();
while (!reg && Date.now() - t0 < 60000) { const e = await call('session.events', { session: 'k2', limit: 60 }); reg = e.find((x) => x.kind === 'resume_registered'); if (!reg) await sleep(40); }
const pid2 = await killHerdr();
log('k2 등록', reg && new Date(reg.t).toISOString().slice(11, 23), '→ 곧바로 herdr 강제 종료 pid', pid2, `(등록 뒤 ${Date.now() - reg.t}ms)`);
await until(() => page.evaluate(() => window.__mt.getState().terminal.connected === false), 10000);
await sleep(1200);
await page.click('[data-action="terminal-start"]');
await until(async () => { const k = await S('k2'); return k && k.state === 'ready'; }, 120000);
await sleep(3000);
const kev = await call('session.events', { session: 'k2', limit: 80 });
log('k2 이벤트', kev.filter((e) => ['resync', 'recover_check', 'recovered_by_board', 'recover_failed', 'resume_registered', 'resume_verified', 'closed', 'turn_interrupted'].includes(e.kind) || (e.kind === 'state')).map((e) => `${new Date(e.t).toISOString().slice(11, 23)} ${e.kind} ${JSON.stringify(e.data).slice(0, 160)}`));
const r2 = await call('session.send', { text: '@k2 Reply with exactly: k2-after-recover' });
await until(async () => { const d = (await call('delivery.list', { session: 'k2', limit: 1 }))[0]; return d && d.deliveryId === r2.deliveries[0].deliveryId && ['confirmed', 'unconfirmed', 'failed'].includes(d.status); }, 60000);
await until(async () => (await S('k2')).lastAnswer === 'k2-after-recover', 60000).catch(() => {});
const k2 = await call('session.get', { session: 'k2' });
log('k2 되살린 뒤', { state: k2.state, recovered: k2.recovered, lastAnswer: k2.lastAnswer, hooks: k2.hooks, paneId: k2.paneId, transcript: k2.transcriptPath, resume: k2.resume });
const msgs = await call('session.messages', { session: 'k2', limit: 20 });
log('k2 대화 기록(같은 파일에 이어짐)', msgs.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => `${m.role}: ${String(m.text).slice(0, 60)}`));
await view(['k2']);
await sleep(2000);
log('터미널', await page.evaluate(() => ({ terms: window.__mt.terms.size, covers: [...document.querySelectorAll('.mt-term-cover')].map((c) => c.textContent), reattach: window.__mt.perf.events.filter((e) => e.kind === 'term_auto_reattach').length })));
await shot(page, 'c3-3-recovered-k2', log);
await app.close();
