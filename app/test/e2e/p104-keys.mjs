// P104 창 시험: 판이 터미널 질문에 답하는 UI(PC 승인 줄, 휴대폰 카드)를 뺐고, 휴대폰은 키 패드로 그 세션 패널에 키를 그대로 보낸다(session.keys).
// 따로 띄운 개발용 판(atrium-dev-p104, 47898, backend/.dev)만 쓴다. 휴대폰: Playwright 휴대폰 흉내(390×844, 터치) → ts-sim(47988) → 백엔드(47898).
// 단계마다 따로 돈다(창과 브라우저를 한 번에 하나만 띄운다):
//   setup        백엔드·herdr, 시험 세션(셸, Claude Code 권한 질문, AskUserQuestion, Codex 승인 질문)을 띄우고 응답 필요가 될 때까지 기다린다
//   pc <tag>     PC 창: 응답이 필요한 노드(가까이·멀리 얼굴)와 응답 필요 목록, N. tag before|after
//   phone <tag>  휴대폰: 세션 목록·새 세션 시트(계산된 모양 JSON), 응답이 필요한 세션 화면. tag before|after
//   answer       휴대폰 키 패드로 Claude Code 권한 질문·AskUserQuestion·Codex 승인 질문에 답하고, 셸에서 빠르게 누른 숫자와 방향키
//   shell        셸 부분만 다시
//   stop         시험 세션, 백엔드, herdr 서버와 세션을 끈다
// 결과는 experiments/p104/(git 밖). 실행: node backend/.dev/clean.mjs node app/test/e2e/p104-keys.mjs <단계> [tag]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p104');
const CONVOS = path.join(OUT, 'convos');
const PROJ = process.env.P104_PROJ || 'C:\\Workspace\\mtask-p104-proj';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A, baseOf } = L;
const B0 = L.board({ session: 'atrium-dev-p104', port: 47898, sim: 47988, sim2: 47987 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p104',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim}`,
  ATRIUM_REMOTE_QUIET_MS: '4000',
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(PROJ, { recursive: true });
const { logger, sleep, until, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const STAGE = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const log = logger(`p104-${STAGE}${STAGE === 'pc' || STAGE === 'phone' ? `-${TAG}` : ''}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const screenText = (n) => atrium('screen', n, '--text');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 900)}` : ''}`); };
const save = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
const N = { shell: 'p104-shell', perm: 'p104-perm', ask: 'p104-ask', codex: 'p104-codex' };

// 휴대폰 세션 목록·새 세션 시트의 계산된 모양(P101과 같은 값). 폭과 투명도는 내용·때에 따라 바뀌어 뺀다
const STYLE_PRINT = `((sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const keys = ['display', 'position', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'paddingTop', 'paddingLeft', 'height', 'boxShadow', 'animationName'];
  return [...root.querySelectorAll('*')].map((e) => { const s = getComputedStyle(e); return [e.tagName, String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className), ...keys.map((k) => s[k])].join('|'); });
})`;

async function setup() {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  for (const s of sessions()) if (/^p104-/.test(s.name)) atrium('kill', s.sessionId, '--yes', '--delete');
  for (const f of ['p104-perm-dir', 'p104-codex.txt']) fs.rmSync(path.join(PROJ, f), { recursive: true, force: true });
  const spawn = (...a) => JSON.parse(atrium('--json', 'spawn', PROJ, ...a));
  const sh = spawn('--kind', 'shell', '--name', N.shell);
  const perm = spawn('--model', 'haiku', '--name', N.perm, '--prompt', 'Use the Bash tool to run exactly this one command and nothing else: mkdir p104-perm-dir');
  const ask = spawn('--model', 'haiku', '--name', N.ask, '--prompt', 'Use the AskUserQuestion tool to ask me exactly one question, "Which color?", with exactly three options: Red, Green, Blue (single choice). After I answer, reply with only the color I picked.');
  const cx = spawn('--kind', 'codex', '--name', N.codex, '--args', '-s read-only -a on-request', '--prompt', 'Create a file named p104-codex.txt containing the word ok by running one shell command. Ask for approval if the sandbox blocks it.');
  check('시험 세션을 띄움(셸, Claude Code 둘, Codex), 신뢰 대화상자 예상 없음', sh.sessionId && perm.sessionId && ask.sessionId && cx.sessionId && !(perm.trust && perm.trust.needsTrust), { perm: perm.trust, codex: cx.argv });
  await until(() => { const s = byName(N.perm); return s && s.state === 'waiting' && s.ask && s.ask.kind === 'permission'; }, 180000, 1000).catch(() => null);
  await until(() => { const s = byName(N.ask); return s && s.state === 'waiting' && s.ask && s.ask.kind === 'question'; }, 180000, 1000).catch(() => null);
  await until(() => { const s = byName(N.codex); return s && s.state === 'waiting'; }, 180000, 1000).catch(() => null);
  const view = sessions().filter((s) => /^p104-/.test(s.name)).map((s) => ({ name: s.name, kind: s.kind, state: s.state, ask: s.ask && { kind: s.ask.kind, tool: s.ask.tool, summary: s.ask.summary } }));
  log(JSON.stringify(view));
  check('Claude Code 권한 질문(Bash mkdir)을 기다린다', byName(N.perm).state === 'waiting' && byName(N.perm).ask && byName(N.perm).ask.tool === 'Bash', byName(N.perm).ask);
  check('Claude Code AskUserQuestion을 기다린다', byName(N.ask).state === 'waiting' && byName(N.ask).ask && byName(N.ask).ask.kind === 'question', byName(N.ask).ask);
  check('Codex가 승인 질문을 기다린다(herdr blocked)', byName(N.codex).state === 'waiting', { state: byName(N.codex).state, herdr: byName(N.codex).herdrStatus });
  fs.writeFileSync(path.join(OUT, 'screen-codex-setup.txt'), screenText(N.codex));
  fs.writeFileSync(path.join(OUT, 'screen-ask-setup.txt'), screenText(N.ask));
  fs.writeFileSync(path.join(OUT, 'screen-perm-setup.txt'), screenText(N.perm));
}

async function pc() {
  const { app, page } = await launch({ log, env: ENV });
  try {
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await sleep(2500);
    const go = async (name) => {
      const id = byName(name).sessionId;
      // 터미널에 초점을 주지 않는다(시험이 누르는 키가 세션에 들어가지 않게. 고치기 전 시험의 Esc가 Codex 승인을 취소했다)
      await page.evaluate((i) => window.__mt.getState().navigateTo(i, { focusTerminal: false }), id);
      await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await sleep(2500);
      return id;
    };
    const nodeFacts = (id) => page.evaluate((i) => {
      const n = document.querySelector(`.mt-node[data-session="${i}"]`);
      if (!n) return null;
      const body = n.querySelector('.mt-node-body'); const term = n.querySelector('.mt-term');
      const rb = body && body.getBoundingClientRect(); const rt = term && term.getBoundingClientRect();
      return { face: n.dataset.face, cls: n.className, pill: (n.querySelector('.mt-pill') || {}).textContent || null, waited: (n.querySelector('.mt-waited') || {}).textContent || null,
        answer: n.querySelectorAll('.mt-answer, [data-role=approval]').length, asking: n.classList.contains('asking'),
        termStyleBottom: term ? term.style.bottom : null, bodyBottom: rb && Math.round(rb.bottom), termBottom: rt && Math.round(rt.bottom), callout: !!n.querySelector('[data-role=ask-callout]'),
        rows: window.__mt.terms && window.__mt.terms.get(i) ? window.__mt.terms.get(i).rows : null };
    }, id);
    const out = {};
    for (const k of ['perm', 'codex']) {
      const id = await go(N[k]);
      out[k] = await nodeFacts(id);
      log(`${k} ${JSON.stringify(out[k])}`);
      await page.screenshot({ path: path.join(OUT, `pc-${TAG}-${k}.png`) });
    }
    // 멀리 보기: 말풍선(묻는 글)은 남는다
    const z = await page.evaluate(() => { const vp = document.querySelector('.react-flow__viewport'); return vp ? vp.style.transform : null; });
    log(`viewport ${z}`);
    // 응답 필요 목록과 N
    await page.click('[data-role="inbox"]').catch((e) => log(`inbox ${e.message}`));
    await sleep(800);
    out.chips = await page.evaluate(() => [...document.querySelectorAll('.mt-chip.need')].map((c) => ({ text: c.textContent.slice(0, 120), answerButtons: c.querySelectorAll('button').length })));
    await page.screenshot({ path: path.join(OUT, `pc-${TAG}-inbox.png`) });
    await page.click('[data-role="inbox"]').catch(() => {});
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    const inTerm = await page.evaluate(() => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.xterm')));
    if (inTerm) throw new Error('N을 누르기 전에 터미널에 초점이 있다');
    await page.keyboard.press('n');
    await sleep(1500);
    out.afterN = await page.evaluate(() => { const st = window.__mt.getState(); const s = st.sessions.get(st.focusId); return s ? { name: s.name, state: s.state } : null; });
    save(`pc-${TAG}.json`, out);
    if (TAG === 'after') {
      check('PC 노드(권한 질문)에 답하기 UI가 없고 터미널이 노드 끝까지(줄이지 않음)', out.perm && out.perm.answer === 0 && !out.perm.asking && !out.perm.termStyleBottom, out.perm);
      check('PC 노드(Codex)에도 답하기 UI가 없다', out.codex && out.codex.answer === 0, out.codex);
      check('응답 필요는 상태 알약(노랑, 내 차례)과 기다린 시간으로 알린다', out.perm && /st-waiting/.test(out.perm.cls) && !!out.perm.pill, { pill: out.perm && out.perm.pill, waited: out.perm && out.perm.waited });
      check('응답 필요 목록에 세 세션이 있다(목록 안 답 단추 없음)', out.chips && out.chips.length >= 3, out.chips);
      check('N으로 응답이 필요한 세션에 간다', out.afterN && out.afterN.state === 'waiting', out.afterN);
    } else {
      check('고치기 전: PC 노드에 승인 줄이 있었다(비교용)', out.perm && out.perm.answer > 0, out.perm);
    }
  } finally { await closeApp(app); }
}

async function phoneCtx(browser, label) {
  const PHONE = { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`[${label} pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`[${label} console.error] ${m.text().slice(0, 200)}`); });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
async function withPhone(fn) {
  const { startTsSim } = await import('file:///' + path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs').replace(/\\/g, '/'));
  const { chromium } = await import('playwright');
  const sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const found = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const BASE = baseOf(B0.sim);
  const browser = await chromium.launch({ headless: true, ...(found ? { executablePath: found } : { channel: 'chromium' }), args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${BASE}`] });
  try {
    for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
    const P = await phoneCtx(browser, 'phone');
    const pg = P.page;
    await pg.goto(`${BASE}/`);
    await pg.waitForSelector('[data-role=pair]', { timeout: 20000 });
    await pg.fill('[data-field=pair-code]', call('device.code').code);
    await pg.tap('[data-action=pair-submit]');
    await pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open' && !!document.querySelector('[data-role=phone-list]'), null, { timeout: 60000 });
    await pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    await fn(pg, P);
  } finally { await browser.close().catch(() => {}); sim.close && sim.close(); }
}
const openSession = async (pg, name) => {
  const id = byName(name).sessionId;
  await pg.evaluate((i) => window.__mtPhone.open(i), id);
  await pg.waitForSelector(`[data-role=phone-session][data-session="${id}"] .xterm-screen`, { timeout: 20000 });
  await sleep(1800);
  return id;
};
const sessionFacts = (pg) => pg.evaluate(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), bottom: Math.round(r.bottom) }; };
  const pad = document.querySelector('[data-role=phone-pad]');
  const keys = pad ? [...pad.querySelectorAll('button')].map((b) => ({ k: b.dataset.padKey || b.dataset.action, ...R(b), label: b.getAttribute('aria-label') })) : [];
  return { term: R(document.querySelector('[data-role=phone-term]')), card: R(document.querySelector('[data-role=phone-answer]')), cardback: !!document.querySelector('[data-action=phone-card]'),
    pad: R(pad), padKeys: keys, keyRow: R(document.querySelector('[data-role=phone-keys]')), input: R(document.querySelector('[data-role=phone-input]')), vh: innerHeight, docW: document.documentElement.scrollWidth };
});

async function phone() {
  await withPhone(async (pg) => {
    await pg.screenshot({ path: path.join(OUT, `phone-${TAG}-list.png`) });
    const listPrint = await pg.evaluate(`${STYLE_PRINT}('[data-role=phone-list]')`);
    await pg.tap('[data-action=phone-new]'); await sleep(800);
    await pg.screenshot({ path: path.join(OUT, `phone-${TAG}-sheet.png`) });
    const sheetPrint = await pg.evaluate(`${STYLE_PRINT}('[data-role=phone-spawn]')`);
    await pg.tap('[data-action=phone-spawn-close]'); await sleep(500);
    save(`phone-${TAG}-styles.json`, { list: listPrint, sheet: sheetPrint });
    const facts = {};
    for (const k of ['perm', 'ask', 'codex', 'shell']) {
      await openSession(pg, N[k]);
      facts[k] = await sessionFacts(pg);
      log(`${k} ${JSON.stringify(facts[k]).slice(0, 600)}`);
      await pg.screenshot({ path: path.join(OUT, `phone-${TAG}-${k}.png`) });
      await pg.evaluate(() => window.__mtPhone.list()); await sleep(600);
    }
    save(`phone-${TAG}.json`, facts);
    if (TAG === 'after') {
      const before = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'phone-before-styles.json'), 'utf8')); } catch { return null; } })();
      if (before) {
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const diff = (a, b) => { const A = new Set(a || []), B = new Set(b || []); return { onlyBefore: [...A].filter((x) => !B.has(x)).slice(0, 8), onlyAfter: [...B].filter((x) => !A.has(x)).slice(0, 8) }; };
        check('휴대폰 세션 목록의 계산된 모양이 고치기 전과 같다', same(before.list, listPrint), same(before.list, listPrint) ? `${listPrint.length}개 요소` : diff(before.list, listPrint));
        check('새 세션 시트의 계산된 모양이 고치기 전과 같다', same(before.sheet, sheetPrint), same(before.sheet, sheetPrint) ? `${sheetPrint.length}개 요소` : diff(before.sheet, sheetPrint));
      }
      const p = facts.perm;
      check('휴대폰(권한 질문): 카드와 "카드 보기"가 없고 키 패드가 펼쳐 있다(키 줄 대신)', !p.card && !p.cardback && p.pad && !p.keyRow, p);
      const small = p.padKeys.filter((k) => k.h < 44 || k.w < 44);
      check('키 패드의 모든 칸이 44px 넘는다(390px 폭)', p.padKeys.length === 13 && !small.length, { n: p.padKeys.length, small });
      check('키 패드가 있어도 터미널이 화면 절반 넘게 보인다, 가로 넘침 없음', p.term.h > p.vh * 0.5 && p.docW <= 390, { term: p.term, vh: p.vh, docW: p.docW });
      check('응답이 필요 없는 셸은 키 패드를 접고 키 줄(+ 키 패드 열기 단추)', !facts.shell.pad && facts.shell.keyRow, facts.shell);
      check('Codex 세션도 응답이 필요하면 키 패드가 펼쳐진다', !!facts.codex.pad, facts.codex.pad);
    } else {
      check('고치기 전: 휴대폰 세션 화면에 승인 카드가 있었다(비교용)', !!facts.perm.card, facts.perm.card);
    }
  });
}

// 키 패드 누르기: 진짜 터치(CDP), 앞 키가 끝나기를 기다리지 않는다
async function tapKeys(pg, cdp, keys, gap = 0) {
  const pts = await pg.evaluate((ks) => ks.map((k) => { const b = document.querySelector(`[data-role=phone-pad] [data-pad-key="${k}"]`); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }), keys);
  if (pts.some((p) => !p)) throw new Error(`키 패드에 없는 키: ${keys.join(',')}`);
  for (const p of pts) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (gap) await sleep(gap);
  }
}
// 셸: 키 패드를 열고 숫자를 빠르게(앞 요청을 기다리지 않고) → 차례와 빠짐 확인. ↑ ←×4 4 로 지난 줄을 고쳐 다시 실행.
// ↑는 PowerShell 기록(PSReadLine, 이 PC의 모든 셸이 나눈다)을 부른다. 앞 명령이 이 셸에서 돌지 않았으면 다른 셸의 명령이 올라오므로,
// Enter 전에 프롬프트 줄이 기대한 글인지 보고 아니면 Esc로 지운다(남의 명령을 실행하지 않는다)
const promptLine = (n) => { const ls = screenText(n).split(/\r?\n/).filter((l) => l.trim()); return ls.length ? ls[ls.length - 1] : ''; };
async function safeEnter(pg, P, want) {
  const line = promptLine(N.shell);
  if (!line.endsWith(`> ${want}`)) { await tapKeys(pg, P.cdp, ['esc']); throw new Error(`프롬프트 줄이 기대와 다르다(Esc로 지움): ${line.slice(-60)}`); }
  await tapKeys(pg, P.cdp, ['enter']);
}
async function shellKeys(pg, P) {
  await openSession(pg, N.shell);
  if (!(await pg.$('[data-role=phone-pad]'))) await pg.tap('[data-action=phone-pad-open]');
  await pg.waitForSelector('[data-role=phone-pad]');
  await sleep(1200); // 패드가 열리면 터미널이 줄어든다. 자리가 잡힌 뒤 누를 곳을 잰다
  const seq = ['1', '2', '3', '4', '4', '3', '2', '1', '1', '2', '3', '4'];
  await tapKeys(pg, P.cdp, seq, 0);
  await sleep(800);
  await safeEnter(pg, P, seq.join(''));
  await until(() => /^123443211234\s*$/m.test(screenText(N.shell)), 15000, 500).catch(() => null);
  const sc1 = screenText(N.shell);
  check('셸: 빠르게 누른 숫자 12개가 빠지지 않고 차례대로 들어갔다(123443211234)', /^123443211234\s*$/m.test(sc1), sc1.split('\n').filter((l) => /1234/.test(l)).slice(-3));
  await tapKeys(pg, P.cdp, ['up'], 300);
  await tapKeys(pg, P.cdp, ['left', 'left', 'left', 'left'], 0);
  await tapKeys(pg, P.cdp, ['4'], 0);
  await sleep(800);
  await safeEnter(pg, P, '1234432141234');
  await until(() => /^1234432141234\s*$/m.test(screenText(N.shell)), 15000, 500).catch(() => null);
  const sc2 = screenText(N.shell);
  check('셸: ↑로 지난 명령, ←×4 뒤 4를 넣고 Enter(1234432141234)', /^1234432141234\s*$/m.test(sc2), sc2.split('\n').filter((l) => /1234/.test(l)).slice(-3));
  await pg.screenshot({ path: path.join(OUT, 'answer-7-shell.png') });
}

async function answer() {
  await withPhone(async (pg, P) => {
    await pg.evaluate(() => { window.__p104 = []; const c = window.__mt.api.call.bind(window.__mt.api); window.__mt.api.call = (m, p) => { if (m === 'session.keys' || m === 'session.answer' || m === 'terminal.input') window.__p104.push({ m, keys: p.keys, data: p.data, t: Math.round(performance.now()) }); return c(m, p); }; });
    // 1) Claude Code 권한 질문: ↓ ↑ 로 오간 뒤 Enter(1. Yes)
    await openSession(pg, N.perm);
    await tapKeys(pg, P.cdp, ['down', 'up'], 250);
    await sleep(500);
    await pg.screenshot({ path: path.join(OUT, 'answer-1-perm-moved.png') });
    await tapKeys(pg, P.cdp, ['enter']);
    await until(() => fs.existsSync(path.join(PROJ, 'p104-perm-dir')), 60000, 500).catch(() => null);
    check('Claude Code 권한 질문: 키 패드 ↓ ↑ Enter로 허용 → 폴더가 생겼다', fs.existsSync(path.join(PROJ, 'p104-perm-dir')), { state: byName(N.perm).state });
    await sleep(1500);
    await pg.screenshot({ path: path.join(OUT, 'answer-2-perm-done.png') });
    // 2) AskUserQuestion: ↓ Enter → 2. Green
    await pg.evaluate(() => window.__mtPhone.list()); await sleep(500);
    await openSession(pg, N.ask);
    await pg.screenshot({ path: path.join(OUT, 'answer-3-ask.png') });
    await tapKeys(pg, P.cdp, ['down'], 300);
    await sleep(400);
    await tapKeys(pg, P.cdp, ['enter']);
    await until(() => { const s = byName(N.ask); return s && s.state !== 'waiting' && /green/i.test(s.lastAnswer || ''); }, 90000, 1000).catch(() => null);
    const askS = byName(N.ask);
    check('AskUserQuestion: 키 패드 ↓ Enter로 두 번째 선택지(Green)를 골랐다', /green/i.test(askS.lastAnswer || ''), { state: askS.state, answer: (askS.lastAnswer || '').slice(0, 80) });
    await pg.screenshot({ path: path.join(OUT, 'answer-4-ask-done.png') });
    // 3) Codex 승인 질문: Enter(1. Yes, proceed)
    await pg.evaluate(() => window.__mtPhone.list()); await sleep(500);
    await openSession(pg, N.codex);
    await pg.screenshot({ path: path.join(OUT, 'answer-5-codex.png') });
    fs.writeFileSync(path.join(OUT, 'screen-codex-before-answer.txt'), screenText(N.codex));
    await tapKeys(pg, P.cdp, ['enter']);
    await until(() => fs.existsSync(path.join(PROJ, 'p104-codex.txt')), 90000, 1000).catch(() => null);
    check('Codex 승인 질문: 키 패드 Enter로 허용 → 파일이 생겼다', fs.existsSync(path.join(PROJ, 'p104-codex.txt')), { state: byName(N.codex).state });
    await sleep(2000);
    fs.writeFileSync(path.join(OUT, 'screen-codex-after-answer.txt'), screenText(N.codex));
    await pg.screenshot({ path: path.join(OUT, 'answer-6-codex-done.png') });
    // 4) 셸
    await pg.evaluate(() => window.__mtPhone.list()); await sleep(500);
    await shellKeys(pg, P);
    const calls = await pg.evaluate(() => window.__p104);
    save('answer-calls.json', calls);
    check('휴대폰은 session.keys만 불렀다(session.answer 없음), 빠르게 누른 키는 요청 몇 개로 모였다', calls.every((c) => c.m !== 'session.answer') && calls.filter((c) => c.m === 'session.keys').length < calls.reduce((a, c) => a + (c.keys ? c.keys.length : 0), 0), { calls: calls.filter((c) => c.m === 'session.keys').map((c) => c.keys.join('+')) });
    // 기록: 세션 이벤트 keys(키 이름과 보낸 기기)
    const ev = call('session.events', { session: N.shell, limit: 200 }).filter((e) => e.kind === 'keys');
    save('answer-events-shell.json', ev);
    const sent = ev.flatMap((e) => e.data.keys);
    check('세션 이벤트 keys에 보낸 키와 기기가 남았다', sent.join('').includes('123443211234') && ev.every((e) => e.data.via === 'device' && e.data.deviceId), { n: ev.length, first: ev[0] && ev[0].data });
    for (const n of [N.perm, N.ask, N.codex]) save(`answer-events-${n}.json`, call('session.events', { session: n, limit: 200 }).filter((e) => e.kind === 'keys' || e.kind === 'answer'));
  });
}

async function stop() {
  for (const s of sessions()) if (/^p104-/.test(s.name)) { try { atrium('kill', s.sessionId, '--yes', '--delete'); log(`kill ${s.name}`); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 200)}`); } }
  try { log(atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log(`herdr stop ${e.message.slice(0, 200)}`); }
  try { log(atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 200)}`); }
}

try {
  if (STAGE === 'setup') await setup();
  else if (STAGE === 'pc') await pc();
  else if (STAGE === 'phone') await phone();
  else if (STAGE === 'answer') await answer();
  else if (STAGE === 'quick') await withPhone(async (pg, P) => {
    // 키 패드 열기 단추를 누르자마자(기다리지 않고) 숫자를 누른다
    await openSession(pg, N.shell);
    if (await pg.$('[data-role=phone-pad]')) { await pg.tap('[data-action=phone-pad-close]'); await sleep(800); }
    await pg.evaluate(() => {
      window.__q = [];
      const t0 = performance.now();
      const tag = (e) => { const el = e.target && e.target.closest ? e.target.closest('[data-pad-key],[data-action]') : null; return el ? (el.dataset.padKey || el.dataset.action) : (e.target && e.target.className && String(e.target.className).slice(0, 30)); };
      for (const ty of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click']) document.addEventListener(ty, (e) => window.__q.push(`${Math.round(performance.now() - t0)} ${ty} ${tag(e)}`), true);
      const c = window.__mt.api.call.bind(window.__mt.api);
      window.__mt.api.call = (m, p) => { const r = c(m, p); if (m === 'session.keys') { window.__q.push(`${Math.round(performance.now() - t0)} call ${p.keys.join('+')}`); r.then(() => window.__q.push(`ok ${p.keys.join('+')}`), (e) => window.__q.push(`err ${p.keys.join('+')} ${e.code}`)); } return r; };
    });
    const b = await pg.evaluate(() => { const r = document.querySelector('[data-action=phone-pad-open]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await P.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [b] });
    await P.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const t0 = Date.now();
    await pg.waitForSelector('[data-role=phone-pad]');
    await tapKeys(pg, P.cdp, ['1', '2', '3', '4'], 0);
    log(`패드가 뜬 뒤 숫자까지 ${Date.now() - t0}ms`);
    await sleep(900);
    const line = promptLine(N.shell);
    log(`프롬프트 줄: ${line.slice(-40)}`);
    log(`이벤트 ${JSON.stringify(await pg.evaluate(() => window.__q))}`);
    check('키 패드를 열자마자 누른 숫자도 들어간다(1234)', line.endsWith('> 1234'), line.slice(-40));
    await tapKeys(pg, P.cdp, ['esc']);
  });
  else if (STAGE === 'shell') await withPhone(async (pg, P) => { const t0 = Date.now(); await shellKeys(pg, P); const ev = call('session.events', { session: N.shell, limit: 200 }).filter((e) => e.kind === 'keys' && e.t >= t0); save('shell-events.json', ev); check('세션 이벤트 keys에 보낸 키와 기기가 남았다', ev.some((e) => e.data.keys.includes('4')) && ev.every((e) => e.data.via === 'device' && e.data.deviceId), { n: ev.length, last: ev[ev.length - 1] && ev[ev.length - 1].data }); });
  else if (STAGE === 'stop') await stop();
  else throw new Error(`모르는 단계: ${STAGE}`);
} catch (e) { check(`단계 ${STAGE} 오류 없이 끝남`, false, e.stack || e.message); }
save(`result-${STAGE}${STAGE === 'pc' || STAGE === 'phone' ? `-${TAG}` : ''}.json`, results);
log(`결과 ${results.filter((r) => r.ok).length}/${results.length}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
