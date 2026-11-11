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
  const pane = s.paneId, rt = s.rt, agent = rt?.herdr?.agentSessionId;
  const w = parseWorktreeExit(screen != null ? screen : await visible(b, s));
  if (!w || s.paneId !== pane || s.rt !== rt || rt?.herdr?.agentSessionId !== agent || (b.sessions && b.sessions.get(s.sessionId) !== s)) return null;
  const c = choice === 'remove' ? w.remove : w.keep;
  await b.adapter.paneKeys(pane, [String(c.n)]);
  b.store.addEvent(s.sessionId, 'worktree_exit_answered', { choice, label: c.label, commits: w.commits, files: w.files, by });
  return c;
}

// /exit를 보낸 뒤 claude가 끝나기를 ms까지 기다린다. 그동안 질문이 뜨면 고른 답(기본 남기기)을 한 번 보낸다. → 기다린 시간(ms)
export async function waitClaudeExit(b, s, ms, opts = {}) { return (await waitClaudeExitOr(b, s, ms, opts)).ms; }

// P105: stopOn(화면 글 → 참 같은 값이면 멈춤)을 주면 기다리는 동안 화면을 계속 보고, 그 값이 나오면 그 자리에서 멈춘다
// (잠재우기의 "뒤 일이 돈다" 확인 창). → { ms, stopped: stopOn이 돌려준 값 | null }
export async function waitClaudeExitOr(b, s, ms, { worktree = 'keep', by = 'close', steps = null, stopOn = null } = {}) {
  const t0 = Date.now();
  const pane = s.paneId, rt = s.rt;
  const current = () => s.paneId === pane && s.rt === rt && (!b.sessions || b.sessions.get(s.sessionId) === s);
  const claude = (s.kind || 'claude') === 'claude';
  let answered = !claude, readAt = 0;
  while (current() && s.rt.herdr.present && Date.now() - t0 < ms) {
    if (claude && (!answered || stopOn) && Date.now() - readAt >= 400) {
      readAt = Date.now();
      const screen = await visible(b, s);
      if (!current()) break;
      if (stopOn) { const hit = stopOn(screen); if (hit) return { ms: Date.now() - t0, stopped: hit }; }
      if (!answered) {
        const c = await answerWorktreeExitOnScreen(b, s, worktree === 'remove' ? 'remove' : 'keep', by, screen);
        if (c) { answered = true; if (steps) steps.push(`worktree exit: ${c.n}. ${c.label}`); }
      }
    }
    await sleep(200);
  }
  return { ms: Date.now() - t0, stopped: null };
}
