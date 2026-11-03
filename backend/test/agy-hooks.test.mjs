import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { normalizeAgyHook, agyComposerState } from '../src/agy-hooks.mjs';
import { newRuntime, deriveState } from '../src/state.mjs';

test('Antigravity shell hook maps CommandLine and stable tool identity', () => {
  const body = { atriumEvent: 'PreToolUse', conversationId: 'test', stepIdx: 4, workspacePaths: ['/work'], toolCall: { name: 'run_command', args: { CommandLine: 'herdr agent prompt reviewer "review" --wait' } } };
  const pre = normalizeAgyHook(body), post = normalizeAgyHook({ ...body, atriumEvent: 'PostToolUse' });
  assert.equal(pre.tool_name, 'Bash'); assert.match(pre.tool_input.command, /herdr agent prompt/);
  assert.equal(post.tool_use_id, pre.tool_use_id); assert.equal(post.noToolOutput, true);
  assert.equal(post.tool_response, undefined);
  assert.equal(normalizeAgyHook({ ...body, atriumEvent: 'PostToolUse', error: 'denied' }).hook_event_name, 'PostToolUseFailure');
});

test('Antigravity hook cannot invent final answer text', () => {
  const body = normalizeAgyHook({ atriumEvent: 'Stop', fullyIdle: true, transcriptPath: '/not-claude.jsonl' });
  assert.equal(body.notification_type, 'agy_stop'); assert.equal(body.last_assistant_message, undefined); assert.equal(body.transcript_path, undefined);
  const rt = newRuntime({ kind: 'agy', hooked: false }); rt.herdr.status = 'idle'; rt.agyTurnActive = true;
  assert.equal(deriveState(rt).state, 'working'); rt.herdr.status = 'blocked'; assert.equal(deriveState(rt).state, 'waiting');
});

test('Outside Atrium, the registered hook is inert and leaves default approval policy in charge', () => {
  const env = { ...process.env }; delete env.ATRIUM_AGY_BRIDGE;
  for (const event of ['SessionStart', 'PreToolUse', 'Stop']) {
    const r = spawnSync(process.execPath, [new URL('../scripts/agy-hook.mjs', import.meta.url).pathname, event], { env, input: '{}', encoding: 'utf8' });
    assert.equal(r.status, 0); assert.equal(r.stderr, '');
    assert.deepEqual(JSON.parse(r.stdout), event === 'PreToolUse' ? { decision: 'allow' } : {});
  }
});

test('onboarding, consent and login are never composer-ready even when herdr reports idle', () => {
  for (const text of ['Select login method:\n> Google OAuth\n↑/↓ Navigate · enter Select', '[Next]\n↑/↓ Navigate · enter Confirm\nGemini 3.8 Flash', '[Previous] [Done]\n↑/↓ Navigate · enter Toggle']) assert.equal(agyComposerState(text), 'waiting');
  assert.equal(agyComposerState('loading...'), 'starting');
  assert.equal(agyComposerState('> \n──────────────── ? for shortcuts\nGemini'), 'ready');
});
