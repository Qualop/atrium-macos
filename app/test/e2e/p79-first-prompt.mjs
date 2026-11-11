// P79 창 시험: atrium child --prompt의 첫 요청이 들어가는가. 리드(claude haiku)의 env로 워크트리 워커 여덟(--worktree, haiku)과
// 워크트리 없는 워커 여덟을 --prompt로 띄우고, 저마다 첫 요청이 hook UserPromptSubmit으로 한 번 들어가는지 잰다.
// 들어가지 않은 것은 그때의 전달 기록(상태·이유·시도 수), herdr 상태, hook 시각, 화면(보낸 뒤 6초, 확인 못 함 때)을 남긴다.
// 판: herdr 세션 atrium-dev-p79, 포트 47899, 이 워크트리의 backend/.dev(experiments/p79/tools/env.cjs). 창의 원격 디버깅 포트 9379.
// 시험 저장소는 P75·P78과 같은 경로를 새로 만든다(사용자가 그 경로의 신뢰를 이미 주었다). 신뢰 질문이 뜨면 대신 답하지 않고(CLAUDE.md)
// backend/.dev/p79-need-trust.txt에 한 줄을 두고 사람이 판의 @lead 노드에서 답할 때까지 기다린다(60분).
// MT_P79_STAGE=before(고치기 전 코드) | after(고친 코드) | clean(세션 끄기, 판 멈추기, 시험 워크트리 지우기)
// 사용: node experiments/p79/tools/e2e.cjs p79-first-prompt.mjs before|after|clean
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p79') throw new Error('MT_E2E_OUT=p79를 명령줄에서 준다');
const STAGE = process.env.MT_P79_STAGE;
if (!['before', 'after', 'clean'].includes(STAGE)) throw new Error('MT_P79_STAGE=before|after|clean');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p79', 'tools', 'env.cjs'));
const ENV = T.P79_ENV;
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p79' || ENV.ATRIUM_PORT !== '47899') throw new Error('P79 판(atrium-dev-p79, 47899)만');
if (!/^C:\\Workspace\\mtask-p7[59]-/.test(T.REPO)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p75-* 또는 mtask-p79-*만: ${T.REPO}`);
fs.mkdirSync(OUT, { recursive: true });

const log = logger(`p79-first-prompt-${STAGE}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE|ATRIUM_|MTASK_|HERDR_)/.test(k)));
const env = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const GIT_ID = ['-c', 'user.name=p79', '-c', 'user.email=p79@example.invalid'];
const git = (...a) => execFileSync('git', ['-C', T.REPO, ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const N = Number(process.env.MT_P79_N || 8);
const WT = Array.from({ length: N }, (_, i) => `wt${i + 1}`);
const PL = Array.from({ length: N }, (_, i) => `pl${i + 1}`);
const ASK = (n) => `Reply with the single word ok-${n} and do nothing else.`;
const NEED_TRUST = path.join(T.DEV, 'p79-need-trust.txt');
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
      if (m && keyOf(m[1]) !== keyOf(T.REPO)) { try { git('worktree', 'remove', '--force', '--force', m[1]); log('워크트리 지움', path.basename(m[1])); } catch (e) { log('워크트리 지우기 실패', e.message.slice(0, 160)); } }
    }
    git('worktree', 'prune');
    for (const b of git('branch', '--format=%(refname:short)').split(/\r?\n/).filter((x) => x && x !== 'main')) { try { git('branch', '-D', b); } catch {} }
  }
  process.exit(0);
}

let app = null, page = null;
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sess = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, cwd: s.cwd } : null; }, name);
const shot = async (name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };

async function open() {
  app = await electron.launch({ args: ['.', '--dev', '--remote-debugging-port=9379'], cwd: APP_ROOT, env, timeout: 60000 });
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
const childOut = {};
const child = (pe, n, extra = []) => {
  const out = execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', n, ...extra, '--model', 'haiku', '--no-wait', '--json'], { encoding: 'utf8', env: pe, timeout: 120000 });
  try { childOut[n] = JSON.parse(out); } catch { childOut[n] = out; }
  log(`atrium child ${n}`, JSON.stringify(childOut[n].firstPrompt || null));
};
// 판 기록(읽기만): 세션별 전달·hook·상태
function records() {
  const db = new DatabaseSync(path.join(ENV.ATRIUM_DATA_DIR, 'board.db'), { readOnly: true });
  try {
    const names = Object.fromEntries(db.prepare('select session_id, name from sessions').all().map((r) => [r.session_id, r.name]));
    const ev = db.prepare("select t, session_id, kind, data from events where kind in ('delivery', 'hook', 'state', 'first_prompt_retry', 'first_prompt_lost') order by t").all();
    const by = {};
    for (const r of ev) {
      const n = names[r.session_id]; if (!n) continue;
      const d = JSON.parse(r.data || '{}');
      const x = (by[n] ||= { delivery: [], ups: [], state: [], other: [] });
      if (r.kind === 'delivery') x.delivery.push({ t: r.t, status: d.status, reason: d.reason, attempts: d.attempts });
      else if (r.kind === 'hook' && d.ev === 'UserPromptSubmit') x.ups.push({ t: r.t, prompt: d.prompt });
      else if (r.kind === 'hook') x.other.push({ t: r.t, ev: d.ev });
      else if (r.kind === 'state') x.state.push({ t: r.t, to: d.to, herdr: d.herdr, cause: d.cause });
      else x.other.push({ t: r.t, kind: r.kind, ...d });
    }
    return by;
  } finally { db.close(); }
}

try {
  for (const d of [T.PROJECTS, T.SESSIONS]) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(path.join(T.REPO, '.git'))) {
    fs.mkdirSync(T.REPO, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', T.REPO]);
    fs.writeFileSync(path.join(T.REPO, 'README.md'), '# p79 test repo\n');
    git('add', 'README.md'); git(...GIT_ID, 'commit', '-q', '-m', 'init');
  }
  await open();
  if (!(await sess('lead'))) log(atrium('spawn', T.REPO, '--name', 'lead', '--model', 'haiku').trim().split('\n').slice(-3).join(' | '));
  await until(async () => !!(await sess('lead')), 60000);
  const t0 = await until(async () => { const s = await sess('lead'); return s && ['trust_wait', 'ready', 'working'].includes(s.state) ? s.state : null; }, 120000);
  if (t0 === 'trust_wait') {
    log('사람 차례: 개발용 판의 @lead 노드에서 신뢰 질문에 답해 주세요(시험은 대신 답하지 않는다)');
    fs.writeFileSync(NEED_TRUST, 'Dev board atrium-dev-p79 (port 47899) window: on the @lead node, answer the folder trust question for the test repo mtask-p75-repo ("Yes, I trust this folder").\n');
  }
  const ready = await until(async () => (await sess('lead'))?.state === 'ready', 60 * 60000, 2000);
  try { fs.rmSync(NEED_TRUST, { force: true }); } catch {}
  step('준비: 리드가 시험 저장소에서 떴다', !!ready, await sess('lead'));
  if (!ready) throw new Error('리드가 ready가 되지 않았다(신뢰를 받지 못함)');

  // ---------- 워커 열여섯: 워크트리 여덟, 워크트리 없이 여덟(리드가 차례로 치는 것처럼) ----------
  const leadEnv = await envOf('lead');
  const spawnedAt = {};
  for (let i = 0; i < N; i++) {
    for (const [n, extra] of [[WT[i], ['--worktree', WT[i]]], [PL[i], []]]) { spawnedAt[n] = Date.now(); child(leadEnv, n, [...extra, '--prompt', ASK(n)]); }
  }
  // 보낸 뒤 6초에도 확인 못 한 것과 확인 못 함으로 끝난 것의 화면을 남긴다
  const screens = {};
  const ALL = [...WT, ...PL];
  const done = await until(async () => {
    const ds = await call('delivery.list', { limit: 200 });
    const firstOf = new Map();
    for (const d of ds) if (ALL.includes(d.name) && (!firstOf.has(d.name) || d.createdAt < firstOf.get(d.name).createdAt)) firstOf.set(d.name, d);
    for (const [n, d] of firstOf) {
      const key = d.status === 'sent' && d.sentAt && Date.now() - d.sentAt > 6000 ? `sent6s-a${d.attempts}` : d.status === 'unconfirmed' ? 'unconfirmed' : null;
      if (key && !(screens[n] && screens[n][key])) {
        try { const s = await sess(n); const r = await call('terminal.snapshot', { session: s.id, format: 'text' }); (screens[n] ||= {})[key] = { at: Date.now(), text: r.text.split(/\r?\n/).filter((l) => l.trim()).slice(-14).join('\n') }; } catch (e) { (screens[n] ||= {})[key] = { error: e.message }; }
      }
    }
    const final = ALL.every((n) => firstOf.has(n) && ['confirmed', 'unconfirmed', 'failed', 'cancelled'].includes(firstOf.get(n).status));
    return final ? firstOf : null;
  }, 5 * 60000, 1000);
  step('첫 요청 열여섯이 끝 상태에 닿음(5분 안)', !!done);
  await sleep(3000);
  await page.evaluate(() => window.__mt.getState().fitAll && window.__mt.getState().fitAll());
  await sleep(1200);
  await shot(`p79-${STAGE}-board`);

  const rec = records();
  const row = (n) => {
    const r = rec[n] || { delivery: [], ups: [], state: [], other: [] };
    const mine = r.ups.filter((u) => u.prompt && u.prompt.includes(`ok-${n} `));
    const t = (x) => (x ? x - spawnedAt[n] : null);
    const last = r.delivery[r.delivery.length - 1] || {};
    return {
      n, final: last.status || null, reason: last.reason || null, attempts: last.attempts || 0, submitted: mine.length,
      readyMs: t((r.state.find((s) => s.to === 'ready') || {}).t), sentMs: t((r.delivery.find((d) => d.status === 'sent') || {}).t), upsMs: t((mine[0] || {}).t),
      firstHook: r.other.length ? { ev: r.other[0].ev || r.other[0].kind, ms: t(r.other[0].t) } : null,
      states: r.state.map((s) => `${s.to}${s.herdr ? '/' + s.herdr : ''}@${t(s.t)}`),
      deliveries: r.delivery.map((d) => `${d.status}${d.reason ? '(' + d.reason + ')' : ''}#${d.attempts}@${t(d.t)}`),
      extra: r.other.filter((o) => o.kind).map((o) => `${o.kind}@${t(o.t)}`),
      screens: screens[n] || null,
    };
  };
  const wtRows = WT.map(row), plRows = PL.map(row);
  const okCount = (rows) => rows.filter((r) => r.submitted >= 1).length;
  log('워크트리 워커', wtRows.map((r) => [r.n, r.final, r.submitted, r.attempts]));
  log('워크트리 없는 워커', plRows.map((r) => [r.n, r.final, r.submitted, r.attempts]));
  step(`워크트리 워커 ${N}: 첫 요청이 모두 들어감(hook UserPromptSubmit)`, okCount(wtRows) === N, `${okCount(wtRows)}/${N}`);
  step(`워크트리 없는 워커 ${N}: 첫 요청이 모두 들어감`, okCount(plRows) === N, `${okCount(plRows)}/${N}`);
  step('같은 글이 두 번 들어가지 않음', [...wtRows, ...plRows].every((r) => r.submitted <= 1), [...wtRows, ...plRows].filter((r) => r.submitted > 1).map((r) => r.n));
  fs.writeFileSync(path.join(OUT, `p79-measure-${STAGE}.json`), JSON.stringify({ worktree: wtRows, plain: plRows, child: childOut }, null, 2));
} catch (e) {
  step('예외', false, e.stack);
  try { await shot(`p79-${STAGE}-error`); } catch {}
} finally {
  fs.writeFileSync(path.join(OUT, `p79-results-${STAGE}.json`), JSON.stringify(results, null, 2));
  log('결과', `${results.filter((r) => r.ok).length}/${results.length}`);
  if (app) await closeApp(app);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
