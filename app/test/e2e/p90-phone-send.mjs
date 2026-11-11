// P90 창 시험: 휴대폰 입력 줄에서 일하는 중인 Claude Code에 보낸 글이 판 대기열에서 기다리지 않고 바로 Claude Code의 대기 메시지가 되고
//   턴 뒤에 처리되는지, 권한을 묻는 중에는 대기열에 남는지(선택지가 눌리지 않는지), 일하는 세션 셋의 활동이 바뀌어도 목록 순서가 그대로인지 본다.
// 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs): iPhone 흉내 Chromium(393×852, 손가락) → ts-sim(47895) → 백엔드(47898).
// 따로 띄운 개발용 판(atrium-dev-p90, 47898, backend/.dev)만 쓴다. PC 창은 띄우지 않는다.
// 판: 워크스페이스 mtask-p90-a 하나(.claude/settings.local.json으로 ping만 허용), p90-lead·p90-w2(haiku), p90-sh(셸). 결과는 experiments/p90/(git 밖).
// 실행: bash backend/.dev/clean-env.sh node app/test/e2e/p90-phone-send.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p90');
const CONVOS = path.join(OUT, 'convos');
const DIR = 'C:\\Workspace\\mtask-p90-a';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const B0 = L.board({ session: 'atrium-dev-p90', port: 47898, sim: 47895, sim2: 47896 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p90',
  ATRIUM_TEST_PREFIX: 'p90-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},localhost:${B0.sim}`,
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(path.join(DIR, '.claude'), { recursive: true });
fs.writeFileSync(path.join(DIR, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(ping:*)', 'Bash(ping *)'] } }, null, 1)); // ping만 묻지 않는다(P85)
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const { chromium } = await import('playwright');
const { parseChoices } = await import(toUrl(path.join(REPO, 'backend', 'src', 'screen.mjs')));

const log = logger('p90-phone-send');
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const screenOf = (n) => call('terminal.snapshot', { session: n, format: 'text' }).text || '';
const deliveriesOf = (n) => call('delivery.list', { session: n });
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const W = 393, H = 852;
const PHONE = { viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const tapSel = async (pg, sel) => { await pg.waitForSelector(sel, { timeout: 15000 }); await pg.tap(sel); };
async function pair(pg, base) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.click('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg);
}
const trustStop = () => {
  const tr = sessions().find((s) => /^p90-/.test(s.name) && s.state === 'trust_wait');
  if (tr) { fs.writeFileSync(path.join(DEV, 'p90-need-trust.txt'), `${tr.name} asks the folder trust question in a test folder\n`); throw new Error('trust question (backend/.dev/p90-need-trust.txt)'); }
};
const readyOf = (n, ms = 150000) => until(() => { const s = byName(n); return s && ['ready', 'working', 'waiting', 'trust_wait'].includes(s.state) ? s : null; }, ms, 1500).catch(() => null);
const LONG = (n) => `Use the Bash tool to run this command in the foreground, not in the background, with timeout 600000: ping -n ${n} 127.0.0.1 . Wait for it to finish. Then reply with the single word done.`;
const THEN_ASK = (n) => `First use the Bash tool to run this command in the foreground, not in the background, with timeout 600000: ping -n ${n} 127.0.0.1 . After it finishes, use the Bash tool to run exactly: mkdir p90-ask-dir . Then reply with the single word done.`;
// 목록의 칸별 순서(휴대폰 화면 그대로)
const PROBE_ORDER = `(() => { const sec = (k) => [...document.querySelectorAll('[data-section=' + k + '] [data-session]')].map((e) => e.querySelector('.mt-ph-name, b') ? (e.querySelector('.mt-ph-name, b').textContent || '').trim() : e.dataset.session);
  return { view: (document.querySelector('[data-role=phone]') || { dataset: {} }).dataset.view, needs: sec('needs'), working: sec('working'), repo: sec('repo') }; })()`;

async function setupBoard() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const s of sessions().filter((x) => /^p90-/.test(x.name) && !['p90-lead', 'p90-w2', 'p90-sh'].includes(x.name))) { try { atrium('kill', s.name, '--yes'); log(`끔 ${s.name}`); } catch (e) { log(`끄기 실패 ${s.name} ${e.message.slice(0, 100)}`); } }
  try { fs.rmSync(path.join(DIR, 'p90-ask-dir'), { recursive: true, force: true }); } catch {}
  const spawnIn = (...a) => JSON.parse(atrium('--json', 'spawn', DIR, ...a));
  // 시작 순서가 곧 목록 순서다(createdAt): lead → w2 → sh
  if (!byName('p90-lead')) { spawnIn('--model', 'haiku', '--name', 'p90-lead'); await sleep(1500); }
  if (!byName('p90-w2')) { spawnIn('--model', 'haiku', '--name', 'p90-w2'); await sleep(1500); }
  if (!byName('p90-sh')) spawnIn('--kind', 'shell', '--name', 'p90-sh');
  await readyOf('p90-lead'); await readyOf('p90-w2'); trustStop();
  await until(() => byName('p90-lead').state === 'ready' && byName('p90-w2').state === 'ready', 120000, 1500).catch(() => {});
  log(`세션 ${sessions().filter((s) => /^p90-/.test(s.name)).map((s) => `${s.name}:${s.state}@${s.createdAt}`).join(' ')}`);
}

let sim, browser;
const metrics = { order: [], activity: [] };
try {
  await setupBoard();
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  // 일을 시킨다: lead는 긴 ping, w2는 ping 뒤 mkdir 권한 질문, sh는 ping
  atrium('send', '@p90-lead', LONG(110));
  atrium('send', '@p90-w2', THEN_ASK(30));
  if (!((byName('p90-sh').shell || {}).atPrompt === false)) atrium('input', 'p90-sh', 'ping -n 400 127.0.0.1\\r');
  await until(() => byName('p90-lead').state === 'working' && byName('p90-w2').state === 'working' && (byName('p90-sh').shell || {}).atPrompt === false, 120000, 1500).catch(() => {});
  log(`일 ${sessions().filter((s) => /^p90-/.test(s.name)).map((s) => `${s.name}:${s.state}`).join(' ')}`);

  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  browser = await chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : { channel: 'chromium' }) });
  const BASE = `http://localhost:${B0.sim}`;
  const ctx = await browser.newContext(PHONE);
  const listPg = await ctx.newPage();
  listPg.on('pageerror', (e) => log(`[list pageerror] ${e.message}`));
  await pair(listPg, BASE);
  await sleep(2500);
  // 목록 순서를 2초마다 적는다(다른 페이지에서 보내는 동안에도)
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const o = await listPg.evaluate(PROBE_ORDER).catch(() => null);
      const act = sessions().filter((s) => /^p90-/.test(s.name)).map((s) => ({ n: s.name, st: s.state, a: s.lastActivityAt || 0 }));
      if (o) metrics.order.push({ t: Date.now(), ...o });
      metrics.activity.push({ t: Date.now(), act });
      await sleep(2000);
    }
  })();
  await shot(listPg, '01-list-working');

  // ---- A. 일하는 중에 휴대폰에서 보내기 ----
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => log(`[phone pageerror] ${e.message}`));
  await pg.goto(`${BASE}/`); await loadedOpen(pg); await splashGone(pg); await sleep(1500);
  const lead = byName('p90-lead');
  await tapSel(pg, `[data-section=working] [data-session="${lead.sessionId}"]`);
  await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'session', null, { timeout: 10000 });
  await sleep(2500);
  const sendFromPhone = async (text) => {
    await pg.fill('[data-field=phone-text]', text);
    await pg.tap('[data-action=phone-send]');
    const t = Date.now();
    await pg.waitForFunction(() => !document.querySelector('[data-field=phone-text]').value, null, { timeout: 10000 }).catch(() => {});
    return t;
  };
  const NOTE1 = 'P90 phone note: when the ping is done, also reply with the word mango.';
  const NOTE2 = 'P90 second line one\nline two: also say kiwi.';
  const tA = await sendFromPhone(NOTE1);
  const d1 = await until(() => deliveriesOf('p90-lead').find((d) => d.createdAt >= tA - 2000 && /mango/.test(d.text || '') && ['confirmed', 'unconfirmed', 'failed'].includes(d.status)), 20000, 500).catch(() => null);
  const leadNow = byName('p90-lead');
  check('A1 일하는 중에 보낸 글이 판 대기열에서 기다리지 않고 바로 들어가 제출 확인(이유 typed), 세션은 아직 일하는 중', d1 && d1.status === 'confirmed' && d1.reason === 'typed' && leadNow.state === 'working' && d1.confirmedAt - d1.createdAt < 10000, d1 && { status: d1.status, reason: d1.reason, ms: d1.confirmedAt - d1.createdAt, state: leadNow.state });
  await sleep(1200);
  const scrA = screenOf('p90-lead');
  fs.writeFileSync(path.join(OUT, 'A-screen-queued.txt'), scrA);
  check('A2 Claude Code 화면에 대기 메시지로 보인다(스피너 위 ❯ 글, 입력 칸은 대기 안내)', /❯\s*P90 phone note/.test(scrA) && /Press up to edit queued messages|ctrl\+enter to send now/.test(scrA), scrA.split('\n').filter((l) => l.trim()).slice(-10));
  const note = await pg.evaluate(() => (document.querySelector('[data-role=phone-note]') || {}).textContent || '');
  check('A3 휴대폰 알림 줄에 "Claude Code 대기열에 추가됨"(판 언어가 영어면 queued in Claude Code)', /Claude Code 대기열에 추가됨|queued in Claude Code/.test(note), note);
  await shot(pg, '02-phone-typed');
  const tA2 = await sendFromPhone(NOTE2);
  const d2 = await until(() => deliveriesOf('p90-lead').find((d) => d.createdAt >= tA2 - 2000 && /kiwi/.test(d.text || '') && ['confirmed', 'unconfirmed', 'failed'].includes(d.status)), 20000, 500).catch(() => null);
  await sleep(1200);
  const scrA2 = screenOf('p90-lead');
  fs.writeFileSync(path.join(OUT, 'A-screen-queued2.txt'), scrA2);
  check('A4 여러 줄도 한 번에 들어가 두 번째 대기 메시지가 된다(줄바꿈 그대로)', d2 && d2.status === 'confirmed' && d2.reason === 'typed' && d2.text === NOTE2 && /❯\s*P90 second line one/.test(scrA2) && /line two: also say kiwi/.test(scrA2), d2 && { status: d2.status, reason: d2.reason, text: d2.text });
  await shot(pg, '03-phone-typed2');
  const th = call('thread.list', { limit: 10 });
  const items = (th.items || th || []).filter((i) => i.t >= tA - 2000 && /P90 phone note|P90 second line/.test(i.text || ''));
  check('A5 Thread에 두 글이 남고 대상의 전달 상태가 confirmed, 이유 typed', items.length === 2 && items.every((i) => (i.results || []).length === 1 && i.results.every((r) => r.status === 'confirmed' && r.reason === 'typed')), items.map((i) => ({ text: (i.text || '').slice(0, 30), r: (i.results || []).map((r) => `${r.status}:${r.reason || ''}:${r.phase}`) })));

  // ---- B. 권한을 묻는 중에는 대기열에 ----
  await until(() => byName('p90-w2').state === 'waiting', 180000, 1500).catch(() => {});
  const w2 = byName('p90-w2');
  log(`w2 ${w2.state} ${JSON.stringify(w2.ask || {}).slice(0, 200)}`);
  await tapSel(pg, '[data-action=phone-back]');
  await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'list', null, { timeout: 10000 });
  await tapSel(pg, `[data-section=needs] [data-session="${w2.sessionId}"]`);
  await pg.waitForFunction(() => document.querySelector('[data-role=phone]').dataset.view === 'session', null, { timeout: 10000 });
  await sleep(2000);
  const scrB0 = screenOf('p90-w2');
  const tB = await sendFromPhone('P90 while asking: when you are done, also say grape.');
  await sleep(6000);
  const dB = deliveriesOf('p90-w2').find((d) => d.createdAt >= tB - 2000 && /grape/.test(d.text || ''));
  const scrB = screenOf('p90-w2');
  fs.writeFileSync(path.join(OUT, 'B-screen-asking.txt'), scrB);
  const w2b = byName('p90-w2');
  check('B1 권한 질문 중에는 바로 넣지 않고 대기열에 남는다(queued, 이유 waiting)', dB && dB.status === 'queued' && dB.reason === 'waiting' && w2b.state === 'waiting', dB && { status: dB.status, reason: dB.reason, state: w2b.state });
  check('B2 질문 화면이 그대로다(선택지가 눌리지 않았고 폴더도 생기지 않았다)', parseChoices(scrB).length >= 2 && JSON.stringify(parseChoices(scrB)) === JSON.stringify(parseChoices(scrB0)) && !fs.existsSync(path.join(DIR, 'p90-ask-dir')) && !/while asking/.test(scrB), { choices: parseChoices(scrB).map((c) => c.label.slice(0, 30)) });
  await shot(pg, '04-phone-asking-queued');
  // 거절로 풀면 턴이 끝나고(ready) B1로 보낸다
  log(atrium('answer', 'p90-w2', 'reject').trim().slice(0, 200));
  const dB2 = await until(() => { const d = deliveriesOf('p90-w2').find((x) => x.deliveryId === (dB && dB.deliveryId)); return d && ['confirmed', 'unconfirmed', 'failed'].includes(d.status) ? d : null; }, 120000, 1500).catch(() => null);
  check('B3 질문이 풀린 뒤에는 지금처럼 B1로 보내 제출 확인(typed 아님)', dB2 && dB2.status === 'confirmed' && !dB2.reason, dB2 && { status: dB2.status, reason: dB2.reason });

  // ---- A 끝: 턴 뒤에 대기 메시지가 처리된다 ----
  await until(() => byName('p90-lead').state === 'ready', 200000, 2000).catch(() => {});
  await sleep(3000);
  const leadEnd = byName('p90-lead');
  const msgs = call('session.messages', { session: 'p90-lead' });
  const all = (msgs.messages || []);
  fs.writeFileSync(path.join(OUT, 'A-messages.json'), JSON.stringify(all.map((m) => ({ role: m.role, seq: m.seq, text: String(m.text ?? JSON.stringify(m)).slice(0, 300) })), null, 1));
  const said = all.filter((m) => m.role === 'assistant').map((m) => JSON.stringify(m)).join('\n');
  check('A6 턴 뒤에 대기 메시지가 처리되었다(Claude의 답에 mango, kiwi)', /mango/i.test(said) && /kiwi/i.test(said), { lastAnswer: leadEnd.lastAnswer });
  fs.writeFileSync(path.join(OUT, 'A-screen-done.txt'), screenOf('p90-lead'));

  sampling = false; await sampler;
  // ---- C. 목록 순서 ----
  const createdOrder = sessions().filter((s) => /^p90-/.test(s.name)).sort((a, b) => a.createdAt - b.createdAt).map((s) => s.name);
  const listSamples = metrics.order.filter((o) => o.view === 'list');
  const workingSeqs = listSamples.map((o) => o.working.join(','));
  const consistent = listSamples.every((o) => { const idx = o.working.map((n) => createdOrder.indexOf(n)); return idx.every((v, i) => i === 0 || v > idx[i - 1]); });
  const threeAtOnce = listSamples.filter((o) => o.working.length === 3);
  // 같은 때 활동 시각의 최근 순(옛 정렬)이 몇 번 바뀌었나
  const recentOrders = metrics.activity.map((a) => a.act.filter((x) => ['working', 'starting'].includes(x.st) || x.n === 'p90-sh').sort((x, y) => y.a - x.a).map((x) => x.n).join(','));
  const recentChanges = recentOrders.filter((v, i) => i > 0 && v !== recentOrders[i - 1]).length;
  check('C1 일하는 세션 셋이 시작한 순(lead → w2 → sh)으로 보이고, 표본마다 순서가 같다(빠지는 것은 상태가 바뀐 때만)', threeAtOnce.length >= 3 && threeAtOnce.every((o) => o.working.join(',') === 'p90-lead,p90-w2,p90-sh') && consistent, { samples: listSamples.length, three: threeAtOnce.length, distinct: [...new Set(workingSeqs)] });
  check('C2 그동안 활동 시각의 최근 순은 바뀌었다(옛 정렬이었다면 줄이 움직였을 것)', recentChanges >= 1, { recentChanges, distinct: [...new Set(recentOrders)].slice(0, 6) });
  await shot(listPg, '05-list-end');
  await ctx.close();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'p90-phone-send.json'), JSON.stringify({ results, metrics }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
