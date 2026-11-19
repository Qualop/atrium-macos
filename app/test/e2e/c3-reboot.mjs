// P3 완료 기준 1(C3) 재부팅 대신: 창을 닫고, 개발용 백엔드와 개발용 herdr 서버를 모두 강제 종료한 뒤 창을 다시 띄운다(창이 백엔드를, 백엔드가 herdr를 띄운다).
// PC를 재부팅하지 않는다. 직접 띄운 백엔드와 herdr 서버의 PID만 끈다.
import { execFileSync } from 'node:child_process';
import { launch, shot, logger, sleep, until, sessionsOf } from './harness.mjs';

const log = logger('c3-reboot');
let { app, page } = await launch({ log });
let call = (m, p) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const S = async (name) => (await sessionsOf(page)).find((s) => s.name === name);
await call('session.send', { text: '@d Write the numbers from 1 to 500, one per line, with no other text.' });
await until(async () => (await S('d')).state === 'working', 60000);
await sleep(1000);
const st = await call('backend.status');
log('끄기 전', (await sessionsOf(page)).map((s) => `${s.name}:${s.state}`).join(' '), { backendPid: st.pid, herdrPid: st.terminal.serverPid });
await app.close();
execFileSync('taskkill', ['/PID', String(st.pid), '/F']);
execFileSync('taskkill', ['/PID', String(st.terminal.serverPid), '/F']);
log('강제 종료: 백엔드', st.pid, 'herdr 서버', st.terminal.serverPid);
await sleep(3000);
({ app, page } = await launch({ log }));
call = (m, p) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const st2 = await call('backend.status');
log('다시 띄움', { backendPid: st2.pid, herdrPid: st2.terminal.serverPid, previousRun: st2.previousRun });
await until(async () => (await sessionsOf(page)).every((s) => s.state === 'ready'), 120000);
await sleep(4000);
const d = await page.evaluate(() => [...window.__mt.getState().sessions.values()].find((s) => s.name === 'd'));
log('d', { state: d.state, interruptedTurn: d.interruptedTurn, recovered: d.recovered, resume: d.resume });
const ev = await call('session.events', { limit: 400 });
log('이벤트', ev.filter((e) => ['herdr_restarted_while_down', 'turn_interrupted', 'recover_check', 'recovered_by_board', 'resync', 'backend_started', 'herdr_started'].includes(e.kind) && e.t > Date.now() - 120000).map((e) => `${new Date(e.t).toISOString().slice(11, 23)} ${e.kind} ${(e.sessionId || '').slice(0, 8)} ${JSON.stringify(e.data).slice(0, 140)}`));
// d가 보이게 맞춘다
const n = await page.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'd'); return window.__mt.getState().nodes.get(s.sessionId); });
await page.evaluate((r) => window.__mt.getState().setViewport({ x: 800 - (r.x + r.w / 2), y: 420 - (r.y + r.h / 2), zoom: 1 }), n);
await until(() => page.evaluate(() => window.__mt.terms.size >= 1), 20000).catch(() => {});
await sleep(3000);
log('d 노드의 끊긴 턴 꼬리', await page.evaluate(() => [...document.querySelectorAll('.mt-node[data-name="d"] .mt-tail > div')].map((x) => x.textContent.slice(0, 100))));
log('터미널', await page.evaluate(() => ({ terms: window.__mt.terms.size, covers: [...document.querySelectorAll('.mt-term-cover')].map((c) => c.textContent) })));
await shot(page, 'c3-4-after-reboot-substitute', log);
await app.close();
