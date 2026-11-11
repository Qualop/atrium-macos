// 미션 맵(ARCH 4절 I6, P6c → P32 → P95에서 다시 그림): 덮개 화면. 왼쪽 → 오른쪽 열(나 → 리드 → 하위 세션 → 그 아래)과 오른쪽 요약 열.
// - 배치는 lib/mission-layout.js(순수 함수), 역할·관계·요약은 PC와 휴대폰이 같이 쓰는 lib/mission-model.js.
// - 틀이 없다: 워크스페이스는 옅은 머리 글(누르면 접기)과 간격으로만 나눈다. 무리 상자, 가상 그룹 띠, 팀 상자, 범례 카드를 두지 않는다(가상 그룹 이름은 머리 글 앞에).
// - 카드는 작고 정돈되게: 이름(팀 번호), 역할과 지금 하는 일 한 줄, 옅은 메타 한 줄(모델·노력 수준, 일한 시간 또는 마지막 활동, 워크트리 브랜치), 오른쪽 아래 작은 경고.
//   카드 오른쪽 끝에 종류 기호 동그라미와 상태 배지(일함 점, 응답 필요 !, 오류 ✕, 결과 ✓, 쉼은 점선 고리). 쉬는·잠든·끝난 세션은 한 줄로 물러나고(끝남은 취소선),
//   하위가 많으면 쉬는 하위들은 동그라미 줄로 접힌다.
// - 선은 이름표 없는 가는 곡선. 관계 종류는 모양(나무 밖 연결은 옅은 점선, 요청은 점 선, 다른 프로젝트는 긴 점선)과 가리킬 때 뜨는 풀이로 구별한다. 일하는 쪽으로 가는 선은 일함 색.
// - 세션(또는 요약 열의 줄)을 가리키거나 키보드로 고르면 그 세션·조상·팀·바로 이어진 세션만 또렷하다(P94). 누르면 덮개를 닫고 판의 그 노드로 간다.
// - 위 거르기는 맞지 않는 세션을 흐리게만 한다(자리는 그대로). 빈 곳을 누르거나 Esc를 누르면 닫힌다(P32). 연 동안 판이 바뀌면 다시 읽는다(mission.graph).
// - P101 다듬기: 워크스페이스마다 옅은 판(머리 글과 그 세션들을 감싸는 바탕 면), 쉬는·잠든·끝난 세션은 테두리 있는 알약, 종류 동그라미는 카드 안 오른쪽 위.
//   서로 이은 두 세션은 마주 보는 가장자리 사이 짧은 두 줄과 화살촉(lib/mission-wire.js).
// - P107: 일하는 카드는 테두리를 따라 상태 색 빛이 돈다(빛 층 .mt-mm-light: 2px 고리와 옅은 빛 무리, 원뿔 그라데이션을 transform으로만 돌린다, 2.4초에 한 바퀴·초당 30번,
//   모두 같은 박자: lib/work-light.js). 판 설정 workLight(작업 중 테두리 빛: 켬 기본 / Windows 설정 따름 / 끔, 판 노드 둘레도 따른다)를 따르고, 끔·가벼운 판에서는 멈춘 굵은 상태 색 테두리다.
//   P102 번쩍임은 걷었다(사용자: 촌스럽다).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, getState, setMissionOpen, toast, wsName } from './store.js';
import { missionLayout, mapOrder, edgeLabel, MISSION } from './lib/mission-layout.js';
import { roleModel, focusOf, teamText, roleText, nodeTier, filterMatch, FILTERS, modelText, ageText, missionSummary } from './lib/mission-model.js';
import { STATE_LABEL } from './lib/labels.js';
import { useT, errText, fmtTime } from './lib/i18n.js';
import { KindIcon } from './SessionNode.jsx';
import { onLightStart } from './lib/work-light.js';

// 빈 곳 누르기에서 빼는 것
const SOLID = '[data-role="mm-node"], [data-role="mm-edge"], [data-role="mm-summary"], button, input, select, a';
const clip = (s, n) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const branchOfLive = (live) => (live && live.git && live.git.isWorktree && live.git.branch) || null;

// 세션 하나의 보일 글: 상태 글, 지금 하는 일, 메타, 경고
function facts(n, live, m, tier, t, now, cross = false) {
  const kind = (live && (live.flavor || live.kind)) || n.agentKind || 'claude';
  const shell = kind === 'shell' || n.agentKind === 'shell';
  const cmd = live && live.shell && live.shell.atPrompt === false ? live.shell.command || (live.shell.procs || []).join(', ') : null;
  const ask = n.ask || (live && live.ask && (live.ask.summary || live.ask.kind)) || null;
  const err = live && live.error ? (live.error.message || String(live.error)) : null;
  const state = live ? live.state : n.state;
  const stateText = shell && state !== 'exited' && state !== 'sleeping' ? (cmd ? STATE_LABEL.shell_running : STATE_LABEL.shell_idle) : STATE_LABEL[state] || state || '';
  const doing = cmd ? `$ ${cmd}` : tier === 'work' && (n.lastPrompt || (live && live.lastPrompt)) ? clip(n.lastPrompt || live.lastPrompt, 90) : null;
  const role = m ? roleText(m, t) : '';
  const team = m && m.team ? teamText(m, t) : null;
  const turnAt = n.turnAt || (live && live.state === 'working' && live.turn && live.turn.startedAt) || null;
  const activeAt = n.activeAt || (live && live.lastActivityAt) || null;
  const age = tier === 'work' && turnAt ? ageText(now - turnAt, t) : activeAt ? ageText(now - activeAt, t) : null;
  const model = shell ? null : modelText(n.model || (live && live.model), n.effort || (live && live.effort));
  const branch = n.gitBranch || branchOfLive(live);
  const meta = [model, age, branch ? `⎇ ${branch}` : null, n.loops ? `⟳${n.loops}` : null].filter(Boolean).join(' · ');
  const away = cross ? t('mmMap.crossWs', { ws: wsName(n.workspaceKey) }) : null; // P101: 다른 워크스페이스의 하위 세션(부모 팀의 판 안에 놓였다)
  const warn = tier === 'turn' ? t('mmMap.warnTurn') : tier === 'alert' ? t('mmMap.warnAlert') : tier === 'review' ? t('mmMap.warnReview') : m && m.climb ? t('mmMap.warnClimb', { n: m.climb }) : null;
  // 둘째 줄: 응답 필요는 묻는 글, 오류는 오류, 팀이 있으면 팀 요약(쉬는 리드는 "워커 n 기다림"), 그 밖은 역할 · 지금 하는 일(없으면 상태)
  const line = tier === 'turn' && ask ? { k: 'ask', main: null, text: clip(ask, 120) }
    : tier === 'alert' ? { k: 'err', main: role, text: clip(err || stateText, 90) }
    : team ? { k: 'team', main: role, text: [t('mmRole.team', { n: m.team.size }), m.waiting ? t('mmRole.waiting', { n: m.waiting }) : m.team.work ? t('mmRole.teamWork', { n: m.team.work }) : null].filter(Boolean).join(' · ') }
    : { k: doing ? 'now' : 'state', main: role, text: doing || stateText };
  return { kind, shell, ask, stateText, doing, role, team, meta, warn, line, away };
}

function Avatar({ kind, tier, shell, small }) {
  const ring = tier === 'rest' || tier === 'sleep' || tier === 'done';
  const b = tier === 'work' ? (shell ? 'shell' : 'work') : tier === 'turn' || tier === 'alert' || tier === 'review' ? tier : null;
  return (
    <span className={`mt-mm-av${ring ? ' ring' : ''}${small ? ' sm' : ''}`} data-role="mm-avatar" data-badge={b || undefined}>
      <KindIcon kind={kind} />
      {b && <i className={`mt-mm-badge b-${b}`} aria-hidden="true">{b === 'turn' ? '!' : b === 'alert' ? '✕' : b === 'review' ? '✓' : ''}</i>}
    </span>
  );
}

// P107: 테두리를 따라 도는 빛 층(휴대폰 PhoneMission.jsx도 쓴다). 가리개 하나(.mt-mm-lring: 2px 고리와 그 둘레 옅은 빛 무리)가 가로로 늘린 감싸개(.mt-mm-lspin) 안의
// 원뿔을 돌린다(가리개를 둘로 나누면 카드마다 렌더 패스가 둘이라 GPU 값이 두 배였다, 작업 기록). 설정이 끔이거나 가벼운 판이면 CSS가 숨기고 층이 멈춘 굵은 테두리가 된다
export function MissionLight({ role }) {
  return (
    <span className="mt-mm-light" data-role={role} aria-hidden="true" onAnimationStart={onLightStart}>
      <i className="mt-mm-lring"><i className="mt-mm-lspin" /></i>
    </span>
  );
}

function Node({ b, live, m, tier, t, now, no, hot, recede, dim, onGo, onHot }) {
  const n = b.node;
  const f = facts(n, live, m, tier, t, now, b.cross);
  const style = { left: b.x, top: b.y, width: b.w, height: b.h };
  const st = (live && live.state) || n.state;
  const tip = [`@${n.name} · ${f.role}`, f.team, f.ask ? `${t('mmap.ask')} ${f.ask}` : null, n.lastPrompt ? `${t('mmap.prompt')} ${n.lastPrompt}` : null, b.cross ? t('mmMap.crossWs', { ws: wsName(n.workspaceKey) }) : null, f.meta || null, t('mission.goSession')].filter(Boolean).join('\n');
  const common = {
    'data-role': 'mm-node', 'data-kind': 'session', 'data-id': n.id, 'data-name': n.name, 'data-tier': tier, 'data-rank': m ? m.rank : undefined, 'data-family': m ? m.family : undefined, 'data-shape': b.kind,
    tabIndex: 0, title: tip, onClick: () => onGo(n), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(n); } },
    onMouseEnter: () => onHot(n.id), onMouseLeave: () => onHot(null), onFocus: () => onHot(n.id), onBlur: () => onHot(null),
  };
  const cls = `t-${tier}${f.shell ? ' shell' : ''}${st === 'starting' ? ' starting' : ''}${hot ? ' hot' : ''}${recede ? ' recede' : ''}${dim ? ' fdim' : ''}`;
  if (b.kind === 'dot') return <div className={`mt-mm-dot ${cls}`} style={style} {...common}><Avatar kind={f.kind} tier={tier} shell={f.shell} small /></div>;
  if (b.kind === 'row') return (
    <div className={`mt-mm-row ${cls}`} style={style} {...common}>
      <span className="o" aria-hidden="true" /><span className="nm">{n.name}</span>
      {m && m.rank !== 'solo' && <span className="rl" data-role="mm-role">{f.role}</span>}
      <Avatar kind={f.kind} tier={tier} shell={f.shell} small />
    </div>
  );
  return (
    <div className={`mt-mm-card ${cls}${m && m.team ? ' lead' : ''}`} style={style} {...common}>
      {tier === 'work' && <MissionLight role="mm-light" />}
      <div className="mt-mm-c1">{no ? <span className="mt-mm-no" data-role="mm-team-no">{no}</span> : null}<b className="mt-mm-name">{n.name}</b></div>
      <div className={`mt-mm-c2 k-${f.line.k}`} data-role={f.line.k === 'ask' ? 'mm-ask' : f.line.k === 'team' ? 'mm-team' : 'mm-line'}>
        {f.line.main ? <b data-role="mm-role">{f.line.main}</b> : null}{f.line.main && f.line.text ? ' · ' : null}{f.line.text}
      </div>
      <div className="mt-mm-c3"><span className="mt-mm-meta" data-role="mm-meta">{[f.away ? `↗ ${f.away}` : null, f.meta || (f.shell ? t('mmMap.noModel') : '')].filter(Boolean).join(' · ')}</span>{f.warn ? <span className="mt-mm-warn" data-role="mm-warn">{f.warn}</span> : null}</div>
      <Avatar kind={f.kind} tier={tier} shell={f.shell} />
    </div>
  );
}

export function MissionMap() {
  const t = useT();
  const open = useStore((st) => st.missionOpen);
  const sessions = useStore((st) => st.sessions);
  const links = useStore((st) => st.links);
  const thread = useStore((st) => st.thread);
  const loops = useStore((st) => st.loops);
  const workspaces = useStore((st) => st.workspaces);
  const vgroups = useStore((st) => st.groups); // P44 가상 그룹
  const [graph, setGraph] = useState(null);
  const [filter, setFilter] = useState('all');
  const [shut, setShut] = useState(() => new Set()); // 접은 워크스페이스 키
  const [hot, setHot] = useState(null); // 가리키거나 키보드로 고른 세션 id
  const [width, setWidth] = useState(1300); // 지도 칸 폭(혼자인 워크스페이스를 채울 열 수)
  const bodyRef = useRef(null);
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
  useEffect(() => { if (!open) setHot(null); }, [open]);
  // 지도 칸 폭: 40px 단위로만 바꿔 다시 놓기를 줄인다
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!open || !el) return undefined;
    const read = () => { const w = Math.max(480, Math.round(el.clientWidth / 40) * 40); setWidth((v) => (v === w ? v : w)); };
    read();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', read);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', read); };
  }, [open, !!graph]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = useMemo(() => (workspaces || []).map((w) => w.key), [workspaces]);
  const liveOf = (n) => (n && n.sessionId ? sessions.get(n.sessionId) : null);
  const tiers = useMemo(() => new Map(graph ? graph.nodes.filter((n) => n.kind === 'session').map((n) => [n.id, nodeTier(n, liveOf(n))]) : []), [graph, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const lay = useMemo(() => (graph ? missionLayout(graph, { collapsed: [...shut], order, vgroups, tiers, width }) : null), [graph, shut, order, vgroups, tiers, width]);
  const roles = useMemo(() => (graph && lay ? roleModel(graph, { tiers, tree: lay.tree }) : new Map()), [graph, lay, tiers]);
  const focus = useMemo(() => (lay && hot ? focusOf(lay.tree, hot, lay.edges.filter((e) => e.rel === 'human')) : null), [lay, hot]);
  const ids = useMemo(() => (lay ? mapOrder(lay) : []), [lay]);
  const sum = useMemo(() => missionSummary(lay ? lay.tree.nodes.map((n) => n.id).sort((a, b) => (ids.indexOf(a) + 1 || 1e9) - (ids.indexOf(b) + 1 || 1e9)) : [], (id) => tiers.get(id)), [lay, ids, tiers]);
  if (!open) return null;

  const now = Date.now();
  const gName = (key) => (key ? wsName(key) : t('mmapGroup.noWorkspace'));
  const toggle = (key) => setShut((cur) => { const n = new Set(cur); if (n.has(key)) n.delete(key); else n.add(key); return n; });
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
  const nameOf = (id) => { const n = lay && lay.tree.byId.get(id); return n ? n.name : id === 'human' ? t('mmMap.you') : id; };
  const tipOf = (e) => {
    const rel = e.rel === 'human' ? t('mmRole.relHuman') : e.cross ? t('mmRole.relCross') : t(`mmRole.${{ spawn: 'relSpawn', role: 'relRole', prompt: 'relPrompt' }[e.rel] || 'relRole'}`);
    const who = e.from.startsWith('g:') || e.to.startsWith('g:') || e.to.startsWith('dots:') ? null : t('mmMap.edgeTip', { from: nameOf(e.from), to: nameOf(e.to) });
    return [who, `${rel}${e.role ? ` · ${e.role}` : ''}`, e.cross ? `${t('mmapGroup.crossTitle')}` : null, e.text ? `“${e.text}”` : null, e.count > 1 ? edgeLabel(e, t) : null, e.lastAt ? t('mission.edgeLast', { time: fmtTime(e.lastAt) }) : null].filter(Boolean).join('\n');
  };
  const edgeHot = (e) => !!focus && (focus.pairs.has(e.id) || (e.members || []).some((x) => focus.pairs.has(x)));
  const fdim = (id) => filter !== 'all' && !filterMatch(tiers.get(id), filter);
  const counts = sum.counts;
  const catN = { all: counts.all, needs_you: counts.turn, working: counts.work, idle: counts.idle, done: counts.review, exited: counts.gone };
  const boxes = lay ? [...lay.boxes.values()] : [];
  const dotLabels = boxes.filter((b) => b.kind === 'dots');
  const sumItem = (id, text) => {
    const n = lay.tree.byId.get(id), tier = tiers.get(id), no = lay.teamNo.get(id);
    return (
      <button key={id} type="button" className={`mt-mm-si t-${tier}${hot === id ? ' hot' : ''}`} data-role="mm-sum-item" data-name={n.name} onClick={() => go(n)} onMouseEnter={() => setHot(id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(id)} onBlur={() => setHot(null)}>
        <span className="a"><i className="dot" aria-hidden="true" />{no ? <span className="mt-mm-no">{no}</span> : null}<span className="nm">{n.name}</span></span>
        {text ? <span className="b">{text}</span> : null}
      </button>
    );
  };
  const nowText = (id) => {
    const n = lay.tree.byId.get(id), live = liveOf(n), m = roles.get(id);
    const f = facts(n, live, m, tiers.get(id), t, now);
    return f.doing ? t('mmMap.sumNow', { text: f.doing }) : f.team ? `${f.role} · ${f.team}` : f.role ? `${f.role} · ${f.stateText}` : f.stateText;
  };
  const askText = (id) => { const n = lay.tree.byId.get(id), live = liveOf(n); const f = facts(n, live, roles.get(id), tiers.get(id), t, now); return f.line.k === 'ask' || f.line.k === 'err' ? f.line.text : f.stateText; };
  const REST_MAX = 24;
  return (
    <div className="mt-mission" data-role="mission" onClick={onBackdrop}>
      <div className="mt-mission-head">
        <b className="mt-mission-title">{t('mission.title')}</b>
        <span className="mt-mission-filters" role="tablist">
          {FILTERS.map((k) => <button key={k} role="tab" aria-selected={filter === k} className={`mt-mm-filter c-${k}${filter === k ? ' on' : ''}`} data-filter={k} data-n={catN[k] || 0} onClick={() => setFilter(k)}>{t(`mission.cat.${k}`)}<span className="mt-mm-fn">{catN[k] ?? 0}</span></button>)}
        </span>
        <span className="mt-node-sp" />
        <button className="mt-x" data-action="mission-close" title={t('mission.closeTitle')} onClick={() => setMissionOpen(false)}>×</button>
      </div>
      <div className="mt-mission-main">
        <div className={`mt-mission-body nowheel${focus ? ' focusing' : ''}`} ref={bodyRef}>
          {!lay ? <div className="dim" style={{ padding: 20 }}>{t('common.loading')}</div> : (
            <div className="mt-mission-canvas" style={{ width: lay.width, height: lay.height }}>
              {lay.groups.map((g) => <div key={`p:${g.key}`} className={`mt-mm-plate${g.collapsed ? ' shut' : ''}`} data-role="mm-plate" data-key={g.key} style={{ left: g.plate.x, top: g.plate.y, width: g.plate.w, height: g.plate.h }} />)}
              {lay.groups.map((g) => (
                <button key={`g:${g.key}`} type="button" className={`mt-mm-ws${g.collapsed ? ' shut' : ''}`} data-role="mm-group" data-key={g.key} data-collapsed={g.collapsed ? '1' : undefined} data-packed={g.packed ? '1' : undefined}
                  style={{ left: g.x, top: g.y, maxWidth: g.w }} title={t('mmapGroup.toggleTitle')} aria-expanded={!g.collapsed} onClick={(ev) => { ev.stopPropagation(); toggle(g.key); }}>
                  <span className="caret" aria-hidden="true">{g.collapsed ? '▸' : ''}</span>
                  {g.vg && <span className="vg" data-role="mm-vgroup">{g.vg.name} /</span>}
                  <span className="nm" data-role="mm-group-name">{gName(g.key)}</span>
                  <span className="n">{g.count}</span>
                  {g.needs > 0 && <span className="needs" data-role="mm-group-needs" title={t('mmapGroup.needs', { n: g.needs })}>!{g.needs}</span>}
                </button>
              ))}
              <svg className="mt-mm-svg" width={lay.width} height={lay.height}>
                {lay.edges.filter((e) => !e.quiet || edgeHot(e)).map((e) => {
                  const to = lay.boxes.get(e.to);
                  const target = to && to.node && to.node.kind === 'session' ? tiers.get(e.to) : null;
                  const hotE = edgeHot(e);
                  return (
                    <g key={e.id} className={`mt-mm-edge rel-${e.rel}${e.tree ? ' tree' : ' link'}${e.cross ? ' cross' : ''}${e.pair ? ' pair' : ''}${target === 'work' || e.active ? ' active' : ''}${target === 'turn' ? ' turn' : ''}${focus ? (hotE ? ' hot' : ' recede') : ''}`}
                      data-role="mm-edge" data-id={e.id} data-kind={e.primary} data-rel={e.rel} data-route={e.route} data-pair={e.pair ? '1' : undefined} data-from={e.from} data-to={e.to} data-cross={e.cross ? '1' : undefined} data-tree={e.tree ? '1' : undefined}>
                      <path className="hit" d={e.d} />
                      <path className="line" d={e.d} />
                      {e.tip && <path className="mt-mm-tip" d={e.tip} />}
                      <title>{tipOf(e)}</title>
                    </g>
                  );
                })}
              </svg>
              {boxes.filter((b) => b.kind === 'you').map((b) => (
                <div key="you" className={`mt-mm-you${focus && !lay.edges.some((e) => e.rel === 'human' && edgeHot(e)) ? ' recede' : ''}`} data-role="mm-node" data-kind="human" title={t('mmMap.youTitle')} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>{t('mmMap.you')}</div>
              ))}
              {dotLabels.map((b) => <span key={b.node.id} className={`mt-mm-dots-label${focus && !b.node.ids.some((x) => focus.nodes.has(x)) ? ' recede' : ''}`} style={{ left: b.x + 4 + Math.min(MISSION.dotsPerRow, b.node.ids.length) * (MISSION.dot + MISSION.dotGap) + 2, top: b.y + 4 }} data-role="mm-dots">{t('mmMap.dotsRest', { n: b.node.ids.length })}</span>)}
              {boxes.filter((b) => b.node && b.node.kind === 'session').map((b) => (
                <Node key={b.node.id} b={{ ...b, cross: b.group != null && (b.node.workspaceKey || '') !== b.group }} live={liveOf(b.node)} m={roles.get(b.node.id)} tier={tiers.get(b.node.id)} t={t} now={now} no={lay.teamNo.get(b.node.id)}
                  hot={hot === b.node.id} recede={!!focus && !focus.nodes.has(b.node.id)} dim={fdim(b.node.id)} onGo={go} onHot={setHot} />
              ))}
              {boxes.length === 0 && <div className="dim mt-mm-empty">{t('mission.empty')}</div>}
            </div>
          )}
        </div>
        {lay && (
          <aside className="mt-mm-sum" data-role="mm-summary" aria-label={t('mission.title')}>
            {sum.turn.length > 0 && <section className="mt-mm-sec turn" data-role="mm-sum-turn"><h4 className="mt-mm-sech">{t('mmMap.sumTurn')}<i>{sum.turn.length}</i></h4>{sum.turn.map((id) => sumItem(id, askText(id)))}</section>}
            <section className="mt-mm-sec" data-role="mm-sum-work"><h4 className="mt-mm-sech">{t('mmMap.sumWork')}<i>{sum.work.length}</i></h4>{sum.work.length ? sum.work.map((id) => sumItem(id, nowText(id))) : <div className="mt-mm-none">{t('mmMap.sumNone')}</div>}</section>
            {sum.review.length > 0 && <section className="mt-mm-sec" data-role="mm-sum-review"><h4 className="mt-mm-sech">{t('mmMap.sumReview')}<i>{sum.review.length}</i></h4>{sum.review.map((id) => sumItem(id, nowText(id)))}</section>}
            {sum.rest.length > 0 && (
              <section className="mt-mm-sec" data-role="mm-sum-rest"><h4 className="mt-mm-sech">{t('mmMap.sumRest')}<i>{sum.rest.length}</i></h4>
                <div className="mt-mm-rest">{sum.rest.slice(0, REST_MAX).map((id, i) => { const n = lay.tree.byId.get(id); return <span key={id}>{i ? <span className="mt-mm-sep"> · </span> : null}<button type="button" className={`mt-mm-rn t-${tiers.get(id)}`} data-role="mm-sum-rest-item" onClick={() => go(n)} onMouseEnter={() => setHot(id)} onMouseLeave={() => setHot(null)}>{n.name}</button></span>; })}
                  {sum.rest.length > REST_MAX ? <span className="mt-mm-sep"> {t('mmMap.restHidden', { n: sum.rest.length - REST_MAX })}</span> : null}</div>
              </section>
            )}
            <div className="mt-mm-foot" data-role="mm-sum-foot">
              <div>{t('mmMap.sumFoot', { work: counts.work, all: counts.all, teams: lay.teamNo.size })}</div>
              <div className="mt-mm-hint">{t('mmMap.hint')}</div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
