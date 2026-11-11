// P61 창 시험: 아래 바가 넓힌 범위로 나오고(들어가는·나가는 선), 늦게 숨고, 아래에서 올라오는 움직임, 다시 그린 찾기 창의 내려오는 움직임과 키,
// 움직임 줄이기, 웹 화면(같은 판에 localhost로 짝 맺은 브라우저)에서도 같은지.
// 판: herdr 세션 atrium-dev-p61, 포트 47883, 이 워크트리의 backend/.dev(experiments/p61/tools/env.cjs). 세션은 셸 노드 하나.
// 사용: node experiments/p61/tools/e2e.cjs p61-motion.mjs [--fresh] [--no-web]
import path from 'node:path';
import { board, sleep, until, OUT } from './p61-lib.mjs';
import { newCode, pairByCode } from './p59-lib.mjs';
import { chromium } from 'playwright';
import { BAND_PX, EXIT_BAND_PX, BAND_SIDE_PX, EXIT_SIDE_PX, HIDE_DELAY_MS } from '../../src/renderer/lib/bottom.js';

const argv = process.argv.slice(2);
const b = board('p61-motion');
const { log, step } = b;
let page = null;
let browser = null;

// ---------- 창 안에서 읽기 ----------
const canvasBox = (pg) => pg.evaluate(() => { const r = document.querySelector('.mt-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom }; });
const barBox = (pg) => pg.evaluate(() => { const r = document.querySelector('[data-role="bottom"]').getBoundingClientRect(); return { left: r.left, right: r.right }; });
const barState = (pg) => pg.evaluate(() => {
  const bt = document.querySelector('[data-role="bottom"]'), c = document.querySelector('[data-role="chips"]'), cmd = document.querySelector('.mt-cmd');
  return { hidden: bt && bt.dataset.hidden === '1', chipsHidden: c && c.dataset.hidden === '1', cmdOpacity: cmd && +getComputedStyle(cmd).opacity, shown: window.__mt.getState().bottomShown };
});
const hitAt = (pg, x, y) => pg.evaluate(([xx, yy]) => { const e = document.elementFromPoint(xx, yy); if (!e) return null; return { xterm: !!e.closest('.xterm'), cmd: !!e.closest('.mt-cmd'), chips: !!e.closest('.mt-chips'), pane: e.classList.contains('react-flow__pane') }; }, [x, y]);
const searchOpen = (pg) => pg.evaluate(() => !!document.querySelector('[data-role="search"]'));
async function blankPoint(pg) {
  const c = await canvasBox(pg);
  for (let y = c.y + 120; y < c.bottom - 240; y += 40) for (let x = c.x + 110; x < c.x + c.w - 110; x += 60) { const h = await hitAt(pg, x, y); if (h && h.pane) return { x, y }; }
  throw new Error('빈 캔버스 점이 없다');
}
const clickBlank = async (pg) => { const p = await blankPoint(pg); await pg.mouse.click(p.x, p.y); await sleep(250); return p; };
// 프레임마다 그 요소의 불투명도와 옮김(transform의 y, translate의 y)을 적는다. 시작한 뒤 trigger를 부른다
function sampler(pg, sel, ms) {
  return pg.evaluate(([s, m]) => new Promise((res) => {
    const out = []; const t0 = performance.now();
    const f = () => {
      const el = document.querySelector(s);
      if (el) {
        const cs = getComputedStyle(el);
        const ty = cs.transform && cs.transform !== 'none' ? new DOMMatrix(cs.transform).m42 : 0;
        const tr = cs.translate && cs.translate !== 'none' ? parseFloat(String(cs.translate).split(' ')[1] || '0') : 0;
        out.push({ t: Math.round(performance.now() - t0), op: Math.round(+cs.opacity * 1000) / 1000, ty: Math.round(ty * 10) / 10, tr: Math.round(tr * 10) / 10, st: el.dataset.state || el.dataset.hidden || '' });
      } else out.push({ t: Math.round(performance.now() - t0), none: true });
      if (performance.now() - t0 < m) requestAnimationFrame(f); else res(out);
    };
    requestAnimationFrame(f);
  }), [sel, ms]);
}
const tagOf = (pre) => (pre.includes('웹') ? 'web' : pre.replace(/\W/g, '') || 'win');
const mids = (frames, key, lo, hi) => frames.filter((f) => !f.none && f[key] > lo && f[key] < hi);
const brief = (frames) => frames.filter((_, i) => i % 2 === 0).slice(0, 18).map((f) => (f.none ? `${f.t}:-` : `${f.t}:${f.op}/${f.ty || f.tr}`)).join(' ');
// 움직임을 중간에서 멈추고 스크린숏(트랜지션·애니메이션 모두 getAnimations로 잡힌다)
async function midShot(pg, sel, at, name, shotFn) {
  const n = await pg.evaluate(([s, t]) => { const el = document.querySelector(s); if (!el) return 0; const as = el.getAnimations({ subtree: true }); for (const a of as) { a.pause(); a.currentTime = t; } return as.length; }, [sel, at]);
  await shotFn(name);
  await pg.evaluate((s) => { const el = document.querySelector(s); if (el) for (const a of el.getAnimations({ subtree: true })) a.play(); }, sel);
  return n;
}

// ---------- 아래 바와 찾기 창(창과 웹 화면이 함께 쓴다) ----------
async function bottomChecks(pg, pre, shotFn, { terminal = null } = {}) {
  const c = await canvasBox(pg); const bar = await barBox(pg);
  const cx = Math.round((bar.left + bar.right) / 2);
  const far = { x: cx, y: Math.round(c.bottom - 340) };
  const enter = { x: cx, y: Math.round(c.bottom - (BAND_PX - 20)) }; // 옛 띠(28px)보다 훨씬 위
  const between = { x: cx, y: Math.round(c.bottom - (BAND_PX + EXIT_BAND_PX) / 2) };
  const sideBetween = { x: Math.round(bar.right + (BAND_SIDE_PX + EXIT_SIDE_PX) / 2), y: Math.round(c.bottom - 40) };
  await pg.mouse.move(far.x, far.y); await sleep(HIDE_DELAY_MS + 500);
  const b0 = await barState(pg);
  step(`${pre}처음: 명령 바와 칩이 숨어 있다`, b0.hidden && b0.chipsHidden && b0.cmdOpacity === 0, b0);
  // 두 선 사이로는 나타나지 않는다
  await pg.mouse.move(between.x, between.y, { steps: 4 }); await sleep(450);
  const b1 = await barState(pg);
  step(`${pre}숨은 동안 들어가는 선 밖(아래 끝에서 ${Math.round(c.bottom - between.y)}px)에서는 나타나지 않는다`, b1.hidden, b1);
  // 넓힌 범위로 들어가면 아래에서 올라온다
  const sP = sampler(pg, '.mt-cmd', 520);
  await pg.mouse.move(enter.x, enter.y, { steps: 3 });
  const fr = await sP;
  const b2 = await barState(pg);
  const up = mids(fr, 'ty', 0.5, 27.5);
  step(`${pre}아래 끝에서 ${Math.round(c.bottom - enter.y)}px 위(옛 띠 28px 밖)로 가면 나타난다`, !b2.hidden && !b2.chipsHidden && b2.cmdOpacity === 1, b2);
  step(`${pre}나타날 때 아래에서 올라온다(중간 프레임의 y가 0과 28px 사이, 불투명도가 0과 1 사이)`, up.length >= 2 && mids(fr, 'op', 0.02, 0.98).length >= 2 && fr[fr.length - 1].ty === 0, { frames: brief(fr), mid: up.length });
  // 나온 뒤에는 두 선 사이(위·옆)에서 숨지 않는다
  await pg.mouse.move(between.x, between.y, { steps: 3 }); await sleep(HIDE_DELAY_MS + 400);
  const b3 = await barState(pg);
  await pg.mouse.move(sideBetween.x, sideBetween.y, { steps: 3 }); await sleep(HIDE_DELAY_MS + 400);
  const b3s = await barState(pg);
  step(`${pre}나온 뒤에는 두 선 사이(위 ${Math.round(c.bottom - between.y)}px, 옆 바 끝에서 ${Math.round(sideBetween.x - bar.right)}px)로 가도 숨지 않는다`, !b3.hidden && !b3s.hidden, { b3, b3s });
  // 멀어지면 늦게 숨고, 숨을 때 내려간다
  const sH = sampler(pg, '.mt-cmd', HIDE_DELAY_MS + 450);
  const tOut = Date.now();
  await pg.mouse.move(far.x, far.y, { steps: 3 });
  await sleep(250);
  const b4 = await barState(pg);
  const frH = await sH;
  const b5 = await barState(pg);
  const firstMove = frH.find((f) => f.ty > 0.5);
  step(`${pre}멀어지면 바로 숨지 않고(250ms 뒤 보임) ${HIDE_DELAY_MS}ms 뒤 숨는다`, !b4.hidden && b5.hidden && b5.chipsHidden, { at250: b4, after: b5, waited: Date.now() - tOut });
  step(`${pre}숨을 때 아래로 내려가며 흐려진다`, mids(frH, 'ty', 0.5, 27.5).length >= 1 && firstMove && firstMove.t >= HIDE_DELAY_MS - 120, { firstMoveAt: firstMove && firstMove.t, frames: brief(frH.filter((f) => f.t > HIDE_DELAY_MS - 100)) });
  // 중간 프레임 스크린숏
  await pg.mouse.move(enter.x, enter.y, { steps: 2 }); await sleep(150);
  await midShot(pg, '[data-role="bottom"]', 90, `${tagOf(pre)}-bar-mid`, shotFn);
  await sleep(500);
  await shotFn(`${tagOf(pre)}-bar-shown`);
  await pg.mouse.move(far.x, far.y); await sleep(HIDE_DELAY_MS + 500);
  // ↓ 키(초점)로 나타날 때도 올라온다
  await clickBlank(pg);
  await pg.mouse.move(far.x, far.y);
  const sK = sampler(pg, '.mt-cmd', 400);
  await pg.keyboard.press('ArrowDown');
  const frK = await sK;
  const aK = await pg.evaluate(() => document.activeElement && document.activeElement.dataset.role);
  step(`${pre}↓ 키로 나타날 때도 올라오고 입력칸에 초점`, aK === 'command' && mids(frK, 'ty', 0.5, 27.5).length >= 1, { active: aK, frames: brief(frK) });
  // 초점이 있으면 멀어져도 숨지 않는다
  await sleep(HIDE_DELAY_MS + 600);
  const b6 = await barState(pg);
  step(`${pre}명령 바에 초점이 있으면 마우스가 멀어도 숨지 않는다`, !b6.hidden, b6);
  // 쓰다 만 글이 있으면 초점이 나가도 숨지 않는다
  await pg.keyboard.type('@s1 draft');
  await clickBlank(pg); await pg.mouse.move(far.x, far.y); await sleep(HIDE_DELAY_MS + 600);
  const b7 = await barState(pg);
  step(`${pre}쓰다 만 글이 있으면 초점이 나가고 마우스가 멀어도 숨지 않는다`, !b7.hidden, b7);
  await pg.click('[data-role="command"]'); await pg.keyboard.press('Control+A'); await pg.keyboard.press('Delete'); await pg.keyboard.press('Escape');
  await pg.mouse.move(far.x, far.y); await sleep(HIDE_DELAY_MS + 600);
  const b8 = await barState(pg);
  step(`${pre}글을 지우고 Esc로 나가면 숨는다`, b8.hidden, b8);
  if (terminal) await terminal({ c, cx, enter, far });
}

async function searchChecks(pg, pre, shotFn) {
  const tag = tagOf(pre);
  await clickBlank(pg);
  // ↑ 키: 위에서 내려온다
  const sO = sampler(pg, '.mt-search', 360);
  await pg.keyboard.press('ArrowUp');
  const frO = await sO;
  const box = await pg.evaluate(() => { const el = document.querySelector('[data-role="search"]'); const i = document.querySelector('.mt-search-bar'); const r = el.getBoundingClientRect(); return { w: Math.round(r.width), top: Math.round(r.top), inputH: i ? Math.round(i.getBoundingClientRect().height) : null, font: getComputedStyle(document.querySelector('[data-field="search"]')).fontSize, icon: !!document.querySelector('.mt-search-bar .mt-search-icon'), keys: [...document.querySelectorAll('.mt-search-foot kbd')].map((k) => k.textContent), placeholder: document.querySelector('[data-field="search"]').placeholder, focused: document.activeElement && document.activeElement.dataset.field }; });
  step(`${pre}↑ 키: 찾기 창이 열리고 입력칸에 초점, 아이콘·짧은 자리 표시·키 안내`, box.focused === 'search' && box.icon && box.keys.join(' ') === '↑ ↓ Enter Esc' && box.placeholder.length <= 20 && box.inputH >= 46 && parseFloat(box.font) >= 15, box);
  step(`${pre}찾기 창이 위에서 내려온다(중간 프레임 translate y가 -14과 0 사이)`, mids(frO, 'tr', -13.5, -0.3).length >= 2 && mids(frO, 'op', 0.02, 0.98).length >= 2 && frO[frO.length - 1].tr === 0, { frames: brief(frO) });
  await pg.keyboard.press('Escape'); await sleep(400);
  await pg.keyboard.press('ArrowUp'); await sleep(50);
  await midShot(pg, '.mt-search', 45, `${tag}-search-mid`, shotFn);
  await sleep(300);
  // 결과, 위아래 키
  await pg.fill('[data-field="search"]', 'p61');
  await until(() => pg.evaluate(() => document.querySelectorAll('.mt-search-item:not(.empty)').length >= 3), 10000, 200);
  const r0 = await pg.evaluate(() => ({ kinds: [...document.querySelectorAll('.mt-search-item:not(.empty)')].map((e) => e.dataset.kind), tags: [...document.querySelectorAll('.mt-search-tag')].map((e) => e.textContent), marks: document.querySelectorAll('.mt-search-item mark').length, on: [...document.querySelectorAll('.mt-search-item')].findIndex((e) => e.classList.contains('on')) }));
  await pg.keyboard.press('ArrowDown'); await sleep(120);
  const on1 = await pg.evaluate(() => [...document.querySelectorAll('.mt-search-item')].findIndex((e) => e.classList.contains('on')));
  await pg.keyboard.press('ArrowUp'); await pg.keyboard.press('ArrowUp'); await sleep(120);
  const on2 = await pg.evaluate(() => [...document.querySelectorAll('.mt-search-item')].length - 1 === [...document.querySelectorAll('.mt-search-item')].findIndex((e) => e.classList.contains('on')));
  step(`${pre}결과: 종류 표시와 맞는 글자 강조, ↑↓로 고른 줄이 옮겨 가고 끝에서 돈다`, r0.tags.length === r0.kinds.length && r0.marks >= r0.kinds.length && r0.on === 0 && on1 === 1 && on2, { ...r0, on1, wrapped: on2 });
  await shotFn(`${tag}-search-results`);
  // 결과 없음
  await pg.fill('[data-field="search"]', 'zzqx none');
  await until(() => pg.evaluate(() => !!document.querySelector('[data-role="search-empty"]')), 5000, 150);
  const e0 = await pg.evaluate(() => document.querySelector('[data-role="search-empty"]').innerText.replace(/\s+/g, ' '));
  step(`${pre}결과 없음 안내`, /zzqx none/.test(e0), { text: e0 });
  // Enter: 그 줄로 가고 닫힌다(닫힐 때 올라간다)
  await pg.fill('[data-field="search"]', 'p61 search notes');
  await until(() => pg.evaluate(() => document.querySelector('.mt-search-item.on[data-kind="memo"]')), 10000, 150);
  const sC = sampler(pg, '.mt-search', 330);
  await pg.keyboard.press('Enter');
  const frC = await sC;
  await sleep(200);
  const closing = frC.filter((f) => f.st === 'closing');
  step(`${pre}Enter: 고른 메모로 가고 찾기 창이 위로 올라가며 닫힌다`, !(await searchOpen(pg)) && closing.length >= 2 && mids(closing, 'tr', -10, -0.3).length >= 1 && frC[frC.length - 1].none, { closingFrames: closing.length, frames: brief(frC) });
  // 바깥 누르기, Esc, 안 누르기
  await pg.keyboard.press('Escape').catch(() => {});
  await clickBlank(pg); await pg.keyboard.press('ArrowUp'); await sleep(300);
  await clickBlank(pg); await sleep(250);
  const o1 = await searchOpen(pg);
  await pg.keyboard.press('ArrowUp'); await sleep(300); await pg.keyboard.press('Escape'); await sleep(250);
  const o2 = await searchOpen(pg);
  await pg.keyboard.press('ArrowUp'); await sleep(300); await pg.click('[data-field="search"]'); await sleep(250);
  const o3 = await searchOpen(pg);
  await pg.keyboard.press('Escape'); await sleep(300);
  step(`${pre}바깥을 누르면, Esc로 닫히고 안을 누르면 열려 있다`, !o1 && !o2 && o3, { afterBlank: o1, afterEsc: o2, afterInside: o3 });
}

async function reducedChecks(pg, pre) {
  await pg.emulateMedia({ reducedMotion: 'reduce' });
  const rm = await pg.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const c = await canvasBox(pg); const bar = await barBox(pg); const cx = (bar.left + bar.right) / 2;
  await pg.mouse.move(cx, c.bottom - 340); await sleep(HIDE_DELAY_MS + 500);
  const sP = sampler(pg, '.mt-cmd', 400);
  await pg.mouse.move(cx, c.bottom - 60, { steps: 2 });
  const fr = await sP;
  await clickBlank(pg);
  const sO = sampler(pg, '.mt-search', 300);
  await pg.keyboard.press('ArrowUp');
  const frO = await sO;
  const sC = sampler(pg, '.mt-search', 250);
  await pg.keyboard.press('Escape');
  const frC = await sC;
  const step1 = mids(fr, 'ty', 0.5, 27.5).length === 0 && mids(fr, 'op', 0.02, 0.98).length === 0 && fr[fr.length - 1].op === 1;
  const step2 = mids(frO, 'tr', -13.5, -0.3).length === 0 && mids(frO, 'op', 0.02, 0.98).length === 0;
  const step3 = frC.filter((f) => f.st === 'closing').length <= 1;
  step(`${pre}움직임 줄이기: 바와 찾기 창이 움직이지 않고 바로 바뀐다`, rm && step1 && step2 && step3, { matches: rm, bar: brief(fr), open: brief(frO), close: brief(frC) });
  await pg.emulateMedia({ reducedMotion: 'no-preference' });
  await pg.mouse.move(cx, c.bottom - 340); await sleep(HIDE_DELAY_MS + 400);
}

let code = 1;
try {
  if (argv.includes('--fresh')) await b.fresh();
  await b.launch();
  await b.seed();
  page = b.page;
  const S = b.ids.s1;
  // 셸 노드를 키우고 출력으로 채운 뒤, 터미널 아래 끝이 판 아래 끝에서 50px 위에 오게 둔다(노드가 아래쪽에 있을 때)
  const nodeRect = (id) => page.evaluate((i) => { const r = window.__mt.getState().nodes.get(i); return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null; }, id);
  const r0 = await nodeRect(S);
  if (r0.w !== 1000 || r0.h !== 520) {
    await b.call('board.setNode', { session: S, x: Math.round(r0.x), y: Math.round(r0.y), w: 1000, h: 520, z: 0, cause: 'p61-test' });
    await page.reload(); await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
    await until(async () => { const q = await nodeRect(S); return q && q.w === 1000; }, 10000);
  }
  const term = () => page.evaluate((i) => { const t = window.__mt.terms.get(i); const el = document.querySelector(`.mt-term[data-session="${i}"] .xterm-screen`); if (!t || !el) return null; const r = el.getBoundingClientRect(); return { rows: t.rows, y: r.y, h: r.height, viewportY: t.buffer.active.viewportY, baseY: t.buffer.active.baseY, sel: t.hasSelection() }; }, S);
  await until(async () => !!(await term()), 20000, 300);
  await until(() => page.evaluate((i) => !document.querySelector(`.react-flow__node[data-id="${i}"] .mt-term-note`), S), 20000, 300);
  await sleep(1000);
  await b.call('terminal.input', { session: S, data: '1..120 | % { "p61 line $_" }\r' });
  await sleep(2500);
  const place = async (gap) => {
    await page.evaluate(([i]) => { const st = window.__mt.getState(); const r = st.nodes.get(i); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - (r.x + r.w / 2), y: el.clientHeight - 30 - (r.y + r.h), zoom: 1 }); }, [S]);
    await sleep(700);
    const c = await canvasBox(page); const ti = await term();
    const dy = (c.bottom - gap) - (ti.y + ti.h);
    await page.evaluate(([d]) => { const st = window.__mt.getState(); const m = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform); st.setViewport({ x: m.e, y: m.f + d, zoom: m.a }); }, [dy]);
    await sleep(700);
  };
  await place(50);

  // 터미널: 글 고르기와 휠 굴리기가 방해받지 않는가
  const terminalChecks = async ({ c, cx, enter, far }) => {
    // 터미널 안에서 눌러 아래로 끌어 범위로 들어가도(글 고르기) 바는 나타나지 않는다
    const ti = await term();
    await page.mouse.move(cx - 200, ti.y + 40); await sleep(HIDE_DELAY_MS + 300);
    await page.mouse.down();
    await page.mouse.move(cx, c.bottom - 70, { steps: 12 });
    await sleep(500);
    const d1 = await barState(page);
    await page.mouse.up(); await sleep(150);
    const t1 = await term();
    step('터미널에서 글을 고르며 아래 범위로 끌어도 바는 나타나지 않는다', d1.hidden && t1.sel, { bar: d1, selection: t1.sel });
    await page.mouse.move(far.x, far.y); await sleep(HIDE_DELAY_MS + 400);
    // 범위 안 터미널 줄 위에서 휠: 바가 나타나도 그 자리(바와 칩 사이·위)는 터미널이 받고 굴러간다
    const wheelAt = { x: cx - 150, y: Math.round(c.bottom - 95) };
    await page.mouse.move(wheelAt.x, wheelAt.y, { steps: 3 }); await sleep(400);
    const h1 = await hitAt(page, wheelAt.x, wheelAt.y);
    const v0 = (await term()).viewportY;
    for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, -240); await sleep(80); }
    await sleep(300);
    const v1 = (await term()).viewportY;
    step('범위 안 터미널 줄(바와 칩 사이) 위에서 휠을 굴리면 터미널이 굴러간다', h1 && h1.xterm && v1 < v0, { hit: h1, before: v0, after: v1, fromBottom: Math.round(c.bottom - wheelAt.y) });
    for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, 400); await sleep(60); }
    // 바가 보이는 동안 가리는 줄: 바와 칩이 덮는 터미널 자리
    const cover = [];
    for (let y = Math.round(c.bottom - 50); y > c.bottom - BAND_PX; y -= 8) { const h = await hitAt(page, cx, y); cover.push(h && (h.cmd ? 'B' : h.chips ? 'C' : h.xterm ? 't' : '.')); }
    log('바가 보일 때 가운데 줄(아래 50px부터 위로 8px마다): B=명령 바 C=칩 t=터미널', cover.join(''));
    await b.shot('03-terminal-bottom');
    await page.mouse.move(far.x, far.y); await sleep(HIDE_DELAY_MS + 400);
  };

  await b.shot('01-hidden');
  await bottomChecks(page, '', b.shot, { terminal: terminalChecks });
  await searchChecks(page, '', b.shot);
  await reducedChecks(page, '');
  // 두 번째 창 크기
  await b.size(1366, 768);
  await bottomChecks(page, '[1366] ', b.shot);
  await searchChecks(page, '[1366] ', b.shot);
  await b.size(1584, 921);

  // ---------- 웹 화면 ----------
  if (!argv.includes('--no-web')) {
    const BASE = 'http://localhost:47883'; // 패스키의 RP ID는 IP 주소가 될 수 없어 localhost로 연다
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ko-KR' });
    const wp = await ctx.newPage();
    wp.on('pageerror', (e) => log(`[web pageerror] ${e.message}`));
    const cdp = await ctx.newCDPSession(wp);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    const codeStr = await newCode(page);
    await pairByCode(wp, BASE, codeStr, 'p61 web');
    await wp.waitForSelector('.react-flow__node');
    await sleep(1500);
    const wshot = async (name) => { await wp.screenshot({ path: path.join(OUT, `p61-motion-${name}.png`) }); log('스크린숏', `web-${name}`); };
    await wshot('web-01-board');
    await bottomChecks(wp, '[웹] ', wshot);
    await searchChecks(wp, '[웹] ', wshot);
    await reducedChecks(wp, '[웹] ');
    // 짝 맺은 시험 기기를 지운다
    const devs = await b.call('device.list', {}).catch(() => null);
    const list = devs && (devs.devices || devs);
    if (Array.isArray(list)) for (const d of list.filter((x) => x.name === 'p61 web')) await b.call('device.revoke', { id: d.id }).catch((e) => log('기기 지우기', e.message));
  }
  code = b.summary() ? 1 : 0;
} catch (e) {
  log('오류', e.stack || e.message);
  b.summary();
} finally {
  if (browser) await browser.close().catch(() => {});
  await b.close();
}
process.exit(code);
