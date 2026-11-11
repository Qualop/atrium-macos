// 판 밖 대화 노드의 자리(P13, BRIEF "판 밖 대화", ARCH 5절 "판 밖 대화 노드·missed"). 순수 함수만 둔다. 창(renderer)도 이 파일을 그대로 묶어 쓴다(node 모듈을 부르지 않는다).
// - 대화 노드는 읽기 전용 카드다. 영역 안에서 판 세션(과 그룹, 메모, 칸반)이 먼저이고, 대화 노드는 그 아래에 최근 순 격자로 놓는다.
// - 같은 리포의 워크트리 대화는 워크트리마다 줄을 새로 시작하고(블록), 창은 그 블록을 감싸는 배경과 이름표를 그린다(worktreeBoxes).
// - 새 카드만 자리를 정한다. 이미 놓인 카드는 사람이 옮긴 자리 그대로다(BRIEF 4절). 겹침은 다른 모든 것과 GAP 넘게 띄운다.
import { bbox, overlaps, REGION_PAD, REGION_HEAD } from './canvas.mjs';

export const CARD = { w: 320, h: 184 };
export const CARD_GAP = 24;
export const CARD_COLS = 5; // 한 줄의 카드 수(5 × 344 = 1720, 기본 세션 노드 둘 남짓)
export const BLOCK_HEAD = 44; // 워크트리 블록 위 이름표 자리
export const BOX_PAD = 12; // 워크트리 배경과 카드 사이
export const CONVO_CAP = 40; // 영역 하나에 올리는 대화 노드 수(최근 순). 나머지는 사이드바에만 둔다
const ZONE_GAP = 56; // 판 세션과 대화 격자 사이

// cards: [{ id, block, at }] 이 워크스페이스에 올릴 대화(최근 순이 아니어도 된다), placed: Map id → { x, y, w, h }(이미 놓인 카드),
// items: [{ id?, ws, x, y, w, h, kind? }] 캔버스의 다른 것(세션, 그룹, 메모, 칸반). 이 워크스페이스의 것만 본다, anchor: 워크스페이스 자리 { x, y } (안이 비었을 때)
// → Map id → { x, y, w, h } (새로 놓은 카드만)
export function placeCards({ wsKey, cards, placed = new Map(), items = [], anchor = null, size = CARD, cols = CARD_COLS, gap = CARD_GAP }) {
  const out = new Map();
  const todo = cards.filter((c) => !placed.has(c.id));
  if (!todo.length) return out;
  const own = items.filter((i) => i.ws === wsKey && i.kind !== 'convo');
  const ownBox = bbox(own);
  const placedRects = [...placed.values()];
  // 자기 영역 안의 것만 피한다. 다른 영역과 겹치면 부르는 쪽이 영역째로 민다(settleRegions). 다른 영역을 피하면 격자에 구멍이 생긴다
  const taken = [...own, ...placedRects];
  const free = (r) => !taken.some((t) => overlaps(r, t, gap - 1));
  // 격자의 왼쪽 위: 판 세션 등의 아래(없으면 영역 자리 안쪽)
  const x0 = ownBox ? ownBox.x : anchor ? anchor.x + REGION_PAD : 0;
  const y0 = ownBox ? ownBox.y + ownBox.h + ZONE_GAP : anchor ? anchor.y + REGION_HEAD + REGION_PAD : 0;
  const cell = { w: size.w + gap, h: size.h + gap };
  // 블록 순서: 본 저장소('')가 먼저, 그다음 워크트리를 가장 최근 활동 순으로
  const blocks = new Map();
  for (const c of [...cards].sort((a, b) => (b.at || 0) - (a.at || 0))) { const k = c.block || ''; if (!blocks.has(k)) blocks.set(k, []); blocks.get(k).push(c); }
  const order = [...blocks.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
  let rowY = y0;
  // 이미 놓인 카드가 있으면 새 블록은 그 아래에서 시작한다
  const placedBox = bbox(placedRects);
  if (placedBox) rowY = Math.max(rowY, placedBox.y + placedBox.h + gap);
  for (const k of order) {
    const list = blocks.get(k);
    const mine = list.filter((c) => placed.has(c.id)).map((c) => placed.get(c.id));
    const fresh = list.filter((c) => !placed.has(c.id));
    if (!fresh.length) continue;
    // 블록의 격자 원점: 이미 놓인 그 블록 카드가 있으면 그 왼쪽 위, 없으면 다음 줄(워크트리는 이름표 자리를 둔다)
    const mb = bbox(mine);
    const head = k ? BLOCK_HEAD : 0;
    const ox = mb ? mb.x : x0, oy = mb ? mb.y : rowY + head;
    let n = 0;
    for (const c of fresh) {
      for (; ; n++) {
        const r = { x: ox + (n % cols) * cell.w, y: oy + Math.floor(n / cols) * cell.h, w: size.w, h: size.h };
        if (free(r)) { out.set(c.id, r); taken.push(r); n++; break; }
        if (n > 4000) { out.set(c.id, r); taken.push(r); break; }
      }
    }
    const nb = bbox([...mine, ...[...out.entries()].filter(([id]) => fresh.some((c) => c.id === id)).map(([, r]) => r)]);
    if (nb) rowY = Math.max(rowY, nb.y + nb.h + gap);
  }
  return out;
}

// 워크트리 블록의 배경(창이 카드 뒤에 그린다). cards: [{ ws, block, x, y, w, h }] → [{ ws, block, x, y, w, h }]
export function worktreeBoxes(cards) {
  const by = new Map();
  for (const c of cards) { if (!c.block) continue; const k = `${c.ws}\u0000${c.block}`; if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
  const out = [];
  for (const [k, list] of by) {
    const b = bbox(list);
    const [ws, block] = k.split('\u0000');
    out.push({ ws, block, n: list.length, x: b.x - BOX_PAD, y: b.y - BLOCK_HEAD + 4, w: b.w + 2 * BOX_PAD, h: b.h + BLOCK_HEAD - 4 + BOX_PAD });
  }
  return out;
}

// 대화 노드의 얼굴. 세션 노드와 같은 너비 기준(lib/faces.js)을 쓰되 카드에는 터미널이 없으므로 가까이·중간은 같은 "카드" 얼굴이다
export const convoFace = (face) => (face === 'close' || face === 'middle' ? 'card' : face);

// P67: 판 세션끼리의 띄움은 판의 연결(ARCH 4절 F3, K1) 하나로만 보인다. 대화 띄움 선(J6)은 판 밖 대화가 낀 띄움에만 긋는다.
// e: { from, to, via } (from·to는 판 세션 ID나 convo:<대화 ID>), linked(a, b): 판에 a → b 연결이 있는가(지운 연결도 친다)
// → 판의 연결과 겹치므로 긋지 않을 선이면 true. 판의 띄움 명령(atrium child|spawn)은 연결이 늦게 생겨도 판이 잇는다
export const BOARD_SPAWN_VIA = new Set(['atrium-child', 'atrium-spawn', 'mtask-child', 'mtask-spawn']);
export function boardSpawnDup(e, linked = () => false) {
  const board = (id) => !!id && !String(id).startsWith('convo:');
  if (!e || !board(e.from) || !board(e.to)) return false;
  return BOARD_SPAWN_VIA.has(e.via) || !!linked(e.from, e.to) || !!linked(e.to, e.from);
}
