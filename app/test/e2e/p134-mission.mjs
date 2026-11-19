// P134 창 시험: 미션 맵의 폴더 상자. 한 번에 한 창만 돌린다(메모리).
// 판: 따로 띄운 개발용 판(atrium-dev-p134, 47903, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9383.
//   워크스페이스 일곱(mtask-p134-a…g)에 셸을 하나씩 띄우고, 폴더 alpha(a, b, c)·beta(d, e)를 만든다. f, g는 폴더 밖.
//   실제 세션 그대로 한 번 찍고, 그다음 페이지 안에서 mission.graph 답을 흉내 판으로 바꿔 팀(폴더를 넘는 하위 세션 포함)·혼자인 세션·쉬는·잠든·끝난 세션을 섞는다.
//   큰 판: 흉내 판에 세션 25개를 더한다. 움직임 줄이기(reduce)와 no-preference 둘 다 찍는다.
// 실행(실제 판의 변수를 지운 셸로): sh backend/.dev/clean-env.sh node app/test/e2e/p134-mission.mjs <setup|shot|stop> [before|after]
// 결과는 주 체크아웃의 experiments/p134/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MAIN = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO; // 워크트리면 주 체크아웃
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(MAIN, 'experiments', 'p134');
const CONVOS = path.join(OUT, 'convos');
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const DIRS = LETTERS.map((k) => `C:\\Workspace\\mtask-p134-${k}`);
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
const ENV = {
  ATRIUM_TERMINAL_SESSION: 'atrium-dev-p134', ATRIUM_HERDR_SESSION: 'atrium-dev-p134', ATRIUM_PORT: '47903',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p134-none-',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p134-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const P = (k) => `p134-${k}`;

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
const HOOK = ([keys, n]) => {
  const api = window.__mt.api;
  if (!api.__p134orig) api.__p134orig = api.call.bind(api);
  const now = Date.now();
  let i = 0;
  const S = (name, w, o = {}) => ({ id: `s:${name}`, kind: 'session', sessionId: `fk-${name}`, name, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: keys[w], parentId: null, role: null, order: null, createdAt: 1e12 + ++i, loops: 0, model: 'claude-opus-5-5', effort: 'high', activeAt: now - i * 5e5, turnAt: null, gitBranch: null, ...o });
  const W = { state: 'working', category: 'working' };
  const nodes = [{ id: 'human', kind: 'human', name: 'you' },
    S('conductor', 'a', { ...W, model: 'claude-fable-5-2', turnAt: now - 5e6, lastPrompt: 'Merge P134 when the worker reports' }),
    S('p134', 'a', { ...W, parentId: 's:conductor', role: 'mission map', turnAt: now - 2e6, gitBranch: 'worktree-p134', lastPrompt: 'Folder boxes' }),
    S('p132', 'a', { parentId: 's:conductor', role: 'sidebar', state: 'exited', category: 'exited' }),
    S('reviewer', 'a', { parentId: 's:conductor', role: 'reviewer', state: 'waiting', category: 'needs_you', ask: 'Run the tests?' }),
    S('p133', 'd', { ...W, parentId: 's:conductor', role: 'codex import', turnAt: now - 9e5, lastPrompt: 'Import Codex chats' }), // 다른 폴더(beta)의 하위 세션
    S('blog', 'b', { model: 'claude-sonnet-5-5', effort: null }), S('blog-copy', 'b', { state: 'sleeping' }),
    S('notes', 'c', { state: 'sleeping' }),
    S('api-lead', 'd', { state: 'ready' }), S('api-w1', 'd', { ...W, parentId: 's:api-lead', role: 'worker', turnAt: now - 4e5, lastPrompt: 'npm test' }), S('api-w2', 'd', { parentId: 's:api-lead', role: 'tests' }),
    S('infra', 'e', { agentKind: 'shell', model: null }), S('infra-old', 'e', { state: 'exited', category: 'exited' }),
    S('site', 'f', { ...W, turnAt: now - 2e5, lastPrompt: 'Deploy preview' }), S('site-docs', 'f', { parentId: 's:site', role: 'docs' }),
    S('scratch', 'g', { agentKind: 'shell', model: null }), S('paper', 'g', { agentKind: 'codex', model: 'gpt-6' }), S('dotfiles', 'g', { state: 'sleeping' })];
  const edges = [{ from: 's:conductor', to: 's:p134', kind: 'spawn' }, { from: 's:conductor', to: 's:p132', kind: 'spawn' }, { from: 's:conductor', to: 's:reviewer', kind: 'role', label: 'reviewer' }, { from: 's:conductor', to: 's:p133', kind: 'spawn' },
    { from: 'human', to: 's:conductor', kind: 'bar', count: 4 }, { from: 's:p134', to: 's:conductor', kind: 'prompt', label: 'p134 done', count: 1, lastAt: now - 3e5 },
    { from: 's:api-lead', to: 's:api-w1', kind: 'spawn' }, { from: 's:api-lead', to: 's:api-w2', kind: 'spawn' }, { from: 's:site', to: 's:site-docs', kind: 'spawn' },
    { from: 's:api-w2', to: 's:site-docs', kind: 'prompt', label: 'update the api docs', count: 2, lastAt: now - 6e5 }]; // 폴더 beta → 폴더 밖 f(상자를 넘는 선)
  const extra = [];
  const st = ['working', 'ready', 'sleeping', 'waiting', 'ready', 'exited'];
  const cat = (s) => (s === 'waiting' ? 'needs_you' : s === 'working' ? 'working' : s === 'exited' ? 'exited' : 'idle');
  for (let k = 0; k < n; k++) {
    const w = 'abcdefg'[k % 7], state = st[k % st.length];
    const parent = k >= 1 && k <= 6 ? 's:big-00' : null;
    extra.push(S(`big-${String(k).padStart(2, '0')}`, k <= 6 ? 'b' : w, { state, category: cat(state), parentId: parent, role: parent ? 'worker' : null, agentKind: k % 4 === 3 ? 'shell' : 'claude' }));
    if (parent) edges.push({ from: parent, to: `s:big-${String(k).padStart(2, '0')}`, kind: 'spawn' });
  }
  const g = { nodes: [...nodes, ...extra], edges, counts: { all: nodes.length - 1 + extra.length }, at: now };
  api.call = (m, p) => (m === 'mission.graph' ? Promise.resolve(g) : api.__p134orig(m, p));
};
const UNHOOK = () => { const api = window.__mt.api; if (api.__p134orig) api.call = api.__p134orig; };

// ---- 지도 읽기 ----
const PROBE = () => {
  const m = document.querySelector('[data-role=mission]');
  if (!m) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const folders = [...m.querySelectorAll('[data-role=mm-folder]')].map((f) => ({ id: f.dataset.id, name: (f.querySelector('[data-role=mm-folder-name]') || {}).textContent, title: f.title, ...R(f), border: getComputedStyle(f).borderTopColor }));
  const plates = [...m.querySelectorAll('[data-role=mm-plate]')].map((p) => ({ key: p.dataset.key, inf: p.classList.contains('inf'), ...R(p) }));
  const groups = [...m.querySelectorAll('[data-role=mm-group]')].map((g) => ({ key: g.dataset.key, name: (g.querySelector('[data-role=mm-group-name]') || {}).textContent, vg: !!g.querySelector('[data-role=mm-vgroup]'), ...R(g) }));
  const nodes = [...m.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((n) => ({ name: n.dataset.name, shape: n.dataset.shape, ...R(n) }));
  const edges = [...m.querySelectorAll('[data-role=mm-edge]')].map((e) => ({ id: e.dataset.id, outside: e.classList.contains('outside') }));
  return { folders, plates, groups, nodes, edges, light: m.querySelectorAll('[data-role=mm-light]').length, done: m.querySelectorAll('[data-role=mm-done]').length };
};
const hit = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
const inside = (a, o) => a.x >= o.x - 1 && a.y >= o.y - 1 && a.x + a.w <= o.x + o.w + 1 && a.y + a.h <= o.y + o.h + 1;

async function openMission(pg) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  if (await pg.$('[data-role="mission"]')) { await pg.keyboard.press('Escape'); await sleep(400); }
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] [data-role="mm-node"], [data-role="mission"] [data-role="mm-group"]', { timeout: 20000 });
  await sleep(1500);
}
const shotTo = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}-${TAG}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));

async function shots() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9383'] });
  try {
    await page.setViewportSize({ width: 1600, height: 900 }).catch(() => {});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    const st = await page.evaluate(() => { const s = window.__mt.getState(); return { ws: s.workspaces.map((w) => w.key), groups: s.groups }; });
    log('store', JSON.stringify(st).slice(0, 800));
    // 1) 실제 세션(셸 일곱) 그대로
    await openMission(page); await page.mouse.move(1250, 880); await sleep(300);
    await shotTo(page, 'real');
    const real = await page.evaluate(PROBE);
    if (AFTER()) check('실제 판: 폴더 상자 둘(alpha, beta), 폴더 밖 f·g는 상자 없음', real.folders.length === 2 && real.folders.map((f) => f.name).sort().join() === 'alpha,beta', real.folders);
    // 2) 흉내 판
    const keyOf = (k) => st.ws.find((w) => w.toLowerCase().includes(`mtask-p134-${k}`)) || `x-${k}`;
    const keys = Object.fromEntries(LETTERS.map((k) => [k, keyOf(k)]));
    for (const [nm, n] of [['mix', 0], ['big', 25]]) {
      await page.evaluate(UNHOOK);
      await page.evaluate(HOOK, [keys, n]);
      await page.mouse.move(1250, 880);
      await openMission(page); await page.mouse.move(1250, 880); await sleep(300);
      for (const motion of ['reduce', 'no-preference']) {
        await page.emulateMedia({ reducedMotion: motion });
        await sleep(600);
        await shotTo(page, `${nm}-${motion}`);
      }
      const p = await page.evaluate(PROBE);
      log(`[${nm}] ${JSON.stringify({ folders: p.folders.map((f) => `${f.name}:${f.x},${f.y},${f.w}x${f.h}`), groups: p.groups.map((g) => g.name), outside: p.edges.filter((e) => e.outside).map((e) => e.id), light: p.light, done: p.done })}`);
      if (!AFTER()) continue;
      check(`[${nm}] 폴더 상자 둘`, p.folders.length === 2, p.folders.map((f) => f.name));
      const rects = [...p.folders.map((f) => ({ id: f.name, ...f })), ...p.plates.filter((x) => !x.inf).map((x) => ({ id: x.key, ...x }))];
      let bad = null; for (let i = 0; i < rects.length && !bad; i++) for (let j = i + 1; j < rects.length; j++) if (hit(rects[i], rects[j])) { bad = `${rects[i].id}×${rects[j].id}`; break; }
      check(`[${nm}] 상자끼리, 폴더 밖 판과 겹치지 않는다`, !bad, bad || '');
      const fa = p.folders.find((f) => f.name === 'alpha');
      const inA = ['conductor', 'p134', 'p133', 'blog', 'notes'].map((x) => p.nodes.find((q) => q.name === x)).filter(Boolean);
      check(`[${nm}] alpha 상자 안: 팀(다른 폴더 beta의 하위 세션 p133 포함)과 혼자인 세션`, fa && inA.length === 5 && inA.every((b) => inside(b, fa)), inA.map((b) => b.name));
      check(`[${nm}] 폴더 안 워크스페이스 머리 글에 폴더 이름을 다시 쓰지 않는다`, p.groups.every((g) => !g.vg));
      if (nm === 'mix') check(`[${nm}] 상자를 넘는 선(api-w2 → site-docs)`, p.edges.some((e) => e.outside && e.id === 's:api-w2>s:site-docs'), p.edges.filter((e) => e.outside));
      check(`[${nm}] 작업 중 테두리 빛과 작업 완료 카드가 그대로`, p.light >= 3, { light: p.light, done: p.done });
      // 접기: alpha의 b 머리 글을 누르면 접히고 상자는 남는다
      const gb = p.groups.find((g) => g.key === keys.b);
      if (gb && nm === 'mix') {
        await page.mouse.click(gb.x + 20, gb.y + 8); await sleep(800);
        const q = await page.evaluate(PROBE);
        check(`[${nm}] 폴더 안 워크스페이스 접기: 상자 둘 그대로, blog 숨김`, q.folders.length === 2 && !q.nodes.some((x) => x.name === 'blog'));
        await shotTo(page, `${nm}-fold`);
        const gb2 = q.groups.find((g) => g.key === keys.b); if (gb2) { await page.mouse.click(gb2.x + 20, gb2.y + 8); await sleep(600); }
        // 가리키기: p133을 가리키면 그 팀만 또렷하다
        const n133 = q.nodes.find((x) => x.name === 'p133');
        if (n133) { await page.mouse.move(n133.x + 40, n133.y + n133.h / 2); await sleep(600); await shotTo(page, `${nm}-hover`); await page.mouse.move(5, 300); }
        // 거르기: 일함
        await page.click('[data-filter="working"]').catch(() => {}); await sleep(500); await shotTo(page, `${nm}-filter`); await page.click('[data-filter="all"]').catch(() => {});
      }
    }
    // 좁은 창
    await page.setViewportSize({ width: 1100, height: 800 }).catch(() => {});
    await sleep(1200);
    await shotTo(page, 'big-narrow');
    if (AFTER()) { const p = await page.evaluate(PROBE); const rects = [...p.folders.map((f) => ({ id: f.name, ...f })), ...p.plates.filter((x) => !x.inf).map((x) => ({ id: x.key, ...x }))]; let bad = null; for (let i = 0; i < rects.length && !bad; i++) for (let j = i + 1; j < rects.length; j++) if (hit(rects[i], rects[j])) bad = `${rects[i].id}×${rects[j].id}`; check('[narrow] 좁은 창에서도 겹치지 않는다', !bad, bad || ''); }
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
}
const AFTER = () => TAG === 'after';

async function stopBoard() {
  for (const s of sessions().filter((x) => /^p134-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
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
  fs.writeFileSync(path.join(OUT, `p134-${WHAT}-${TAG}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
