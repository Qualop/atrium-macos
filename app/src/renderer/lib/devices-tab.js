// P60: 설정 › 연결된 기기 탭의 순수 함수(단위 시험 app/test/p60-lib.test.mjs).
// 탭은 요약, 짝 맺기, 짝 맺은 기기, 보안 설정, Tailscale 진단(접힘), 연결 기록(최근 몇 줄) 차례다(WebDevices.jsx).

// P57: Tailscale 기기에 묶이지 않은 옛 바깥 기기(backend tailscale.mjs needsRepair와 같은 규칙)
export const needsRepair = (d) => !!d && !(d.tsNode && d.tsNode.id) && d.origin !== 'local';
export const isRepair = (d) => !!d && (!!d.needsRepair || needsRepair(d));

// 짝 맺은 기기를 쓸 수 있는 것과 다시 짝 맺어야 하는 것으로 가른다. 지금 붙은 기기를 먼저, 그다음 마지막 접속이 늦은 차례
export function groupDevices(devices, connected = new Set()) {
  const list = Array.isArray(devices) ? devices : [];
  const order = (a, b) => (connected.has(b.id) - connected.has(a.id)) || ((b.lastSeenAt || 0) - (a.lastSeenAt || 0)) || ((b.createdAt || 0) - (a.createdAt || 0));
  return { ok: list.filter((d) => !isRepair(d)).sort(order), repair: list.filter(isRepair).sort(order) };
}

// 지금 붙은 기기 ID(판에 붙은 웹 클라이언트 가운데 짝 맺은 기기로 붙은 것)
export function connectedIds(peers) {
  const out = new Set();
  for (const c of (peers && Array.isArray(peers.clients) ? peers.clients : [])) if (c && c.kind === 'web' && c.deviceId) out.add(c.deviceId);
  return out;
}

// 진단에서 요약에 띄울 문제(안 됨 먼저, 그다음 주의). 건너뜀(skip)과 괜찮음은 뺀다
export function diagProblems(checks) {
  const list = Array.isArray(checks) ? checks : [];
  return [...list.filter((c) => c && c.level === 'fail'), ...list.filter((c) => c && c.level === 'warn')];
}

// 패스키 종류 → 글 열쇠. 백엔드 passkeyKind(phone, device, key, unknown)
export const kindKey = (pk) => (pk && ['phone', 'device', 'key'].includes(pk.kind) ? `devTab.kind_${pk.kind}` : pk ? 'devTab.kind_unknown' : null);

// 연결 기록: 기본으로 보일 줄 수와 "더 보기"마다 늘릴 줄 수
export const LOG_PREVIEW = 6;
export const LOG_STEP = 30;
