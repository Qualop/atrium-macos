// P49(원격 R3): 백엔드 연결이 끊기면 다시 붙는 규칙. 순수 함수만 둔다(단위 시험 test/p49-lib.test.mjs). 소켓을 다루는 것은 api.js다.
// - 백오프: 0.5초부터 두 배씩, 웹 화면은 15초까지(PC 창은 2초까지: main이 백엔드를 다시 띄우므로 빨리 붙는다). ±20% 흔들어 여러 탭이 한꺼번에 붙지 않게 한다. 열리면 처음부터.
// - 살아 있나: 15초마다 ping. 8초 안에 답이 없으면 죽은 연결로 보고 닫은 뒤 다시 붙는다(노트북 잠자기, 네트워크 바뀜).
// - 띠: 한 번이라도 열렸다가 끊긴 동안 "다시 연결 중"을 보인다. 짝이 끊겼거나 세션이 끝났으면(4401, 401) 페이지를 다시 열어
//   P56의 다시 확인 화면(패스키)으로, 짝이 풀렸으면 짝 맺기 화면으로 간다(Pair.jsx).
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 15_000;
export const PING_EVERY_MS = 15_000;
export const PING_TIMEOUT_MS = 8_000;
export const CLOSE_REVOKED = 4401; // 백엔드가 기기를 끊을 때(web.mjs revoke), P56: 세션이 끝났을 때(sweepSessions)도
// P58: PC에서 원격 받기를 껐을 때(web.mjs accessChanged). 4402(PC에서 끊기)는 보통 끊김처럼 곧 다시 붙어 본다.
// P59: 끊기는 세션도 끝내므로 다시 붙을 때 backend()의 /web/me가 401을 받고 다시 확인 화면으로 간다
export const CLOSE_BLOCKED = 4403;

export function backoffMs(attempt, rand = Math.random(), maxMs = BACKOFF_MAX_MS) {
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  const raw = Math.min(maxMs, BACKOFF_BASE_MS * 2 ** Math.min(n, 20));
  return Math.round(raw * (0.8 + 0.4 * Math.min(1, Math.max(0, rand))));
}

// 연결 상태. phase: 'connecting'(처음) | 'open' | 'reconnecting'(열렸다가 끊김) | 'unpaired' | 'blocked'(P58: PC에서 원격을 막음)
export const connInit = () => ({ phase: 'connecting', attempt: 0, wasOpen: false, since: null, lastClose: null });
export function connStep(s, ev, now = Date.now()) {
  switch (ev.type) {
    case 'open': return { ...s, phase: 'open', attempt: 0, wasOpen: true, since: null };
    case 'close': {
      if (ev.code === CLOSE_REVOKED || ev.unpaired) return { ...s, phase: 'unpaired', since: s.since || now, lastClose: ev.code ?? null };
      // P58: PC에서 원격을 막았다(4403, /web/me의 remote_blocked). 띠 대신 막음 화면을 보이고 백오프로 계속 다시 붙어 본다(켜면 돌아온다)
      if (ev.code === CLOSE_BLOCKED || ev.code === 'remote_blocked') return { ...s, phase: 'blocked', attempt: s.phase === 'open' ? 0 : s.attempt + 1, since: s.since || now, lastClose: ev.code };
      const phase = s.wasOpen ? 'reconnecting' : 'connecting';
      return { ...s, phase, attempt: s.phase === 'open' ? 0 : s.attempt + 1, since: s.since || now, lastClose: ev.code ?? null };
    }
    case 'unpaired': return { ...s, phase: 'unpaired', since: s.since || now };
    default: return s;
  }
}
// 다음 시도까지 기다릴 시간. 짝이 끊겼으면 다시 붙지 않는다(null). 깨어남·온라인이면 곧바로
export function retryDelay(s, { wake = false, rand, maxMs } = {}) {
  if (s.phase === 'unpaired' || s.phase === 'open') return null;
  if (wake) return 0;
  return backoffMs(s.attempt, rand ?? Math.random(), maxMs);
}
export const showBanner = (s) => s.phase === 'reconnecting';
// P82: 짧은 끊김(SHORT_DROP_MS 안에 다시 붙음)에는 띠와 연결 알약을 바꾸지 않는다. 남은 ms(0이면 지금 보인다), 보일 일이 없으면 null.
// PC에서 끊었으면(4402) 바로 보인다
export const SHORT_DROP_MS = 2000;
export function bannerDue(s, now = Date.now(), graceMs = SHORT_DROP_MS) {
  if (!s || s.phase !== 'reconnecting') return null;
  if (s.lastClose === 4402 || s.since == null) return 0;
  return Math.max(0, s.since + graceMs - now);
}
// 짧은 끊김을 넘겼는가(띠·알약을 바꿀 때인가)
export const dropShown = (s, now = Date.now(), graceMs = SHORT_DROP_MS) => bannerDue(s, now, graceMs) === 0;
// P82: 다시 붙을 때 연결 주소로 알리는 직전 닫힘(pc=<코드>.<깨끗이 닫혔나 0|1>.<붙어 있던 ms>, backend/src/remote-ws.mjs parsePrevClose).
// 코드는 CloseEvent.code 또는 창이 스스로 닫은 까닭(timeout, open_timeout)
export function prevCloseParam(c) {
  if (!c) return null;
  const code = Number.isInteger(c.code) ? c.code : c.code === 'timeout' || c.code === 'open_timeout' ? c.code : null;
  if (code == null) return null;
  const ms = Number.isFinite(c.ms) && c.ms > 0 ? Math.min(Math.round(c.ms), 864e5) : 0;
  return `${code}.${c.wasClean ? 1 : 0}.${ms}`;
}
// ping 답을 기다린 시간이 넘었는가
export const pingTimedOut = (sentAt, now, timeoutMs = PING_TIMEOUT_MS) => sentAt != null && now - sentAt > timeoutMs;
// 왕복 지연 표시: 최근 몇 번의 가운데 값(튀는 값 하나에 흔들리지 않게)
export function rttLabel(samples) {
  const xs = (samples || []).filter((x) => Number.isFinite(x)).slice(-5).sort((a, b) => a - b);
  if (!xs.length) return null;
  return Math.round(xs[Math.floor(xs.length / 2)]);
}
