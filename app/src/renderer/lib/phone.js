// P74: 휴대폰 세로 화면(Phone.jsx)이 쓰는 순수 함수(단위 시험 app/test/p74-lib.test.mjs).
// - 좁은 세로 화면인지(폭 430px 이하, 세로, 터치). 가로로 돌리거나 태블릿·노트북 폭이면 보드 화면을 그대로 쓴다
// - 세션 목록: 응답 필요(오래 기다린 순) → 작업 중 → 나머지(프로젝트별). P90: 작업 중과 프로젝트별은 시작한 순(createdAt)이라 활동이 생겨도 자리가 그대로
// - 줄마다 마지막 한 줄, 자주 쓰는 키의 바이트, 손가락 끌기 → 휠, 가상 키보드를 뺀 화면 높이
// - P104: 키 패드의 키와 보내는 줄(keyQueue), 펼칠지(padOpen)

export const PHONE_MAX_WIDTH = 430;
export const LAYOUT_KEY = 'mt.phoneLayout'; // 'board'면 휴대폰에서도 보드 화면(사용자가 고름). 없으면 저절로

// width·height: CSS px(window.innerWidth·innerHeight), coarse: 손가락 포인터(matchMedia('(pointer: coarse)')), pref: LAYOUT_KEY 값
export function isPhoneLayout({ width, height, coarse, pref = null } = {}) {
  if (pref === 'board') return false;
  if (!(width > 0) || !(height > 0)) return false;
  return !!coarse && width <= PHONE_MAX_WIDTH && height > width;
}

// P87: 휴대폰은 늘 세션 목록(캔버스 보드는 iPhone Safari에서 죽는다). 휴대폰 = 손가락 포인터이고 짧은 변이 PHONE_MAX_WIDTH 이하.
// 가로로 돌려도 휴대폰이다(가로 보드도 같은 이유로 죽는다). 태블릿(짧은 변 700px 안팎)·마우스 웹 화면·PC 창은 보드
export function isPhoneDevice({ width, height, coarse } = {}) {
  if (!(width > 0) || !(height > 0)) return false;
  return !!coarse && Math.min(width, height) <= PHONE_MAX_WIDTH;
}
export const firstView = (o) => (isPhoneDevice(o) ? 'list' : 'board');

const NEED = new Set(['waiting', 'trust_wait']);
const BUSY = new Set(['working', 'starting']);
export const needsYou = (s) => !!s && NEED.has(s.state);
export const isBusy = (s) => !!s && (BUSY.has(s.state) || !!s.waking || (s.kind === 'shell' && s.shell && s.shell.atPrompt === false && s.state !== 'exited' && s.state !== 'sleeping'));
const askSince = (s) => (s.ask && s.ask.since) || s.lastActivityAt || s.createdAt || 0;
// P90: 시작한 지 오래된 것부터(세션을 띄운 시각). 같으면 이름, 그다음 ID 순으로 늘 같은 자리
const byStart = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.name).localeCompare(String(b.name)) || String(a.sessionId).localeCompare(String(b.sessionId));
// 나머지 안에서는 살아 있는 세션 먼저, 끝났거나 잠든 세션은 아래로
const resting = (s) => (s.state === 'exited' || s.state === 'sleeping' ? 1 : 0);

// sessions: 요약 목록, workspaces: [{ key, name }] 보드 순서. 저장소가 없는 세션은 key null 묶음(맨 끝)
export function phoneList(sessions, workspaces = []) {
  const all = [...(sessions || [])].filter(Boolean);
  const needs = all.filter(needsYou).sort((a, b) => askSince(a) - askSince(b) || String(a.name).localeCompare(String(b.name)));
  const working = all.filter((s) => !needsYou(s) && isBusy(s)).sort(byStart);
  const taken = new Set([...needs, ...working].map((s) => s.sessionId));
  const rest = all.filter((s) => !taken.has(s.sessionId));
  const order = new Map(workspaces.map((w, i) => [w.key, i]));
  const byKey = new Map();
  for (const s of rest) {
    const k = s.workspaceKey && order.has(s.workspaceKey) ? s.workspaceKey : s.workspaceKey || null;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  const nameOf = (k) => { const w = workspaces.find((x) => x.key === k); return w ? w.name : k ? String(k).split('/').filter(Boolean).slice(-1)[0] || k : null; };
  const groups = [...byKey.entries()].map(([key, list]) => ({
    key, name: nameOf(key),
    sessions: list.sort((a, b) => resting(a) - resting(b) || byStart(a, b)),
    // 접힌 이름표에 보일 수(모든 세션: 위로 올라간 응답 필요·작업 중 포함)
    total: all.filter((s) => (s.workspaceKey || null) === key).length,
  })).sort((a, b) => (a.key == null) - (b.key == null) || (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9) || String(a.name).localeCompare(String(b.name)));
  return { needs, working, groups };
}

// 상태 점의 색 이름(phone.css의 data-tone). 셸은 명령이 돌면 shell_running(P93: 셸은 초록, 에이전트 working은 주황)
export function toneOf(s) {
  if (!s) return 'exited';
  if (s.waking) return 'starting';
  if (s.kind === 'shell' && s.state !== 'exited' && s.state !== 'sleeping' && s.state !== 'error') return s.shell && s.shell.atPrompt === false ? 'shell_running' : 'ready';
  if (s.state === 'trust_wait') return 'waiting';
  if (s.unseen && s.state === 'ready') return 'review';
  return ['starting', 'ready', 'working', 'waiting', 'error', 'exited', 'sleeping'].includes(s.state) ? s.state : 'starting';
}

const firstLine = (x) => String(x || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
// 목록 줄 아래의 마지막 한 줄: 묻는 것 → 오류 → 셸 명령 → 마지막 답 → 마지막 지시
export function lastLineOf(s) {
  if (!s) return { kind: 'none', text: '' };
  const a = s.ask;
  if (s.state === 'trust_wait') return { kind: 'ask', text: '', key: 'trust' };
  if (s.state === 'waiting' && a) {
    if (a.kind === 'permission') { const sum = firstLine(a.summary); const body = a.tool && sum.startsWith(`${a.tool}:`) ? sum.slice(a.tool.length + 1).trim() : sum; return { kind: 'ask', text: body, key: 'permission', tool: a.tool || '' }; } // 앞의 "Bash:"는 이끄는 말(…승인)과 겹친다
    if (a.kind === 'question') return { kind: 'ask', text: firstLine((a.questions || []).map((q) => q.question).join(' / ')), key: 'question' };
    if (a.kind === 'plan') return { kind: 'ask', text: firstLine(a.plan), key: 'plan' };
    return { kind: 'ask', text: firstLine(a.tail), key: 'screen' };
  }
  if (s.state === 'error' && s.error) return { kind: 'error', text: firstLine(typeof s.error === 'string' ? s.error : s.error.message || '') };
  if (s.kind === 'shell') return { kind: 'shell', text: firstLine(s.shell && s.shell.command) };
  if (s.state === 'working' && s.lastPrompt) return { kind: 'prompt', text: firstLine(s.lastPrompt) };
  if (s.lastAnswer) return { kind: 'answer', text: firstLine(s.lastAnswer) };
  if (s.lastPrompt) return { kind: 'prompt', text: firstLine(s.lastPrompt) };
  return { kind: 'none', text: '' };
}

// 자주 쓰는 키 줄(왼쪽부터). appCursor: 터미널이 응용 커서 모드면 화살표를 ESC O A로
export const KEY_ROW = ['enter', 'esc', 'ctrlc', 'up', 'down', 'tab', 'shifttab', 'slash'];
export function keyBytes(key, { appCursor = false } = {}) {
  switch (key) {
    case 'enter': return '\r';
    case 'esc': return '\x1b';
    case 'ctrlc': return '\x03';
    case 'up': return appCursor ? '\x1bOA' : '\x1b[A';
    case 'down': return appCursor ? '\x1bOB' : '\x1b[B';
    case 'left': return appCursor ? '\x1bOD' : '\x1b[D';
    case 'right': return appCursor ? '\x1bOC' : '\x1b[C';
    case 'tab': return '\t';
    case 'shifttab': return '\x1b[Z';
    case 'slash': return '/';
    default: return '';
  }
}

// P104: 키 패드(응답 키). 판은 답을 고르지 않고 누른 키를 그 세션 패널에 그대로 보낸다(백엔드 session.keys, 받는 키는 keys.mjs KEY_NAMES).
// 그래서 Claude Code, Codex, 셸 어디서나 같다. 두 줄 일곱 칸: 위 [Esc 1 2 3 4 ↑ Tab], 아래 [닫기 Space Enter(두 칸) ← ↓ →]
// 숫자는 1~4: Claude Code의 권한 질문(3개까지)·계획 승인(4개까지)·AskUserQuestion(선택지 2~4개)의 번호. 그 밖의 줄과 다른 하네스는 화살표와 Enter로 고른다
export const PAD_KEYS = ['esc', '1', '2', '3', '4', 'up', 'tab', 'space', 'enter', 'left', 'down', 'right'];
export const PAD_MAX = 32; // 요청 하나에 담는 키(keys.mjs KEYS_MAX)

// 누른 키를 차례로 보낸다. 앞 요청이 돌아오기 전에 누른 키는 모아 다음 요청 하나로 보낸다(빠지지 않고 차례가 섞이지 않는다).
// 실패하면 모아 둔 키를 버린다(끊긴 뒤 늦게 닿아 다음 질문에 답하지 않게). send(keys) → Promise. onError(e, 버린 키 수)
export function keyQueue(send, onError = () => {}, capture = () => null) {
  let pending = [];
  let busy = false;
  const pump = async () => {
    if (busy || !pending.length) return;
    busy = true;
    const context = pending[0].context;
    const batch = [];
    while (pending.length && batch.length < PAD_MAX && pending[0].context === context) batch.push(pending.shift().key);
    try { await send(batch, context); } catch (e) { const n = batch.length + pending.length; pending = []; onError(e, n); } finally { busy = false; }
    pump();
  };
  return { push(k) { pending.push({ key: k, context: capture() }); pump(); }, pending: () => pending.length, busy: () => busy };
}

// 키 패드를 펼칠까. 응답이 필요하면 펼친다. 사람이 열거나 닫았으면(pref) 그 뜻을 따르되, 기다리는 요청이 바뀌면(padKeyOf) 창이 pref를 비운다
export const padKeyOf = (s, askKeyOf) => (needsYou(s) ? `need|${s.state}|${askKeyOf(s.ask)}` : 'calm');
export const padOpen = (s, pref) => (pref != null ? !!pref : needsYou(s));

// 손가락으로 끈 거리(px, 아래로 +) → 휠 deltaY(px). 손가락을 올리면 글이 올라가며 아래(뒤)를 본다.
// 휠은 100px을 한 번으로 친다(lib/term-input.js). 손가락 33px쯤에 한 번
export const TOUCH_WHEEL_GAIN = 3;
export const touchWheelDelta = (dy, gain = TOUCH_WHEEL_GAIN) => (dy ? -dy * gain : 0);

// 가상 키보드가 올라오면 보이는 높이(visualViewport)에 화면을 맞춘다. vv가 없으면 창 높이
export function viewportBox(vv, innerHeight) {
  if (!vv || !(vv.height > 0)) return { height: Math.round(innerHeight || 0), top: 0 };
  return { height: Math.round(vv.height), top: Math.max(0, Math.round(vv.offsetTop || 0)) };
}

// P83: 화면 높이. iOS 홈 화면 앱(standalone, black-translucent)은 창 높이(innerHeight, 100vh, visualViewport)를 화면보다
// 위 안전 영역(상태 표시줄)만큼 짧게 줄 때가 있다. 그러면 아래에 그만큼 빈 띠가 남는다. 홈 화면 앱에는 브라우저 막대가 없으니
// 키보드가 닫혀 있고 모자란 높이가 TALL_GAP_MAX 안이면 화면 높이(screen, 세로면 긴 변)를 쓴다. 브라우저 탭과 키보드가 열린 때는 viewportBox 그대로
export const TALL_GAP_MAX = 100;
export const KB_GAP_PX = 120; // 보이는 높이가 창 높이보다 이만큼 작으면 키보드(P74, touch-board.js KB_OPEN_PX와 같다)
export function screenBox({ vv, innerHeight, innerWidth, screenW, screenH, standalone = false }) {
  const b = viewportBox(vv, innerHeight);
  if (!standalone || !(screenW > 0) || !(screenH > 0)) return b;
  if (b.top > 0 || b.height < (innerHeight || 0) - KB_GAP_PX) return b; // 키보드가 열렸다
  const full = Math.round((innerHeight || 0) >= (innerWidth || 0) ? Math.max(screenW, screenH) : Math.min(screenW, screenH));
  const gap = full - Math.max(b.height, Math.round(innerHeight || 0));
  return gap > 0 && gap <= TALL_GAP_MAX ? { height: full, top: 0, tall: gap } : b;
}

// 입력 줄: 에이전트는 전달 대기열(session.send, 여러 줄 그대로), 셸은 터미널 입력(줄마다 Enter 대신 마지막에 한 번)
// P90: Claude Code는 whileWorking: 'type'. 일하는 중이면 판이 기다리지 않고 바로 넣어 Claude Code가 대기 메시지로 받는다(판단은 백엔드 canTypeNow)
export function sendPlan(s, text) {
  const body = String(text || '').replace(/\r\n?/g, '\n');
  if (!body.trim()) return null;
  if (s && s.kind === 'shell') return { method: 'terminal.input', data: body.replace(/\n+$/, '') + '\r' };
  if (!s || (s.kind || 'claude') === 'claude') return { method: 'session.send', text: body, whileWorking: 'type' };
  return { method: 'session.send', text: body };
}

// 다음 응답 필요: 지금 세션 다음(없으면 처음). 지금 세션밖에 없으면 null
export function nextNeed(needIds, currentId) {
  const list = (needIds || []).filter((x) => x !== currentId);
  if (!list.length) return null;
  const i = (needIds || []).indexOf(currentId);
  if (i < 0) return list[0];
  for (let k = 1; k <= needIds.length; k++) { const id = needIds[(i + k) % needIds.length]; if (id !== currentId) return id; }
  return null;
}
