// P49(원격 R3): 노트북에서 Tailscale로 이 PC의 판(웹 화면)을 쓴다. 이 모듈은 Tailscale 상태를 읽기만 한다.
// - 읽기: `tailscale status --json`(이름, tailnet, 로그인 사용자, MagicDNS, HTTPS 인증서), `tailscale serve status --json`(serve가 어디로 가는지, funnel).
//   Tailscale이 없거나 꺼져 있어도 판은 그대로 돈다(installed:false, running:false).
// - 바깥 요청: tailscale serve(HTTPS를 이 PC의 tailscaled가 끝내고 http://127.0.0.1:<판 포트>로 넘긴다)를 거친 요청은
//   Host가 `<pc>.<tailnet>.ts.net`이고 Tailscale-User-Login(요청한 사람의 로그인 이름) 머리글이 있다(https://tailscale.com/kb/1312/serve).
//   serve는 요청에 원래 있던 이 머리글을 지우고 다시 채운다. 태그 기기와 funnel(인터넷 공개) 요청에는 이 머리글이 없다.
// - 로그인 사용자 제한(loginAllowed): Tailscale 이름으로 온 요청은 이 PC에 로그인한 Tailscale 사용자(또는 설정의 허용 목록)만 받는다.
// - P57 기기 확인: 바깥 요청은 `tailscale whois --json <X-Forwarded-For 주소>`로 요청한 Tailscale 기기(노드 StableID)를 읽고(WhoisCache, 주소마다 60초),
//   짝 맺을 때 기기 기록에 둔 tsNode와 같을 때만 받는다(nodeCheck). 못 읽거나 맞지 않으면 막는다.
// - 바꾸기 명령(serve 켜기·끄기)은 글로만 만든다(serveCommand). 실제 실행은 `atrium remote enable|disable --yes`만 한다(bin/atrium.mjs).
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { envVar } from './config.mjs';

export const REFRESH_MS = 60_000;
export const RUN_TIMEOUT_MS = 6000;

// tailscale 실행 파일. ATRIUM_TAILSCALE=none이면 읽지 않는다(시험), 경로를 주면 그것
export function tailscaleBin({ env = envVar('TAILSCALE'), platform = process.platform, exists = fs.existsSync, programFiles = process.env.ProgramFiles, pathEnv = process.env.PATH || '', userHome = os.homedir() } = {}) {
  if (env === 'none') return null;
  if (env) return env;
  if (platform === 'win32') {
    const p = path.join(programFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
    if (exists(p)) return p;
  }
  if (platform === 'darwin') {
    // Electron의 PATH가 짧아도 설치된 CLI·앱을 찾는다. 실행하거나 전역 PATH를 바꾸지는 않는다.
    // 공식 CLI: https://tailscale.com/docs/reference/tailscale-cli?tab=macos
    const candidates = [...String(pathEnv).split(':').filter(Boolean).map((dir) => path.posix.join(dir, 'tailscale')),
      '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale',
      '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
      path.posix.join(userHome, 'Applications/Tailscale.app/Contents/MacOS/Tailscale')];
    for (const candidate of new Set(candidates)) if (exists(candidate)) return candidate;
  }
  return 'tailscale'; // PATH에서
}

// 읽기 명령만 부른다. 바꾸기 명령은 이 함수로 부르지 않는다
// P57: `whois --json <주소>`도 읽기다. 주소는 tailnet 주소 형식(isTailnetAddr)만 받는다(명령줄에 다른 값이 들어가지 않게)
const READ_ONLY = new Set(['status --json', 'serve status --json']);
export const isReadOnly = (args) => READ_ONLY.has(args.join(' ')) || (args.length === 3 && args[0] === 'whois' && args[1] === '--json' && isTailnetAddr(args[2]));
export function runTailscale(bin, args) {
  if (!isReadOnly(args)) return Promise.reject(new Error(`not a read-only tailscale command: ${args.join(' ')}`));
  // 시험: ATRIUM_TAILSCALE이 .mjs면 node로 부른다(가짜 tailscale, app/test/e2e/p49-fake-tailscale.mjs)
  const [file, argv] = /\.m?js$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args];
  return new Promise((res, rej) => execFile(file, argv, { timeout: RUN_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TAILSCALE_BE_CLI: '1' } }, (e, out, err) => {
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

// ---------- P57: 요청한 Tailscale 기기 확인(whois) ----------
// 근거(tailscale/tailscale ipn/ipnlocal/serve.go): reverseProxy.ServeHTTP의 Rewrite가 addProxyForwardedHeaders를 부르고, 그것이
// X-Forwarded-For를 Header.Set으로 요청한 쪽 주소(c.SrcAddr.Addr(), 포트 없음)로 덮어쓴다. addTailscaleIdentityHeaders는 들어온
// Tailscale-User-Login 등을 지운(delHeaderVariants) 뒤 b.WhoIs로 다시 채우고, 태그 기기·funnel·tailnet 밖이면 비워 둔다.
// 백엔드는 127.0.0.1에서만 받으므로, 루프백에서 온 serve 요청의 두 머리글은 믿는다(이 PC의 다른 프로세스는 이미 판 API 토큰을 읽을 수 있다).
export const WHOIS_TTL_MS = 60_000; // 주소마다 결과를 기억하는 시간
export const WHOIS_FAIL_TTL_MS = 5_000; // 실패도 잠깐 기억한다(Tailscale이 꺼졌을 때 요청마다 프로세스를 띄우지 않게)
export const WHOIS_MAX = 256;
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// IPv6 주소 → 16비트 8개(형식이 틀리면 null). 점 표기(v4 섞임)와 영역(%)은 받지 않는다
function v6Words(s) {
  if (!/^[0-9a-f:]+$/i.test(s) || !net.isIPv6(s)) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (x) => (x ? x.split(':') : []);
  const head = part(halves[0]), tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const words = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail].map((w) => parseInt(w, 16));
  return words.length === 8 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : null;
}
// tailnet 주소인가: IPv4 100.64.0.0/10(CGNAT) 또는 IPv6 fd7a:115c:a1e0::/48. 쉼표 여럿, 빈 값, 포트, 다른 범위는 거부
export function isTailnetAddr(s) {
  if (typeof s !== 'string' || !s || s.length > 45) return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (m) {
    const o = m.slice(1).map(Number);
    if (m.slice(1).some((x) => x.length > 1 && x[0] === '0') || o.some((x) => x > 255)) return false;
    return o[0] === 100 && o[1] >= 64 && o[1] <= 127;
  }
  const w = v6Words(s);
  return !!w && w[0] === 0xfd7a && w[1] === 0x115c && w[2] === 0xa1e0;
}
// 바깥 요청의 요청한 기기 주소: 이 PC의 앞단(serve)이 루프백으로 넘긴 요청의 X-Forwarded-For 한 값만. 아니면 null
export function requestAddr(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  if (!LOOPBACK.test(a)) return null;
  const xf = req.headers && req.headers['x-forwarded-for'];
  if (typeof xf !== 'string') return null; // 없거나 배열
  const v = xf.trim();
  return !v.includes(',') && isTailnetAddr(v) ? v.toLowerCase() : null;
}

// `tailscale whois --json <주소>` → { id: 노드 StableID, name: 기기 이름, dnsName, login, tags }. 모양이 틀리면 null
export function parseWhois(j) {
  const n = j && j.Node, u = j && j.UserProfile;
  if (!n || typeof n !== 'object' || !u || typeof u !== 'object') return null;
  if (typeof n.StableID !== 'string' || !n.StableID) return null;
  const dnsName = trimDot(n.Name) || null;
  const name = String(n.ComputedName || (dnsName ? dnsName.split('.')[0] : '') || '').slice(0, 80) || null;
  return { id: n.StableID, name, dnsName, login: u.LoginName ? String(u.LoginName) : null, tags: Array.isArray(n.Tags) ? n.Tags.map(String) : [] };
}

// 주소마다 whois 결과를 잠깐 기억한다. lookup(addr) → { ok: true, who } | { ok: false, reason }. 던지지 않는다
export class WhoisCache {
  constructor({ bin, run = runTailscale, now = Date.now, ttlMs = WHOIS_TTL_MS, failTtlMs = WHOIS_FAIL_TTL_MS, max = WHOIS_MAX } = {}) {
    this.bin = bin; this.run = run; this.now = now; this.ttlMs = ttlMs; this.failTtlMs = failTtlMs; this.max = max;
    this.map = new Map(); // addr → { at, result }
    this.pending = new Map(); // addr → Promise
  }
  async lookup(addr) {
    if (!isTailnetAddr(addr)) return { ok: false, reason: 'bad_addr' };
    if (!this.bin) return { ok: false, reason: 'disabled' };
    const key = addr.toLowerCase();
    const hit = this.map.get(key);
    if (hit && this.now() - hit.at < (hit.result.ok ? this.ttlMs : this.failTtlMs)) return hit.result;
    if (this.pending.has(key)) return this.pending.get(key);
    const p = (async () => {
      let result;
      try {
        const who = parseWhois(JSON.parse(await this.run(this.bin, ['whois', '--json', key])));
        result = who ? { ok: true, who } : { ok: false, reason: 'unknown_node' };
      } catch { result = { ok: false, reason: 'whois_failed' }; } // 꺼짐, 시간 초과, 모르는 주소(tailscale이 실패로 끝난다)
      this.map.delete(key); this.map.set(key, { at: this.now(), result });
      while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
      return result;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }
  clear() { this.map.clear(); }
}

// 바깥 요청이 whois와 맞는가(순수). w = WhoisCache.lookup 결과. whois의 로그인과 Tailscale-User-Login이 같아야 한다(대소문자 무시)
// → { ok, reason, node: { id, name, login } }
export function whoisMatch(req, w) {
  if (!w || !w.ok || !w.who) return { ok: false, reason: (w && w.reason) || 'whois_failed', node: null };
  const h = req.headers || {};
  const login = typeof h['tailscale-user-login'] === 'string' ? h['tailscale-user-login'].trim().toLowerCase() : null;
  if (!login || !w.who.login || login !== w.who.login.toLowerCase()) return { ok: false, reason: 'login_mismatch', node: null };
  return { ok: true, reason: null, node: { id: w.who.id, name: w.who.name, login: w.who.login } };
}
// 기기 확인(순수). 자격(기기 토큰 등)을 확인한 다음에 부른다. device는 기기 기록(tsNode가 짝 맺을 때 확인한 Tailscale 기기)
// - 이 PC 안 요청: 상관없다
// - 바깥 요청: whois가 맞고, 기록의 tsNode.id가 지금 요청한 기기와 같을 때만 받는다
//   tsNode가 없는 기기: 이 PC 안에서 짝 맺은 기기(origin 'local')는 'local_only', 이 작업 전에 바깥에서 짝 맺은 옛 기기는 'not_bound'(다시 짝 맺기)
export function nodeCheck(req, device, w, port) {
  if (!isRemoteRequest(req, port)) return { ok: true, remote: false, reason: null, node: null };
  const m = whoisMatch(req, w);
  if (!m.ok) return { ...m, remote: true };
  const bound = device && device.tsNode;
  if (!bound || typeof bound.id !== 'string' || !bound.id) return { ok: false, remote: true, reason: device && device.origin === 'local' ? 'local_only' : 'not_bound', node: m.node };
  if (!safeEq(bound.id, m.node.id)) return { ok: false, remote: true, reason: 'other_node', node: m.node };
  if (bound.login && String(bound.login).toLowerCase() !== String(m.node.login).toLowerCase()) return { ok: false, remote: true, reason: 'other_user', node: m.node };
  return { ok: true, remote: true, reason: null, node: m.node };
}
// 기기 기록이 Tailscale 기기에 묶이지 않은 옛 바깥 기기인가(다시 짝 맺기 필요)
export const needsRepair = (d) => !!d && !(d.tsNode && d.tsNode.id) && d.origin !== 'local';

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
  // P57: 짝 맺은 기기는 Tailscale 기기에 묶인다. 묶이지 않은 옛 바깥 기기(다시 짝 맺기 필요)의 수. null: 백엔드 없이 읽음
  out.push({ id: 'nodes', level: ctx.unbound == null ? 'skip' : ctx.unbound > 0 ? 'warn' : 'ok', vars: { n: ctx.unbound || 0 } });
  // P62: 패스키로 확인(판 설정 remotePasskey). 고르는 값이라 켬·끔 둘 다 ok. 백엔드 없이 읽으면 모른다(skip)
  out.push(typeof ctx.passkey === 'boolean' ? { id: ctx.passkey ? 'passkey_on' : 'passkey_off', level: 'ok', vars: {} } : { id: 'passkey', level: 'skip', vars: {} });
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
  // P57: 요청한 기기 확인. 실행 파일이 없으면(ATRIUM_TAILSCALE=none) 늘 실패한다(바깥 요청은 막힌다)
  whois(addr) { if (!this.whoisCache) this.whoisCache = new WhoisCache({ bin: this.bin, run: this.run }); return this.whoisCache.lookup(addr); }
  selfLogin() { return (this.last.status && this.last.status.login) || null; }
}
