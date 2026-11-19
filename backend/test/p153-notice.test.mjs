// P153 r13 단위 시험: 판이 세션에 보낸 알림("[Atrium 보드] …", 옛 이름 "[Atrium 판]", "[multitask 판]")은 마지막 지시(lastPrompt)가 되지 않는다.
// 카드의 지금·마지막 일, 미리 보기, 휴대폰 대기 카드, 사이드바 일 줄은 모두 세션 요약의 lastPrompt를 쓰므로 여기서 한 번 거른다(그 앞 지시가 남는다)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBoardNotice } from '../src/text.mjs';
import { newRuntime, applyHook } from '../src/state.mjs';
import { parseTranscriptChunks } from '../src/convos.mjs';
import { parseCodexChunks } from '../src/codex-convos.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const NOTICE = '[Atrium 보드] 관계: 너는 @lead의 하위 워커다. 보고는 아래 지시에 적힌 방법을 따른다.';

test('P153 r13: 판 알림 알아보기(지금 이름·옛 이름·붙여넣기 감싸기), 보통 글은 아니다', () => {
  for (const s of [NOTICE, '[Atrium 판] 연결 알림: `@w`가 너의 "worker"이다.', '[multitask 판] 연결 해제', '  [Atrium 보드] 하위 세션', `<pasted_content id="ab12">\n${NOTICE}\n</pasted_content id="ab12">`]) assert.ok(isBoardNotice(s), s);
  for (const s of ['Review the parser diff', '보드 [Atrium 보드] 가운데', '[Atrium] 보드', '', null, undefined]) assert.ok(!isBoardNotice(s), String(s));
});

test('P153 r13: hook — 알림 지시는 마지막 지시를 바꾸지 않고(턴은 시작), 다음 진짜 지시는 바꾼다', () => {
  const rt = newRuntime({ now: 1 });
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'Collect the source tables' }, 10);
  applyHook(rt, { hook_event_name: 'Stop' }, 20);
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: NOTICE }, 30);
  assert.equal(rt.lastPrompt, 'Collect the source tables'); assert.equal(rt.lastPromptAt, 10);
  assert.equal(rt.turn.startedAt, 30, '알림에 답하는 턴은 그대로 돈다');
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'Draft the slide notes' }, 40);
  assert.equal(rt.lastPrompt, 'Draft the slide notes');
});

test('P153 r13: 대화 기록(Claude Code·Codex)의 마지막 지시는 알림을 건너뛴 그 앞 지시', () => {
  const u = (text, at) => JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
  const a = (text, at) => JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } });
  const s = parseTranscriptChunks([u('Review the parser diff', '2026-11-15T01:00:00Z'), a('done', '2026-11-15T01:00:05Z'), u(NOTICE, '2026-11-15T01:01:00Z'), a('알겠다', '2026-11-15T01:01:02Z')].join('\n'));
  assert.equal(s.lastPrompt, 'Review the parser diff');
  assert.equal(s.firstPrompt, 'Review the parser diff');
  const only = parseTranscriptChunks(u(NOTICE, '2026-11-15T01:01:00Z'));
  assert.ok(!only.lastPrompt, '알림뿐이면 마지막 지시가 없다');
  const ev = (text, at) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', id: 'u', content: [{ type: 'text', text }] } } });
  const c = parseCodexChunks([ev('Merge the workers', '2026-11-15T01:00:00Z'), ev('[Atrium 판] 연결 갱신: 너의 "worker"', '2026-11-15T01:02:00Z')].join('\n'));
  assert.equal(c.lastPrompt, 'Merge the workers');
});

test('P153 r13: 판 전달 확인과 세션 요약도 같은 규칙(옛 기록에 남은 알림은 요약에서 뺀다)', () => {
  const b = fs.readFileSync(path.join(SRC, 'backend.mjs'), 'utf8');
  assert.match(b, /if \(row && !isBoardNotice\(row\.text\)\)/);
  assert.match(b, /lastPrompt: clip\(promptTask\(rt\.lastPrompt\), 300\)/); // P159: 알림이면 null, 관계 줄 + 지시면 줄을 뗀 지시
});

test('P164 뒤: Claude Code 뒤 일 끝남 알림(<task-notification>)도 마지막 지시가 되지 않는다', () => {
  const TN = '<task-notification>\n<task-id>a7f283cf586047f56</task-id>\n<status>completed</status>\n<summary>Background command "sleep 150" completed</summary>\n</task-notification>';
  assert.ok(isBoardNotice(TN)); assert.ok(isBoardNotice(`  ${TN}`));
  assert.ok(!isBoardNotice('Explain what <task-notification> means'), '글 가운데 나오면 지시다');
  const rt = newRuntime({ now: 1 });
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: 'Run sleep 150 in the background' }, 10);
  applyHook(rt, { hook_event_name: 'Stop' }, 20);
  applyHook(rt, { hook_event_name: 'UserPromptSubmit', prompt: TN }, 30);
  assert.equal(rt.lastPrompt, 'Run sleep 150 in the background');
  assert.equal(rt.turn.startedAt, 30, '알림에 답하는 턴은 그대로 돈다');
});
