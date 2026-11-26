// P117·P129: 옛 판 옮기기(herdr → hc). 옛 판 옮기기 모듈(herdr-migrate)의 일부다.
// P129: 사람이 누르던 옮기기·되돌리기를 없애고, 옛 herdr 판이 뜰 때 저절로 돈다(index.mjs). 되돌리기(hc → herdr)는 없다.
// 차례:
// 1. 판이 뜰 때 주 백엔드는 이미 hc다(index.mjs openTerminal). 새 세션은 hc에 뜬다. herdr 서버가 없으면(재부팅, herdr 없음) 그 세션들은 판이 hc에서 같은 대화로 되살린다(J1 recreate)
// 2. herdr에 남은 세션을 하나씩 옮긴다. 세션마다 hc에 같은 대화 ID·이름·env·안내문·연결(판의 줄)로 이어 띄우고, 뜬 것(ready 등)을 본 뒤에만 옛 패널을 닫는다.
//    - 판이 띄운 claude: 옛 패널의 claude를 /exit(한 대화를 두 프로세스가 쓰지 않게) → hc에 작업 공간 → 같은 세션 ID로 이어 가기
//    - 판이 띄운 하네스(codex 등, 이어 가기를 아는 것): 끄고(ctrl+c) → hc에서 판의 줄로 이어 가기
//    - 셸: 같은 폴더의 새 셸. 끝난 세션(exited): 남은 셸 자리만 옮긴다
//    - 판에 올린 claude(판이 띄우지 않음): 그 대화 ID로 이어 간다(J1 되살리기와 같은 줄)
//    - 잠든 세션: 패널이 없다. 잠든 채 두고, 깨면 hc에서 뜬다
//    - 일하는 중·응답 필요·쓰다 만 글·전달 대기·뒤 일·도는 명령, 이어 가기를 모르는 판에 올린 에이전트: 끝날 때까지 기다린다(시간 제한 없이 다시 본다. 판 위 띠가 무엇을 기다리는지 보인다)
//    실패하면 새 자리를 닫고 옛 패널에서 판의 줄로 다시 이어 간 뒤 잠시 뒤 다시 해 본다(세 번). 노드·자리·덩어리·하위 세션 나무·역할 선은 세션 ID에 붙어 그대로다
// 3. herdr에 판의 세션이 남지 않으면 herdr 어댑터를 떼고, 서버에 패널이 없을 때만 끄고, 판 전용 herdr 세션을 지운다. 판 기록에 끝남을 남긴다(다음에 뜰 때부터 hc 하나)
// 연결 알림(setPane의 새 패널 알림)은 보내지 않는다: 에이전트는 이름으로 부르고(atrium prompt), 옮겨도 이름은 같다
import fs from 'node:fs';
import { deriveState, newRuntime } from '../state.mjs';
import { paneBackend } from './router.mjs';
import { convoOf, wakeArgs, sessionActivity, parseExitBackground } from '../sleep.mjs';
import { waitClaudeExitOr } from '../worktree-exit.mjs';
import { startOpt } from '../launchers.mjs';
import { harnessResumable } from '../harness.mjs';
import { convOf } from '../recall.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHELL = 'shell';
export const MOVE_READY_MS = 90000; // 새 자리에서 준비되기를 기다리는 시간
export const MOVE_TRIES = 3; // 실패한 세션을 다시 해 보는 횟수(모두)
const READY = new Set(['ready', 'working', 'waiting', 'trust_wait', 'error']);
const apiError = (code, message) => Object.assign(new Error(message), { code });
const FROM = 'herdr', TO = 'hc';
// rt.move를 빼고 본 상태(옮기는 동안 판에는 starting으로 보인다)
const realState = (rt) => deriveState({ ...rt, move: null }).state;

// 세션 하나를 어떻게 옮길지(순수 함수). x: { paneId, kind, hooked, origin, state, sleeping, harness, adoptedConv, busy }
// → { plan } | { wait: 까닭 } | { skip: 까닭 }
export function movePlan(x) {
  if (x.sleeping) return { plan: 'asleep' };
  if (!x.paneId) return { skip: 'no_pane' };
  if (x.busy) return { wait: x.busy };
  if (x.kind === SHELL) return { plan: 'shell' };
  if (x.state === 'exited') return { plan: 'pane' };
  if (x.kind === 'claude' && x.hooked) return { plan: 'claude' };
  if (x.harness) return { plan: 'harness' };
  if (x.kind === 'claude' && x.adoptedConv) return { plan: 'adopted_claude' };
  return { wait: x.origin === 'adopted' ? 'adopted' : 'not_resumable' }; // P129: 이어 가기를 모르는 에이전트는 끝나 셸이 될 때까지 기다린다
}

// 옛 판 옮기기 하나(판이 뜰 때 한 번). b: Backend, router: 라우터(주 hc + herdr), herdr: herdr 어댑터(서버가 없어 라우터에서 뗐어도 지우기에 쓴다),
// startPanes: 판이 뜰 때 herdr 패널이던 세션 ID들(되살린 세션을 recreated로 센다)
export class Migrator {
  constructor(b, router, { herdr = null, readyMs = MOVE_READY_MS, pollMs = 2000, retryMs = 30000, restoreMs = 120000, startPanes = [] } = {}) {
    this.b = b; this.r = router; this.herdr = herdr; this.readyMs = readyMs; this.pollMs = pollMs; this.retryMs = retryMs; this.restoreMs = restoreMs;
    this.startPanes = new Set(startPanes);
    this.job = null; this.stopped = false;
    this.last = b.store.getMeta('herdrMigration') || null;
    // 옮기다 백엔드가 꺼졌으면 남은 표시를 지운다(그 세션은 옛 자리나 새 자리에 있다. 판이 다시 맞춘다)
    for (const s of b.sessions.values()) if (s.rt && s.rt.move) { delete s.rt.move; b.store.saveRuntime(s.sessionId, s.rt); }
  }
  where(s) { return s.paneId ? paneBackend(s.paneId) : s.rt && s.rt.sleep ? 'asleep' : 'none'; }
  view(j = this.job) {
    if (!j) return this.last;
    const by = (k) => j.rows.filter((x) => x.result === k).length;
    return { state: j.state, startedAt: j.startedAt, endedAt: j.endedAt || null, error: j.error || null, total: j.rows.length, rows: j.rows.map(({ retryAt, ...x }) => ({ ...x })), moved: by('moved'), asleep: by('asleep'), waiting: by('waiting') + by('pending') + by('moving'), failed: by('failed'), recreated: by('recreated'), stoppedOld: j.stoppedOld || null, deleted: j.deleted ?? null };
  }
  emit() { this.b.api.broadcast('terminal.migrate', this.view()); }
  stop() { this.stopped = true; }
  // 세션 하나를 어떻게 옮길지 미리 본다(바꾸지 않는다)
  info(s) {
    const b = this.b;
    const sl = b.sleeper ? b.sleeper.info(s) : { state: deriveState(s.rt).state };
    const state = deriveState(s.rt).state;
    let busy = null;
    if (s.kind === SHELL) busy = state === 'shell_running' ? 'running' : null;
    else if (state !== 'exited') busy = sessionActivity({ ...sl, state, childBusy: false, parentBusy: false, viewed: false }, { mode: 'hand' });
    if (!busy && b.sleeper && (b.sleeper.going.has(s.sessionId) || b.sleeper.wakes.has(s.sessionId))) busy = 'waking';
    if (!busy && b.killing.has(s.sessionId)) busy = 'closing';
    const conv = s.kind === 'claude' && !b.hooked(s) ? convOf(s) : null;
    return { name: s.name, paneId: s.paneId, kind: s.kind || 'claude', hooked: b.hooked(s), origin: s.origin, state, sleeping: !!s.rt.sleep, harness: !b.hooked(s) && s.kind !== SHELL && harnessResumable(s), adoptedConv: !!(conv && b.recall && b.recall.transcriptExists(conv, s.rt.cwd || s.cwd)), busy };
  }
  // 판이 뜬 뒤(첫 resync 뒤) 한 번 부른다
  start() {
    if (this.job) return this.job.done;
    const b = this.b;
    const rows = [...b.sessions.values()].filter((s) => this.where(s) === FROM || this.startPanes.has(s.sessionId)).map((s) => ({ name: s.name, sessionId: s.sessionId, kind: s.kind || 'claude', result: 'pending', plan: null, reason: null, tries: 0 }));
    const job = this.job = { state: 'preparing', startedAt: Date.now(), rows };
    this.emit();
    job.done = this.run(job).catch((e) => { job.error = { code: e.code || 'error', message: e.message }; }).finally(() => {
      if (this.stopped && job.state !== 'done') return; // 백엔드가 꺼진다. 다음에 뜰 때 다시 한다
      job.endedAt = Date.now();
      if (job.state !== 'done') job.state = 'failed';
      this.last = this.view(job);
      b.store.setMeta('herdrMigration', { ...this.last, rows: this.last.rows.slice(0, 200) });
      b.store.addEvent(null, 'terminal_migrated', { state: job.state, error: job.error || null, moved: this.last.moved, recreated: this.last.recreated, asleep: this.last.asleep, failed: this.last.failed, stoppedOld: job.stoppedOld || null, deleted: job.deleted ?? null, ms: job.endedAt - job.startedAt });
      b.log(`terminal migration: ${job.state}${job.error ? ` ${job.error.code}` : ''} moved=${this.last.moved} recreated=${this.last.recreated} asleep=${this.last.asleep} failed=${this.last.failed}`);
      this.emit();
    });
    return job.done;
  }

  async run(job) {
    const b = this.b, r = this.r;
    // herdr 서버가 없어 판이 hc에서 되살리는 세션(J1)은 되살리기가 끝나기를 기다린다
    if (b.recoveryDone) await b.recoveryDone.catch(() => {});
    job.state = 'moving'; this.emit();
    let pending = [...job.rows];
    while (pending.length && !this.stopped) {
      const next = [];
      for (const row of pending) {
        if (this.stopped) return;
        const s = b.sessions.get(row.sessionId);
        if (!s) { Object.assign(row, { result: 'moved', reason: 'closed' }); continue; }
        const w = this.where(s);
        if (w === TO) { if (row.result !== 'moved') Object.assign(row, { result: row.tries || r.get(FROM) ? 'moved' : 'recreated', reason: null }); continue; }
        if (w === 'asleep') { Object.assign(row, { result: 'asleep', plan: 'asleep', reason: null }); continue; }
        if (w === 'none' || !r.get(FROM)) { Object.assign(row, { result: 'waiting', reason: 'restoring' }); next.push(row); continue; }
        if (row.retryAt && Date.now() < row.retryAt) { next.push(row); continue; }
        const plan = movePlan(this.info(s));
        if (plan.wait || plan.skip) { Object.assign(row, { result: 'waiting', reason: plan.wait || plan.skip }); next.push(row); continue; }
        Object.assign(row, { result: 'moving', plan: plan.plan, reason: null }); this.emit();
        const t0 = Date.now();
        let out;
        try { out = await this.moveOne(s, plan.plan); } catch (e) { out = { result: 'failed', reason: e.code || e.message }; }
        row.ms = Date.now() - t0;
        if (out.result === 'failed') {
          row.tries++;
          if (row.tries < MOVE_TRIES) { Object.assign(row, { result: 'waiting', reason: `retry: ${out.reason}`, retryAt: Date.now() + this.retryMs }); next.push(row); }
          else Object.assign(row, { result: 'failed', reason: out.reason });
        } else Object.assign(row, { result: out.result, reason: out.reason || null, tries: row.tries + 1 });
        this.emit();
      }
      pending = next;
      if (!pending.length) break;
      // herdr 서버가 없는데 되살아나지 않는 세션은 끝없이 기다리지 않는다
      if (!r.get(FROM) && pending.every((x) => x.reason === 'restoring') && Date.now() - job.startedAt > this.restoreMs) { for (const row of pending) Object.assign(row, { result: 'failed', reason: 'not_restored' }); break; }
      this.emit();
      await sleep(this.pollMs);
    }
    if (this.stopped) return;
    await this.finish(job);
  }

  // herdr에 판의 세션이 남지 않으면 떼고, 서버에 패널이 없을 때만 끄고, 판 전용 herdr 세션을 지운다. 끝남을 판 기록에 남긴다
  async finish(job) {
    const b = this.b, r = this.r;
    const left = [...b.sessions.values()].filter((s) => s.paneId && paneBackend(s.paneId) === FROM);
    if (left.length) { job.state = 'failed'; job.error = { code: 'sessions_left', message: `${left.length} session(s) are still in herdr: ${left.map((s) => s.name).join(', ')}` }; return; }
    const old = r.get(FROM) || this.herdr;
    if (old) {
      let panes = null;
      if (r.get(FROM)) { try { panes = (await old.snapshot()).panes.length; } catch {} r.remove(FROM); }
      const running = (await old.probe().catch(() => ({ running: false }))).running;
      if (running && panes === 0) { const st = await old.stopServer().catch((e) => ({ stopped: false, out: e.message })); job.stoppedOld = { stopped: !!st.stopped, panes }; }
      else job.stoppedOld = { stopped: !running, panes };
      if (!(await old.probe().catch(() => ({ running: false }))).running) {
        const del = old.herdrPath ? await old.deleteSession().catch((e) => ({ deleted: false, out: e.message })) : { deleted: false };
        // herdr를 찾지 못했으면(지웠음) 판 전용 세션 폴더만 지운다(그 서버는 돌지 않는다)
        if (!del.deleted && old.sessionDir && fs.existsSync(old.sessionDir)) { try { fs.rmSync(old.sessionDir, { recursive: true, force: true }); } catch {} }
        job.deleted = old.sessionDir ? !fs.existsSync(old.sessionDir) : !!del.deleted;
      } else job.deleted = false; // 판 밖 패널이 남은 herdr 서버는 끄지도 지우지도 않는다
    }
    b.store.setMeta('terminalBackend', { backend: TO, by: 'migrated', from: FROM, at: Date.now() });
    job.state = 'done';
  }

  // ---------- 세션 하나 ----------
  async moveOne(s, plan, to = TO) {
    const b = this.b;
    const old = { paneId: s.paneId, ws: s.termWorkspaceId, rt: s.rt };
    s.rt.move = { to, at: Date.now(), plan };
    b.broadcastSession(s, { cause: `move:${to}` });
    b.killing.add(s.sessionId); // 판이 닫는 옛 패널: "판 밖에서 닫음"으로 보지 않는다. 판에 올린 에이전트를 셸로 내리지 않는다
    let created = null, stopped = false;
    const steps = [];
    try {
      // 1. 옛 패널의 에이전트를 끈다(패널은 남는다)
      if (plan === 'claude' || plan === 'adopted_claude') { stopped = await this.exitClaude(s, steps); }
      else if (plan === 'harness') { stopped = await b.stopHarnessAgent(s, steps); if (!stopped) throw apiError('still_running', `${s.kind} did not stop`); }
      // 2. 새 백엔드에 작업 공간(판이 만드는 패널이라 판에 올리지 않는다)
      created = await b.withNewPane(() => b.adapter.createWorkspace({ backend: to, cwd: plan === 'shell' && s.rt.cwd ? s.rt.cwd : s.cwd, label: s.name }), (x) => b.setPane(s, x.paneId, x.workspaceId, `moved to ${to}`, { quiet: true }));
      try { b.relay.detach(s.sessionId); } catch {}
      steps.push(`${to} workspace ${created.workspaceId}`);
      const shellReady = await b.adapter.waitShellReady(s.paneId, 15000);
      // 3. 같은 줄로 띄우고 뜬 것을 본다
      if (plan === 'shell' || plan === 'pane') {
        if (!shellReady) throw apiError('shell_not_ready', 'new shell did not show a prompt');
        if (plan === 'shell') {
          const rt = newRuntime({ kind: SHELL, hooked: false });
          rt.phase = 'running'; rt.cwd = s.rt.cwd; rt.move = s.rt.move;
          s.rt = rt; s.agentName = s.paneId;
          b.store.updateSession(s.sessionId, { agentName: s.agentName, runtime: rt });
        }
      } else {
        this.resetForLaunch(s);
        if (plan === 'claude') {
          const { args } = wakeArgs(b.launchOf(s), convoOf(s, b.projectsOf ? b.projectsOf(s) : b.cfg.claudeProjects), b.modelNowFor ? b.modelNowFor(s) : s.rt.modelNow);
          await b.adapter.startAgent({ name: s.agentName, paneId: s.paneId, args, ...startOpt(s) });
        } else if (plan === 'harness') await b.startHarness(s, { resume: true, why: 'move' });
        else if (plan === 'adopted_claude') await b.recall.resumeHookless(s, 'move');
        await this.waitReady(s);
      }
      // 4. 옛 자리를 닫는다
      await this.closeOld(s, old, steps);
      delete s.rt.move;
      b.store.addEvent(s.sessionId, 'terminal_moved', { to, plan, from: paneBackend(old.paneId), oldPane: old.paneId, newPane: s.paneId, steps });
      b.broadcastSession(s, { cause: `moved:${to}` });
      return { result: 'moved' };
    } catch (e) {
      steps.push(`failed: ${e.code || e.message}`);
      await this.rollback(s, plan, old, created, stopped, steps).catch((x) => steps.push(`rollback failed: ${x.code || x.message}`));
      delete s.rt.move;
      b.store.addEvent(s.sessionId, 'terminal_move_failed', { to, plan, error: e.code || e.message, steps });
      b.broadcastSession(s, { cause: 'move:failed' });
      return { result: 'failed', reason: e.code || e.message };
    } finally { b.killing.delete(s.sessionId); }
  }
  resetForLaunch(s) {
    const rt = s.rt;
    rt.exit = null; rt.phase = 'starting'; rt.launchedAt = Date.now(); rt.hooksSinceLaunch = 0; rt.sessionEnd = null; rt.pendingAsk = null; rt.exitRequested = false;
    rt.term = { status: null, launchPending: true, agentSessionId: null, present: false, at: Date.now() };
  }
  // claude를 /exit로 끈다(잠재우기와 같은 확인: 워크트리 나가기 질문은 남기기, 뒤 일 확인 창이면 Esc로 닫고 실패)
  async exitClaude(s, steps) {
    const b = this.b;
    if (!s.rt.term.present) return true;
    s.rt.exitRequested = true;
    await b.adapter.sendText(s.paneId, '/exit'); await sleep(150); await b.adapter.paneKeys(s.paneId, ['enter']);
    const w = await waitClaudeExitOr(b, s, b.cfg.killWaitMs, { by: 'move', steps, stopOn: parseExitBackground });
    if (w.stopped || s.rt.term.present) {
      if (b.sleeper) await b.sleeper.restoreAfterExit(s, !!w.stopped).catch(() => {});
      s.rt.exitRequested = false;
      throw apiError(w.stopped ? 'background' : 'still_running', w.stopped ? 'background work is running' : 'claude did not exit after /exit');
    }
    return true;
  }
  async waitReady(s) {
    const t0 = Date.now();
    while (Date.now() - t0 < this.readyMs) {
      if (!this.b.sessions.has(s.sessionId)) throw apiError('closed', 'session closed while moving');
      if (s.rt.exit) throw apiError('resume_failed', `exited right after resume (${s.rt.exit.kind})`);
      const st = realState(s.rt);
      if (READY.has(st) && (s.rt.term.present || s.kind === SHELL)) return st;
      await sleep(200);
    }
    throw apiError('timeout', `not ready in ${Math.round(this.readyMs / 1000)}s`);
  }
  // 옛 자리를 닫는다. 그 작업 공간을 다른 판 세션이 쓰지 않으면 작업 공간째(hc에서 에이전트가 끝나 남은 셸까지), 쓰면 이 세션의 패널만(남은 셸을 따라가 함께)
  async closeOld(s, old, steps) {
    const b = this.b;
    const cur = b.adapter.follow ? await b.adapter.follow(old.paneId).catch(() => old.paneId) : old.paneId;
    const shared = [...b.sessions.values()].some((x) => x !== s && x.termWorkspaceId === old.ws && x.paneId && paneBackend(x.paneId) === paneBackend(old.paneId));
    if (!shared) { await b.adapter.closeWorkspace(old.ws); steps.push(`old workspace ${old.ws} closed`); return; }
    for (const id of new Set([cur, old.paneId])) await b.adapter.closePane(id).then(() => steps.push(`old pane ${id} closed`)).catch(() => {});
  }
  // 새 자리를 닫고 옛 패널로 돌아간다. 에이전트를 껐으면 옛 패널에서 판의 줄로 다시 이어 간다(그 세션은 옛 백엔드에 남는다)
  async rollback(s, plan, old, created, stopped, steps) {
    const b = this.b;
    if (!b.sessions.has(s.sessionId)) return;
    if (created) {
      if (s.rt.term.present && (plan === 'claude' || plan === 'adopted_claude')) { await b.adapter.sendText(s.paneId, '/exit').catch(() => {}); await sleep(150); await b.adapter.paneKeys(s.paneId, ['enter']).catch(() => {}); for (const t = Date.now(); s.rt.term.present && Date.now() - t < 5000;) await sleep(200); }
      if (s.rt.term.present && plan === 'harness') await b.stopHarnessAgent(s, steps).catch(() => {});
      await b.adapter.closeWorkspace(created.workspaceId).catch(() => {});
      steps.push(`new workspace ${created.workspaceId} closed`);
    }
    const back = b.adapter.follow ? await b.adapter.follow(old.paneId).catch(() => old.paneId) : old.paneId; // hc: 에이전트가 끝나 그 자리에 남은 셸
    if (s.paneId !== back) await b.setPane(s, back, old.ws, 'move failed', { quiet: true });
    try { b.relay.detach(s.sessionId); } catch {}
    if (plan === 'shell' || plan === 'pane') { s.rt = old.rt; s.agentName = plan === 'shell' ? old.paneId : s.agentName; b.store.updateSession(s.sessionId, { agentName: s.agentName, runtime: s.rt }); return; }
    if (!stopped) return; // 에이전트를 끄기 전에 실패했다(그대로 돈다)
    this.resetForLaunch(s);
    await b.adapter.waitShellReady(s.paneId, 8000);
    if (plan === 'claude') { const { args } = wakeArgs(b.launchOf(s), convoOf(s, b.projectsOf ? b.projectsOf(s) : b.cfg.claudeProjects), b.modelNowFor ? b.modelNowFor(s) : s.rt.modelNow); await b.adapter.startAgent({ name: s.agentName, paneId: s.paneId, args, ...startOpt(s) }); }
    else if (plan === 'harness') await b.startHarness(s, { resume: true, why: 'move_back' });
    else if (plan === 'adopted_claude') await b.recall.resumeHookless(s, 'move_back');
    steps.push('resumed in the old pane');
  }
}
