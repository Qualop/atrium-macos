// P49(원격 R3): 원격 클라이언트(tailscale serve를 거친 브라우저)에게 터미널 프레임을 패널마다 묶어 보낸다.
// - 쉬다가 온 첫 프레임은 바로 보낸다(타자 메아리가 늦지 않게). 그 뒤 간격(기본 33ms, 초당 30번) 안에 온 프레임은 모아 간격 끝에 한 번 보낸다.
// - 모으기: 바뀐 부분(full이 아닌 프레임)의 바이트를 순서대로 잇는다. 터미널 출력은 이어진 VT 흐름이라 이어 써도 같은 화면이 된다.
//   full 프레임(화면 전체)이 오면 그 전에 모은 것은 버리고 full부터 다시 모은다. 크기(width×height)가 바뀌면 모은 것을 먼저 보낸다.
// - 이 PC 안의 창은 묶지 않는다(지금처럼 바로 보낸다).
export const REMOTE_BATCH_MS = 33;

const b64 = (s) => Buffer.from(String(s || ''), 'base64');

// 프레임 두 개(이미 모은 것 a, 새로 온 것 f)를 하나로. 크기가 다르면 null(따로 보낸다)
export function mergeFrames(a, f) {
  if (!a) return { ...f, merged: 1 };
  if (f.full) return { ...f, merged: (a.merged || 1) + 1 }; // full이 앞의 것을 덮는다
  if ((f.width && a.width && f.width !== a.width) || (f.height && a.height && f.height !== a.height)) return null;
  return { ...a, seq: f.seq ?? a.seq, bytes: Buffer.concat([b64(a.bytes), b64(f.bytes)]).toString('base64'), merged: (a.merged || 1) + 1, full: !!a.full };
}

// 한 클라이언트·한 패널의 묶음. send(frame)로 보낸다. timers는 시험에서 바꾼다
export class FrameBatcher {
  constructor({ send, intervalMs = REMOTE_BATCH_MS, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t) }) {
    this.send = send; this.ms = intervalMs; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.pending = null; this.timer = null; this.lastSent = -Infinity;
    this.stats = { in: 0, out: 0 };
  }
  push(f) {
    this.stats.in++;
    if (this.ms <= 0) return this._out(f);
    // 쉬다가 온 첫 프레임: 바로
    if (!this.pending && !this.timer && this.now() - this.lastSent >= this.ms) return this._out(f);
    const m = mergeFrames(this.pending, f);
    if (m) this.pending = m;
    else { this._out(this.pending); this.pending = { ...f, merged: 1 }; }
    if (!this.timer) this.timer = this.setTimer(() => this.flush(), Math.max(1, this.ms - (this.now() - this.lastSent)));
  }
  flush() {
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    if (!this.pending) return;
    const p = this.pending; this.pending = null;
    this._out(p);
  }
  drop() { if (this.timer) this.clearTimer(this.timer); this.timer = null; this.pending = null; }
  _out(f) { this.lastSent = this.now(); this.stats.out++; const { merged, ...rest } = f; this.send(merged > 1 ? { ...rest, merged } : rest); }
}
