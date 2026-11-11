// 답하기(ARCH 4절 A1, 5절, E9): 승인 카드의 답을 Claude Code 대화상자에 넣을 키 순서로 바꾼다.
// 커서 위치에 기대지 않도록 숫자 키를 기본으로 쓴다. 판은 ctrl+g(외부 편집기, 메모장이 뜬다)를 보내지 않는다.
// 대화로 이어지는 선택지("Chat about this", "Tell Claude what to change")와 신뢰 대화상자는 카드에서 답하지 않는다.
//
// 답(answer):
//   { choice: n }                  권한·계획의 n번, 질문 하나(단일 선택)의 n번
//   { choice: n, text }            질문의 "Type something"(자유 입력)
//   { choice: 'reject' }           권한 거부, 질문 취소(esc)
//   { choice: 'amend', text }      권한 승인하면서 지시 덧붙이기(tab, 글, enter)
//   { picks: [n, ...] }            여러 개 고르기(질문 하나) 또는 질문 여러 개(질문마다 번호 하나)
// 결과 steps: [{ keys: [...] } | { text }]. 단계 사이에 화면이 바뀔 시간을 준다.

const KEY_RE = /^([1-9]|esc|enter|tab|down|up|space)$/;

function answerError(code, message) { return Object.assign(new Error(message), { code }); }
const inTerminal = (what) => answerError('answer_in_terminal', `${what}: 카드에서는 응답할 수 없습니다. 터미널에서 직접 응답하세요.`);

function oneLine(text) {
  const t = String(text ?? '').replace(/\r\n?|\n/g, ' ').trim(); // pane.send_text에 CR을 넣지 않는다(B1 규칙 5, E4)
  if (!t) throw answerError('bad_request', "내용을 입력하세요.");
  return t;
}
function intIn(n, lo, hi, what) {
  if (!Number.isInteger(n) || n < lo || n > hi) throw answerError('bad_request', `${what}: ${n}(가능 ${lo}~${hi})`);
  return n;
}

export function planAnswer(ask, a = {}) {
  if (!ask) throw answerError('no_pending_ask', "응답을 기다리는 요청이 없습니다.");
  const kind = ask.kind;
  if (kind === 'unknown_dialog') throw inTerminal('알 수 없는 대화상자');
  const choice = a.choice;

  // P71: 워크트리 나가기 질문. { choice: 'keep' } 남기기, { choice: 'remove', confirm: true } 지우기(브랜치와 커밋도 지워진다. 한 번 더 묻고 보낸다)
  if (kind === 'worktree_exit') {
    if (choice === 'keep') return { steps: [{ keys: [String(ask.keep.n)] }], label: `${ask.keep.n}. ${ask.keep.label}` };
    if (choice === 'remove') {
      if (a.confirm !== true) throw answerError('needs_confirm', '워크트리를 지우면 브랜치와 커밋도 지워집니다. confirm: true로 한 번 더 확인하세요.');
      return { steps: [{ keys: [String(ask.remove.n)] }], label: `${ask.remove.n}. ${ask.remove.label}` };
    }
    throw answerError('bad_request', `워크트리 질문에는 keep 또는 remove로 답하세요: ${choice}`);
  }

  if (kind === 'permission') {
    if (choice === 'reject') return { steps: [{ keys: ['esc'] }], label: '거부' };
    if (choice === 'amend') return { steps: [{ keys: ['tab'] }, { text: oneLine(a.text) }, { keys: ['enter'] }], label: "승인 및 지시 추가" };
    const choices = ask.choices || [];
    const n = intIn(choice, 1, Math.max(1, choices.length), '권한 선택지 번호'); // 화면에서 선택지를 아직 못 읽었으면 1(승인)만 받는다
    const c = choices[n - 1];
    if (c && /^No\b/i.test(c.label)) return { steps: [{ keys: ['esc'] }], label: `거부(${n}. ${c.label})` }; // 거부는 번호가 바뀌어도 esc
    return { steps: [{ keys: [String(n)] }], label: c ? `${n}. ${c.label}` : `${n}` };
  }

  if (kind === 'plan') {
    const choices = ask.choices || [];
    if (!choices.length) throw answerError('choices_unknown', "화면에서 계획 승인 선택지를 아직 확인하지 못했습니다.");
    const n = intIn(choice, 1, choices.length, '계획 선택지 번호');
    if (/tell claude what to change/i.test(choices[n - 1].label)) throw inTerminal('"Tell Claude what to change"');
    return { steps: [{ keys: [String(n)] }], label: `${n}. ${choices[n - 1].label}` };
  }

  if (kind === 'question') {
    const qs = ask.questions || [];
    if (!qs.length) throw answerError('bad_request', "질문 내용이 없습니다.");
    if (choice === 'reject') return { steps: [{ keys: ['esc'] }], label: '질문 취소' };
    if (qs.length === 1 && !qs[0].multiSelect) {
      const opts = qs[0].options.length;
      const n = intIn(choice, 1, opts + 2, '질문 선택지 번호');
      if (n === opts + 2) throw inTerminal('"Chat about this"');
      if (n === opts + 1) return { steps: [{ keys: [String(n)] }, { text: oneLine(a.text) }, { keys: ['enter'] }], label: `직접 입력: ${oneLine(a.text)}` };
      return { steps: [{ keys: [String(n)] }], label: `${n}. ${qs[0].options[n - 1]}` };
    }
    const picks = Array.isArray(a.picks) ? a.picks : null;
    if (!picks || !picks.length) throw answerError('bad_request', "picks에 선택한 항목의 번호를 지정하세요.");
    if (qs.length === 1) { // 여러 개 고르기: 번호로 켜고, Submit까지 내려가 enter, 확인 화면에서 enter(E9 Q6)
      const opts = qs[0].options.length;
      const uniq = [...new Set(picks)].map((n) => intIn(n, 1, opts, "선택지 번호"));
      return { steps: [{ keys: uniq.map(String) }, { keys: Array(opts + 1).fill('down') }, { keys: ['enter'] }, { keys: ['enter'] }], label: uniq.map((n) => qs[0].options[n - 1]).join(', ') };
    }
    if (qs.some((q) => q.multiSelect)) throw inTerminal("복수 선택 질문이 포함되어 있습니다.");
    if (picks.length !== qs.length) throw answerError('bad_request', `질문 ${qs.length}개에 답 ${picks.length}개`);
    const keys = picks.map((n, i) => String(intIn(n, 1, qs[i].options.length, `질문 ${i + 1} 번호`)));
    return { steps: [{ keys }, { keys: ['enter'] }], label: picks.map((n, i) => qs[i].options[n - 1]).join(' / ') }; // 질문마다 번호, 확인 화면에서 enter(E9 Q7)
  }
  throw answerError('bad_request', `알 수 없는 요청 종류입니다: ${kind}`);
}

// 보내기 직전에 쓰는 키가 허용 목록 안에 있는지(ctrl+g 같은 키가 섞이지 않게)
export function checkSteps(steps) {
  for (const s of steps) if (s.keys && !s.keys.every((k) => KEY_RE.test(k))) throw answerError('bad_request', `허용되지 않은 키입니다: ${s.keys.join(',')}`);
  return steps;
}

// 카드가 가리키는 요청이 지금 기다리는 요청과 같은가(PreToolUse의 tool_use_id, 없으면 시작 시각)
export function sameAsk(ask, card = {}) {
  if (!ask) return false;
  if (card.toolUseId && ask.toolUseId) return card.toolUseId === ask.toolUseId;
  if (card.since) return card.since === ask.since;
  return true;
}
