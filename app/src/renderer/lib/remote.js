// P58(원격 강화 S4): PC 창에서 원격 연결을 보고 끊는 데 쓰는 순수 함수(단위 시험 app/test/p58-lib.test.mjs).
// 백엔드 쪽(연결 기록, 새로 붙음 판단, 끊기, 원격 받기)은 backend/src/remote-log.mjs와 web.mjs에 있다.
import { stepsLabel } from '../../../../backend/src/web-crash.mjs'; // P86: 단계 기록의 짧은 글(CLI와 같은 꼴)

// 알약에서 끊기·짝 풀기를 보일 클라이언트: 짝 맺은 기기(deviceId)로 붙은 웹 클라이언트
export const isDeviceClient = (c) => !!(c && c.kind === 'web' && c.deviceId);

// remote.connected { kind: 'paired'|'connected', device: { name }, remote, login, browser } → 알림 글 열쇠와 값
export function noticeOf(ev) {
  if (!ev || !ev.device) return null;
  const name = ev.device.name || '?';
  const key = ev.kind === 'paired' ? 'remoteNotice.paired' : ev.remote ? 'remoteNotice.connectedRemote' : 'remoteNotice.connected';
  const detail = [ev.login, ev.browser].filter(Boolean).join(' · ');
  return { key, vars: { name }, detail };
}

// 토스트는 늘, OS 알림은 창이 숨었거나 초점이 없을 때(사람이 창을 보고 있지 않을 때)
export function noticeWay({ visible = true, focused = true } = {}) {
  return { toast: true, os: !visible || !focused };
}

// 연결 기록 한 줄 → 글 열쇠와 값. 까닭은 remoteLog.reason_<코드>가 있으면 그 글, 없으면 코드 그대로(P56·P57이 더하는 까닭)
// P59: pair.grant(등록 허가가 나감), login·logout(패스키 로그인, 로그아웃). who에 Tailscale 기기 이름(node)
// P62: passkey.on·passkey.off(패스키로 확인 켬·끔), passkey.add(패스키 없이 짝 맺은 기기가 패스키를 등록). pair.ok의 passkey: false = 패스키 없이 짝 맺음(noPasskey)
export const LOG_EVENTS = ['pair.request', 'pair.grant', 'pair.ok', 'pair.fail', 'login', 'logout', 'connect', 'disconnect', 'deny', 'unpair', 'kick', 'remote.block', 'remote.allow', 'passkey.on', 'passkey.off', 'passkey.add', 'boot', 'level', 'push.on', 'push.off', 'push.fail']; // P84: boot(웹 화면이 닫힌 뒤 다시 열림). P86: level(가벼운 보드 단계를 기억함). P88: push.*(알림 구독·해지·보내기 실패)
// 까닭 글 열쇠: 'tailscale_node:other_node' → ['remoteLog.reason_tailscale_node_other_node', 'remoteLog.reason_tailscale_node', 'other_node']
export function reasonKeys(r) {
  const s = String(r || '');
  const i = s.indexOf(':');
  return { full: `remoteLog.reason_${s.replace(/[:.]/g, '_')}`, prefix: i > 0 ? `remoteLog.reason_${s.slice(0, i)}` : null, rest: i > 0 ? s.slice(i + 1) : null };
}
// P82: "1006 · 3.4s · deflate"(backend/src/remote-ws.mjs wsLabel과 같은 꼴)
export function sockLabel(ws) {
  if (!ws) return '';
  const parts = [];
  if (ws.code != null) parts.push(String(ws.code));
  if (ws.err) parts.push(ws.err);
  if (ws.ms != null) parts.push(`${(ws.ms / 1000).toFixed(ws.ms < 10000 ? 1 : 0)}s`);
  if (ws.deflate != null) parts.push(ws.deflate ? 'deflate' : 'plain');
  return parts.join(' · ');
}
// P84: 닫히기 전 상태(backend/src/web-crash.mjs crashLabel과 같은 꼴, 예: "board · 3 term · 2.1M px · gl 3 · dpr 3 · 6.0s")
export function crashText(c) {
  if (!c) return '';
  const parts = [];
  if (c.view) parts.push(c.view);
  if (c.terms != null) parts.push(`${c.terms} term`);
  if (c.px != null || c.atlas != null) parts.push(`${(((c.px || 0) + (c.atlas || 0)) / 1e6).toFixed(1)}M px`);
  if (c.gl != null) parts.push(`gl ${c.gl}`);
  if (c.dpr != null) parts.push(`dpr ${c.dpr}`);
  if (c.up != null) parts.push(`${(c.up / 1000).toFixed(c.up < 10000 ? 1 : 0)}s`);
  if (c.hidden) parts.push('hidden');
  if (c.light) parts.push('light');
  if (c.level) parts.push(`L${c.level}`); // P86
  return parts.join(' · ');
}
export function logRow(e) {
  const ev = LOG_EVENTS.includes(e && e.event) ? e.event : 'other';
  return {
    key: ev === 'boot' ? 'remoteCrash.ev_boot' : ev === 'level' ? 'remoteSteps.ev_level' : ev.startsWith('push.') ? `push.ev_${ev.slice(5)}` : `remoteLog.ev_${ev.replace('.', '_')}`, // P84: boot 글은 사전 끝(remoteCrash)에. P86: level. P88: push.*는 사전 끝(push)에
    ...(e && e.host ? { host: e.host } : {}), // P88: push.on의 푸시 서비스 이름
    reason: e && e.reason ? e.reason : null,
    who: [e && e.deviceName, e && e.node && e.node !== e.deviceName ? e.node : null, e && e.login, e && e.addr].filter(Boolean).join(' · '),
    browser: (e && e.browser) || null,
    remote: e && e.remote != null ? !!e.remote : null,
    count: e && e.count > 1 ? e.count : null,
    bad: ev === 'deny' || ev === 'pair.fail' || ev === 'push.fail', // P88
    ...(ev === 'pair.ok' && e && e.passkey === false ? { noPasskey: true } : {}),
    // P82: 원격 소켓. disconnect는 서버가 받은 닫힘 코드·붙어 있던 시간·압축, connect는 창이 본 직전 닫힘
    ...(e && e.ws && ev === 'disconnect' ? { sock: sockLabel(e.ws) } : {}),
    ...(e && e.prev && ev === 'connect' ? { prev: sockLabel({ code: e.prev.code, ms: e.prev.ms }) } : {}),
    ...(ev === 'boot' ? { bad: true, crash: crashText(e.crash), light: e.light === true } : {}), // P84: 닫히기 전 상태, 이 부팅이 가벼운 화면인지
    ...(ev === 'boot' && e.crash && e.crash.steps ? { steps: stepsLabel(e.crash.steps) } : {}), // P86: 죽기 직전의 보드 시작 단계
    ...((ev === 'level' || (ev === 'boot' && e.level > 0)) && Number.isInteger(e.level) ? { level: e.level } : {}), // P86: 보드 단계
  };
}

// 웹 화면: 백엔드가 원격을 막았는가(연결이 4403으로 닫혔거나 /web/me가 remote_blocked)
export const CLOSE_BLOCKED = 4403;
export const CLOSE_KICKED = 4402;
export const isBlockedClose = (code) => code === CLOSE_BLOCKED || code === 'remote_blocked';
