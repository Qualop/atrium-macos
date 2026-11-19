// P115: 모델 연결(엔드포인트, 프로토콜, 인증). 런처와 따로 둔 목록이고 런처가 ID로 참조한다(이슈 #11 5.1).
// 판은 연결을 켜거나 번역하지 않는다. 연결이 그 하네스의 프로토콜을 직접 지원해야 한다(번역이 필요하면 사용자가 판 밖에서 게이트웨이를 돌리고 그 주소를 연결로 둔다).
// 인증은 환경 변수 이름만 둔다(값은 판 기록에 남기지 않는다). 하네스가 그 이름을 받아 자기 방식으로 싣는다(harness.mjs, launch.mjs).
// base URL 모양: anthropic-messages는 Claude Code의 ANTHROPIC_BASE_URL처럼 /v1 앞까지(http://host:port), openai-*는 /v1까지(http://host:port/v1).
// 모델 목록 주소를 비우면 프로토콜의 기본(anthropic: <base>/v1/models, openai: <base>/models). health 주소를 비우면 base URL이 닿는지만 본다.
import crypto from 'node:crypto';

export const META_KEY = 'connections';
export const VERSION = 1;
export const PROTOCOLS = ['anthropic-messages', 'openai-responses', 'openai-chat'];
export const AUTH_SCHEMES = ['bearer', 'x-api-key'];
export const NAME_MAX = 40;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NAME_BAD = /[\x00-\x1f\x7f"'`$\\]/;

const err = (code, message, key, vars = {}) => Object.assign(new Error(message), { code, key: `connections.err.${key}`, vars });
export const isAnthropic = (protocol) => protocol === 'anthropic-messages';
const trimUrl = (u) => String(u || '').trim().replace(/\/+$/, '');
function urlOf(v, field, { required = false } = {}) {
  const u = trimUrl(v);
  if (!u) { if (required) throw err('bad_request', `${field} 주소를 입력하세요.`, 'urlEmpty', { field }); return ''; }
  let x; try { x = new URL(u); } catch { x = null; }
  if (!x || !/^https?:$/.test(x.protocol) || u.length > 300 || /[\s"'`]/.test(u)) throw err('bad_request', `${field} 주소: ${u.slice(0, 60)}`, 'url', { field, url: u.slice(0, 60) });
  return u;
}
// 연결 ID: 프로토콜과 base URL에서 만든다(옮기기를 여러 번 돌려도 같다)
export const connectionId = (protocol, baseUrl) => 'c' + crypto.createHash('sha256').update(`${protocol}|${trimUrl(baseUrl).toLowerCase()}`).digest('hex').slice(0, 10);
export const defaultScheme = (protocol) => (isAnthropic(protocol) ? 'x-api-key' : 'bearer');
export const modelsUrlOf = (c) => c.modelsUrl || (isAnthropic(c.protocol) ? `${c.baseUrl}/v1/models` : `${c.baseUrl}/models`);
// 연결 이름의 기본값(주소의 호스트:포트)
export const nameOfUrl = (u) => { try { const x = new URL(u); return x.host || u; } catch { return String(u || '').slice(0, NAME_MAX); } };

// 연결 하나 확인·정리. others: 이름 겹침을 볼 다른 연결들
export function normalizeConnection(input, { others = [] } = {}) {
  if (!input || typeof input !== 'object') throw err('bad_request', '연결을 지정하세요.', 'empty');
  const protocol = String(input.protocol || '');
  if (!PROTOCOLS.includes(protocol)) throw err('bad_request', `프로토콜: ${protocol}`, 'protocol', { protocol: protocol.slice(0, 30) });
  const baseUrl = urlOf(input.baseUrl, 'base URL', { required: true });
  const name = String(input.name ?? '').trim() || nameOfUrl(baseUrl);
  if (name.length > NAME_MAX || NAME_BAD.test(name)) throw err('bad_request', `이름은 ${NAME_MAX}자까지, 따옴표·$·\\ 없이`, 'name', { max: NAME_MAX });
  if (others.some((o) => o.id !== input.id && o.name.toLowerCase() === name.toLowerCase())) throw err('name_taken', `이미 사용 중인 연결 이름입니다: ${name}`, 'nameTaken', { name });
  const a = input.auth && typeof input.auth === 'object' ? input.auth : {};
  const env = String(a.env ?? '').trim();
  if (env && !ENV_NAME_RE.test(env)) throw err('bad_request', `인증 환경 변수 이름: ${env.slice(0, 40)}`, 'authEnv', { name: env.slice(0, 40) });
  const scheme = a.scheme ? String(a.scheme) : defaultScheme(protocol);
  if (!AUTH_SCHEMES.includes(scheme)) throw err('bad_request', `인증 방식: ${scheme}`, 'authScheme', { scheme: scheme.slice(0, 20) });
  return { id: input.id || connectionId(protocol, baseUrl), name, protocol, baseUrl, auth: { env, scheme }, healthUrl: urlOf(input.healthUrl, 'health'), modelsUrl: urlOf(input.modelsUrl, '모델 목록') };
}

// 판이 그 연결에 보낼 머리글(health·모델 목록). 키 값은 판 프로세스의 env에서 그때 읽는다(판 기록에 남기지 않는다)
export function authHeaders(c, env = process.env) {
  const h = isAnthropic(c.protocol) ? { 'anthropic-version': '2023-06-01' } : {};
  const v = c.auth && c.auth.env ? env[c.auth.env] : '';
  if (v) { if (c.auth.scheme === 'x-api-key') h['x-api-key'] = v; else h.authorization = `Bearer ${v}`; }
  return h;
}
// 시작 전 확인: health 주소면 2xx이고 status가 ok여야, 아니면 base URL에 무슨 HTTP 답이든(launchers.checkGateway가 한다)
export const checkOf = (c) => (c.healthUrl ? { url: c.healthUrl, health: true } : { url: c.baseUrl, health: false });

// 모델 목록 읽기. Anthropic식은 anthropic-version 머리글, OpenAI식은 GET <base>/models. 안 닿으면 { ok: false, why }
export async function fetchConnectionModels(c, { timeoutMs = 2000, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const url = modelsUrlOf(c) + (isAnthropic(c.protocol) && !c.modelsUrl ? '?limit=1000' : '');
  try {
    const r = await fetchImpl(url, { headers: authHeaders(c, env), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    const j = await r.json().catch(() => null);
    const data = j && Array.isArray(j.data) ? j.data : j && Array.isArray(j.models) ? j.models : null;
    if (!data) return { ok: false, why: '유효한 모델 목록이 아닙니다.' };
    return { ok: true, models: data.filter((m) => m && typeof m.id === 'string').map((m) => ({ id: m.id, display_name: m.display_name || m.name || null, owned_by: m.owned_by || null })) };
  } catch (e) { return { ok: false, why: e && e.name === 'TimeoutError' ? 'timeout' : (e && e.cause && e.cause.code) || (e && e.message) || 'unreachable' }; }
}

// 판 기록에 둔 연결 목록
export class Connections {
  constructor({ store, broadcast = () => {}, inUse = () => [] }) { this.store = store; this.broadcast = broadcast; this.inUse = inUse; }
  data() { const d = this.store.getMeta(META_KEY); return d && Array.isArray(d.items) ? d : { v: VERSION, items: [] }; }
  items() { return this.data().items; }
  save(items) { this.store.setMeta(META_KEY, { v: VERSION, items }); const out = this.list(); this.broadcast('connections.updated', out); return out; }
  list() { return { connections: this.items().map((c) => ({ ...c, usedBy: this.inUse(c.id) })), protocols: PROTOCOLS, schemes: AUTH_SCHEMES }; }
  find(ref) { const r = String(ref ?? '').trim().toLowerCase(); if (!r) return null; const xs = this.items(); return xs.find((c) => c.id.toLowerCase() === r) || xs.find((c) => c.name.toLowerCase() === r) || null; }
  get(ref) { const c = this.find(ref); if (!c) throw err('no_connection', `연결을 찾을 수 없습니다: ${ref}`, 'notFound', { ref: String(ref).slice(0, 40) }); return c; }
  // 없으면 더한다(같은 ID면 그대로). 옮기기가 쓴다
  ensure(c) { const xs = this.items(); if (xs.some((x) => x.id === c.id)) return xs.find((x) => x.id === c.id); const n = normalizeConnection({ ...c, name: uniqueName(c.name, xs) }, { others: xs }); this.store.setMeta(META_KEY, { v: VERSION, items: [...xs, n] }); return n; }
  create(p) {
    const xs = this.items();
    const c = normalizeConnection({ ...((p && p.connection) || p), id: null }, { others: xs });
    if (xs.some((x) => x.id === c.id)) throw err('exists', `같은 프로토콜과 주소의 연결이 이미 있습니다: ${xs.find((x) => x.id === c.id).name}`, 'exists', { name: xs.find((x) => x.id === c.id).name });
    return { connection: c, ...this.save([...xs, c]) };
  }
  // 프로토콜·주소를 바꿔도 ID는 그대로(런처의 참조가 끊기지 않게)
  update(p) {
    const xs = this.items(); const cur = this.get(p && (p.id || (p.connection && p.connection.id)));
    const c = normalizeConnection({ ...cur, ...((p && p.patch) || (p && p.connection) || {}), id: cur.id }, { others: xs });
    return { connection: c, ...this.save(xs.map((x) => (x.id === cur.id ? c : x))) };
  }
  delete(p) {
    const cur = this.get(p && p.id);
    const users = this.inUse(cur.id);
    if (users.length) throw err('connection_in_use', `이 연결을 쓰는 런처가 있습니다: ${users.join(', ')}. 런처에서 연결을 먼저 바꾸세요.`, 'inUse', { launchers: users.join(', ') });
    return this.save(this.items().filter((x) => x.id !== cur.id));
  }
}
export function uniqueName(want, items = []) {
  const base = (String(want || '').trim() || 'Connection').slice(0, NAME_MAX);
  const taken = new Set(items.map((x) => String(x.name).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) { const n = `${base.slice(0, NAME_MAX - 1 - String(i).length)} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  return base;
}
