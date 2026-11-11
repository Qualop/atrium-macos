// P58(원격 강화 S4): 원격 연결 기록과 "새로 붙음" 알림 판단. SSH의 접속 기록에 해당한다.
// - 기록(RemoteLog): 판 데이터 폴더의 remote-log.jsonl(한 줄에 하나). 짝 맺기 요청·성공·실패, 연결·끊김, 거부(까닭 코드), 짝 풀기, PC에서 끊기,
//   원격 받기 끄기·켜기. 값은 정한 필드만 받는다(시각, 일, 까닭, 기기 ID·이름, Tailscale 로그인, tailnet 주소, 브라우저 종류, 바깥 요청인지, 짝 맺은 방법).
//   토큰·코드·세션 ID·챌린지 같은 비밀은 받는 필드가 없어 남지 않는다. 까닭은 짧은 문자열 코드(예: host, origin, login_other_user)를 그대로 남긴다.
//   최근 LOG_MAX개, LOG_MAX_AGE_MS(30일) 안의 것만 둔다. 같은 거부·실패가 REPEAT_MS 안에 되풀이되면 새 줄 대신 count를 올린다(넘치는 요청이 기록을 밀어내지 않게).
// - 알림 판단(ConnectWatch): 기기의 연결이 없다가 생기면 알린다. 같은 기기가 끊긴 지 RECONNECT_QUIET_MS 안에 다시 붙거나,
//   그 안에 이미 알렸으면(짝 맺기 성공 직후의 첫 연결 등) 다시 알리지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { wsInfo, prevInfo } from './remote-ws.mjs'; // P82: 원격 소켓의 끊김(ws)과 창이 본 직전 닫힘(prev)
import { crashInfo } from './web-crash.mjs'; // P84: 웹 화면이 죽은 뒤의 부팅(boot)

export const LOG_MAX = 2000;
export const LOG_MAX_AGE_MS = 30 * 24 * 3600_000;
export const REPEAT_MS = 30_000;
export const RECONNECT_QUIET_MS = 3 * 60_000;
export const LIST_LIMIT_MAX = 500;
const FLUSH_MS = 500;

// 남기는 일. 모르는 일은 'other'로 남긴다
// P59: pair.grant(코드·허락으로 등록 허가가 나감, 패스키 등록을 기다림), login·logout(P56 패스키 로그인, 로그아웃)
// P62: passkey.on·passkey.off(패스키로 확인 켬·끔), passkey.add(패스키 없이 짝 맺은 기기가 패스키를 등록함). pair.ok의 passkey: false = 패스키 없이 짝 맺음
// P84: boot(웹 화면이 정상 떠남 없이 다시 읽힘. crashed, 이 부팅이 가벼운 화면인지 light, 직전 상태 crash)
// P88: push.on(알림 구독, host = 푸시 서비스 이름), push.off(해지, 까닭 user·unpair·blocked·gone_404·gone_410), push.fail(보내기 실패, 까닭 http_<코드>·timeout 등). 알림 내용은 받는 필드가 없다
export const LOG_EVENTS = ['pair.request', 'pair.grant', 'pair.ok', 'pair.fail', 'login', 'logout', 'connect', 'disconnect', 'deny', 'unpair', 'kick', 'remote.block', 'remote.allow', 'passkey.on', 'passkey.off', 'passkey.add', 'boot', 'level', 'push.on', 'push.off', 'push.fail'];
const MERGE = new Set(['deny', 'pair.fail', 'push.fail']); // 되풀이를 합치는 일

const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const reasonCode = (r) => (r == null || r === '' ? null : /^[A-Za-z0-9_.:-]{1,48}$/.test(String(r)) ? String(r) : 'unknown');
const loginOf = (s) => { const v = clip(s, 120).toLowerCase(); return v && /^[^\s"<>]+$/.test(v) ? v : null; };
const addrOf = (s) => { const v = String(s || '').trim().replace(/^::ffff:/, ''); return /^[0-9A-Fa-f:.]{2,45}$/.test(v) ? v : null; };
const idOf = (s) => (s && /^[A-Za-z0-9_.:-]{1,80}$/.test(String(s)) ? String(s) : null);

// 브라우저 종류(사람이 읽을 짧은 글). User-Agent 전체는 남기지 않는다
export function browserOf(ua) {
  const s = String(ua || '');
  if (!s) return null;
  const ver = (re) => { const m = re.exec(s); return m ? m[1].split('.')[0] : ''; };
  const b = /Edg\//.test(s) ? `Edge ${ver(/Edg\/([\d.]+)/)}` : /Firefox\//.test(s) ? `Firefox ${ver(/Firefox\/([\d.]+)/)}` : /Chrome\//.test(s) ? `Chrome ${ver(/Chrome\/([\d.]+)/)}`
    : /Safari\//.test(s) ? `Safari ${ver(/Version\/([\d.]+)/)}` : /^node|undici|ws\//i.test(s) ? 'script' : 'other';
  const os = /Windows/.test(s) ? 'Windows' : /iPhone|iPad/.test(s) ? 'iOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Android/.test(s) ? 'Android' : /Linux/.test(s) ? 'Linux' : '';
  return clip(os ? `${b.trim()} · ${os}` : b.trim(), 40);
}

// 한 줄로 고르기(정한 필드만). 비밀이 들어갈 자리가 없다
export function logEntry(event, f = {}, at = Date.now()) {
  const e = { at, event: LOG_EVENTS.includes(event) ? event : 'other' };
  const reason = reasonCode(f.reason); if (reason) e.reason = reason;
  const id = idOf(f.deviceId); if (id) e.deviceId = id;
  const name = clip(f.deviceName, 40); if (name) e.deviceName = name;
  const node = clip(f.node, 80); if (node) e.node = node; // P59: Tailscale이 확인한 기기 이름(P57)
  const login = loginOf(f.login); if (login) e.login = login;
  const addr = f.remote ? addrOf(f.addr) : null; if (addr) e.addr = addr; // tailnet 주소는 바깥 요청만
  const br = clip(f.browser, 40); if (br) e.browser = br;
  if (f.remote != null) e.remote = !!f.remote;
  if (f.via === 'code' || f.via === 'approve') e.via = f.via;
  if (f.passkey === false) e.passkey = false; // P62
  if (Number.isInteger(f.n) && f.n >= 0) e.n = Math.min(f.n, 1e6);
  const ws = wsInfo(f.ws); if (ws) e.ws = ws; // P82: 닫힘 코드·까닭 글, 붙어 있던 ms, 압축, 주고받은 수·바이트, 마지막으로 보낸 것(종류와 크기만)
  const prev = prevInfo(f.prev); if (prev) e.prev = prev; // P82: connect. 창이 본 직전 닫힘(CloseEvent.code, wasClean, 붙어 있던 ms)
  if (f.crashed === true) e.crashed = true; // P84: boot. 직전 페이지가 죽었다
  if (f.light === true) e.light = true; // P84: 이 부팅은 가벼운 화면
  const crash = crashInfo(f.crash); if (crash) e.crash = crash; // P84: 죽기 전 상태(숫자와 짧은 코드만)
  if (Number.isInteger(f.level) && f.level >= 0 && f.level <= 4) e.level = f.level; // P86: boot(이 부팅의 보드 단계), level(살아남아 기억한 단계)
  if (Number.isFinite(f.bootId) && f.bootId > 0 && f.bootId < 1e14) e.bootId = Math.round(f.bootId); // P87: boot. 죽은 페이지의 부팅 시각(같은 죽음을 한 번만 남긴다)
  if (typeof f.host === 'string' && /^[A-Za-z0-9.-]{1,120}$/.test(f.host)) e.host = f.host.toLowerCase(); // P88: push.on. 푸시 서비스 이름(주소의 나머지는 남기지 않는다)
  return e;
}
const mergeKey = (e) => [e.event, e.reason, e.deviceId, e.addr, e.login, e.remote].join('|');

export class RemoteLog {
  // file: 없으면 메모리에만(시험). onAppend(entry): 새 줄(창의 설정 탭이 따라온다)
  constructor({ file = null, now = Date.now, max = LOG_MAX, maxAgeMs = LOG_MAX_AGE_MS, repeatMs = REPEAT_MS, onAppend = () => {}, log = () => {} } = {}) {
    this.file = file; this.now = now; this.max = max; this.maxAgeMs = maxAgeMs; this.repeatMs = repeatMs; this.onAppend = onAppend; this.log = log;
    this.entries = [];
    this.timer = null;
    if (file) this.load();
  }
  load() {
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return; }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j && Number.isFinite(j.at) && typeof j.event === 'string') this.entries.push({ ...logEntry(j.event, j, j.at), ...(j.count > 1 ? { count: Math.min(j.count, 1e9), lastAt: j.lastAt } : {}) }); } catch {}
    }
    this.prune();
  }
  prune() {
    const t = this.now();
    let i = 0;
    while (i < this.entries.length && t - (this.entries[i].lastAt || this.entries[i].at) > this.maxAgeMs) i++;
    if (i) this.entries.splice(0, i);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
  }
  add(event, fields = {}) {
    const t = this.now();
    const e = logEntry(event, fields, t);
    if (MERGE.has(e.event)) {
      const k = mergeKey(e);
      for (let i = this.entries.length - 1, seen = 0; i >= 0 && seen < 30; i--, seen++) {
        const x = this.entries[i];
        if (t - (x.lastAt || x.at) > this.repeatMs) break;
        if (mergeKey(x) === k) { x.count = (x.count || 1) + 1; x.lastAt = t; this.schedule(); return x; }
      }
    }
    this.entries.push(e);
    this.prune();
    this.schedule();
    try { this.onAppend(e); } catch {}
    return e;
  }
  // 최근 것부터
  list({ limit = 100 } = {}) {
    const n = Math.max(1, Math.min(LIST_LIMIT_MAX, Number.isInteger(limit) ? limit : 100));
    return this.entries.slice(-n).reverse().map((e) => ({ ...e }));
  }
  schedule() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, FLUSH_MS);
    this.timer.unref?.();
  }
  // 통째로 다시 쓴다(2000줄, 수백 KB). 반쯤 쓴 파일이 남지 않게 임시 파일에 쓰고 바꾼다
  flush() {
    if (!this.file) return;
    clearTimeout(this.timer); this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''));
      fs.renameSync(tmp, this.file);
    } catch (e) { this.log(`remote log write failed: ${e.message}`); }
  }
}

// 기기 연결 수와 알림 판단. 연결 단위로 opened/closed를 부른다
export class ConnectWatch {
  constructor({ now = Date.now, quietMs = RECONNECT_QUIET_MS } = {}) { this.now = now; this.quietMs = quietMs; this.open = new Map(); this.lastClosed = new Map(); this.lastNotice = new Map(); }
  quiet(id, t) {
    const c = this.lastClosed.get(id), n = this.lastNotice.get(id);
    return (c != null && t - c < this.quietMs) || (n != null && t - n < this.quietMs);
  }
  // 알릴지(true) 돌려준다
  opened(id) {
    if (!id) return false;
    const n = this.open.get(id) || 0;
    this.open.set(id, n + 1);
    if (n > 0) return false; // 이미 붙어 있다(탭이 둘)
    const t = this.now();
    if (this.quiet(id, t)) return false; // 다시 연결
    this.lastNotice.set(id, t);
    return true;
  }
  closed(id) {
    if (!id) return;
    const n = (this.open.get(id) || 0) - 1;
    if (n > 0) { this.open.set(id, n); return; }
    this.open.delete(id);
    this.lastClosed.set(id, this.now());
  }
  // 짝 맺기 성공을 알렸다. 곧이어 오는 첫 연결은 다시 알리지 않는다
  paired(id) { if (id) this.lastNotice.set(id, this.now()); }
  // 짝을 풀었다(다시 짝 맺으면 새 ID라 상관없지만 기록을 비운다)
  forget(id) { this.open.delete(id); this.lastClosed.delete(id); this.lastNotice.delete(id); }
  count(id) { return this.open.get(id) || 0; }
}
