// P283: 터미널 링크(DOM 쪽). 계산은 lib/links.js(단위 시험 p283-lib), 여는 곳은 open-link.js.
// - OSC 8 하이퍼링크(Claude Code·Codex가 낸다): xterm linkHandler로 받는다. xterm 기본 처리(confirm 창 뒤 주소 없는 window.open)는
//   Electron 창이 막아 아무것도 열리지 않았다. 그 밖의 스킴도 받아(allowNonHttpProtocols) 열지 않고 알림만 낸다.
// - 글 속 http(s) 주소: 링크 제공자(registerLinkProvider)로 찾는다. 감싼 줄(isWrapped)은 이어 붙여 찾는다.
// - 여는 누르기: PC는 Ctrl+누르기(그냥 누르기는 글 고르기·노드 들어가기), 손가락·펜 탭은 그냥 누르기(lib/links.js opensOnClick).
//   마우스를 올리면 밑줄·손가락 모양과 작은 알림 글("Ctrl+클릭하면 링크를 엽니다")을 띄운다.
// - 누르기는 xterm Linkifier의 mouseup 처리에 맡기지 않는다: 판의 글 고르기(term-selection.js)가 mousedown을 멈춰 xterm에 닿지 않는다.
//   그래서 여기서 mousedown(고르기보다 먼저 건 capture)에 마우스 밑 링크(Linkifier.currentLink, 밑줄 친 그 링크)를 잡고,
//   여는 누르기면 고르기를 시작하지 않게 멈춘 뒤 mouseup이 같은 링크 위면 연다. Linkifier는 xterm 6.0.0 내부(_core._linkifier)라 판 올릴 때 확인한다.
// - 연 누르기의 click은 판(React Flow)으로 보내지 않는다: Ctrl+누르기는 판에서 노드 여럿 고르기다.
import { cellLinks, opensOnClick } from './lib/links.js';
import { openLink } from './open-link.js';
import { t } from './lib/i18n.js';

const MAX_WRAP = 12; // 한 논리 줄로 이어 볼 감싼 줄 수 상한
const CLICK_SWALLOW_MS = 700;

// 버퍼 줄 y(1부터)가 든 논리 줄의 칸들
function logicalCells(term, y) {
  const b = term.buffer.active, cell = b.getNullCell();
  let top = y - 1;
  for (let i = 0; i < MAX_WRAP && top > 0; i++) { const l = b.getLine(top); if (!l || !l.isWrapped) break; top--; }
  const cells = [];
  for (let row = top, n = 0; n < MAX_WRAP * 2; row++, n++) {
    const line = b.getLine(row);
    if (!line) break;
    if (row > top && !line.isWrapped) break;
    for (let x = 0; x < term.cols; x++) {
      const c = line.getCell(x, cell);
      if (!c || c.getWidth() === 0) continue;
      cells.push({ ch: c.getChars() || ' ', x: x + 1, y: row + 1 });
    }
  }
  return cells;
}

const sameLink = (a, b) => !!(a && b && a.text === b.text && a.range.start.x === b.range.start.x && a.range.start.y === b.range.start.y && a.range.end.x === b.range.end.x && a.range.end.y === b.range.end.y);

export function attachTermLinks(term, host, { log } = {}) {
  let pointerType = 'mouse', openedAt = 0, openedUrl = null, hintEl = null, pending = null;
  const lk = term._core && term._core._linkifier;
  const linkifier = () => (lk && ('currentLink' in lk ? lk : lk.value)) || null;
  if (!linkifier() && log) log('term_link_no_linkifier', {});
  const onPointerDown = (e) => { pointerType = e.pointerType || 'mouse'; };
  // 여는 누르기(PC Ctrl+누르기, 손가락 탭)가 링크 위에서 시작하면 글 고르기·판 고르기로 넘기지 않고 놓을 때 연다
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const cur = linkifier() && linkifier().currentLink;
    if (!cur || !opensOnClick(e, pointerType)) return;
    e.stopImmediatePropagation(); e.preventDefault();
    pending = cur.link;
    window.addEventListener('mouseup', onMouseUp, true);
  };
  const onMouseUp = (e) => {
    window.removeEventListener('mouseup', onMouseUp, true);
    const link = pending; pending = null;
    const cur = linkifier() && linkifier().currentLink;
    if (link && cur && sameLink(cur.link, link)) link.activate(e, link.text);
  };
  // 링크를 연 누르기의 click은 판으로 보내지 않는다(Ctrl+누르기 = 노드 여럿 고르기, 그냥 누르기 = 들어가기)
  const onClick = (e) => { if (performance.now() - openedAt < CLICK_SWALLOW_MS) { e.stopPropagation(); e.preventDefault(); } };
  host.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('mousedown', onMouseDown, true); // term-selection.js보다 먼저 건다(같은 요소의 capture는 건 차례로 돈다)
  host.addEventListener('click', onClick, true);

  const hideHint = () => { if (hintEl) { hintEl.remove(); hintEl = null; } };
  const showHint = (e, url) => {
    if (pointerType === 'touch' || pointerType === 'pen') return;
    hideHint();
    hintEl = document.createElement('div');
    hintEl.className = 'mt-link-hint';
    hintEl.dataset.role = 'link-hint';
    hintEl.textContent = t('urlLink.hint');
    hintEl.title = url;
    hintEl.style.left = `${Math.round(e.clientX + 12)}px`;
    hintEl.style.top = `${Math.round(e.clientY + 16)}px`;
    document.body.appendChild(hintEl);
  };
  const activate = (e, url, how) => {
    if (!opensOnClick(e, pointerType)) return;
    if (url === openedUrl && performance.now() - openedAt < CLICK_SWALLOW_MS) return; // xterm 자체 처리와 겹쳐 두 번 열지 않는다
    openedAt = performance.now(); openedUrl = url;
    hideHint();
    const ok = openLink(url);
    if (log) log('term_link_open', { how, ok, pointer: pointerType });
  };

  term.options.linkHandler = {
    allowNonHttpProtocols: true, // http(s)가 아닌 것도 받아 open-link.js가 알림을 낸다
    activate: (e, text) => activate(e, text, 'osc8'),
    hover: (e, text) => showHint(e, text),
    leave: hideHint,
  };
  const provider = term.registerLinkProvider({
    provideLinks(y, cb) {
      let links;
      try { links = cellLinks(logicalCells(term, y)).filter((l) => l.range.start.y <= y && l.range.end.y >= y); } catch { links = []; }
      cb(links.length ? links.map((l) => ({
        range: l.range, text: l.url, decorations: { pointerCursor: true, underline: true },
        activate: (e) => activate(e, l.url, 'text'),
        hover: (e) => showHint(e, l.url),
        leave: hideHint,
      })) : undefined);
    },
  });
  return () => {
    hideHint();
    provider.dispose();
    host.removeEventListener('pointerdown', onPointerDown, true);
    host.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    host.removeEventListener('click', onClick, true);
  };
}
