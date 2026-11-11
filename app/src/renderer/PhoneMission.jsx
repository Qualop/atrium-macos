// P87·P89 → P95: 휴대폰 미션 맵(작업 관계도). 세션 목록 머리줄의 단추로 연다. 누가 누구의 무슨 역할인지, 무엇이 일하는지를 PC 미션 맵과 같은 시각 언어로 보인다.
// - 자료는 mission.graph만 받는다(이름, 역할, 상태, 부모·하위, 연결, 모델·노력 수준·시간). 대화(session.messages)와 터미널은 받지 않는다. 상태는 판의 세션 요약(이미 받은 것)으로 덧입힌다
// - 나무와 등급은 lib/phone-mission.js, 놓기와 보기(맞추기·범위)는 lib/phone-graph.js(P95): 화면 폭을 칸으로 나눠 팀은 두 칸(리드 → 하위, 왼쪽 → 오른쪽),
//   혼자인 워크스페이스는 한 칸 기둥으로 채운다(세로 한 줄로 늘어서지 않는다). 상자·띠·범례 없이 워크스페이스는 옅은 머리 글(누르면 접기)
// - 카드는 이름(팀 번호), 역할과 지금 하는 일, 옅은 메타(모델·시간·브랜치), 오른쪽 끝에 종류 동그라미와 상태 배지. 쉬는·잠든·끝난 세션은 한 줄, 하위가 많으면 동그라미 줄
// - 위쪽 요약 칩(작업 중·응답 필요)을 누르면 그 등급만 또렷하게 하고 그 카드들로 맞춘다. 다시 누르면 푼다(자리는 그대로, 다시 받지 않는다)
// - 한 손가락으로 옮기고 두 손가락으로 확대·축소(lib/touch-board.js의 셈). 페이지는 늘어나거나 튀지 않는다(touch-action: none, gesture 막음).
//   처음과 "맞추기"는 폭에 맞추고 위에 붙인다. 카드를 누르면 세션 화면(Phone.jsx PhoneSession), 돌아오면 같은 자리·배율(화면 크기가 같을 때, 모듈에 둔다)
// - 가볍게(iPhone Safari): 그래프는 DOM 카드와 SVG 한 장, 옮길 때는 한 요소의 transform만 바꾼다. filter·backdrop-filter·will-change 없음
// - P101 다듬기: 워크스페이스마다 옅은 판, 쉬는·잠든 세션은 테두리 있는 알약, 종류 동그라미는 카드 안. 서로 이은 두 세션은 짧은 두 줄과 화살촉(lib/phone-graph.js).
// - P107: 일하는 카드는 PC처럼 테두리를 따라 상태 색 빛이 돈다(Mission.jsx MissionLight, .mt-mm-light). 판 설정 workLight를 따르고(끔이면 멈춘 굵은 테두리),
//   휴대폰은 가볍게(P89) steps(36)으로 초당 15번만 바뀐다(phone.css P107 덩어리, WebKit에서 잰 값은 작업 기록). 모든 카드가 같은 박자(lib/work-light.js).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, wsName } from './store.js';
import { useT, errText } from './lib/i18n.js';
import { STATE_LABEL } from './lib/labels.js';
import { phoneMission, PM_FOLD_KEY } from './lib/phone-mission.js';
import { phoneGraph, VIEW, fitView, clampView, zoomRange, focusView, inFocus, vpKey, branchOf } from './lib/phone-graph.js';
import { roleText, teamText, modelText, ageText } from './lib/mission-model.js';
import { kindOf, shownKind, logoFor } from './lib/kinds.js';
import { TOUCH_SLOP_PX, pinchViewport, panViewport, mid, dist } from './lib/touch-board.js';
import { MissionLight } from './Mission.jsx'; // P107: 테두리를 따라 도는 빛 층(PC와 같다)

const REFRESH_MS = 600; // 판이 바뀌면 이만큼 모았다가 다시 받는다
let cache = null; // 마지막 mission.graph
let viewAt = null; // 마지막 보기 { key: 화면 크기, v: { x, y, zoom } }
const store = () => { try { return localStorage; } catch { return null; } };
const readFolded = () => { try { return JSON.parse(store().getItem(PM_FOLD_KEY) || '[]'); } catch { return []; } };
const Chev = ({ dir = 'right' }) => <svg className="mt-ph-chev" viewBox="0 0 24 24" aria-hidden="true"><path d={dir === 'left' ? 'm15 18-6-6 6-6' : dir === 'down' ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6'} /></svg>;
const clip = (s, n) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

function stateText(r, live) {
  const s = live || { state: r.state, kind: r.agentKind };
  if (s.kind === 'shell' && s.state !== 'exited' && s.state !== 'sleeping') return s.shell && s.shell.atPrompt === false ? STATE_LABEL.shell_running : STATE_LABEL.shell_idle;
  return STATE_LABEL[s.state] || s.state || '';
}

// 종류 동그라미와 상태 배지(PC와 같다: 일함 점, 응답 필요 !, 오류 ✕, 결과 ✓, 쉼은 점선 고리)
function Avatar({ live, r }) {
  const k = kindOf(shownKind(live || { kind: r.agentKind }));
  const src = logoFor(k, r.state);
  const b = r.tier === 'work' ? (k.id === 'shell' ? 'shell' : 'work') : ['turn', 'alert', 'review'].includes(r.tier) ? r.tier : null;
  const ring = ['rest', 'sleep', 'done'].includes(r.tier);
  return (
    <span className={`mt-pm-av${ring ? ' ring' : ''}`} data-badge={b || undefined}>
      {src ? <img src={src} alt={k.label} width="11" height="11" decoding="async" draggable="false" /> : <span className="mark" style={{ color: k.color }}>{k.mark}</span>}
      {b && <i className={`mt-pm-badge b-${b}`} aria-hidden="true">{b === 'turn' ? '!' : b === 'alert' ? '✕' : b === 'review' ? '✓' : ''}</i>}
    </span>
  );
}

function Node({ n, live, dim, no, t, now }) {
  const r = n.row;
  const shell = (live && live.kind === 'shell') || r.agentKind === 'shell';
  const common = { 'data-role': 'pm-node', 'data-id': n.id, 'data-session': r.sessionId, 'data-name': r.name, 'data-tier': r.tier, 'data-depth': r.depth, 'data-rank': r.rank, 'data-family': r.family, 'data-shape': n.kind, style: { left: n.x, top: n.y, width: n.w, height: n.h } };
  const cls = `t-${r.tier} r-${r.rank || 'solo'}${shell ? ' shell' : ''}${dim ? ' dim' : ''}`;
  if (n.kind === 'dot') return <button type="button" className={`mt-pm-dot ${cls}`} aria-label={r.name} {...common}><Avatar live={live} r={r} /></button>;
  const role = r.rank !== 'solo' ? roleText(r, t, { short: true }) : null;
  if (n.kind === 'row') return (
    <button type="button" className={`mt-pm-row ${cls}`} {...common}>
      <span className="o" aria-hidden="true" /><span className="nm">{r.name}</span>{role && <span className="rl" data-role="pm-role">{role}</span>}
      <Avatar live={live} r={r} />
    </button>
  );
  const team = r.team ? teamText(r, t) : null;
  const cmd = live && live.shell && live.shell.atPrompt === false ? live.shell.command : null;
  const doing = cmd ? `$ ${cmd}` : r.tier === 'work' && r.lastPrompt ? clip(r.lastPrompt, 60) : null;
  const line = (r.tier === 'turn' || r.tier === 'alert') && r.ask ? { k: 'ask', main: null, text: r.ask }
    : team ? { k: 'team', main: role, text: [t('mmRole.team', { n: r.team.size }), r.waiting && r.tier !== 'turn' ? t('mmRole.waiting', { n: r.waiting }) : r.team.work ? t('mmRole.teamWork', { n: r.team.work }) : null].filter(Boolean).join(' · ') }
    : { k: doing ? 'now' : 'state', main: role, text: doing || stateText(r, live) };
  const age = r.tier === 'work' && r.turnAt ? ageText(now - r.turnAt, t) : r.activeAt ? ageText(now - r.activeAt, t) : null;
  const branch = r.gitBranch || branchOf(live);
  const meta = [shell ? null : modelText(r.model, r.effort), age, branch ? `⎇ ${branch}` : null, n.cross ? t('mmMap.crossWs', { ws: r.workspaceKey ? wsName(r.workspaceKey) : t('phone.noRepo') }) : null].filter(Boolean).join(' · ');
  return (
    <button type="button" className={`mt-pm-node ${cls}${r.team ? ' lead' : ''}`} {...common}>
      {r.tier === 'work' && <MissionLight role="pm-light" />}
      <span className="mt-pm-top">{no ? <span className="mt-pm-no" data-role="pm-team-no">{no}</span> : null}<b className="mt-pm-name">{r.name}</b></span>
      <span className={`mt-pm-sub ${line.k}`} data-role={`pm-${line.k}`}>{line.main ? <b data-role="pm-role">{line.main}</b> : null}{line.main && line.text ? ' · ' : null}{line.text}</span>
      <span className="mt-pm-meta" data-role="pm-meta">{meta || (shell ? t('mmMap.noModel') : '')}</span>
      <Avatar live={live} r={r} />
    </button>
  );
}

export function PhoneMission({ onBack, onOpen, conn }) {
  const t = useT();
  const sessions = useStore((st) => st.sessions);
  const links = useStore((st) => st.links);
  const thread = useStore((st) => st.thread);
  const loops = useStore((st) => st.loops);
  const workspaces = useStore((st) => st.workspaces);
  const vgroups = useStore((st) => st.groups); // P44 가상 그룹
  const [graph, setGraph] = useState(cache);
  const [fail, setFail] = useState(null);
  const [folded, setFolded] = useState(readFolded);
  const [focus, setFocus] = useState(null); // 'work' | 'turn' | null
  const [vp, setVp] = useState(null); // 그래프 칸 크기 { w, h }
  const stageRef = useRef(null), worldRef = useRef(null);
  const view = useRef(null); // { x, y, zoom }
  const moved = useRef(false); // 옮기거나 확대한 손가락 뒤의 click은 열지 않는다
  const sizeRef = useRef(null), keyRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => api.call('mission.graph').then((g) => { cache = g; if (alive) { setGraph(g); setFail(null); } }).catch((e) => { if (alive) setFail(e); }), graph ? REFRESH_MS : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [sessions, links, thread, loops]); // eslint-disable-line react-hooks/exhaustive-deps
  // 그래프 칸 크기(세로·가로 돌리기)
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const read = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setVp((v) => (v && Math.round(v.w) === Math.round(r.width) && Math.round(v.h) === Math.round(r.height) ? v : { w: r.width, h: r.height })); };
    read();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', read);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', read); };
  }, []);

  const order = useMemo(() => (workspaces || []).map((w) => w.key), [workspaces]);
  const lay = useMemo(() => (graph ? phoneMission(graph, { live: sessions, order, folded, vgroups }) : null), [graph, sessions, order, folded, vgroups]);
  const gw = vp ? Math.max(300, Math.round(vp.w - 2 * VIEW.PAD)) : 373; // 그래프 폭: 화면 폭에 맞춰 배율 1에서 읽힌다
  const pg = useMemo(() => (lay ? phoneGraph(lay, { width: gw }) : null), [lay, gw]);
  sizeRef.current = pg && vp ? { size: pg, vp } : null;
  const tierOfId = useMemo(() => new Map(pg ? pg.nodes.map((n) => [n.id, n.row.tier]) : []), [pg]);
  const teamNo = useMemo(() => { const m = new Map(); let i = 0; for (const n of pg ? pg.nodes : []) if (n.row.team && n.row.rank === 'lead') m.set(n.id, ++i); return m; }, [pg]);

  // 보기를 바꾼다: 한 요소의 transform만(다시 그리지 않는다). 모듈에 남겨 돌아오면 같은 자리
  const apply = (v) => {
    const s = sizeRef.current;
    const c = s ? clampView(v, s.size, s.vp) : v;
    view.current = { x: c.x, y: c.y, zoom: c.zoom };
    if (keyRef.current) viewAt = { key: keyRef.current, v: view.current };
    const w = worldRef.current;
    if (w) w.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`;
  };
  const fit = () => { const s = sizeRef.current; if (s) apply(fitView(s.size, s.vp)); };
  // 처음(또는 화면 크기가 바뀌면) 맞추고, 돌아오면 마지막 보기. 그래프가 바뀌어도 보기는 그대로(범위만 다시)
  useLayoutEffect(() => {
    if (!pg || !vp) return;
    const key = vpKey(vp);
    if (keyRef.current !== key || !view.current) {
      keyRef.current = key;
      apply(viewAt && viewAt.key === key ? viewAt.v : fitView(pg, vp));
    } else apply(view.current);
  }, [pg, vp]); // eslint-disable-line react-hooks/exhaustive-deps

  // 손가락: 한 손가락 옮기기, 두 손가락 확대·축소. 페이지 확대(Safari gesture)는 막는다
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    let g = null;
    const pts = (tl) => [...tl].map((x) => { const r = el.getBoundingClientRect(); return { id: x.identifier, x: x.clientX - r.left, y: x.clientY - r.top }; });
    const lim = () => { const s = sizeRef.current; return s ? zoomRange(s.size, s.vp) : { minZoom: 0.25, maxZoom: 2.5 }; };
    const set = apply;
    const begin = (tl) => {
      const p = pts(tl), v0 = { ...view.current };
      if (p.length >= 2) g = { mode: 'pinch', v0, m0: mid(p[0], p[1]), d0: dist(p[0], p[1]) };
      else if (p.length === 1) g = { mode: g && g.mode !== 'pending' ? 'pan' : 'pending', v0, p0: p[0] };
      else g = null;
    };
    const onStart = (e) => { if (e.touches.length === 1) moved.current = false; if (!view.current) return; begin(e.touches); };
    const onMove = (e) => {
      if (e.cancelable) e.preventDefault();
      if (!g || !view.current) return;
      const p = pts(e.touches);
      if (g.mode === 'pinch' && p.length >= 2) { moved.current = true; set(pinchViewport(g.v0, g.m0, g.d0, mid(p[0], p[1]), dist(p[0], p[1]), lim())); return; }
      if (p.length !== 1 || !g.p0) return;
      const dx = p[0].x - g.p0.x, dy = p[0].y - g.p0.y;
      if (g.mode === 'pending' && Math.hypot(dx, dy) > TOUCH_SLOP_PX) g.mode = 'pan';
      if (g.mode === 'pan') { moved.current = true; set(panViewport(g.v0, dx, dy)); }
    };
    const onEnd = (e) => { if (!view.current) return; if (e.touches.length) begin(e.touches); else g = null; }; // 두 손가락에서 하나를 떼면 남은 손가락으로 이어 옮긴다
    const noGesture = (e) => e.preventDefault();
    const cap = { passive: false };
    el.addEventListener('touchstart', onStart, cap); el.addEventListener('touchmove', onMove, cap); el.addEventListener('touchend', onEnd, cap); el.addEventListener('touchcancel', onEnd, cap);
    el.addEventListener('gesturestart', noGesture, cap); el.addEventListener('gesturechange', noGesture, cap);
    return () => {
      el.removeEventListener('touchstart', onStart, cap); el.removeEventListener('touchmove', onMove, cap); el.removeEventListener('touchend', onEnd, cap); el.removeEventListener('touchcancel', onEnd, cap);
      el.removeEventListener('gesturestart', noGesture, cap); el.removeEventListener('gesturechange', noGesture, cap);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  window.__mtPm = { view: () => (view.current ? { x: view.current.x, y: view.current.y, zoom: view.current.zoom } : null), fit }; // 시험이 읽는다

  const toggle = (key) => setFolded((f) => { const k = key || '-'; const n = f.includes(k) ? f.filter((x) => x !== k) : [...f, k]; try { store().setItem(PM_FOLD_KEY, JSON.stringify(n)); } catch {} return n; });
  const pick = (tier) => {
    const next = focus === tier ? null : tier;
    setFocus(next);
    const s = sizeRef.current;
    if (next && s) { const v = focusView(s.size.nodes.filter((n) => inFocus(next, n.row.tier)), s.vp); if (v) apply(v); }
  };
  const onClick = (e) => {
    if (moved.current) return;
    const b = e.target.closest('[data-role=pm-node], [data-action=pm-fold]');
    if (!b) return;
    if (b.dataset.action === 'pm-fold') toggle(b.dataset.ws || null);
    else if (b.dataset.session) onOpen(b.dataset.session);
  };
  const c = lay ? lay.counts : null;
  const now = Date.now();
  return (
    <div className="mt-ph-list mt-pm" data-role="phone-mission">
      <header className="mt-ph-head">
        <button type="button" className="mt-pm-back" data-action="phone-mission-back" aria-label={t('phoneMission.back')} onClick={onBack}><Chev dir="left" /><span>{t('phone.list')}</span></button>
        <b className="mt-pm-title">{t('phoneMission.title')}</b>
        {conn}
      </header>
      {c && (
        <div className="mt-pm-sum" data-role="pm-sum">
          <button type="button" className={`mt-pm-chip t-turn${focus === 'turn' ? ' on' : ''}`} data-n={c.turn} data-action="pm-focus-turn" aria-pressed={focus === 'turn'} disabled={!c.turn && focus !== 'turn'} title={t('phoneMission.focus')} onClick={() => pick('turn')}><i />{t('phoneMission.needs', { n: c.turn })}</button>
          <button type="button" className={`mt-pm-chip t-work${focus === 'work' ? ' on' : ''}`} data-n={c.work} data-action="pm-focus-work" aria-pressed={focus === 'work'} disabled={!c.work && focus !== 'work'} title={t('phoneMission.focus')} onClick={() => pick('work')}><i />{t('phoneMission.working', { n: c.work })}</button>
          <span className="mt-pm-chip">{t('phoneMission.all', { n: c.all })}</span>
        </div>
      )}
      <div className={`mt-pm-stage${focus ? ' focusing' : ''}`} data-role="pm-stage" ref={stageRef} onClick={onClick}>
        {!lay && !fail && <div className="mt-ph-empty">{t('common.loading')}</div>}
        {!lay && fail && <div className="mt-ph-empty" data-role="pm-fail">{t('mission.fail', { error: errText(fail) })}</div>}
        {lay && lay.groups.length === 0 && <div className="mt-ph-empty" data-role="pm-empty">{t('phone.empty')}</div>}
        {pg && pg.nodes.length + pg.groups.length > 0 && (
          <div className="mt-pm-world" data-role="pm-world" ref={worldRef} style={{ width: pg.width, height: pg.height, transform: view.current ? `translate(${view.current.x}px, ${view.current.y}px) scale(${view.current.zoom})` : 'scale(0)' }}>
            {pg.groups.map((g) => <div key={`p:${g.key || '-'}`} className={`mt-pm-plate${g.folded ? ' folded' : ''}`} data-role="pm-plate" style={{ left: g.plate.x, top: g.plate.y, width: g.plate.w, height: g.plate.h }} />)}
            {pg.groups.map((g) => (
              <button key={g.key || '-'} type="button" className={`mt-pm-ws${g.folded ? ' folded' : ''}`} data-role="pm-group" data-action="pm-fold" data-ws={g.key || ''} aria-expanded={!g.folded} style={{ left: g.x, top: g.y, maxWidth: g.w }}>
                {g.folded && <Chev dir="right" />}
                {g.vg && <span className="vg" data-role="pm-vgroup">{g.vg.name} /</span>}
                <span className="mt-pm-gname">{g.key ? wsName(g.key) : t('phone.noRepo')}</span>
                <span className="n">{g.count}</span>
                {g.turn > 0 && <span className="needs" title={t('phoneMission.needs', { n: g.turn })}>!{g.turn}</span>}
              </button>
            ))}
            <svg className="mt-pm-edges" width={pg.width} height={pg.height} viewBox={`0 0 ${pg.width} ${pg.height}`} aria-hidden="true">
              {pg.edges.map((e) => {
                const dim = focus && !(inFocus(focus, e.tier) || inFocus(focus, tierOfId.get(e.from)));
                const cls = `${e.kind} rel-${e.rel || 'spawn'} t-${e.tier}${e.pair ? ' pair' : ''}${e.active ? ' active' : ''}${dim ? ' dim' : ''}`;
                return [<path key={e.id} className={`mt-pm-edge ${cls}`} data-role="pm-edge" data-kind={e.kind} data-rel={e.rel} data-route={e.route} data-pair={e.pair ? '1' : undefined} data-from={e.from} data-to={e.to} d={e.d} />,
                  e.tip ? <path key={`tip:${e.id}`} className={`mt-pm-tip ${cls}`} data-role="pm-tip" d={e.tip} /> : null];
              })}
            </svg>
            {pg.dots.map((d) => <span key={d.id} className="mt-pm-dots-label" style={{ left: d.x + 2 + Math.min(d.per, d.n) * 22, top: d.y + 2 }}>{t('mmMap.dotsRest', { n: d.n })}</span>)}
            {pg.nodes.map((n) => <Node key={n.id} n={n} t={t} now={now} no={teamNo.get(n.id)} live={n.row.sessionId ? sessions.get(n.row.sessionId) : null} dim={!!focus && !inFocus(focus, n.row.tier)} />)}
          </div>
        )}
        {pg && pg.nodes.length > 0 && (
          <div className="mt-pm-tools">
            <span />
            <button type="button" className="mt-pm-fit" data-action="pm-fit" aria-label={t('phoneMission.fit')} onClick={(e) => { e.stopPropagation(); fit(); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg><span>{t('phoneMission.fitShort')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
