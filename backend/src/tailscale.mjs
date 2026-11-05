// P49(원격 R3): 노트북에서 Tailscale로 이 PC의 판(웹 화면)을 쓴다. 이 모듈은 Tailscale 상태를 읽기만 한다.
// - 읽기: `tailscale status --json`(이름, tailnet, 로그인 사용자, MagicDNS, HTTPS 인증서), `tailscale serve status --json`(serve가 어디로 가는지, funnel).
//   Tailscale이 없거나 꺼져 있어도 판은 그대로 돈다(installed:false, running:false).
// - 바깥 요청: tailscale serve(HTTPS를 이 PC의 tailscaled가 끝내고 http://127.0.0.1:<판 포트>로 넘긴다)를 거친 요청은
//   Host가 `<pc>.<tailnet>.ts.net`이고 Tailscale-User-Login(요청한 사람의 로그인 이름) 머리글이 있다(https://tailscale.com/kb/1312/serve).
//   serve는 요청에 원래 있던 이 머리글을 지우고 다시 채운다. 태그 기기와 funnel(인터넷 공개) 요청에는 이 머리글이 없다.
// - 로그인 사용자 제한(loginAllowed): Tailscale 이름으로 온 요청은 이 PC에 로그인한 Tailscale 사용자(또는 설정의 허용 목록)만 받는다.
// - 바꾸기 명령(serve 켜기·끄기)은 글로만 만든다(serveCommand). 실제 실행은 `atrium remote enable|disable --yes`만 한다(bin/atrium.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { envVar } from './config.mjs';

export const REFRESH_MS = 60_000;
export const RUN_TIMEOUT_MS = 6000;

// tailscale 실행 파일. ATRIUM_TAILSCALE=none이면 읽지 않는다(시험), 경로를 주면 그것
export function tailscaleBin({ env = envVar('TAILSCALE'), platform = process.platform, exists = fs.existsSync, programFiles = process.env.ProgramFiles } = {}) {
  if (env === 'none') return null;
  if (env) return env;
  if (platform === 'win32') {
    const p = path.join(programFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
    if (exists(p)) return p;
  }
  return 'tailscale'; // PATH에서
}

// 읽기 명령만 부른다. 바꾸기 명령은 이 함수로 부르지 않는다
const READ_ONLY = new Set(['status --json', 'serve status --json']);
export function runTailscale(bin, args) {
  if (!READ_ONLY.has(args.join(' '))) return Promise.reject(new Error(`not a read-only tailscale command: ${args.join(' ')}`));
  // 시험: ATRIUM_TAILSCALE이 .mjs면 node로 부른다(가짜 tailscale, app/test/e2e/p49-fake-tailscale.mjs)
  const [file, argv] = /\.m?js$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args];
  return new Promise((res, rej) => execFile(file, argv, { timeout: RUN_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => {
    if (e) return rej(Object.assign(e, { stderr: String(err || '') }));
    res(String(out || ''));
  }));
}

const trimDot = (s) => String(s || '').replace(/\.$/, '').toLowerCase();

// `tailscale status --json` → 판이 쓰는 것만
export function parseStatus(j) {
  if (!j || typeof j !== 'object') return { running: false, loggedIn: false };
  const state = String(j.BackendState || '');
  const self = j.Self || {};
  const users = j.User || {};
  const u = users[String(self.UserID)] || users[self.UserID] || null;
  const tn = j.CurrentTailnet || {};
  const dnsName = trimDot(self.DNSName);
  return {
    backendState: state,
    running: state === 'Running',
    loggedIn: !['NeedsLogin', 'NoState', ''].includes(state) && !!(self.UserID != null && u),
    version: j.Version || null,
    hostName: self.HostName || null,
    dnsName: dnsName || null,
    tailnet: tn.Name || null,
    magicDNSSuffix: trimDot(tn.MagicDNSSuffix || j.MagicDNSSuffix) || null,
    magicDNS: tn.MagicDNSEnabled === true,
    certDomains: Array.isArray(j.CertDomains) ? j.CertDomains.map(trimDot) : [],
    https: Array.isArray(j.CertDomains) && j.CertDomains.length > 0,
    login: u && u.LoginName ? String(u.LoginName) : null,
    health: Array.isArray(j.Health) ? j.Health.slice(0, 10) : [],
  };
}

// 프록시 대상 주소가 이 판 포트인가(127.0.0.1·localhost, 끝 / 있든 없든)
export function proxiesTo(target, port) {
  try { const u = new URL(String(target)); return u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && Number(u.port) === Number(port); } catch { return false; }
}

// `tailscale serve status --json` → 항목 목록(주소:포트, 경로, 프록시 대상 또는 폴더)과 funnel
export function parseServe(j, port) {
  const entries = [];
  const web = (j && j.Web) || {};
  for (const [hp, cfg] of Object.entries(web)) {
    const i = hp.lastIndexOf(':');
    const host = trimDot(i > 0 ? hp.slice(0, i) : hp), p = Number(i > 0 ? hp.slice(i + 1) : 443);
    for (const [mount, h] of Object.entries((cfg && cfg.Handlers) || {})) {
      entries.push({ host, port: p, mount, proxy: h.Proxy || null, path: h.Path ? true : false, text: h.Text ? true : false, toBoard: !!(h.Proxy && proxiesTo(h.Proxy, port)) });
    }
  }
  const tcp = (j && j.TCP) || {};
  const funnel = Object.entries((j && j.AllowFunnel) || {}).filter(([, v]) => v).map(([k]) => k);
  return {
    entries,
    tcpPorts: Object.keys(tcp).map(Number).filter(Number.isFinite),
    funnel,
    board: entries.find((e) => e.toBoard && e.mount === '/') || entries.find((e) => e.toBoard) || null,
  };
}

// 한 번 읽기. run(bin, args)을 바꿔 시험한다
export async function readTailscale({ port, bin = tailscaleBin(), run = runTailscale } = {}) {
  const at = Date.now();
  if (!bin) return { at, installed: false, disabled: true, status: null, serve: null, error: null };
  let status = null, serve = null, error = null, installed = true;
  try { status = parseStatus(JSON.parse(await run(bin, ['status', '--json']))); }
  catch (e) {
    if (e && (e.code === 'ENOENT' || /not recognized|not found/i.test(String(e.message)))) installed = false;
    else {
      // 꺼져 있으면 status가 실패하거나 BackendState가 Stopped다. stdout에 JSON이 왔으면 그것을 쓴다
      error = String((e && (e.stderr || e.message)) || e).split('\n')[0].slice(0, 200);
      status = { running: false, loggedIn: false, backendState: 'Unknown' };
    }
  }
  if (installed && status && status.running) {
    try { serve = parseServe(JSON.parse((await run(bin, ['serve', 'status', '--json'])) || '{}'), port); }
    catch (e) { serve = { entries: [], tcpPorts: [], funnel: [], board: null, error: String((e && e.message) || e).slice(0, 200) }; }
  }
  return { at, installed, status, serve, error };
}

// Host 허용 목록에 저절로 넣을 이름: Tailscale 이름(https 기본 포트는 Host에 포트가 없다), serve가 다른 https 포트면 그 포트도
export function tailscaleHosts(ts) {
  const out = [];
  const name = ts && ts.status && ts.status.dnsName;
  if (!name) return out;
  out.push(name);
  const ports = new Set([443]);
  if (ts.serve && ts.serve.board) ports.add(ts.serve.board.port);
  for (const p of ports) out.push(`${name}:${p}`);
  return out;
}

// 이 요청이 바깥(앞단 프록시, Tailscale)에서 왔는가. 그러면 원격 연결로 다룬다(로그인 제한, 프레임 묶기, 압축)
const FORWARD = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip'];
export function isRemoteRequest(req, port) {
  const h = req.headers || {};
  const host = String(h.host || '').toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return true;
  return FORWARD.some((k) => h[k] != null) || Object.keys(h).some((k) => k.startsWith('tailscale-'));
}

// 로그인 사용자 제한. policy = { sameUser: 설정 remoteSameUser(기본 켬), allowed: 허용 로그인 목록, self: 이 PC의 Tailscale 로그인, tsHosts: Tailscale 이름들 }
// - Tailscale-User-Login이 있으면: sameUser가 꺼졌으면 받고, 아니면 이 PC의 로그인이나 허용 목록에 있을 때만 받는다(대소문자 무시)
// - 머리글이 없는데 Tailscale 이름으로 왔으면(태그 기기, funnel): sameUser가 켜져 있으면 막는다
// - 그 밖(이 PC 안, ATRIUM_WEB_HOSTS의 다른 앞단): 이 규칙과 상관없다
export function loginAllowed(req, policy) {
  const h = req.headers || {};
  const login = h['tailscale-user-login'] != null ? String(h['tailscale-user-login']).trim().toLowerCase() : null;
  const host = String(h.host || '').toLowerCase();
  const viaTs = (policy.tsHosts || []).some((x) => String(x).toLowerCase() === host);
  if (login === null) {
    if (viaTs && policy.sameUser !== false) return { ok: false, reason: 'no_login', login: null };
    return { ok: true, reason: null, login: null };
  }
  if (policy.sameUser === false) return { ok: true, reason: null, login };
  const ok = (policy.self && login === String(policy.self).toLowerCase()) || (policy.allowed || []).some((x) => String(x).trim().toLowerCase() === login);
  return ok ? { ok: true, reason: null, login } : { ok: false, reason: policy.self || (policy.allowed || []).length ? 'other_user' : 'self_unknown', login };
}
export const parseLogins = (s) => String(s || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

// serve 켜기·끄기 명령(글). funnel은 쓰지 않는다
export const DEFAULT_HTTPS_PORT = 443;
export function serveCommand(port, httpsPort = DEFAULT_HTTPS_PORT) { return ['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${port}`]; }
export function serveOffCommand(port, httpsPort = DEFAULT_HTTPS_PORT) { return ['serve', `--https=${httpsPort}`, `http://127.0.0.1:${port}`, 'off']; }
export function remoteUrl(ts, httpsPort) {
  const name = ts && ts.status && ts.status.dnsName;
  if (!name) return null;
  const p = httpsPort || (ts.serve && ts.serve.board ? ts.serve.board.port : DEFAULT_HTTPS_PORT);
  return `https://${name}${p === 443 ? '' : `:${p}`}/`;
}

// enable 전에 볼 것: 그 https 포트를 이미 다른 대상이 쓰는가(덮어쓰지 않게)
export function portConflict(ts, port, httpsPort = DEFAULT_HTTPS_PORT) {
  const es = (ts && ts.serve && ts.serve.entries) || [];
  const other = es.filter((e) => e.port === Number(httpsPort) && !e.toBoard);
  return other.length ? { httpsPort: Number(httpsPort), mounts: other.map((e) => e.mount) } : null;
}
// 비어 있는 https 포트 고르기(제안용). 443부터 Tailscale serve가 받는 포트 가운데
export function freeHttpsPort(ts, prefer = [443, 8443, 10000]) {
  const used = new Set(((ts && ts.serve && ts.serve.entries) || []).filter((e) => !e.toBoard).map((e) => e.port));
  return prefer.find((p) => !used.has(p)) || null;
}

// 진단. ctx = { port, hosts(허용 목록), devices(짝 맺은 수), built(화면 빌드), sameUser, allowed }
// 항목마다 { id, level: 'ok'|'warn'|'fail'|'skip', vars }. 글은 창과 CLI가 열쇠(remote.check.<id>.<level>)로 만든다
export function diagnose(ts, ctx) {
  const out = [];
  const add = (id, level, vars = {}) => out.push({ id, level, vars });
  const st = ts && ts.status;
  const sv = ts && ts.serve;
  if (!ts || !ts.installed) { add('installed', ts && ts.disabled ? 'skip' : 'fail'); return finish(out, ts, ctx); }
  add('installed', 'ok', { version: (st && st.version) || '' });
  if (!st || !st.running) { add('running', 'fail', { state: (st && st.backendState) || '' }); return finish(out, ts, ctx); }
  add('running', 'ok');
  add('login', st.loggedIn ? 'ok' : 'fail', { login: st.login || '' });
  add('magicdns', st.magicDNS ? 'ok' : 'fail', { name: st.dnsName || '' });
  add('https', st.https ? 'ok' : 'fail');
  if (sv && sv.board) add('serve', 'ok', { httpsPort: sv.board.port });
  else {
    const c = portConflict(ts, ctx.port);
    add('serve', c ? 'warn' : 'fail', { httpsPort: c ? c.httpsPort : DEFAULT_HTTPS_PORT, free: freeHttpsPort(ts) || '' });
  }
  const funnelOn = !!(sv && sv.funnel && sv.funnel.length);
  const funnelBoard = funnelOn && sv.board && sv.funnel.some((k) => k.endsWith(`:${sv.board.port}`));
  add('funnel', funnelBoard ? 'fail' : funnelOn ? 'warn' : 'ok', { ports: funnelOn ? sv.funnel.join(', ') : '' });
  const name = st.dnsName;
  add('hosts', name && ctx.hosts && ctx.hosts.includes(name) ? 'ok' : 'fail', { name: name || '' });
  return finish(out, ts, ctx);
}
function finish(out, ts, ctx) {
  out.push({ id: 'built', level: ctx.built === false ? 'fail' : ctx.built === undefined ? 'skip' : 'ok', vars: {} });
  out.push({ id: 'devices', level: ctx.devices == null ? 'skip' : ctx.devices > 0 ? 'ok' : 'warn', vars: { n: ctx.devices || 0 } }); // null: 백엔드 없이 읽음
  out.push({ id: 'users', level: ctx.sameUser === false ? 'warn' : 'ok', vars: { n: (ctx.allowed || []).length } });
  const ready = !out.some((c) => c.level === 'fail');
  const st = ts && ts.status;
  const board = ts && ts.serve && ts.serve.board;
  const httpsPort = board ? board.port : (portConflict(ts, ctx.port) ? freeHttpsPort(ts) : DEFAULT_HTTPS_PORT) || DEFAULT_HTTPS_PORT;
  return {
    checks: out,
    ready,
    url: st && st.dnsName ? remoteUrl(ts, httpsPort) : null,
    httpsPort,
    enable: board ? null : `atrium remote enable --yes${httpsPort !== 443 ? ` --https-port ${httpsPort}` : ''}`,
    login: (st && st.login) || null,
    readAt: ts ? ts.at : null,
  };
}

// 상태를 들고 있다가 주기마다 다시 읽는다. onChange(ts)는 이름이 바뀔 때(허용 목록)
export class TailscaleWatch {
  constructor({ port, bin, run, log = () => {}, onChange = () => {}, refreshMs = REFRESH_MS }) {
    this.port = port; this.bin = bin === undefined ? tailscaleBin() : bin; this.run = run || runTailscale; this.log = log; this.onChange = onChange;
    this.last = { at: 0, installed: !!this.bin, disabled: !this.bin, status: null, serve: null, error: null };
    this.refreshMs = refreshMs; this.timer = null; this.pending = null;
  }
  start(firstDelayMs = 500) {
    if (!this.bin || this.timer) return;
    this.firstTimer = setTimeout(() => this.refresh().catch(() => {}), firstDelayMs); this.firstTimer.unref?.();
    this.timer = setInterval(() => this.refresh().catch(() => {}), this.refreshMs); this.timer.unref?.();
  }
  stop() { clearTimeout(this.firstTimer); clearInterval(this.timer); this.firstTimer = this.timer = null; }
  refresh() {
    if (!this.bin) return Promise.resolve(this.last);
    if (this.pending) return this.pending;
    this.pending = readTailscale({ port: this.port, bin: this.bin, run: this.run }).then((ts) => {
      const before = JSON.stringify(tailscaleHosts(this.last)) + (this.last.status && this.last.status.login);
      this.last = ts;
      if (before !== JSON.stringify(tailscaleHosts(ts)) + (ts.status && ts.status.login)) { try { this.onChange(ts); } catch {} }
      return ts;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  hosts() { return tailscaleHosts(this.last); }
  selfLogin() { return (this.last.status && this.last.status.login) || null; }
}
