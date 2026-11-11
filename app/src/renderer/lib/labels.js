// 화면에 보이는 글: 상태 필, 전달 상태, 기다린 시간(ARCH 3절, 4절 B1). 글은 사전(locales/)에 있다(P16)

import { t } from './i18n.js';

// 열쇠 → 글. 언어가 바뀌면 다시 찾으므로 객체처럼 읽되 그때의 언어로 돌려준다(STATE_LABEL[s.state])
const labelMap = (ns, keys) => new Proxy({}, {
  get: (_, k) => (typeof k === 'string' && keys.includes(k) ? t(`${ns}.${k}`) : undefined),
  has: (_, k) => keys.includes(k),
  ownKeys: () => keys,
  getOwnPropertyDescriptor: (_, k) => (keys.includes(k) ? { enumerable: true, configurable: true, value: t(`${ns}.${k}`) } : undefined),
});

export const STATE_LABEL = labelMap('state', ['starting', 'trust_wait', 'ready', 'working', 'waiting', 'error', 'exited', 'shell_idle', 'shell_running', 'sleeping']);
export const EXIT_LABEL = labelMap('exit', ['normal', 'herdr_stopped', 'trust_declined', 'other']);
export const DELIVERY_LABEL = labelMap('delivery', ['queued', 'sending', 'sent', 'confirmed', 'unconfirmed', 'failed', 'cancelled']);
export const WAIT_REASON_LABEL = labelMap('waitReason', ['waiting', 'starting', 'trust_wait', 'working', 'user_typing', 'no_agent', 'herdr_down', 'sleeping']);

export function deliveryText(d) {
  const base = DELIVERY_LABEL[d.status] || d.status;
  if (!d.reason) return base;
  if (d.reason === 'typed') return t('delivery.withReason', { base, reason: t('typeNow.typed') }); // P90: 일하는 중에 Claude Code 대기 메시지로 넣었다
  if (d.status === 'queued' && d.reason === 'draft') return t('delivery.withReason', { base, reason: t('typeNow.draft') });
  if (d.status === 'queued') return t('delivery.withReason', { base, reason: WAIT_REASON_LABEL[d.reason] || d.reason });
  if (d.status === 'cancelled' && d.reason === 'user') return base;
  return t('delivery.withReason', { base, reason: d.reason });
}

// 지난 시간(12초, 3분 4초, 1시간 2분 / 12s, 3m 4s, 1h 2m)
export function ago(at, now = Date.now()) {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return t('time.s', { s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('time.ms', { m, s: s % 60 });
  return t('time.hm', { h: Math.floor(m / 60), m: m % 60 });
}
// "3분 전" / "3m ago"
export const agoText = (at, now) => (at ? t('time.ago', { d: ago(at, now) }) : '');

// 내 차례 칩과 요약 얼굴에 쓰는 한 줄
export function askLine(s) {
  if (s.state === 'trust_wait') return t('ask.trust');
  const a = s.ask;
  if (!a) return '';
  if (a.kind === 'question') return t('ask.question', { q: (a.questions || []).map((q) => q.question).join(' / ') });
  if (a.kind === 'plan') return t('ask.plan');
  if (a.kind === 'unknown_dialog') return t('ask.unknownDialog');
  if (a.kind === 'worktree_exit') return t('wtExit.title');
  if (a.kind === 'screen') return t('ask.screen', { kind: s.kind || t('ask.agent') });
  return t('ask.permission', { what: a.summary || a.tool });
}

// P6a(P4 6절 9번): 선 위 글이 옆 노드를 가리지 않게, 두 노드 사이 틈에 맞춰 글 폭을 줄인다. 틈이 좁으면 짧은 표시(역할 앞부분과 받는 쪽 상태)만 두고,
// 글 위에 마우스를 올리면 다 보인다. 틈은 Canvas가 data.gap(판 좌표)과 data.horizontal로 준다
export function labelFit(data) {
  const gap = data && Number.isFinite(data.gap) ? data.gap : 1e9;
  if (data && data.horizontal === false) return gap >= 34 ? { maxWidth: 460, compact: false } : { maxWidth: 160, compact: true };
  const room = gap - 12;
  return room >= 160 ? { maxWidth: Math.min(460, room), compact: false } : { maxWidth: Math.max(26, room), compact: true };
}
