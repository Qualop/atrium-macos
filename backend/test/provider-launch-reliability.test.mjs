import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { splitArgs, withCodexModel, modelFromArgs } from '../src/codex-args.mjs';
import { listCodexModels, normalizeModels } from '../src/codex-models.mjs';
import { parseAgyModels, validateAgyNewSessionArgs, installAgyHooks, listAgyModels } from '../src/agy.mjs';
import { writeAgySession } from '../src/agy-session.mjs';
import { writeGeminiSession, GEMINI_EVENTS } from '../src/gemini.mjs';
import { geminiModelFromArgs, withGeminiModel } from '../src/gemini-args.mjs';
import { listGeminiModels } from '../src/gemini-models.mjs';
import { findExecutable, defaultHerdrPath } from '../src/platform.mjs';
import { argvHasSettings, predictTrustFrom, writeSessionSettings } from '../src/launch.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-provider-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };

test('Codex default selection clears model; missing model values never eat another flag', () => {
  assert.deepEqual(withCodexModel('-m old --sandbox read-only', null), ['--sandbox', 'read-only']);
  assert.deepEqual(withCodexModel('--model --sandbox read-only', 'new'), ['--sandbox', 'read-only', '--model', 'new']);
  assert.equal(modelFromArgs('--model --sandbox read-only'), '');
});

test('Codex model flags after the terminator remain literal prompt text', () => {
  const args = ['--model', 'old', '--', '--model=prompt'];
  assert.equal(modelFromArgs(args), 'old');
  assert.deepEqual(withCodexModel(args, 'new'), ['--model', 'new', '--', '--model=prompt']);
});

test('Codex shell escapes and every config-model spelling round trip', () => {
  assert.deepEqual(splitArgs(String.raw`--profile work\ account -c 'title="a quote"'`), ['--profile', 'work account', '-c', 'title="a quote"']);
  for (const args of [
    ['-c', 'model = "provider/model"'], ['--config=model="provider/model"'],
    ['-cmodel="provider/model"'], ['-c=model="provider/model"'],
  ]) {
    assert.equal(modelFromArgs(args), 'provider/model');
    assert.deepEqual(withCodexModel(args, ''), []);
  }
  assert.throws(() => withCodexModel(['--profile', 'bad\0value'], 'new'), { code: 'bad_request' });
  assert.throws(() => splitArgs('trailing\\'), { code: 'bad_request' });
});

test('Antigravity rejects empty values and TSV model IDs that cannot be launched', () => {
  for (const args of ['--model=', '--model ""', '--effort=', '--project ""']) {
    assert.throws(() => validateAgyNewSessionArgs(args), { code: 'bad_request' });
  }
  assert.throws(() => parseAgyModels(`${'x'.repeat(513)}\tToo long\n`), { code: 'model_list_unrecognized' });
  assert.throws(() => parseAgyModels('valid\t \nother\tOther\n'), { code: 'model_list_unrecognized' });
});

test('Gemini grouped short model switches are replaced without losing boolean flags', () => {
  assert.equal(geminiModelFromArgs('-dmold'), 'old');
  assert.equal(geminiModelFromArgs('-dm old'), 'old');
  assert.deepEqual(withGeminiModel('-dmold --debug', 'new'), ['-d', '--debug', '--model', 'new']);
  assert.deepEqual(withGeminiModel('-sdm old', null), ['-sd']);
});

test('Gemini bundle discovery resolves config before constants and visits all active imports', async (t) => {
  const root = fixture(t), cli = path.join(root, 'node_modules/@google/gemini-cli');
  write(path.join(cli, 'package.json'), JSON.stringify({ name: '@google/gemini-cli', main: 'bundle/gemini.js' }));
  write(path.join(cli, 'bundle/gemini.js'), 'import "./definitions.js"; import "./models.js";');
  write(path.join(cli, 'bundle/definitions.js'), `// packages/core/src/config/defaultModelConfigs.ts\nexport const DEFAULT_MODEL_CONFIGS = { modelDefinitions: { [DEFAULT_GEMINI_MODEL]: { displayName: 'Named Model' }, [PREVIEW_GEMINI_MODEL]: { isVisible: false } } };`);
  write(path.join(cli, 'bundle/models.js'), `// packages/core/src/config/models.ts\nexport const DEFAULT_GEMINI_MODEL = 'fixture-pro';\nexport const PREVIEW_GEMINI_MODEL = 'fixture-hidden';`);
  const result = await listGeminiModels({ executable: null, cwd: root });
  assert.ok(result.models.some((row) => row.id === 'fixture-pro' && row.name === 'Named Model'));
  assert.ok(!result.models.some((row) => row.id === 'fixture-hidden'));
});

test('Gemini profile regeneration preserves native changes and refreshes only its bridge', (t) => {
  const dir = fixture(t), home = path.join(dir, 'home');
  const source = path.join(home, '.gemini/settings.json');
  const defaults = { model: { name: 'base' }, hooks: { enabled: false, BeforeAgent: [{ matcher: '*', hooks: [{ type: 'command', name: 'user-hook', command: 'echo user' }] }] } };
  write(source, JSON.stringify(defaults));
  const options = { dir: path.join(dir, 'sessions'), sessionId: 'fixture', userHome: home, executable: '/fixture/gemini', token: 'first', hookUrl: 'http://127.0.0.1:1/hooks/gemini' };
  const first = writeGeminiSession(options);
  const settings = JSON.parse(fs.readFileSync(first.settingsPath));
  settings.model.name = 'chosen-in-session'; settings.ui = { theme: 'local-choice' };
  fs.writeFileSync(first.settingsPath, JSON.stringify(settings));
  const second = writeGeminiSession({ ...options, token: 'second' });
  const next = JSON.parse(fs.readFileSync(second.settingsPath));
  assert.equal(next.model.name, 'chosen-in-session');
  assert.deepEqual(next.ui, settings.ui);
  assert.equal(next.hooks.enabled, false);
  assert.equal(next.hooks.BeforeAgent[0].hooks[0].name, 'user-hook');
  for (const event of GEMINI_EVENTS) assert.equal(next.hooks[event].flatMap((row) => row.hooks).filter((row) => row.name === `atrium-${event}`).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(options.dir, 'fixture.gemini-bridge.json'))).token, 'second');
  assert.equal(fs.readFileSync(source, 'utf8'), JSON.stringify(defaults));
});

test('malformed Gemini defaults are refused before creating profile artifacts', (t) => {
  const dir = fixture(t), home = path.join(dir, 'home'), sessions = path.join(dir, 'sessions');
  const source = path.join(home, '.gemini/settings.json');
  for (const content of ['null', '[]', '"text"', '{broken', '{"hooks":[]}', '{"hooks":{"BeforeAgent":"bad"}}', '{"hooks":{"Stop":[null]}}']) {
    write(source, content);
    assert.throws(() => writeGeminiSession({ dir: sessions, sessionId: 'fixture', userHome: home, executable: '/fixture/gemini' }), { code: 'gemini_settings_invalid' });
    assert.equal(fs.readFileSync(source, 'utf8'), content);
    assert.equal(fs.existsSync(sessions), false);
  }
});

test('Antigravity can write a session without optional branch context', (t) => {
  const dir = fixture(t);
  const result = writeAgySession({ dir, sessionId: 'fixture', token: 'fixture-token', hookUrl: 'http://127.0.0.1:1/hooks/agy', executable: '/fixture/agy', hooksFile: path.join(dir, 'hooks.json') });
  assert.deepEqual(JSON.parse(fs.readFileSync(result.env.ATRIUM_BRANCH_FILE)), {});
});

test('Antigravity hook refresh preserves an explicit disabled preference', (t) => {
  const dir = fixture(t), file = path.join(dir, 'hooks.json');
  const options = { file, nodePath: process.execPath, script: path.join(dir, 'old.mjs') };
  installAgyHooks(options);
  const data = JSON.parse(fs.readFileSync(file)); data['atrium-board'].enabled = false;
  fs.writeFileSync(file, JSON.stringify(data));
  installAgyHooks({ ...options, script: path.join(dir, 'new.mjs') });
  const refreshed = JSON.parse(fs.readFileSync(file))['atrium-board'];
  assert.equal(refreshed.enabled, false);
  assert.match(refreshed.SessionStart[0].command, /new\.mjs/);
});

test('executable lookup accepts explicit paths and case-insensitive Windows PATH keys', (t) => {
  const dir = fixture(t), file = path.join(dir, 'fixture.exe');
  write(file, 'fixture'); fs.chmodSync(file, 0o700);
  assert.equal(findExecutable(file, { env: { PATH: '/missing' } }), file);
  assert.equal(findExecutable('fixture', { platform: 'win32', env: { Path: `"${dir}"`, PathExt: '.EXE;.CMD' } }), file);
});

test('Windows chooses an executable suffix over the Unix npm shim', (t) => {
  const dir = fixture(t);
  write(path.join(dir, 'codex'), '#!/bin/sh\nexit 1');
  write(path.join(dir, 'codex.cmd'), '@echo off');
  assert.equal(findExecutable('codex', { platform: 'win32', env: { PATH: dir } }), path.join(dir, 'codex.cmd'));
});

test('herdr fallback never chooses an executable directory', { skip: process.platform === 'win32' }, (t) => {
  const dir = fixture(t), fake = path.join(dir, '.local/bin/herdr');
  fs.mkdirSync(fake, { recursive: true });
  assert.notEqual(defaultHerdrPath('fixture', { platform: 'linux', home: dir, env: {} }), fake);
});

test('launch recovery matches the effective settings option, not an earlier duplicate', () => {
  assert.equal(argvHasSettings(['--settings', '/expected', '--settings', '/other'], '/expected'), false);
  assert.equal(argvHasSettings(['--settings=/expected'], '/expected'), true);
  assert.equal(argvHasSettings(['--', '--settings', '/expected'], '/expected'), false);
  assert.equal(predictTrustFrom('/fixture', { '/fixture': { hasTrustDialogAccepted: 'false' } }).needsTrust, true);
  assert.equal(predictTrustFrom('/fixture', null).needsTrust, true);
});

test('Claude session settings containing bearer tokens are private', { skip: process.platform === 'win32' }, (t) => {
  const file = path.join(fixture(t), 'settings.json');
  write(file, '{}'); fs.chmodSync(file, 0o644);
  writeSessionSettings({ file, hookUrl: 'http://127.0.0.1:1/hooks/claude', token: 'fixture-token', sessionId: 'fixture' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

function fakeServer(onMessage) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  child.kill = () => { child.signalCode = 'SIGTERM'; queueMicrotask(() => { child.emit('exit', null); child.emit('close', null); }); };
  child.stdin.on('data', (chunk) => queueMicrotask(() => onMessage(JSON.parse(chunk), child)));
  return { executable: '/fixture/codex', spawnImpl: () => child, timeoutMs: 100 };
}
test('Codex spawn errors are sanitized and invalid deadlines rejected', async () => {
  await assert.rejects(listCodexModels({ executable: '/fixture/codex', spawnImpl: () => { throw new Error('private fixture detail'); } }), (error) => error.code === 'model_list_failed' && !error.message.includes('private'));
  const fake = fakeServer(() => {});
  await assert.rejects(listCodexModels({ ...fake, timeoutMs: 0 }), { code: 'bad_request' });
});

test('Codex drains stdout after process exit before judging model discovery', async () => {
  const fake = fakeServer((message, child) => {
    if (message.method === 'initialize') child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n');
    if (message.method === 'model/list') {
      child.exitCode = 0; child.emit('exit', 0);
      child.stdout.write(JSON.stringify({ id: message.id, result: { data: [{ model: 'fixture-model' }] } }) + '\n');
      child.emit('close', 0);
    }
  });
  assert.equal((await listCodexModels(fake)).models[0].id, 'fixture-model');
});

test('Windows Codex model discovery runs npm bin metadata through Node without a shell', async (t) => {
  const dir = fixture(t), executable = path.join(dir, 'codex.cmd');
  const cli = path.join(dir, 'node_modules/@openai/codex');
  write(executable, '@echo off\nREM this wrapper is never executed');
  write(path.join(cli, 'package.json'), JSON.stringify({ name: '@openai/codex', bin: { codex: 'bin/codex.js' } }));
  const entry = path.join(cli, 'bin/codex.js'); write(entry, 'throw new Error("fixture only");');
  const fake = fakeServer((message, child) => {
    if (message.id) child.stdout.write(JSON.stringify({ id: message.id, result: message.id === 1 ? {} : { data: [] } }) + '\n');
  });
  let invocation;
  const result = await listCodexModels({ ...fake, executable, platform: 'win32', spawnImpl: (...args) => { invocation = args; return fake.spawnImpl(); } });
  assert.deepEqual(result.models, []);
  assert.equal(invocation[0], process.execPath);
  assert.deepEqual(invocation[1], [entry, 'app-server', '--listen', 'stdio://']);
  assert.equal(invocation[2].shell, false);
});

test('oversized Codex model pages fail without overflowing the backend call stack', async () => {
  const fake = fakeServer((message, child) => {
    if (message.id) child.stdout.write(JSON.stringify({ id: message.id, result: message.id === 1 ? {} : { data: Array(150000).fill(null) } }) + '\n');
  });
  await assert.rejects(listCodexModels(fake), { code: 'model_list_failed' });
});

test('Codex catalog excludes IDs that its model argument cannot accept', () => {
  assert.deepEqual(normalizeModels([{ model: ' ' }, { model: 'bad\nmodel' }, { model: 'x'.repeat(201) }, { model: 'valid/model' }]), [{ id: 'valid/model', name: 'valid/model', isDefault: false }]);
});

test('Antigravity stream read errors reject the query and stop its child', async () => {
  const fake = fakeServer(() => {}), child = fake.spawnImpl();
  const pending = listAgyModels(fake);
  queueMicrotask(() => child.stdout.emit('error', new Error('fixture stream failure')));
  await assert.rejects(pending, { code: 'model_list_failed' });
  assert.equal(child.signalCode, 'SIGTERM');
});
