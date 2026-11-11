// P74: 휴대폰 세로 화면(폭 430px 이하, 세로, 터치)의 원격 웹 화면. 무한 캔버스 대신 한 손으로 쓰는 세 화면을 보인다.
// - 목록: 응답 필요(오래 기다린 순) → 작업 중 → 나머지(프로젝트별로 접기). 줄마다 상태 점과 마지막 한 줄. 아래쪽에 "다음 응답 필요"와 "새 세션"
// - 세션: 화면 전체 터미널(손가락으로 끌어 스크롤, 누르면 키보드가 뜨지 않는다),
//   자주 쓰는 키 줄(Enter, Esc, Ctrl+C, ↑↓, Tab, ⇧Tab, /, 글자 크기), 아래쪽 입력 줄(여러 줄, 에이전트는 전달 대기열, 셸은 터미널 입력)
//   P104: 승인·질문 카드와 "카드 보기"를 뺐다. 응답이 필요하면 키 줄 자리에 키 패드(Esc 1~4 ↑ Tab / 닫기 Space Enter ← ↓ →)를 펼치고,
//   누른 키를 session.keys로 그 패널에 그대로 보낸다(어느 하네스에서나 같다). 답은 터미널을 보며 사람이 고른다
// - 새 세션: 왼쪽 레일의 런처(즐겨찾기, 없으면 모두)와 프로젝트를 골라 띄운다
// - 위쪽에 연결 상태(연결됨·왕복 지연, 다시 연결 중 → 누르면 지금 다시). 원격 막음 화면과 업데이트 띠는 RemoteBar가 그대로 보인다
// - 가상 키보드가 올라오면 보이는 높이(visualViewport)에 화면을 맞춰 입력 줄이 가려지지 않게 한다. 노치는 env(safe-area-inset-*)
// 가로로 돌리거나 폭이 넓으면 main.jsx가 보드 화면을 그대로 보인다. 휴대폰에서도 "보드 화면"을 고를 수 있다(LAYOUT_KEY)
// P76: 휴대폰의 기본은 보드 화면(캔버스, 탭하면 전체 보기 PhoneFull.jsx)이다. 이 목록은 보드 화면의 목록 단추로 고를 때(LAYOUT_KEY 'list')만 보이고, 머리줄의 보드 단추로 돌아간다
// P87: 휴대폰은 늘 이 목록으로 연다(lib/phone.js isPhoneDevice, 보드는 iPhone Safari에서 죽는다). 머리줄의 보드 단추는 미션 맵(PhoneMission.jsx) 단추가 되었고,
//   가벼운 화면 안내와 "보드로 다시 열기"는 휴대폰에 보이지 않는다(죽음 기록은 그대로 남긴다). 보드 화면·전체 보기 코드는 태블릿을 위해 그대로 둔다
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, getState, toast, markSeen, setFocus, setCloseIds, askKey } from './store.js';
import { phoneInputTarget, phoneInputCall } from './lib/phone-input.js';
import { TerminalView, terms } from './TerminalView.jsx';
import { LauncherIcon } from './Launchers.jsx';
import { startedText, devModel } from './SpawnDialog.jsx';
import { enterSession, markInteracted } from './touch.js';
import { wakeSession } from './sleep.js';
import { useT, errText } from './lib/i18n.js';
import { ago, STATE_LABEL, deliveryText } from './lib/labels.js';
import { favoriteLaunchers, orderedLaunchers } from './lib/launchers.js';
import { checkLabel } from './lib/session-name.js'; // P97: 새 세션 이름 칸
import { BRAND_WORDMARK } from './lib/icons.jsx';
import { phoneList, toneOf, lastLineOf, KEY_ROW, keyBytes, touchWheelDelta, screenBox, sendPlan, nextNeed, isPhoneDevice, LAYOUT_KEY, needsYou, PAD_KEYS, keyQueue, padKeyOf, padOpen } from './lib/phone.js';
import { pwaState, onPwa, isStandalone, isIOS, promptInstall } from './lib/pwa.js';
import { clampPhoneScale, PHONE_SCALE_DEFAULT } from './lib/scale.js'; // P83: 휴대폰 글자는 40%까지
import { LIST_PREF } from './lib/touch-board.js'; // P76: 목록 단추(태블릿 보드에는 보이지 않는다)
import { PhoneMission } from './PhoneMission.jsx'; // P87: 휴대폰 미션 맵
import { useConnSteady } from './steady.js'; // P82: 짧은 끊김에는 연결 알약을 바꾸지 않는다
import { PushButton, PushSheet, SessionMuteButton } from './PhonePush.jsx'; // P88: 알림(웹 푸시), P92: 세션 하나 끄기
import { setOpenHandler, launchOpen, clearLaunchOpen } from './push.js'; // P88: 알림을 누르면 그 세션으로
import { reopenBoard, boardLevel, boardHeavier, boardReset, bootState } from './crash-watch.js'; // P84: 반복해서 죽으면 가벼운 화면(목록). P86: 보드 단계
import './phone.css';

// ---------- 화면 고르기(main.jsx) ----------
const store = () => { try { return localStorage; } catch { return null; } };
let pref = (() => { try { return store() && store().getItem(LAYOUT_KEY); } catch { return null; } })();
const prefSubs = new Set();
export function setLayoutPref(v) {
  pref = v || null;
  try { if (v) store().setItem(LAYOUT_KEY, v); else store().removeItem(LAYOUT_KEY); } catch {}
  for (const fn of [...prefSubs]) fn();
}
const coarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };
export const phoneScreen = () => isPhoneDevice({ width: window.innerWidth, height: window.innerHeight, coarse: coarse() });
// P76: [세션 목록을 보일까, 휴대폰 세로 화면인가(보드 화면에 목록 단추와 전체 보기를 둔다)]
// P87: 휴대폰이면 늘 목록이다(목록 단추로 고른 것과 상관없이). 휴대폰에서는 보드를 그리지 않으므로 둘째 값도 같다
export function usePhoneLayout(enabled = true) {
  const get = () => (enabled ? [phoneScreen(), phoneScreen()] : [false, false]);
  const [v, setV] = useState(get);
  useEffect(() => {
    if (!enabled) return undefined;
    let raf = 0;
    const up = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setV((old) => { const n = get(); return n[0] === old[0] && n[1] === old[1] ? old : n; })); };
    window.addEventListener('resize', up);
    window.addEventListener('orientationchange', up);
    prefSubs.add(up);
    up();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', up); window.removeEventListener('orientationchange', up); prefSubs.delete(up); };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}
// P83: 화면 높이(lib/phone.js screenBox). iOS 홈 화면 앱이 창 높이를 상태 표시줄만큼 짧게 주면 html.mt-tall과 --mt-screen-h로
// html·body·#root를 화면 높이까지 늘린다(phone.css). 키보드가 열려도 그대로 둔다(보이는 높이는 visualViewport로 따로 맞춘다)
export const screenNow = () => screenBox({ vv: window.visualViewport, innerHeight: window.innerHeight, innerWidth: window.innerWidth, screenW: window.screen && window.screen.width, screenH: window.screen && window.screen.height, standalone: isStandalone() });
export function useScreenFix(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const root = document.documentElement;
    const fit = () => {
      const b = screenNow();
      if (b.tall) { root.style.setProperty('--mt-screen-h', `${b.height}px`); root.classList.add('mt-tall'); } else if (!isStandalone()) root.classList.remove('mt-tall');
    };
    fit();
    const vv = window.visualViewport;
    if (vv) vv.addEventListener('resize', fit);
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => { if (vv) vv.removeEventListener('resize', fit); window.removeEventListener('resize', fit); window.removeEventListener('orientationchange', fit); root.classList.remove('mt-tall'); };
  }, [enabled]);
}

// P76: 휴대폰 보드 화면(기본)의 작은 세션 목록 단추(오른쪽 위, 늘 보인다)
export function PhoneListButton() {
  const t = useT();
  return (
    <button type="button" className="mt-ph-listbtn" data-action="phone-list-open" title={t('phoneBoard.toList')} aria-label={t('phoneBoard.toList')} onClick={() => setLayoutPref(LIST_PREF)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
    </button>
  );
}

// ---------- 작은 도우미 ----------
function useNow(ms) { const [n, set] = useState(Date.now()); useEffect(() => { const id = setInterval(() => set(Date.now()), ms); return () => clearInterval(id); }, [ms]); return n; }
const Chev = ({ dir = 'right' }) => <svg className="mt-ph-chev" viewBox="0 0 24 24" aria-hidden="true"><path d={dir === 'left' ? 'm15 18-6-6 6-6' : dir === 'down' ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6'} /></svg>;
const readFolded = () => { try { return new Set(JSON.parse(store().getItem('mt.phoneFolded') || '[]')); } catch { return new Set(); } };
const PHONE_SCALE_KEY = 'mt.phoneTermScale';
// 기본 14px × 0.8 ≈ 11px: 390px 폭에 50칸쯤. P83: 가장 작게 40%(5.6px)면 110칸 안팎
export const readPhoneScale = () => { try { return clampPhoneScale(store().getItem(PHONE_SCALE_KEY)); } catch { return PHONE_SCALE_DEFAULT; } };
export const writePhoneScale = (n) => { try { store().setItem(PHONE_SCALE_KEY, String(n)); } catch {} }; // P76: 전체 보기도 같은 글자 크기

// 연결 상태(api.js $conn, $rtt)
// P82: 끊긴 지 2초가 안 됐으면 열린 것처럼(지연도 그대로) 보인다
function useConn() {
  const { conn: raw, grace } = useConnSteady();
  const [rtt, setRtt] = useState(api.rtt);
  useEffect(() => api.on('$rtt', (r) => setRtt(r.rtt)), []);
  const conn = grace ? { ...raw, phase: 'open' } : raw;
  return { conn, rtt: conn.phase === 'open' ? rtt : null };
}
// compact: 세션 화면의 머리줄(연결되어 있으면 점만, 끊기면 글도)
function ConnPill({ compact = false }) {
  const t = useT();
  const { conn, rtt } = useConn();
  const phase = conn.phase === 'open' ? 'open' : conn.phase === 'blocked' ? 'blocked' : 'reconnecting';
  const text = phase === 'open' ? (rtt != null ? t('phone.connRtt', { ms: rtt }) : t('phone.connOpen')) : phase === 'blocked' ? t('phone.connBlocked') : t('phone.connRetry');
  const dotOnly = compact && phase === 'open';
  return (
    <button type="button" className={`mt-ph-conn ${phase}${compact ? ' compact' : ''}`} data-role="phone-conn" data-phase={phase} aria-label={text} onClick={() => { if (phase !== 'open') api.wake(); }} title={phase === 'open' ? text : t('remote.retryNow')}>
      <span className="mt-ph-conn-dot" />{!dotOnly && <span>{text}</span>}
    </button>
  );
}

// ---------- 뿌리 ----------
export function PhoneApp() {
  const sessions = useStore((st) => st.sessions);
  // P87: 화면은 history.state에 둔다. mtPhone: 연 세션, mtMission: 미션 맵(그 위에서 연 세션이면 둘 다)
  const navOf = (st) => ({ open: (st && st.mtPhone) || null, mission: !!(st && st.mtMission) });
  const [nav, setNav] = useState(() => navOf(history.state));
  const open = nav.open;
  const [spawn, setSpawn] = useState(false);
  const rootRef = useRef(null);

  // 가상 키보드: 보이는 높이에 맞춘다
  useEffect(() => {
    const vv = window.visualViewport;
    const el = rootRef.current;
    const fit = () => {
      const b = screenNow(); // P83: 홈 화면 앱의 짧은 창 높이를 바로잡은 값
      if (el) { el.style.height = `${b.height}px`; el.style.transform = b.top ? `translateY(${b.top}px)` : ''; }
      document.documentElement.classList.toggle('mt-kb-open', b.height < window.innerHeight - 120); // 키보드가 올라왔으면 아래 안전 영역을 비우지 않는다
    };
    fit();
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    window.addEventListener('resize', fit);
    document.documentElement.classList.add('mt-phone-on');
    return () => { if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); } window.removeEventListener('resize', fit); document.documentElement.classList.remove('mt-phone-on', 'mt-kb-open'); };
  }, []);

  // 뒤로 가기(Android 뒤로 단추, 가장자리 밀기)는 목록으로
  useEffect(() => {
    const onPop = (e) => setNav(navOf(e.state));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (id, { replace = false } = {}) => {
    if (!id) { if (history.state && history.state.mtPhone) history.back(); else setNav((n) => ({ ...n, open: null })); return; }
    const next = { mtPhone: id, ...(nav.mission ? { mtMission: true } : {}) };
    if (replace || (history.state && history.state.mtPhone)) history.replaceState(next, ''); else history.pushState(next, '');
    setNav({ open: id, mission: nav.mission });
  };
  // P87: 미션 맵 열기·닫기(뒤로 가기도 목록으로)
  const mission = (on) => {
    if (on) { history.pushState({ mtMission: true }, ''); setNav({ open: null, mission: true }); return; }
    if (history.state && history.state.mtMission && !history.state.mtPhone) history.back(); else { try { history.replaceState(null, ''); } catch {} setNav({ open: null, mission: false }); }
  };
  // 연 세션: 보는 중(잠재우기에서 뺀다), 들어간 시각, 확인함
  useEffect(() => {
    if (!open) { setCloseIds([]); return; }
    setFocus(open); setCloseIds([open]); enterSession(open); markSeen(open);
  }, [open]);
  // 연 세션이 사라지면 목록으로
  useEffect(() => { if (open && getState().boardLoaded && !sessions.has(open)) { const m = nav.mission; setNav({ open: null, mission: m }); try { history.replaceState(m ? { mtMission: true } : null, ''); } catch {} } }, [open, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  window.__mtPhone = { open: (id) => go(id), list: () => go(null), mission: () => mission(true) }; // 시험이 부른다
  // P88: 알림을 누르면 그 세션을 연다. 열린 창이면 서비스 워커의 메시지로, 새로 열었으면 주소의 ?open=으로(세션이 들어온 뒤 한 번)
  const goRef = useRef(go); goRef.current = go;
  useEffect(() => setOpenHandler((id) => { if (getState().sessions.has(id)) goRef.current(id); }), []);
  const launch = useRef(launchOpen());
  useEffect(() => {
    const id = launch.current;
    if (!id) return;
    if (sessions.has(id)) { launch.current = null; clearLaunchOpen(); goRef.current(id); } else if (getState().boardLoaded) { launch.current = null; clearLaunchOpen(); }
  }, [sessions]);

  const s = open ? sessions.get(open) : null;
  return (
    <div className="mt-phone" ref={rootRef} data-role="phone" data-view={s ? 'session' : nav.mission ? 'mission' : 'list'}>
      {s ? <PhoneSession key={s.sessionId} s={s} fromMission={nav.mission} onBack={() => go(null)} onGo={(id) => go(id, { replace: true })} />
        : nav.mission ? <PhoneMission onBack={() => mission(false)} onOpen={(id) => go(id)} conn={<ConnPill />} />
        : <PhoneList onOpen={(id) => go(id)} onNew={() => setSpawn(true)} onMission={() => mission(true)} />}
      {spawn && <SpawnSheet onClose={() => setSpawn(false)} onStarted={(id) => { setSpawn(false); go(id); }} />}
    </div>
  );
}

// ---------- 목록 ----------
function Row({ s, now, showRepo, wsName, onOpen }) {
  const t = useT();
  const tone = toneOf(s);
  const line = lastLineOf(s);
  const at = line.kind === 'ask' ? s.ask && s.ask.since : s.lastActivityAt || s.lastAnswerAt;
  const label = s.kind === 'shell' && s.state !== 'exited' && s.state !== 'sleeping' ? (s.shell && s.shell.atPrompt === false ? STATE_LABEL.shell_running : STATE_LABEL.shell_idle) : STATE_LABEL[s.state] || s.state;
  const lead = line.kind === 'ask' ? t(`phone.ask_${line.key}`, { tool: line.tool || '' }) : line.kind === 'prompt' ? t('phone.youSaid') : line.kind === 'error' ? t('state.error') : '';
  return (
    <button type="button" className={`mt-ph-row${needsYou(s) ? ' need' : ''}`} data-session={s.sessionId} data-tone={tone} onClick={() => onOpen(s.sessionId)}>
      <span className="mt-ph-dot" data-tone={tone} aria-hidden="true" />
      <span className="mt-ph-row-main">
        <span className="mt-ph-row-top">
          <b className="mt-ph-name">{s.name}</b>
          {showRepo && wsName && <span className="mt-ph-repo">{wsName}</span>}
          <span className="mt-ph-when">{at ? ago(at, now) : ''}</span>
        </span>
        <span className="mt-ph-line" data-kind={line.kind}>
          {lead && <span className="mt-ph-lead">{lead}</span>}
          <span className="mt-ph-text">{line.text || (lead ? '' : label)}</span>
        </span>
      </span>
      <Chev />
    </button>
  );
}

function InstallTip() {
  const t = useT();
  const [, tick] = useState(0);
  const [hidden, setHidden] = useState(() => { try { return store().getItem('mt.phoneInstallTip') === '0'; } catch { return false; } });
  useEffect(() => onPwa(() => tick((x) => x + 1)), []);
  if (hidden || isStandalone()) return null;
  const hide = () => { setHidden(true); try { store().setItem('mt.phoneInstallTip', '0'); } catch {} };
  if (pwaState.installEvent) {
    return <div className="mt-ph-tip" data-role="phone-install"><span>{t('phone.installHint')}</span><button type="button" className="mt-ph-tip-btn" data-action="phone-install" onClick={() => promptInstall()}>{t('pwa.install')}</button><button type="button" className="mt-ph-tip-x" aria-label={t('common.close')} onClick={hide}>×</button></div>;
  }
  if (isIOS()) return <div className="mt-ph-tip" data-role="phone-install-ios"><span>{t('phone.installIos')}</span><button type="button" className="mt-ph-tip-x" aria-label={t('common.close')} onClick={hide}>×</button></div>;
  return null;
}

// P84: 가벼운 화면의 안내(페이지가 1분 안에 두 번 죽은 뒤). 보드로 다시 열면 페이지를 다시 읽는다. floating: 보드 화면 위(휴대폰 밖)
export function LightBanner({ floating = false }) {
  const t = useT();
  return (
    <div className={`mt-ph-light${floating ? ' floating' : ''}`} data-role="light-banner" role="status">
      <div className="mt-ph-light-text"><b>{t('lightView.title')}</b><span>{t('lightView.body')}</span></div>
      <button type="button" className="mt-ph-tip-btn" data-action="light-board" onClick={() => { setLayoutPref(null); reopenBoard(); }}>{t('lightView.reopen')}</button>
    </div>
  );
}

// P86: 가벼운 보드 단계(웹 화면이 죽을 때마다 한 단계씩). 작은 알약을 누르면 무엇을 껐는지와 "한 단계 무겁게", "처음으로"
export function LevelBadge() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const n = boardLevel();
  if (!n) return null;
  return (
    <div className={`mt-level${open ? ' open' : ''}`} data-role="board-level" data-level={n} role="status">
      <button type="button" className="mt-level-pill" data-action="board-level" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{t('boardLevel.title', { n })}</button>
      {open && (
        <div className="mt-level-body">
          <span>{t(`boardLevel.l${n}`)}</span>
          {bootState().ok && <span className="mt-level-kept">{t('boardLevel.kept')}</span>}
          <div className="mt-level-actions">
            <button type="button" className="mt-ph-tip-btn" data-action="board-heavier" onClick={() => boardHeavier()}>{t('boardLevel.heavier')}</button>
            <button type="button" className="mt-ph-tip-btn ghost" data-action="board-reset" onClick={() => boardReset()}>{t('boardLevel.reset')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PhoneList({ onOpen, onNew, onMission }) {
  const t = useT();
  const sessions = useStore((st) => st.sessions);
  const workspaces = useStore((st) => st.workspaces);
  const loaded = useStore((st) => st.boardLoaded);
  const now = useNow(15000);
  const [folded, setFolded] = useState(readFolded);
  const [pushOpen, setPushOpen] = useState(false); // P88
  const list = useMemo(() => phoneList([...sessions.values()], workspaces), [sessions, workspaces]);
  const wsName = (k) => { const w = workspaces.find((x) => x.key === k); return w ? w.name : null; };
  const toggle = (k) => setFolded((f) => { const n = new Set(f); const key = k || '-'; if (n.has(key)) n.delete(key); else n.add(key); try { store().setItem('mt.phoneFolded', JSON.stringify([...n])); } catch {} return n; });
  const row = (s, showRepo) => <Row key={s.sessionId} s={s} now={now} showRepo={showRepo} wsName={wsName(s.workspaceKey)} onOpen={onOpen} />;
  const nextId = list.needs[0] && list.needs[0].sessionId;
  const empty = loaded && sessions.size === 0;
  return (
    <div className="mt-ph-list" data-role="phone-list">
      <header className="mt-ph-head">
        <img className="mt-ph-brand" src={BRAND_WORDMARK} alt="Atrium" draggable={false} />
        <ConnPill />
        <PushButton onClick={() => setPushOpen(true)} />
        <button type="button" className="mt-ph-icon" data-action="phone-mission" title={t('phoneMission.open')} aria-label={t('phoneMission.open')} onClick={onMission}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4" /></svg>
        </button>
      </header>
      <InstallTip />
      <div className="mt-ph-scroll" data-role="phone-scroll">
        {list.needs.length > 0 && (
          <section className="mt-ph-sec need" data-section="needs">
            <h4>{t('phone.secNeeds', { n: list.needs.length })}</h4>
            {list.needs.map((s) => row(s, true))}
          </section>
        )}
        {list.working.length > 0 && (
          <section className="mt-ph-sec" data-section="working">
            <h4>{t('phone.secWorking', { n: list.working.length })}</h4>
            {list.working.map((s) => row(s, true))}
          </section>
        )}
        {list.groups.map((g) => {
          const off = folded.has(g.key || '-');
          return (
            <section key={g.key || '-'} className={`mt-ph-sec repo${off ? ' folded' : ''}`} data-section="repo" data-ws={g.key || ''}>
              <button type="button" className="mt-ph-group" data-action="phone-fold" aria-expanded={!off} onClick={() => toggle(g.key)}>
                <Chev dir={off ? 'right' : 'down'} />
                <span className="mt-ph-group-name">{g.name || t('phone.noRepo')}</span>
                <span className="mt-ph-group-n">{g.sessions.length}</span>
              </button>
              {!off && g.sessions.map((s) => row(s, false))}
            </section>
          );
        })}
        {empty && <div className="mt-ph-empty" data-role="phone-empty">{t('phone.empty')}</div>}
      </div>
      <footer className="mt-ph-foot">
        {nextId && <button type="button" className="mt-ph-next" data-action="phone-next" onClick={() => onOpen(nextId)}>{t('phone.nextNeed', { n: list.needs.length })}</button>}
        <button type="button" className={`mt-ph-new${nextId ? '' : ' wide'}`} data-action="phone-new" onClick={onNew}>{t('phone.newSession')}</button>
      </footer>
      {pushOpen && <PushSheet onClose={() => setPushOpen(false)} />}
    </div>
  );
}

// ---------- 세션 하나 ----------
const KEY_LABEL = { enter: '⏎', esc: 'Esc', ctrlc: 'Ctrl+C', up: '↑', down: '↓', tab: 'Tab', shifttab: '⇧Tab', slash: '/' };
// P104: 키 패드. 키 줄 자리에 두 줄로 펼친다(phone.css .mt-ph-pad의 칸 배치). 누르면 화면 키보드와 입력 줄의 초점은 그대로 둔다
const PAD_GLYPH = { esc: 'Esc', tab: 'Tab', space: 'Space', enter: '⏎ Enter', up: '↑', down: '↓', left: '←', right: '→' };
const noFocus = (e) => e.preventDefault();
function PadIcon() {
  return <svg className="mt-ph-padicon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 9.5h.01M10.5 9.5h.01M14 9.5h.01M17.5 9.5h.01M8 14.5h8" /></svg>;
}
function PhoneKeyPad({ onKey, onClose, need }) {
  const t = useT();
  const label = (k) => (/^\d$/.test(k) ? t('phoneKeys.digit', { n: k }) : k === 'enter' || k === 'esc' || k === 'tab' ? t(`phone.key_${k}`) : t(`phoneKeys.${k}`));
  return (
    <div className={`mt-ph-pad${need ? ' need' : ''}`} role="group" aria-label={t('phoneKeys.group')} data-role="phone-pad">
      <button type="button" className="mt-ph-pk close" data-action="phone-pad-close" aria-label={t('phoneKeys.close')} title={t('phoneKeys.close')} onPointerDown={noFocus} onClick={onClose}><Chev dir="down" /></button>
      {PAD_KEYS.map((k) => (
        <button key={k} type="button" className={`mt-ph-pk${k === 'enter' ? ' enter' : ''}`} data-pad-key={k} aria-label={label(k)} onPointerDown={noFocus} onClick={() => onKey(k)}>{PAD_GLYPH[k] || k}</button>
      ))}
    </div>
  );
}
function PhoneSession({ s, onBack, onGo, fromMission = false }) {
  const t = useT();
  const id = s.sessionId;
  const sessions = useStore((st) => st.sessions);
  const deliveries = useStore((st) => st.deliveries);
  const boxRef = useRef(null);
  const taRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [scale, setScale] = useState(readPhoneScale);
  const [padPref, setPadPref] = useState(null); // P104: 사람이 키 패드를 열었거나(true) 닫았으면(false). 기다리는 요청이 바뀌면 비운다
  const now = useNow(5000);
  const needIds = useMemo(() => phoneList([...sessions.values()]).needs.map((x) => x.sessionId), [sessions]);
  const next = nextNeed(needIds, id);
  const live = s.state !== 'sleeping' && s.state !== 'exited';
  const ask = needsYou(s);
  const padKey = padKeyOf(s, askKey);
  useEffect(() => { setPadPref(null); }, [padKey]);
  const pad = live && padOpen(s, padPref);
  // P104: 키 패드의 키는 차례로(앞 요청이 돌아오기 전에 누른 키는 모아 다음 요청 하나로). 실패하면 모아 둔 키를 버린다
  const tRef = useRef(t); tRef.current = t;
  const keys = useMemo(() => keyQueue((list, target) => phoneInputCall(api, terms, id, 'session.keys', { keys: list }, target), (e) => { if (e.code !== 'disconnected') toast(tRef.current('phoneKeys.failed', { error: errText(e) }), 'error'); }, () => phoneInputTarget(api, terms, id)), [id]);
  const padPress = (k) => { markInteracted(id); keys.push(k); };

  // 터미널 칸의 크기(TerminalView가 패널 크기를 맞춘다)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [live]);
  // 이 휴대폰이 패널 크기를 가져간다(P47: 초점을 준 클라이언트). 붙을 때까지 몇 번 해 본다
  useEffect(() => {
    if (!live) return undefined;
    let n = 0, stop = false, timer = 0;
    const tryFocus = () => { if (stop) return; phoneInputCall(api, terms, id, 'terminal.focus').catch(() => { if (++n < 20 && !stop) timer = setTimeout(tryFocus, 300); }); };
    timer = setTimeout(tryFocus, 250);
    // 다시 붙으면(새 연결, 터미널도 다시 붙는다) 크기를 다시 가져간다
    const off = api.on('$open', () => { n = 0; clearTimeout(timer); timer = setTimeout(tryFocus, 600); });
    return () => { stop = true; clearTimeout(timer); off(); };
  }, [id, live]);
  // 터미널을 눌러도 화면 키보드가 뜨지 않게(입력은 아래 줄로). 손가락으로 끌면 휠로 바꿔 스크롤한다
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !live) return undefined;
    const quiet = setInterval(() => { const ta = el.querySelector('.xterm-helper-textarea'); if (ta && ta.getAttribute('inputmode') !== 'none') { ta.setAttribute('inputmode', 'none'); ta.setAttribute('aria-hidden', 'true'); } }, 300);
    let y0 = null, last = null, dragging = false;
    const onStart = (e) => { if (e.touches.length !== 1) { y0 = null; return; } y0 = last = e.touches[0].clientY; dragging = false; };
    const onMove = (e) => {
      if (y0 == null || e.touches.length !== 1) return;
      const tch = e.touches[0];
      if (!dragging && Math.abs(tch.clientY - y0) < 8) return;
      dragging = true;
      e.preventDefault();
      const dy = tch.clientY - last; last = tch.clientY;
      const screen = el.querySelector('.xterm-screen');
      if (screen && dy) screen.dispatchEvent(new WheelEvent('wheel', { deltaY: touchWheelDelta(dy), deltaMode: 0, clientX: tch.clientX, clientY: tch.clientY, bubbles: true, cancelable: true }));
    };
    const onEnd = () => { y0 = null; };
    el.addEventListener('touchstart', onStart, { passive: true, capture: true });
    el.addEventListener('touchmove', onMove, { passive: false, capture: true });
    el.addEventListener('touchend', onEnd, { capture: true });
    el.addEventListener('touchcancel', onEnd, { capture: true });
    return () => { clearInterval(quiet); el.removeEventListener('touchstart', onStart, { capture: true }); el.removeEventListener('touchmove', onMove, { capture: true }); el.removeEventListener('touchend', onEnd, { capture: true }); el.removeEventListener('touchcancel', onEnd, { capture: true }); };
  }, [id, live]);

  const sendKey = (k) => {
    const term = terms.get(id);
    const data = keyBytes(k, { appCursor: !!(term && term.modes && term.modes.applicationCursorKeysMode) });
    if (!data) return;
    markInteracted(id);
    phoneInputCall(api, terms, id, 'terminal.input', { data }).catch((e) => { if (e.code !== 'disconnected') toast(errText(e), 'error'); }); // P82: 끊긴 동안은 띠가 알린다
  };
  const bump = (d) => setScale((v) => { const n = clampPhoneScale(Math.round((v + d) * 100) / 100); try { store().setItem(PHONE_SCALE_KEY, String(n)); } catch {} return n; });
  async function send() {
    const plan = sendPlan(s, text);
    if (!plan || busy) return;
    setBusy(true);
    markInteracted(id);
    try {
      if (plan.method === 'session.send') {
        const r = await api.call('session.send', { target: [id], text: plan.text, ...(plan.whileWorking ? { whileWorking: plan.whileWorking } : {}) });
        const d = r && r.deliveries && r.deliveries[0];
        setNote(d ? { deliveryId: d.deliveryId, at: Date.now() } : { text: t('phone.sent'), at: Date.now() });
      } else {
        await phoneInputCall(api, terms, id, 'terminal.input', { data: plan.data });
        setNote({ text: t('phone.sent'), at: Date.now() });
      }
      setText('');
      requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = ''; });
    } catch (e) { if (e.code !== 'disconnected') toast(t('phone.sendFailed', { error: errText(e) }), 'error'); } // P82: 끊긴 동안은 글을 두고 띠가 알린다
    setBusy(false);
  }
  // 보낸 것의 전달 상태(대기열, 보냄, 확인 …)를 잠깐 보인다
  const d = note && note.deliveryId ? deliveries.get(note.deliveryId) : null;
  const noteText = note && now - note.at < 20000 ? (d ? deliveryText(d) : note.text || null) : null;
  const grow = (el) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 132)}px`; };
  const stateText = s.kind === 'shell' && live ? (s.shell && s.shell.atPrompt === false ? STATE_LABEL.shell_running : STATE_LABEL.shell_idle) : STATE_LABEL[s.state] || s.state;

  return (
    <div className="mt-ph-session" data-role="phone-session" data-session={id} data-state={s.state}>
      <header className="mt-ph-shead">
        <button type="button" className="mt-ph-back" data-action="phone-back" aria-label={fromMission ? t('phoneMission.backToMap') : t('phone.back')} onClick={onBack}><Chev dir="left" /><span>{fromMission ? t('phoneMission.short') : t('phone.list')}</span></button>
        <div className="mt-ph-title">
          <b><span className="mt-ph-dot" data-tone={toneOf(s)} aria-hidden="true" />{s.name}</b>
          <span className="mt-ph-sub">{stateText}</span>
        </div>
        {s.kind !== 'shell' && <SessionMuteButton sessionId={id} />}
        <ConnPill compact />
        <button type="button" className={`mt-ph-nextbtn${next ? ' on' : ''}`} data-action="phone-next-need" disabled={!next} onClick={() => next && onGo(next)} title={t('phone.nextNeedTitle')}>
          <span>{next ? t('phone.nextShort', { n: needIds.filter((x) => x !== id).length }) : t('phone.noNext')}</span><Chev />
        </button>
      </header>
      <div className="mt-ph-term" ref={boxRef} data-role="phone-term">
        {live && box.w > 0 && <TerminalView sessionId={id} width={box.w} height={box.h} fontScale={scale} webgl={false} onInput={() => markInteracted(id)} />}
        {s.state === 'sleeping' && (
          <div className="mt-ph-cover" data-role="phone-asleep"><p>{t('phone.asleep')}</p><button type="button" className="mt-ph-primary" data-action="phone-wake" onClick={() => wakeSession(id)}>{s.waking ? t('phone.waking') : t('phone.wake')}</button></div>
        )}
        {s.state === 'exited' && <div className="mt-ph-cover" data-role="phone-exited"><p>{t('phone.exited')}</p></div>}
      </div>
      {pad && <PhoneKeyPad need={ask} onKey={padPress} onClose={() => setPadPref(false)} />}
      {live && !pad && (
        <div className="mt-ph-keys" data-role="phone-keys">
          <button type="button" className={`mt-ph-key mt-ph-padopen${ask ? ' need' : ''}`} data-action="phone-pad-open" aria-expanded="false" aria-label={t('phoneKeys.open')} title={t('phoneKeys.open')} onPointerDown={noFocus} onClick={() => setPadPref(true)}><PadIcon /></button>
          {KEY_ROW.map((k) => (
            <button key={k} type="button" className="mt-ph-key" data-key={k} aria-label={t(`phone.key_${k}`)} onPointerDown={(e) => e.preventDefault()} onClick={() => sendKey(k)}>{KEY_LABEL[k]}</button>
          ))}
          <span className="mt-ph-keysep" />
          <button type="button" className="mt-ph-key small" data-action="phone-font-down" aria-label={t('phone.fontDown')} onPointerDown={(e) => e.preventDefault()} onClick={() => bump(-0.05)}>A−</button>
          <button type="button" className="mt-ph-key small" data-action="phone-font-up" aria-label={t('phone.fontUp')} onPointerDown={(e) => e.preventDefault()} onClick={() => bump(0.05)}>A+</button>
        </div>
      )}
      {live && (
        <form className="mt-ph-input" data-role="phone-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          {noteText && <div className="mt-ph-note" data-role="phone-note">{noteText}</div>}
          <textarea ref={taRef} rows={1} value={text} data-field="phone-text" enterKeyHint="enter" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder={s.kind === 'shell' ? t('phone.inputShell') : t('phone.inputAgent', { name: s.name })}
            onChange={(e) => { setText(e.target.value); grow(e.target); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229 && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
          <button type="submit" className="mt-ph-send" data-action="phone-send" disabled={busy || !text.trim()} aria-label={t('phone.send')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </form>
      )}
    </div>
  );
}

// ---------- 새 세션 ----------
function SpawnSheet({ onClose, onStarted }) {
  const t = useT();
  const data = useStore((st) => st.launchers);
  const workspaces = useStore((st) => st.workspaces);
  const currentWs = useStore((st) => st.currentWs);
  const favs = favoriteLaunchers(data);
  const list = favs.length ? favs : orderedLaunchers(data);
  const [lid, setLid] = useState(() => (list[0] ? list[0].id : null));
  const [ws, setWs] = useState(() => currentWs || (workspaces[0] && workspaces[0].key) || null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); // P97: 세션 이름(비우면 판이 짓는다). 레일 이름 칸과 같은 규칙
  const sessions = useStore((st) => st.sessions);
  const chk = checkLabel(name, [...sessions.values()], null);
  const W = workspaces.find((w) => w.key === ws) || null;
  const L = list.find((l) => l.id === lid) || null;
  async function start() {
    if (!L || !W || busy || !chk.ok) return;
    setBusy(true);
    try {
      const p = { cwd: W.root, launcher: L.id, ...(chk.label ? { name: chk.label } : {}) };
      const dm = devModel(L); if (dm) p.model = dm;
      const r = await api.call('session.spawn', p);
      toast(startedText(r));
      const t0 = Date.now();
      const wait = () => { if (getState().sessions.has(r.sessionId)) return onStarted(r.sessionId); if (Date.now() - t0 < 15000) setTimeout(wait, 200); else onClose(); };
      wait();
    } catch (e) { toast(t('spawn.failed', { error: errText(e) }), 'error'); setBusy(false); }
  }
  return (
    <div className="mt-ph-sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mt-ph-sheet" data-role="phone-spawn" role="dialog" aria-label={t('phone.newSession')}>
        <div className="mt-ph-sheet-head"><h3>{t('phone.newSession')}</h3><button type="button" className="mt-ph-tip-x" data-action="phone-spawn-close" aria-label={t('common.close')} onClick={onClose}>×</button></div>
        <div className="mt-ph-label">{favs.length ? t('phone.launchersRail') : t('phone.launchers')}</div>
        <div className="mt-ph-choices" data-role="phone-launchers">
          {list.map((l) => (
            <button key={l.id} type="button" className={`mt-ph-choice${l.id === lid ? ' on' : ''}`} data-launcher={l.id} aria-pressed={l.id === lid} onClick={() => setLid(l.id)}>
              <LauncherIcon l={l} /><span className="mt-ph-choice-name">{l.name}</span>
            </button>
          ))}
          {!list.length && <div className="mt-ph-empty">{t('phone.noLaunchers')}</div>}
        </div>
        <div className="mt-ph-label">{t('phone.repo')}</div>
        <div className="mt-ph-choices repos" data-role="phone-repos">
          {workspaces.map((w) => (
            <button key={w.key} type="button" className={`mt-ph-choice${w.key === ws ? ' on' : ''}`} data-ws={w.key} aria-pressed={w.key === ws} onClick={() => setWs(w.key)}>
              <span className="mt-ph-choice-name">{w.name}</span><span className="mt-ph-choice-sub">{w.root}</span>
            </button>
          ))}
          {!workspaces.length && <div className="mt-ph-empty">{t('phone.noRepos')}</div>}
        </div>
        <label className="mt-ph-label" htmlFor="mt-ph-spawn-name">{t('quickName.label')}</label>
        <input id="mt-ph-spawn-name" className={`mt-ph-spawn-name${chk.ok ? '' : ' bad'}`} data-field="phone-spawn-name" value={name} maxLength={40} autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go"
          placeholder={t('quickName.ph')} aria-invalid={!chk.ok} aria-describedby="mt-ph-spawn-note" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); start(); } }} />
        <div id="mt-ph-spawn-note" className={`mt-ph-spawn-note${chk.ok ? '' : ' bad'}`} data-role="phone-spawn-note" role={chk.ok ? undefined : 'alert'}>{chk.ok ? t('quickName.hintPhone') : t(`backend.${chk.key}`, chk.vars)}</div>
        <button type="button" className="mt-ph-primary" data-action="phone-spawn-go" disabled={!L || !W || busy || !chk.ok} onClick={start}>{busy ? t('phone.starting') : t('phone.start', { name: L ? L.name : '' })}</button>
      </div>
    </div>
  );
}
