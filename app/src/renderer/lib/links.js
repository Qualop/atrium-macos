import { clientMac, appMod } from './keys.js'; // macOS 판: Cmd가 앱 키
// P283: 판 안 링크(터미널 OSC 8 하이퍼링크·글 속 주소, 마크다운 링크)를 고르고 거르는 계산. DOM 없이 단위 시험한다(p283-lib).
// 여는 곳은 open-link.js(PC 창: 기본 브라우저, 원격 웹: 새 탭). 열리는 것은 http·https뿐이고 그 밖의 스킴은 짧은 알림만 낸다.

// 글 속 주소: http(s)://로 시작해 빈칸·따옴표·꺾쇠·백틱이나 ASCII 밖 글자(한글 조사 등)에서 끝난다
const URL_RE = /\bhttps?:\/\/[!#-&(-;=?-[\]_a-z~]+/gi;
const TRAIL = /[.,;:!?*'"]+$/; // 문장 끝 문장부호는 주소가 아니다
const PAIRS = { ')': '(', ']': '[', '}': '{' };

// 닫는 괄호가 여는 괄호보다 많으면 끝의 것을 뗀다((https://a.b/x) → https://a.b/x, https://a.b/x_(y) 그대로)
function trimUrl(s) {
  for (;;) {
    const before = s;
    s = s.replace(TRAIL, '');
    const last = s[s.length - 1];
    if (PAIRS[last]) {
      const open = s.split(PAIRS[last]).length - 1, close = s.split(last).length - 1;
      if (close > open) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

// 글 속 http(s) 주소들: [{ start, end(끝 다음 자리), url }]. 스킴 뒤가 비면 뺀다
export function findUrls(text) {
  const out = [];
  if (!text) return out;
  URL_RE.lastIndex = 0;
  for (let m; (m = URL_RE.exec(text));) {
    const url = trimUrl(m[0]);
    if (!/^https?:\/\/[^/?#]/i.test(url)) continue;
    out.push({ start: m.index, end: m.index + url.length, url });
  }
  return out;
}

// 열어도 되는 주소면 정리한 href, 아니면 null(그 밖의 스킴·깨진 주소). scheme은 알림에 쓸 스킴('file:' 등)
export function linkTarget(raw) {
  const s = String(raw || '').trim();
  let u;
  try { u = new URL(s); } catch { return { href: null, scheme: '' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { href: null, scheme: u.protocol };
  if (!u.hostname) return { href: null, scheme: u.protocol };
  return { href: u.href, scheme: u.protocol };
}

// 열기 한 번: 열 수 있으면 open(href)(PC 창은 window.open → main이 기본 브라우저로, 웹은 새 탭), 아니면 notify(scheme). 연 주소 또는 null
export function openWith(raw, { open, notify }) {
  const { href, scheme } = linkTarget(raw);
  if (!href) { notify(scheme || '?'); return null; }
  open(href);
  return href;
}

// 터미널 링크를 누른 것으로 열지: PC(마우스)는 Ctrl(맥 Cmd)+누르기만, 손가락·펜 탭은 그냥 누르기로 연다.
// 그냥 누르기는 판에서 글 고르기·노드 들어가기라 PC에서는 열지 않는다(터미널 앱들의 Ctrl+누르기 습관)
// macOS 판: Mac은 Cmd+누르기만(Ctrl+누르기는 macOS에서 오른쪽 누르기다)
export function opensOnClick(ev, pointerType, mac = clientMac()) {
  if (pointerType === 'touch' || pointerType === 'pen') return true;
  return !!(ev && appMod(ev, mac));
}

// 터미널 칸 배열 → 링크 자리. cells: 논리 줄(감싼 줄 이어 붙임)의 칸 [{ ch, x, y }](x·y 1부터, 넓은 글자의 오른쪽 반 칸은 넣지 않는다).
// 돌려줌: [{ url, range: { start: { x, y }, end: { x, y } } }](xterm IBufferRange, 끝 칸 포함)
export function cellLinks(cells) {
  let text = '';
  const at = [];
  for (const c of cells) { const ch = c.ch || ' '; for (let i = 0; i < ch.length; i++) { text += ch[i]; at.push(c); } }
  return findUrls(text).map(({ start, end, url }) => ({ url, range: { start: { x: at[start].x, y: at[start].y }, end: { x: at[end - 1].x, y: at[end - 1].y } } }));
}
