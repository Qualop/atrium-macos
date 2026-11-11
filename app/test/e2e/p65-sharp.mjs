// P65 창 시험: 터미널 글자의 선명함을 숫자로 잰다. 같은 셸 글을 화면 배율(DPR)·판 배율·창 배율마다 찍어 견준다.
// - 창은 --force-device-scale-factor=<dpr>로 띄운다(4K 150%·200% 흉내). 터미널 화면(.xterm-screen)을 webContents.capturePage로 장치 픽셀 그대로 찍는다.
// - 잰 값(밝기 Y, 0~255):
//   edge   글자 가장자리 폭(px). 가로·세로 줄에서 밝기가 대비(p99.5 - p0.5)의 절반 넘게 한쪽으로 바뀌는 구간의 10%→90% 거리 평균. 작을수록 선명하다(화면 픽셀에 맞춰 그린 글은 1 안팎).
//   steep  가장 가파른 가장자리 1%의 한 픽셀 밝기 차 평균 / 대비. 1에 가까울수록 가파르다.
//   energy 밝기 기울기 제곱 평균 / 밝기 분산. 흐리면 작다(배율과 글 양에 덜 기댄다).
// 판: herdr 세션 atrium-dev-p65, 포트 47892, 이 워크트리의 backend/.dev(experiments/p65/tools/env.cjs). 세션은 셸 하나(sharp1).
// 사용: node experiments/p65/tools/e2e.cjs p65-sharp.mjs --dpr 1.5 --tag before [--zooms 0.5,0.75,1,1.25] [--ui 1,1.25] [--dom] [--win 1100x650]
// 결과: experiments/p65/<tag>-sharp-d<dpr>.json, 찍은 그림 experiments/p65/<tag>/d<dpr>-ui<ui>-z<zoom>.png
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
const ZOOMS = arg('--zooms', '0.5,0.75,1,1.25').split(',').map(Number);
const UIS = arg('--ui', '1,1.25').split(',').map(Number);
const DOM = argv.includes('--dom');
const WIN = arg('--win', '1200x800').split('x').map(Number); // 창 안쪽 크기(CSS px). DPR 2에서는 화면에 들어가게 작게 준다
const SHOTS = path.join(OUT, TAG);
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of [T.PROJECTS, T.SESSIONS, T.DIR]) fs.mkdirSync(d, { recursive: true });
const log = logger(`${TAG}-sharp-d${DPR}`);
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV, MT_HERDR_SESSION: ENV.ATRIUM_HERDR_SESSION };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });

const args = ['.', '--dev'];
if (DPR > 0) args.push(`--force-device-scale-factor=${DPR}`);
const app = await electron.launch({ args, cwd: APP_ROOT, env, timeout: 60000 });
const page = await app.firstWindow();
page.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
if (DOM) await page.evaluate(() => { localStorage.setItem('mt.webglBudget', '0'); location.reload(); });
else await page.evaluate(() => { if (localStorage.getItem('mt.webglBudget') !== null) { localStorage.removeItem('mt.webglBudget'); location.reload(); } });
await page.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded, null, { timeout: 90000 });
await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setContentSize(w[0], w[1]), WIN);
await sleep(500);
const results = [];
const sid = (n) => page.evaluate((nn) => { const s = [...window.__mt.getState().sessions.values()].find((x) => x.name === nn); return s && window.__mt.getState().nodes.has(s.sessionId) ? s.sessionId : null; }, n);
const call = (m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);

// 장치 픽셀 그대로 찍어 잰다(main 프로세스에서). 창 전체를 찍고 장치 픽셀 사각형(r)으로 잘라 낸다.
// capturePage에 DIP 사각형을 주면 분수 DPR에서 자르는 자리가 장치 픽셀 사이에 걸려 찍은 그림이 다시 번질 수 있다
async function measure(r, file) {
  const out = await app.evaluate(async ({ BrowserWindow, nativeImage }, [r]) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    const full = await wc.capturePage();
    const sz = full.getSize(), all = full.toBitmap(); // BGRA
    const sc = Math.sqrt(all.length / 4 / (sz.width * sz.height));
    const FW = Math.round(sz.width * sc), FH = Math.round(sz.height * sc);
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), W = Math.min(r.w, FW - x0), H = Math.min(r.h, FH - y0);
    const bmp = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) all.copy(bmp, y * W * 4, ((y0 + y) * FW + x0) * 4, ((y0 + y) * FW + x0 + W) * 4);
    const img = nativeImage.createFromBitmap(bmp, { width: W, height: H });
    const Y = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) Y[i] = 0.0722 * bmp[i * 4] + 0.7152 * bmp[i * 4 + 1] + 0.2126 * bmp[i * 4 + 2];
    const sorted = Float32Array.from(Y).sort();
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const contrast = q(0.995) - q(0.005);
    let mean = 0; for (const v of Y) mean += v; mean /= Y.length;
    let vr = 0; for (const v of Y) vr += (v - mean) ** 2; vr /= Y.length;
    const g = []; let e = 0, n = 0;
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const i = y * W + x, gx = Y[i + 1] - Y[i], gy = Y[i + W] - Y[i];
      e += gx * gx + gy * gy; n++;
      g.push(Math.abs(gx), Math.abs(gy));
    }
    g.sort((a, b) => b - a);
    const top = g.slice(0, Math.max(1, Math.floor(g.length * 0.01)));
    const steep = top.reduce((a, b) => a + b, 0) / top.length / Math.max(1, contrast);
    // 가장자리 폭: 가로·세로 줄마다 밝기가 한쪽으로만 바뀌는 구간 가운데 바뀜이 대비의 절반 이상인 것의 10%→90% 거리(px, 선형 보간)
    const widths = [];
    const scan = (len, at) => {
      const close = (a, b) => {
        const d = at(b) - at(a);
        if (b <= a || Math.abs(d) < 0.5 * contrast) return;
        const cross = (lv) => { for (let k = a; k < b; k++) { const u = at(k), v = at(k + 1); if ((u - lv) * (v - lv) <= 0 && u !== v) return k + (lv - u) / (v - u); } return b; };
        widths.push(Math.abs(cross(at(a) + 0.9 * d) - cross(at(a) + 0.1 * d)));
      };
      let a = 0, dir = 0;
      for (let k = 1; k < len; k++) {
        const sg = Math.sign(at(k) - at(k - 1));
        if (sg === 0) { close(a, k - 1); a = k; dir = 0; continue; }
        if (dir !== 0 && sg !== dir) { close(a, k - 1); a = k - 1; }
        dir = sg;
      }
      close(a, len - 1);
    };
    for (let y = 0; y < H; y++) scan(W, (x) => Y[y * W + x]);
    for (let x = 0; x < W; x++) scan(H, (y) => Y[y * W + x]);
    widths.sort((p1, p2) => p1 - p2);
    const edge = widths.length ? widths.reduce((p1, p2) => p1 + p2, 0) / widths.length : null;
    return { full: [FW, FH], edge: edge === null ? null : +edge.toFixed(3), edgeMed: widths.length ? +widths[widths.length >> 1].toFixed(3) : null, edges: widths.length, png: img.toPNG().toString('base64'), w: W, h: H, contrast: +contrast.toFixed(1), steep: +steep.toFixed(4), energy: +(e / n / Math.max(1, vr)).toFixed(4) };
  }, [r]);
  fs.writeFileSync(file, Buffer.from(out.png, 'base64'));
  delete out.png;
  return out;
}

try {
  const info = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; const d = screen.getDisplayMatching(w.getBounds()); return { scaleFactor: d.scaleFactor, size: d.size }; });
  log('화면', info, 'devicePixelRatio', await page.evaluate(() => window.devicePixelRatio));
  if (!await sid('sharp1')) atrium('spawn', T.DIR, '--name', 'sharp1', '--kind', 'shell');
  const id = await until(() => sid('sharp1'), 40000);
  const r0 = await page.evaluate((i) => window.__mt.getState().nodes.get(i), id);
  await call('board.setNode', { session: id, x: Math.round(r0.x), y: Math.round(r0.y), w: 720, h: 460, z: 0, cause: 'p65-test' });
  await sleep(500);
  const view = async (z) => {
    await page.evaluate(([i, zz]) => { const st = window.__mt.getState(); const r = st.nodes.get(i); const el = document.querySelector('.mt-canvas'); st.setViewport({ x: el.clientWidth / 2 - (r.x + r.w / 2) * zz, y: el.clientHeight / 2 - (r.y + r.h / 2) * zz, zoom: zz }); }, [id, z]);
    await sleep(1500);
  };
  await view(1);
  await until(() => page.$(`.mt-term[data-session="${id}"] .xterm-screen`), 40000);
  await sleep(2000);
  const el = await page.$(`.mt-term[data-session="${id}"] .xterm-screen`);
  const b = await el.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(400);
  await page.keyboard.type('cls; 1..13 | % { ("{0,2}" -f $_) + " The quick brown fox jumps over the lazy dog 0123456789 [](){}<>=+-*/ #@&%$ ~|;:" }; "WWWW mmmm iiii llll 1111 0000 OOOO ____ .... 가나다라 한글 글자 선명도"');
  await page.keyboard.press('Enter');
  await sleep(2500);
  await page.mouse.click(5, 400); await sleep(300); // 초점 밖으로(커서 깜빡임 없게)
  for (const ui of UIS) {
    await page.evaluate((u) => window.mt.setZoom(u), ui);
    await sleep(800);
    for (const z of ZOOMS) {
      await view(z);
      const st = await page.evaluate((i) => {
        const t = window.__mt.terms.get(i); const s = document.querySelector(`.mt-term[data-session="${i}"] .xterm-screen`);
        if (!t || !s) return null;
        const r = s.getBoundingClientRect();
        const cv = s.querySelector('canvas');
        const dims = t._core._renderService.dimensions;
        return { rect: { x: r.x, y: r.y + 0, w: r.width, h: Math.min(r.height, 16 * r.height / t.rows) }, cols: t.cols, rows: t.rows, dpr: window.devicePixelRatio, canvas: cv ? { w: cv.width, h: cv.height, cssW: cv.style.width } : null, cell: { dw: dims.device.cell.width, dh: dims.device.cell.height, cw: +dims.css.cell.width.toFixed(3), ch: +dims.css.cell.height.toFixed(3) }, tf: t.element.style.transform, sharp: s.closest('.mt-term').dataset.sharp || null, map: cv ? (() => { const q = cv.getBoundingClientRect(), d = window.devicePixelRatio, fr = (v) => +(((v * d) % 1 + 1) % 1).toFixed(3); return { phaseX: fr(q.x), phaseY: fr(q.y), sx: +(q.width * d / cv.width).toFixed(4), sy: +(q.height * d / cv.height).toFixed(4) }; })() : null };
      }, id);
      if (!st) { results.push({ dpr: DPR, ui, z, error: 'no terminal' }); log('터미널 없음', { ui, z }); continue; }
      const d = st.dpr; // CSS px → 장치 픽셀
      const rect = { x: Math.round(st.rect.x * d), y: Math.round(st.rect.y * d), w: Math.round(st.rect.w * d), h: Math.round(st.rect.h * d) };
      const file = path.join(SHOTS, `d${DPR}-ui${ui}-z${z}.png`);
      const m = await measure(rect, file);
      if (argv.includes('--full')) log('자식', await page.evaluate((i) => [...document.querySelectorAll(`.mt-term[data-session="${i}"] .xterm *`)].filter((e) => e.tagName === 'CANVAS' || e.className.toString().includes('xterm-screen') || e.className.toString().includes('xterm-rows')).map((e) => { const r = e.getBoundingClientRect(); return [e.tagName, String(e.className).slice(0, 40), e.width, e.height, e.style.width, e.style.height, Math.round(r.width), Math.round(r.height), Math.round(r.y)]; }), id));
      if (argv.includes('--full')) await page.screenshot({ path: file.replace(/.png$/, '-full.png') });
      const row = { dpr: DPR, ui, z, ...m, cols: st.cols, rows: st.rows, canvas: st.canvas, cell: st.cell, sharp: st.sharp, map: st.map, tf: st.tf };
      results.push(row);
      log('잼', row);
    }
  }
  await page.evaluate(() => window.mt.setZoom(1));
} catch (e) {
  results.push({ error: e.stack || e.message });
  log('시험 오류', e.stack || e.message);
} finally {
  fs.writeFileSync(path.join(OUT, `${TAG}-sharp-d${DPR}.json`), JSON.stringify(results, null, 2));
  if (DOM) await page.evaluate(() => localStorage.removeItem('mt.webglBudget')).catch(() => {});
  await closeApp(app);
}
process.exit(results.some((r) => r.error) ? 1 : 0);
