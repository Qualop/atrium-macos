// P109: 고른 노드가 없을 때 판에서 Space를 살짝 길게 누르면 전체 보기(lib/keys.js spaceHoldReady, spaceHoldStep)와 두 사전의 안내
import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceHoldReady, spaceHoldStep, SPACE_HOLD_MS } from '../src/renderer/lib/keys.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

// 화면 요소 흉내(p43-lib와 같다): closest(sel)는 cls·inside에 든 것과 맞으면 자신을 준다
function el(tag, { cls = [], inside = [], editable = false } = {}) {
  const all = [...cls, ...inside];
  return {
    tagName: tag, isContentEditable: editable, nodeType: 1,
    closest(sel) { return sel.split(',').map((s) => s.trim()).some((s) => all.some((c) => c === s)) ? this : null; },
  };
}
const sp = (target, more = {}) => ({ key: ' ', target, ...more });
const BODY = { tagName: 'BODY', nodeType: 1, closest: () => null };
const PANE = el('DIV', { cls: ['.react-flow__pane'], inside: ['.mt-stage'] });
const NODE = el('DIV', { cls: ['.react-flow__node'], inside: ['.mt-stage'] });

test('P109 조건: 몸통·판 빈 곳·노드 테두리에서, 아무것도 고르지 않았을 때만', () => {
  assert.equal(spaceHoldReady(sp(BODY)), true);
  assert.equal(spaceHoldReady(sp(PANE)), true);
  assert.equal(spaceHoldReady(sp(NODE)), true);
  assert.equal(spaceHoldReady(sp(null)), true, '대상 없음은 몸통');
  assert.equal(spaceHoldReady({ key: 'a', target: BODY }), false, 'Space가 아니다');
  assert.equal(spaceHoldReady({ key: 'Space', target: BODY }), false, 'key는 " "만');
  assert.equal(spaceHoldReady(null), false);
});

test('P109 조건: 고른 노드(판의 고름, React Flow의 고름)가 있으면 아니다', () => {
  assert.equal(spaceHoldReady(sp(BODY), { selected: ['s1'] }), false);
  assert.equal(spaceHoldReady(sp(BODY), { rfSelected: true }), false);
  assert.equal(spaceHoldReady(sp(BODY), { selected: [] , rfSelected: false }), true);
});

test('P109 조건: 초점 대상 — 터미널·입력 칸·메모 편집·단추·링크·role=button·판 밖은 그 자리의 몫', () => {
  const no = [
    ['터미널', el('TEXTAREA', { inside: ['.xterm', '.mt-stage'] })],
    ['터미널 안 DIV', el('DIV', { inside: ['.xterm', '.mt-stage'] })],
    ['명령 바', el('TEXTAREA', { inside: ['.mt-bottom', '.mt-stage'] })],
    ['입력 칸', el('INPUT', { inside: ['.mt-stage'] })],
    ['펼침', el('SELECT', { inside: ['.mt-stage'] })],
    ['메모 편집', el('DIV', { editable: true, inside: ['.mt-stage'] })],
    ['단추', el('BUTTON', { cls: ['button'], inside: ['.mt-stage'] })],
    ['단추 안 아이콘', el('SPAN', { inside: ['button', '.mt-stage'] })],
    ['링크', el('A', { cls: ['a[href]'], inside: ['.mt-stage'] })],
    ['role=button', el('DIV', { cls: ['[role="button"]'], inside: ['.mt-stage'] })],
    ['대화상자 안', el('DIV', { inside: ['[role="dialog"]', '.mt-stage'] })],
    ['메뉴 안', el('DIV', { inside: ['.mt-menu', '.mt-stage'] })],
    ['찾기 바 안', el('DIV', { inside: ['.mt-search', '.mt-stage'] })],
    ['사이드바(판 밖)', el('DIV', { inside: ['.mt-sidebar'] })],
  ];
  for (const [name, t] of no) assert.equal(spaceHoldReady(sp(t)), false, name);
});

test('P109 조건: 열린 화면(대화상자, 미션 맵, 출력 보기, 검색), 기다리는 입력이 있으면 아니다', () => {
  assert.equal(spaceHoldReady(sp(BODY), { dialog: { kind: 'spawn' } }), false);
  assert.equal(spaceHoldReady(sp(BODY), { missionOpen: true }), false);
  assert.equal(spaceHoldReady(sp(BODY), { outputOpen: true }), false);
  assert.equal(spaceHoldReady(sp(BODY), { searchOpen: true }), false);
  assert.equal(spaceHoldReady(sp(BODY), { pending: true }), false, '노드에 들어가 터미널을 기다리는 중(H4)');
});

test('P109 조건: 수정 키(Ctrl·Alt·Meta·Shift)와 한글 조합 중은 아니다', () => {
  for (const k of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'isComposing']) assert.equal(spaceHoldReady(sp(BODY, { [k]: true })), false, k);
});

// ---------- 시간 ----------
const run = (events) => {
  let s; let fires = 0;
  for (const ev of events) { const r = spaceHoldStep(s, ev); s = r.s; if (r.fire) fires += 1; }
  return { s, fires };
};

test('P109 시간: 기준 시간은 350~450ms', () => {
  assert.ok(SPACE_HOLD_MS >= 350 && SPACE_HOLD_MS <= 450);
});

test('P109 시간: 기준 전에 떼면 아무것도 하지 않는다(빠른 누름)', () => {
  const r = run([{ type: 'down', ready: true, at: 0 }, { type: 'up' }, { type: 'tick', at: SPACE_HOLD_MS + 5 }]);
  assert.equal(r.fires, 0);
  assert.equal(r.s.phase, 'idle');
  assert.equal(run([{ type: 'down', ready: true, at: 0 }, { type: 'tick', at: 120 }]).fires, 0, '120ms 시점');
});

test('P109 시간: 기준을 넘으면 한 번, 떼어도 그대로(되돌리지 않는다)', () => {
  const r = run([{ type: 'down', ready: true, at: 0 }, { type: 'tick', at: SPACE_HOLD_MS }, { type: 'tick', at: SPACE_HOLD_MS + 200 }, { type: 'up' }]);
  assert.equal(r.fires, 1);
  assert.equal(r.s.phase, 'idle');
});

test('P109 시간: 누른 채 오는 되풀이 keydown은 처음 것 하나로 본다', () => {
  const evs = [{ type: 'down', ready: true, at: 0 }];
  for (let t = 30; t < 1500; t += 33) evs.push({ type: 'down', ready: false, repeat: true, at: t });
  evs.push({ type: 'tick', at: SPACE_HOLD_MS + 5 });
  for (let t = 600; t < 1500; t += 33) evs.push({ type: 'down', ready: false, repeat: true, at: t }, { type: 'tick', at: t });
  assert.equal(run(evs).fires, 1, '되풀이가 다시 걸거나 시간을 늦추지 않는다');
  const late = run([{ type: 'down', ready: true, at: 0 }, { type: 'down', repeat: true, at: 300 }, { type: 'tick', at: SPACE_HOLD_MS }]);
  assert.equal(late.fires, 1, '시작 시각은 처음 keydown');
  assert.equal(run([{ type: 'down', ready: false, repeat: true, at: 0 }, { type: 'tick', at: 1000 }]).fires, 0, '되풀이만 오면 걸지 않는다(다른 곳에서 누르기 시작)');
});

test('P109 시간: 조건이 안 맞는 keydown은 걸지 않는다', () => {
  assert.equal(run([{ type: 'down', ready: false, at: 0 }, { type: 'tick', at: 1000 }]).fires, 0);
});

test('P109 시간: 기준 전 마우스 누름·끌기·휠·다른 키는 취소', () => {
  const r = run([{ type: 'down', ready: true, at: 0 }, { type: 'cancel' }, { type: 'tick', at: SPACE_HOLD_MS + 5 }]);
  assert.equal(r.fires, 0);
  const again = run([{ type: 'down', ready: true, at: 0 }, { type: 'cancel' }, { type: 'down', repeat: true, at: 200 }, { type: 'tick', at: 1000 }]);
  assert.equal(again.fires, 0, '취소 뒤 되풀이로 다시 걸지 않는다');
  const after = run([{ type: 'down', ready: true, at: 0 }, { type: 'tick', at: SPACE_HOLD_MS }, { type: 'cancel' }]);
  assert.equal(after.fires, 1, '기준을 넘은 뒤 끌기는 그 보기에서 옮긴다(취소할 것이 없다)');
});

test('P109 시간: 떼고 다시 길게 누르면 다시 한 번', () => {
  const r = run([
    { type: 'down', ready: true, at: 0 }, { type: 'tick', at: SPACE_HOLD_MS }, { type: 'up' },
    { type: 'down', ready: true, at: 2000 }, { type: 'tick', at: 2000 + SPACE_HOLD_MS }, { type: 'up' },
  ]);
  assert.equal(r.fires, 2);
});

// ---------- 사전 ----------
test('P109 사전: 두 사전에 spaceFit 안내가 있고 Space를 말한다', () => {
  for (const k of ['rail', 'chip', 'zoom']) {
    assert.ok(en.spaceFit && typeof en.spaceFit[k] === 'string' && /hold Space/.test(en.spaceFit[k]), `en ${k}`);
    assert.ok(ko.spaceFit && typeof ko.spaceFit[k] === 'string' && /Space를 길게/.test(ko.spaceFit[k]), `ko ${k}`);
  }
});
