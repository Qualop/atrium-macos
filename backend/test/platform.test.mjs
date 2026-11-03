import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appDataDir, herdrDirectory, herdrSocket, resolvePath, canonicalPath, findExecutable } from '../src/platform.mjs';
import { predictTrustFrom, transcriptPathFor } from '../src/launch.mjs';
import { pathKey } from '../src/workspaces.mjs';
import { parsePs } from '../src/processes.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';
import { shellPromptState } from '../src/screen.mjs';
import { desktopSessionRoots, readDesktopSessions } from '../src/convos.mjs';

test('macOS 데이터와 herdr 경로는 각 도구의 규약을 따른다', () => {
  const opts = { platform: 'darwin', home: '/Users/test', env: {} };
  assert.equal(appDataDir(opts), '/Users/test/Library/Application Support');
  assert.equal(herdrDirectory('atrium-dev-test', opts), '/Users/test/.config/herdr/sessions/atrium-dev-test');
  assert.equal(herdrDirectory('test', { ...opts, env: { XDG_CONFIG_HOME: '/tmp/isolated' } }), '/tmp/isolated/herdr/sessions/test');
  assert.equal(herdrSocket('/tmp/test', 'darwin'), path.join('/tmp/test', 'herdr.sock'));
  assert.equal(herdrSocket('test', 'win32'), '\\\\.\\pipe\\' + path.join('test', 'herdr.sock'));
});

test('Windows 경로 자료와 POSIX 대소문자를 구분한다', { skip: process.platform === 'win32' }, () => {
  assert.equal(resolvePath('C:\\Work\\repo'), 'C:/Work/repo');
  assert.equal(resolvePath('//Server/Share/Repo'), '//Server/Share/Repo');
  assert.equal(pathKey('C:\\Work\\repo'), 'c:/work/repo');
  assert.notEqual(pathKey('/work/Repo'), pathKey('/work/repo'));
  assert.equal(path.basename(path.dirname(transcriptPathFor('P', '/Users/test/repo', 'id'))), '-Users-test-repo');
});

test('POSIX 신뢰 경로는 앞 슬래시와 저장소 경계를 보존한다', { skip: process.platform === 'win32' }, () => {
  const projects = { '/Users/test': { hasTrustDialogAccepted: true } };
  assert.equal(predictTrustFrom('/Users/test/plain/sub', projects).needsTrust, false);
  assert.equal(predictTrustFrom('/Users/test/repo/sub', projects, '/Users/test/repo').needsTrust, true);
  assert.equal(predictTrustFrom('/Users/test/repo', { '/users/test/repo': { hasTrustDialogAccepted: true } }).needsTrust, true);
});

test('기존 폴더의 심볼릭 링크는 같은 신뢰 경로로 판정한다', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-path-'));
  try {
    fs.mkdirSync(path.join(dir, 'real'));
    fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'alias'));
    assert.equal(canonicalPath(path.join(dir, 'alias')), canonicalPath(path.join(dir, 'real')));
    assert.equal(predictTrustFrom(path.join(dir, 'alias'), { [path.join(dir, 'real')]: { hasTrustDialogAccepted: true } }).needsTrust, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Unix ps: 프로세스 부모, RSS byte 단위, 명령줄을 보존한다', () => {
  const p = parsePs(' 12 1 2048 /usr/local/bin/herdr\n 13 12 512 /bin/zsh\n', ' 12 /usr/local/bin/herdr --session atrium-dev-test server\n 13 /bin/zsh -l\n');
  assert.equal(p.get(12).ws, 2097152);
  assert.equal(p.get(13).ppid, 12);
  assert.match(p.get(12).cmd, /--session atrium-dev-test server$/);
});

test('PATH에서 실행 권한이 있는 파일만 찾는다', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-bin-'));
  try {
    const file = path.join(dir, 'herdr'); fs.writeFileSync(file, '', { mode: 0o600 });
    assert.equal(findExecutable('herdr', { env: { PATH: dir } }), null);
    fs.chmodSync(file, 0o700);
    assert.equal(findExecutable('herdr', { env: { PATH: dir } }), file);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('재시작 중 전송 상태도 확인 기한이 지나면 끝나고 다음 메시지가 진행된다', async (t) => {
  const now = 100000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const saved = [];
  const rows = [
    { deliveryId: 'a', sessionId: 's', text: 'first', status: 'sending', createdAt: now - 5000, sentAt: null },
    { deliveryId: 'b', sessionId: 's', text: 'next', status: 'queued', createdAt: now - 4000 },
  ];
  const sent = [];
  const q = new DeliveryQueue({ store: { activeDeliveries: () => rows, updateDelivery: (id, p) => saved.push({ id, ...p }) }, cfg: { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000 }, view: () => ({ state: 'ready', agentPresent: true, herdrConnected: true }), send: async (_, text) => sent.push(text) });
  assert.equal(saved[0].sentAt, rows[0].createdAt);
  t.mock.timers.tick(30001); q.pump(); q.pump();
  await Promise.resolve();
  assert.ok(saved.some((p) => p.id === 'a' && p.status === 'unconfirmed'));
  assert.deepEqual(sent, ['next']);
});

test('zsh의 기본 % 프롬프트는 쉬는 셸로 표시한다', () => {
  assert.equal(shellPromptState('test@Mac repo % ').atPrompt, true);
});

test('Mac 데스크톱 대화 목록과 Windows 프로필 하위 목록을 모두 찾는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-desktop-'));
  try {
    const mac = path.join(dir, 'claude-code-sessions');
    const win = path.join(dir, 'profile', 'claude-code-sessions');
    for (const d of [mac, win]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(mac, 'local_test.json'), JSON.stringify({ cliSessionId: 'test-id', isArchived: false }));
    assert.deepEqual(new Set(desktopSessionRoots(dir)), new Set([mac, win]));
    assert.equal(readDesktopSessions(dir).get('test-id').archived, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
