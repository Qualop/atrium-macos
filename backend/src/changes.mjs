// 복귀 요약(ARCH 4절 A3): 마지막으로 본 뒤 바뀐 것만 한 줄씩. 판 이벤트 기록(SQLite events)에서 뽑는다. 순수 함수.
// 줄 종류: needs_you(새로 생긴 내 차례), error(오류), interrupted(재시작으로 끊긴 턴), exited(종료), turn_done(끝난 턴), herdr(herdr 꺼짐·켜짐), backend(백엔드 재시작, P53)
// 같은 세션의 같은 종류는 한 줄로 모으고 횟수를 센다.

import { m } from './msg.mjs'; // P16: 줄마다 화면 글 열쇠(msg)도 준다. text는 한국어 그대로(CLI)

export const CHANGE_KINDS = ['state', 'hook', 'closed', 'turn_interrupted', 'herdr_disconnected', 'herdr_connected', 'backend_started'];
const ORDER = { needs_you: 0, error: 1, interrupted: 2, exited: 3, turn_done: 4, herdr: 5, backend: 6 };

const EXIT_TEXT = { normal: '정상 종료', trust_declined: '신뢰하지 않아 끝남', other: '끝남' };
const EXIT_KEY = { normal: 'chgExitNormal', trust_declined: 'chgExitTrust', other: 'chgExited' };
function askMsg(ask) {
  if (!ask) return null;
  if (ask.kind === 'question') return m('chgQuestion', { q: (ask.questions || []).map((q) => q.question).join(' / ') });
  if (ask.kind === 'plan') return m('chgPlan');
  if (ask.kind === 'unknown_dialog') return m('chgUnknownDialog');
  return m('chgPermission', { what: ask.summary || ask.tool || '' });
}

function askText(ask) {
  if (!ask) return '';
  if (ask.kind === 'question') return `질문: ${(ask.questions || []).map((q) => q.question).join(' / ')}`;
  if (ask.kind === 'plan') return '계획 승인';
  if (ask.kind === 'unknown_dialog') return '알 수 없는 대화상자';
  return `권한: ${ask.summary || ask.tool || ''}`;
}
const one = (s, n = 120) => (typeof s === 'string' ? (s.replace(/\s+/g, ' ').trim().length > n ? s.replace(/\s+/g, ' ').trim().slice(0, n) + '…' : s.replace(/\s+/g, ' ').trim()) : '');

// P53(#10): 백엔드 시작(backend_started)이 재시작인지. 앞선 실행의 마지막 심장 박동(previousRun)이 있을 때만이다.
// 빈 데이터 폴더의 첫 시작에는 previousRun이 없다(backend.mjs)
export function isRestart(data) {
  return !!(data && data.previousRun && data.previousRun.lastHeartbeatAt);
}

// events: store.eventsAfter(since, CHANGE_KINDS), nameOf(sessionId) → 이름, current: sessionId → 지금 요약(없으면 판에서 닫힘)
export function summarizeChanges(events, { nameOf = () => null, current = new Map() } = {}) {
  const lines = new Map();
  // merge: 같은 일을 다른 이벤트가 한 번 더 알린다(끄기의 종료 상태와 판에서 빠짐). 횟수를 늘리지 않는다
  const add = (key, base, t, text, { merge = false, msg = null } = {}) => {
    const l = lines.get(key) || { ...base, count: 0, firstAt: t, lastAt: t, text: '', msg: null };
    if (!merge || !l.count) l.count++;
    l.lastAt = t; if (text) { l.text = text; l.msg = msg; }
    lines.set(key, l);
  };
  let herdrDown = 0, herdrUp = 0, backendRestarts = 0, downMs = 0;
  for (const e of events) {
    const sid = e.sessionId;
    const d = e.data || {};
    const base = { sessionId: sid, name: sid ? nameOf(sid) || '?' : null };
    if (e.kind === 'state') {
      if ((d.to === 'waiting' || d.to === 'trust_wait') && d.from !== 'waiting' && d.from !== 'trust_wait') add(`${sid}|needs_you`, { ...base, kind: 'needs_you' }, e.t, d.to === 'trust_wait' ? '처음 쓰는 폴더 신뢰 확인' : askText(d.ask), { msg: d.to === 'trust_wait' ? m('chgTrust') : askMsg(d.ask) });
      else if (d.to === 'error' && d.from !== 'error') add(`${sid}|error`, { ...base, kind: 'error' }, e.t, d.error ? `${d.error.type}` : '턴 실패', { msg: d.error ? null : m('chgTurnFailed') });
      else if (d.to === 'exited' && d.exit && d.exit.kind !== 'herdr_stopped') add(`${sid}|exited`, { ...base, kind: 'exited' }, e.t, EXIT_TEXT[d.exit.kind] || '끝남', { msg: m(EXIT_KEY[d.exit.kind] || 'chgExited') });
    } else if (e.kind === 'hook' && d.ev === 'Stop') {
      add(`${sid}|turn_done`, { ...base, kind: 'turn_done' }, e.t, one(d.lastAnswer));
    } else if (e.kind === 'hook' && d.ev === 'StopFailure') {
      add(`${sid}|error`, { ...base, kind: 'error' }, e.t, d.error ? `${d.error.type}` : '턴 실패', { msg: d.error ? null : m('chgTurnFailed') });
    } else if (e.kind === 'turn_interrupted') {
      add(`${sid}|interrupted`, { ...base, kind: 'interrupted' }, e.t, d.prompt ? `${d.state === 'shell_running' ? '명령' : '지시'}: ${one(d.prompt, 80)}` : `${d.state || ''} 중이었음`, { msg: d.prompt ? m(d.state === 'shell_running' ? 'chgCommand' : 'chgPrompt', { p: one(d.prompt, 80) }) : m('chgWasState', { state: d.state || '' }) }); // 셸의 끊긴 명령(I8)
    } else if (e.kind === 'closed') {
      add(`${sid}|exited`, { ...base, kind: 'exited' }, e.t, d.reason === 'killed' ? '판에서 끔' : `판에서 빠짐(${d.reason})`, { merge: true, msg: d.reason === 'killed' ? m('chgKilled') : m('chgRemoved', { reason: d.reason }) });
    } else if (e.kind === 'herdr_disconnected' && !d.expected) herdrDown++;
    else if (e.kind === 'herdr_connected') herdrUp++;
    else if (e.kind === 'backend_started' && isRestart(d)) { backendRestarts++; if (d.previousRun.downMs) downMs += d.previousRun.downMs; }
  }
  const out = [...lines.values()];
  for (const l of out) {
    const cur = l.sessionId ? current.get(l.sessionId) : null;
    if (l.kind === 'needs_you') l.stillOpen = !!(cur && (cur.state === 'waiting' || cur.state === 'trust_wait'));
    if (l.sessionId && !cur) l.closed = true;
  }
  // P53(#10): herdr와 백엔드는 다른 것이라 줄을 나눈다. 줄 이름표가 그 줄의 주제와 맞는다
  const sys = (kind, count, text, msg) => out.push({ kind, sessionId: null, name: null, count, text, msg, firstAt: null, lastAt: null });
  if (herdrDown) sys('herdr', herdrDown, `herdr가 ${herdrDown}번 예기치 않게 꺼졌다${herdrUp ? '(다시 붙음)' : ''}`, m('chgHerdrDown', { n: herdrDown, up: herdrUp ? m('chgReattached') : '' }));
  if (backendRestarts) sys('backend', backendRestarts, `백엔드가 ${backendRestarts}번 다시 떴다${downMs ? `(꺼져 있던 시간 ${Math.round(downMs / 1000)}초)` : ''}`, m('chgBackendRestarts', { n: backendRestarts, down: downMs ? m('chgDownFor', { s: Math.round(downMs / 1000) }) : '' }));
  out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (b.lastAt || 0) - (a.lastAt || 0));
  return out;
}
