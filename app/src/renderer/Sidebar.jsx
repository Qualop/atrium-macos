// P7(J5): 왼쪽 사이드바. 평소에는 닫혀 있고 위쪽 줄 왼쪽 단추(☰)와 Ctrl+Shift+E로 연다. 캔버스는 그 옆으로 줄어들 뿐 자리와 배율은 그대로다.
// 판 세션을 누르면 그 노드로 들어가고(H4), 리포 이름을 누르면 그 영역으로 간다. 닫힌 세션과 묶여 있지 않은 대화는 "판으로 열기"(J2·J4),
// 다른 곳에 묶인 대화는 흐리게 묶인 곳만 보인다. 닫힌 세션과 판 밖 대화는 백엔드 recall.list로 읽고, recall.updated가 오면 사이드바가 열려 있을 때만 다시 읽는다.
// P10: 닫힌 세션과 판 밖 대화의 "보관", 워크스페이스 메뉴의 "오래된 것 보관"(수를 보이고 한 번 더 누른다), 맨 아래 "보관함"(접혀 있음, archive.list, 따로 거르기, 꺼내기).
// P13: 맨 아래 "missed(지울 대화)" 함. 폴더별로 모으고 모두·폴더 하나·하나를 Windows 휴지통으로 지운다(확인창). 캔버스에 대화 노드가 있는 줄은 제목을 누르면 그 노드로 간다.
// P44: 세션 200개 이상을 위해 다시 짰다.
//   - 그룹(가상, ws-groups.mjs) → 워크스페이스 → 세션의 나무를 줄 높이가 정해진 평평한 목록으로 펴고(lib/sidebar-tree.js) 보이는 줄만 그린다(가상 스크롤).
//   - 줄에는 상태 점, 이름, (claude가 아니면) 종류, 지난 시간만 둔다. 응답 필요·오류 줄만 질문 한 줄을 더 보인다. 나머지는 마우스를 올리면(title) 보인다.
//   - 그룹·워크스페이스는 접고 펼친다. 접혀 있어도 응답 필요·오류 세션은 그 아래 줄로 남는다. 닫힌 세션과 판 밖 대화는 워크스페이스마다 한 줄("닫힘 n · 대화 m")로 접혀 있다.
//   - 찾기 칸(글), 상태 칩(응답 필요, 오류, 작업 중, 대기, 절전), 종류 고르기. 목록에서 ↑↓로 옮기고 Enter로 들어가며 ←→로 접고 편다.
//   - 그룹 만들기·이름 바꾸기·지우기, 워크스페이스를 그룹 머리줄이나 다른 워크스페이스 줄에 끌어 놓기(메뉴의 "그룹으로 옮기기"도 같다).
//   - 오른쪽 가장자리를 끌어 폭을 바꾼다(두 번 누르면 기본 폭). 고르기 모드에서 워크스페이스 여럿을 골라 판에서 지운다(Workspaces.jsx CloseWsDialog).
//   열림, 폭, 접힘, 거르기는 창 프로필의 localStorage에 둔다.
import './sidebar.css';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './api.js';
import { useStore, getState, selectWorkspace, toast, goWhenOpen, openDialog } from './store.js';
import { ago, askLine, STATE_LABEL } from './lib/labels.js';
import { useT, t, errText, tMsg, tOr } from './lib/i18n.js';
import { archiveRows, SECTION_STEP, bindingText } from './lib/sidebar.js';
import { buildRows, offsetsOf, windowOf, scrollFor, moveCursor, parentOf, dropTarget, adjustIndex, freshGroupName, clampWidth, SIDE_W, BUCKETS, bucketOf, kindOf } from './lib/sidebar-tree.js'; // P44
import { shownKind, kindOf as agentKindOf } from './lib/kinds.js'; // P25: DeepSeek(flavor)를 종류처럼 보인다
import { branchLabel } from './lib/branch.js'; // P8(K4): 하위 세션은 부모 아래에 들여 보인다
import { Icon } from './lib/icons.jsx';

const KEY = 'mt.sidebar';
function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
const saved = load();
const side = {
  open: !!saved.open,
  collapsed: saved.collapsed && typeof saved.collapsed === 'object' ? saved.collapsed : {}, // 워크스페이스 키(그룹은 'g:'+ID) → 접힘
  filter: typeof saved.filter === 'string' ? saved.filter : '',
  width: clampWidth(saved.width ?? SIDE_W.def), // P44: 사이드바 폭
  states: new Set(Array.isArray(saved.states) ? saved.states.filter((x) => BUCKETS.includes(x)) : []), // P44: 상태 칩
  kind: typeof saved.kind === 'string' ? saved.kind : '', // P44: 종류 거르기
  extra: {}, // P44: 워크스페이스 키 → 닫힌 세션·판 밖 대화 펼침(창을 다시 열면 접힘)
  more: {}, // 워크스페이스 키 + 칸 → 더 보인 수(창을 다시 열면 처음으로)
  cursor: null, // P44: 키보드로 고른 줄 ID
  selecting: false, selected: new Set(), // P44: 고르기 모드(워크스페이스 여럿 지우기)
  menu: null, // P44: { type: 'ws' | 'group', key, x, y }
  renaming: null, // P44: 이름을 고치는 그룹 ID
  drag: null, dropAt: null, // P44: 끄는 워크스페이스 키, 놓일 줄 { id, after }
  data: null, // recall.list 결과
  loading: false,
  busy: new Set(), // 여는 중인 항목
  // P10: 보관함
  archiveOpen: false, archive: null, archiveFilter: '', archiveLoading: false,
  oldAsk: null, // "오래된 것 보관"의 확인 { key, name, count, message }
  // P13: missed 함. missedAsk: 지우기 확인창 { scope, count, bytes, folders, message }
  missedOpen: false, missed: null, missedLoading: false, missedAsk: null,
  v: 0,
};
const subs = new Set();
function persist() { try { localStorage.setItem(KEY, JSON.stringify({ open: side.open, collapsed: side.collapsed, filter: side.filter, width: side.width, states: [...side.states], kind: side.kind })); } catch {} }
function bump() { side.v++; for (const f of [...subs]) f(); }
export function useSide(sel) { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => sel(side)); }
export const sideState = () => side;

export function setSidebarOpen(v) {
  side.open = v; persist(); bump();
  if (v) refresh();
}
export function toggleSidebar() { setSidebarOpen(!side.open); }
function setFilter(v) { side.filter = v; persist(); bump(); }
function showMore(k) { side.more = { ...side.more, [k]: (side.more[k] || 0) + SECTION_STEP }; bump(); }

let timer = null;
export async function refresh() {
  if (side.loading) { clearTimeout(timer); timer = setTimeout(refresh, 300); return; }
  side.loading = true; bump();
  try { side.data = await api.call('recall.list'); } catch (e) { if (e.code !== 'disconnected') toast(t('sidebar.loadFail', { error: errText(e) }), 'error'); }
  side.loading = false; bump();
}
api.on('recall.updated', () => { if (!side.open) { side.data = null; side.archive = null; side.missed = null; return; } clearTimeout(timer); timer = setTimeout(() => { refresh(); if (side.archiveOpen) refreshArchive(); if (side.missedOpen) refreshMissed(); }, 400); });
api.on('$open', () => { if (side.open) refresh(); });

// ---------- P10: 보관 ----------
export async function refreshArchive() {
  side.archiveLoading = true; bump();
  try { side.archive = await api.call('archive.list'); } catch (e) { if (e.code !== 'disconnected') toast(t('archive.loadFail', { error: errText(e) }), 'error'); }
  side.archiveLoading = false; bump();
}
function setArchiveOpen(v) { side.archiveOpen = v; bump(); if (v) refreshArchive(); }
// P11: 오른쪽 레일의 보관함 단추. 사이드바를 열고 맨 아래 보관함을 펼쳐 그쪽으로 민다
export function openArchiveBox() {
  if (!side.open) setSidebarOpen(true);
  setArchiveOpen(true);
  setTimeout(() => { const el = document.querySelector('[data-role="archive-box"]'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 120);
}
function setArchiveFilter(v) { side.archiveFilter = v; bump(); }

// ---------- P13: missed(지울 대화) ----------
export async function refreshMissed() {
  side.missedLoading = true; bump();
  try { side.missed = await api.call('missed.list'); } catch (e) { if (e.code !== 'disconnected') toast(t('missed.loadFail', { error: errText(e) }), 'error'); }
  side.missedLoading = false; bump();
}
function setMissedOpen(v) { side.missedOpen = v; bump(); if (v) refreshMissed(); }
export function openMissedBox() { if (!side.open) setSidebarOpen(true); setMissedOpen(true); setTimeout(() => { const el = document.querySelector('[data-role="missed-box"]'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 120); }
// scope: { all: true } | { folder } | { convos: [id] }. 먼저 수·크기·폴더를 받아 확인창을 띄운다
async function askMissed(scope) {
  try { const r = await api.call('missed.delete', scope); side.missedAsk = { scope, ...r }; bump(); }
  catch (e) { toast(t('missed.deleteFail', { error: errText(e) }), 'error'); }
}
async function confirmMissed() {
  const a = side.missedAsk; side.missedAsk = null; bump();
  if (!a || !a.count) return;
  return run('missed', async () => {
    const r = await api.call('missed.delete', { ...a.scope, confirm: true });
    const why = r.refused && r.refused.length ? t('missed.kept', { n: r.refused.length, why: [...new Set(r.refused.map((x) => tOr(`refuse.${x.reason}`, x.label)))].join(', ') }) : '';
    toast(t('missed.trashed', { n: r.trashed }) + why + (r.failed && r.failed.length ? t('missed.failed', { n: r.failed.length }) : ''), r.failed && r.failed.length ? 'error' : 'info');
    await refreshMissed();
  });
}
export const fmtBytes = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)}GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round((n || 0) / 1024))}KB`);
const WHY = { gone: 'missed.whyGone', code: 'missed.whyTest', tmp: 'missed.whyTmp', prefix: 'missed.whyTest' };
const ref = (c) => (c.convId && !c.sessionId ? { convo: c.convId } : { session: c.sessionId });
export function archiveItem(c) { return run(c.sessionId || c.convId, async () => { await api.call('archive.add', ref(c)); toast(c.name ? t('archive.addedNamed', { name: c.name }) : t('archive.added')); }); }
export function restoreItem(c) { return run(c.sessionId || c.convId, async () => { await api.call('archive.restore', ref(c)); toast(t('archive.restored')); if (side.archiveOpen) refreshArchive(); }); }
async function askOld(w) {
  try { const r = await api.call('archive.old', { workspace: w.key }); side.oldAsk = { key: w.key, name: w.name, count: r.count, message: r.message, msg: r.msg }; bump(); }
  catch (e) { toast(t('archive.oldFail', { error: errText(e) }), 'error'); }
}
function confirmOld(w) {
  side.oldAsk = null; bump();
  return run(`old:${w.key}`, async () => { const r = await api.call('archive.old', { workspace: w.key, confirm: true }); toast(t('archive.oldDone', { n: r.archived || 0 })); });
}

async function run(key, fn) {
  if (side.busy.has(key)) return;
  side.busy = new Set(side.busy); side.busy.add(key); bump();
  try { await fn(); } catch (e) { toast(e.code === 'bound' ? t('sidebar.notOpened', { error: errText(e) }) : errText(e), 'error'); }
  side.busy = new Set(side.busy); side.busy.delete(key); bump();
  refresh();
}
const devModel = () => (api.info && api.info.defaultModel) || undefined; // 개발용 프로필은 haiku(P2), 실제 판은 사용자 기본 모델
export function reopenClosed(c) {
  return run(c.sessionId, async () => {
    const r = await api.call('recall.reopen', { session: c.sessionId, ...(api.info && api.info.profile === 'dev' && !c.model ? { model: devModel() } : {}) });
    toast(r.resume ? t('sidebar.reopenedResume', { name: r.name }) : t('sidebar.reopened', { name: r.name }));
    goWhenOpen(r.sessionId);
  });
}
export function openConvo(c) {
  return run(c.convId, async () => {
    const r = await api.call('convo.open', { convo: c.convId, model: devModel() });
    if (!r.existing) toast(t('sidebar.convoOpened', { name: r.name, id: c.convId.slice(0, 8) }));
    goWhenOpen(r.sessionId);
  });
}

function useNow(ms = 15000) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }
const KIND_LABEL = { shell: 'sidebar.kindShell', claude: 'sidebar.kindClaude', deepseek: 'sidebar.kindDeepseek' };
const kindText = (k) => (KIND_LABEL[k] ? t(KIND_LABEL[k]) : agentKindOf(k).label);

// ---------- P44: 접기, 거르기, 고르기, 그룹, 폭 ----------
function toggleFold(key, open) { side.collapsed = { ...side.collapsed, [key]: open === undefined ? !side.collapsed[key] : !open }; persist(); bump(); }
// 모두 접기·펼치기: 지금 판의 그룹과 워크스페이스 전부
function foldAll(fold) {
  const st = getState();
  const next = { ...side.collapsed };
  for (const w of st.workspaces) next[w.key] = fold;
  for (const g of st.groups || []) next[`g:${g.id}`] = false; // 그룹은 펼쳐 두고 워크스페이스만 접는다(그룹 안 이름이 보이게)
  side.collapsed = next; persist(); bump();
}
function toggleExtra(key) { side.extra = { ...side.extra, [key]: !side.extra[key] }; bump(); }
function toggleState(b) { const n = new Set(side.states); if (n.has(b)) n.delete(b); else n.add(b); side.states = n; persist(); bump(); }
function setKind(k) { side.kind = k; persist(); bump(); }
function clearFilters() { side.filter = ''; side.states = new Set(); side.kind = ''; persist(); bump(); }
function setCursor(id) { if (side.cursor !== id) { side.cursor = id; bump(); } }
function setSelecting(v) { side.selecting = v; side.selected = new Set(); bump(); }
function toggleSelected(key) { const n = new Set(side.selected); if (n.has(key)) n.delete(key); else n.add(key); side.selected = n; bump(); }
export function setSidebarWidth(w, save = true) { side.width = clampWidth(w); if (save) persist(); bump(); }
function openMenu(e, type, key) { const r = e.currentTarget.getBoundingClientRect(); side.menu = { type, key, x: r.right, y: r.bottom + 2 }; bump(); e.stopPropagation(); }
function closeMenu() { if (side.menu) { side.menu = null; bump(); } }
async function groupCall(method, p, done) {
  try { const r = await api.call(method, p); if (done) done(r); return r; } catch (e) { toast(t('sbGroups.fail', { error: errText(e) }), 'error'); return null; }
}
async function newGroup(wsKey = null) {
  const name = freshGroupName(getState().groups, t('sbGroups.newName'));
  const r = await groupCall('group.create', { name, ...(wsKey ? { workspaces: [wsKey] } : {}) });
  if (r && r.created) { side.renaming = r.created; side.collapsed = { ...side.collapsed, [`g:${r.created}`]: false }; bump(); }
}
const renameGroup = (id, name) => groupCall('group.rename', { group: id, name }, () => { side.renaming = null; bump(); });
const removeGroup = (g) => groupCall('group.remove', { group: g.id }, () => toast(t('sbGroups.removed', { name: g.name })));
const moveToGroup = (wsKey, group, index = null) => groupCall('group.move', { workspace: wsKey, group, index });
export function removeWorkspaces(list) { if (list.length) openDialog({ kind: 'wsclose', ws: list }); }
// 끌어 놓기: 그룹 머리줄 → 그 그룹 끝, 워크스페이스 줄 → 그 앞(아래 절반이면 뒤), "그룹 없음" → 그룹에서 뺀다
function dropOn(r, after) {
  const key = side.drag;
  side.drag = null; side.dropAt = null; bump();
  if (!key) return;
  const groups = getState().groups;
  const to = adjustIndex(groups, key, dropTarget(groups, r.type === 'group' ? { type: 'group', groupId: r.g.id } : { type: 'ws', wsKey: r.w.key }, { after }));
  if (!to || (r.type === 'ws' && r.w.key === key)) return;
  moveToGroup(key, to.group, to.index);
}
const dragProps = (r) => ({
  onDragOver: (e) => { if (!side.drag) return; e.preventDefault(); const rc = e.currentTarget.getBoundingClientRect(); const after = r.type === 'ws' && e.clientY > rc.top + rc.height / 2; if (!side.dropAt || side.dropAt.id !== r.id || side.dropAt.after !== after) { side.dropAt = { id: r.id, after }; bump(); } },
  onDragLeave: () => { if (side.dropAt && side.dropAt.id === r.id) { side.dropAt = null; bump(); } },
  onDrop: (e) => { e.preventDefault(); const rc = e.currentTarget.getBoundingClientRect(); dropOn(r, r.type === 'ws' && e.clientY > rc.top + rc.height / 2); },
});
const pad = (r, extra = 0) => ({ paddingLeft: 6 + (r.depth || 0) * 14 + Math.min(r.indent || 0, 4) * 12 + extra });

function sessionTitle(s, now) {
  const br = branchLabel(s);
  const ask = s.state === 'waiting' || s.state === 'trust_wait' ? askLine(s) : '';
  return [
    `@${s.name} · ${kindText(shownKind(s))} · ${STATE_LABEL[s.state] || s.state}${s.lastActivityAt ? ` · ${ago(s.lastActivityAt, now)}` : ''}`,
    ask && `${t('sb2.tipAsk')}: ${ask}`,
    s.state === 'error' && s.error && `${t('state.error')}: ${typeof s.error === 'string' ? s.error : s.error.message || ''}`,
    s.lastPrompt && `${t('sb2.tipPrompt')}: ${s.lastPrompt}`,
    s.kind === 'shell' && s.shell && s.shell.command && `$ ${s.shell.command}`,
    br && br.title,
    t('sidebar.enterNode', { name: s.name }),
  ].filter(Boolean).join('\n');
}

// 판 세션 한 줄: 상태 점, 이름, 종류(claude가 아니면), 지난 시간. 응답 필요·오류는 질문(또는 오류) 한 줄을 더 보인다
const SessionRow = memo(function SessionRow({ r, now, cur }) {
  const t = useT();
  const s = r.s;
  const b = bucketOf(s);
  const ask = r.attn ? (b === 'need' ? askLine(s) || t(`state.${s.state}`) : (s.error && (typeof s.error === 'string' ? s.error : s.error.message)) || t(`state.${s.state}`)) : '';
  const k = shownKind(s);
  return (
    <button className={`mt-sb2-row sess b-${b}${r.attn ? ' attn' : ''}${r.pinned ? ' pinned' : ''}${cur ? ' cur' : ''}${s.unseen ? ' unseen' : ''}`} style={pad(r)} data-sb="session" data-row={r.id} data-session={s.sessionId} data-name={s.name} data-state={s.state} data-indent={r.indent || 0} data-pinned={r.pinned ? '1' : undefined}
      title={sessionTitle(s, now)} onClick={() => { setCursor(r.id); getState().navigateTo && getState().navigateTo(s.sessionId, { focusTerminal: true }); }}>
      <span className="mt-sb2-line">
        <span className={`mt-sb2-dot st-${s.state}`} data-state={s.state} />
        {k === 'shell' && <span className="mt-sb2-sh" title={kindText(k)}>$</span>}
        <b className="mt-sb2-name">{s.name}</b>
        {k !== 'claude' && k !== 'shell' && <span className="mt-sb2-kind">{kindText(k)}</span>}
        {s.branch && s.branch.role && <span className="mt-sb2-role">{s.branch.role}</span>}
        {r.attn && <span className={`mt-sb2-tag ${b}`}>{b === 'need' ? t('sb2.st_need') : t('sb2.st_error')}</span>}
        <span className="mt-sb2-time">{ago(s.lastActivityAt || s.createdAt, now)}</span>
      </span>
      {r.attn && <span className="mt-sb2-ask">{ask}</span>}
    </button>
  );
});

function Counts({ c, attnOnly = false }) {
  const t = useT();
  return (
    <span className="mt-sb2-c">
      {c.need > 0 && <span className="need" data-count="need" title={t('state.waiting')}>{c.need}</span>}
      {c.error > 0 && <span className="err" data-count="error" title={t('state.error')}>{c.error}</span>}
      {!attnOnly && c.working > 0 && <span className="work" data-count="working" title={t('state.working')}>{c.working}</span>}
      {!attnOnly && <span className="all" data-count="sessions" title={t('sb2.sessionsN', { n: c.sessions })}>{c.sessions}</span>}
    </span>
  );
}

function GroupRow({ r, cur, renaming, dropAt }) {
  const t = useT();
  const [val, setVal] = useState(r.g.name || '');
  useEffect(() => { if (renaming) setVal(r.g.name || ''); }, [renaming, r.g.name]);
  const none = r.none;
  return (
    <div className={`mt-sb2-row grp${r.open ? '' : ' folded'}${cur ? ' cur' : ''}${none ? ' none' : ''}${dropAt ? ' drop' : ''}`} style={pad(r, r.none ? 18 : 0)} data-sb="group" data-row={r.id} data-group={r.g.id || ''} data-name={r.g.name || ''} {...dragProps(r)}
      onClick={() => { setCursor(r.id); if (!none && !renaming) toggleFold(r.id); }}>
      {!none && <span className="mt-sb2-fold" data-action="fold">{r.open ? '▾' : '▸'}</span>}
      {renaming
        ? <input className="mt-sb2-rename" data-role="group-rename" autoFocus value={val} maxLength={40} onClick={(e) => e.stopPropagation()} onChange={(e) => setVal(e.target.value)} onBlur={() => (val.trim() && val.trim() !== r.g.name ? renameGroup(r.g.id, val) : (side.renaming = null, bump()))} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { side.renaming = null; bump(); } }} />
        : <span className="mt-sb2-gname" onDoubleClick={(e) => { if (!none) { e.stopPropagation(); side.renaming = r.g.id; bump(); } }}>{none ? t('sbGroups.none') : r.g.name}</span>}
      <span className="mt-sb2-gn">{r.wsN}</span>
      <Counts c={r.c} attnOnly={!r.open} />
      {!none && <button className="mt-sb2-more" data-action="group-menu" title={t('sb2.menu')} onClick={(e) => openMenu(e, 'group', r.g.id)}><Icon name="more" /></button>}
    </div>
  );
}

function WsRow({ r, cur, selecting, selected, dropAt }) {
  const t = useT();
  const w = r.w;
  return (
    <div className={`mt-sb2-row ws${r.open ? '' : ' folded'}${cur ? ' cur' : ''}${selected ? ' sel' : ''}${dropAt ? (dropAt.after ? ' drop-after' : ' drop-before') : ''}`} style={pad(r)} data-sb="ws" data-row={r.id} data-ws={w.key} data-name={w.name}
      draggable={!selecting} onDragStart={(e) => { side.drag = w.key; try { e.dataTransfer.setData('text/plain', w.name); e.dataTransfer.effectAllowed = 'move'; } catch {} bump(); }} onDragEnd={() => { side.drag = null; side.dropAt = null; bump(); }} {...dragProps(r)}
      title={`${w.root}\n${t('sb2.wsTip')}`}
      onClick={() => { setCursor(r.id); if (selecting) toggleSelected(w.key); else toggleFold(w.key); }}>
      {selecting
        ? <input type="checkbox" className="mt-sb2-check" data-action="ws-select" checked={selected} readOnly />
        : <span className="mt-sb2-fold" data-action="fold">{r.open ? '▾' : '▸'}</span>}
      {!selecting && <span className="mt-sb2-icon">{w.kind === 'repo' ? '⎇' : '▢'}</span>}
      <button className="mt-sb2-wname" data-action="go-ws" title={t('sidebar.goWs')} onClick={(e) => { e.stopPropagation(); setCursor(r.id); if (selecting) toggleSelected(w.key); else selectWorkspace(w.key); }}>{w.name}</button>
      {r.matched != null && <span className="mt-sb2-gn" data-count="matched">{r.matched}</span>}
      <Counts c={r.c} attnOnly={!r.open && r.matched == null} />
      {!selecting && <button className="mt-sb2-more" data-action="ws-menu" title={t('sb2.menu')} onClick={(e) => openMenu(e, 'ws', w.key)}><Icon name="more" /></button>}
    </div>
  );
}

function ExtraRow({ r, cur }) {
  const t = useT();
  return (
    <button className={`mt-sb2-row extra${cur ? ' cur' : ''}`} style={pad(r, 4)} data-sb="extra" data-row={r.id} data-ws={r.key} data-action="extra" onClick={() => { setCursor(r.id); toggleExtra(r.key); }}>
      <span className="mt-sb2-fold">{r.open ? '▾' : '▸'}</span>
      {[r.closedN > 0 && t('sidebar.cClosed', { n: r.closedN }), r.convosN > 0 && t('sidebar.cConvos', { n: r.convosN })].filter(Boolean).join(' · ')}
    </button>
  );
}
function SecRow({ r }) {
  const t = useT();
  return <div className="mt-sb2-row sec" style={pad(r, 18)} data-sec={r.sec}>{r.sec === 'closed' ? t('sidebar.secClosed') : t('sidebar.secConvos')} <span className="mt-sb-n">{r.n}</span></div>;
}
function MoreRow({ r, cur }) {
  const t = useT();
  const go = () => { setCursor(r.id); if (r.pinMore) { const k = r.key.slice(4); toggleFold(k, true); } else showMore(r.key); };
  return <button className={`mt-sb2-row morerow${cur ? ' cur' : ''}`} style={pad(r, 18)} data-action="more" data-row={r.id} onClick={go}>{r.pinMore ? t('sb2.attnMore', { n: r.n }) : t('sidebar.more', { n: r.n })}</button>;
}
function EmptyRow({ r }) {
  const t = useT();
  return <div className="mt-sb2-row empty" style={pad(r, 18)}>{r.group != null ? t('sbGroups.empty') : t('sidebar.wsEmpty')}</div>;
}
// 닫힌 세션·판 밖 대화: 한 줄(꼬리표, 제목, 시간). 단추(판으로 열기, 보관)와 묶인 곳은 마우스를 올리거나 고르면 보인다
function ClosedRow({ r, now, busy, cur }) {
  const t = useT();
  const c = r.x;
  const why = c.binding && c.binding.bound ? bindingText(c.binding) : null;
  const reason = (c.reason && tOr(`closeReason.${c.reason}`, c.reasonLabel)) || c.reasonLabel || t('sidebar.closedTag');
  return (
    <div className={`mt-sb2-row item closed${why ? ' bound' : ''}${cur ? ' cur' : ''}`} style={pad(r, 18)} data-sb="closed" data-row={r.id} data-session={c.sessionId} data-name={c.name} title={`@${c.name} · ${reason}${c.lastPrompt ? `\n${c.lastPrompt}` : ''}${why ? `\n${why}` : ''}`} onClick={() => setCursor(r.id)}>
      <span className="mt-sb-tag closed">{t('sidebar.closedTag')}</span><b className="mt-sb2-name">{c.name}</b>{shownKind(c) !== 'claude' && <span className="mt-sb2-kind">{kindText(shownKind(c))}</span>}
      <span className="mt-sb2-time">{ago(c.closedAt, now)}</span>
      <span className="mt-sb2-acts">
        {why ? <span className="mt-sb-bound" data-bound={c.binding.where}>{why}</span>
          : <button className="mt-btn small" data-action="reopen" disabled={busy} onClick={(e) => { e.stopPropagation(); reopenClosed(c); }}>{busy ? t('sidebar.opening') : t('sidebar.openOnBoard')}</button>}
        <button className="mt-btn small ghost" data-action="archive" title={t('sidebar.archiveClosedTitle')} onClick={(e) => { e.stopPropagation(); archiveItem(c); }}>{t('common.archive')}</button>
      </span>
    </div>
  );
}
function ConvoRow({ r, now, busy, cur }) {
  const t = useT();
  const c = r.x;
  const b = c.binding || { bound: false };
  const title = c.title || c.firstPrompt || c.convId.slice(0, 8);
  return (
    <div className={`mt-sb2-row item convo${b.bound ? ' bound' : ''}${cur ? ' cur' : ''}`} style={pad(r, 18)} data-sb="convo" data-row={r.id} data-convo={c.convId} data-bound={b.bound ? b.where : ''} onClick={() => setCursor(r.id)}
      title={`${c.title || ''}\n${t('sidebar.convoId', { id: c.convId })}${c.cwd ? `\n${c.cwd}` : ''}${[c.folder, c.branch && `⎇ ${c.branch}`].filter(Boolean).length ? `\n${[c.folder, c.branch && `⎇ ${c.branch}`].filter(Boolean).join(' · ')}` : ''}${c.lastPrompt && c.lastPrompt !== c.title ? `\n${c.lastPrompt}` : ''}${b.bound ? `\n${bindingText(b)}` : ''}`}>
      <span className="mt-sb-tag convo">{t('sidebar.convoTag')}</span>
      {c.onCanvas ? <button className="mt-sb-title link mt-sb2-name" data-action="go-convo" title={t('sidebar.goConvo')} onClick={(e) => { e.stopPropagation(); getState().navigateToItem && getState().navigateToItem(`convo:${c.convId}`); }}>{title}</button> : <b className="mt-sb2-name">{title}</b>}
      <span className="mt-sb2-time">{ago(c.lastAt, now)}</span>
      <span className="mt-sb2-acts">
        {b.bound ? <span className="mt-sb-bound" data-bound={b.where} title={b.sure ? '' : t('sidebar.boundUnsure')}>{bindingText(b)}</span>
          : <button className="mt-btn small" data-action="open-convo" disabled={busy} onClick={(e) => { e.stopPropagation(); openConvo(c); }}>{busy ? t('sidebar.opening') : t('sidebar.openOnBoard')}</button>}
        <button className="mt-btn small ghost" data-action="archive" title={t('sidebar.archiveConvoTitle')} onClick={(e) => { e.stopPropagation(); archiveItem(c); }}>{t('common.archive')}</button>
      </span>
    </div>
  );
}

function Row({ r, now, cur, busy, selecting, selected, renaming, dropAt }) {
  switch (r.type) {
    case 'group': return <GroupRow r={r} cur={cur} renaming={renaming} dropAt={dropAt} />;
    case 'ws': return <WsRow r={r} cur={cur} selecting={selecting} selected={selected} dropAt={dropAt} />;
    case 'session': return <SessionRow r={r} now={now} cur={cur} />;
    case 'extra': return <ExtraRow r={r} cur={cur} />;
    case 'sec': return <SecRow r={r} />;
    case 'closed': return <ClosedRow r={r} now={now} busy={busy} cur={cur} />;
    case 'convo': return <ConvoRow r={r} now={now} busy={busy} cur={cur} />;
    case 'more': return <MoreRow r={r} cur={cur} />;
    default: return <EmptyRow r={r} />;
  }
}

// 고른 줄에서 Enter
function activate(r) {
  if (!r) return;
  if (r.type === 'group') { if (!r.none) toggleFold(r.id); }
  else if (r.type === 'ws') { if (side.selecting) toggleSelected(r.w.key); else selectWorkspace(r.w.key); }
  else if (r.type === 'session') { const st = getState(); if (st.navigateTo) st.navigateTo(r.s.sessionId, { focusTerminal: true }); }
  else if (r.type === 'extra') toggleExtra(r.key);
  else if (r.type === 'more') { if (r.pinMore) toggleFold(r.key.slice(4), true); else showMore(r.key); }
  else if (r.type === 'closed' && !(r.x.binding && r.x.binding.bound)) reopenClosed(r.x);
  else if (r.type === 'convo' && !(r.x.binding && r.x.binding.bound)) openConvo(r.x);
}

// 메뉴(워크스페이스: 영역으로, 그룹으로 옮기기, 새 그룹으로, 오래된 것 보관, 판에서 지우기 / 그룹: 이름 바꾸기, 그룹 지우기)
function SideMenu() {
  const t = useT();
  const menu = useSide((st) => st.menu);
  const groups = useStore((st) => st.groups);
  const workspaces = useStore((st) => st.workspaces);
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!menu || !box.current) { setPos(null); return; }
    const r = box.current.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(window.innerWidth - r.width - 4, menu.x - r.width)), top: Math.max(4, Math.min(window.innerHeight - r.height - 4, menu.y)) });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const down = (e) => { if (box.current && !box.current.contains(e.target)) closeMenu(); };
    const key = (e) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('mousedown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
  }, [menu]);
  if (!menu) return null;
  const item = (action, label, fn, extra = {}) => <button key={action + (extra.k || '')} className={`mt-sb2-mi${extra.on ? ' on' : ''}${extra.danger ? ' danger' : ''}`} data-action={action} data-group={extra.group} disabled={extra.disabled} onClick={() => { closeMenu(); fn(); }}>{label}</button>;
  let body = null;
  if (menu.type === 'ws') {
    const w = workspaces.find((x) => x.key === menu.key);
    if (!w) return null;
    const cur = (groups.find((g) => g.members.includes(w.key)) || {}).id || null;
    body = <>
      <div className="mt-sb2-mh">{w.name}</div>
      {item('menu-go-ws', t('sidebar.goWs'), () => selectWorkspace(w.key))}
      <div className="mt-sb2-mh sub">{t('sbGroups.moveTo')}</div>
      {groups.map((g) => item('menu-move-group', g.name, () => moveToGroup(w.key, g.id), { k: g.id, group: g.id, on: cur === g.id, disabled: cur === g.id }))}
      {item('menu-new-group', t('sbGroups.newWith'), () => newGroup(w.key))}
      {cur && item('menu-ungroup', t('sbGroups.ungroup'), () => moveToGroup(w.key, null))}
      <div className="mt-sb2-msep" />
      {item('archive-old', t('sidebar.archiveOld'), () => askOld(w))}
      {item('menu-remove-ws', t('sbRemove.menu'), () => removeWorkspaces([w]), { danger: true })}
    </>;
  } else {
    const g = groups.find((x) => x.id === menu.key);
    if (!g) return null;
    body = <>
      <div className="mt-sb2-mh">{g.name}</div>
      {item('menu-rename-group', t('sbGroups.rename'), () => { side.renaming = g.id; bump(); })}
      {item('menu-remove-ws', t('sbRemove.groupMenu', { n: g.members.length }), () => removeWorkspaces(workspaces.filter((w) => g.members.includes(w.key))), { disabled: !g.members.length })}
      {item('menu-remove-group', t('sbGroups.remove'), () => removeGroup(g), { danger: true })}
    </>;
  }
  return <div ref={box} className="mt-sb2-menu" data-role="sidebar-menu" style={pos || { left: -9999, top: -9999 }}>{body}</div>;
}

// "오래된 것 보관" 확인 줄(메뉴에서 연다)
function OldAsk() {
  const t = useT();
  const a = useSide((st) => st.oldAsk);
  const workspaces = useStore((st) => st.workspaces);
  if (!a) return null;
  const w = workspaces.find((x) => x.key === a.key) || { key: a.key, name: a.name };
  return (
    <div className="mt-sb-oldask" data-role="old-ask"><span><b>{w.name}</b> · {tMsg(a)}</span>
      {a.count > 0 && <button className="mt-btn small" data-action="old-confirm" onClick={() => confirmOld(w)}>{t('common.archive')}</button>}
      <button className="mt-btn small ghost" onClick={() => { side.oldAsk = null; bump(); }}>{a.count > 0 ? t('common.cancel') : t('common.close')}</button></div>
  );
}

// 거르기 칩: 상태 묶음(판 전체 수)과 종류
function FilterBar({ counts, kinds, rows }) {
  const t = useT();
  const states = useSide((st) => st.states);
  const kind = useSide((st) => st.kind);
  const filter = useSide((st) => st.filter);
  const selecting = useSide((st) => st.selecting);
  const any = states.size || kind || filter;
  const heads = rows.filter((r) => r.type === 'ws');
  const allFolded = heads.length > 0 && heads.every((r) => !r.open);
  return (
    <div className="mt-sb2-chips" data-role="sidebar-chips">
      {BUCKETS.map((b) => (counts[b] > 0 || states.has(b)) && <button key={b} className={`mt-sb2-chip b-${b}${states.has(b) ? ' on' : ''}`} data-action="state-chip" data-bucket={b} onClick={() => toggleState(b)}>{t(`sb2.st_${b}`)} <span>{counts[b]}</span></button>)}
      {kinds.length > 1 && (
        <select className="mt-sb2-kind-sel" data-role="kind-filter" value={kind} onChange={(e) => setKind(e.target.value)} title={t('sb2.kindTitle')}>
          <option value="">{t('sb2.kindAll')}</option>
          {kinds.map((k) => <option key={k} value={k}>{kindText(k)}</option>)}
        </select>
      )}
      {any ? <button className="mt-sb2-chip clear" data-action="clear-filters" onClick={clearFilters}>{t('sb2.clear')}</button> : null}
      <span className="mt-sb2-tools">
        <button className="mt-sb2-tool" title={allFolded ? t('sb2.unfoldAll') : t('sb2.foldAll')} data-action={allFolded ? 'unfold-all' : 'fold-all'} onClick={() => foldAll(!allFolded)}>{allFolded ? '⊞' : '⊟'}</button>
        <button className="mt-sb2-tool" title={t('sbGroups.newTitle')} data-action="group-new" onClick={() => newGroup()}><Icon name="plus" /></button>
        <button className={`mt-sb2-tool text${selecting ? ' on' : ''}`} title={t('sbRemove.selectTitle')} data-action="select-mode" onClick={() => setSelecting(!selecting)}>{t('sbRemove.select')}</button>
      </span>
    </div>
  );
}

// 가상 스크롤 목록: 보이는 줄(위아래 몇 줄 더)만 그린다. 목록 뒤에 보관함과 missed 함이 이어진다
function VirtualList({ rows, now, scroller }) {
  const off = useMemo(() => offsetsOf(rows), [rows]);
  const [view, setView] = useState({ top: 0, h: 800 });
  const cursor = useSide((st) => st.cursor);
  const busy = useSide((st) => st.busy);
  const selecting = useSide((st) => st.selecting);
  const selected = useSide((st) => st.selected);
  const renaming = useSide((st) => st.renaming);
  const dropAt = useSide((st) => st.dropAt);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setView({ top: el.scrollTop, h: el.clientHeight })); };
    on();
    el.addEventListener('scroll', on, { passive: true });
    const ro = new ResizeObserver(on); ro.observe(el);
    return () => { el.removeEventListener('scroll', on); ro.disconnect(); cancelAnimationFrame(raf); };
  }, [scroller]);
  // 키보드로 고른 줄이 보이게
  useEffect(() => {
    const el = scroller.current;
    if (!el || !cursor) return;
    const i = rows.findIndex((r) => r.id === cursor);
    if (i < 0) return;
    const top = scrollFor(off, i, el.scrollTop, el.clientHeight);
    if (top !== el.scrollTop) el.scrollTop = top;
  }, [cursor, rows, off, scroller]);
  const win = windowOf(off, view.top, view.h);
  const out = [];
  for (let i = win.start; i < win.end; i++) {
    const r = rows[i];
    const key = r.type === 'ws' ? r.w.key : r.type === 'closed' || r.type === 'convo' ? r.x.sessionId || r.x.convId : '';
    out.push(
      <div key={r.id} className="mt-sb2-slot" style={{ top: off[i], height: r.h }}>
        <Row r={r} now={now} cur={cursor === r.id} busy={busy.has(key)} selecting={selecting} selected={r.type === 'ws' && selected.has(r.w.key)} renaming={r.type === 'group' && !!renaming && renaming === r.g.id} dropAt={dropAt && dropAt.id === r.id ? dropAt : null} />
      </div>,
    );
  }
  return <div className="mt-sb2-virtual" data-role="sidebar-rows" data-rows={rows.length} data-shown={out.length} style={{ height: win.total }}>{out}</div>;
}

// P10: 보관함. 접혀 있다가 펼치면 읽는다. 리포별 묶음, 거르기, 꺼내기
function ArchivedRow({ c, now, busy }) {
  const t = useT();
  const convo = !c.sessionId;
  const auto = c.archive && c.archive.why === 'auto';
  return (
    <div className={`mt-sb-row archived ${convo ? 'convo' : 'closed'}`} data-sb="archived" data-kind={convo ? 'convo' : 'session'} data-convo={c.convId || ''} data-session={c.sessionId || ''} data-name={c.name || ''} title={convo ? `${c.title || ''}\n${t('sidebar.convoId', { id: c.convId })}${c.cwd ? `\n${c.cwd}` : ''}` : `@${c.name}`}>
      <span className="mt-sb-line"><span className="mt-sb-tag arch">{convo ? t('sidebar.convoTag') : t('sidebar.closedTag')}</span><b className="mt-sb-title">{convo ? c.title || c.firstPrompt || c.convId.slice(0, 8) : `@${c.name}`}</b><span className="mt-sb-time">{ago(convo ? c.lastAt : c.lastActivityAt || c.closedAt, now)}</span></span>
      <span className="mt-sb-sub">{auto ? t('archive.whyAuto') : t('archive.whyHand')}{convo ? [c.folder, c.branch && `⎇ ${c.branch}`].filter(Boolean).map((x) => ` · ${x}`).join('') : c.reasonLabel ? ` · ${tOr(`closeReason.${c.reason}`, c.reasonLabel)}` : ''}{c.lastPrompt && c.lastPrompt !== c.title ? ` · ${c.lastPrompt}` : ''}</span>
      <span className="mt-sb-acts"><button className="mt-btn small" data-action="restore" disabled={busy} onClick={() => restoreItem(c)}>{busy ? '…' : t('archive.restore')}</button></span>
    </div>
  );
}
function ArchiveBox({ now }) {
  const t = useT();
  const open = useSide((st) => st.archiveOpen);
  const data = useSide((st) => st.archive);
  const loading = useSide((st) => st.archiveLoading);
  const filter = useSide((st) => st.archiveFilter);
  const busy = useSide((st) => st.busy);
  const counted = useSide((st) => ((st.data && st.data.workspaces) || []).reduce((n, w) => n + (w.archived || 0), 0));
  const groups = useMemo(() => archiveRows({ workspaces: (data && data.workspaces) || [], filter }), [data, filter]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const box = useRef(null);
  useEffect(() => { if (open && box.current) box.current.scrollIntoView({ block: 'start' }); }, [open]); // 펼치면 보이게(목록 맨 아래에 있다)
  return (
    <div ref={box} className={`mt-sb-archive${open ? ' open' : ''}`} data-role="archive-box">
      <button className="mt-sb-archive-head" data-action="archive-box" onClick={() => setArchiveOpen(!open)} title={t('archive.boxTitle')}>
        <span>{open ? '▾' : '▸'}</span> {t('archive.box')} <span className="mt-sb-n">{open && data ? total : counted}</span>
        {data && data.days > 0 && <span className="mt-sb-dim">· {t('archive.autoDays', { n: data.days })}</span>}
      </button>
      {open && (
        <div className="mt-sb-archive-body">
          <input className="mt-sb-filter" data-role="archive-filter" placeholder={t('archive.filter')} value={filter} onChange={(e) => setArchiveFilter(e.target.value)} onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.keyCode !== 229 && e.key === 'Escape') setArchiveFilter(''); }} />
          {loading && !data && <div className="mt-sb-empty">{t('common.loading')}</div>}
          {data && !total && <div className="mt-sb-empty">{filter ? t('archive.noMatch') : t('archive.empty')}</div>}
          {groups.map((g) => (
            <div key={g.key} className="mt-sb-archive-ws" data-ws={g.key} data-name={g.name}>
              <div className="mt-sb-sec-head">{g.name} <span className="mt-sb-n">{g.rows.length}</span></div>
              {g.rows.slice(0, filter ? 100 : 30).map((c) => <ArchivedRow key={c.sessionId || c.convId} c={c} now={now} busy={busy.has(c.sessionId || c.convId)} />)}
              {g.rows.length > (filter ? 100 : 30) && <div className="mt-sb-empty">{t('archive.moreRows', { n: g.rows.length - (filter ? 100 : 30) })}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// P13: missed(지울 대화) 함. 접혀 있다가 펼치면 읽는다. 폴더별 묶음(수, 크기, 마지막 활동), 모두 지우기, 폴더 지우기, 하나 지우기. 모두 확인창을 거친다
function MissedBox({ now }) {
  const t = useT();
  const open = useSide((st) => st.missedOpen);
  const data = useSide((st) => st.missed);
  const loading = useSide((st) => st.missedLoading);
  const counted = useSide((st) => (st.data ? st.data.missed || 0 : 0));
  const busy = useSide((st) => st.busy.has('missed'));
  const [unfold, setUnfold] = useState({});
  const box = useRef(null);
  useEffect(() => { if (open && box.current) box.current.scrollIntoView({ block: 'start' }); }, [open]);
  return (
    <div ref={box} className={`mt-sb-archive mt-sb-missed${open ? ' open' : ''}`} data-role="missed-box">
      <button className="mt-sb-archive-head" data-action="missed-box" onClick={() => setMissedOpen(!open)} title={t('missed.boxTitle')}>
        <span>{open ? '▾' : '▸'}</span> {t('missed.box')} <span className="mt-sb-n" data-count="missed">{open && data ? data.count : counted}</span>
        {open && data && data.count > 0 && <span className="mt-sb-dim">· {fmtBytes(data.bytes)}</span>}
      </button>
      {open && (
        <div className="mt-sb-archive-body">
          {loading && !data && <div className="mt-sb-empty">{t('common.loading')}</div>}
          {data && !data.count && <div className="mt-sb-empty">{t('missed.empty')}</div>}
          {data && data.count > 0 && <div className="mt-sb-tools"><button className="mt-btn small danger" data-action="missed-all" disabled={busy} onClick={() => askMissed({ all: true })}>{busy ? t('missed.deleting') : t('missed.deleteAll', { n: data.count })}</button><span className="mt-sb-dim">{t('missed.toTrash')}</span></div>}
          {data && data.folders.map((g) => (
            <div key={g.folder} className="mt-sb-missed-ws" data-folder={g.folder} data-why={g.why}>
              <div className="mt-sb-missed-head">
                <button className="mt-sb-fold" data-action="missed-fold" onClick={() => setUnfold((u) => ({ ...u, [g.folder]: !u[g.folder] }))}>{unfold[g.folder] ? '▾' : '▸'}</button>
                <span className="mt-sb-missed-path" title={g.folder}>{g.folder.split('/').slice(-2).join('/')}</span>
                <span className="mt-sb-tag missed">{WHY[g.why] ? t(WHY[g.why]) : g.why}</span>
              </div>
              <div className="mt-sb-missed-meta"><span data-count="folder">{t('missed.count', { n: g.count })}</span> · {fmtBytes(g.bytes)} · {ago(g.lastAt, now)}
                <button className="mt-btn small ghost" data-action="missed-folder" disabled={busy} onClick={() => askMissed({ folder: g.folder })}>{t('missed.deleteFolder')}</button></div>
              {unfold[g.folder] && g.items.map((c) => (
                <div key={c.convId} className="mt-sb-row missed" data-sb="missed" data-convo={c.convId}>
                  <span className="mt-sb-line"><b className="mt-sb-title">{c.title || c.convId.slice(0, 8)}</b><span className="mt-sb-time">{ago(c.lastAt, now)}</span></span>
                  <span className="mt-sb-sub">{fmtBytes(c.size)}{c.subagents ? ` · ${t('missed.subagents', { n: c.subagents })}` : ''} · {c.convId.slice(0, 8)}</span>
                  <span className="mt-sb-acts"><button className="mt-btn small ghost" data-action="missed-one" disabled={busy} onClick={() => askMissed({ convos: [c.convId] })}>{t('missed.deleteOne')}</button></span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// 지우기 확인창: 지울 대화 수, 크기, 폴더 목록
export function MissedConfirm() {
  const t = useT();
  const a = useSide((st) => st.missedAsk);
  if (!a) return null;
  const close = () => { side.missedAsk = null; bump(); };
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="mt-modal" data-role="missed-confirm">
        <h3>{t('missed.confirmTitle')}</h3>
        <div className="mt-card-sub" data-role="missed-confirm-msg">{tMsg(a)}</div>
        {a.count > 0 && <div className="mt-missed-sum"><b data-count="confirm-count">{t('missed.count', { n: a.count })}</b> · <b data-count="confirm-bytes">{fmtBytes(a.bytes)}</b> · {t('missed.folders', { n: a.folders.length })}</div>}
        {a.count > 0 && <ul className="mt-missed-folders" data-role="missed-confirm-folders">{a.folders.map((f) => <li key={f.folder} data-folder={f.folder}><span className="mono">{f.folder}</span> <span className="dim">{t('missed.count', { n: f.count })} · {fmtBytes(f.bytes)}</span></li>)}</ul>}
        <div className="mt-card-sub dim">{t('missed.confirmNote')}</div>
        <div className="mt-card-actions">
          {a.count > 0 && <button className="mt-btn danger" data-action="missed-confirm" onClick={confirmMissed}>{t('missed.confirmOk')}</button>}
          <button className="mt-btn ghost" data-action="missed-cancel" onClick={close}>{a.count > 0 ? t('common.cancel') : t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}

export function SidebarToggle() {
  const t = useT();
  const open = useSide((st) => st.open);
  return <button className={`mt-sb-toggle${open ? ' on' : ''}`} data-action="sidebar" title={t('top.sidebar')} onClick={toggleSidebar}>☰</button>;
}

// P44: 오른쪽 가장자리를 끌어 폭을 바꾼다. 두 번 누르면 기본 폭
function ResizeHandle() {
  const t = useT();
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = side.width;
    document.body.classList.add('mt-sb2-resizing');
    const move = (ev) => setSidebarWidth(w0 + ev.clientX - x0, false);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.classList.remove('mt-sb2-resizing'); persist(); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  return <div className="mt-sb2-resize" data-role="sidebar-resize" title={t('sb2.resize')} onMouseDown={down} onDoubleClick={() => setSidebarWidth(SIDE_W.def)} />;
}

// 고르기 모드 아래 막대: 고른 수, 판에서 지우기, 끝
function SelectBar() {
  const t = useT();
  const selected = useSide((st) => st.selected);
  const workspaces = useStore((st) => st.workspaces);
  const list = workspaces.filter((w) => selected.has(w.key));
  return (
    <div className="mt-sb2-selbar" data-role="sidebar-selbar">
      <span>{t('sbRemove.selected', { n: list.length })}</span>
      <button className="mt-btn small danger" data-action="remove-selected" disabled={!list.length} onClick={() => removeWorkspaces(list)}>{t('sbRemove.button')}</button>
      <button className="mt-btn small ghost" data-action="select-done" onClick={() => setSelecting(false)}>{t('common.cancel')}</button>
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const open = useSide((st) => st.open);
  const data = useSide((st) => st.data);
  const loading = useSide((st) => st.loading);
  const filter = useSide((st) => st.filter);
  const width = useSide((st) => st.width);
  const collapsed = useSide((st) => st.collapsed);
  const extra = useSide((st) => st.extra);
  const more = useSide((st) => st.more);
  const states = useSide((st) => st.states);
  const kind = useSide((st) => st.kind);
  const selecting = useSide((st) => st.selecting);
  const workspaces = useStore((st) => st.workspaces);
  const groups = useStore((st) => st.groups);
  const sessions = useStore((st) => st.sessions);
  const now = useNow();
  const input = useRef(null);
  const scroller = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'E' || e.key === 'e' || e.code === 'KeyE')) { e.preventDefault(); e.stopPropagation(); toggleSidebar(); }
    };
    window.addEventListener('keydown', onKey, true); // 터미널에 초점이 있어도 받는다(Ctrl+F와 같이)
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => { if (open && !data) refresh(); }, [open, data]);
  const list = useMemo(() => [...sessions.values()], [sessions]);
  const built = useMemo(() => buildRows({ workspaces, groups, sessions: list, data, collapsed, extra, more, filter, states, kind }), [workspaces, groups, list, data, collapsed, extra, more, filter, states, kind]);
  const rows = built.rows;
  // 고른 워크스페이스가 판에서 빠지면 고름에서도 뺀다
  useEffect(() => { if (side.selected.size) { const keys = new Set(workspaces.map((w) => w.key)); const n = new Set([...side.selected].filter((k) => keys.has(k))); if (n.size !== side.selected.size) { side.selected = n; bump(); } } }, [workspaces]);
  const onListKey = useCallback((e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || e.target !== e.currentTarget) return; // 줄 안의 입력 칸(그룹 이름)은 그대로
    const id = side.cursor;
    const r = rows.find((x) => x.id === id);
    const page = Math.max(1, Math.floor(((scroller.current && scroller.current.clientHeight) || 600) / 30) - 1);
    const go = (d) => { e.preventDefault(); setCursor(moveCursor(rows, id, d)); };
    if (e.key === 'ArrowDown') return go(1);
    if (e.key === 'ArrowUp') { if (!r || rows.findIndex((x) => x.id === id) === rows.findIndex((x) => x.type !== 'sec' && x.type !== 'empty')) { e.preventDefault(); input.current && input.current.focus(); return; } return go(-1); }
    if (e.key === 'PageDown') return go(page);
    if (e.key === 'PageUp') return go(-page);
    if (e.key === 'Home') return go('home');
    if (e.key === 'End') return go('end');
    if (e.key === 'Enter') { e.preventDefault(); activate(r); return; }
    if (e.key === ' ' && r && r.type === 'ws' && side.selecting) { e.preventDefault(); toggleSelected(r.w.key); return; }
    if (e.key === 'ArrowRight' && r) {
      e.preventDefault();
      if (r.type === 'group' && !r.none && !r.open) toggleFold(r.id, true);
      else if (r.type === 'ws' && !r.open) toggleFold(r.w.key, true);
      else if (r.type === 'extra' && !r.open) toggleExtra(r.key);
      else go(1);
      return;
    }
    if (e.key === 'ArrowLeft' && r) {
      e.preventDefault();
      if (r.type === 'group' && !r.none && r.open) toggleFold(r.id, false);
      else if (r.type === 'ws' && r.open && !built.filtering) toggleFold(r.w.key, false);
      else if (r.type === 'extra' && r.open) toggleExtra(r.key);
      else { const p = parentOf(rows, id); if (p) setCursor(p); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); if (side.selecting) setSelecting(false); else input.current && input.current.focus(); }
  }, [rows, built.filtering]);
  if (!open) return null;
  return (
    <aside className="mt-sidebar mt-sb2" data-role="sidebar" style={{ width, flex: `0 0 ${width}px` }} data-width={width}>
      <MissedConfirm />
      <SideMenu />
      <div className="mt-sb-top">
        <input ref={input} className="mt-sb-filter" data-role="sidebar-filter" placeholder={t('sb2.filterPh')} value={filter} onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Escape') { if (filter) setFilter(''); else setSidebarOpen(false); }
            if (e.key === 'ArrowDown' || (e.key === 'Enter' && filter)) { e.preventDefault(); scroller.current && scroller.current.focus(); const first = moveCursor(rows, null, 1); setCursor(first); if (e.key === 'Enter') activate(rows.find((x) => x.id === first)); }
          }} />
        <button className="mt-btn small ghost" title={t('sidebar.refresh')} data-action="sidebar-refresh" onClick={() => api.call('convo.scan').then(refresh).catch(() => refresh())}>{loading ? '…' : '↻'}</button>
        <button className="mt-btn small ghost" title={t('sidebar.closeTitle')} data-action="sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
      </div>
      <FilterBar counts={built.counts} kinds={built.kinds} rows={rows} />
      <OldAsk />
      <div className="mt-sb-list mt-sb2-list" ref={scroller} tabIndex={0} data-role="sidebar-list" onKeyDown={onListKey} onFocus={(e) => { if (e.target === e.currentTarget && !side.cursor) setCursor(moveCursor(rows, null, 1)); }}>
        {!workspaces.length && <div className="mt-sb-empty">{t('sidebar.noWs')}</div>}
        {workspaces.length > 0 && built.filtering && !rows.length && <div className="mt-sb-empty" data-role="sidebar-nomatch">{t('sb2.noMatch')}</div>}
        <VirtualList rows={rows} now={now} scroller={scroller} />
        {workspaces.length > 0 && <ArchiveBox now={now} />}
        <MissedBox now={now} />
      </div>
      {selecting ? <SelectBar /> : <div className="mt-sb-foot">{data && data.scan ? t('sidebar.scanned', { n: data.scan.files, ago: ago(data.scannedAt, now) }) : loading ? t('common.loading') : ''}</div>}
      <ResizeHandle />
    </aside>
  );
}
