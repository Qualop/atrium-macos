// 세션에 들어가기와 손대기(ARCH 4절 E2). 들어갈 때 브리핑은 P45에서 뺐다(누르면 바로 그 세션을 쓴다). 나올 때의 한 줄 메모는 P22에서 뺐다.
// 들어가거나(칩·N·알림으로 가거나 노드를 누름) 손대면 백엔드에 손댄 시각을 남긴다(session.touch). 잠재우기(P21)가 이 시각을 본다.
import { api } from './api.js';

let current = null; // { id, at }

export function enterSession(id) {
  if (current && current.id === id) return;
  current = { id, at: Date.now() };
  api.call('session.touch', { session: id }).catch(() => {});
}

// 그 세션에 실제로 손댔다(터미널 입력, 카드 답). 들어가지 않은 채 손댔으면 들어간 것으로 본다
export function markInteracted(id) {
  if (!current || current.id !== id) enterSession(id);
}
