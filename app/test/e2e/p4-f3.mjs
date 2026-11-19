// P4 완료 기준 5(F3): A가 herdr로 패널을 나누고 새 에이전트를 띄우면, 새 노드가 A 옆 빈자리에 저절로 생기고 A와 이어진다.
// 그 노드도 상태, 화면, 끄기가 된다. 같은 탭의 패널끼리 제어기가 패널 크기를 두고 다투지 않는지 본다. MT_E2E_OUT=p4
// 인자: A 이름(기본 a), 새 에이전트 이름(기본 helper2)
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, shot, logger, sleep, REPO, closeApp } from './harness.mjs';
import { linksOf, frame, runUntilReady, sendBar, labelShot, until, sid } from './p4-lib.mjs';

const [A = 'a', N = 'helper2'] = process.argv.slice(2);
const log = logger('p4-f3');
const herdr = (m, p) => JSON.parse(execFileSync(process.execPath, [path.join(REPO, 'experiments', 'p4', 'tools', 'h.mjs'), m, JSON.stringify(p)], { encoding: 'utf8' }));
const { app, page } = await launch({ log });
await frame(page, [A], { maxZoom: 0.5 });
const before = await page.evaluate(() => [...window.__mt.getState().nodes.entries()].map(([id, r]) => ({ id, ...r })));

const task = `Use herdr: split your own pane down, start a new claude agent named ${N} in the new pane (pass --model haiku as the agent argument), then ask ${N} to reply with exactly: hi2. Tell me ${N}'s answer.`;
await sendBar(page, `@${A} ${task}`);
log(`@${A}에게 보냄: ${task}`);
await runUntilReady(page, A, log, { timeout: 240000 });
await sleep(1500);

const s = await page.evaluate((n) => [...window.__mt.getState().sessions.values()].find((x) => x.name === n), N);
if (!s) throw new Error(`${N} 노드가 생기지 않았다`);
const parent = await page.evaluate((id) => window.__mt.getState().sessions.get(id), s.parentSessionId);
log('새 노드', { name: s.name, kind: s.kind, origin: s.origin, parent: parent && parent.name, paneId: s.paneId, termWorkspaceId: s.termWorkspaceId, state: s.state, hooked: s.hooked, lastAnswer: s.lastAnswer });
const rect = await page.evaluate((id) => window.__mt.getState().nodes.get(id), s.sessionId);
const aRect = await page.evaluate((id) => window.__mt.getState().nodes.get(id), await sid(page, A));
const overlaps = before.filter((n) => n.id !== s.sessionId && rect.x < n.x + n.w && n.x < rect.x + rect.w && rect.y < n.y + n.h && n.y < rect.y + rect.h).length;
log('자리', { new: rect, parent: aRect, overlapsOthers: overlaps });
const link = (await linksOf(page)).find((l) => l.from === A && l.to === N);
log('연결', link);
log('새 노드 머리줄', await page.evaluate((n) => document.querySelector(`.mt-node[data-name="${n}"] .mt-node-head`).innerText.replace(/\s+/g, ' '), N));
await frame(page, [A, N], { maxZoom: 0.5 });
await shot(page, 'f3-1-new-node-next-to-parent', log);
if (link) await labelShot(page, link.id, 'f3-2-spawn-line', shot, log);

// 화면: 두 노드(같은 탭의 패널)에 터미널을 붙인다. 제어기는 노드 크기대로, herdr 레이아웃은 그대로인가
await frame(page, [A, N], { maxZoom: 0.62 });
await sleep(2500);
const terms = await page.evaluate(([a, b]) => { const out = {}; for (const [id, t] of window.__mt.terms) { const n = window.__mt.getState().sessions.get(id).name; if (n === a || n === b) { const lines = []; for (let i = 0; i < t.rows; i++) { const l = t.buffer.active.getLine(i); if (l && l.translateToString(true).trim()) lines.push(l.translateToString(true).trim()); } out[n] = { cols: t.cols, rows: t.rows, tail: lines.slice(-6) }; } } return out; }, [A, N]);
log('붙은 터미널(노드 크기)', terms);
log('herdr 레이아웃(같은 탭)', herdr('pane.layout', { pane_id: s.paneId }).layout.panes.map((p) => `${p.pane_id}=${p.rect.width}x${p.rect.height}`));
await shot(page, 'f3-3-terminals-same-tab', log);

// 끄기: 같은 작업 공간의 A 패널은 남기고 새 패널만 닫는다
await page.click(`.mt-node[data-name="${N}"] .mt-x[title="세션 끄기"]`);
await page.waitForSelector(`.mt-node[data-name="${N}"] .mt-kill .mt-btn.danger`);
await sleep(500);
log('끄기 확인 문구', await page.evaluate((n) => document.querySelector(`.mt-node[data-name="${n}"] .mt-kill`).innerText.replace(/\s+/g, ' '), N));
await shot(page, 'f3-4-kill-confirm', log);
await page.click(`.mt-node[data-name="${N}"] .mt-kill .mt-btn.danger`);
await until(async () => !(await page.evaluate((n) => [...window.__mt.getState().sessions.values()].some((x) => x.name === n), N)), 30000);
log('끈 뒤', { aState: await page.evaluate((n) => [...window.__mt.getState().sessions.values()].find((x) => x.name === n).state, A), panes: herdr('pane.list', { workspace_id: s.termWorkspaceId }).panes.map((p) => `${p.pane_id}:${p.agent || 'shell'}`) });
log('이벤트', execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', 'events', '--limit', '400'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('closed') || l.includes('adopted')).slice(-4));
await frame(page, [A], { maxZoom: 0.5 });
await shot(page, 'f3-5-after-kill', log);
await closeApp(app);
process.exit(0);
