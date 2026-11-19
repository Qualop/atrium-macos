// P149 창 시험: 이전 미션 맵(열 지도)을 다듬었다. 큰 창 맞춤 배율, 대비·머리 글 위계, 넘침 없음, 작업 완료 거르기 탭 없음.
// 판: 따로 띄운 개발용 판(atrium-dev-p149, 47919, backend/.dev)만 쓴다. 창의 원격 디버깅 포트 9399. 한 번에 한 창만 돌린다(메모리).
//   워크스페이스 다섯(mtask-p149-a…e)에 셸 세션 하나씩. 폴더 atrium(a, b, c)·tools(d, e). f…j는 흉내 판에서 어느 폴더에도 없는 키.
//   페이지 안에서 mission.graph 답을 실제 판 모양 흉내(세션 28·워크스페이스 10, 9·4·3·3·2·2·2·1·1·1)로 바꾸고
//   작업 중·응답 필요·오류·작업 완료·쉼·잠듦·끝남을 섞는다. 2576×1408, 1584×921, 1366×768 창에서 reduce와 no-preference로 찍는다.
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p149-mission.mjs <setup|shot|stop> [before|after]
// 결과는 주 체크아웃의 experiments/p149/(저장소 밖).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WHAT = process.argv[2] || 'setup';
const TAG = process.argv[3] || 'after';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const MAIN = /[\\/]\.claude[\\/]worktrees[\\/]/.test(REPO) ? path.resolve(REPO, '..', '..', '..') : REPO; // 워크트리면 주 체크아웃
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(MAIN, 'experiments', 'p149');
const CONVOS = path.join(OUT, 'convos');
const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const DIRS = LETTERS.map((k) => `C:\\Workspace\\mtask-p149-${k}`);
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_|HC_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
const ENV = {
  ATRIUM_TERMINAL_SESSION: 'atrium-dev-p149', ATRIUM_HERDR_SESSION: 'atrium-dev-p149', ATRIUM_PORT: '47919',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', ATRIUM_TEST_PREFIX: 'p149-none-',
};
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
const { logger, sleep, launch, closeApp } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });

const log = logger(`p149-${WHAT}-${TAG}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const P = (k) => `p149-${k}`;

async function setupBoard() {
  for (const d of DIRS) fs.mkdirSync(d, { recursive: true });
  log(atrium('backend', 'start').trim().slice(0, 300));
  const have = new Set(sessions().map((s) => s.name));
  LETTERS.forEach((k, i) => { if (!have.has(P(k))) log(atrium('--json', 'spawn', DIRS[i], '--kind', 'shell', '--name', P(k)).slice(0, 160)); });
  await sleep(3000);
  const gs = call('group.list');
  const list = gs.groups || gs;
  const has = (n) => Array.isArray(list) && list.some((g) => g.name === n);
  if (!has('atrium')) call('group.create', { name: 'atrium', workspaces: [DIRS[0], DIRS[1], DIRS[2]] });
  if (!has('tools')) call('group.create', { name: 'tools', workspaces: [DIRS[3], DIRS[4]] });
  log('groups', JSON.stringify(call('group.list')).slice(0, 600));
}

// ---- 흉내 판(페이지 안에서 mission.graph 답을 바꾼다). keys: 글자 → 워크스페이스 키 ----
const HOOK = ([keys]) => {
  const api = window.__mt.api;
  if (!api.__p149orig) api.__p149orig = api.call.bind(api);
  const now = Date.now();
  let i = 0;
  const S = (name, w, o = {}) => ({ id: `s:${name}`, kind: 'session', sessionId: `fk-${name}`, name, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: keys[w], parentId: null, role: null, order: null, createdAt: 1e12 + ++i, loops: 0, model: 'claude-opus-5-5', effort: 'high', activeAt: now - i * 7e5, turnAt: null, gitBranch: null, ...o });
  const W = { state: 'working', category: 'working' };
  const DONE = { state: 'ready', category: 'done' };
  const kid = (name, w, parent, o = {}) => S(name, w, { parentId: `s:${parent}`, role: 'worker', ...o });
  const fake = [
    // a (9): 지휘 세션과 워커 셋(작업 중·응답 필요·작업 완료), 워커의 리뷰어, 쉼·잠듦·셸·끝남
    S('multitask-1', 'a', { ...W, model: 'claude-fable-5-2', effort: 'high', turnAt: now - 5e6, lastPrompt: 'Merge the workers when they report and run the release check' }),
    kid('p149', 'a', 'multitask-1', { ...W, turnAt: now - 2e6, gitBranch: 'worktree-p149', lastPrompt: 'Polish the classic mission map without removing any information from the cards' }),
    kid('p150', 'a', 'multitask-1', { state: 'waiting', category: 'needs_you', ask: 'Allow npm ci in the worktree?', gitBranch: 'worktree-p150', lastPrompt: 'Phone layout check' }),
    kid('p151', 'a', 'multitask-1', { ...DONE, gitBranch: 'worktree-p151', lastPrompt: 'Fix the sidebar fold arrow and add a unit test' }),
    kid('p149-review', 'a', 'p149', { ...W, role: 'reviewer', model: 'claude-sonnet-5-5', effort: 'medium', turnAt: now - 4e5, lastPrompt: 'Review the mission map diff for overflow' }),
    S('docs', 'a', { lastPrompt: 'Rewrite the install section' }), S('a-old', 'a', { state: 'sleeping', lastPrompt: 'Old experiment with the dock' }),
    S('a-shell', 'a', { agentKind: 'shell', model: null, effort: null }), S('a-gone', 'a', { state: 'exited', category: 'exited', lastPrompt: 'Clean the temp folders' }),
    // b (4): 쉬는 리드와 하위 둘(오류, 작업 중), 잠듦
    S('web', 'b', { lastPrompt: 'Split the landing page work' }), kid('web-api', 'b', 'web', { state: 'error', category: 'needs_you', lastPrompt: 'Start the dev server' }),
    kid('web-ui', 'b', 'web', { ...W, role: 'frontend', model: 'claude-haiku-5-5', effort: null, turnAt: now - 3e5, lastPrompt: 'Make the hero section responsive' }), S('b-notes', 'b', { state: 'sleeping' }),
    // c (3): 일하는 리드, 쉬는 하위, 작업 완료 하위
    S('bot', 'c', { ...W, turnAt: now - 9e5, lastPrompt: 'Ship the bot release notes' }), kid('bot-1', 'c', 'bot', { lastPrompt: 'Collect the changelog lines' }), kid('bot-2', 'c', 'bot', { ...DONE, lastPrompt: 'Tag the release' }),
    // d (3), e (2): 폴더 tools의 혼자인 세션
    S('d-1', 'd', { ...W, turnAt: now - 1e5, lastPrompt: 'Profile the build' }), S('d-2', 'd', { state: 'sleeping', lastPrompt: 'Benchmark the cache' }), S('d-3', 'd'),
    S('e-1', 'e', { ...DONE, lastPrompt: 'Upgrade the lint config' }), S('e-2', 'e'),
    // f…j: 폴더 밖
    S('f-1', 'f', { ...W, model: 'gpt-5.5', effort: 'high', agentKind: 'codex', turnAt: now - 6e5, lastPrompt: 'Port the parser to the new API' }), S('f-2', 'f', { state: 'sleeping' }),
    S('g-1', 'g'), S('g-2', 'g', { lastPrompt: 'Read the logs' }),
    S('h-1', 'h', { agentKind: 'shell', model: null, effort: null, state: 'working', category: 'working' }),
    S('i-1', 'i', { state: 'waiting', category: 'needs_you', ask: 'Which branch should I rebase onto?' }),
    S('j-1', 'j', { state: 'sleeping', lastPrompt: 'Summarize the meeting notes' })];
  const edges0 = [];
  for (const n of fake) if (n.parentId) edges0.push({ from: n.parentId, to: n.id, kind: 'spawn' });
  edges0.push({ from: 'human', to: 's:multitask-1', kind: 'bar', count: 6, label: 'Ship the classic map polish' }, { from: 's:p149', to: 's:p151', kind: 'prompt', label: 'share the fold helper', count: 1, lastAt: now - 3e5 });
  api.call = async (m, p) => {
    if (m !== 'mission.graph') return api.__p149orig(m, p);
    const nodes = [{ id: 'human', kind: 'human', name: 'you' }, ...fake];
    return { nodes, edges: edges0, counts: { all: nodes.length - 1 }, at: now };
  };
};
const UNHOOK = () => { const api = window.__mt.api; if (api.__p149orig) api.call = api.__p149orig; };

// ---- 지도 읽기 ----
const PROBE = () => {
  const m = document.querySelector('[data-role=mission]');
  if (!m) return null;
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const body = m.querySelector('.mt-mission-body'), canvas = m.querySelector('.mt-mission-canvas');
  const vb = R(body);
  const px = (e) => (e ? Math.round(parseFloat(getComputedStyle(e).fontSize) * (parseFloat(getComputedStyle(e).zoom) || 1) * 10) / 10 : null);
  // 화면에 보이는 글자 크기: 글자 크기 × 조상들의 zoom
  const shown = (e) => { if (!e) return null; let z = 1; for (let x = e; x && x.nodeType === 1; x = x.parentElement) z *= parseFloat(getComputedStyle(x).zoom) || 1; return Math.round(parseFloat(getComputedStyle(e).fontSize) * z * 10) / 10; };
  const nodes = [...m.querySelectorAll('[data-role=mm-node][data-kind=session]')].map((n) => {
    const r = R(n);
    // 넘침: 카드 안 글 줄과 꼬리표가 카드 상자 밖으로 나가는지(꼬리표·종류 동그라미는 위 가장자리에 반쯤 걸치게 둔 것이라 가로만 본다)
    const out = [...n.querySelectorAll('.mt-mm-c1, .mt-mm-c2, .mt-mm-c3, .mt-mm-meta, .mt-mm-warn, .mt-mm-donetag, .mt-mm-av, .nm, .rl, .mt-mm-rl2')].filter((c) => { const q = c.getBoundingClientRect(); return q.width > 0 && (q.left < r.x - 1.5 || q.right > r.x + r.w + 1.5); }).map((c) => c.className);
    const clipped = [...n.querySelectorAll('.mt-mm-c2, .mt-mm-c3, .mt-mm-meta')].filter((c) => c.scrollWidth > c.clientWidth + 1).length;
    return { name: n.dataset.name, shape: n.dataset.shape, tier: n.dataset.tier, title: n.title || '', text: n.innerText.replace(/\s+/g, ' ').trim(), out, clipped, ...r };
  });
  const seen = nodes.filter((n) => n.x >= vb.x - 1 && n.y >= vb.y - 1 && n.x + n.w <= vb.x + vb.w + 1 && n.y + n.h <= vb.y + vb.h + 1);
  const folders = [...m.querySelectorAll('[data-role=mm-folder]')].map((f) => ({ id: f.dataset.id, ...R(f) }));
  const plates = [...m.querySelectorAll('[data-role=mm-plate]')].map((p) => ({ key: p.dataset.key, inf: p.classList.contains('inf'), ...R(p) }));
  const all = [...nodes.map((n) => n), ...folders, ...plates];
  const used = all.length ? { w: Math.max(...all.map((b) => b.x + b.w)) - vb.x, h: Math.max(...all.map((b) => b.y + b.h)) - vb.y } : { w: 0, h: 0 };
  const card = m.querySelector('.mt-mm-card');
  return {
    win: { w: innerWidth, h: innerHeight }, body: vb, canvas: canvas ? { w: Math.round(canvas.getBoundingClientRect().width), h: Math.round(canvas.getBoundingClientRect().height) } : null,
    zoom: canvas ? parseFloat(getComputedStyle(canvas).zoom) || 1 : 1, used,
    font: { name: shown(m.querySelector('.mt-mm-card .mt-mm-name')), line: shown(m.querySelector('.mt-mm-card .mt-mm-c2')), meta: shown(m.querySelector('.mt-mm-card .mt-mm-c3')), ws: shown(m.querySelector('.mt-mm-ws .nm')), folder: shown(m.querySelector('.mt-mm-fhead .nm')), sum: shown(m.querySelector('.mt-mm-si .a')) },
    weight: { name: card && getComputedStyle(card.querySelector('.mt-mm-name')).fontWeight, ws: m.querySelector('.mt-mm-ws') && getComputedStyle(m.querySelector('.mt-mm-ws')).fontWeight, folder: m.querySelector('.mt-mm-fhead') && getComputedStyle(m.querySelector('.mt-mm-fhead')).fontWeight },
    nodes, folders, plates, seen: seen.length, total: nodes.length,
    filters: [...m.querySelectorAll('[data-filter]')].map((b) => b.dataset.filter), edges: m.querySelectorAll('[data-role=mm-edge]').length, light: m.querySelectorAll('[data-role=mm-light]').length,
    scrollX: body.scrollWidth > body.clientWidth + 1, sw: body.scrollWidth, cw: body.clientWidth, sh: body.scrollHeight, ch: body.clientHeight,
    far: [...m.querySelectorAll('.mt-mission-canvas *')].map((e) => [e.className && e.className.baseVal === undefined ? e.className : 'svg', Math.round(e.getBoundingClientRect().right)]).sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
};
const apart = (a, b, g = 0) => a.x + a.w + g <= b.x + 1 || b.x + b.w + g <= a.x + 1 || a.y + a.h + g <= b.y + 1 || b.y + b.h + g <= a.y + 1;

async function openMission(pg) {
  if (await pg.$('[data-action="return-close"]')) { await pg.click('[data-action="return-close"]').catch(() => {}); await sleep(300); }
  if (await pg.$('[data-role="mission"]')) { await pg.keyboard.press('Escape'); await sleep(400); }
  await pg.click('[data-action="mission-rail"]');
  await pg.waitForSelector('[data-role="mission"] [data-role="mm-node"], [data-role="mission"] [data-role="mm-group"]', { timeout: 20000 });
  await sleep(1500);
}
const shotTo = (pg, name, clip) => pg.screenshot({ path: path.join(OUT, `${name}-${TAG}.png`), ...(clip ? { clip } : {}) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));
const AFTER = () => TAG === 'after';
const summary = {};
const SIZES = [[2576, 1408], [1584, 921], [1366, 768]];

function judge(tag, p) {
  summary[tag] = { win: p.win, zoom: p.zoom, font: p.font, weight: p.weight, seen: p.seen, total: p.total, canvas: p.canvas, used: p.used, body: { w: p.body.w, h: p.body.h }, filters: p.filters, scrollX: p.scrollX, sw: p.sw, cw: p.cw, sh: p.sh, ch: p.ch, far: p.far };
  log(`[${tag}] 배율 ${p.zoom}, 글자 ${JSON.stringify(p.font)}, 굵기 ${JSON.stringify(p.weight)}, 한 화면 카드 ${p.seen}/${p.total}, 지도 ${p.canvas && `${p.canvas.w}x${p.canvas.h}`}, 쓴 곳 ${p.used.w}x${p.used.h}, 칸 ${p.body.w}x${p.body.h}, 빛 ${p.light}`);
  if (!AFTER()) return;
  check(`[${tag}] 작업 완료 거르기 탭이 없다`, !p.filters.includes('done') && p.filters.includes('needs_you'), p.filters);
  let bad = null; for (let i = 0; i < p.nodes.length; i++) for (let j = i + 1; j < p.nodes.length; j++) if (!apart(p.nodes[i], p.nodes[j])) bad = `${p.nodes[i].name}×${p.nodes[j].name}`;
  check(`[${tag}] 카드끼리 겹치지 않는다`, !bad, bad || '');
  const over = p.nodes.filter((n) => n.out.length).map((n) => `${n.name}:${n.out.join('|')}`);
  check(`[${tag}] 카드 안 글·칩이 카드 밖으로 나가지 않는다`, !over.length, over);
  check(`[${tag}] 가로 스크롤 없음`, !p.scrollX, p);
  check(`[${tag}] 머리 글 위계: 폴더 > 워크스페이스 > 카드 이름(크기)`, p.font.folder > p.font.ws && p.font.ws > p.font.name - 0.01 && p.font.folder > p.font.name, p.font);
  check(`[${tag}] 카드마다 역할·모델이 글로 보인다(셸·동그라미 빼고)`, p.nodes.filter((n) => n.shape !== 'dot' && !/shell/.test(n.name) && n.name !== 'h-1').every((n) => /opus|sonnet|haiku|fable|gpt/.test(n.text)), p.nodes.filter((n) => n.shape !== 'dot' && !/opus|sonnet|haiku|fable|gpt/.test(n.text)).map((n) => n.name));
  if (p.win.w >= 2500) {
    check(`[${tag}] 큰 창: 배율이 1보다 크고 본문 글자가 14px 안팎`, p.zoom > 1.1 && p.font.line >= 13.5 && p.font.line <= 16.5, { zoom: p.zoom, font: p.font });
    check(`[${tag}] 큰 창: 지도가 칸 폭의 절반 넘게 쓴다`, p.used.w >= p.body.w * 0.5, { used: p.used, body: p.body });
  } else if (p.win.w <= 1400) check(`[${tag}] 작은 창: 배율 1(지금처럼)`, p.zoom === 1, p.zoom);
}

async function shots() {
  const { app, page } = await launch({ log, env: { ...ENV }, args: ['--remote-debugging-port=9399'] });
  try {
    await page.setViewportSize({ width: 1584, height: 921 }).catch(() => {});
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(2500);
    const st = await page.evaluate(() => { const s = window.__mt.getState(); return { ws: s.workspaces.map((w) => w.key) }; });
    const keyOf = (k) => st.ws.find((w) => w.toLowerCase().includes(`mtask-p149-${k}`)) || `x-${k}`;
    const keys = Object.fromEntries([...LETTERS, 'f', 'g', 'h', 'i', 'j'].map((k) => [k, LETTERS.includes(k) ? keyOf(k) : `c:/elsewhere/p149-${k}`]));
    await page.evaluate(UNHOOK);
    await page.evaluate(HOOK, [keys]);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h }).catch(() => {});
      await sleep(600);
      await openMission(page); await page.mouse.move(w - 10, h - 10); await sleep(400);
      for (const motion of ['reduce', 'no-preference']) { await page.emulateMedia({ reducedMotion: motion }); await sleep(700); await shotTo(page, `real-${w}-${motion}`); }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const p = await page.evaluate(PROBE);
      judge(`${w}x${h}`, p);
      // 카드 하나 크게(작업 중 워커 p149, 작업 완료 p151, 응답 필요 p150, 잠든 a-old)
      for (const nm of ['p149', 'p151', 'p150', 'a-old', 'web-api']) {
        const n = p.nodes.find((x) => x.name === nm);
        if (n && n.w > 0) { await page.emulateMedia({ reducedMotion: 'no-preference' }); await sleep(200); await shotTo(page, `card-${nm}-${w}`, { x: Math.max(0, n.x - 14), y: Math.max(0, n.y - 14), width: n.w + 28, height: n.h + 28 }); }
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      if (w === 1584 && AFTER()) {
        const cond = p.nodes.find((x) => x.name === 'multitask-1');
        const kids = ['p149', 'p150', 'p151'].map((n) => p.nodes.find((x) => x.name === n));
        check('[1584] 팀 흐름: 하위는 부모 오른쪽', cond && kids.every((k) => k && k.x > cond.x + cond.w), kids.map((k) => k && k.x));
        const one = p.nodes.find((x) => x.name === 'p149');
        check('[1584] 작업 중 카드에 역할·모델·지금 하는 일', one && /worker/i.test(one.text) && /opus 5\.5·high/.test(one.text) && /Polish the classic/.test(one.text), one && one.text);
        const done = p.nodes.find((x) => x.name === 'p151');
        check('[1584] 작업 완료 카드에 마지막으로 한 일', done && /Fix the sidebar/.test(done.text), done && done.text);
        const old = p.nodes.find((x) => x.name === 'a-old');
        check('[1584] 잠든 세션도 모델과 마지막 일을 남긴다', old && /opus/.test(old.text) && /Old experiment/.test(old.text), old && old.text);
        const sumAsk = await page.evaluate(() => (document.querySelector('[data-role=mm-sum-item][data-name=p150]') || {}).innerText || '');
        check('[1584] 요약 열의 응답 필요 칸은 묻는 글', /Allow npm ci/.test(sumAsk), sumAsk);
        const sumDone = await page.evaluate(() => (document.querySelector('[data-role=mm-sum-review] [data-role=mm-sum-item]') || {}).innerText || '');
        check('[1584] 요약 열의 작업 완료 칸은 마지막으로 한 일', /Last: /.test(sumDone), sumDone);
        // 가리키면 또렷해지기
        await page.mouse.move(one.x + one.w / 2, one.y + one.h / 2); await sleep(400);
        const rec = await page.evaluate(() => ({ docs: document.querySelector('[data-role=mm-node][data-name=e-1]').classList.contains('recede'), cond: document.querySelector('[data-role=mm-node][data-name="multitask-1"]').classList.contains('recede') }));
        check('[1584] 가리키면 그 팀만 또렷하다', rec.docs && !rec.cond, rec);
        await shotTo(page, 'real-1584-hover');
        await page.mouse.move(w - 10, h - 10); await sleep(300);
        await page.click('[data-filter=needs_you]'); await sleep(400);
        const dim = await page.evaluate(() => ({ ask: document.querySelector('[data-role=mm-node][data-name=p150]').classList.contains('fdim'), other: document.querySelector('[data-role=mm-node][data-name=docs]').classList.contains('fdim') }));
        check('[1584] 거르기는 흐리게만', !dim.ask && dim.other, dim);
        await page.click('[data-filter=all]'); await sleep(300);
        check('[1584] 작업 중 빛(일하는 카드)', p.light >= 5, p.light);
      }
    }
    await page.evaluate(UNHOOK);
  } finally { await closeApp(app); }
  fs.writeFileSync(path.join(OUT, `p149-summary-${TAG}.json`), JSON.stringify(summary, null, 2));
}

async function stopBoard() {
  for (const s of sessions().filter((x) => /^p149-/.test(x.name))) { try { atrium('kill', s.name, '--yes'); } catch (e) { log(`kill ${s.name} ${e.message.slice(0, 100)}`); } }
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
  fs.writeFileSync(path.join(OUT, `p149-${WHAT}-${TAG}.json`), JSON.stringify({ results }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
