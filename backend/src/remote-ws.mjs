// P82: 원격 소켓(tailscale serve를 거친 브라우저)의 끊김을 재는 것과 WebKit 판별. 모두 순수하거나 작은 셈이다(단위 시험 p82.test.mjs).
// - WebKit 브라우저(Safari, iOS·iPadOS의 모든 브라우저, 데스크톱 모드 iPad)는 압축(permessage-deflate) 없는 원격 소켓으로 받는다.
//   Safari는 압축을 켠 연결을 이유 없이 끊는다는 보고가 있다(docs/log/p82-phone-disconnects.md). Chrome·Edge·Firefox와 Electron 창은 그대로다.
// - 소켓 통계: 주고받은 메시지 수와 바이트, 마지막으로 보낸 메시지 몇 개의 종류(t 글, b 바이너리)와 크기. 내용은 남기지 않는다.
// - 직전 닫힘: 창이 다시 붙을 때 연결 주소의 pc 값(<코드>.<깨끗이 닫혔나 0|1>.<붙어 있던 ms>)으로 알린다. 서버는 connect 기록에 남긴다.

// iOS·iPadOS에만 있는 브라우저 이름(그 위에서는 모두 WebKit이다)
const IOS_BROWSERS = /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT)\//;
const BLINK_GECKO = /\b(Chrome|Chromium|HeadlessChrome|Edg|EdgA|OPR|Firefox|SamsungBrowser)\//;
export function isWebKitBrowser(ua) {
  const s = String(ua || '');
  if (!s) return false;
  if (/\bElectron\//.test(s)) return false; // PC 창(Chromium)
  if (/\b(iPhone|iPad|iPod)\b/.test(s)) return true; // iOS·iPadOS: 브라우저가 무엇이든 WebKit
  if (/\bAndroid\b/.test(s)) return false;
  if (IOS_BROWSERS.test(s)) return true; // 데스크톱 모드 iPad의 Chrome·Firefox·Edge(Macintosh로 보인다)
  // Safari(macOS, 데스크톱 모드 iPad), 그 밖의 WebKit 브라우저: Version/x Safari/y, Chromium·Gecko 이름이 없음
  return /\bAppleWebKit\//.test(s) && /\bSafari\//.test(s) && /\bVersion\/\d/.test(s) && !BLINK_GECKO.test(s);
}

export const LAST_SENT = 5; // 마지막으로 보낸 메시지 몇 개
const sizeOf = (data) => (typeof data === 'string' ? Buffer.byteLength(data) : data && (data.byteLength ?? data.length)) || 0;

// 한 연결의 통계
export class WsStats {
  constructor(now = Date.now) { this.now = now; this.openedAt = now(); this.inN = 0; this.inB = 0; this.outN = 0; this.outB = 0; this.last = []; this.lastOutAt = null; }
  received(data, isBinary) { this.inN++; this.inB += Array.isArray(data) ? data.reduce((a, x) => a + sizeOf(x), 0) : sizeOf(data); void isBinary; }
  sent(data) {
    const n = sizeOf(data);
    this.outN++; this.outB += n; this.lastOutAt = this.now();
    this.last.push(`${typeof data === 'string' ? 't' : 'b'}${n}`);
    if (this.last.length > LAST_SENT) this.last.shift();
  }
  // disconnect 기록의 ws 값. close = { code, reason }, error = ws의 오류(코드만)
  summary({ code = null, reason = '', error = null, deflate = false } = {}) {
    const t = this.now();
    return wsInfo({ code, why: reason, err: error && (error.code || error.name), ms: t - this.openedAt, deflate, in: this.inN, inB: this.inB, out: this.outN, outB: this.outB, last: this.last, sinceOut: this.lastOutAt == null ? null : t - this.lastOutAt });
  }
}

const int = (v, max = 1e12) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null);
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// 기록에 남길 ws 값 고르기(정한 필드만, 모양이 다르면 버린다)
export function wsInfo(f) {
  if (!f || typeof f !== 'object') return null;
  const o = {};
  const code = int(f.code, 4999); if (code != null) o.code = code;
  const why = clip(f.why, 80); if (why) o.why = why;
  if (f.err && /^[A-Za-z0-9_]{1,40}$/.test(String(f.err))) o.err = String(f.err);
  for (const k of ['ms', 'in', 'inB', 'out', 'outB', 'sinceOut']) { const v = int(f[k]); if (v != null) o[k] = v; }
  if (f.deflate != null) o.deflate = !!f.deflate;
  if (Array.isArray(f.last)) { const l = f.last.filter((x) => /^[tb]\d{1,10}$/.test(String(x))).slice(-LAST_SENT); if (l.length) o.last = l; }
  return Object.keys(o).length ? o : null;
}

// 창이 본 직전 닫힘(창의 lib/reconnect.js prevCloseParam이 만든다). 코드는 숫자(CloseEvent.code) 또는 창이 스스로 닫은 까닭(timeout: ping 답 없음, open_timeout: 열리지 않음)
const OWN_CLOSE = ['timeout', 'open_timeout'];
export function parsePrevClose(s) {
  const m = /^(\d{1,4}|timeout|open_timeout)\.([01])\.(\d{1,8})$/.exec(String(s || ''));
  if (!m) return null;
  return { code: /^\d/.test(m[1]) ? Number(m[1]) : m[1], clean: m[2] === '1', ms: Number(m[3]) };
}
export function prevInfo(p) {
  if (!p || typeof p !== 'object') return null;
  const code = Number.isInteger(p.code) && p.code >= 0 && p.code <= 4999 ? p.code : OWN_CLOSE.includes(p.code) ? p.code : null;
  if (code == null) return null;
  return { code, clean: !!p.clean, ms: int(p.ms, 864e5) ?? 0 };
}

// 연결 기록 화면의 짧은 글(예: "1006 · 3.4s · deflate"). 창(lib)과 CLI가 같은 꼴을 쓴다
export function wsLabel(ws) {
  if (!ws) return '';
  const parts = [];
  if (ws.code != null) parts.push(String(ws.code));
  if (ws.err) parts.push(ws.err);
  if (ws.ms != null) parts.push(`${(ws.ms / 1000).toFixed(ws.ms < 10000 ? 1 : 0)}s`);
  if (ws.deflate != null) parts.push(ws.deflate ? 'deflate' : 'plain');
  return parts.join(' · ');
}
