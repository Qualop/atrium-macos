// 검색(ARCH 4절 H2, P6a)과 고른 노드 막대(H6·H7)
// - 검색(Ctrl+F): 세션 이름, 워크스페이스 이름, 기다리는 질문, 요청, 답, 메모, 지난 지시에서 찾는다(백엔드 search.query, 판 기록만).
//   위아래 화살표로 오가고 Enter로 그 노드(워크스페이스면 그 영역)로 간다. Esc로 닫는다.
//   P43: 위 가운데(위 크롬 아래)에 뜨고 결과는 아래로 펼친다. 판에서 ↑ 키로도 연다. 바깥을 누르면 닫는다(누르기는 판에 그대로 간다)
//   P6c: 출력(hook 없는 세션의 화면 답), 메모 노드, 칸반(제목, 열, 카드)도 나온다. 고르면 그 메모·칸반 노드로 간다(카드는 빛난다).
//   P61: 찾기 아이콘이 든 큰 입력칸, 종류 표시가 든 두 줄 결과와 맞는 낱말 강조, 아래 키 안내. 위에서 가볍게 내려오고 닫힐 때 올라간다.
// - 고른 노드 막대: Ctrl+누르기나 Shift+끌기로 노드를 고르면 뜬다. 크기(P26: 가로|세로 토글과 크게·보통·작게, 지금 크기 단계에 불), 배치 틀(P17 붙여 묶기, P23: 도형 단추,
//   P26: 고른 세션 수에 맞는 틀만), 고름 풀기. P26: 위 알약 묶음과 같은 맨 위 줄 가운데에 두고, 자리가 모자라면 그 아래 줄로 접는다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, getState, setSearchOpen, selectWorkspace, toast, setFlashCard } from './store.js';
import { STATE_LABEL } from './lib/labels.js';
import { dt, presetText } from './lib/dock-text.js'; // P17
import { presetTree, presetsFor, layout as layoutTree } from '../../../backend/src/dock-tree.mjs'; // P23: 배치 틀 그림. P26: 세션 수마다 틀
import { bbox } from '../../../backend/src/canvas.mjs';
import { SIZE_DIRS, SIZE_LEVELS, ASPECT_KEYS, COMPACT_LEVELS, aspectLabel, blockState, dockState, dockLevelSize, litOf, levelSize, showBar, showLayouts, presetGlyph, sizeTargets, layoutCount, placeBar } from './lib/selbar.js'; // P26. P73: 방향 × 비율 × 단계, 혼자인 세션도
import { useT, errText, tOr } from './lib/i18n.js';
import { Icon } from './lib/icons.jsx';
import { SEARCH_LEAVE_MS, kindIcon, markRanges, showField, showSnip, movePick } from './lib/search-ui.js'; // P61: 찾기 창 다시 그리기

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function SearchBox() {
  const t = useT();
  const open = useStore((st) => st.searchOpen);
  const [q, setQ] = useState('');
  const [result, setResult] = useState({ query: '', items: [] });
  const res = result.query === q.trim() ? result.items : [];
  const [pick, setPick] = useState(0);
  const [pending, setPending] = useState(false); // 친 말에 대한 결과를 기다리는 중(그동안은 '결과 없음'을 보이지 않는다)
  const [shown, setShown] = useState(open); // P61: 닫힌 뒤에도 올라가는 움직임 동안 남겨 둔다
  const inRef = useRef(null);
  const boxRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { if (!open) return; const timer = setTimeout(() => inRef.current?.select(), 0); return () => clearTimeout(timer); }, [open]);
  // P61: 열리면 위에서 내려오고(styles.css mt-search-in), 닫히면 SEARCH_LEAVE_MS 동안 위로 올라가며 흐려진 뒤 사라진다. 움직임 줄이기면 바로
  useEffect(() => {
    if (open) { setShown(true); return undefined; }
    if (inRef.current && document.activeElement === inRef.current) inRef.current.blur();
    const ms = reducedMotion() ? 0 : SEARCH_LEAVE_MS;
    if (!ms) { setShown(false); return undefined; }
    const id = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(id);
  }, [open]);
  // P43: 찾기 바 바깥을 한 번 누르면 닫는다. 누르기는 막지 않아 판에 그대로 간다(노드를 눌렀으면 노드도 골라진다)
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setSearchOpen(false); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    setResult({ query, items: [] });
    if (!query) { setPending(false); return; }
    let alive = true;
    setPending(true);
    const timer = setTimeout(() => api.call('search.query', { q: query, limit: 20 }).then((r) => { if (alive) { setResult({ query, items: r.results }); setPick(0); setPending(false); } }).catch((e) => { if (alive) { setPending(false); toast(t('search.fail', { error: errText(e) }), 'error'); } }), 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, open]);
  // 위아래 키로 고른 줄이 목록 밖이면 보이게 굴린다
  useEffect(() => { const el = listRef.current && listRef.current.querySelector('.mt-search-item.on'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [pick, res]);
  if (!open && !shown) return null;
  const leaving = !open;
  const go = (r) => {
    if (!r) return;
    setSearchOpen(false);
    if (r.kind === 'workspace') selectWorkspace(r.workspaceKey);
    else if (r.kind === 'memo') getState().navigateToItem && getState().navigateToItem(`memo:${r.memoId}`);
    else if (r.kind === 'kanban') { getState().navigateToItem && getState().navigateToItem(`kanban:${r.kanbanId}`); if (r.cardId) setFlashCard(r.cardId); }
    else getState().navigateTo && getState().navigateTo(r.sessionId);
  };
  const onKey = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key === 'Process') return;
    if (e.key === 'Escape') { e.preventDefault(); setSearchOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPick((p) => movePick(p, res.length, e.key === 'ArrowDown' ? 1 : -1)); return; }
    if (e.key === 'Enter') { e.preventDefault(); go(res[pick]); }
  };
  const query = q.trim();
  const hl = (text) => markRanges(text, query).map((m, i) => (m.hit ? <mark key={i}>{m.text}</mark> : m.text));
  const empty = !!query && !pending && !res.length;
  return (
    // P61: 찾기 아이콘이 든 큰 입력칸, 찾는 범위 안내(빈 칸일 때), 종류 표시가 든 두 줄 결과, 아래 키 안내. 위에서 가볍게 내려온다
    <div className="mt-search" data-role={leaving ? undefined : 'search'} data-state={leaving ? 'closing' : 'open'} ref={boxRef} aria-hidden={leaving || undefined}>
      <div className="mt-search-bar">
        <Icon name="search" className="mt-search-icon" />
        <input ref={inRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('searchBox.placeholder')} aria-label={t('searchBox.label')} data-field="search" spellCheck={false} />
        {q && <button type="button" className="mt-search-clear" title={t('searchBox.clear')} data-action="search-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(''); if (inRef.current) inRef.current.focus(); }}><Icon name="x" /></button>}
      </div>
      {!query && <div className="mt-search-scope">{t('searchBox.scope')}</div>}
      {res.length > 0 && (
        <div className="mt-search-list" role="listbox" ref={listRef}>
          {res.map((r, i) => {
            const kindText = tOr(`searchBox.kind.${r.kind}`, r.kind);
            const fieldText = r.field ? tOr(`search.field.${r.field}`, r.label) : r.label;
            return (
              <div key={`${r.kind}:${r.sessionId || r.memoId || r.kanbanId || r.workspaceKey}`} role="option" aria-selected={i === pick} className={`mt-search-item${i === pick ? ' on' : ''}`} data-kind={r.kind} data-name={r.name} data-field={r.field} onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); go(r); }}>
                <span className="mt-search-kind" data-kind={r.kind}><Icon name={kindIcon(r.kind)} /></span>
                <span className="mt-search-main">
                  <span className="mt-search-top">
                    <b className="mt-search-name">{r.kind === 'session' ? '@' : ''}{hl(r.name || '')}</b>
                    {r.state && <span className={`mt-pill st-${r.state}`}>{STATE_LABEL[r.state] || r.state}</span>}
                    <span className="mt-search-tag">{kindText}</span>
                  </span>
                  {(showField(fieldText, kindText) || showSnip(r.snippet, r.name)) && (
                    <span className="mt-search-sub">
                      {showField(fieldText, kindText) && <span className="mt-search-field">{fieldText}</span>}
                      {showSnip(r.snippet, r.name) && <span className="mt-search-snip">{hl(r.snippet)}</span>}
                    </span>
                  )}
                </span>
                {r.hits > 1 && <span className="mt-search-more">+{r.hits - 1}</span>}
                <kbd className="mt-search-go" aria-hidden="true">↵</kbd>
              </div>
            );
          })}
        </div>
      )}
      {empty && (
        <div className="mt-search-item empty" data-role="search-empty">
          <Icon name="search" className="mt-search-empty-icon" />
          <b>{t('searchBox.emptyTitle', { q: query })}</b>
          <span>{t('searchBox.emptyBody')}</span>
        </div>
      )}
      <div className="mt-search-foot">
        <span className="mt-search-keys">
          <span><kbd>↑</kbd><kbd>↓</kbd>{t('searchBox.keyPick')}</span>
          <span><kbd>Enter</kbd>{t('searchBox.keyGo')}</span>
          <span><kbd>Esc</kbd>{t('searchBox.keyClose')}</span>
        </span>
        {res.length > 0 && <span className="mt-search-count">{t('searchBox.count', { n: res.length })}</span>}
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
  // P73: 세션 하나만 골라도 뜬다(방향·단계·비율). 배치 틀은 틀에 들어갈 세션이 둘 이상일 때(덩어리 안 노드 하나를 골랐으면 그 덩어리)
  const docks = useStore((st) => st.docks);
  const barRef = useRef(null);
  const [layoutOpen, setLayoutOpen] = useState(false); // P26: 가장 줄인 막대에서 접은 배치 틀을 펼쳤는가
  const dockList = [...docks.values()];
  const show = showBar(selected);
  const list = selected.map((id) => sessions.get(id)).filter(Boolean);
  // 크기 대상(덩어리는 바깥 하나)과 그 상태(방향, 불이 든 비율·단계), 틀에 들어갈 세션 수
  const targets = sizeTargets(selected, dockList);
  // P80: 덩어리는 바깥을 같은 규칙의 단독 세션 하나로 본 상태다(틀 비율은 그대로). 혼자인 노드는 그 노드
  const states = targets.map((x) => { const d = x.dockId ? docks.get(x.dockId) : null; return d ? dockState(d.tree, x.members.map((m) => nodes.get(m)), d.aspect) : blockState(nodes.get(x.id), (nodes.get(x.id) || {}).aspect); });
  const rects = targets.map((x, i) => (states[i] && states[i].single) || bbox(x.members.map((m) => nodes.get(m))));
  const dockUnit = targets.some((x) => x.dockId); // P80: 덩어리를 골랐으면 도움말이 덩어리 규칙
  const dockOne = targets.length === 1 && targets[0].dockId ? docks.get(targets[0].dockId) : null;
  const lit = litOf(states);
  const n = layoutCount(selected, dockList);
  const layouts = showLayouts(selected, dockList);
  const presets = layouts ? presetsFor(n) : [];
  useEffect(() => { setLayoutOpen(false); }, [selected]);
  const place = useBarPlace(barRef, `${show}|${list.length}|${n}|${lit.dir}|${layouts}|${dockUnit}|${list.map((s) => s.name).join(',')}`);
  if (!show || !list.length) return null;
  const ws = new Set(list.map((s) => s.workspaceKey || null));
  const call = async (method, p, ok) => { try { const r = await api.call(method, p); if (ok) toast(ok(r)); } catch (e) { toast(errText(e), 'error'); } };
  const clear = () => getState().clearSelection && getState().clearSelection();
  // P73: 크기는 방향·단계·비율 가운데 바꾼 것만 보낸다(나머지는 백엔드가 지금 것을 지킨다). 덩어리 안 노드는 덩어리 바깥에 한 번만
  const resize = async (req) => {
    for (const x of sizeTargets(getState().selected, [...getState().docks.values()])) await call('board.setSize', { session: x.id, ...req, scope: x.dockId ? 'dock' : undefined });
  };
  const one = rects.length === 1 ? rects[0] : null;
  const sizeTitle = (lv) => { const s = dockOne ? dockLevelSize(lv, { dir: lit.dir, aspect: lit.aspect, tree: dockOne.tree, single: one }) : levelSize(lv, { dir: lit.dir, aspect: lit.aspect, rect: one }); return t(dockOne ? 'dockSizeBar.sizeTitle' : 'selection.sizeTitle', { w: s.w, h: s.h }); };
  const style = !place ? { visibility: 'hidden' } : place.row === 'top' ? { left: place.x, width: place.w } : undefined;
  return (
    <div ref={barRef} className={`mt-selbar ${place ? place.row : 'top'}`} style={style} data-role="selection" data-row={place ? place.row : undefined} data-compact={place ? place.level : 0} data-single={layouts ? undefined : ''} data-unit={dockUnit ? 'dock' : undefined}>
      <b className="mt-sel-count" title={t('selection.count', { n: list.length })}><span className="full">{t('selection.count', { n: list.length })}</span><span className="short">{list.length}</span></b>
      <span className="dim mt-sel-names" data-role="sel-names">{list.map((s) => `@${s.name}`).join(' ')}</span>
      <span className="mt-sel-sep" />
      <div className="mt-sel-dir" data-role="size-dir" role="group" title={t(dockUnit ? 'dockSizeBar.dirTitle' : 'sizeBar.dirTitle')}>
        {SIZE_DIRS.map((d) => <button key={d} className={`mt-sel-dirbtn${lit.dir === d ? ' on' : ''}`} data-dir={d} aria-pressed={lit.dir === d} aria-label={t(`selection.${d}`)} onClick={() => { if (lit.dir !== d) resize({ dir: d }); }}><span className="sfull">{t(`selection.${d}`)}</span><span className={`sshort mt-sel-dirglyph ${d}`} aria-hidden="true" /></button>)}
      </div>
      <div className="mt-sel-sizes" data-role="size-buttons" data-dir={lit.dir} data-lit={lit.level || undefined}>
        {SIZE_LEVELS.map((lv) => <button key={lv} className={`mt-btn small ghost mt-sel-size${lit.level === lv ? ' on' : ''}`} data-level={lv} aria-pressed={lit.level === lv} aria-label={t(`selection.${lv}`)} title={sizeTitle(lv)} onClick={() => resize({ level: lv })}><span className="sfull">{t(`selection.${lv}`)}</span><span className="sshort">{t(`sizeBar.short.${lv}`)}</span></button>)}
      </div>
      {/* P73: 종횡비 토글. 하나를 누르면 그 비율이 되고(지금 단계를 지킨다) 다른 하나는 꺼진다. 테두리를 끌면 둘 다 꺼진다(자유 비율) */}
      <div className="mt-sel-dir mt-sel-aspect" data-role="size-aspect" role="group" data-lit={lit.aspect || undefined} title={t(dockUnit ? 'dockSizeBar.aspectTitle' : 'sizeBar.aspectTitle')}>
        {ASPECT_KEYS.map((a) => <button key={a} className={`mt-sel-dirbtn${lit.aspect === a ? ' on' : ''}`} data-aspect={a} aria-pressed={lit.aspect === a} onClick={() => { if (lit.aspect !== a) resize({ aspect: a }); }}>{aspectLabel(a, lit.dir)}</button>)}
      </div>
      {/* P17: 배치 틀. 고른 순서대로 칸을 채워 한 덩어리로 짠다(고른 노드가 든 덩어리는 통째로). P23: 글 대신 도형. P26: 세션 수에 맞는 틀만. P30: 누른 뒤에도 고름을 풀지 않는다(이어서 다른 틀·크기를 바로 고른다)
          P73: 혼자인 세션 하나면 틀이 없다. H(모두 가로 한 줄)·V(모두 세로 한 줄)는 칸이 많으면 글자 단추 */}
      {layouts && <span className="mt-sel-sep" />}
      {layouts && <button className={`mt-btn small ghost mt-sel-layout${layoutOpen ? ' on' : ''}`} data-action="layout-more" aria-expanded={layoutOpen} title={dt('layoutLabel')} onClick={() => setLayoutOpen((o) => !o)}>{presets[0] && <PresetIcon id={presets[0]} n={n} />}<span className="mt-sel-caret">▾</span></button>}
      {layouts && (
        <div className={`mt-sel-presets${layoutOpen ? ' open' : ''}`} data-role="presets" data-count={n}>
          {presets.map((id) => {
            const b = presetText(id);
            const label = dt(b.label, { n });
            const glyph = presetGlyph(id, n);
            return (
              <button key={id} className={`mt-btn small ghost mt-preset${glyph ? ' glyph' : ''}`} data-preset={id} disabled={ws.size !== 1} aria-label={label} title={ws.size !== 1 ? dt('layoutMixed') : `${label}: ${dt(b.title, { n })}\n${dt('layoutTitle')}`}
                onClick={() => call('dock.layout', { members: selected, preset: id }, () => dt('layoutDone', { name: label })).then(() => setLayoutOpen(false))}>{glyph ? <span className="mt-preset-glyph">{glyph}</span> : <PresetIcon id={id} n={n} />}</button>
            );
          })}
        </div>
      )}
      <span className="mt-sel-sep" />
      <button className="mt-btn small ghost mt-sel-clear" data-action="selection-clear" title={t('selection.clear')} aria-label={t('selection.clear')} onClick={clear}><span className="full">{t('selection.clear')}</span><span className="short">×</span></button>
    </div>
  );
}
