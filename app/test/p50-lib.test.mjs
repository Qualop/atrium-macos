// P50 단위 시험(#6): 메모 편집을 열 화면(lib/memo-edit.js), 빈 판 안내(lib/empty-board.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoEditView, memoFar, MEMO_FAR_PX, MEMO_EDIT_PX } from '../src/renderer/lib/memo-edit.js';
import { boardEmpty } from '../src/renderer/lib/empty-board.js';

const screen = { width: 1584, height: 921 };
const memo = { x: 1000, y: 500, w: 360, h: 240 };

test('먼 얼굴 경계: 화면 너비 220px 아래', () => {
  assert.equal(memoFar(360, 0.3), true);
  assert.equal(memoFar(360, MEMO_FAR_PX / 360), false);
});

test('전체 보기 배율(먼 얼굴)에서 편집을 열면 화면을 그 메모로 옮기고 편집할 수 있는 크기로', () => {
  const v = memoEditView({ memo, viewport: { x: 0, y: 0, zoom: 0.3 }, screen });
  assert.deepEqual([v.cx, v.cy], [1180, 620]);
  assert.ok(!memoFar(memo.w, v.zoom) && memo.w * v.zoom >= MEMO_EDIT_PX - 0.01 && v.zoom <= 1, JSON.stringify(v));
});

test('이미 편집할 수 있게 다 보이면 화면은 그대로(null)', () => {
  // 배율 1, 메모가 화면 안
  assert.equal(memoEditView({ memo, viewport: { x: -800, y: -300, zoom: 1 }, screen }), null);
  // 배율은 되지만 화면 밖이면 옮긴다(배율은 그대로)
  const v = memoEditView({ memo: { ...memo, w: 600 }, viewport: { x: 2000, y: 0, zoom: 0.8 }, screen });
  assert.equal(v.zoom, 0.8);
});

test('큰 메모는 화면에 들어오게 줄이고, 배율 상한은 1', () => {
  const big = { x: 0, y: 0, w: 3000, h: 2000 };
  const v = memoEditView({ memo: big, viewport: { x: 0, y: 0, zoom: 0.05 }, screen });
  assert.ok(big.w * v.zoom <= screen.width && big.h * v.zoom <= screen.height && !memoFar(big.w, v.zoom), JSON.stringify(v));
  const small = { x: 0, y: 0, w: 120, h: 80 };
  assert.equal(memoEditView({ memo: small, viewport: { x: 0, y: 0, zoom: 0.2 }, screen }).zoom, 1);
});

test('빈 판 안내: 판을 읽었고 아무것도 없을 때만', () => {
  const none = { loaded: true, workspaces: [], sessions: new Map(), memos: new Map(), kanbans: new Map(), convoNodes: new Map() };
  assert.equal(boardEmpty(none), true);
  assert.equal(boardEmpty({ ...none, loaded: false }), false, '읽기 전에는 보이지 않는다');
  assert.equal(boardEmpty({ ...none, workspaces: [{ key: 'w' }] }), false);
  assert.equal(boardEmpty({ ...none, sessions: new Map([['s', {}]]) }), false);
  assert.equal(boardEmpty({ ...none, memos: new Map([['m', {}]]) }), false);
});
