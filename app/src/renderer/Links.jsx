// 세션끼리 연결(ARCH 4절 F, 7.1 연결선, P4)
// - 연결선: 누가 누구에게 일을 시켰는지(F1), 판에서 정한 역할(F2), 누가 띄웠는지(F3). 선 위에 역할, 마지막 지시 앞부분, 받는 쪽 상태가 보인다.
// - 같은 저장소 선(F4): 워크트리 세션과 본 저장소 쪽 세션. 점선이고 누르지 않는다.
// - 선을 누르면 오간 기록, 판에서 노드를 이으면 역할을 묻는다.
// - P11: 띄움·시킴(알아챈 지시)은 얇은 주황 곡선과 끝점(목업의 가지 선), 판에서 정한 역할은 파랑, 같은 저장소는 회색 점선으로 구분한다(styles.css).
//   하위 세션(P8)처럼 띄우면서 역할도 정한 선은 data-kind는 role 그대로 두고 색만 띄움(주황, .spawn)으로 그린다
import { useEffect, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { useStore, getState, toast, openDialog } from './store.js';
import { api } from './api.js';
import { STATE_LABEL, agoText, labelFit } from './lib/labels.js';
import { useT, tMsg, errText, fmtTime } from './lib/i18n.js';
import { linkLabel } from '../../../backend/src/links.mjs';
import { useDialog } from './dialog.js';

const ACTIVE_MS = 30 * 60 * 1000;

// P46: 덩어리 안 연결 글(Docks.jsx DockLinks)도 같은 상태 알약을 쓴다
export function Pill({ s }) {
  useT();
  if (!s) return null;
  return <span className={`mt-pill st-${s.state}`} data-state={s.state}>{STATE_LABEL[s.state] || s.state}</span>;
}

export function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const t = useT();
  const link = useStore((st) => st.links.get(id));
  const to = useStore((st) => (link ? st.sessions.get(link.to) : null));
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  if (!link) return null;
  const active = to && to.state === 'working' && link.lastAt && Date.now() - link.lastAt < ACTIVE_MS && ['prompt', 'target_submitted', 'target_working'].includes(link.lastKind);
  const kind = link.role ? 'role' : link.observed ? 'observed' : 'spawned';
  const label = !link.role && link.spawned && !link.lastText ? t('links.spawned') : linkLabel(link); // 띄움만 있는 선은 사전의 글
  const fit = labelFit(data);
  return <>
    <BaseEdge id={id} path={path} className={`mt-edge ${kind}${link.spawned ? ' spawn' : ''}${active ? ' active' : ''}`} interactionWidth={24} />
    {/* P11: 선 양 끝의 작은 점(목업의 가지 선) */}
    <circle className={`mt-edge-end ${kind}${link.spawned ? ' spawn' : ''}`} cx={sourceX} cy={sourceY} r={4.5} />
    <circle className={`mt-edge-end ${kind}${link.spawned ? ' spawn' : ''}`} cx={targetX} cy={targetY} r={4.5} />
    <EdgeLabelRenderer>
      <div className={`mt-edge-label ${kind}${link.spawned ? ' spawn' : ''}${fit.compact ? ' compact' : ''} nodrag nopan`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, '--fitw': `${fit.maxWidth}px` }} data-link={id} data-kind={kind}
        onClick={(e) => { e.stopPropagation(); openDialog({ kind: 'link', linkId: id }); }} title={t('links.edgeTitle', { label: label || t('links.link') })}>
        {link.spawned && <span className="mt-edge-tag">{t('links.spawned')}</span>}
        <span className="mt-edge-text">{label || t('links.link')}</span>
        {(link.observed || link.role) && <Pill s={to} />}
      </div>
    </EdgeLabelRenderer>
  </>;
}

export function RepoEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const t = useT();
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const fit = labelFit(data);
  if (fit.compact) return <BaseEdge id={id} path={path} className="mt-edge repo" />; // 틈이 좁으면 글 없이 점선만
  return <>
    <BaseEdge id={id} path={path} className="mt-edge repo" />
    <EdgeLabelRenderer>
      <div className="mt-edge-label repo nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'none', '--fitw': `${fit.maxWidth}px` }} data-repo-edge={id}>
        {t('links.sameRepo')}{data && data.branch ? ` ⎇ ${data.branch}` : ''}
      </div>
    </EdgeLabelRenderer>
  </>;
}

// 판에서 A → B를 이을 때 역할을 묻는다(F2)
export function RoleDialog({ from, to, onClose }) {
  const t = useT();
  const a = useStore((st) => st.sessions.get(from));
  const b = useStore((st) => st.sessions.get(to));
  const [role, setRole] = useState(() => t('links.defaultRole'));
  const [busy, setBusy] = useState(false);
  const box = useDialog(() => onClose()); // P52
  if (!a || !b) return null;
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.call('link.create', { from, to, role: role.trim() });
      toast(t('links.created', { a: a.name, b: b.name, role: role.trim() }));
      onClose(r);
    } catch (err) { toast(t('links.createFail', { error: errText(err) }), 'error'); setBusy(false); }
  }
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} className="mt-modal" onSubmit={submit} data-role="link-role">
        <h3>{t('links.roleTitle', { a: a.name, b: b.name })}</h3>
        <label>{t('links.roleLabel', { b: b.name })}<input autoFocus value={role} onChange={(e) => setRole(e.target.value)} data-field="role" maxLength={40} /></label>
        <div className="mt-card-sub">{t('links.roleHelp1', { a: a.name, b: b.name })}<span className="mono">{b.agentName}</span>{t('links.roleHelp2', { a: a.name, pane: b.paneId, role: role.trim() || t('links.role') })}</div>
        <div className="mt-card-actions">
          <button className="mt-btn primary" disabled={busy || !role.trim()} data-action="link-submit">{busy ? t('links.linking') : t('links.linkBtn')}</button>
          <button type="button" className="mt-btn ghost" onClick={() => onClose()}>{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  );
}

const EVENT_KINDS = ['role', 'notice', 'unlink', 'prompt', 'prompt_result', 'wait_result', 'keys', 'reply', 'spawn', 'target_submitted', 'target_working', 'target_waiting', 'target_done', 'target_exited'];
const eventLabel = (t, kind) => (EVENT_KINDS.includes(kind) ? t(`links.event.${kind}`) : kind);

// 선을 누르면 뜨는 오간 기록과 끊기
export function LinkPanel({ linkId, onClose }) {
  const t = useT();
  const link = useStore((st) => st.links.get(linkId));
  const a = useStore((st) => (link ? st.sessions.get(link.from) : null));
  const b = useStore((st) => (link ? st.sessions.get(link.to) : null));
  const [events, setEvents] = useState(null);
  const [confirm, setConfirm] = useState(null);
  useEffect(() => {
    let alive = true;
    let request = 0;
    setEvents(null);
    const load = () => {
      const id = ++request;
      return api.call('link.log', { link: linkId }).then((r) => { if (alive && id === request) setEvents(r.events); }).catch(() => { if (alive && id === request) setEvents([]); });
    };
    load();
    const off = api.on('link.event', (e) => { if (e.linkId === linkId) load(); });
    return () => { alive = false; off(); };
  }, [linkId]);
  async function unlink(yes) {
    try {
      const r = await api.call('link.delete', { link: linkId, confirm: yes });
      if (r.needsConfirm) return setConfirm(tMsg(r));
      toast(r.deliveryId ? t('links.unlinked', { a: a ? a.name : '' }) : t('links.removed'));
      onClose();
    } catch (e) { toast(t('links.unlinkFail', { error: errText(e) }), 'error'); }
  }
  if (!link) return null;
  return (
    <div className="mt-linkpanel nowheel" data-role="link-panel" data-link={linkId}>
      <div className="mt-linkpanel-head">
        <b>@{a ? a.name : '?'} → @{b ? b.name : '?'}</b>
        {link.role && <span className="mt-edge-tag role">{link.role}</span>}
        {link.spawned && <span className="mt-edge-tag">{t('links.spawned')}</span>}
        {b && <Pill s={b} />}
        <span className="mt-node-sp" />
        <button className="mt-btn small ghost" onClick={() => { onClose(); getState().navigateTo && b && getState().navigateTo(b.sessionId); }} data-action="link-go">{t('links.goTo', { name: b ? b.name : '' })}</button>
        <button className="mt-x" onClick={onClose} title={t('common.close')}>×</button>
      </div>
      <div className="mt-linkpanel-sub">{t('links.herdrName')} <span className="mono">{link.toAgentName}</span> · {t('links.panelInfo', { pane: link.toPaneId, n: link.count })}</div>
      <div className="mt-linkpanel-body">
        {events === null && <div className="mt-chat-empty">{t('common.loading')}</div>}
        {events && events.map((e) => (
          <div key={e.id} className={`mt-linkev k-${e.kind}`} data-kind={e.kind}>
            <div className="mt-linkev-head"><span className="mt-linkev-t">{fmtTime(e.t)}</span> <b>{eventLabel(t, e.kind)}</b>{e.data && e.data.status ? <span className="mt-card-sub"> · {e.data.status}</span> : null}{e.data && e.data.ok === false ? <span className="mt-card-sub bad"> · {t('delivery.failed')}</span> : null}</div>
            {e.text && <pre className="mt-linkev-text">{e.text}</pre>}
          </div>
        ))}
      </div>
      <div className="mt-card-actions">
        {confirm ? <>
          <span className="mt-card-sub">{confirm}</span>
          <button className="mt-btn danger" onClick={() => unlink(true)} data-action="unlink-confirm">{t('links.unlinkConfirm')}</button>
          <button className="mt-btn ghost" onClick={() => setConfirm(null)}>{t('common.cancel')}</button>
        </> : <button className="mt-btn danger" onClick={() => unlink(false)} data-action="unlink">{link.role ? t('links.unlink') : t('links.removeLine')}</button>}
        <span className="mt-card-sub">{link.lastAt ? t('links.last', { ago: agoText(link.lastAt) }) : ''}</span>
      </div>
    </div>
  );
}
