// P101: 미션 맵 선의 길. PC(lib/mission-layout.js)와 휴대폰(lib/phone-graph.js)이 같이 쓴다. 순수 함수만 둔다(단위 시험 test/p101-lib.test.mjs).
// - 선은 두 카드가 마주 보는 가장자리 사이로 간다(facing): 받는 쪽이 오른쪽이면 보내는 쪽 오른쪽 → 받는 쪽 왼쪽, 왼쪽이면 왼쪽 → 오른쪽,
//   위·아래로 겹치면(같은 열) 아래 가장자리 → 위 가장자리. 늘 오른쪽에서 나가 받는 쪽 오른쪽으로 돌아 들어가지 않는다.
// - 서로 이은 두 세션(A → B와 B → A)은 짧은 두 줄로 나란히 긋는다(사이 2 × WIRE.off). 앞으로 가는 줄(왼쪽 → 오른쪽, 위 → 아래)은 위·왼쪽,
//   되돌아오는 줄은 아래·오른쪽. 방향은 끝의 작은 화살촉(tip)으로 보인다.
// - 같은 열에서 사이에 다른 카드가 있어 곧게 이을 수 없으면 오른쪽으로 짧은 괄호(side)를 그린다(볼록함은 세로 거리에 따라 작게).
export const WIRE = { off: 3, tip: 5.5, tipW: 3.2, minDx: 16, bulge: 18 };
const r1 = (v) => Math.round(v * 10) / 10;
const mid = (b) => b.y + b.h / 2;

// a → b가 어느 가장자리로 마주 보는가: 'r'(b가 오른쪽), 'l'(b가 왼쪽), 'd'(b가 아래, 가로로 겹침), 'u'(b가 위), 겹치면 null
export function facing(a, b) {
  if (b.x >= a.x + a.w) return 'r';
  if (b.x + b.w <= a.x) return 'l';
  if (b.y >= a.y + a.h) return 'd';
  if (b.y + b.h <= a.y) return 'u';
  return null;
}

// 끝(x, y)을 꼭짓점으로 dir 쪽을 가리키는 작은 화살촉(채운 삼각형)
export function tipPath(x, y, dir) {
  const { tip: t, tipW: w } = WIRE;
  const p = dir === 'r' ? [[x - t, y - w], [x - t, y + w]] : dir === 'l' ? [[x + t, y - w], [x + t, y + w]] : dir === 'd' ? [[x - w, y - t], [x + w, y - t]] : [[x - w, y + t], [x + w, y + t]];
  return `M${r1(p[0][0])},${r1(p[0][1])} L${r1(x)},${r1(y)} L${r1(p[1][0])},${r1(p[1][1])} Z`;
}

// 선 하나의 길. opt: off(나란한 줄의 비킴, 가로 길은 y, 세로 길은 x), tip(끝에 화살촉), y1·y2(가로 길의 나가는·들어가는 높이, 없으면 가운데), route('side'면 오른쪽 괄호), bulge·maxX(괄호의 볼록함과 오른쪽 끝)
// → { d, tip: 화살촉 길 | null, route: 'r'|'l'|'d'|'u'|'side', x1, y1, x2, y2 }
export function wire(a, b, { off = 0, tip = false, y1 = null, y2 = null, route = null, bulge = WIRE.bulge, maxX = Infinity } = {}) {
  const f = route || facing(a, b) || 'side';
  const T = tip ? WIRE.tip : 0;
  if (f === 'r' || f === 'l') {
    const x1 = f === 'r' ? a.x + a.w : a.x, x2 = f === 'r' ? b.x : b.x + b.w;
    const Y1 = (y1 ?? mid(a)) + off, Y2 = (y2 ?? mid(b)) + off;
    const s = f === 'r' ? 1 : -1, xe = x2 - s * T;
    const dx = Math.max(WIRE.minDx, Math.abs(xe - x1) * 0.5);
    const d = Math.abs(Y2 - Y1) < 0.5 ? `M${r1(x1)},${r1(Y1)} L${r1(xe)},${r1(Y2)}` : `M${r1(x1)},${r1(Y1)} C${r1(x1 + s * dx)},${r1(Y1)} ${r1(xe - s * dx)},${r1(Y2)} ${r1(xe)},${r1(Y2)}`;
    return { d, tip: tip ? tipPath(x2, Y2, f) : null, route: f, x1: r1(x1), y1: r1(Y1), x2: r1(x2), y2: r1(Y2) };
  }
  if (f === 'd' || f === 'u') {
    const X = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2 + off; // 두 상자가 가로로 겹치는 곳의 가운데
    const s = f === 'd' ? 1 : -1;
    const Y1 = f === 'd' ? a.y + a.h : a.y, Y2 = f === 'd' ? b.y : b.y + b.h, ye = Y2 - s * T;
    return { d: `M${r1(X)},${r1(Y1)} L${r1(X)},${r1(ye)}`, tip: tip ? tipPath(X, Y2, f) : null, route: f, x1: r1(X), y1: r1(Y1), x2: r1(X), y2: r1(Y2) };
  }
  // side: 같은 열, 사이에 카드가 있다. 오른쪽 가장자리 → 오른쪽으로 짧게 볼록 → 받는 쪽 오른쪽 가장자리.
  // 높이는 상자 위쪽(14px 안)이라 가운데로 나가는 나무 선과 겹치지 않는다
  const top = (bx) => bx.y + Math.min(bx.h / 2, 14);
  const x1 = a.x + a.w, x2 = b.x + b.w, Y1 = (y1 ?? top(a)) + off, Y2 = (y2 ?? top(b)) + off;
  const bx = Math.min(maxX, Math.max(x1, x2) + bulge + Math.min(bulge, Math.abs(Y2 - Y1) / 10) - off), xe = x2 + T; // maxX: 괄호가 넘지 않을 오른쪽 끝(휴대폰은 화면 여백 안)
  return { d: `M${r1(x1)},${r1(Y1)} C${r1(bx)},${r1(Y1)} ${r1(bx)},${r1(Y2)} ${r1(xe)},${r1(Y2)}`, tip: tip ? tipPath(x2, Y2, 'l') : null, route: 'side', x1: r1(x1), y1: r1(Y1), x2: r1(x2), y2: r1(Y2) };
}

// 서로 이은 두 줄의 비킴: 앞으로 가는 줄(오른쪽·아래로)은 -off, 되돌아오는 줄은 +off. side(같은 열 괄호)는 아래로 가는 줄이 앞
export function pairOff(a, b, route) {
  const fwd = route === 'r' || route === 'd' || (route === 'side' && mid(b) >= mid(a));
  return fwd ? -WIRE.off : WIRE.off;
}

// 두 상자 사이(위 상자의 아래 가장자리 ~ 아래 상자의 위 가장자리, 가로로 겹치는 곳)를 다른 상자가 막는가
export function blocked(a, b, boxes) {
  const top = a.y <= b.y ? a : b, bot = top === a ? b : a;
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w), y0 = top.y + top.h, y1 = bot.y;
  if (x1 <= x0 || y1 <= y0) return false;
  return boxes.some((c) => c !== a && c !== b && c.x < x1 && c.x + c.w > x0 && c.y < y1 && c.y + c.h > y0);
}

// 부모 오른쪽 가장자리에서 하위로 나가는 높이(port): 하위가 아래에 있으면 조금 아래, 위에 있으면 조금 위.
// 한 점으로 모이던 선(P95)이 서로 이은 두 줄과 함께 겹치지 않게 살짝 펼친다(카드 위아래 끝에서 edge만큼 안쪽까지)
export function portY(parent, kid, { k = 0.12, edge = 12 } = {}) {
  const c = mid(parent), lim = Math.max(0, parent.h / 2 - edge);
  return r1(c + Math.max(-lim, Math.min(lim, (mid(kid) - c) * k)));
}
