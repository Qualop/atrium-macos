// 보낸 글과 hook `prompt`를 맞춰 보는 규칙(ARCH 4절 B1 규칙 6, E3).

const WRAP = /\n*<pasted_content id="([0-9a-f]+)">\n([\s\S]*?)\n<\/pasted_content id="\1">\n?/g;

// Claude Code가 4줄 이상이거나 800자를 넘는 붙여넣기를 감싼 `<pasted_content>`를 벗긴다. 대화 보기에도 쓴다.
export function unwrapPasted(s) {
  if (typeof s !== 'string') return s;
  return s.replace(WRAP, (_, _id, inner) => inner);
}

// P153 r13: 판이 세션에 보낸 알림(연결·관계·하위 세션 알림. "[Atrium 보드] …", 옛 이름 "[Atrium 판]", "[multitask 판]")인가.
// 알림은 그 세션의 일이 아니라서 마지막 지시(lastPrompt: 카드의 지금·마지막 일, 미리 보기, 휴대폰 대기 카드, 사이드바 일 줄)가 되지 않는다(그 앞 지시가 남는다).
// 대화 보기·전달 기록에는 그대로 남는다
const BOARD_NOTICE = /^\s*\[(?:atrium|multitask|mtask)\s*(?:보드|판)\]/i;
// P159: 하위·동료의 첫 요청은 판의 관계 줄("[Atrium 보드] 관계: …") 한 줄 뒤에 진짜 지시가 온다. 그 줄만 떼면 일이고 알림이 아니다
const RELATION_LINE = /^\s*\[(?:atrium|multitask|mtask)\s*(?:보드|판)\]\s*관계:[^\n]*(?:\n|$)/i;
// P164 뒤: 뒤 일(뒤 셸·뒤 하위 에이전트)이 끝나면 Claude Code가 `<task-notification>` 글로 새 턴을 연다. 사람·에이전트의 지시가 아니라 알림이다
const HARNESS_NOTICE = /^\s*<task-notification>/;
// 지시로 보일 글: 알림이 아니면 그대로(붙여넣기 벗김), 관계 줄 + 지시면 관계 줄만 뗀 나머지, 알림뿐이면 null
export function promptTask(s) {
  if (typeof s !== 'string') return null;
  const u = unwrapPasted(s);
  if (HARNESS_NOTICE.test(u)) return null;
  if (!BOARD_NOTICE.test(u)) return u;
  const m = u.match(RELATION_LINE);
  if (!m) return null;
  const rest = u.slice(m[0].length).replace(/^\s+/, '');
  return rest && !BOARD_NOTICE.test(rest) ? rest : null;
}
export function isBoardNotice(s) { return typeof s === 'string' && promptTask(s) === null; }

// 판이 보내기 전에 글을 맞춘다: 줄바꿈을 LF로(B1 규칙 5)
export function toLF(s) { return String(s).replace(/\r\n?/g, '\n'); }

function norm(s) { return toLF(s).replace(/\t/g, '    ').trim(); }

// 보낸 글(sent)이 hook의 prompt로 제출된 것인가
export function promptMatches(sent, hookPrompt) {
  if (typeof hookPrompt !== 'string') return false;
  return norm(sent) === norm(unwrapPasted(hookPrompt));
}

// "@a @b 내용" → { targets: ['a','b'], text: '내용' }
export function parseTargets(line) {
  const m = String(line).match(/^\s*((?:@[^\s@]+\s*)+)([\s\S]*)$/);
  if (!m) return { targets: [], text: String(line) };
  return { targets: m[1].trim().split(/\s+/).map((t) => t.slice(1)), text: m[2].replace(/^\s/, '') };
}

export function clip(s, n = 200) { if (typeof s !== 'string') return s; return s.length > n ? s.slice(0, n) + '…' : s; }
