// 붙여 묶기(ARCH 4절 H5, P6a, P17, P23, P73): 덩어리(분할 나무)의 분할선, 바깥 테두리, 바깥 크기 손잡이, 붙을 자리 미리 보기, 덩어리 안 연결
// - 내부 분할선과 엇갈리는 점은 끌거나 두 번 눌러 비율을 조절한다. 바깥 테두리는 P73의 전체 비율 크기 조절을 유지한다.
//   분할선은 고른 노드(React Flow가 z를 1000 올린다)보다 위에 그린다.
// - P23: 잡는 폭은 배율과 상관없이 화면 기준 8px(HIT)이고 마우스를 올리면 초록(--accent)이다. 노드(React Flow)는 얇게 두고 안의 잡는 띠를 배율로 나눈 크기로 그린다.
// - P73: 덩어리 크기는 바깥 테두리(네 변)와 오른쪽 아래 모서리 손잡이로만 바꾼다. 나무의 비율은 그대로라 칸이 비율대로 함께 커지고 작아진다
//   (잎마다 최소 크기, dock-tree.mjs dragOuter·LEAF_MIN). 놓으면 dock.update(x, y, w, h)로 저장하고, 백엔드가 고른 종횡비를 끈다(자유 비율).
// - P30: 덩어리 안 세션끼리의 연결은 터미널 위를 지나지 않는다. 맞닿은 칸은 경계 위 다리, 같은 바깥 변에 닿는 칸은 괄호, 그 밖은 둘레 길,
//   둘레에 닿지 않는 칸은 칩(DockLinks). 누르면 오간 기록. 그 덩어리 안에 연결이 있을 때만 그린다.
//   잇기는 지금처럼 잇기 모드에서 가운데 점(SessionNode의 가운데 잇기 손잡이)끼리 끈다. 점은 잇기 모드에서만 보인다.
// - herdr 레이아웃과 패널 크기는 바꾸지 않는다. 제어기는 지금처럼 노드 크기로 화면을 받는다.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStore as useFlowStore } from '@xyflow/react';
import { api } from './api.js';
import { useStore, getState, setNodesLocal, setDockLocal, openDialog, toast, loadBoard, beginLayoutEdit } from './store.js';
import { STATE_LABEL } from './lib/labels.js';
import { dt } from './lib/dock-text.js';
import { moveDivider, moveJunction, evenDivider, layout as layoutTree, minSize, dragOuter } from '../../../backend/src/dock-tree.mjs';
import { bbox } from '../../../backend/src/canvas.mjs';
import { useT, t, errText } from './lib/i18n.js';
import { dockFocus, dockRoutes, roundedPath, arrowHead, linkActive, touches, fitDockLabel, labelSpot, dockLabelParts } from './lib/dock-links.js'; // P30: 다리·괄호·둘레 길, P46: 배율별 글
import { Pill } from './Links.jsx';
import { pairLabels, pairAwake, pairKey, dockRestLevel } from './lib/link-labels.js'; // P67: 한 쌍에 글 하나, 물러나기

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

// P73: 덩어리 바깥 테두리(네 변). side 쪽으로 덩어리 전체가 커지거나 줄고 칸은 비율대로 함께 바뀐다(맞은편 변은 그대로)
function DockEdgeInner({ data }) {
  const dragWith = useDrag(data.dockId);
  const { dockId, side } = data;
  useT();
  const zoom = useFlowStore(zoomSel);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const d = getState().docks.get(dockId);
    if (!d) return;
    const outer = dockOuterNow(d);
    if (!outer) return;
    let last = null;
    dragWith(e, zoom, (dx, dy) => {
      last = dragOuter(d.tree, outer, side, side === 'left' || side === 'right' ? dx : dy);
      setNodesLocal([...layoutTree(d.tree, last).rects]);
    }, (moved) => {
      if (!moved || !last) return;
      api.call('dock.update', { dock: dockId, x: last.x, y: last.y, w: last.w, h: last.h }).catch(fail('edgeError'));
    });
  };
  const dir = side === 'left' || side === 'right' ? 'row' : 'col';
  return <div className={`mt-dockedge ${dir} s-${side} nodrag nopan`} style={hitStyle(zoom)} onPointerDown={onPointerDown} data-role="dock-edge" data-dock={dockId} data-side={side} title={t('sizeBar.edgeTitle')} />;
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

// P30: 덩어리 안 연결은 터미널 위로 선을 긋지 않는다(lib/dock-links.js dockRoutes). data.rects: 구성 노드 자리(덩어리 바깥 왼쪽 위 기준)
// - 맞닿은 두 칸: 경계선 위 작은 알약(다리). 화살표는 시키는 쪽 → 받는 쪽, 마우스를 올리면 역할 이름이 펼쳐진다.
// - 같은 바깥 변에 닿는 두 칸: 그 변 바깥에 ] 모양 괄호. 그 밖: 덩어리 둘레를 도는 ㄱ자 길. 바깥 길은 차선을 나눠 겹치지 않는다.
// - 둘레에 닿지 않는 칸이 낀 연결: 그 칸 머리줄 위 작은 칩(← 시킨 쪽, → 받는 쪽).
// - 색은 받는 쪽 상태(선 이름표와 같다), 일이 오가면(Links.jsx와 같은 조건) 화살표가 흐른다. 누르면 오간 기록(LinkPanel).
// - 덩어리 안 한 칸에 마우스를 올리거나 초점(고름 > 눌러 들어감)이 있으면 그 칸에 닿는 것만 진하게, 나머지는 옅게.
// - P46: 배율이 0.4보다 작을 때만 화살표 블록(mini). 0.4부터 역할 이름(short), 0.8부터 @시킨 쪽 → @받는 쪽 · 역할 · 받는 쪽 상태 알약(full).
//   글은 선을 따라 놓는다(세로 경계·세로 선분이면 세운다). 자리가 모자라면 한 단계 내리고, 그래도 넘치면 줄임표. 마우스를 올리면 다 펼친다.
//   말과 모양은 덩어리 밖 선 글(Links.jsx)과 같다: 역할 이름, 띄움 꼬리표(mt-edge-tag), 상태 알약(Pill).
const ARROW = { right: '→', left: '←', down: '↓', up: '↑' };
const FLOW = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
function DockLinksInner({ data, positionAbsoluteX = 0, positionAbsoluteY = 0 }) {
  const { dockId, rects } = data;
  useT();
  const zoom = useFlowStore(zoomSel);
  const links = useStore((st) => st.links);
  const sessions = useStore((st) => st.sessions);
  const selected = useStore((st) => st.selected);
  const focusId = useStore((st) => st.focusId);
  const [hoverCell, setHoverCell] = useState(null);
  const [hoverLink, setHoverLink] = useState(null);
  // 마우스가 이 덩어리의 어느 칸 위인가(노드 DOM의 data-dock, data-session)
  useEffect(() => {
    const over = (e) => {
      const el = e.target && e.target.closest ? e.target.closest('.mt-node') : null;
      setHoverCell(el && el.dataset.dock === dockId ? el.dataset.session : null);
    };
    document.addEventListener('pointerover', over);
    return () => document.removeEventListener('pointerover', over);
  }, [dockId]);
  const focus = useFlowStore((s) => {
    const [tx, ty, z] = s.transform;
    const view = s.width && s.height ? { x: -tx / z - positionAbsoluteX, y: -ty / z - positionAbsoluteY, w: s.width / z, h: s.height / z } : null;
    return dockFocus({ rects, selected, focusId, view, center: false });
  });
  const z = Math.max(zoom, 0.02);
  const inside = useMemo(() => [...links.values()].filter((l) => rects[l.from] && rects[l.to]), [links, rects]);
  // P67: 한 쌍(방향 상관없이)에 글 하나. 다리·칩은 쌍의 대표 연결(가장 최근)만 놓고, 둘레 길·괄호는 선을 모두 긋되 글은 대표에만 단다
  const pairs = useMemo(() => pairLabels(inside), [inside]);
  const primaries = useMemo(() => [...pairs.values()].map((p) => p.primary), [pairs]);
  const routed = useMemo(() => dockRoutes(rects, inside, { gap: 16 / z, step: 11 / z }), [rects, inside, z]);
  const lead = useMemo(() => dockRoutes(rects, primaries, { gap: 16 / z, step: 11 / z }), [rects, primaries, z]);
  const res = { routes: routed.routes, bridges: lead.bridges, chips: lead.chips };
  const byId = new Map(inside.map((l) => [l.linkId, l]));
  const dialogLink = useStore((st) => (st.dialog && st.dialog.kind === 'link' ? st.dialog.linkId : null));
  const [, setTick] = useState(0); // 시간이 지나 물러나도록 다시 그린다
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 15000); return () => clearInterval(i); }, []);
  const now = Date.now();
  const pairOf = (l) => pairs.get(pairKey(l.from, l.to));
  const isLead = (l) => { const p = pairOf(l); return !!p && p.primary.linkId === l.linkId; };
  // 물러난 글은 short(역할 이름)까지만. 마우스를 올리거나 그 연결 대화상자가 열려 있으면 그대로
  const rest = (l, level) => {
    const p = pairOf(l);
    if (!p) return level;
    const hot = (hoverLink && p.links.some((x) => x.linkId === hoverLink)) || (dialogLink && p.links.some((x) => x.linkId === dialogLink));
    return dockRestLevel(level, { awake: pairAwake(p, sessions, now).awake, hot });
  };
  const moreOf = (l) => { const p = pairOf(l); return p && p.more > 0 ? <span className="mt-edge-more" data-role="link-more" title={t('linkLabel.moreTitle', { n: p.more })}>{t('linkLabel.more', { n: p.more })}</span> : null; };
  const hot = hoverLink ? null : hoverCell || focus; // 연결 하나에 올렸으면 그것만
  const look = (l) => {
    const to = sessions.get(l.to);
    const on = hoverLink ? hoverLink === l.linkId : hot ? touches(l, hot) : null;
    return `st-${to ? to.state : 'exited'}${linkActive(l, to) ? ' active' : ''}${on === true ? ' hot' : on === false ? ' dim' : ''}${l.role ? ' role' : ''}`;
  };
  const nameOf = (id) => (sessions.get(id) || {}).name || '?';
  const names = Object.fromEntries(Object.keys(rects).map((id) => [id, nameOf(id)]));
  const words = { spawned: t('links.spawned'), directed: t('docks.directed') };
  const roleText = (l) => dockLabelParts(l, names, words).role;
  const titleOf = (l) => {
    const to = sessions.get(l.to);
    return t('dockLinks.title', { a: nameOf(l.from), b: nameOf(l.to), role: t('dockLinks.role', { role: roleText(l) }) })
      + (to ? t('dockLinks.state', { b: to.name, state: STATE_LABEL[to.state] || to.state }) : '')
      + (linkActive(l, to) ? t('dockLabel.activeTitle') : '')
      + (l.lastText ? t('docks.markLast', { text: l.lastText }) : '') + t('docks.markClick');
  };
  // P46: 펼친 글(short: 역할, full: @a → @b · 역할 · 상태). noDir: 칩처럼 앞에 이미 상대 이름이 있으면 방향 글을 뺀다
  const body = (l, level, noDir = false) => {
    if (level === 'mini') return <span className="mt-dl-role">{roleText(l)}</span>;
    const p = dockLabelParts(l, names, words);
    const to = sessions.get(l.to);
    return (
      <span className="mt-dl-text" data-role="dock-label">
        {linkActive(l, to) && <i className="mt-dl-live" title={t('dockLabel.active')} />}
        {p.spawnTag && <span className="mt-edge-tag">{t('links.spawned')}</span>}
        {level === 'full' && !noDir && <span className="mt-dl-dir">{p.dir}</span>}
        <span className="mt-dl-role">{p.role}</span>
        {moreOf(l)}
        {level === 'full' && to && <Pill s={to} />}
        {level === 'short' && to && <i className={`mt-edge-dot st-${to.state}`} data-role="link-dot" />}
      </span>
    );
  };
  const open = (id) => (e) => { e.stopPropagation(); openDialog({ kind: 'link', linkId: id }); };
  const hov = (id) => ({ onMouseEnter: () => setHoverLink(id), onMouseLeave: () => setHoverLink((h) => (h === id ? null : h)) });
  const fs = Math.max(10, Math.min(160, 11 / z));
  const tip = hoverLink && res.routes.find((r) => r.linkId === hoverLink);
  const tipSpot = tip ? labelSpot(tip.points) : null;
  const tipAt = tip && byId.get(tip.linkId) && fitDockLabel(zoom, tipSpot.len).level === 'mini' ? tipSpot : null; // 펼친 글이 있으면 따로 띄우지 않는다
  return (
    <div className="mt-docklinks" data-role="dock-links" data-dock={dockId} data-focus={hot || undefined} data-level={fitDockLabel(zoom, 1e9).level}>
      <svg className="mt-docklinks-svg" width="100%" height="100%" style={{ overflow: 'visible' }}>
        {res.routes.map((r) => {
          const l = byId.get(r.linkId);
          if (!l) return null;
          const d = roundedPath(r.points, 10 / z);
          const head = arrowHead(r.points, 9 / z).map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <g key={r.linkId} className={`mt-dl ${r.kind} ${look(l)}`} data-link={r.linkId} data-kind={r.kind} data-lane={r.lane} data-sides={r.sides.join(',')} data-from={l.from} data-to={l.to}
              style={{ '--dash': `${8 / z}px ${6 / z}px`, '--dash-off': `${-14 / z}px` }} onClick={open(r.linkId)} {...hov(r.linkId)}>
              <title>{titleOf(l)}</title>
              <path className="mt-dl-hit" d={d} strokeWidth={14 / z} />
              <path className="mt-dl-casing" d={d} strokeWidth={5.5 / z} />
              <path className="mt-dl-line" d={d} strokeWidth={2.4 / z} />
              <polygon className="mt-dl-head" points={head} strokeWidth={1.5 / z} />
            </g>
          );
        })}
      </svg>
      {/* P46: 바깥 길 위 글(가장 긴 바깥 선분 가운데, 그 선분 방향으로) */}
      {res.routes.map((r) => {
        const l = byId.get(r.linkId);
        if (!l) return null;
        if (!isLead(l)) return null; // P67: 쌍의 글은 대표 연결 하나에만
        const spot = labelSpot(r.points);
        const fit0 = fitDockLabel(zoom, spot.len);
        const fit = { ...fit0, level: rest(l, fit0.level) };
        if (fit.level === 'mini') return null;
        return (
          <button key={`t:${r.linkId}`} className={`mt-dl-rlabel lv-${fit.level}${spot.vertical ? ' vert' : ''} ${look(l)} nodrag nopan`} data-link={r.linkId} data-kind="route-label" data-level={fit.level}
            style={{ left: spot.x, top: spot.y, fontSize: fs, '--max': `${fit.max}px` }} title={titleOf(l)} onClick={open(r.linkId)} {...hov(r.linkId)}>
            {body(l, fit.level)}
          </button>
        );
      })}
      {res.bridges.map((b) => {
        const l = byId.get(b.linkId);
        if (!l) return null;
        const [fx, fy] = FLOW[b.arrow];
        const fit0 = fitDockLabel(zoom, b.span);
        const fit = { ...fit0, level: rest(l, fit0.level) }; // P67: 물러난 글은 역할 이름까지만
        const vert = b.axis === 'v' && fit.level !== 'mini';
        return (
          <button key={b.linkId} className={`mt-dl-bridge axis-${b.axis} lv-${fit.level}${vert ? ' vert' : ''} ${look(l)} nodrag nopan`} data-link={b.linkId} data-kind="bridge" data-arrow={b.arrow} data-from={l.from} data-to={l.to} data-level={fit.level}
            style={{ left: b.x, top: b.y, fontSize: fs, '--fx': fx, '--fy': fy, '--max': `${fit.max}px` }} title={titleOf(l)} onClick={open(b.linkId)} {...hov(b.linkId)}>
            <span className="mt-dl-arrowbox"><span className="mt-dl-arrow">{ARROW[b.arrow]}</span></span>
            {body(l, fit.level)}
          </button>
        );
      })}
      {res.chips.map((c) => {
        const l = byId.get(c.linkId);
        const r = rects[c.cell];
        if (!l || !r) return null;
        const mine = res.chips.filter((x) => x.cell === c.cell);
        const i = mine.indexOf(c);
        const fit0 = fitDockLabel(zoom, r.w / mine.length);
        const fit = { ...fit0, level: rest(l, fit0.level) }; // P67
        return (
          <button key={c.linkId} className={`mt-dl-chip lv-${fit.level} ${look(l)} nodrag nopan`} data-link={c.linkId} data-kind="chip" data-cell={c.cell} data-dir={c.dir} data-level={fit.level}
            style={{ left: r.x + r.w / 2, top: r.y, fontSize: fs, '--i': i, '--max': `${fit.max}px` }} title={titleOf(l)} onClick={open(c.linkId)} {...hov(c.linkId)}>
            <span className="mt-dl-chipname">{t(c.dir === 'in' ? 'dockLinks.chipIn' : 'dockLinks.chipOut', { name: nameOf(c.dir === 'in' ? l.from : l.to) })}</span>
            {fit.level !== 'mini' && body(l, fit.level, true)}
          </button>
        );
      })}
      {tipAt && <div className="mt-dl-tip" style={{ left: tipAt.x, top: tipAt.y, fontSize: fs }}>{roleText(byId.get(tip.linkId))}</div>}
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
