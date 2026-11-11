// P72 창 단위 시험: 하네스 모델의 보이는 이름(Codex 목록의 display_name), 목록 밖 모델 경고 글이 두 사전에 있는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { harnessModels, harnessModelLabels, modelChoices } from '../src/renderer/lib/launchers.js';
import { translate } from '../src/renderer/lib/i18n.js';

const harnesses = [
  { id: 'claude', fields: ['model'], models: ['haiku'] },
  { id: 'codex', fields: ['model', 'args'], models: ['gpt-6.1-sol', 'gpt-6-astra'], modelLabels: { 'gpt-6.1-sol': 'GPT-6.1-Sol' }, warnUnlisted: true },
];

test('P72 하네스 모델 목록과 보이는 이름', () => {
  assert.deepEqual(harnessModels(harnesses, 'codex'), ['gpt-6.1-sol', 'gpt-6-astra']);
  assert.deepEqual(harnessModelLabels(harnesses, 'codex'), { 'gpt-6.1-sol': 'GPT-6.1-Sol' });
  assert.deepEqual(harnessModelLabels(harnesses, 'claude'), {});
  assert.deepEqual(harnessModelLabels(harnesses, 'nope'), {});
  assert.deepEqual(harnessModelLabels(null, 'codex'), {});
});

test('P72 모델 입력칸 아래 목록: 비었거나 목록의 이름이면 전부, 아니면 글자로 거른다', () => {
  const ms = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol'];
  const labels = { 'gpt-6-astra': 'Astra (default)' };
  assert.deepEqual(modelChoices(ms, labels, ''), ms);
  assert.deepEqual(modelChoices(ms, labels, 'gpt-6-astra'), ms, '고른 뒤에도 다른 모델이 보인다');
  assert.deepEqual(modelChoices(ms, labels, 'SOL'), ['gpt-6.1-sol', 'gpt-6-sol']);
  assert.deepEqual(modelChoices(ms, labels, 'default'), ['gpt-6-astra'], '보이는 이름으로도');
  assert.deepEqual(modelChoices(ms, labels, 'nope'), []);
  assert.deepEqual(modelChoices(null, {}, ''), []);
});

test('P72 목록 밖 모델 경고(백엔드 열쇠 launcherModels.unlisted)는 두 언어로', () => {
  const vars = { harness: 'Codex', model: 'gpt-6.1-sool' };
  assert.equal(translate('en', 'launcherModels.unlisted', vars), 'This model is not in the Codex list. Check that the name is right.');
  assert.equal(translate('ko', 'launcherModels.unlisted', vars), 'Codex 목록에 없는 모델입니다. 이름이 맞는지 확인하세요.');
});
