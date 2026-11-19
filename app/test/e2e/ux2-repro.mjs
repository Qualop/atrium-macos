// ux2 재현 각본: ux1 재현 사례(이슈 #2~#10 다시 보기)를 ux2 판에서 그대로 돌리고, ux2 탐색에서 찾은 문제를 빈 판에서 처음부터 다시 재현한다(ux1-repro.mjs를 옮김).
// 판: 터미널 세션 atrium-dev-ux2(hc), 포트 47908, 이 워크트리의 backend/.dev(experiments/ux2/tools/env.cjs). 세션은 셸, haiku, 가짜 연결 Codex만.
// 사용: node experiments/ux2/tools/e2e.cjs ux2-repro.mjs [--fresh] [--round 1|2] [--only 이름,...]
//   --fresh: 백엔드를 멈추고 판 데이터와 창 프로필을 지운 뒤 시작한다(시험 세션을 먼저 모두 끄고, 터미널 서버도 멈춘 뒤에 쓴다)
// 결과: experiments/ux2/ux2-repro-r<round>.json, 스크린숏 ux2-repro-r<round>-<사례>-*.png. farName은 가짜 Codex 서버(127.0.0.1:47994)가 떠 있어야 한다
import fs from 'node:fs';
import path from 'node:path';
import * as L from './ux2-lib.mjs';

const argv = process.argv.slice(2);
const ROUND = argv.includes('--round') ? argv[argv.indexOf('--round') + 1] : '1';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const TAG = `ux2-repro-r${ROUND}`;
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
const clickBlank = async () => { let p = await blank(); if (!p) { await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(900); p = await blank(); } if (p) await page.mouse.click(p.x, p.y); else await page.evaluate(() => window.__mt.getState().clearSelection()); await sleep(250); };
// 사이드바를 연다/닫는다(Ctrl+Shift+E는 여닫기를 바꾸므로 지금 상태를 보고 누른다)
const sidebar = async (open) => { const now = await page.evaluate(() => !!document.querySelector('.mt-sidebar')); if (now !== open) { await page.keyboard.press('Control+Shift+E'); await sleep(800); } };
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
    const ws = L.atrium('ws').split('\n').filter((l) => l.includes(L.WS_DIR2)).join(' ');
    await sidebar(true);
    const headTxt = await page.evaluate((w) => [...document.querySelectorAll('.mt-sidebar [draggable=true]')].map((e) => e.innerText.replace(/\n/g, ' ')).filter((t) => t.includes(w)), L.WS_DIR2);
    const storeCounts = await page.evaluate(() => (window.__mt.getState().workspaces || []).map((w) => ({ name: w.name, c: w.counts })));
    await shot('counts-1-sidebar');
    await page.keyboard.press('Control+Shift+E'); await sleep(300);
    const d2 = storeCounts.find((w) => w.name === L.WS_DIR2);
    const dt = during.find((w) => w.name === L.WS_DIR2);
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
      const items = [...document.querySelectorAll('.react-flow__node-region .mt-rdrag, .mt-wsgroup-head, .react-flow__node-session .mt-node-head, .react-flow__node-memo, .react-flow__node-kanban')];
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
    L.atrium('sleep', L.WS_DIR2);
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
  // ---------- ux2에서 새로 찾은 것 ----------
  // S4·B1: Claude Code가 턴 뒤 입력 칸에 보이는 흐린 추천 글(prompt suggestion)을 판이 쓰다 만 글로 보고 전달을 queued(draft)로 잡아 둔다
  async suggestDraft() {
    await sp.spawn(L.T.DIR2, 'sg1', '--model', 'haiku', '--mode', 'manual');
    await L.waitStateOf(page, 'sg1', ['ready'], 90000);
    const dimBox = () => { const raw = L.atrium('screen', 'sg1'); const m = raw.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => /❯/.test(l)).slice(-1)[0] || ''; return { dim: /❯[^\x1b]*(\x1b\[[0-9;]*m)*\x1b\[2m\s*\S/.test(m), line: m.replace(/\x1b\[[0-9;]*m/g, '').trim() }; };
    let box = null;
    for (const ask of ['We are planning a tiny todo CLI app in this folder. Propose a three-step plan in three short lines. Do not use tools.', 'Good. Now list the files we will need, one per line. Do not use tools.', 'Which step should we do first? One line. Do not use tools.']) {
      L.atrium('send', '@sg1', ask);
      await L.waitStateOf(page, 'sg1', ['working'], 30000).catch(() => null);
      await L.waitStateOf(page, 'sg1', ['ready'], 120000);
      for (let i = 0; i < 20 && !(box && box.dim); i++) { await sleep(1000); box = dimBox(); }
      if (box && box.dim) break;
    }
    if (!box || !box.dim) { step('suggestDraft: 흐린 추천 글이 나오지 않아 볼 수 없었다', null, box); return; }
    const id = await L.sessionId(page, 'sg1');
    await page.evaluate((i) => window.__mt.getState().navigateTo(i), id); await sleep(1500);
    const t0 = Date.now();
    L.atrium('send', '@sg1', 'Reply with only the word PING.');
    let d = null;
    for (let i = 0; i < 45; i++) { await sleep(1000); d = L.atrium('deliveries', 'sg1').split('\n')[0]; if (/confirmed/.test(d)) break; }
    const ms = Date.now() - t0;
    await shot('suggest-1-stuck');
    const ev = L.atrium('events', 'sg1', '--limit', '30').split('\n').filter((l) => /delivery_draft/.test(l)).slice(-2).map((l) => l.slice(0, 220));
    step('suggestDraft: 흐린 추천 글만 있는 입력 칸이면 판 전달이 45초 안에 제출된다(B1)', /confirmed/.test(d), { suggestion: box.line, waitedMs: ms, delivery: d, draftEvents: ev });
    const did = (/\b(d[0-9a-f]{10})\b/.exec(d) || [])[1];
    if (did && !/confirmed/.test(d)) { try { L.atrium('cancel', did); } catch {} }
  },
  // S4·H6: 터미널에 초점이 있을 때 Ctrl+K가 명령 바로 가지 않고 그 터미널로 들어간다
  // P140(#13): 셸과 Claude Code(haiku) 노드에 초점을 둔 채 Ctrl+K → 명령 바. 이어 친 `@ckt Reply with only OK` + Enter는 ckt에 전달되고
  // 초점 있던 터미널에는 ^K도 친 글도 들어가지 않는다
  async ctrlKTerminal() {
    if (!await L.sessionId(page, 'sp1')) await sp.spawn(L.T.DIR, 'sp1', '--kind', 'shell');
    for (const n of ['ckt', 'ckf']) if (!await L.sessionId(page, n)) await sp.spawn(L.T.DIR, n, '--model', 'haiku');
    for (const n of ['ckt', 'ckf']) await L.waitStateOf(page, n, ['ready'], 120000);
    for (const [from, i] of [['sp1', 1], ['ckf', 2]]) {
      const { id } = await L.focusTerm(page, from);
      const before = await active();
      const target = await L.sessionOf(page, 'ckt');
      const answered = target.lastAnswer || null;
      await page.keyboard.press('Control+k'); await sleep(500);
      const after = await active();
      const word = `ctrlk${i}x`;
      await page.keyboard.type(`@ckt Reply with only the word ${word.toUpperCase()}`); await sleep(300);
      const barText = await page.evaluate(() => { const e = document.querySelector('[data-role="command"]'); return e ? e.value : null; });
      await page.keyboard.press('Enter');
      let got = null;
      await L.until(async () => { const s = await L.sessionOf(page, 'ckt'); got = s && s.lastAnswer; return got && got !== answered && new RegExp(word, 'i').test(got); }, 90000).catch(() => {});
      const lines = (await L.termView(page, id)) || [];
      const leaked = lines.filter((l) => /\^K|ckt Reply with only|ctrlk\dx/i.test(l));
      await shot(`ctrlk-${i}-${from}`);
      step(`ctrlKTerminal(${from}): 터미널 안에서 Ctrl+K를 누르면 명령 바로 초점이 가고, 친 글은 그 터미널이 아니라 @ckt로 간다(H6, #13)`,
        !/terminal/.test(after) && /^TEXTAREA\{command\}$/.test(after) && !leaked.length && !!got && new RegExp(word, 'i').test(got),
        { focusBefore: before, focusAfterCtrlK: after, barText, leakedIntoFocusedTerminal: leaked, targetAnswer: got });
    }
  },
  // S1·H3: 사이드바 "새 그룹" 이름 칸의 기본 이름이 골라져 있지 않아 친 글이 뒤에 붙는다 + S1·H5: 전체 보기 뒤 그룹 띠 이름표가 위 알약 밑에 깔린다
  async groupName() {
    await sidebar(true);
    await page.click('[data-action=group-new]'); await sleep(500);
    const inp = await page.evaluate(() => { const a = document.activeElement; return a && a.tagName === 'INPUT' ? { value: a.value, selStart: a.selectionStart, selEnd: a.selectionEnd } : { tag: a && a.tagName }; });
    await page.keyboard.type('ux2grp'); await page.keyboard.press('Enter'); await sleep(600);
    const groups = await page.evaluate(() => (window.__mt.getState().groups || []).map((g) => g.name));
    await shot('group-1-name');
    step('groupName: 새 그룹 이름 칸은 기본 이름이 골라져 있어 친 글로 바뀐다(H3)', groups.includes('ux2grp'), { input: inp, groupsAfterTyping: groups });
    // 두 워크스페이스를 그 그룹으로(더 보기 메뉴)
    for (const ws of [path.basename(L.T.DIR2), path.basename(L.T.DIR)]) {
      const row = page.locator('.mt-sidebar [draggable=true]', { hasText: ws }).first();
      await row.hover(); await sleep(200);
      await row.locator('[data-action=ws-menu]').click(); await sleep(400);
      await page.evaluate(() => { const e = [...document.querySelectorAll('[data-action=menu-move-group]')].find((x) => x.offsetParent); if (e) e.click(); }); await sleep(600);
    }
    await sidebar(false);
    const hits = [];
    for (const [w, h] of [[1584, 921], [1366, 768]]) {
      await app.evaluate(({ BrowserWindow }, [ww, hh]) => BrowserWindow.getAllWindows()[0].setContentSize(ww, hh), [w, h]); await sleep(700);
      await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1300);
      const r = await page.evaluate(() => { const tl = document.querySelector('[data-role="top-left"]').getBoundingClientRect(); return [...document.querySelectorAll('.mt-wsgroup-head')].map((e) => { const b = e.getBoundingClientRect(); const ox = Math.min(b.right, tl.right) - Math.max(b.left, tl.left), oy = Math.min(b.bottom, tl.bottom) - Math.max(b.top, tl.top); return { label: e.innerText.replace(/\n/g, ' '), ox: Math.round(ox), oy: Math.round(oy), top: Math.round(b.top) }; }).filter((x) => x.ox > 4 && x.oy > 2); });
      await shot(`group-2-fit-${w}`);
      hits.push({ size: `${w}x${h}`, under: r });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921)); await sleep(500);
    step('groupFitLabel: 전체 보기 뒤 그룹 띠 이름표가 위 왼쪽 알약 밑에 깔리지 않는다(H5, ux1 #5)', hits.every((x) => x.under.length === 0), hits);
  },
  // S2·S9·H4: 영어 화면에서 하위 세션의 기본 역할이 한국어 "워커"로 보인다(atrium child 기본 역할)
  async enRole() {
    await sp.spawn(L.T.DIR, 'rl', '--model', 'haiku');
    await L.waitStateOf(page, 'rl', ['ready'], 90000);
    const id = await L.sessionId(page, 'rl');
    const sdir = path.join(L.T.DEV, 'data', 'sessions');
    const tok = fs.existsSync(path.join(sdir, `${id}.token`)) ? fs.readFileSync(path.join(sdir, `${id}.token`), 'utf8').trim() : JSON.parse(fs.readFileSync(path.join(sdir, `${id}.json`), 'utf8')).env.ATRIUM_SESSION_TOKEN;
    const { execFileSync } = await import('node:child_process');
    const o = execFileSync(process.execPath, [path.join(L.REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', 'rw1', '--model', 'haiku', '--no-wait'], { encoding: 'utf8', env: L.env({ ATRIUM_PORT: L.ENV.ATRIUM_PORT, ATRIUM_SESSION_ID: id, ATRIUM_SESSION_TOKEN: tok }), timeout: 60000 });
    sp.spawned.push('rw1');
    await L.waitNode(page, 'rw1');
    await call('settings.set', { key: 'language', value: 'en' }); await sleep(900);
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(1200);
    const ko = await page.evaluate(() => [...new Set([...document.querySelectorAll('.react-flow__node-session *')].map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim()).filter((t) => /[가-힣]/.test(t)))].slice(0, 6));
    await shot('enrole-1-board');
    await page.keyboard.press('m'); await sleep(1300);
    const mm = await page.evaluate(() => [...new Set([...document.querySelectorAll('body *')].map((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim()).filter((t) => /워커/.test(t)))].slice(0, 6));
    await shot('enrole-2-mission');
    await page.keyboard.press('Escape'); await sleep(400);
    await call('settings.set', { key: 'language', value: 'ko' }); await sleep(500);
    step('enRole: 영어 화면에 한국어 역할 이름(워커)이 보이지 않는다(H4)', ko.length === 0 && mm.length === 0, { childOut: o.trim().split('\n').slice(-1)[0].slice(0, 120), koreanOnNodes: ko, koreanInMission: mm });
  },
  // S3·S8: 응답 필요의 기다린 시간이 백엔드를 다시 켜면 0부터 다시 센다(오래 기다린 순서가 흐트러진다)
  async waitAgeRestart() {
    await sp.spawn(L.T.REPO, 'tw1', '--model', 'haiku');
    await L.waitStateOf(page, 'tw1', ['trust_wait', 'waiting'], 90000);
    await sleep(70000);
    const age = () => page.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'tw1'); return { since: s.waitingSince || s.stateSince || s.since || null, keys: Object.keys(s).filter((k) => /since|At$/i.test(k)) }; });
    await sidebar(true);
    const rowTime = () => page.evaluate(() => { const r = [...document.querySelectorAll('.mt-sidebar [title]')].find((e) => /@tw1/.test(e.title)); const t = r && r.querySelector('.mt-sb2-time'); return t ? t.innerText : null; });
    const a0 = await age(); const t0 = await rowTime();
    await shot('waitage-1-before');
    try { L.atrium('backend', 'stop'); } catch {}
    await sleep(1500);
    try { L.atrium('backend', 'start'); } catch {}
    await page.waitForFunction(() => window.__mt.api.conn && window.__mt.api.conn.phase === 'open', null, { timeout: 60000 }).catch(() => {});
    await sleep(6000);
    const a1 = await age(); const t1 = await rowTime();
    await shot('waitage-2-after');
    await sidebar(false);
    const inbox = L.atrium('inbox').split('\n').filter((l) => /tw1/.test(l)).slice(0, 2);
    step('waitAgeRestart: 백엔드를 다시 켜도 응답 필요의 기다린 시간이 이어진다(A1, C2)', t0 && t1 && !/^\d+(초|s)$/.test(t1), { sidebarBefore: t0, sidebarAfter: t1, stateBefore: a0, stateAfter: a1, inbox });
  },
  // P141(#16)·H5: 선택 막대가 고른 노드의 머리줄을 덮고, 미션 맵을 열어도 그 위에 남아 탭을 가린다
  async selBar() {
    await sp.spawn(L.T.DIR, 'sbx', '--kind', 'shell');
    await L.waitNode(page, 'sbx'); await sleep(1500);
    const id = await L.sessionId(page, 'sbx');
    await clickBlank();
    // 노드 머리줄이 선택 막대 자리(맨 위 줄이 좁으면 그 아래 줄, top 60px) 밑에 오게 판을 옮긴다(배율 0.8)
    await page.evaluate((i) => { const st = window.__mt.getState(); const n = st.nodes.get(i); const el = document.querySelector('.mt-canvas'); const z = 0.8; st.setViewport({ x: el.clientWidth / 2 - (n.x + n.w / 2) * z, y: 66 - n.y * z, zoom: z }); }, id);
    await sleep(900);
    const hb = await page.evaluate((i) => { const h = document.querySelector(`.react-flow__node[data-id="${i}"] .mt-node-head`).getBoundingClientRect(); return { x: Math.round(innerWidth / 2), y: h.y + h.height / 2, top: Math.round(h.top), hit: (document.elementFromPoint(innerWidth / 2, h.y + h.height / 2) || {}).className || null }; }, id); // 가운데(위 알약 사이, 막대가 뜰 자리)를 누른다
    await page.keyboard.down('Control'); await page.mouse.click(hb.x, hb.y); await page.keyboard.up('Control'); await sleep(1200); // 고르기(Ctrl+누르기. 그냥 누르면 그 노드로 화면을 옮긴다)
    const cover = () => page.evaluate((i) => { const b = document.querySelector('[data-role="selection"]'); const h = document.querySelector(`.react-flow__node[data-id="${i}"] .mt-node-head`); if (!b || !h) return { bar: !!b }; const r = b.getBoundingClientRect(), q = h.getBoundingClientRect(); const ox = Math.min(r.right, q.right) - Math.max(r.left, q.left), oy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top); return { bar: true, row: b.dataset.row, ox: Math.round(ox), oy: Math.round(oy), barBottom: Math.round(r.bottom), headTop: Math.round(q.top) }; }, id);
    const c1 = await cover();
    await shot('selbar-1-head');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 768)); await sleep(800);
    await page.keyboard.press('m'); await sleep(1300);
    const inMission = await page.evaluate(() => { const b = document.querySelector('[data-role="selection"]'); const sel = window.__mt.getState().selected.length; return { bar: !!(b && b.offsetParent), selected: sel }; });
    await shot('selbar-2-mission');
    await page.keyboard.press('Escape'); await sleep(500);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921)); await sleep(600);
    await page.evaluate(() => window.__mt.getState().clearSelection());
    step('selBar: 선택 막대가 고른 노드 머리줄을 덮지 않고, 미션 맵을 여는 동안 숨는다(H5)', c1.bar && !(c1.ox > 4 && c1.oy > 0) && !inMission.bar && inMission.selected > 0, { headTopBefore: hb.top, afterSelect: c1, mission: inMission });
  },
  // S5·H5·U4: 먼 얼굴에서 칩이 많으면 세션 이름이 "@"만 남는다(작업 완료가 상태 알약과 칩으로 두 번)
  async farName() {
    const c = await call('connection.create', { connection: { name: 'fake codex ux2r', protocol: 'openai-responses', baseUrl: `http://127.0.0.1:${L.T.FAKE_PORT || 47994}/v1`, auth: { env: 'P115_FAKE_KEY' } } });
    const l = await call('launcher.create', { launcher: { name: 'Codex fake r', harness: 'codex', connection: c.connection.id, model: 'ux2-fake-model', args: '--dangerously-bypass-approvals-and-sandbox' }, favorite: false });
    await sp.spawn(L.T.DIR, 'cq', '--launcher', l.launcher.id);
    await L.waitStateOf(page, 'cq', ['ready'], 90000);
    L.atrium('send', '@cq', 'Say hi.');
    await sleep(8000);
    await L.waitStateOf(page, 'cq', ['ready'], 60000);
    await page.evaluate(() => window.__mt.getState().fitAll(0)); await sleep(800);
    const id = await L.sessionId(page, 'cq');
    const r = (await L.nodeRects(page)).find((x) => x.id === id);
    const res = [];
    for (const z of [0.14, 0.12]) {
      await page.evaluate(([rr, zz]) => { const st = window.__mt.getState(); st.setViewport({ x: innerWidth / 2 - (rr.x + rr.w / 2) * zz, y: innerHeight / 2 - (rr.y + rr.h / 2) * zz, zoom: zz }); }, [r, z]); await sleep(1000);
      const m = await page.evaluate((i) => { const n = document.querySelector(`.react-flow__node[data-id="${i}"] .mt-far-nm`); if (!n) return null; const rg = document.createRange(); rg.selectNodeContents(n); return { name: n.innerText, textW: Math.round(rg.getBoundingClientRect().width), boxW: Math.round(n.getBoundingClientRect().width), row: n.parentElement.innerText.replace(/\n/g, ' | ') }; }, id);
      await page.locator(`.react-flow__node[data-id="${id}"]`).screenshot({ path: path.join(L.OUT, `${TAG}-farname-${z}.png`) });
      res.push({ z, ...m });
    }
    step('farName: 먼 얼굴의 세션 이름이 칩에 밀려 잘리지 않는다(U4, H5)', res.every((x) => x && x.boxW + 1 >= x.textW), res);
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
