// 판 API 클라이언트 도우미: 백엔드 찾기(backend.json + /health), 띄우기, 끄기, WebSocket 요청.
// atrium CLI와 Electron 창(main 프로세스)이 같이 쓴다. 창도 CLI와 같은 방법으로 프로필을 고르고 백엔드를 띄운다.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { profileEnv, BACKEND_ROOT } from './config.mjs';
import { pendingRequest } from './requests.mjs';
import { assertRestartAllowedSync } from './update-lease.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function backendInfo(cfg) { try { return JSON.parse(fs.readFileSync(cfg.backendFile, 'utf8')); } catch { return null; } }

export function health(port) {
  return new Promise((res) => { const r = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (x) => { let b = ''; x.on('data', (d) => (b += d)); x.on('end', () => { try { res(JSON.parse(b)); } catch { res(null); } }); }); r.on('error', () => res(null)); r.on('timeout', () => { r.destroy(); res(null); }); });
}

export class ApiClient {
  constructor(info, { connectTimeoutMs = 10000 } = {}) { this.info = info; this.connectTimeoutMs = connectTimeoutMs; this.n = 0; this.wait = new Map(); this.handlers = []; }
  open({ handshakeTimeoutMs = this.connectTimeoutMs } = {}) {
    return new Promise((res, rej) => {
      this.closed = false;
      this.ws = new WebSocket(`ws://127.0.0.1:${this.info.port}/api?token=${this.info.token}`, { handshakeTimeout: handshakeTimeoutMs });
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        let m; try { m = JSON.parse(String(raw)); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (m.event) { for (const h of this.handlers) h(m.event, m.data); return; }
        const w = this.wait.get(m.id); if (!w) return; this.wait.delete(m.id);
        if (m.error) w.rej(Object.assign(new Error(`${m.error.code}: ${m.error.message}`), { code: m.error.code })); else w.res(m.result);
      });
      this.ws.on('close', () => { const error = new Error('connection closed'); rej(error); for (const w of this.wait.values()) w.rej(error); this.closed = true; });
    });
  }
  call(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(Object.assign(new Error('not connected'), { code: 'disconnected' }));
    const id = ++this.n;
    return pendingRequest(this.wait, id, () => this.ws.send(JSON.stringify({ id, method, params })), { method });
  }
  on(h) { this.handlers.push(h); }
  close() { this.ws?.close(); }
}

export async function connect(cfg) {
  const info = backendInfo(cfg);
  if (!info || !(await health(info.port))) throw new Error(`백엔드가 실행 중이 아닙니다 (프로필 ${cfg.profile}, 데이터 ${cfg.dataDir}). 먼저: atrium${cfg.profile === 'dev' ? ' --dev' : ''} backend start`);
  const c = new ApiClient(info); await c.open(); return c;
}

// 백엔드가 없으면 띄운다. 백엔드는 herdr 서버가 없으면 띄운다(ARCH 1절 백엔드 수명).
// nodePath: 백엔드를 돌릴 지원 Node 런타임. Electron main에서는 process.execPath가 electron.exe라서 따로 준다.
export async function startBackend(cfg, { nodePath = process.execPath } = {}) {
  assertRestartAllowedSync(cfg, { allowPermit: false });
  const info = backendInfo(cfg);
  const live = info && await health(info.port);
  assertRestartAllowedSync(cfg, { allowPermit: false });
  if (live) return { already: true, pid: info.pid, port: info.port };
  fs.mkdirSync(cfg.logDir, { recursive: true });
  const log = fs.openSync(path.join(cfg.logDir, 'backend.out'), 'a');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_)/.test(k)));
  const p = spawn(nodePath, [path.join(BACKEND_ROOT, 'src', 'main.mjs')], { env: { ...env, ...profileEnv(cfg) }, detached: true, stdio: ['ignore', log, log], windowsHide: true });
  let spawnError = null;
  p.on('error', (e) => { spawnError = e; });
  p.unref();
  fs.closeSync(log);
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) { // P18: 처음 뜰 때 옛 판 옮기기(옛 백엔드·herdr 끄기)가 몇십 초 걸릴 수 있다
    await sleep(200);
    if (spawnError) throw new Error(`백엔드 Node 실행 실패 (${nodePath}): ${spawnError.message}`);
    const b = backendInfo(cfg);
    if (b && b.pid === p.pid && (await health(b.port))) {
      const c = new ApiClient(b); await c.open();
      for (let i = 0; i < 50; i++) { const st = await c.call('backend.status'); if (st.herdr.connected || (st.herdr.compat && !st.herdr.compat.ok)) { c.close(); return { started: true, pid: p.pid, port: b.port, ms: Date.now() - t0, herdr: st.herdr }; } await sleep(200); }
      c.close(); return { started: true, pid: p.pid, port: b.port, herdr: 'not connected yet' };
    }
    if (p.exitCode !== null) break;
  }
  // P54: 같은 판을 둘이 함께 띄우면(CLI 둘, 창과 CLI) 늦은 쪽은 포트를 못 열고 끝난다. 먼저 뜬 백엔드가 돌면 그것을 쓴다
  for (let i = 0; i < 15; i++) {
    const other = backendInfo(cfg);
    if (other && other.pid !== p.pid && (await health(other.port))) return { already: true, pid: other.pid, port: other.port };
    await sleep(200);
  }
  // P18: 백엔드가 까닭을 남기고 끝났으면(예: 옛 판을 옮기지 못함) 그 줄을 함께 알린다
  let why = '';
  try { why = fs.readFileSync(path.join(cfg.logDir, 'backend.out'), 'utf8').split(/\r?\n/).reverse().find((l) => /^백엔드를 시작하지 못(?:했다|했습니다):/.test(l)) || ''; } catch {}
  throw new Error(`백엔드가 시작되지 않았습니다${why ? `: ${why.replace(/^백엔드를 시작하지 못(?:했다|했습니다):\s*/, '')}` : ''}. 로그: ${path.join(cfg.logDir, 'backend.out')}`);
}

export async function stopBackend(cfg) {
  const info = backendInfo(cfg);
  if (!info || !(await health(info.port))) return { running: false };
  const c = await connect(cfg); await c.call('backend.shutdown'); c.close();
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) { await sleep(200); if (!(await health(info.port))) return { stopped: true, pid: info.pid, ms: Date.now() - t0 }; }
  return { stopped: false, pid: info.pid };
}
