import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listAgyModels, parseAgyModels, withAgyModel, agyModelFromArgs, validateAgyNewSessionArgs, installAgyHooks, AGY_HOOK_EVENTS } from '../src/agy.mjs';

function hookFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-agy-hooks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'config/hooks.json'), nodePath: process.execPath, script: path.join(dir, "bridge with ' quote.mjs") };
}

test('explicit hook installer creates only the named bridge with the exact native event schema', (t) => {
  const fixture = hookFixture(t);
  assert.deepEqual(installAgyHooks(fixture), { file: fixture.file, changed: true });
  const hooks = JSON.parse(fs.readFileSync(fixture.file, 'utf8'));
  assert.deepEqual(Object.keys(hooks), ['atrium-board']);
  assert.deepEqual(Object.keys(hooks['atrium-board']), ['enabled', 'SessionStart', 'PreToolUse', 'PostToolUse', 'PreInvocation', 'Stop']);
  for (const event of AGY_HOOK_EVENTS) {
    const entries = hooks['atrium-board'][event];
    assert.equal(entries.length, 1);
    const handler = ['PreToolUse', 'PostToolUse'].includes(event) ? entries[0].hooks[0] : entries[0];
    if (['PreToolUse', 'PostToolUse'].includes(event)) assert.equal(entries[0].matcher, '*');
    assert.equal(handler.type, 'command');
    assert.equal(handler.timeout, 5);
    assert.ok(handler.command.endsWith(`'${event}'`) || handler.command.endsWith(`"${event}"`));
    assert.ok(!handler.command.includes('ATRIUM_AGY_BRIDGE'));
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(fixture.file).mode & 0o777, 0o600);
});

test('installation preserves existing named hooks and settings, and identical reinstall is a no-op', (t) => {
  const fixture = hookFixture(t);
  fs.mkdirSync(path.dirname(fixture.file), { recursive: true });
  const original = { 'my-linter': { PostToolUse: [{ matcher: 'write_to_file', hooks: [{ command: 'lint' }] }] }, disabled: { enabled: false, Stop: [{ type: 'command', command: 'echo stop' }] } };
  fs.writeFileSync(fixture.file, JSON.stringify(original));
  const settings = path.join(fixture.dir, 'settings.json');
  fs.writeFileSync(settings, '{"model":"personal","theme":"unchanged"}');
  installAgyHooks(fixture);
  const first = fs.readFileSync(fixture.file, 'utf8');
  const result = JSON.parse(first);
  for (const [key, value] of Object.entries(original)) assert.deepEqual(result[key], value);
  assert.deepEqual(installAgyHooks(fixture), { file: fixture.file, changed: false });
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), first);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{"model":"personal","theme":"unchanged"}');
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.file)), ['hooks.json']);
});

test('malformed hook files are refused byte-for-byte without repair or overwrite', (t) => {
  const fixture = hookFixture(t);
  fs.mkdirSync(path.dirname(fixture.file), { recursive: true });
  for (const content of ['{broken', '', 'null', '[]', '"text"', '{"existing":null}', '{"existing":[]}', '{"existing":{"enabled":"true"}}', '{"existing":{"Stop":"bad"}}', '{"existing":{"Stop":[null]}}', '{"existing":{"Stop":[{}]}}', '{"existing":{"PreToolUse":[{"hooks":"bad"}]}}']) {
    fs.writeFileSync(fixture.file, content);
    assert.throws(() => installAgyHooks(fixture), { code: 'agy_hooks_invalid' });
    assert.equal(fs.readFileSync(fixture.file, 'utf8'), content);
  }
});

test('registered commands preserve quoted paths and pass only the event to a no-op bridge', (t) => {
  const fixture = hookFixture(t);
  fs.writeFileSync(fixture.script, 'process.stdout.write(JSON.stringify({ event: process.argv[2], args: process.argv.slice(3), managed: !!process.env.ATRIUM_AGY_BRIDGE }));');
  installAgyHooks(fixture);
  const hooks = JSON.parse(fs.readFileSync(fixture.file, 'utf8'))['atrium-board'];
  const env = { ...process.env }; delete env.ATRIUM_AGY_BRIDGE;
  const result = spawnSync(hooks.SessionStart[0].command, { shell: true, encoding: 'utf8', env, timeout: 2000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { event: 'SessionStart', args: [], managed: false });
});

function fakeProcess(run = () => {}) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  const kills = [], calls = [];
  child.kill = (signal = 'SIGTERM') => { kills.push(signal); child.signalCode = signal; queueMicrotask(() => child.emit('exit', null, signal)); };
  const close = (code = 0) => { child.exitCode = code; child.emit('exit', code); child.emit('close', code); };
  const spawnImpl = (...args) => { calls.push(args); queueMicrotask(() => run(child, close)); return child; };
  return { child, kills, calls, spawnImpl };
}

// Representative parser contracts, not a captured native success transcript:
// the real 1.4.12 probe failed before catalog output at localhost listener bind.
const catalog = 'Available models:\n  fixture-pro  Fixture Pro\n  fixture-flash (Fixture Flash)\n  fixture-pro  duplicate\n';

test('model parser requires an explicit catalog heading and emits nonempty unique IDs', () => {
  assert.deepEqual(parseAgyModels('\x1b[32m' + catalog + '\x1b[0m'), [{ id: 'fixture-pro', name: 'Fixture Pro' }, { id: 'fixture-flash', name: 'Fixture Flash' }]);
  assert.deepEqual(parseAgyModels('Available models:\n ID  Name\n --------\n - custom/model\n'), [{ id: 'custom/model', name: 'custom/model' }]);
  assert.deepEqual(parseAgyModels('No models available\n'), []);
  for (const output of ['', 'error: login required', 'arbitrary/model', 'Available models:\n', 'Available models:\nthis is diagnostic text']) {
    assert.throws(() => parseAgyModels(output), { code: 'model_list_unrecognized' });
  }
});

test('model listing only invokes models with closed stdin, bounded lifetime and no shell/TTY', async () => {
  const f = fakeProcess((child, close) => { child.stdout.write(catalog); close(); });
  assert.deepEqual(await listAgyModels({ executable: '/fixture/agy', spawnImpl: f.spawnImpl, cwd: '/fixture', env: { PATH: '/fixture/bin', BROWSER: 'unsafe-browser' } }), { models: parseAgyModels(catalog), source: 'agy' });
  assert.deepEqual(f.calls[0].slice(0, 2), ['/fixture/agy', ['models']]);
  const options = f.calls[0][2];
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(options.shell, false);
  assert.equal(options.cwd, '/fixture');
  assert.equal(options.env.NO_COLOR, '1');
  assert.notEqual(options.env.BROWSER, 'unsafe-browser');
  assert.deepEqual(f.kills, []);
});

test('missing executable, spawn failures, nonzero status, and unsupported output fail safely', async () => {
  await assert.rejects(listAgyModels({ executable: null }), { code: 'agy_not_installed' });
  await assert.rejects(listAgyModels({ executable: 'fixture', timeoutMs: 0 }), { code: 'bad_request' });
  await assert.rejects(listAgyModels({ executable: 'fixture', spawnImpl: () => { throw new Error('private token'); } }), { code: 'model_list_failed' });
  for (const run of [(child) => child.emit('error', new Error('private path')), (child, close) => { child.stderr.write('private diagnostic'); close(1); }]) {
    const f = fakeProcess(run);
    await assert.rejects(listAgyModels({ executable: 'fixture', spawnImpl: f.spawnImpl }), (error) => error.code === 'model_list_failed' && !error.message.includes('private'));
  }
  const unknown = fakeProcess((child, close) => { child.stdout.write('new undocumented layout'); close(); });
  await assert.rejects(listAgyModels({ executable: 'fixture', spawnImpl: unknown.spawnImpl }), { code: 'model_list_unrecognized' });
});

test('auth attempts terminate without echoing auth URLs or sending answers', async () => {
  const f = fakeProcess((child) => {
    child.stderr.write('Authentication ');
    child.stderr.write('required. Open browser https://example.test/?private=token');
  });
  await assert.rejects(listAgyModels({ executable: 'fixture', spawnImpl: f.spawnImpl }), (error) => error.code === 'agy_auth_required' && !error.message.includes('token') && !error.message.includes('https:'));
  assert.deepEqual(f.kills, ['SIGTERM']);
});

test('timeout and excessive output terminate the subprocess', async () => {
  const hang = fakeProcess();
  await assert.rejects(listAgyModels({ executable: 'fixture', spawnImpl: hang.spawnImpl, timeoutMs: 10 }), { code: 'model_list_timeout' });
  assert.deepEqual(hang.kills, ['SIGTERM']);
  const flood = fakeProcess((child) => child.stdout.write('x'.repeat(1024 * 1024 + 1)));
  await assert.rejects(listAgyModels({ executable: 'fixture', spawnImpl: flood.spawnImpl }), { code: 'model_list_failed' });
  assert.deepEqual(flood.kills, ['SIGTERM']);
});

test('native --model override preserves quoting and other verified options', () => {
  assert.deepEqual(withAgyModel('--model old --model=older --add-dir "work tree" --effort high', 'custom/new@v1'), ['--add-dir', 'work tree', '--effort', 'high', '--model', 'custom/new@v1']);
  assert.equal(agyModelFromArgs('--model old --model=latest'), 'latest');
  assert.equal(agyModelFromArgs('--settings \'{"model":"config-model"}\''), '');
  assert.deepEqual(withAgyModel('--settings \'{"model":"keep","title":"a \\\"quote\\\""}\' --model old', 'new'), ['--settings', '{"model":"keep","title":"a \\"quote\\""}', '--model', 'new']);
  const args = ['--model=old', '--sandbox=false'];
  assert.deepEqual(withAgyModel(args, undefined), args);
  assert.deepEqual(withAgyModel(args, null), ['--sandbox=false']);
  assert.deepEqual(withAgyModel(args, ''), ['--sandbox=false']);
  assert.deepEqual(args, ['--model=old', '--sandbox=false']);
  assert.deepEqual(withAgyModel('', 'custom/not-in-catalog'), ['--model', 'custom/not-in-catalog']);
});

test('fresh sessions reject short model aliases, identity/resume/headless flags and subcommands', () => {
  for (const args of [
    '-m old', '-mold', '-m=old', '-model old', '--continue', '-continue', '-c', '--c=true',
    '--conversation id', '-conversation=id', '--conversation-path=file', '--resume', '-r latest',
    '--print hi', '-print=hi', '-p hi', '--prompt=hi', '--headless', '--acp', '--experimental-acp',
    '--input-format stream-json', '--output-format=json', '--json-schema={}', '--print-timeout=10s',
    '--session-id=id', '--session-file=file', '--remote-agent', '--remote-control',
    '--', 'models', 'plugin install x', 'auth login', 'update', 'initial prompt', '--model', '--model --continue',
    '--sandbox=invalid', '--log-file bad\0path', '--unknown-option',
  ]) {
    assert.throws(() => validateAgyNewSessionArgs(args), { code: 'bad_request' }, args);
    assert.throws(() => withAgyModel(args, undefined), { code: 'bad_request' }, args);
  }
  assert.equal(agyModelFromArgs('-m old'), '');
  assert.deepEqual(validateAgyNewSessionArgs('--prompt-interactive "hello there" --mode plan'), ['--prompt-interactive', 'hello there', '--mode', 'plan']);
  for (const id of ['--print', 'bad model', 'a\0b', 'a;exit', 'x'.repeat(513)]) assert.throws(() => withAgyModel('', id), { code: 'bad_request' });
});

test('native 1.4.12 headerless TSV model output', () => {
  assert.deepEqual(parseAgyModels('gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n'), [{id:'gemini-3.8-flash-low',name:'Gemini 3.8 Flash (Low)'}]);
});
