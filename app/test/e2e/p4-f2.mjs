// P4 완료 기준 4(F2): 판에서 A 노드에서 B 노드로 선을 끌어 역할을 적으면, 판이 A에게 B의 herdr 이름, 패널 ID, 역할을 알린다.
// 그 뒤 A에게 "리뷰어에게 맡겨"라고만 해도 A가 B에게 일을 시킨다. 다시 띄우기와 끊기는 p4-f2-restart.mjs.
// 새 세션 대화상자로 lead(herdr 명령 자동 승인)와 rev를 띄운다(haiku). MT_E2E_OUT=p4
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, shot, logger, sleep, waitState, REPO, closeApp } from './harness.mjs';
import { linksOf, frame, runUntilReady, sendBar, labelShot, until } from './p4-lib.mjs';

const log = logger('p4-f2');
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8' });
const { app, page } = await launch({ log });

async function spawnFromDialog(name, { allowHerdr = false, shotName = null } = {}) {
  if (await page.evaluate((n) => [...window.__mt.getState().sessions.values()].some((s) => s.name === n), name)) { log(`${name}: 이미 있음`); return; }
  await page.click('[data-action=spawn]');
  await page.fill('[data-field=name]', name);
  log(`${name}: 대화상자`, await page.evaluate(() => ({ kind: document.querySelector('[data-field=kind]').value, kinds: [...document.querySelectorAll('[data-field=kind] option')].map((o) => `${o.value}${o.disabled ? '(없음)' : ''}`), model: document.querySelector('[data-field=model]').value })));
  if (shotName) await shot(page, shotName, log);
  await page.click('[data-action=spawn-submit]');
  await page.waitForSelector(`.mt-node[data-name="${name}"]`, { timeout: 30000 });
}
await spawnFromDialog('lead', { allowHerdr: true, shotName: 'f2-0-spawn-dialog' });
await spawnFromDialog('rev');
await waitState(page, 'lead', 'ready', 90000); await waitState(page, 'rev', 'ready', 90000);
log('lead, rev 준비');
await frame(page, ['lead', 'rev'], { maxZoom: 0.5 });

// 판에서 lead의 손잡이를 끌어 rev에 놓는다
const side = await page.evaluate(() => {
  const st = window.__mt.getState(); const id = (n) => [...st.sessions.values()].find((s) => s.name === n).sessionId;
  const a = st.nodes.get(id('lead')), b = st.nodes.get(id('rev'));
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  return Math.abs(dx) - (a.w + b.w) / 2 >= Math.abs(dy) - (a.h + b.h) / 2 ? (dx >= 0 ? ['r', 'l'] : ['l', 'r']) : (dy >= 0 ? ['b', 't'] : ['t', 'b']);
});
const hA = await page.locator(`.mt-node[data-name="lead"] .react-flow__handle.h-${side[0]}`).boundingBox();
const hB = await page.locator(`.mt-node[data-name="rev"] .react-flow__handle.h-${side[1]}`).boundingBox();
await page.mouse.move(hA.x + hA.width / 2, hA.y + hA.height / 2);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(hA.x + (hB.x - hA.x) * i / 12 + hA.width / 2, hA.y + (hB.y - hA.y) * i / 12 + hA.height / 2);
await page.mouse.up();
await page.waitForSelector('[data-role="link-role"]', { timeout: 5000 });
log(`손잡이 ${side[0]} → ${side[1]}로 끌어 이음. 역할 대화상자`, await page.evaluate(() => document.querySelector('[data-role="link-role"]').innerText.replace(/\s+/g, ' ')));
await page.fill('[data-field=role]', '리뷰어');
await shot(page, 'f2-1-role-dialog', log);
await page.click('[data-action=link-submit]');
const link = await until(async () => (await linksOf(page)).find((l) => l.from === 'lead' && l.to === 'rev' && l.role), 10000);
log('연결', link);
log('판이 lead에게 보낸 알림', JSON.parse(atrium('--json', 'linklog', link.id)).events.find((e) => e.kind === 'role').data.notice);

// 알림이 lead에게 들어가고 lead가 답할 때까지
await runUntilReady(page, 'lead', log, { timeout: 120000 });
log('알림 뒤 lead의 답', await page.evaluate(() => [...window.__mt.getState().sessions.values()].find((s) => s.name === 'lead').lastAnswer));
await labelShot(page, link.id, 'f2-2-linked', shot, log);

// "리뷰어에게 맡겨"라고만 한다
const ask = '리뷰어에게 맡겨: "Reply with exactly: LGTM". 리뷰어의 답을 받아 와서 알려 줘.';
await sendBar(page, `@lead ${ask}`);
log(`@lead에게 보냄: ${ask}`);
await runUntilReady(page, 'lead', log, { timeout: 240000 });
await sleep(1500);
const ev = JSON.parse(atrium('--json', 'linklog', link.id)).events;
log('오간 기록', ev.map((e) => `${e.kind}${e.text ? ` "${e.text.replace(/\s+/g, ' ').slice(0, 80)}"` : ''}`));
log('lead의 답', await page.evaluate(() => [...window.__mt.getState().sessions.values()].find((s) => s.name === 'lead').lastAnswer));
await labelShot(page, link.id, 'f2-3-delegated', shot, log);

// 창과 백엔드를 다시 띄워도 남는지, 연결 끊기는 p4-f2-restart.mjs가 이어서 본다
await closeApp(app);
process.exit(0);
