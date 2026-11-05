// P30 창 시험: 덩어리 안 연결(다리·괄호·둘레 길, 터미널 위 선 없음, 초점·마우스 강조, 다리를 누르면 오간 기록, 덩어리 안 잇기),
// 배치 틀을 바꾼 뒤 고름 유지와 이어지는 틀·크기 단추, 붙여 막 만든 덩어리에서 첫 크기 단추·토글.
// 판: herdr 세션 atrium-dev-p30, 포트 47848, backend/.dev(experiments/p30/tools/env.cjs). 시험 폴더는 새로 만든 C:\Workspace\mtask-p30-ws 하나, 셸만 띄운다.
// 사용: node experiments/p30/tools/e2e.cjs p30-dock.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, closeApp, shot, logger, sleep, until, call, writeJson, DIRS, DEV } from './p10-lib.mjs';

if (process.env.MT_E2E_BOARD !== 'p30') throw new Error('MT_E2E_BOARD=p30으로 돌린다(experiments/p30/tools/e2e.cjs)');
const log = logger('p30-dock');
const result = { steps: [] };
const step = (name, ok, data = {}) => { result.steps.push({ name, ok: !!ok, ...data }); log(`${ok ? '통과' : '실패'}: ${name}`, data); };
for (const d of [DIRS.ws, path.join(DEV, 'fixture-projects-p30'), path.join(DEV, 'fixture-sessions-p30')]) fs.mkdirSync(d, { recursive: true });
const NAMES = ['lead', 'ui', 'tests', 'review'];
const AT = { lead: [0, 0], ui: [900, 0], tests: [0, 700], review: [900, 700] };

const sid = (page, name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? s.sessionId : null; }, name);
const ids = async (page) => Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await sid(page, n)])));
const rects = (page) => page.evaluate(() => { const s = window.__mt.getState(); return Object.fromEntries([...s.sessions.values()].map((x) => [x.name, s.nodes.get(x.sessionId)]).filter(([, r]) => r).map(([n, r]) => [n, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }])); });
const bboxOf = (rs) => { const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)); return { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 }; };
const sel = (page) => page.evaluate(() => window.__mt.getState().selected.map((id) => (window.__mt.getState().sessions.get(id) || {}).name));
async function frame(page, rect, margin = 260) {
  await page.evaluate(([r, m]) => window.__mt.getState().navigateToRect({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m + 420 }, 0), [rect, margin]); // 아래 칩 줄을 피해 덩어리를 위로
  await sleep(800);
}
async function headClick(page, name, ctrl = false) {
  const head = await page.locator(`.mt-node[data-name="${name}"] .mt-node-head`).boundingBox();
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.click(head.x + Math.min(120, head.width / 3), head.y + head.height / 2);
  if (ctrl) await page.keyboard.up('Control');
  await sleep(400);
}
const clearSel = (page) => page.evaluate(() => { const s = window.__mt.getState(); if (s.clearSelection) s.clearSelection(); });
async function dropDeliveries(page) {
  for (const n of NAMES) for (const d of await call(page, 'delivery.list', { session: n, limit: 50 }).catch(() => [])) if (d.status === 'queued' || d.status === 'pending') await call(page, 'delivery.cancel', { deliveryId: d.deliveryId }).catch(() => {});
}
async function unlinkAll(page) { for (const l of await call(page, 'link.list').catch(() => [])) if (!l.removedAt) await call(page, 'link.delete', { link: l.linkId, confirm: true }).catch(() => {}); await dropDeliveries(page); }
async function reset(page, base) {
  for (const d of await call(page, 'dock.list')) await call(page, 'dock.remove', { dock: d.dockId });
  await unlinkAll(page);
  for (const n of NAMES) { const id = await sid(page, n); if (id) await call(page, 'board.setNode', { session: id, x: base.x + AT[n][0], y: base.y + AT[n][1], w: 720, h: 460, z: 0, cause: 'p30 test reset' }); }
  await page.evaluate(() => { window.__mt.api.emit('board.changed', { why: 'p30 test reset' }); });
  await clearSel(page);
  await page.mouse.move(5, 400);
  await sleep(900);
}
async function layoutDock(page, members, preset) { await call(page, 'dock.layout', { members, preset }); await sleep(1000); }
async function link(page, I, from, to, role) { const r = await call(page, 'link.create', { from: I[from], to: I[to], role }); await dropDeliveries(page); return r.link.linkId; }
// 덩어리 안 연결 모양(창 좌표). kind: bridge | bracket | around | chip
const dl = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-role=dock-links]');
  if (!root) return null;
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; };
  const st = window.__mt.getState();
  const nm = (id) => (st.sessions.get(id) || {}).name;
  return {
    focus: root.dataset.focus ? nm(root.dataset.focus) : null,
    items: [...root.querySelectorAll('[data-link]')].filter((e) => e.dataset.kind).map((e) => ({
      kind: e.dataset.kind, link: e.dataset.link, from: nm(e.dataset.from), to: nm(e.dataset.to), lane: e.dataset.lane != null ? +e.dataset.lane : undefined, sides: e.dataset.sides, arrow: e.dataset.arrow,
      cls: [...e.classList].filter((c) => ['hot', 'dim', 'active'].includes(c)), box: box(e),
      // 바깥 길의 꺾인 점(창 좌표). SVG 길의 점을 화면 좌표로 바꾼다
      pts: e.tagName === 'g' ? (() => { const p = e.querySelector('.mt-dl-line'); const m = p.getScreenCTM(); const L = p.getTotalLength(); return Array.from({ length: 41 }, (_, i) => { const q = p.getPointAtLength((L * i) / 40); return { x: Math.round(q.x * m.a + m.e), y: Math.round(q.y * m.d + m.f) }; }); })() : undefined,
    })),
  };
});
// 노드 화면 사각형(창 좌표)
const nodeBox = (page, name) => page.evaluate((n) => { const e = document.querySelector(`.mt-node[data-name="${n}"]`); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, name);
// 바깥 길이 터미널 위를 지나지 않는다: 처음·끝 몇 점(칸 테두리)을 빼면 모든 점이 덩어리 바깥(2px 여유)
const offTerminal = (pts, O, tol = 2) => pts.slice(2, -2).every((p) => p.x < O.x + tol || p.x > O.x + O.w - tol || p.y < O.y + tol || p.y > O.y + O.h - tol);
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

let { app, page } = await launch({ log });
try {
  if (await page.$('[data-role="sidebar"]')) await page.click('[data-action="sidebar"]');
  // 이 시험의 넷 말고 남은 시험 세션은 끈다(이 판은 P30 시험 판)
  for (const s of await page.evaluate(() => [...window.__mt.getState().sessions.values()].map((x) => x.name))) if (!NAMES.includes(s)) await call(page, 'session.kill', { session: s, confirm: true }).catch(() => {});
  for (const n of NAMES) if (!(await sid(page, n))) await call(page, 'session.spawn', { cwd: DIRS.ws, kind: 'shell', name: n });
  await until(async () => (await Promise.all(NAMES.map((n) => sid(page, n)))).every(Boolean), 60000, 500);
  await sleep(2500);
  const I = await ids(page);
  const base = (await rects(page)).lead;
  log('기준 자리(lead)', base);

  // 1) 2개 덩어리: 가운데 경계의 다리 하나(가로·세로)
  await reset(page, base);
  for (const [preset, , arrowWant] of [['row', 'v', 'right'], ['col', 'h', 'down']]) {
    await layoutDock(page, [I.lead, I.ui], preset);
    if (preset === 'row') await link(page, I, 'lead', 'ui', 'p30 짝');
    const R0 = await rects(page);
    await frame(page, bboxOf([R0.lead, R0.ui]));
    const d = await dl(page);
    const a = await nodeBox(page, 'lead'), b = await nodeBox(page, 'ui');
    const br = d && d.items.find((x) => x.kind === 'bridge');
    const boundary = preset === 'row' ? { x: a.x + a.w } : { y: a.y + a.h };
    const onEdge = br && (preset === 'row' ? near(br.box.cx, boundary.x) && near(br.box.cy, a.y + a.h / 2, 6) : near(br.box.cy, boundary.y) && near(br.box.cx, a.x + a.w / 2, 6));
    const svgLines = d ? d.items.filter((x) => x.kind !== 'bridge').length : -1;
    await shot(page, `p30-1-${preset}-bridge`);
    step(`2개 덩어리(${preset}): 가운데 경계의 다리 하나(${arrowWant}), 터미널 위 선 없음`, d && d.items.length === 1 && br && br.arrow === arrowWant && onEdge && svgLines === 0, { items: d && d.items.map((x) => ({ kind: x.kind, arrow: x.arrow, box: x.box })), boundary, b });
  }

  // 2) 1x3: lead → 오른쪽 셋은 세로 경계의 다리, ui → review는 오른쪽 괄호
  await reset(page, base);
  await layoutDock(page, [I.lead, I.ui, I.tests, I.review], 'main-left-3');
  const L = {};
  for (const to of ['ui', 'tests', 'review']) L[`lead>${to}`] = await link(page, I, 'lead', to, `p30 ${to}`);
  L['ui>review'] = await link(page, I, 'ui', 'review', 'p30 검토');
  await sleep(800);
  let R = await rects(page);
  await frame(page, bboxOf(NAMES.map((n) => R[n])));
  let d = await dl(page);
  const lead = await nodeBox(page, 'lead');
  const O = bboxOf(await Promise.all(NAMES.map((n) => nodeBox(page, n))));
  const bridges = d.items.filter((x) => x.kind === 'bridge');
  const bracket = d.items.find((x) => x.kind === 'bracket');
  const vEdge = lead.x + lead.w;
  step('1x3: lead → ui·tests·review는 세로 경계 위 다리 셋(→)', bridges.length === 3 && bridges.every((x) => x.from === 'lead' && x.arrow === 'right' && near(x.box.cx, vEdge)), { bridges: bridges.map((x) => ({ to: x.to, box: x.box })), vEdge });
  step('1x3: ui → review는 오른쪽 바깥 괄호(덩어리 테두리 밖, 터미널 위 선 없음)', bracket && bracket.from === 'ui' && bracket.to === 'review' && bracket.sides === 'right,right' && Math.max(...bracket.pts.map((p) => p.x)) > O.x + O.w + 4 && offTerminal(bracket.pts, O), { bracket: bracket && { sides: bracket.sides, box: bracket.box }, O });
  await shot(page, 'p30-2-1x3');

  // 3) 마우스 올림·초점 강조
  const ui = await nodeBox(page, 'ui');
  await page.mouse.move(ui.x + ui.w / 2, ui.y + ui.h / 2); await sleep(500);
  d = await dl(page);
  const touchUi = (x) => x.from === 'ui' || x.to === 'ui';
  const hoverOk = d.focus === 'ui' && d.items.every((x) => (touchUi(x) ? x.cls.includes('hot') : x.cls.includes('dim')));
  await shot(page, 'p30-3-1-hover-ui');
  step('칸(ui)에 마우스를 올리면 그 칸에 닿는 다리·괄호만 진하게, 나머지는 옅게', hoverOk, { items: d.items.map((x) => [x.link === L['ui>review'] ? 'ui>review' : `${x.from}>${x.to}`, x.cls.join(',')]) });
  await page.mouse.move(5, 400); await sleep(300);
  await headClick(page, 'tests', true);
  await page.mouse.move(5, 400); await sleep(400);
  d = await dl(page);
  const focusOk = d.focus === 'tests' && d.items.every((x) => ((x.from === 'tests' || x.to === 'tests') ? x.cls.includes('hot') : x.cls.includes('dim')));
  await shot(page, 'p30-3-2-focus-tests');
  step('고른 칸(tests)에 닿는 다리만 진하게', focusOk, { focus: d.focus, items: d.items.map((x) => [`${x.from}>${x.to}`, x.cls.join(',')]) });
  await clearSel(page); await sleep(400);
  d = await dl(page);
  step('초점·마우스가 없으면 모두 보통', !d.focus && d.items.every((x) => !x.cls.length), { items: d.items.map((x) => x.cls) });
  // 다리에 마우스를 올리면 역할 이름이 펼쳐지고, 누르면 오간 기록
  const b1 = d.items.find((x) => x.kind === 'bridge' && x.to === 'tests');
  await page.mouse.move(b1.box.cx, b1.box.cy); await sleep(400);
  const roleShown = await page.evaluate((id) => { const e = document.querySelector(`.mt-dl-bridge[data-link="${id}"] .mt-dl-role`); return e ? { shown: getComputedStyle(e).display !== 'none', text: e.textContent } : null; }, b1.link);
  await shot(page, 'p30-3-3-bridge-hover');
  step('다리에 마우스를 올리면 역할 이름이 보인다', roleShown && roleShown.shown && roleShown.text === 'p30 tests', roleShown || {});
  await page.mouse.click(b1.box.cx, b1.box.cy); await sleep(900);
  const panel = await page.$(`[data-role=link-panel][data-link="${b1.link}"]`);
  await shot(page, 'p30-3-4-bridge-click-panel');
  step('다리를 누르면 오간 기록(LinkPanel)', !!panel, {});
  if (panel) await page.click('[data-role=link-panel] .mt-x'); await sleep(400);
  // 괄호에 올리면 역할 글, 누르면 기록
  d = await dl(page);
  const bk = d.items.find((x) => x.kind === 'bracket');
  const bkPt = bk.pts[20];
  await page.mouse.move(bkPt.x, bkPt.y); await sleep(400);
  const tip = await page.evaluate(() => { const e = document.querySelector('.mt-dl-tip'); return e ? e.textContent : null; });
  await page.mouse.click(bkPt.x, bkPt.y); await sleep(900);
  const panel2 = await page.$(`[data-role=link-panel][data-link="${bk.link}"]`);
  step('괄호에 올리면 역할 이름, 누르면 오간 기록', tip === 'p30 검토' && !!panel2, { tip });
  if (panel2) await page.click('[data-role=link-panel] .mt-x'); await sleep(300);

  // 4) 2x2 대각선: 둘레 길(ㄱ자), 둘이 같은 모서리를 돌면 다른 차선
  await reset(page, base);
  await layoutDock(page, [I.lead, I.ui, I.tests, I.review], 'grid'); // lead ui / tests review
  await link(page, I, 'lead', 'ui', 'p30 옆');
  await link(page, I, 'lead', 'review', 'p30 대각');
  await link(page, I, 'ui', 'tests', 'p30 반대 대각');
  await sleep(800);
  R = await rects(page);
  await frame(page, bboxOf(NAMES.map((n) => R[n])));
  d = await dl(page);
  const O2 = bboxOf(await Promise.all(NAMES.map((n) => nodeBox(page, n))));
  const around = d.items.filter((x) => x.kind === 'around');
  const lanesOk = around.length === 2 && (around[0].sides.split(',').some((s) => around[1].sides.split(',').includes(s)) ? around[0].lane !== around[1].lane : true);
  step('2x2: 이웃은 다리, 두 대각선은 덩어리 둘레를 도는 길(터미널 위를 지나지 않음)', d.items.filter((x) => x.kind === 'bridge').length === 1 && around.length === 2 && around.every((x) => offTerminal(x.pts, O2)), { items: d.items.map((x) => ({ kind: x.kind, sides: x.sides, lane: x.lane, from: x.from, to: x.to })) });
  step('2x2: 같은 변을 쓰는 둘레 길은 다른 차선', lanesOk, { around: around.map((x) => ({ sides: x.sides, lane: x.lane })) });
  await shot(page, 'p30-4-2x2-diagonal');

  // 5) 덩어리 안에서 잇기: 잇기 모드에서 가운데 점끼리. 점은 잇기 모드에서만 보인다
  await unlinkAll(page); await sleep(800);
  await link(page, I, 'lead', 'ui', 'p30 옆');
  await sleep(600);
  const dots = () => page.evaluate(() => [...document.querySelectorAll('.mt-node.docked .mt-handle.h-c')].map((h) => (h.style.transition = 'none', h)).map((h) => ({ name: h.closest('.mt-node').dataset.name, op: +getComputedStyle(h).opacity, pe: getComputedStyle(h).pointerEvents })));
  let ds = await dots();
  step('연결이 있어도 잇기 모드가 아니면 가운데 점이 보이지 않는다', ds.length === 4 && ds.every((x) => x.op === 0 && x.pe === 'none'), { dots: ds });
  await page.click('[data-action=link-mode]'); await sleep(500);
  ds = await dots();
  const from = await page.locator('.mt-node[data-name="tests"] .mt-handle.h-c').boundingBox();
  const to = await page.locator('.mt-node[data-name="review"] .mt-handle.h-c').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await sleep(150);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) { await page.mouse.move(from.x + from.width / 2 + ((to.x - from.x) * i) / 14, from.y + from.height / 2 + ((to.y - from.y) * i) / 14); await sleep(20); }
  await sleep(200);
  await page.mouse.up(); await sleep(700);
  const roleDlg = await page.$('[data-role=link-role]');
  if (roleDlg) { await page.fill('[data-role=link-role] [data-field=role]', 'p30 점 잇기'); await page.click('[data-action=link-submit]'); await sleep(1500); }
  await dropDeliveries(page);
  await page.click('[data-action=link-mode]'); await sleep(600);
  d = await dl(page);
  const made = d.items.find((x) => x.from === 'tests' && x.to === 'review');
  await shot(page, 'p30-5-link-in-dock');
  step('잇기 모드에서 tests 점을 review 점에 놓으면 역할을 묻고 잇는다(맞닿은 칸이라 다리)', ds.every((x) => x.op > 0.5 && x.pe !== 'none') && !!roleDlg && made && made.kind === 'bridge' && made.arrow === 'right', { made: made && { kind: made.kind, arrow: made.arrow } });

  // 6) 배치 틀을 바꾼 뒤에도 고름이 남고, 이어서 다른 틀·크기 단추가 바로 듣는다
  await reset(page, base);
  await layoutDock(page, [I.lead, I.ui, I.tests], 'main-left');
  R = await rects(page);
  await frame(page, bboxOf(['lead', 'ui', 'tests'].map((n) => R[n])), 400);
  await headClick(page, 'lead', true);
  const openPresets = async () => { if (await page.isVisible('[data-role=selection] [data-action=layout-more]') && !(await page.isVisible('[data-role=selection] [data-role=presets] [data-preset]'))) { await page.click('[data-role=selection] [data-action=layout-more]'); await sleep(300); } };
  const outer = async () => { const r = await rects(page); return bboxOf(['lead', 'ui', 'tests'].map((n) => r[n])); };
  const treeDir = () => page.evaluate(() => { const d = [...window.__mt.getState().docks.values()][0]; return d && d.tree && d.tree.dir; });
  await openPresets();
  await page.click('[data-role=selection] [data-preset="main-top"]'); await sleep(1300);
  const s1 = await sel(page), bar1 = await page.isVisible('[data-role=selection]'), dir1 = await treeDir();
  step('배치 틀(main-top)을 누른 뒤에도 같은 덩어리가 골라져 있다', s1.includes('lead') && bar1 && dir1 === 'col', { sel: s1, bar: bar1, dir: dir1 });
  await openPresets();
  await page.click('[data-role=selection] [data-preset="row"]'); await sleep(1300);
  const dir2 = await treeDir(), s2 = await sel(page);
  step('이어서 다른 틀(row)이 바로 듣는다', dir2 === 'row' && s2.includes('lead'), { dir: dir2, sel: s2 });
  if ((await page.evaluate(() => document.querySelector('[data-role=size-buttons]').dataset.dir)) !== 'wide') { await page.click('[data-role=size-dir] [data-dir=wide]'); await sleep(1200); }
  await page.click('[data-role=selection] [data-size="wide-normal"]'); await sleep(1300);
  const o1 = await outer();
  await shot(page, 'p30-6-after-presets-size');
  step('이어서 크기 단추(가로 보통)가 바로 듣는다(바깥 1040 × 585), 고름은 그대로', o1.w === 1040 && o1.h === 585 && (await sel(page)).includes('lead'), { outer: o1 });

  // 7) 붙여서 막 만든 덩어리: 크기 단추가 첫 번째부터 듣는다(끌어 붙이기 → 그대로 크기)
  await reset(page, base);
  R = await rects(page);
  await frame(page, bboxOf([R.tests, R.review]), 300);
  const z = await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a);
  const hr = await page.locator('.mt-node[data-name="review"] .mt-node-head').boundingBox();
  const sx = hr.x + 150, sy = hr.y + hr.height / 2, dx = (R.tests.x + R.tests.w + 20 - R.review.x) * z;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(sx + (dx * i) / 12, sy); await sleep(30); }
  await sleep(200); await page.mouse.up(); await sleep(1500);
  const docksNow = await page.evaluate(() => [...window.__mt.getState().docks.values()].map((x) => x.members.length));
  const s3 = await sel(page), bar3 = await page.isVisible('[data-role=selection]');
  const pairOuter = async () => { const r = await rects(page); return bboxOf([r.tests, r.review]); };
  const o0 = await pairOuter();
  await shot(page, 'p30-7-1-new-dock');
  step('끌어 붙여 새 덩어리(둘), 끈 노드가 골라져 막대가 보인다', docksNow.length === 1 && docksNow[0] === 2 && bar3, { docks: docksNow, sel: s3, outer: o0 });
  await page.click('[data-role=selection] [data-size="wide-small"]'); await sleep(1300);
  const o2 = await pairOuter();
  step('새 덩어리에서 첫 크기 단추(가로 작게)가 듣는다(바깥 720 × 405)', o2.w === 720 && o2.h === 405, { outer: o2 });
  // 다시 새로 만들어 이번에는 토글부터(불이 없는 덩어리): 누른 쪽의 가까운 단계로
  await reset(page, base);
  await call(page, 'dock.attach', { session: I.review, to: I.tests, side: 'right' }); await sleep(1200);
  R = await rects(page);
  await frame(page, bboxOf([R.tests, R.review]), 300);
  await headClick(page, 'review');
  const lit0 = await page.evaluate(() => document.querySelector('[data-role=size-buttons]').dataset.lit || null);
  await page.click('[data-role=size-dir] [data-dir=tall]'); await sleep(1300);
  const o3 = await pairOuter();
  const lit1 = await page.evaluate(() => document.querySelector('[data-role=size-buttons]').dataset.lit || null);
  await shot(page, 'p30-7-2-toggle-first');
  step('불이 없는 새 덩어리에서 토글(세로)을 먼저 눌러도 크기가 바뀐다(세로 보통 600 × 920, 불)', !lit0 && o3.w === 600 && o3.h === 920 && lit1 === 'tall-normal', { lit0, lit1, outer: o3 });
  await page.click('[data-role=selection] [data-size="tall-small"]'); await sleep(1300);
  const o4 = await pairOuter();
  step('이어서 크기 단추(세로 작게)도 듣는다(480 × 740)', o4.w === 480 && o4.h === 740, { outer: o4 });

  await reset(page, base);
} catch (e) {
  log('오류', e.stack);
  step('시험 중 오류', false, { error: e.message });
} finally {
  const pass = result.steps.filter((s) => s.ok).length;
  log(`결과 ${pass}/${result.steps.length}`);
  writeJson('p30-dock.json', result);
  await closeApp(app);
}
