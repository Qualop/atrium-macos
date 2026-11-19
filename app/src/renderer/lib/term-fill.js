// P127: 셸 기록(터미널 기록, 최대 5000줄)을 xterm에 넣을 때 여러 프레임으로 나눠 쓴다. 순수 함수와 작은 순서 잡이만 둔다(단위 시험 p127-lib).
// P124 측정에서 처음 터미널을 붙일 때 기록 쓰기가 한 번에 39~40ms였다(xterm은 write 한 번을 쪼개지 않는다).
// - 최근 줄 먼저: 첫 쓰기는 대체 화면(DECSET 1049)에 지금 화면만 그린다. 사람에게는 바로 지금 화면(가장 최근 줄)이 보인다.
// - 위쪽 기록은 뒤 프레임에: 쓰기마다 보통 화면으로 돌아가(1049l, 커서 되돌림) 기록 한 조각을 쓰고 다시 대체 화면에 지금 화면을 그린다(1049h는 대체 화면을 비운다).
//   한 쓰기 안에서 끝나므로 그려지는 프레임은 늘 대체 화면(지금 화면)이다. 마지막 조각은 보통 화면에 남고 화면 줄만큼 내린 뒤 지금 화면을 그린다.
//   보통 화면에 쓰인 글을 모두 이으면 예전 한 번 쓰기(historyPrefill + 화면)와 같다.
// - 채우는 동안 스크롤: 대체 화면에는 scrollback이 없어 위로 올려 볼 수 없다(휠은 셸 노드에서 term.scrollLines라 아무 일도 없다). 채우기는 수십 ms라 막지 않고 그대로 둔다.
//   다 채우면 보통 화면의 맨 아래(지금 화면)에 있다.
// - 여러 터미널을 한꺼번에 붙여도 한 프레임에 한 조각만 쓴다(fillSlot이 모든 터미널의 조각을 한 줄로 세운다).

export const ALT_ON = '\x1b[?1049h';
export const ALT_OFF = '\x1b[?1049l';
// 한 조각: 줄 수와 글자 수 상한(기록 5000줄 쓰기가 약 40ms였으므로 400줄이면 한 조각 3ms 남짓)
export const FILL_LINES = 400;
export const FILL_CHARS = 48000;

const lineOf = (l) => `\x1b[0m${l}\x1b[0m`;

// 기록 줄을 조각으로 나눈다(줄 수·글자 수 상한, 한 조각에 적어도 한 줄)
export function fillChunks(lines, { maxLines = FILL_LINES, maxChars = FILL_CHARS } = {}) {
  const out = [];
  let cur = [], chars = 0;
  for (const l of lines) {
    const n = String(l).length + 10;
    if (cur.length && (cur.length >= maxLines || chars + n > maxChars)) { out.push(cur); cur = []; chars = 0; }
    cur.push(l); chars += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

// 기록 lines(ANSI 줄)와 화면 줄 수 rows, 지금 화면 screen(칸 그대로 다시 그리는 글, term-select serializeScreen)으로 쓸 글의 목록.
// 조각이 하나면 예전처럼 한 번에 쓴다(대체 화면 없이). 둘 이상이면 [대체 화면에 지금 화면, 조각…]
export function fillPlan(lines, rows, screen = '', opt = {}) {
  if (!lines || !lines.length) return screen ? [screen] : [];
  const parts = fillChunks(lines, opt);
  const tail = '\r\n'.repeat(rows);
  if (parts.length === 1) return [parts[0].map(lineOf).join('\r\n') + tail + screen];
  const out = [ALT_ON + screen];
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    const body = p.map(lineOf).join('\r\n') + (last ? tail : '\r\n');
    out.push(ALT_OFF + body + (last ? screen : ALT_ON + screen));
  });
  return out;
}

// 모든 터미널의 조각을 한 줄로 세워, 다음 화면을 그린 뒤 하나씩 내보낸다(프레임 시작 rAF 안이 아니라 그린 뒤의 작업에서 쓴다)
let gate = Promise.resolve();
const defFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(fn, 0)) : setTimeout(fn, 16));
export function fillSlot(frame = defFrame) {
  const p = gate.then(() => new Promise((res) => frame(res)));
  gate = p.catch(() => {});
  return p;
}

// 쓸 글 목록을 차례로 쓴다. 첫 글은 바로, 그다음부터는 조각마다 fillSlot을 기다린다. alive()가 거짓이 되면 멈춘다(터미널을 닫음).
// write(글) → Promise(xterm이 다 읽었을 때). 돌려주는 값: 쓴 글 수
export async function runFill(writes, { write, alive = () => true, slot = fillSlot } = {}) {
  let n = 0;
  for (let i = 0; i < writes.length; i++) {
    if (i > 0) { await slot(); }
    if (!alive()) break;
    await write(writes[i]);
    n++;
  }
  return n;
}
