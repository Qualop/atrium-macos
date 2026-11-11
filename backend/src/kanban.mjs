// I4 칸반(체크리스트) 노드(P6b, ARCH 4절 I4): 열(기본: 할 일, 하는 중, 끝)과 카드를 가진 노드. 열 하나짜리는 체크리스트다.
// 카드는 세션에 이을 수 있다. 이은 카드에는 세션 요약(이름, 상태, 내 차례, 검토 대기, 마지막 답 앞부분)을 붙여 준다.
// 창은 session.updated 이벤트로 이은 카드의 상태를 따라 바꾼다(카드의 sessionId로 찾는다).
// 열과 카드 바꾸기는 순수 함수 applyKanbanOp로 한다(단위 시험). 노드 자리와 워크스페이스 소속은 메모와 같은 규칙이다(memos.mjs).
import crypto from 'node:crypto';
import { m, confirmResult } from './msg.mjs'; // P16: 화면 글 열쇠
import { geometry, placeAt, requireWorkspace } from './memos.mjs';

export const KANBAN = { w: 640, h: 360, minW: 200, minH: 120, maxColumns: 12, maxCards: 500, maxText: 2000, maxTitle: 80 };
export const DEFAULT_COLUMNS = ['할 일', "진행 중", "완료"];
const rid = (p) => p + crypto.randomBytes(4).toString('hex');
const bad = (m) => Object.assign(new Error(m), { code: 'bad_request' });
const notFound = (m) => Object.assign(new Error(m), { code: 'not_found' });

export function newColumns(names = DEFAULT_COLUMNS, now = Date.now()) {
  const list = (names && names.length ? names : DEFAULT_COLUMNS).map((n) => colName(n));
  if (list.length > KANBAN.maxColumns) throw bad(`열은 ${KANBAN.maxColumns}개까지`);
  return list.map((name) => ({ columnId: rid('k'), name, cards: [], createdAt: now }));
}
function colName(n) { const s = String(n ?? '').trim(); if (!s || s.length > 40) throw bad("열 이름은 1~40자로 입력하세요."); return s; }
function cardText(t) { const s = String(t ?? '').replace(/\r\n?/g, '\n').trim(); if (!s || s.length > KANBAN.maxText) throw bad(`카드 내용은 1~${KANBAN.maxText}자`); return s; }
const clampIndex = (i, n) => (i == null ? n : Math.max(0, Math.min(n, Math.trunc(Number(i)) || 0)));

export function findCard(columns, cardId) {
  for (const c of columns) { const i = c.cards.findIndex((x) => x.cardId === cardId); if (i >= 0) return { column: c, index: i, card: c.cards[i] }; }
  return null;
}
export function findColumn(columns, ref) {
  if (ref == null) return null;
  return columns.find((c) => c.columnId === ref) || columns.find((c) => c.name === ref) || (Number.isInteger(ref) ? columns[ref] : null) || null;
}

// 칸반의 열과 카드에 바꾸기 하나를 한다. 새 열 배열과 결과(만든 ID 등)를 돌려준다. 받은 배열은 바꾸지 않는다.
// 세션 이름은 미리 sessionId로 풀어서 넘긴다(op.sessionId, null이면 잇기 풀기)
export function applyKanbanOp(columns, op, now = Date.now()) {
  const cols = structuredClone(columns);
  const total = () => cols.reduce((n, c) => n + c.cards.length, 0);
  switch (op && op.op) {
    case 'addColumn': {
      if (cols.length >= KANBAN.maxColumns) throw bad(`열은 ${KANBAN.maxColumns}개까지`);
      const c = { columnId: rid('k'), name: colName(op.name), cards: [], createdAt: now };
      cols.splice(clampIndex(op.index, cols.length), 0, c);
      return { columns: cols, result: { columnId: c.columnId } };
    }
    case 'renameColumn': { const c = findColumn(cols, op.column); if (!c) throw notFound(`열을 찾을 수 없습니다: ${op.column}`); c.name = colName(op.name); return { columns: cols, result: { columnId: c.columnId } }; }
    case 'moveColumn': {
      const c = findColumn(cols, op.column); if (!c) throw notFound(`열을 찾을 수 없습니다: ${op.column}`);
      cols.splice(cols.indexOf(c), 1); cols.splice(clampIndex(op.index, cols.length), 0, c);
      return { columns: cols, result: { columnId: c.columnId } };
    }
    case 'removeColumn': {
      const c = findColumn(cols, op.column); if (!c) throw notFound(`열을 찾을 수 없습니다: ${op.column}`);
      if (cols.length === 1) throw bad("마지막 열은 삭제할 수 없습니다. 칸반 전체를 삭제하세요.");
      cols.splice(cols.indexOf(c), 1);
      return { columns: cols, result: { columnId: c.columnId, removedCards: c.cards.length } };
    }
    case 'addCard': {
      if (total() >= KANBAN.maxCards) throw bad(`카드는 ${KANBAN.maxCards}개까지`);
      const c = op.column == null ? cols[0] : findColumn(cols, op.column); if (!c) throw notFound(`열을 찾을 수 없습니다: ${op.column}`);
      const card = { cardId: rid('c'), text: cardText(op.text), sessionId: op.sessionId ?? null, createdAt: now, updatedAt: now };
      c.cards.splice(clampIndex(op.index, c.cards.length), 0, card);
      return { columns: cols, result: { cardId: card.cardId, columnId: c.columnId } };
    }
    case 'editCard': { const f = findCard(cols, op.card); if (!f) throw notFound(`카드를 찾을 수 없습니다: ${op.card}`); f.card.text = cardText(op.text); f.card.updatedAt = now; return { columns: cols, result: { cardId: f.card.cardId } }; }
    case 'moveCard': {
      const f = findCard(cols, op.card); if (!f) throw notFound(`카드를 찾을 수 없습니다: ${op.card}`);
      const to = findColumn(cols, op.column ?? f.column.columnId); if (!to) throw notFound(`열을 찾을 수 없습니다: ${op.column}`);
      f.column.cards.splice(f.index, 1);
      to.cards.splice(clampIndex(op.index, to.cards.length), 0, f.card);
      f.card.updatedAt = now;
      return { columns: cols, result: { cardId: f.card.cardId, columnId: to.columnId } };
    }
    case 'removeCard': { const f = findCard(cols, op.card); if (!f) throw notFound(`카드를 찾을 수 없습니다: ${op.card}`); f.column.cards.splice(f.index, 1); return { columns: cols, result: { cardId: f.card.cardId } }; }
    case 'linkCard': { const f = findCard(cols, op.card); if (!f) throw notFound(`카드를 찾을 수 없습니다: ${op.card}`); f.card.sessionId = op.sessionId ?? null; f.card.updatedAt = now; return { columns: cols, result: { cardId: f.card.cardId, sessionId: f.card.sessionId } }; }
    default: throw bad(`알 수 없는 칸반 작업입니다: ${op && op.op}`);
  }
}

// ctx: { store, broadcast, resolveWorkspace, occupied, resolveSession(ref) → { sessionId }, sessionCard(sessionId) → 요약, apiError }
export class Kanbans {
  constructor(ctx) { this.ctx = ctx; }
  find(ref) { const k = ref && this.ctx.store.getKanban(String(ref)); if (!k) throw this.ctx.apiError('not_found', `칸반을 찾을 수 없습니다: ${ref}`); return k; }
  async wsKey(ref) { if (ref === undefined) return undefined; if (ref === null || ref === '') return null; return (await this.ctx.resolveWorkspace(ref)).key; }
  title(t, fallback) { const s = String(t ?? fallback ?? '').trim(); if (!s || s.length > KANBAN.maxTitle) throw this.ctx.apiError('bad_request', `제목은 1~${KANBAN.maxTitle}자`); return s; }
  // 이은 카드에 세션 요약을 붙인다
  view(k) { return { ...k, columns: k.columns.map((c) => ({ ...c, cards: c.cards.map((card) => (card.sessionId ? { ...card, session: this.ctx.sessionCard(card.sessionId) } : card)) })) }; }
  emit(k) { const v = this.view(k); this.ctx.broadcast('kanban.updated', v); return v; }

  // kanban.create { title?, columns?: [이름…], x?, y?, w?, h?, workspace?, near? }. 열 하나만 주면 체크리스트. 자리는 메모와 같다(placeAt)
  async create(p) {
    const cols = typeof p.columns === 'string' ? p.columns.split(',') : p.columns;
    const size = geometry({ w: p.w ?? KANBAN.w, h: p.h ?? KANBAN.h }, {}, KANBAN);
    const ws = requireWorkspace(this.ctx, (await this.wsKey(p.workspace)) ?? null);
    const at = p.x != null && p.y != null ? geometry({ x: p.x, y: p.y }, {}, KANBAN) : placeAt(this.ctx, size, ws, p.near);
    const k = { kanbanId: 'b' + crypto.randomBytes(5).toString('hex'), workspaceKey: ws, title: this.title(p.title, cols && cols.length === 1 ? '체크리스트' : '칸반'), ...at, ...size, columns: newColumns(cols), createdAt: Date.now() };
    this.ctx.store.insertKanban(k);
    return this.emit(this.ctx.store.getKanban(k.kanbanId));
  }

  // kanban.update { kanban, title?, x?, y?, w?, h?, workspace?, op?, ops?: [...], confirm? }
  // op: addColumn{name,index?} renameColumn{column,name} moveColumn{column,index} removeColumn{column} addCard{column?,text,session?,index?}
  //     editCard{card,text} moveCard{card,column?,index?} removeCard{card} linkCard{card,session|null}
  async update(p) {
    const ws = requireWorkspace(this.ctx, await this.wsKey(p.workspace));
    const k = this.find(p.kanban);
    const f = geometry(p, {}, KANBAN);
    if (p.title !== undefined) f.title = this.title(p.title);
    if (ws !== undefined) f.workspaceKey = ws;
    const ops = [...(p.op ? [typeof p.op === 'string' ? { ...p, op: p.op } : p.op] : []), ...(Array.isArray(p.ops) ? p.ops : [])];
    let cols = k.columns;
    const results = [];
    for (const raw of ops) {
      const op = { ...raw };
      if (op.session !== undefined) op.sessionId = op.session ? this.ctx.resolveSession(op.session).sessionId : null;
      if (op.op === 'removeColumn' && !p.confirm) {
        const c = findColumn(cols, op.column);
        if (c && c.cards.length) return confirmResult(`열 "${c.name}"과 그 안의 카드 ${c.cards.length}개를 삭제합니다.`, m('kanbanColumnDelete', { name: c.name, n: c.cards.length }));
      }
      const r = applyKanbanOp(cols, op);
      cols = r.columns; results.push({ op: op.op, ...r.result });
    }
    if (ops.length) f.columns = cols;
    if (Object.keys(f).length) this.ctx.store.updateKanban(k.kanbanId, f);
    const v = this.emit(this.ctx.store.getKanban(k.kanbanId));
    return { ...v, results };
  }
  // kanban.delete { kanban, confirm? }. 카드가 있으면 확인을 받는다
  delete(p) {
    const k = this.find(p.kanban);
    const n = k.columns.reduce((a, c) => a + c.cards.length, 0);
    if (n && !p.confirm) return confirmResult(`칸반 "${k.title}"과 카드 ${n}개를 삭제합니다. 연결된 세션은 유지합니다.`, m('kanbanDelete', { title: k.title, n }));
    this.ctx.store.deleteKanban(k.kanbanId);
    this.ctx.broadcast('kanban.removed', { kanbanId: k.kanbanId });
    return { deleted: true, kanbanId: k.kanbanId };
  }
  async list(p = {}) {
    let list = this.ctx.store.kanbans();
    if (p.workspace !== undefined) { const key = await this.wsKey(p.workspace); list = list.filter((k) => (k.workspaceKey || null) === (key || null)); }
    return list.map((k) => this.view(k));
  }
  // 세션이 바뀌었을 때 그 세션을 이은 칸반(창이 session.updated로 따라가지 못하는 닫힘만 알린다)
  linkedTo(sessionId) { return this.ctx.store.kanbans().filter((k) => k.columns.some((c) => c.cards.some((x) => x.sessionId === sessionId))); }
  onSessionClosed(sessionId) { for (const k of this.linkedTo(sessionId)) this.emit(k); }
}
