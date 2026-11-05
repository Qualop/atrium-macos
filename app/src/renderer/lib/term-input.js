// 터미널 노드 입력 규칙(ARCH 7.2, E4). 제어기 프레임은 herdr가 다시 그린 화면이라 괄호 붙여넣기와 마우스 추적 모드가
// xterm.js에 오지 않는다. 그래서 창이 직접 감싸고 바꾼 뒤 terminal.input으로 보낸다. 순수 함수만 둔다(단위 시험 있음).

export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';

// 붙여넣기를 괄호 붙여넣기로 감싼다. 감싸지 않으면 줄마다 따로 제출된다(E4 2.5).
// 줄바꿈은 터미널이 보내는 모양(CR)으로 맞춘다. 글 안의 감싸기 끝 표시는 지워 감싸기를 깨지 못하게 한다.
// P51(#3): shell이면 줄바꿈을 Shift+Enter(win32-input-mode 키 누름·뗌)로 보낸다. Windows PowerShell 5.1의 PSReadLine 2.0은
// 괄호 붙여넣기를 몰라 CR마다 제출한다. Shift+Enter는 PSReadLine의 AddLine이라 여러 줄이 입력줄에 쌓이고, 마지막 Enter는 사람이 친다(U8).
// ConPTY가 이 시퀀스를 Shift+Enter 키로 바꾼다. PSReadLine이 아닌 앞 프로그램(cmd, REPL)에서는 Enter와 같아 지금과 다르지 않다.
export const SHIFT_ENTER = '\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_';
export function wrapPaste(text, { shell = false, platform = globalThis.window?.mt?.platform || globalThis.process?.platform } = {}) {
  const body = String(text ?? '').replace(/\x1b\[20[01]~/g, '').replace(/\r\n?|\n/g, shell && platform === 'win32' ? SHIFT_ENTER : '\r');
  return body ? PASTE_START + body + PASTE_END : '';
}

// 휠 값을 단계 수로 바꾼다. 픽셀(deltaMode 0)은 pxPerStep px을 한 단계, 줄(1)은 한 줄을 한 단계, 쪽(2)은 rows단계로 본다.
// 소수 부분은 acc에 모아 다음 휠에 더한다(트랙패드의 작은 값이 모여, 같은 거리면 같은 만큼 간다)
export function wheelSteps({ deltaY, deltaMode = 0, rows = 24, acc = 0, pxPerStep = 100 }) {
  const unit = deltaMode === 1 ? 1 : deltaMode === 2 ? rows : 1 / pxPerStep;
  let total = acc + deltaY * unit;
  const steps = Math.trunc(total + Math.sign(total) * 1e-9); // 0.3 × 10이 2.9999…가 되는 소수 오차를 버린다
  total -= steps;
  return { steps, acc: Math.abs(total) < 1e-9 ? 0 : total };
}

// P51(#7): 셸 노드 판 안 기록 휠. 100px에 3줄(Windows Terminal의 기본, Windows의 휠 한 칸 3줄 설정과 같다).
// Chromium은 휠 한 칸을 100px로 주고, Windows 설정에서 한 칸 줄 수를 바꾸면 픽셀 값도 그 비율로 바뀌므로 그 설정을 따라간다.
export const SHELL_WHEEL_LINES = 3;
export function shellWheelLines({ deltaY, deltaMode = 0, rows = 24, acc = 0 }) {
  const r = wheelSteps({ deltaY, deltaMode, rows, acc, pxPerStep: 100 / SHELL_WHEEL_LINES });
  return { lines: r.steps, acc: r.acc };
}

// 휠을 SGR 마우스 시퀀스로 바꾼다(위 ESC[<64;x;yM, 아래 ESC[<65;x;yM). Claude Code 전체 화면 렌더러가 스스로 스크롤한다(E4 2.4).
// rect는 화면에 그려진(확대·축소가 반영된) 터미널 영역이라, 판의 배율과 상관없이 칸 위치를 비율로 구한다.
// 한 번에 여러 칸 굴린 휠은 최대 maxSteps번으로 나눠 보낸다. 트랙패드의 작은 값은 acc에 모아 둔다.
export function wheelToSgr({ deltaY, deltaMode = 0, clientX, clientY, rect, cols, rows, acc = 0, maxSteps = 5 }) {
  const { steps, acc: total } = wheelSteps({ deltaY, deltaMode, rows, acc }); // 픽셀은 100px을 한 번으로 본다
  if (!steps || !rect || !rect.width || !rect.height) return { seq: '', acc: total };
  const x = clamp(Math.floor(((clientX - rect.left) / rect.width) * cols) + 1, 1, cols);
  const y = clamp(Math.floor(((clientY - rect.top) / rect.height) * rows) + 1, 1, rows);
  const one = `\x1b[<${steps < 0 ? 64 : 65};${x};${y}M`;
  return { seq: one.repeat(Math.min(Math.abs(steps), maxSteps)), acc: total };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// P42: 휠 steps번(아래 +, 위 -)을 칸(x, y: 1부터)의 SGR 휠로. 끄는 중 가장자리 자동 스크롤이 쓴다
export function sgrWheel(steps, x, y, cols, rows) {
  const n = Math.trunc(steps);
  if (!n) return '';
  return `\x1b[<${n < 0 ? 64 : 65};${clamp(x, 1, cols)};${clamp(y, 1, rows)}M`.repeat(Math.abs(n));
}

// 키 처리(xterm attachCustomKeyEventHandler에서 부른다). 돌려준 action:
//   'block-ctrl-g'  막는다. Claude Code가 외부 편집기(메모장)를 띄운다(E9 2.4, P2에서 막기로 정함. docs/decisions.md)
//   'paste'         xterm이 ^V를 보내지 않게 하고 브라우저 붙여넣기 이벤트로 넘긴다(그 이벤트에서 감싼다)
//   'copy'          고른 글이 있으면 복사하고 ^C를 보내지 않는다
//   'clear-selection' P42: 고른 글이 있을 때 Esc는 선택만 끝낸다(웹처럼). 앱에 보내지 않는다(Claude Code에서 Esc는 턴 끊기)
//   'pass'          xterm이 처리한다
export function keyAction(e, hasSelection) {
  if (e.type !== 'keydown' || e.isComposing || e.keyCode === 229) return 'pass';
  const k = String(e.key || '').toLowerCase();
  if (e.ctrlKey && !e.altKey && !e.metaKey && k === 'g') return 'block-ctrl-g';
  if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'v') return 'paste';
  if (e.shiftKey && !e.ctrlKey && k === 'insert') return 'paste';
  if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'c' && (e.shiftKey || hasSelection)) return 'copy';
  if (k === 'escape' && hasSelection && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return 'clear-selection';
  return 'pass';
}

// base64 프레임 → 바이트(xterm.write는 Uint8Array를 UTF-8로 읽는다)
export function frameBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- P38: 끌어 고르기와 선택 ----------
// 판은 노드를 CSS 확대·축소(transform: scale)로 그린다. xterm은 마우스 위치(화면 px)를 확대·축소 전 칸 크기로 나눠
// 칸을 구하므로, 배율이 1이 아니면 선택이 마우스 밑 글자보다 뒤처지거나(배율 < 1) 앞선다(배율 > 1).
// 화면 점을 확대·축소 전 자리로 되돌려 xterm에 넘긴다. rect: 화면에 그려진 요소 사각형(getBoundingClientRect),
// width·height: 확대·축소 전 크기(offsetWidth·offsetHeight). 그러면 xterm의 칸 계산이 그대로 맞는다.
export function unscalePoint({ clientX, clientY, rect, width, height }) {
  if (!rect) return { clientX, clientY };
  const sx = rect.width > 0 && width > 0 ? rect.width / width : 1;
  const sy = rect.height > 0 && height > 0 ? rect.height / height : 1;
  return { clientX: rect.left + (clientX - rect.left) / sx, clientY: rect.top + (clientY - rect.top) / sy };
}

// 선택을 지우는 때. true면 지운다. P42(웹처럼): 선택은 문서 줄에 붙어 휠·자동 스크롤·새 프레임에 함께 움직이므로
// 'wheel'·'scroll'·'frame'으로는 지우지 않는다. 고르기를 끝내는 것은 웹과 같다(밖 누르기, 글 입력, Esc).
//   'copy'    고른 글을 복사했다(Ctrl+C, Ctrl+Shift+C). 다음 Ctrl+C가 ^C가 되게 지운다(Windows Terminal처럼)
//   'paste'   붙여넣었다(Ctrl+V, Shift+Insert)
//   'input'   글을 쳤다
//   'escape'  Esc
//   'outside' 터미널 밖을 눌렀다
//   'resize'  칸 수가 바뀌었다(줄이 다시 감겨 문서를 이어 갈 수 없다)
const CLEARS = new Set(['copy', 'paste', 'input', 'escape', 'outside', 'resize']);
export function clearsSelection(event, { hasSelection = true } = {}) {
  return !!hasSelection && CLEARS.has(event);
}

// 복사할 글: herdr가 다시 그린 화면은 줄 끝까지 빈칸이 차 있어, 줄마다 끝의 빈칸을 뺀다(Windows Terminal처럼)
export function copyText(sel) {
  return String(sel ?? '').replace(/[ \t]+(?=\r?\n|$)/g, '');
}

// 터미널 안을 누르면 판이 그 노드로 간다(navigateTo viewOnly). 끌어 고른 뒤의 click, 두세 번 누르기에서는 가지 않는다.
// 한 번 누르기도 TERM_CLICK_WAIT(Windows 기본 두 번 누르기 간격 500ms 가까이) 뒤에 다시 물어, 그 사이 선택이 생겼으면 가지 않는다.
// 기다리는 동안 다시 누르면(두 번째 누르기, 끌기 시작) 부르는 쪽(Canvas)이 취소한다
export const TERM_CLICK_WAIT = 450;
export function termClickNavigates({ detail = 1, hasSelection = false } = {}) {
  return detail <= 1 && !hasSelection;
}
