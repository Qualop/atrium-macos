// P21(ARCH 4절 D4 잠재우기) → P24: 리포 단위로 잠재우고 깨우는 단추가 부르는 것.
// 노드 메뉴의 "이 리포 깨우기", 잠든 얼굴, 노드를 눌러 들어갈 때(Canvas navigateTo), 영역 이름표 메뉴, 메모리 알약 목록
import { api } from './api.js';
import { toast, getState, subscribe } from './store.js';
import { t, errText } from './lib/i18n.js';

export const fmtMB = (x) => (x == null ? '?' : x >= 1024 ? `${(x / 1024).toFixed(1)}GB` : `${Math.round(x)}MB`);
const busy = new Set();

// 세션 id의 리포를 깨운다(그 세션을 먼저, 나머지는 백엔드가 차례로). 그 세션이 준비될 때까지 기다리고 결과를 알린다
export async function wakeSession(id, { quiet = false, why = 'hand' } = {}) {
  if (busy.has(id)) return null;
  busy.add(id);
  try {
    const r = await api.call('session.wake', { session: id, why });
    if (r && r.woke && !quiet) toast(r.repo && r.repo.waking > 1 ? t('sleep.wokeRepo', { name: r.name, n: r.repo.waking, s: ((r.ms || 0) / 1000).toFixed(1) }) : t('sleep.woke', { name: r.name, s: ((r.ms || 0) / 1000).toFixed(1) }));
    return r;
  } catch (e) { toast(t('sleep.wakeFailed', { error: errText(e) }), 'error'); return null; } finally { busy.delete(id); }
}

// 영역 이름표 메뉴: 이 리포 잠재우기·깨우기
export async function sleepRepo(key) {
  try {
    const r = await api.call('workspace.sleep', { workspace: key });
    toast(t('sleep.sleptRepo', { repo: r.name, n: r.slept, mb: fmtMB(r.savedMB) }));
    return r;
  } catch (e) { toast(t('sleep.sleepFailed', { error: errText(e) }), 'error'); return null; }
}
export async function wakeRepo(key) {
  try {
    const r = await api.call('workspace.wake', { workspace: key, wait: false });
    if (r.waking) toast(t('sleep.wakingRepo', { repo: r.name, n: r.waking }));
    return r;
  } catch (e) { toast(t('sleep.wakeFailed', { error: errText(e) }), 'error'); return null; }
}

// 쉬는 리포 모두(메모리 알약 목록. 트레이는 main이 같은 API를 부른다)
export async function sleepIdle() {
  try {
    const r = await api.call('workspace.sleepIdle');
    toast(r.slept ? t('sleep.sleepIdleDone', { repos: r.repos, n: r.slept, mb: fmtMB(r.savedMB) }) : t('sleep.sleepIdleNone'));
    return r;
  } catch (e) { toast(t('sleep.sleepFailed', { error: errText(e) }), 'error'); return null; }
}

// "지금 보고 있는 노드"를 백엔드에 알린다. 초점 노드는 창에 초점이 있고 가려지지 않았을 때만,
// 가까이 얼굴로 보이는 노드(P24: 제어기 상한 밖과 잠든 노드 포함)는 창이 가려지지 않았을 때. 터미널이 붙은 노드는 백엔드가 이미 안다
export function startViewingReport() {
  let last;
  const send = (force = false) => {
    const st = getState();
    const shown = typeof document !== 'undefined' && !document.hidden;
    const focus = shown && document.hasFocus() ? st.focusId || null : null;
    const close = shown ? st.closeIds : [];
    const key = JSON.stringify([focus, close]);
    if (!force && key === last) return;
    last = key;
    api.call('board.viewing', { focus, close }).catch(() => { last = undefined; });
  };
  subscribe(() => send());
  api.on('$open', () => send(true));
  window.addEventListener('focus', () => send());
  window.addEventListener('blur', () => send());
  document.addEventListener('visibilitychange', () => send());
}

// 잠든 세션 수와 잠들기 전에 잰 메모리 합(메모리 알약 풀이). key를 주면 그 리포만
export function asleepStats(sessions, key) {
  const list = [...sessions.values()].filter((s) => s.state === 'sleeping' && (key === undefined || (s.workspaceKey || '') === key));
  return { n: list.length, mb: list.reduce((a, s) => a + ((s.sleep && s.sleep.memMB) || 0), 0), list };
}

export { repoSleep, memByRepo, sleptAlone } from './lib/repo-sleep.js'; // P24: 순수 함수(단위 시험), P111: 혼자 잠든 세션
