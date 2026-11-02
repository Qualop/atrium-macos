// 자원 감시(ARCH 4절 D1, 5절)와 D3의 프로세스 쪽 신호. 약 30초마다 잰다.
// - 세션별 메모리: herdr pane.process_info로 우리 패널의 셸 PID를 얻고, 그 셸 아래 프로세스(claude와 그 자식)의 작업 집합을 더한다.
// - 제어기: 화면 중계가 띄운 herdr 제어기 프로세스의 메모리
// - herdr 서버와 백엔드 자신의 메모리, 동시 실행 수(working·waiting)
// 프로세스 표는 PowerShell의 Win32_Process 한 번으로 읽는다(읽기만 한다). 프로세스를 끄지 않는다.
import { execFile } from 'node:child_process';
import { readPosixProcesses } from './processes.mjs';

const PS_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '$p = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,Name | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; p = $_.ParentProcessId; w = [int64]$_.WorkingSetSize; n = $_.Name } }',
  "$h = Get-CimInstance Win32_Process -Filter \"Name='herdr.exe'\" -Property ProcessId,CommandLine | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; c = $_.CommandLine } }",
  '[pscustomobject]@{ p = @($p); h = @($h) } | ConvertTo-Json -Compress -Depth 3',
].join('; ');

export async function readProcessTable() {
  if (process.platform !== 'win32') {
    const procs = await readPosixProcesses();
    return procs ? { procs, herdr: [...procs.values()].filter((p) => p.name === 'herdr').map(({ pid, cmd }) => ({ pid, cmd })), at: Date.now() } : null;
  }
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(null);
      try {
        const j = JSON.parse(out);
        const procs = new Map();
        for (const x of [].concat(j.p || [])) procs.set(x.i, { pid: x.i, ppid: x.p, ws: x.w, name: x.n });
        resolve({ procs, herdr: [].concat(j.h || []).map((x) => ({ pid: x.i, cmd: x.c || '' })), at: Date.now() });
      } catch { resolve(null); }
    });
  });
}

// G2(P5): 셸 PID들의 바로 아래 프로세스(셸에서 돌고 있는 명령). Windows에서 herdr pane.process_info는 셸만 준다(P5에서 확인)
export async function childProcesses(pids) {
  const ids = pids.map(Number).filter((p) => Number.isInteger(p) && p > 0);
  if (!ids.length) return Promise.resolve([]);
  if (process.platform !== 'win32') {
    const procs = await readPosixProcesses();
    return procs ? [...procs.values()].filter((p) => ids.includes(p.ppid)).map(({ pid, ppid, name }) => ({ pid, ppid, name })) : [];
  }
  const filter = ids.map((p) => `ParentProcessId=${p}`).join(' OR ');
  const ps = `$ErrorActionPreference = 'SilentlyContinue'; @(Get-CimInstance Win32_Process -Filter '${filter}' -Property ProcessId,ParentProcessId,Name | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; p = $_.ParentProcessId; n = $_.Name } }) | ConvertTo-Json -Compress`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 10000 }, (err, out) => {
      if (err) return resolve([]);
      try { resolve([].concat(JSON.parse(out || '[]') || []).map((x) => ({ pid: x.i, ppid: x.p, name: x.n }))); } catch { resolve([]); }
    });
  });
}

// pid와 그 아래 모든 프로세스
export function descendants(procs, root) {
  const kids = new Map();
  for (const p of procs.values()) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p.pid); }
  const out = []; const seen = new Set(); const stack = [root];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid) || !procs.has(pid)) continue;
    seen.add(pid); out.push(procs.get(pid));
    for (const k of kids.get(pid) || []) stack.push(k);
  }
  return out;
}
export const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

// herdr.exe 명령줄을 낱말로 나눈다(따옴표 안의 공백 유지)
export function argvOf(cmd) { return (String(cmd).match(/"[^"]*"|\S+/g) || []).map((t) => t.replace(/^"|"$/g, '')); }

// D3: 이 세션에 붙은 herdr 화면(TUI) 프로세스. 서버, 판의 제어기(terminal session control), 짧은 API 명령은 빼고,
// 하위 명령 없이 `herdr --session <s>`로 뜬 것과 `herdr session attach <s>`를 화면으로 본다. 이 PC의 프로세스만 보인다.
export function tuiClientsFor(herdrProcs, session) {
  const out = [];
  for (const h of herdrProcs) {
    const a = argvOf(h.cmd).slice(1);
    const si = a.indexOf('--session');
    if (si >= 0 && a[si + 1] === session) {
      const rest = a.filter((_, i) => i !== si && i !== si + 1).filter((t) => !t.startsWith('--'));
      if (rest.length === 0) out.push({ pid: h.pid, how: 'herdr --session' });
    } else if (a[0] === 'session' && a[1] === 'attach' && a[2] === session) out.push({ pid: h.pid, how: 'herdr session attach' });
  }
  return out;
}

export class ResourceMonitor {
  // sample()이 부를 함수들을 받는다. 시험에서 바꿔 넣는다.
  constructor({ sessions, processInfo, controllers, herdrServerPid, session, readTable = readProcessTable, intervalMs = 30000 }) {
    Object.assign(this, { sessions, processInfo, controllers, herdrServerPid, session, readTable, intervalMs });
    this.last = null;
  }
  start(onSample) {
    this.stop(); this.stopped = false; this.onSample = onSample;
    this.timer = setInterval(() => this.sample().catch(() => {}), this.intervalMs);
    this.firstSample = setTimeout(() => this.sample().catch(() => {}), 3000);
  }
  stop() { clearInterval(this.timer); clearTimeout(this.firstSample); this.stopped = true; this.generation = (this.generation || 0) + 1; }

  async sample() {
    if (this.stopped) return this.last;
    const generation = this.generation;
    const t0 = Date.now();
    const table = await this.readTable();
    if (this.stopped || this.generation !== generation) return this.last;
    if (!table) return this.last;
    const list = this.sessions();
    const rows = [];
    for (const s of list) {
      let info = null;
      if (s.paneId) info = await this.processInfo(s.paneId).catch(() => null);
      const shell = info && info.shell_pid;
      const claude = info && (info.foreground_processes || []).find((p) => /claude/i.test(p.name || ''));
      const tree = shell ? descendants(table.procs, shell) : [];
      const claudeTree = claude ? descendants(table.procs, claude.pid) : [];
      rows.push({
        sessionId: s.sessionId, name: s.name, state: s.state, shellPid: shell || null, claudePid: claude ? claude.pid : null,
        memMB: mb(tree.reduce((a, p) => a + p.ws, 0)), claudeMB: mb(claudeTree.reduce((a, p) => a + p.ws, 0)), procs: tree.length,
      });
    }
    const ctl = this.controllers();
    const ctlMB = mb(ctl.reduce((a, c) => a + ((table.procs.get(c.controllerPid) || {}).ws || 0), 0));
    const hp = this.herdrServerPid() || (table.herdr || []).find((h) => {
      const args = argvOf(h.cmd), i = args.indexOf('--session');
      return i >= 0 && args[i + 1] === this.session && args[i + 2] === 'server';
    })?.pid;
    const snap = {
      at: Date.now(), ms: Date.now() - t0,
      sessions: rows,
      sessionCount: list.length,
      sessionsMB: mb(rows.reduce((a, r) => a + r.memMB * 1048576, 0)),
      running: list.filter((s) => s.state === 'working').length,
      waiting: list.filter((s) => s.state === 'waiting' || s.state === 'trust_wait').length,
      controllers: { count: ctl.length, memMB: ctlMB, pids: ctl.map((c) => c.controllerPid) },
      herdrServer: hp && table.procs.get(hp) ? { pid: hp, memMB: mb(table.procs.get(hp).ws) } : null,
      backend: { pid: process.pid, memMB: mb(process.memoryUsage().rss) },
      tuiProcesses: tuiClientsFor(table.herdr, this.session),
    };
    this.last = snap;
    if (!this.stopped && this.generation === generation && this.onSample) this.onSample(snap);
    return snap;
  }
}
