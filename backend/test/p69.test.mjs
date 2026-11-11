// Source/archive updater tests were replaced by macos-update.test.mjs.
// Keep the release policy contract independently covered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease } from '../../scripts/release-check.mjs';

test('릴리즈 확인: main이 dev와 같고, 두 version이 태그와 같고, 태그가 main을 가리켜야 한다', () => {
  const ok = { tag: 'v0.2.0', main: 'a'.repeat(40), dev: 'a'.repeat(40), tagCommit: null, appVersion: '0.2.0', backendVersion: '0.2.0' };
  assert.deepEqual(checkRelease(ok), []);
  assert.deepEqual(checkRelease({ ...ok, tagCommit: 'a'.repeat(40) }), []);
  assert.match(checkRelease({ ...ok, dev: 'b'.repeat(40) }).join(), /fast-forward/);
  assert.match(checkRelease({ ...ok, appVersion: '0.1.9' }).join(), /app\/package\.json/);
  assert.match(checkRelease({ ...ok, backendVersion: '0.1.9' }).join(), /backend\/package\.json/);
  assert.match(checkRelease({ ...ok, tagCommit: 'c'.repeat(40) }).join(), /main이 아닌 커밋/);
  assert.match(checkRelease({ ...ok, tag: 'v0.2.0-rc.1' }).join(), /사전 릴리즈/);
  assert.match(checkRelease({ ...ok, dev: null }).join(), /dev 브랜치가 없습니다/);
});
