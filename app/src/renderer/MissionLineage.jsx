// P153 r7: 세션 맵 PC = 시안 B "Lineage"(experiments/mm-concepts/project/B.dc.html, ARCH 4절 I6). 무한 캔버스 덮개. 옛 열 지도(Mission.jsx ClassicMission)는 숨은 설정 missionStyle: classic으로만.
// - 배치는 lib/mission-lineage.js(순수 함수): 폴더 = 가로 띠(왼쪽 기둥: 이름·워크스페이스·세션 수·상태 비율 막대), 워크스페이스 = 띠 안의 줄,
//   줄마다 고정 칸(워크스페이스 · 리드 · 워커 · 다음 단계 · 솔로). 관계 선은 종류마다 모양·화살촉·작은 이름표. 왼쪽 레일은 폴더 > 워크스페이스 목차(누르면 그 줄로).
//   칸 머리는 화면 위(위 줄 아래)에 붙어 있고 끌기·확대를 따라 옮겨 간다(paint가 DOM에 바로).
// - 사용자가 정한 것(시안 B보다 이긴다): 이름 "세션 맵", 줌(− % + 맞춤)만(단계 단추·미니맵·범례·B의 오른쪽 서랍 없음), 빈 곳 눌러도 안 닫힘(닫기 Esc·단추),
//   늘 떠 있는 명령줄(CommandBar), 카드 누르기 = 명령줄 @태그(여럿, 다시 누르면 뺌), 맵 안에서 친 글자 = 명령줄, 더블클릭·Enter = 판의 그 세션으로(첫 클릭 태그는 되돌림),
//   워크스페이스 줄 머리를 Alt+끌기로 다른 폴더 띠에 놓으면 그 폴더로(group.move, 띠 밖·폴더 없음 띠 = 폴더 없음. P155: Alt 없이 끌면 늘 시점 이동),옛 지도의 작업 완료 꼬리표, 판과 같은 배경, 앱 기본 글꼴(강조는 굵기),
//   작업 중 테두리 빛(P107), 처음 열 때 읽힘(폭 맞춤으로 위에서부터), 사이드바 소속, 역할로 이어진 무리, 무채색(제목·바탕에 색 없음, 색은 상태와 선 종류만).
// - 성능: 보기는 ref, 세계 한 요소의 transform만 바꾼다. 확대 단계 클래스(lv-far 등)·배율 글·칸 머리 자리·배경 격자는 DOM에 바로. 멀리 타일 글 하한(--ik)은 멈춘 뒤에.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, getState, setMissionOpen, toast, wsName } from './store.js';
import { lineageLayout, headDrag, relationDrop, relationCall, applyRelationStub, LINE } from './lib/mission-lineage.js'; // P155: headDrag(Alt+끌기만 옮기기)
import { levelOf, zoomAt, wheelK, panBy, fitView, centerOn, pressIntent, viewKey, stepCard, ZOOM } from './lib/mission-terr.js';
import { roleModel, nodeTier, roleText, modelText, ageText } from './lib/mission-model.js';
import { kindOf } from './lib/kinds.js';
import { bgShow, bgText, bgKindsText } from './lib/bg-work.js'; // P164
import { STATE_LABEL } from './lib/labels.js';
import { useT, errText } from './lib/i18n.js';
import { leadTags } from './lib/cmd-input.js';
import { MissionLight, DoneMark } from './Mission.jsx';
import { commandDraft } from './Thread.jsx';

const TOPH = 52; // 위 줄(세션 맵 머리) 높이(보기 칸 기준)
const COLH = 34; // 칸 머리 띠 높이
const RAIL = 0; // P153 r9: 목차 레일은 없앴다(앱 사이드바를 같이 쓴다)
const BOTTOM = 112; // 아래 명령줄 자리
const PAD = 16;
const OPEN_MAX = 0.85; // 처음 화면(폭 맞춤) 배율 상한
const READ_K = 0.26; // 멀리 타일 이름 11.5px·상태 10px(화면)가 지켜지는 배율 하한(폭 맞춤이 이보다 작으면 이 배율로 왼쪽 위에서)
const DOT_GAP = 92, DOT_R = 1.8, DOT_MIN_GAP = 28; // 판 배경 점 격자(Canvas.jsx DOT_GAP, 점 지름 3.6)와 같다. 멀리서는 솎는다
const ATTN_MAX = 4;
const clip = (s, n) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
// P164: 뒤 일 표시 아이콘(겹친 두 사각형 = 뒤에서 도는 일). 움직이지 않는다
export const BgIcon = () => <svg className="mt-bg-ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="2.5" width="8" height="8" rx="1.5" /><path d="M10.5 13.5h-6a2 2 0 0 1-2-2v-6" /></svg>;
export function BgBadge({ f, role }) { return f.bg ? <span className="mt-bg-badge" data-role={role} data-bg-n={f.bg.n} data-bg-kinds={f.bg.kinds.join(',')} title={f.bgKinds}><BgIcon />{f.bgText}</span> : null; }
// P164: 미리 보기의 뒤 일 목록(종류와 설명·명령 한 줄)
export function BgList({ f, t }) {
  if (!f.bg) return null;
  return <div className="pkbg" data-role="ln-peek-bg"><span className="lb">{t('mmBg.title')}</span>{f.bgKinds}{(f.bg.items || []).map((x, i) => <span key={i} className="it"><BgIcon /><b>{t(`mmBg.kind.${['shell', 'agent'].includes(x.kind) ? x.kind : 'other'}`)}</b>{x.label ? <span className="lbl">{clip(x.label, 120)}</span> : <span className="dim">{t('mmBg.noLabel')}</span>}</span>)}</div>;
}
const branchOfLive = (live) => (live && live.git && live.git.isWorktree && live.git.branch) || null;
// 상태 색 클래스(시안 st-*): 등급 → 색
const ST = { turn: 'needs', alert: 'error', work: 'working', review: 'done', rest: 'ready', sleep: 'sleeping', done: 'exited' };
const IDLE = new Set(['rest', 'sleep', 'done']);
const KINDS = ['spawn', 'role', 'prompt', 'cross'];
// P153 r11: 깊이 접기를 편 카드(맵 노드 id)는 창에 기억한다(다시 열어도 그 가지만 펴져 있다)
const EXP_KEY = 'atrium.sessionMap.expanded';
const loadExpanded = () => { try { const a = JSON.parse(localStorage.getItem(EXP_KEY) || '[]'); return new Set(Array.isArray(a) ? a.slice(0, 200) : []); } catch { return new Set(); } };
const saveExpanded = (s) => { try { localStorage.setItem(EXP_KEY, JSON.stringify([...s].slice(-200))); } catch { /* 기억 못 해도 지금 화면은 된다 */ } };
// P153 r12: 놓자마자 보이는 관계(판 답을 기다리는 동안, applyRelationStub = P156 그래프 모양)는 두 세션 쌍마다 하나
const relKey = (x) => [x.a, x.b].sort().join('|');
const putRel = (list, x) => [...list.filter((y) => relKey(y) !== relKey(x)), x];

// 카드 사실(보통 단계 줄들, 풍선 도움말, 휴대폰 시트가 같이 쓴다)
export function cardFacts(n, live, m, tier, t, now, { parentName = null, parentWs = null, cross = false, kids = 0 } = {}) {
  const kind = (live && (live.flavor || live.kind)) || n.agentKind || 'claude';
  const k = kindOf(kind);
  const shell = k.id === 'shell';
  const state = live ? live.state : n.state;
  const cmd = live && live.shell && live.shell.atPrompt === false ? live.shell.command || (live.shell.procs || []).join(', ') : null;
  const stateText = tier === 'review' ? t('doneMark.tag') : shell && state !== 'exited' && state !== 'sleeping' ? (cmd ? STATE_LABEL.shell_running : STATE_LABEL.shell_idle) : STATE_LABEL[state] || state || '';
  const turnAt = n.turnAt || (live && live.state === 'working' && live.turn && live.turn.startedAt) || null;
  const activeAt = n.activeAt || (live && live.lastActivityAt) || null;
  const age = tier === 'work' && turnAt ? ageText(now - turnAt, t) : activeAt ? ageText(now - activeAt, t) : null;
  const model = shell ? null : live && live.model ? modelText(live.model, live.effort) : modelText(n.model, n.effort);
  // P157: 하위를 불렀던 세션(닫힌 하위·최근 지시)·상위가 닫힌 세션은 솔로가 아니다. 역할 자리에 작게 그 까닭
  const called = n.closedKids ? t('mmLine.closedKids', { n: n.closedKids }) : n.assignAt ? t('mmLine.assigned') : n.parentClosed ? t('mmLine.parentClosed') : null;
  const role = m ? (m.rank === 'solo' ? ((n.peers || []).length ? t('mmLine.peer') : called || t('mmTerr.solo')) : roleText(m, t, { short: true })) : ''; // r11: 정한 동료는 '동료'
  const lp = n.lastPrompt || (live && live.lastPrompt) || null;
  const ask = n.ask || (live && live.ask && (live.ask.summary || live.ask.kind)) || null;
  const err = live && live.error ? (live.error.message || String(live.error)) : n.error || null;
  let taskKind, task;
  if (tier === 'work') { taskKind = 'now'; task = cmd ? `$ ${cmd}` : lp; }
  else if (tier === 'turn') { taskKind = 'ask'; task = ask || lp; }
  else if (tier === 'alert') { taskKind = 'fail'; task = lp || ask; }
  else if (tier === 'review') { taskKind = 'did'; task = lp; }
  else { taskKind = 'last'; task = lp; }
  const rel = parentName ? t(`mmTerr.rel.${['spawn', 'role', 'prompt'].includes(n._rel) ? n._rel : 'spawn'}`, { name: parentName }) : kids ? t('mmTerr.leads', { n: kids }) : t('mmTerr.rel.none');
  const relText = cross && parentWs ? t('mmTerr.rel.inWs', { text: rel, ws: parentWs }) : rel;
  const branch = n.gitBranch || branchOfLive(live);
  // 카드 맨 아래 줄은 다른 워크스페이스에서 온 것(선이 멀리 간다)·브랜치·루프만(풍선 도움말 relAll에는 관계 전부)
  const extra = [branch ? `⎇ ${branch}` : null, n.loops ? `⟳${n.loops}` : null];
  const more = [cross && parentWs ? relText : null, ...extra].filter(Boolean).join(' · ');
  const relAll = [relText, ...extra].filter(Boolean).join(' · ');
  const bg = bgShow(n, live, tier); // P164: 쉬는 세션에 도는 뒤 일(뒤 셸·뒤 하위 에이전트)
  return { kind, k, shell, state, stateText, age, model, role, taskKind, task: task ? clip(task, 200) : null, err: tier === 'alert' && err ? clip(err, 200) : null, more, relAll, harness: k.label, bg, bgText: bg ? bgText(bg, t) : null, bgKinds: bg ? bgKindsText(bg, t) : null };
}

// 카드 하나. 멀리 타일(이름·상태)과 보통 사실을 둘 다 그리고 단계 클래스(.lv-far 등)로 갈아 끼운다
// P157: 카드에는 브라우저 풍선(title)을 달지 않는다. 마우스를 올리면 미리 보기(Peek) 하나만 뜬다(전에는 둘이 함께 떴다). 같은 사실은 aria-label에
export const Card = memo(function Card({ id, b, f, tier, lead, tagged, onTag, onOpen, onHover, t, unfold = false, onFold = null }) {
  const n = b.node;
  const st = ST[tier] || 'ready';
  const cls = `mt-ta-slot st-${st}${f.shell ? ' shell' : ''}${IDLE.has(tier) ? ' idle' : ''}${lead ? ' lead' : ''}${tagged ? ' tagged' : ''}${b.thin ? ' thin' : ''}`;
  const tip = [`@${n.name}${f.role ? ` · ${f.role}` : ''}`, `${f.stateText}${f.age ? ` · ${f.age}` : ''}`, [f.harness, f.model].filter(Boolean).join(' · '), f.task ? `${t(`mmTerr.kind.${f.taskKind}`)}: ${f.task}` : null, f.bg ? `${f.bgText} (${f.bgKinds})` : null, f.err, f.relAll, t(f.shell ? 'mmTerr.cardTipShell' : 'mmTerr.cardTip'), t('mmLine.cardDragTip')].filter(Boolean).join('\n');
  const done = tier === 'review';
  return (
    <div className={cls} style={{ left: b.x, top: b.y, width: b.w, height: b.h }} data-role="ta-slot" data-id={id} data-tier={tier} data-ws={b.ws} data-thin={b.thin ? '1' : undefined}>
      <div className="mt-ta-card" role="button" tabIndex={0} aria-pressed={tagged ? 'true' : 'false'} data-role="mm-node" data-kind="session" data-id={id} data-name={n.name} data-tier={tier} data-tagged={tagged ? '1' : undefined} aria-label={tip.replace(/\n/g, ', ')}
        onClick={(e) => onTag(id, e)} onDoubleClick={() => onOpen(id, true)} onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(id, e.currentTarget)} onPointerLeave={() => onHover(null)} onFocus={(e) => onHover(id, e.currentTarget)} onBlur={() => onHover(null)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen(id); } else if (e.key === ' ') { e.preventDefault(); onTag(id); } }}>
        {/* P163: 얇은 줄(하위 많은 리드 아래 절전 하위) = 상태 점 + 이름 + 지난 시간 한 줄. 조작은 카드와 같다 */}
        {b.thin ? <span className="mt-sm-thin" data-role="ta-thin"><i /><span className="cname" data-role="ta-name">{n.name}</span>{f.age ? <span className="cago">{f.age}</span> : null}</span> : null}
        {tier === 'work' && <MissionLight role="ta-light" />}
        {done && <span className="mt-mm-donetag" data-role="mm-done"><DoneMark />{t('doneMark.tag')}</span>}
        {!b.thin && <span className="mt-ta-tile" aria-hidden="true"><span className="tn">{n.name}</span><span className="ts">{done ? <span className="dim">{f.age || ''}</span> : <><i />{f.stateText}</>}{f.bg ? <span className="mt-bg-tile" data-role="ta-bg-tile"><BgIcon />{f.bg.n}</span> : null}</span></span>}
        {!b.thin && <span className="mt-ta-full">
          <span className="c1">{lead ? <span className="mt-sm-lead">{t('mmLine.lead')}</span> : null}<span className="cname" data-role="ta-name">{n.name}</span><span className="cst" data-role="ta-state">{done ? (f.age ? <span className="cago">{f.age}</span> : null) : <><i />{f.stateText}{f.age ? <span className="cago"> · {f.age}</span> : null}</>}</span><BgBadge f={f} role="ta-bg" /></span>
          <span className="c2" data-role="ta-meta">{f.role ? <span className="crole">{f.role}</span> : null}{f.role ? <span className="dotsep">/</span> : null}<span className="hb">{f.k.mark}</span><span>{f.harness}</span>{f.model ? <><span className="dotsep">/</span><span>{f.model}</span></> : null}</span>
          <span className={`c3${f.err ? ' one' : ''}`} data-role="ta-task">{f.task ? <b>{t(`mmTerr.kind.${f.taskKind}`)}</b> : null}{f.task || t('mmMap3.noTask')}</span>
          {f.err ? <span className="cerr" data-role="ta-err">{f.err}</span> : null}
          {f.more ? <span className="c4" data-role="ta-more">{f.more}</span> : null}
        </span>}
        {/* P153 r11: 깊이 접기 칩. 누르면 이 가지만 펴거나 다시 접는다(카드 태그·판으로 가기와 따로) */}
        {onFold && (b.fold > 0 || unfold) ? (
          <button type="button" className={`mt-sm-fold${unfold ? ' open' : ''}`} data-action="ln-fold" data-id={id} title={t(unfold ? 'mmLine.unfoldTip' : 'mmLine.foldTip')}
            onClick={(e) => { e.stopPropagation(); onFold(id); }} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}>
            {unfold ? t('mmLine.unfold') : t('mmLine.fold', { n: b.fold })}
          </button>
        ) : null}
      </div>
    </div>
  );
});

// P153 r8: 카드 미리 보기(마우스를 HOVER_MS 올리거나 키보드 초점). 카드 옆에 뜨고 마우스를 받지 않는다(누르기·끌기는 그대로 카드·판으로).
// 사실은 카드 사실 + 판의 세션 요약(마지막 답, 질문과 선택지, 오류) + 최근 이벤트 몇 개 + 깨어 있는 세션이면 터미널 지금 화면 끝줄(읽기만, 화면만 읽음 P136, 휠 보고 없음).
// 절전·끝난 세션은 저장된 정보만(터미널을 읽지 않는다). 이벤트·화면은 처음 볼 때 읽고 PEEK_TTL 동안 담아 둔다
const HOVER_MS = 500, PEEK_TTL = 4000, PEEK_LINES = 10;
const peekCache = new Map(); // sessionId → { at, events, screen }
const lastLines = (text, n) => String(text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).slice(-n);
export function Peek({ pv, f, b, live, tier, t, now, folder }) { // P160·P166: 휴대폰 세션 맵의 길게 누르기 미리 보기도 같은 내용(PhoneMap.jsx)
  const sid = b.node.sessionId;
  const awake = !!live && !['sleeping', 'exited'].includes(live.state) && !String(sid).startsWith('fk-');
  const [data, setData] = useState(() => peekCache.get(sid) || null);
  useEffect(() => {
    const hit = peekCache.get(sid);
    if (hit && Date.now() - hit.at < PEEK_TTL) { setData(hit); return undefined; }
    let alive = true;
    const real = !String(sid).startsWith('fk-');
    Promise.all([
      real ? api.call('session.events', { session: sid, limit: 6 }).catch(() => []) : Promise.resolve([]),
      awake ? api.call('terminal.snapshot', { session: sid, format: 'text' }).then((r) => lastLines(r && r.text, PEEK_LINES)).catch(() => null) : Promise.resolve(null),
    ]).then(([events, screen]) => { const d = { at: Date.now(), events: (events || []).slice(-4), screen }; peekCache.set(sid, d); if (alive) setData(d); });
    return () => { alive = false; };
  }, [sid, awake]);
  const ask = live && live.ask;
  const qs = ask && ask.kind === 'question' ? (ask.questions || []) : [];
  const answer = live && live.lastAnswer;
  const err = f.err || (live && live.error && (live.error.message || String(live.error))) || null;
  const task = (b.node.lastPrompt || (live && live.lastPrompt) || f.task || '').trim();
  const st = ST[tier] || 'ready';
  return (
    <div className={`mt-sm-peek st-${st}`} data-role="ln-peek" data-id={pv.id} style={{ left: pv.x, top: pv.y, width: pv.w }} aria-hidden="true">
      <div className="pk1"><b>{b.node.name}</b><span className="pst"><i />{f.stateText}{f.age ? <span className="dim"> · {f.age}</span> : null}</span></div>
      <div className="pk2">{[f.role, [f.harness, f.model].filter(Boolean).join(' · '), folder].filter(Boolean).join('  ·  ')}</div>
      {task ? <div className="pkt"><span className="lb">{t(`mmTerr.kind.${f.taskKind}`)}</span>{clip(task, 600)}</div> : null}
      {qs.length ? qs.slice(0, 2).map((q, i) => <div key={i} className="pkq"><span className="lb">{t('mmPeek.asks')}</span>{q.question}{(q.options || []).length ? <span className="opts">{q.options.slice(0, 6).map((o, j) => <span key={j}>{o.label || String(o)}</span>)}</span> : null}</div>) : ask && ask.summary ? <div className="pkq"><span className="lb">{t('mmPeek.asks')}</span>{ask.summary}</div> : null}
      <BgList f={f} t={t} />
      {err ? <div className="pke">{clip(err, 400)}</div> : null}
      {answer ? <div className="pka"><span className="lb">{t('mmPeek.answer')}</span><span className="txt">{clip(answer, 400)}</span></div> : null}
      {data && data.events && data.events.length ? <div className="pkv"><span className="lb">{t('mmPeek.events')}</span>{data.events.slice().reverse().map((e) => <span key={e.id} className="ev">{e.kind}{e.data && e.data.to ? ` → ${STATE_LABEL[e.data.to] || e.data.to}` : e.data && e.data.command ? ` ${clip(e.data.command, 40)}` : ''}<span className="dim"> · {ageText(now - e.t, t)}</span></span>)}</div> : null}
      {awake ? (data && data.screen ? <pre className="pks" data-role="ln-peek-screen">{data.screen.join('\n')}</pre> : <div className="pkn dim">{data ? t('mmPeek.noScreen') : t('common.loading')}</div>) : <div className="pkn dim" data-role="ln-peek-asleep">{t('mmPeek.asleep')}</div>}
    </div>
  );
}

const FolderIcon = () => <svg className="mt-ta-iico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10l2 2.5h6.5A1.5 1.5 0 0 1 20 8v10.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" /></svg>;
const XIcon = ({ s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true" className="mt-ta-x"><path d="M6 6l12 12M18 6L6 18" /></svg>;
// 글자 키인가(명령줄로 보낼 것): 한 글자 키, 또는 IME 조합 시작(Process)
const typedKey = (e) => !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Process' || (e.key && e.key.length === 1));

export function LineageMap() {
  const t = useT();
  const open = useStore((st) => st.missionOpen);
  const sessions = useStore((st) => st.sessions);
  const links = useStore((st) => st.links);
  const thread = useStore((st) => st.thread);
  const loops = useStore((st) => st.loops);
  const workspaces = useStore((st) => st.workspaces);
  const vgroups = useStore((st) => st.groups);
  const [graph, setGraph] = useState(null);
  const [tags, setTags] = useState([]); // 명령줄 앞머리 태그 이름들
  const [vsize, setVsize] = useState(null); // 보기 칸 크기 { w, h }
  const [moveWs, setMoveWs] = useState(null); // 끄는 중인 줄 키
  const [pv, setPv] = useState(null); // 미리 보기 { id, x, y, w }(덮개 기준)
  const pvRef = useRef(null), hoverTimer = useRef(0);
  pvRef.current = pv;
  const rootRef = useRef(null), vpRef = useRef(null), worldRef = useRef(null), pctRef = useRef(null), bgRef = useRef(null), colsRef = useRef(null);
  const view = useRef(null); // { k, x, y }
  const fitted = useRef(false);
  const moveTimer = useRef(0), glideTimer = useRef(0);
  const justDragged = useRef(false);
  const layRef = useRef(null), sizeRef = useRef(null);
  const [expanded, setExpanded] = useState(loadExpanded); // 깊이 접기를 편 카드
  const [pending, setPending] = useState([]); // 놓자마자 보이는 관계(판 답을 기다리는 동안). [{ a, b, relation, ok }]
  const [reloadN, setReloadN] = useState(0);
  const onFold = useCallback((id) => setExpanded((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); saveExpanded(n); return n; }), []);

  useEffect(() => {
    if (!open) { setGraph(null); fitted.current = false; view.current = null; return undefined; }
    let alive = true;
    // 판이 바꾼 관계가 든 새 그래프가 오면 답을 받은(ok) 놓기 흉내는 걷는다
    const timer = setTimeout(() => api.call('mission.graph').then((g) => { if (!alive) return; setGraph(g); setPending((p) => (p.some((x) => x.ok) ? p.filter((x) => !x.ok) : p)); }).catch((e) => toast(t('mission.fail', { error: errText(e) }), 'error')), graph ? 300 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, sessions, links, thread, loops, reloadN]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onText = (e) => { const next = leadTags(e.detail); setTags((cur) => (cur.join('\n') === next.join('\n') ? cur : next)); };
    commandDraft.addEventListener('text', onText);
    return () => commandDraft.removeEventListener('text', onText);
  }, []);
  // P153 r12: 다른 곳(에이전트 atrium child --peer, 다른 창)에서 관계가 바뀌면 그래프를 다시 읽는다
  useEffect(() => (open ? api.on('relation.updated', () => setReloadN((n) => n + 1)) : undefined), [open]);

  const order = useMemo(() => (workspaces || []).map((w) => w.key), [workspaces]);
  const liveOf = (n) => (n && n.sessionId ? sessions.get(n.sessionId) : null);
  const tiers = useMemo(() => new Map(graph ? graph.nodes.filter((n) => n.kind === 'session').map((n) => [n.id, nodeTier(n, liveOf(n))]) : []), [graph, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => new Map((workspaces || []).map((w) => [w.key, wsName(w.key)])), [workspaces]);
  // 판 그래프 + 답을 기다리는 놓기(pending). 판이 받은 관계는 판 그래프(P156)에 들어 있다
  const g2 = useMemo(() => (graph ? applyRelationStub(graph, pending) : null), [graph, pending]);
  const lay = useMemo(() => (g2 ? lineageLayout(g2, { order, vgroups, tiers, names, noFolder: t('mmTerr.noFolder'), expanded, spineText: (w, n) => [t('mmTerr.workspaces', { n: w }), t('mmTerr.sessions', { n })] }) : null), [g2, order, vgroups, tiers, names, t, expanded]);
  const roles = useMemo(() => (g2 && lay ? roleModel(g2, { tiers, tree: lay.tree }) : new Map()), [g2, lay, tiers]);
  layRef.current = lay;
  sizeRef.current = vsize;
  const now = Date.now();
  const relOfChild = useMemo(() => { const m = new Map(); if (lay) for (const e of lay.edges) if (e.tree) m.set(e.to, e.rel); return m; }, [lay]);
  const factsOf = useCallback((id) => {
    const b = lay.cards.get(id), n = b.node, m = roles.get(id);
    const pid = m && m.parentId, p = pid ? lay.tree.byId.get(pid) : null;
    const pws = p ? p.workspaceKey || '' : null;
    return cardFacts({ ...n, _rel: relOfChild.get(id) }, liveOf(n), m, tiers.get(id), t, now, { parentName: p ? p.name : null, parentWs: p ? (pws ? wsName(pws) : t('mmapGroup.noWorkspace')) : null, cross: !!p && pws !== (n.workspaceKey || ''), kids: (lay.tree.kids.get(id) || []).length });
  }, [lay, roles, tiers, sessions, t, relOfChild]); // eslint-disable-line react-hooks/exhaustive-deps
  const tagSet = useMemo(() => new Set(tags.map((x) => x.toLowerCase())), [tags]);

  // ---- 보기 쓰기(DOM에 바로) ----
  const paint = useCallback((v, { glide = false } = {}) => {
    view.current = v;
    clearTimeout(hoverTimer.current);
    if (pvRef.current) { pvRef.current = null; setPv(null); } // 끌거나 확대하면 미리 보기는 비킨다
    const w = worldRef.current, root = rootRef.current;
    const lv = levelOf(v.k);
    if (w) {
      if (glide) { w.classList.add('glide'); clearTimeout(glideTimer.current); glideTimer.current = setTimeout(() => w.classList.remove('glide'), 480); } else w.classList.remove('glide');
      w.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
      if (!w.classList.contains(`lv-${lv}`)) { w.classList.remove('lv-far', 'lv-mid', 'lv-near'); w.classList.add(`lv-${lv}`); }
      if (root && root.dataset.level !== lv) root.dataset.level = lv;
    }
    // 배경 점은 세계의 형제 층(.mt-ta-bg)에 쓴다(세계를 감싼 요소에 변수를 쓰면 카드 전부의 스타일을 다시 센다)
    const bg = bgRef.current;
    // P153 r8: 점은 화면에서 크기가 정해져 있다(지름 DOT_R·배율, 1~1.8px). 멀리 줄이면 간격이 DOT_MIN_GAP보다 좁아지지 않게 두 배씩 솎고 옅게 한다(촘촘한 회색 무늬가 되지 않게)
    if (bg) {
      let gs = DOT_GAP * v.k; while (gs < DOT_MIN_GAP) gs *= 2;
      bg.style.backgroundSize = `${gs}px ${gs}px`; bg.style.backgroundPosition = `${v.x % gs - gs / 2}px ${v.y % gs - gs / 2}px`;
      bg.style.setProperty('--dot-r', `${Math.min(DOT_R, Math.max(1, DOT_R * v.k))}px`);
      bg.style.opacity = String(Math.max(0.45, Math.min(1, v.k / 0.5)));
    }
    // 칸 머리: 세계 칸 x를 화면으로(레일 오른쪽 띠 안의 자리)
    const cs = colsRef.current, L = layRef.current;
    if (cs && L) L.cols.forEach((c, i) => { const el = cs.children[i]; if (el) el.style.transform = `translateX(${Math.round(c.x * v.k + v.x - RAIL)}px)`; });
    // 멀리 타일 글 하한(--ik = 1/배율): 움직이는 동안은 그대로, 멈춘 뒤(160ms)·처음·미끄러지기 때 한 번
    const setIk = () => { const ww = worldRef.current, kk = view.current && view.current.k; if (!ww || !kk || levelOf(kk) !== 'far') return; const ik = (1 / kk).toFixed(3); if (ww.style.getPropertyValue('--ik') !== ik) ww.style.setProperty('--ik', ik); };
    if (w && lv === 'far' && (glide || !w.style.getPropertyValue('--ik'))) setIk();
    if (pctRef.current) pctRef.current.textContent = `${Math.round(v.k * 100)}%`;
    if (root && !glide) { if (root.dataset.moving !== '1') root.dataset.moving = '1'; clearTimeout(moveTimer.current); moveTimer.current = setTimeout(() => { delete root.dataset.moving; setIk(); }, 160); }
  }, []);
  // 맞춤: 세계 전체를 레일 오른쪽·위 줄과 칸 머리 아래·명령줄 위 칸에
  const fitOf = (L, s) => { const f = fitView(L.bounds, s.w - RAIL, s.h, { top: TOPH + COLH, bottom: BOTTOM, pad: PAD }); return { ...f, x: f.x + RAIL }; };
  // 처음 연 화면: 폭 맞춤(위에서부터, 아래는 끌어서 본다). 전체가 그보다 크게 들어가면 맞춤. 폭 맞춤이 READ_K보다 작으면 READ_K로 왼쪽 위에서
  const openOf = (L, s) => {
    const f = fitOf(L, s);
    const kw = Math.min(OPEN_MAX, (s.w - RAIL - PAD * 2) / L.bounds.w);
    if (f.k >= kw) return f;
    const k = Math.max(READ_K, kw);
    return { k, x: RAIL + PAD - L.bounds.x * k, y: TOPH + COLH + 8 - L.bounds.y * k };
  };
  const fit = useCallback((glide = true) => { const L = layRef.current, s = sizeRef.current; if (L && s) paint(fitOf(L, s), { glide }); }, [paint]);
  const zoomCenter = useCallback((k2) => { const s = sizeRef.current, v = view.current; if (s && v) paint(zoomAt(v, (s.w + RAIL) / 2, (s.h + TOPH + COLH - BOTTOM) / 2, k2), { glide: true }); }, [paint]);
  const flyTo = useCallback((id, k) => {
    const L = layRef.current, s = sizeRef.current, v = view.current, b = L && L.cards.get(id);
    if (!b || !s || !v) return;
    const c = centerOn(b.x + b.w / 2, b.y + b.h / 2, k || Math.max(0.9, v.k), s.w - RAIL, s.h, { top: TOPH + COLH, bottom: BOTTOM });
    paint({ ...c, x: c.x + RAIL }, { glide: true });
  }, [paint]);
  // P153 r9: 앱 사이드바가 세션 맵을 움직인다(Sidebar.jsx가 getState().mapFocus를 부른다). 세션 = 지금 배율 그대로 가운데로, 워크스페이스 줄·폴더 띠 = 그 상자에 맞춤.
  // 간 뒤 그 카드·줄·띠를 세 번 반짝인다(.blink, 움직임 줄이기에서도 판 설정 workLight가 끔이 아니면 돈다)
  const blink = useCallback((sel) => { const root = rootRef.current, el = root && root.querySelector(sel); if (!el) return; el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); setTimeout(() => el.classList.remove('blink'), 2200); }, []);
  const fitBoxTo = useCallback((r) => { const s = sizeRef.current; if (!s || !r) return; const f = fitView(r, s.w - RAIL, s.h, { top: TOPH + COLH, bottom: BOTTOM, pad: 40, max: OPEN_MAX }); paint({ ...f, x: f.x + RAIL }, { glide: true }); }, [paint]);
  useEffect(() => {
    if (!open) return undefined;
    const st = getState();
    st.mapFocus = {
      session: (sid) => { const L = layRef.current, v = view.current, s = sizeRef.current; if (!L || !v || !s) return false; const hit = [...L.cards.entries()].find(([, b]) => b.node.sessionId === sid); if (!hit) return false; const [id, b] = hit; const c = centerOn(b.x + b.w / 2, b.y + b.h / 2, v.k, s.w - RAIL, s.h, { top: TOPH + COLH, bottom: BOTTOM }); paint({ ...c, x: c.x + RAIL }, { glide: true }); setTimeout(() => blink(`.mt-ta-slot[data-id="${CSS.escape(id)}"]`), 460); return true; },
      ws: (key) => { const L = layRef.current, r = L && L.rows.find((x) => x.key === key); if (!r) return false; fitBoxTo({ x: 0, y: r.y, w: L.W, h: r.h }); setTimeout(() => blink(`.mt-sm-row[data-key="${CSS.escape(key)}"]`), 460); return true; },
      group: (gid) => { const L = layRef.current, b = L && L.bands.find((x) => (x.id || null) === (gid || null)); if (!b) return false; fitBoxTo({ x: 0, y: b.y, w: L.W, h: b.h }); setTimeout(() => blink(`.mt-sm-band[data-id="${CSS.escape(b.id || 'none')}"]`), 460); return true; },
    };
    return () => { if (getState().mapFocus === st.mapFocus) getState().mapFocus = null; };
  }, [open, paint, blink, fitBoxTo]);

  useLayoutEffect(() => {
    const el = vpRef.current;
    if (!open || !el) return undefined;
    const read = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setVsize((v) => (v && v.w === Math.round(r.width) && v.h === Math.round(r.height) ? v : { w: Math.round(r.width), h: Math.round(r.height) })); };
    read();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', read);
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', read); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !lay || !vsize) return;
    if (!fitted.current) { fitted.current = true; paint(openOf(lay, vsize)); }
    else if (view.current) paint(view.current);
  }, [open, lay, vsize, paint]); // eslint-disable-line react-hooks/exhaustive-deps

  // 미리 보기: 카드 위에 HOVER_MS 머물면(또는 초점) 카드 옆에. 오른쪽에 자리가 없으면 왼쪽
  const onHover = useCallback((id, el) => {
    clearTimeout(hoverTimer.current);
    if (!id || !el) { if (pvRef.current) setPv(null); return; }
    hoverTimer.current = setTimeout(() => {
      const root = rootRef.current; if (!root || !el.isConnected) return;
      const r = el.getBoundingClientRect(), R = root.getBoundingClientRect(), w = 380;
      let x = r.right - R.left + 12;
      if (x + w > R.width - 8) x = Math.max(8, r.left - R.left - 12 - w);
      const y = Math.max(60 + TOPH + COLH + 6, Math.min(r.top - R.top, R.height - 360));
      setPv({ id, x, y, w });
    }, HOVER_MS);
  }, []);

  const lastTag = useRef(null); // { id, at }: 마지막 카드 누르기(더블클릭이면 되돌린다)
  const go = useCallback((id, dbl = false) => {
    const L = layRef.current, b = L && L.cards.get(id);
    // 더블클릭의 첫 클릭이 넣거나 뺀 태그를 되돌린다(더블클릭은 판으로 가는 것이지 태그가 아니다)
    const lt = lastTag.current;
    if (dbl && b && lt && lt.id === id && Date.now() - lt.at < 800) commandDraft.dispatchEvent(new CustomEvent('tag', { detail: b.node.name }));
    lastTag.current = null;
    setMissionOpen(false);
    const st = getState();
    // P157: 날아가기(줌 아웃 → 이동 → 줌 인) 없이 그 세션 맞춤 보기로 한 번에
    if (b && b.node.sessionId) setTimeout(() => st.navigateTo && st.navigateTo(b.node.sessionId, { instant: true }), 30);
  }, []);
  const tag = useCallback((id, e) => {
    const L = layRef.current, b = L && L.cards.get(id);
    if (!b || justDragged.current || b.node.agentKind === 'shell') return; // 셸은 메시지를 받지 않는다
    if (e && e.detail > 1) return; // 더블클릭의 둘째 클릭은 태그를 바꾸지 않는다(첫 클릭은 go가 되돌린다)
    lastTag.current = { id, at: Date.now() };
    commandDraft.dispatchEvent(new CustomEvent('tag', { detail: b.node.name }));
  }, []);

  // ---- 줄 옮기기(소속만): 놓은 자리의 폴더 띠 → group.move. 폴더 없음 띠·띠 밖 = 폴더 없음 ----
  const bandAt = (L, wx, wy) => (wx >= 0 && wx <= L.W ? L.bands.find((x) => wy >= x.y && wy <= x.y + x.h) || null : null);
  const moveRow = useCallback((key, bandId) => {
    const L = layRef.current;
    const row = L && L.rows.find((r) => r.key === key);
    if (!row || (row.band || null) === (bandId || null)) return;
    const gs = getState().groups || [];
    const name = bandId ? (gs.find((g) => g.id === bandId) || {}).name : null;
    api.call('group.move', { workspace: key, group: bandId || null }).then(() => toast(bandId ? t('mmTerr.movedTo', { ws: wsName(key), folder: name || '' }) : t('mmTerr.movedOut', { ws: wsName(key) }))).catch((e) => toast(t('mmTerr.moveFail', { error: errText(e) }), 'error'));
  }, [t]);

  // ---- P153 r11·r12: 관계 바꾸기(Alt+카드 끌기). 놓자마자 맵에 보이고(pending), 판 relation.set(P156)을 부른다(계보는 사실이라 그대로, session.detach는 쓰지 않는다).
  // 실패하면 되돌리고 알린다. cycle(끈 세션 아래에 대상이 있다)은 따로 분명한 글 ----
  const setRelation = useCallback((dragId, drop) => {
    const L = layRef.current;
    const call = L && relationCall(L, dragId, drop);
    if (!call) return;
    const nm = (sid) => { const n = L.tree.nodes.find((x) => x.sessionId === sid); return n ? n.name : sid; };
    const done = () => toast(t(call.relation === 'sub' ? 'mmLine.relSub' : call.relation === 'peer' ? 'mmLine.relPeer' : 'mmLine.relNone', { name: nm(call.b), up: nm(call.a) }));
    setPending((p) => putRel(p, { ...call, ok: false }));
    api.call('relation.set', call).then(() => {
      done();
      setPending((p) => p.map((x) => (relKey(x) === relKey(call) ? { ...x, ok: true } : x)));
      setReloadN((n) => n + 1);
    }).catch((e) => {
      setPending((p) => p.filter((x) => relKey(x) !== relKey(call)));
      if (e && e.code === 'cycle') { toast(t('mmLine.relCycle', { name: nm(call.b), up: nm(call.a) }), 'error'); return; }
      toast(t('mmLine.relFail', { error: errText(e) }), 'error');
    });
  }, [t]);

  // ---- 끌기·두 손가락·휠·줄 머리 끌기 ----
  useEffect(() => {
    const el = vpRef.current;
    if (!open || !el) return undefined;
    const pts = new Map();
    let g = null; // { mode: 'press'|'drag'|'pinch'|'row', ... }
    const local = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const setAlt = (on) => { if (on) { if (el.dataset.alt !== '1') el.dataset.alt = '1'; } else if (el.dataset.alt) delete el.dataset.alt; }; // P155
    const begin = () => {
      const v = view.current; if (!v) { g = null; return; }
      const p = [...pts.values()];
      if (p.length >= 2) g = { mode: 'pinch', v0: v, m0: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1 };
      else if (p.length === 1) g = { mode: g && g.mode !== 'press' ? 'drag' : 'press', v0: v, p0: p[0] };
      else g = null;
    };
    // 끄는 줄과 그 안의 카드(세계에서 형제 요소라 함께 옮긴다)
    const rowEls = (key) => [...el.querySelectorAll(`.mt-sm-row[data-key="${CSS.escape(key)}"], .mt-ta-slot[data-ws="${CSS.escape(key)}"]`)];
    const hotBand = (id) => { for (const x of el.querySelectorAll('.mt-sm-band')) x.classList.toggle('drop', id != null && x.dataset.id === id); };
    const bandKey = (b) => (b ? b.id || 'none' : 'none');
    const endRow = (commit, p) => {
      const s = g; g = null;
      for (const ie of rowEls(s.key)) { ie.style.transform = ''; ie.classList.remove('moving'); }
      hotBand(null);
      el.classList.remove('dragging');
      setMoveWs(null);
      if (commit && s.moved) {
        const v = view.current, L = layRef.current;
        const bb = L && v ? bandAt(L, (p.x - v.x) / v.k, (p.y - v.y) / v.k) : null;
        moveRow(s.key, bb ? bb.id : null);
      }
    };
    // P153 r11: 카드 끌기(관계 바꾸기). 놓을 자리 미리 보기(.mt-sm-drop)와 대상 카드 강조는 DOM에 바로(끄는 동안 다시 그리지 않는다)
    const slotEl = (id) => el.querySelector(`.mt-ta-slot[data-id="${CSS.escape(id)}"]`);
    const showDrop = (d) => {
      const box = el.querySelector('.mt-sm-drop');
      for (const x of el.querySelectorAll('.mt-ta-slot.drop-target')) if (!d || x.dataset.id !== d.target) x.classList.remove('drop-target');
      if (!box) return;
      if (!d) { box.hidden = true; delete box.dataset.kind; return; }
      const L = layRef.current, tn = d.target && L ? (L.tree.byId.get(d.target) || {}).name : '';
      box.hidden = false; box.dataset.kind = d.kind;
      Object.assign(box.style, { left: `${d.box.x}px`, top: `${d.box.y}px`, width: `${d.box.w}px`, height: `${d.box.h}px` });
      const lb = box.firstChild; if (lb) lb.textContent = t(d.kind === 'sub' ? 'mmLine.dropSub' : d.kind === 'peer' ? 'mmLine.dropPeer' : 'mmLine.dropNone', { name: tn });
      if (d.target) { const te = slotEl(d.target); if (te) te.classList.add('drop-target'); }
    };
    const endCard = (commit) => {
      const s = g; g = null;
      const se = slotEl(s.id); if (se) { se.style.transform = ''; se.classList.remove('moving'); }
      showDrop(null);
      el.classList.remove('dragging', 'card-moving');
      if (commit && s.moved && s.drop) setRelation(s.id, s.drop);
    };
    const down = (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest('.mt-ta-hud')) return;
      justDragged.current = false;
      if (e.target.closest('.mt-sm-fold')) return; // 접기 칩은 누르기만
      setAlt(e.altKey);
      // P153 r11: Alt+카드 끌기 = 관계 바꾸기(마우스 왼쪽만). Alt 없이 끌면 시점 이동
      const card = e.target.closest('.mt-ta-card');
      if (card && !pts.size && e.altKey && e.pointerType === 'mouse' && e.button === 0) { const p = local(e); pts.set(e.pointerId, p); g = { mode: 'card', id: card.dataset.id, p0: p, moved: false, drop: null }; return; }
      // P155: 줄 머리 옮기기는 Alt+끌기만(headDrag). Alt 없이 누르면 줄 머리에서도 시점 이동.
      // P153 r11: 잡는 자리는 줄 머리 + 워크스페이스 칸 빈 곳 전체(.mt-sm-grab, Alt를 누르는 동안만 누를 수 있다)
      const head = e.target.closest('.mt-sm-head, .mt-sm-grab');
      if (head && !pts.size && headDrag({ onHead: true, altKey: e.altKey, button: e.button, pointerType: e.pointerType }) === 'row') { const p = local(e); pts.set(e.pointerId, p); g = { mode: 'row', key: head.dataset.key, p0: p, moved: false }; return; }
      pts.set(e.pointerId, local(e));
      begin();
    };
    const move = (e) => {
      if (e.pointerType === 'mouse') setAlt(e.altKey); // 창 밖에서 Alt를 누르고 들어온 경우도 맞춘다
      if (!pts.has(e.pointerId) || !g) return;
      const lp = local(e);
      pts.set(e.pointerId, lp);
      if (g.mode === 'card') {
        const dx = lp.x - g.p0.x, dy = lp.y - g.p0.y, v = view.current;
        if (!g.moved && pressIntent({ dx, dy }) !== 'drag') return;
        if (!g.moved) { g.moved = true; el.classList.add('dragging', 'card-moving'); clearTimeout(hoverTimer.current); if (pvRef.current) setPv(null); try { el.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ } }
        justDragged.current = true;
        const se = slotEl(g.id);
        if (se && v) { se.classList.add('moving'); se.style.transform = `translate(${dx / v.k}px, ${dy / v.k}px)`; }
        const L = layRef.current;
        g.drop = L && v ? relationDrop(L, g.id, (lp.x - v.x) / v.k, (lp.y - v.y) / v.k) : null;
        showDrop(g.drop);
        return;
      }
      if (g.mode === 'row') {
        const dx = lp.x - g.p0.x, dy = lp.y - g.p0.y, v = view.current;
        if (!g.moved && pressIntent({ dx, dy }) !== 'drag') return;
        if (!g.moved) { g.moved = true; el.classList.add('dragging'); setMoveWs(g.key); try { el.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ } }
        justDragged.current = true;
        if (v) for (const ie of rowEls(g.key)) { ie.classList.add('moving'); ie.style.transform = `translate(${dx / v.k}px, ${dy / v.k}px)`; }
        const L = layRef.current;
        const bb = L && v ? bandAt(L, (lp.x - v.x) / v.k, (lp.y - v.y) / v.k) : null;
        hotBand(bandKey(bb));
        return;
      }
      const p = [...pts.values()];
      if (g.mode === 'pinch' && p.length >= 2) {
        const m = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
        const z = zoomAt(g.v0, g.m0.x, g.m0.y, g.v0.k * (d / g.d0));
        justDragged.current = true;
        paint(panBy(z, m.x - g.m0.x, m.y - g.m0.y));
        return;
      }
      if (p.length !== 1 || !g.p0) return;
      const dx = p[0].x - g.p0.x, dy = p[0].y - g.p0.y;
      if (g.mode === 'press' && pressIntent({ dx, dy }) === 'drag') { g.mode = 'drag'; el.classList.add('dragging'); try { el.setPointerCapture(e.pointerId); } catch { /* 잡지 못해도 끌기는 된다 */ } }
      if (g.mode === 'drag') { justDragged.current = true; paint(panBy(g.v0, dx, dy)); }
    };
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      const lp = local(e);
      pts.delete(e.pointerId);
      if (g && g.mode === 'row') { endRow(e.type === 'pointerup', lp); return; }
      if (g && g.mode === 'card') { endCard(e.type === 'pointerup'); return; }
      if (!pts.size) { g = null; el.classList.remove('dragging'); } else begin();
    };
    const wheel = (e) => {
      if (e.target.closest('.mt-ta-hud')) return;
      e.preventDefault();
      const v = view.current; if (!v) return;
      const p = local(e);
      paint(zoomAt(v, p.x, p.y, wheelK(v.k, e.deltaY, e.deltaMode)));
    };
    const click = (e) => { if (justDragged.current) { e.stopPropagation(); e.preventDefault(); justDragged.current = false; } };
    const esc = (e) => { if (e.key === 'Escape' && g && g.mode === 'row') { e.preventDefault(); e.stopPropagation(); pts.clear(); endRow(false); } else if (e.key === 'Escape' && g && g.mode === 'card') { e.preventDefault(); e.stopPropagation(); pts.clear(); endCard(false); } };
    // P155: Alt를 누르고 있는 동안 보기 칸에 data-alt="1"(줄 머리에 옮기기 커서·강조, styles.css 끝).
    // Alt만 눌렀다 떼면 창 메뉴로 초점이 가는 일이 없게 기본 동작을 막는다(세션 맵이 열린 동안만). 창이 초점을 잃으면 끈다
    const altKey = (e) => {
      if (e.key !== 'Alt') return;
      setAlt(e.type === 'keydown');
      if (!e.ctrlKey && !e.shiftKey && !e.metaKey) e.preventDefault();
    };
    const altOff = () => setAlt(false);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('click', click, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('keydown', altKey, true); window.addEventListener('keyup', altKey, true); window.addEventListener('blur', altOff);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel); el.removeEventListener('click', click, true); window.removeEventListener('keydown', esc, true);
      window.removeEventListener('keydown', altKey, true); window.removeEventListener('keyup', altKey, true); window.removeEventListener('blur', altOff);
      delete el.dataset.alt;
    };
  }, [open, paint, moveRow, setRelation, t]);

  // ---- 키: Esc 닫기, 친 글자는 명령줄로, 화살표 끌기, 카드에 초점이 있으면 ↑↓로 카드 다니기 ----
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      const tag2 = (e.target && e.target.tagName) || '';
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag2) || (e.target && e.target.isContentEditable);
      if (e.key === 'Escape' && !typing) { e.preventDefault(); setMissionOpen(false); return; }
      if (typing || getState().dialog) return;
      if (typedKey(e) && !(e.key === ' ' && e.target && e.target.closest && e.target.closest('.mt-ta-card'))) { commandDraft.dispatchEvent(new CustomEvent('focus')); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const card = e.target && e.target.closest ? e.target.closest('.mt-ta-card') : null;
      const L = layRef.current;
      if (card && L && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const next = stepCard(L.order, card.dataset.id, e.key === 'ArrowDown' ? 1 : -1);
        const el = next && rootRef.current && rootRef.current.querySelector(`.mt-ta-card[data-id="${CSS.escape(next)}"]`);
        if (el) { el.focus({ preventScroll: true }); flyTo(next); }
        return;
      }
      const a = viewKey(e.key, { shift: e.shiftKey });
      if (!a || !a.pan) return;
      e.preventDefault();
      if (view.current) paint(panBy(view.current, a.pan[0], a.pan[1]), { glide: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, flyTo, paint]);
  window.__mtTa = { view: () => (view.current ? { ...view.current } : null), fit: () => fit(false), flyTo, lay: () => layRef.current, set: (v) => paint(v), tags: () => tags, rail: RAIL, top: TOPH + COLH }; // 시험이 읽는다

  if (!open) return null;
  const ids = lay ? lay.order : [];
  const attn = ids.filter((id) => tiers.get(id) === 'turn' || tiers.get(id) === 'alert').sort((a, b) => (tiers.get(a) === 'turn' ? 0 : 1) - (tiers.get(b) === 'turn' ? 0 : 1));
  const nWork = ids.filter((id) => tiers.get(id) === 'work').length, nDone = ids.filter((id) => tiers.get(id) === 'review').length;
  const tagOf = (id) => { const b = lay.cards.get(id); return !!b && tagSet.has(String(b.node.name).toLowerCase()); };
  const leads = lay ? new Set([...lay.cards.entries()].filter(([id, b]) => b.depth >= 0 && (lay.tree.kids.get(id) || []).some((c) => (c.workspaceKey || '') === (b.node.workspaceKey || ''))).map(([id]) => id)) : new Set();
  const edgeText = (e) => (e.cross ? t('mmTerr.edgeCross', { from: lay.tree.byId.get(e.from).name, ws: wsName(lay.tree.byId.get(e.to).workspaceKey || '') || t('mmTerr.noFolder') }) : e.rel === 'role' ? (e.role || t('mmLine.role')) : t('mmLine.task'));
  // 칸 머리: 워크스페이스 · 시작 · 1단계 · 2단계 · … · 솔로
  const colLabel = (c) => (c.key === 'ws' ? t('mmLine.colWs') : c.key === 'solo' ? t('mmLine.colSolo') : c.level === 0 ? t('mmLine.colRoot') : t('mmLine.colLevel', { n: c.level }));
  const col0 = lay ? (lay.cols.find((c) => c.key === 'lv') || { x: lay.headx + LINE.HEADW + 208 }).x : 0;

  return (
    <div className={`mt-mission mt-ta mt-sm nowheel nopan${moveWs ? ' isle-moving' : ''}`} data-role="mission" data-style="territories" data-layout="lineage" ref={rootRef}>
      <div className="mt-ta-vp" data-role="ta-viewport" ref={vpRef}>
        <div className="mt-ta-bg" ref={bgRef} aria-hidden="true" />
        {!lay ? <div className="mt-ta-loading">{t('common.loading')}</div> : (
          <div className="mt-ta-world lv-far" data-role="ta-world" ref={worldRef}>
            {lay.bands.map((b) => (
              <div key={`b:${b.id || 'none'}`} className={`mt-sm-band${b.odd ? ' odd' : ''}${b.loose ? ' loose' : ''}`} data-role="ln-band" data-id={b.id || 'none'} style={{ top: b.y, height: b.h, width: lay.W }}>
                <div className="mt-sm-spine" style={{ width: lay.spine }}>
                  <span className="fk">{b.loose ? t('mmLine.loose') : t('mmLine.folder')}</span>
                  <span className="fn" data-role="ln-band-name">{b.name}</span>
                  <span className="fs" data-role="ln-band-stat"><span>{t('mmTerr.workspaces', { n: b.nWs })}</span><span>{t('mmTerr.sessions', { n: b.sessions })}</span></span>
                  <span className="fbar" aria-hidden="true">{b.bar.map((c) => <i key={c.tier} className={`st-${ST[c.tier]}`} style={{ flexGrow: c.n }} />)}</span>
                </div>
              </div>
            ))}
            {lay.rows.map((r) => (
              <div key={`r:${r.key || '-'}`} className={`mt-sm-row${r.first ? ' first' : ''}`} data-role="ta-isle" data-key={r.key} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                {r.key ? <div className="mt-sm-grab" data-key={r.key} data-role="ln-row-grab" style={{ width: Math.max(LINE.HEADW, col0 - r.x - 40) }} /> : null}
                {/* P157: 옮기기 안내는 풍선(title)이 아니라 Alt를 누른 동안에만 보이는 작은 글(.mt-sm-althint) */}
                <div className="mt-sm-head" data-key={r.key} data-role="ta-isle-head">
                  <span className="wsn"><FolderIcon /><span data-role="ta-isle-name">{r.key ? r.name : t('mmapGroup.noWorkspace')}</span></span>
                  {r.key ? <span className="mt-sm-althint" data-role="ln-alt-hint">{t('mmLine.altMoveHint')}</span> : null}
                  <span className="wsc">{r.chips.map((c) => <span key={c.tier} className={`st-${ST[c.tier]}`} data-tier={c.tier}><i /><b>{c.n}</b> {t(`mmTerr.chip.${c.tier}`)}</span>)}</span>
                </div>
              </div>
            ))}
            {lay.divs.map((d, i) => <span key={`d:${i}`} className="mt-sm-div" style={{ left: d.x, top: d.y, height: d.h }} />)}
            <svg className="mt-ta-edges" width={1} height={1} aria-hidden="true">
              <defs>
                {KINDS.map((k) => <marker key={k} id={`mt-sm-tip-${k}`} className={`mt-sm-tip k-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 L10 5 L0 10 z" /></marker>)}
                {/* P153 r11: 동료 선은 양 끝에 작은 점(화살촉 없음, 위아래가 없다) */}
                <marker id="mt-sm-end-peer" className="mt-sm-tip k-peer" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse"><circle cx="5" cy="5" r="4" /></marker>
              </defs>
              {lay.edges.map((e) => {
                const k = e.peer ? 'peer' : e.lineage ? 'lineage' : e.cross ? 'cross' : e.rel;
                const tip = e.peer ? 'url(#mt-sm-end-peer)' : e.lineage ? undefined : `url(#mt-sm-tip-${KINDS.includes(k) ? k : 'spawn'})`;
                return <path key={e.id} className={`mt-ta-edge k-${k}${!e.peer && !e.lineage && (e.active || tiers.get(e.to) === 'work') ? ' active' : ''}`} data-role="ta-edge" data-from={e.from} data-to={e.to} data-rel={e.rel} data-cross={e.cross ? '1' : undefined} d={e.d} markerEnd={tip} markerStart={e.peer ? tip : undefined} />;
              })}
            </svg>
            {lay.edges.filter((e) => e.label).map((e) => <span key={`l:${e.id}`} className={`mt-ta-elab k-${e.cross ? 'cross' : e.rel}`} data-role="ta-edge-label" style={{ left: e.label.x, top: e.label.y }}>{edgeText(e)}</span>)}
            {ids.map((id) => { const b = lay.cards.get(id); return <Card key={id} id={id} b={b} f={factsOf(id)} tier={tiers.get(id)} lead={leads.has(id)} tagged={tagOf(id)} onTag={tag} onOpen={go} onHover={onHover} t={t} unfold={b.depth >= LINE.FOLD && expanded.has(id) && (lay.tree.kids.get(id) || []).length > 0} onFold={onFold} />; })}
            {/* P153 r11: Alt+카드 끌기 때 놓을 자리(하위로·동료로·독립). 끄는 동안 DOM에 바로 쓴다 */}
            <div className="mt-sm-drop" data-role="ln-drop" hidden><span className="lb" /></div>
          </div>
        )}
        {lay && lay.cards.size === 0 && <div className="mt-ta-loading">{t('mission.empty')}</div>}
      </div>

      {pv && lay && lay.cards.get(pv.id) && (() => { const b = lay.cards.get(pv.id), row = lay.rows.find((r) => r.key === b.ws), band = row && lay.bands.find((x) => (x.id || null) === (row.band || null)); return <Peek pv={pv} b={b} f={factsOf(pv.id)} live={liveOf(b.node)} tier={tiers.get(pv.id)} t={t} now={now} folder={[band && band.name, row && row.name].filter(Boolean).join(' / ')} />; })()}
      <div className="mt-ta-hud mt-sm-top" data-role="ta-top">
        <span className="mt-ta-title">{t('mission.title')}</span>
        <span className="mt-ta-attn" data-role="ta-attn">
          {attn.slice(0, ATTN_MAX).map((id) => {
            const b = lay.cards.get(id), tier = tiers.get(id);
            return <button key={id} type="button" className={`mt-sm-pill st-${ST[tier]}`} data-role="ta-attn-item" data-id={id} title={t('mmTerr.waitingTitle')} onClick={() => { flyTo(id); if (!tagOf(id)) tag(id); }}><i /><b>{b.node.name}</b><span>{t(`mmTerr.chip.${tier}`)}</span></button>;
          })}
          {attn.length > ATTN_MAX && <span className="mt-ta-amore">{t('mmTerr.more', { n: attn.length - ATTN_MAX })}</span>}
          {lay && nWork > 0 && <span className="mt-sm-pill quiet st-working" data-role="ln-count"><i /><b>{nWork}</b><span>{t('mmTerr.chip.work')}</span></span>}
          {lay && nDone > 0 && <span className="mt-sm-pill quiet st-done" data-role="ln-count"><i /><b>{nDone}</b><span>{t('mmTerr.chip.review')}</span></span>}
        </span>
        <span className="mt-ta-spacer" />
        <span className="mt-sm-zgrp" data-role="ta-dock">
          <button type="button" className="zb" data-action="ta-zoom-out" title={t('mmTerr.zoomOut')} aria-label={t('mmTerr.zoomOut')} onClick={() => zoomCenter(view.current.k / ZOOM.step)}><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
          <span className="zpct" ref={pctRef} data-role="ta-zoom">100%</span>
          <button type="button" className="zb" data-action="ta-zoom-in" title={t('mmTerr.zoomIn')} aria-label={t('mmTerr.zoomIn')} onClick={() => zoomCenter(view.current.k * ZOOM.step)}><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
          <button type="button" className="zb fit" data-action="ta-fit" title={t('mmTerr.fitTitle')} onClick={() => fit()}>{t('mmTerr.fit')}</button>
        </span>
        <button type="button" className="mt-ta-iconbtn" data-action="mission-close" title={t('mmTerr.close')} aria-label={t('mmTerr.close')} onClick={() => setMissionOpen(false)}><XIcon s={18} /></button>
      </div>
      <div className="mt-ta-hud mt-sm-cols" data-role="ln-cols" ref={colsRef} aria-hidden="true">
        {lay && lay.cols.map((c, i) => <span key={`${c.key}${i}`} className="colh" data-col={c.key === 'lv' ? `lv${c.level}` : c.key}>{colLabel(c)}</span>)}
      </div>
    </div>
  );
}
