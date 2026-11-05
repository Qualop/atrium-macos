// P50(#6): 빈 판의 첫 걸음 안내를 보일지. 순수 함수(단위 시험 app/test/p50-lib.test.mjs). 부르는 곳은 Canvas.jsx의 EmptyHint.
// 판을 다 읽었고, 워크스페이스, 세션, 메모·칸반, 판 밖 대화 노드가 하나도 없을 때만 보인다. 무엇이든 하나 생기면 사라진다.
const size = (x) => (x == null ? 0 : typeof x.size === 'number' ? x.size : x.length || 0);
export function boardEmpty({ loaded, workspaces, sessions, memos, kanbans, convoNodes }) {
  return !!loaded && [workspaces, sessions, memos, kanbans, convoNodes].every((x) => size(x) === 0);
}
