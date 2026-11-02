import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ResourceMonitor } from '../src/resources.mjs';
import { parsePs } from '../src/processes.mjs';

test('중지한 자원 감시기의 최초 예약 작업도 취소한다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let samples = 0;
  const r = new ResourceMonitor({ intervalMs: 30000 }); r.sample = async () => { samples++; };
  r.start(() => {}); r.stop(); t.mock.timers.tick(4000);
  assert.equal(samples, 0);
});

test('공백이 있는 실행 경로와 명령 인자를 ps에서 혼동하지 않는다', () => {
  const rows = ' 12 1 2048 /Applications/My Agent.app/Contents/MacOS/claude\n';
  const commands = ' 12 /Applications/My Agent.app/Contents/MacOS/claude --session-id test\n';
  const p = parsePs(rows, commands).get(12);
  assert.equal(p.name, 'claude');
  assert.equal(p.cmd, '/Applications/My Agent.app/Contents/MacOS/claude --session-id test');
});

test('에이전트 없는 셸도 메모리를 측정한다', async () => {
  const procs = new Map([[42, { pid: 42, ppid: 1, ws: 1048576, name: 'zsh' }]]);
  const r = new ResourceMonitor({ sessions: () => [{ sessionId: 's', paneId: 'w1:p1', present: false, state: 'shell_idle' }], processInfo: async () => ({ shell_pid: 42 }), controllers: () => [], herdrServerPid: () => null, readTable: async () => ({ procs, herdr: [] }) });
  assert.equal((await r.sample()).sessions[0].memMB, 1);
});

test('Node 실행 파일이 없으면 백엔드 시작 Promise를 거부하고 프로세스를 죽이지 않는다', { timeout: 5000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-launch-'));
  const url = new URL('../src/client.mjs', import.meta.url).href;
  const script = `import { startBackend } from ${JSON.stringify(url)};
    const cfg = { backendFile: ${JSON.stringify(path.join(dir, 'backend.json'))}, logDir: ${JSON.stringify(dir)}, profile: 'dev', herdrSession: 'atrium-dev-fixture', port: 1, dataDir: ${JSON.stringify(dir)} };
    try { await startBackend(cfg, { nodePath: ${JSON.stringify(path.join(dir, 'missing-node'))} }); process.exitCode=2; }
    catch(e) { console.log('HANDLED ' + e.message); }`;
  try {
    const result = await new Promise((resolve) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', script]); let out = '', err = '';
      p.stdout.on('data', (x) => { out += x; }); p.stderr.on('data', (x) => { err += x; });
      p.on('exit', (code) => resolve({ code, out, err }));
    });
    assert.equal(result.code, 0, result.err); assert.match(result.out, /HANDLED.*missing-node/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
