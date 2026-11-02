import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, insert, remove, leaves, layout, moveDivider } from '../src/dock-tree.mjs';

test('고정 난수 2,000회: 붙이기·빼기·분할선 이동은 노드를 잃거나 겹치지 않는다', () => {
  let seed = 0xA731, serial = 0;
  const rand = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  let tree = 'n0';
  const expected = new Set(['n0']);
  for (let step = 0; step < 2000; step++) {
    const ids = leaves(tree), target = ids[rand(ids.length)];
    const op = rand(3);
    if (op === 0 && ids.length < 16) {
      const id = 'n' + (++serial); expected.add(id);
      tree = normalize(insert(tree, { target, side: ['top', 'bottom', 'left', 'right'][rand(4)], id }));
    } else if (op === 1 && ids.length > 1) { tree = remove(tree, target); expected.delete(target); }
    const bounds = { x: -100, y: 30, w: 1000 + rand(1800), h: 800 + rand(1000) };
    let result = layout(tree, bounds);
    if (op === 2 && result.dividers.length) {
      const d = result.dividers[rand(result.dividers.length)];
      tree = moveDivider(tree, result.outer, d.path, d.index, rand(4000) - 2000);
      result = layout(tree, result.outer);
    }
    assert.deepEqual(new Set(leaves(tree)), expected, `step ${step}`);
    assert.equal(result.rects.size, expected.size);
    const rects = [...result.rects.values()], outer = result.outer;
    assert.equal(rects.reduce((sum, r) => sum + r.w * r.h, 0), outer.w * outer.h);
    for (const [i, a] of rects.entries()) {
      assert.ok(a.w >= 240 && a.h >= 160);
      assert.ok(a.x >= outer.x && a.y >= outer.y && a.x + a.w <= outer.x + outer.w && a.y + a.h <= outer.y + outer.h);
      for (const b of rects.slice(i + 1)) assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `overlap ${step}`);
    }
  }
});
