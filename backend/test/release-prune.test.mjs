// 오래된 dev 릴리즈 지우기(scripts/prune-dev-releases.mjs, 2026-11-07 사용자 요청): 전 정식 이하의 dev는 지우고 전과 이번 사이의 dev만 남긴다
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneDevReleases } from '../../scripts/prune-dev-releases.mjs';

const rel = (tagName, more = {}) => ({ tagName, isPrerelease: /-dev\./.test(tagName), isDraft: false, ...more });
const tags = (...a) => a.map((t) => rel(t));

test('정식 v0.1.4를 낼 때: 전(v0.1.3) 이하의 dev는 지우고 v0.1.4-dev와 그 뒤만 남긴다', () => {
  const r = pruneDevReleases(tags('v0.1.0', 'v0.1.1', 'v0.1.2', 'v0.1.3', 'v0.1.4',
    'v0.1.1-dev.1', 'v0.1.2-dev.1', 'v0.1.3-dev.1', 'v0.1.3-dev.6', 'v0.1.4-dev.1', 'v0.1.4-dev.9', 'v0.1.5-dev.1'));
  assert.deepEqual(r.stable, ['v0.1.4', 'v0.1.3']);
  assert.deepEqual(r.remove, ['v0.1.1-dev.1', 'v0.1.2-dev.1', 'v0.1.3-dev.1', 'v0.1.3-dev.6']);
  assert.deepEqual(r.keep, ['v0.1.4-dev.1', 'v0.1.4-dev.9', 'v0.1.5-dev.1']);
});

test('정식이 둘보다 적으면 지우지 않고, 버전 순서는 글자 순서가 아니다(v0.1.10 > v0.1.9)', () => {
  assert.deepEqual(pruneDevReleases(tags('v0.1.0', 'v0.1.0-dev.1')).remove, []);
  const r = pruneDevReleases(tags('v0.1.9', 'v0.1.10', 'v0.1.9-dev.2', 'v0.1.10-dev.1', 'v0.1.11-dev.1'));
  assert.deepEqual(r.stable, ['v0.1.10', 'v0.1.9']);
  assert.deepEqual(r.remove, ['v0.1.9-dev.2']);
  assert.deepEqual(r.keep, ['v0.1.10-dev.1', 'v0.1.11-dev.1']);
});

test('초안과 버전 꼴이 아닌 태그는 건드리지 않는다', () => {
  const r = pruneDevReleases([...tags('v0.1.2', 'v0.1.3', 'ux1-evidence'), rel('v0.1.2-dev.1', { isDraft: true }), rel('v0.1.0-dev.2')]);
  assert.deepEqual(r.remove, ['v0.1.0-dev.2']);
  assert.deepEqual(pruneDevReleases(null), { stable: [], remove: [], keep: [] });
});
