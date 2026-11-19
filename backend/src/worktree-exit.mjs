// P71: `claude -w` 세션의 워크트리 나가기 질문. 세션이 끝날 때 Claude Code가 "Exiting worktree session"을 묻는다(screen.mjs parseWorktreeExit).
// - 판이 세션을 끝낼 때(닫기, 잠재우기, 판 설정으로 다시 띄우기) /exit 뒤에 이 질문이 뜨면 고른 답을 보낸다. 사람이 지우기를 고르지 않았으면 남기기다.
// - 신뢰 질문과는 상관없다(신뢰는 지금처럼 대신 답하지 않는다).
// b는 backend.mjs의 Backend(adapter, store, cfg를 쓴다).
import { parseWorktreeExit } from './screen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function visible(b, s) {
  try { return await b.adapter.readScreen(s.paneId, { source: 'visible' }); } catch { return ''; }
}

// `claude -w`로 띄운 세션인가. 하위 세션의 --worktree(info), 또는 작업 폴더가 <저장소>/.claude/worktrees/<이름> 안. → { name } | null
export function worktreeOf(s, info = null) {
  if ((s.kind || 'claude') !== 'claude') return null;
  if (info && info.worktree) return { name: info.worktree };
  const m = String((s.rt && s.rt.cwd) || s.cwd || '').match(/[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/);
  return m ? { name: m[1] } : null;
}

// 화면에 질문이 있으면 고른 답(keep|remove)의 번호를 보낸다. → 보낸 선택지 | null. screen을 주면 화면을 다시 읽지 않는다(P105)
export async function answerWorktreeExitOnScreen(b, s, choice, by, screen = null) {
  const pane = s.paneId, rt = s.rt, agent = rt?.term?.agentSessionId;
  const w = parseWorktreeExit(screen != null ? screen : await visible(b, s));
  if (!w || s.paneId !== pane || s.rt !== rt || rt?.term?.agentSessionId !== agent || (b.sessions && b.sessions.get(s.sessionId) !== s)) return null;
  const c = choice === 'remove' ? w.remove : w.keep;
  await b.adapter.paneKeys(pane, [String(c.n)]);
  b.store.addEvent(s.sessionId, 'worktree_exit_answered', { choice, label: c.label, commits: w.commits, files: w.files, by });
  return c;
}

// /exit를 보낸 뒤 claude가 끝나기를 ms까지 기다린다. 그동안 질문이 뜨면 고른 답(기본 남기기)을 한 번 보낸다. → 기다린 시간(ms)
export async function waitClaudeExit(b, s, ms, opts = {}) { return (await waitClaudeExitOr(b, s, ms, opts)).ms; }

// P105: stopOn(화면 글 → 참 같은 값이면 멈춤)을 주면 기다리는 동안 화면을 계속 보고, 그 값이 나오면 그 자리에서 멈춘다
// (잠재우기의 "뒤 일이 돈다" 확인 창). → { ms, stopped: stopOn이 돌려준 값 | null }
// P119: 기다리는 동안 rt.boardExit를 두어(이미 있으면 그대로) 판이 답할 나가기 질문이 응답 필요로 보이지 않게 한다(state.mjs boardClosing).
// 막혔는데 화면이 나가기 질문이 아닌 것을 두 번 연달아 보면 판이 모르는 질문이라 사람에게 남긴다(foreign → 다시 응답 필요).
export async function waitClaudeExitOr(b, s, ms, { worktree = 'keep', by = 'close', steps = null, stopOn = null } = {}) {
  const t0 = Date.now();
  const pane = s.paneId, rt = s.rt;
  const current = () => (b.samePane ? b.samePane(s, pane) : s.paneId === pane) && s.rt === rt && (!b.sessions || b.sessions.get(s.sessionId) === s);
  const claude = (s.kind || 'claude') === 'claude';
  let answered = !claude, readAt = 0, strange = 0;
  const own = beginBoardExit(b, s, by);
  try {
    while (current() && s.rt.term.present && Date.now() - t0 < ms) {
      if (claude && (!answered || stopOn) && Date.now() - readAt >= 400) {
        readAt = Date.now();
        const screen = await visible(b, s);
        if (!current()) break;
        if (stopOn) { const hit = stopOn(screen); if (hit) return { ms: Date.now() - t0, stopped: hit }; }
        if (!answered) {
          const c = await answerWorktreeExitOnScreen(b, s, worktree === 'remove' ? 'remove' : 'keep', by, screen);
          if (c) { answered = true; if (steps) steps.push(`worktree exit: ${c.n}. ${c.label}`); }
          else if (s.rt.term.status === 'blocked' && !parseWorktreeExit(screen)) {
            if (++strange >= 2 && s.rt.boardExit && !s.rt.boardExit.foreign) { s.rt.boardExit.foreign = true; if (steps) steps.push('unknown dialog: left to the human'); if (b.broadcastSession) b.broadcastSession(s, { cause: `${by}:unknown_dialog` }); }
          } else strange = 0;
        }
      }
      await sleep(200);
    }
    return { ms: Date.now() - t0, stopped: null };
  } finally { if (own) endBoardExit(b, s); }
}

// P119: 판이 /exit를 보내기 직전에 부른다. → 이번에 둔 것인가(그렇다면 끝에 endBoardExit)
export function beginBoardExit(b, s, by) {
  if (s.rt.boardExit) return false;
  s.rt.boardExit = { by, at: Date.now() };
  if (s.rt.term.status === 'blocked' && b.broadcastSession) b.broadcastSession(s, { cause: `${by}:board_exit` }); // 이미 떠 있는 나가기 질문을 바로 거둔다
  return true;
}
export function endBoardExit(b, s) {
  if (!s.rt.boardExit) return;
  const shown = s.rt.term.present && s.rt.term.status === 'blocked';
  delete s.rt.boardExit;
  if (shown && b.broadcastSession) b.broadcastSession(s, { cause: 'board_exit:end' }); // 끝나지 않고 남은 질문은 사람에게 보인다
}
