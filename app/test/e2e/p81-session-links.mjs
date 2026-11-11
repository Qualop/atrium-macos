// P81 창 시험: 세션 연결 읽기(atrium me), 부모에서 떼기(노드 메뉴, 선 끊기 확인의 두 고르기), 처음부터 헤드로 띄우기(atrium child --head).
// 고치기 전(v0.1.3 코드)과 고친 뒤를 같은 단계로 찍는다. 고치기 전에는 없는 것(메뉴 줄, 고르기, atrium me, --head)을 "없음"으로 남긴다.
// 판: herdr 세션 atrium-dev-p81, 포트 47898, 이 워크트리의 backend/.dev(experiments/p81/tools/env.cjs). 창의 원격 디버깅 포트 9378.
// 리드(lead)는 시험 저장소 C:\Workspace\mtask-p75-repo(새로 만든 git 저장소, 사람이 이 경로의 신뢰를 이미 주었다)에서 띄운다. 신뢰 질문이 뜨면
// backend/.dev/p81-need-trust.txt에 한 줄을 두고 사람이 답할 때까지 기다린다(대신 답하지 않는다). 다른 워크스페이스는 git이 아닌 새 폴더 C:\Workspace\mtask-p81-head.
// 하위 세션은 리드의 세션 설정 파일 env(ATRIUM_SESSION_ID, ATRIUM_SESSION_TOKEN)로 atrium child를 불러 만든다(리드가 칠 명령과 같은 길).
// MT_P81_STAGE=before | after | clean. before 뒤 after는 리드를 그대로 두고(백엔드만 새 코드로) 이미 떠 있던 세션이 새 안내·스킬을 읽는지도 잰다.
// 사용: backend/.dev/clean-env.sh env MT_E2E_OUT=p81 MT_P81_STAGE=before node app/test/e2e/p81-session-links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, execFile } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p81') throw new Error('MT_E2E_OUT=p81을 명령줄에서 준다');
const STAGE = process.env.MT_P81_STAGE;
if (!['before', 'after', 'clean'].includes(STAGE)) throw new Error('MT_P81_STAGE=before|after|clean');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p81', 'tools', 'env.cjs'));
const ENV = T.P81_ENV;
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p81' || ENV.ATRIUM_PORT !== '47898') throw new Error('P81 판(atrium-dev-p81, 47898)만');
if (T.REPO !== 'C:\\Workspace\\mtask-p75-repo' || !/^C:\\Workspace\\mtask-p81-/.test(T.HEAD)) throw new Error('시험 폴더가 다르다');
fs.mkdirSync(OUT, { recursive: true });

const log = logger(`p81-session-links-${STAGE}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE|ATRIUM_|MTASK_|HERDR_)/.test(k)));
const env = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 300000 });
const GIT_ID = ['-c', 'user.name=p81', '-c', 'user.email=p81@example.invalid'];
const git = (...a) => execFileSync('git', ['-C', T.REPO, ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const note = (name, detail) => { results.push({ name, ok: true, note: true, detail }); log(`기록 ${name}`, detail ?? ''); };
const P = STAGE === 'before' ? 'b' : 'a';
const N = { b: `${P}b`, c: `${P}c`, d: `${P}d`, h: `${P}h` };
const ASK = 'Reply with the single word ok and do nothing else.';
const NEED_TRUST = path.join(T.DEV, 'p81-need-trust.txt');
const keyOf = (p) => p.replace(/\\/g, '/').toLowerCase();
const repoKey = keyOf(path.join(T.REPO, '.git'));
const headKey = keyOf(T.HEAD);
const save = (name, text) => fs.writeFileSync(path.join(OUT, `${name}.txt`), String(text));
async function until(fn, ms, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } }

// ---------- 정리 ----------
if (STAGE === 'clean') {
  let names = [];
  try { names = JSON.parse(atrium('--json', 'ls')).map((s) => s.name); } catch (e) { try { names = JSON.parse(atrium('ls', '--json')).map((s) => s.name); } catch (e2) { log('목록 실패', e2.message.slice(0, 200)); } }
  for (const n of names) { try { log('끄기', atrium('kill', n, '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('끄기 실패', n, e.message.slice(0, 160)); } }
  try { log('herdr 멈춤', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { log('herdr 멈춤 실패', e.message.slice(0, 200)); }
  try { log('백엔드 멈춤', atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log('백엔드 멈춤 실패', e.message.slice(0, 200)); }
  process.exit(0);
}

let app = null, page = null;
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const sess = (name) => page.evaluate((n) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === n); return s ? { id: s.sessionId, state: s.state, cwd: s.cwd, ws: s.workspaceKey, branch: s.branch || null } : null; }, name);
const shot = async (name) => { const f = path.join(OUT, `${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.relative(REPO, f)); };
const fit = async (k) => { await page.evaluate((kk) => window.__mt.getState().fitWorkspace(kk), k); await sleep(1200); };
const go = async (name) => { const s = await sess(name); if (s) await page.evaluate((id) => window.__mt.getState().navigateTo(id), s.id); await sleep(1200); };

async function open() {
  // 백엔드를 창보다 먼저 CLI로 띄운다. 창이 띄운 백엔드와 herdr는 창의 원격 디버깅 포트(9378)를 물려받아 창을 닫은 뒤에도 붙잡는다
  try { log('백엔드', atrium('backend', 'start').trim().slice(0, 160)); } catch (e) { log('백엔드 시작 실패', e.message.slice(0, 200)); }
  try { atrium('settings', 'set', 'tray', 'off'); } catch (e) { log('트레이 끄기 실패', e.message.slice(0, 120)); }
  app = await electron.launch({ args: ['.', '--dev', '--remote-debugging-port=9378'], cwd: APP_ROOT, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
  await page.evaluate(() => window.__mt.pinBottom && window.__mt.pinBottom(true));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1584, 921));
  await sleep(1000);
  try { atrium('settings', 'set', 'language', 'ko'); } catch (e) { log('언어 설정 실패', e.message.slice(0, 120)); }
  await sleep(800);
  if (!(await page.locator('.mt-sb2-row').count())) await page.locator('[data-action=sidebar]').first().click().catch(() => {});
  await sleep(800);
}
// 노드 머리줄의 단추는 마우스를 올려야 보인다
// 노드가 커서(1440×810) 맞추면 배율이 0.7 아래라 머리줄 단추가 숨는다(.z-small). 배율 0.8로 머리줄 왼쪽을 화면에 둔다
const zoomOn = async (name) => { const s = await sess(name); await page.evaluate((id) => { const st = window.__mt.getState(); const r = st.nodes.get(id); st.setViewport({ x: 200 - r.x * 0.8, y: 160 - r.y * 0.8, zoom: 0.8 }); }, s.id); await sleep(900); };
const nodeMenu = async (name) => { await zoomOn(name); const h = page.locator(`.mt-node[data-name="${name}"]`).first(); await h.hover({ timeout: 5000 }).catch(() => {}); await sleep(300); await page.locator(`.mt-node[data-name="${name}"] [data-action=node-menu]`).first().click({ timeout: 5000, force: true }); await sleep(600); };
const envOf = async (name) => {
  const s = await sess(name);
  const settings = JSON.parse(fs.readFileSync(path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${s.id}.json`), 'utf8'));
  const e = { ...env, ...Object.fromEntries(Object.entries(settings.env || {}).filter(([k]) => k.startsWith('ATRIUM_'))) };
  if (e.ATRIUM_SESSION_ID !== s.id || !e.ATRIUM_SESSION_TOKEN) throw new Error(`${name} 설정 파일에 세션 env가 없다`);
  return e;
};
// 하위 세션 명령(그 세션의 env로). 실패해도 출력을 돌려준다
const cmd = (pe, args, ms = 150000) => new Promise((resolve) => execFile(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), ...args], { encoding: 'utf8', env: pe, timeout: ms }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout || ''}${stderr ? `\n[stderr]\n${stderr}` : ''}`.trim() })));
// 창에서 읽기: 노드 머리줄의 역할 칩, 사이드바 줄(들여쓰기, 역할), 미션 맵
const chip = (name) => page.evaluate((n) => { const e = document.querySelector(`.mt-node[data-name="${n}"] [data-role=branch]`); return e ? e.textContent : null; }, name);
const sideRow = (name) => page.evaluate((n) => { const e = document.querySelector(`.mt-sb2-row[data-name="${n}"]`); if (!e) return null; const r = e.querySelector('.mt-sb2-role'); return { indent: e.dataset.indent, pad: e.style.paddingLeft, role: r ? r.textContent : null }; }, name);
async function mission(name) {
  try {
    await page.locator('[data-action=conn-mission]').first().click({ timeout: 5000 });
    await sleep(1500);
    await shot(name);
  } catch (e) { log('미션 맵을 열지 못했다', e.message.slice(0, 160)); }
  try { await page.keyboard.press('Escape'); await sleep(400); if (await page.evaluate(() => window.__mt.getState().missionOpen)) await page.locator('[data-action=conn-mission]').first().click({ timeout: 3000 }); } catch {}
  await sleep(500);
}
async function view(name) {
  const s = await sess(name);
  return { parent: s && s.branch ? s.branch.parentName : null, parentSessionId: s && s.branch ? s.branch.parentSessionId : null, child: s && s.branch ? s.branch.child : null, role: s && s.branch ? s.branch.role : null, depth: s && s.branch ? s.branch.depth : null, chip: await chip(name), side: await sideRow(name) };
}
const linkBetween = async (from, to) => { const g = await call('link.list').catch(() => null); const list = Array.isArray(g) ? g : (g && g.links) || []; const a = await sess(from), b = await sess(to); return list.find((l) => l.from === a.id && l.to === b.id && !l.removedAt) || null; };
async function openLinkPanel(from, to) {
  const l = await linkBetween(from, to);
  if (!l) return null;
  await go(to);
  const el = page.locator(`[data-link="${l.linkId}"]`).first();
  try { await el.click({ timeout: 5000, force: true }); } catch (e) {
    log('선 이름표가 화면 밖이라 요소를 직접 누른다', e.message.slice(0, 120));
    const ok = await page.evaluate((id) => { const x = document.querySelector(`[data-link="${id}"]`); if (!x) return false; x.click(); return true; }, l.linkId);
    if (!ok) return null;
  }
  await page.waitForSelector('[data-role=link-panel]', { timeout: 5000 }).catch(() => {});
  await sleep(600);
  return l;
}
async function spawnChild(pe, name, extra) {
  const r = await cmd(pe, ['child', name, ...extra, '--model', 'haiku']);
  save(`p81-${STAGE}-child-${name}`, r.out);
  log(`atrium child ${name}`, r.out.slice(0, 500));
  await until(async () => { const s = await sess(name); return s && ['ready', 'working'].includes(s.state); }, 120000, 1000);
  return r;
}

try {
  // ---------- 준비 ----------
  fs.mkdirSync(T.PROJECTS, { recursive: true });
  fs.mkdirSync(T.HEAD, { recursive: true });
  if (!fs.existsSync(path.join(T.REPO, '.git'))) {
    fs.mkdirSync(T.REPO, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', T.REPO]);
    fs.writeFileSync(path.join(T.REPO, 'README.md'), '# p81 test repo\n');
    git('add', 'README.md'); git(...GIT_ID, 'commit', '-q', '-m', 'init');
  }
  await open();
  if (!(await sess('lead'))) log(atrium('spawn', T.REPO, '--name', 'lead', '--model', 'haiku').trim().split('\n').slice(-3).join(' | '));
  await until(async () => !!(await sess('lead')), 60000);
  const t0 = await until(async () => { const s = await sess('lead'); return s && ['trust_wait', 'ready', 'working'].includes(s.state) ? s.state : null; }, 120000);
  if (t0 === 'trust_wait') {
    await go('lead');
    await shot(`p81-${STAGE}-0-trust`);
    log('사람 차례: 개발용 판의 @lead 노드에서 신뢰 질문에 답해 주세요(시험은 대신 답하지 않는다)');
    fs.writeFileSync(NEED_TRUST, 'Dev board atrium-dev-p81 (port 47898) window: on the @lead node, answer the folder trust question for C:\\Workspace\\mtask-p75-repo ("Yes, I trust this folder").\n');
  }
  const ready = await until(async () => (await sess('lead'))?.state === 'ready', 60 * 60000, 2000);
  try { fs.rmSync(NEED_TRUST, { force: true }); } catch {}
  step('준비: 리드가 시험 저장소에서 떴다', !!ready, await sess('lead'));
  if (!ready) throw new Error('리드가 ready가 되지 않았다');
  const leadEnv = await envOf('lead');

  // ---------- 이미 떠 있던 세션(고치기 전 코드로 띄운 리드)이 새 안내·스킬을 읽는가. 새로 띄운 세션(ab)과 같은 물음으로 견준다 ----------
  const ASKS = [
    ['me', 'Run the shell command `atrium me` exactly once and reply with only its first output line.'],
    ['prompt', 'Answer only yes or no, without running anything: does your system prompt mention the command `atrium me`?'],
    ['skill', 'Invoke the skill atrium-herdr:atrium, then answer only yes or no: does that skill text mention `atrium me` or `--head`?'],
  ];
  async function askAll(name, tag) {
    for (const [k, q] of ASKS) {
      log(`${name}에게(${k})`, atrium('send', `@${name}`, q, '--wait').trim().slice(0, 200));
      await until(async () => (await sess(name))?.state !== 'ready', 30000, 500); // 턴이 시작되기를
      const done = await until(async () => { const s = await sess(name); return s && ['waiting', 'ready'].includes(s.state) ? s.state : null; }, 180000, 1500);
      let ans = '';
      if (done === 'waiting') {
        const g = atrium('get', name);
        ans = `(승인을 물었다) ${(/summary: '([^']*)'/.exec(g) || [])[1] || g.slice(0, 300)}`;
        await shot(`p81-after-${tag}-${k}-asks`);
        try { atrium('answer', name, 'reject'); } catch {}
        await until(async () => (await sess(name))?.state === 'ready', 90000, 1500);
        ans += ` → 거절 뒤 응답: ${atrium('last', name).trim().split('\n').slice(1).join(' ').slice(0, 200)}`;
      } else ans = atrium('last', name).trim().split('\n').slice(1).join(' ').slice(0, 400);
      save(`p81-after-${tag}-${k}`, ans);
      note(`${tag}: ${k}`, ans.slice(0, 300));
    }
  }
  if (STAGE === 'after') {
    for (const n of Object.values(N)) if (await sess(n)) { try { atrium('kill', n, '--yes'); } catch {} }
    await sleep(1500);
    await askAll('lead', 'old-lead');
  }

  // ---------- 1. A → B(다른 워크스페이스) ----------
  if (!(await sess(N.b))) await spawnChild(leadEnv, N.b, ['--cwd', T.HEAD.replace(/\\/g, '/'), '--prompt', ASK]);
  await sleep(3000);
  const b1 = await view(N.b);
  step('1. B가 다른 워크스페이스에 떴다', (await sess(N.b))?.ws === headKey, b1);
  await fit(headKey);
  await shot(`p81-${STAGE}-1-spawned`);
  await mission(`p81-${STAGE}-1-mission`);
  const bEnv = await envOf(N.b);
  const me1 = await cmd(bEnv, ['me']);
  save(`p81-${STAGE}-1-me-${N.b}`, me1.out);
  const meLead = await cmd(leadEnv, ['me']);
  save(`p81-${STAGE}-1-me-lead`, meLead.out);
  if (STAGE === 'after') {
    step('1. atrium me(B): 부모 lead와 역할', me1.code === 0 && /부모: @lead/.test(me1.out) && /워커/.test(me1.out), me1.out);
    step('1. atrium me(A): 하위 세션 B', meLead.code === 0 && new RegExp(`@${N.b}`).test(meLead.out), meLead.out);
    const js = await cmd(bEnv, ['me', '--json']);
    let j = null; try { j = JSON.parse(js.out); } catch {}
    step('1. atrium me --json', !!(j && j.parent && j.parent.name === 'lead'), js.out.slice(0, 400));
    await askAll(N.b, 'new-ab'); // 새 코드로 띄운 세션은 새 안내·스킬·승인 규칙을 가진다(견주기)
  } else note('1. atrium me(고치기 전)', me1.out.slice(0, 300));

  // ---------- 2. 노드 메뉴로 떼기(고치기 전: 메뉴에 없다 → 선만 끊고 남는 것을 잰다) ----------
  await go(N.b);
  await nodeMenu(N.b);
  await shot(`p81-${STAGE}-2-menu`);
  const hasDetach = await page.locator('[data-role=node-menu] [data-action=detach]').count();
  if (STAGE === 'after') {
    step('2. 노드 메뉴에 "부모에서 떼기"', hasDetach === 1);
    await page.locator('[data-role=node-menu] [data-action=detach]').first().click();
    await sleep(800);
    await shot(`p81-${STAGE}-2-menu-confirm`);
    const msg = await page.locator('[data-role=node-menu] [data-role=detach-ask]').first().textContent().catch(() => null);
    note('2. 떼기 확인 글', msg);
    await page.locator('[data-role=node-menu] [data-action=detach-confirm]').first().click();
    await sleep(2500);
  } else {
    note('2. 노드 메뉴에 "부모에서 떼기"(고치기 전)', hasDetach ? '있음' : '없음');
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('[data-role=node-menu] [data-action=menu-close]').first().click({ timeout: 3000 }).catch(() => {});
    const l = await openLinkPanel('lead', N.b);
    if (l) {
      await page.locator('[data-role=link-panel] [data-action=unlink]').first().click();
      await sleep(700);
      await shot(`p81-${STAGE}-2-cut-confirm`);
      await page.locator('[data-role=link-panel] [data-action=unlink-confirm]').first().click();
      await sleep(2500);
    } else log('선을 찾지 못했다');
  }
  const b2 = await view(N.b);
  const kids2 = await cmd(leadEnv, ['children']);
  const wait2 = await cmd(leadEnv, ['child-wait', N.b, '--json'], 30000);
  const me2 = await cmd(bEnv, ['me']);
  save(`p81-${STAGE}-2-children-lead`, kids2.out); save(`p81-${STAGE}-2-childwait`, wait2.out); save(`p81-${STAGE}-2-me-${N.b}`, me2.out);
  const m2 = { view: b2, inChildren: new RegExp(`@${N.b} `).test(kids2.out), childWaitScope: !/not_parent/.test(wait2.out) };
  fs.writeFileSync(path.join(OUT, `p81-${STAGE}-2-measure.json`), JSON.stringify(m2, null, 2));
  await fit(headKey);
  await shot(`p81-${STAGE}-2-after-board`);
  await mission(`p81-${STAGE}-2-mission`);
  if (STAGE === 'after') {
    step('2. 뗀 뒤: 부모 기록 없음, 머리줄·사이드바 역할 없음', !b2.parentSessionId && !b2.role && !(b2.chip || '').includes('lead') && !(b2.side && b2.side.role), b2);
    step('2. 뗀 뒤: atrium children에 없고 child-wait(끄기 범위)는 not_parent', !m2.inChildren && !m2.childWaitScope, { children: kids2.out, wait: wait2.out.slice(0, 200) });
    step('2. 뗀 뒤: atrium me(B)는 부모 없음', /부모 없음/.test(me2.out), me2.out);
  } else note('2. 선만 끊은 뒤 남는 것(고치기 전)', m2);

  // ---------- 3. 선 끊기 확인의 두 고르기 ----------
  if (!(await sess(N.c))) await spawnChild(leadEnv, N.c, ['--prompt', ASK]);
  await sleep(2000);
  const lc = await openLinkPanel('lead', N.c);
  if (lc) {
    await page.locator('[data-role=link-panel] [data-action=unlink]').first().click();
    await sleep(700);
    await shot(`p81-${STAGE}-3-cut-choices`);
    const choices = await page.locator('[data-role=link-panel] [data-action^=unlink-]').evaluateAll((es) => es.map((e) => `${e.dataset.action}:${e.textContent}`));
    note('3. 끊기 확인의 단추', choices);
    if (STAGE === 'after') step('3. 부모 → 하위 세션 선의 끊기 확인에 두 고르기', choices.some((c) => c.startsWith('unlink-confirm')) && choices.some((c) => c.startsWith('unlink-detach')), choices);
    await page.locator('[data-role=link-panel] [data-action=unlink-confirm]').first().click();
    await sleep(2500);
  } else step('3. 리드 → C 선', false);
  const c3 = await view(N.c);
  step('3. "선만 끊기" 뒤 C의 부모는 남는다', c3.parentSessionId && c3.parent === 'lead', c3);
  if (STAGE === 'after') {
    if (!(await sess(N.d))) await spawnChild(leadEnv, N.d, ['--prompt', ASK]);
    await sleep(2000);
    const ld = await openLinkPanel('lead', N.d);
    if (ld) {
      await page.locator('[data-role=link-panel] [data-action=unlink]').first().click();
      await sleep(700);
      await page.locator('[data-role=link-panel] [data-action=unlink-detach]').first().click();
      await sleep(2500);
    }
    const d3 = await view(N.d);
    step('3. "부모에서도 떼기" 뒤 D는 부모 없음', !d3.parentSessionId && !d3.role, d3);
    await fit(repoKey);
    await shot(`p81-${STAGE}-3-after-board`);
  }

  // ---------- 4. --head ----------
  const hr = await cmd(leadEnv, ['child', N.h, '--head', '--cwd', T.HEAD.replace(/\\/g, '/'), '--prompt', ASK, '--model', 'haiku']);
  save(`p81-${STAGE}-4-child-head`, hr.out);
  if (STAGE === 'after') {
    step('4. --head 응답 글', hr.code === 0 && /헤드로 띄웠다/.test(hr.out) && /너의 워커가 아니다/.test(hr.out), hr.out);
    await until(async () => { const s = await sess(N.h); return s && !s.branch.parentSessionId; }, 60000, 1000);
    const h4 = await view(N.h);
    step('4. 첫 요청 뒤 판이 부모 관계를 뗐다', !h4.parentSessionId && !h4.role, h4);
    const g = await call('board.get');
    const hs = await sess(N.h), bs = await sess(N.b);
    const hn = g.nodes.find((n) => n.session_id === hs.id), bn = g.nodes.find((n) => n.session_id === bs.id);
    note('4. 헤드 노드 자리', { head: hn && { x: hn.x, y: hn.y, w: hn.w, h: hn.h }, b: bn && { x: bn.x, y: bn.y } });
    const hEnv = await envOf(N.h);
    const meh = await cmd(hEnv, ['me']);
    save(`p81-${STAGE}-4-me-${N.h}`, meh.out);
    step('4. atrium me(헤드)는 부모 없음', /부모 없음/.test(meh.out), meh.out);
  } else note('4. --head(고치기 전)', hr.out.slice(0, 400));
  await sleep(2000);
  await fit(headKey);
  await shot(`p81-${STAGE}-4-head-board`);
  await mission(`p81-${STAGE}-4-mission`);
  const meLead4 = await cmd(leadEnv, ['me']);
  save(`p81-${STAGE}-4-me-lead`, meLead4.out);

  // ---------- 5. 판 전체 ----------
  await page.evaluate(() => window.__mt.getState().fitAll && window.__mt.getState().fitAll());
  await sleep(1200);
  await shot(`p81-${STAGE}-5-board`);
  const views = {};
  for (const n of ['lead', ...Object.values(N)]) if (await sess(n)) views[n] = await view(n);
  fs.writeFileSync(path.join(OUT, `p81-${STAGE}-5-views.json`), JSON.stringify(views, null, 2));
  log('끝 모습', views);
} catch (e) {
  step('예외', false, e.stack);
  try { await shot(`p81-${STAGE}-error`); } catch {}
} finally {
  fs.writeFileSync(path.join(OUT, `p81-results-${STAGE}.json`), JSON.stringify(results, null, 2));
  log('결과', `${results.filter((r) => r.ok).length}/${results.length}`);
  if (app) await closeApp(app);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
