// 칸반(체크리스트) 노드(ARCH 4절 I4, P6c): 열과 카드. 머리줄을 끌어 옮기고, 고르면 크기 손잡이가 생긴다. 열 하나짜리는 체크리스트다.
// - 카드 끌기: 카드를 눌러 끌면 놓을 자리(줄)가 보이고, 놓으면 그 열의 그 차례로 옮긴다(같은 열 안의 순서 바꾸기도). 한 칸반 안에서만.
// - 이름 바꾸기: 제목, 열 이름, 카드 글을 두 번 누른다. Enter 저장, Esc 취소.
// - 세션 잇기: 카드의 ⚭에서 세션을 고른다. 이은 카드에는 그 세션의 지금 상태(session.updated를 따라감), 내 차례 질문, 검토 대기가 보이고 누르면 그 세션으로 간다.
// - 지우기: 카드가 있는 열·칸반은 한 번 더 묻는다(백엔드 needsConfirm).
import { memo, useRef, useState } from 'react';
import { NodeResizer, useStore as useFlowStore } from '@xyflow/react';
import { api } from './api.js';
import { useStore, getState, setKanbanLocal, toast, wsName } from './store.js';
import { StatePill } from './SessionNode.jsx';
import { InlineConfirm } from './Memo.jsx';
import { askLine } from './lib/labels.js';
import { useT, errText, tMsg } from './lib/i18n.js';

const zoomSel = (s) => s.transform[2];
const DONE = /^~~([\s\S]*)~~$/; // 체크리스트에서 끝낸 카드(글을 ~~로 감싼다. 칸반에는 끝 표시 칸이 따로 없다)

// 두 번 눌러 고치는 글(제목, 열 이름, 카드)
function EditText({ value, display, onSave, multiline = false, className = '', field, placeholder }) {
  const t = useT();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  if (!edit) return <span className={`${className} mt-kedit`} data-field={field} title={t('kanban.editTitle')} onDoubleClick={(e) => { e.stopPropagation(); setV(value); setEdit(true); }}>{display ?? value}</span>;
  const done = (ok) => { setEdit(false); if (ok && v.trim() && v.trim() !== value) onSave(v.trim()); };
  const props = {
    autoFocus: true, value: v, className: `nodrag nowheel ${className} mt-kinput`, 'data-field': `${field}-input`, placeholder,
    onChange: (e) => setV(e.target.value), onBlur: () => done(true), onMouseDown: (e) => e.stopPropagation(),
    onKeyDown: (e) => { if (e.nativeEvent.isComposing) return; e.stopPropagation(); if (e.key === 'Enter' && (!multiline || !e.shiftKey)) { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

// 새 열·새 카드 입력줄
function AddLine({ label, onAdd, field, placeholder }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  if (!open) return <button className="mt-btn small ghost nodrag mt-kadd" data-action={field} onClick={() => setOpen(true)}>{label}</button>;
  const submit = async () => { const t = v.trim(); if (!t) { setOpen(false); return; } await onAdd(t); setV(''); };
  return (
    <input autoFocus className="nodrag nowheel mt-kinput" data-field={field} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onMouseDown={(e) => e.stopPropagation()} onBlur={() => { if (!v.trim()) setOpen(false); }}
      onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') { setV(''); setOpen(false); } }} />
  );
}

// 이은 카드의 세션 표시. 판에 있는 세션은 창의 요약(실시간), 빠진 세션은 칸반이 준 마지막 모습
function CardSession({ card }) {
  const t = useT();
  const live = useStore((st) => (card.sessionId ? st.sessions.get(card.sessionId) : null));
  if (!card.sessionId) return null;
  if (!live) {
    const snap = card.session || {};
    return <div className="mt-kcard-sess closed" data-role="card-session" data-state="closed">@{snap.name || '?'} <span className="dim">{t('kanban.offBoard')}</span></div>;
  }
  const waiting = live.state === 'waiting' || live.state === 'trust_wait';
  return (
    <div className={`mt-kcard-sess nodrag${waiting ? ' hot' : ''}`} data-role="card-session" data-state={live.state} data-name={live.name} title={t('kanban.goSession')}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); getState().navigateTo && getState().navigateTo(live.sessionId); }}>
      <b>@{live.name}</b> <StatePill s={live} />{live.unseen && <span className="mt-badge review">{t('kanban.review')}</span>}
      {waiting && <div className="mt-kcard-ask">{askLine(live) || t('kanban.waitingYou')}</div>}
    </div>
  );
}

function LinkPicker({ card, onPick, onClose }) {
  const t = useT();
  const sessions = useStore((st) => st.sessions);
  const list = [...sessions.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <select autoFocus className="nodrag mt-klink" data-field="card-link" value={card.sessionId || ''} onMouseDown={(e) => e.stopPropagation()} onBlur={onClose}
      onChange={(e) => { onPick(e.target.value || null); onClose(); }}>
      <option value="">{t('kanban.noLink')}</option>
      {list.map((s) => <option key={s.sessionId} value={s.sessionId}>@{s.name}{s.kind === 'shell' ? t('kanban.shellSuffix') : ''} · {wsName(s.workspaceKey)}</option>)}
    </select>
  );
}

// 먼 얼굴의 요약(글자는 화면 기준 크기). P112: 배율은 이 얼굴만 구독한다(칸반 전체는 배율로 다시 그리지 않는다)
function KanbanFar({ h, children }) {
  const zoom = useFlowStore(zoomSel);
  return <div className="mt-kanban-far" style={{ fontSize: Math.min(13 / Math.max(zoom, 0.02), h * 0.12) }}>{children}</div>;
}

function KanbanNodeInner({ data, selected }) {
  const t = useT();
  const id = data.kanbanId;
  const k = useStore((st) => st.kanbans.get(id));
  const flashCard = useStore((st) => st.flashCard);
  const kw = k ? k.w : 0;
  const far = useFlowStore((st) => kw * st.transform[2] < 260); // P112: 배율은 먼 얼굴 단계로만 구독한다(먼 얼굴 글자는 KanbanFar가)
  const [confirm, setConfirm] = useState(null); // { message, run }
  const [drag, setDrag] = useState(null); // { cardId, over: { columnId, index } | null }
  const [linking, setLinking] = useState(null); // cardId
  const root = useRef(null);
  if (!k) return null;

  // 바꾸기 하나. 확인이 필요하면(카드가 든 열 지우기) 묻고 다시 부른다
  const op = async (o, extra = {}) => {
    try {
      const r = await api.call('kanban.update', { kanban: id, op: o, ...extra });
      if (r.needsConfirm) setConfirm({ message: tMsg(r), run: () => op(o, { confirm: true }) });
      return r;
    } catch (e) { toast(t('kanban.fail', { error: errText(e) }), 'error'); return null; }
  };
  const del = async (yes = false) => {
    try {
      const r = await api.call('kanban.delete', { kanban: id, confirm: yes || undefined });
      if (r.needsConfirm) setConfirm({ message: tMsg(r), run: () => del(true) });
    } catch (e) { toast(t('kanban.deleteFail', { error: errText(e) }), 'error'); }
  };

  // 카드 끌기(포인터로 직접): 놓을 열과 차례를 화면 좌표로 찾는다. 끄는 카드는 빼고 센다(백엔드 moveCard는 빼고 넣는다)
  const dropAt = (x, y) => {
    for (const c of root.current ? root.current.querySelectorAll('.mt-kcol') : []) {
      const r = c.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const cards = [...c.querySelectorAll('.mt-kcard:not(.dragging)')];
      let index = cards.length;
      for (let i = 0; i < cards.length; i++) { const cr = cards[i].getBoundingClientRect(); if (y < cr.top + cr.height / 2) { index = i; break; } }
      return { columnId: c.dataset.col, index };
    }
    return null;
  };
  const startDrag = (e, card) => {
    if (e.button !== 0 || (e.target.closest && e.target.closest('button, input, textarea, select, .mt-kcard-sess'))) return;
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY;
    let active = false;
    const move = (ev) => {
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      active = true;
      setDrag({ cardId: card.cardId, over: dropAt(ev.clientX, ev.clientY) });
    };
    const up = (ev) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      if (!active) return;
      const over = dropAt(ev.clientX, ev.clientY);
      setDrag(null);
      if (!over) return;
      // 바로 그리기(백엔드가 kanban.updated로 확정한다)
      const cols = structuredClone(k.columns);
      const from = cols.find((c) => c.cards.some((x) => x.cardId === card.cardId));
      const to = cols.find((c) => c.columnId === over.columnId);
      if (!from || !to) return;
      const [moved] = from.cards.splice(from.cards.findIndex((x) => x.cardId === card.cardId), 1);
      to.cards.splice(Math.min(over.index, to.cards.length), 0, moved);
      setKanbanLocal(id, { columns: cols });
      op({ op: 'moveCard', card: card.cardId, column: over.columnId, index: over.index });
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  };

  const total = k.columns.reduce((n, c) => n + c.cards.length, 0);
  const checklist = k.columns.length === 1;

  return (
    <div ref={root} className={`mt-kanban-node${selected ? ' selected' : ''}${checklist ? ' checklist' : ''}`} data-kanban={id} data-ws={k.workspaceKey || ''} data-title={k.title}>
      <NodeResizer isVisible={selected && !far} minWidth={200} minHeight={120} lineClassName="mt-resize-line" handleClassName="mt-resize-handle"
        onResize={(_e, p) => setKanbanLocal(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
        onResizeEnd={(_e, p) => { setKanbanLocal(id, { x: p.x, y: p.y, w: p.width, h: p.height }); api.call('kanban.update', { kanban: id, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) }).catch((e) => toast(errText(e), 'error')); }} />
      <div className="mt-kanban-head mt-kdrag" title={t('memo.dragTitle')}>
        <span className="mt-memo-icon">{checklist ? '☑' : '▦'}</span>
        <EditText className="mt-kanban-title" field="kanban-title" value={k.title} onSave={(title) => api.call('kanban.update', { kanban: id, title }).catch((e) => toast(errText(e), 'error'))} />
        <span className="mt-node-meta">{t('kanban.cards', { n: total })}</span>
        <span className="mt-node-sp" />
        {k.workspaceKey ? <span className="mt-memo-ws" data-role="kanban-ws">{wsName(k.workspaceKey)}</span> : <span className="mt-memo-ws free" data-role="kanban-ws">{t('memo.noWs')}</span>}
        {!far && <AddLine label={t('kanban.addColumn')} field="add-column" placeholder={t('kanban.addColumnPh')} onAdd={(name) => op({ op: 'addColumn', name })} />}
        {!far && <button className="mt-x nodrag" data-action="kanban-delete" title={t('kanban.deleteTitle')} onClick={() => del()}>×</button>}
      </div>
      {far
        ? <KanbanFar h={k.h}>
            <b>{k.title}</b>
            {k.columns.map((c) => <div key={c.columnId}>{c.name} {c.cards.length}</div>)}
          </KanbanFar>
        : <div className="mt-kcols nowheel">
            {k.columns.map((c) => {
              const over = drag && drag.over && drag.over.columnId === c.columnId ? drag.over.index : -1;
              const shown = c.cards.filter((x) => !(drag && x.cardId === drag.cardId));
              return (
                <div key={c.columnId} className={`mt-kcol${over >= 0 ? ' over' : ''}`} data-col={c.columnId} data-name={c.name}>
                  <div className="mt-kcol-head">
                    <EditText className="mt-kcol-name" field="column-name" value={c.name} onSave={(name) => op({ op: 'renameColumn', column: c.columnId, name })} />
                    <span className="mt-node-meta">{c.cards.length}</span>
                    <span className="mt-node-sp" />
                    {k.columns.length > 1 && <button className="mt-x nodrag small" data-action="column-delete" title={t('kanban.deleteColumn')} onClick={() => op({ op: 'removeColumn', column: c.columnId })}>×</button>}
                  </div>
                  <div className="mt-kcards">
                    {c.cards.map((card) => {
                      const i = shown.indexOf(card);
                      return (
                        <div key={card.cardId}>
                          {over >= 0 && i === over && <div className="mt-kdrop" data-role="drop-line" />}
                          <div className={`mt-kcard nodrag${drag && drag.cardId === card.cardId ? ' dragging' : ''}${flashCard === card.cardId ? ' flash' : ''}`} data-card={card.cardId} data-text={card.text} onMouseDown={(e) => startDrag(e, card)}>
                            {checklist && <input type="checkbox" className="nodrag" data-action="card-check" title={t('kanban.checkTitle')} checked={DONE.test(card.text)} onChange={(e) => op({ op: 'editCard', card: card.cardId, text: e.target.checked ? `~~${card.text}~~` : card.text.replace(DONE, '$1') })} />}
                            <EditText className={`mt-kcard-text${DONE.test(card.text) ? ' done' : ''}`} field="card-text" multiline value={card.text} display={card.text.replace(DONE, '$1')} onSave={(text) => op({ op: 'editCard', card: card.cardId, text })} />
                            <span className="mt-kcard-tools">
                              <button className="mt-x nodrag small" data-action="card-link" title={t('kanban.linkTitle')} onClick={() => setLinking(linking === card.cardId ? null : card.cardId)}>⚭</button>
                              <button className="mt-x nodrag small" data-action="card-delete" title={t('kanban.deleteCard')} onClick={() => op({ op: 'removeCard', card: card.cardId })}>×</button>
                            </span>
                            {linking === card.cardId && <LinkPicker card={card} onPick={(sid) => op({ op: 'linkCard', card: card.cardId, session: sid })} onClose={() => setLinking(null)} />}
                            <CardSession card={card} />
                          </div>
                        </div>
                      );
                    })}
                    {over >= 0 && over >= shown.length && <div className="mt-kdrop" data-role="drop-line" />}
                  </div>
                  <AddLine label={t('kanban.addCard')} field="add-card" placeholder={t('kanban.addCardPh')} onAdd={(text) => op({ op: 'addCard', column: c.columnId, text })} />
                </div>
              );
            })}
          </div>}
      {confirm && <InlineConfirm message={confirm.message} onYes={() => { const r = confirm.run; setConfirm(null); r(); }} onNo={() => setConfirm(null)} />}
    </div>
  );
}
export const KanbanNode = memo(KanbanNodeInner);
