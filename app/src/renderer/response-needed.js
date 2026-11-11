// 읽기 전용 안내와 OS 알림은 같은 현재 세션의 터미널로 연결한다.
import { getState, toast } from './store.js';
import { t } from './lib/i18n.js';

export function openResponseTerminal(id) {
  const st = getState();
  if (!id || !st.sessions.has(id) || !st.navigateTo) { toast(t('response.unavailable'), 'error'); return false; }
  if (!st.dialog && typeof document !== 'undefined') document.activeElement?.blur?.();
  st.navigateTo(id, { focusTerminal: true });
  return true;
}
