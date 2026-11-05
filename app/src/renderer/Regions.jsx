// 워크스페이스 영역(ARCH 4절 H1·H7, P6a). P24: 이름표에 잠듦 표시와 아낀 메모리, 메뉴에 이 리포 잠재우기·깨우기. P11: 아래쪽 워크스페이스 단추는 위 왼쪽의 워크스페이스 탭(Chrome.jsx)으로 옮겼다
// - 영역: 한 워크스페이스의 노드와 그룹 뒤에 깔리는 배경과 이름표(이름, ⎇ 저장소 / ▢ 폴더, 세는 값). 이름표를 끌면 안의 것이 모두 함께 움직인다.
//   이름표 글자는 화면 기준 크기라 줄여 보아도 읽힌다. 이름표의 단추: 정리(연결을 따라 나무 배치, 사람이 누를 때만), 되돌리기(한 번), + 세션, 모두 보기.
//   다른 영역과 겹치면 빨갛게 보인다(놓으면 되돌린다).
import { memo, useMemo, useState } from 'react';
import { useStore as useFlowStore } from '@xyflow/react';
import { api } from './api.js';
import { useStore, getState, openDialog, selectWorkspace, noteWorkspace, toast, markArranged } from './store.js';
import { Icon } from './lib/icons.jsx';
import { useT, t, errText } from './lib/i18n.js';
import { workspaceCounts } from '../../../backend/src/workspaces.mjs';
import { REGION_HEAD, REGION_GAP } from '../../../backend/src/canvas.mjs';
import { repoSleep, sleepRepo, wakeRepo, fmtMB } from './sleep.js'; // P24: 리포 단위 잠재우기
import { worktreeLabel } from '../../../backend/src/worktree-areas.mjs'; // P27: 워크트리 영역(P35: 리포 영역 안의 노란 상자)

const zoomSel = (s) => s.transform[2];

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
export async function arrangeBoard(undo = false) {
  try {
    if (undo) { await api.call('board.arrange', { all: true, undo: true }); markArranged(BOARD_ARRANGED, false); toast(t('arrangeAll.undone')); return; }
    const r = await api.call('board.arrange', { all: true, apply: true });
    for (const k of [...getState().arranged]) markArranged(k, false); // 워크스페이스 하나의 되돌리기는 지워졌다
    markArranged(BOARD_ARRANGED, true);
    toast(t('arrangeAll.done', { n: (r.regions || []).length }));
    setTimeout(() => { const st = getState(); if (st.fitAll) st.fitAll(250); }, 400); // 다시 놓은 판 전체가 보이게
  } catch (e) { toast(t('regions.arrangeFail', { error: errText(e) }), 'error'); }
}

// P11: 영역은 1.5px 얇은 테두리(안에 일하는 세션이 있으면 청록 회색)로 그리고, 이름표를 테두리 위에 단다(목업의 그룹 이름표: 점, 이름 대문자 굵게, 고정폭 회색 "6 · 3 일하는 중", ⌄).
//   테두리는 영역 맨 위(REGION_HEAD 자리)가 아니라 안의 것 32px 위에 긋는다. 이름표의 단추(정리, 되돌리기, + 세션, 이 영역으로)는 ⌄를 누르거나 이름표에 마우스를 올리면 보인다
export const BORDER_TOP = REGION_HEAD + 8; // 영역 위에서 테두리까지(안의 것보다 REGION_PAD - 8 위)
function RegionNodeInner({ data }) {
  const t = useT();
  const key = data.wsKey;
  const w = useStore((st) => st.workspaces.find((x) => x.key === key));
  const sessions = useStore((st) => st.sessions);
  const arranged = useStore((st) => st.arranged.has(key));
  const current = useStore((st) => st.currentWs === key);
  const convos = useStore((st) => { let n = 0; for (const c of st.convoNodes.values()) if (c.workspaceKey === key) n++; return n; }); // P13: 판 밖 대화 노드 수
  const zoom = useFlowStore(zoomSel);
  const [acts, setActs] = useState(false);
  const c = useMemo(() => workspaceCounts([...sessions.values()], key), [sessions, key]);
  const z = useMemo(() => repoSleep(sessions.values(), key), [sessions, key]); // P24: 잠든 수, 아낀 메모리
  if (!w) return null;
  // 화면에서 13px. 아주 멀리서는 영역 사이 틈(REGION_GAP)을 넘지 않게 줄인다(이름표가 위쪽 영역을 덮지 않게)
  const fs = Math.max(13, Math.min((REGION_HEAD + REGION_GAP * 0.7) / 2.3, 13 / Math.max(zoom, 0.02)));
  const head = fs * 2.1;
  // 이름표는 작을 때 테두리 한가운데에, 커지면 아래 끝이 테두리 조금 아래에 오게(안의 노드를 덜 덮게)
  const top = BORDER_TOP - head + Math.min(head / 2, fs * 0.9);
  return (
    <div className={`mt-region${data.warn ? ' warn' : ''}${c.needsYou ? ' hot' : ''}${c.working ? ' run' : ''}${current ? ' current' : ''}${z.all ? ' asleep' : ''}`} data-ws={key} data-name={w.name} data-asleep={z.asleep || undefined}>
      <div className="mt-region-box" style={{ top: BORDER_TOP }} />
      <div className={`mt-region-head mt-rdrag${acts ? ' acts' : ''}`} style={{ fontSize: fs, height: head, top }} title={t('regions.headTitle', { kind: w.kind === 'repo' ? t('top.wsRepo') : t('top.wsFolder'), root: w.root })}>
        <span className="mt-region-dot" />
        <b className="mt-region-name">{w.name}</b>
        <span className="mt-region-meta"><span data-count="sessions">{c.sessions}</span>{c.working > 0 && <> · <span data-count="working">{t('regions.working', { n: c.working })}</span></>}{convos > 0 && <> · <span data-count="convos">{t('regions.convos', { n: convos })}</span></>}{w.kind !== 'repo' && <> · {t('regions.folder')}</>}</span>
        {c.needsYou > 0 && <span className="mt-ws-c need" data-count="needsYou">{t('top.turnN', { n: c.needsYou })}</span>}
        {c.review > 0 && <span className="mt-ws-c review" data-count="review">{t('regions.review', { n: c.review })}</span>}
        {z.asleep > 0 && <span className={`mt-ws-c asleep${z.all ? ' all' : ''}`} data-count="asleep" title={t('regions.asleepTitle', { n: z.asleep, mb: fmtMB(z.mb) })}><Icon name="moon" />{z.waking ? t('sleep.waking') : z.all ? t('regions.asleepAll', { mb: fmtMB(z.mb) }) : t('regions.asleepN', { n: z.asleep, mb: fmtMB(z.mb) })}</span>}
        <span className="mt-region-acts">
          <button className="mt-btn small nodrag" data-action="arrange" title={t('regions.arrangeTitle')} onClick={() => arrangeWorkspace(key)}>{t('chips.arrange')}</button>
          {arranged && <button className="mt-btn small ghost nodrag" data-action="arrange-undo" onClick={() => arrangeWorkspace(key, true)}>{t('regions.undo')}</button>}
          {z.awake > 0 && <button className="mt-btn small nodrag" data-action="region-sleep" title={t('regions.sleepTitle')} onClick={() => sleepRepo(key)}><Icon name="moon" />{t('regions.sleep')}</button>}
          {z.asleep > 0 && <button className="mt-btn small nodrag" data-action="region-wake" title={t('regions.wakeTitle')} disabled={z.waking > 0} onClick={() => wakeRepo(key)}><Icon name="moon" />{t('regions.wake')}</button>}
          <button className="mt-btn small nodrag" data-action="region-spawn" onClick={() => { noteWorkspace(key); openDialog({ kind: 'spawn', cwd: w.root }); }}>{t('regions.addSession')}</button>
          <button className="mt-btn small ghost nodrag" title={t('regions.fit')} data-action="region-fit" onClick={() => selectWorkspace(key)}>⤢</button>
          <button className="mt-btn small ghost nodrag" title={t('sbRemove.regionTitle')} data-action="region-remove" onClick={() => openDialog({ kind: 'wsclose', ws: [w] })}>{t('sbRemove.region')}</button>{/* P44: 판에서 지우기(세션이 있으면 모두 보관·삭제를 고른다) */}
        </span>
        <button className="mt-region-chev nodrag" title={t('regions.acts')} data-action="region-acts" onClick={() => setActs((a) => !a)}><Icon name="chevDown" /></button>
      </div>
    </div>
  );
}
export const RegionNode = memo(RegionNodeInner);

// P27: 워크트리 영역. P35: 리포 영역 안의 노란 상자(테두리, 옅은 바탕, 이름표 글자 모두 노란 계열, tokens.css --wt-box-*).
//   이름표는 ⎇ 브랜치(폴더 이름이 다르면 함께)와 세는 값. 이름표를 끌면 이 상자와 안의 노드·대화 노드가 함께 움직이고 자리를 저장한다(worktree.move). 누르면 그 리포로 간다.
//   줌 아웃하면 이름표는 리포 영역 이름표처럼 화면 기준 크기로 커지되, 리포 영역 이름표보다 조금 작게 둔다
function WorktreeAreaNodeInner({ data }) {
  const t = useT();
  const zoom = useFlowStore(zoomSel);
  const fs = Math.max(12, Math.min((REGION_HEAD + REGION_GAP * 0.5) / 2.3, 12 / Math.max(zoom, 0.02)));
  const head = fs * 2.1;
  const top = BORDER_TOP - head + Math.min(head / 2, fs * 0.9);
  const { branch, folder } = worktreeLabel({ path: data.path, branch: data.branch });
  return (
    <div className={`mt-region mt-wtarea${data.warn ? ' warn' : ''}${data.working ? ' run' : ''}`} data-ws={data.wsKey} data-area={data.area} data-worktree={data.path} data-branch={branch}>
      <div className="mt-region-box" style={{ top: BORDER_TOP }} />
      <div className="mt-region-head mt-wadrag" style={{ fontSize: fs, height: head, top }} title={t('regions.wtTitle', { path: data.path || '', branch })}>
        <b className="mt-wtarea-name">⎇ {branch}</b>
        {folder && <span className="mt-wtarea-meta" data-role="wt-folder">({folder})</span>}
        <span className="mt-wtarea-meta"><span data-count="sessions">{t('regions.wtSessions', { n: data.n || 0 })}</span>{data.working > 0 && <> · <span data-count="working">{t('regions.working', { n: data.working })}</span></>}{data.convos > 0 && <> · <span data-count="convos">{t('regions.convos', { n: data.convos })}</span></>}</span>
      </div>
    </div>
  );
}
export const WorktreeAreaNode = memo(WorktreeAreaNodeInner);
