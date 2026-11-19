// 터미널 노드 입력 규칙(ARCH 7.2, E4). 제어기 프레임은 터미널 서버가 다시 그린 화면이라 괄호 붙여넣기와 마우스 추적 모드가
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

// P126: 휠을 마우스 보고로 보낼지. 프로그램이 마우스 추적(DECSET 1000·1002·1003)을 켜지 않았는데 보내면 받는 쪽이 보고를 글로 읽어
// 입력창에 `[<65;101;61M` 같은 글이 남을 수 있다(그 뒤 판이 넣은 지시가 제출되지 않았다).
// - modesKnown: 이 터미널이 받는 프레임이 마우스 모드를 알려 준다(hc 판은 프레임마다 모드를 다시 적는다). 프레임에 모드를 적지 않는 서버는 다시 그린 화면만 보내
//   마우스 모드가 xterm에 오지 않는다(늘 'none'). 그때는 알 수 없으므로 예전처럼 보낸다(터미널 서버가 입력을 받아 프로그램에 맞춰 넘긴다)
// - 모드가 꺼져 있으면 아무것도 보내지 않는다. 에이전트 노드는 판 안 기록이 없어(scrollback 0) 굴릴 것이 없고, xterm 기본(대체 화면이면
//   위·아래 키)은 Codex·Claude Code에서 지난 지시 불러오기가 되어 입력창을 바꾼다
// → 'report'(SGR 휠을 보낸다) | 'swallow'(삼킨다)
// - framed(P135): 이 터미널에 첫 프레임이 왔고 다시 붙는 중이 아니다. 그 전에는 모드를 모르고 보낼 곳도 아직 없으니 삼킨다
export function wheelAction({ modesKnown = false, mouseTrackingMode = 'none', framed = true } = {}) {
  if (!framed) return 'swallow';
  if (!modesKnown) return 'report';
  return mouseTrackingMode && mouseTrackingMode !== 'none' ? 'report' : 'swallow';
}
// P135: 마우스 보고 거르기. 콘솔 호스트(ConPTY)가 입력을 읽지 못하는 동안(PC 메모리가 모자라 창을 다시 띄울 때 등) 쌓인 입력은 나중에 한꺼번에 읽힌다.
// 한 번에 읽는 양(4096바이트)을 넘으면 읽는 경계가 보고 가운데에 떨어질 수 있고, ESC 바로 뒤에서 끊기면 ESC는 Esc 키로, 나머지
// `[<65;101;61M`은 글자로 들어가 Codex·Claude Code 입력창에 남는다(P135 재현: 콘솔 호스트를 3초 멈추고 휠 보고 400개 → 입력창에 남음, 75개 → 깨끗).
// 그래서 (1) 아무 단추도 누르지 않은 마우스 움직임 보고(DECSET 1003, 마우스를 움직일 때마다 하나)는 보내지 않는다. 에이전트 하네스는 마우스 올림을 쓰지 않는다.
// (2) 프로그램이 다시 그리기(프레임) 전에 보낸 보고는 REPORT_BUDGET바이트까지만 보낸다. 프로그램이 받아서 그리면 프레임이 오고 다시 센다.
//     휠 한 칸에 보고 하나(약 13바이트)라 쉬지 않고 75칸 넘게 굴려도 화면이 바뀌지 않을 때만 막힌다
export const REPORT_BUDGET = 1024;
const MOUSE_G = /\x1b\[<(\d+);\d+;\d+[Mm]|\x1b\[M([\s\S]{3})/g;
// 단추 없는 움직임: 움직임 비트(32)가 있고 단추 칸이 3(누른 단추 없음)
const isHover = (code) => (code & 32) !== 0 && (code & 3) === 3;
// data: 터미널로 보낼 글. room: 더 보낼 수 있는 보고 바이트 → { data(거른 글), bytes(남긴 보고 바이트), hover(뺀 움직임 수), held(자리가 없어 뺀 보고 수) }
export function filterMouse(data, { room = Infinity } = {}) {
  const s = String(data ?? '');
  if (!s.includes('\x1b[')) return { data: s, bytes: 0, hover: 0, held: 0 };
  let bytes = 0, hover = 0, held = 0;
  const out = s.replace(MOUSE_G, (m, sgr, x10) => {
    const code = sgr != null ? Number(sgr) : x10.charCodeAt(0) - 32;
    if (isHover(code)) { hover++; return ''; }
    if (bytes + m.length > room) { held++; return ''; }
    bytes += m.length;
    return m;
  });
  return { data: out, bytes, hover, held };
}

// P126: DECSET·DECRST(CSI ? … h|l)의 인자에 마우스 모드가 있는가. xterm 파서의 인자는 숫자이거나(하위 인자가 있으면) 숫자 배열이다
export const MOUSE_MODES = [9, 1000, 1001, 1002, 1003, 1005, 1006, 1015, 1016];
export function setsMouseMode(params) {
  for (const p of params || []) for (const n of [].concat(p)) if (MOUSE_MODES.includes(n)) return true;
  return false;
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
// P82: 다시 붙은 뒤 첫 full 프레임 앞에 붙인다(글자 속성 초기화, 맨 위 왼쪽, 보이는 화면 지우기). 기록(scrollback)은 그대로다
export const REDRAW_PREFIX = Uint8Array.from([0x1b, 0x5b, 0x30, 0x6d, 0x1b, 0x5b, 0x48, 0x1b, 0x5b, 0x32, 0x4a]); // ESC[0m ESC[H ESC[2J
export function joinBytes(a, b) { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out; }

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
//   (P125) 복사(Ctrl+C, Ctrl+Shift+C, 끌어 고르기)로는 지우지 않는다. 고른 글이 남아 있는 동안 Ctrl+C는 몇 번을 눌러도 복사만 한다.
//   복사하려고 Ctrl+C를 두 번 누르면 두 번째가 ^C가 되어 Claude Code가 끝나던 것을 막는다. ^C를 보내려면 Esc·밖 누르기·글 입력으로 먼저 고르기를 끝낸다
//   'paste'   붙여넣었다(Ctrl+V, Shift+Insert)
//   'input'   글을 쳤다
//   'escape'  Esc
//   'outside' 터미널 밖을 눌렀다
//   'resize'  칸 수가 바뀌었다(줄이 다시 감겨 문서를 이어 갈 수 없다)
const CLEARS = new Set(['paste', 'input', 'escape', 'outside', 'resize']);

// P125: 끌어 고르기(두세 번 누르기 포함)를 놓을 때 클립보드로 복사할까. 고른 글이 있을 때만(그냥 누르기는 아니다)
export function copyOnRelease({ hasSelection = false, text = '' } = {}) {
  return !!hasSelection && copyText(text).trim().length > 0; // 빈칸·줄바꿈만이면 클립보드를 덮지 않는다
}
export function clearsSelection(event, { hasSelection = true } = {}) {
  return !!hasSelection && CLEARS.has(event);
}

// 복사할 글: 터미널 서버가 다시 그린 화면은 줄 끝까지 빈칸이 차 있어, 줄마다 끝의 빈칸을 뺀다(Windows Terminal처럼)
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
