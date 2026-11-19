// P137 시험: 하네스가 지금 쓰는 모델(과 노력 수준)을 기록 파일에서 읽는다.
// - Claude Code 대화 기록: assistant의 message.model, /model·/effort 출력 줄(나중 줄이 이긴다), <synthetic>·하위 에이전트(isSidechain)는 뺀다
// - Codex rollout의 turn_context(model·effort), pi 세션 파일의 model_change·thinking_level_change
// - 처음에는 끝에서 거슬러 읽고(4MB 조각을 넘는 파일), 그 뒤에는 늘어난 만큼만. 쓰는 중인 마지막 조각은 미룬다
// - 보일 값: 지금 값이 있으면 그것, 모르면 띄운 값
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lineModel, refreshModel, findCodexRollout, findPiSession, shownModel, sameModel } from '../src/model-now.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p137-'));
const J = (o) => JSON.stringify(o);
const asst = (model, extra = {}) => J({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'ok' }] }, ...extra });
const cmdOut = (text) => J({ type: 'user', message: { content: `<local-command-stdout>${text}</local-command-stdout>` } });
const turnCtx = (model, effort) => J({ type: 'turn_context', payload: { cwd: 'C:/x', model, effort, collaboration_mode: { mode: 'default', settings: { model, reasoning_effort: effort } } } });

test('P137 Claude Code 줄: assistant 모델, /model·/effort 출력, 빼는 줄', () => {
  assert.deepEqual(lineModel('claude', asst('claude-haiku-5-5')), { model: 'claude-haiku-5-5' });
  assert.equal(lineModel('claude', asst('<synthetic>')), null);
  assert.equal(lineModel('claude', asst('claude-haiku-5-5', { isSidechain: true })), null);
  assert.deepEqual(lineModel('claude', cmdOut('Set model to `Opus 5.5` and saved as your default for new sessions')), { model: 'Opus 5.5' });
  assert.deepEqual(lineModel('claude', cmdOut('Set model to \u001b[1m`ocx-claude-deepseek--deepseek-flash[1m]`\u001b[22m')), { model: 'ocx-claude-deepseek--deepseek-flash[1m]' });
  assert.deepEqual(lineModel('claude', cmdOut('Set model to `GPT 6.1 Terra (native)` and saved as your default for new sessions · Draws from usage credits')), { model: 'GPT 6.1 Terra (native)' });
  assert.deepEqual(lineModel('claude', cmdOut('Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning')), { effort: 'xhigh' });
  assert.equal(lineModel('claude', J({ type: 'user', message: { content: 'please Set model to x' } })), null);
  assert.equal(lineModel('claude', '{"type":"assistant","model": broken'), null);
});

test('P137 Codex·pi 줄', () => {
  assert.deepEqual(lineModel('codex', turnCtx('gpt-6.1-sol', 'xhigh')), { model: 'gpt-6.1-sol', effort: 'xhigh' });
  assert.deepEqual(lineModel('codex', J({ type: 'turn_context', payload: { model: 'm1' } })), { model: 'm1', effort: null });
  assert.equal(lineModel('codex', J({ type: 'event_msg', payload: { model: 'x' } })), null);
  // /model로 바꾼 바로 그때 남는 줄(다음 턴 전)
  assert.deepEqual(lineModel('codex', J({ type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-6-luna', reasoning_effort: 'high', collaboration_mode: { settings: { model: 'gpt-6-luna', reasoning_effort: 'high' } } } } })), { model: 'gpt-6-luna', effort: 'high' });
  assert.equal(lineModel('codex', J({ type: 'event_msg', payload: { type: 'task_complete', thread_settings_applied: 1 } })), null);
  assert.deepEqual(lineModel('pi', J({ type: 'model_change', provider: 'p', modelId: 'fake-2' })), { model: 'fake-2' });
  assert.deepEqual(lineModel('pi', J({ type: 'thinking_level_change', thinkingLevel: 'off' })), { effort: null });
  assert.deepEqual(lineModel('pi', J({ type: 'thinking_level_change', thinkingLevel: 'high' })), { effort: 'high' });
});

test('P137 Claude Code 대화 기록: 처음 읽기, /model 뒤, 다음 턴, 쓰는 중인 조각', () => {
  const d = tmp(); const f = path.join(d, 't.jsonl');
  fs.writeFileSync(f, [J({ type: 'user', message: { content: 'hi' } }), asst('claude-haiku-5-5'), ''].join('\n'));
  let st = refreshModel('claude', f, null);
  assert.equal(st.model, 'claude-haiku-5-5');
  // /model: 다음 답이 오기 전에 바뀐 이름(보이는 이름)을 보인다
  fs.appendFileSync(f, cmdOut('Set model to `Sonnet 5.5` and saved as your default for new sessions') + '\n');
  st = refreshModel('claude', f, st);
  assert.equal(st.model, 'Sonnet 5.5');
  // 하위 에이전트의 다른 모델은 보지 않는다
  fs.appendFileSync(f, asst('claude-haiku-5-5', { isSidechain: true }) + '\n');
  st = refreshModel('claude', f, st);
  assert.equal(st.model, 'Sonnet 5.5');
  // 다음 턴의 답: 모델 ID로 바뀐다. 쓰는 중인 마지막 조각(줄바꿈 없음)은 미룬다
  const line = asst('claude-sonnet-5-5');
  fs.appendFileSync(f, line.slice(0, 20));
  st = refreshModel('claude', f, st);
  assert.equal(st.model, 'Sonnet 5.5');
  fs.appendFileSync(f, line.slice(20) + '\n' + cmdOut('Set effort level to low (saved as your default for new sessions): Quick') + '\n');
  st = refreshModel('claude', f, st);
  assert.deepEqual([st.model, st.effort], ['claude-sonnet-5-5', 'low']);
  // 파일을 새로 쓰면(줄어듦) 처음부터 다시 읽는다
  fs.writeFileSync(f, asst('claude-opus-5-5') + '\n');
  st = refreshModel('claude', f, st);
  assert.equal(st.model, 'claude-opus-5-5');
  fs.rmSync(d, { recursive: true, force: true });
});

test('P137 큰 기록: 4MB 조각을 넘어 거슬러 찾고, 한글이 조각 경계에 걸려도 깨지지 않는다', () => {
  const d = tmp(); const f = path.join(d, 'big.jsonl');
  const pad = J({ type: 'user', message: { content: '가'.repeat(3000) } });
  const lines = [turnCtx('gpt-old', 'low'), turnCtx('gpt-new', 'high')];
  for (let i = 0; i < 1800; i++) lines.push(pad); // ~16MB
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const st = refreshModel('codex', f, null);
  assert.deepEqual([st.model, st.effort], ['gpt-new', 'high']);
  assert.equal(st.pos, fs.statSync(f).size);
  fs.rmSync(d, { recursive: true, force: true });
});

test('P137 Codex rollout·pi 세션 파일 찾기', () => {
  const home = tmp(); const id = '01a1d2a6-c7a4-7f42-86ab-a32e2e857a48';
  const dir = path.join(home, 'sessions', '2026', '11', '13'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `rollout-2026-11-13T11-05-07-${id}.jsonl`), turnCtx('m', 'medium') + '\n');
  assert.equal(path.basename(findCodexRollout(home, id.toUpperCase())), `rollout-2026-11-13T11-05-07-${id}.jsonl`);
  assert.equal(findCodexRollout(home, 'nope'), null);
  const pi = path.join(home, 'pi'); fs.mkdirSync(path.join(pi, '--C--x--'), { recursive: true });
  fs.writeFileSync(path.join(pi, '--C--x--', `2026-11-12T14-38-38-216Z_${id}.jsonl`), '');
  assert.ok(findPiSession(pi, id).endsWith(`_${id}.jsonl`));
  fs.rmSync(home, { recursive: true, force: true });
});

test('P137 보일 값: 지금 값이 이기고, 모르면 띄운 값', () => {
  assert.deepEqual(shownModel({ model: 'haiku', effort: 'high' }, null), { model: 'haiku', effort: 'high' });
  assert.deepEqual(shownModel({ model: 'haiku', effort: 'high' }, { model: 'claude-sonnet-5-5', effort: null }), { model: 'claude-sonnet-5-5', effort: 'high' });
  assert.deepEqual(shownModel({ model: null, effort: null }, { model: 'gpt-6.1-sol', effort: 'xhigh' }), { model: 'gpt-6.1-sol', effort: 'xhigh' });
});

test('P137 같은 모델의 다른 이름(판 이벤트를 남기지 않는다)', () => {
  assert.ok(sameModel('haiku', 'claude-haiku-5-5'));
  assert.ok(sameModel('Sonnet 5.5', 'claude-sonnet-5-5'));
  assert.ok(sameModel('claude-opus-5-5', 'opus'));
  assert.ok(!sameModel('claude-haiku-5-5', 'Sonnet 5.5'));
  assert.ok(!sameModel('p115-fake-model', 'gpt-6-luna'));
  assert.ok(!sameModel('gpt-6', 'gpt-6-luna'));
});
