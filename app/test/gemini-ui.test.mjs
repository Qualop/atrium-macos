import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnDefaults, hasModelCatalog } from '../src/renderer/lib/spawn.js';
import { kindOf, KINDS, logoFor, shownKind } from '../src/renderer/lib/kinds.js';
import { translate } from '../src/renderer/lib/i18n.js';

test('Gemini와 다른 종류의 빈 기본값에 Claude 설정을 물려주지 않는다', () => {
  const settings = { claudeModel: 'claude-configured', codexArgs: '-m codex-configured', deepseekModel: 'deepseek-configured' };
  for (const kind of ['gemini', 'agy', 'hermes', 'shell']) {
    assert.deepEqual(spawnDefaults(kind, settings, { defaultModel: 'claude-dev' }), { model: '', args: '' });
  }
  assert.deepEqual(spawnDefaults('gemini'), { model: '', args: '' });
});

test('Gemini와 다른 종류는 자기 종류에 저장된 기본값만 사용한다', () => {
  const settings = { claudeModel: 'claude-configured', geminiModel: 'gemini-configured', geminiArgs: '--sandbox', hermesModel: 'hermes-configured', hermesArgs: '--verbose' };
  assert.deepEqual(spawnDefaults('gemini', settings), { model: 'gemini-configured', args: '--sandbox' });
  assert.deepEqual(spawnDefaults('hermes', settings), { model: 'hermes-configured', args: '--verbose' });
  assert.deepEqual(spawnDefaults('gemini', { ...settings, geminiModel: '', geminiArgs: '' }), { model: '', args: '' });
});

test('기존 Claude·Codex·DeepSeek 기본 모델을 유지한다', () => {
  assert.equal(spawnDefaults('claude', {}, { defaultModel: 'claude-dev' }).model, 'claude-dev');
  assert.equal(spawnDefaults('claude', { claudeModel: 'claude-configured' }, { defaultModel: 'claude-dev' }).model, 'claude-configured');
  const args = '-m old --model="codex-configured" -c model_reasoning_effort=high';
  assert.deepEqual(spawnDefaults('codex', { codexArgs: args }), { model: 'codex-configured', args });
  assert.equal(spawnDefaults('codex', { codexArgs: '-m "unfinished' }).model, '');
  assert.equal(spawnDefaults('deepseek', { deepseekModel: 'deepseek-configured', claudeModel: 'claude-configured' }).model, 'deepseek-configured');
  assert.equal(spawnDefaults('deepseek', { claudeModel: 'claude-configured' }).model, '');
});

test('모델 목록을 지원하는 종류만 조회한다', () => {
  for (const kind of ['codex', 'gemini', 'agy']) assert.equal(hasModelCatalog(kind), true);
  for (const kind of ['claude', 'deepseek', 'shell', 'hermes']) assert.equal(hasModelCatalog(kind), false);
});

test('Gemini는 고유 이름·아이콘·레일 그림으로 표시하며 세션 종류를 유지한다', () => {
  const kind = kindOf('Gemini');
  assert.equal(kind, KINDS.gemini);
  assert.equal(kind.label, 'Gemini CLI');
  assert.notEqual(kind.color, KINDS.other.color);
  assert.equal(shownKind({ kind: 'gemini', hooked: true }), 'gemini');
  for (const state of ['working', 'waiting', 'trust_wait']) assert.equal(logoFor(kind, state), kind.logo);
  for (const asset of [kind.logo, kind.logoBadge]) {
    const svg = fs.readFileSync(new URL(`../src/renderer/${asset}`, import.meta.url), 'utf8');
    assert.match(svg, /^<svg[\s>]/);
    assert.doesNotMatch(svg, /<script|\son[a-z]+\s*=|href\s*=|<foreignObject|<image|url\(/i);
  }
});

test('모델 안내는 선택한 CLI 이름을 쓰고 계정 접근 권한 확인과 구분한다', () => {
  for (const lang of ['ko', 'en']) {
    for (const key of ['modelDefault', 'modelList_loading', 'modelList_ready', 'modelList_error']) {
      const text = translate(lang, `spawn.${key}`, { kind: 'Gemini' });
      assert.match(text, /Gemini/);
      assert.doesNotMatch(text, /Codex|\{kind\}/);
    }
    assert.match(translate(lang, 'spawn.modelDefault', { kind: 'Codex' }), /Codex/);
  }
  assert.match(translate('en', 'spawn.modelList_ready', { kind: 'Gemini' }), /does not verify account access/);
  assert.match(translate('ko', 'spawn.modelList_ready', { kind: 'Gemini' }), /접근 권한을 확인한 결과는 아니/);
});

test('Gemini 안내에 터미널 로그인·승인과 검토자 연결 방법이 있다', () => {
  assert.match(translate('en', 'spawn.geminiNote'), /Google.*Antigravity.*API key.*approvals.*terminal/);
  assert.match(translate('en', 'spawn.geminiNote'), /reviewer role.*connection/);
  assert.match(translate('ko', 'spawn.geminiNote'), /Google.*Antigravity.*API 키.*로그인.*승인.*터미널/);
  assert.match(translate('ko', 'spawn.geminiNote'), /연결선.*검토자 역할/);
  for (const lang of ['ko', 'en']) assert.match(translate(lang, 'rail.gemini'), /Gemini/);
});
