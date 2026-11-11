import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backend } from '../src/backend.mjs';
import { loadConfig } from '../src/config.mjs';
import { startBackend } from '../src/client.mjs';
import { acquireRestartLeaseSync, releaseRestartLeaseSync } from '../src/update-lease.mjs';

test('actual backend and normal launcher honor restart exclusion before opening data or spawning', async t => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-restart-integration-')));
  const cfg = loadConfig({ argv: ['--dev'], env: { ATRIUM_PROFILE: 'dev', ATRIUM_DATA_DIR: path.join(root, 'data'), ATRIUM_HERDR_SESSION: 'atrium-dev-restart-integration', ATRIUM_PORT: '47983' } });
  const job = { cfg, targetBundle: path.join(root, 'Applications/Atrium.app'), oldBackendPid: process.pid, from: { version: '0.3.9' }, to: { version: '0.4.0' } };
  acquireRestartLeaseSync(job);
  t.after(() => { releaseRestartLeaseSync(job); fs.rmSync(root, { recursive: true, force: true }); });
  const b = new Backend(cfg);
  await assert.rejects(b.start(), { code: 'update_restarting' });
  await assert.rejects(startBackend(cfg, { nodePath: path.join(root, 'must-not-spawn') }), { code: 'update_restarting' });
  assert.equal(fs.existsSync(cfg.dbFile), false);
  assert.equal(fs.existsSync(cfg.backendFile), false);
});
