// P166: 휴대폰 세션 맵 = PC 세션 맵(MissionLineage.jsx)과 같은 무한 캔버스. P160 세로 목록(PhoneLineage.jsx)을 갈음한다.
// - 배치: PC와 같은 lib/mission-lineage.js lineageLayout에 phone: true(세로 화면 배치: 폴더·워크스페이스 이름은 띠 위 머리, 솔로는 나무 아래 격자, 좁은 카드·단계 간격,
//   보이는 칸 비율에 더 크게 들면 단 나눔). 카드·선·관계 판정·깊이 접기·얇은 줄(P163)·작업 완료 꼬리표는 PC 카드(Card)와 선을 그대로 쓴다.
// - 손가락(lib/phone-map.js touchIntent): 한 손가락 끌기 = 시점 이동, 두 손가락 = 확대·축소, 카드 누르기 = 그 세션 화면(Phone.jsx PhoneSession),
//   길게 누르기 = 미리 보기(PC Peek과 같은 내용, 아래 판). Alt 끌기(폴더 옮기기·위계 조정)·명령줄·앱 사이드바는 없다. 브라우저 확대·스크롤은 막는다(touch-action: none).
// - 시점: 처음은 맞춤(전체가 한 화면). 옮기고 확대한 보기는 이 기기에 화면 크기마다 기억해 다시 열면 그대로(맞춤 단추로 되돌림). 위 알약을 누르면 그 카드로 가서 반짝인다.
// - 성능: 보기는 ref, 세계 한 요소의 transform만 바꾼다(PC paint와 같다). 확대 단계 클래스·멀리 타일 글 하한(--ik)은 DOM에 바로, --ik는 멈춘 뒤에.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, wsName } from './store.js';
import { useT, errText } from './lib/i18n.js';
import { lineageLayout, PHONE } from './lib/mission-lineage.js';
import { roleModel, nodeTier } from './lib/mission-model.js';
import { levelOf, zoomAt, ZOOM } from './lib/mission-terr.js';
import { PM, touchIntent, pinchView, phoneFit, goView, openView, saveView, sizeKey } from './lib/phone-map.js';
import { Card, Peek, cardFacts } from './MissionLineage.jsx';

const REFRESH_MS = 600;
const ST = { turn: 'needs', alert: 'error', work: 'working', review: 'done', rest: 'ready', sleep: 'sleeping', done: 'exited' };
const ATTN_MAX = 3; // 위 줄에 이름으로 보이는 기다리는 세션 수
const KINDS = ['spawn', 'role', 'prompt', 'cross'];
const EXP_KEY = 'atrium.phoneMap.expanded';
const DOT_GAP = 92, DOT_MIN_GAP = 28;
const store = () => { try { return localStorage; } catch { return null; } };
const loadExpanded = () => { try { const a = JSON.parse(localStorage.getItem(EXP_KEY) || '[]'); return new Set(Array.isArray(a) ? a.slice(0, 200) : []); } catch { return new Set(); } };
const saveExpanded = (s) => { try { localStorage.setItem(EXP_KEY, JSON.stringify([...s].slice(-200))); } catch { /* 기억 못 해도 지금 화면은 된다 */ } };
let cache = null;
let lastGoId = null; // 마지막으로 알약이 데려간 카드(시험이 읽는다)
const noop = () => {};
const Chev = () => <svg className="mt-ph-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>;
const FolderIcon = () => <svg className="mt-ta-iico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10l2 2.5h6.5A1.5 1.5 0 0 1 20 8v10.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" /></svg>;

export function PhoneMap({ onBack, onOpen, conn }) {
  const t = useT();
  const sessions = useStore((st) => st.sessions);
  const links = useStore((st) => st.links);
  const thread = useStore((st) => st.thread);
  const loops = useStore((st) => st.loops);
  const workspaces = useStore((st) => st.workspaces);
  const vgroups = useStore((st) => st.groups);
  const [graph, setGraph] = useState(cache);
  const [fail, setFail] = useState(null);
  const [reloadN, setReloadN] = useState(0);
  const [expanded, setExpanded] = useState(loadExpanded);
  const [vsize, setVsize] = useState(null);
  const [peek, setPeek] = useState(null); // 길게 누른 카드 id
  const vpRef = useRef(null), worldRef = useRef(null), bgRef = useRef(null), pctRef = useRef(null);
  const view = useRef(null), sizeRef = useRef(null), layRef = useRef(null), opened = useRef(false);
  const moveTimer = useRef(0), glideTimer = useRef(0), saveTimer = useRef(0);
  const quiet = useRef(0); // 끌기·핀치·길게 누르기 뒤 이때까지 오는 click은 무시한다
  const lastGo = useRef({});

  // 그래프 받기: 열 때 바로 한 번, 그 뒤 판이 바뀌면 REFRESH_MS 안에 한 번(바뀜이 잇따라도 미뤄지기만 하지 않게 모아서)
  const fetchT = useRef(0), alive = useRef(true), fetched = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(fetchT.current); fetchT.current = 0; }; }, []);
  useEffect(() => {
    if (fetchT.current) return;
    const run = () => { fetchT.current = 0; fetched.current = true; api.call('mission.graph').then((g) => { cache = g; if (alive.current) { setGraph(g); setFail(null); } }).catch((e) => { if (alive.current) setFail(e); }); };
    fetchT.current = setTimeout(run, fetched.current ? REFRESH_MS : 0);
  }, [sessions, links, thread, loops, reloadN]);
  useEffect(() => api.on('relation.updated', () => setReloadN((n) => n + 1)), []);

  const order = useMemo(() => (workspaces || []).map((w) => w.key), [workspaces]);
  const liveOf = (n) => (n && n.sessionId ? sessions.get(n.sessionId) : null);
  const tiers = useMemo(() => new Map(graph ? graph.nodes.filter((n) => n.kind === 'session').map((n) => [n.id, nodeTier(n, liveOf(n))]) : []), [graph, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => new Map((workspaces || []).map((w) => [w.key, wsName(w.key)])), [workspaces]);
  const vkey = sizeKey(vsize); // 단 나누기는 보이는 칸 비율을 따른다(크기가 조금 바뀌어도 다시 놓지 않게 20px 단위)
  const lay = useMemo(() => (graph && vsize ? lineageLayout(graph, { order, vgroups, tiers, names, noFolder: t('mmTerr.noFolder'), expanded, phone: true, view: vsize }) : null), [graph, order, vgroups, tiers, names, t, expanded, vkey]); // eslint-disable-line react-hooks/exhaustive-deps
  const roles = useMemo(() => (graph && lay ? roleModel(graph, { tiers, tree: lay.tree }) : new Map()), [graph, lay, tiers]);
  const relOfChild = useMemo(() => { const m = new Map(); if (lay) for (const e of lay.edges) if (e.tree) m.set(e.to, e.rel); return m; }, [lay]);
  layRef.current = lay;
  sizeRef.current = vsize;
  const now = Date.now();
  const factsOf = (id) => {
    const b = lay.cards.get(id), n = b.node, m = roles.get(id);
    const pid = m && m.parentId, p = pid ? lay.tree.byId.get(pid) : null;
    const pws = p ? p.workspaceKey || '' : null;
    return cardFacts({ ...n, _rel: relOfChild.get(id) }, liveOf(n), m, tiers.get(id), t, now, { parentName: p ? p.name : null, parentWs: p ? (pws ? wsName(pws) : t('mmapGroup.noWorkspace')) : null, cross: !!p && pws !== (n.workspaceKey || ''), kids: (lay.tree.kids.get(id) || []).length });
  };
  const onFold = useCallback((id) => { quiet.current = Date.now() + 400; setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); saveExpanded(n); return n; }); }, []);

  // ---- 보기 쓰기(DOM에 바로, PC paint와 같다) ----
  const paint = useCallback((v, { glide = false, save = true } = {}) => {
    view.current = v;
    const w = worldRef.current, vp = vpRef.current;
    const lv = levelOf(v.k);
    if (w) {
      if (glide) { w.classList.add('glide'); clearTimeout(glideTimer.current); glideTimer.current = setTimeout(() => w.classList.remove('glide'), 480); } else w.classList.remove('glide');
      w.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
      if (!w.classList.contains(`lv-${lv}`)) { w.classList.remove('lv-far', 'lv-mid', 'lv-near'); w.classList.add(`lv-${lv}`); }
    }
    const bg = bgRef.current;
    if (bg) { let gs = DOT_GAP * v.k; while (gs < DOT_MIN_GAP) gs *= 2; bg.style.backgroundSize = `${gs}px ${gs}px`; bg.style.backgroundPosition = `${v.x % gs - gs / 2}px ${v.y % gs - gs / 2}px`; }
    if (pctRef.current) pctRef.current.textContent = `${Math.round(v.k * 100)}%`;
    const setIk = () => { const ww = worldRef.current, kk = view.current && view.current.k; if (!ww || !kk || levelOf(kk) !== 'far') return; const ik = (1 / kk).toFixed(3); if (ww.style.getPropertyValue('--ik') !== ik) ww.style.setProperty('--ik', ik); };
    if (w && lv === 'far' && (glide || !w.style.getPropertyValue('--ik'))) setIk();
    if (vp && !glide) { if (vp.dataset.moving !== '1') vp.dataset.moving = '1'; clearTimeout(moveTimer.current); moveTimer.current = setTimeout(() => { delete vp.dataset.moving; setIk(); }, 160); }
    // 이 기기에 기억(조금 모았다가)
    if (save) { clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => saveView(store(), sizeRef.current, view.current), PM.SAVE_MS); }
  }, []);
  const fit = useCallback((glide = true) => { const L = layRef.current, s = sizeRef.current; if (L && s) paint(phoneFit(L.bounds, s.w, s.h), { glide }); }, [paint]);
  const zoomBy = useCallback((f) => { const s = sizeRef.current, v = view.current; if (s && v) paint(zoomAt(v, s.w / 2, s.h / 2, v.k * f), { glide: true }); }, [paint]);

  // 보이는 칸 크기(세로·가로 돌리기)
  useLayoutEffect(() => {
    const el = vpRef.current;
    if (!el) return undefined;
    const read = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setVsize((v) => (v && v.w === Math.round(r.width) && v.h === Math.round(r.height) ? v : { w: Math.round(r.width), h: Math.round(r.height) })); };
    read();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', read);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', read); };
  }, []);
  // 처음(또는 화면 크기가 바뀌면): 이 크기에서 기억한 보기, 없으면 맞춤. 그래프가 바뀌어도 보기는 그대로
  const openedKey = useRef('');
  useLayoutEffect(() => {
    if (!lay || !vsize) return;
    if (!opened.current || openedKey.current !== vkey) { opened.current = true; openedKey.current = vkey; paint(openView(store(), vsize, lay.bounds), { save: false }); }
    else if (view.current) paint(view.current, { save: false });
  }, [lay, vkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 알약: 그 카드로 가서 반짝인다 ----
  const goTo = useCallback((id) => {
    const L = layRef.current, s = sizeRef.current, b = L && L.cards.get(id);
    if (!b || !s) return false;
    lastGoId = id;
    paint(goView(b, view.current, s.w, s.h), { glide: true });
    const el = vpRef.current && vpRef.current.querySelector(`.mt-ta-slot[data-id="${CSS.escape(id)}"]`);
    if (el) { el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); setTimeout(() => el.classList.remove('blink'), 2200); }
    return true;
  }, [paint]);
  const goNext = (key, want) => {
    const list = (lay ? lay.order : []).filter((id) => want.includes(tiers.get(id)));
    if (!list.length) return;
    const i = list.indexOf(lastGo.current[key]);
    const id = list[(i + 1) % list.length];
    lastGo.current[key] = id; goTo(id);
  };

  // ---- 손가락: 끌기·두 손가락·누르기·길게 누르기(포인터 이벤트, 마우스도 같다) ----
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return undefined;
    const pts = new Map();
    let g = null; // { mode: 'press'|'pan'|'pinch', v0, p0, m0, d0, at, card, timer, n }
    const local = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const stopLong = () => { if (g && g.timer) { clearTimeout(g.timer); g.timer = 0; } };
    const begin = (card) => {
      const v = view.current, p = [...pts.values()];
      stopLong();
      if (!v || !p.length) { g = null; return; }
      if (p.length >= 2) { g = { mode: 'pinch', v0: v, m0: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, n: 2 }; return; }
      // 두 손가락에서 하나를 떼면 남은 손가락으로 이어 옮긴다(누르기·길게 누르기는 아니다)
      const cont = g && (g.mode === 'pinch' || g.mode === 'pan');
      g = { mode: cont ? 'pan' : 'press', v0: v, p0: p[0], at: Date.now(), card: cont ? null : card, n: 1, timer: 0 };
      if (!cont && card) {
        g.timer = setTimeout(() => {
          if (!g || g.mode !== 'press' || touchIntent({ n: 1, dt: Date.now() - g.at }) !== 'long') return;
          g.mode = 'long'; quiet.current = Date.now() + 10000; setPeek(card);
        }, PM.LONG_MS);
      }
    };
    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.mt-pmap-dock')) return;
      const fold = e.target.closest('.mt-sm-fold');
      pts.set(e.pointerId, local(e));
      const card = !fold && pts.size === 1 ? e.target.closest('.mt-ta-card') : null;
      begin(card ? card.dataset.id : null);
    };
    const move = (e) => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, local(e));
      const p = [...pts.values()];
      if (g.mode === 'pinch' && p.length >= 2) {
        const m = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
        quiet.current = Date.now() + 500;
        paint(pinchView(g.v0, g.m0, g.d0, m, d));
        return;
      }
      if (p.length !== 1 || !g.p0 || g.mode === 'long') return;
      const dx = p[0].x - g.p0.x, dy = p[0].y - g.p0.y;
      if (g.mode === 'press' && touchIntent({ n: 1, dx, dy }) === 'pan') { stopLong(); g.mode = 'pan'; el.classList.add('dragging'); try { el.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ } }
      if (g.mode === 'pan') { quiet.current = Date.now() + 400; paint({ k: g.v0.k, x: g.v0.x + dx, y: g.v0.y + dy }); }
    };
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size) { begin(null); return; }
      stopLong();
      if (g && g.mode === 'long') quiet.current = Date.now() + 700; // 손을 떼며 오는 click이 열지 않게
      g = null; el.classList.remove('dragging');
    };
    // 카드 누르기(click). 끌기·핀치·길게 누르기 뒤의 click은 무시한다
    const click = (e) => {
      if (Date.now() < quiet.current) { e.stopPropagation(); e.preventDefault(); return; }
      const fold = e.target.closest('.mt-sm-fold');
      if (fold) return; // 접기 칩은 Card가 받는다
      const card = e.target.closest('.mt-ta-card');
      if (!card) return;
      e.stopPropagation();
      const L = layRef.current, b = L && L.cards.get(card.dataset.id);
      if (b && b.node.sessionId) onOpen(b.node.sessionId);
    };
    const ctx = (e) => { e.preventDefault(); const c = e.target.closest('.mt-ta-card'); if (c && e.pointerType !== 'touch' && !(g && g.mode === 'long')) setPeek(c.dataset.id); }; // 마우스 오른쪽 = 미리 보기, 손가락 길게 누르기는 타이머가 연다
    const wheel = (e) => { e.preventDefault(); const v = view.current; if (!v) return; const p = local(e); paint(zoomAt(v, p.x, p.y, v.k * Math.exp(-e.deltaY * ZOOM.wheel))); };
    const noGesture = (e) => e.preventDefault(); // iOS Safari 페이지 확대
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    el.addEventListener('contextmenu', ctx);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', noGesture, { passive: false }); el.addEventListener('gesturechange', noGesture, { passive: false });
    return () => {
      stopLong();
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true); el.removeEventListener('contextmenu', ctx); el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', noGesture); el.removeEventListener('gesturechange', noGesture);
    };
  }, [paint, onOpen]);
  useEffect(() => () => { clearTimeout(saveTimer.current); if (view.current && sizeRef.current) saveView(store(), sizeRef.current, view.current); }, []); // 떠날 때 마지막 보기를 남긴다
  window.__mtPm = { style: 'canvas', fitView: () => { const L = layRef.current, s = sizeRef.current; return L && s ? phoneFit(L.bounds, s.w, s.h) : null; }, lay: () => layRef.current, view: () => (view.current ? { ...view.current } : null), set: (v) => paint(v), fit: () => fit(false), goTo, last: () => lastGoId, peek: (id) => setPeek(id), size: () => sizeRef.current }; // 시험이 읽는다

  const ids = lay ? lay.order : [];
  const attn = ids.filter((id) => tiers.get(id) === 'turn' || tiers.get(id) === 'alert').sort((a, b) => (tiers.get(a) === 'turn' ? 0 : 1) - (tiers.get(b) === 'turn' ? 0 : 1));
  const nWork = ids.filter((id) => tiers.get(id) === 'work').length, nDone = ids.filter((id) => tiers.get(id) === 'review').length;
  const leads = lay ? new Set([...lay.cards.entries()].filter(([id, b]) => b.depth >= 0 && (lay.tree.kids.get(id) || []).some((c) => (c.workspaceKey || '') === (b.node.workspaceKey || ''))).map(([id]) => id)) : new Set();
  const pb = peek && lay ? lay.cards.get(peek) : null;
  return (
    <div className="mt-ph-list mt-pm mt-pl mt-pmap" data-role="phone-mission" data-style="canvas">
      <header className="mt-ph-head">
        <button type="button" className="mt-pm-back" data-action="phone-mission-back" aria-label={t('phoneMission.back')} onClick={onBack}><Chev /><span>{t('phone.list')}</span></button>
        <b className="mt-pm-title">{t('phoneMission.title')}</b>
        {conn}
      </header>
      {lay && ids.length > 0 && (
        <div className="mt-pl-pills" data-role="pl-pills">
          {attn.slice(0, ATTN_MAX).map((id) => { const tr = tiers.get(id); return <button key={id} type="button" className={`mt-pl-pill st-${ST[tr]}`} data-role="pl-attn" data-id={id} onClick={() => goTo(id)}><i /><b>{lay.cards.get(id).node.name}</b><span>{t(`mmTerr.chip.${tr}`)}</span></button>; })}
          {attn.length > ATTN_MAX && <button type="button" className="mt-pl-pill st-needs more" data-role="pl-attn-more" onClick={() => goNext('attn', ['turn', 'alert'])}><span>{t('mmTerr.more', { n: attn.length - ATTN_MAX })}</span></button>}
          {!attn.length && <span className="mt-pl-pill quiet" data-role="pl-none"><span>{t('phoneMap.none')}</span></span>}
          {nWork > 0 && <button type="button" className="mt-pl-pill st-working count" data-role="pl-count" data-tier="work" onClick={() => goNext('work', ['work'])}><i /><b>{nWork}</b><span>{t('mmTerr.chip.work')}</span></button>}
          {nDone > 0 && <button type="button" className="mt-pl-pill st-done count" data-role="pl-count" data-tier="review" onClick={() => goNext('review', ['review'])}><i /><b>{nDone}</b><span>{t('mmTerr.chip.review')}</span></button>}
        </div>
      )}
      <div className="mt-pmap-stage mt-ta mt-sm" data-role="pm-stage">
        <div className="mt-ta-vp mt-pmap-vp" data-role="ta-viewport" ref={vpRef}>
          <div className="mt-ta-bg" ref={bgRef} aria-hidden="true" />
          {!lay && !fail && <div className="mt-ta-loading">{t('common.loading')}</div>}
          {!lay && fail && <div className="mt-ta-loading" data-role="pm-fail">{t('mission.fail', { error: errText(fail) })}</div>}
          {lay && ids.length === 0 && <div className="mt-ta-loading" data-role="pm-empty">{t('phone.empty')}</div>}
          {lay && ids.length > 0 && (
            <div className="mt-ta-world lv-far" data-role="ta-world" ref={worldRef} style={view.current ? { transform: `translate(${view.current.x}px, ${view.current.y}px) scale(${view.current.k})` } : undefined}>
              {lay.bands.map((b, i) => (
                <div key={`b:${b.id || 'none'}:${i}`} className={`mt-sm-band mt-pmap-band${b.odd ? ' odd' : ''}${b.loose ? ' loose' : ''}`} data-role="ln-band" data-id={b.id || 'none'} data-cont={b.cont ? '1' : undefined} style={{ left: b.x, top: b.y, height: b.h, width: b.w }}>
                  <div className="mt-pmap-fh" data-role="pm-fhead">
                    <span className="fn" data-role="ln-band-name">{b.name}{b.cont ? <span className="cont"> {t('phoneMap.cont')}</span> : null}</span>
                    <span className="fs" data-role="ln-band-stat">{t('mmTerr.workspaces', { n: b.nWs })} · {t('mmTerr.sessions', { n: b.sessions })}</span>
                    <span className="fbar" aria-hidden="true">{b.bar.map((c) => <i key={c.tier} className={`st-${ST[c.tier]}`} style={{ flexGrow: c.n }} />)}</span>
                  </div>
                </div>
              ))}
              {lay.rows.map((r) => (
                <div key={`r:${r.key || '-'}`} className={`mt-sm-row mt-pmap-row${r.first ? ' first' : ''}`} data-role="ta-isle" data-key={r.key} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                  <div className="mt-pmap-wh" data-role="pm-whead">
                    <span className="wsn"><FolderIcon /><span data-role="ta-isle-name">{r.key ? r.name : t('mmapGroup.noWorkspace')}</span></span>
                    <span className="wsc">{r.chips.map((c) => <span key={c.tier} className={`st-${ST[c.tier]}`} data-tier={c.tier}><i /><b>{c.n}</b> {t(`mmTerr.chip.${c.tier}`)}</span>)}</span>
                  </div>
                </div>
              ))}
              {lay.divs.map((d, i) => <span key={`d:${i}`} className="mt-pmap-div" data-role="pm-solo-div" style={{ left: d.x, top: d.y, width: d.w }}><span>{t('mmLine.colSolo')}</span></span>)}
              <svg className="mt-ta-edges" width={1} height={1} aria-hidden="true">
                <defs>
                  {KINDS.map((k) => <marker key={k} id={`mt-pmap-tip-${k}`} className={`mt-sm-tip k-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 z" /></marker>)}
                  <marker id="mt-pmap-end-peer" className="mt-sm-tip k-peer" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse"><circle cx="5" cy="5" r="4" /></marker>
                </defs>
                {lay.edges.map((e) => {
                  const k = e.peer ? 'peer' : e.lineage ? 'lineage' : e.cross ? 'cross' : e.rel;
                  const tip = e.peer ? 'url(#mt-pmap-end-peer)' : e.lineage ? undefined : `url(#mt-pmap-tip-${KINDS.includes(k) ? k : 'spawn'})`;
                  return <path key={e.id} className={`mt-ta-edge k-${k}${!e.peer && !e.lineage && (e.active || tiers.get(e.to) === 'work') ? ' active' : ''}`} data-role="ta-edge" data-from={e.from} data-to={e.to} data-rel={e.rel} data-cross={e.cross ? '1' : undefined} d={e.d} markerEnd={tip} markerStart={e.peer ? tip : undefined} />;
                })}
              </svg>
              {ids.map((id) => { const b = lay.cards.get(id); return <Card key={id} id={id} b={b} f={factsOf(id)} tier={tiers.get(id)} lead={leads.has(id)} tagged={false} onTag={noop} onOpen={noop} onHover={noop} t={t} unfold={b.depth >= PHONE.FOLD && expanded.has(id) && (lay.tree.kids.get(id) || []).length > 0} onFold={onFold} />; })}
            </div>
          )}
        </div>
        {lay && ids.length > 0 && (
          <div className="mt-pmap-dock" data-role="ta-dock">
            <button type="button" className="zb" data-action="ta-zoom-out" aria-label={t('mmTerr.zoomOut')} onClick={() => zoomBy(1 / ZOOM.step)}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
            <span className="zpct" ref={pctRef} data-role="ta-zoom">100%</span>
            <button type="button" className="zb" data-action="ta-zoom-in" aria-label={t('mmTerr.zoomIn')} onClick={() => zoomBy(ZOOM.step)}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
            <button type="button" className="zb fit" data-action="ta-fit" aria-label={t('mmTerr.fitTitle')} onClick={() => fit()}>{t('mmTerr.fit')}</button>
          </div>
        )}
      </div>
      {pb && (() => {
        const row = lay.rows.find((x) => x.key === pb.ws), band = row && lay.bands.find((x) => (x.id || null) === (row.band || null));
        return (
          <div className="mt-pl-peekwrap" data-role="pl-peek" onClick={(e) => { if (e.target === e.currentTarget && Date.now() >= quiet.current) setPeek(null); }}>
            <div className="mt-pl-peeksheet">
              <Peek pv={{ id: peek, x: 0, y: 0 }} b={pb} f={factsOf(peek)} live={liveOf(pb.node)} tier={tiers.get(peek)} t={t} now={now} folder={[band && band.name, row && row.name].filter(Boolean).join(' / ')} />
              <div className="mt-pl-peekact">
                <button type="button" data-action="pl-peek-close" onClick={() => setPeek(null)}>{t('common.close')}</button>
                {pb.node.sessionId ? <button type="button" className="go" data-action="pl-peek-open" onClick={() => { const sid = pb.node.sessionId; setPeek(null); onOpen(sid); }}>{t('phoneMap.open')}</button> : null}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
