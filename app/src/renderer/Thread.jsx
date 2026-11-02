// 명령 바 대화 기록(Thread, ARCH 4절 I2, P6c): 명령 바 위에 펼쳐 본다. 보낸 글, 대상, 대상마다 전달 상태와 완료 보고(마지막 답, 4,000자까지).
// 줄은 시간순(새 것이 아래), 이벤트 thread.item으로 바꿔 끼운다. 결과의 @이름을 누르면 그 세션으로 간다. "더 앞"으로 지난 줄을 더 읽는다.
import { Icon } from './lib/icons.jsx';
import { useEffect, useRef, useState } from 'react';
import { useStore, getState, setThreadOpen, loadThread, toast } from './store.js';
import { deliveryText } from './lib/labels.js';
import { RESULT_PHASE, ITEM_PHASE, SOURCE_LABEL } from './lib/items.js';
import { useT, errText, fmtTime } from './lib/i18n.js';

const time = (at) => fmtTime(at, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); // P16: 화면 언어의 시각

function Result({ r }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const live = useStore((st) => st.sessions.get(r.sessionId));
  const rep = r.report;
  return (
    <div className={`mt-thread-res ph-${r.phase}`} data-role="thread-result" data-name={r.name} data-phase={r.phase} data-status={r.status}>
      <b className="mt-thread-to" title={live ? t('thread.goSession') : t('thread.goneSession')} onClick={() => live && getState().navigateTo && getState().navigateTo(r.sessionId)}>@{r.name}</b>
      <span className={`mt-thread-ph ph-${r.phase}`}>{RESULT_PHASE[r.phase] || r.phase}</span>
      <span className="dim">{deliveryText(r)}</span>
      {rep && <span className="mt-thread-rep" data-role="thread-report" onClick={() => setOpen((o) => !o)} title={t('thread.expand')}>
        {rep.state === 'error' ? t('thread.repError') : rep.state === 'exited' ? t('thread.repExited') : rep.state === 'closed' ? t('thread.repClosed') : ''}
        {open ? null : (rep.text || t('thread.emptyReport')).replace(/\s+/g, ' ').slice(0, 140)}{rep.clipped ? t('thread.clipped') : ''}
      </span>}
      {rep && open && <pre className="mt-thread-full nowheel">{rep.text}</pre>}
    </div>
  );
}

function Item({ it }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = it.text.length > 160 || it.text.includes('\n');
  return (
    <div className={`mt-thread-item ip-${it.phase}`} data-role="thread-item" data-item={it.itemId} data-source={it.source} data-phase={it.phase}>
      <div className="mt-thread-line">
        <span className="dim">{time(it.t)}</span>
        <span className={`mt-badge src-${it.source}`}>{SOURCE_LABEL[it.source] || it.source}</span>
        <span className="mt-thread-targets">{it.targets.join(' ')}</span>
        <span className={`mt-thread-iph ip-${it.phase}`}>{ITEM_PHASE[it.phase] || it.phase}</span>
      </div>
      <div className={`mt-thread-text${open ? ' open' : ''}`} onClick={() => long && setOpen((o) => !o)} title={long ? t('thread.expand') : undefined}>{it.text}</div>
      {it.results.map((r) => <Result key={r.deliveryId} r={r} />)}
    </div>
  );
}

export function ThreadPanel() {
  const t = useT();
  const open = useStore((st) => st.threadOpen);
  const thread = useStore((st) => st.thread);
  const more = useStore((st) => st.threadMore);
  const listRef = useRef(null);
  const stick = useRef(true);
  const items = [...thread.values()];
  useEffect(() => { if (open && stick.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [open, thread]);
  if (!open) return null;
  return (
    <div className="mt-thread" data-role="thread">
      <div className="mt-thread-head">
        <b>{t('thread.title')}</b> <span className="dim">{t('thread.sub')}</span>
        <span className="mt-node-sp" />
        <button className="mt-x" data-action="thread-close" onClick={() => setThreadOpen(false)} title={t('thread.collapse')}>▾</button>
      </div>
      <div className="mt-thread-list nowheel" ref={listRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {more && <button className="mt-btn small ghost" data-action="thread-more" onClick={() => loadThread({ older: true }).catch((e) => toast(errText(e), 'error'))}>{t('thread.older')}</button>}
        {!items.length && <div className="dim">{t('thread.empty')}</div>}
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
