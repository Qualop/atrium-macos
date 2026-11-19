// macOS 판: 백엔드 메모리 돌려주기. 대화 기록 훑기(recall.mjs, 15초마다·처음엔 전체)는 읽는 동안 큰 글을 잠깐 만든다.
// 살아 있는 JS 객체는 20MB 안팎인데(2026-11-18 힙 스냅샷 18MB), V8은 쓰레기를 치운 힙을 OS에 바로 돌려주지 않아 백엔드가 200~400MB로 남았다.
// 전체 GC 뒤에는 physical footprint가 340MB → 104MB로 줄었다(같은 날 개발용 판에서 잼). 그래서 큰 일을 마친 뒤 쉬는 틈에 GC를 한 번 부른다.
// - GC 함수는 실행 인자(--expose-gc) 없이 얻는다(v8.setFlagsFromString + vm). 못 얻으면 아무것도 하지 않는다
// - 너무 자주 부르지 않는다(minGapMs). 힙에 치울 것이 적으면(slackBytes 아래) 부르지 않는다. 한 번은 수십 ms라 15초마다 돌아도 부담이 작다
import v8 from 'node:v8';
import vm from 'node:vm';

let gcFn = null;
export function gcFunction() {
  if (gcFn !== null) return gcFn;
  try { v8.setFlagsFromString('--expose-gc'); gcFn = vm.runInNewContext('gc'); if (typeof gcFn !== 'function') gcFn = undefined; } catch { gcFn = undefined; }
  return gcFn;
}

export class MemTrim {
  // heapCapBytes: 힙 전체(heapTotal)가 이보다 크면 여유와 상관없이 정리한다. 설치본에서 여유 조건만으로는 정리가 돌지 않아 힙이 120MB로 남았다(2026-11-18, 살아 있는 것은 15MB)
  constructor({ log = () => {}, minGapMs = 60 * 1000, slackBytes = 24 * 1024 * 1024, heapCapBytes = 64 * 1024 * 1024, periodMs = 2 * 60 * 1000, gc = gcFunction(), mem = () => process.memoryUsage() } = {}) {
    this.log = log; this.minGapMs = minGapMs; this.slackBytes = slackBytes; this.heapCapBytes = heapCapBytes; this.periodMs = periodMs; this.gc = gc; this.mem = mem;
    this.lastAt = -Infinity; this.timer = null; this.count = 0; this.freedMB = 0; this.last = null; this.skipped = 0;
  }
  // 큰 일을 마친 뒤(why: 'scan' 등)와 타이머. 부르면 { why, rssMB, afterMB, heapTotalMB, heapAfterMB, heapMB, ms } | null
  maybe(why = 'idle', { force = false } = {}) {
    if (!this.gc) return null;
    const now = Date.now();
    if (!force && now - this.lastAt < this.minGapMs) return null;
    const m = this.mem();
    if (!force && m.heapTotal - m.heapUsed < this.slackBytes && m.heapTotal < this.heapCapBytes) { this.skipped++; return null; }
    this.lastAt = now;
    const t0 = Date.now();
    // 보통 gc()는 힙을 거의 돌려주지 않는다(75 → 69MB). last-resort는 압축까지 해 OS에 돌려준다(시험: 265 → 14MB, RSS 286 → 68MB). 못 받는 V8이면 보통 gc
    try { try { this.gc({ type: 'major', execution: 'sync', flavor: 'last-resort' }); } catch { this.gc(); } } catch { return null; }
    const a = this.mem();
    const mb = (x) => Math.round(x / 1048576);
    const out = { why, rssMB: mb(m.rss), afterMB: mb(a.rss), heapTotalMB: mb(m.heapTotal), heapAfterMB: mb(a.heapTotal), heapMB: mb(a.heapUsed), ms: Date.now() - t0, at: now };
    this.count++; this.freedMB += Math.max(0, out.heapTotalMB - out.heapAfterMB); this.last = out;
    if (out.heapTotalMB - out.heapAfterMB >= 16 || out.rssMB - out.afterMB >= 16) this.log(`mem trim (${why}) heap ${out.heapTotalMB} → ${out.heapAfterMB}MB (used ${out.heapMB}MB), rss ${out.rssMB} → ${out.afterMB}MB in ${out.ms}ms`);
    return out;
  }
  start() {
    if (this.timer || !this.gc) return this;
    this.timer = setInterval(() => this.maybe('timer'), this.periodMs);
    if (this.timer.unref) this.timer.unref();
    return this;
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  stats() { return { enabled: !!this.gc, timer: !!this.timer, count: this.count, skipped: this.skipped, freedHeapMB: this.freedMB, last: this.last }; }
}
