// P137 창 시험: 미션 맵 카드 메타의 지금 모델, 폴더 상자 안 워크스페이스 상자. 한 번에 한 창만 돌린다(메모리).
// 판: 따로 띄운 개발용 판(atrium-dev-p137, 47906, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9386.
//   워크스페이스 일곱(mtask-p137-a…g). a에는 Claude Code(haiku), d에는 가짜 연결(experiments/p137/tools/fake-server.mjs, 47966)의 Codex, 나머지는 셸.
//   폴더 alpha(a, b, c)·beta(d, e), f·g는 폴더 밖. 모델 바꾸기(/model)는 시험 사이에 atrium prompt로 친다(보고 절).
//   실제 세션 그대로 한 번 찍고, 그다음 페이지 안에서 mission.graph 답을 흉내 판으로 바꿔 폴더마다 워크스페이스 2~3개, 팀(폴더를 넘는 하위 세션 포함)을 섞는다.
//   움직임 줄이기(reduce)와 no-preference 둘 다 찍는다.
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p137-mission.mjs <setup|shot|stop> [before|after]
// 결과는 주 체크아웃의 experiments/p137/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MAIN = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO; // 워크트리면 주 체크아웃
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(MAIN, 'experiments', 'p137');
const CONVOS = path.join(OUT, 'convos');
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const DIRS = LETTERS.map((k) => `C:\\Workspace\\mtask-p137-${k}`);
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
const ENV = {
  ATRIUM_TERMINAL_SESSION: 'atrium-dev-p137', ATRIUM_HERDR_SESSION: 'atrium-dev-p137', ATRIUM_PORT: '47906',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p137-none-',
  OCX_SHIM_BYPASS: '1', P137_FAKE_KEY: 'p137-fake-not-a-key', // codex 래퍼가 프록시를 띄우지 않게. 가짜 서버의 가짜 키
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p137-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const P = (k) => `p137-${k}`;

async function setupBoard() {
  for (const d of DIRS) fs.mkdirSync(d, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  const have = new Set(sessions().map((s) => s.name));
  // 가짜 연결과 Codex 호출자
  const cs = call('connection.list').connections || [];
  let conn = cs.find((c) => c.name === 'p137fake');
  if (!conn) conn = call('connection.create', { connection: { name: 'p137fake', protocol: 'openai-responses', baseUrl: 'http://127.0.0.1:47966/v1', auth: { env: 'P137_FAKE_KEY' } } }).connection;
  log('connection', JSON.stringify(conn).slice(0, 300));
  const ls = call('launcher.list');
  const items = ls.items || ls.launchers || [];
  if (!items.some((l) => l.name === 'p137-codex')) log('launcher', JSON.stringify(call('launcher.create', { launcher: { name: 'p137-codex', harness: 'codex', connection: conn.id, model: 'p115-fake-model' } })).slice(0, 300));
  LETTERS.forEach((k, i) => {
    if (have.has(P(k))) return;
    if (k === 'a') log(atrium('--json', 'spawn', DIRS[i], '--model', 'haiku', '--name', P(k)).slice(0, 200));
    else if (k === 'd') log(atrium('--json', 'spawn', DIRS[i], '--launcher', 'p137-codex', '--name', P(k)).slice(0, 200));
    else log(atrium('--json', 'spawn', DIRS[i], '--kind', 'shell', '--name', P(k)).slice(0, 160));
  });
  await sleep(3000);
  const gs = call('group.list');
  const list = gs.groups || gs;
  const has = (n) => Array.isArray(list) && list.some((g) => g.name === n);
  if (!has('alpha')) call('group.create', { name: 'alpha', workspaces: [DIRS[0], DIRS[1], DIRS[2]] });
  if (!has('beta')) call('group.create', { name: 'beta', workspaces: [DIRS[3], DIRS[4]] });
  log('groups', JSON.stringify(call('group.list')).slice(0, 600));
}

// ---- 흉내 판(페이지 안에서 mission.graph 답을 바꾼다). keys: 글자 → 워크스페이스 키. 실제 세션(p137-a, p137-d)은 그대로 둔다 ----
const HOOK = ([keys]) => {
  const api = window.__mt.api;
  if (!api.__p137orig) api.__p137orig = api.call.bind(api);
  const now = Date.now();
  let i = 0;
  const S = (name, w, o = {}) => ({ id: `s:${name}`, kind: 'session', sessionId: `fk-${name}`, name, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: keys[w], parentId: null, role: null, order: null, createdAt: 1e12 + ++i, loops: 0, model: 'claude-opus-5-5', effort: 'high', activeAt: now - i * 5e5, turnAt: null, gitBranch: null, ...o });
  const W = { state: 'working', category: 'working' };
  const fake = [
    S('conductor', 'a', { ...W, model: 'claude-fable-5-2', turnAt: now - 5e6, lastPrompt: 'Merge P137 when the worker reports' }),
    S('p137', 'a', { ...W, parentId: 's:conductor', role: 'mission map', turnAt: now - 2e6, gitBranch: 'worktree-p137', lastPrompt: 'Workspace boxes' }),
    S('reviewer', 'a', { parentId: 's:conductor', role: 'reviewer', state: 'waiting', category: 'needs_you', ask: 'Run the tests?' }),
    S('p136', 'd', { ...W, parentId: 's:conductor', role: 'terminal input', turnAt: now - 9e5, lastPrompt: 'Scroll residue' }), // 다른 폴더(beta)의 하위 세션
    S('blog', 'b', { model: 'claude-sonnet-5-5', effort: null }), S('blog-copy', 'b', { state: 'sleeping' }),
    S('notes', 'c', { state: 'sleeping' }), S('notes-2', 'c'),
    S('api-lead', 'e', { state: 'ready' }), S('api-w1', 'e', { ...W, parentId: 's:api-lead', role: 'worker', turnAt: now - 4e5, lastPrompt: 'npm test' }),
    S('site', 'f', { ...W, turnAt: now - 2e5, lastPrompt: 'Deploy preview' }), S('site-docs', 'f', { parentId: 's:site', role: 'docs' }),
    S('scratch', 'g', { agentKind: 'shell', model: null }), S('dotfiles', 'g', { state: 'sleeping' })];
  const edges0 = [{ from: 's:conductor', to: 's:p137', kind: 'spawn' }, { from: 's:conductor', to: 's:reviewer', kind: 'role', label: 'reviewer' }, { from: 's:conductor', to: 's:p136', kind: 'spawn' },
    { from: 'human', to: 's:conductor', kind: 'bar', count: 4 }, { from: 's:api-lead', to: 's:api-w1', kind: 'spawn' }, { from: 's:site', to: 's:site-docs', kind: 'spawn' },
    { from: 's:api-w1', to: 's:site-docs', kind: 'prompt', label: 'update the api docs', count: 2, lastAt: now - 6e5 }];
  api.call = async (m, p) => {
    if (m !== 'mission.graph') return api.__p137orig(m, p);
    const real = await api.__p137orig(m, p);
    const keep = real.nodes.filter((n) => n.kind === 'session' && /^p137-[ad]$/.test(n.name)); // 실제 Claude Code·Codex 세션(모델 메타)
    const nodes = [{ id: 'human', kind: 'human', name: 'you' }, ...fake, ...keep];
    return { nodes, edges: edges0, counts: { all: nodes.length - 1 }, at: now };
  };
};
const UNHOOK = () => { const api = window.__mt.api; if (api.__p137orig) api.call = api.__p137orig; };

// ---- 지도 읽기 ----
const PROBE = () => {
  const m = document.querySelector('[data-role=mission]');
  if (!m) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const folders = [...m.querySelectorAll('[data-role=mm-folder]')].map((f) => ({ id: f.dataset.id, name: (f.querySelector('[data-role=mm-folder-name]') || {}).textContent, ...R(f), border: getComputedStyle(f).borderTopColor, head: getComputedStyle(f.querySelector('.mt-mm-fhead')).fontSize }));
  const plates = [...m.querySelectorAll('[data-role=mm-plate]')].map((p) => ({ key: p.dataset.key, inf: p.classList.contains('inf'), border: getComputedStyle(p).borderTopColor, ...R(p) }));
  const groups = [...m.querySelectorAll('[data-role=mm-group]')].map((g) => ({ key: g.dataset.key, font: getComputedStyle(g).fontSize, ...R(g) }));
  const nodes = [...m.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((n) => ({ name: n.dataset.name, meta: (n.querySelector('[data-role=mm-meta]') || {}).textContent || '', title: n.title || '', ...R(n) }));
  return { folders, plates, groups, nodes };
};
const apart = (a, b, g = 0) => a.x + a.w + g <= b.x + 1 || b.x + b.w + g <= a.x + 1 || a.y + a.h + g <= b.y + 1 || b.y + b.h + g <= a.y + 1;
const inside = (a, o, m = 0) => a.x >= o.x + m - 1 && a.y >= o.y + m - 1 && a.x + a.w <= o.x + o.w - m + 1 && a.y + a.h <= o.y + o.h - m + 1;

async function openMission(pg) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  if (await pg.$('[data-role="mission"]')) { await pg.keyboard.press('Escape'); await sleep(400); }
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] [data-role="mm-node"], [data-role="mission"] [data-role="mm-group"]', { timeout: 20000 });
  await sleep(1500);
}
const shotTo = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}-${TAG}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const AFTER = () => TAG === 'after';

async function shots() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9386'] });
  try {
    await page.setViewportSize({ width: 1600, height: 900 }).catch(() => {});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    const st = await page.evaluate(() => { const s = window.__mt.getState(); return { ws: s.workspaces.map((w) => w.key) }; });
    // 1) 실제 세션 그대로: 카드 메타의 모델이 요약의 지금 모델과 같다
    const sum = Object.fromEntries(sessions().filter((s) => /^p137-[ad]$/.test(s.name)).map((s) => [s.name, { model: s.model, effort: s.effort, launchModel: s.launchModel }]));
    log('summary', JSON.stringify(sum));
    await openMission(page); await page.mouse.move(1250, 880); await sleep(300);
    await shotTo(page, 'real');
    const real = await page.evaluate(PROBE);
    log('real meta', JSON.stringify(real.nodes.map((n) => [n.name, n.meta])));
    if (AFTER()) {
      for (const nm of ['p137-a', 'p137-d']) {
        const n = real.nodes.find((x) => x.name === nm), s = sum[nm];
        if (!n || !s) { check(`[real] ${nm} 카드`, false, 'no card'); continue; }
        const short = String(s.model || '').toLowerCase().replace(/^claude-/, '').replace(/\[.*\]$/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2');
        check(`[real] ${nm} 카드 메타가 지금 모델(${s.model}, 띄운 값 ${s.launchModel})`, !!s.model && n.meta.includes(short), n.meta);
        if (s.launchModel && s.launchModel !== s.model) check(`[real] ${nm} 풍선 도움말에 처음 띄운 모델`, /Launched with|처음 띄운 모델/.test(n.title), n.title.split('\n').slice(-3));
      }
    }
    // 2) 흉내 판: 폴더 둘(워크스페이스 3·2), 폴더 밖 f·g
    const keyOf = (k) => st.ws.find((w) => w.toLowerCase().includes(`mtask-p137-${k}`)) || `x-${k}`;
    // f·g는 실제 판에서 같은 부모 폴더(C:\Workspace)라 저절로 묶인 폴더(P91)에 든다. 흉내 판에서는 어느 폴더에도 없는 키로 폴더 밖 워크스페이스를 만든다
    const keys = Object.fromEntries(LETTERS.map((k) => [k, k === 'f' || k === 'g' ? `c:/elsewhere/p137-${k}` : keyOf(k)]));
    await page.evaluate(UNHOOK);
    await page.evaluate(HOOK, [keys]);
    await openMission(page); await page.mouse.move(1250, 880); await sleep(300);
    for (const motion of ['reduce', 'no-preference']) { await page.emulateMedia({ reducedMotion: motion }); await sleep(600); await shotTo(page, `mix-${motion}`); }
    const p = await page.evaluate(PROBE);
    log(`[mix] ${JSON.stringify({ folders: p.folders.map((f) => `${f.name}:${f.x},${f.y},${f.w}x${f.h} ${f.border} ${f.head}`), plates: p.plates.map((x) => `${x.key.slice(-1)}:${x.inf ? 'in' : 'out'} ${x.border}`) })}`);
    if (AFTER()) {
      check('[mix] 폴더 상자 둘', p.folders.length === 2, p.folders.map((f) => f.name));
      for (const f of p.folders) {
        const ins = p.plates.filter((x) => x.inf && inside(x, f, 8));
        check(`[mix] ${f.name}: 워크스페이스 상자가 폴더 안 여백 안쪽(${ins.length}개)`, ins.length >= 2, ins.map((x) => x.key.slice(-1)));
        let bad = null; for (let i = 0; i < ins.length; i++) for (let j = i + 1; j < ins.length; j++) if (!apart(ins[i], ins[j], 8)) bad = `${ins[i].key}×${ins[j].key}`;
        check(`[mix] ${f.name}: 워크스페이스 상자끼리 겹치지 않고 떨어진다`, !bad, bad || '');
      }
      const pin = p.plates.find((x) => x.inf), pout = p.plates.find((x) => !x.inf);
      check('[mix] 폴더 안 워크스페이스 상자에 테두리(투명 아님), 폴더 밖과 같은 테두리', pin && !/rgba\(0, 0, 0, 0\)|transparent/.test(pin.border) && pout && pin.border === pout.border, { pin: pin && pin.border, pout: pout && pout.border });
      check('[mix] 폴더 테두리가 워크스페이스 테두리보다 밝다, 머리 글이 크다', p.folders[0] && pin && p.folders[0].border !== pin.border && parseFloat(p.folders[0].head) > parseFloat(p.groups[0].font), { folder: p.folders[0] && [p.folders[0].border, p.folders[0].head], ws: [pin && pin.border, p.groups[0] && p.groups[0].font] });
      const rects = [...p.folders.map((f) => ({ id: f.name, ...f })), ...p.plates.filter((x) => !x.inf).map((x) => ({ id: x.key, ...x }))];
      let bad = null; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (!apart(rects[i], rects[j])) bad = `${rects[i].id}×${rects[j].id}`;
      check('[mix] 폴더 상자와 폴더 밖 워크스페이스 상자가 겹치지 않는다', !bad, bad || '');
      const fa = p.folders.find((f) => f.name === 'alpha');
      const n136 = p.nodes.find((x) => x.name === 'p136');
      check('[mix] 폴더를 넘는 하위 세션(p136, beta)은 부모 팀 안(alpha 상자)', fa && n136 && inside(n136, fa), n136);
    }
    // 좁은 창
    await page.setViewportSize({ width: 1100, height: 800 }).catch(() => {});
    await sleep(1200);
    await shotTo(page, 'mix-narrow');
    if (AFTER()) { const q = await page.evaluate(PROBE); const rects = [...q.folders, ...q.plates.filter((x) => !x.inf)]; let bad = null; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (!apart(rects[i], rects[j])) bad = `${i}×${j}`; check('[narrow] 좁은 창에서도 겹치지 않는다', !bad, bad || ''); }
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
}

async function stopBoard() {
  for (const s of sessions().filter((x) => /^p137-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
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
  fs.writeFileSync(path.join(OUT, `p137-${WHAT}-${TAG}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
