// 대화 기록 읽기(ARCH 5절): ~/.claude/projects/.../<세션 ID>.jsonl을 사용자 지시, AI 답, 도구 사용 목록으로 바꾼다.
// 줄 번호를 seq로 쓴다. afterSeq 뒤의 줄만 돌려줘 이어서 읽을 수 있다. 파일은 읽기만 한다.
import fs from 'node:fs';
import { unwrapPasted, clip } from './text.mjs';

// Parent's session.transcript handler can await this for a Codex native ID.
// This adapter reads supported app-server history, never local DB/JSONL files.
export async function readCodexMessages(history, threadId, { afterSeq = -1, limit = 500 } = {}) {
  const turns = await history.turns(threadId), messages = [];
  let seq = -1;
  for (const turn of turns) for (const item of turn.items || []) {
    seq++;
    if (seq <= afterSeq) continue;
    const at = item.completedAtMs ?? item.startedAtMs ?? (Number.isFinite(turn.startedAt) ? turn.startedAt * 1000 : null);
    if (item.type === 'userMessage') {
      const text = (item.content || []).filter((c) => c?.type === 'text').map((c) => c.text).join('\n');
      if (text) messages.push({ seq, at, role: 'user', text });
    } else if (item.type === 'agentMessage' && typeof item.text === 'string') messages.push({ seq, at, role: 'assistant', text: item.text });
    // Reasoning, tool arguments and environment/config items are not surfaced.
  }
  const bounded = Math.min(2000, Math.max(1, Number.isInteger(limit) ? limit : 500));
  return { exists: true, messages: messages.slice(-bounded), lastSeq: seq };
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n'); } catch { return null; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => isObj(c) && c.type === 'text').map((c) => c.text).join('\n');
}

export function readMessages(file, { afterSeq = -1, limit = 500 } = {}) {
  const lines = readLines(file);
  if (!lines) return { exists: false, messages: [], lastSeq: -1 };
  const out = [];
  let lastSeq = -1;
  const tail = lines.length - 1; // 줄바꿈으로 끝나지 않은 마지막 조각(파일이 줄바꿈으로 끝나면 빈 문자열)
  lines.forEach((line, seq) => {
    if (!line.trim()) return;
    if (seq <= afterSeq) { lastSeq = seq; return; } // 이미 본 줄은 다시 파싱하지 않는다
    let o; try { o = JSON.parse(line); } catch {
      // 아직 쓰는 중인 마지막 조각은 lastSeq에 넣지 않는다. 다 쓰인 뒤 다음 읽기에서 읽는다(이슈 #1-4)
      if (seq !== tail) lastSeq = seq;
      return;
    }
    lastSeq = seq;
    if (!isObj(o) || o.isSidechain || o.isMeta) return; // null이나 객체가 아닌 줄은 건너뛴다(이슈 #1-5)
    const at = o.timestamp ? Date.parse(o.timestamp) : null;
    if (o.type === 'user' && isObj(o.message)) {
      const c = o.message.content;
      if (typeof c === 'string') out.push({ seq, at, role: 'user', text: unwrapPasted(c) });
      else if (Array.isArray(c)) {
        for (const part of c) {
          if (!isObj(part)) continue;
          if (part.type === 'tool_result') out.push({ seq, at, role: 'tool_result', toolUseId: part.tool_use_id, isError: !!part.is_error, text: clip(typeof part.content === 'string' ? part.content : textOf(part.content), 2000) });
          else if (part.type === 'text') out.push({ seq, at, role: 'user', text: unwrapPasted(part.text) });
        }
      }
    } else if (o.type === 'assistant' && isObj(o.message) && Array.isArray(o.message.content)) {
      for (const part of o.message.content) {
        if (!isObj(part)) continue;
        if (part.type === 'text' && part.text) out.push({ seq, at, role: 'assistant', text: part.text });
        else if (part.type === 'tool_use') out.push({ seq, at, role: 'tool_use', tool: part.name, toolUseId: part.id, input: part.input });
      }
    }
  });
  return { exists: true, messages: out.slice(-limit), lastSeq };
}

// 사람이 쓴 지시가 아니라 Claude Code가 대화 기록에 남기는 표시(거부·중단, 슬래시 명령 출력 등). 마지막 지시로 보지 않는다(P3 브리핑)
export const isSyntheticUserText = (t) => /^\s*(\[Request interrupted|\[Tool call interrupted|<(local-command|command-name|command-message|command-args|system-reminder)\b)/.test(String(t || ''));

// C2(백엔드 재시작)에서 놓친 hook을 메운다: 마지막 지시, 마지막 답, 마지막 턴이 끝났는지. E2 브리핑도 쓴다
// 복구·확인용이라 개수 제한 없이 본다(이슈 #1-6). 화면용 제한(session.messages 등)은 그대로다
export function lastExchange(file) {
  const { exists, messages } = readMessages(file, { limit: Infinity });
  if (!exists) return { exists: false };
  let lastUser = null, lastAnswer = null;
  for (const m of messages) {
    if (m.role === 'user' && isSyntheticUserText(m.text)) continue;
    if (m.role === 'user') { lastUser = m; lastAnswer = null; }
    else if (m.role === 'assistant') lastAnswer = m;
  }
  return { exists: true, lastPrompt: lastUser && lastUser.text, lastPromptAt: lastUser && lastUser.at, lastAnswer: lastAnswer && lastAnswer.text, lastAnswerAt: lastAnswer && lastAnswer.at };
}

// 보낸 시각 뒤에 제출된 사용자 지시들(전달 확인 보정용)
export function userPromptsSince(file, sinceMs) {
  const { messages } = readMessages(file, { limit: Infinity });
  return messages.filter((m) => m.role === 'user' && m.at && m.at >= sinceMs - 2000).map((m) => m.text);
}
