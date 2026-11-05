// P46 창 시험: 덩어리 안 연결 글(배율 0.3·0.6·1), 작업 관계도의 워크스페이스 무리(세 워크스페이스, 세션 10개 이상, 무리를 건너는 지시, 접기),
// 판 세션(claude haiku)이 atrium 스킬로 워커를 띄울 때 짓는 이름(두 번).
// 판: herdr 세션 atrium-dev-p46, 포트 47864, 이 워크트리의 backend/.dev(experiments/p46/tools/env.cjs). 시험 폴더는 새로 만든 폴더만 쓴다.
// 사용: node experiments/p46/tools/e2e.cjs p46-labels.mjs dock|mission|naming|all
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p46') throw new Error('MT_E2E_OUT=p46을 명령줄에서 준다(experiments/p46/tools/e2e.cjs)');
const MODE = process.argv[2] || 'all';
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p46', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P46_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
fs.mkdirSync(OUT, { recursive: true });
for (const d of [...Object.values(T.WS), ENV.ATRIUM_CLAUDE_SESSIONS]) fs.mkdirSync(d, { recursive: true });

const log = logger(`p46-${MODE}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const mt = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', '--json', ...a], { encoding: 'utf8', env, timeout: 240000 });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const shot = async (page, name) => { const f = path.join(OUT, `p46-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const sessions = (page) => page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => ({ id: s.sessionId, name: s.name, state: s.state, kind: s.kind, ws: s.workspaceKey, parent: s.parentSessionId || null })));
const sid = async (page, n) => ((await sessions(page)).find((s) => s.name === n) || {}).id || null;

// 판 차림: 워크스페이스 셋(app, api, docs)에 셸 13개. app의 넷(lead, ui, tests, review)은 2 × 2 덩어리
const SCENE = {
  app: ['lead', 'ui', 'tests', 'review', 'app-notes'],
  api: ['api-lead', 'api-tests', 'schema', 'perf'],
  docs: ['ko-copy', 'en-copy', 'doc-review', 'glossary'],
};
const DOCK = ['lead', 'ui', 'tests', 'review']; // grid 틀: 왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래
const LONG = 'test worker for login and signup flows';
const LINKS = [
  ['lead', 'ui', 'P31 worker'], ['lead', 'tests', LONG], ['ui', 'review', 'reviewer'], ['lead', 'review', 'P31 audit'], // 덩어리 안: 세로 경계 다리, 가로 경계 다리, 가로 경계 다리, 대각선 둘레 길
  ['lead', 'api-tests', 'api tests'], ['lead', 'ko-copy', 'ko copy'], ['api-lead', 'schema', 'schema worker'], ['api-lead', 'perf', 'perf probe'], ['api-lead', 'en-copy', 'en copy'], ['ko-copy', 'doc-review', 'reviewer'],
];
async function dropDeliveries(page) {
  for (const s of await sessions(page)) for (const d of await call(page, 'delivery.list', { session: s.name, limit: 50 }).catch(() => [])) if (d.status === 'queued' || d.status === 'pending') await call(page, 'delivery.cancel', { deliveryId: d.deliveryId }).catch(() => {});
}
async function scene(page) {
  for (const [ws, names] of Object.entries(SCENE)) for (const n of names) if (!(await sid(page, n))) await call(page, 'session.spawn', { cwd: T.WS[ws], kind: 'shell', name: n });
  await until(async () => { const ss = await sessions(page); return Object.values(SCENE).flat().every((n) => ss.some((s) => s.name === n)); }, 90000, 700);
  await sleep(2500);
  const ss = await sessions(page);
  const id = (n) => ss.find((s) => s.name === n).id;
  const have = await call(page, 'link.list');
  for (const [a, b, role] of LINKS) if (!have.some((l) => !l.removedAt && l.from === id(a) && l.to === id(b))) { await call(page, 'link.create', { from: id(a), to: id(b), role }); await dropDeliveries(page); }
  const docks = await call(page, 'dock.list');
  if (!docks.some((d) => DOCK.every((n) => d.members.includes(id(n))))) {
    for (const d of docks) await call(page, 'dock.remove', { dock: d.dockId });
    await call(page, 'dock.layout', { members: DOCK.map(id), preset: 'grid' });
  }
  await sleep(1500);
  return id;
}

// 덩어리 안 연결 글(창 좌표)
const dockItems = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-role=dock-links]');
  if (!root) return null;
  const st = window.__mt.getState();
  const nm = (id) => (st.sessions.get(id) || {}).name;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  return [...root.querySelectorAll('button[data-link]')].map((e) => {
    const lab = e.querySelector('[data-role=dock-label]');
    return { kind: e.dataset.kind, level: e.dataset.level, from: nm(e.dataset.from), to: nm(e.dataset.to), vert: e.classList.contains('vert'), axis: [...e.classList].find((c) => c.startsWith('axis-')), box: R(e),
      text: lab ? lab.textContent : '', pill: !!(lab && lab.querySelector('.mt-pill')), clipped: lab ? lab.scrollWidth > lab.clientWidth + 1 : false };
  });
});
const outerScreen = (page, names) => page.evaluate((ns) => {
  const rs = ns.map((n) => document.querySelector(`.mt-node[data-name="${n}"]`).getBoundingClientRect());
  const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
  return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y };
}, names);
async function zoomOn(page, names, z) {
  await page.evaluate(([ns, zz]) => {
    const s = window.__mt.getState();
    const rs = ns.map((n) => s.nodes.get([...s.sessions.values()].find((x) => x.name === n).sessionId));
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y)), x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    const el = document.querySelector('.mt-canvas');
    s.setViewport({ x: el.clientWidth / 2 - ((x0 + x1) / 2) * zz, y: el.clientHeight / 2 - ((y0 + y1) / 2) * zz, zoom: zz });
  }, [names, z]);
  await page.mouse.move(3, 300);
  await sleep(1200);
}

async function testDock(page) {
  await scene(page);
  const rec = {};
  for (const z of [0.3, 0.6, 1]) {
    await zoomOn(page, DOCK, z);
    const items = await dockItems(page);
    rec[z] = items;
    await shot(page, `dock-z${z}`);
    const O = await outerScreen(page, DOCK);
    const want = z < 0.4 ? 'mini' : z < 0.8 ? 'short' : 'full';
    const bridges = items.filter((i) => i.kind === 'bridge');
    const around = await page.$$eval('[data-role=dock-links] g[data-kind=around]', (es) => es.length);
    step(`배율 ${z}: 덩어리 안 연결 넷(다리 셋 + 둘레 길 하나)`, bridges.length === 3 && around === 1, items.map((i) => `${i.kind}:${i.from}>${i.to}:${i.level}`));
    if (want === 'mini') step(`배율 ${z}: 화살표 블록만(펼친 글 없음)`, items.every((i) => i.level === 'mini' && !i.text), items.map((i) => i.level));
    else {
      step(`배율 ${z}: 다리는 ${want}`, bridges.every((i) => i.level === want), bridges.map((i) => i.level));
      const p31 = items.find((i) => i.from === 'lead' && i.to === 'ui');
      step(`배율 ${z}: 사용자가 붙인 역할 이름이 보인다(P31 worker)`, p31 && p31.text.includes('P31 worker'), p31 && p31.text);
      step(`배율 ${z}: 방향 글(@lead → @ui)과 상태 알약은 ${want === 'full' ? '있다' : '없다'}`, p31 && p31.text.includes('@lead → @ui') === (want === 'full') && p31.pill === (want === 'full'), p31 && p31.text);
      step(`배율 ${z}: 세로 경계의 글은 세워서 경계 폭만(터미널 글을 덮지 않음)`, p31 && p31.vert && p31.box.w <= 28, p31 && p31.box);
      const hb = bridges.filter((i) => i.axis === 'axis-h');
      step(`배율 ${z}: 가로 경계의 글은 눕혀서 경계 폭만`, hb.length === 2 && hb.every((i) => !i.vert && i.box.h <= 28), hb.map((i) => i.box));
      const route = items.find((i) => i.kind === 'route-label');
      const outside = route && (route.box.x >= O.x + O.w - 2 || route.box.x + route.box.w <= O.x + 2 || route.box.y >= O.y + O.h - 2 || route.box.y + route.box.h <= O.y + 2);
      step(`배율 ${z}: 둘레 길의 글은 덩어리 바깥 선 위`, route && outside && route.text.includes('P31 audit'), { route: route && route.box, O });
    }
    if (z === 1) {
      const long = items.find((i) => i.from === 'lead' && i.to === 'tests');
      step('배율 1: 긴 역할은 줄임표로 줄인다', long && long.clipped, long && { text: long.text, box: long.box });
      const el = page.locator(`[data-role=dock-links] button[data-kind=bridge][data-from="${await sid(page, 'lead')}"][data-to="${await sid(page, 'tests')}"]`);
      await el.hover();
      await sleep(500);
      const after = (await dockItems(page)).find((i) => i.from === 'lead' && i.to === 'tests');
      step('배율 1: 마우스를 올리면 다 보인다', after && !after.clipped && after.box.w > long.box.w, after && after.box);
      await shot(page, 'dock-z1-hover');
      await page.mouse.move(3, 300);
    }
  }
  fs.writeFileSync(path.join(OUT, 'p46-dock.json'), JSON.stringify(rec, null, 2));
}

async function openMap(page) {
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.mouse.click(5, 400);
  await page.keyboard.press('m');
  await sleep(500);
  if (!(await page.$('[data-role="mission"]'))) await page.click('[data-action="mission-rail"]');
  await page.waitForSelector('[data-role="mission"] [data-role="mm-group"]', { timeout: 20000 });
  await sleep(1200);
}
const mapState = (page) => page.evaluate(() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const m = document.querySelector('[data-role="mission"]');
  const groups = [...m.querySelectorAll('[data-role="mm-group"]')].map((e) => ({ key: e.dataset.key, name: e.querySelector('[data-role="mm-group-name"]').textContent, head: e.querySelector('[data-action="mm-group-toggle"]').textContent, collapsed: !!e.dataset.collapsed, ...R(e) }));
  const boxes = [...m.querySelectorAll('[data-role="mm-node"]')].map((e) => ({ name: e.dataset.name || e.dataset.kind, ...R(e) }));
  const labels = [...m.querySelectorAll('[data-role="mm-label"]')].map((e, i) => ({ id: `${i}:${e.textContent}`, ...R(e) }));
  const edges = [...m.querySelectorAll('[data-role="mm-edge"]')].map((e) => ({ from: e.dataset.from, to: e.dataset.to, cross: !!e.dataset.cross }));
  const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
  const pairs = (xs, ys, same) => { const out = []; xs.forEach((a, i) => ys.forEach((b, j) => { if ((!same || j > i) && hit(a, b)) out.push(`${a.name || a.key || a.id} × ${b.name || b.key || b.id}`); })); return out; };
  const outside = boxes.filter((b) => b.name !== 'human').filter((b) => !groups.some((g) => b.l >= g.l && b.r <= g.r && b.t >= g.t && b.b <= g.b)).map((b) => b.name);
  return { groups, boxes: boxes.length, edges, boxBox: pairs(boxes, boxes, true), groupGroup: pairs(groups, groups, true), labelBox: pairs(labels, boxes, false), labelLabel: pairs(labels, labels, true), outside };
});

async function testMission(page) {
  await scene(page);
  await openMap(page);
  const s = await mapState(page);
  await shot(page, 'mission');
  const total = Object.values(SCENE).flat().length;
  step(`작업 관계도: 세션 ${total}개가 워크스페이스 무리 셋에`, s.groups.length >= 3 && ['app', 'api', 'docs'].every((n) => s.groups.some((g) => g.name === n)) && s.boxes >= total, s.groups.map((g) => `${g.name}: ${g.head}`));
  step('작업 관계도: 상자는 모두 자기 무리 안', s.outside.length === 0, s.outside);
  step('작업 관계도: 상자끼리, 무리끼리, 이름표와 상자, 이름표끼리 겹치지 않는다', !s.boxBox.length && !s.groupGroup.length && !s.labelBox.length && !s.labelLabel.length, { boxBox: s.boxBox, groupGroup: s.groupGroup, labelBox: s.labelBox, labelLabel: s.labelLabel });
  const cross = s.edges.filter((e) => e.cross);
  step('작업 관계도: 무리를 건너는 지시 선(lead → api-tests, lead → ko-copy, api-lead → en-copy)', cross.length === 3, cross);
  step('작업 관계도: 무리 이름표에 세션 수', s.groups.filter((g) => ['app', 'api', 'docs'].includes(g.name)).every((g) => /\d/.test(g.head)), s.groups.map((g) => g.head));
  // 접기
  const docs = s.groups.find((g) => g.name === 'docs');
  await page.click(`[data-role="mm-group"][data-key="${docs.key.replace(/\\/g, '\\\\')}"] [data-action="mm-group-toggle"]`);
  await sleep(700);
  const c = await mapState(page);
  await shot(page, 'mission-docs-collapsed');
  const cd = c.groups.find((g) => g.name === 'docs');
  step('작업 관계도: docs를 접으면 머리줄만, 그쪽으로 가는 선은 머리줄로 모인다', cd.collapsed && c.boxes === s.boxes - SCENE.docs.length && c.edges.filter((e) => e.to === `g:${docs.key}`).length === 2, { boxes: c.boxes, into: c.edges.filter((e) => e.to.startsWith('g:')) });
  await page.click(`[data-role="mm-group"][data-key="${docs.key.replace(/\\/g, '\\\\')}"] [data-action="mm-group-toggle"]`);
  await sleep(700);
  step('작업 관계도: 다시 펼친다(지도는 열린 채)', (await mapState(page)).boxes === s.boxes && !!(await page.$('[data-role="mission"]')));
  // 거르기와 누르면 그 노드로 가기는 그대로
  await page.click('[data-role="mission"] [data-filter="working"]');
  await sleep(500);
  await page.click('[data-role="mission"] [data-filter="all"]');
  await sleep(500);
  await page.click('[data-role="mission"] [data-role="mm-node"][data-name="schema"]');
  await sleep(1200);
  step('작업 관계도: 상자를 누르면 닫고 그 노드로', !(await page.$('[data-role="mission"]')) && (await page.evaluate(() => { const s = window.__mt.getState(); return (s.sessions.get(s.focusId) || {}).name; })) === 'schema');
}

const RUN = Date.now().toString(36).slice(-4);
async function testNaming(page) {
  // 판 세션이 폴더를 먼저 보려다(ls 등) 권한 질문에서 멈추면 그 판은 이름을 짓지 못한다. 그런 판은 기록하고 끈 뒤, 이름을 지은 판이 둘이 될 때까지(최대 넷) 다시 한다
  const out = [];
  let got = 0;
  for (let round = 1; round <= 4 && got < 2; round++) {
    const boss = `boss${round}-${RUN}`; // 끈 판 세션 이름과 겹치지 않게
    if (!(await sid(page, boss))) mt('spawn', T.WS.naming, '--name', boss, '--model', 'haiku');
    await until(async () => ((await sessions(page)).find((s) => s.name === boss) || {}).state === 'ready', 180000, 1500).catch(() => {});
    const b = (await sessions(page)).find((s) => s.name === boss);
    log(`${boss} 상태 ${b && b.state}`);
    if (!b || b.state !== 'ready') { step(`이름 ${round}: ${boss}가 준비됨`, false, b && b.state); continue; }
    mt('send', `@${boss}`, '테스트를 돌리는 워커와 문서를 고치는 워커를 띄워');
    let kids = [];
    let stuck = false;
    await until(async () => { const ss = await sessions(page); kids = ss.filter((s) => s.parent === b.id); stuck = !kids.length && (ss.find((s) => s.id === b.id) || {}).state === 'waiting'; return kids.length >= 2 || stuck; }, 420000, 3000).catch(() => {});
    if (stuck) await sleep(20000); // 권한 질문이 잠깐 뜬 것일 수도 있다
    stuck = stuck && !(await sessions(page)).some((s) => s.parent === b.id);
    await sleep(3000);
    kids = (await sessions(page)).filter((s) => s.parent === b.id);
    const names = kids.map((k) => k.name);
    out.push({ round, boss, names, stuck });
    await shot(page, `naming-${round}`);
    if (stuck) log(`이름 ${round}: ${boss}가 워커를 띄우기 전에 권한 질문에서 멈췄다(이름과 상관없음, 다시 한다)`);
    else { got++; step(`이름 ${round}: 워커 둘을 번호가 아닌 일에 맞는 이름으로`, names.length >= 2 && names.every((n) => !/^(w|ds|worker|agent)?-?\d+$/.test(n) && !/-w\d+$/.test(n)), names); }
    // 이번 판 세션과 워커는 끈다(다음 판 세션이 같은 이름을 쓸 수 있게)
    for (const n of [...names, boss]) { try { mt('kill', n, '--yes'); } catch (e) { log(`kill ${n}: ${e.message.slice(0, 120)}`); } }
    await sleep(3000);
  }
  step('이름: 이름을 지은 판 둘', got >= 2, out);
  fs.writeFileSync(path.join(OUT, 'p46-naming.json'), JSON.stringify(out, null, 2));
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
  if (MODE === 'dock' || MODE === 'all') await testDock(page);
  if (MODE === 'mission' || MODE === 'all') await testMission(page);
  if (MODE === 'naming' || MODE === 'all') await testNaming(page);
} catch (e) {
  step('예외', false, e.stack);
} finally {
  fs.writeFileSync(path.join(OUT, `p46-${MODE}.json`), JSON.stringify(results, null, 2));
  const fails = results.filter((r) => !r.ok);
  log(`결과 ${results.length - fails.length}/${results.length}`);
  await closeApp(app).catch(() => {});
  process.exit(fails.length ? 1 : 0);
}
