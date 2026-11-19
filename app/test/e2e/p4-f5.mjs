// P4 완료 기준 7(F5): 새 세션 대화상자에서 herdr가 아는 종류를 고른다. 이 PC에 깔린 codex로 시험한다(로그인되어 있을 때만, 턴은 한두 번).
// Claude Code가 아닌 종류는 herdr 상태와 화면으로 보여주고, 승인 카드는 "터미널에서 답하기"로 보낸다.
// 시작 대화상자(신뢰 확인 등)가 뜨면 판도 시험도 수락하지 않는다. MT_E2E_OUT=p4
import { launch, shot, logger, sleep, closeApp } from './harness.mjs';
import { frame, sendBar, until, sid, stateOf } from './p4-lib.mjs';

const N = 'cx';
const log = logger('p4-f5');
const { app, page } = await launch({ log });
const sum = () => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && { state: s.state, herdr: s.termStatus, kind: s.kind, hooked: s.hooked, ask: s.ask, lastAnswer: s.lastAnswer, answerSource: s.answerSource, estimate: s.estimate, exit: s.exit }; }, N);

if (!(await sid(page, N))) {
  await page.click('[data-action=spawn]');
  await page.fill('[data-field=name]', N);
  await page.selectOption('[data-field=kind]', 'codex');
  await page.fill('[data-field=args]', '-c model_reasoning_effort=low');
  log('대화상자', await page.evaluate(() => ({ kinds: [...document.querySelectorAll('[data-field=kind] option')].map((o) => `${o.value}${o.disabled ? '(없음)' : ''}`), fields: [...document.querySelectorAll('[data-role=spawn] [data-field]')].map((e) => e.dataset.field), note: document.querySelector('[data-role=spawn] .mt-card-sub') && document.querySelector('[data-role=spawn] .mt-card-sub').innerText })));
  await shot(page, 'f5-0-spawn-dialog-codex', log);
  await page.click('[data-action=spawn-submit]');
  await page.waitForSelector(`.mt-node[data-name="${N}"]`, { timeout: 60000 });
}
// 시작 뒤 상태(시작 중 → 준비 또는 막힘)
const seen = [];
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const v = await sum();
  const k = `${v.state}/${v.herdr}`;
  if (seen.at(-1) !== k) { seen.push(k); log('상태', k); }
  if (v.state === 'ready' || v.state === 'waiting') { await sleep(1500); break; }
  await sleep(300);
}
let v = await sum();
log('시작 뒤', v);
await frame(page, [N], { maxZoom: 0.9 });
await shot(page, 'f5-1-codex-node', log);

if (v.state === 'waiting') {
  // codex가 시작하면서 무언가를 묻는다(신뢰 확인 등). 판은 키 순서를 모르니 카드는 "터미널에서 답하기"만 준다. 수락하지 않는다
  log('카드', await page.evaluate((n) => { const c = document.querySelector(`.mt-node[data-name="${n}"] .mt-card`); return c && { kind: c.dataset.kind, text: c.innerText.slice(0, 600), buttons: [...c.querySelectorAll('button')].map((b) => b.textContent) }; }, N));
  await shot(page, 'f5-2-codex-card-terminal-only', log);
  log('판에서 답하기를 부르면', await page.evaluate((n) => window.__mt.api.call('session.answer', { session: n, choice: 1 }).then((r) => r, (e) => ({ error: e.code, message: e.message })), N));
} else if (v.state === 'ready') {
  await sendBar(page, `@${N} Reply with exactly: ok`);
  log('보냄: Reply with exactly: ok');
  const deliv = await until(() => page.evaluate(() => [...window.__mt.getState().deliveries.values()].find((d) => d.name === 'cx' && ['confirmed', 'unconfirmed', 'failed'].includes(d.status))), 60000);
  log('전달', { status: deliv.status, reason: deliv.reason });
  await until(async () => { const x = await sum(); return x.state === 'ready' && x.lastAnswer ? x : null; }, 120000);
  v = await sum();
  log('턴 뒤', v);
  await frame(page, [N], { maxZoom: 0.9 });
  await shot(page, 'f5-2-codex-after-turn', log);
}
await closeApp(app);
process.exit(0);
