import test from 'node:test';
import assert from 'node:assert/strict';
import { splitArgs, geminiModelFromArgs, withGeminiModel, validateGeminiNewSessionArgs } from '../src/gemini-args.mjs';

test('Gemini argv preserves quoting, empty arguments, escapes, and literal shell text', () => {
  assert.deepEqual(splitArgs('--model "provider/my-model" --include-directories "work tree"'), ['--model', 'provider/my-model', '--include-directories', 'work tree']);
  assert.deepEqual(splitArgs(String.raw`--label 'single "quotes"' "double \"quotes\"" escaped\ space '' a" b"c`), ['--label', 'single "quotes"', 'double "quotes"', 'escaped space', '', 'a bc']);
  assert.deepEqual(splitArgs(String.raw`--path "C:\work\tree" '$HOME' '$(command)'`), ['--path', 'C:\\work\\tree', '$HOME', '$(command)']);
  assert.deepEqual(splitArgs('one\\\ntwo'), ['onetwo']);
  const args = ['--model', 'custom/id', 'literal "quotes"', '', 42];
  assert.deepEqual(splitArgs(args), ['--model', 'custom/id', 'literal "quotes"', '', '42']);
  assert.deepEqual(args, ['--model', 'custom/id', 'literal "quotes"', '', 42]);
  for (const malformed of ['"unfinished', "'unfinished", 'trailing\\']) assert.throws(() => splitArgs(malformed), { code: 'bad_request' });
});

test('Gemini model overrides support long/short/equal/attached spellings and custom IDs', () => {
  assert.deepEqual(withGeminiModel('-m old --model=older -moldest -m=last --debug', 'projects/p/locations/us/models/custom@v1'), ['--debug', '--model', 'projects/p/locations/us/models/custom@v1']);
  assert.equal(geminiModelFromArgs('-m one --model two --model=three -mfour -m=five'), 'five');
  assert.equal(geminiModelFromArgs('--debug --model "custom/name"'), 'custom/name');
  assert.equal(geminiModelFromArgs('--model --debug'), '');
  assert.equal(geminiModelFromArgs('--model'), '');
  assert.equal(geminiModelFromArgs('--model=first -- --model=prompt'), 'first');
  assert.equal(geminiModelFromArgs('"unfinished'), '');
});

test('default, explicit auto, and unchanged model have different argv semantics', () => {
  assert.deepEqual(withGeminiModel('-m old --debug', undefined), ['-m', 'old', '--debug']);
  for (const model of ['', null, '  ']) assert.deepEqual(withGeminiModel('-m old --debug', model), ['--debug']);
  assert.deepEqual(withGeminiModel('-m old', 'auto'), ['--model', 'auto']);
  assert.deepEqual(withGeminiModel('--model --debug', 'new'), ['--debug', '--model', 'new']);
  for (const id of ['bad model', '--resume', 'bad\0id', 'bad;id', 'x'.repeat(513)]) assert.throws(() => withGeminiModel('', id), { code: 'bad_request' });
});

test('Gemini never strips Codex config or Claude-specific flags', () => {
  const args = ['-c', 'model=keep', '--config=model=also-keep', '-cmodel=keep-too', '--config', 'model=last', '--permission-mode', 'plan', '--debug'];
  assert.deepEqual(withGeminiModel([...args, '--model', 'old'], 'new'), [...args, '--model', 'new']);
  assert.equal(geminiModelFromArgs(args), '');
});

test('new-session validation rejects session ownership and headless flags in all spellings', () => {
  for (const args of [
    '--resume', '--resume latest', '--resume=latest', '-r', '-rlatest', '-r=latest', '-dr latest', '--r=latest', '--no-r',
    '--session-id id', '--session-id=id', '--sessionId=id', '--session-file file', '--sessionFile=file',
    '--prompt hi', '--prompt=hi', '-p hi', '-phi', '-p=hi', '-dp hi', '--p=hi', '--no-p', '--session-id.extra=bad',
    '--acp', '--acp=true', '--acp=false', '--experimental-acp', '--experimentalAcp', '--no-acp',
    '-- --session-id id', '--', '--label bad\0value',
  ]) {
    assert.throws(() => validateGeminiNewSessionArgs(args), { code: 'bad_request' }, args);
    assert.throws(() => withGeminiModel(args, undefined), { code: 'bad_request' }, args);
    assert.throws(() => withGeminiModel(args, 'auto'), { code: 'bad_request' }, args);
  }
  assert.deepEqual(validateGeminiNewSessionArgs('--approval-mode plan --debug -mprovider/model'), ['--approval-mode', 'plan', '--debug', '-mprovider/model']);
  assert.deepEqual(validateGeminiNewSessionArgs('--prompt-interactive "continue here"'), ['--prompt-interactive', 'continue here']);
  const argv = withGeminiModel('--debug', 'auto');
  argv.push('--session-id', 'board-uuid');
  assert.deepEqual(argv, ['--debug', '--model', 'auto', '--session-id', 'board-uuid']);
});
