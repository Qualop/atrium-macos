// P124: 거리 단계(터미널·요약·틀)와 경계 여유, 고른 노드가 워크스페이스를 바꿈, 요약의 요청 줄, 틀의 상태 표지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tierFor, faceOfTier, pickAttached, TIER_TERM_PX, TIER_BRIEF_PX, TIER_KEEP } from '../src/renderer/lib/faces.js';
import { tierOf } from '../src/renderer/lib/overview.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, '..', 'src', 'renderer', f), 'utf8');

test('거리 단계: 240px부터 터미널, 120px부터 요약, 그 아래는 틀', () => {
  assert.equal(TIER_TERM_PX, 240);
  assert.equal(TIER_BRIEF_PX, 120);
  assert.equal(tierFor(1440 * 0.25), 'term'); // 예전 가까이 경계(360px)보다 먼 곳에서도
  assert.equal(tierFor(1440 * 0.17), 'term'); // 245px
  assert.equal(tierFor(1440 * 0.16), 'brief'); // 230px
  assert.equal(tierFor(1440 * 0.09), 'brief'); // 130px
  assert.equal(tierFor(1440 * 0.08), 'frame'); // 115px
  assert.equal(tierFor(0), 'frame');
  assert.equal(tierFor(NaN), 'frame');
});

test('경계 여유: 위 단계에 있던 노드는 경계의 88%까지 남고, 아래에서 올라갈 때는 경계를 넘어야 한다', () => {
  const t = TIER_TERM_PX, b = TIER_BRIEF_PX;
  assert.equal(tierFor(t - 1, 'term'), 'term');
  assert.equal(tierFor(t * TIER_KEEP, 'term'), 'term');
  assert.equal(tierFor(t * TIER_KEEP - 1, 'term'), 'brief');
  assert.equal(tierFor(t - 1, 'brief'), 'brief'); // 요약에서 올라가려면 240px
  assert.equal(tierFor(b - 1, 'brief'), 'brief');
  assert.equal(tierFor(b * TIER_KEEP - 1, 'brief'), 'frame');
  assert.equal(tierFor(b - 1, 'frame'), 'frame'); // 틀에서 올라가려면 120px
  assert.equal(tierFor(b * TIER_KEEP + 1, 'term'), 'brief'); // 터미널에서 크게 줄이면 요약까지 여유가 같다
  // 휠 한 칸(약 5%)으로 경계를 오가도 단계가 흔들리지 않는다
  let prev = null; const seen = [];
  for (const px of [245, 233, 245, 233, 245]) { prev = tierFor(px, prev); seen.push(prev); }
  assert.deepEqual(seen, ['term', 'term', 'term', 'term', 'term']);
});

test('얼굴: 터미널 단계는 허용된 노드만 터미널(close), 아니면 요약(far). 요약 단계는 far, 틀은 icon', () => {
  assert.equal(faceOfTier('term', true), 'close');
  assert.equal(faceOfTier('term', false), 'far');
  assert.equal(faceOfTier('brief', true), 'far');
  assert.equal(faceOfTier('brief', false), 'far');
  assert.equal(faceOfTier('frame', true), 'icon');
  assert.equal(faceOfTier('frame', false), 'icon');
});

test('터미널 붙이기도 거리 단계를 따른다(경계 여유 포함)', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, w: 1440, h: 810, ws: 'A' }];
  const screen = { width: 1920, height: 1080 };
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 0.17 }, screen, { wsLimit: { key: 'A' } }), ['a']); // 245px
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 0.16 }, screen, { wsLimit: { key: 'A' } }), []); // 230px
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 0.16 }, screen, { wsLimit: { key: 'A' }, prev: new Set(['a']) }), ['a']); // 붙은 노드는 211px까지
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 0.14 }, screen, { wsLimit: { key: 'A' }, prev: new Set(['a']) }), []);
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 0.17 }, screen, { wsLimit: { key: 'B' } }), []); // 다른 워크스페이스는 요약
});

test('고른 노드가 워크스페이스를 바꾼다: 노드를 누르거나(navigateTo) Ctrl로 고르면 viewWs가 그 노드의 워크스페이스', () => {
  const store = read('store.js');
  const fn = store.slice(store.indexOf('export function noteWorkspace'), store.indexOf('export const wsOf'));
  assert.match(fn, /\{ view = false \} = \{\}/);
  assert.match(fn, /if \(view\) state\.viewWs = key;/);
  const canvas = read('Canvas.jsx');
  const nav = canvas.slice(canvas.indexOf('st.navigateTo = (id'), canvas.indexOf('enterSession(id);', canvas.indexOf('st.navigateTo = (id')));
  assert.match(nav, /noteWorkspace\(s\.workspaceKey, \{ view: true \}\)/);
  const click = canvas.slice(canvas.indexOf('const onNodeClick'), canvas.indexOf('const onSelectionChange'));
  assert.match(click, /e\.ctrlKey \|\| e\.shiftKey \|\| e\.metaKey\) \{ const s = getState\(\)\.sessions\.get\(node\.id\); if \(s\) noteWorkspace\(s\.workspaceKey, \{ view: true \}\)/);
});

test('noteWorkspace(view): viewWs와 currentWs를 함께 바꾸고, 같으면 알리지 않는다', async () => {
  // store.js를 그대로 부를 수 없어(창 api) 함수 몸을 떼어 흉내 상태로 돌린다
  const store = read('store.js');
  const body = store.slice(store.indexOf('export function noteWorkspace'), store.indexOf('export const wsOf')).replace('export function', 'function');
  const calls = [];
  const state = { currentWs: 'A', viewWs: 'A' };
  let changes = 0;
  const f = new Function('state', 'changed', 'api', `${body}; return noteWorkspace;`)(state, () => { changes++; }, { call: (m, p) => { calls.push([m, p.workspace]); return Promise.resolve(); } });
  f('B', { view: true });
  assert.deepEqual([state.currentWs, state.viewWs, changes, calls.length], ['B', 'B', 1, 1]);
  f('B', { view: true });
  assert.equal(changes, 1); // 같으면 그대로
  f('C');
  assert.deepEqual([state.currentWs, state.viewWs], ['C', 'B']); // view 없이는 예전대로(새 세션 폴더만)
  state.currentWs = 'B'; f('B', { view: true }); // currentWs는 같고 viewWs만 다를 때도 바꾼다
  assert.equal(state.viewWs, 'B');
});

test('요약의 요청 줄: 요약·잠·터미널 기다림 얼굴과 화면 보기에 마지막 요청이 답 위에', () => {
  const node = read('SessionNode.jsx');
  const far = node.slice(node.indexOf('function FarFace'), node.indexOf('// P10: 아주 멀리서'));
  assert.ok(far.indexOf('data-role="far-prompt"') > 0 && far.indexOf('data-role="far-prompt"') < far.indexOf('data-role="far-answer"'));
  const wait = node.slice(node.indexOf('function CloseWaiting'), node.indexOf('// P28: 떠 있는 닫기 확인'));
  assert.ok(wait.indexOf('data-role="wait-prompt"') > 0 && wait.indexOf('data-role="wait-prompt"') < wait.indexOf('data-role="wait-answer"'));
  assert.match(wait, /mt-far-line one prompt/);
  const chat = read('ChatView.jsx');
  const screen = chat.slice(chat.indexOf('function ScreenView'), chat.indexOf('function ShellView'));
  assert.ok(screen.indexOf('data-role="screen-prompt"') > 0 && screen.indexOf('screen-prompt') < screen.indexOf('s.lastAnswer ?'));
});

test('틀 단계: 상태 표지는 응답 필요·작업 완료·오류·작업 중·잠듦마다 다른 모양, 쉼·끝남은 표지 없음, 글 없음', () => {
  const node = read('SessionNode.jsx');
  const frame = node.slice(node.indexOf('const FRAME_MARK'), node.indexOf('// 아주 멀리서(노드가 화면에서 160px'));
  const map = { waiting: 'ask', trust_wait: 'ask', error: 'error', working: 'work', shell_running: 'work', sleeping: 'sleep' };
  const marks = eval(`(${frame.slice(frame.indexOf('{'), frame.indexOf('};') + 1)})`);
  for (const [state, want] of Object.entries(map)) assert.equal(marks[tierOf({ state })], want, state);
  assert.equal(marks[tierOf({ state: 'ready', unseen: true })], 'done');
  assert.equal(marks[tierOf({ state: 'ready' })], undefined);
  assert.equal(marks[tierOf({ state: 'exited' })], undefined);
  assert.ok(!/mt-icon-name|\{s\.name\}<\/span>/.test(frame), '틀에는 이름 글이 없다');
  const css = read('styles.css');
  for (const m of ['ask', 'done', 'error', 'work', 'sleep']) assert.match(css, new RegExp(`\\.mt-frame-mark\\[data-mark="${m}"\\]`));
});

test('사용자 보고(부모 곁에 붙은 하위 세션): 초점·고른 노드와 같은 덩어리, 부모·자식은 터미널을 가질 수 있다', async () => {
  const { matesOf, termAllowed } = await import('../src/renderer/lib/faces.js');
  const parent = { child: 'lead', w2: 'lead' };
  const pOf = (id) => parent[id] || null;
  const docks = [{ members: ['lead', 'child'] }, { members: ['x', 'y'] }];
  const ids = ['lead', 'child', 'w2', 'x', 'y', 'z'];
  assert.deepEqual([...matesOf({ seeds: ['child'], docks, parentOf: pOf, ids })].sort(), ['lead']); // 덩어리 짝이자 부모
  assert.deepEqual([...matesOf({ seeds: ['lead'], docks, parentOf: pOf, ids })].sort(), ['child', 'w2']); // 덩어리 짝, 자식들
  assert.deepEqual([...matesOf({ seeds: ['x'], docks, parentOf: pOf, ids })], ['y']);
  assert.equal(matesOf({ seeds: [null], docks, parentOf: pOf, ids }).size, 0);
  assert.equal(matesOf({ seeds: ['z'], docks, parentOf: pOf, ids }).size, 0);
  // 다른 워크스페이스를 고른 상태에서도 짝은 터미널을 가질 수 있다
  assert.equal(termAllowed({ id: 'lead', ws: 'A', viewWs: 'B', focus: 'child', mates: new Set(['lead']) }), true);
  assert.equal(termAllowed({ id: 'lead', ws: 'A', viewWs: 'B', focus: 'child' }), false);
});

test('부모가 화면에 조금만 걸쳐도(보이는 넓이와 상관없이) 초점 하위 세션의 짝이면 터미널, 상한 안에서는 초점 다음 순서', () => {
  const screen = { width: 1920, height: 1080 };
  // 큰 부모(1920×1080)와 오른쪽에 붙은 작은 자식(1040×585). 자식을 가운데에 배율 1로: 부모는 왼쪽에 일부만 보인다
  const nodes = [{ id: 'lead', x: 0, y: 0, w: 1920, h: 1080, ws: 'A' }, { id: 'child', x: 1920, y: 0, w: 1040, h: 585, ws: 'A' }, ...Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, x: 1920 + (i % 4) * 300, y: 700 + Math.floor(i / 4) * 200, w: 280, h: 160, ws: 'B' }))];
  const vp = { x: 960 - (1920 + 520), y: 540 - 292, zoom: 1 };
  const got = pickAttached(nodes, vp, screen, { wsLimit: { key: 'B' }, focus: 'child', mates: new Set(['lead']), max: 3 });
  assert.deepEqual(got.slice(0, 2), ['child', 'lead']);
  const without = pickAttached(nodes, vp, screen, { wsLimit: { key: 'B' }, focus: 'child', max: 3 });
  assert.ok(!without.includes('lead'));
});
