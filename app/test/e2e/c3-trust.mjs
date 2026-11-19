// 완료 기준 3의 trust_wait: 처음 쓰는 폴더에서 시작한 세션의 상태 필과 카드. 판은 신뢰를 누르지 않는다.
// 노드의 ×(끄기)와 확인으로 끈다. 백엔드가 esc로 대화상자를 나가 claude를 끝낸다. 만든 임시 폴더는 지운다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, shot, logger, sessionsOf, waitState, waitFor, sleep } from './harness.mjs';

const log = logger('c3-trust');
const dir = path.join(os.tmpdir(), `mtask-trust-p2-${Date.now()}`);
fs.mkdirSync(dir);
log('새 폴더', dir);
const { app, page } = await launch({ log });
try {
  await page.click('[data-action=spawn]');
  await page.fill('[data-field=cwd]', dir);
  await page.fill('[data-field=name]', 't');
  await page.waitForSelector('.mt-modal .mt-warn', { timeout: 10000 });
  log('대화상자 경고', await page.textContent('.mt-modal .mt-warn'));
  await shot(page, 'c3-trust-dialog-warning', log);
  await page.click('[data-action=spawn-submit]');
  await waitState(page, 't', 'trust_wait', 60000);
  await sleep(1500);
  const t = (await sessionsOf(page)).find((s) => s.name === 't');
  log('t', { state: t.state, term: t.term });
  await page.evaluate((id) => window.__mt.getState().navigateTo(id), t.id);
  await sleep(2500);
  log('필', await page.evaluate(() => document.querySelector('.mt-node[data-name="t"] .mt-pill').dataset.state), '칩', await page.evaluate(() => [...document.querySelectorAll('.mt-chip.need')].map((c) => c.textContent)));
  await shot(page, 'c3-trust-wait', log);
  // 끄기: × → 확인 문구 → 끄기
  await page.click('.mt-node[data-name="t"] .mt-x');
  await page.waitForFunction(() => { const k = document.querySelector('.mt-node[data-name="t"] .mt-kill'); return k && !k.textContent.includes('받는 중'); });
  log('확인 문구', await page.textContent('.mt-node[data-name="t"] .mt-kill'));
  await shot(page, 'c3-trust-kill-confirm', log);
  await page.click('.mt-node[data-name="t"] .mt-kill .mt-btn.danger');
  await waitFor(page, () => ![...window.__mt.getState().sessions.values()].some((s) => s.name === 't'), null, 30000);
  const ev = await page.evaluate((id) => window.__mt.api.call('session.events', { session: undefined, limit: 400 }).then((e) => e.filter((x) => x.sessionId === id && ['state', 'trust_dialog', 'closed'].includes(x.kind)).map((x) => `${x.kind} ${JSON.stringify(x.data).slice(0, 140)}`)), t.id);
  log('t 기록', ev);
} finally {
  await app.close();
  await sleep(500);
  fs.rmSync(dir, { recursive: true, force: true });
  log('폴더 지움', !fs.existsSync(dir));
}
