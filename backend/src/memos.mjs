// I3 메모 노드(P6b, ARCH 4절 I3): 캔버스에 두는 글 노드. 마크다운 글, 자리와 크기, 워크스페이스 소속을 저장한다.
// 워크스페이스 영역 안에 두면 그 워크스페이스 소속이다. 영역 계산은 창(P6a)이 하고, 창이 workspace를 넘긴다. 없으면 어느 워크스페이스에도 속하지 않는다.
// I4 칸반 노드도 같은 자리 규칙을 쓴다(kanban.mjs).
import crypto from 'node:crypto';
import { m as mk, confirmResult } from './msg.mjs'; // P16: 화면 글 열쇠

export const MEMO = { w: 360, h: 240, minW: 120, minH: 80, maxText: 20000 };
const GAP = 40;

// 자리를 주지 않으면 판에 있는 것들(세션 노드, 그룹, 메모, 칸반)의 오른쪽 끝 너머에 둔다. 다른 것 위에 겹치지 않는다(BRIEF 4절)
export function placeRight(rects, size, gap = GAP) {
  const list = (rects || []).filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.w));
  if (!list.length) return { x: 0, y: 0 };
  const right = Math.max(...list.map((r) => r.x + r.w));
  const top = Math.min(...list.map((r) => r.y));
  return { x: Math.round(right + gap), y: Math.round(top) };
}

// 자리를 주지 않은 새 메모·칸반의 자리. ctx.place(size, wsKey, near)가 있으면 단일 캔버스 빈자리(P6c, canvas-ops placeItem), 없으면 오른쪽 끝 너머
export function placeAt(ctx, size, wsKey, near) {
  const n = near && Number.isFinite(Number(near.x)) && Number.isFinite(Number(near.y)) ? { x: Number(near.x), y: Number(near.y) } : null;
  return ctx.place ? ctx.place(size, wsKey, n) : placeRight(ctx.occupied(), size);
}

// 자리·크기 값 고르기(숫자만, 크기는 최소값 이상)
export function geometry(p, base, min = MEMO) {
  const f = {};
  for (const k of ['x', 'y']) if (p[k] !== undefined) { const v = Number(p[k]); if (!Number.isFinite(v)) throw Object.assign(new Error(`${k}는 숫자`), { code: 'bad_request' }); f[k] = Math.round(v); }
  if (p.w !== undefined) { const v = Number(p.w); if (!Number.isFinite(v)) throw Object.assign(new Error('w는 숫자'), { code: 'bad_request' }); f.w = Math.max(min.minW, Math.round(v)); }
  if (p.h !== undefined) { const v = Number(p.h); if (!Number.isFinite(v)) throw Object.assign(new Error('h는 숫자'), { code: 'bad_request' }); f.h = Math.max(min.minH, Math.round(v)); }
  return { ...base, ...f };
}

// 비동기 이름·경로 조회 중 워크스페이스가 닫힐 수 있다. 쓰기 직전에 현재 소속을 확인한다.
export function requireWorkspace(ctx, key) {
  if (key != null && !ctx.store.getWorkspace(key)) throw ctx.apiError('not_found', `없는 워크스페이스: ${key}`);
  return key;
}

// ctx: { store, broadcast(event, data), resolveWorkspace(ref, { required }) → Promise<{ key } | null>, occupied() → 사각형들, apiError }
export class Memos {
  constructor(ctx) { this.ctx = ctx; }
  async wsKey(ref) {
    if (ref === undefined) return undefined;
    if (ref === null || ref === '') return null;
    return (await this.ctx.resolveWorkspace(ref)).key;
  }
  find(ref) {
    const m = ref && this.ctx.store.getMemo(String(ref));
    if (!m) throw this.ctx.apiError('not_found', `없는 메모: ${ref}`);
    return m;
  }
  text(t) {
    const s = String(t ?? '').replace(/\r\n?/g, '\n');
    if (s.length > MEMO.maxText) throw this.ctx.apiError('bad_request', `메모는 ${MEMO.maxText}자까지`);
    return s;
  }

  // memo.create { text?, x?, y?, w?, h?, color?, workspace?, near? }
  // x·y를 주면 그 자리 그대로. 아니면 빈자리(P6c: ctx.place = 단일 캔버스 빈자리. near는 원하는 왼쪽 위 { x, y })
  async create(p) {
    const size = geometry({ w: p.w ?? MEMO.w, h: p.h ?? MEMO.h }, {});
    const ws = requireWorkspace(this.ctx, (await this.wsKey(p.workspace)) ?? null);
    const at = p.x != null && p.y != null ? geometry({ x: p.x, y: p.y }, {}) : placeAt(this.ctx, size, ws, p.near);
    const m = { memoId: 'm' + crypto.randomBytes(5).toString('hex'), workspaceKey: ws, ...at, ...size, text: this.text(p.text), color: p.color ? String(p.color).slice(0, 32) : null, createdAt: Date.now() };
    this.ctx.store.insertMemo(m);
    const v = this.ctx.store.getMemo(m.memoId);
    this.ctx.broadcast('memo.updated', v);
    return v;
  }
  // memo.update { memo, text?, x?, y?, w?, h?, color?, workspace? }
  async update(p) {
    const ws = requireWorkspace(this.ctx, await this.wsKey(p.workspace));
    const m = this.find(p.memo);
    const f = geometry(p, {});
    if (p.text !== undefined) f.text = this.text(p.text);
    if (p.color !== undefined) f.color = p.color ? String(p.color).slice(0, 32) : null;
    if (ws !== undefined) f.workspaceKey = ws;
    if (Object.keys(f).length) this.ctx.store.updateMemo(m.memoId, f);
    const v = this.ctx.store.getMemo(m.memoId);
    this.ctx.broadcast('memo.updated', v);
    return v;
  }
  // memo.delete { memo, confirm? }. 글이 있는 메모는 확인을 받는다(되돌릴 수 없다)
  delete(p) {
    const m = this.find(p.memo);
    if (m.text.trim() && !p.confirm) return confirmResult(`메모(${m.text.trim().split('\n')[0].slice(0, 40)}…)를 지운다. 되돌릴 수 없다.`, mk('memoDelete', { text: m.text.trim().split('\n')[0].slice(0, 40) }));
    this.ctx.store.deleteMemo(m.memoId);
    this.ctx.broadcast('memo.removed', { memoId: m.memoId });
    return { deleted: true, memoId: m.memoId };
  }
  // memo.list { workspace?, q? }. q는 글에서 찾는다(대소문자 무시)
  async list(p = {}) {
    let list = this.ctx.store.memos();
    if (p.workspace !== undefined) { const k = await this.wsKey(p.workspace); list = list.filter((m) => (m.workspaceKey || null) === (k || null)); }
    if (p.q) { const q = String(p.q).toLowerCase(); list = list.filter((m) => m.text.toLowerCase().includes(q)); }
    return list;
  }
}
