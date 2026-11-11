// P75 창 시험: 워커 줄. 리드 하나(claude haiku)가 atrium child --worktree로 워커 다섯(haiku)을 띄우고, 워커 하나(w2)가 다시 워커 둘(g1, g2)을 띄운다.
// 띄운 직후 배치, 영역 정리 버튼 뒤, 워커 하나(w1)를 크게 바꾼 뒤를 찍고, 워커 상자들이 한 열에 띄운 순서대로 서는지 잰다.
// 판: herdr 세션 atrium-dev-p75, 포트 47896, 이 워크트리의 backend/.dev(experiments/p75/tools/env.cjs). 창의 원격 디버깅 포트 9376.
// 시험 저장소는 새로 만든 git 저장소라 신뢰를 받지 않았다. 리드를 그 저장소에서 띄우면 신뢰 질문이 리드 노드에 뜬다. 시험은 대신 답하지 않고(CLAUDE.md)
// backend/.dev/p75-need-trust.txt에 한 줄을 두고 사람이 판의 @lead 노드에서 답할 때까지 기다린다. 신뢰를 받은 뒤 띄우는 워커는 신뢰 관문 없이 claude -w로 뜬다.
// 워커는 리드의 세션 설정 파일의 env(ATRIUM_SESSION_ID, ATRIUM_SESSION_TOKEN)로 atrium child를 불러 만든다(리드가 칠 명령과 같은 길). 손자는 w2의 env로.
// MT_P75_STAGE=before(고치기 전 코드) | after(고친 코드) | clean(세션 끄기, 판 멈추기, 시험 워크트리 지우기)
// 사용: node experiments/p75/tools/e2e.cjs p75-worker-line.mjs before|after|clean
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p75') throw new Error('MT_E2E_OUT=p75를 명령줄에서 준다');
const STAGE = process.env.MT_P75_STAGE;
if (!['before', 'after', 'clean'].includes(STAGE)) throw new Error('MT_P75_STAGE=before|after|clean');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p75', 'tools', 'env.cjs'));
const ENV = T.P75_ENV;
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p75' || ENV.ATRIUM_PORT !== '47896') throw new Error('P75 판(atrium-dev-p75, 47896)만');
if (!/^C:\\Workspace\\mtask-p75-/.test(T.REPO)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p75-*만: ${T.REPO}`);
fs.mkdirSync(OUT, { recursive: true });
const { areaKey, areaAnchorList, nestedRegions, regionConflicts } = await import(pathToFileURL(path.join(REPO, 'backend', 'src', 'worktree-areas.mjs')).href);

const log = logger(`p75-worker-line-${STAGE}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE|ATRIUM_|MTASK_|HERDR_)/.test(k)));
const env = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const GIT_ID = ['-c', 'user.name=p75', '-c', 'user.email=p75@example.invalid'];
const git = (...a) => execFileSync('git', ['-C', T.REPO, ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const WORKERS = ['w1', 'w2', 'w3', 'w4', 'w5'];
const GRAND = ['g1', 'g2'];
// 첫 요청: 리드가 일을 줄 때처럼 hook이 돌아 판이 워커의 폴더(claude -w가 들어간 워크트리)를 안다. 요청이 없으면 cwd가 저장소 그대로라 상자에 들지 않는다
const ASK = 'Reply with the single word ok and do nothing else.';
const NEED_TRUST =path.join(T.DEV, 'p75-need-trust.txt'); // 사람에게 신뢰 답을 부탁하는 한 줄(지휘 세션이 본다)
const wtDir = (n) => path.join(T.REPO, '.claude', 'worktrees', n);
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
      if (m && keyOf(m[1]) !== keyOf(T.REPO)) { try { git('worktree', 'remove', '--force', m[1]); log('워크트리 지움', path.basename(m[1])); } catch (e) { log('워크트리 지우기 실패', e.message.slice(0, 160)); } }
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
  app = await electron.launch({ args: ['.', '--dev', '--remote-debugging-port=9376'], cwd: APP_ROOT, env, timeout: 60000 });
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

// 판의 자리를 창과 같은 규칙으로 잰다(board.get의 노드·워크트리 자리 → 영역)
async function measure(label) {
  const g = await call('board.get');
  const byName = new Map();
  const sessions = await page.evaluate(() => [...window.__mt.getState().sessions.values()].map((s) => [s.sessionId, s.name]));
  const nameOf = new Map(sessions);
  const items = g.nodes.map((n) => ({ id: n.session_id, kind: 'node', ws: n.area ? areaKey(n.workspace_key, n.area) : n.workspace_key, x: n.x, y: n.y, w: n.w, h: n.h, area: n.area || '' }));
  for (const it of items) byName.set(nameOf.get(it.id), it);
  const regs = nestedRegions(areaAnchorList(g.workspaces), items);
  const blockOf = (n) => { const it = byName.get(n); if (!it) return null; return it.area ? regs.get(it.ws) : it; };
  const ws = WORKERS.map((n) => ({ name: n, block: blockOf(n), area: byName.get(n) ? byName.get(n).area : null }));
  const xs = ws.map((w) => w.block && Math.round(w.block.x));
  const cols = new Set(xs).size;
  const ordered = ws.every((w, i) => i === 0 || (w.block && ws[i - 1].block && w.block.y > ws[i - 1].block.y + ws[i - 1].block.h - 1));
  let overl = 0;
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) { const a = ws[i].block, b = ws[j].block; if (a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overl++; }
  const lead = byName.get('lead');
  const right = ws.every((w) => w.block && lead && w.block.x >= lead.x + lead.w);
  const w2 = byName.get('w2');
  const grand = GRAND.map((n) => byName.get(n)).filter(Boolean);
  const grandRight = grand.length === 2 && w2 && grand.every((r) => r.x >= w2.x + w2.w) && grand[0].y < grand[1].y;
  const conflicts = [...regionConflicts(regs, items)];
  const m = { label, cols, xs, ordered, overlaps: overl, workersRightOfLead: right, grandRightOfW2: grandRight, conflicts: conflicts.length, boxes: ws.map((w) => ({ n: w.name, area: !!w.area, x: w.block && Math.round(w.block.x), y: w.block && Math.round(w.block.y), w: w.block && Math.round(w.block.w), h: w.block && Math.round(w.block.h) })), grand: grand.map((r) => ({ x: r.x, y: r.y })) };
  log(`잼 ${label}`, m);
  return m;
}

try {
  // ---------- 준비 ----------
  for (const d of [T.PROJECTS, T.SESSIONS]) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(path.join(T.REPO, '.git'))) {
    fs.mkdirSync(T.REPO, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', T.REPO]);
    fs.writeFileSync(path.join(T.REPO, 'README.md'), '# p75 test repo\n');
    git('add', 'README.md'); git(...GIT_ID, 'commit', '-q', '-m', 'init');
  }
  await open();
  if (!(await sess('lead'))) log(atrium('spawn', T.REPO, '--name', 'lead', '--model', 'haiku').trim().split('\n').slice(-3).join(' | '));
  await until(async () => !!(await sess('lead')), 60000);
  // 신뢰: 사람이 @lead 노드에서 답할 때까지 기다린다
  const t0 = await until(async () => { const s = await sess('lead'); return s && ['trust_wait', 'ready', 'working'].includes(s.state) ? s.state : null; }, 120000);
  if (t0 === 'trust_wait') {
    await page.evaluate(async (n) => { const st = window.__mt.getState(); const s = [...st.sessions.values()].find((x) => x.name === n); st.navigateTo(s.sessionId); }, 'lead');
    await sleep(1200);
    await shot(`p75-${STAGE}-0-trust`);
    log('사람 차례: 개발용 판의 @lead 노드에서 신뢰 질문에 답해 주세요(시험은 대신 답하지 않는다)');
    fs.writeFileSync(NEED_TRUST, 'Dev board atrium-dev-p75 (port 47896) window: on the @lead node, answer the folder trust question for the test repo mtask-p75-repo ("Yes, I trust this folder").\n');
  }
  const ready = await until(async () => (await sess('lead'))?.state === 'ready', 60 * 60000, 2000);
  try { fs.rmSync(NEED_TRUST, { force: true }); } catch {}
  step('준비: 리드가 시험 저장소에서 떴다', !!ready, await sess('lead'));
  if (!ready) throw new Error('리드가 ready가 되지 않았다(신뢰를 받지 못함)');

  // ---------- 워커 다섯(--worktree), 손자 둘 ----------
  const leadEnv = await envOf('lead');
  for (const n of WORKERS) if (!(await sess(n))) child(leadEnv, n, ['--worktree', n, '--prompt', ASK]);
  const up = await until(async () => { await call('worktree.sync').catch(() => {}); const g = await call('board.get'); const ids = await Promise.all(WORKERS.map(sess)); return ids.every((s) => s && g.nodes.find((n) => n.session_id === s.id && n.area)); }, 4 * 60000, 3000);
  step('워커 다섯이 각자 워크트리 상자에', !!up);
  const w2Env = await envOf('w2');
  for (const n of GRAND) if (!(await sess(n))) child(w2Env, n, ['--prompt', ASK]);
  await until(async () => (await Promise.all(GRAND.map(sess))).every(Boolean), 90000, 1000);
  await sleep(4000);
  await call('worktree.sync').catch(() => {});
  await sleep(1500);
  await fitRepo();
  await shot(`p75-${STAGE}-1-spawned`);
  const m1 = await measure('spawned');
  step('띄운 직후: 워커 상자가 한 열', m1.cols === 1, m1.xs);
  step('띄운 직후: 띄운 순서대로 위에서 아래', m1.ordered);
  step('띄운 직후: 겹침 없음', m1.overlaps === 0 && m1.conflicts === 0, { overlaps: m1.overlaps, conflicts: m1.conflicts });
  step('띄운 직후: 손자 둘은 w2 오른쪽에 순서대로', m1.grandRightOfW2, m1.grand);
  // 순서 번호(역할 칩)
  const chips = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.mt-node')].map((e) => { const c = e.querySelector('[data-role=branch]'); return [e.dataset.name, c ? c.textContent : null]; })));
  log('역할 칩', chips);
  if (STAGE === 'after') step('역할 칩에 띄운 순서', WORKERS.every((n, i) => !chips[n] || new RegExp(` ${i + 1} · |^level |단계$`).test(chips[n])) && (await Promise.all(WORKERS.map(sess))).every((s, i) => s.branch && s.branch.order === i + 1), chips);

  // ---------- 영역 정리 버튼 ----------
  const head = page.locator(`.mt-region[data-ws="${repoKey}"] .mt-region-head`).first();
  let clicked = false;
  try { await head.hover({ timeout: 5000 }); await sleep(400); await page.locator(`.mt-region[data-ws="${repoKey}"] [data-action=arrange]`).first().click({ timeout: 5000 }); clicked = true; } catch (e) { log('정리 버튼을 누르지 못해 API로', e.message.slice(0, 160)); await call('board.arrange', { workspace: repoKey, apply: true }); }
  await sleep(2500);
  await fitRepo();
  await shot(`p75-${STAGE}-2-arranged`);
  const m2 = await measure('arranged');
  step('정리 뒤: 워커 상자가 한 열', m2.cols === 1, { clicked, xs: m2.xs });
  step('정리 뒤: 띄운 순서대로', m2.ordered);
  step('정리 뒤: 워커가 리드 오른쪽', m2.workersRightOfLead);
  step('정리 뒤: 겹침 없음', m2.overlaps === 0 && m2.conflicts === 0, { overlaps: m2.overlaps, conflicts: m2.conflicts });

  // ---------- 워커 하나를 크게 ----------
  await call('board.setSize', { session: (await sess('w1')).id, size: 'wide-large' });
  await sleep(2500);
  await fitRepo();
  await shot(`p75-${STAGE}-3-resized`);
  const m3 = await measure('resized');
  step('크게 바꾼 뒤: 한 열, 순서, 겹침 없음', m3.cols === 1 && m3.ordered && m3.overlaps === 0 && m3.conflicts === 0, { xs: m3.xs, ordered: m3.ordered, overlaps: m3.overlaps, conflicts: m3.conflicts });
  fs.writeFileSync(path.join(OUT, `p75-measure-${STAGE}.json`), JSON.stringify([m1, m2, m3], null, 2));
} catch (e) {
  step('예외', false, e.stack);
  try { await shot(`p75-${STAGE}-error`); } catch {}
} finally {
  fs.writeFileSync(path.join(OUT, `p75-results-${STAGE}.json`), JSON.stringify(results, null, 2));
  log('결과', `${results.filter((r) => r.ok).length}/${results.length}`);
  if (app) await closeApp(app);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
