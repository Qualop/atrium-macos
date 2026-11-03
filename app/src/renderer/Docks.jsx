// 붙여 묶기(ARCH 4절 H5, P6a, P17, P23): 덩어리(분할 나무)의 분할선, 바깥 테두리, 엇갈리는 점, 바깥 크기 손잡이, 붙을 자리 미리 보기, 덩어리 안 연결
// - 분할선은 나무의 마디(path)마다 자식 사이에 하나씩이다. 끌면 그 마디의 두 쪽 크기가 함께 바뀌고(합은 그대로, 다른 마디의 비율은 그대로)
//   놓으면 나무 통째로 dock.update로 저장한다. 두 번 누르면 두 쪽을 반반으로(P23). 분할선은 고른 노드(React Flow가 z를 1000 올린다)보다 위에 그린다.
// - P23: 잡는 폭은 배율과 상관없이 화면 기준 8px(HIT)이고 마우스를 올리면 초록(--accent)이다. 노드(React Flow)는 얇게 두고 안의 잡는 띠를 배율로 나눈 크기로 그린다.
// - P23: 붙은 노드의 바깥 테두리(덩어리 바깥에 닿은 쪽)도 끈다. 그 쪽으로 덩어리가 커지거나 줄고 다른 칸의 길이는 그대로다(dock-tree.mjs dragEdge).
//   이웃과 맞닿은 테두리는 분할선이 그 자리를 맡는다.
// - P23: 2 × 2처럼 분할선이 엇갈리는 점에 손잡이(가로·세로 분할선을 같이 옮긴다, 두 번 누르면 모두 반반).
// - 덩어리 오른쪽 아래 모서리 손잡이를 끌면 바깥 크기가 바뀌고 비율대로 나눈다(잎마다 최소 크기, dock-tree.mjs LEAF_MIN).
// - P23: 덩어리 안 세션끼리의 연결은 분할선 위 표시 대신 두 노드 가운데 점을 잇는 선으로 세션 위에 겹쳐 그린다(DockLinks).
//   누르면 오간 기록. 그 덩어리 안에 연결이 있을 때만 그린다(점은 SessionNode의 가운데 잇기 손잡이, 잇기 모드에서도 보인다).
//   P26: 어두운 테두리를 두른 색 선. 초점 세션 쪽 끝은 그 세션의 테두리 가운데다.
// - herdr 레이아웃과 패널 크기는 바꾸지 않는다. 제어기는 지금처럼 노드 크기로 화면을 받는다.
import { memo, useEffect, useRef } from 'react';
import { useStore as useFlowStore } from '@xyflow/react';
import { api } from './api.js';
import { useStore, getState, setNodesLocal, setDockLocal, openDialog, toast, loadBoard, beginLayoutEdit } from './store.js';
import { STATE_LABEL } from './lib/labels.js';
import { dt } from './lib/dock-text.js';
import { moveDivider, layout as layoutTree, minSize, dragEdge, moveJunction, evenDivider } from '../../../backend/src/dock-tree.mjs';
import { bbox } from '../../../backend/src/canvas.mjs';
import { useT, t, errText } from './lib/i18n.js';
import { linkEnds, dockFocus, placeLabels } from './lib/dock-links.js'; // P26: 초점 세션의 선은 테두리 가운데에서

export const HIT = 8; // 분할선·테두리를 잡는 폭(화면 px)
const zoomSel = (s) => s.transform[2];
// 덩어리의 지금 바깥(구성 노드 사각형의 bbox)
export const dockOuterNow = (d, st = getState()) => bbox(d.members.map((m) => st.nodes.get(m)));

// 끄기 공통: 누른 점에서 움직인 판 거리로 onMove를 부르고, 놓으면 onUp(움직였는가)
function dragWith(e, zoom, onMove, onUp) {
  e.stopPropagation(); e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  let ended = false;
  const move = (ev) => { if (ev.pointerId !== e.pointerId) return; if (ev.clientX !== sx || ev.clientY !== sy) moved = true; onMove((ev.clientX - sx) / zoom, (ev.clientY - sy) / zoom); };
  const up = (ev) => {
    if (ended || (ev?.pointerId != null && ev.pointerId !== e.pointerId)) return;
    ended = true;
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up); window.removeEventListener('blur', up);
    onUp(moved);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up); window.addEventListener('blur', up);
  return up;
}
function useDrag(dockId) {
  const stop = useRef(null);
  useEffect(() => () => stop.current?.(), []);
  return (e, zoom, move, up) => {
    stop.current?.();
    const end = beginLayoutEdit(getState().docks.get(dockId)?.members || [], dockId);
    stop.current = dragWith(e, zoom, move, (moved) => { end(); up(moved); });
  };
}
const fail = (key) => (err) => { toast(dt(key, { msg: errText(err) }), 'error'); loadBoard().catch(() => {}); };
// 나무만 바뀐 것을 저장(분할선, 엇갈리는 점)
const saveTree = (dockId, key) => { const cur = getState().docks.get(dockId); if (cur) api.call('dock.update', { dock: dockId, tree: cur.tree }).catch(fail(key)); };
// 지금 덩어리의 나무를 f(tree, outer)로 바꿔 화면에 놓고 저장한다(두 번 누르기)
function applyNow(dockId, f, key) {
  const d = getState().docks.get(dockId);
  const outer = d && dockOuterNow(d);
  if (!outer) return;
  const t2 = f(d.tree, outer);
  setDockLocal(dockId, { tree: t2 });
  setNodesLocal([...layoutTree(t2, outer).rects]);
  saveTree(dockId, key);
}
const hitStyle = (zoom) => ({ '--hit': `${HIT / Math.max(zoom, 0.02)}px`, '--line': `${1.5 / Math.max(zoom, 0.02)}px` });

function DividerNodeInner({ data }) {
  const dragWith = useDrag(data.dockId);
  const { dockId, path, index, dir } = data;
  useT();
  const zoom = useFlowStore(zoomSel);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const d = getState().docks.get(dockId);
    if (!d) return;
    const base = d.tree, outer = dockOuterNow(d);
    if (!outer) return;
    dragWith(e, zoom, (dx, dy) => {
      const t2 = moveDivider(base, outer, path, index, dir === 'row' ? dx : dy);
      setDockLocal(dockId, { tree: t2 });
      setNodesLocal([...layoutTree(t2, outer).rects]);
    }, (moved) => { if (moved) saveTree(dockId, 'dividerError'); });
  };
  const onDoubleClick = (e) => { e.stopPropagation(); applyNow(dockId, (tr, o) => evenDivider(tr, o, path, index), 'dividerError'); };
  return (
    <div className={`mt-divider ${dir} nodrag nopan`} style={hitStyle(zoom)} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} data-dock={dockId} data-path={path.join('.')} data-index={index} title={dt('dividerTitle')} />
  );
}
export const DividerNode = memo(DividerNodeInner);

// P23: 붙은 노드의 바깥 테두리(덩어리 바깥에 닿은 쪽). side 쪽으로 덩어리가 커지거나 줄어든다
function DockEdgeInner({ data }) {
  const dragWith = useDrag(data.dockId);
  const { dockId, leaf, side } = data;
  useT();
  const zoom = useFlowStore(zoomSel);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const d = getState().docks.get(dockId);
    if (!d) return;
    const base = d.tree, outer = dockOuterNow(d);
    if (!outer) return;
    let last = null;
    dragWith(e, zoom, (dx, dy) => {
      last = dragEdge(base, outer, leaf, side, side === 'left' || side === 'right' ? dx : dy);
      setDockLocal(dockId, { tree: last.tree });
      setNodesLocal([...layoutTree(last.tree, last.outer).rects]);
    }, (moved) => {
      if (!moved || !last) return;
      const o = last.outer;
      api.call('dock.update', { dock: dockId, tree: last.tree, x: o.x, y: o.y, w: o.w, h: o.h }).catch(fail('edgeError'));
    });
  };
  const dir = side === 'left' || side === 'right' ? 'row' : 'col';
  return <div className={`mt-dockedge ${dir} s-${side} nodrag nopan`} style={hitStyle(zoom)} onPointerDown={onPointerDown} data-role="dock-edge" data-dock={dockId} data-leaf={leaf} data-side={side} title={dt('edgeTitle')} />;
}
export const DockEdge = memo(DockEdgeInner);

// P23: 분할선이 엇갈리는 점. 끌면 그 점에 닿은 세로 분할선은 dx, 가로 분할선은 dy만큼
function JunctionNodeInner({ data }) {
  const dragWith = useDrag(data.dockId);
  const { dockId, j } = data;
  useT();
  const zoom = useFlowStore(zoomSel);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const d = getState().docks.get(dockId);
    if (!d) return;
    const base = d.tree, outer = dockOuterNow(d);
    if (!outer) return;
    dragWith(e, zoom, (dx, dy) => {
      const t2 = moveJunction(base, outer, j, dx, dy);
      setDockLocal(dockId, { tree: t2 });
      setNodesLocal([...layoutTree(t2, outer).rects]);
    }, (moved) => { if (moved) saveTree(dockId, 'dividerError'); });
  };
  const onDoubleClick = (e) => {
    e.stopPropagation();
    applyNow(dockId, (tr, o) => [...j.rows, ...j.cols].reduce((acc, dv) => evenDivider(acc, o, dv.path, dv.index), tr), 'dividerError');
  };
  return <div className="mt-junction nodrag nopan" style={{ '--size': `${(HIT + 6) / Math.max(zoom, 0.02)}px`, '--line': `${1.5 / Math.max(zoom, 0.02)}px` }} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} data-role="dock-junction" data-dock={dockId} title={dt('junctionTitle')} />;
}
export const JunctionNode = memo(JunctionNodeInner);

// 덩어리 바깥 크기 손잡이(오른쪽 아래 모서리). 왼쪽 위는 그대로 두고 너비·높이만 바꾼다
function DockGripInner({ data }) {
  const dragWith = useDrag(data.dockId);
  const { dockId } = data;
  useT();
  const zoom = useFlowStore(zoomSel);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const d = getState().docks.get(dockId);
    if (!d) return;
    const outer = dockOuterNow(d);
    if (!outer) return;
    const need = minSize(d.tree);
    let last = outer;
    dragWith(e, zoom, (dx, dy) => {
      last = { ...outer, w: Math.max(need.w, Math.round(outer.w + dx)), h: Math.max(need.h, Math.round(outer.h + dy)) };
      setNodesLocal([...layoutTree(d.tree, last).rects]);
    }, () => {
      if (last === outer) return;
      api.call('dock.update', { dock: dockId, w: last.w, h: last.h }).catch(fail('gripError'));
    });
  };
  const s = Math.max(22, 22 / Math.max(zoom, 0.02));
  return <div className="mt-dockgrip nodrag nopan" style={{ width: s, height: s, left: 1 - s / 2, top: 1 - s / 2 }} data-role="dock-grip" data-dock={dockId} onPointerDown={onPointerDown} title={dt('gripTitle')} />;
}
export const DockGrip = memo(DockGripInner);

// P23: 덩어리 안 연결(두 세션 노드 가운데를 잇는 선). data.rects: 구성 노드 자리(덩어리 바깥 왼쪽 위 기준)
// P26: 선은 어두운 테두리(외곽선)를 두른 색 선이라 터미널 글 위에서도 보인다. 색은 선 색 체계(역할 파랑, 띄움 초록, 알아챈 지시 초록 점선: 일반 선과 같다).
//   덩어리 안 한 세션이 초점(고름, 눌러 들어감, 화면 가운데에서 보는 중)이면 그 세션에 닿는 선은 그 세션의 테두리 가운데(상대 쪽)에서 나간다(lib/dock-links.js).
function DockLinksInner({ data, positionAbsoluteX = 0, positionAbsoluteY = 0 }) {
  const { dockId, rects } = data;
  useT();
  const zoom = useFlowStore(zoomSel);
  const links = useStore((st) => st.links);
  const sessions = useStore((st) => st.sessions);
  const selected = useStore((st) => st.selected);
  const focusId = useStore((st) => st.focusId);
  // 화면에 보이는 판 사각형(덩어리 기준 좌표)으로 초점 세션을 고른다. 고른 세션 ID만 돌려주므로 화면을 옮길 때마다 다시 그리지 않는다
  const focus = useFlowStore((s) => {
    const [tx, ty, z] = s.transform;
    const view = s.width && s.height ? { x: -tx / z - positionAbsoluteX, y: -ty / z - positionAbsoluteY, w: s.width / z, h: s.height / z } : null;
    return dockFocus({ rects, selected, focusId, view });
  });
  const z = Math.max(zoom, 0.02);
  const inside = [...links.values()].filter((l) => rects[l.from] && rects[l.to]);
  const ends = new Map(inside.map((l) => [l.linkId, linkEnds(rects[l.from], rects[l.to], focus === l.from ? 'from' : focus === l.to ? 'to' : null)]));
  const fs = Math.max(10, Math.min(160, 11 / z));
  const kindOfLink = (l) => (l.role && !l.spawned ? 'role' : l.observed ? 'observed' : 'spawned'); // 일반 선(Links.jsx)과 같은 구분
  const labelText = (l) => l.role || (l.spawned && !l.observed ? t('links.spawned') : t('docks.directed'));
  const stateText = (l) => { const to = sessions.get(l.to); return to ? STATE_LABEL[to.state] || to.state : ''; };
  // 글은 선 가운데를 피해 시키는 쪽 가까이 둔다(가운데는 분할선·엇갈리는 점 자리). P26: 글끼리 겹치면 선을 따라 옮긴다(선이 엇갈릴 때)
  const em = (str) => [...str].reduce((acc, ch) => acc + (ch.codePointAt(0) > 0x2e80 ? 1 : 0.6), 0);
  const labelAt = placeLabels(inside.map((l) => ({ ...ends.get(l.linkId), w: fs * (em(labelText(l)) + em(stateText(l)) * 0.85 + 2.6), h: fs * 1.8 })));
  return (
    <div className="mt-docklinks" data-role="dock-links" data-dock={dockId} data-focus={focus || undefined}>
      <svg className="mt-docklinks-svg" width="100%" height="100%" style={{ overflow: 'visible' }}>
        {inside.map((l) => {
          const { a, b, anchored } = ends.get(l.linkId);
          const both = inside.some((o) => o.from === l.to && o.to === l.from);
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const off = both ? 7 / z : 0; // 서로 시키면 두 선을 조금 벌린다
          const nx = (-(b.y - a.y) / len) * off, ny = ((b.x - a.x) / len) * off;
          const p = { x1: a.x + nx, y1: a.y + ny, x2: b.x + nx, y2: b.y + ny };
          const start = anchored === 'from' ? a : anchored === 'to' ? b : null;
          return (
            <g key={l.linkId} className={`mt-dl ${kindOfLink(l)}${l.spawned ? ' spawn' : ''}${anchored ? ' anchored' : ''}`} data-link={l.linkId} data-anchored={anchored || undefined}
              data-ax={Math.round(p.x1)} data-ay={Math.round(p.y1)} data-bx={Math.round(p.x2)} data-by={Math.round(p.y2)} onClick={(e) => { e.stopPropagation(); openDialog({ kind: 'link', linkId: l.linkId }); }}>
              <line className="mt-dl-hit" {...p} strokeWidth={12 / z} />
              <line className="mt-dl-casing" {...p} strokeWidth={6 / z} />
              <line className="mt-dl-line" {...p} strokeWidth={2.6 / z} strokeDasharray={l.observed ? `${7 / z} ${5 / z}` : undefined} />
              {start && <circle className="mt-dl-start" cx={start.x + nx} cy={start.y + ny} r={4.5 / z} strokeWidth={2 / z} />}
              <circle className="mt-dl-end" cx={b.x + nx} cy={b.y + ny} r={5.5 / z} strokeWidth={2 / z} />
            </g>
          );
        })}
      </svg>
      {inside.map((l, i) => {
        const to = sessions.get(l.to);
        const at = labelAt[i];
        return (
          <button key={l.linkId} className={`mt-dl-label ${kindOfLink(l)} nodrag nopan`} data-link={l.linkId} data-k={at.k} style={{ left: at.x, top: at.y, fontSize: fs }}
            title={`@${(sessions.get(l.from) || {}).name} → @${(to || {}).name}${l.lastText ? t('docks.markLast', { text: l.lastText }) : ''}${t('docks.markClick')}`}
            onClick={(e) => { e.stopPropagation(); openDialog({ kind: 'link', linkId: l.linkId }); }}>
            {labelText(l)}
            {to && <span className={`mt-pill st-${to.state}`}>{stateText(l)}</span>}
          </button>
        );
      })}
    </div>
  );
}
export const DockLinks = memo(DockLinksInner);

// 붙을 자리 미리 보기. kind: leaf(그 노드를 나눈다), dock(덩어리 옆 새 칸), snap(그냥 끌기로 가장자리에 붙는다)
// 선 굵기와 글 크기는 화면에서 같게(배율로 나눈다)
export function GhostNode({ data }) {
  useT();
  const zoom = useFlowStore(zoomSel);
  const kind = (data && data.kind) || 'snap';
  const z = Math.max(zoom, 0.02);
  return <div className={`mt-ghost ${kind}`} data-role="dock-ghost" data-kind={kind} data-side={data && data.side} style={{ borderWidth: 1.5 / z, fontSize: Math.min(200, 14 / z) }}>{dt(kind === 'leaf' ? 'ghostLeaf' : kind === 'dock' ? 'ghostDock' : 'ghostSnap')}</div>;
}
