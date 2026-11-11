// 연결이 바뀔 때 알림(P81, ARCH 4절 K): 받는 쪽의 행동이 바뀌는 때만 짧게 알린다. 내용은 atrium me가 주고 알림은 신호다.
// - 사람이 부모에서 뗐을 때: 옛 부모와 뗀 세션에게. 하위 세션이 부모의 child-kill이 아닌 까닭으로 닫혔을 때: 부모에게.
// - 같은 세션에 짧은 사이(batchMs, 10초)에 생긴 알림은 하나로 묶는다. 하위 세션 여럿을 한꺼번에 닫아도 부모의 턴은 하나다.
// - 잠든 세션은 이 알림 때문에 깨우지 않는다(넣을 때와 보낼 때 모두 본다. 깨면 atrium me로 본다).
export const NOTICE_BATCH_MS = 10000;
export const ME_LINE = '지금 연결은 `atrium me`.';
export const ACK_LINE = '이 알림에는 "알겠다"고만 답해라.';

// 닫힌 까닭(backend.closeSession의 reason) → 부모에게 보일 말. killed는 판에서 사람이 닫은 것(부모의 child-kill은 알리지 않는다)
export function closeWhy(reason) {
  if (reason === 'killed') return '사람이 닫음';
  if (reason === 'pane exited') return '스스로 끝남';
  return '패널 사라짐';
}
export const detachedParentLine = (child) => `@${child}는 이제 너의 하위 세션이 아니다. 일을 시키지 마라.`;
export const detachedChildLine = (parent) => `너는 이제 부모 없는 세션이다(@${parent}에서 뗌).`;
export const childClosedLine = (child, why) => `@${child}가 닫혔다(${why}).`;

export function noticeText(lines) {
  const body = lines.length === 1 ? [`[Atrium 보드] ${lines[0]}`] : ['[Atrium 보드] 연결이 바뀌었다.', ...lines.map((l) => `- ${l}`)];
  return [...body, ME_LINE, ACK_LINE].join('\n');
}

// add(sessionId, line): 그 세션의 묶음에 더한다. 첫 줄에서 batchMs 뒤 한 번 보낸다.
// canSend(sessionId) → false면 버린다(닫힘, 닫는 중, 잠듦). send(sessionId, text, lines)
export class NoticeBatcher {
  constructor({ batchMs = NOTICE_BATCH_MS, canSend, send, onDrop = () => {} }) {
    this.batchMs = batchMs; this.canSend = canSend; this.send = send; this.onDrop = onDrop;
    this.pending = new Map(); // 세션 ID → { lines, timer }
  }
  add(sessionId, line) {
    if (!this.canSend(sessionId)) { this.onDrop(sessionId, [line]); return false; }
    let p = this.pending.get(sessionId);
    if (!p) {
      p = { lines: [], timer: setTimeout(() => this.flush(sessionId), this.batchMs) };
      if (p.timer.unref) p.timer.unref();
      this.pending.set(sessionId, p);
    }
    if (!p.lines.includes(line)) p.lines.push(line);
    return true;
  }
  flush(sessionId) {
    const p = this.pending.get(sessionId);
    if (!p) return null;
    clearTimeout(p.timer); this.pending.delete(sessionId);
    if (!this.canSend(sessionId)) { this.onDrop(sessionId, p.lines); return null; }
    return this.send(sessionId, noticeText(p.lines), p.lines);
  }
  flushAll() { for (const id of [...this.pending.keys()]) this.flush(id); }
  stop() { for (const p of this.pending.values()) clearTimeout(p.timer); this.pending.clear(); }
}
