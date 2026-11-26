// macOS 판: 판의 세션이 일하는 동안 Mac이 잠들지 않게 한다(caffeinate).
// 까닭: 2026-11-19 실험 D에서 밤에 Mac이 잠들어 워커의 턴이 API 오류("Your computer went to sleep mid-response")로 끊겼고,
//   리드가 그걸 모른 채 50분을 쉬었다. 끊긴 것을 알리는 것(branch.noteTurnFailed)보다 잠들지 않는 것이 낫다.
// - 일하는 세션(state working)이 하나라도 있으면 `caffeinate -i -s -w <백엔드 PID>`를 띄운다.
//   -i: 쉬는 동안의 잠들기를 막는다. -s: 전원에 꽂혀 있으면 시스템 잠들기도 막는다. -w: 백엔드가 끝나면 caffeinate도 끝난다(남지 않는다).
//   화면은 꺼져도 된다(-d를 쓰지 않는다). 노트북 덮개를 닫은 잠들기는 막지 못한다(macOS 규칙).
// - 모두 쉬면 graceMs(기본 2분) 뒤 끈다. 그 사이 다시 일하면 그대로 둔다(턴 사이 짧은 쉼마다 껐다 켜지 않게).
// - 설정 keepAwake(기본 켬)가 끄면 바로 끈다. macOS가 아니면 아무것도 하지 않는다.
import { spawn as nodeSpawn } from 'node:child_process';

export const KEEP_AWAKE_GRACE_MS = 120_000;

export class KeepAwake {
  constructor({ platform = process.platform, spawn = nodeSpawn, pid = process.pid, enabled = () => true, graceMs = KEEP_AWAKE_GRACE_MS, log = () => {}, now = Date.now } = {}) {
    this.platform = platform; this.spawn = spawn; this.pid = pid; this.enabled = enabled; this.graceMs = graceMs; this.log = log; this.now = now;
    this.working = new Set(); // 일하는 세션 ID
    this.child = null; this.offTimer = null; this.since = null;
  }
  // 세션 상태가 바뀔 때(backend.broadcastSession) 부른다
  onState(sessionId, state) {
    if (state === 'working') this.working.add(sessionId); else this.working.delete(sessionId);
    this.update();
  }
  onClosed(sessionId) { this.working.delete(sessionId); this.update(); }
  // 지금 붙잡고 있나(진단·화면)
  status() { return { active: !!this.child, working: this.working.size, since: this.since, enabled: this.supported() && !!this.enabled() }; }
  supported() { return this.platform === 'darwin'; }
  update() {
    if (!this.supported()) return;
    const want = !!this.enabled() && this.working.size > 0;
    if (want) {
      if (this.offTimer) { clearTimeout(this.offTimer); this.offTimer = null; }
      if (!this.child) this.start();
      return;
    }
    if (!this.child) return;
    if (!this.enabled()) { this.stop('setting off'); return; }
    if (!this.offTimer) { this.offTimer = setTimeout(() => { this.offTimer = null; if (this.working.size === 0 || !this.enabled()) this.stop('idle'); }, this.graceMs); this.offTimer.unref?.(); }
  }
  start() {
    try {
      const c = this.spawn('/usr/bin/caffeinate', ['-i', '-s', '-w', String(this.pid)], { stdio: 'ignore', detached: false });
      this.child = c; this.since = this.now();
      c.on?.('exit', () => { if (this.child === c) { this.child = null; this.since = null; } });
      c.on?.('error', (e) => { this.log(`keep-awake error ${e.message}`); if (this.child === c) { this.child = null; this.since = null; } });
      this.log(`keep-awake on (${this.working.size} working)`);
    } catch (e) { this.log(`keep-awake failed ${e.message}`); this.child = null; }
  }
  stop(why = 'stop') {
    if (this.offTimer) { clearTimeout(this.offTimer); this.offTimer = null; }
    const c = this.child; this.child = null; this.since = null;
    if (c) { try { c.kill('SIGTERM'); } catch {} this.log(`keep-awake off (${why})`); }
  }
}
