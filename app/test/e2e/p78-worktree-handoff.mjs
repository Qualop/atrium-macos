// P78 창 시험: 워크트리 워커의 띄움 → 정리 → 인계. 사용자가 본 순서다(P75 창 시험은 워커가 상자에 든 뒤에 정리했다).
// 리드 하나(claude haiku)가 atrium child --worktree로 워커 넷(haiku)을 띄운다. w1·w2는 요청 없이, w3·w4는 --prompt로.
// 띄운 직후를 찍고 → 영역 정리 버튼을 누르고 찍고 → herdr agent prompt로 넷에게 일을 넘기고(리드가 칠 명령, 이 판의 herdr 세션) → 워커가 워크트리에 들고 상자가 선 뒤를 찍는다.
// 잰다: 워커 블록(상자가 있으면 상자, 없으면 노드)이 한 열인지, 띄운 순서인지, 겹치지 않는지, 정리한 자리(x, 순서)를 인계 뒤에도 지키는지, 넷 다 상자에 들었는지.
// 판: herdr 세션 atrium-dev-p78, 포트 47898, 이 워크트리의 backend/.dev(experiments/p78/tools/env.cjs). 창의 원격 디버깅 포트 9378.
// 시험 저장소는 P75와 같은 경로를 새로 만든다(사용자가 그 경로의 신뢰를 이미 주었다). 신뢰 질문이 뜨면 대신 답하지 않고(CLAUDE.md)
// backend/.dev/p78-need-trust.txt에 한 줄을 두고 사람이 판의 @lead 노드에서 답할 때까지 기다린다(60분).
// MT_P78_STAGE=before(고치기 전 코드) | after(고친 코드) | clean(세션 끄기, 판 멈추기, 시험 워크트리 지우기)
// 사용: node experiments/p78/tools/e2e.cjs p78-worktree-handoff.mjs before|after|clean
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p78') throw new Error('MT_E2E_OUT=p78를 명령줄에서 준다');
const STAGE = process.env.MT_P78_STAGE;
if (!['before', 'after', 'clean'].includes(STAGE)) throw new Error('MT_P78_STAGE=before|after|clean');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p78', 'tools', 'env.cjs'));
const ENV = T.P78_ENV;
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p78' || ENV.ATRIUM_PORT !== '47898') throw new Error('P78 판(atrium-dev-p78, 47898)만');
if (!/^C:\\Workspace\\mtask-p7[58]-/.test(T.REPO)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p75-* 또는 mtask-p78-*만: ${T.REPO}`);
fs.mkdirSync(OUT, { recursive: true });
const { areaKey, areaAnchorList, nestedRegions, regionConflicts } = await import(pathToFileURL(path.join(REPO, 'backend', 'src', 'worktree-areas.mjs')).href);

const log = logger(`p78-worktree-handoff-${STAGE}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE|ATRIUM_|MTASK_|HERDR_)/.test(k)));
const env = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const GIT_ID = ['-c', 'user.name=p78', '-c', 'user.email=p78@example.invalid'];
const git = (...a) => execFileSync('git', ['-C', T.REPO, ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const WORKERS = ['w1', 'w2', 'w3', 'w4'];
const WITH_PROMPT = new Set(['w3', 'w4']);
const ASK = 'Reply with the single word ok and do nothing else.';
const NEED_TRUST = path.join(T.DEV, 'p78-need-trust.txt'); // 사람에게 신뢰 답을 부탁하는 한 줄(지휘 세션이 본다)
const keyOf = (p) => p.replace(/\\/g, '/').toLowerCase();
const repoKey = keyOf(path.join(T.REPO, '.git'));
async function until(fn, ms, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } }

// ---------- 정리 ----------
if (STAGE === 'clean') {
  let names = [];
  try { names = JSON.parse(atrium('ls', '--json')).map((s) => s.name); } catch (e) { log('목록 실패', e.message.slice(0, 200)); }
  for (const n of names) { try { log('끄기', atrium('kill', n, '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('끄기 실패', n, e.message.slice(0, 160)); } }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  if (fs.existsSync(path.join(T.REPO, '.git'))) {
    for (const line of git('worktree', 'list', '--porcelain').split(/\r?\n/)) {
      const m = /^worktree (.+)$/.exec(line);
      if (m && keyOf(m[1]) !== keyOf(T.REPO)) { try { git('worktree', 'remove', '--force', '--force', m[1]); /* claude -w가 잠근 것도(세션은 이미 껐다) */ log('워크트리 지움', path.basename(m[1])); } catch (e) { log('워크트리 지우기 실패', e.message.slice(0, 160)); } }
    }
    git('worktree', 'prune');
    for (const b of git('branch', '--format=%(refname:short)').split(/\r?\n/).filter((x) => x && x !== 'main')) { try { git('branch', '-D', b); } catch {} }
  }
  process.exit(0);
}

let app = null, page = null;
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sess = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, cwd: s.cwd, branch: s.branch || null } : null; }, name);
const shot = async (name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const fitRepo = async () => { await page.evaluate((k) => window.__mt.getState().fitWorkspace(k), repoKey); await sleep(1200); };

async function open() {
  app = await electron.launch({ args: ['.', '--dev', '--remote-debugging-port=9378'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(1000);
}
const envOf = async (name) => {
  const s = await sess(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.id}.json`), 'utf8'));
  const e = { ...env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (e.ATRIUM_SESSION_ID !== s.id || !e.ATRIUM_SESSION_TOKEN) throw new Error(`${name} 설정 파일에 세션 env가 없다`);
  return e;
};
const child = (pe, n, extra = []) => { const out = execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', n, ...extra, '--model', 'haiku', '--no-wait', '--json'], { encoding: 'utf8', env: pe, timeout: 120000 }); log(`atrium child ${n}`, out.trim().slice(0, 300)); };

// 판의 자리를 창과 같은 규칙으로 잰다(board.get의 노드·워크트리 자리 → 영역). 워커 블록 = 상자가 있으면 상자, 없으면 노드
async function measure(label) {
  const g = await call('board.get');
  const nameOf = new Map(await page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => [s.sessionId, s.name])));
  const items = g.nodes.map((n) => ({ id: n.session_id, kind: 'node', ws: n.area ? areaKey(n.workspace_key, n.area) : n.workspace_key, x: n.x, y: n.y, w: n.w, h: n.h, area: n.area || '' }));
  const byName = new Map(items.map((it) => [nameOf.get(it.id), it]));
  const regs = nestedRegions(areaAnchorList(g.workspaces), items);
  const blockOf = (n) => { const it = byName.get(n); if (!it) return null; return it.area ? regs.get(it.ws) : it; };
  const ws = WORKERS.map((n) => ({ name: n, block: blockOf(n), area: byName.get(n) ? byName.get(n).area : null }));
  const xs = ws.map((w) => w.block && Math.round(w.block.x));
  const ordered = ws.every((w, i) => i === 0 || (w.block && ws[i - 1].block && w.block.y > ws[i - 1].block.y + ws[i - 1].block.h - 1));
  let overl = 0;
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) { const a = ws[i].block, b = ws[j].block; if (a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overl++; }
  const lead = byName.get('lead');
  // 워커 영역이 아닌 빈 상자(워커가 아직 들지 않은 것)
  const wtKeys = [...regs.keys()].filter((k) => k !== repoKey && k.startsWith(repoKey));
  const used = new Set(ws.filter((w) => w.area).map((w) => areaKey(repoKey, w.area)));
  const empty = wtKeys.filter((k) => !used.has(k)).map((k) => { const r = regs.get(k); return { x: Math.round(r.x), y: Math.round(r.y) }; });
  const m = {
    label, cols: new Set(xs).size, xs, ordered, overlaps: overl, conflicts: [...regionConflicts(regs, items)].length,
    inBox: ws.filter((w) => w.area).map((w) => w.name), emptyBoxes: empty,
    rightOfLead: ws.every((w) => w.block && lead && w.block.x >= lead.x + lead.w),
    blocks: ws.map((w) => ({ n: w.name, box: !!w.area, x: w.block && Math.round(w.block.x), y: w.block && Math.round(w.block.y), w: w.block && Math.round(w.block.w), h: w.block && Math.round(w.block.h) })),
  };
  log(`잼 ${label}`, m);
  return m;
}
const lineOk = (m) => m.cols === 1 && m.ordered && m.overlaps === 0 && m.conflicts === 0;

try {
  // ---------- 준비 ----------
  for (const d of [T.PROJECTS, T.SESSIONS]) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(path.join(T.REPO, '.git'))) {
    fs.mkdirSync(T.REPO, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', T.REPO]);
    fs.writeFileSync(path.join(T.REPO, 'README.md'), '# p78 test repo\n');
    git('add', 'README.md'); git(...GIT_ID, 'commit', '-q', '-m', 'init');
  }
  await open();
  if (!(await sess('lead'))) log(atrium('spawn', T.REPO, '--name', 'lead', '--model', 'haiku').trim().split('\n').slice(-3).join(' | '));
  await until(async () => !!(await sess('lead')), 60000);
  const t0 = await until(async () => { const s = await sess('lead'); return s && ['trust_wait', 'ready', 'working'].includes(s.state) ? s.state : null; }, 120000);
  if (t0 === 'trust_wait') {
    await page.evaluate(async (n) => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === n); st.navigateTo(s.sessionId); }, 'lead');
    await sleep(1200);
    await shot(`p78-${STAGE}-0-trust`);
    log('사람 차례: 개발용 판의 @lead 노드에서 신뢰 질문에 답해 주세요(시험은 대신 답하지 않는다)');
    fs.writeFileSync(NEED_TRUST, 'Dev board atrium-dev-p78 (port 47898) window: on the @lead node, answer the folder trust question for the test repo mtask-p75-repo ("Yes, I trust this folder").\n');
  }
  const ready = await until(async () => (await sess('lead'))?.state === 'ready', 60 * 60000, 2000);
  try { fs.rmSync(NEED_TRUST, { force: true }); } catch {}
  step('준비: 리드가 시험 저장소에서 떴다', !!ready, await sess('lead'));
  if (!ready) throw new Error('리드가 ready가 되지 않았다(신뢰를 받지 못함)');

  // ---------- 1. 워커 넷(--worktree): w1·w2는 요청 없이, w3·w4는 --prompt ----------
  const leadEnv = await envOf('lead');
  for (const n of WORKERS) if (!(await sess(n))) child(leadEnv, n, ['--worktree', n, ...(WITH_PROMPT.has(n) ? ['--prompt', ASK] : [])]);
  // claude -w가 워크트리 넷을 다 만들 때까지(판이 상자를 만들 수 있게)
  await until(async () => WORKERS.every((n) => fs.existsSync(path.join(T.REPO, '.claude', 'worktrees', n))), 120000, 1000);
  await sleep(3000);
  await call('worktree.sync').catch(() => {});
  await sleep(3000);
  await fitRepo();
  await shot(`p78-${STAGE}-1-spawned`);
  const m1 = await measure('spawned');
  step('띄운 직후: 한 열, 띄운 순서, 겹침 없음', lineOk(m1), { xs: m1.xs, ordered: m1.ordered, overlaps: m1.overlaps, conflicts: m1.conflicts });
  step('띄운 직후: 빈 상자 없음(요청 없이 띄운 워커도 상자에)', m1.emptyBoxes.length === 0 && m1.inBox.length === WORKERS.length, { inBox: m1.inBox, empty: m1.emptyBoxes });

  // ---------- 2. 영역 정리 버튼 ----------
  const head = page.locator(`.mt-region[data-ws="${repoKey}"] .mt-region-head`).first();
  let clicked = false;
  try { await head.hover({ timeout: 5000 }); await sleep(400); await page.locator(`.mt-region[data-ws="${repoKey}"] [data-action=arrange]`).first().click({ timeout: 5000 }); clicked = true; } catch (e) { log('정리 버튼을 누르지 못해 API로', e.message.slice(0, 160)); await call('board.arrange', { workspace: repoKey, apply: true }); }
  await sleep(2500);
  await fitRepo();
  await shot(`p78-${STAGE}-2-arranged`);
  const m2 = await measure('arranged');
  step('정리 뒤: 한 열, 띄운 순서, 겹침 없음, 리드 오른쪽', lineOk(m2) && m2.rightOfLead, { clicked, xs: m2.xs, ordered: m2.ordered, overlaps: m2.overlaps, right: m2.rightOfLead });

  // ---------- 3. 인계: herdr agent prompt로 넷에게 일을 넘긴다 ----------
  // 리드가 칠 명령과 같은 herdr agent prompt를 시험이 직접 친다(이 판의 herdr 세션). 리드(haiku)에게 시키면 herdr 말고 다른 명령도 쳐서
  // 권한 질문에서 멈출 때가 있다(1회 기록 experiments/p78/run1)
  for (const n of WORKERS) log(`herdr agent prompt ${n}`, execFileSync('herdr', ['--session', ENV.ATRIUM_HERDR_SESSION, 'agent', 'prompt', n, ASK], { encoding: 'utf8', env, timeout: 60000 }).trim().slice(0, 160));
  // 넘긴 일이 넷에 닿을 때까지(hook이 워커의 폴더를 워크트리로 알린다, 최대 4분). 그 전에 재면 인계 뒤가 아니다
  const gitWt = () => page.evaluate((ns) => ns.map((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return !!(s && s.git && s.git.isWorktree); }), WORKERS);
  const handed = await until(async () => (await gitWt()).every(Boolean), 4 * 60000, 2000);
  step('인계: 넘긴 일이 넷에 닿음(hook이 워크트리 폴더를 알림)', !!handed, await gitWt());
  // 넷 다 상자에 들 때까지(최대 1분). 판은 10초마다 워크트리를 읽는다
  const all = await until(async () => { await call('worktree.sync').catch(() => {}); const m = await measure('wait'); return m.inBox.length === WORKERS.length ? m : null; }, 60000, 5000);
  step('인계 뒤: 워커 넷이 각자 상자에', !!all, all && all.inBox);
  await sleep(3000);
  await call('worktree.sync').catch(() => {});
  await sleep(1500);
  await fitRepo();
  await shot(`p78-${STAGE}-3-handoff`);
  const m3 = await measure('handoff');
  step('인계 뒤: 한 열, 띄운 순서, 겹침 없음, 리드 오른쪽', lineOk(m3) && m3.rightOfLead, { xs: m3.xs, ordered: m3.ordered, overlaps: m3.overlaps, right: m3.rightOfLead });
  const kept = m3.blocks.every((b, i) => b.x === m2.blocks[i].x && b.y === m2.blocks[i].y);
  step('인계 뒤: 정리한 자리 그대로(상자 x·y)', kept, { arranged: m2.blocks.map((b) => [b.n, b.x, b.y]), handoff: m3.blocks.map((b) => [b.n, b.x, b.y]) });
  fs.writeFileSync(path.join(OUT, `p78-measure-${STAGE}.json`), JSON.stringify([m1, m2, m3], null, 2));
} catch (e) {
  step('예외', false, e.stack);
  try { await shot(`p78-${STAGE}-error`); } catch {}
} finally {
  fs.writeFileSync(path.join(OUT, `p78-results-${STAGE}.json`), JSON.stringify(results, null, 2));
  log('결과', `${results.filter((r) => r.ok).length}/${results.length}`);
  if (app) await closeApp(app);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
