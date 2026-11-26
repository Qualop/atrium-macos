// P278 단위 시험: 캔버스에서 사이드바 폴더(가상 그룹) 머리를 누르면 그 폴더의 영역 묶음으로 간다.
// - 폴더 줄(buildRows의 g = groupLayout { id, name, workspaces })에서 판에 있는 구성 워크스페이스 키를 얻는다(전에는 g.members를 읽어 늘 비었다)
// - 맞춤 사각형: 영역 여럿 = 묶음 테두리·이름표까지, 하나 = 그 영역, 없음 = null
// - 접기·펴기는 화살표 단추만, 이름·빈 곳 누르기는 이동(줄 onClick)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows, groupKeys } from '../src/renderer/lib/sidebar-tree.js';
import { fitRectOf, groupFrameOf, bbox } from '../../backend/src/canvas.mjs';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

const WS = [
  { key: 'd:/work/a', name: 'a', root: 'D:/work/a', kind: 'repo' },
  { key: 'd:/work/b', name: 'b', root: 'D:/work/b', kind: 'repo' },
  { key: 'd:/work/c', name: 'c', root: 'D:/work/c', kind: 'folder' },
  { key: 'd:/work/d', name: 'd', root: 'D:/work/d', kind: 'folder' },
];
const GROUPS = [
  { id: 'g1', name: 'Market', members: ['d:/work/b', 'd:/work/a', 'd:/gone/x'] },
  { id: 'g2', name: 'Empty', members: ['d:/gone/y'] },
];
const rowsOf = (opts = {}) => buildRows({ workspaces: WS, groups: GROUPS, sessions: [], ...opts }).rows;
const groupRow = (rows, id) => rows.find((r) => r.type === 'group' && (id === null ? r.none : r.g.id === id));

test('폴더 줄 → 판에 있는 구성 워크스페이스(폴더 안 순서)', () => {
  const rows = rowsOf();
  const g1 = groupRow(rows, 'g1');
  assert.equal(g1.g.members, undefined, '줄의 g에는 members가 없다(그래서 전에는 늘 비었다)');
  assert.deepEqual(groupKeys(g1, WS, GROUPS), ['d:/work/b', 'd:/work/a']);
});

test('접힌 폴더 줄도 같다', () => {
  const g1 = groupRow(rowsOf({ collapsed: { 'g:g1': true } }), 'g1');
  assert.equal(g1.open, false);
  assert.deepEqual(groupKeys(g1, WS, GROUPS), ['d:/work/b', 'd:/work/a']);
});

test('그룹 없음 줄 → 어느 폴더에도 없는 워크스페이스 전부', () => {
  assert.deepEqual(groupKeys(groupRow(rowsOf(), null), WS, GROUPS), ['d:/work/c', 'd:/work/d']);
});

test('판에 구성 워크스페이스가 없는 폴더 → 빈 목록(아무것도 하지 않는다)', () => {
  assert.deepEqual(groupKeys(groupRow(rowsOf(), 'g2'), WS, GROUPS), []);
  assert.deepEqual(groupKeys(null, WS, GROUPS), []);
});

test('members만 있는 g(옛 모양)와 id만 있는 g도 받는다', () => {
  assert.deepEqual(groupKeys({ type: 'group', g: { id: 'g1', members: ['d:/work/a', 'd:/gone/x'] } }, WS, GROUPS), ['d:/work/a']);
  assert.deepEqual(groupKeys({ type: 'group', g: { id: 'g1' } }, WS, GROUPS), ['d:/work/b', 'd:/work/a']);
});

test('맞춤 사각형: 여럿 = 묶음 테두리, 하나 = 그 영역, 없음 = null', () => {
  const a = { x: 0, y: 0, w: 400, h: 300 }, b = { x: 500, y: 100, w: 300, h: 300 };
  assert.deepEqual(fitRectOf([a, b]), groupFrameOf(bbox([a, b])));
  const f = fitRectOf([a, b]);
  assert.ok(f.x < 0 && f.y < 0 && f.x + f.w > 800 && f.y + f.h > 400, '두 영역을 다 담고 이름표 자리까지');
  assert.deepEqual(fitRectOf([a, null]), a, '판에 영역이 하나만 있으면 테두리 없이 그 영역');
  assert.equal(fitRectOf([null, null]), null);
  assert.equal(fitRectOf([]), null);
});

test('사이드바: 폴더 이름·빈 곳 = 이동, 화살표 = 접기(따로)', () => {
  const src = read('Sidebar.jsx');
  const row = src.slice(src.indexOf('function GroupRow'), src.indexOf('function WsRow'));
  assert.match(row, /onClick=\{\(\) => \{ setCursor\(r\.id\); if \(!renaming\) focusGroup\(r\); \}\}/, '줄을 누르면 focusGroup');
  assert.match(row, /<Fold [^>]*onToggle=\{\(\) => \{ setCursor\(r\.id\); toggleFold\(r\.id\); \}\}/, '접기는 화살표의 onToggle');
  const fold = src.slice(src.indexOf('const Fold = '), src.indexOf('function focusSession'));
  assert.match(fold, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onToggle\(\); \}\}/, '화살표 누르기는 줄로 번지지 않는다(이동하지 않는다)');
  const fg = src.slice(src.indexOf('function focusGroup'), src.indexOf('function sessionTitle'));
  assert.match(fg, /mapFocus\.group/, '세션 맵이 열려 있으면 세션 맵 쪽 이동');
  assert.match(fg, /groupKeys\(r, st\.workspaces, st\.groups\)/);
  assert.match(fg, /selectGroup\(keys/);
});

test('캔버스: 묶음 맞춤은 fitRectOf로 navigateToRect', () => {
  const src = read('Canvas.jsx');
  assert.match(src, /st\.fitWorkspaces = \(keys\) => \{ const r = fitRectOf\(keys\.map\(repoRect\)\); if \(r\) st\.navigateToRect\(r\); \}/);
});
