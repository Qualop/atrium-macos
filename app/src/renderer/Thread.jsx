// 명령 바 요청 기록(Thread, ARCH 4절 I2, P6c): 명령 바 위에 펼쳐 본다. 보낸 글, 대상, 대상마다 전달 상태와 완료 보고(마지막 답, 4,000자까지).
// 줄은 시간순(새 것이 아래), 이벤트 thread.item으로 바꿔 끼운다. "이전 기록"으로 지난 줄을 더 읽는다.
// P45: 읽기 쉽고 쓰기 좋게 고쳤다(판단은 lib/thread.js).
//   - 줄 머리: 시각 → 받은 세션(@all은 푼 이름), 명령 바가 아닌 곳에서 보낸 것만 출처 표시. 왼쪽 띠 색이 줄 전체 상태다.
//   - 보낸 글은 상자에 넣고, 길면 3줄로 접어 "더 보기"로 펼친다. 결과는 세션마다 한 줄: @이름(누르면 그 세션으로), 상태, 보고 한 줄(누르면 펼침).
//   - 머리의 세션 단추로 한 세션에 보낸 것만 묶어 본다. 줄마다 다시 보내기, 고쳐 보내기(명령 바에 넣음), 복사.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, getState, setThreadOpen, loadThread, toast } from './store.js';
import { deliveryText } from './lib/labels.js';
import { RESULT_PHASE, ITEM_PHASE, SOURCE_LABEL } from './lib/items.js';
import { itemNames, threadSessions, filterThread, isLong, oneLine, resendLine, resultTone, threadSummary, sameDay } from './lib/thread.js';
import { Icon } from './lib/icons.jsx';
import { useT, errText, fmtTime, fmtDateTime } from './lib/i18n.js';

// 고쳐 보내기: 명령 바(CommandBar.jsx)가 듣고 입력칸에 글을 넣는다
export const commandDraft = new EventTarget();
const putDraft = (text) => commandDraft.dispatchEvent(new CustomEvent('draft', { detail: text }));

const timeOf = (at) => (sameDay(at, Date.now()) ? fmtTime(at, { hour: '2-digit', minute: '2-digit' }) : fmtDateTime(at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
const fullTime = (at) => fmtDateTime(at, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function copy(text, t) {
  navigator.clipboard.writeText(text).then(() => toast(t('threadView.copied')), () => toast(t('termSelect.copyFail'), 'error'));
}

function Result({ r }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const live = useStore((st) => st.sessions.has(r.sessionId));
  const rep = r.report;
  const tone = resultTone(r);
  // 상태 글: 보고가 있으면 단계만, 아직이면 전달 상태(대기 까닭 포함)
  const state = r.phase === 'done' ? (rep && rep.state === 'error' ? t('thread.repError').replace(/ · $/, '') : rep && rep.state === 'exited' ? t('thread.repExited').replace(/ · $/, '') : rep && rep.state === 'closed' ? t('thread.repClosed').replace(/ · $/, '') : RESULT_PHASE.done)
    : r.phase === 'delivering' ? deliveryText(r) : RESULT_PHASE[r.phase] || r.phase;
  const go = () => { if (live && getState().navigateTo) getState().navigateTo(r.sessionId, { focusTerminal: true }); };
  return (
    <div className={`mt-tv-res tone-${tone}`} data-role="thread-result" data-name={r.name} data-phase={r.phase} data-status={r.status}>
      <div className="mt-tv-res-line">
        <button type="button" className="mt-tv-to" data-action="thread-go" disabled={!live} title={live ? t('thread.goSession') : t('thread.goneSession')} onClick={go}>@{r.name}{live && <span className="mt-tv-go">↗</span>}</button>
        <span className={`mt-tv-state tone-${tone}`}>{(tone === 'run') && <span className="mt-spin" />}{state}</span>
        {rep && rep.text && !open && <span className="mt-tv-rep" data-role="thread-report" title={t('threadView.reportOpen')} onClick={() => setOpen(true)}>{oneLine(rep.text, 200)}</span>}
        {rep && !rep.text && rep.state !== 'exited' && rep.state !== 'closed' && <span className="mt-tv-rep dim">{t('thread.emptyReport')}</span>}
        {rep && rep.text && open && <span className="mt-tv-sp" />}
        {rep && rep.text && open && <button type="button" className="mt-tv-act" data-action="thread-report-copy" onClick={() => copy(rep.text, t)}>{t('threadView.copy')}</button>}
        {rep && rep.text && open && <button type="button" className="mt-tv-act" data-action="thread-report-close" onClick={() => setOpen(false)}>{t('threadView.less')}</button>}
      </div>
      {rep && open && <pre className="mt-tv-full nowheel" data-role="thread-report-full">{rep.text}{rep.clipped ? t('thread.clipped') : ''}</pre>}
    </div>
  );
}

function Item({ it }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = isLong(it.text);
  const names = itemNames(it);
  const all = (it.targets || []).includes('@all');
  const resend = () => api.call('session.send', { text: resendLine(it) }).then(() => toast(t('threadView.resent', { to: (it.targets || []).join(' ') }))).catch((e) => toast(t('cmd.sendFailed', { error: errText(e) }), 'error'));
  return (
    <div className={`mt-tv-item ip-${it.phase}`} data-role="thread-item" data-item={it.itemId} data-source={it.source} data-phase={it.phase} data-targets={names.join(' ')} data-long={long ? '1' : undefined}>
      <div className="mt-tv-head">
        <span className="mt-tv-time" title={fullTime(it.t)}>{timeOf(it.t)}</span>
        <span className="mt-tv-arrow">→</span>
        <span className="mt-tv-targets">{all ? <><b>@all</b> <span className="dim">({names.length})</span></> : names.map((n) => <b key={n}>@{n}</b>)}</span>
        {it.source !== 'bar' && <span className={`mt-badge src-${it.source}`}>{SOURCE_LABEL[it.source] || it.source}</span>}
        {it.results.length > 1 && <span className={`mt-tv-iph ip-${it.phase}`}>{ITEM_PHASE[it.phase] || it.phase}</span>}
        <span className="mt-tv-sp" />
        <span className="mt-tv-acts">
          <button type="button" className="mt-tv-act" data-action="thread-resend" title={t('threadView.resendTitle')} onClick={resend}>{t('threadView.resend')}</button>
          <button type="button" className="mt-tv-act" data-action="thread-edit" title={t('threadView.editTitle')} onClick={() => putDraft(resendLine(it))}>{t('threadView.edit')}</button>
          <button type="button" className="mt-tv-act" data-action="thread-copy" title={t('threadView.copyTitle')} onClick={() => copy(it.text, t)}>{t('threadView.copy')}</button>
        </span>
      </div>
      <div className={`mt-tv-text${long && !open ? ' clamp' : ''}`} data-role="thread-text">{it.text}</div>
      {long && <button type="button" className="mt-tv-more" data-action="thread-text-toggle" onClick={() => setOpen((o) => !o)}>{open ? t('threadView.less') : t('threadView.more')}</button>}
      <div className="mt-tv-results">
        {it.results.map((r) => <Result key={r.deliveryId} r={r} />)}
        {it.hiddenResults > 0 && <div className="mt-tv-hidden dim">{t('threadView.hidden', { n: it.hiddenResults })}</div>}
      </div>
    </div>
  );
}

export function ThreadPanel() {
  const t = useT();
  const open = useStore((st) => st.threadOpen);
  const thread = useStore((st) => st.thread);
  const more = useStore((st) => st.threadMore);
  const sessionsLive = useStore((st) => st.sessions);
  const [only, setOnly] = useState('');
  const listRef = useRef(null);
  const stick = useRef(true);
  const all = useMemo(() => [...thread.values()], [thread]);
  const groups = useMemo(() => threadSessions(all), [all]);
  const items = useMemo(() => filterThread(all, only), [all, only]);
  const sum = threadSummary(all);
  useEffect(() => { if (open && stick.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [open, thread, only]);
  useEffect(() => { if (only && !groups.some((g) => g.name === only)) setOnly(''); }, [groups, only]);
  if (!open) return null;
  const liveNames = new Set([...sessionsLive.values()].map((s) => s.name));
  return (
    <div className="mt-thread mt-tv" data-role="thread">
      <div className="mt-tv-top">
        <b className="mt-tv-title">{t('threadView.title')}</b>
        <span className="dim" title={t('thread.sub')}>{t('threadView.count', { n: sum.total })}{sum.active ? t('threadView.countActive', { n: sum.active }) : ''}</span>
        <span className="mt-tv-sp" />
        <button className="mt-x" data-action="thread-close" onClick={() => setThreadOpen(false)} title={t('thread.collapse')}><Icon name="chevDown" /></button>
      </div>
      {groups.length > 1 && (
        <div className="mt-tv-filter" data-role="thread-filter" title={t('threadView.filterTitle')}>
          <button type="button" className={`mt-tv-chip${!only ? ' on' : ''}`} data-name="" onClick={() => setOnly('')}>{t('threadView.all')} <span className="n">{sum.total}</span></button>
          {groups.map((g) => (
            <button type="button" key={g.name} className={`mt-tv-chip${only === g.name ? ' on' : ''}${liveNames.has(g.name) ? '' : ' gone'}`} data-name={g.name} onClick={() => setOnly(only === g.name ? '' : g.name)}>
              @{g.name} <span className="n">{g.count}</span>{g.active > 0 && <span className="mt-cmd-note" />}
            </button>
          ))}
        </div>
      )}
      <div className="mt-tv-list nowheel" ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {more && <button className="mt-btn small ghost mt-tv-older" data-action="thread-more" onClick={() => loadThread({ older: true }).catch((e) => toast(errText(e), 'error'))}>{t('thread.older')}</button>}
        {!all.length && <div className="dim mt-tv-empty">{t('thread.empty')}</div>}
        {items.map((it) => <Item key={it.itemId} it={it} />)}
      </div>
    </div>
  );
}

// 명령 바의 Thread 단추: 펼치기와 도는 줄 수
export function ThreadToggle() {
  const t = useT();
  const open = useStore((st) => st.threadOpen);
  const thread = useStore((st) => st.thread);
  const active = [...thread.values()].filter((x) => x.phase === 'active').length;
  // P11: 명령 입력 안의 둥근 단추. 진행 중인 것이 있으면 주황 점
  return <button className={`mt-cmd-thread${open ? ' on' : ''}`} data-action="thread-toggle" title={t('thread.toggle', { n: thread.size, active: active ? t('thread.toggleActive', { n: active }) : '' })} onClick={() => setThreadOpen(!open)}><Icon name={open ? 'chevDown' : 'chevUp'} />{active > 0 && <span className="mt-cmd-note" />}</button>;
}
