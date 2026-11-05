// P47(원격 R1): 한 백엔드에 창이 여럿 붙을 때 창 쪽에서 쓰는 순수 함수(단위 시험 app/test/p47-lib.test.mjs).
// 백엔드 쪽 판단(알림 받을 클라이언트, 크기 정하는 기기)은 backend/src/multiclient.mjs에 있다.

// 오래 가는 클라이언트 ID. 창 프로필(localStorage)마다 하나다. 받은 값이 쓸 만하면 그대로 쓴다
export function clientIdOf(saved, rand) {
  if (typeof saved === 'string' && /^[A-Za-z0-9_.:-]{4,80}$/.test(saved)) return saved;
  return `c-${String(rand).replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'anon0000'}`;
}

// 백엔드 연결 주소에 붙일 값(ARCH 6절, P48 웹 화면과 같은 이름: client, name, kind)
export function clientQuery({ clientId, name, kind }) {
  const q = new URLSearchParams();
  if (clientId) q.set('client', clientId);
  if (name) q.set('name', String(name).slice(0, 60));
  if (kind) q.set('kind', kind);
  return q.toString();
}

// 위쪽 알약의 "다른 기기 n": 나와 다른 ID의 창·웹 클라이언트(트레이와 CLI는 세지 않는다)
export function otherDevices(peers) {
  if (!peers || !Array.isArray(peers.clients)) return [];
  return peers.clients.filter((c) => c.clientId && c.clientId !== peers.me && c.kind !== 'tray' && c.kind !== 'cli');
}

// 이 창이 OS 알림을 띄워도 되는가. 백엔드가 고른 클라이언트가 있고 내가 아니면 띄우지 않는다.
// 백엔드가 고르지 못했거나(옛 백엔드, 목록이 아직 없음) 내 ID를 모르면 예전처럼 띄운다
export function notifyAllowed(peers) {
  if (!peers || !peers.me || !peers.notify) return { allowed: true, reason: null };
  return peers.notify === peers.me ? { allowed: true, reason: null } : { allowed: false, reason: 'other-client' };
}

// 패널 크기(열×행, 크기 정하는 기기의 것)를 내 노드 크기에 맞춰 비율로 줄이거나 늘린다.
// 글이 잘리지 않게 가로·세로 가운데 작은 비율을 쓴다. 차이가 아주 작으면 1(흐려지지 않게)
export function fitScale({ termW, termH, boxW, boxH, min = 0.2, max = 3 }) {
  if (!(termW > 0 && termH > 0 && boxW > 0 && boxH > 0)) return 1;
  const s = Math.max(min, Math.min(max, boxW / termW, boxH / termH));
  return Math.abs(s - 1) < 0.01 ? 1 : s;
}

// "다른 기기가 방금 입력" 표시를 보일지. 내 ID에서 온 것은 보이지 않는다
export function inputByLabel(ev, me) {
  if (!ev || (me && ev.clientId === me)) return null;
  return ev.name || ev.clientId || '?';
}
