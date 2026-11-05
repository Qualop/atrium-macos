// 세션 노드(ARCH 7.1, 7.2): 머리줄(이름, 상태 필, 기다린 시간, 표시)과 본문(가까이·중간·멀리 세 얼굴), 승인 카드
// P4: 잇기 손잡이(오른쪽에서 끌어 다른 노드 왼쪽에 놓는다), 에이전트 종류, 누가 띄웠는지, 워크트리와 브랜치
// P5: 일반 셸(종류, 돌고 있는 명령), 다른 저장소에서 일하는 중 표시
// P6a: 멀리 얼굴을 다시 그렸다(H3: 기다리는 질문을 가장 크게, 마지막 요청과 답 한 줄, 글자 크기는 화면 기준). 기다리는 노드는 줄여 보아도 테두리가 보이고,
//   오래 쉬는 노드는 흐리다. 노드를 누르면 들어간다(Canvas onNodeClick, H4). ⋯ 메뉴: 크기 단계(H7), 떼기(H5). 붙은 노드는 크기 손잡이 대신 분할선을 쓴다.
//   캔버스가 하나라 다른 워크스페이스로 가는 연결도 선으로 그린다(P5의 가장자리 표시는 뺐다)
// P10: 넷째 얼굴 "아이콘"(화면 140px 아래, 머리줄 없이 종류 아이콘과 상태 색만). 멀리 얼굴은 노드 너비에도 맞춰 글을 줄이고 자른다
// P6c: 긴 답이면 머리줄에 "출력 보기"(I1). 루프 배지(I5)와 ⋯ 메뉴의 "루프 만들기"(셸 제외). 셸의 끊긴 명령은 "끊긴 명령"으로 보인다(P6b I8)
// P22: 그룹 표시와 한 줄 메모 단추를 뺐다. 노드를 고르고 Delete를 누르면 X와 같은 닫기 확인을 연다(main.jsx가 store.killAsk로 알린다)
// P28: 닫기 확인에서 Delete를 한 번 더 누르면 삭제 단추에 초점과 표시가 가고 Enter로 확정한다. Esc는 취소. 멀리·아이콘 얼굴은 흐리게 하지 않는다(styles.css)
import { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer, Handle, Position, useStore as useFlowStore } from '@xyflow/react';
import { useStore, getState, saveNode, setNodeLocal, askKey, markSeen, toast, dockOf, setOutputView, openDialog, setKillAsk } from './store.js';
import { shellLine } from './Workspaces.jsx';
import { api } from './api.js';
import { faceFor } from './lib/faces.js';
import { kindOf, SHAPES, stateColor, logoFor, shownKind } from './lib/kinds.js'; // P10: 아이콘 얼굴. P25: shownKind(flavor가 먼저)
import { STATE_LABEL, EXIT_LABEL, ago, askLine } from './lib/labels.js';
import { useT, t, errText, tMsg, tOr } from './lib/i18n.js';
import { TerminalView } from './TerminalView.jsx';
import { ApprovalCard } from './ApprovalCard.jsx';
import { ChatView } from './ChatView.jsx';
import { NodeBoundary } from './ErrorBoundary.jsx';
import { InterruptedBanner } from './SessionExtras.jsx';
import { enterSession, markInteracted } from './touch.js';
import { LoopBadge, SessionLoopList } from './Loops.jsx';
import { BranchBadge } from './Branch.jsx'; // P8(K4): "@lead의 워커 · 2단계"
import { Icon } from './lib/icons.jsx';
import { dotVar } from './lib/tokens.js';
import { ANSWER_H } from './ApprovalCard.jsx';
import { dt } from './lib/dock-text.js'; // P17
import { wakeSession, fmtMB } from './sleep.js'; // P21(D4), P24: 잠재우기는 리포 단위(영역 이름표 메뉴)
import { fmtTime } from './lib/i18n.js';
import { confirmKey } from './lib/keys.js'; // P28: 닫기 확인에서 Delete 한 번 더, Esc

const zoomSel = (s) => s.transform[2];
// 이 배율보다 작으면 머리줄의 메모리·모델·작은 단추를 숨기고 이름과 상태만 화면 기준 크기로 보인다(사용성 평가 2026-10-31)
const SMALL_ZOOM = 0.7;

function useTick(on) {
  const [, set] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => set((x) => x + 1), 1000); return () => clearInterval(t); }, [on]);
}

// P11: 상태 알약(한글, 점 + 테두리). 끝난 턴을 아직 안 본 준비 상태는 "검토 대기"(연보라)로 보인다
export function StatePill({ s }) {
  const t = useT();
  const review = s.unseen && (s.state === 'ready' || s.state === 'shell_idle');
  const label = s.waking ? t('sleep.waking') : review ? t('node.review') : STATE_LABEL[s.state] || s.state; // P21: 깨우는 동안
  const title = `${STATE_LABEL[s.state] || s.state}${s.estimate ? t('node.estimate', { v: s.estimate }) : ''}`;
  return <span className={`mt-pill st-${s.state}${review ? ' st-review' : ''}${s.estimate ? ' estimate' : ''}${s.waking ? ' st-waking' : ''}`} data-state={s.state} data-waking={s.waking ? '1' : undefined} title={title}>{s.state === 'sleeping' && !s.waking && <Icon name="moon" />}{label}{s.estimate ? '?' : ''}</span>;
}

function Badges({ s }) {
  const t = useT();
  return <>
    {s.unseen && !(s.state === 'ready' || s.state === 'shell_idle') && <span className="mt-badge review" data-flag="unseen">{t('node.review')}</span>}
    {s.delivering > 0 && <span className="mt-badge deliver" title={t('node.deliverTitle')}>{t('node.deliver', { n: s.delivering })}</span>}
    {s.quiet && <span className="mt-badge quiet">{t('node.quiet')}</span>}
    {s.interruptedTurn && (s.kind === 'shell' ? <span className="mt-badge warn" data-role="interrupted-badge" title={t('node.interruptedCmdTitle')}>{t('node.interruptedCmd')}</span> : <span className="mt-badge warn" data-role="interrupted-badge" title={t('node.interruptedTurnTitle')}>{t('node.interruptedTurn')}</span>)}
    {s.permissionMode && s.permissionMode !== 'default' && s.permissionMode !== 'manual' && s.hooked && <span className="mt-badge mode">{tOr(`permissionModes.${s.permissionMode}`, s.permissionMode)}</span>}
  </>;
}

// 에이전트 종류(Claude Code가 아니면), 누가 띄웠는지(F3)
function Origin({ s }) {
  const t = useT();
  const parent = useStore((st) => (s.parentSessionId ? st.sessions.get(s.parentSessionId) : null));
  return <>
    {/* P25: 띄운 방법(DeepSeek). 판이 띄운 Claude Code면 hook이 붙고, 직접 명령이면 hook 없이 셸에서 뜬다 */}
    {s.flavor && <span className="mt-badge kind flavor" data-kind={s.flavor} data-role="flavor-badge" title={t(s.hooked ? 'node.flavorHookedTitle' : 'node.flavorCommandTitle', { kind: kindOf(s.flavor).label })}>{kindOf(s.flavor).label}</span>}
    {s.kind === 'shell' && <span className="mt-badge kind shell" data-kind="shell" title={t('node.shellTitle')}>{t('node.shell')}</span>}
    {s.kind && s.kind !== 'claude' && s.kind !== 'shell' && <span className="mt-badge kind" data-kind={s.kind} title={t('node.kindTitle')}>{kindOf(s.kind).label}</span>}
    {s.fromShell && <span className="mt-badge kind" data-role="from-shell" title={t('node.fromShellTitle')}>{t('node.fromShell')}</span>}
    {s.imported && <span className="mt-badge adopted" data-role="imported-badge" title={t('node.importedTitle', { title: s.imported.title || '', gen: s.imported.gen })}>{t('node.imported')}</span>}
    {s.origin === 'adopted' && <span className="mt-badge adopted" data-role="adopted" title={s.kind === 'shell' ? t('node.adoptedShellTitle', { pane: s.paneId }) : t('node.adoptedAgentTitle', { name: s.agentName })}>{parent ? t('node.spawnedBy', { name: parent.name }) : t('node.adopted')}</span>}
    {s.elsewhere && <span className="mt-badge warn" data-role="elsewhere" title={t('node.elsewhereTitle', { cwd: s.cwdNow })}>{t(s.elsewhere.repo ? 'node.elsewhereRepo' : 'node.elsewhereFolder', { name: s.elsewhere.name })}</span>}
  </>;
}

// 워크트리와 브랜치(F4). 판은 워크트리를 만들지 않고 보여주기만 한다
function GitLine({ s }) {
  const t = useT();
  const g = s.git;
  if (!g || !g.isRepo) return null;
  const short = (p) => String(p || '').replace(/^.*?([^/]+\/[^/]+)$/, '…/$1');
  return (
    <div className={`mt-node-git${g.isWorktree ? ' wt' : ''}`} data-role="git" data-worktree={g.isWorktree ? '1' : '0'} title={t('node.gitTitle', { cwd: g.cwd, root: g.root }) + (g.isWorktree ? t('node.gitMain', { main: g.mainRoot || g.commonDir }) : '')}>
      <span>⎇ {g.branch || '?'}</span>
      {g.isWorktree ? <span className="mt-node-wt">{t('node.worktree', { path: short(g.root) })}</span> : <span className="mt-node-dim">{short(g.root)}</span>}
      {g.changedFiles > 0 && <span className="mt-node-dim">{t('node.changedFiles', { n: g.changedFiles })}</span>}
    </div>
  );
}

// P11: 콘솔 머리(목업): 종류 아이콘, 세션마다 다른 색 점, 이름(굵게), 표시들, 오른쪽에 상태 알약과 동작 아이콘.
//   머리 높이와 글은 월드 28px·13px이 기준이고, 멀리 볼 때는 화면에서 11px 아래로 작아지지 않게 키운다(styles.css --inv)
function Header({ s, onKill, onMenu, onLoops }) {
  const t = useT();
  const waiting = s.state === 'waiting' || s.state === 'trust_wait';
  useTick(waiting);
  const since = s.ask && s.ask.since;
  // D1: 약 30초마다 오는 자원 이벤트에서 이 세션의 메모리
  const mem = useStore((st) => { const r = st.resources && st.resources.sessions.find((x) => x.sessionId === s.sessionId); return r ? r.memMB : null; });
  return (
    <div className="mt-node-head mt-drag">
      <span className="mt-head-kind"><KindIcon kind={shownKind(s)} state={s.state} /></span>
      <span className="mt-head-dot" style={{ background: dotVar(s.name) }} />
      <span className="mt-node-name" title={`@${s.name}
${s.cwd}
${s.sessionId}`}>{s.name}</span>
      {/* 표시들은 좁으면 먼저 잘린다(이름이 먼저 보이게) */}
      <span className="mt-head-badges"><Badges s={s} /><Origin s={s} /><BranchBadge s={s} /><LoopBadge s={s} onClick={onLoops} /></span>
      <span className="mt-node-sp" />
      {s.output && s.output.long && <button className="mt-btn small nodrag mt-output-btn" data-action="output-open" title={t('node.outputTitle', { n: s.output.chars })} onClick={() => setOutputView({ sessionId: s.sessionId, turn: null })}>{t('node.output')}</button>}
      {mem != null && mem >= 1 && <span className="mt-node-meta" data-role="mem" title={t('node.memTitle')}>{mem >= 1024 ? `${(mem / 1024).toFixed(1)}GB` : `${Math.round(mem)}MB`}</span>}
      {s.model && <span className="mt-node-meta" title={s.cwd}>{s.model}</span>}
      {waiting && since && <span className="mt-waited">{ago(since)}</span>}
      <StatePill s={s} />
      <button className="mt-x nodrag" title={t('node.menuTitle')} data-action="node-menu" onClick={onMenu}><Icon name="more" /></button>
      <button className="mt-x nodrag kill" title={t('node.killTitle')} data-action="kill" onClick={onKill}><Icon name="x" /></button>
    </div>
  );
}

const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// 멀리 얼굴(H3): 이름, 상태, 기다리는 질문(가장 크게), 마지막 사용자 요청 한 줄, 마지막 답 한 줄. 글자 크기는 화면 기준(px / 배율)이고 노드 높이에 맞춰 줄인다.
// P10: 노드 너비에도 맞춰 줄인다(한 줄에 열몇 자는 들어가게). 이름 줄은 한 줄로 자르고, 좁으면(화면 180px 아래) 표시는 상태 필만 남긴다. 줄은 넘치면 자른다(styles.css)
function FarFace({ s, zoom, w, h }) {
  const t = useT();
  const px = (n, frac, wfrac) => Math.min(n / Math.max(zoom, 0.02), h * frac, w * wfrac);
  const waiting = s.state === 'waiting' || s.state === 'trust_wait';
  const narrow = w * zoom < 180;
  return (
    <div className="mt-far" style={{ fontSize: px(12, 0.17, 1 / 16) }} data-role="far">
      <div className="mt-far-name" style={{ fontSize: px(14, 0.2, 1 / 13) }}><span className="mt-far-nm">@{s.name}</span> <StatePill s={s} />{!narrow && <>{s.flavor ? <span className="mt-badge kind">{kindOf(s.flavor).label}</span> : s.kind && s.kind !== 'claude' ?<span className="mt-badge kind">{s.kind === 'shell' ? t('node.shell') : kindOf(s.kind).label}</span> : null}{s.unseen && <span className="mt-badge review">{t('node.review')}</span>}<BranchBadge s={s} /></>}</div>
      {waiting && <div className="mt-far-ask" data-role="far-ask" style={{ fontSize: px(15, 0.21, 1 / 14) }}>{askLine(s) || t('node.waitingForYou')}</div>}
      {s.kind === 'shell' && <div className="mt-far-line" data-role="shell-line">{shellLine(s)}</div>}
      {s.elsewhere && <div className="mt-far-line warn">↪ {t('node.workingIn', { name: s.elsewhere.name })}</div>}
      {s.state === 'exited' && <div className="mt-far-line">{EXIT_LABEL[s.exit && s.exit.kind] || t('state.exited')}</div>}
      {s.lastPrompt && <div className="mt-far-line one prompt" data-role="far-prompt"><span className="mt-far-k">{t('node.prompt')}</span> {oneLine(s.lastPrompt)}</div>}
      {s.lastAnswer && <div className="mt-far-line one" data-role="far-answer"><span className="mt-far-k">{t('node.answer')}</span> {oneLine(s.lastAnswer)}</div>}
    </div>
  );
}

// P10: 아주 멀리서(아이콘 얼굴, lib/faces.js FACE_ICON_PX 아래) 노드 안에는 글을 넣지 않고 에이전트 종류 아이콘 하나와 상태 색(테두리, 점)만 그린다.
// 아이콘은 lib/kinds.js에 모았다(로고 파일을 넣으면 그 그림). 이 얼굴 전체가 끌기 손잡이다(머리줄을 숨기므로)
// badge: 바탕이 있는 그림(왼쪽 레일의 새 세션 단추). 없으면 보통 로고
export function KindIcon({ kind, title, state, badge = false }) {
  useT(); // 종류 이름(셸, 에이전트)이 언어를 따른다
  const k = kindOf(kind);
  const logo = (badge && k.logoBadge) || logoFor(k, state);
  if (logo) return <img className="mt-kind-icon" src={logo} alt={k.label} title={title || k.label} draggable={false} data-kind={k.id} />;
  const d = SHAPES[k.shape];
  const fs = k.mark.length > 1 ? 34 : 46;
  return (
    <svg className="mt-kind-icon" viewBox="0 0 100 100" role="img" aria-label={k.label} data-kind={k.id}>
      <title>{title || k.label}</title>
      {d ? <path d={d} style={{ fill: k.color }} /> : <circle cx="50" cy="50" r="44" style={{ fill: k.color }} />}
      <text x="50" y="50" dy=".36em" textAnchor="middle" fontSize={fs} fontWeight="800" style={{ fill: k.ink, fontFamily: 'var(--font-ui)' }}>{k.mark}</text>
    </svg>
  );
}
function IconFace({ s }) {
  useT();
  const k = kindOf(shownKind(s));
  return (
    <div className="mt-iconface mt-drag" data-role="icon-face" data-kind={k.id} style={{ '--sc': stateColor(s.state) }} title={`@${s.name} · ${k.label} · ${STATE_LABEL[s.state] || s.state}`}>
      <KindIcon kind={shownKind(s)} state={s.state} title={`@${s.name} · ${k.label}`} />
      {/* P11: 타일 아래쪽에 이름(화면 기준 글자 크기, 넘치면 자른다) */}
      <span className="mt-icon-name" data-role="icon-name">{s.name}</span>
      <span className="mt-icon-dot" data-state={s.state} />
      {s.state === 'sleeping' && <span className="mt-icon-moon" data-role="icon-moon"><Icon name="moon" /></span>}
    </div>
  );
}

// 아주 멀리서(노드가 화면에서 160px보다 낮을 때, 아이콘 얼굴이면 늘) 기다리는 노드: 노드 안에는 질문이 들어가지 않으므로 노드 위에 말풍선으로 띄운다(화면 기준 글자 크기, H3).
// 아이콘 얼굴에서는 노드보다 넓게(화면 220px) 노드 가운데에 맞춰 띄워 글이 한 글자씩 꺾이지 않게 한다
function AskCallout({ s }) {
  const t = useT();
  return (
    <div className="mt-callout" data-role="ask-callout">
      <div className="mt-callout-ask"><b>@{s.name}</b> {askLine(s) || t('node.waitingForYou')}</div>
      {s.lastPrompt && <div className="mt-callout-line"><span className="mt-far-k">{t('node.prompt')}</span> {oneLine(s.lastPrompt)}</div>}
    </div>
  );
}

// ⋯ 메뉴: 크기 단계(H7), 덩어리에서 떼기(H5), 루프 만들기(I5, P6c)
function NodeMenu({ s, docked, onClose }) {
  const t = useT();
  const call = (method, p) => api.call(method, p).then(onClose, (e) => toast(errText(e), 'error'));
  return (
    <div className="mt-menu nodrag" data-role="node-menu" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mt-menu-row"><span className="dim">{t('node.size')}</span>
        {[['large', t('node.sizeLarge')], ['normal', t('node.sizeNormal')], ['small', t('node.sizeSmall')]].map(([k, l]) => <button key={k} className="mt-btn small" data-size={k} onClick={() => call('board.setSize', { session: s.sessionId, size: k })}>{l}</button>)}
      </div>
      {/* P21(D4)·P24: 잠든 노드는 그 리포를 깨운다. 잠재우기는 리포 단위라 영역 이름표 메뉴에 있다 */}
      {s.state === 'sleeping' && <div className="mt-menu-row"><button className="mt-btn small" data-action="wake" disabled={!!s.waking} onClick={() => { onClose(); wakeSession(s.sessionId); }}><Icon name="moon" />{t('sleep.menuWake')}</button><span className="dim">{t('sleep.menuWakeHint')}</span></div>}
      {s.kind !== 'shell' && <div className="mt-menu-row"><button className="mt-btn small" data-action="loop-new" onClick={() => { onClose(); openDialog({ kind: 'loop', target: { session: s.sessionId } }); }}>{t('node.loopNew')}</button><span className="dim">{t('node.loopNewHint')}</span></div>}
      {docked && <div className="mt-menu-row"><button className="mt-btn small" data-action="undock" onClick={() => call('dock.remove', { session: s.sessionId })}>{dt('undock')}</button><span className="dim">{dt('undockHint')}</span></div>}
      <div className="mt-menu-row dim" data-role="dock-hint">{dt('dockHint')}</div>
      <div className="mt-menu-row"><button className="mt-btn small ghost" data-action="menu-close" onClick={onClose}>{t('common.close')}</button></div>
    </div>
  );
}

// P21(D4): 잠든 노드의 요약 얼굴(가까이·중간·멀리 모두). 흐리게, 달, 이름, 마지막 요청과 답 앞부분, 잠든 시각, 아낀 메모리, 깨우기.
// 멀리 얼굴이면 글자 크기를 FarFace처럼 화면 기준으로 둔다. 크기와 자리는 그대로라 깨면 같은 자리에서 터미널이 된다
function SleepFace({ s, zoom, w, h, far, close }) { // 깨우기 단추는 가까이 얼굴에서만(작은 얼굴은 노드를 누르면 깨운다)
  const t = useT();
  const z = s.sleep || {};
  const px = (n, frac, wfrac) => Math.min(n / Math.max(zoom, 0.02), h * frac, w * wfrac);
  const wake = (e) => { e.stopPropagation(); const st = getState(); if (st.navigateTo) st.navigateTo(s.sessionId, { focusTerminal: true }); else wakeSession(s.sessionId); };
  return (
    <div className={`mt-sleepface${far ? ' far' : ''}${s.waking ? ' waking' : ''}`} data-role="sleep-face" style={{ fontSize: px(13, 0.17, 1 / 16) }}>
      <div className="mt-sleep-head" style={{ fontSize: px(14, 0.2, 1 / 13) }}>
        <span className="mt-sleep-moon"><Icon name="moon" /></span>
        <b className="mt-far-nm">@{s.name}</b>
        <span className="mt-sleep-at" data-role="slept-at">{z.at ? t('sleep.sleptAt', { time: fmtTime(z.at) }) : t('sleep.face')}</span>
        {z.memMB > 0 && <span className="mt-sleep-saved" data-role="sleep-saved">{t('sleep.saved', { mb: fmtMB(z.memMB) })}</span>}
      </div>
      {s.imported && s.imported.title && <div className="mt-far-line one mt-sleep-title" data-role="import-title" title={t('node.importedTitle', { title: s.imported.title, gen: s.imported.gen })}>{s.imported.title}</div>}
      {s.lastPrompt && <div className="mt-far-line one prompt" data-role="sleep-prompt"><span className="mt-far-k">{t('node.prompt')}</span> {oneLine(s.lastPrompt)}</div>}
      {s.lastAnswer && <div className="mt-far-line" data-role="sleep-answer"><span className="mt-far-k">{t('node.answer')}</span> {oneLine(s.lastAnswer).slice(0, 400)}</div>}
      {z.error && !s.waking && <div className="mt-far-line warn" data-role="wake-error">{t('sleep.failed', { error: z.error.message || z.error.code })}</div>}
      {close && <div className="mt-sleep-actions"><button className="mt-btn nodrag" data-action="wake-face" disabled={!!s.waking} title={t('sleep.wakeTitle')} onClick={wake}>{s.waking ? t('sleep.waking') : t('sleep.wake')}</button></div>}
    </div>
  );
}

const IDLE_DIM_MS = 30 * 60 * 1000; // 이만큼 아무 일이 없던 쉬는 노드는 흐리게(H3)

function CloseWaiting({ s }) {
  const t = useT();
  return (
    <div className="mt-placeholder">
      <div>{t('node.overBudget')}</div>
      {s.lastAnswer && <div className="mt-far-line">{t('node.lastAnswer')} {s.lastAnswer.replace(/\s+/g, ' ').slice(0, 200)}</div>}
    </div>
  );
}

// P28: 떠 있는 닫기 확인(노드 안 KillConfirm, 창 가운데 CloseDialog)의 키. 여럿이 떠 있으면 마지막에 뜬 것만 받는다.
// 창의 캡처 단계에서 받아 main.jsx의 Delete(닫기 확인 열기)보다 먼저 막는다
const confirmStack = [];
let confirmListening = false;
function onConfirmKey(e) {
  const top = confirmStack[confirmStack.length - 1];
  const k = top && confirmKey(e);
  if (!k) return;
  e.preventDefault(); e.stopPropagation();
  top.current(k);
}
function useConfirmKeys(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    confirmStack.push(ref);
    if (!confirmListening) { window.addEventListener('keydown', onConfirmKey, true); confirmListening = true; }
    return () => { const i = confirmStack.indexOf(ref); if (i >= 0) confirmStack.splice(i, 1); };
  }, []);
}
// 삭제 단추를 고른다: 초점을 주고 표시(armed)한다. 바로 지우지 않는다
function useArmDelete() {
  const btn = useRef(null);
  const [armed, setArmed] = useState(false);
  const arm = () => { setArmed(true); if (btn.current) btn.current.focus(); };
  return { btn, armed, arm };
}

// 세션 하나를 닫고(보관 또는 삭제) 결과를 알린다. 닫았으면 true
async function closeOne(s, after, { quiet = false } = {}) {
  try {
    const r = await api.call('session.kill', { session: s.sessionId, confirm: true, after });
    const a = r.after || {};
    if (after === 'archive') { if (!quiet) toast(t('node.closedArchived', { name: s.name })); }
    else if (a.deleted) { if (!quiet) toast(t(a.trashed ? 'node.closedDeletedTrash' : 'node.closedDeleted', { name: s.name })); }
    else toast(t('node.closedNotDeleted', { name: s.name, reason: a.reason ? tOr(`refuse.${a.reason}`, a.label || a.reason) : a.label || '?' }), 'error');
    return true;
  } catch (e) { toast(t('node.closeFail', { error: errText(e) }), 'error'); return false; }
}

// P22: Delete 키로 연 닫기 확인(창 가운데). 고른 노드가 여럿이거나, 하나라도 멀리 보아 머리줄의 X가 숨었을 때. X의 확인과 같이 보관·삭제·취소를 묻고 고른 세션 모두에 한다
export function CloseDialog({ ids, onClose }) {
  const t = useT();
  const sessions = useStore((st) => st.sessions);
  const list = ids.map((id) => sessions.get(id)).filter(Boolean);
  const one = list.length === 1 ? list[0] : null;
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(0);
  useEffect(() => { if (one) api.call('session.kill', { session: one.sessionId }).then((r) => setMsg(r || {})).catch((e) => setMsg({ error: e })); }, [one && one.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const del = useArmDelete();
  useConfirmKeys((k) => { if (busy) return; if (k === 'cancel') onClose(); else del.arm(); });
  if (!list.length) return null;
  const run = async (after) => {
    setBusy(after);
    let ok = 0;
    for (const s of list) { if (await closeOne(s, after, { quiet: !one })) ok++; setDone((n) => n + 1); }
    if (!one && ok) toast(t(after === 'archive' ? 'close.manyArchived' : 'close.manyDeleted', { n: ok }));
    onClose();
  };
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="mt-modal" data-role="close-dialog" data-count={list.length}>
        <h3>{one ? t('close.titleOne', { name: one.name }) : t('close.titleMany', { n: list.length })}</h3>
        {one ? <div>{!msg ? t('node.confirmLoading') : msg.error ? errText(msg.error) : tMsg(msg)}</div>
          : <><div>{t('close.many', { n: list.length })}</div><div className="mt-close-names mono" data-role="close-names">{list.map((s) => `@${s.name}`).join('  ')}</div></>}
        {busy && !one && <div className="dim" data-role="close-progress">{t('close.progress', { done, n: list.length })}</div>}
        <div className="mt-card-actions">
          <button className="mt-btn" disabled={!!busy} data-action="close-archive" onClick={() => run('archive')}>{busy === 'archive' ? t('node.closing') : t('common.archive')}</button>
          <button ref={del.btn} className={`mt-btn danger${del.armed ? ' armed' : ''}`} disabled={!!busy} data-action="close-delete" onClick={() => run('delete')}>{busy === 'delete' ? t('node.deleting') : t('common.delete')}</button>
          <button className="mt-btn ghost" disabled={!!busy} data-action="close-cancel" onClick={onClose}>{t('common.cancel')}</button>
        </div>
        <div className={`mt-close-keys dim${del.armed ? ' armed' : ''}`} data-role="close-keys">{del.armed ? t('close.keysArmed') : t('close.keys')}</div>
      </div>
    </div>
  );
}

// P15: 닫는 것은 보관이나 삭제다. 보관하면 보관함에서 다시 열고, 삭제하면 대화 기록을 휴지통으로 보내고 판에서 지운다(다시 뜨지 않는다)
function KillConfirm({ s, onClose }) {
  const t = useT();
  const [msg, setMsg] = useState(null); // 백엔드 확인 결과({ message, msg }) 또는 { error }
  const [busy, setBusy] = useState(null); // 'archive' | 'delete'
  const del = useArmDelete();
  useConfirmKeys((k) => { if (busy) return; if (k === 'cancel') onClose(); else del.arm(); });
  useEffect(() => { api.call('session.kill', { session: s.sessionId }).then((r) => setMsg(r || {})).catch((e) => setMsg({ error: e })); }, [s.sessionId]);
  const close = async (after) => {
    setBusy(after);
    if (!(await closeOne(s, after))) setBusy(null);
  };
  return (
    <div className="mt-kill nodrag" data-role="kill-confirm" data-loading={msg ? '0' : '1'}>
      <div>{!msg ? t('node.confirmLoading') : msg.error ? errText(msg.error) : tMsg(msg)}</div>
      <div className="mt-card-actions">
        <button className="mt-btn" disabled={!!busy} data-action="close-archive" onClick={() => close('archive')}>{busy === 'archive' ? t('node.closing') : t('common.archive')}</button>
        <button ref={del.btn} className={`mt-btn danger${del.armed ? ' armed' : ''}`} disabled={!!busy} data-action="close-delete" onClick={() => close('delete')}>{busy === 'delete' ? t('node.deleting') : t('common.delete')}</button>
        <button className="mt-btn ghost" disabled={!!busy} data-action="close-cancel" onClick={onClose}>{t('common.cancel')}</button>
      </div>
      <div className={`mt-close-keys dim${del.armed ? ' armed' : ''}`} data-role="close-keys">{del.armed ? t('close.keysArmed') : t('close.keys')}</div>
    </div>
  );
}

// P31: 대화 보기(.mt-chat)의 세로 스크롤 막대를 누르면 끌기(React Flow, 노드 래퍼의 mousedown)로 넘기지 않는다
const onScrollbarDown = (e) => {
  const el = e.target;
  if (el && el.classList && el.classList.contains('mt-chat') && e.nativeEvent.offsetX >= el.clientWidth) e.stopPropagation();
};

function SessionNodeInner({ id, selected }) {
  const t = useT();
  const s = useStore((st) => st.sessions.get(id));
  const attached = useStore((st) => st.attached && st.attached.includes(id));
  const dismissed = useStore((st) => st.dismissedAsks);
  const focusTick = useStore((st) => (st.focusId === id ? st.focusTick : 0));
  const zoom = useFlowStore(zoomSel);
  const n = useStore((st) => st.nodes.get(id));
  const [killing, setKilling] = useState(false);
  const killAsk = useStore((st) => (st.killAsk && st.killAsk.id === id ? st.killAsk.at : 0));
  const xVisible = useRef(true);
  // P22: Delete 키. X가 보이는 크기면 그 노드의 닫기 확인을, 멀리 보아 X가 숨으면 같은 확인을 창 가운데 대화상자로 연다
  useEffect(() => {
    if (!killAsk) return;
    setKillAsk(null);
    if (xVisible.current) setKilling(true);
    else openDialog({ kind: 'close', ids: [id] });
  }, [killAsk, id]);
  const [menu, setMenu] = useState(false);
  const [loopsOpen, setLoopsOpen] = useState(false);
  const docked = useStore((st) => dockOf(id));
  // P23: 이 덩어리 안 세션끼리 연결이 있으면 가운데 점이 보인다(Docks.jsx DockLinks가 점끼리 선을 겹쳐 그린다)
  const dockLinked = useStore((st) => { const d = dockOf(id); if (!d) return false; for (const l of st.links.values()) if (d.members.includes(l.from) && d.members.includes(l.to)) return true; return false; });
  const prevFace = useRef(null);
  const boom = useStore((st) => st.debugThrow === id);
  if (boom) throw new Error(t('node.debugThrow', { name: s ? s.name : id })); // 오류 경계 시험(setDebugThrow)
  if (!s || !n) return null;
  const face = faceFor(n.w, zoom, attached ? 'close' : prevFace.current); // 경계에서 흔들리지 않게(faces.js 이력)
  prevFace.current = face;
  const far = face === 'far' || face === 'icon';
  xVisible.current = face !== 'icon' && zoom >= SMALL_ZOOM; // 머리줄의 X가 보이는 조건(styles.css .z-small)
  const showCard = (s.state === 'waiting' || s.state === 'trust_wait') && !(s.ask && dismissed.has(askKey(s.ask)));
  const toTerminal = () => { const st = getState(); st.navigateTo && st.navigateTo(id, { focusTerminal: true }); };
  const idle = (s.state === 'ready' || s.state === 'shell_idle') && !s.unseen && s.lastActivityAt && Date.now() - s.lastActivityAt > IDLE_DIM_MS;
  const asleep = s.state === 'sleeping'; // P21: 터미널 대신 잠든 얼굴(아이콘 얼굴은 달 표시)

  return (
    <div className={`mt-node st-${s.state} face-${face} kind-${kindOf(shownKind(s)).id}${s.unseen ? ' unseen' : ''}${showCard && !far ? ' asking' : ''}${selected ? ' selected' : ''}${idle ? ' idle' : ''}${asleep ? ' asleep' : ''}${s.waking ? ' waking' : ''}${docked ? ` docked dock-${docked.dir}${dockLinked ? ' dock-linked' : ''}` : ''}${zoom < SMALL_ZOOM ? ' z-small' : ''}`} style={{ '--inv': 1 / Math.max(zoom, 0.02) }} data-session={id} data-name={s.name} data-face={face} data-asleep={asleep ? '1' : undefined} data-dock={docked ? docked.dockId : undefined} onMouseDown={() => { markSeen(id); enterSession(id); }}>
      <NodeResizer isVisible={selected && face === 'close' && !docked} minWidth={420} minHeight={260} lineClassName="mt-resize-line" handleClassName="mt-resize-handle"
        onResize={(_e, p) => setNodeLocal(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
        onResizeEnd={(_e, p) => { setNodeLocal(id, { x: p.x, y: p.y, w: p.width, h: p.height }); saveNode(id, 'resize'); }} />
      {/* 잇기 손잡이 네 개(판은 connectionMode loose). 끌기 시작한 노드가 시키는 쪽(A)이다. 선은 두 노드가 마주 보는 쪽에 붙인다 */}
      {[['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]].map(([hid, pos]) => (
        <Handle key={hid} type="source" position={pos} id={hid} className={`mt-handle h-${hid}`} title={t('node.handleTitle')} />
      ))}
      {/* P23: 덩어리 안에서는 가장자리 손잡이 대신 가운데 점으로 잇는다(분할선과 겹치지 않게, 잇기 모드에서만 끈다) */}
      {docked && <Handle type="source" position={Position.Top} id="c" className="mt-handle h-c nodrag" title={t('dock.dotTitle')} />}
      {face !== 'icon' && <Header s={s} onKill={() => setKilling(true)} onMenu={() => setMenu((m) => !m)} onLoops={() => setLoopsOpen((o) => !o)} />}
      {!far && <GitLine s={s} />}
      {far && (s.state === 'waiting' || s.state === 'trust_wait') && (face === 'icon' || n.h * zoom < 160) && <AskCallout s={s} />}
      {/* P31: 가까이(터미널)가 아닌 얼굴은 본문 어디를 끌어도 머리줄처럼 노드를 옮긴다(mt-drag, Canvas.jsx onNodeDragStart). 누르기만 하면 들어간다(H4).
          단추·입력·답 카드·링크는 nodrag. 대화 보기의 스크롤 막대를 누른 것은 끌기로 넘기지 않는다 */}
      <div className={`mt-node-body${face !== 'close' ? ' mt-drag' : ''}`} onMouseDownCapture={face === 'middle' ? onScrollbarDown : undefined}>
        <NodeBoundary id={id} label={face === 'close' ? 'terminal' : face} compact>
          {asleep && face !== 'icon' && <SleepFace s={s} zoom={zoom} w={n.w} h={n.h} far={face === 'far'} close={face === 'close'} />}
          {!asleep && face === 'close' && (attached ? <TerminalView sessionId={id} width={n.w} height={n.h} reserve={showCard ? ANSWER_H : 0} focusTick={focusTick} onActivate={() => markSeen(id)} onInput={() => markInteracted(id)} /> : <CloseWaiting s={s} />)}
          {!asleep && face === 'middle' && <ChatView s={s} />}
          {!asleep && face === 'far' && <FarFace s={s} zoom={zoom} w={n.w} h={n.h} />}
          {face === 'icon' && <IconFace s={s} />}
        </NodeBoundary>
        {!far && <div className="mt-node-overlays">
          {s.interruptedTurn && <InterruptedBanner s={s} />}
        </div>}
        {showCard && !far && <ApprovalCard s={s} onTerminal={toTerminal} onAnswered={() => markInteracted(id)} />}
        {killing && <KillConfirm s={s} onClose={() => setKilling(false)} />}
        {menu && <NodeMenu s={s} docked={!!docked} onClose={() => setMenu(false)} />}
        {loopsOpen && <SessionLoopList s={s} onClose={() => setLoopsOpen(false)} />}
      </div>
    </div>
  );
}

export const SessionNode = memo(SessionNodeInner);
