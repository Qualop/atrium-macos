// 검색(ARCH 4절 H2, P6a)과 고른 노드 막대(H6·H7)
// - 검색(Ctrl+F): 세션 이름, 워크스페이스 이름, 기다리는 질문, 요청, 답, 메모, 지난 지시에서 찾는다(백엔드 search.query, 판 기록만).
//   위아래 화살표로 오가고 Enter로 그 노드(워크스페이스면 그 영역)로 간다. Esc로 닫는다.
//   P6c: 출력(hook 없는 세션의 화면 답), 메모 노드, 칸반(제목, 열, 카드)도 나온다. 고르면 그 메모·칸반 노드로 간다(카드는 빛난다).
// - 고른 노드 막대: Ctrl+누르기나 Shift+끌기로 노드를 고르면 뜬다. 크기(P26: 가로|세로 토글과 크게·보통·작게, 지금 크기 단계에 불), 배치 틀(P17 붙여 묶기, P23: 도형 단추,
//   P26: 고른 세션 수에 맞는 틀만), 고름 풀기. P26: 위 알약 묶음과 같은 맨 위 줄 가운데에 두고, 자리가 모자라면 그 아래 줄로 접는다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, getState, setSearchOpen, selectWorkspace, toast, setFlashCard } from './store.js';
import { STATE_LABEL } from './lib/labels.js';
import { dt, presetText } from './lib/dock-text.js'; // P17
import { presetTree, presetsFor, layout as layoutTree } from '../../../backend/src/dock-tree.mjs'; // P23: 배치 틀 그림. P26: 세션 수마다 틀
import { SIZE_STEPS, BAR_SIZES, bbox } from '../../../backend/src/canvas.mjs'; // P23: 가로·세로 크기
import { SIZE_DIRS, SIZE_LEVELS, COMPACT_LEVELS, litStep, autoDir, flipStep, sizeTargets, layoutCount, placeBar } from './lib/selbar.js'; // P26
import { useT, errText, tOr } from './lib/i18n.js';

export function SearchBox() {
  const t = useT();
  const open = useStore((st) => st.searchOpen);
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [pick, setPick] = useState(0);
  const inRef = useRef(null);
  useEffect(() => { if (!open) return; const timer = setTimeout(() => inRef.current?.select(), 0); return () => clearTimeout(timer); }, [open]);
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) { setRes([]); return; }
    let alive = true;
    const timer = setTimeout(() => api.call('search.query', { q: query, limit: 20 }).then((r) => { if (alive) { setRes(r.results); setPick(0); } }).catch((e) => toast(t('search.fail', { error: errText(e) }), 'error')), 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, open]);
  if (!open) return null;
  const go = (r) => {
    if (!r) return;
    setSearchOpen(false);
    if (r.kind === 'workspace') selectWorkspace(r.workspaceKey);
    else if (r.kind === 'memo') getState().navigateToItem && getState().navigateToItem(`memo:${r.memoId}`);
    else if (r.kind === 'kanban') { getState().navigateToItem && getState().navigateToItem(`kanban:${r.kanbanId}`); if (r.cardId) setFlashCard(r.cardId); }
    else getState().navigateTo && getState().navigateTo(r.sessionId);
  };
  const onKey = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); setSearchOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (res.length) setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : res.length - 1)) % res.length); return; }
    if (e.key === 'Enter') { e.preventDefault(); go(res[pick]); }
  };
  const hl = (text) => {
    const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
    if (i < 0 || !q.trim()) return text;
    return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.trim().length)}</mark>{text.slice(i + q.trim().length)}</>;
  };
  return (
    <div className="mt-search" data-role="search">
      <input ref={inRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('search.placeholder')} data-field="search" spellCheck={false} />
      <div className="mt-search-list">
        {res.map((r, i) => (
          <div key={`${r.kind}:${r.sessionId || r.memoId || r.kanbanId || r.workspaceKey}`} className={`mt-search-item${i === pick ? ' on' : ''}`} data-kind={r.kind} data-name={r.name} data-field={r.field} onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }}>
            <b>{r.kind === 'workspace' ? '▣ ' : r.kind === 'memo' ? '▤ ' : r.kind === 'kanban' ? '▦ ' : '@'}{r.name}</b>
            {r.state && <span className={`mt-pill st-${r.state}`}>{STATE_LABEL[r.state] || r.state}</span>}
            <span className="mt-search-field">{r.field ? tOr(`search.field.${r.field}`, r.label) : r.label}</span>
            <span className="mt-search-snip">{hl(r.snippet || '')}</span>
            {r.hits > 1 && <span className="mt-search-more">+{r.hits - 1}</span>}
          </div>
        ))}
        {q.trim() && !res.length && <div className="mt-search-item empty">{t('search.empty')}</div>}
      </div>
    </div>
  );
}

// P23: 배치 틀 단추의 그림. 틀의 나무를 작은 사각형들로 그린다. P26: 틀은 고른 세션 수(n)에 맞는 것만 보이고 그 수 그대로 그린다
function PresetIcon({ id, n }) {
  const W = 30, H = 20;
  const tree = presetTree(id, Array.from({ length: n }, (_, i) => `c${i}`));
  const rects = [...layoutTree(tree, { x: 0, y: 0, w: W, h: H }, { w: 0, h: 0 }).rects.values()];
  return (
    <svg className="mt-preset-icon" width={W + 2} height={H + 2} viewBox={`-1 -1 ${W + 2} ${H + 2}`} aria-hidden="true">
      {rects.map((r, i) => <rect key={i} x={r.x + 1} y={r.y + 1} width={Math.max(1, r.w - 2)} height={Math.max(1, r.h - 2)} rx="1.5" />)}
    </svg>
  );
}

// P26: 막대 자리(맨 위 줄 가운데, lib/selbar.js placeBar). 줄이는 단계마다 막대 너비를 재고, 위 알약 묶음 사이에 들어가는 가장 낮은 단계로 둔다.
// 막대를 그릴 때와 창·묶음 크기가 바뀔 때 잰다. 재는 동안만 너비를 풀고 단계를 바꿔 본다(같은 틀 안이라 화면에 그려지지 않는다)
const GAP = 12;
function useBarPlace(barRef, key) {
  const [place, setPlace] = useState(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    const measure = () => {
      const host = bar.offsetParent || document.body;
      const hr = host.getBoundingClientRect();
      const tl = document.querySelector('[data-role="top-left"]'), tr = document.querySelector('[data-role="top-right"]');
      const keep = { width: bar.style.width, compact: bar.dataset.compact };
      bar.style.width = 'max-content';
      const widths = Array.from({ length: COMPACT_LEVELS }, (_, k) => { bar.dataset.compact = String(k); return Math.ceil(bar.getBoundingClientRect().width) + 1; });
      bar.style.width = keep.width;
      if (keep.compact == null) delete bar.dataset.compact; else bar.dataset.compact = keep.compact;
      const next = placeBar({ width: hr.width, tlRight: tl ? tl.getBoundingClientRect().right - hr.left : 0, trLeft: tr ? tr.getBoundingClientRect().left - hr.left : hr.width, widths, gap: GAP });
      setPlace((p) => (p && p.row === next.row && p.level === next.level && p.x === next.x && p.w === next.w ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const sel of ['[data-role="top-left"]', '[data-role="top-right"]']) { const el = document.querySelector(sel); if (el) ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [barRef, key]);
  return place;
}

export function SelectionBar() {
  const t = useT();
  const selected = useStore((st) => st.selected);
  const sessions = useStore((st) => st.sessions);
  const nodes = useStore((st) => st.nodes);
  // 하나만 누른 것은 고르기가 아니다(크기는 노드의 ⋯ 메뉴). P17: 덩어리 안 노드 하나를 골랐으면 그 덩어리를 틀로 다시 짤 수 있게 보인다
  const docks = useStore((st) => st.docks);
  const barRef = useRef(null);
  const [dirPick, setDirPick] = useState(null);
  const [layoutOpen, setLayoutOpen] = useState(false); // P26: 가장 줄인 막대에서 접은 배치 틀을 펼쳤는가
  const dockList = [...docks.values()];
  const oneDock = selected.length === 1 && dockList.some((d) => d.members.includes(selected[0]));
  const show = selected.length >= 2 || oneDock;
  const list = selected.map((id) => sessions.get(id)).filter(Boolean);
  // P26: 크기 대상(덩어리는 바깥 하나)과 그 크기, 불이 들어올 단계, 토글 쪽, 틀에 들어갈 세션 수
  const targets = sizeTargets(selected, dockList);
  const rects = targets.map((x) => bbox(x.members.map((m) => nodes.get(m))));
  const lit = litStep(rects);
  const dir = dirPick || autoDir(rects, lit);
  const n = layoutCount(selected, dockList);
  const presets = presetsFor(n);
  useEffect(() => { setDirPick(null); }, [lit]);
  useEffect(() => { setLayoutOpen(false); }, [selected]);
  const place = useBarPlace(barRef, `${show}|${list.length}|${n}|${dir}|${list.map((s) => s.name).join(',')}`);
  if (!show) return null;
  const ws = new Set(list.map((s) => s.workspaceKey || null));
  const call = async (method, p, ok) => { try { const r = await api.call(method, p); if (ok) toast(ok(r)); } catch (e) { toast(errText(e), 'error'); } };
  const clear = () => getState().clearSelection && getState().clearSelection();
  // P23: 크기. 덩어리 안 노드는 덩어리 전체 바깥에 한 번만 쓴다(scope dock), 혼자인 노드는 그 노드에
  const resize = async (size) => {
    for (const x of sizeTargets(getState().selected, [...getState().docks.values()])) await call('board.setSize', { session: x.id, size, scope: x.dockId ? 'dock' : undefined });
  };
  // P26: 토글을 바꾸면 불이 들어온 단계를 다른 쪽의 같은 단계로 바꾼다(불이 없으면 쪽만 바꾼다)
  const flip = (d) => { setDirPick(d); const k = flipStep(lit, d); if (k) resize(k); };
  const sizeTitle = (k) => t('selection.sizeTitle', { w: SIZE_STEPS[k].w, h: SIZE_STEPS[k].h });
  const style = !place ? { visibility: 'hidden' } : place.row === 'top' ? { left: place.x, width: place.w } : undefined;
  return (
    <div ref={barRef} className={`mt-selbar ${place ? place.row : 'top'}`} style={style} data-role="selection" data-row={place ? place.row : undefined} data-compact={place ? place.level : 0}>
      <b className="mt-sel-count" title={t('selection.count', { n: list.length })}><span className="full">{t('selection.count', { n: list.length })}</span><span className="short">{list.length}</span></b>
      <span className="dim mt-sel-names" data-role="sel-names">{list.map((s) => `@${s.name}`).join(' ')}</span>
      <span className="mt-sel-sep" />
      <div className="mt-sel-dir" data-role="size-dir" role="group" title={t('selection.dirTitle')}>
        {SIZE_DIRS.map((d) => <button key={d} className={`mt-sel-dirbtn${dir === d ? ' on' : ''}`} data-dir={d} aria-pressed={dir === d} onClick={() => flip(d)}>{t(`selection.${d}`)}</button>)}
      </div>
      <div className="mt-sel-sizes" data-role="size-buttons" data-dir={dir} data-lit={lit || undefined}>
        {BAR_SIZES[dir].map((k, i) => <button key={k} className={`mt-btn small ghost mt-sel-size${lit === k ? ' on' : ''}`} data-size={k} aria-pressed={lit === k} title={sizeTitle(k)} onClick={() => resize(k)}>{t(`selection.${SIZE_LEVELS[i]}`)}</button>)}
      </div>
      {/* P17: 배치 틀. 고른 순서대로 칸을 채워 한 덩어리로 짠다(고른 노드가 든 덩어리는 통째로). P23: 글 대신 도형. P26: 세션 수에 맞는 틀만 */}
      <span className="mt-sel-sep" />
      <button className={`mt-btn small ghost mt-sel-layout${layoutOpen ? ' on' : ''}`} data-action="layout-more" aria-expanded={layoutOpen} title={dt('layoutLabel')} onClick={() => setLayoutOpen((o) => !o)}>{presets[0] && <PresetIcon id={presets[0]} n={n} />}<span className="mt-sel-caret">▾</span></button>
      <div className={`mt-sel-presets${layoutOpen ? ' open' : ''}`} data-role="presets" data-count={n}>
        {presets.map((id) => {
          const b = presetText(id);
          const label = dt(b.label, { n });
          return (
            <button key={id} className="mt-btn small ghost mt-preset" data-preset={id} disabled={ws.size !== 1} aria-label={label} title={ws.size !== 1 ? dt('layoutMixed') : `${label}: ${dt(b.title, { n })}\n${dt('layoutTitle')}`}
              onClick={() => call('dock.layout', { members: selected, preset: id }, () => dt('layoutDone', { name: label })).then(() => { setLayoutOpen(false); clear(); })}><PresetIcon id={id} n={n} /></button>
          );
        })}
      </div>
      <span className="mt-sel-sep" />
      <button className="mt-btn small ghost mt-sel-clear" data-action="selection-clear" title={t('selection.clear')} aria-label={t('selection.clear')} onClick={clear}><span className="full">{t('selection.clear')}</span><span className="short">×</span></button>
    </div>
  );
}
