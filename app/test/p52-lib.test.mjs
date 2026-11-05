// P52: 크롬 이슈 #4(사이드바 머리줄의 세는 값), #5(대화상자 Esc·초점, 전체 보기와 떠 있는 크롬)의 순수 함수
import test from 'node:test';
import assert from 'node:assert/strict';
import { escTarget, topOf, trapIndex, firstFieldIndex } from '../src/renderer/lib/dialog.js';
import { chromeInset, fitInset } from '../src/renderer/lib/chrome-inset.js';
import { buildRows } from '../src/renderer/lib/sidebar-tree.js';

const esc = (o = {}) => ({ key: 'Escape', isComposing: false, defaultPrevented: false, inside: false, inTerminal: false, inField: false, ...o });

test('#5 Esc: 맨 위 하나만 닫는다', () => {
  const stack = [{ id: 1, modal: false }, { id: 2, modal: true }];
  assert.equal(topOf(stack).id, 2);
  assert.equal(escTarget(stack, esc()), 2);
  assert.equal(escTarget([], esc()), null);
  assert.equal(escTarget(stack, esc({ key: 'Enter' })), null);
});

test('#5 Esc: 한글 조합 중이거나 안쪽 칸이 이미 쓴 Esc는 닫지 않는다', () => {
  const stack = [{ id: 1, modal: true }];
  assert.equal(escTarget(stack, esc({ isComposing: true })), null);
  assert.equal(escTarget(stack, esc({ defaultPrevented: true })), null);
  assert.equal(escTarget(stack, esc({ inField: true, inside: true })), 1, '대화상자 안 입력 칸의 Esc는 닫는다');
});

test('#5 Esc: 떠 있는 창은 터미널·바깥 입력 칸의 Esc를 가져가지 않는다', () => {
  const stack = [{ id: 7, modal: false }];
  assert.equal(escTarget(stack, esc({ inTerminal: true })), null, '터미널의 Esc는 에이전트 끊기');
  assert.equal(escTarget(stack, esc({ inField: true })), null, '명령 바 등 바깥 입력 칸');
  assert.equal(escTarget(stack, esc({ inside: true, inField: true })), 7, '창 안의 칸');
  assert.equal(escTarget(stack, esc()), 7, '판이나 단추에 초점');
  assert.equal(escTarget([{ id: 3, modal: true }], esc({ inTerminal: true })), 3, '대화상자는 어디서든');
});

test('#5 Tab 가두기: 끝에서 처음으로, 처음에서 끝으로', () => {
  assert.equal(trapIndex(3, 2, false), 0);
  assert.equal(trapIndex(3, 0, true), 2);
  assert.equal(trapIndex(3, 1, false), 2);
  assert.equal(trapIndex(3, -1, false), 0, '밖에서 Tab이면 처음');
  assert.equal(trapIndex(3, -1, true), 2);
  assert.equal(trapIndex(0, -1, false), -1);
});

test('#5 열 때 초점: 첫 입력 칸, 단추는 고르지 않는다', () => {
  const B = { tag: 'BUTTON' }, I = { tag: 'INPUT', type: 'text' }, S = { tag: 'SELECT' }, C = { tag: 'INPUT', type: 'checkbox' };
  assert.equal(firstFieldIndex([B, S, I]), 1);
  assert.equal(firstFieldIndex([B, C, I]), 2);
  assert.equal(firstFieldIndex([B, { ...I, disabled: true }, { tag: 'TEXTAREA' }]), 2);
  assert.equal(firstFieldIndex([B, B]), -1, '확인 대화상자는 상자 자체에 초점(Enter로 지우지 않게)');
  assert.equal(firstFieldIndex([I, { ...B, autofocus: true }]), 1, 'autofocus가 이긴다');
});

const view = { left: 0, top: 0, right: 1584, bottom: 921 };
const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });

test('#5 크롬 여백: 위 알약, 왼쪽·오른쪽 레일, 아래 바', () => {
  const ins = chromeInset(view, { top: [rect(87, 17, 600, 34), rect(1300, 17, 270, 34)], left: [rect(17, 300, 50, 320)], right: [rect(1522, 330, 48, 260)], bottom: [] }, { gap: 12 });
  assert.deepEqual(ins, { top: 63, left: 79, right: 74, bottom: 0 });
  const withBar = chromeInset(view, { bottom: [rect(300, 820, 900, 90)] }, { gap: 12 });
  assert.equal(withBar.bottom, 113);
  assert.equal(chromeInset(view, { top: [rect(0, 0, 10, 900)] }).top, Math.round(921 * 0.3), '한쪽 여백은 30%까지');
  assert.deepEqual(chromeInset(view, {}), { top: 0, left: 0, right: 0, bottom: 0 });
});

test('#5 여백 안에 맞추기: 맞춘 사각형이 여백 밖으로 나가지 않는다', () => {
  const screen = { width: 1584, height: 921 };
  const inset = { top: 63, left: 79, right: 74, bottom: 0 };
  const b = { x: -40, y: -40, w: 3000, h: 1200 };
  const vp = fitInset(b, screen, inset);
  const sx = b.x * vp.zoom + vp.x, sy = b.y * vp.zoom + vp.y;
  assert.ok(sx >= inset.left - 0.5 && sy >= inset.top - 0.5, `왼쪽 위 ${sx},${sy}`);
  assert.ok(sx + b.w * vp.zoom <= screen.width - inset.right + 0.5);
  assert.ok(sy + b.h * vp.zoom <= screen.height - inset.bottom + 0.5);
  // 여백이 없으면 옛 맞추기(fitViewport)와 같다
  const v0 = fitInset({ x: 0, y: 0, w: 3000, h: 960 }, { width: 1500, height: 800 }, {}, { maxZoom: 1 });
  assert.equal(v0.zoom, 0.5);
  assert.equal(fitInset({ x: 0, y: 0, w: 100, h: 100 }, { width: 1000, height: 1000 }, {}).zoom, 1, '배율 상한');
  assert.equal(fitInset(null, screen, inset), null);
  // fill: 둘레를 띄운다(영역으로 가기)
  const f = fitInset({ x: 0, y: 0, w: 1000, h: 100 }, { width: 1000, height: 1000 }, {}, { fill: 0.92 });
  assert.equal(f.zoom, 0.92);
});

test('#4 사이드바 워크스페이스 줄의 세는 값은 세션 상태에서 바로 센다', () => {
  const ws = [{ key: 'a', name: 'a' }];
  const s = (state, extra = {}) => ({ sessionId: 's1', name: 'x', workspaceKey: 'a', state, ...extra });
  const head = (sessions) => buildRows({ workspaces: ws, sessions }).rows.find((r) => r.type === 'ws').c;
  assert.equal(head([s('ready')]).working, 0);
  assert.equal(head([s('working')]).working, 1, '턴 중');
  assert.equal(head([s('shell_running', { kind: 'shell' })]).working, 1, '셸 명령 중');
  const after = head([s('ready', { unseen: true })]);
  assert.equal(after.working, 0, '턴이 끝나면 바로 0');
  assert.equal(head([s('waiting')]).need, 1);
  // 판이 보낸 옛 세는 값(workspace.updated의 counts)은 쓰지 않는다
  const stale = buildRows({ workspaces: [{ key: 'a', name: 'a', counts: { working: 2 } }], sessions: [s('ready')] }).rows.find((r) => r.type === 'ws').c;
  assert.equal(stale.working, 0);
});
