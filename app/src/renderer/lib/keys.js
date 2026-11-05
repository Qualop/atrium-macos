// H4(P6a): 노드를 눌러 들어간 뒤 터미널이 붙기 전에 친 키를 터미널 입력(글자열)으로 바꾼다. 순수 함수만 둔다(단위 시험 있음).
// 붙은 뒤에는 xterm.js가 직접 받는다. 한글 조합(IME) 중인 키는 바꾸지 않는다(조합이 끝난 글자는 붙은 뒤에 친다).

const SPECIAL = {
  Enter: '\r', Backspace: '\x7f', Tab: '\t', Escape: '\x1b',
  ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
  Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~',
};

// e: { key, ctrlKey, altKey, metaKey, isComposing } → 보낼 글자열, 또는 null(모으지 않는다)
export function keyToData(e) {
  if (!e || e.isComposing || e.key === 'Process' || e.key === 'Dead' || e.metaKey) return null;
  if (e.ctrlKey && !e.altKey) {
    if (/^[a-z]$/i.test(e.key)) {
      const k = e.key.toLowerCase();
      if (k === 'g') return null; // 외부 편집기(판에서 막는다, P2)
      if (k === 'v' || k === 'c' || k === 'f' || k === 'k') return null; // 붙여넣기·복사와 판의 단축키
      return String.fromCharCode(k.charCodeAt(0) - 96);
    }
    return null;
  }
  if (SPECIAL[e.key]) return (e.altKey ? '\x1b' : '') + SPECIAL[e.key];
  if (e.key && [...e.key].length === 1) return (e.altKey ? '\x1b' : '') + e.key;
  return null;
}

// P22: Delete 키로 닫을 세션. 고른 노드 중 판에 있는 세션 노드만(메모·칸반은 selected에 없다). 대화상자가 열려 있거나 조합 키면 닫지 않는다.
// 입력 칸·터미널·메모 편집 중인지는 부르는 쪽(main.jsx editable)이 먼저 본다 → null | { one: id } | { many: [id…] }
export function closeKeyTargets(e, { selected = [], sessions = new Map(), dialog = null } = {}) {
  if (!e || e.key !== 'Delete' || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || dialog) return null;
  const ids = selected.filter((id) => sessions.has(id));
  if (!ids.length) return null;
  return ids.length === 1 ? { one: ids[0] } : { many: ids };
}

// P28: 닫기 확인(보관·삭제·취소)이 떠 있을 때의 키. Delete를 한 번 더 누르면 "삭제"를 고른다(초점과 표시만, Enter로 확정), Esc는 취소다.
// 조합 키, 한글 조합 중, 입력 칸·터미널 안에서 친 키는 보지 않는다 → 'arm' | 'cancel' | null
export function confirmKey(e) {
  if (!e || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (t.closest && t.closest('.xterm')))) return null;
  if (e.key === 'Delete') return 'arm';
  if (e.key === 'Escape') return 'cancel';
  return null;
}

// P43: 판에 키보드 초점이 있을 때의 방향키. 아래 = 명령 바에 초점, 위 = 찾기 바(Ctrl+F와 같다), 왼쪽 = 고르기·잇기 도구 바꾸기,
// 오른쪽 = 정하지 않았다('none': 받기만 하고 아무것도 하지 않는다. React Flow가 고른 노드를 옮기지 않게).
// 판에 초점이 있다 = 초점이 문서 몸통(빈 캔버스를 누른 뒤 등)이거나 판 칸(.mt-stage: 캔버스, 노드 테두리, 떠 있는 단추) 안의 글을 받지 않는 곳.
// 글을 받는 곳(입력칸, 터미널), 대화상자·메뉴·펼침 목록·찾기 바 안, 사이드바, 덮개(미션 맵, 출력 보기)가 열린 때, 노드에 들어가 터미널이 붙기를
// 기다리는 동안(pending: 친 키는 터미널로 간다)에는 받지 않는다. 조합 키(Shift 포함), 한글 조합 중, 누르고 있어 되풀이되는 키도 받지 않는다
// → 'command' | 'search' | 'tool' | 'none' | null(판의 키가 아니다. 그대로 둔다)
const ARROWS = { ArrowDown: 'command', ArrowUp: 'search', ArrowLeft: 'tool', ArrowRight: 'none' };
const NOT_BOARD = '.mt-modal, .mt-modal-bg, [role="dialog"], [role="menu"], [role="listbox"], .mt-menu, .mt-dropdown, .mt-search, .mt-mission, .mt-output';
export function boardArrowKey(e, { dialog = null, missionOpen = false, outputOpen = false, pending = false } = {}) {
  if (!e || !ARROWS[e.key] || e.isComposing || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  if (dialog || missionOpen || outputOpen || pending) return null;
  const t = e.target;
  const body = !t || t.tagName === 'BODY' || t.tagName === 'HTML' || t.nodeType === 9;
  if (!body) {
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return null;
    if (!t.closest || t.closest('.xterm') || t.closest(NOT_BOARD) || !t.closest('.mt-stage')) return null;
  }
  return ARROWS[e.key];
}
