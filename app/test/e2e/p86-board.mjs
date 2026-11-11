// P86 창 시험: iPhone Safari가 보드 화면만 열자마자(1초 안) 죽는 문제. 흉내 원격(p59-lib.mjs, ts-sim-proxy.mjs)으로
//   휴대폰: 브라우저 문맥(iPhone 393×852, 화면 배율 3, 손가락) → ts-sim(47893) → 백엔드(47897). WebKit(Playwright)과 Safari UA를 준 Chromium 둘 다.
// 따로 띄운 개발용 판(atrium-dev-p86, 47897, backend/.dev)만 쓴다. PC 창은 띄우지 않고 짝 맺기 코드와 설정은 이 판의 CLI로 한다.
// 판은 실제 판과 비슷하게: 워크스페이스 3개, 세션 6개(긴 출력의 셸 4, haiku 2), 대화 노드 30개(고정 자료 ATRIUM_CLAUDE_PROJECTS)
// 단계: 1 보드를 열 때 받은 메시지(종류·바이트), 장면마다(PC가 남긴 자리 배율 1, 전체 맞춤, 배율 0.1·0.3·1) 터미널의 잰 글자 폭·높이, 칸·줄, DOM 셀 수,
//   DOM 수, 효과 요소(will-change·animation·filter)와 그 화면 장치 픽셀, Chromium 합성 레이어(CDP LayerTree), WebKit 웹 프로세스 메모리(Windows 프로세스 값)
//   2 가설 덜어 보기: 터미널 없음, 대화 노드 없음, 효과 끔(CSS)으로 같은 것을 다시 잰다
//   3(after) 단계 기록과 스스로 좁혀 가는 보드: CDP Page.crash 뒤 boot 줄의 steps, 다시 열기의 L1 → L2 …, 살아남은 단계 기억, 한 단계 무겁게·처음으로
// P86_STAGE=before: 고치기 전(재기만), after(기본): 고친 뒤(판정). P86_ENGINES=webkit,chromium(기본 둘 다). 결과는 experiments/p86/(git 밖).
// 실행: sh backend/.dev/clean-env.sh node app/test/e2e/p86-board.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const STAGE = process.env.P86_STAGE || 'after';
const ENGINES = (process.env.P86_ENGINES || 'webkit,chromium').split(',').filter(Boolean);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p86');
const CONVOS = path.join(OUT, 'convos');
const DIRS = ['a', 'b', 'c'].map((k) => `C:\\Workspace\\mtask-p86-${k}`);
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const B0 = L.board({ session: 'atrium-dev-p86', port: 47897, sim: 47893, sim2: 47894 });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p86',
  ATRIUM_TEST_PREFIX: 'p86-none-', // 시험 폴더(mtask-p86-*)의 고정 대화를 missed가 아니라 판의 대화 노드로 올린다
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},localhost:${B0.sim}`,
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
Object.assign(process.env, ENV);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true });
for (const d of DIRS) fs.mkdirSync(d, { recursive: true });
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const { chromium, webkit } = await import('playwright');

const log = logger(`p86-board-${STAGE}`);
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 120000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const judge = (name, ok, detail) => (STAGE === 'before' ? check(`[전] ${name}`, true, detail) : check(name, ok, detail));
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const W = 393, H = 852;
const PHONE = { viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI };
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const metrics = { stage: STAGE, engines: {}, crash: {} };

// ---- 고정 자료: 워크스페이스마다 대화 10개(대화 노드 30개) ----
function makeConvos() {
  fs.rmSync(CONVOS, { recursive: true, force: true });
  const now = Date.now();
  let n = 0;
  for (const [wi, cwd] of DIRS.entries()) {
    const dir = path.join(CONVOS, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 10; i++) {
      const cid = `${String(++n).padStart(8, '0')}-0000-4000-8000-00000000a086`;
      const at = now - (i * 2 + wi + 1) * 3600 * 1000;
      const ts = (s) => new Date(at + s * 1000).toISOString();
      const base = { cwd, entrypoint: 'cli', gitBranch: 'main', sessionId: cid };
      const long = Array.from({ length: 30 }, (_, k) => `step ${k + 1}: checked module ${k} and wrote a short note about it.`).join('\n');
      const lines = [
        JSON.stringify({ type: 'user', uuid: `u${cid}`, ...base, timestamp: ts(0), message: { role: 'user', content: `p86 task ${n}: look at the parser and write notes` } }),
        JSON.stringify({ type: 'assistant', uuid: `a${cid}`, ...base, timestamp: ts(40), message: { role: 'assistant', content: [{ type: 'text', text: `done ${n}\n${long}` }] } }),
        JSON.stringify({ type: 'ai-title', aiTitle: `p86 convo ${n}`, sessionId: cid }),
      ];
      const f = path.join(dir, `${cid}.jsonl`);
      fs.writeFileSync(f, lines.join('\n') + '\n');
      const t = new Date(at + 60000); fs.utimesSync(f, t, t);
    }
  }
}

// ---- 창 안에서 재는 것 ----
// 받은 메시지(종류와 바이트, 내용 없음): 페이지가 뜨기 전에 WebSocket을 감싼다
const WS_HOOK = () => {
  const Orig = window.WebSocket;
  window.__p86msgs = [];
  class Hooked extends Orig {
    constructor(...a) {
      super(...a);
      const sent = new Map();
      const send = this.send.bind(this);
      this.send = (d) => { try { const j = JSON.parse(d); sent.set(j.id, j.method); } catch {} return send(d); };
      this.addEventListener('message', (ev) => {
        const s = typeof ev.data === 'string' ? ev.data : '';
        let k = '?';
        try { const j = JSON.parse(s); k = j.event || `r:${sent.get(j.id)}`; } catch {}
        window.__p86msgs.push({ k, b: s.length, t: Math.round(performance.now()) });
      });
    }
  }
  window.WebSocket = Hooked;
};
const PROBE = `(() => {
  const mt = window.__mt; const st = mt.getState();
  const dpr = devicePixelRatio;
  const q = (s) => document.querySelectorAll(s).length;
  const out = { dpr, view: document.querySelector('[data-role=phone]') ? 'list' : document.querySelector('[data-role=phone-full]') ? 'full' : 'board',
    zoom: st.vpNow ? +st.vpNow.zoom.toFixed(3) : null, dom: document.getElementsByTagName('*').length,
    nodes: { session: q('.react-flow__node-session'), convo: q('.react-flow__node-convo'), memo: q('.react-flow__node-memo'), kanban: q('.react-flow__node-kanban'), region: q('.react-flow__node-region'), wtarea: q('.react-flow__node-wtarea') },
    faces: [...document.querySelectorAll('.mt-node[data-face]')].map((e) => e.dataset.face).join(','),
    edges: q('.react-flow__edge'), terms: [], level: mt.crash && mt.crash().level != null ? mt.crash().level : null, rootZoom: getComputedStyle(document.documentElement).zoom };
  for (const [id, tm] of mt.terms) {
    const cs = tm._core && tm._core._charSizeService;
    const rows = tm.element && tm.element.querySelector('.xterm-rows');
    const scr = tm.element && tm.element.querySelector('.xterm-screen');
    const r = scr ? scr.getBoundingClientRect() : null;
    out.terms.push({ id: id.slice(0, 8), cols: tm.cols, rows: tm.rows, cw: cs ? +cs.width.toFixed(3) : null, ch: cs ? +cs.height.toFixed(3) : null,
      rowEls: rows ? rows.children.length : 0, spans: rows ? rows.getElementsByTagName('span').length : 0,
      css: scr ? scr.offsetWidth + 'x' + scr.offsetHeight : null, screen: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null });
  }
  out.cells = out.terms.reduce((a, t) => a + t.spans, 0);
  // 합성 레이어가 될 만한 요소(will-change, 움직임, 필터, 뒤 흐림)와 그 화면 장치 픽셀
  let fx = 0, fxPx = 0, fxMax = 0, shadow = 0;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    const hot = (s.willChange && s.willChange !== 'auto') || (s.animationName && s.animationName !== 'none') || (s.filter && s.filter !== 'none') || (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none');
    if (s.boxShadow && s.boxShadow !== 'none') shadow++;
    if (!hot) continue;
    const r = el.getBoundingClientRect();
    const px = Math.max(0, r.width) * Math.max(0, r.height) * dpr * dpr;
    fx++; fxPx += px; fxMax = Math.max(fxMax, px);
  }
  out.fx = { n: fx, mpx: +(fxPx / 1e6).toFixed(1), maxMpx: +(fxMax / 1e6).toFixed(1), shadow };
  // 큰 요소: 배치 크기(변환 전 CSS px) 또는 스크롤 내용이 4M CSS px를 넘는 요소와, 합성 레이어를 만들 수 있는 값
  const giants = [];
  for (const el of document.querySelectorAll('body *')) {
    const w = el.offsetWidth || 0, h = el.offsetHeight || 0, sh = el.scrollHeight || 0, sw = el.scrollWidth || 0;
    const area = Math.max(w * h, sw * sh);
    if (area < 4e6) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    giants.push({ cls: String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className).slice(0, 60), tag: el.tagName.toLowerCase(), box: w + 'x' + h, scroll: sw + 'x' + sh, screen: Math.round(r.width) + 'x' + Math.round(r.height),
      ov: s.overflowY, pos: s.position, tf: s.transform === 'none' ? '' : s.transform.slice(0, 40), op: s.opacity, filt: s.filter, mask: (s.webkitMaskImage || s.maskImage || 'none').slice(0, 20), wc: s.willChange, z: s.zIndex, bs: s.boxShadow === 'none' ? '' : 'shadow' });
  }
  out.giants = giants.slice(0, 40);
  out.giantN = giants.length;
  // 판 안의 합성 레이어 힌트(P86 고친 것): 터미널 스크롤 손잡이의 transform, 도는 둘레의 will-change
  out.hints = { slider: [...document.querySelectorAll('.react-flow .xterm .slider')].filter((e) => getComputedStyle(e).transform !== 'none').length, sliders: document.querySelectorAll('.react-flow .xterm .slider').length,
    willChange: [...document.querySelectorAll('.react-flow *')].filter((e) => { const w = getComputedStyle(e).willChange; return w && w !== 'auto'; }).length };
  const bs = mt.crash ? mt.crash() : {};
  out.level = bs.level ?? null; out.ok = !!bs.ok; out.light = !!bs.light;
  out.lite = document.documentElement.classList.contains('mt-lite');
  out.badge = document.querySelector('[data-role=board-level]') ? Number(document.querySelector('[data-role=board-level]').dataset.level) : 0;
  out.straight = q('.react-flow__edge-straight');
  out.shownSessions = q('.react-flow__node-session'); out.allSessions = st.sessions.size;
  out.curWsSessions = [...st.sessions.values()].filter((x) => (x.workspaceKey || null) === (st.currentWs || null)).length;
  out.anim = [...document.querySelectorAll('.react-flow *')].filter((e) => { const a = getComputedStyle(e).animationName; return a && a !== 'none'; }).length;
  out.heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  return out;
})()`;

// WebKit 웹 프로세스(이 시험이 띄운 브라우저의 자식) 메모리: Windows 프로세스 값(사적 바이트, 작업 집합). 띄운 프로세스만 읽는다
function childTree(rootPid) {
  const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress';
  const all = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000 }));
  const kids = new Map();
  for (const p of all) { if (!kids.has(p.ParentProcessId)) kids.set(p.ParentProcessId, []); kids.get(p.ParentProcessId).push(p); }
  const out = [];
  const walk = (pid) => { for (const c of kids.get(pid) || []) { out.push({ pid: c.ProcessId, name: c.Name }); walk(c.ProcessId); } };
  walk(rootPid);
  return out;
}
const webPids = (engine) => childTree(process.pid).filter((p) => (engine === 'webkit' ? /WebKitWebProcess/i.test(p.name) : /chrome|headless_shell/i.test(p.name))).map((p) => p.pid);
// pids의 사적 바이트를 ms 동안 100ms마다 적는다(백그라운드 PowerShell 하나)
function sampleMem(pids, ms) {
  if (!pids.length) return { done: Promise.resolve([]) };
  const n = Math.ceil(ms / 100);
  const ps = `$ids=@(${pids.join(',')}); $t0=[Environment]::TickCount; for($i=0;$i -lt ${n};$i++){ $s=0; $w=0; foreach($id in $ids){ $p=Get-Process -Id $id -ErrorAction SilentlyContinue; if($p){ $s+=$p.PrivateMemorySize64; $w+=$p.WorkingSet64 } }; Write-Output ("{0},{1},{2}" -f ([Environment]::TickCount-$t0),$s,$w); Start-Sleep -Milliseconds 100 }`;
  const child = spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; });
  const done = new Promise((r) => child.on('close', () => r(buf.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [t, p, w] = l.split(',').map(Number); return { t, priv: Math.round(p / 1048576), ws: Math.round(w / 1048576) }; }))));
  return { done };
}
const memSum = (s) => (s.length ? { peakPriv: Math.max(...s.map((x) => x.priv)), lastPriv: s[s.length - 1].priv, peakWs: Math.max(...s.map((x) => x.ws)) } : null);

// 장면 하나: 화면을 옮기고 잠깐 뒤 잰다
async function scene(env, name, setup, waitMs = 3500) {
  const { pg, engine, cdp } = env;
  if (setup) await pg.evaluate(setup);
  await sleep(waitMs);
  const p = await pg.evaluate(PROBE);
  if (cdp) {
    try {
      const layers = await new Promise((res) => { const h = (e) => { cdp.off('LayerTree.layerTreeDidChange', h); res(e.layers || []); }; cdp.on('LayerTree.layerTreeDidChange', h); cdp.send('LayerTree.enable').catch(() => res([])); setTimeout(() => res(null), 3000); });
      await cdp.send('LayerTree.disable').catch(() => {});
      if (layers) {
        const draws = layers.filter((l) => l.drawsContent);
        const px = draws.map((l) => l.width * l.height * p.dpr * p.dpr);
        p.layers = { n: layers.length, draws: draws.length, mpx: +(px.reduce((a, b) => a + b, 0) / 1e6).toFixed(1), maxMpx: +(Math.max(0, ...px) / 1e6).toFixed(1) };
      }
    } catch (e) { p.layers = { err: e.message.slice(0, 80) }; }
  }
  const pids = env.pids || [];
  if (pids.length) { const m = sampleMem(pids, 600); p.mem = memSum(await m.done); }
  metrics.engines[engine].scenes[name] = p;
  log(`[${engine} ${name}] 배율 ${p.zoom} DOM ${p.dom} 노드 ${JSON.stringify(p.nodes)} 선 ${p.edges} 터미널 ${p.terms.length} 셀 ${p.cells} ${JSON.stringify(p.terms)} 효과 ${JSON.stringify(p.fx)} 레이어 ${JSON.stringify(p.layers || null)} 메모리 ${JSON.stringify(p.mem || null)} 얼굴 ${p.faces}`);
  log(`[${engine} ${name}] 큰 요소 ${p.giantN}개 ${JSON.stringify(p.giants)}`);
  return p;
}

// ---- 고친 뒤: 단계 기록과 스스로 좁혀 가는 보드 ----
const crumbs = (pg) => pg.evaluate(() => { try { return localStorage.getItem('mt.crumbs'); } catch { return null; } }).catch(() => null);
async function crashPage(env, openPage, base, label) {
  log(`[${env.engine} ${label}] 죽이기 전 기록 ${String(await crumbs(env.pg)).slice(0, 900)}`);
  if (env.engine === 'chromium') env.cdp.send('Page.crash').catch(() => {});
  else for (const pid of webPids('webkit')) try { process.kill(pid); } catch {} // 이 시험이 띄운 WebKit의 웹 프로세스만(PID로)
  await new Promise((r) => { env.pg.once('crash', r); setTimeout(r, 6000); });
  await env.pg.close().catch(() => {});
  const o = await openPage();
  env.pg = o.pg; env.cdp = o.cdp;
  await env.pg.goto(`${base}/`);
  await loadedOpen(env.pg); await splashGone(env.pg);
  await sleep(3000);
  return env.pg.evaluate(PROBE);
}
const tapSel = async (pg, sel) => { await pg.waitForSelector(sel, { timeout: 15000 }); await pg.tap(sel); };
async function reloadAfter(env, fn) { await Promise.all([env.pg.waitForEvent('load', { timeout: 30000 }).catch(() => null), fn()]); await loadedOpen(env.pg); await splashGone(env.pg); await sleep(3000); return env.pg.evaluate(PROBE); }
async function ladder(env, openPage, base) {
  const E = env.engine;
  const sum = (p) => ({ view: p.view, level: p.level, ok: p.ok, light: p.light, terms: p.terms.length, convo: p.nodes.convo, edges: p.edges, straight: p.straight, lite: p.lite, badge: p.badge, anim: p.anim, sess: `${p.shownSessions}/${p.allSessions}`, cur: p.curWsSessions, rootZoom: p.rootZoom });
  call('board.setViewport', { x: 40, y: 80, zoom: 1 });
  let p = await reloadAfter(env, () => env.pg.reload());
  log(`[${E} L0] ${JSON.stringify(sum(p))} 힌트 ${JSON.stringify(p.hints)}`);
  judge(`[${E}] L0(전부 켬): 보드 터미널이 붙고, 판 안에 합성 레이어 힌트(스크롤 손잡이 transform, will-change)가 없다`, p.level === 0 && p.terms.length >= 1 && p.hints.slider === 0 && p.hints.willChange === 0, { ...sum(p), hints: p.hints });
  await sleep(2500);
  const t0 = Date.now();
  p = await crashPage(env, openPage, base, 'crash-1');
  log(`[${E} 죽음 1 뒤] ${JSON.stringify(sum(p))}`);
  judge(`[${E}] 죽음 1번: 다음 보드는 L1(보드 터미널 없음, 얼굴만)과 단계 알약`, p.view === 'board' && p.level === 1 && p.terms.length === 0 && p.badge === 1 && !p.light, sum(p));
  await env.pg.screenshot({ path: path.join(OUT, `after-${E}-03-L1.png`) });
  await sleep(1500);
  const boots = bootLog().filter((e) => e.at >= t0 - 1000 && e.event === 'boot');
  const names = (b) => (b && b.crash && b.crash.steps ? b.crash.steps.map((x) => x.s) : []);
  log(`[${E}] boot 줄 ${JSON.stringify(boots.map((b) => ({ level: b.level, crash: b.crash })))}`);
  const b1 = boots[0];
  judge(`[${E}] boot 줄에 죽기 직전의 단계(판 적용, 첫 그리기, 터미널 붙기·첫 프레임)와 다음 단계`, !!b1 && b1.level === 1 && ['board', 'paint'].every((n) => names(b1).includes(n)) && names(b1).some((n) => ['term', 'fw0', 'fw1', 'att'].includes(n)), b1);
  judge(`[${E}] boot 줄의 단계는 정한 값만(이름, ms, 숫자, 종류 이름)`, !!b1 && b1.crash.steps.every((x) => Object.entries(x).every(([k, v]) => (k === 's' || k === 'k' ? /^[A-Za-z0-9._:-]+$/.test(v) : typeof v === 'number'))), b1 && b1.crash.steps);
  const cli = (() => { try { return atrium('remote', 'log', '--limit', '6'); } catch (e) { return e.message; } })();
  log(`atrium remote log\n${cli}`);
  judge(`[${E}] atrium remote log에 마지막 단계와 보드 단계가 보인다`, /마지막 단계=/.test(cli) && /보드 단계=1/.test(cli), cli.split('\n').slice(0, 3).join(' | '));
  if (E !== 'chromium') return; // 사다리 전체는 Chromium으로(CDP Page.crash). WebKit은 죽음 1번까지
  await sleep(2000);
  p = await crashPage(env, openPage, base, 'crash-2'); // 1분 안에 두 번: 가벼운 화면(P84), 다음 보드는 L2
  log(`[${E} 죽음 2 뒤] ${JSON.stringify(sum(p))}`);
  judge(`[${E}] 죽음 2번(1분 안): 가벼운 화면(목록), 다음 보드는 L2`, p.light && p.view === 'list' && p.level === 2, sum(p));
  await env.pg.screenshot({ path: path.join(OUT, `after-${E}-04-light.png`) });
  p = await reloadAfter(env, () => tapSel(env.pg, '[data-action=light-board]'));
  log(`[${E} L2] ${JSON.stringify(sum(p))}`);
  judge(`[${E}] 보드로 다시 열기 → L2: 대화 노드 없음, 터미널 없음, 선은 곧은 선만`, p.view === 'board' && p.level === 2 && p.nodes.convo === 0 && p.terms.length === 0 && p.edges === p.straight && p.badge === 2, sum(p));
  await env.pg.screenshot({ path: path.join(OUT, `after-${E}-05-L2.png`) });
  p = await crashPage(env, openPage, base, 'crash-3');
  judge(`[${E}] 다시 연 L2가 죽음 → 가벼운 화면, 다음 보드는 L3`, p.light && p.level === 3, sum(p));
  p = await reloadAfter(env, () => tapSel(env.pg, '[data-action=light-board]'));
  log(`[${E} L3] ${JSON.stringify(sum(p))}`);
  judge(`[${E}] L3: 효과 끔(html.mt-lite, 판 안 움직임 0, 그림자 0, 화면 배율 zoom 없음)`, p.level === 3 && p.lite && p.anim === 0 && p.fx.shadow === 0 && ['1', '', 'normal'].includes(String(p.rootZoom)), { ...sum(p), fx: p.fx });
  p = await crashPage(env, openPage, base, 'crash-4');
  p = await reloadAfter(env, () => tapSel(env.pg, '[data-action=light-board]'));
  log(`[${E} L4] ${JSON.stringify(sum(p))}`);
  judge(`[${E}] L4: 지금 워크스페이스의 세션만`, p.level === 4 && p.shownSessions === p.curWsSessions && p.shownSessions < p.allSessions, sum(p));
  await env.pg.screenshot({ path: path.join(OUT, `after-${E}-06-L4.png`) });
  // 살아남은 단계 기억: 보드를 그린 뒤 1분 넘게
  const t1 = Date.now();
  await sleep(64000);
  const kept = JSON.parse((await crumbs(env.pg)) || '{}');
  await sleep(1000);
  const lv = bootLog().filter((e) => e.at >= t1 && e.event === 'level');
  judge(`[${E}] L4가 1분 넘게 살면 그 단계를 기억하고 연결 기록에 level 줄`, kept.level === 4 && kept.ok === true && lv.length === 1 && lv[0].level === 4, { level: kept.level, ok: kept.ok, lines: lv });
  p = await reloadAfter(env, () => env.pg.reload());
  await tapSel(env.pg, '[data-action=board-level]');
  const keptText = await env.pg.evaluate(() => !!document.querySelector('.mt-level-kept'));
  judge(`[${E}] 정상으로 다시 읽어도 L4 그대로, 알약에 "기억합니다"`, p.level === 4 && p.ok && keptText, { ...sum(p), keptText });
  await env.pg.screenshot({ path: path.join(OUT, `after-${E}-07-badge.png`) });
  p = await reloadAfter(env, () => tapSel(env.pg, '[data-action=board-heavier]'));
  judge(`[${E}] 한 단계 무겁게 → L3(기억 지움)`, p.level === 3 && !p.ok && !p.light, sum(p));
  await tapSel(env.pg, '[data-action=board-level]');
  p = await reloadAfter(env, () => tapSel(env.pg, '[data-action=board-reset]'));
  judge(`[${E}] 처음으로 → L0(알약 없음, 보드 터미널 다시 붙음)`, p.level === 0 && p.badge === 0 && p.terms.length >= 1, sum(p));
  const t2 = Date.now();
  await sleep(1500);
  judge(`[${E}] 무겁게·처음으로 다시 읽기는 죽음으로 세지 않는다(boot 줄 없음)`, bootLog().filter((e) => e.at >= t2 - 8000 && e.event === 'boot').length === 0, null);
}

const newCode = () => call('device.code').code;
async function pair(pg, base) {
  await pg.goto(`${base}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', newCode());
  await pg.tap('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg);
}
const bootLog = () => call('remote.log', { limit: 80 }).entries;

let sim;
const browsers = [];
try {
  // ---- 0. 판 ----
  if (process.env.P86_RESTART === '1') try { log(atrium('backend', 'stop').trim().slice(0, 200)); } catch (e) { log(`백엔드 멈추기 ${e.message.slice(0, 100)}`); }
  makeConvos();
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  sim = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); sim.cfg.ip = LAPTOP_A;
  await sim.ready;
  const spawnIn = (dir, ...a) => JSON.parse(atrium('--json', 'spawn', dir, ...a));
  const want = [['p86-sh1', 0, 'shell'], ['p86-sh2', 0, 'shell'], ['p86-ag1', 0, 'agent'], ['p86-sh3', 1, 'shell'], ['p86-ag2', 1, 'agent'], ['p86-sh4', 2, 'shell']];
  const have = new Set(sessions().filter((s) => /^p86-/.test(s.name) && s.state !== 'exited').map((s) => s.name));
  for (const [n, wi, kind] of want) if (!have.has(n)) { if (kind === 'shell') spawnIn(DIRS[wi], '--kind', 'shell', '--name', n); else spawnIn(DIRS[wi], '--model', 'haiku', '--name', n); }
  await until(() => want.every(([n]) => { const s = byName(n); return s && s.state !== 'starting'; }), 180000, 2000).catch(() => null);
  const trust = sessions().find((s) => /^p86-ag/.test(s.name) && s.state === 'trust_wait');
  if (trust) { fs.writeFileSync(path.join(DEV, 'p86-need-trust.txt'), `${trust.name} asks the folder trust question\n`); throw new Error('trust question (backend/.dev/p86-need-trust.txt)'); }
  // 셸 화면을 긴 출력으로 채운다(큰 전체 프레임)
  for (const [n, , kind] of want) if (kind === 'shell') try { atrium('input', n, "1..400 | % { 'line ' + $_ + ' ' + ('abcdefghij' * 15) }\\r"); } catch (e) { log(`입력 실패 ${n} ${e.message.slice(0, 100)}`); }
  try { if (!call('link.list').some((l) => l.from === byName('p86-ag1').sessionId)) atrium('link', 'p86-ag1', 'p86-ag2', '--role', 'reviewer'); } catch (e) { log(`연결 ${e.message.slice(0, 120)}`); }
  await sleep(4000);
  log(`세션 ${sessions().filter((s) => /^p86-/.test(s.name)).map((s) => `${s.name}:${s.state}`).join(' ')}`);
  try { call('convo.scan'); } catch {}
  await until(() => call('convo.nodes').nodes.length >= 30, 90000, 3000).catch(() => null);
  log(`대화 노드 ${call('convo.nodes').nodes.length}개, 분류 ${JSON.stringify(call('convo.classify').byClass)}`);
  const board = call('board.get');
  log(`판: 노드 ${Object.keys(board.nodes || {}).length || (board.nodes || []).length}, 워크스페이스 ${(board.workspaces || []).length}`);
  call('board.setViewport', { x: 40, y: 80, zoom: 1 }); // PC가 남긴 화면 자리(처음 붙는 휴대폰이 그대로 연다)

  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  const BASE = `http://localhost:${B0.sim}`;

  for (const engine of ENGINES) {
    metrics.engines[engine] = { scenes: {}, msgs: null };
    call('board.setViewport', { x: 40, y: 80, zoom: 1 }); // 휴대폰이 화면 자리를 저장하므로 엔진마다 다시
    const browser = engine === 'webkit'
      ? await webkit.launch({ headless: true })
      : await chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : { channel: 'chromium' }), args: ['--enable-precise-memory-info', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    browsers.push(browser);
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(WS_HOOK);
    const open = async (label) => {
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => log(`[${engine} ${label} pageerror] ${e.message}`));
      pg.on('console', (m) => { if (m.type() === 'error') log(`[${engine} ${label} console.error] ${m.text().slice(0, 200)}`); });
      const cdp = engine === 'chromium' ? await ctx.newCDPSession(pg) : null;
      return { pg, cdp };
    };
    let { pg, cdp } = await open('phone');
    await pair(pg, BASE);
    await pg.evaluate(() => { try { localStorage.removeItem('mt.phoneTermScale'); localStorage.removeItem('mt.phoneLayout'); } catch {} });
    // 처음 여는 것처럼 다시 읽고(짝 맺기 뒤), 메모리를 첫 5초 동안 적는다
    const env = { pg, cdp, engine, pids: [] };
    await pg.goto(`${BASE}/`).catch(() => {});
    env.pids = webPids(engine);
    const boot = sampleMem(env.pids, 6000);
    await loadedOpen(pg); await splashGone(pg);
    const bootMem = await boot.done;
    metrics.engines[engine].bootMem = bootMem;
    log(`[${engine}] 첫 6초 메모리(사적 MB, pid ${env.pids.join(',')}) ${JSON.stringify(memSum(bootMem))} ${bootMem.filter((_, i) => i % 5 === 0).map((x) => `${x.t}:${x.priv}`).join(' ')}`);
    const msgs = await pg.evaluate(() => window.__p86msgs || []);
    const big = msgs.filter((m) => m.b >= 8000);
    const byKind = {};
    for (const m of msgs) { byKind[m.k] = byKind[m.k] || { n: 0, b: 0, max: 0 }; byKind[m.k].n++; byKind[m.k].b += m.b; byKind[m.k].max = Math.max(byKind[m.k].max, m.b); }
    metrics.engines[engine].msgs = { n: msgs.length, b: msgs.reduce((a, m) => a + m.b, 0), big, byKind };
    log(`[${engine}] 받은 메시지 ${msgs.length}개 ${msgs.reduce((a, m) => a + m.b, 0)}B, 큰 것 ${JSON.stringify(big)} 종류별 ${JSON.stringify(byKind)}`);

    await scene(env, 'pc-viewport', null, 1500);
    await pg.screenshot({ path: path.join(OUT, `${STAGE}-${engine}-01-pc-viewport.png`) });
    await scene(env, 'fit-all', () => window.__mt.getState().fitAll());
    const node = await pg.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === 'p86-sh1'); return s ? window.__mt.getState().nodes.get(s.sessionId) : null; });
    const at = (z) => `(() => { const r = ${JSON.stringify(node)}; window.__mt.getState().setViewport({ x: 10 - r.x * ${z}, y: 70 - r.y * ${z}, zoom: ${z} }); })()`;
    for (const z of [0.1, 0.3, 1]) await scene(env, `zoom-${z}`, at(z));
    await pg.screenshot({ path: path.join(OUT, `${STAGE}-${engine}-02-zoom1.png`) });
    // 가설 덜어 보기(고치기 전에만): 효과 끔(CSS), 대화 노드 뺌, 터미널 없음
    if (STAGE === 'before') {
      await pg.addStyleTag({ content: '*,*::before,*::after{box-shadow:none!important;filter:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;animation:none!important;will-change:auto!important;transition:none!important}' });
      await scene(env, 'zoom-1-nofx', null);
      await pg.evaluate(() => window.__mt.setConvoNodes([], []));
      await scene(env, 'zoom-1-nofx-noconvo', null);
      await pg.evaluate(() => window.__mt.getState().fitAll());
      await scene(env, 'fit-nofx-noconvo', null);
    }
    if (STAGE === 'after') await ladder(env, () => open('crash'), BASE);
    ({ pg } = env);
    metrics.engines[engine].env = await pg.evaluate(() => ({ ua: navigator.userAgent, dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight, coarse: matchMedia('(pointer: coarse)').matches }));
    log(`[${engine}] 환경 ${JSON.stringify(metrics.engines[engine].env)}`);
    await ctx.close();
  }
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  if (sim) await sim.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, `p86-board-${STAGE}-${ENGINES.join('+')}.json`), JSON.stringify({ results, metrics }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
