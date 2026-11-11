// P11: 캔버스 위에 떠 있는 크롬(목업 app/design/board-mock/ ?scene=ours). P6a~P10의 위쪽 줄(InboxBar)과 아래쪽 워크스페이스 단추(Regions)가 하던 일을 옮겼다.
// - 위 왼쪽: 사이드바, 워크스페이스 탭(지금 영역은 주황 갈색, 세션 수), 리포 열기 +, 찾기(Ctrl+F)
// - 위 오른쪽: 내 차례(누르면 기다리는 세션 목록, N으로 다음), 검토, 문제, 연결과 세션 수, 메모리, 바뀐 것, 설정
// - 왼쪽 레일: 선택, 새 세션(Claude, Codex, Gemini, DeepSeek(P25), 셸), 메모, 칸반, 그룹, 손으로 잇기, 전체 보기, 작업 중만 또렷하게(P85)
// - 오른쪽 레일: 사이드바(리포), 미션 맵, 루프, 보관함, 설정
// - 아래: 빠른 동작 칩 줄, 줌 알약(− n% +, 누르면 전체 보기). 명령 입력은 CommandBar.jsx
// 새 기능은 없다. 모든 단추는 이미 있던 동작을 부른다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, getState, openDialog, toast, wsName, setMissionOpen, setSearchOpen, selectWorkspace, selectGroup, setSpotlight } from './store.js';
import { openResponseTerminal } from './response-needed.js';
import { QuickName } from './QuickName.jsx'; // P97: 레일 빠른 생성의 이름 칸
import { favoriteLaunchers, launcherIcon, launcherMark, launcherTooltip } from './lib/launchers.js'; // P33: 레일 = 즐겨찾기 호출자
import { api } from './api.js';
import { useConnSteady } from './steady.js'; // P82
import { isWeb } from './web.js';
import { createItem } from './Memo.jsx';
import { arrangeBoard, BOARD_ARRANGED } from './Regions.jsx'; // P31: 칩의 정리는 판 전체
import { toggleSidebar, openArchiveBox, useSide } from './Sidebar.jsx';
import { LoopList } from './Loops.jsx';
import { useDialog } from './dialog.js'; // P52
import { useInbox } from './InboxBar.jsx';
import { KindIcon } from './SessionNode.jsx';
import { DevicesPill } from './Peers.jsx'; // P47: 다른 기기 n
import { Icon } from './lib/icons.jsx';
import { STATE_LABEL, EXIT_LABEL, ago, askLine } from './lib/labels.js';
import { useT, errText, fmtTime } from './lib/i18n.js';
import { shortcutText } from './lib/shortcuts.js';
import { workspaceCounts } from '../../../backend/src/workspaces.mjs';
import { wsTabs, sumCounts, groupPick, memberLabel } from './lib/ws-tabs.js'; // P98: 위 바 묶음 칩
import { sleepIdle, asleepStats, memByRepo } from './sleep.js'; // P21(D4), P24: 리포별로 묶는다

function useNow(ms = 1000) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
const fmtMB = (x) => (x >= 1024 ? `${(x / 1024).toFixed(1)}GB` : `${Math.round(x)}MB`);
const go = openResponseTerminal;

// 펼침 목록: 알약 아래로 펼치고 바깥을 누르거나 Esc면 닫는다
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (!e.isComposing && e.keyCode !== 229 && e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return [open, setOpen, ref];
}

// ---------- 위 왼쪽 ----------
// P98: 묶음 칩에서 마지막으로 고른 구성(묶음 ID → 워크스페이스 키). 묶음 칩을 누르면 그것을 지금 워크스페이스로 둔다
const lastInGroup = new Map();

function wsTitle(t, w, c) {
  return `${t('top.wsTitle', { kind: w.kind === 'repo' ? t('top.wsRepo') : t('top.wsFolder'), root: w.root, sessions: c.sessions, shells: c.shells, working: c.working, needsYou: c.needsYou, review: c.review })}\n${t('boardKeys.ws')}`;
}
const closeWs = (e, w) => { e.stopPropagation(); openDialog({ kind: 'wsclose', ws: w }); };

function WsChip({ w, list, on }) {
  const t = useT();
  const c = workspaceCounts(list, w.key);
  return (
    <div role="button" tabIndex={0} className={`mt-wsbtn${on ? ' on' : ''}${c.needsYou ? ' hot' : ''}`} data-ws={w.key} data-name={w.name}
      title={wsTitle(t, w, c)} onClick={() => selectWorkspace(w.key)} onKeyDown={(e) => { if (e.key === 'Enter') selectWorkspace(w.key); }}>
      {c.needsYou > 0 && <span className="mt-ws-need" data-count="needsYou" title={t('top.turnN', { n: c.needsYou })}>{c.needsYou}</span>}
      <span className="mt-ws-name">{w.name}</span>
      <span className={`mt-ws-n${on ? ' badge' : ''}`} data-count="sessions">{c.sessions}</span>
      {c.sessions === 0 && <span role="button" className="mt-ws-x" title={t('top.wsClose')} data-action="ws-close" onClick={(e) => closeWs(e, w)}><Icon name="x" /></span>}
    </div>
  );
}

// P98: 묶음 하나의 대표 칩. 이름은 묶음 이름, 수와 응답 필요는 구성의 합. 누르면 지금 워크스페이스를 고르고(groupPick) 묶음 전체로 화면을 맞춘다.
// 끝의 ▾는 구성 목록을 펼친다(바는 가로 스크롤이라 목록은 body에 띄운다). 지금 워크스페이스가 묶음 안이면 켜지고 › 뒤에 안의 이름을 작게 보인다
function GroupChip({ tab, list, current }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const chip = useRef(null);
  const chev = useRef(null);
  const menu = useRef(null);
  const [at, setAt] = useState(null);
  const c = sumCounts(list, tab.keys);
  const on = tab.keys.includes(current);
  const cur = on ? tab.ws.find((w) => w.key === current) : null;
  const kind = tab.auto ? t('wsGroupTab.kindAuto', { root: tab.root || '' }) : t('wsGroupTab.kindGroup');
  const title = `${t('wsGroupTab.title', { name: tab.name, n: tab.keys.length, kind, sessions: c.sessions, shells: c.shells, working: c.working, needsYou: c.needsYou, review: c.review })}${cur ? `\n${t('wsGroupTab.current', { name: memberLabel(cur) })}` : ''}\n${t('boardKeys.ws')}`;
  const pickGroup = () => { setOpen(false); selectGroup(tab.keys, groupPick(tab, current, lastInGroup.get(tab.id))); };
  const pickOne = (k) => { setOpen(false); lastInGroup.set(tab.id, k); selectWorkspace(k); };
  useEffect(() => { if (on) lastInGroup.set(tab.id, current); }, [on, current, tab.id]);
  const place = () => { const r = chip.current && chip.current.getBoundingClientRect(); if (r) setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 288)), top: r.bottom + 8 }); };
  const toggle = (e, viaKey = false) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    place(); setOpen(viaKey ? 'key' : true);
  };
  // 바깥을 누르거나, Esc, 창 크기 바뀜, 바를 넘기면 닫는다. 키보드로 열었으면 첫 줄에 초점
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!(chip.current && chip.current.contains(e.target)) && !(menu.current && menu.current.contains(e.target))) setOpen(false); };
    const onKey = (e) => { if (!e.isComposing && e.keyCode !== 229 && e.key === 'Escape') { setOpen(false); chev.current && chev.current.focus(); } };
    const close = () => setOpen(false);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    const seg = chip.current && chip.current.closest('.mt-seg');
    if (seg) seg.addEventListener('scroll', close);
    if (open === 'key') requestAnimationFrame(() => { const b = menu.current && menu.current.querySelector('[role="menuitem"]'); if (b) b.focus(); });
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', close); if (seg) seg.removeEventListener('scroll', close); };
  }, [open]);
  // 목록 안 ↑·↓로 줄을 옮긴다
  const onMenuKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menu.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    if (n) n.focus();
  };
  return (
    <div ref={chip} role="button" tabIndex={0} className={`mt-wsbtn mt-wsgrp${on ? ' on' : ''}${c.needsYou ? ' hot' : ''}${tab.auto ? ' auto' : ''}`} data-group={tab.id} data-name={tab.name} data-ws={on ? current : undefined} data-members={tab.keys.length}
      title={title} onClick={pickGroup} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter') pickGroup(); else if (e.key === 'ArrowDown' && e.altKey) toggle(e, true); }}>
      {c.needsYou > 0 && <span className="mt-ws-need" data-count="needsYou" title={t('top.turnN', { n: c.needsYou })}>{c.needsYou}</span>}
      <Icon name={tab.auto ? 'folder' : 'layers'} className="mt-wsgrp-ico" />
      <span className="mt-ws-name">{tab.name}</span>
      {cur && <><span className="mt-wsgrp-sep" aria-hidden="true">›</span><span className="mt-wsgrp-sub" data-role="ws-group-current">{memberLabel(cur)}</span></>}
      <span className={`mt-ws-n${on ? ' badge' : ''}`} data-count="sessions">{c.sessions}</span>
      <span ref={chev} role="button" tabIndex={0} className={`mt-wsgrp-chev${open ? ' open' : ''}`} data-action="ws-group-open" aria-haspopup="menu" aria-expanded={!!open} aria-label={t('wsGroupTab.pick', { name: tab.name })} title={t('wsGroupTab.pick', { name: tab.name })}
        onClick={(e) => toggle(e)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); toggle(e, true); } }}><Icon name="chevDown" /></span>
      {open && at && createPortal(
        <div ref={menu} className="mt-dropdown mt-wsgrp-menu" role="menu" aria-label={t('wsGroupTab.pick', { name: tab.name })} data-role="ws-group-menu" data-group={tab.id} style={{ left: at.left, top: at.top }} onKeyDown={onMenuKey} onClick={(e) => e.stopPropagation()}>
          <div className="mt-dropdown-head"><span>{tab.name} · {t(tab.auto ? 'wsGroupTab.headAuto' : 'wsGroupTab.headGroup')}</span><span className="mono">{tab.keys.length}</span></div>
          {tab.ws.map((w) => {
            const x = workspaceCounts(list, w.key);
            return (
              <div key={w.key} role="menuitem" tabIndex={-1} className={`mt-wsgrp-item${w.key === current ? ' on' : ''}`} data-ws={w.key} data-name={w.name} title={wsTitle(t, w, x)}
                onClick={() => pickOne(w.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickOne(w.key); } }}>
                {x.needsYou > 0 && <span className="mt-ws-need" data-count="needsYou" title={t('top.turnN', { n: x.needsYou })}>{x.needsYou}</span>}
                <span className="mt-wsgrp-item-name">{memberLabel(w)}</span>
                <span className="mt-ws-n" data-count="sessions">{x.sessions}</span>
                {x.sessions === 0 && <span role="button" className="mt-ws-x" title={t('top.wsClose')} data-action="ws-close" onClick={(e) => { setOpen(false); closeWs(e, w); }}><Icon name="x" /></span>}
              </div>
            );
          })}
        </div>, document.body)}
    </div>
  );
}

function WorkspaceTabs() {
  const t = useT();
  const workspaces = useStore((st) => st.workspaces);
  const groups = useStore((st) => st.groups);
  const current = useStore((st) => st.currentWs);
  const sessions = useStore((st) => st.sessions);
  const list = useMemo(() => [...sessions.values()], [sessions]);
  const tabs = useMemo(() => wsTabs(workspaces, groups), [workspaces, groups]); // P98: 묶음은 대표 칩 하나
  const seg = useRef(null);
  // 지금 칩이 바 밖이면(←·→, 다른 곳에서 고름) 바만 가로로 넘겨 보이게 한다(scrollIntoView는 바깥 칸까지 넘길 수 있어 쓰지 않는다)
  useEffect(() => {
    const box = seg.current, el = box && box.querySelector('.mt-wsbtn.on');
    if (!el) return;
    const br = box.getBoundingClientRect(), er = el.getBoundingClientRect();
    const l = er.left - br.left + box.scrollLeft, r = l + er.width;
    if (l < box.scrollLeft) box.scrollLeft = Math.max(0, l - 8);
    else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth + 8;
  }, [current, tabs]);
  return (
    <div ref={seg} className="mt-seg" data-role="workspaces" onWheel={(e) => { if (!e.deltaX && e.deltaY) e.currentTarget.scrollLeft += e.deltaY; }}>
      {tabs.map((tab) => (tab.type === 'group'
        ? <GroupChip key={`g:${tab.id}`} tab={tab} list={list} current={current} />
        : <WsChip key={tab.key} w={tab.w} list={list} on={tab.key === current} />))}
      {!workspaces.length && <span className="mt-ws-empty">{t('top.wsEmpty')}</span>}
      <button className="mt-seg-plus" data-action="ws-open" title={t('top.wsOpen')} onClick={() => openDialog({ kind: 'wsopen' })}><Icon name="plus" /></button>
    </div>
  );
}

function SidebarButton() {
  const t = useT();
  const open = useSide((st) => st.open);
  return <button className={`mt-cp round${open ? ' on' : ''}`} data-action="sidebar" title={t('top.sidebar')} onClick={toggleSidebar}><Icon name="sidebar" /></button>;
}

export function TopLeft() {
  const t = useT();
  return (
    <div className="mt-cluster tl" data-role="top-left">
      <SidebarButton />
      {/* P9: 개발용 판이면 표시한다. 실제 판에는 없다 */}
      {api.info && api.info.profile === 'dev' && <span className="mt-dev-badge" data-role="dev-badge" title={t('top.devBadge', { session: api.info.herdrSession, port: api.info.port })}>dev</span>}
      <WorkspaceTabs />
      <button className="mt-cp" data-action="search" title={`${t('top.searchTitle')}\n${t('boardKeys.search')}`} onClick={() => setSearchOpen(true)}>
        <Icon name="search" /><span className="dim">{t('top.search')}</span><span className="mt-kbd">{shortcutText('Ctrl F')}</span>
      </button>
    </div>
  );
}

// ---------- 위 오른쪽 ----------
const wsTag = (s, currentWs) => <span className={`mt-chip-ws${(s.workspaceKey || null) === (currentWs || null) ? '' : ' other'}`} data-ws={s.workspaceKey || ''}>{wsName(s.workspaceKey)}</span>;

// 내 차례 알약과 그 목록(BRIEF 4절, ARCH 4절 A1). 목록의 줄을 누르거나 N을 누르면 노드를 옮기지 않고 화면이 그 세션으로 간다
function TurnPill({ needsYou }) {
  const t = useT();
  const [open, setOpen, ref] = useDropdown();
  const focusId = useStore((st) => st.focusId);
  const currentWs = useStore((st) => st.currentWs);
  const now = useNow();
  const n = needsYou.length;
  return (
    <div className="mt-drop" ref={ref}>
      <button className={`mt-cp turn${n ? ' hot' : ''}${open ? ' on' : ''}`} data-role="inbox" data-count={n} title={n ? t('top.turnTitle') : t('top.turnNone')} onClick={() => setOpen((o) => !o)}>
        <span className="mt-turn-dot" />{t('top.turn')} <b className="mono">{n}</b>
      </button>
      {open && (
        <div className="mt-dropdown" data-role="inbox-list">
          <div className="mt-dropdown-head"><span>{t('top.turn')}</span>{n > 0 && <span className="mt-kbd">{t('top.nextKey')}</span>}</div>
          {needsYou.map((s) => (
            <button key={s.sessionId} className={`mt-chip need${focusId === s.sessionId ? ' current' : ''}`} data-session={s.sessionId} data-name={s.name} onClick={() => { setOpen(false); go(s.sessionId); }} title={askLine(s)}>
              <span className="mt-chip-line"><b>@{s.name}</b> {wsTag(s, currentWs)} <span className="mt-chip-time">{ago((s.ask && s.ask.since) || s.createdAt, now)}</span></span>
              <span className="mt-chip-what">{askLine(s)}</span>
            </button>
          ))}
          {!n && <div className="mt-dropdown-empty">{t('top.turnEmpty')}</div>}
        </div>
      )}
    </div>
  );
}

function ListPill({ list, label, cls, role, line, empty }) {
  const [open, setOpen, ref] = useDropdown();
  const currentWs = useStore((st) => st.currentWs);
  return (
    <div className="mt-drop" ref={ref}>
      <button className={`mt-cp ${cls}${list.length ? ' has' : ''}${open ? ' on' : ''}`} data-role={role} data-count={list.length} onClick={() => setOpen((o) => !o)}>
        {label} <span className="mono">{list.length}</span>
      </button>
      {open && (
        <div className="mt-dropdown" data-role={`${role}-list`}>
          <div className="mt-dropdown-head"><span>{label}</span></div>
          {list.map((s) => (
            <button key={s.sessionId} className={`mt-chip ${cls}`} data-session={s.sessionId} data-name={s.name} onClick={() => { setOpen(false); go(s.sessionId); }} title={line(s)}>
              <span className="mt-chip-line"><b>@{s.name}</b> {wsTag(s, currentWs)}</span>
              {line(s) && <span className="mt-chip-what">{line(s)}</span>}
            </button>
          ))}
          {!list.length && <div className="mt-dropdown-empty">{empty}</div>}
        </div>
      )}
    </div>
  );
}

function ConnPill() {
  const t = useT();
  const rawConn = useStore((st) => st.conn);
  const { grace } = useConnSteady(); // P82: 웹 화면은 짧은 끊김(2초 안)에 알약을 바꾸지 않는다
  const conn = isWeb && grace ? 'open' : rawConn;
  const herdr = useStore((st) => st.herdr);
  const count = useStore((st) => st.sessions.size);
  const links = useStore((st) => st.links.size);
  const [starting, setStarting] = useState(false);
  const startHerdr = async () => { setStarting(true); try { await api.call('herdr.start'); toast(t('top.herdrStarted')); } catch (e) { toast(t('top.herdrStartFail', { error: errText(e) }), 'error'); } setStarting(false); };
  const herdrBlocked = !!(herdr.missing || herdr.level === 'missing' || herdr.level === 'incompatible'); // P40: 띠가 까닭과 할 일을 보인다
  const ok = conn === 'open' && herdr.connected && !herdrBlocked;
  const connWord = (c) => t(c === 'open' ? 'top.connected' : c === 'connecting' ? 'top.connecting' : 'top.disconnected');
  // P32: 누르면 미션 맵을 열고(열려 있으면 닫고) 올리면 연결 풀이. 백엔드와 끊겨 있으면 맵을 읽을 수 없으므로 누르기를 받지 않는다(herdr만 끊긴 때는 판 데이터로 연다)
  const mission = useStore((st) => st.missionOpen);
  const canOpen = conn === 'open';
  const title = [t('top.connBackend', { state: connWord(conn) }), t('top.connHerdr', { session: herdr.session || '?', version: herdr.version ? ` (${herdr.version})` : '', state: connWord(herdr.connected ? 'open' : 'closed') }), t('top.connSessions', { n: count }), t('top.connLinks', { n: links }), canOpen ? t(mission ? 'mmap.pillClose' : 'mmap.pillOpen') : null].filter(Boolean).join('\n');
  const toggle = () => { if (canOpen || mission) setMissionOpen(!mission); };
  return <>
    <span className={`mt-cp conn${ok ? '' : ' bad'}${canOpen ? ' click' : ''}${mission ? ' on' : ''}`} data-role="conn" data-action="conn-mission" title={title} role={canOpen ? 'button' : undefined} tabIndex={canOpen ? 0 : undefined} aria-pressed={canOpen ? mission : undefined} onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
      <span className={`mt-dot ${ok ? 'ok' : 'bad'}`} />
      {conn !== 'open' ? t('top.backendState', { state: connWord(conn) }) : herdrBlocked ? t(herdr.level === 'incompatible' ? 'top.herdrIncompatible' : 'top.herdrMissing') : herdr.connected === false ? t('top.herdrDown') : <><span className="mono">{count}</span><span className="dim">{t('top.sessions', { n: count })}</span></>}
      <span hidden data-role="links">{links}</span>
    </span>
    {conn === 'open' && herdr.connected === false && !herdrBlocked && <button className="mt-cp accent" disabled={starting} onClick={startHerdr} data-action="herdr-start">{t('top.herdrStart')}</button>}
  </>;
}

// P21(D4): 누르면 펼침 목록(세션별 메모리, 잠든 세션과 아낀 메모리, 쉬는 세션 모두 잠재우기). 잠든 세션을 누르면 그 노드로 간다(깨우지 않는다)
// P24: 목록은 리포별로 묶는다(리포 이름, 깨어 있는 메모리, 잠든 수와 아낀 메모리). 동작은 쉬는 리포 모두 잠재우기
function ResourcePill({ maxControllers }) {
  const t = useT();
  const r = useStore((st) => st.resources);
  const attached = useStore((st) => st.attached.length);
  const sessions = useStore((st) => st.sessions);
  const workspaces = useStore((st) => st.workspaces);
  const [open, setOpen, ref] = useDropdown();
  const [busy, setBusy] = useState(false);
  if (!r) return null;
  const z = asleepStats(sessions);
  const asleepLine = z.n ? t('sleep.memAsleep', { n: z.n, mb: fmtMB(z.mb) }) : t('sleep.memAsleepNone');
  const title = [
    asleepLine,
    t('top.resSessions', { n: r.sessionCount, mb: fmtMB(r.sessionsMB) }),
    ...r.sessions.map((x) => t('top.resSession', { name: x.name, mb: fmtMB(x.memMB), claude: fmtMB(x.claudeMB), n: x.procs })),
    t('top.resControllers', { n: r.controllers.count, mb: fmtMB(r.controllers.memMB), attached, max: maxControllers }),
    r.herdrServer ? t('top.resHerdr', { mb: fmtMB(r.herdrServer.memMB) }) : t('top.resNoHerdr'),
    t('top.resBackend', { mb: fmtMB(r.backend.memMB) }),
    t('top.resStates', { working: r.running, waiting: r.waiting }),
    t('top.resAt', { time: fmtTime(r.at), ms: r.ms }),
  ].join('\n');
  const repos = memByRepo(r.sessions, sessions, workspaces); // 잰 뒤 잠든 세션은 잠든 줄로만
  const doSleep = async () => { setBusy(true); await sleepIdle(); setBusy(false); };
  return (
    <div className="mt-drop" ref={ref}>
      <button className={`mt-cp res${open ? ' on' : ''}`} title={title} data-role="resources" data-asleep={z.n} onClick={() => setOpen((o) => !o)}>
        <span className="dim">{t('top.memory')}</span><span className="mono">{fmtMB(r.sessionsMB)}</span>
        {z.n > 0 && <span className="mt-res-asleep" data-role="res-asleep" title={asleepLine}><Icon name="moon" />{z.n}</span>}
      </button>
      {open && (
        <div className="mt-dropdown" data-role="resources-list">
          <div className="mt-dropdown-head"><span>{t('sleep.memHead')} · {fmtMB(r.sessionsMB)}</span></div>
          <div className="mt-res-sum" data-role="res-asleep-line">{asleepLine}</div>
          {repos.map((g) => (
            <div key={g.key || '-'} className="mt-res-group" data-role="res-repo" data-ws={g.key} data-name={g.name}>
              <div className="mt-res-repo"><b>{g.name}</b> <span className="mono">{fmtMB(g.memMB)}</span>{g.asleep.length > 0 && <span className="mt-res-asleep" data-role="res-repo-asleep"><Icon name="moon" />{t('sleep.memRepoAsleep', { n: g.asleep.length, mb: fmtMB(g.savedMB) })}</span>}</div>
              {g.rows.map((x) => (
                <button key={x.sessionId} className="mt-chip" data-session={x.sessionId} data-name={x.name} onClick={() => { setOpen(false); go(x.sessionId); }}>
                  <span className="mt-chip-line"><b>@{x.name}</b> <span className="mono">{fmtMB(x.memMB)}</span> <span className="dim">{STATE_LABEL[x.state] || x.state}</span></span>
                </button>
              ))}
              {g.asleep.map((s) => (
                <button key={s.sessionId} className="mt-chip asleep" data-session={s.sessionId} data-name={s.name} data-role="res-asleep-row" onClick={() => { setOpen(false); go(s.sessionId); }}>
                  <span className="mt-chip-line"><Icon name="moon" /> {t('sleep.memRowAsleep', { name: s.name, mb: fmtMB(s.sleep && s.sleep.memMB) })}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="mt-card-actions"><button className="mt-btn small" data-action="sleep-idle" disabled={busy} title={t('sleep.sleepIdleTitle')} onClick={doSleep}><Icon name="moon" />{t('sleep.sleepIdle')}</button></div>
        </div>
      )}
    </div>
  );
}

export function TopRight({ maxControllers }) {
  const t = useT();
  const { needsYou, review, problems } = useInbox();
  return (
    <div className="mt-cluster tr" data-role="top-right">
      <TurnPill needsYou={needsYou} />
      <ListPill list={review} label={t('top.review')} cls="review" role="review" line={(s) => (s.lastAnswer || '').replace(/\s+/g, ' ').slice(0, 120)} empty={t('top.reviewEmpty')} />
      {problems.length > 0 && <ListPill list={problems} label={t('top.issues')} cls="problem" role="problems" line={(s) => (s.state === 'exited' ? EXIT_LABEL[s.exit && s.exit.kind] : STATE_LABEL[s.state]) || ''} empty={t('top.issuesEmpty')} />}
      <ConnPill />
      <DevicesPill />
      <ResourcePill maxControllers={maxControllers} />
      <button className="mt-cp round" title={t('top.changes')} onClick={() => getState().showChanges && getState().showChanges(60)} data-action="changes"><Icon name="history" /></button>
      <button className="mt-cp round" onClick={() => openDialog({ kind: 'settings' })} data-action="settings-open" title={t('top.settings')}><Icon name="gear" /></button>
    </div>
  );
}

// ---------- 도구 레일 ----------
function Tool({ icon, kind, label, on, onClick, action, pressed }) {
  return (
    <button className={`mt-tool${on ? ' on' : ''}`} title={label} aria-label={label} aria-pressed={pressed} data-action={action} onClick={onClick}>
      {kind ? <KindIcon kind={kind} title={label} badge /> : <Icon name={icon} />}
    </button>
  );
}
const Sep = () => <span className="mt-rail-sep" />;
// P33: 즐겨찾기 호출자 하나. Shift+누르기는 그 호출자를 채운 새 세션 창.
// P97: 누르면 바로 띄우지 않고 단추 옆에 세션 이름 칸(QuickName.jsx)을 연다. 다시 누르면 닫는다
// 아이콘은 하네스 로고(고른 아이콘이 먼저), 셸은 터미널, 직접 명령은 터미널 위에 이름 첫 글자. 마우스를 올리면 이름과 명령 미리보기
function LauncherTool({ l, open, onOpen }) {
  const t = useT();
  const kind = launcherIcon(l);
  const tip = launcherTooltip(l, { shellText: t('launchers.shellPreview'), envText: t('launchers.envShort') });
  const go = (e) => (e && e.shiftKey ? openDialog({ kind: 'spawn', launcher: l.id }) : onOpen(open ? null : { id: l.id, el: e.currentTarget }));
  return (
    <button className={`mt-tool${open ? ' on' : ''}`} title={tip} aria-label={l.name} aria-haspopup="dialog" aria-expanded={open} data-action="launch" data-launcher={l.id} data-name={l.name} onClick={go}>
      {kind === 'shell' ? <Icon name="terminal" /> : kind ? <KindIcon kind={kind} title={tip} badge /> : <span className="mt-tool-mark" data-role="launcher-mark">{launcherMark(l)}</span>}
    </button>
  );
}
// 즐겨찾기가 많으면 이 칸만 위아래로 넘긴다(레일은 창 높이를 넘지 않는다). P97: 끝의 +는 설정 › 런처 › 새 런처(명령줄 붙여 넣기 칸에 초점)
function Favorites() {
  const t = useT();
  const data = useStore((st) => st.launchers);
  const favs = favoriteLaunchers(data);
  const [open, setOpen] = useState(null); // { id, el }: 이름 칸을 연 단추
  const cur = open && favs.find((l) => l.id === open.id);
  return (
    <div className="mt-rail-favs" data-role="rail-favorites">
      {favs.map((l) => <LauncherTool key={l.id} l={l} open={!!cur && cur.id === l.id} onOpen={setOpen} />)}
      <button className="mt-tool add" title={t('quickName.addLauncher')} aria-label={t('quickName.addLauncher')} data-action="launcher-add" onClick={() => openDialog({ kind: 'settings', tab: 'launchers', newLauncher: true })}><Icon name="plus" /></button>
      {cur && <QuickName launcher={cur} anchor={open.el} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function LeftRail({ linking, setLinking }) {
  const t = useT();
  const spot = useStore((st) => st.spotlight);
  return (
    <div className="mt-rail left" data-role="rail-left">
      <Tool icon="pointer" on={!linking} label={t('rail.select')} action="tool-select" onClick={() => { setLinking(false); getState().clearSelection && getState().clearSelection(); }} />
      {/* 손으로 잇기는 선택과 서로 바뀌는 모드라 바로 아래에 둔다 */}
      <Tool icon="link" on={linking} label={t('rail.link')} action="link-mode" onClick={() => setLinking(!linking)} />
      <Sep />
      <Favorites />
      <Sep />
      <Tool icon="note" label={t('rail.memo')} action="memo-new" onClick={() => createItem('memo')} />
      <Tool icon="kanban" label={t('rail.kanban')} action="kanban-new" onClick={() => createItem('kanban')} />
      <Sep />
      <Tool icon="expand" label={t('spaceFit.rail')} action="fit-all" onClick={() => getState().fitAll && getState().fitAll(250)} />
      {/* P85: 멀리 보기에서 일함·내 차례·오류 밖의 노드를 더 물린다. 이 창 프로필에 남는다(단축키 없음) */}
      <Tool icon="spot" on={spot} pressed={spot} label={t(spot ? 'spotlight.off' : 'spotlight.on')} action="spotlight" onClick={() => setSpotlight(!spot)} />
    </div>
  );
}

export function RightRail({ loopsOpen, setLoopsOpen }) {
  const t = useT();
  const sideOpen = useSide((st) => st.open);
  const mission = useStore((st) => st.missionOpen);
  return (
    <div className="mt-rail right" data-role="rail-right">
      <Tool icon="folder" on={sideOpen} label={t('rail.sidebar')} action="sidebar-rail" onClick={toggleSidebar} />
      <Tool icon="flower" on={mission} label={t('rail.mission')} action="mission-rail" onClick={() => setMissionOpen(!mission)} />
      <Tool icon="repeat" on={loopsOpen} label={t('rail.loops')} action="loops-open" onClick={() => setLoopsOpen(!loopsOpen)} />
      <Sep />
      <Tool icon="archive" label={t('rail.archive')} action="archive-open" onClick={openArchiveBox} />
      <Sep />
      <Tool icon="gear" label={t('rail.settings')} action="settings-rail" onClick={() => openDialog({ kind: 'settings' })} />
    </div>
  );
}

// 오른쪽 레일의 루프 목록(모든 루프). 만들기는 노드 ⋯ 메뉴에서 한다
export function LoopsPanel({ onClose }) {
  const t = useT();
  const loops = useStore((st) => st.loops);
  const now = useNow();
  const list = [...loops.values()];
  const box = useDialog(onClose, { modal: false }); // P52: 떠 있는 창. Esc로 닫는다
  if (!list.length) return <div ref={box} className="mt-loops-panel"><div className="mt-loop-list" data-role="loop-list"><div className="mt-card-head"><span className="mt-card-title">{t('loops.title')}</span><button className="mt-card-min" onClick={onClose}><Icon name="x" /></button></div><div className="dim">{t('loops.panelEmpty')}</div></div></div>;
  return <div ref={box} className="mt-loops-panel"><LoopList loops={list} now={now} onClose={onClose} /></div>;
}

// ---------- 아래 ----------
// 빠른 동작 칩. 칩마다 테두리 색이 다르다(tokens.css --chip-ring-n)
export function ChipRow() {
  const t = useT();
  const boardArranged = useStore((st) => st.arranged.has(BOARD_ARRANGED));
  const shown = useStore((st) => st.bottomShown); // P43: 명령 바와 함께 숨고 나타난다(CommandBar.jsx useAutoHide)
  const chips = [
    [t('chips.spawn'), 'chip-spawn', t('chips.spawnTitle'), () => openDialog({ kind: 'spawn' })],
    // P31: 칩의 정리는 판 전체(영역도 다시 놓는다). 영역 이름표의 정리는 그 영역 안만
    [t('chips.arrange'), 'chip-arrange', t('arrangeAll.title'), () => arrangeBoard()],
    ...(boardArranged ? [[t('arrangeAll.undo'), 'chip-arrange-undo', t('arrangeAll.undoTitle'), () => arrangeBoard(true)]] : []),
    [t('chips.mission'), 'chip-mission', t('chips.missionTitle'), () => setMissionOpen(true)],
    [t('chips.changes'), 'chip-changes', t('chips.changesTitle'), () => getState().showChanges && getState().showChanges(60)],
    [t('chips.fit'), 'chip-fit', t('spaceFit.chip'), () => getState().fitAll && getState().fitAll(250)],
  ];
  return (
    <div className="mt-chips" data-role="chips" data-hidden={shown ? undefined : '1'}>
      {chips.map(([label, action, title, fn], i) => <button key={action} className="mt-qchip" style={{ '--chip-ring': `var(--chip-ring-${(i % 7) + 1})` }} data-action={action} title={title} onClick={fn}>{label}</button>)}
    </div>
  );
}

export function ZoomPill() {
  const t = useT();
  const vp = useStore((st) => st.vpNow);
  const z = vp ? vp.zoom : 1;
  const by = (f) => getState().zoomBy && getState().zoomBy(f);
  return (
    <div className="mt-cp zoom" data-role="zoom">
      <button title={t('zoom.out')} data-action="zoom-out" onClick={() => by(1 / 1.25)}><Icon name="minus" /></button>
      <button className="mt-zoom-n mono" title={t('spaceFit.zoom')} data-action="zoom-fit" onClick={() => getState().fitAll && getState().fitAll(250)}>{Math.round(z * 100)}%</button>
      <button title={t('zoom.in')} data-action="zoom-in" onClick={() => by(1.25)}><Icon name="plus" /></button>
    </div>
  );
}
