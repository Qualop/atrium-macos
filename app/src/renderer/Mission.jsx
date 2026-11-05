// 미션 맵(ARCH 4절 I6, P6c, P32에서 다시 그림): 덮개 화면. 왼쪽에서 오른쪽으로 펼친 나무(사람 → 지시하는 세션 → 받는 세션)와 아래 "연결 없음" 칸.
// 배치는 lib/mission-layout.js(순수 함수). 한 쌍 사이의 선은 하나로 모으고 화살표로 방향을, 받는 상자 옆 이름표로 역할을 보인다.
// 상자는 판의 노드와 같은 종류 아이콘(KindIcon)과 상태 알약(StatePill)을 쓴다. 내 차례는 주황 테두리와 묻는 내용.
// 상자를 누르면 덮개를 닫고 그 노드로 간다. 상자·선·이름표·단추가 아닌 빈 곳을 누르거나 Esc를 누르면 닫힌다(P32). 위쪽 칩으로 거른다(맞는 세션과 그 조상만, 조상은 흐리게).
// 연 동안 세션·연결·Thread·루프가 바뀌면 다시 읽는다(mission.graph).
// P46: 세션 상자는 워크스페이스(저장소)별 무리 안에 놓인다. 무리 머리줄에 이름, 세션 수, 응답 필요 수. 머리줄을 누르면 접고 펼친다.
//   다른 워크스페이스의 세션에게 시킨 선(cross)은 굵게 긋고 이름표 테두리를 점선으로, 풀이 글에 어느 워크스페이스에서 왔는지 적는다.
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useStore, getState, setMissionOpen, toast, wsName } from './store.js';
import { missionLayout, edgeLabel, EDGE_ORDER, MISSION } from './lib/mission-layout.js';
import { useT, errText, fmtTime } from './lib/i18n.js';
import { KindIcon, StatePill } from './SessionNode.jsx';

const CATS = ['all', 'needs_you', 'working', 'idle', 'done', 'exited'];
// 빈 곳 누르기에서 빼는 것
const SOLID = '[data-role="mm-node"], [data-role="mm-edge"], [data-role="mm-label"], [data-role="mm-legend"], button, input, select, a';

function Box({ b, live, onGo }) {
  const t = useT();
  const n = b.node;
  const style = { left: b.x, top: b.y, width: b.w, height: b.h };
  if (n.kind === 'human') return (
    <div className="mt-mm-box human" style={style} data-role="mm-node" data-kind="human" title={t('mmap.humanTitle')}>
      <span className="mt-mm-you">{t('mission.human')}</span>
      <span className="mt-mm-sub">{t('mission.edge.bar')}</span>
    </div>
  );
  // 판의 세션(있으면)으로 상태 알약을 그려 노드와 같은 말·색을 쓴다
  const s = live || { state: n.state, unseen: n.category === 'done' };
  const kind = (live && (live.flavor || live.kind)) || n.agentKind || 'claude';
  const cmd = live && live.shell && !live.shell.atPrompt ? live.shell.command || (live.shell.procs || []).join(', ') : null; // 셸은 도는 명령
  const sub = n.ask || (n.lastPrompt ? n.lastPrompt.replace(/\s+/g, ' ') : cmd ? `$ ${cmd}` : null);
  const tip = [`@${n.name}${n.role ? ` · ${n.role}` : ''}`, n.ask ? `${t('mmap.ask')} ${n.ask}` : null, n.lastPrompt ? `${t('mmap.prompt')} ${n.lastPrompt}` : null, t('mission.goSession')].filter(Boolean).join('\n');
  return (
    <div className={`mt-mm-box session c-${n.category}${b.ghost ? ' ghost' : ''}`} style={style} data-role="mm-node" data-kind="session" data-name={n.name} data-category={n.category} data-ghost={b.ghost ? '1' : undefined} onClick={() => onGo(n)} title={tip}>
      <div className="mt-mm-line">
        <span className="mt-mm-kind"><KindIcon kind={kind} state={n.state} /></span>
        <b className="mt-mm-name">@{n.name}</b>
        {n.loops ? <span className="mt-mm-loop" title={t('mmap.loops', { n: n.loops })}>⟳{n.loops}</span> : null}
        <StatePill s={s} />
      </div>
      {sub ? <div className={`mt-mm-sub${n.ask ? ' ask' : ''}`} data-role={n.ask ? 'mm-ask' : 'mm-prompt'}>{sub}</div> : <div className="mt-mm-sub none">{n.agentKind === 'shell' ? t('mission.shell') : t('mmap.noPrompt')}</div>}
      {(n.ask || (n.lastPrompt && n.lastPrompt.length > 34)) && <div className="mt-mm-more" data-role="mm-more">{n.ask ? <><b>{t('mmap.ask')}</b> {n.ask}{n.lastPrompt ? <><br /><b>{t('mmap.prompt')}</b> {n.lastPrompt}</> : null}</> : <><b>{t('mmap.prompt')}</b> {n.lastPrompt}</>}</div>}
    </div>
  );
}

function Legend() {
  const t = useT();
  return (
    <span className="mt-mm-legend" data-role="mm-legend">
      {EDGE_ORDER.map((k) => (
        <span key={k} className={`mt-mm-key k-${k}`} title={t(`mmap.keyTitle.${k}`)}>
          <svg width="22" height="8"><line x1="1" y1="4" x2="21" y2="4" /></svg>{t(`mission.edge.${k}`)}
        </span>
      ))}
    </span>
  );
}

export function MissionMap() {
  const t = useT();
  const open = useStore((st) => st.missionOpen);
  const sessions = useStore((st) => st.sessions);
  const links = useStore((st) => st.links);
  const thread = useStore((st) => st.thread);
  const loops = useStore((st) => st.loops);
  const [graph, setGraph] = useState(null);
  const [filter, setFilter] = useState('all');
  const workspaces = useStore((st) => st.workspaces);
  const [shut, setShut] = useState(() => new Set()); // P46: 접은 무리(워크스페이스 키)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => api.call('mission.graph').then((g) => alive && setGraph(g)).catch((e) => { if (alive) toast(t('mission.fail', { error: errText(e) }), 'error'); }), graph ? 300 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, sessions, links, thread, loops]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229 && !getState().dialog) { e.preventDefault(); e.stopPropagation(); setMissionOpen(false); } };
    // The map owns Esc while visible, before the selected React Flow nodes consume it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  const order = useMemo(() => (workspaces || []).map((w) => w.key), [workspaces]);
  const lay = useMemo(() => (graph ? missionLayout(graph, { filter, collapsed: [...shut], order }) : null), [graph, filter, shut, order]);
  const gName = (key) => (key ? wsName(key) : t('mmapGroup.noWorkspace'));
  const toggle = (key) => setShut((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  if (!open) return null;

  const go = (n) => {
    setMissionOpen(false);
    const st = getState();
    if (n.kind === 'session') setTimeout(() => st.navigateTo && st.navigateTo(n.sessionId), 30);
  };
  // P32: 빈 곳을 누르면 닫는다(글을 고르며 끈 경우는 빼고)
  const onBackdrop = (e) => {
    if (e.button !== 0 || e.target.closest(SOLID)) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    setMissionOpen(false);
  };
  const c = (graph && graph.counts) || {};
  const tipOf = (e) => {
    const kinds = e.kinds.map((k) => t(`mission.edge.${k}`)).join(' · ');
    return [`${kinds}${e.role ? `: ${e.role}` : ''}`, e.cross ? `${t('mmapGroup.crossTitle')}: ${gName(e.fromGroup)} → ${gName(e.toGroup)}` : null, e.text ? `“${e.text}”` : null, e.count ? t('mission.edgeCount', { n: e.count }) : null, e.lastAt ? t('mission.edgeLast', { time: fmtTime(e.lastAt) }) : null].filter(Boolean).join('\n');
  };
  return (
    <div className="mt-mission" data-role="mission" onClick={onBackdrop}>
      <div className="mt-mission-head">
        <b className="mt-mission-title">{t('mission.title')}</b>
        <span className="mt-mission-filters">
          {CATS.map((k) => <button key={k} className={`mt-mm-filter c-${k}${filter === k ? ' on' : ''}`} data-filter={k} onClick={() => setFilter(k)}>{k !== 'all' && <i className="mt-mm-fdot" />}{t(`mission.cat.${k}`)}<span className="mt-mm-fn">{k === 'all' ? c.all ?? '' : c[k] ?? 0}</span></button>)}
        </span>
        <span className="mt-node-sp" />
        <Legend />
        <button className="mt-x" data-action="mission-close" title={t('mission.closeTitle')} onClick={() => setMissionOpen(false)}>×</button>
      </div>
      <div className="mt-mission-body nowheel">
        {!lay ? <div className="dim" style={{ padding: 20 }}>{t('common.loading')}</div> : (
          <div className="mt-mission-canvas" style={{ width: lay.width, height: lay.height }}>
            {lay.groups.map((g) => (
              <div key={`g:${g.key}`} className={`mt-mm-group${g.collapsed ? ' shut' : ''}`} data-role="mm-group" data-key={g.key} data-collapsed={g.collapsed ? '1' : undefined} style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
                <button className="mt-mm-ghead" data-action="mm-group-toggle" title={t('mmapGroup.toggleTitle')} onClick={(ev) => { ev.stopPropagation(); toggle(g.key); }}>
                  <span className="mt-mm-gcaret" aria-label={t(g.collapsed ? 'mmapGroup.expand' : 'mmapGroup.collapse')}>{g.collapsed ? '▸' : '▾'}</span>
                  <b className="mt-mm-gname" data-role="mm-group-name">{gName(g.key)}</b>
                  <span className="mt-mm-gcount">{t('mmapGroup.sessions', { n: g.count })}</span>
                  {g.needs > 0 && <span className="mt-mm-gneeds" data-role="mm-group-needs">{t('mmapGroup.needs', { n: g.needs })}</span>}
                </button>
                {g.looseAt && <div className="mt-mm-gloose" style={{ left: g.looseAt.x - g.x, top: g.looseAt.y - g.y }}>{t('mmap.loose')}</div>}
              </div>
            ))}
            <svg className="mt-mm-svg" width={lay.width} height={lay.height}>
              <defs>
                {EDGE_ORDER.map((k) => <marker key={k} id={`mm-arrow-${k}`} className={`mt-mm-arrow k-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L10,5 L0,10 z" /></marker>)}
              </defs>
              {lay.edges.map((e) => (
                <g key={e.id} className={`mt-mm-edge k-${e.primary}${e.active ? ' active' : ''}${e.back ? ' back' : ''}${e.kinds.length > 1 ? ' multi' : ''}${e.cross ? ' cross' : ''}`} data-role="mm-edge" data-kind={e.primary} data-kinds={e.kinds.join(' ')} data-from={e.from} data-to={e.to} data-cross={e.cross ? '1' : undefined}>
                  <path className="hit" d={e.d} />
                  <path className="line" d={e.d} markerEnd={`url(#mm-arrow-${e.primary})`} />
                  {!e.label && <circle className="dot" cx={e.lx} cy={e.ly} r="3.5" />}
                  <title>{tipOf(e)}</title>
                </g>
              ))}
            </svg>
            {lay.edges.filter((e) => e.label).map((e) => (
              <span key={`l:${e.id}`} className={`mt-mm-label k-${e.primary}${e.cross ? ' cross' : ''}`} data-role="mm-label" data-kind={e.primary} style={{ left: e.lx, top: e.ly, maxWidth: MISSION.labelW }} title={tipOf(e)}>
                {edgeLabel(e, t)}
              </span>
            ))}
            {[...lay.boxes.values()].filter((b) => !b.proxy).map((b) => <Box key={b.node.id} b={b} live={b.node.sessionId ? sessions.get(b.node.sessionId) : null} onGo={go} />)}
            {lay.boxes.size === 0 && <div className="dim mt-mm-empty">{t('mission.empty')}{filter !== 'all' ? t('mission.emptyFiltered') : ''}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
