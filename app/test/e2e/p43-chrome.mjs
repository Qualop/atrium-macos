// P43 창 시험: 아래 바 자동 숨김, 판의 방향키(아래 = 명령 바, 왼쪽 = 고르기·잇기, 위 = 찾기), 위로 옮긴 찾기 바와 바깥 누르기로 닫기,
// 터미널에 초점이 있을 때 방향키는 터미널로 간다.
// 판: herdr 세션 atrium-dev-p43, 포트 47861, 이 워크트리의 backend/.dev(experiments/p43/tools/env.cjs). 세션은 셸 노드 하나.
// 사용: node experiments/p43/tools/e2e.cjs p43-chrome.mjs [--fresh] [--tag 이름]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p43') throw new Error('MT_E2E_OUT=p43를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p43', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P43_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p43' || ENV.ATRIUM_PORT !== '47861') throw new Error('P43 판(atrium-dev-p43, 47861)만');
if (!/^C:\\Workspace\\mtask-p43-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p43-*만: ${T.DIR}`);
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const TAG = argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'p43-chrome';
const log = logger(TAG);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const lastLine = (s) => s.trim().split(/\r?\n/).slice(-1)[0];
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
let page = null;
const shot = async (name) => { const f = path.join(OUT, `${TAG}-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);

if (argv.includes('--fresh')) {
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim()); } catch (e) { log('백엔드 멈춤', e.message.slice(0, 120)); }
  await sleep(800);
  for (const d of [path.join(T.DEV, 'data'), path.join(T.DEV, 'app'), T.PROJECTS, T.SESSIONS, T.DIR]) fs.rmSync(d, { recursive: true, force: true });
}
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });

let app = null;
const ids = {};
const spawned = [];
async function spawn(name, ...extra) {
  log(lastLine(atrium('spawn', T.DIR, '--name', name, ...extra)));
  spawned.push(name);
  ids[name] = await until(() => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, name), 30000);
}
const nodeRect = (id) => page.evaluate((i) => { const r = window.__mt.getState().nodes.get(i); return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }, id);
const reload = async () => { await page.reload(); await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 }); };
async function setSize(id, w, h) {
  const r = await nodeRect(id);
  await call('board.setNode', { session: id, x: Math.round(r.x), y: Math.round(r.y), w, h, z: 0, cause: 'p43-test' });
  await reload();
  await until(async () => { const q = await nodeRect(id); return q && q.w === w && q.h === h; }, 10000);
}
const term = (id) => page.evaluate((i) => {
  const t = window.__mt.terms.get(i);
  const el = document.querySelector(`.mt-term[data-session="${i}"] .xterm-screen`);
  if (!t || !el) return null;
  const r = el.getBoundingClientRect();
  const b = t.buffer.active;
  const lines = [];
  for (let k = 0; k < t.rows; k++) { const l = b.getLine(b.viewportY + k); lines.push(l ? l.translateToString(true) : ''); }
  return { cols: t.cols, rows: t.rows, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, lines };
}, id);
const canvasBox = () => page.evaluate(() => { const r = document.querySelector('.mt-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom }; });
const barState = () => page.evaluate(() => {
  const b = document.querySelector('[data-role="bottom"]'), c = document.querySelector('[data-role="chips"]'), h = document.querySelector('[data-role="bottom-hint"]');
  const cmd = document.querySelector('.mt-cmd');
  return { hidden: b && b.dataset.hidden === '1', chipsHidden: c && c.dataset.hidden === '1', hint: h && h.dataset.on === '1', cmdOpacity: cmd && +getComputedStyle(cmd).opacity, shown: window.__mt.getState().bottomShown };
});
const active = () => page.evaluate(() => { const a = document.activeElement; return a ? { tag: a.tagName, role: a.dataset.role || null, field: a.dataset.field || null, xterm: !!(a.closest && a.closest('.xterm')), session: a.closest && a.closest('.mt-term') ? a.closest('.mt-term').dataset.session : null } : null; });
const hitAt = (x, y) => page.evaluate(([xx, yy]) => { const e = document.elementFromPoint(xx, yy); if (!e) return null; return { xterm: !!e.closest('.xterm'), cmd: !!e.closest('.mt-cmd'), chips: !!e.closest('.mt-chips'), pane: e.classList.contains('react-flow__pane'), cls: String(e.className).slice(0, 60) }; }, [x, y]);
// 빈 캔버스 점(아래 140px 띠와 노드·영역을 피한다)
async function blankPoint() {
  const c = await canvasBox();
  for (let y = c.y + 120; y < c.bottom - 160; y += 40) for (let x = c.x + 110; x < c.x + c.w - 110; x += 60) { const h = await hitAt(x, y); if (h && h.pane) return { x, y }; }
  throw new Error('빈 캔버스 점이 없다');
}
const clickBlank = async () => { const p = await blankPoint(); await page.mouse.click(p.x, p.y); await sleep(250); return p; };
const moveAway = async () => { const c = await canvasBox(); await page.mouse.move(c.x + c.w / 2, c.y + 200); };

try {
  app = await electron.launch({ args: ['.', '--dev'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(500);
  await call('settings.set', { language: 'ko' });
  await call('workspace.open', { path: T.DIR });
  await page.waitForSelector('.react-flow__node-region');
  await spawn('s1', '--kind', 'shell');
  const S = ids.s1;
  await setSize(S, 1000, 520);
  await until(async () => !!(await term(S)), 20000, 300);
  await until(() => page.evaluate((i) => !document.querySelector(`.react-flow__node[data-id="${i}"] .mt-term-note`), S), 20000, 300);
  await sleep(1200);
  // 화면을 채우고 마지막 줄에 프롬프트가 오게
  await call('terminal.input', { session: S, data: '1..80 | % { "p43 line $_" }\r' });
  await until(async () => { const ti = await term(S); return ti && ti.lines.some((l) => /p43 line 80/.test(l)); }, 15000, 300);
  await sleep(600);
  // 노드 터미널의 아래 끝이 판 아래 끝에서 50px 위에 오게(바가 보이면 가릴 자리, 띠보다는 위)
  const place = async (gap) => {
    await page.evaluate(([i]) => { const st = window.__mt.getState(); const r = st.nodes.get(i); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - (r.x + r.w / 2), y: el.clientHeight - 30 - (r.y + r.h), zoom: 1 }); }, [S]);
    await sleep(700);
    const c = await canvasBox(); const ti = await term(S);
    const dy = (c.bottom - gap) - (ti.rect.y + ti.rect.h);
    await page.evaluate(([d]) => { const st = window.__mt.getState(); const v = st.vpNow || { x: 0, y: 0, zoom: 1 }; const m = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform); st.setViewport({ x: m.e, y: m.f + d, zoom: m.a }); }, [dy]);
    await sleep(700);
  };
  await place(50);
  await moveAway();
  await sleep(1000);

  // ---------- 1. 처음에는 숨어 있고, 아래쪽 터미널 마지막 줄이 가려지지 않으며 눌린다 ----------
  const b0 = await barState();
  step('처음: 명령 바와 칩이 숨고 얇은 표시가 있다', b0.hidden && b0.chipsHidden && b0.hint && b0.cmdOpacity === 0, b0);
  const ti0 = await term(S);
  const rowH = ti0.rect.h / ti0.rows;
  const last = ti0.lines.map((l, k) => [l, k]).filter(([l]) => l.trim()).slice(-1)[0];
  const lastY = ti0.rect.y + (ti0.rows - 0.5) * rowH;
  const c0 = await canvasBox();
  const lx = c0.x + c0.w / 2;
  const hit0 = await hitAt(lx, lastY);
  step('처음: 터미널 마지막 줄 자리(바가 덮던 곳)를 누르면 터미널이 받는다', hit0 && hit0.xterm, { hit: hit0, fromBottom: Math.round(c0.bottom - lastY), lastText: last && last[0] });
  await shot('01-hidden');
  await page.mouse.click(lx, lastY);
  await sleep(500);
  const a0 = await active();
  step('처음: 그 자리를 누르면 터미널에 초점이 간다', a0 && a0.xterm && a0.session === S, a0);
  const b0b = await barState();
  step('처음: 터미널을 누른 뒤에도 바는 숨어 있다', b0b.hidden, b0b);

  // ---------- 2. 마우스를 아래 띠로 가져가면 나타나고, 벗어나면 숨는다 ----------
  await clickBlank();
  await page.mouse.move(lx, c0.bottom - 10);
  await sleep(450);
  const b1 = await barState();
  step('띠: 아래 띠로 가면 나타난다', !b1.hidden && !b1.chipsHidden && !b1.hint, b1);
  const hit1 = await hitAt(lx, c0.bottom - 56);
  step('띠: 보이는 동안 그 자리는 명령 바다', hit1 && hit1.cmd, hit1);
  await shot('02-band-shown');
  // 띠에서 칩 줄까지 올라가도(사이 빈틈 포함) 숨지 않는다
  const chipBox = await page.evaluate(() => { const r = document.querySelector('[data-action="chip-arrange"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(lx, c0.bottom - 50, { steps: 4 }); await page.mouse.move(chipBox.x, chipBox.y, { steps: 6 });
  await sleep(900);
  const b1b = await barState();
  step('띠: 칩 줄로 올라가도 보인다', !b1b.hidden && !b1b.chipsHidden, b1b);
  await moveAway();
  await sleep(250);
  const b2a = await barState();
  await sleep(900);
  const b2 = await barState();
  step('띠: 벗어나면 잠시 뒤 숨는다', !b2a.hidden && b2.hidden && b2.chipsHidden, { justAfter: b2a, later: b2 });

  // ---------- 3. 쓰다 만 글이 있으면 숨지 않는다 ----------
  await page.mouse.move(lx, c0.bottom - 10); await sleep(450);
  await page.click('[data-role="command"]');
  await page.keyboard.type('p43 draft');
  await clickBlank();
  await moveAway();
  await sleep(1500);
  const b3 = await barState();
  const a3 = await active();
  step('쓰다 만 글: 바깥을 누르고 마우스가 떠나도 숨지 않는다', !b3.hidden && a3 && a3.role !== 'command', { bar: b3, active: a3 });
  await shot('03-draft-kept');
  await page.fill('[data-role="command"]', '');
  await page.focus('[data-role="command"]');
  await page.keyboard.press('Escape');
  await sleep(1200);
  const b3b = await barState();
  step('쓰다 만 글: 지우고 Esc로 나가면 숨는다', b3b.hidden, b3b);

  // ---------- 4. 빈 캔버스를 누른 뒤 아래 키 → 명령 바가 나타나고 바로 칠 수 있다 ----------
  await clickBlank();
  await page.keyboard.press('ArrowDown');
  await sleep(350);
  const b4 = await barState();
  const a4 = await active();
  step('아래 키: 명령 바가 나타나고 입력칸에 초점이 있다', !b4.hidden && a4 && a4.role === 'command', { bar: b4, active: a4 });
  await page.keyboard.type('@s1 hi');
  const v4 = await page.inputValue('[data-role="command"]');
  step('아래 키: 바로 글을 칠 수 있다', v4 === '@s1 hi', { value: v4 });
  await shot('04-down-key');
  await page.fill('[data-role="command"]', '');
  await page.keyboard.press('Escape');
  await moveAway();
  await sleep(1200);

  // ---------- 5. 왼쪽 키로 고르기·잇기가 바뀐다 ----------
  await clickBlank();
  const tools = () => page.evaluate(() => ({ linking: document.querySelector('.mt-app').classList.contains('linking'), select: document.querySelector('[data-action="tool-select"]').classList.contains('on'), link: document.querySelector('[data-action="link-mode"]').classList.contains('on') }));
  const t0 = await tools();
  await page.keyboard.press('ArrowLeft'); await sleep(250);
  const t1 = await tools();
  await shot('05-left-link');
  await page.keyboard.press('ArrowLeft'); await sleep(250);
  const t2 = await tools();
  step('왼쪽 키: 고르기 → 잇기 → 고르기, 도구 단추 표시도 바뀐다', !t0.linking && t0.select && t1.linking && t1.link && !t1.select && !t2.linking && t2.select, { t0, t1, t2 });
  // 노드를 고른 뒤(Ctrl+누르기, 노드 테두리에 초점) 방향키는 노드를 옮기지 않는다
  const n0 = await nodeRect(S);
  const head = await page.$(`.react-flow__node[data-id="${S}"] .mt-node-head`);
  const hb = await head.boundingBox();
  await page.keyboard.down('Control'); await page.mouse.click(hb.x + hb.width / 2, hb.y + 8); await page.keyboard.up('Control'); await sleep(300);
  const a5 = await active();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft'); await sleep(400);
  const n1 = await nodeRect(S);
  const t3 = await tools();
  step('왼쪽·오른쪽 키: 고른 노드는 그대로이고 왼쪽 키는 도구를 바꾼다', JSON.stringify(n0) === JSON.stringify(n1) && t3.linking, { n0, n1, active: a5, t3 });
  await page.keyboard.press('ArrowLeft'); await sleep(200);
  await page.evaluate(() => window.__mt.getState().clearSelection());

  // ---------- 6. 위 키 → 위쪽 찾기 바가 열리고 바로 칠 수 있다. 바깥을 누르면 닫히고 그 누르기는 판에 간다 ----------
  await clickBlank();
  await page.keyboard.press('ArrowUp');
  await sleep(400);
  const s6 = await page.evaluate(() => { const el = document.querySelector('[data-role="search"]'); if (!el) return null; const r = el.getBoundingClientRect(); const tl = document.querySelector('[data-role="top-left"]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, cx: r.x + r.width / 2, w: window.innerWidth, clusterBottom: tl.bottom }; });
  const a6 = await active();
  step('위 키: 찾기 바가 위 가운데(위 알약 줄 아래)에 열리고 입력칸에 초점', s6 && s6.top >= s6.clusterBottom && s6.top < 120 && Math.abs(s6.cx - s6.w / 2) < 120 && a6 && a6.field === 'search', { box: s6, active: a6 });
  await page.keyboard.type('mtask-p43');
  await until(() => page.evaluate(() => document.querySelectorAll('.mt-search-item:not(.empty)').length > 0), 8000, 200).catch(() => null);
  const s6b = await page.evaluate(() => { const i = document.querySelector('[data-field="search"]').getBoundingClientRect(); const it = document.querySelector('.mt-search-item:not(.empty)'); return { value: document.querySelector('[data-field="search"]').value, inputBottom: i.bottom, itemTop: it ? it.getBoundingClientRect().top : null, n: document.querySelectorAll('.mt-search-item').length }; });
  step('위 키: 바로 칠 수 있고 결과는 아래로 펼친다', s6b.value === 'mtask-p43' && s6b.itemTop != null && s6b.itemTop > s6b.inputBottom, s6b);
  await shot('06-up-search');
  // 바깥(노드 머리줄) 한 번 누르기: 찾기 바가 닫히고 노드도 골라진다
  const hb2 = await (await page.$(`.react-flow__node[data-id="${S}"] .mt-node-head`)).boundingBox();
  await page.keyboard.down('Control'); await page.mouse.click(hb2.x + hb2.width / 2, hb2.y + 8); await page.keyboard.up('Control'); await sleep(400);
  const s6c = await page.evaluate((i) => ({ open: !!document.querySelector('[data-role="search"]'), selected: window.__mt.getState().selected.includes(i) }), S);
  step('찾기 바: 바깥(노드)을 한 번 누르면 닫히고 그 노드도 골라진다', !s6c.open && s6c.selected, s6c);
  await page.evaluate(() => window.__mt.getState().clearSelection());
  // 빈 캔버스 누르기와 Esc
  await clickBlank(); await page.keyboard.press('ArrowUp'); await sleep(300);
  await clickBlank();
  const s6d = await page.evaluate(() => !!document.querySelector('[data-role="search"]'));
  await page.keyboard.press('ArrowUp'); await sleep(300); await page.keyboard.press('Escape'); await sleep(200);
  const s6e = await page.evaluate(() => !!document.querySelector('[data-role="search"]'));
  step('찾기 바: 빈 캔버스를 눌러도, Esc로도 닫힌다', !s6d && !s6e, { afterBlank: s6d, afterEsc: s6e });
  // 찾기 바 안을 누르면 닫히지 않는다
  await page.keyboard.press('ArrowUp'); await sleep(300);
  await page.click('[data-field="search"]'); await sleep(200);
  const s6f = await page.evaluate(() => !!document.querySelector('[data-role="search"]'));
  step('찾기 바: 안을 누르면 열려 있다', s6f, { open: s6f });
  await page.keyboard.press('Escape'); await sleep(200);

  // ---------- 7. 터미널에 초점이 있으면 방향키는 터미널로 간다 ----------
  await place(50);
  const ti7 = await term(S);
  await page.mouse.click(ti7.rect.x + ti7.rect.w / 2, ti7.rect.y + ti7.rect.h / 2);
  await sleep(500);
  await page.keyboard.type('echo p43mark'); await page.keyboard.press('Enter');
  await until(async () => { const t = await term(S); return t && t.lines.some((l) => /^p43mark\s*$/.test(l)); }, 10000, 200);
  await sleep(400);
  const a7 = await active();
  await page.keyboard.press('ArrowUp');
  await sleep(800);
  const t7 = await term(S);
  const prompt = t7.lines.filter((l) => l.trim()).slice(-1)[0] || '';
  const s7 = await page.evaluate(() => ({ search: !!document.querySelector('[data-role="search"]'), linking: document.querySelector('.mt-app').classList.contains('linking') }));
  const b7 = await barState();
  step('터미널 초점: 위 키는 셸의 이전 명령을 부른다(찾기 바는 열리지 않는다)', a7 && a7.xterm && /echo p43mark\s*$/.test(prompt) && !s7.search, { active: a7, prompt, s7 });
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowDown'); await sleep(400);
  const s7b = await page.evaluate(() => ({ linking: document.querySelector('.mt-app').classList.contains('linking') }));
  const b7b = await barState();
  step('터미널 초점: 왼쪽·아래 키도 터미널 몫이다(도구와 명령 바는 그대로)', !s7b.linking && b7b.hidden && b7.hidden, { s7b, b7, b7b });
  await shot('07-terminal-keys');
  await call('terminal.input', { session: S, data: '\x03' });

  // ---------- 8. 옛 창 시험용 고정(pinBottom)은 다시 읽어도 남고, 풀면 숨는다 ----------
  await page.evaluate(() => window.__mt.pinBottom(true));
  await reload(); await moveAway(); await sleep(1200);
  const b8 = await barState();
  await page.evaluate(() => window.__mt.pinBottom(false)); await sleep(1200);
  const b8b = await barState();
  step('고정: 다시 읽어도 보이고, 풀면 숨는다', !b8.hidden && b8b.hidden, { pinned: b8, unpinned: b8b });
} catch (e) {
  step('예외', false, String(e && (e.stack || e.message)).slice(0, 800));
  if (page) await shot('error').catch(() => {});
} finally {
  for (const n of spawned) { try { log(lastLine(atrium('kill', n, '--yes'))); } catch (e) { log('kill', n, e.message.slice(0, 200)); } }
  if (app) await closeApp(app);
  const pass = results.filter((r) => r.ok).length;
  log(`결과 ${pass}/${results.length}`);
  fs.writeFileSync(path.join(OUT, `${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
  process.exit(pass === results.length ? 0 : 1);
}
