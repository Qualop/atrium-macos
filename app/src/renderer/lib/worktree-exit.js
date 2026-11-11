// P71: `claude -w` 세션의 닫기 확인에서 고르는 워크트리 답.
// P104: 워크트리 나가기 질문(ask.kind worktree_exit)에 답하던 승인 줄과 그 글(한 줄, 지우기 경고)은 뺐다. 사람은 터미널에서 고른다

// 닫기 확인에서 고른 워크트리 답 → session.kill에 넘길 값. 고르지 않았으면 남기기다(지우기는 사람이 고를 때만)
export const killWorktreeParam = (wt, choice) => (wt ? { worktree: choice === 'remove' ? 'remove' : 'keep' } : {});
