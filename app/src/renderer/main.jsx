// 창 화면의 시작점: 위쪽 내 차례 줄, 판, 아래쪽 명령 바(ARCH 7.1 고정 요소)
// P3: 경고 띠(D3, herdr 꺼짐), 복귀 요약(A3), OS 알림(A1), 판 오류 경계(E5 2.5)
// P5: 리포 열기·닫기 대화상자
// P6a: 캔버스 하나. 명령 바 위에 워크스페이스 단추(누르면 그 영역으로), 검색(Ctrl+F), 고른 노드 막대(크기, 배치). P5의 워크스페이스 줄과 세션 줄은 뺐다.
// P22: 그룹·묶음 대화상자와 떠날 때 메모 줄을 뺐다. 세션 노드를 고르고 Delete를 누르면 닫기 확인(보관·삭제·취소)을 연다
//   노드를 눌러 들어간 뒤 터미널이 붙기 전에 친 키는 모았다가 터미널이 붙으면 넣는다(H4, store.pendingInput)
// P6c: 출력 보기 창(I1), 루프 대화상자(I5), 미션 맵 덮개(I6, M), 설정(I7). Thread(I2)는 명령 바 안, 메모·칸반(I3·I4)은 캔버스 노드다
// P7: 캔버스 왼쪽의 사이드바(J5). 캔버스와 한 줄(mt-body)에 두어 사이드바를 열면 캔버스가 옆으로 줄어든다
// P11: 위쪽 줄과 아래쪽 워크스페이스 단추를 없애고 캔버스 위에 떠 있는 크롬(Chrome.jsx)으로 바꿨다. 크롬은 캔버스와 같은 칸(mt-stage)에 있어 사이드바를 열면 함께 옆으로 간다.
//   색은 tokens.css, 글꼴은 fonts.css(앱에 넣은 OFL 글꼴). 글꼴을 읽은 뒤에 그린다(터미널이 처음부터 제 글꼴로 칸 크기를 잰다)
// P48(원격 R2): Electron 밖(브라우저)에서 돌면 웹 어댑터(web.js)가 window.mt를 두고, 짝을 맺기 전에는 짝 맺기 화면(Pair.jsx)만 보인다.
//   PC 창에는 브라우저의 허락 요청 카드(WebDevices.jsx)가 뜬다
import './dialog.js';
import { isWeb } from './web.js';
import { RemoteBar } from './RemoteBar.jsx'; // P49: 웹 화면의 다시 연결 띠와 왕복 지연
import { webGate } from './Pair.jsx';
import { PairRequestBanner } from './WebDevices.jsx';
import '@xyflow/react/dist/style.css';
import '@xterm/xterm/css/xterm.css';
import './fonts.css';
import './tokens.css';
import './styles.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { api } from './api.js';
import { useStore, getState, openDialog, setKillAsk, setDebugThrow, setSearchOpen, pendingFor, setMissionOpen, setConvoNodes, setFocus, setBottomPin } from './store.js';
import { OutputPanel } from './Output.jsx';
import { LoopDialog } from './Loops.jsx';
import { MissionMap } from './Mission.jsx';
import { SettingsDialog } from './Settings.jsx';
import { Canvas, MAX_CONTROLLERS } from './Canvas.jsx';
import { Warnings, useInbox } from './InboxBar.jsx';
import { TopLeft, TopRight, LeftRail, RightRail, ChipRow, ZoomPill, LoopsPanel } from './Chrome.jsx';
import { CommandBar } from './CommandBar.jsx';
import { SpawnDialog } from './SpawnDialog.jsx';
import { RoleDialog, LinkPanel } from './Links.jsx';
import { OpenRepoDialog, CloseWsDialog } from './Workspaces.jsx';
import { DesktopImportDialog } from './DesktopImport.jsx'; // P34
import { Sidebar } from './Sidebar.jsx'; // P7(J5): 평소에 닫힌 왼쪽 사이드바
import { SearchBox, SelectionBar } from './Search.jsx';
import { keyToData, closeKeyTargets, boardArrowKey } from './lib/keys.js';
import { ReturnSummary, useReturnSummary } from './ReturnSummary.jsx';
import { CloseDialog } from './SessionNode.jsx';
import { AppBoundary } from './ErrorBoundary.jsx';
import { budget, terms } from './TerminalView.jsx';
import { nextTarget } from './lib/faces.js';
import { startViewingReport } from './sleep.js';
import { startNotifier, notifyLog } from './notify.js';
import * as perf from './perf.js';
import { useT } from './lib/i18n.js';
import { BRAND_WORDMARK } from './lib/icons.jsx'; // 처음 화면의 텍스트 로고

const editable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || (t.closest && t.closest('.xterm')));

function Dialogs() {
  const d = useStore((st) => st.dialog);
  if (!d) return null;
  const close = () => openDialog(null);
  if (d.kind === 'spawn') return <SpawnDialog cwd={d.cwd} agentKind={d.agentKind} launcher={d.launcher} onClose={close} />;
  if (d.kind === 'close') return <CloseDialog ids={d.ids || []} onClose={close} />;
  if (d.kind === 'role') return <RoleDialog from={d.from} to={d.to} onClose={close} />;
  if (d.kind === 'link') return <LinkPanel linkId={d.linkId} onClose={close} />;
  if (d.kind === 'wsopen') return <OpenRepoDialog onClose={close} />;
  if (d.kind === 'desktopImport') return <DesktopImportDialog onClose={close} />;
  if (d.kind === 'wsclose') return <CloseWsDialog ws={d.ws} onClose={close} />;
  if (d.kind === 'loop') return <LoopDialog target={d.target} onClose={close} />;
  if (d.kind === 'settings') return <SettingsDialog onClose={close} />;
  return null;
}

// 처음 화면: 판을 받기 전(백엔드에 붙는 중, 첫 실행의 옮기기 포함) 텍스트 로고와 연결 상태.
// P28: 아이콘을 빼고 텍스트 로고만 크게 가운데에 둔다. 어두운 글자 위로 밝은 글자가 아래부터 점 한 줄씩 차오른다(clip-path, 2초 안에 한 번).
//   판을 빨리 받아도 처음 화면은 SPLASH_MIN_MS 동안 보인다. 그 사이 판은 뒤에서 읽고 그린다(처음 화면은 판 위에 덮여 있다가 사라진다)
const SPLASH_MIN_MS = 2000;
function Splash({ error, leaving }) {
  const t = useT();
  return (
    <div className={`mt-splash${leaving ? ' leaving' : ''}`} data-role="splash" data-leaving={leaving ? '1' : undefined}>
      <div className="mt-splash-brand">
        <img className="mt-splash-word mt-splash-base" src={BRAND_WORDMARK} alt="Atrium" draggable={false} />
        <img className="mt-splash-word mt-splash-lit" src={BRAND_WORDMARK} alt="" aria-hidden="true" draggable={false} />
      </div>
      <div className={`mt-splash-status${error ? ' error' : ''}`}>{error || t('app.connecting')}</div>
    </div>
  );
}
// 처음 화면을 보일지: 판을 받기 전에는 늘, 받은 뒤에는 처음 화면이 뜬 지 SPLASH_MIN_MS가 지나 잠깐 사라지는 동안(leaving)까지
function useSplash(loaded) {
  const [phase, setPhase] = useState('on'); // on → leaving → off
  const [minDone, setMinDone] = useState(false); // 처음 화면이 뜬 때부터 센다
  useEffect(() => { const id = setTimeout(() => setMinDone(true), SPLASH_MIN_MS); return () => clearTimeout(id); }, []);
  useEffect(() => { if (loaded && minDone && phase === 'on') setPhase('leaving'); }, [loaded, minDone, phase]);
  useEffect(() => { if (phase !== 'leaving') return; const id = setTimeout(() => setPhase('off'), 280); return () => clearTimeout(id); }, [phase]);
  return phase;
}

function App() {
  const t = useT();
  const conn = useStore((st) => st.conn);
  const detail = useStore((st) => st.connDetail);
  const loaded = useStore((st) => st.boardLoaded);
  const toasts = useStore((st) => st.toasts);
  const cmd = useRef(null);
  const inbox = useInbox();
  const [summary, closeSummary] = useReturnSummary();
  const splash = useSplash(loaded);
  const order = [...inbox.needsYou, ...inbox.problems].map((s) => s.sessionId);
  const orderRef = useRef(order);
  orderRef.current = order;
  // P11: 왼쪽 레일의 "손으로 잇기"(노드 손잡이를 늘 보인다), 오른쪽 레일의 루프 목록. P43: 판에서 ← 키로도 바꾼다
  const [linking, setLinking] = useState(false);
  const [loopsOpen, setLoopsOpen] = useState(false);

  useEffect(() => {
    // H4: 노드를 눌러 들어간 직후 터미널이 붙기 전에 친 키(입력칸 밖)는 모아 둔다. 터미널에 초점이 가면 그만 모은다
    const onKeyCapture = (e) => {
      // Ctrl+F는 판의 검색이다. 터미널에 초점이 있어도 터미널보다 먼저 받는다(H2)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); e.stopPropagation(); setSearchOpen(true); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); e.stopPropagation(); cmd.current?.focus(); return; }
      const st = getState();
      const p = st.pendingInput && pendingFor(st.pendingInput.id);
      // P43: 판에 초점이 있을 때의 방향키(lib/keys.js boardArrowKey). 노드에 들어가 터미널을 기다리는 동안(p)은 터미널 몫이다.
      // 잡는 단계에서 받아 React Flow(고른 노드를 방향키로 옮긴다)보다 먼저 쓴다
      const arrow = boardArrowKey(e, { dialog: st.dialog, missionOpen: st.missionOpen, outputOpen: !!st.outputView, pending: !!p });
      if (arrow) {
        e.preventDefault(); e.stopPropagation();
        if (arrow === 'command') cmd.current && cmd.current.focus();
        else if (arrow === 'search') { if (st.searchOpen) { const el = document.querySelector('[data-field="search"]'); if (el) el.select(); } else setSearchOpen(true); }
        else if (arrow === 'tool') setLinking((l) => !l);
        return;
      }
      if (!p || st.dialog || st.searchOpen || st.missionOpen || st.outputView || st.killAsk) return;
      if (e.target && e.target.closest && e.target.closest('.xterm')) return;
      if (editable(e.target)) return;
      const data = keyToData(e);
      if (data == null) return;
      e.preventDefault(); e.stopPropagation();
      p.buf += data;
    };
    window.addEventListener('keydown', onKeyCapture, true);
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); cmd.current && cmd.current.focus(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); setSearchOpen(true); return; }
      if (editable(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      // P22: 고른 세션 노드를 Delete로 닫는다(X와 같은 확인). 터미널·입력 칸·메모 편집 중에는 위의 editable에서 그대로 글자를 지운다
      const close = closeKeyTargets(e, getState());
      if (close) { e.preventDefault(); if (close.one) setKillAsk(close.one); else openDialog({ kind: 'close', ids: close.many }); return; }
      if ((e.key === 'm' || e.key === 'M') && !getState().dialog) { e.preventDefault(); setMissionOpen(!getState().missionOpen); return; }
      if (e.key === 'n' || e.key === 'N') {
        // N: 내 차례(그다음 문제)를 차례로. 노드를 옮기지 않고 화면만 간다(BRIEF 4절)
        const id = nextTarget(orderRef.current, getState().focusId);
        if (id) { e.preventDefault(); getState().navigateTo(id); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keydown', onKeyCapture, true); };
  }, []);

  return (
    <div className={`mt-app${linking ? ' linking' : ''}`}>
      <div className="mt-body">
        {loaded && <Sidebar />}
        <div className="mt-stage">
          <AppBoundary>
            {loaded && <Canvas />}
          </AppBoundary>
          <TopLeft />
          <TopRight maxControllers={MAX_CONTROLLERS} />
          <Warnings />
          {loaded && <LeftRail linking={linking} setLinking={setLinking} />}
          {loaded && <RightRail loopsOpen={loopsOpen} setLoopsOpen={setLoopsOpen} />}
          {loaded && loopsOpen && <LoopsPanel onClose={() => setLoopsOpen(false)} />}
          <ReturnSummary summary={summary} onClose={closeSummary} />
          {loaded && <SelectionBar />}
          {loaded && <SearchBox />}
          {loaded && <ChipRow />}
          <CommandBar ref={cmd} />
          {loaded && <ZoomPill />}
          {loaded && <OutputPanel />}
          {loaded && <MissionMap />}
        </div>
      </div>
      <Dialogs />
      {loaded && <PairRequestBanner />}
      {isWeb && <RemoteBar />}
      {splash !== 'off' && <Splash error={!loaded && conn === 'error' ? t('app.backendFailed', { detail }) : null} leaving={splash === 'leaving'} />}
      <div className="mt-toasts">{toasts.map((t) => <div key={t.id} className={`mt-toast ${t.kind}`}>{t.text}</div>)}</div>
    </div>
  );
}

// 시험 스크립트(Playwright)와 E5·E6 측정이 읽는 창 안의 값
window.__mt = { api, getState, perf, budget, terms, maxControllers: MAX_CONTROLLERS, notifyLog, setDebugThrow, setConvoNodes, setFocus, pinBottom: setBottomPin }; // P13: setConvoNodes는 성능 시험의 기준(대화 노드 뺀 판). P26: setFocus는 초점 세션 시험. P43: pinBottom(true)은 아래 바를 늘 보이게(옛 창 시험)
window.addEventListener('error', (e) => { perf.perfLog('window_error', { message: e.message, at: `${e.filename}:${e.lineno}` }); window.mt.log(`error ${e.message} ${e.filename}:${e.lineno}`); });
window.addEventListener('unhandledrejection', (e) => { perf.perfLog('unhandled', { message: String(e.reason && (e.reason.message || e.reason)) }); window.mt.log(`unhandled ${e.reason && (e.reason.stack || e.reason.message || e.reason)}`); });

// React 19가 잡은 오류와 못 잡은 오류를 모두 남긴다(E5 2.5: 못 잡은 렌더링 오류는 뿌리부터 전체를 내린다)
const root = createRoot(document.getElementById('root'), {
  onUncaughtError: (error, info) => { perf.perfLog('react_uncaught', { message: String(error && error.message), stack: String((info && info.componentStack) || '').split('\n').slice(0, 6).join(' | ') }); window.mt.log(`react uncaught: ${error && (error.stack || error.message)}`); },
  onCaughtError: (error, info) => { perf.perfLog('react_caught', { message: String(error && error.message), stack: String((info && info.componentStack) || '').split('\n').slice(0, 6).join(' | ') }); window.mt.log(`react caught: ${error && (error.stack || error.message)}`); },
});
// P11: 터미널 글꼴을 먼저 읽는다. xterm은 처음 열 때 글꼴로 칸 폭을 재므로, 대체 글꼴로 재면 글이 겹친다. 오래 걸리면(1.5초) 그냥 그린다
const fontsReady = Promise.race([
  Promise.all(['500 14px "JetBrains Mono Variable"', '700 14px "JetBrains Mono Variable"', '400 14px "Nanum Gothic Coding"', '600 13px "Geist Variable"', '600 13px "Pretendard Variable"']
    .map((f) => document.fonts.load(f, f.includes('Nanum') || f.includes('Pretendard') ? '가나' : 'Ab').catch(() => null))),
  new Promise((r) => setTimeout(r, 1500)),
]);
function boot() {
  fontsReady.then(() => root.render(<ReactFlowProvider><App /></ReactFlowProvider>));
  api.connect();
  startNotifier();
  startViewingReport(); // P21(D4): 초점 노드는 저절로 잠재우지 않는다
}
// P48: 웹 화면은 짝을 맺은 뒤에 판에 붙는다
if (isWeb) webGate().then(boot); else boot();
