// P125: 사람이 스스로 끝낸 세션(사람이 닫음)과 다시 열기의 순수 함수(단위 시험 app/test/p125-lib.test.mjs).
// 백엔드(state.mjs exitKind)가 판이 끄라고 하지 않았는데 사람이 끝낸 것(Ctrl+C 두 번, /exit, 콘솔 Ctrl+C)을 exit.kind 'user'로 둔다.
// 그것은 오류·문제 목록·사이드바 오류 묶음에 넣지 않고, 노드는 같은 자리에 "직접 종료"로 남아 사이드바의 "다시 열기"로 같은 대화를 잇는다.
export const exitKindOf = (s) => (s && s.state === 'exited' && s.exit && s.exit.kind) || null;
export const userClosed = (s) => exitKindOf(s) === 'user';
// 사람이 봐야 하는 끝남(오류 코드·충돌·까닭 모름, 신뢰 거부, 터미널 서버 꺼짐). 판이 끈 것(normal)과 사람이 닫은 것(user)은 아니다
export function problemExit(s) {
  const k = exitKindOf(s);
  return !!k && k !== 'normal' && k !== 'user';
}
// 캔버스의 끝난 세션을 같은 자리에서 다시 열 수 있나(셸은 끝나면 닫히고, 깨우는 중이면 기다린다)
export const canReopen = (s) => !!s && s.state === 'exited' && s.kind !== 'shell' && !s.waking;
