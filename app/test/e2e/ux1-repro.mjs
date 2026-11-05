// ux1 재현 각본: 탐색(ux1-drive)에서 찾은 문제를 빈 판에서 처음부터 다시 재현하고 증거 스크린숏과 측정값을 남긴다.
// 판: herdr 세션 atrium-dev-ux1, 포트 47867, 이 워크트리의 backend/.dev(experiments/ux1/tools/env.cjs). 세션은 셸과 haiku만.
// 사용: node experiments/ux1/tools/e2e.cjs ux1-repro.mjs [--fresh] [--round 1|2] [--only 이름,...]
//   --fresh: 백엔드를 멈추고 판 데이터와 창 프로필을 지운 뒤 시작한다(시험 폴더 C:\Workspace\mtask-ux1-*의 세션만 있는 판이어야 한다)
// 결과: experiments/ux1/ux1-repro-r<round>.json, 스크린숏 ux1-repro-r<round>-<사례>-*.png
import fs from 'node:fs';
import path from 'node:path';
import * as L from './ux1-lib.mjs';

const argv = process.argv.slice(2);
const ROUND = argv.includes('--round') ? argv[argv.indexOf('--round') + 1] : '1';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const TAG = `ux1-repro-r${ROUND}`;
const log = L.logger(TAG);
const { step, save } = L.recorder(TAG, log);
const sleep = L.sleep;

if (argv.includes('--fresh')) {
  try { log('백엔드 멈춤', L.atrium('backend', 'stop').trim().split('\n').slice(-1)[0]); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(L.T.DEV, 'data'), path.join(L.T.DEV, 'app')]) fs.rmSync(d, { recursive: true, force: true });
}
L.prepare();

let ctx = null, page = null, app = null;
const shot = (n) => L.shot(page, `${TAG}-${n}`, log);
const call = (m, p) => L.call(page, m, p);
const blank = () => page.evaluate(() => { const c = document.querySelector('.mt-canvas').getBoundingClientRect(); for (let y = c.y + 120; y < c.bottom - 160; y += 30) for (let x = c.x + 110; x < c.right - 110; x += 40) { const e = document.elementFromPoint(x, y); if (e && e.classList.contains('react-flow__pane')) return { x, y }; } return null; });
const clickBlank = async () => { const p = await blank(); await page.mouse.click(p.x, p.y); await sleep(250); };
const head = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); const h = document.querySelector(`.react-flow__node[data-id="${s.sessionId}"] .mt-node-head`).getBoundingClientRect(); return { x: h.x + 60, y: h.y + h.height / 2 }; }, name);
const active = () => page.evaluate(() => { const a = document.activeElement; if (!a) return null; const t = a.closest && a.closest('.mt-term'); return t ? 'terminal' : `${a.tagName}${a.dataset.action ? '[' + a.dataset.action + ']' : ''}${a.dataset.role ? '{' + a.dataset.role + '}' : ''}`; });
const want = (n) => !ONLY || ONLY.includes(n);
let sp = null;

const cases = {
  // S6·U1: 노드 둘을 골라 "가로 2개" 배치 틀을 쓰면, 그룹이 옆의 세 번째 노드 자리로 커져 그 노드를 덮는다
  async presetOverlap() {
    for (const n of ['pa', 'pb', 'pc']) await sp.spawn(L.T.DIR, n, '--kind', 'shell');
    await sleep(1500);
    // 셋을 한 줄로: pa(왼쪽), pc(가운데), pb(오른쪽 위로)
    const ids = {}; for (const n of ['pa', 'pb', 'pc']) ids[n] = await L.sessionId(page, n);
    const r0 = await L.nodeRects(page);
    log('처음 자리', r0.map((r) => `${r.id.slice(0, 6)}:${r.x},${r.y},${r.w}x${r.h}`).join(' '));
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200);
    await clickBlank();
    let p = await head('pa'); await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y);
    // 새 노드 자리: pa(왼쪽), pb(pa 오른쪽), pc(pa 위). pa와 pc를 골라 가로로 묶으면 pc가 pa 오른쪽, 곧 pb 자리로 간다
    p = await head('pc'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control'); await sleep(500);
    const sel = (await page.evaluate(() => window.__mt.getState().selected)).length;
    await page.click('[data-action="layout-more"]'); await sleep(300);
    await shot('preset-1-before');
    const btn = (await page.$$('[data-role="presets"] button'))[0];
    const title = await btn.getAttribute('title');
    await btn.click(); await sleep(1500);
    await page.evaluate(() => window.__mt.getState().clearSelection());
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200);
    const overlaps = await L.domOverlaps(page);
    const hidden = await page.evaluate((i) => { const el = document.querySelector(`.react-flow__node[data-id="${i}"]`); const b = el.getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !(e && el.contains(e)); }, ids.pb);
    await shot('preset-2-after');
    const r1 = await L.nodeRects(page);
    step('presetOverlap: 배치 틀 뒤 다른 노드와 겹치지 않는다(U1)', overlaps.length === 0, { selected: sel, preset: title && title.split(':')[0], overlaps, pbHiddenAtCenter: hidden, after: r1.map((r) => `${r.id === ids.pa ? 'pa' : r.id === ids.pb ? 'pb' : r.id === ids.pc ? 'pc' : r.id.slice(0, 6)}:${r.x},${r.y},${r.w}x${r.h}`) });
  },
  // S5·U8: 셸 노드에 여러 줄을 붙여넣으면 마지막 줄 말고는 Enter 없이 바로 실행된다
  async shellPaste() {
    await sp.spawn(L.T.DIR, 'sp1', '--kind', 'shell');
    const id = await L.sessionId(page, 'sp1');
    await page.evaluate((i) => window.__mt.getState().navigateTo(i), id); await sleep(2000);
    const el = await page.$(`.mt-term[data-session="${id}"] .xterm-screen`); const b = await el.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(500);
    await app.evaluate(({ clipboard }) => clipboard.writeText('echo ux1-line-1\r\necho ux1-line-2\r\necho ux1-line-3'));
    await page.keyboard.press('Control+v'); await sleep(2000);
    const scr = L.atrium('screen', 'sp1', '--text').split('\n').map((l) => l.trimEnd()).filter(Boolean);
    const ran = scr.filter((l) => /^ux1-line-\d$/.test(l));
    await shot('paste-1-after-ctrl-v');
    step('shellPaste: 여러 줄 붙여넣기는 Enter 전에는 실행되지 않는다(U8)', ran.length === 0, { ranWithoutEnter: ran, tail: scr.slice(-7) });
    await L.call(page, 'terminal.input', { session: id, data: '\x1b' }).catch(() => {});
  },
  // S2·S3: 사이드바 머리의 세는 값(작업 중·확인할 결과)이 세션 상태가 바뀌어도 갱신되지 않는다
  async sidebarCounts() {
    await sp.spawn(L.T.DIR2, 'sc1', '--model', 'haiku');
    await L.waitStateOf(page, 'sc1', ['ready'], 90000);
    L.atrium('send', '@sc1', 'Reply with exactly: ok');
    await L.waitStateOf(page, 'sc1', ['working'], 30000).catch(() => null);
    await sleep(800);
    const during = await page.evaluate(() => (window.__mt.getState().workspaces || []).map((w) => ({ name: w.name, c: w.counts })));
    await L.waitStateOf(page, 'sc1', ['ready'], 90000);
    await sleep(5000);
    const st = (await L.sessionOf(page, 'sc1')).state;
    const ws = L.atrium('ws').split('\n').filter((l) => /mtask-ux1-dir2/.test(l)).join(' ');
    await page.keyboard.press('Control+Shift+E'); await sleep(900);
    const headTxt = await page.evaluate(() => [...document.querySelectorAll('.mt-sb-ws-head')].map((e) => e.innerText.replace(/\n/g, ' ')));
    const storeCounts = await page.evaluate(() => (window.__mt.getState().workspaces || []).map((w) => ({ name: w.name, c: w.counts })));
    await shot('counts-1-sidebar');
    await page.keyboard.press('Control+Shift+E'); await sleep(300);
    const d2 = storeCounts.find((w) => w.name === 'mtask-ux1-dir2');
    const dt = during.find((w) => w.name === 'mtask-ux1-dir2');
    // 턴 중에는 작업 중 1, 끝난 뒤에는 작업 중 0·확인할 결과 1이어야 한다(CLI ws는 백엔드의 실제 값)
    step('sidebarCounts: 창의 워크스페이스 세는 값(사이드바 머리)이 세션 상태를 따라간다', dt && dt.c.working === 1 && d2 && d2.c.working === 0 && d2.c.review === 1, { sessionState: st, cliWs: ws, sidebarHeads: headTxt, windowCountsAfter: d2 && d2.c, windowCountsDuringTurn: dt && dt.c });
  },
  // S1·S6·H6: 대화상자와 떠 있는 창이 Esc로 닫히는지, 열 때 초점이 들어가는지
  async escDialogs() {
    const res = {};
    const tryEsc = async (name, open, sel) => {
      await open(); await sleep(600);
      const a = await active();
      await page.keyboard.press('Escape'); await sleep(400);
      const still = await page.evaluate((s) => !!document.querySelector(s), sel);
      res[name] = { focusOnOpen: a, closedByEsc: !still };
      if (still) await shot(`esc-${name.replace(/[^a-z]/gi, '')}-after-esc`);
      if (still) { await page.mouse.click(4, 600); await sleep(300); await page.click('[data-action="return-close"]', { timeout: 1500 }).catch(() => {}); await page.click('[data-action="import-close"]', { timeout: 1500 }).catch(() => {}); await sleep(300); }
    };
    await clickBlank();
    await tryEsc('newSession(rail Shift+click)', async () => { const b = (await page.$$('[data-role="rail-favorites"] [data-action="launch"]'))[0]; await page.keyboard.down('Shift'); await b.click(); await page.keyboard.up('Shift'); }, '.mt-modal');
    await shot('esc-1-new-session-after-esc');
    await tryEsc('openProject', () => page.click('[data-action="ws-open"]'), '.mt-modal');
    await tryEsc('changes', () => page.click('[data-action="changes"]'), '[data-role="return-summary"]');
    await tryEsc('settings', () => page.click('[data-action="settings-open"]'), '[data-role="settings"]');
    await tryEsc('loops', () => page.click('[data-action="loops-open"]'), '[data-role="loop-list"]');
    await tryEsc('desktopImport', async () => { await page.click('[data-action="ws-open"]'); await sleep(400); await page.click('[data-action="desktop-import-open"]'); }, '[data-role="desktop-import"]');
    // 고른 노드는 Esc로 풀리는가
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1000); await clickBlank();
    const any = await page.evaluate(() => [...window.__mt.getState().sessions.values()][0].name);
    const p = await head(any); await page.keyboard.down('Control'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Control'); await sleep(400);
    const s0 = (await page.evaluate(() => window.__mt.getState().selected)).length;
    await page.keyboard.press('Escape'); await sleep(300);
    const s1 = (await page.evaluate(() => window.__mt.getState().selected)).length;
    res.selection = { before: s0, afterEsc: s1 };
    await page.evaluate(() => window.__mt.getState().clearSelection());
    const bad = Object.entries(res).filter(([k, v]) => k !== 'selection' && !v.closedByEsc).map(([k]) => k);
    step('escDialogs: 대화상자·떠 있는 창은 Esc로 닫힌다(H6)', bad.length === 0, { notClosed: bad, detail: res });
  },
  // S6·H3: 레일의 메모 버튼을 누른 뒤 스페이스나 Enter를 치면 메모가 또 생긴다(새 메모는 편집 상태가 아니고 초점이 버튼에 남는다)
  async memoKeys() {
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(800);
    const n = () => page.evaluate(() => document.querySelectorAll('.react-flow__node-memo').length);
    const n0 = await n();
    await page.click('[data-action="memo-new"]'); await sleep(900);
    const a = await active(); const n1 = await n();
    await page.keyboard.press('Space'); await sleep(900);
    await page.keyboard.press('Enter'); await sleep(900);
    const n2 = await n();
    const editing = await page.evaluate(() => !!document.querySelector('.mt-memo-edit'));
    await shot('memo-1-after-space-enter');
    step('memoKeys: 새 메모를 만든 뒤 친 키가 메모를 더 만들지 않는다', n2 === n1, { before: n0, afterClick: n1, afterSpaceEnter: n2, focus: a, editing });
    const memos = L.atrium('memo').split('\n').map((l) => l.split(' ')[0]).filter((x) => /^m[0-9a-f]+$/.test(x));
    for (const m of memos) L.atrium('memo', 'rm', m, '--yes');
  },
  // S5·H7: 셸 노드의 휠 한 칸(deltaY 100)과 작은 휠(deltaY 10) 열 번이 몇 줄 가는가
  async shellWheel() {
    if (!await L.sessionId(page, 'sp1')) await sp.spawn(L.T.DIR, 'sp1', '--kind', 'shell');
    const id = await L.sessionId(page, 'sp1');
    await page.evaluate((i) => window.__mt.getState().navigateTo(i), id); await sleep(1800);
    const el = await page.$(`.mt-term[data-session="${id}"] .xterm-screen`); const b = await el.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(400);
    await page.keyboard.type('cls; 1..120 | % { "wheel row $_" }'); await page.keyboard.press('Enter');
    await L.until(() => page.evaluate((i) => { const t = window.__mt.terms.get(i); if (!t) return false; const bf = t.buffer.active; for (let k = 0; k < t.rows; k++) { const l = bf.getLine(bf.viewportY + k); if (l && /wheel row 120/.test(l.translateToString(true))) return true; } return false; }, id), 15000, 200);
    await sleep(800);
    const vy = () => page.evaluate((i) => window.__mt.terms.get(i).buffer.active.viewportY, id);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    const y0 = await vy();
    await page.mouse.wheel(0, -100); await sleep(500);
    const one = y0 - await vy();
    for (let k = 0; k < 5; k++) { await page.mouse.wheel(0, 100); await sleep(80); }
    await sleep(400);
    const y1 = await vy();
    for (let k = 0; k < 10; k++) { await page.mouse.wheel(0, -10); await sleep(30); }
    await sleep(500);
    const small = y1 - await vy();
    const rows = await page.evaluate((i) => window.__mt.terms.get(i).rows, id);
    step('shellWheel: 휠 한 칸에 셸 기록이 3줄 안팎 가고, 작은 휠 여럿은 합한 만큼 간다(H7)', one >= 3 && small <= one * 2, { linesPerNotch100: one, linesFor10x10: small, rows });
  },
  // S6·H5: 전체 보기 뒤 영역 이름표와 노드가 떠 있는 크롬(위 알약, 왼쪽 레일) 밑에 깔리는가
  async fitUnderChrome() {
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200);
    const r = await page.evaluate(() => {
      const rect = (e) => e.getBoundingClientRect();
      const chrome = ['[data-role="top-left"]', '[data-role="top-right"]', '[data-role="rail-left"]', '[data-role="rail-right"]'].map((s) => [s, document.querySelector(s)]).filter(([, e]) => e).map(([s, e]) => [s, rect(e)]);
      const items = [...document.querySelectorAll('.react-flow__node-region .mt-rdrag, .react-flow__node-session .mt-node-head, .react-flow__node-memo, .react-flow__node-kanban')];
      const hits = [];
      for (const it of items) { const b = rect(it); for (const [s, c] of chrome) { const ox = Math.min(b.right, c.right) - Math.max(b.left, c.left), oy = Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top); if (ox > 4 && oy > 4) hits.push({ item: (it.innerText || '').split('\n')[0].slice(0, 30) || it.className.slice(0, 30), under: s, ox: Math.round(ox), oy: Math.round(oy) }); } }
      return hits;
    });
    await shot('fit-1-under-chrome');
    step('fitUnderChrome: 전체 보기 뒤 이름표·머리줄·메모가 떠 있는 크롬 밑에 깔리지 않는다(H5)', r.length === 0, r);
  },
  // S7·H2: git이 아닌 폴더의 판 밖 대화 카드에 "⎇ HEAD"가 붙는다(Claude Code가 기록에 gitBranch "HEAD"를 쓴다)
  async convoHead() {
    await sleep(16000); // 판 밖 대화 목록이 한 번 돈다
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1000);
    const cards = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node-convo')].map((e) => ({ id: e.dataset.id, ws: (e.closest('.react-flow__node') || e).dataset.id, text: e.innerText.replace(/\n/g, ' | ').slice(0, 160) })));
    const git = (() => { try { L.git(L.T.DIR, 'rev-parse', '--git-dir'); return true; } catch { return false; } })();
    const c = cards[0];
    if (c) { await page.evaluate((i) => window.__mt.getState().navigateToItem && window.__mt.getState().navigateToItem(i), c.id); await sleep(1200); const el = await page.$(`.react-flow__node[data-id="${c.id}"]`); if (el) await el.screenshot({ path: path.join(L.OUT, `${TAG}-convo-1-card.png`) }); }
    step('convoHead: git이 아닌 폴더의 대화 카드에 브랜치 표시가 없다', !git && cards.length > 0 && !cards.some((x) => /⎇ HEAD/.test(x.text)), { folderIsGit: git, cards });
  },
  // S9·H4: 영어 화면에서 "Prompt"가 요청(마지막 지시)과 셸의 "명령 입력 대기"를 함께 뜻한다
  async enPrompt() {
    if (!await L.sessionId(page, 'sp1')) await sp.spawn(L.T.DIR, 'sp1', '--kind', 'shell');
    await call('settings.set', { key: 'language', value: 'en' }); await sleep(800);
    await page.evaluate(() => { const st = window.__mt.getState(); st.setViewport({ x: 200, y: 400, zoom: 0.22 }); }); await sleep(1500);
    const shellFar = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node-session')].map((e) => e.innerText.replace(/\n/g, ' | ').slice(0, 80)).filter((t) => /Shell/.test(t)));
    await shot('enprompt-1-far');
    await call('settings.set', { key: 'language', value: 'ko' }); await sleep(500);
    step('enPrompt: 영어 셸 먼 얼굴의 대기 표시가 요청 이름표(Prompt)와 다른 낱말이다', !shellFar.some((t) => /\| Prompt\b/.test(t)), { shellFar });
  },
  // S6·H5: 절전 노드의 먼 얼굴에서 긴 요청 줄이 아래 줄과 겹친다
  async sleepFace() {
    await sp.spawn(L.T.DIR2, 'sf1', '--model', 'haiku');
    await L.waitStateOf(page, 'sf1', ['ready'], 90000);
    L.atrium('send', '@sf1', 'This is a deliberately long instruction line for the ux1 sleep face check. Reply with exactly: ok', '--wait');
    await L.waitStateOf(page, 'sf1', ['working'], 30000).catch(() => null);
    await L.waitStateOf(page, 'sf1', ['ready'], 90000);
    await sleep(3000);
    L.atrium('sleep', 'mtask-ux1-dir2');
    await L.waitStateOf(page, 'sf1', ['sleeping'], 60000);
    const id = await L.sessionId(page, 'sf1');
    const r = await page.evaluate((i) => { const n = window.__mt.getState().nodes.get(i); const el = document.querySelector('.mt-canvas'); const z = 190 / n.w; window.__mt.getState().setViewport({ x: el.clientWidth / 2 - (n.x + n.w / 2) * z, y: el.clientHeight / 2 - (n.y + n.h / 2) * z, zoom: z }); return z; }, id);
    await sleep(1500);
    const el = await page.$(`.react-flow__node[data-id="${id}"]`);
    await el.screenshot({ path: path.join(L.OUT, `${TAG}-sleepface-1-crop.png`) });
    const ov = await page.evaluate((i) => { const n = document.querySelector(`.react-flow__node[data-id="${i}"]`); const lines = [...n.querySelectorAll('.mt-far-line, .mt-far-k, .mt-sleep-at, .mt-far-nm')]; const out = []; for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) { if (lines[a].contains(lines[b]) || lines[b].contains(lines[a])) continue; const A = lines[a], B = lines[b]; const ra = A.getBoundingClientRect(), rb = B.getBoundingClientRect(); // 보이는 글 높이(scrollHeight)로 잰다
        const ha = Math.max(ra.height, A.scrollHeight), hb = Math.max(rb.height, B.scrollHeight); const oy = Math.min(ra.top + ha, rb.top + hb) - Math.max(ra.top, rb.top); const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left); const cs = getComputedStyle(A); if (oy > 2 && ox > 2 && cs.overflowY === 'visible') out.push([A.textContent.slice(0, 30), B.textContent.slice(0, 30), Math.round(oy)]); } return out; }, id);
    step('sleepFace: 절전 노드 먼 얼굴의 글줄이 겹치지 않는다', ov.length === 0, { zoom: r, overlaps: ov });
  },
  // S3: 처음 켠 판의 변경 내역이 백엔드 시작을 "다시 시작"으로 센다
  async firstStartAsRestart() {
    await page.click('[data-action="changes"]'); await sleep(900);
    const t = await page.evaluate(() => { const e = document.querySelector('[data-role="return-summary"]'); return e ? e.innerText : ''; });
    const line = t.split('\n').filter((l) => /다시 시작|restart/i.test(l));
    await shot('restart-1-changes');
    await page.click('[data-action="return-close"]').catch(() => {});
    const ev = L.atrium('events', '--limit', '500').split('\n').filter((l) => /backend_started/.test(l));
    step('firstStartAsRestart: 변경 내역의 다시 시작 횟수가 실제 재시작 횟수와 맞다', ev.length <= 1 ? line.length === 0 : true, { changesLine: line, backendStartedEvents: ev.length });
  },
};

try {
  ctx = await L.open({ log }); page = ctx.page; app = ctx.app;
  sp = L.spawner(page, log);
  await call('workspace.open', { path: L.T.DIR });
  await call('workspace.open', { path: L.T.DIR2 });
  await sleep(800);
  for (const [name, fn] of Object.entries(cases)) {
    if (!want(name)) continue;
    log('--- 사례', name);
    try { await fn(); } catch (e) { step(`${name}: 예외`, false, String(e && (e.stack || e.message)).slice(0, 600)); await shot(`${name}-error`).catch(() => {}); }
    await page.keyboard.press('Escape').catch(() => {});
  }
  step('창 콘솔 오류', ctx.errors.filter((e) => e.type !== 'warning').length === 0, ctx.errors.slice(0, 10));
} catch (e) {
  step('예외', false, String(e && (e.stack || e.message)).slice(0, 800));
} finally {
  if (sp) sp.killAll();
  if (app) await L.closeApp(app);
  save({ round: ROUND });
  process.exit(0);
}
