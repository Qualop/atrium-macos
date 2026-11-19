// P146 단위 시험: 판 움직임 비용 줄이기(P144 원인 1·4·7)와 성능 기록 스위치.
// 1) 초점 없는 터미널의 숨은 입력칸 고정 CSS(초점 터미널에는 안 걸림)
// 2) 바뀐 노드만 다시 그리기(lib/node-reuse.js: 값이 같으면 같은 객체, 바뀐 것만 새로)
// 3) 대화 노드 멀리 얼굴이 배율을 구독하지 않음(--inv 계단 CSS), 움직이는 동안 그림자 빼기
// 4) 성능 기록 요약(lib/perf-summary.js)과 꺼져 있을 때 비용 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reuseNode, sameFields, sameList, sessionNode, NO_DATA, shallowSame } from '../src/renderer/lib/node-reuse.js';
import { statOf, loafOf, longTasksOf, summarize, zoomOfTransform, visibleCount } from '../src/renderer/lib/perf-summary.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const noComments = (s) => s.replace(/\/\*[^]*?\*\//g, '');

test('입력칸 고정 CSS: 초점 없는 터미널(.xterm:not(.focus))에만 걸리고 네 값을 묶는다', () => {
  const css = noComments(read('styles.css'));
  const rules = css.split('}').filter((r) => r.includes('xterm-helper-textarea'));
  assert.equal(rules.length, 1, '입력칸 규칙은 하나');
  const r = rules[0];
  assert.match(r, /^\s*\.xterm:not\(\.focus\) \.xterm-helper-textarea \{/);
  for (const k of ['left: 0', 'top: 0', 'width: 1px', 'height: 1px']) assert.ok(r.includes(`${k} !important`), k);
  // 초점 터미널(.xterm.focus)의 입력칸을 묶는 규칙은 없다(한국어 IME 후보창 자리)
  assert.ok(!/\.xterm\.focus[^{]*xterm-helper-textarea/.test(css));
  // 선택자 흉내: .focus가 있으면 걸리지 않는다
  const applies = (classes) => classes.includes('xterm') && !classes.includes('focus');
  assert.equal(applies(['xterm', 'focus']), false);
  assert.equal(applies(['xterm']), true);
});

test('노드 재사용: 값이 같으면 같은 객체, React Flow가 더한 값(selected·measured)은 그대로', () => {
  const r = { x: 10, y: 20, w: 640, h: 360, z: 2 };
  const a = sessionNode(null, 's1', r);
  assert.equal(a.data, NO_DATA);
  const withRf = { ...a, selected: true, measured: { width: 640, height: 360 } }; // React Flow가 고른 표시와 잰 크기를 더한 노드
  const b = sessionNode(withRf, 's1', { ...r });
  assert.equal(b, withRf, '값이 같으면 옛 객체 그대로(다시 그리지 않음)');
  assert.equal(b.selected, true, '선택이 남는다');
});

test('노드 재사용: 자리·크기·쌓임·덩어리·끄는 자리가 바뀌면 새 객체(바뀐 것이 반영된다)', () => {
  const r = { x: 10, y: 20, w: 640, h: 360, z: 0 };
  const old = { ...sessionNode(null, 's1', r), selected: true };
  const cases = [
    ['자리', sessionNode(old, 's1', { ...r, x: 11 }), (n) => n.position.x === 11],
    ['크기', sessionNode(old, 's1', { ...r, w: 800 }), (n) => n.width === 800],
    ['높이', sessionNode(old, 's1', { ...r, h: 400 }), (n) => n.height === 400],
    ['쌓임', sessionNode(old, 's1', { ...r, z: 5 }), (n) => n.zIndex === 5],
    ['덩어리', sessionNode(old, 's1', r, null, { dir: 'row' }), (n) => n.className === 'docked dock-row'],
    ['끄는 자리', sessionNode(old, 's1', r, { x: 99, y: 98 }), (n) => n.position.x === 99 && n.position.y === 98],
  ];
  for (const [what, n, ok] of cases) {
    assert.notEqual(n, old, what);
    assert.ok(ok(n), what);
    assert.equal(n.selected, true, `${what}: 선택은 남는다`);
    assert.equal(n.data, old.data, `${what}: data는 옛 것을 다시 쓴다`);
  }
  // 덩어리에서 떼면 다시 바뀐다
  const docked = sessionNode(null, 's1', r, null, { dir: 'col' });
  assert.notEqual(sessionNode(docked, 's1', r), docked);
  assert.equal(sessionNode(docked, 's1', r).className, '');
});

test('노드 재사용: 메모·칸반·대화 data(두 단계까지 값 비교), 영역 data의 배열, 바뀐 것만 새로', () => {
  const old = { id: 'convo:c1', type: 'convo', position: { x: 0, y: 0 }, width: 300, height: 200, dragHandle: '.mt-cdrag', data: { convId: 'c1' }, zIndex: 0 };
  assert.equal(reuseNode(old, { ...old, position: { x: 0, y: 0 }, data: { convId: 'c1' } }), old);
  const moved = reuseNode(old, { ...old, position: { x: 5, y: 0 }, data: { convId: 'c1' } });
  assert.notEqual(moved, old);
  assert.equal(moved.data, old.data);
  const reg = { id: 'wa:k', type: 'wtarea', position: { x: 0, y: 0 }, width: 1, height: 1, data: { wsKey: 'k', n: 3, working: 1, keys: ['a', 'b'] } };
  assert.equal(reuseNode(reg, { ...reg, data: { wsKey: 'k', n: 3, working: 1, keys: ['a', 'b'] } }), reg, '배열 값이 같으면 같은 객체');
  const done = reuseNode(reg, { ...reg, data: { ...reg.data, working: 0 } }); // 작업 완료: 영역의 일하는 수가 바뀐다
  assert.notEqual(done, reg);
  assert.equal(done.data.working, 0);
  // 끄는 중인 노드의 data만 견준다
  assert.equal(reuseNode({ ...reg, dragging: true }, { data: { ...reg.data } }).dragging, true);
  assert.ok(sameFields(old, { position: { x: 0, y: 0 } }));
  assert.ok(!sameFields(null, {}));
  assert.ok(shallowSame([1, 2], [1, 2]) && !shallowSame([1], [1, 2]));
});

test('노드 목록: 원소가 모두 같은 객체면 옛 배열을 그대로 쓴다(sameList)', () => {
  const a = { id: 'a' }, b = { id: 'b' };
  assert.ok(sameList([a, b], [a, b]));
  assert.ok(!sameList([a, b], [a, { ...b }]));
  assert.ok(!sameList([a], [a, b]));
});

test('판(Canvas.jsx): 세션 노드는 sessionNode로 만들고, 바뀐 노드가 없으면 옛 배열, 선도 값이 같으면 다시 쓴다', () => {
  const src = read('Canvas.jsx');
  assert.match(src, /sess\.push\(sessionNode\(old, id, r, p, d\)\)/);
  assert.ok(!/data: \{\}, zIndex/.test(src), '세션 노드마다 새 data 객체를 만들지 않는다');
  assert.match(src, /return same \? prev : next;/);
  assert.match(src, /reuseNode\(o, n\)/, '영역·분할선 등 배경 노드도 다시 쓴다');
  assert.match(src, /sameList\(edgesRef\.current, next\)/);
  // 고른 워크스페이스(P86 단계 4)와 세션·덩어리·배치가 바뀌면 다시 만든다
  assert.match(src, /\}, \[storeNodes, sessions, docks, links, workspaces, wsGroups, memos, kanbans, convoNodes, rev, currentWs\]\);/);
  // 세션 값(상태·작업 완료·거리 단계)은 노드 안에서 구독한다: 노드 객체가 같아도 그 세션이 바뀌면 그 노드만 다시 그린다
  const sn = read('SessionNode.jsx');
  assert.match(sn, /const s = useStore\(\(st\) => st\.sessions\.get\(id\)\);/);
  assert.match(sn, /const dist = useFlowStore\(/);
  assert.match(sn, /export const SessionNode = memo\(SessionNodeInner\);/);
});

test('대화 노드: 멀리 얼굴은 배율을 구독하지 않고 CSS(--inv)로 글자 크기, 감싸개 --inv는 계단, 먼 노드는 얼굴 없이', () => {
  const src = read('ConvoNode.jsx');
  const far = src.slice(src.indexOf('function FarFace'), src.indexOf('function IconFace'));
  assert.ok(!/useFlowStore|transform\[2\]|zoom/.test(far), '멀리 얼굴에 배율 구독이 없다');
  assert.match(far, /farFont\(12, /);
  assert.match(src, /useInvRef\(0\.02, id, true\)/, '대화 카드 --inv는 계단 값');
  assert.ok(!/zoomSel/.test(src));
  assert.match(src, /if \(awayFromView\(st, id, AWAY_PAD\)\) return 'away';/, '먼 노드는 away 하나로 구독(배율 경계를 넘어도 다시 그리지 않음)');
  assert.match(src, /\{!away && face === 'far' && <FarFace/);
  // farFont: 글자 크기 = min(n px × --inv, 노드 크기 상한)
  const m = /export const farFont = \(n, cap\) => `(.*)`;/.exec(src);
  assert.ok(m);
  const farFont = (n, cap) => `min(calc(${n}px * var(--inv, 1)), ${+cap.toFixed(2)}px)`;
  assert.equal(farFont(12, 40), 'min(calc(12px * var(--inv, 1)), 40px)');
  assert.equal(farFont(14, 1080 * 0.2), 'min(calc(14px * var(--inv, 1)), 216px)');
  // 움직이는 동안 그림자를 뺀다(고른 테두리는 남긴다)
  const css = noComments(read('styles.css'));
  assert.match(css, /html\[data-board-moving="1"\] \.mt-cv \{ box-shadow: none; \}/);
  assert.match(css, /html\[data-board-moving="1"\] \.mt-cv\.selected \{ box-shadow: 0 0 0 calc\(2px \* var\(--inv, 1\)\) var\(--info\); \}/);
});

test('성능 기록 요약: 프레임 간격 통계, 긴 애니메이션 프레임, 화면 안 노드 수, 배율', () => {
  const s = statOf([7, 7, 7, 8, 40, 60, 7, 7, 7, 7]);
  assert.equal(s.n, 10);
  assert.equal(s.p50, 7);
  assert.equal(s.max, 60);
  assert.equal(s.over33, 2);
  assert.equal(s.over50, 1);
  assert.deepEqual(statOf([]), { n: 0 });
  const l = loafOf([{ duration: 80, blockingDuration: 30, startTime: 100, styleAndLayoutStart: 160, scripts: [{ duration: 20 }, { duration: 5 }] }, { duration: 60, blockingDuration: 10, startTime: 300, styleAndLayoutStart: 0 }]);
  assert.deepEqual(l, { n: 2, ms: 140, blockingMs: 40, styleLayoutMs: 20, scriptMs: 25 });
  assert.deepEqual(longTasksOf([{ duration: 55 }, { duration: 70.123 }]), { n: 2, ms: 125.12 });
  assert.equal(zoomOfTransform('translate(10px, 20px) scale(0.2834)'), 0.2834);
  assert.equal(zoomOfTransform(''), null);
  const view = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.equal(visibleCount([{ left: 10, top: 10, right: 20, bottom: 20, width: 10, height: 10 }, { left: 200, top: 0, right: 220, bottom: 10, width: 20, height: 10 }], view), 1);
  const sum = summarize({ sec: 30, gaps: [7, 8], wheel: [12], longTasks: [], loafs: [], renders: { session: 3 }, rebuild: { n: 1, same: 0, changed: 1 }, nodes: { total: 5 }, view: { zoom: 0.3 }, reason: 'tick' });
  assert.equal(sum.frames.n, 2);
  assert.equal(sum.wheel.p50, 12);
  assert.equal(sum.renders.session, 3);
  assert.equal(sum.reason, 'tick');
  // 요약에는 글(이름·화면 글)이 없다: 숫자와 정한 낱말만
  const strings = JSON.stringify(sum).match(/"[^"]*"/g).filter((x, i, a) => a.indexOf(x) === i);
  for (const x of strings) assert.match(x, /^"[A-Za-z0-9]+"$/, x);
});

test('성능 기록 스위치: 꺼져 있으면 rAF·관찰자·사건 처리기가 없고 렌더 세기는 불 값 하나만 본다', () => {
  const src = read('perf-trace.js');
  const top = src.slice(0, src.indexOf('export function startTrace'));
  // 모듈을 읽을 때 rAF·관찰자·사건 처리기를 걸지 않는다(켤 때 startTrace가 건다)
  const loadTime = top.replace(/function [^]*?\n\}/g, '').replace(/const \w+ = \([^)]*\) => \{[^\n]*\};/g, '');
  assert.ok(!/requestAnimationFrame\(|addEventListener\(|new PerformanceObserver/.test(loadTime));
  assert.match(src, /export function countRender\(kind\) \{ if \(traceFlag\.on && c\)/);
  assert.match(src, /export function noteRebuild\(prev, next, same\) \{\r?\n  if \(!traceFlag\.on \|\| !c\) return;/);
  assert.match(src, /api\.call\('perf\.report', sum\)/);
  // 설정 화면에 스위치 줄, 두 사전에 글
  assert.match(read('Settings.jsx'), /'perfTrace' in settings && <PerfTraceSetting/);
  for (const f of ['locales/en.js', 'locales/ko.js']) assert.match(read(f), /perfTrace: \{\r?\n    name: /);
  assert.match(read('main.jsx'), /watchPerfTrace\(\);/);
});
