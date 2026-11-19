// P113: 창을 닫고 트레이에 남을 때 GPU 프로세스가 쥔 메모리를 돌려준다.
// - 창을 없애도 GPU 프로세스는 남는다(트레이 상주). 창이 쓰던 그림(공유 이미지, WebGL 터미널)을 풀어도 그 메모리는 그래픽 드라이버·ANGLE의 풀에 남아
//   GPU 프로세스 private이 닫힌 동안 140~200MB에 머문다(Chromium 할당자로 잡히는 것은 40MB쯤). 메모리 압박 신호를 받아야 풀을 비운다.
// - 압박 신호는 무거운 페이지를 먼저 내린 뒤에 보내야 듣는다(창이 살아 있을 때 보내면 그 뒤 풀린 메모리는 다시 남는다).
//   그래서 창을 숨기고 → 페이지를 about:blank로 바꾸고 → 잠깐 기다린 뒤 → 그 창의 webContents.debugger로 Memory.simulatePressureNotification을 보내고 → 창을 없앤다.
//   Electron에는 압박 신호를 보내는 공개 API가 없고, DevTools 프로토콜의 이 명령은 브라우저·GPU를 포함한 모든 프로세스에 간다.
// - 같은 단계를 거듭 보내면 두 번째부터는 GPU 프로세스가 듣지 않는다(단계가 바뀔 때만 전해진다. 개발용 판에서 잼, critical → critical은 그대로).
//   그래서 닫을 때마다 아래 단계 하나를 먼저 보내 단계를 바꾼 뒤 고른 단계를 보낸다(critical이면 moderate → critical).
// - 앱을 끝낼 때(트레이 끝내기, 업데이트)와 트레이 상주가 꺼져 있을 때는 하지 않는다(프로세스가 곧 끝난다).
export const PURGE_SETTLE_MS = 500; // about:blank를 읽은 뒤 GPU 프로세스가 옛 페이지의 자원을 풀 때까지
export const PURGE_TIMEOUT_MS = 3000; // 이보다 오래 걸리면 그냥 창을 없앤다
export const PURGE_LEVELS = ['moderate', 'critical'];

// 닫는 창에 할지. level이 'off'면 하지 않는다(개발용 판의 비교 시험, ATRIUM_GPU_PURGE)
export function shouldPurgeOnClose({ keepRunning, quitting, updating, level }) {
  return !!keepRunning && !quitting && !updating && PURGE_LEVELS.includes(level);
}

// 보낼 단계들: 지난번과 같은 단계는 전해지지 않으므로 다른 단계를 먼저 보낸다
export function pressureSteps(level) { return level === 'critical' ? ['moderate', 'critical'] : ['critical', 'moderate']; }

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms) => {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms); });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
};

// win: 닫는 BrowserWindow(close를 막은 뒤). 끝나면 늘 창을 없앤다. 돌려주는 값은 기록용 { ok, ms, error? }
export async function purgeAndDestroy(win, { level = 'critical', settleMs = PURGE_SETTLE_MS, timeoutMs = PURGE_TIMEOUT_MS, sleep = delay } = {}) {
  const t0 = Date.now();
  const res = { ok: false, level };
  try {
    win.hide();
    const wc = win.webContents;
    await within(wc.loadURL('about:blank'), timeoutMs);
    await sleep(settleMs);
    if (win.isDestroyed()) throw new Error('window destroyed');
    const dbg = wc.debugger;
    const mine = !dbg.isAttached();
    if (mine) dbg.attach('1.3');
    try { for (const lv of pressureSteps(level)) await within(dbg.sendCommand('Memory.simulatePressureNotification', { level: lv }), timeoutMs); } finally { if (mine && !win.isDestroyed()) { try { dbg.detach(); } catch {} } }
    res.ok = true;
  } catch (e) {
    res.error = String((e && e.message) || e);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  res.ms = Date.now() - t0;
  return res;
}
