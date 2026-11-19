// E5: 가까이 보이는 노드 8개에 제어기를 붙였을 때 메모리, CPU, 프레임 지연(BRIEF 위험 2, docs/log/p2-window.md).
// 사용: node test/e2e/e5.mjs webgl8   (WebGL 예산 8: 8개 모두 WebGL)
//       node test/e2e/e5.mjs dom4     (WebGL 예산 4: 4개 WebGL, 4개 DOM)
// 측정: (1) 쉬는 상태 10초 (2) 입력 → 다음 프레임(입력칸에 x를 넣고 지운다) (3) 8개가 동시에 150줄을 출력하는 실제 턴
//       (4) 합성 부하: E4에서 기록한 한 세션 전체 프레임(135KB)을 8개 터미널에 동시에 다시 넣기
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, shot, logger, sleep, until, OUT } from './harness.mjs';

const mode = process.argv[2] || 'webgl8';
const skipTurns = process.argv.includes('--no-turns');
const query = mode === 'dom4' ? '?webglBudget=4' : '';
const log = logger(`e5-${mode}`);
const result = { mode, at: new Date().toISOString() };

function procs(pids) {
  const list = pids.filter(Boolean).join(',');
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${list} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.ProcessName) $($_.WorkingSet64) $($_.PrivateMemorySize64) $($_.TotalProcessorTime.TotalSeconds)" }`], { encoding: 'utf8' });
  return Object.fromEntries(out.trim().split(/\r?\n/).filter(Boolean).map((l) => { const [pid, name, ws, priv, cpu] = l.split(' '); return [pid, { name, wsMB: +(ws / 2 ** 20).toFixed(1), privMB: +(priv / 2 ** 20).toFixed(1), cpuSec: +cpu }]; }));
}
const sum = (arr) => +arr.filter(Boolean).reduce((a, x) => a + x.wsMB, 0).toFixed(1);
const cpuPct = (a, b, sec) => Object.fromEntries(Object.keys(b).map((k) => [k, a[k] ? +(((b[k].cpuSec - a[k].cpuSec) / sec) * 100).toFixed(1) : null]));
const emSummary = (em) => em.map((m) => ({ type: m.type, cpu: +m.cpu.toFixed(1), wsMB: +(m.memKB / 1024).toFixed(1) }));
const emTotal = (em) => +(em.reduce((a, m) => a + m.memKB, 0) / 1024).toFixed(1);

const { app, page } = await launch({ log, query });
const status = () => page.evaluate(() => window.__mt.api.call('backend.status'));
const electronMetrics = () => page.evaluate(() => window.mt.metrics());
const pidsOf = (st) => ({ backend: st.pid, herdrServer: st.terminal.serverPid, controllers: st.relay.map((r) => r.controllerPid) });
// Electron 프로세스(Browser=main, Tab=창, GPU 등)의 CPU는 OS 프로세스 시간으로 잰다(한 코어 기준 %)
const EPIDS = (await electronMetrics()).map((m) => ({ pid: String(m.pid), type: m.type }));
const ePids = EPIDS.map((e) => e.pid);
const eCpu = (a, b, sec) => Object.fromEntries(EPIDS.map((e) => [e.type, a[e.pid] && b[e.pid] ? +(((b[e.pid].cpuSec - a[e.pid].cpuSec) / sec) * 100).toFixed(1) : null]));

// 8개 노드가 모두 가까이 얼굴(배율 0.5)이면서 화면 안에 들어오게
const nodes = await page.evaluate(() => [...window.__mt.getState().nodes.values()]);
const minX = Math.min(...nodes.map((n) => n.x)), maxX = Math.max(...nodes.map((n) => n.x + n.w)), minY = Math.min(...nodes.map((n) => n.y)), maxY = Math.max(...nodes.map((n) => n.y + n.h));
const area = await page.evaluate(() => { const r = document.querySelector('.mt-canvas').getBoundingClientRect(); return { w: r.width, h: r.height }; });
const zoom = 0.5;
const VP = { x: (area.w - (maxX - minX) * zoom) / 2 - minX * zoom, y: (area.h - (maxY - minY) * zoom) / 2 - minY * zoom, zoom };
await page.evaluate((vp) => window.__mt.getState().setViewport(vp), VP);
await until(() => page.evaluate(() => window.__mt.getState().attached.length >= 8 && Object.keys(window.__mt.perf.snapshot().terminals).length >= 8), 30000);
await sleep(3000);
const st0 = await status();
const renderers = await page.evaluate(() => Object.values(window.__mt.perf.snapshot().terminals).map((t) => t.renderer));
result.attached = { controllers: st0.relay.length, renderers: renderers.reduce((a, r) => ({ ...a, [r]: (a[r] || 0) + 1 }), {}), webglBudget: await page.evaluate(() => window.__mt.budget.budget), area, zoom };
log('붙음', result.attached);
await shot(page, `e5-${mode}-idle`, log);

// (1) 쉬는 상태 10초
await page.evaluate(() => window.__mt.perf.reset());
await electronMetrics();
const p0 = pidsOf(st0);
const all0 = [p0.backend, p0.herdrServer, ...p0.controllers, ...ePids];
const pr0 = procs(all0);
await sleep(10000);
const em1 = await electronMetrics();
const pr1 = procs(all0);
const idleCpu = cpuPct(pr0, pr1, 10);
const idlePerf = await page.evaluate(() => window.__mt.perf.snapshot());
result.idle = {
  rafGapMs: idlePerf.rafGapMs, longFramesOver50ms: idlePerf.longFrames,
  electron: { totalWsMB: emTotal(em1), byType: emSummary(em1), cpuPctOs: eCpu(pr0, pr1, 10) },
  controllers: { count: p0.controllers.length, totalWsMB: sum(p0.controllers.map((p) => pr1[p])), each: p0.controllers.map((p) => pr1[p] && pr1[p].wsMB), cpuPct: p0.controllers.map((p) => idleCpu[p]) },
  backend: { ...pr1[p0.backend], cpuPct: idleCpu[p0.backend] }, herdrServer: { ...pr1[p0.herdrServer], cpuPct: idleCpu[p0.herdrServer] },
};
log('쉬는 상태', result.idle);

// (2) 입력 → 다음 프레임: 세션마다 x를 넣고 지우기를 5번(입력칸에만 들어가고 제출하지 않는다)
await page.evaluate(() => window.__mt.perf.reset());
const ids = await page.evaluate(() => Object.keys(window.__mt.perf.snapshot().terminals));
for (let round = 0; round < 5; round++) {
  for (const id of ids) {
    for (const data of ['x', '\x7f']) {
      await page.evaluate(([i, d]) => { window.__mt.perf.perf.pendingEcho.set(i, performance.now()); return window.__mt.api.call('terminal.input', { session: i, data: d }); }, [id, data]);
      await sleep(250);
    }
  }
}
result.echoMs = (await page.evaluate(() => window.__mt.perf.snapshot())).echoMs;
log('입력 → 프레임(ms)', result.echoMs);
await sleep(3500); // 사용자 입력 뒤 3초는 전달을 미룬다(B1 규칙 4)

// (3) 실제 턴: 8개가 동시에 150줄씩 출력
if (!skipTurns) {
  await page.evaluate(() => window.__mt.perf.reset());
  await electronMetrics();
  const p1 = pidsOf(await status());
  const all1 = [p1.backend, p1.herdrServer, ...p1.controllers, ...ePids];
  const q0 = procs(all1);
  await page.evaluate(() => { window.__turns = {}; window.__mt.api.on('session.state', (d) => { const t = (window.__turns[d.sessionId] ||= {}); if (d.to === 'working') t.working = true; if (d.to === 'ready' && t.working) t.done = Date.now(); }); });
  const t0 = Date.now();
  const r = await page.evaluate(() => window.__mt.api.call('session.send', { target: ['all'], text: 'Output the integers from 1 to 150, one per line, and nothing else.' }));
  log('보냄', r.deliveries.map((d) => d.name).join(','));
  const peak = { electronMB: 0, controllersMB: 0 };
  let midShot = false;
  while (Date.now() - t0 < 120000) {
    const em = await electronMetrics();
    peak.electronMB = Math.max(peak.electronMB, emTotal(em));
    peak.controllersMB = Math.max(peak.controllersMB, sum(Object.values(procs(p1.controllers))));
    if (!midShot && Date.now() - t0 > 4000) { await shot(page, `e5-${mode}-burst`, log); midShot = true; }
    if (await page.evaluate((n) => Object.values(window.__turns).filter((t) => t.done).length >= n, ids.length)) break;
    await sleep(500);
  }
  const sec = (Date.now() - t0) / 1000;
  const em2 = await electronMetrics();
  const q1 = procs(all1);
  const loadCpu = cpuPct(q0, q1, sec);
  const pf = await page.evaluate(() => window.__mt.perf.snapshot());
  result.turns = {
    seconds: +sec.toFixed(1), turnsDone: await page.evaluate(() => Object.values(window.__turns).filter((t) => t.done).length),
    frames: pf.frames, bytes: pf.bytes, bytesPerSession: Math.round(pf.bytes / ids.length),
    writeMs: pf.writeMs, rafGapMs: pf.rafGapMs, longFramesOver50ms: pf.longFrames,
    electron: { byType: emSummary(em2), cpuPctOs: eCpu(q0, q1, sec), peakTotalWsMB: peak.electronMB },
    controllers: { peakTotalWsMB: peak.controllersMB, cpuPct: p1.controllers.map((p) => loadCpu[p]) },
    backend: { cpuPct: loadCpu[p1.backend], wsMB: q1[p1.backend] && q1[p1.backend].wsMB }, herdrServer: { cpuPct: loadCpu[p1.herdrServer], wsMB: q1[p1.herdrServer] && q1[p1.herdrServer].wsMB },
    contextLost: await page.evaluate(() => window.__mt.budget.lost),
  };
  log('실제 턴 8개 동시', result.turns);
  await shot(page, `e5-${mode}-after-turns`, log);
}

// (4) 합성 부하: 실제 턴의 프레임은 화면 차이분이라 작다. docs/log/p2-window.md의 기준(턴 하나 100~135KB)을 창 쪽에서 재현한다.
const rec = JSON.parse(fs.readFileSync(path.join(OUT, '..', 'e4-frames-fullscreen.json'), 'utf8'));
const targets = (await status()).relay.map((x) => ({ sessionId: x.sessionId, controllerPid: x.controllerPid }));
async function replay(label, paced) {
  await page.evaluate(() => window.__mt.perf.reset());
  await electronMetrics();
  const c0 = procs(ePids);
  const t = Date.now();
  await page.evaluate(([frames, tg, pacedRun]) => new Promise((resolve) => {
    let i = 0; const start = performance.now(); const t0 = frames[0].t;
    const step = () => {
      const now = performance.now() - start;
      while (i < frames.length && (!pacedRun || frames[i].t - t0 <= now)) {
        const f = frames[i++];
        for (const x of tg) window.__mt.api.emit('terminal.frame', { sessionId: x.sessionId, controllerPid: x.controllerPid, seq: i, full: f.full, width: f.w, height: f.h, bytes: f.b });
        if (!pacedRun) break;
      }
      if (i >= frames.length) setTimeout(resolve, 300); else setTimeout(step, pacedRun ? 4 : 0);
    };
    step();
  }), [rec.frames, targets, paced]);
  const secs = (Date.now() - t) / 1000;
  const em = await electronMetrics();
  const c1 = procs(ePids);
  const pf = await page.evaluate(() => window.__mt.perf.snapshot());
  const out = { seconds: +secs.toFixed(2), frames: pf.frames, bytes: pf.bytes, writeMs: pf.writeMs, rafGapMs: pf.rafGapMs, longFramesOver50ms: pf.longFrames, electron: emSummary(em), electronCpuPctOs: eCpu(c0, c1, secs), contextLost: await page.evaluate(() => window.__mt.budget.lost) };
  log(label, out);
  return out;
}
result.replay = {
  source: 'experiments/e4-frames-fullscreen.json (256 frames, 135KB, 120x40) x 8 terminals',
  paced: await replay('합성 부하(기록된 시간 간격대로)', true),
  flood: await replay('합성 부하(쉬지 않고)', false),
};
await shot(page, `e5-${mode}-replay`, log);

// 합성 프레임으로 어지럽힌 화면을 되돌린다: 멀리 갔다가(제어기 놓기) 다시 와서(다시 붙기) 첫 전체 프레임으로 복원(C1과 같은 길)
await page.evaluate(() => window.__mt.getState().setViewport({ x: 0, y: 0, zoom: 0.15 }));
await until(() => page.evaluate(() => window.__mt.getState().attached.length === 0 && Object.keys(window.__mt.perf.snapshot().terminals).length === 0), 15000);
await page.evaluate((v) => window.__mt.getState().setViewport(v), VP);
await until(() => page.evaluate(() => Object.keys(window.__mt.perf.snapshot().terminals).length >= 8), 20000);
await sleep(3000);
result.restoredAfterReplay = await page.evaluate(async () => {
  let rows = 0, diff = 0;
  for (const [id, t] of window.__mt.terms) {
    const h = (await window.__mt.api.call('terminal.snapshot', { session: id, format: 'text' })).text.split('\n').map((l) => l.replace(/\s+$/, ''));
    for (let r = 0; r < t.rows; r++) { rows++; if (t.buffer.active.getLine(r).translateToString(true).replace(/\s+$/, '') !== (h[r] || '')) diff++; }
  }
  return { terminals: window.__mt.terms.size, rows, diffRows: diff };
});
log('다시 붙인 뒤 화면 복원', result.restoredAfterReplay);
await shot(page, `e5-${mode}-restored`, log);
fs.writeFileSync(path.join(OUT, `e5-${mode}.json`), JSON.stringify(result, null, 2));
log('저장', `experiments/p2/e5-${mode}.json`);
await app.close();
