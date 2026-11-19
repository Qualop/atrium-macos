// P115: 런처 옮기기(연결 목록이 생긴 판). 옛 이름과 주소는 이 파일과 그 시험에만 남긴다(이슈 #11 6절).
// - 런처 목록을 새 키(launchers.v2)에 쓴다. 옛 키(launchers)는 지우지 않는다. 옛 코드로 돌아가면 옛 목록을 그대로 쓴다(P33 방식, Launchers.ensure).
// - claude 런처 env의 ANTHROPIC_BASE_URL → anthropic-messages 연결 하나 + 런처의 참조. 런처의 checkUrl은 그 연결의 health 주소가 된다.
//   연결 ID는 프로토콜과 base URL에서 만든다(connections.mjs connectionId). 같은 입력이면 같은 결과다.
// - 옛 DeepSeek 런처(P25·P33의 예시)도 같은 규칙의 보통 claude 런처다. 이름과 아이콘은 그대로 두고 특별 취급만 없앴다.
// - ATRIUM_OCX_HEALTH·ATRIUM_OCX_BASE_URL: 이번 릴리스 동안 읽어 연결로 옮기고 로그에 경고한다(뜰 때마다, 같은 ID라 겹치지 않는다). 다음 릴리스에서 없앤다.
// - 런처 env에 평문으로 든 인증 값은 옮기지 않는다(설정 탭이 알린다, launchers.mjs authNotices).
// - P33 전 판(런처 목록이 없음)의 옛 새 세션 기본값(deepseekModel, deepseekCommand 등)은 이 파일만 읽는다.
import { connectionId, normalizeConnection, nameOfUrl } from './connections.mjs';

export const V2_KEY = 'launchers.v2';
export const LEGACY_FLAVOR = 'deepseek'; // P25 세션의 flavor·옛 예시 런처의 ID와 아이콘
const LEGACY_MODEL = 'ocx-claude-deepseek--deepseek-flash[1m]'; // P25 예시 모델(옛 판의 설정에 모델이 없을 때)
const LEGACY_HEALTH_URL = 'http://127.0.0.1:10100/healthz'; // P25 예시의 health 주소(옛 판에 주소를 준 적이 없을 때)
export const LEGACY_KEYS = ['claudeModel', 'claudeEffort', 'claudePermissionMode', 'claudeAllowHerdr', 'codexArgs', 'deepseekModel', 'deepseekCommand'];

const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

// ATRIUM_OCX_* → 연결 하나({ healthUrl, baseUrl } 어느 하나라도 있으면)
export function legacyGatewayConnection(g = {}) {
  if (!g || (!g.healthUrl && !g.baseUrl)) return null;
  const baseUrl = g.baseUrl || originOf(g.healthUrl);
  if (!baseUrl) return null;
  try { return normalizeConnection({ name: `Gateway ${nameOfUrl(baseUrl)}`, protocol: 'anthropic-messages', baseUrl, healthUrl: g.healthUrl || '' }); } catch { return null; }
}

// P33 전 판: 옛 새 세션 기본값 → 런처 목록(P33의 initialLaunchers 옛 판 길 그대로. DeepSeek 예시는 env의 게이트웨이 주소)
export function legacyInitialLaunchers(o = {}, gw = {}) {
  const healthUrl = gw.healthUrl || LEGACY_HEALTH_URL;
  const base = (id, name, harness, x = {}) => ({ id, name, harness, icon: '', model: '', effort: '', permissionMode: '', args: '', env: {}, command: '', checkUrl: '', ...x });
  const items = [
    base('claude', 'Claude Code', 'claude', { model: o.claudeModel || '', effort: o.claudeEffort || '', permissionMode: o.claudePermissionMode || 'manual' }),
    base('codex', 'Codex', 'codex', { args: o.codexArgs || '' }),
    base('shell', 'Shell', 'shell'),
    o.deepseekCommand
      ? base(LEGACY_FLAVOR, 'DeepSeek', 'command', { icon: LEGACY_FLAVOR, command: o.deepseekCommand })
      : base(LEGACY_FLAVOR, 'DeepSeek', 'claude', { icon: LEGACY_FLAVOR, model: o.deepseekModel || LEGACY_MODEL, permissionMode: o.claudePermissionMode || 'manual', env: { ANTHROPIC_BASE_URL: gw.baseUrl || originOf(healthUrl), CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1' }, checkUrl: healthUrl }),
  ];
  return { v: 1, items, favorites: ['claude', 'codex', LEGACY_FLAVOR, 'shell'] };
}

// 옛 목록(v1) → { list(v2), connections(더할 연결), report }. 여러 번 돌려도 같다(연결 ID가 주소에서 나온다)
export function migrateLaunchers(v1, { legacyGateway = null } = {}) {
  const conns = new Map();
  const report = { moved: [], droppedCheckUrl: [], legacyGateway: null };
  const add = (c) => { if (!conns.has(c.id)) conns.set(c.id, c); return conns.get(c.id); };
  const items = (v1 && Array.isArray(v1.items) ? v1.items : []).map((l) => {
    const env = { ...(l.env || {}) };
    const out = { ...l, env };
    delete out.checkUrl;
    const url = l.harness === 'claude' ? env.ANTHROPIC_BASE_URL : null;
    if (url) {
      let c = null;
      try { c = normalizeConnection({ name: l.name, protocol: 'anthropic-messages', baseUrl: url, healthUrl: l.checkUrl || '' }); } catch { c = null; }
      if (c) {
        // 같은 주소를 여러 런처가 쓰면 연결 하나(health 주소는 처음 것)
        const kept = add(c);
        delete env.ANTHROPIC_BASE_URL;
        out.connection = kept.id;
        report.moved.push({ launcher: l.name, connection: kept.id, baseUrl: kept.baseUrl });
      }
    } else if (l.checkUrl) report.droppedCheckUrl.push(l.name); // base URL 없이 확인 주소만 있던 런처(연결이 없으니 확인할 곳이 없다)
    return out;
  });
  const lg = legacyGatewayConnection(legacyGateway);
  if (lg) { add(lg); report.legacyGateway = lg.id; }
  return { list: { v: 2, items, favorites: Array.isArray(v1 && v1.favorites) ? [...v1.favorites] : [] }, connections: [...conns.values()], report };
}

// 옛 세션(flavor만 있고 env 기록이 없는 P25 세션)의 연결: 그 flavor를 아이콘으로 쓰는 claude 런처의 연결
export const legacyFlavorLauncher = (launchers = [], flavor) => (flavor ? launchers.find((l) => l.harness === 'claude' && (l.icon === flavor || l.id === flavor) && l.connection) || null : null);
export const legacyConnectionIdOf = (protocol, baseUrl) => connectionId(protocol, baseUrl);
