// P69: 업데이트 상태(update.status) → 창이 한 번만 띄울 알림. 새 버전은 버전마다 한 번, 바꾸기 결과는 결과마다 한 번(최근 것만)
export const RESULT_FRESH_MS = 10 * 60 * 1000; // 바꾸기 결과는 이만큼 지나기 전에만 알린다(처음 여는 웹 화면에 옛 결과를 띄우지 않게)
export function noticesFor(view, { toasted = null, resultSeen = null, now = Date.now() } = {}) {
  const out = [];
  if (!view) return out;
  const r = view.lastResult;
  if (r && r.at && String(r.at) !== String(resultSeen) && now - r.at < RESULT_FRESH_MS) out.push({ kind: 'result', key: String(r.at), ok: !!r.ok, to: (r.to && r.to.tag) || '', from: (r.from && (r.from.tag || r.from.version)) || '', error: r.error || '', ...(!r.ok ? { recovery: r.rollbackError ? 'attention' : r.rolledBack ? 'restored' : 'unchanged', backupBundle: r.backupBundle || null } : {}) });
  if (view.available && view.latest && view.latest.tag !== toasted && !(view.job && view.job.phase !== 'failed')) out.push({ kind: 'available', key: view.latest.tag, version: view.latest.tag });
  return out;
}

// P70: 업데이트 채널(판 설정 updateChannel). 모르는 값은 정식
export const channelOf = (v) => (v === 'dev' ? 'dev' : 'stable');
// P70: 보일 버전. vTag는 v를 하나만 붙인다(문장 안). versionLabel은 dev 빌드(x.y.z-dev.n)면 뒤에 (dev)도 붙인다(버전 칸). 예: "v0.1.2-dev.1 (dev)"
export const vTag = (version) => (version ? `v${String(version).replace(/^v/, '')}` : '');
export function versionLabel(version) {
  const v = vTag(version);
  return /-dev\.\d+$/.test(v) ? `${v} (dev)` : v;
}

// P71: 창 제목과 트레이 풍선 글의 이름. 지금 도는 창의 app/package.json version을 그대로 붙인다(dev 빌드면 0.1.3-dev.1).
// 개발용 판은 뒤에 (dev)를 붙인다. 예: "Atrium 0.1.2", "Atrium 0.1.2 (dev)"
export function windowTitle(name, version, profile) {
  const v = version ? String(version).replace(/^v/, '') : '';
  return `${name}${v ? ` ${v}` : ''}${profile === 'dev' ? ' (dev)' : ''}`;
}
