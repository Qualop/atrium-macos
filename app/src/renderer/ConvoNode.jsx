// P13(BRIEF "판 밖 대화", ARCH 5절 "판 밖 대화 노드·missed", 7.1): 판 밖 대화 노드. 터미널(CLI)에서 한 Claude Code 대화를 리포 영역 안에 읽기 전용 카드로 보인다. 터미널이 아니다.
// - 얼굴은 세션 노드와 같은 너비 기준(lib/faces.js)이다. 카드에는 터미널이 없으므로 가까이·중간은 같은 "카드" 얼굴, 그다음 멀리, 아이콘(convo-canvas.mjs convoFace).
// - 카드: 종류 아이콘, 제목(대화 제목이나 첫 요청), 마지막 요청과 답 앞부분, 마지막 활동, 브랜치·워크트리, 하위 에이전트 수(누르면 목록), 묶임("터미널 · pid n에서 도는 중"),
//   띄운 곳(부모가 캔버스에 없을 때), 띄운 대화 수, "판으로 열기"(묶여 있지 않을 때만, 노드가 그 자리에서 세션 노드가 된다), "보관".
// - 머리줄을 끌면 옮기고(convo.move), 자리는 판이 지킨다. 띄움 선(SpawnEdge)은 주황 실선이다
import { memo, useEffect, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, Position, useStore as useFlowStore } from '@xyflow/react';
import { useStore } from './store.js';
import { api } from './api.js';
import { faceFor } from './lib/faces.js';
import { convoTier } from './lib/overview.js'; // P85: 판 밖 대화 카드도 멀리 보기 규칙을 따른다(열린 대화는 쉼, 닫힌 대화는 끝남)
import { ago, labelFit } from './lib/labels.js';
import { shifted, linkLabelHidden } from './lib/link-labels.js'; // P67, P108
import { useT, errText, tMsg, fmtDateTime } from './lib/i18n.js';
import { KindIcon } from './SessionNode.jsx';
import { openConvo, archiveItem } from './Sidebar.jsx';
import { bindingText } from './lib/sidebar.js';
import { convoFace } from '../../../backend/src/convo-canvas.mjs';

const zoomSel = (s) => s.transform[2];
const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const VIA = { claude: 'claude -w', herdr: 'herdr agent', 'atrium-child': 'atrium child', 'atrium-spawn': 'atrium spawn', 'mtask-child': 'atrium child', 'mtask-spawn': 'atrium spawn' }; // mtask-*는 P18 전 이름

function useNow(ms = 30000) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }

// 하위 에이전트 목록(누르면 읽는다)
function Subagents({ c, onClose }) {
  const t = useT();
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.call('convo.subagents', { convo: c.convId }).then((r) => setList(r.subagents), (e) => setErr(errText(e))); }, [c.convId]);
  const now = Date.now();
  return (
    <div className="mt-cv-pop nodrag nowheel" data-role="subagent-list" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mt-cv-pop-head"><b>{t('convo.subagents', { n: c.subagents })}</b><button className="mt-x" onClick={onClose} title={t('common.close')}>✕</button></div>
      {err && <div className="mt-cv-dim">{err}</div>}
      {!list && !err && <div className="mt-cv-dim">{t('common.loading')}</div>}
      {list && list.map((a) => (
        <div key={a.id} className="mt-cv-sub" data-subagent={a.id}><span className="mt-cv-sub-d">{a.description || a.id}</span><span className="mt-cv-dim">{a.agentType ? `${a.agentType} · ` : ''}{a.at ? ago(a.at, now) : ''}</span></div>
      ))}
    </div>
  );
}

function Flags({ c }) {
  const t = useT();
  const b = c.binding || {};
  const running = b.bound && b.open && b.where === 'terminal';
  return <>
    {running && <span className="mt-cv-flag run" data-role="running" title={t('convo.runningTitle')}>{t('convo.running', { pid: b.pid })}</span>}
    {b.bound && !running && <span className="mt-cv-flag bound" data-role="bound" title={b.sure ? '' : t('sidebar.boundUnsure')}>{bindingText(b)}</span>}
  </>;
}

function CardFace({ c, now, narrow }) {
  const t = useT();
  const [subs, setSubs] = useState(false);
  const [busy, setBusy] = useState(false);
  const title = c.title || oneLine(c.firstPrompt) || c.convId.slice(0, 8);
  const sp = c.spawnedBy;
  return (
    <div className="mt-cv-card" data-role="convo-card">
      <div className="mt-cv-head mt-cdrag">
        <span className="mt-cv-kind"><KindIcon kind="claude" title={t('convo.kindTitle')} /></span>
        <b className="mt-cv-title" title={`${title}\n${t('sidebar.convoId', { id: c.convId })}\n${c.cwd || ''}`}>{title}</b>
        <span className="mt-cv-time" title={fmtDateTime(c.lastAt || 0)}>{ago(c.lastAt, now)}</span>
      </div>
      <div className="mt-cv-meta">
        {c.block ? <span className="mt-cv-wt" data-role="worktree">⎇ {c.block}{c.branch && c.branch !== c.block ? ` · ${c.branch}` : ''}</span> : c.branch ? <span className="mt-cv-br">⎇ {c.branch}</span> : null}
        {c.subagents > 0 && <button className="mt-cv-chip nodrag" data-action="subagents" data-count={c.subagents} title={t('convo.subagentsTitle')} onClick={() => setSubs((v) => !v)}>{t('convo.subagents', { n: c.subagents })}</button>}
        {c.children > 0 && <span className="mt-cv-chip" data-role="children" title={t('convo.childrenTitle')}>{t('convo.children', { n: c.children })}</span>}
      </div>
      {!narrow && c.lastPrompt && <div className="mt-cv-line prompt" data-role="convo-prompt"><span className="mt-far-k">{t('convo.prompt')}</span> {oneLine(c.lastPrompt)}</div>}
      {!narrow && c.lastAnswer && <div className="mt-cv-line" data-role="convo-answer"><span className="mt-far-k">{t('convo.answer')}</span> {oneLine(c.lastAnswer)}</div>}
      <div className="mt-cv-foot">
        <Flags c={c} />
        {sp && !sp.onCanvas && <span className="mt-cv-from" data-role="spawned-by" title={t('convo.spawnedVia', { via: `${VIA[sp.via] || sp.via}${sp.name ? ` ${sp.name}` : ''}` })}>{t('convo.spawnedBy', { label: sp.labelMsg ? tMsg({ msg: sp.labelMsg }, sp.label) : sp.label })}</span>}
        <span className="mt-cv-sp" />
        {c.canOpen && <button className="mt-btn small nodrag" data-action="open-convo" disabled={busy} title={t('convo.openTitle')} onClick={async () => { setBusy(true); await openConvo(c); setBusy(false); }}>{busy ? t('sidebar.opening') : t('sidebar.openOnBoard')}</button>}
        <button className="mt-btn small ghost nodrag" data-action="archive" title={t('convo.archiveTitle')} onClick={() => archiveItem(c)}>{t('common.archive')}</button>
      </div>
      {subs && <Subagents c={c} onClose={() => setSubs(false)} />}
    </div>
  );
}

// 멀리: 제목과 마지막 활동, 도는 중 표시. 글자는 화면 기준 크기(노드 높이·너비에 맞춰 줄인다)
function FarFace({ c, zoom, now }) {
  const t = useT();
  const px = (n, frac, wfrac) => Math.min(n / Math.max(zoom, 0.02), c.h * frac, c.w * wfrac);
  const b = c.binding || {};
  return (
    <div className="mt-cv-far mt-cdrag" data-role="convo-far" style={{ fontSize: px(12, 0.16, 1 / 13) }}>
      <div className="mt-cv-far-title" style={{ fontSize: px(14, 0.2, 1 / 11) }}>{c.title || oneLine(c.firstPrompt) || c.convId.slice(0, 8)}</div>
      <div className="mt-cv-dim">{ago(c.lastAt, now)}{c.block ? ` · ⎇ ${c.block}` : ''}{c.subagents ? ` · ${t('convo.subShort', { n: c.subagents })}` : ''}</div>
      {b.open && <div className="mt-cv-flag run">{t('convo.runningShort')}</div>}
    </div>
  );
}

function IconFace({ c }) {
  const t = useT();
  const b = c.binding || {};
  return (
    <div className="mt-iconface mt-cdrag" data-role="convo-icon" title={c.title || c.convId}>
      <KindIcon kind="claude" title={c.title || t('convo.kindShort')} />
      <span className="mt-icon-name">{c.title || c.convId.slice(0, 8)}</span>
      {b.open && <span className="mt-icon-dot" data-state="working" style={{ '--sc': 'var(--st-working)' }} />}
    </div>
  );
}

function ConvoNodeInner({ data, selected }) {
  const c = useStore((st) => st.convoNodes.get(data.convId));
  const zoom = useFlowStore(zoomSel);
  const now = useNow();
  const prevFace = useRef(null);
  if (!c) return null;
  const f = faceFor(c.w, zoom, prevFace.current); // 경계에서 흔들리지 않게(faces.js 이력)
  prevFace.current = f;
  const face = convoFace(f);
  const b = c.binding || {};
  return (
    <div className={`mt-cv face-${face} t-${convoTier(b)}${b.open ? ' running' : ''}${selected ? ' selected' : ''}`} style={{ '--inv': 1 / Math.max(zoom, 0.02) }} data-convo={c.convId} data-face={face} data-ws={c.workspaceKey} data-block={c.block || ''}>
      {/* 띄움 선의 끝(잇기는 하지 않는다) */}
      {[['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]].map(([hid, pos]) => <Handle key={hid} type="source" position={pos} id={hid} className="mt-cv-handle" isConnectable={false} />)}
      {face === 'card' && <CardFace c={c} now={now} narrow={c.w * zoom < 260} />}
      {face === 'far' && <FarFace c={c} zoom={zoom} now={now} />}
      {face === 'icon' && <IconFace c={c} />}
    </div>
  );
}
export const ConvoNode = memo(ConvoNodeInner);

// 워크트리 블록 배경(같은 리포의 워크트리 대화를 묶어 보인다). 누르거나 끌지 않는다
function WorktreeBoxInner({ data }) {
  const t = useT();
  const zoom = useFlowStore(zoomSel);
  return (
    <div className="mt-wtbox" data-worktree={data.block} data-ws={data.ws}>
      <div className="mt-wtbox-head" style={{ fontSize: Math.max(12, Math.min(28, 12 / Math.max(zoom, 0.02))) }}>⎇ {data.block} <span className="mt-cv-dim">· {t('convo.worktreeConvos', { n: data.n })}</span></div>
    </div>
  );
}
export const WorktreeBox = memo(WorktreeBoxInner);

// 대화끼리의 띄움 선(주황 실선, 끝점). 선 위 글은 띄운 방법과 이름
export function SpawnEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const [path, lx0, ly0] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const [lx, ly] = shifted(lx0, ly0, data); // P67: 다른 선의 이름표와 겹치면 비켜 놓은 자리
  const t = useT();
  const fit = labelFit(data);
  return <>
    <BaseEdge id={id} path={path} className="mt-edge spawned spawn convo" interactionWidth={12} />
    {!(data && data.hideSource) && <circle className="mt-edge-end spawn" cx={sourceX} cy={sourceY} r={4.5} />}
    {!(data && data.hideTarget) && <circle className="mt-edge-end spawn" cx={targetX} cy={targetY} r={4.5} />}
    {!fit.compact && !linkLabelHidden(data, { x: lx, y: ly }) && <EdgeLabelRenderer>
      <div className="mt-edge-label spawn nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'none', '--fitw': `${fit.maxWidth}px` }} data-spawn-edge={id}>
        <span className="mt-edge-tag">{t('convo.spawnTag')}</span><span className="mt-edge-text">{VIA[data && data.via] || (data && data.via) || ''}{data && data.name ? ` ${data.name}` : ''}</span>
      </div>
    </EdgeLabelRenderer>}
  </>;
}
