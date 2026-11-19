// P146: 성능 기록(진단 스위치). 판 설정 perfTrace를 켜면 창(데스크톱·웹)이 30초마다 판 움직임 요약(프레임 간격, 긴 작업, 휠 입력 지연,
// 보이는 노드·터미널 수, 세션 갱신 렌더 수)을 perf.report로 보내고, 백엔드가 그 값을 백엔드 로그에 한 줄씩 남긴다(`perf <종류> {...}`).
// - 값(숫자와 정한 짧은 낱말)만 받는다. 화면 글, 세션 이름, 대화 내용을 담을 필드가 없다(sanitizeReport).
// - 켠 뒤 TRACE_MS(10분)가 지나면 저절로 끈다(잊어도 비용이 남지 않게). 백엔드가 다시 뜰 때 켜져 있으면 끈다.
// - 꺼져 있을 때 창은 아무것도 모으지 않는다(app perf-trace.js).

export const TRACE_MS = 10 * 60_000;
export const REPORT_MS = 30_000; // 창이 요약을 보내는 주기(app perf-trace.js와 같다)
export const GRACE_MS = 5_000; // 끈 뒤에도 이만큼은 받는다(창이 끌 때 보내는 마지막 요약이 끄기보다 늦게 온다)

const KINDS = new Set(['app', 'web', 'phone']);
const num = (v, max = 1e7) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-max, Math.min(max, Math.round(v * 100) / 100)) : null);
// 받는 필드와 그 모양. 숫자 묶음은 정한 키만, 그 밖의 것은 버린다
const STAT_KEYS = ['n', 'p50', 'p95', 'max', 'over33', 'over50', 'ms', 'blockingMs', 'styleLayoutMs', 'scriptMs'];
const GROUPS = ['frames', 'longTasks', 'loaf', 'wheel', 'nodes', 'renders', 'rebuild', 'view'];
const GROUP_KEYS = {
  frames: STAT_KEYS, longTasks: STAT_KEYS, loaf: STAT_KEYS, wheel: STAT_KEYS,
  nodes: ['total', 'visible', 'sessions', 'convos', 'terms', 'attached', 'webgl', 'dom'],
  renders: ['session', 'convo', 'convoFar'],
  rebuild: ['n', 'same', 'changed'],
  view: ['zoom', 'w', 'h', 'dpr', 'hiddenMs', 'movingMs'],
};

// 창이 보낸 요약에서 정한 숫자만 남긴다
export function sanitizeReport(p, kind) {
  const out = { kind: KINDS.has(kind) ? kind : 'app', sec: num(p && p.sec, 3600) };
  for (const g of GROUPS) {
    const src = p && p[g];
    if (!src || typeof src !== 'object') continue;
    const o = {};
    for (const k of GROUP_KEYS[g]) { const v = num(src[k]); if (v != null) o[k] = v; }
    if (Object.keys(o).length) out[g] = o;
  }
  if (p && typeof p.reason === 'string' && /^[a-z]{1,12}$/.test(p.reason)) out.reason = p.reason; // 'tick' | 'stop' | 'hide'
  return out;
}

// 켠 시각을 기억해 TRACE_MS 뒤 끈다. settings: { get(), set(patch) }
export class PerfTrace {
  constructor({ settings, log = () => {}, now = () => Date.now(), traceMs = TRACE_MS }) {
    this.settings = settings; this.log = log; this.now = now; this.traceMs = traceMs;
    this.timer = null; this.onAt = 0; this.offAt = 0; this.lines = 0;
  }
  on() { try { return !!this.settings.get().perfTrace; } catch { return false; } }
  // 백엔드가 뜰 때: 지난 실행에서 켜 둔 채면 끈다
  start() { if (this.on()) { this.log('perf trace: was on at start, turning off'); this.turnOff(); } }
  // settings.updated를 받을 때마다 부른다
  changed() {
    const on = this.on();
    if (on && !this.timer) {
      this.onAt = this.now(); this.lines = 0;
      this.log(`perf trace: on for ${Math.round(this.traceMs / 60000)} min`);
      this.timer = setTimeout(() => { this.timer = null; this.log('perf trace: time is up, turning off'); this.turnOff(); }, this.traceMs);
      this.timer.unref?.();
    } else if (!on && this.timer) {
      clearTimeout(this.timer); this.timer = null; this.offAt = this.now();
      this.log(`perf trace: off (${this.lines} reports)`);
    }
  }
  turnOff() { this.offAt = this.now(); try { this.settings.set({ perfTrace: false }); } catch (e) { this.log(`perf trace: could not turn off: ${e.message}`); } }
  stop() { clearTimeout(this.timer); this.timer = null; }
  // perf.report 처리. 꺼져 있으면 버린다
  report(p, c) {
    if (!this.on() && !(this.offAt && this.now() - this.offAt < GRACE_MS)) return { ok: false, off: true };
    const kind = c && c.kind === 'web' ? (p && p.phone ? 'phone' : 'web') : 'app';
    const r = sanitizeReport(p, kind);
    this.lines++;
    this.log(`perf ${r.kind} ${JSON.stringify(r)}`);
    return { ok: true };
  }
  status() { return { on: this.on(), since: this.timer ? this.onAt : null, untilMs: this.timer ? Math.max(0, this.onAt + this.traceMs - this.now()) : 0, reports: this.lines }; }
}
