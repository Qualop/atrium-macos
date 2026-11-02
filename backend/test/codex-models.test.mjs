import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { listCodexModels, normalizeModels } from '../src/codex-models.mjs';
import { withCodexModel, modelFromArgs, splitArgs } from '../src/codex-args.mjs';

function fakeServer(handler) {
  const child = new EventEmitter(); Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  child.kill = () => { child.signalCode = 'SIGTERM'; queueMicrotask(() => child.emit('exit', null)); };
  const calls = [];
  child.stdin.on('data', (d) => { const m = JSON.parse(String(d)); calls.push(m); queueMicrotask(() => handler(m, (v) => child.stdout.write(JSON.stringify(v) + '\n'))); });
  return { child, calls, spawnImpl: () => child };
}
test('모델 목록: 초기화, 페이지네이션, 숨김·중복 제외, model ID 보존', async () => {
  const f = fakeServer((m, reply) => {
    if (m.method === 'initialize') reply({ id: m.id, result: {} });
    if (m.method === 'model/list') reply({ id: m.id, result: m.params.cursor ? { data: [{ model: 'provider/model', displayName: 'Readable model' }, { model: 'hidden', hidden: true }], nextCursor: null } : { data: [{ id: 'opaque', model: 'provider/model', displayName: 'Readable model' }], nextCursor: 'page2' } });
  });
  const r = await listCodexModels({ executable: 'fixture', spawnImpl: f.spawnImpl });
  assert.deepEqual(r.models, [{ id: 'provider/model', name: 'Readable model', isDefault: false }]);
  assert.deepEqual(f.calls.map((m) => m.method), ['initialize', 'initialized', 'model/list', 'model/list']);
  assert.equal(f.child.signalCode, 'SIGTERM');
});
test('목록 오류·timeout·설치 안 됨은 실패로 반환하고 자식을 정리한다', async () => {
  await assert.rejects(listCodexModels({ executable: null }), { code: 'codex_not_installed' });
  const err = fakeServer((m, reply) => reply({ id: m.id, error: { message: 'private diagnostic' } }));
  await assert.rejects(listCodexModels({ executable: 'fixture', spawnImpl: err.spawnImpl }), { code: 'model_list_failed' });
  const hang = fakeServer(() => {});
  await assert.rejects(listCodexModels({ executable: 'fixture', spawnImpl: hang.spawnImpl, timeoutMs: 10 }), { code: 'model_list_timeout' });
  assert.equal(hang.child.signalCode, 'SIGTERM');
});
test('빈 목록과 반복 cursor 처리', async () => {
  assert.deepEqual(normalizeModels([]), []);
  const f = fakeServer((m, reply) => m.id && reply({ id: m.id, result: m.id === 1 ? {} : { data: [], nextCursor: 'same' } }));
  await assert.rejects(listCodexModels({ executable: 'fixture', spawnImpl: f.spawnImpl }), { code: 'model_list_failed' });
});
test('선택 모델은 기존 -m과 config model만 교체하며 다른 설정을 보존한다', () => {
  assert.deepEqual(withCodexModel('-m old --model=older -c model=oldest -c model_reasoning_effort=high', 'provider/new'), ['-c', 'model_reasoning_effort=high', '--model', 'provider/new']);
  assert.deepEqual(withCodexModel('--model old -c model_reasoning_effort=high', ''), ['-c', 'model_reasoning_effort=high']);
  assert.deepEqual(withCodexModel('-m old', undefined), ['-m', 'old']);
  assert.equal(modelFromArgs('-m old'), 'old');
  assert.equal(modelFromArgs('--model=provider/new'), 'provider/new');
  assert.deepEqual(splitArgs('--profile "work account"'), ['--profile', 'work account']);
  assert.throws(() => withCodexModel('', 'bad model'), { code: 'bad_request' });
  assert.throws(() => splitArgs('"unfinished'));
});
