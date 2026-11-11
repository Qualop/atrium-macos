// P67 창 시험: 연결 선 이름표. 리드(claude haiku)가 atrium child로 워커 둘을 띄우고 같은 워커에 지시를 셋 보낸다.
// 확인: 판 세션끼리의 띄움은 선 하나(대화 띄움 선 없음), 한 쌍에 이름표 하나와 수(+2), 일이 도는 동안 다 보임,
// 끝나고 결과를 보면 칩으로 줄어듦, 마우스를 올리면 다시 다 보임, 이름표끼리 겹치지 않음.
// 판: herdr 세션 atrium-dev-p67, 포트 47894, 이 워크트리의 backend/.dev(experiments/p67/tools/env.cjs). 시험 폴더는 새로 만든 폴더만 쓴다.
// 사용: node experiments/p67/tools/e2e.cjs p67-labels.mjs <after|before>  (before는 P67_WT=<고치기 전 코드 사본>으로 돌린다. 판정은 기록만 한다)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, sleep, until, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p67') throw new Error('MT_E2E_OUT=p67을 명령줄에서 준다(experiments/p67/tools/e2e.cjs)');
const TAG = process.argv[2] || 'after';
const T = createRequire(import.meta.url)(path.join(process.env.P67_TOOLS || path.join(REPO, 'experiments', 'p67', 'tools'), 'env.cjs'));
const OUT = path.join(T.HERE, 'experiments', 'p67'); // 사본으로 돌려도 결과는 이 워크트리에
const ENV = Object.fromEntries(Object.entries(T.P67_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
fs.mkdirSync(OUT, { recursive: true });
for (const d of [...Object.values(T.WS), ENV.ATRIUM_CLAUDE_SESSIONS]) fs.mkdirSync(d, { recursive: true });

const logFile = path.join(OUT, `p67-${TAG}.txt`);
const log = (...a) => { const line = `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const mt = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', '--json', ...a], { encoding: 'utf8', env, timeout: 240000 });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name) => { const f = path.join(OUT, `p67-${TAG}-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.basename(f)); };
const sessions = (page) => page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => ({ id: s.sessionId, name: s.name, state: s.state, unseen: !!s.unseen, parent: s.parentSessionId || null })));
const byName = async (page, n) => (await sessions(page)).find((s) => s.name === n) || null;

const RUN = Date.now().toString(36).slice(-4);
const LEAD = `lead-${RUN}`, A = `alpha-${RUN}`, B = `beta-${RUN}`;

// 선 위 이름표(창 좌표)
const labels = (page) => page.evaluate(() => [...document.querySelectorAll('.mt-edge-label')].map((e) => {
  const r = e.getBoundingClientRect();
  return { link: e.dataset.link || null, spawn: e.dataset.spawnEdge || null, repo: e.dataset.repoEdge || null, level: e.dataset.level || null, awake: e.dataset.awake || null, more: e.dataset.more || null,
    text: e.textContent.replace(/\s+/g, ' ').trim(), box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
}));
const overlaps = (ls) => { const out = []; for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) { const a = ls[i].box, b = ls[j].box; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push([ls[i].text, ls[j].text]); } return out; };
const linkOf = async (page, from, to) => { const a = await byName(page, from), b = await byName(page, to); return (await call(page, 'link.list')).find((l) => a && b && l.from === a.id && l.to === b.id) || null; };
async function frame(page) {
  await page.evaluate(([names]) => {
    const s = window.__mt.getState();
    const rs = names.map((n) => s.nodes.get([...s.sessions.values()].find((x) => x.name === n).sessionId)).filter(Boolean);
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    const el = document.querySelector('.mt-canvas');
    const z = 0.82;
    s.setViewport({ x: el.clientWidth / 2 - ((x0 + x1) / 2) * z, y: el.clientHeight / 2 - ((y0 + y1) / 2) * z + 10, zoom: z });
  }, [[LEAD, A, B]]);
  await page.mouse.move(3, 300);
  await sleep(1000);
}
// 리드는 왼쪽, 워커 둘은 오른쪽 위아래(선 위 글이 들어갈 틈을 둔다)
async function place(page) {
  const at = { [LEAD]: [0, 0, 720, 460], [A]: [1180, -140, 640, 400], [B]: [1180, 380, 640, 400] };
  for (const [n, [x, y, w, h]] of Object.entries(at)) { const s = await byName(page, n); if (s) await call(page, 'board.setNode', { session: s.id, x, y, w, h, cause: 'p67 test' }); }
  await sleep(800);
  await frame(page);
}

async function run(page) {
  mt('spawn', T.WS.lead, '--name', LEAD, '--model', 'haiku');
  await until(async () => ((await byName(page, LEAD)) || {}).state === 'ready', 180000, 1500).catch(() => {});
  const lead = await byName(page, LEAD);
  step('리드가 준비됨', lead && lead.state === 'ready', lead && lead.state);
  if (!lead || lead.state !== 'ready') return;
  mt('send', `@${LEAD}`, [
    'Run these shell commands one at a time, exactly as written, each after the previous one has finished. Do not run anything else and do not explain.',
    `atrium child ${A} --model haiku --prompt "Reply with only the word ONE."`,
    `atrium child ${B} --model haiku --prompt "Reply with only the word BETA."`,
    `herdr agent prompt ${A} "Reply with only the word TWO." --wait`,
    `herdr agent prompt ${A} "Write a 250-word story about a lighthouse keeper, then end with the word THREE." --wait`,
    'When all four commands are done, reply DONE.',
  ].join('\n'));
  // 워커 둘이 뜨면 자리를 잡는다
  await until(async () => (await sessions(page)).filter((s) => s.parent === lead.id).length >= 2, 300000, 1500).catch(() => {});
  const kids = (await sessions(page)).filter((s) => s.parent === lead.id).map((s) => s.name);
  step('워커 둘을 띄움', kids.includes(A) && kids.includes(B), kids);
  await place(page);
  await shot(page, '1-spawned');
  // 세 번째 지시가 가고 alpha가 그 일을 하는 동안
  let seenWorking = null;
  await until(async () => { const l = await linkOf(page, LEAD, A); return l && l.lastText && /THREE/.test(l.lastText); }, 420000, 400).catch(() => {});
  await until(async () => { const a = await byName(page, A); if (a && a.state === 'working') { seenWorking = a; return true; } return false; }, 60000, 300).catch(() => {});
  await frame(page);
  const L1 = await labels(page);
  log('이름표(일하는 중)', L1);
  await shot(page, '2-working');
  const lab = (ls, n) => ls.find((x) => x.text.includes(n) || false);
  const linkA = await linkOf(page, LEAD, A);
  step('지시 셋이 알아챔(lead → alpha)', linkA && linkA.prompts >= 3, linkA && { prompts: linkA.prompts, last: linkA.lastText });
  const pairA = L1.filter((x) => x.link && linkA && x.link === linkA.linkId);
  step('한 쌍에 이름표 하나(lead–alpha)', L1.filter((x) => x.link).length === new Set(L1.filter((x) => x.link).map((x) => x.link)).size && pairA.length === 1, L1.map((x) => x.text));
  step('판 세션끼리 대화 띄움 선 없음', !L1.some((x) => x.spawn), L1.filter((x) => x.spawn).map((x) => x.text));
  step('이름표끼리 겹치지 않음(일하는 중)', !overlaps(L1).length, overlaps(L1));
  if (seenWorking) step('일하는 동안 다 보임과 +2', pairA[0] && pairA[0].level === 'full' && pairA[0].more === '2' && /\+2/.test(pairA[0].text), pairA[0]);
  else log('alpha가 일하는 순간을 잡지 못했다(이미 끝남)');
  // 끝나고 아직 안 봤다 → 그대로 다 보임
  await until(async () => { const a = await byName(page, A); return a && a.state === 'ready'; }, 240000, 1000).catch(() => {});
  await sleep(1500);
  const L2 = await labels(page);
  const a2 = await byName(page, A);
  const p2 = linkA && L2.find((x) => x.link === linkA.linkId);
  step('끝났고 결과를 안 봄: 다 보임', a2 && a2.unseen && p2 && p2.level === 'full', { unseen: a2 && a2.unseen, label: p2 });
  await shot(page, '3-done-unseen');
  // 결과를 본다(그 노드를 누른 것과 같다) → 칩
  for (const n of [A, B]) { const s = await byName(page, n); if (s) await call(page, 'session.markSeen', { session: s.id }); }
  await until(async () => { const x = linkA && (await labels(page)).find((y) => y.link === linkA.linkId); return x && x.level === 'chip'; }, 30000, 500).catch(() => {});
  await page.mouse.move(3, 300);
  await sleep(800);
  const L3 = await labels(page);
  const p3 = linkA && L3.find((x) => x.link === linkA.linkId);
  step('결과를 보면 칩으로 줄어듦', p3 && p3.level === 'chip' && p3.awake === 'rest', p3);
  step('이름표끼리 겹치지 않음(칩)', !overlaps(L3).length, overlaps(L3));
  await shot(page, '4-seen-chip');
  // 마우스를 올리면 다시 다 보인다
  if (p3) {
    await page.mouse.move(p3.box.x + p3.box.w / 2, p3.box.y + p3.box.h / 2);
    await sleep(700);
    const p4 = (await labels(page)).find((x) => x.link === linkA.linkId);
    step('마우스를 올리면 다시 다 보임', p4 && p4.level === 'full' && /THREE|lighthouse/i.test(p4.text), p4);
    await shot(page, '5-hover');
    await page.mouse.move(3, 300);
  }
  // 대화 띄움 선(J6)이 늦게 생기지 않는지: 대화 훑기를 한 번 더 기다린 뒤 백엔드의 선 목록도 본다
  await sleep(20000);
  const b = await call(page, 'board.get');
  const ids = new Set((await sessions(page)).filter((s) => [LEAD, A, B].includes(s.name)).map((s) => s.id));
  const dup = (b.convoEdges || []).filter((e) => ids.has(e.from) && ids.has(e.to));
  step('백엔드도 판 세션끼리 대화 띄움 선을 내지 않음', !dup.length, dup);
  const L5 = await labels(page);
  log('이름표(끝)', L5);
  step('이름표끼리 겹치지 않음(끝)', !overlaps(L5).length, overlaps(L5));
  await shot(page, '6-end');
}

const app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
const page = await app.firstWindow();
page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') log(`[console.error] ${m.text().slice(0, 300)}`); });
try {
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(800);
  if (await page.$('[data-role="sidebar"]')) await page.click('[data-action="sidebar"]').catch(() => {});
  log(`판 ${ENV.ATRIUM_HERDR_SESSION} ${ENV.ATRIUM_PORT}, 코드 ${TAG}, 이름 ${LEAD} ${A} ${B}`);
  await run(page);
} catch (e) {
  step('예외', false, e.stack);
} finally {
  fs.writeFileSync(path.join(OUT, `p67-${TAG}.json`), JSON.stringify(results, null, 2));
  // 이번 시험의 세션은 끈다(다음 시험이 새 이름으로 띄운다)
  for (const n of [A, B, LEAD]) { try { mt('kill', n, '--yes'); } catch (e) { log(`kill ${n}: ${String(e.message).slice(0, 120)}`); } }
  const fails = results.filter((r) => !r.ok);
  log(`결과 ${results.length - fails.length}/${results.length}`);
  await closeApp(app).catch(() => {});
  process.exit(fails.length ? 1 : 0);
}
