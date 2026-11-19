import { shortFolder } from './lib/folder-display.js';
// 세션 노드(ARCH 7.1, 7.2): 머리줄(이름, 상태 필, 기다린 시간, 표시)과 본문(가까이·중간·멀리 세 얼굴)
// P104: 승인 입력 대신 응답 안내를 둔다. 질문·신뢰·로그인·오류를 보여 주고 현재 터미널로 연결한다.
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
import { countRender } from './perf-trace.js'; // P146
import { NodeResizer, Handle, Position, useStore as useFlowStore } from '@xyflow/react';
import { useStore, getState, matesNow, saveNode, setNodeLocal, markSeen, toast, dockOf, setOutputView, openDialog, setKillAsk, setRenaming, loadAccounts } from './store.js';
import { shellLine } from './Workspaces.jsx';
import { api } from './api.js';
import { tierFor, faceOfTier, termAllowed, veryClose, zoomStep } from './lib/faces.js'; // P124: 거리 단계(터미널·요약·틀)
import { kindOf, SHAPES, stateColor, logoFor, shownKind } from './lib/kinds.js'; // P10: 아이콘 얼굴. P25: shownKind(flavor가 먼저)
import { STATE_LABEL, EXIT_LABEL, ago, askLine } from './lib/labels.js';
import { useT, t, errText, tMsg, tOr } from './lib/i18n.js';
import { TerminalView } from './TerminalView.jsx';
import { boardPlan } from './crash-watch.js'; // P86
import { ChatView } from './ChatView.jsx';
import { NodeBoundary } from './ErrorBoundary.jsx';
import { InterruptedBanner, ResponseNotice } from './SessionExtras.jsx';
import { enterSession, markInteracted } from './touch.js';
import { LoopBadge, SessionLoopList } from './Loops.jsx';
import { BranchBadge } from './Branch.jsx'; // P8(K4): "@lead의 워커 · 2단계"
import { dockBranchOf } from './lib/dock-branch.js'; // P68: 워크트리끼리 붙인 덩어리의 칸마다 브랜치
import { Icon } from './lib/icons.jsx';
import { dotVar } from './lib/tokens.js';
import { dt } from './lib/dock-text.js'; // P17
import { wakeSession, fmtMB, sleptAlone } from './sleep.js'; // P21(D4), P24: 잠재우기는 리포 단위(영역 이름표 메뉴), P111: 혼자 잠든 세션
import { fmtTime } from './lib/i18n.js';
import { confirmKey } from './lib/keys.js'; // P28: 닫기 확인에서 Delete 한 번 더, Esc
import { RenameInput, useRenaming } from './Rename.jsx'; // P66: 판의 이름 바꾸기
import { addressOf, renamed } from './lib/session-name.js';
import { killWorktreeParam } from './lib/worktree-exit.js'; // P71: 닫기 확인의 워크트리 선택
import { tierOf, runsRing, ringDiag } from './lib/overview.js'; // P85: 멀리 보기 강조 등급과 도는 둘레
import { useInvRef } from './zoom-var.js'; // P112: --inv를 렌더 없이

const zoomSel = (s) => s.transform[2];
// P121: 다른 워크스페이스 노드(요약 얼굴)의 글자 크기. React로 배율을 구독하지 않고 노드 뿌리의 --inv(계단 값, zoom-var.js useInvRef stepped)로 CSS가 센다.
//   min(n / 배율, 높이 비, 너비 비)는 아래 px()와 같은 식이다. 판을 확대·축소해도 이 얼굴은 다시 그리지 않고, 계단이 바뀔 때만 스타일을 다시 센다
const cssPx = (n, frac, wfrac, w, h) => `min(calc(${n}px * var(--inv, 1)), ${+(h * frac).toFixed(2)}px, ${+(w * wfrac).toFixed(2)}px)`;
const noZoom = () => 1;
const NO_BOARD_TERMS = !boardPlan().terms; // P86: 보드 단계 1부터 터미널 대신 대화 보기(얼굴)
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
  // P21: 깨우는 동안. P125: 사람이 스스로 끝낸 세션은 머리 알약도 "직접 종료"
  const label = s.waking ? t('sleep.waking') : review ? t('node.review') : (s.state === 'exited' && s.exit && s.exit.kind === 'user' ? EXIT_LABEL.user : STATE_LABEL[s.state] || s.state);
  const title = `${s.state}${s.estimate ? t('node.estimate', { v: s.estimate }) : ''} · term ${s.termStatus ?? '-'}`;
  return <span className={`mt-pill st-${s.state}${review ? ' st-review' : ''}${s.estimate ? ' estimate' : ''}${s.waking ? ' st-waking' : ''}`} data-state={s.state} data-waking={s.waking ? '1' : undefined} title={title}>{s.state === 'sleeping' && !s.waking && <Icon name="moon" />}{label}{s.estimate ? '?' : ''}</span>;
}

function Badges({ s }) {
  const t = useT();
  return <>
    {s.unseen && !(s.state === 'ready' || s.state === 'shell_idle') && <span className="mt-badge review" data-flag="unseen">{t('node.review')}</span>}
    {s.delivering > 0 && !s.deliveryStuck && <span className="mt-badge deliver" title={t('node.deliverTitle')}>{t('node.deliver', { n: s.delivering })}</span>}
    {s.deliveryStuck && <span className="mt-badge warn" data-role="delivery-stuck" title={t('deliveryStuck.title', { code: s.deliveryStuck.code || s.deliveryStuck.reason, n: s.deliveryStuck.attempts })}>{t('deliveryStuck.badge')}</span>}
    {s.quiet && <span className="mt-badge quiet">{t('node.quiet')}</span>}
    {s.interruptedTurn && (s.kind === 'shell' ? <span className="mt-badge warn" data-role="interrupted-badge" title={t('node.interruptedCmdTitle')}>{t('node.interruptedCmd')}</span> : <span className="mt-badge warn" data-role="interrupted-badge" title={t('node.interruptedTurnTitle')}>{t('node.interruptedTurn')}</span>)}
    {s.permissionMode && s.permissionMode !== 'default' && s.permissionMode !== 'manual' && s.hooked && <span className="mt-badge mode">{tOr(`permissionModes.${s.permissionMode}`, s.permissionMode)}</span>}
  </>;
}

// 에이전트 종류(Claude Code가 아니면), 누가 띄웠는지(F3)
function Origin({ s }) {
  const t = useT();
  const lp = s.lineageParentSessionId !== undefined ? s.lineageParentSessionId : s.parentSessionId; // P159: "@x가 띄움"은 계보(사실)
  const parent = useStore((st) => (lp ? st.sessions.get(lp) : null));
  return <>
    {/* P25: 띄운 방법(런처 아이콘). 판이 띄운 Claude Code면 hook이 붙고, 직접 명령이면 hook 없이 셸에서 뜬다 */}
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
  const short = shortFolder;
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
function Header({ s, onKill, onMenu, onLoops, onModel }) {
  const t = useT();
  const waiting = s.state === 'waiting' || s.state === 'trust_wait';
  useTick(waiting);
  const since = s.waitingSince || (s.ask && s.ask.since); // P141(#14): 다시 켜도 이어지는 시각
  // D1: 약 30초마다 오는 자원 이벤트에서 이 세션의 메모리
  const mem = useStore((st) => { const r = st.resources && st.resources.sessions.find((x) => x.sessionId === s.sessionId); return r ? r.memMB : null; });
  const editing = useRenaming(s.sessionId, 'node');
  const dockBranch = useStore((st) => dockBranchOf(st, s.sessionId)); // P68: '' 또는 'wt|main<탭>브랜치'
  const [dbKind, dbName] = dockBranch ? dockBranch.split('\t') : [];
  return (
    <div className="mt-node-head mt-drag">
      <span className="mt-head-kind"><KindIcon kind={shownKind(s)} state={s.state} /></span>
      <span className="mt-head-dot" style={{ background: dotVar(addressOf(s)) }} />
      {/* P66: 이름을 두 번 누르면(또는 ⋯ 메뉴, F2) 바꾼다. 바꾼 이름이면 옆에 에이전트 주소를 작게 보인다 */}
      {editing
        ? <RenameInput s={s} where="node" className="mt-node-rename" />
        : <span className="mt-node-name" data-role="node-name" title={`@${s.name}${renamed(s) ? `
${t('rename.address', { address: addressOf(s) })}` : ''}
${s.cwd}
${s.sessionId}
${t('rename.dblHint')}`} onDoubleClick={(e) => { e.stopPropagation(); setRenaming(s.sessionId, 'node'); }}>{s.name}</span>}
      {!editing && renamed(s) && <span className="mt-node-addr" data-role="node-address" title={t('rename.address', { address: addressOf(s) })}>{addressOf(s)}</span>}
      {dockBranch && <span className={`mt-dock-branch${dbKind === 'wt' ? ' wt' : ''}`} data-role="dock-branch" data-branch={dbName} title={t(dbKind === 'wt' ? 'dockWorkers.branchWt' : 'dockWorkers.branchMain', { branch: dbName })}>⎇ {dbName}</span>}
      {/* 표시들은 좁으면 먼저 잘린다(이름이 먼저 보이게) */}
      <span className="mt-head-badges"><Badges s={s} /><Origin s={s} /><BranchBadge s={s} /><LoopBadge s={s} onClick={onLoops} /></span>
      <span className="mt-node-sp" />
      {s.output && s.output.long && <button className="mt-btn small nodrag mt-output-btn" data-action="output-open" title={t('node.outputTitle', { n: s.output.chars })} onClick={() => setOutputView({ sessionId: s.sessionId, turn: null })}>{t('node.output')}</button>}
      {mem != null && mem >= 1 && <span className="mt-node-meta" data-role="mem" title={t('node.memTitle')}>{mem >= 1024 ? `${(mem / 1024).toFixed(1)}GB` : `${Math.round(mem)}MB`}</span>}
      <TokenSpeed s={s} />
      {/* macOS 판: Claude Code는 누르면 모델·추론 바꾸기(ModelMenu). 다른 종류는 보이기만 한다 */}
      {(s.kind || 'claude') === 'claude' && s.state !== 'sleeping' && s.state !== 'exited'
        ? <button type="button" className={`mt-node-meta mt-model-chip nodrag${s.pendingModel ? ' pending' : ''}`} data-action="model-menu" title={s.pendingModel ? t('model.pendingTitle', { v: modelLabel(s.pendingModel) }) : t('model.chipTitle')} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onModel(); }}>{modelLabel(s) || t('model.unknown')}</button>
        : s.model && <span className="mt-node-meta" title={s.cwd}>{modelLabel(s)}</span>}
      {waiting && since && <span className="mt-waited">{ago(since)}</span>}
      <StatePill s={s} />
      {/* macOS 판: 머리 오른쪽 단추 묶음은 끌기·선택을 받지 않는 칸이다(조금 빗나가 눌러도 노드가 끌리지 않는다). 단추는 화면에서 24px 아래로 작아지지 않는다 */}
      <span className="mt-head-actions nodrag nopan" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {/* macOS 판: 일하는 중이면 중지(Esc). 일하는 하위 세션도 함께 멈춘다(backend session-stop.mjs) */}
        {(s.state === 'working' || s.state === 'shell_running') && <button type="button" className="mt-x nodrag stop" title={t('node.stopTitle')} aria-label={t('node.stopTitle')} data-action="stop" onClick={() => stopSession(s)}><Icon name="stop" /></button>}
        <button type="button" className="mt-x nodrag" title={t('node.menuTitle')} aria-label={t('node.menuTitle')} data-action="node-menu" onClick={onMenu}><Icon name="more" /></button>
        <button type="button" className="mt-x nodrag kill" title={t('node.killTitle')} aria-label={t('node.killTitle')} data-action="kill" onClick={onKill}><Icon name="x" /></button>
      </span>
    </div>
  );
}

const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// 멀리 얼굴(H3): 이름, 상태, 기다리는 질문(가장 크게), 마지막 사용자 요청 한 줄, 마지막 답 한 줄. 글자 크기는 화면 기준(px / 배율)이고 노드 높이에 맞춰 줄인다.
// P10: 노드 너비에도 맞춰 줄인다(한 줄에 열몇 자는 들어가게). 이름 줄은 한 줄로 자르고, 좁으면(화면 180px 아래) 표시는 상태 필만 남긴다. 줄은 넘치면 자른다(styles.css)
// P121 brief: 다른 워크스페이스의 노드라 터미널 대신 이 얼굴을 보인다. 글자 크기는 노드의 --inv(배율 계단, lib/faces.js zoomStep)를 쓰는 CSS로만 바뀌고, 가까이 크기면(open) 누르면 터미널이 열린다는 한 줄을 더한다
// P124: 요약 얼굴은 모두(고른 워크스페이스의 먼 노드도) 글자 크기를 CSS(--inv 계단 값)로 센다. 배율을 React로 구독하지 않는다
function FarFace({ s, w, h, open = false }) {
  const t = useT();
  const px = (n, frac, wfrac) => cssPx(n, frac, wfrac, w, h);
  const waiting = s.state === 'waiting' || s.state === 'trust_wait';
  const narrow = useFlowStore((st) => w * zoomStep(st.transform[2]) < 180); // 좁은지만(계단 값) 구독한다
  return (
    <div className="mt-far" style={{ fontSize: px(12, 0.17, 1 / 16) }} data-role="far">
      {/* P141(#15): 상태 알약이 검토 대기(작업 완료)면 같은 칩을 또 두지 않는다. 이름은 칩보다 먼저 자리를 받는다(styles.css 끝) */}
      <div className="mt-far-name" style={{ fontSize: px(14, 0.2, 1 / 13) }}><span className="mt-far-nm">@{s.name}</span> <StatePill s={s} />{!narrow && <>{s.flavor ? <span className="mt-badge kind">{kindOf(s.flavor).label}</span> : s.kind && s.kind !== 'claude' ?<span className="mt-badge kind">{s.kind === 'shell' ? t('node.shell') : kindOf(s.kind).label}</span> : null}{s.unseen && !(s.state === 'ready' || s.state === 'shell_idle') && <span className="mt-badge review">{t('node.review')}</span>}<BranchBadge s={s} /></>}</div>
      {waiting && <div className="mt-far-ask" data-role="far-ask" style={{ fontSize: px(15, 0.21, 1 / 14) }}>{askLine(s) || t('node.waitingForYou')}</div>}
      {s.kind === 'shell' && <div className="mt-far-line" data-role="shell-line">{shellLine(s)}</div>}
      {s.elsewhere && <div className="mt-far-line warn">↪ {t('node.workingIn', { name: s.elsewhere.name })}</div>}
      {s.state === 'exited' && <div className="mt-far-line">{EXIT_LABEL[s.exit && s.exit.kind] || t('state.exited')}</div>}
      {s.lastPrompt && <div className="mt-far-line one prompt" data-role="far-prompt"><span className="mt-far-k">{t('node.prompt')}</span> {oneLine(s.lastPrompt)}</div>}
      {s.lastAnswer && <div className="mt-far-line one" data-role="far-answer"><span className="mt-far-k">{t('node.answer')}</span> {oneLine(s.lastAnswer)}</div>}
      {open && <div className="mt-far-line mt-brief-hint" data-role="brief-hint">{t('brief.hint')}</div>}
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
  // P138: 글자는 SVG <text>가 아니라 HTML 글이다. 새 Chromium(웹 화면의 브라우저)은 조상의 transform이 바뀔 때마다 SVG 글을 화면 배율에 맞춰
  // 다시 배치해, 판을 움직이는 매 프레임 셸 아이콘마다 레이아웃이 돌았다(웹 각본 레이아웃 10배). HTML 글은 transform 아래에서 다시 배치하지 않는다.
  // 글 크기는 아이콘 상자 너비의 비율(cqw, 예전 viewBox 100의 fs)이다
  return (
    <span className="mt-kind-icon mt-kind-mk" role="img" aria-label={k.label} title={title || k.label} data-kind={k.id}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {d ? <path d={d} style={{ fill: k.color }} /> : <circle cx="50" cy="50" r="44" style={{ fill: k.color }} />}
      </svg>
      <b style={{ color: k.ink, fontSize: `${fs}cqw` }}>{k.mark}</b>
    </span>
  );
}
// P124: 틀 단계(lib/faces.js tierFor, 화면 120px 아래). 노드를 가리고 외곽과 상태 색 바탕, 상태 표지 하나만 그린다(글 없음, 이름은 마우스를 올리면 제목).
//   상태는 색만이 아니라 모양으로도 갈린다: 응답 필요 !, 작업 완료(검토 대기) ✓, 오류 ×, 작업 중 원호(둘레 빛도 돈다), 잠듦 달. 쉬는 노드와 끝난 노드는 표지 없음.
//   표지 크기는 화면 기준(--inv 계단 값)이고 노드보다 커지지 않는다(styles.css .mt-frame-mark)
const FRAME_MARK = { turn: 'ask', alert: 'error', review: 'done', work: 'work', sleep: 'sleep' };
export const frameMarkOf = (tier) => FRAME_MARK[tier] || null;
const MARK_PATH = {
  ask: <><path d="M12 6.5v7" /><circle cx="12" cy="17.6" r=".6" /></>,
  done: <path d="M6.5 12.4l3.6 3.6 7.4-8" />,
  error: <path d="M7.5 7.5l9 9M16.5 7.5l-9 9" />,
  work: <path d="M12 6.5a5.5 5.5 0 1 1-5.5 5.5" />,
};
function FrameFace({ s, tier }) {
  useT();
  const k = kindOf(shownKind(s));
  const mark = frameMarkOf(tier);
  return (
    <div className="mt-iconface mt-frameface mt-drag" data-role="frame-face" data-kind={k.id} data-mark={mark || undefined} title={`@${s.name} · ${k.label} · ${STATE_LABEL[s.state] || s.state}`}>
      {mark && <span className="mt-frame-mark" data-mark={mark} aria-hidden="true">
        {mark === 'sleep' ? <Icon name="moon" /> : <svg viewBox="0 0 24 24">{MARK_PATH[mark]}</svg>}
      </span>}
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

// macOS 판: 머리의 모델 표시(claude- 앞머리는 뺀다)와 추론 수준
export function modelLabel(v) {
  if (!v) return '';
  const m = v.model ? String(v.model).replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2') : '';
  return [m, v.effort].filter(Boolean).join(' · ');
}
// macOS 판: 마지막 응답의 출력 속도(초당 토큰). 10분 지난 값은 흐리게
function TokenSpeed({ s }) {
  const t = useT();
  const sp = s.tokenSpeed;
  if (!sp || !sp.tps) return null;
  const old = Date.now() - (sp.at || 0) > 600000;
  return <span className={`mt-node-meta mt-tps${old ? ' old' : ''}`} data-role="tps" title={t('model.tpsTitle', { n: sp.out, at: new Date(sp.at).toLocaleTimeString() })}>{sp.tps} t/s</span>;
}
// macOS 판: 모델·추론 바꾸기(/model, /effort). 일하는 중이면 턴이 끝난 뒤 바뀐다
const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
function ModelMenu({ s, onClose }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const pick = (p) => {
    setBusy(true);
    api.call('session.setModel', { session: s.sessionId, ...p }).then((r) => {
      onClose();
      toast(r && r.applied ? t('model.applied', { name: s.name }) : t('model.queued', { name: s.name }));
    }, (e) => { setBusy(false); toast(errText(e), 'error'); });
  };
  const cur = String(s.model || '').toLowerCase();
  return (
    <div className="mt-menu nodrag mt-model-menu" data-role="model-menu" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mt-menu-row"><span className="dim">{t('model.model')}</span>
        {MODELS.map((m) => <button key={m} className={`mt-btn small${cur.includes(m) ? ' on' : ''}`} data-model={m} disabled={busy} onClick={() => pick({ model: m })}>{m}</button>)}
      </div>
      <div className="mt-menu-row"><span className="dim">{t('model.effort')}</span>
        {EFFORT_LEVELS.map((x) => <button key={x} className={`mt-btn small${s.effort === x ? ' on' : ''}`} data-effort={x} disabled={busy} onClick={() => pick({ effort: x })}>{x}</button>)}
      </div>
      <div className="mt-menu-row dim">{s.state === 'working' ? t('model.whileWorking') : t('model.hint')}</div>
      <div className="mt-menu-row"><button className="mt-btn small ghost" onClick={onClose}>{t('common.close')}</button></div>
    </div>
  );
}

// macOS 판: 중지 단추. 멈춘 세션 이름을 알린다(하위 세션까지)
export function stopSession(s) {
  return api.call('session.stop', { session: s.sessionId }).then((r) => {
    const names = (r && r.stopped) || [];
    if (!names.length) toast(t('node.stopNone', { name: s.name }));
    else toast(names.length > 1 ? t('node.stoppedTree', { name: s.name, n: names.length - (names.includes(s.name) ? 1 : 0) }) : t('node.stopped', { name: names[0] }));
  }, (e) => toast(errText(e), 'error'));
}

// macOS 판: 이 세션을 다른 Claude 계정으로 옮긴다(같은 대화). 일하는 중이면 멈추고 옮긴 뒤 이어 하라고 알린다
function AccountMove({ s, onClose }) {
  const t = useT();
  const accounts = useStore((st) => st.accounts) || [];
  const [busy, setBusy] = useState(null);
  useEffect(() => { loadAccounts().catch(() => {}); }, []);
  if ((s.kind || 'claude') !== 'claude' || !s.hooked || !s.claudeAccount) return null;
  const others = accounts.filter((a) => a.id !== s.claudeAccount);
  if (!others.length) return null;
  const label = (a) => (a.builtin ? t('accounts.defaultName') : a.name);
  const move = (a) => {
    setBusy(a.id);
    api.call('accounts.switch', { session: s.sessionId, account: a.id, stop: true }).then(() => { onClose(); }, (e) => { setBusy(null); toast(errText(e), 'error'); });
  };
  const cur = accounts.find((a) => a.id === s.claudeAccount);
  return (
    <div className="mt-menu-row" data-role="account-move"><span className="dim">{t('accounts.moveMenu', { from: cur ? label(cur) : s.claudeAccount })}</span>
      {others.map((a) => <button key={a.id} className="mt-btn small" data-action="account-move" data-account={a.id} disabled={!!busy || !a.loggedIn || !!a.limit} title={!a.loggedIn ? t('accounts.notLoggedIn') : a.limit ? t('accounts.limited', { time: new Date(a.limit.until).toLocaleTimeString() }) : t('accounts.moveHint')} onClick={() => move(a)}>{busy === a.id ? t('accounts.moving') : label(a)}</button>)}
    </div>
  );
}

// ⋯ 메뉴: 크기 단계(H7), 덩어리에서 떼기(H5), 루프 만들기(I5, P6c)
function NodeMenu({ s, docked, onClose }) {
  const t = useT();
  const call = (method, p) => api.call(method, p).then(onClose, (e) => toast(errText(e), 'error'));
  const [detachAsk, setDetachAsk] = useState(null); // P81: 부모에서 떼기 확인 글. P159: 독립으로 두기(계보는 남는다)
  const detach = (yes) => api.call('session.detach', { session: s.sessionId, confirm: yes }).then((r) => {
    if (r && r.needsConfirm) return setDetachAsk(tMsg(r));
    onClose(); toast(t('detach.done', { name: s.name, parent: r.from || (s.branch && (s.branch.workParentName || s.branch.parentName)) || '' }));
  }, (e) => toast(errText(e), 'error'));
  return (
    <div className="mt-menu nodrag" data-role="node-menu" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mt-menu-row"><span className="dim">{t('node.size')}</span>
        {[['large', t('node.sizeLarge')], ['normal', t('node.sizeNormal')], ['small', t('node.sizeSmall')]].map(([k, l]) => <button key={k} className="mt-btn small" data-size={k} onClick={() => call('board.setSize', { session: s.sessionId, size: k })}>{l}</button>)}
      </div>
      {/* P66: 판의 이름 바꾸기(에이전트 주소는 그대로) */}
      <div className="mt-menu-row"><button className="mt-btn small" data-action="rename" onClick={() => { onClose(); setRenaming(s.sessionId, 'node'); }}>{t('rename.menu')}</button><span className="dim">{renamed(s) ? t('rename.address', { address: addressOf(s) }) : t('rename.menuHint')}</span></div>
      {/* P21(D4)·P24: 잠든 노드는 그 리포를 깨운다. 잠재우기는 리포 단위라 영역 이름표 메뉴에 있다 */}
      {s.state === 'sleeping' && <div className="mt-menu-row"><button className="mt-btn small" data-action="wake" disabled={!!s.waking} onClick={() => { onClose(); wakeSession(s.sessionId); }}><Icon name="moon" />{t(sleptAlone(s) ? 'sessionSleep.menuWake' : 'sleep.menuWake')}</button><span className="dim">{t(sleptAlone(s) ? 'sessionSleep.menuWakeHint' : 'sleep.menuWakeHint')}</span></div>}
      <AccountMove s={s} onClose={onClose} />
      {s.kind !== 'shell' && <div className="mt-menu-row"><button className="mt-btn small" data-action="loop-new" onClick={() => { onClose(); openDialog({ kind: 'loop', target: { session: s.sessionId } }); }}>{t('node.loopNew')}</button><span className="dim">{t('node.loopNewHint')}</span></div>}
      {/* P68: 리드의 하위 세션(워커)을 워크트리가 달라도 한 덩어리로 */}
      {s.branch && s.branch.children >= 2 && <div className="mt-menu-row"><button className="mt-btn small" data-action="dock-workers" onClick={() => api.call('dock.workers', { lead: s.sessionId }).then((r) => { onClose(); toast(t('dockWorkers.done', { n: (r.workers || []).length })); }, (e) => toast(errText(e), 'error'))}>{t('dockWorkers.action')}</button><span className="dim">{t('dockWorkers.hint', { n: s.branch.children })}</span></div>}
      {/* P81: 부모가 있으면 부모에서 떼기 → P159: 일 부모(위 세션)가 있으면 독립으로 두기(child-kill·잠재우기 묶음에서 빠지고 작업 완료로 센다, 계보는 남는다) */}
      {s.branch && s.branch.workParentSessionId && (detachAsk
        ? <div className="mt-menu-row mt-detach-ask" data-role="detach-ask"><span className="dim">{detachAsk}</span><button className="mt-btn small danger" data-action="detach-confirm" onClick={() => detach(true)}>{t('detach.confirm')}</button><button className="mt-btn small ghost" onClick={() => setDetachAsk(null)}>{t('common.cancel')}</button></div>
        : <div className="mt-menu-row"><button className="mt-btn small" data-action="detach" onClick={() => detach(false)}>{t('detach.menu')}</button><span className="dim">{t('detach.menuHint', { parent: s.branch.workParentName || '' })}</span></div>)}
      {docked && <div className="mt-menu-row"><button className="mt-btn small" data-action="undock" onClick={() => call('dock.remove', { session: s.sessionId })}>{dt('undock')}</button><span className="dim">{dt('undockHint')}</span></div>}
      <div className="mt-menu-row dim" data-role="dock-hint">{dt('dockHint')}</div>
      <div className="mt-menu-row"><button className="mt-btn small ghost" data-action="menu-close" onClick={onClose}>{t('common.close')}</button></div>
    </div>
  );
}

// P21(D4): 잠든 노드의 요약 얼굴(가까이·중간·멀리 모두). 흐리게, 달, 이름, 마지막 요청과 답 앞부분, 잠든 시각, 아낀 메모리, 깨우기.
// 멀리 얼굴이면 글자 크기를 FarFace처럼 화면 기준으로 둔다. 크기와 자리는 그대로라 깨면 같은 자리에서 터미널이 된다
function SleepFace({ s, w, h, far, close, stepped = false }) { // 깨우기 단추는 가까이 얼굴에서만(작은 얼굴은 노드를 누르면 깨운다)
  const t = useT();
  const zoom = useFlowStore(stepped ? noZoom : zoomSel); // P112: FarFace와 같이 이 얼굴만 배율을 구독한다. P121·P124: 요약·틀 단계는 CSS(--inv 계단 값)로
  const z = s.sleep || {};
  const px = stepped ? (n, frac, wfrac) => cssPx(n, frac, wfrac, w, h) : (n, frac, wfrac) => Math.min(n / Math.max(zoom, 0.02), h * frac, w * wfrac);
  const wake = (e) => { e.stopPropagation(); const st = getState(); if (st.navigateTo) st.navigateTo(s.sessionId, { focusTerminal: true }); else wakeSession(s.sessionId); };
  return (
    <div className={`mt-sleepface${far ? ' far' : ''}${s.waking ? ' waking' : ''}`} data-role="sleep-face" data-sleep-scope={z.scope || 'repo'} style={{ fontSize: px(13, 0.17, 1 / 16) }}>
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
      {close && <div className="mt-sleep-actions"><button className="mt-btn nodrag" data-action="wake-face" disabled={!!s.waking} title={t(sleptAlone(s) ? 'sessionSleep.wakeTitle' : 'sleep.wakeTitle')} onClick={wake}>{s.waking ? t('sleep.waking') : t('sleep.wake')}</button></div>}
    </div>
  );
}

const IDLE_DIM_MS = 30 * 60 * 1000; // 이만큼 아무 일이 없던 쉬는 노드는 흐리게(H3)

// P85: 일하는 노드의 도는 둘레. 회전판(i)만 transform으로 돌아 합성 단계에서 끝난다. 화면 밖이면 멈춘다(창 하나에 관찰자 하나)
let ringIO = null;
const ringObserver = () => {
  if (ringIO || typeof IntersectionObserver === 'undefined') return ringIO;
  ringIO = new IntersectionObserver((es) => { for (const e of es) e.target.dataset.off = e.isIntersecting ? '' : '1'; }, { rootMargin: '64px' });
  return ringIO;
};
const ringStep = (st) => 1.25 ** Math.floor(Math.log(Math.max(st.transform[2], 0.02)) / Math.log(1.25)); // 줌마다 판 크기가 바뀌어 다시 그리지 않게 계단으로(작은 쪽으로 잡아 늘 덮는다)
function RunRing({ w, h }) {
  const ref = useRef(null);
  useEffect(() => { const io = ringObserver(); const el = ref.current; if (!io || !el) return undefined; io.observe(el); return () => io.unobserve(el); }, []);
  const zq = useFlowStore(ringStep); // P112: 계단이 바뀔 때만 다시 그린다
  return <span ref={ref} className="mt-node-run" aria-hidden="true" data-role="run-ring"><i style={{ '--diag': `${ringDiag(w, h, zq)}px` }} /></span>;
}

function CloseWaiting({ s }) {
  const t = useT();
  return (
    <div className="mt-placeholder">
      <div>{t('node.overBudget')}</div>
      {/* P124: 마지막 요청(위)과 답(아래). 멀리·잠 얼굴의 요청/응답 줄 모양 */}
      {s.lastPrompt && <div className="mt-far-line one prompt" data-role="wait-prompt"><span className="mt-far-k">{t('node.prompt')}</span> {oneLine(s.lastPrompt)}</div>}
      {s.lastAnswer && <div className="mt-far-line" data-role="wait-answer"><span className="mt-far-k">{t('node.answer')}</span> {oneLine(s.lastAnswer).slice(0, 200)}</div>}
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
async function closeOne(s, after, { quiet = false, extra = {} } = {}) {
  try {
    const r = await api.call('session.kill', { session: s.sessionId, confirm: true, after, ...extra });
    const a = r.after || {};
    if (after === 'archive') { if (!quiet) toast(t('node.closedArchived', { name: s.name })); }
    else if (a.deleted) { if (!quiet) toast(t(a.trashed ? 'node.closedDeletedTrash' : 'node.closedDeleted', { name: s.name })); }
    else toast(t('node.closedNotDeleted', { name: s.name, reason: a.reason ? tOr(`refuse.${a.reason}`, a.label || a.reason) : a.label || '?' }), 'error');
    return true;
  } catch (e) { toast(t('node.closeFail', { error: errText(e) }), 'error'); return false; }
}

// P71: `claude -w` 세션의 닫기 확인에 보이는 워크트리 선택. 기본은 남기기이고, 지우기는 사람이 고를 때만이다
function WorktreeChoice({ wt, value, onChange, disabled }) {
  const t = useT();
  if (!wt) return null;
  return (
    <div className="mt-wt-choice" data-role="close-worktree" data-value={value}>
      <label className="mt-check"><input type="radio" name="wt-choice" data-choice="keep" checked={value !== 'remove'} disabled={disabled} onChange={() => onChange('keep')} />{t('wtExit.closeKeep', { name: wt.name })}</label>
      <label className="mt-check"><input type="radio" name="wt-choice" data-choice="remove" checked={value === 'remove'} disabled={disabled} onChange={() => onChange('remove')} />{t('wtExit.closeRemove')}</label>
      {value === 'remove' && <div className="mt-card-sub mt-wt-warn" data-role="close-worktree-warn">{t('wtExit.closeRemoveWarn')}</div>}
    </div>
  );
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
  const [wtChoice, setWtChoice] = useState('keep'); // P71
  useEffect(() => { if (one) api.call('session.kill', { session: one.sessionId }).then((r) => setMsg(r || {})).catch((e) => setMsg({ error: e })); }, [one && one.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const del = useArmDelete();
  useConfirmKeys((k) => { if (busy) return; if (k === 'cancel') onClose(); else del.arm(); });
  if (!list.length) return null;
  const run = async (after) => {
    setBusy(after);
    let ok = 0;
    for (const s of list) { if (await closeOne(s, after, { quiet: !one, extra: one ? killWorktreeParam(msg && msg.worktree, wtChoice) : {} })) ok++; setDone((n) => n + 1); }
    if (!one && ok) toast(t(after === 'archive' ? 'close.manyArchived' : 'close.manyDeleted', { n: ok }));
    onClose();
  };
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="mt-modal" data-role="close-dialog" data-count={list.length}>
        <h3>{one ? t('close.titleOne', { name: one.name }) : t('close.titleMany', { n: list.length })}</h3>
        {one ? <div>{!msg ? t('node.confirmLoading') : msg.error ? errText(msg.error) : tMsg(msg)}</div>
          : <><div>{t('close.many', { n: list.length })}</div><div className="mt-close-names mono" data-role="close-names">{list.map((s) => `@${s.name}`).join('  ')}</div></>}
        {one && msg && <WorktreeChoice wt={msg.worktree} value={wtChoice} onChange={setWtChoice} disabled={!!busy} />}
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
  const [wtChoice, setWtChoice] = useState('keep'); // P71
  const del = useArmDelete();
  useConfirmKeys((k) => { if (busy) return; if (k === 'cancel') onClose(); else del.arm(); });
  useEffect(() => { api.call('session.kill', { session: s.sessionId }).then((r) => setMsg(r || {})).catch((e) => setMsg({ error: e })); }, [s.sessionId]);
  const close = async (after) => {
    setBusy(after);
    if (!(await closeOne(s, after, { extra: killWorktreeParam(msg && msg.worktree, wtChoice) }))) setBusy(null);
  };
  return (
    <div className="mt-kill nodrag" data-role="kill-confirm" data-loading={msg ? '0' : '1'}>
      <div>{!msg ? t('node.confirmLoading') : msg.error ? errText(msg.error) : tMsg(msg)}</div>
      {msg && <WorktreeChoice wt={msg.worktree} value={wtChoice} onChange={setWtChoice} disabled={!!busy} />}
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
  countRender('session'); // P146: 성능 기록(켜져 있을 때만 센다)
  const t = useT();
  const s = useStore((st) => st.sessions.get(id));
  const attached = useStore((st) => st.attached && st.attached.includes(id));
  const focusTick = useStore((st) => (st.focusId === id ? st.focusTick : 0));
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
  const [modelMenu, setModelMenu] = useState(false); // macOS 판
  const [loopsOpen, setLoopsOpen] = useState(false);
  const docked = useStore((st) => dockOf(id));
  // P23: 이 덩어리 안 세션끼리 연결이 있으면 가운데 점이 보인다(Docks.jsx DockLinks가 점끼리 선을 겹쳐 그린다)
  const dockLinked = useStore((st) => { const d = dockOf(id); if (!d) return false; for (const l of st.links.values()) if (d.members.includes(l.from) && d.members.includes(l.to)) return true; return false; });
  const prevTier = useRef(null);
  const boom = useStore((st) => st.debugThrow === id);
  // P112: 배율은 단계 값(얼굴, 작은 배율, 말풍선 조건)으로만 구독한다. 배율이 바뀌어도 단계가 그대로면 이 노드는 다시 그리지 않는다.
  //   --inv는 useInvRef가 요소에 바로 쓴다
  // P124: 얼굴은 거리 단계(lib/faces.js tierFor: 터미널 240px·요약 120px·틀, 경계 여유 88%)와 터미널 허용(termAllowed)으로 정한다.
  //   단계의 이력은 마지막으로 그린 단계(prevTier)로 본다. 붙은 노드는 터미널 단계로 친다
  const nw = n ? n.w : 0, nh = n ? n.h : 0;
  const dist = useFlowStore((st) => tierFor(nw * st.transform[2], attached ? 'term' : prevTier.current));
  // P121: 고른 워크스페이스 밖의 노드는 터미널 대신 요약(멀리 얼굴)을 보인다. 초점·고른 노드, 아주 가까이 확대한 노드, 이미 붙은 노드는 그대로
  const viewWs = useStore((st) => st.viewWs);
  const isFocus = useStore((st) => st.focusId === id);
  const picked = useStore((st) => st.selected.includes(id));
  const mate = useStore((st) => matesNow(st).has(id)); // P124: 초점·고른 노드와 같은 덩어리, 부모·자식이면 터미널을 가질 수 있다
  const prevNear = useRef(false);
  const near = useFlowStore((st) => !!n && veryClose(n, { x: st.transform[0], y: st.transform[1], zoom: st.transform[2] }, { width: st.width, height: st.height }, prevNear.current));
  prevNear.current = near;
  const allowed = !!s && (attached || termAllowed({ id, ws: s.workspaceKey, viewWs, focus: isFocus ? id : null, selected: picked ? new Set([id]) : null, mates: mate ? new Set([id]) : null, near }));
  const brief = !!s && !allowed; // 다른 워크스페이스의 요약(data-brief)
  const face = faceOfTier(dist, allowed);
  // P124: 터미널이 아닌 얼굴(요약·틀)은 모두 배율 계단 값(lib/faces.js zoomStep, ±5%)을 쓴다. 판을 확대·축소해도 계단이 바뀔 때만 스타일을 다시 센다(P121 요약 얼굴과 같다)
  // P127: 터미널 얼굴도 노드 뿌리의 --inv(머리줄의 화면 크기 글자, 테두리·둘레 굵기)는 계단 값이다(P124 측정에서 휠 바쁨의 약 9%).
  //   터미널 안 글자는 --inv를 쓰지 않는다(TerminalView가 배율에 맞춰 선명하게 다시 그린다, P65)
  const zSmall = useFlowStore((st) => zoomStep(st.transform[2]) < SMALL_ZOOM);
  const shortNode = useFlowStore((st) => nh * zoomStep(st.transform[2]) < 160);
  const invRef = useInvRef(0.02, id, true); // 화면 밖이면 움직이는 동안 미룬다(zoom-var.js)
  if (boom) throw new Error(t('node.debugThrow', { name: s ? s.name : id })); // 오류 경계 시험(setDebugThrow)
  if (!s || !n) return null;
  prevTier.current = dist;
  const far = face === 'far' || face === 'icon';
  xVisible.current = face !== 'icon' && !zSmall; // 머리줄의 X가 보이는 조건(styles.css .z-small)
  const idle = (s.state === 'ready' || s.state === 'shell_idle') && !s.unseen && s.lastActivityAt && Date.now() - s.lastActivityAt > IDLE_DIM_MS;
  const asleep = s.state === 'sleeping'; // P21: 터미널 대신 잠든 얼굴(아이콘 얼굴은 달 표시)
  const tier = tierOf(s); // P85

  return (
    <div data-tier={tier} data-dist={dist} className={`mt-node t-${tier} st-${s.state} face-${face} kind-${kindOf(shownKind(s)).id}${s.unseen ? ' unseen' : ''}${selected ? ' selected' : ''}${idle ? ' idle' : ''}${asleep ? ' asleep' : ''}${s.waking ? ' waking' : ''}${docked ? ` docked dock-${docked.dir}${dockLinked ? ' dock-linked' : ''}` : ''}${zSmall ? ' z-small' : ''}`} ref={invRef} data-session={id} data-name={s.name} data-face={face} data-brief={brief ? '1' : undefined} data-asleep={asleep ? '1' : undefined} data-dock={docked ? docked.dockId : undefined} onMouseDown={() => { markSeen(id); enterSession(id); }}>
      <NodeResizer isVisible={selected && face === 'close' && !docked} minWidth={420} minHeight={260} lineClassName="mt-resize-line" handleClassName="mt-resize-handle"
        onResize={(_e, p) => setNodeLocal(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
        onResizeEnd={(_e, p) => { setNodeLocal(id, { x: p.x, y: p.y, w: p.width, h: p.height }); saveNode(id, 'resize'); }} />
      {/* 잇기 손잡이 네 개(판은 connectionMode loose). 끌기 시작한 노드가 시키는 쪽(A)이다. 선은 두 노드가 마주 보는 쪽에 붙인다 */}
      {[['t', Position.Top], ['r', Position.Right], ['b', Position.Bottom], ['l', Position.Left]].map(([hid, pos]) => (
        <Handle key={hid} type="source" position={pos} id={hid} className={`mt-handle h-${hid}`} title={t('node.handleTitle')} />
      ))}
      {/* P23: 덩어리 안에서는 가장자리 손잡이 대신 가운데 점으로 잇는다(분할선과 겹치지 않게, 잇기 모드에서만 끈다) */}
      {docked && <Handle type="source" position={Position.Top} id="c" className="mt-handle h-c nodrag" title={t('dock.dotTitle')} />}
      {runsRing(tier, face) && <RunRing w={n.w} h={n.h} />}
      {face !== 'icon' && <Header s={s} onKill={() => setKilling(true)} onMenu={() => setMenu((m) => !m)} onLoops={() => setLoopsOpen((o) => !o)} onModel={() => { setMenu(false); setModelMenu((m) => !m); }} />}
      {face === 'icon' && <IconRename s={s} />}
      {!far && <GitLine s={s} />}
      {!far && <ResponseNotice s={s} />}
      {far && (s.state === 'waiting' || s.state === 'trust_wait') && (face === 'icon' || shortNode) && <AskCallout s={s} />}
      {/* P31: 가까이(터미널)가 아닌 얼굴은 본문 어디를 끌어도 머리줄처럼 노드를 옮긴다(mt-drag, Canvas.jsx onNodeDragStart). 누르기만 하면 들어간다(H4).
          단추·입력·링크는 nodrag. 대화 보기의 스크롤 막대를 누른 것은 끌기로 넘기지 않는다 */}
      <div className={`mt-node-body${face !== 'close' ? ' mt-drag' : ''}`} onMouseDownCapture={face === 'middle' ? onScrollbarDown : undefined}>
        <NodeBoundary id={id} label={face === 'close' ? 'terminal' : face} compact>
          {asleep && face !== 'icon' && <SleepFace s={s} w={n.w} h={n.h} far={face === 'far'} close={face === 'close'} stepped />}
          {/* P124: 붙은 터미널은 얼굴이 요약·틀로 바뀌어도 판이 놓을 때까지(Canvas HOLD_MS) 숨겨 둔 채 남긴다. 휠로 배율이 단계 경계를 오갈 때마다
              xterm·WebGL을 새로 만들고 셸 기록을 다시 쓰던 것(한 번에 100ms 넘는 끊김)을 없앤다. 감싸개는 display: contents라 자리와 크기는 그대로다 */}
          {!asleep && (attached ? <div className={`mt-term-slot${face === 'close' ? '' : ' hold'}`} data-role="term-slot" data-hold={face === 'close' ? undefined : '1'}><TerminalView sessionId={id} width={n.w} height={n.h} focusTick={focusTick} onActivate={() => markSeen(id)} onInput={() => markInteracted(id)} /></div> : face === 'close' ? (NO_BOARD_TERMS ? <ChatView s={s} /> : <CloseWaiting s={s} />) : null)}
          {!asleep && face === 'middle' && <ChatView s={s} />}
          {!asleep && face === 'far' && <FarFace s={s} w={n.w} h={n.h} open={brief && dist === 'term'} />}
          {face === 'icon' && <FrameFace s={s} tier={tier} />}
        </NodeBoundary>
        {!far && <div className="mt-node-overlays">
          {s.interruptedTurn && <InterruptedBanner s={s} />}
        </div>}
        {killing && <KillConfirm s={s} onClose={() => setKilling(false)} />}
        {menu && <NodeMenu s={s} docked={!!docked} onClose={() => setMenu(false)} />}
        {modelMenu && <ModelMenu s={s} onClose={() => setModelMenu(false)} />}
        {loopsOpen && <SessionLoopList s={s} onClose={() => setLoopsOpen(false)} />}
      </div>
    </div>
  );
}

// P66: 아이콘 얼굴에는 머리줄이 없다. F2로 이름을 바꿀 때만 노드 위에 입력칸을 띄운다(글자는 화면 기준 크기)
function IconRename({ s }) {
  const editing = useRenaming(s.sessionId, 'node');
  const invRef = useInvRef(0.05); // P112: 이름을 고치지 않는 동안은 배율로 다시 그리지 않는다
  if (!editing) return null;
  return <div className="mt-icon-rename nodrag" ref={invRef}><RenameInput s={s} where="node" /></div>;
}

export const SessionNode = memo(SessionNodeInner);
