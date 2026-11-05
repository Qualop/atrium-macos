// P47(원격 R1): 한 백엔드에 창(클라이언트)이 여럿 붙을 때의 상태 바꾸기. 모두 순수 함수다(단위 시험 p47.test.mjs).
// - 클라이언트 알아보기: 연결 주소의 client(오래 가는 ID)·name(기기 이름)·kind(desktop|web|tray|cli). client.hello로 나중에 바꿀 수도 있다.
// - 화면 위치(viewport): 클라이언트마다 meta `viewport:<client>`. 없으면 보드 값(meta `viewport`, 옛 판 값)에서 시작한다.
// - 터미널 나눠 보내기: herdr는 패널 하나에 클라이언트 하나만 받는다(--takeover 없이 붙으면 거부, P47 실험). 그래서 제어기는 패널마다 하나이고
//   백엔드가 프레임을 붙은 클라이언트 모두에게 보낸다. 새로 붙은 클라이언트는 full 프레임부터 받는다(그 전 변경 프레임은 버린다).
// - 크기 정하는 기기: 마지막으로 입력했거나 초점을 준 클라이언트(tmux latest). 떠나면 남은 쪽 중 가장 최근에 쓴 쪽.
// - 알림 받을 클라이언트: 최근(ACTIVE_MS 안)에 입력이 있었던 클라이언트. 없으면 PC 창(desktop), 그것도 없으면 트레이.

export const ACTIVE_MS = 5 * 60 * 1000; // 이 안에 입력이 있었으면 활성
export const CLIENT_KINDS = ['desktop', 'web', 'tray', 'cli'];

// P49: 기기 토큰(짝 맺은 브라우저)으로 붙은 연결은 늘 웹 클라이언트다. 연결 주소의 kind를 믿지 않고(desktop을 흉내 내어 알림을 가져가지 않게),
// 이름이 없으면 짝 맺을 때의 기기 이름, ID가 없으면 기기마다 하나(web-<기기 ID>)를 쓴다
export function bindAuth(hello, auth) {
  const dev = auth && auth.kind === 'device' && auth.device;
  if (!dev) return hello;
  const id = hello.clientId || (/^[A-Za-z0-9_.:-]{1,70}$/.test(String(dev.id)) ? `web-${dev.id}` : null);
  return { clientId: id, name: hello.name || dev.name || null, kind: 'web' };
}

// 연결 주소(URLSearchParams)나 client.hello 값 → 클라이언트 정보. ID가 없으면 목록에 넣지 않는 익명 연결(CLI, 옛 창)
export function parseClientHello(q) {
  const get = (k) => (typeof q.get === 'function' ? q.get(k) : q[k]);
  const id = String(get('client') || get('clientId') || '').trim();
  const ok = /^[A-Za-z0-9_.:-]{4,80}$/.test(id);
  const kind = String(get('kind') || '').trim();
  return { clientId: ok ? id : null, name: String(get('name') || '').trim().slice(0, 60) || null, kind: CLIENT_KINDS.includes(kind) ? kind : (ok ? 'desktop' : 'cli') };
}

// 붙은 클라이언트 목록(연결 단위) → 보여 줄 목록. 같은 ID로 연결이 둘이면 하나로 합친다(마지막 입력이 늦은 쪽의 이름)
export function clientList(conns) {
  const by = new Map();
  for (const c of conns) {
    if (!c.clientId) continue;
    const p = by.get(c.clientId);
    if (!p) { by.set(c.clientId, { clientId: c.clientId, name: c.name, kind: c.kind, connectedAt: c.connectedAt, lastInputAt: c.lastInputAt || null, conns: 1 }); continue; }
    p.conns++;
    p.connectedAt = Math.min(p.connectedAt, c.connectedAt);
    if ((c.lastInputAt || 0) > (p.lastInputAt || 0)) { p.lastInputAt = c.lastInputAt; if (c.name) p.name = c.name; }
  }
  return [...by.values()].sort((a, b) => a.connectedAt - b.connectedAt);
}

// OS 알림을 띄울 클라이언트 ID. 활성(최근 입력)이 있으면 가장 최근 것, 없으면 PC 창(desktop) 가운데 가장 최근에 쓴 것
// (같으면 먼저 붙은 것), 창도 없으면 트레이. 아무도 없으면 null
export function pickNotifyClient(list, now, activeMs = ACTIVE_MS) {
  const byRecent = (a, b) => (b.lastInputAt || 0) - (a.lastInputAt || 0) || a.connectedAt - b.connectedAt;
  const active = list.filter((c) => c.kind !== 'tray' && c.kind !== 'cli' && c.lastInputAt && now - c.lastInputAt < activeMs).sort(byRecent);
  if (active.length) return active[0].clientId;
  const desk = list.filter((c) => c.kind === 'desktop').sort(byRecent);
  if (desk.length) return desk[0].clientId;
  const tray = list.find((c) => c.kind === 'tray');
  return tray ? tray.clientId : null;
}

// 클라이언트별 화면 위치의 meta 열쇠와 읽기. 클라이언트 값이 없으면 보드 값(옛 판 값 그대로)
export const viewportKey = (clientId) => `viewport:${clientId}`;
export function viewportFor(perClient, board) { return perClient || board || null; }

// ---------- 터미널 나눠 보내기(패널 하나의 상태) ----------
// st = { subs: [{ key, clientId, name, cols, rows, joinedAt, activeAt, needFull }], owner: key|null }
// 모든 함수는 새 st를 돌려준다. 제어기 크기는 shareSize(st)로 읽어 지금 크기와 다르면 relay가 resize한다.
export const shareEmpty = () => ({ subs: [], owner: null });
const bestRemaining = (subs) => [...subs].sort((a, b) => (b.activeAt || 0) - (a.activeAt || 0) || a.joinedAt - b.joinedAt)[0] || null;

export function shareJoin(st, { key, clientId = null, name = null, cols, rows, now }) {
  const prev = st.subs.find((s) => s.key === key);
  const sub = { key, clientId, name, cols, rows, joinedAt: prev ? prev.joinedAt : now, activeAt: prev ? prev.activeAt : 0, needFull: true };
  const subs = [...st.subs.filter((s) => s.key !== key), sub];
  return { subs, owner: st.owner && subs.some((s) => s.key === st.owner) ? st.owner : key };
}
export function shareLeave(st, key) {
  const subs = st.subs.filter((s) => s.key !== key);
  if (st.owner !== key) return { subs, owner: st.owner };
  const b = bestRemaining(subs);
  return { subs, owner: b ? b.key : null };
}
// 입력이나 초점: 그 클라이언트가 크기를 가져간다
export function shareActive(st, key, now) {
  if (!st.subs.some((s) => s.key === key)) return st;
  return { subs: st.subs.map((s) => (s.key === key ? { ...s, activeAt: now } : s)), owner: key };
}
// 클라이언트가 바라는 크기(자기 노드 크기). 크기를 가진 클라이언트의 값만 패널 크기가 된다
export function shareWant(st, key, cols, rows) {
  return { ...st, subs: st.subs.map((s) => (s.key === key ? { ...s, cols, rows } : s)) };
}
export function shareSize(st) {
  const o = st.subs.find((s) => s.key === st.owner);
  return o ? { cols: o.cols, rows: o.rows } : null;
}
// 프레임 하나를 누구에게 보낼지. full을 아직 못 받은 클라이언트에게는 변경 프레임을 보내지 않는다(앞 화면이 없어 깨진다)
export function shareFrame(st, full) {
  const to = st.subs.filter((s) => full || !s.needFull).map((s) => s.key);
  return { to, st: full && st.subs.some((s) => s.needFull) ? { ...st, subs: st.subs.map((s) => ({ ...s, needFull: false })) } : st };
}
// full 프레임을 기다리는 클라이언트가 있는가(있으면 같은 크기 resize로 full을 받는다. P47 실험: 같은 크기 resize는 바로 full 프레임을 준다)
export const shareNeedsFull = (st) => st.subs.some((s) => s.needFull);
export function shareOwnerView(st) {
  const o = st.subs.find((s) => s.key === st.owner);
  return o ? { clientId: o.clientId, name: o.name, cols: o.cols, rows: o.rows } : null;
}
