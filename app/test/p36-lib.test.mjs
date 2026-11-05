// P36: large mission trees remain readable; this port retains the worker limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { missionLayout, MISSION } from '../src/renderer/lib/mission-layout.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('미션 맵: 하위 세션 32개와 8단계 사슬이 겹치지 않고, 단계마다 한 열씩 오른쪽, 부모는 자식 가운데', () => {
  const nodes = [{ id: 'h', kind: 'human', name: '사람' }, { id: 'lead', kind: 'session', name: 'lead' }];
  const edges = [{ from: 'h', to: 'lead', kind: 'bar', count: 1 }];
  for (let i = 1; i <= 32; i++) nodes.push({ id: `w${i}`, kind: 'session', name: `w${String(i).padStart(2, '0')}`, parentId: 'lead', role: '워커', depth: 2 });
  let p = 'lead';
  for (let d = 2; d <= 8; d++) { nodes.push({ id: `d${d}`, kind: 'session', name: `zz${d}`, parentId: p, role: '워커', depth: d }); p = `d${d}`; }
  const L = missionLayout({ nodes, edges });
  const boxes = [...L.boxes.values()];
  assert.equal(boxes.length, nodes.length);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!ov(boxes[i], boxes[j]), `${boxes[i].node.id} ${boxes[j].node.id}`);
  const col = (id) => L.boxes.get(id).depth;
  assert.equal(col('lead'), 1); assert.equal(col('w1'), 2); assert.equal(col('d8'), 8);
  assert.equal(L.columns, 9);
  for (let d = 3; d <= 8; d++) assert.ok(L.boxes.get(`d${d}`).x > L.boxes.get(`d${d - 1}`).x);
  // 형제는 위아래 한 줄씩, lead는 첫째와 끝 자식의 가운데
  const ys = Array.from({ length: 32 }, (_, i) => L.boxes.get(`w${i + 1}`).y);
  assert.equal(new Set(ys).size, 32);
  const kidsY = [...ys, L.boxes.get('d2').y];
  assert.equal(L.boxes.get('lead').y, (Math.min(...kidsY) + Math.max(...kidsY)) / 2);
  assert.ok(L.width >= 9 * MISSION.boxW);
  // 나무 선은 모두 있다
  assert.equal(L.edges.filter((e) => e.tree).length, 1 + 32 + 7);
});

test('macOS port keeps worker limits and refusal reasons (explicit P36 exception)', () => {
  for (const d of [en, ko]) {
    for (const key of ['branchMaxChildren', 'branchMaxDepth', 'branchMaxTotal']) assert.equal(typeof d.branch.key[key], 'string');
    assert.equal(typeof d.branch.range, 'string'); assert.equal(typeof d.branch.settingsHelp, 'string');
    assert.deepEqual(Object.keys(d.branch.refusedCode).sort(), ['too_many_children', 'too_deep', 'board_full', 'not_parent'].sort());
    assert.equal(typeof d.settings.tab.branch, 'string');
  }
});
