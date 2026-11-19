// P146: 판(Canvas.jsx)이 저장소의 배치에서 React Flow 노드를 다시 만들 때, 값이 같은 노드는 옛 객체를 그대로 돌려준다.
// React Flow는 노드 객체가 같으면 그 노드(감싸개와 안의 컴포넌트)를 다시 그리지 않는다. 예전에는 세션 갱신 한 번마다
// 모든 노드 객체(와 data: {})를 새로 만들어 노드 전부(실제 판 모양에서 컴포넌트 약 925개)가 다시 그려졌다(P144 원인 4).
// 세션 값(상태, 이름 등)은 노드 안에서 저장소를 구독하므로 노드 객체에는 자리·크기·덩어리 모양 같은 배치 값만 든다.

// 세션 노드의 data. 세션 노드는 id로 저장소를 구독하므로 data에 든 것이 없다. 늘 같은 객체를 써서 memo가 다시 그리지 않게 한다
export const NO_DATA = Object.freeze({});

// 얕은 비교(한 단계). 배열은 원소를 ===로 견준다
export function shallowSame(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
  return true;
}

// 두 단계 비교: 값이 객체(배열)면 한 단계 더 얕게 본다(영역 data의 keys 배열, 덩어리 선 data의 칸 사각형 등)
function sameDeep2(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const x = a[k], y = b[k];
    if (Object.is(x, y)) continue;
    if (x && y && typeof x === 'object' && typeof y === 'object' && sameDeep2Inner(x, y)) continue;
    return false;
  }
  return true;
}
function sameDeep2Inner(a, b) {
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[k], y = b[k];
    if (Object.is(x, y)) continue;
    if (x && y && typeof x === 'object' && typeof y === 'object' && shallowSame(x, y)) continue;
    return false;
  }
  return true;
}

// 판이 정하는 노드 필드(fields)가 옛 노드(old)와 같은가. position·style은 값으로, data는 두 단계까지 견준다.
// fields에 없는 필드(React Flow가 더한 measured, selected, dragging 등)는 견주지 않는다(옛 값을 그대로 둔다)
export function sameFields(old, fields) {
  if (!old) return false;
  for (const k of Object.keys(fields)) {
    const a = old[k], b = fields[k];
    if (Object.is(a, b)) continue;
    if (k === 'position') { if (a && b && a.x === b.x && a.y === b.y) continue; return false; }
    if (k === 'data') { if (sameDeep2(a, b)) continue; return false; }
    if (k === 'style') { if (shallowSame(a, b)) continue; return false; }
    return false;
  }
  return true;
}

// 옛 노드에 새 필드를 얹은 노드. 값이 모두 같으면 옛 객체 그대로, 다르면 새 객체(바뀌지 않은 data·position은 옛 것을 다시 쓴다)
export function reuseNode(old, fields) {
  if (!old) return fields;
  if (sameFields(old, fields)) return old;
  const out = { ...old, ...fields };
  if (fields.data && old.data && fields.data !== old.data && sameDeep2(old.data, fields.data)) out.data = old.data;
  if (fields.position && old.position && fields.position !== old.position && old.position.x === fields.position.x && old.position.y === fields.position.y) out.position = old.position;
  return out;
}

// 세션 노드 하나(Canvas.jsx 저장소 배치 → React Flow 노드). r: 저장소 사각형 { x, y, w, h, z }, p: 끄는 동안 함께 움직이는 자리, dock: 든 덩어리
export function sessionNode(old, id, r, p = null, dock = null) {
  return reuseNode(old, { id, type: 'session', position: p || { x: r.x, y: r.y }, width: r.w, height: r.h, dragHandle: '.mt-drag', data: NO_DATA, zIndex: r.z || 0, className: dock ? `docked dock-${dock.dir}` : '' });
}

// 노드 배열 둘이 원소마다 같은 객체인가(그렇다면 옛 배열을 그대로 돌려 React Flow가 아무것도 다시 보지 않게 한다)
export function sameList(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
