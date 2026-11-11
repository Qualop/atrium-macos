// P65 창 시험: 판 배율을 바꾸는 동안과 멈춘 뒤의 프레임 시간(세션 노드 12개). 바꾸기 전과 뒤를 같은 각본으로 잰다.
// - 셸 노드 12개를 4×3으로 놓고, 모두 가까이 얼굴이 되는 배율(0.48)에서 판 배율을 0.48 → 0.62 → 0.48로 2초 동안 매 프레임 바꾼다(setViewport).
//   그동안의 화면 갱신 간격(requestAnimationFrame)과, 멈춘 뒤 1.5초(선명하게 다시 그리는 때)의 간격을 잰다. 이것을 세 번 한다.
// - 제어기 상한(기본 8)과 WebGL 예산(기본 8) 그대로다. 그래서 12개 가운데 8개가 실제 터미널을 그린다.
// 판: herdr 세션 atrium-dev-p65, 포트 47892(experiments/p65/tools/env.cjs).
// 사용: node experiments/p65/tools/e2e.cjs p65-perf.mjs --dpr 1.5 --tag before   결과: experiments/p65/<tag>-perf-d<dpr>.json
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { APP_ROOT, REPO, OUT, sleep, until, logger, closeApp } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p65') throw new Error('MT_E2E_OUT=p65를 명령줄에서 준다');
const T = createRequire(import.meta.url)(path.join(REPO, 'experiments', 'p65', 'tools', 'env.cjs'));
const ENV = Object.fromEntries(Object.entries(T.P65_ENV).filter(([k]) => k.startsWith('ATRIUM_')));
assertTestBoard(ENV, { root: T.DEV });
if (ENV.ATRIUM_HERDR_SESSION !== 'atrium-dev-p65' || ENV.ATRIUM_PORT !== '47892') throw new Error('P65 판(atrium-dev-p65, 47892)만');
if (!/^C:\\Workspace\\mtask-p65-/.test(T.DIR)) throw new Error(`시험 폴더는 C:\\Workspace\\mtask-p65-*만: ${T.DIR}`);

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const DPR = Number(arg('--dpr', '1'));
const TAG = arg('--tag', 'run');
const N = Number(arg('--nodes', '12'));
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });
const log = logger(`${TAG}-perf-d${DPR}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });

const args = ['.', '--dev'];
if (DPR > 0) args.push(`--force-device-scale-factor=${DPR}`);
const app = await electron.launch({ args, cwd: APP_ROOT, env, timeout: 60000 });
const page = await app.firstWindow();
page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w[0], w[1]), DPR >= 2 ? [1260, 700] : [1584, 921]); // DPR 2는 화면(장치 2560×1440)에 들어가게
await sleep(500);
const out = { dpr: DPR, tag: TAG, runs: [] };
const sid = (n) => page.evaluate((nn) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === nn); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, n);
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => +(s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0).toFixed(1); return { n: s.length, p50: q(0.5), p95: q(0.95), max: +(s[s.length - 1] || 0).toFixed(1), over33: s.filter((v) => v > 33.4).length, mean: +(s.reduce((x, y) => x + y, 0) / Math.max(1, s.length)).toFixed(2) }; };

try {
  const ids = [];
  for (let i = 1; i <= N; i++) {
    const name = `perf${i}`;
    if (!await sid(name)) atrium('spawn', T.DIR, '--name', name, '--kind', 'shell');
    ids.push(await until(() => sid(name), 40000));
  }
  const W = 780, H = 460, GX = 40, GY = 40;
  const C = DPR >= 2 ? 3 : 4, R = Math.ceil(ids.length / C); // DPR 2 창은 작아 3칸씩(보이는 노드만 붙는다)
  for (let i = 0; i < ids.length; i++) await call('board.setNode', { session: ids[i], x: 5000 + (i % C) * (W + GX), y: 5000 + Math.floor(i / C) * (H + GY), w: W, h: H, z: 0, cause: 'p65-perf' });
  await sleep(800);
  const fitZ = DPR >= 2 ? 0.5 : 0.48; // 노드가 가까이 얼굴(화면 너비 360px 이상)인 배율
  const GW = C * W + (C - 1) * GX, GH = DPR >= 2 ? 2 * H + GY : R * H + (R - 1) * GY;
  const zoomTo = (z) => page.evaluate(([zz, gw, gh]) => { const st = window.__mt.getState(); const el = document.querySelector('.mt-canvas'); const cx = 5000 + gw / 2, cy = 5000 + gh / 2; st.setViewport({ x: el.clientWidth / 2 - cx * zz, y: el.clientHeight / 2 - cy * zz, zoom: zz }); }, [z, GW, GH]);
  await zoomTo(fitZ);
  await sleep(4000);
  // 노드마다 같은 글
  const attached = await page.evaluate(() => [...window.__mt.terms.keys()]);
  for (const id of attached) await call('terminal.input', { session: id, data: 'cls; 1..30 | % { "{0,3} The quick brown fox jumps over the lazy dog 0123456789 가나다라 한글" -f $_ }\r' }).catch(() => {});
  await sleep(3000);
  const renderers = await page.evaluate(() => [...document.querySelectorAll('.mt-term')].map((h) => (h.querySelector('.xterm-screen canvas:not(.xterm-link-layer)') ? 'webgl' : 'dom')));
  log('붙은 터미널', attached.length, 'renderers', renderers);
  out.attached = attached.length; out.renderers = renderers;
  for (let run = 0; run < 3; run++) {
    const r = await page.evaluate(async ([z0, z1, gw, gh]) => {
      const st = window.__mt.getState(); const el = document.querySelector('.mt-canvas');
      const cx = 5000 + gw / 2, cy = 5000 + gh / 2;
      const set = (zz) => st.setViewport({ x: el.clientWidth / 2 - cx * zz, y: el.clientHeight / 2 - cy * zz, zoom: zz });
      const gaps = [], after = [];
      const t0 = performance.now(); let last = t0;
      await new Promise((res) => {
        const step = (now) => {
          gaps.push(now - last); last = now;
          const u = (now - t0) / 2000;
          if (u >= 1) { set(z0); res(); return; }
          set(z0 + (z1 - z0) * Math.sin(Math.PI * u)); // 0.48 → 0.62 → 0.48
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      const t1 = performance.now(); last = t1;
      await new Promise((res) => { const step = (now) => { after.push(now - last); last = now; if (now - t1 > 1500) res(); else requestAnimationFrame(step); }; requestAnimationFrame(step); });
      const sharp = [...document.querySelectorAll('.mt-term')].map((h) => h.dataset.sharp || '');
      return { gaps: gaps.slice(1), after, sharp };
    }, [fitZ, fitZ * 1.3, GW, GH]);
    const row = { run, zooming: stats(r.gaps), settle: stats(r.after), sharp: r.sharp };
    out.runs.push(row);
    log('잼', { run, zooming: row.zooming, settle: row.settle, sharp: r.sharp.slice(0, 3) });
    await sleep(1500);
  }
} catch (e) {
  out.error = e.stack || e.message;
  log('시험 오류', out.error);
} finally {
  fs.writeFileSync(path.join(OUT, `${TAG}-perf-d${DPR}.json`), JSON.stringify(out, null, 2));
  await closeApp(app);
}
process.exit(out.error ? 1 : 0);
