import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationMatches, macUpdateText } from '../src/renderer/lib/update-macos.js';
test('confirmation is bound to the selected release and channel', () => {
  const view = { latest: { tag: 'v0.5.0' } }, asking = { tag: 'v0.5.0', channel: 'stable' };
  assert.equal(confirmationMatches(asking, view, 'stable'), true);
  assert.equal(confirmationMatches(asking, view, 'dev'), false);
  assert.equal(confirmationMatches(asking, { latest: { tag: 'v0.6.0' } }, 'stable'), false);
  assert.equal(confirmationMatches(null, view, 'stable'), false);
});
test('English and Korean copy covers bundle progress, source route and health recovery', () => {
  for (const language of ['en', 'ko']) for (const key of ['manual', 'source_install', 'dev_profile', 'move_to_applications', 'bundle_not_writable', 'no_bundle_asset', 'data_in_bundle', 'note', 'confirm', 'stale', 'download', 'checksum', 'extract', 'verify', 'ready', 'recovery']) assert.ok(macUpdateText(language, key), `${language}.${key}`);
  assert.match(macUpdateText('en', 'note'), /SHA256/); assert.match(macUpdateText('ko', 'note'), /복원/);
});
