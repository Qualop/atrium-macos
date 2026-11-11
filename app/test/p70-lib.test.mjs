// P70 단위 시험(창): 업데이트 채널 값, dev 빌드 버전 보이기, 두 사전의 채널 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelOf, versionLabel, vTag, noticesFor } from '../src/renderer/lib/update-notice.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

test('채널 값: dev가 아니면 정식', () => {
  assert.equal(channelOf('dev'), 'dev');
  assert.equal(channelOf('stable'), 'stable');
  assert.equal(channelOf(undefined), 'stable');
  assert.equal(channelOf('beta'), 'stable');
});

test('버전 보이기: dev 빌드면 (dev)를 붙인다', () => {
  assert.equal(versionLabel('0.1.2-dev.1'), 'v0.1.2-dev.1 (dev)');
  assert.equal(versionLabel('v0.1.2-dev.12'), 'v0.1.2-dev.12 (dev)');
  assert.equal(versionLabel('0.1.1'), 'v0.1.1');
  assert.equal(versionLabel('v0.2.0-rc.1'), 'v0.2.0-rc.1');
  assert.equal(versionLabel(''), '');
  assert.equal(versionLabel(null), '');
  // 문장 안(최신 버전입니다 등)에는 (dev) 없이 v 하나만
  assert.equal(vTag('0.1.2-dev.1'), 'v0.1.2-dev.1');
  assert.equal(vTag('v0.1.1'), 'v0.1.1');
  assert.equal(vTag(''), '');
});

test('새 버전 알림은 채널과 상관없이 태그마다 한 번(dev 빌드도)', () => {
  const view = { available: true, latest: { tag: 'v0.1.2-dev.1' }, channel: 'dev' };
  assert.deepEqual(noticesFor(view).map((n) => n.key), ['v0.1.2-dev.1']);
  assert.deepEqual(noticesFor(view, { toasted: 'v0.1.2-dev.1' }), []);
  assert.deepEqual(noticesFor({ ...view, latest: { tag: 'v0.1.2-dev.2' } }, { toasted: 'v0.1.2-dev.1' }).map((n) => n.key), ['v0.1.2-dev.2']);
});

test('두 사전: 채널 글이 다 있고, 최신 버전 글은 버전에 v를 붙이지 않는다(vTag가 붙인다)', () => {
  for (const d of [en, ko]) {
    const u = d.update;
    for (const k of ['channelName', 'channelStableHint', 'channelDevHint', 'channelStableFromDev']) assert.ok(typeof u[k] === 'string' && u[k].length > 3, k);
    assert.ok(u.channel.stable && u.channel.dev);
    assert.ok(u.upToDate.includes('{version}') && !u.upToDate.includes('v{version}'));
  }
  assert.match(ko.update.channelDevHint, /dev 브랜치/);
});
