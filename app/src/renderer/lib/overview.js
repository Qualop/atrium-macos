// P85: 멀리 보기에서 일하는 세션과 쉬는 세션을 갈라 보인다.
// - 강조 등급(tierOf): 상태에서 고른다. 일함(work: working, starting, 명령이 도는 셸, 깨우는 중)은 앞으로, 쉼(rest)·잠듦(sleep)·끝남(done)은 뒤로.
//   내 차례(turn: waiting, trust_wait, worktree_exit)와 오류(alert)는 따로 눈에 띄고, 검토 대기(review: 끝난 턴을 아직 안 봄)는 그 사이다.
// - "작업 중만 또렷하게"(spotlight): 일함·내 차례·오류 밖의 노드를 더 물린다. 이 창 프로필의 localStorage(mt.spotlight)에 둔다(판 설정이 아니다).
//   켜면 문서 뿌리에 mt-spot 클래스를 단다(styles.css).
export const TIERS = ['work', 'turn', 'alert', 'review', 'rest', 'sleep', 'done'];

export function tierOf(s) {
  if (!s) return 'rest';
  if (s.waking) return 'work';
  switch (s.state) {
    case 'working': case 'starting': case 'shell_running': return 'work';
    case 'waiting': case 'trust_wait': case 'worktree_exit': return 'turn';
    case 'error': return 'alert';
    case 'sleeping': return 'sleep';
    case 'exited': return 'done';
    case 'ready': case 'shell_idle': return s.unseen ? 'review' : 'rest';
    default: return 'rest';
  }
}
// 판 밖 대화 카드: 판은 그 대화가 턴을 도는지 모른다. 터미널에 열려 있으면 쉼, 닫혔으면 끝남
export const convoTier = (binding) => (binding && binding.open ? 'rest' : 'done');
// 일하는 노드만 둘레가 돈다(터미널을 보는 가까이 얼굴은 빼고)
export const runsRing = (tier, face) => tier === 'work' && face !== 'close';
// 도는 둘레의 회전판 한 변(월드 px): 둘레 상자(노드 + 화면 기준 바깥 여백)의 대각선
export const ringDiag = (w, h, zoom, pad = 4) => { const p = (2 * pad) / Math.max(Number.isFinite(zoom) ? zoom : 1, 0.02); return Math.ceil(Math.hypot((w || 0) + p, (h || 0) + p)) + 2; };

export const SPOT_KEY = 'mt.spotlight';
export function loadSpot(storage) { try { return !!storage && storage.getItem(SPOT_KEY) === '1'; } catch { return false; } }
export function saveSpot(storage, on) {
  try { if (storage) { if (on) storage.setItem(SPOT_KEY, '1'); else storage.removeItem(SPOT_KEY); } } catch { /* 저장소를 못 쓰면 이 창에서만 */ }
  return !!on;
}
export function applySpot(on, doc = globalThis.document) { try { doc.documentElement.classList.toggle('mt-spot', !!on); } catch { /* 문서가 없으면(단위 시험) 넘긴다 */ } }
