// P145 창 시험: 미션 맵에서 "나" 동그라미와 사람 선을 걷고 배치를 촘촘히 했다. 앞뒤(before/after) 그림과 한 화면에 보이는 카드 수를 견준다. 한 번에 한 창만 돌린다(메모리).
// 판: 따로 띄운 개발용 판(atrium-dev-p145, 47915, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9395.
//   워크스페이스 다섯(mtask-p145-a…e)에 셸 세션 하나씩. 폴더 alpha(a, b, c)·beta(d, e). 폴더 밖 워크스페이스는 흉내 판에서 어느 폴더에도 없는 키로 만든다.
//   실제 세션 그대로 한 번 찍고, 그다음 페이지 안에서 mission.graph 답을 흉내 판으로 바꾼다:
//   mix = 폴더 둘·폴더 밖, 팀·혼자·쉬는 세션을 섞은 판(세션 22개), big = 세션 30개 안팎의 큰 판(팀 넷, 혼자 많은 워크스페이스 둘).
//   움직임 줄이기(reduce)와 no-preference 둘 다 찍는다.
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p145-mission.mjs <setup|shot|stop> [before|after]
// 결과는 주 체크아웃의 experiments/p145/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MAIN = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO; // 워크트리면 주 체크아웃
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(MAIN, 'experiments', 'p145');
const CONVOS = path.join(OUT, 'convos');
const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const DIRS = LETTERS.map((k) => `C:\\Workspace\\mtask-p145-${k}`);
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
const ENV = {
  ATRIUM_TERMINAL_SESSION: 'atrium-dev-p145', ATRIUM_HERDR_SESSION: 'atrium-dev-p145', ATRIUM_PORT: '47915',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p145-none-',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p145-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const P = (k) => `p145-${k}`;

async function setupBoard() {
  for (const d of DIRS) fs.mkdirSync(d, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  const have = new Set(sessions().map((s) => s.name));
  LETTERS.forEach((k, i) => { if (!have.has(P(k))) log(atrium('--json', 'spawn', DIRS[i], '--kind', 'shell', '--name', P(k)).slice(0, 160)); });
  await sleep(3000);
  const gs = call('group.list');
  const list = gs.groups || gs;
  const has = (n) => Array.isArray(list) && list.some((g) => g.name === n);
  if (!has('alpha')) call('group.create', { name: 'alpha', workspaces: [DIRS[0], DIRS[1], DIRS[2]] });
  if (!has('beta')) call('group.create', { name: 'beta', workspaces: [DIRS[3], DIRS[4]] });
  log('groups', JSON.stringify(call('group.list')).slice(0, 600));
}

// ---- 흉내 판(페이지 안에서 mission.graph 답을 바꾼다). keys: 글자 → 워크스페이스 키 ----
const HOOK = ([keys, which]) => {
  const api = window.__mt.api;
  if (!api.__p145orig) api.__p145orig = api.call.bind(api);
  const now = Date.now();
  let i = 0;
  const S = (name, w, o = {}) => ({ id: `s:${name}`, kind: 'session', sessionId: `fk-${name}`, name, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: keys[w], parentId: null, role: null, order: null, createdAt: 1e12 + ++i, loops: 0, model: 'claude-opus-5-5', effort: 'high', activeAt: now - i * 5e5, turnAt: null, gitBranch: null, ...o });
  const W = { state: 'working', category: 'working' };
  const kid = (name, w, parent, o = {}) => S(name, w, { parentId: `s:${parent}`, role: 'worker', ...o });
  let fake, edges0;
  if (which === 'mix') {
    fake = [
      S('conductor', 'a', { ...W, model: 'claude-fable-5-2', turnAt: now - 5e6, lastPrompt: 'Merge the workers when they report' }),
      kid('ui', 'a', 'conductor', { ...W, turnAt: now - 2e6, gitBranch: 'worktree-ui', lastPrompt: 'Mission map spacing' }),
      kid('reviewer', 'a', 'conductor', { role: 'reviewer', state: 'waiting', category: 'needs_you', ask: 'Run the tests?' }),
      kid('ui-tests', 'a', 'ui', { ...W, turnAt: now - 6e5, lastPrompt: 'npm test' }), kid('ui-docs', 'a', 'ui'),
      kid('term', 'd', 'conductor', { ...W, role: 'terminal input', turnAt: now - 9e5, lastPrompt: 'Scroll residue' }), // 다른 폴더(beta)의 하위 세션
      S('a-notes', 'a'), S('a-try', 'a', { ...W, turnAt: now - 3e5, lastPrompt: 'Try the new flag' }), S('a-old', 'a', { state: 'sleeping' }),
      S('blog', 'b', { model: 'claude-sonnet-5-5', effort: null }), S('blog-copy', 'b', { state: 'sleeping' }),
      S('notes', 'c', { state: 'sleeping' }), S('notes-2', 'c'),
      S('api-lead', 'e'), kid('api-w1', 'e', 'api-lead', { ...W, turnAt: now - 4e5, lastPrompt: 'npm test' }), kid('api-w2', 'e', 'api-lead'),
      S('site', 'f', { ...W, turnAt: now - 2e5, lastPrompt: 'Deploy preview' }), kid('site-docs', 'f', 'site', { role: 'docs' }),
      S('scratch', 'g', { agentKind: 'shell', model: null }), S('dotfiles', 'g', { state: 'sleeping' }), S('sandbox', 'g'), S('tmp', 'g', { state: 'exited', category: 'exited' })];
    edges0 = [{ from: 's:conductor', to: 's:ui', kind: 'spawn' }, { from: 's:conductor', to: 's:reviewer', kind: 'role', label: 'reviewer' }, { from: 's:conductor', to: 's:term', kind: 'spawn' },
      { from: 's:ui', to: 's:ui-tests', kind: 'spawn' }, { from: 's:ui', to: 's:ui-docs', kind: 'spawn' },
      { from: 'human', to: 's:conductor', kind: 'bar', count: 4, label: 'Ship the mission map' }, { from: 'human', to: 's:a-try', kind: 'loop', count: 2 },
      { from: 's:api-lead', to: 's:api-w1', kind: 'spawn' }, { from: 's:api-lead', to: 's:api-w2', kind: 'spawn' }, { from: 's:site', to: 's:site-docs', kind: 'spawn' },
      { from: 's:api-w1', to: 's:site-docs', kind: 'prompt', label: 'update the api docs', count: 2, lastAt: now - 6e5 }];
  } else {
    // big: 팀 넷(리드 + 하위 2~5, 손자 하나), 팀 워크스페이스의 혼자인 세션, 혼자 많은 워크스페이스 둘(폴더 밖), 세션 31개
    fake = [
      S('lead', 'a', { ...W, model: 'claude-fable-5-2', turnAt: now - 6e6, lastPrompt: 'Run the release' }),
      ...['w1', 'w2', 'w3', 'w4', 'w5'].map((n, j) => kid(n, 'a', 'lead', j % 2 ? { ...W, turnAt: now - j * 1e5, lastPrompt: `Task ${n}` } : {})), kid('w1-sub', 'a', 'w1', { ...W, lastPrompt: 'sub task' }),
      S('a-s1', 'a'), S('a-s2', 'a', { state: 'sleeping' }), S('a-s3', 'a', { ...W, lastPrompt: 'Watch the build' }),
      S('web', 'b', W), kid('web-1', 'b', 'web'), kid('web-2', 'b', 'web', { state: 'waiting', category: 'needs_you', ask: 'Allow npm install?' }),
      S('bot', 'd'), kid('bot-1', 'd', 'bot', W), kid('bot-2', 'd', 'bot'), kid('bot-3', 'd', 'bot', { state: 'done', category: 'done' }),
      S('ops', 'e', W), kid('ops-1', 'e', 'ops'),
      ...Array.from({ length: 8 }, (_, j) => S(`lab-${j}`, 'f', j === 2 ? { ...W, lastPrompt: 'experiment' } : j % 3 ? {} : { state: 'sleeping' })),
      ...Array.from({ length: 3 }, (_, j) => S(`misc-${j}`, 'g'))];
    edges0 = [];
    for (const n of fake) if (n.parentId) edges0.push({ from: n.parentId, to: n.id, kind: 'spawn' });
    edges0.push({ from: 'human', to: 's:lead', kind: 'bar', count: 5 }, { from: 'human', to: 's:web', kind: 'bar' }, { from: 's:w2', to: 's:bot-1', kind: 'prompt', label: 'check the bot', count: 1, lastAt: now - 1e5 });
  }
  api.call = async (m, p) => {
    if (m !== 'mission.graph') return api.__p145orig(m, p);
    const nodes = [{ id: 'human', kind: 'human', name: 'you' }, ...fake];
    return { nodes, edges: edges0, counts: { all: nodes.length - 1 }, at: now };
  };
};
const UNHOOK = () => { const api = window.__mt.api; if (api.__p145orig) api.call = api.__p145orig; };

// ---- 지도 읽기: 한 화면(지도 칸)에 다 보이는 카드 수, 지도 크기, 나 동그라미 ----
const PROBE = () => {
  const m = document.querySelector('[data-role=mission]');
  if (!m) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const body = m.querySelector('.mt-mission-body'), canvas = m.querySelector('.mt-mission-canvas');
  const vb = R(body);
  const nodes = [...m.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((n) => ({ name: n.dataset.name, shape: n.dataset.shape, title: n.title || '', ...R(n) }));
  const seen = nodes.filter((n) => n.x >= vb.x - 1 && n.y >= vb.y - 1 && n.x + n.w <= vb.x + vb.w + 1 && n.y + n.h <= vb.y + vb.h + 1);
  const folders = [...m.querySelectorAll('[data-role=mm-folder]')].map((f) => ({ id: f.dataset.id, ...R(f) }));
  const plates = [...m.querySelectorAll('[data-role=mm-plate]')].map((p) => ({ key: p.dataset.key, inf: p.classList.contains('inf'), ...R(p) }));
  return {
    body: vb, canvas: canvas ? { w: canvas.offsetWidth, h: canvas.offsetHeight } : null, nodes, folders, plates, seen: seen.length, total: nodes.length,
    you: m.querySelectorAll('.mt-mm-you, [data-role=mm-node][data-kind=human]').length, humanEdges: m.querySelectorAll('[data-role=mm-edge][data-rel=human]').length,
    edges: m.querySelectorAll('[data-role=mm-edge]').length, light: m.querySelectorAll('[data-role=mm-light]').length,
  };
};
const apart = (a, b, g = 0) => a.x + a.w + g <= b.x + 1 || b.x + b.w + g <= a.x + 1 || a.y + a.h + g <= b.y + 1 || b.y + b.h + g <= a.y + 1;
const inside = (a, o) => a.x >= o.x - 1 && a.y >= o.y - 1 && a.x + a.w <= o.x + o.w + 1 && a.y + a.h <= o.y + o.h + 1;

async function openMission(pg) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  if (await pg.$('[data-role="mission"]')) { await pg.keyboard.press('Escape'); await sleep(400); }
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] [data-role="mm-node"], [data-role="mission"] [data-role="mm-group"]', { timeout: 20000 });
  await sleep(1500);
}
const shotTo = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}-${TAG}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const AFTER = () => TAG === 'after';
const summary = {};

function judge(tag, p) {
  summary[tag] = { seen: p.seen, total: p.total, canvas: p.canvas, body: { w: p.body.w, h: p.body.h } };
  log(`[${tag}] 한 화면 카드 ${p.seen}/${p.total}, 지도 ${p.canvas && `${p.canvas.w}x${p.canvas.h}`}, 칸 ${p.body.w}x${p.body.h}, 나 ${p.you}, 사람 선 ${p.humanEdges}, 선 ${p.edges}, 빛 ${p.light}`);
  if (!AFTER()) return;
  check(`[${tag}] 나 동그라미와 사람 선이 없다`, p.you === 0 && p.humanEdges === 0, { you: p.you, human: p.humanEdges });
  let bad = null; for (let i = 0; i < p.nodes.length; i++) for (let j = i + 1; j < p.nodes.length; j++) if (!apart(p.nodes[i], p.nodes[j])) bad = `${p.nodes[i].name}×${p.nodes[j].name}`;
  check(`[${tag}] 카드끼리 겹치지 않는다`, !bad, bad || '');
  const outer = [...p.folders.map((f) => ({ id: f.id, ...f })), ...p.plates.filter((x) => !x.inf).map((x) => ({ id: x.key, ...x }))];
  bad = null; for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++) if (!apart(outer[i], outer[j], 8)) bad = `${outer[i].id}×${outer[j].id}`;
  check(`[${tag}] 폴더 상자·폴더 밖 판이 겹치지 않고 떨어진다`, !bad, bad || '');
  const left = Math.min(...p.nodes.map((n) => n.x));
  check(`[${tag}] 맨 왼쪽 카드가 지도 칸 왼쪽 끝 가까이(나 자리 없음)`, left - p.body.x <= 40, { left, body: p.body.x });
  // 한 단위(폴더 상자·판)가 칸보다 넓으면(좁은 창의 3열 팀) 그 단위 폭 + 둘레까지만
  const widest = Math.max(0, ...outer.map((o) => o.w));
  check(`[${tag}] 지도 폭이 칸 안(가로 스크롤 없음, 칸보다 넓은 단위가 있으면 그 폭까지)`, p.canvas && p.canvas.w <= Math.max(p.body.w, widest + 40) + 2, { canvas: p.canvas, body: p.body, widest });
}

async function shots() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9395'] });
  try {
    await page.setViewportSize({ width: 1600, height: 900 }).catch(() => {});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    const st = await page.evaluate(() => { const s = window.__mt.getState(); return { ws: s.workspaces.map((w) => w.key) }; });
    // 1) 실제 세션 그대로
    await openMission(page); await page.mouse.move(1250, 880); await sleep(300);
    await shotTo(page, 'real');
    judge('real', await page.evaluate(PROBE));
    const keyOf = (k) => st.ws.find((w) => w.toLowerCase().includes(`mtask-p145-${k}`)) || `x-${k}`;
    const keys = Object.fromEntries([...LETTERS, 'f', 'g'].map((k) => [k, k === 'f' || k === 'g' ? `c:/elsewhere/p145-${k}` : keyOf(k)]));
    for (const which of ['mix', 'big']) {
      await page.setViewportSize({ width: 1600, height: 900 }).catch(() => {});
      await page.evaluate(UNHOOK);
      await page.evaluate(HOOK, [keys, which]);
      await openMission(page); await page.mouse.move(1250, 880); await sleep(300);
      for (const motion of ['reduce', 'no-preference']) { await page.emulateMedia({ reducedMotion: motion }); await sleep(600); await shotTo(page, `${which}-${motion}`); }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const p = await page.evaluate(PROBE);
      judge(which, p);
      if (AFTER() && which === 'mix') {
        const fa = p.folders.find((f) => f.id && p.nodes.some((n) => n.name === 'conductor' && inside(n, f)));
        const term = p.nodes.find((x) => x.name === 'term');
        check('[mix] 폴더를 넘는 하위 세션(term, beta)은 부모 팀 안(부모의 폴더 상자)', fa && term && inside(term, fa), term);
        const cond = p.nodes.find((x) => x.name === 'conductor');
        check('[mix] 사람이 보낸 지시는 카드 풍선 도움말 한 줄', cond && /From you|사용자/.test(cond.title) && /Ship the mission map/.test(cond.title), cond && cond.title.split('\n').slice(0, 3));
        const kids = ['ui', 'reviewer', 'term'].map((n) => p.nodes.find((x) => x.name === n));
        check('[mix] 팀 흐름: 하위는 부모 오른쪽', cond && kids.every((k) => k && k.x > cond.x + cond.w), kids.map((k) => k && k.x));
        // 가리키면 또렷해지기: ui를 가리키면 그 팀 밖 카드(blog)는 물러난다
        const ui = p.nodes.find((x) => x.name === 'ui');
        await page.mouse.move(ui.x + ui.w / 2, ui.y + ui.h / 2); await sleep(400);
        const rec = await page.evaluate(() => ({ blog: document.querySelector('[data-role=mm-node][data-name=blog]').classList.contains('recede'), cond: document.querySelector('[data-role=mm-node][data-name=conductor]').classList.contains('recede') }));
        check('[mix] 가리키면 그 팀만 또렷하다', rec.blog && !rec.cond, rec);
        await shotTo(page, 'mix-hover');
        await page.mouse.move(1250, 880); await sleep(300);
        // 거르기: 응답 필요만
        await page.click('[data-filter=needs_you]'); await sleep(400);
        const dim = await page.evaluate(() => ({ rev: document.querySelector('[data-role=mm-node][data-name=reviewer]').classList.contains('fdim'), blog: document.querySelector('[data-role=mm-node][data-name=blog]').classList.contains('fdim') }));
        check('[mix] 거르기는 흐리게만', !dim.rev && dim.blog, dim);
        await page.click('[data-filter=all]'); await sleep(300);
        check('[mix] 작업 중 빛(일하는 카드)', p.light >= 3, p.light);
      }
      // 좁은 창
      await page.setViewportSize({ width: 1100, height: 800 }).catch(() => {});
      await sleep(1200);
      await shotTo(page, `${which}-narrow`);
      judge(`${which}-narrow`, await page.evaluate(PROBE));
    }
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
  fs.writeFileSync(path.join(OUT, `p145-summary-${TAG}.json`), JSON.stringify(summary, null, 2));
}

async function stopBoard() {
  for (const s of sessions().filter((x) => /^p145-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
  await sleep(2000);
  try { log(atrium('terminal', 'stop', '--yes').slice(0, 200)); } catch (e) { log(`terminal stop ${e.message.slice(0, 120)}`); }
  try { log(atrium('backend', 'stop').slice(0, 200)); } catch (e) { log(`backend stop ${e.message.slice(0, 120)}`); }
}

try {
  if (WHAT === 'setup') await setupBoard();
  else if (WHAT === 'shot') await shots();
  else if (WHAT === 'stop') await stopBoard();
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `p145-${WHAT}-${TAG}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
