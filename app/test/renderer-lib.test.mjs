// 창 쪽 순수 규칙의 단위 시험: 붙여넣기 감싸기, 휠 변환, 키 처리(E4, ARCH 7.2), 얼굴과 제어기 고르기, WebGL 예산(BRIEF 위험 2), 내 차례 순서
import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapPaste, wheelToSgr, keyAction, frameBytes, PASTE_START, PASTE_END } from '../src/renderer/lib/term-input.js';
import { faceFor, pickAttached, RendererBudget, inboxOf, nextTarget } from '../src/renderer/lib/faces.js';
import { deliveryText, askLine } from '../src/renderer/lib/labels.js';
import { setLanguage } from '../src/renderer/lib/i18n.js'; // P16: 한국어 글을 보는 시험은 언어를 정한다

test('E4: 붙여넣기는 괄호 붙여넣기로 감싸고 줄바꿈은 CR로', () => {
  assert.equal(wrapPaste('a\r\nb\nc'), `${PASTE_START}a\rb\rc${PASTE_END}`);
  assert.equal(wrapPaste('한글 한 줄'), `${PASTE_START}한글 한 줄${PASTE_END}`);
  assert.equal(wrapPaste(`x\x1b[201~y`), `${PASTE_START}xy${PASTE_END}`); // 감싸기를 깨지 못한다
  assert.equal(wrapPaste(''), '');
});

test('E4: 휠은 SGR 마우스 시퀀스로, 칸 위치는 화면 비율로(판 배율과 상관없이)', () => {
  const rect = { left: 100, top: 50, width: 500, height: 300 }; // 배율 0.5로 그려진 1000x600 터미널
  const up = wheelToSgr({ deltaY: -100, clientX: 350, clientY: 200, rect, cols: 100, rows: 30 });
  assert.equal(up.seq, '\x1b[<64;51;16M');
  const down = wheelToSgr({ deltaY: 300, clientX: 100, clientY: 50, rect, cols: 100, rows: 30 });
  assert.equal(down.seq, '\x1b[<65;1;1M'.repeat(3));
  const small = wheelToSgr({ deltaY: 40, clientX: 100, clientY: 50, rect, cols: 100, rows: 30 });
  assert.equal(small.seq, '');
  const more = wheelToSgr({ deltaY: 70, clientX: 100, clientY: 50, rect, cols: 100, rows: 30, acc: small.acc });
  assert.equal(more.seq, '\x1b[<65;1;1M');
  assert.equal(wheelToSgr({ deltaY: 3000, clientX: 999, clientY: 999, rect, cols: 100, rows: 30 }).seq, '\x1b[<65;100;30M'.repeat(5));
  assert.equal(wheelToSgr({ deltaY: -2, deltaMode: 1, clientX: 100, clientY: 50, rect, cols: 100, rows: 30 }).seq, '\x1b[<64;1;1M'.repeat(2));
});

test('E9: ctrl+g는 막고, ctrl+v는 붙여넣기 이벤트로, 고른 글이 있을 때 ctrl+c는 복사', () => {
  const k = (key, o = {}) => ({ type: 'keydown', key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(keyAction(k('g', { ctrlKey: true }), false), 'block-ctrl-g');
  assert.equal(keyAction(k('v', { ctrlKey: true }), false), 'paste');
  assert.equal(keyAction(k('Insert', { shiftKey: true }), false), 'paste');
  assert.equal(keyAction(k('c', { ctrlKey: true }), false), 'pass'); // 고른 글이 없으면 ^C(중단)
  assert.equal(keyAction(k('c', { ctrlKey: true }), true), 'copy');
  assert.equal(keyAction(k('a'), false), 'pass');
  assert.equal(keyAction({ ...k('g', { ctrlKey: true }), type: 'keyup' }, false), 'pass');
});

test('프레임 base64를 UTF-8 바이트로', () => {
  const b = frameBytes(Buffer.from('한글 ✅', 'utf8').toString('base64'));
  assert.equal(Buffer.from(b).toString('utf8'), '한글 ✅');
});

test('9.2: 얼굴은 노드의 화면 너비로 정한다', () => {
  assert.equal(faceFor(720, 1), 'close');
  assert.equal(faceFor(720, 0.5), 'close');
  assert.equal(faceFor(720, 0.4), 'middle');
  assert.equal(faceFor(720, 0.2), 'far');
});

test('9.4: 제어기는 가까이 얼굴이면서 보이는 노드에만, 화면 가운데에 가까운 순서로 상한까지', () => {
  const nodes = [];
  for (let i = 0; i < 12; i++) nodes.push({ id: `n${i}`, x: (i % 4) * 760, y: Math.floor(i / 4) * 500, w: 720, h: 460 });
  const screen = { width: 1600, height: 900 };
  const all = pickAttached(nodes, { x: 0, y: 0, zoom: 0.5 }, screen, { max: 8 });
  assert.equal(all.length, 8);
  assert.equal(pickAttached(nodes, { x: 0, y: 0, zoom: 0.5 }, screen, { max: 20 }).length, 12);
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 0.3 }, screen), []); // 중간 얼굴에는 붙이지 않는다
  const near = pickAttached(nodes, { x: 0, y: 0, zoom: 1 }, screen, { max: 20, margin: 0 });
  assert.equal(near[0], 'n1'); // 화면 가운데(800,450)를 품은 노드
  assert.ok(!near.includes('n3')); // 화면 밖
});

test('위험 2: WebGL 예산을 넘으면 DOM, 컨텍스트를 잃으면 자리를 돌려준다', () => {
  const b = new RendererBudget(2);
  assert.equal(b.acquire('a'), 'webgl');
  assert.equal(b.acquire('b'), 'webgl');
  assert.equal(b.acquire('c'), 'dom');
  b.release('a', { contextLost: true });
  assert.equal(b.lost, 1);
  assert.equal(b.acquire('c'), 'webgl');
});

test('A1: 내 차례는 오래 기다린 순서, N은 다음으로 돈다', () => {
  const s = [
    { sessionId: 'a', state: 'ready', unseen: true, turn: { endedAt: 5 } },
    { sessionId: 'b', state: 'waiting', ask: { since: 30 } },
    { sessionId: 'c', state: 'trust_wait', createdAt: 10 },
    { sessionId: 'd', state: 'error' },
    { sessionId: 'e', state: 'exited', exit: { kind: 'normal' } },
  ];
  const ib = inboxOf(s);
  assert.deepEqual(ib.needsYou.map((x) => x.sessionId), ['c', 'b']);
  assert.deepEqual(ib.review.map((x) => x.sessionId), ['a']);
  assert.deepEqual(ib.problems.map((x) => x.sessionId), ['d']);
  assert.equal(nextTarget(['c', 'b', 'd'], null), 'c');
  assert.equal(nextTarget(['c', 'b', 'd'], 'c'), 'b');
  assert.equal(nextTarget(['c', 'b', 'd'], 'd'), 'c');
  assert.equal(nextTarget([], 'x'), null);
});

test('전달 상태와 묻는 내용 글', (tc) => {
  setLanguage('ko'); tc.after(() => setLanguage('en'));
  assert.equal(deliveryText({ status: 'queued', reason: 'waiting' }), '전송 대기 중 (사용자 응답 대기 중)');
  assert.equal(deliveryText({ status: 'confirmed' }), '제출 확인됨');
  assert.equal(deliveryText({ status: 'cancelled', reason: 'user' }), '전송 취소됨');
  assert.equal(askLine({ state: 'waiting', ask: { kind: 'permission', tool: 'Write', summary: 'Write: a.txt' } }), '권한 승인 요청: Write: a.txt');
  assert.equal(askLine({ state: 'trust_wait' }), '새 폴더를 신뢰할지 확인 필요');
});
