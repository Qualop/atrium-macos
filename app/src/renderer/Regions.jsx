import { autoRootPath } from './lib/folder-display.js';
// 워크스페이스 영역(ARCH 4절 H1·H7, P6a). P24: 이름표에 잠듦 표시와 아낀 메모리, 메뉴에 이 리포 잠재우기·깨우기. P11: 아래쪽 워크스페이스 단추는 위 왼쪽의 워크스페이스 탭(Chrome.jsx)으로 옮겼다
// - 영역: 한 워크스페이스의 노드와 그룹 뒤에 깔리는 배경과 이름표(이름, ⎇ 저장소 / ▢ 폴더, 세는 값). 이름표를 끌면 안의 것이 모두 함께 움직인다.
//   이름표 글자는 화면 기준 크기라 줄여 보아도 읽힌다. 이름표의 단추: 정리(연결을 따라 나무 배치, 사람이 누를 때만), 되돌리기(한 번), + 세션, 모두 보기.
//   다른 영역과 겹치면 빨갛게 보인다(놓으면 되돌린다).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.js';
import { useInvRef, useZoomStyle } from './zoom-var.js'; // P112: 배율을 따르는 이름표 크기를 렌더 없이
import { useStore, getState, openDialog, selectWorkspace, noteWorkspace, toast, markArranged } from './store.js';
import { Icon } from './lib/icons.jsx';
import { useT, t, errText } from './lib/i18n.js';
import { workspaceCounts } from '../../../backend/src/workspaces.mjs';
import { REGION_HEAD, REGION_GAP, GROUP_HEAD, GROUP_PAD } from '../../../backend/src/canvas.mjs'; // P91: 묶음 테두리
import { repoSleep, sleepRepo, wakeRepo, fmtMB } from './sleep.js'; // P24: 리포 단위 잠재우기
import { worktreeLabel } from '../../../backend/src/worktree-areas.mjs'; // P27: 워크트리 영역(P35: 리포 영역 안의 노란 상자)

export async function arrangeWorkspace(key, undo = false) {
  try {
    if (undo) { await api.call('board.arrange', { workspace: key, undo: true }); markArranged(key, false); toast(t('regions.undone')); return; }
    const r = await api.call('board.arrange', { workspace: key, apply: true });
    markArranged(key, true);
    markArranged(BOARD_ARRANGED, false); // 판 전체 정리의 되돌리기는 지워졌다
    toast(r.edges ? t('regions.arranged', { n: r.edges }) : t('regions.arrangedNoLinks'));
  } catch (e) { toast(t('regions.arrangeFail', { error: errText(e) }), 'error'); }
}
// P31: 판 전체 정리(아래 칩 "정리"). 모든 워크스페이스 안을 정리하고 영역(리포 영역과 워크트리 위성 영역 묶음)도 줄 맞춰 다시 놓는다.
// 되돌리기는 칩 줄의 "정리 되돌리기"(한 번). 영역 이름표의 "정리"는 그 영역 안만 그대로다
export const BOARD_ARRANGED = '*';
// P91: 지금 캔버스(React Flow 바탕)의 너비 / 높이. 재지 못하면 창 크기, 그것도 없으면 16:9
export function canvasAspect() {
  try {
    const el = document.querySelector('.react-flow');
    const r = el ? el.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    const a = r.width / r.height;
    return Number.isFinite(a) && a > 0 ? +a.toFixed(3) : 16 / 9;
  } catch { return 16 / 9; }
}
export async function arrangeBoard(undo = false) {
  try {
    if (undo) { await api.call('board.arrange', { all: true, undo: true }); markArranged(BOARD_ARRANGED, false); toast(t('arrangeAll.undone')); return; }
    const r = await api.call('board.arrange', { all: true, apply: true, aspect: canvasAspect() }); // P91: 결과 전체를 캔버스 비율에(휴대폰·태블릿은 그 화면 비율)
    for (const k of [...getState().arranged]) markArranged(k, false); // 워크스페이스 하나의 되돌리기는 지워졌다
    markArranged(BOARD_ARRANGED, true);
    toast(t('arrangeAll.done', { n: (r.regions || []).length }));
    setTimeout(() => { const st = getState(); if (st.fitAll) st.fitAll(250); }, 400); // 다시 놓은 판 전체가 보이게
  } catch (e) { toast(t('regions.arrangeFail', { error: errText(e) }), 'error'); }
}

// P11: 영역은 1.5px 얇은 테두리(안에 일하는 세션이 있으면 청록 회색)로 그리고, 이름표를 테두리 위에 단다(목업의 그룹 이름표: 점, 이름 대문자 굵게, 고정폭 회색 "6 · 3 일하는 중", ⌄).
//   테두리는 영역 맨 위(REGION_HEAD 자리)가 아니라 안의 것 32px 위에 긋는다. 이름표의 단추(정리, 되돌리기, + 세션, 이 영역으로)는 ⌄를 누르거나 이름표에 마우스를 올리면 보인다
export const BORDER_TOP = REGION_HEAD + 8; // 영역 위에서 테두리까지(안의 것보다 REGION_PAD - 8 위)
// 화면에서 13px. 아주 멀리서는 영역 사이 틈(REGION_GAP)을 넘지 않게 줄인다(이름표가 위쪽 영역을 덮지 않게)
// 이름표는 작을 때 테두리 한가운데에, 커지면 아래 끝이 테두리 조금 아래에 오게(안의 노드를 덜 덮게)
// P112: 배율이 바뀔 때마다 영역 전체를 다시 그리지 않게 이름표 style만 useZoomStyle로 쓴다
// macOS 판(사용성): 이름표를 2.6em으로 높여 단추가 화면에서 약 28px이 되게 한다(예전 2.1em, 단추 약 18px). 멀리서의 상한은 같은 높이를 지킨다
const HEAD_EM = 2.6;
const LINGER_MS = 900; // 마우스를 뗀 뒤 단추를 남겨 두는 시간(사용자 요청으로 1.8초의 절반)
const regionHead = (zoom) => {
  const fs = Math.max(13, Math.min((REGION_HEAD + REGION_GAP * 0.7) / HEAD_EM, 13 / Math.max(zoom, 0.02)));
  const head = fs * HEAD_EM;
  return { fontSize: fs, height: head, top: BORDER_TOP - head + Math.min(head / 2, fs * 0.9) };
};
function RegionNodeInner({ data }) {
  const t = useT();
  const key = data.wsKey;
  const w = useStore((st) => st.workspaces.find((x) => x.key === key));
  const sessions = useStore((st) => st.sessions);
  const arranged = useStore((st) => st.arranged.has(key));
  const current = useStore((st) => (st.viewWs || st.currentWs) === key); // P121: 위 바의 켜진 칩과 같이 고른 워크스페이스(터미널이 붙는 곳)
  const convos = useStore((st) => { let n = 0; for (const c of st.convoNodes.values()) if (c.workspaceKey === key) n++; return n; }); // P13: 판 밖 대화 노드 수
  const headRef = useZoomStyle(regionHead, true); // P127: 글자 크기는 배율 계단(±5%)으로
  const actsRef = useRef(null);
  const [acts, setActs] = useState(false); // ⌄로 고정(다시 누르면 풀림)
  // macOS 판(사용성): 마우스를 떼도 단추가 바로 사라지지 않게 LINGER_MS 동안 남긴다. 설정 regionActsAlways면 늘 보인다
  const [hover, setHover] = useState(false);
  const hideTimer = useRef(null);
  const always = useStore((st) => !!(st.settings && st.settings.regionActsAlways));
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const enter = () => { clearTimeout(hideTimer.current); setHover(true); };
  const leave = () => { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setHover(false), LINGER_MS); };
  const [menu, setMenu] = useState(null); // P120: 이름표 메뉴 { x, y }(⌄를 눌렀는데 단추가 다 들어가지 않을 때, 오른쪽 클릭)
  const c = useMemo(() => workspaceCounts([...sessions.values()], key), [sessions, key]);
  const z = useMemo(() => repoSleep(sessions.values(), key), [sessions, key]); // P24: 잠든 수, 아낀 메모리
  if (!w) return null;
  // P120: ⌄. 이름표에 단추가 다 들어가면 지금처럼 단추 줄을 펴고 접는다. 영역이 좁거나 이름이 길어 단추가 잘리면 메뉴로 모아 연다
  const chev = (e) => {
    const a = actsRef.current;
    const clipped = a && getComputedStyle(a).display !== 'none' && a.scrollWidth > a.clientWidth + 1;
    if (clipped) { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); return; }
    setActs((v) => !v);
  };
  const ctx = (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); };
  return (
    <div className={`mt-region${data.warn ? ' warn' : ''}${c.needsYou ? ' hot' : ''}${c.working ? ' run' : ''}${current ? ' current' : ''}${z.all ? ' asleep' : ''}`} data-ws={key} data-name={w.name} data-asleep={z.asleep || undefined}>
      <div className="mt-region-box" style={{ top: BORDER_TOP }} />
      <div className={`mt-region-head mt-rdrag${acts || hover || always ? ' acts' : ''}${acts ? ' pinned' : ''}`} ref={headRef} onContextMenu={ctx} onMouseEnter={enter} onMouseLeave={leave}>
        <span className="mt-region-dot" />
        <b className="mt-region-name" data-label={w.label ? 'rel' : undefined} title={t('regions.headTitle', { kind: w.kind === 'repo' ? t('top.wsRepo') : t('top.wsFolder'), root: w.root })}>{/* macOS 판: 경로 말풍선은 이름에만(단추 위에서 뜨지 않게) */}{w.label || w.name}</b>{/* P91: 저절로 만든 묶음 안에서는 뿌리에서의 상대 경로(전체 경로는 title) */}
        <span className="mt-region-meta"><span data-count="sessions">{c.sessions}</span>{c.working > 0 && <> · <span data-count="working">{t('regions.working', { n: c.working })}</span></>}{convos > 0 && <> · <span data-count="convos">{t('regions.convos', { n: convos })}</span></>}{w.kind !== 'repo' && <> · {t('regions.folder')}</>}</span>
        {c.needsYou > 0 && <span className="mt-ws-c need" data-count="needsYou">{t('top.turnN', { n: c.needsYou })}</span>}
        {c.review > 0 && <span className="mt-ws-c review" data-count="review">{t('regions.review', { n: c.review })}</span>}
        {z.asleep > 0 && <span className={`mt-ws-c asleep${z.all ? ' all' : ''}`} data-count="asleep" title={t('regions.asleepTitle', { n: z.asleep, mb: fmtMB(z.mb) })}><Icon name="moon" />{z.waking ? t('sleep.waking') : z.all ? t('regions.asleepAll', { mb: fmtMB(z.mb) }) : t('regions.asleepN', { n: z.asleep, mb: fmtMB(z.mb) })}</span>}
        <span className="mt-region-acts" ref={actsRef}>
          <button className="mt-btn small nodrag" data-action="arrange" title={t('regions.arrangeTitle')} onClick={() => arrangeWorkspace(key)}>{t('chips.arrange')}</button>
          {arranged && <button className="mt-btn small ghost nodrag" data-action="arrange-undo" onClick={() => arrangeWorkspace(key, true)}>{t('regions.undo')}</button>}
          {z.awake > 0 && <button className="mt-btn small nodrag" data-action="region-sleep" title={t('regions.sleepTitle')} onClick={() => sleepRepo(key)}><Icon name="moon" />{t('regions.sleep')}</button>}
          {z.asleep > 0 && <button className="mt-btn small nodrag" data-action="region-wake" title={t('regions.wakeTitle')} disabled={z.waking > 0} onClick={() => wakeRepo(key)}><Icon name="moon" />{t('regions.wake')}</button>}
          <button className="mt-btn small nodrag" data-action="region-spawn" onClick={() => { noteWorkspace(key); openDialog({ kind: 'spawn', cwd: w.root }); }}>{t('regions.addSession')}</button>
          <button className="mt-btn small ghost nodrag" title={t('regions.fit')} data-action="region-fit" onClick={() => selectWorkspace(key)}>⤢</button>
          <button className="mt-btn small ghost nodrag" title={t('sbRemove.regionTitle')} data-action="region-remove" onClick={() => openDialog({ kind: 'wsclose', ws: [w] })}>{t('sbRemove.region')}</button>{/* P44: 판에서 지우기(세션이 있으면 모두 보관·삭제를 고른다) */}
        </span>
        <button className="mt-region-chev nodrag" title={acts ? t('regions.actsUnpin') : t('regions.acts')} aria-pressed={acts} data-action="region-acts" onClick={chev}><Icon name="chevDown" /></button>
      </div>
      {menu && <RegionMenu at={menu} close={() => setMenu(null)} w={w} arranged={arranged} z={z} />}
    </div>
  );
}
// P120: 영역 이름표 메뉴. 이름표의 단추를 모두 담는다(영역이 좁거나 이름이 길어 단추가 잘려도 지우기에 닿게). 사이드바 메뉴와 같은 생김새
function RegionMenu({ at, close, w, arranged, z }) {
  const t = useT();
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(window.innerWidth - r.width - 4, at.x)), top: Math.max(4, Math.min(window.innerHeight - r.height - 4, at.y)) });
  }, [at]);
  useEffect(() => {
    const down = (e) => { if (box.current && !box.current.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
  }, [close]);
  const key = w.key;
  const item = (action, label, fn, extra = {}) => <button key={action} className={`mt-sb2-mi${extra.danger ? ' danger' : ''}`} data-action={action} disabled={extra.disabled} onClick={() => { close(); fn(); }}>{label}</button>;
  return createPortal(
    <div ref={box} className="mt-sb2-menu" data-role="region-menu" data-ws={key} style={pos || { left: -9999, top: -9999 }} onContextMenu={(e) => e.preventDefault()}>
      <div className="mt-sb2-mh" title={w.root}>{w.label || w.name}</div>
      {item('arrange', t('chips.arrange'), () => arrangeWorkspace(key))}
      {arranged && item('arrange-undo', t('regions.undo'), () => arrangeWorkspace(key, true))}
      {z.awake > 0 && item('region-sleep', t('regions.sleep'), () => sleepRepo(key))}
      {z.asleep > 0 && item('region-wake', t('regions.wake'), () => wakeRepo(key), { disabled: z.waking > 0 })}
      {item('region-spawn', t('regions.addSession'), () => { noteWorkspace(key); openDialog({ kind: 'spawn', cwd: w.root }); })}
      {item('region-fit', t('regions.fit'), () => selectWorkspace(key))}
      <div className="mt-sb2-msep" />
      {item('region-remove', t('sbRemove.menu'), () => openDialog({ kind: 'wsclose', ws: [w] }), { danger: true })}
    </div>,
    document.body,
  );
}
export const RegionNode = memo(RegionNodeInner);

// P27: 워크트리 영역. P35: 리포 영역 안의 노란 상자(테두리, 옅은 바탕, 이름표 글자 모두 노란 계열, tokens.css --wt-box-*).
//   이름표는 ⎇ 브랜치(폴더 이름이 다르면 함께)와 세는 값. 이름표를 끌면 이 상자와 안의 노드·대화 노드가 함께 움직이고 자리를 저장한다(worktree.move). 누르면 그 리포로 간다.
//   줌 아웃하면 이름표는 리포 영역 이름표처럼 화면 기준 크기로 커지되, 리포 영역 이름표보다 조금 작게 둔다
const wtHead = (zoom) => { // macOS 판(사용성): 영역 이름표와 같은 높이 비율(HEAD_EM)
  const fs = Math.max(12.5, Math.min((REGION_HEAD + REGION_GAP * 0.5) / HEAD_EM, 12.5 / Math.max(zoom, 0.02)));
  const head = fs * HEAD_EM;
  return { fontSize: fs, height: head, top: BORDER_TOP - head + Math.min(head / 2, fs * 0.9) };
};
function WorktreeAreaNodeInner({ data }) {
  const t = useT();
  const invRef = useInvRef(); // P112: --inv와 이름표 크기는 렌더 없이(RegionNode와 같다)
  const headRef = useZoomStyle(wtHead, true); // P127: 계단
  const { branch, folder } = worktreeLabel({ path: data.path, branch: data.branch });
  return (
    <div className={`mt-region mt-wtarea${data.warn ? ' warn' : ''}${data.working || data.live ? ' run' : ' rest'}`} ref={invRef} data-ws={data.wsKey} data-area={data.area} data-worktree={data.path} data-branch={branch}>
      <div className="mt-region-box" style={{ top: BORDER_TOP }} />
      <div className="mt-region-head mt-wadrag" ref={headRef} title={t('regions.wtTitle', { path: data.path || '', branch })}>
        <b className="mt-wtarea-name">⎇ {branch}</b>
        {folder && <span className="mt-wtarea-meta" data-role="wt-folder">({folder})</span>}
        <span className="mt-wtarea-meta"><span data-count="sessions">{t('regions.wtSessions', { n: data.n || 0 })}</span>{data.working > 0 && <> · <span data-count="working">{t('regions.working', { n: data.working })}</span></>}{data.convos > 0 && <> · <span data-count="convos">{t('regions.convos', { n: data.convos })}</span></>}</span>
      </div>
    </div>
  );
}
export const WorktreeAreaNode = memo(WorktreeAreaNodeInner);

// P91: 묶음(가상 그룹) 테두리. 구성 영역 둘레의 바깥 띠(점선 없는 옅은 선과 아주 옅은 바탕)와 위 왼쪽 이름표(대문자, 자간, 저절로 만든 묶음이면 ⌂ 표시).
//   이름표를 끌면 구성 영역이 함께 움직인다(group.shift). 줌 아웃하면 이름표는 화면 기준 크기로 커지되 테두리 위 띠(GROUP_HEAD + GROUP_PAD)를 넘지 않는다.
//   가볍게: filter·그림자·끝없는 움직임 없음
// 화면에서 12px. 멀리서는 커지되 영역 사이 틈의 반(테두리 위 빈 곳)을 넘지 않게. 작을 때는 테두리 위 띠 안, 커지면 대부분 테두리 위로
const groupHead = (zoom) => {
  const fs = Math.max(12, Math.min((GROUP_HEAD + GROUP_PAD + REGION_GAP / 2) / 2.2, 12 / Math.max(zoom, 0.02)));
  const headH = fs * 2;
  return { fontSize: fs, height: headH, top: Math.min(Math.max(4, GROUP_HEAD / 2 - fs), -headH * 0.85 + GROUP_HEAD) };
};
function GroupFrameNodeInner({ data }) {
  const t = useT();
  const headRef = useZoomStyle(groupHead, true); // P112: 이름표 크기는 렌더 없이. P127: 계단
  const groups = useStore((st) => st.groups);
  const wss = useStore((st) => st.workspaces);
  const g = (groups || []).find((x) => x.id === data.groupId);
  const title = g && g.auto ? t('groupFrame.autoTitle', { root: autoRootPath(g, wss) || '' }) : t('groupFrame.title');
  return (
    <div className={`mt-wsgroup${data.auto ? ' auto' : ''}`} data-group={data.groupId} data-auto={data.auto ? '1' : undefined}>
      <div className="mt-wsgroup-box" />
      <div className="mt-wsgroup-head mt-gdrag" ref={headRef} title={title}>
        {data.auto && <span className="mt-wsgroup-auto" aria-hidden="true">⌂</span>}
        <b className="mt-wsgroup-name">{g ? g.name : data.name}</b>
        <span className="mt-wsgroup-meta">{t('groupFrame.count', { n: (data.keys || []).length })}</span>
      </div>
    </div>
  );
}
export const GroupFrameNode = memo(GroupFrameNodeInner);
