// 터미널 노드 입력 규칙(ARCH 7.2, E4). 제어기 프레임은 herdr가 다시 그린 화면이라 괄호 붙여넣기와 마우스 추적 모드가
// xterm.js에 오지 않는다. 그래서 창이 직접 감싸고 바꾼 뒤 terminal.input으로 보낸다. 순수 함수만 둔다(단위 시험 있음).

export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

// 붙여넣기를 괄호 붙여넣기로 감싼다. 감싸지 않으면 줄마다 따로 제출된다(E4 2.5).
// 줄바꿈은 터미널이 보내는 모양(CR)으로 맞춘다. 글 안의 감싸기 끝 표시는 지워 감싸기를 깨지 못하게 한다.
export function wrapPaste(text) {
  const body = String(text ?? '').replace(/\x1b\[20[01]~/g, '').replace(/\r\n?|\n/g, '\r');
  return body ? PASTE_START + body + PASTE_END : '';
}

// 휠을 SGR 마우스 시퀀스로 바꾼다(위 ESC[<64;x;yM, 아래 ESC[<65;x;yM). Claude Code 전체 화면 렌더러가 스스로 스크롤한다(E4 2.4).
// rect는 화면에 그려진(확대·축소가 반영된) 터미널 영역이라, 판의 배율과 상관없이 칸 위치를 비율로 구한다.
// 한 번에 여러 칸 굴린 휠은 최대 maxSteps번으로 나눠 보낸다. 트랙패드의 작은 값은 acc에 모아 둔다.
export function wheelToSgr({ deltaY, deltaMode = 0, clientX, clientY, rect, cols, rows, acc = 0, maxSteps = 5 }) {
  const unit = deltaMode === 1 ? 1 : deltaMode === 2 ? rows : 1 / 100; // 줄 단위로 바꾼다(픽셀은 100px을 한 번으로 본다)
  let total = acc + deltaY * unit;
  const steps = Math.trunc(total);
  total -= steps;
  if (!steps || !rect || !rect.width || !rect.height) return { seq: '', acc: total };
  const x = clamp(Math.floor(((clientX - rect.left) / rect.width) * cols) + 1, 1, cols);
  const y = clamp(Math.floor(((clientY - rect.top) / rect.height) * rows) + 1, 1, rows);
  const one = `\x1b[<${steps < 0 ? 64 : 65};${x};${y}M`;
  return { seq: one.repeat(Math.min(Math.abs(steps), maxSteps)), acc: total };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 키 처리(xterm attachCustomKeyEventHandler에서 부른다). 돌려준 action:
//   'block-ctrl-g'  막는다. Claude Code가 외부 편집기(메모장)를 띄운다(E9 2.4, P2에서 막기로 정함. docs/decisions.md)
//   'paste'         xterm이 ^V를 보내지 않게 하고 브라우저 붙여넣기 이벤트로 넘긴다(그 이벤트에서 감싼다)
//   'copy'          고른 글이 있으면 복사하고 ^C를 보내지 않는다
//   'pass'          xterm이 처리한다
export function keyAction(e, hasSelection) {
  if (e.type !== 'keydown') return 'pass';
  const k = String(e.key || '').toLowerCase();
  if (e.ctrlKey && !e.altKey && !e.metaKey && k === 'g') return 'block-ctrl-g';
  if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'v') return 'paste';
  if (e.shiftKey && !e.ctrlKey && k === 'insert') return 'paste';
  if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'c' && (e.shiftKey || hasSelection)) return 'copy';
  return 'pass';
}

// base64 프레임 → 바이트(xterm.write는 Uint8Array를 UTF-8로 읽는다)
export function frameBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
