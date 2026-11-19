// 메모 노드(ARCH 4절 I3, P6c): 캔버스에 두는 마크다운 글. 머리줄을 끌어 옮기고, 고르면 크기 손잡이가 생긴다.
// 보기와 편집: 글을 두 번 누르거나 ✎로 편집(Ctrl+Enter 또는 바깥을 누르면 저장, Esc는 취소). 할 일 상자는 보기에서 바로 누른다.
// 워크스페이스 영역 안에 놓으면 그 소속이다(Canvas가 놓은 자리로 정해 memo.update { workspace }). 지우기는 글이 있으면 한 번 더 묻는다.
// 줄여 보아 노드가 작으면 첫 줄만 크게(화면 기준 글자) 보인다. P50(#6): 그 먼 얼굴을 두 번 누르면 화면을 그 메모로 옮겨 편집을 연다. 새 메모는 바로 편집이다.
import { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer, useStore as useFlowStore } from '@xyflow/react';
import { api } from './api.js';
import { useStore, getState, setMemoLocal, toast, wsName, editMemo, takeMemoEdit } from './store.js';
import { memoFar } from './lib/memo-edit.js'; // P50(#6)
import { Markdown } from './Markdown.jsx';
import { toggleTask } from './lib/markdown.js';
import { useT, t, errText, tMsg } from './lib/i18n.js';

const zoomSel = (s) => s.transform[2];
const firstLine = (t) => (String(t || '').split('\n').find((l) => l.trim()) || '').replace(/^#+\s*/, '').trim();

// 노드 안에서 한 번 더 묻기(되돌릴 수 없는 일). 메모와 칸반이 같이 쓴다
export function InlineConfirm({ message, onYes, onNo, yes }) {
  const t = useT();
  return (
    <div className="mt-kill nodrag" data-role="item-confirm" onMouseDown={(e) => e.stopPropagation()}>
      <div>{message}</div>
      <div className="mt-card-actions">
        <button className="mt-btn danger small" data-action="confirm-yes" onClick={onYes}>{yes ?? t('memo.confirmDelete')}</button>
        <button className="mt-btn ghost small" data-action="confirm-no" onClick={onNo}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

// 먼 얼굴의 제목(글자는 화면 기준 크기). P112: 배율은 이 얼굴만 구독한다(메모 전체는 배율로 다시 그리지 않는다)
function MemoFar({ h, title, onDoubleClick, children }) {
  const zoom = useFlowStore(zoomSel);
  return <div className="mt-memo-far" title={title} onDoubleClick={onDoubleClick} style={{ fontSize: Math.min(14 / Math.max(zoom, 0.02), h * 0.3) }}>{children}</div>;
}

function MemoNodeInner({ data, selected }) {
  const t = useT();
  const id = data.memoId;
  const m = useStore((st) => st.memos.get(id));
  const mw = m ? m.w : 0;
  const far = useFlowStore((st) => !!m && memoFar(mw, st.transform[2])); // P112: 배율은 먼 얼굴 단계로만 구독한다(먼 얼굴 글자는 MemoFar가)
  const [edit, setEdit] = useState(() => !!m && !m.text);
  const [draft, setDraft] = useState(m ? m.text : '');
  const [confirm, setConfirm] = useState(null);
  const ta = useRef(null);
  // P50(#6): 편집을 열면 입력칸에 초점을 준다. 먼 얼굴이라 입력칸이 아직 없으면 화면이 다가와 입력칸이 생길 때 준다
  const wantFocus = useRef(!!m && !m.text);
  const startEdit = () => { wantFocus.current = true; setEdit(true); };
  const asked = useStore((st) => st.memoEdit === id);
  useEffect(() => { if (asked) { takeMemoEdit(id); startEdit(); } }, [asked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!edit && m) setDraft(m.text); }, [m && m.text, edit]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!edit || far || !ta.current || !wantFocus.current) return;
    wantFocus.current = false;
    ta.current.focus(); ta.current.setSelectionRange(ta.current.value.length, ta.current.value.length);
  }, [edit, far]);
  if (!m) return null;

  const save = async (text = draft) => {
    setEdit(false);
    if (text === m.text) return;
    setMemoLocal(id, { text });
    try { await api.call('memo.update', { memo: id, text }); } catch (e) { toast(t('memo.saveFail', { error: errText(e) }), 'error'); }
  };
  const del = async (yes = false) => {
    try {
      const r = await api.call('memo.delete', { memo: id, confirm: yes || undefined });
      if (r.needsConfirm) setConfirm(tMsg(r));
    } catch (e) { toast(t('memo.deleteFail', { error: errText(e) }), 'error'); }
  };
  const onToggle = (n, checked) => save(toggleTask(m.text, n, checked));
  const title = firstLine(m.text);

  return (
    <div className={`mt-memo-node${selected ? ' selected' : ''}${edit ? ' editing' : ''}`} data-memo={id} data-ws={m.workspaceKey || ''} style={m.color ? { '--mc': m.color } : undefined}>
      <NodeResizer isVisible={selected && !far} minWidth={120} minHeight={80} lineClassName="mt-resize-line" handleClassName="mt-resize-handle"
        onResize={(_e, p) => setMemoLocal(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
        onResizeEnd={(_e, p) => { setMemoLocal(id, { x: p.x, y: p.y, w: p.width, h: p.height }); api.call('memo.update', { memo: id, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) }).catch((e) => toast(errText(e), 'error')); }} />
      <div className="mt-memo-head mt-mdrag" title={t('memo.dragTitle')}>
        <span className="mt-memo-icon">▤</span>
        <span className="mt-memo-title">{title || t('memo.title')}</span>
        <span className="mt-node-sp" />
        {m.workspaceKey ? <span className="mt-memo-ws" data-role="memo-ws">{wsName(m.workspaceKey)}</span> : <span className="mt-memo-ws free" data-role="memo-ws">{t('memo.noWs')}</span>}
        {!far && (edit
          ? <button className="mt-x nodrag" data-action="memo-done" title={t('memo.saveTitle')} onMouseDown={(e) => e.preventDefault()} onClick={() => save()}>✓</button>
          : <button className="mt-x nodrag" data-action="memo-edit" title={t('memo.editTitle')} onClick={startEdit}>✎</button>)}
        {!far && <button className="mt-x nodrag" data-action="memo-delete" title={t('memo.deleteTitle')} onClick={() => del()}>×</button>}
      </div>
      {far
        ? <MemoFar h={m.h} title={t('memo.editTitle')} onDoubleClick={() => editMemo(id)}>{title || t('memo.title')}</MemoFar>
        : edit
          ? <textarea ref={ta} className="mt-memo-edit nodrag nowheel" data-field="memo-text" value={draft} spellCheck={false} placeholder={t('memo.placeholder')}
              onChange={(e) => setDraft(e.target.value)} onBlur={() => save()}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
                if (e.key === 'Escape') { e.preventDefault(); setDraft(m.text); setEdit(false); }
                e.stopPropagation();
              }} />
          : <div className="mt-memo-body nowheel" data-role="memo-view" onDoubleClick={startEdit}>
              {m.text.trim() ? <Markdown text={m.text} onToggle={onToggle} /> : <div className="mt-memo-empty">{t('memo.empty')}</div>}
            </div>}
      {confirm && <InlineConfirm message={confirm} onYes={() => { setConfirm(null); del(true); }} onNo={() => setConfirm(null)} />}
    </div>
  );
}
export const MemoNode = memo(MemoNodeInner);

// 새 메모·칸반: 보던 화면 가운데에 둔다. 그 점이 워크스페이스 영역 안이면 그 소속(백엔드가 겹치지 않는 가까운 빈자리를 고른다)
export async function createItem(kind, extra = {}) {
  const st = getState();
  const c = st.viewCenter ? st.viewCenter() : { x: 0, y: 0 };
  const size = kind === 'memo' ? { w: 360, h: 240 } : { w: 640, h: 360 };
  const ws = st.regionAt ? st.regionAt(c) : null;
  // P16: 새 칸반의 제목과 열 이름은 지금 언어로 만든다(만든 뒤에는 사용자의 글이다)
  const named = kind === 'kanban' && !extra.title && !extra.columns ? { title: t('kanban.defaultTitle'), columns: [t('kanban.colTodo'), t('kanban.colDoing'), t('kanban.colDone')] } : {};
  const p = { ...named, ...extra, workspace: ws || undefined, near: { x: Math.round(c.x - size.w / 2), y: Math.round(c.y - size.h / 2) } };
  // P50(#6): 누른 단추(레일)에 초점이 남으면 이어 친 Space·Enter가 단추를 다시 눌러 메모가 또 생긴다
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  if (a && a.tagName === 'BUTTON' && a.blur) a.blur();
  try {
    const r = await api.call(kind === 'memo' ? 'memo.create' : 'kanban.create', p);
    if (kind === 'memo' && r && r.memoId) editMemo(r.memoId, r); // 새 메모는 바로 편집(먼 얼굴이면 화면을 그 메모로)
    toast(t(kind === 'memo' ? 'memo.created' : 'kanban.created', { where: ws ? t('memo.inWs', { ws: wsName(ws) }) : t('memo.inNoWs') }));
    return r;
  } catch (e) { toast(t(kind === 'memo' ? 'memo.createFail' : 'kanban.createFail', { error: errText(e) }), 'error'); return null; }
}
