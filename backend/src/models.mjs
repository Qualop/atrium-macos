// P41: 판이 띄울 수 있는 모델의 목록(atrium models)과 말로 한 모델 이름 풀기(atrium child --model).
// 목록은 세 곳에서 온다.
// - 호출자(launchers.mjs): 이름, 하네스, 모델, 게이트웨이 경유 여부. 띄우는 명령은 atrium child <이름> --launcher <호출자>.
// - 하네스가 아는 모델(HARNESSES의 models)과 짧은 별칭(opus, sonnet, haiku, fable).
// - 게이트웨이가 알려 주는 모델: 게이트웨이를 쓰는 claude 호출자(ANTHROPIC_BASE_URL)마다 그 주소의 /v1/models를 Claude Code처럼(anthropic-version 머리글) 읽는다.
//   이 모델은 그 호출자의 env(게이트웨이 주소 등)로 띄운다. 판이 알려진 Anthropic 모델은 게이트웨이를 거치지 않고 하네스 줄로 띄우므로 게이트웨이 목록에서 뺀다.
// 이름 풀기는 정확한 ID → 별칭 → 느슨한 맞춤(대소문자, 띄어쓰기·하이픈, "deepseek flash" ↔ deepseek-flash) 순서다. 같은 모델을 가리키는 줄이 여럿이면 하나로 본다(호출자 > 하네스 > 게이트웨이).
// 서로 다른 모델이 맞으면 띄우지 않고 후보를 돌려주고, 없으면 가까운 후보를 돌려준다. 모르는 이름으로 조용히 띄우지 않는다.
import { HARNESSES, harnessOf, gatewayOf, MODEL_RE, quoteArg } from './launchers.mjs';

// 짧은 별칭. opus·sonnet·haiku는 Claude Code가 아는 별칭이라 그대로 넘기고, fable은 전체 ID로 푼다
export const CLAUDE_ALIASES = { fable: 'claude-fable-5-1' };
const AGENT_HARNESS = (h) => h && h.id !== 'shell' && h.id !== 'command';
const SAFE_REF = /^[A-Za-z0-9._-]+$/;
const SOURCE_RANK = { launcher: 0, harness: 1, gateway: 2 };

// 셸에서 그대로 칠 수 있게: [ ] 같은 글자가 있으면 큰따옴표로 묶는다(Bash가 [1m]을 파일 이름 맞춤으로 읽지 않게)
const q = quoteArg;
export const launcherRef = (l) => (SAFE_REF.test(l.name) ? l.name : q(l.id || l.name));
export const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-.]+/g, '');
const tokens = (s) => String(s || '').toLowerCase().split(/[\s_\-./()[\]·,:]+/).filter(Boolean);
// 말에 든 변형(1M 문맥, fast)
export function variantsOf(s) {
  const t = String(s || '').toLowerCase();
  const v = [];
  if (/\[1m\]|(^|[^a-z0-9])1m([^a-z0-9]|$)/.test(t)) v.push('1m');
  if (/(^|[^a-z])fast([^a-z]|$)/.test(t)) v.push('fast');
  return v;
}
const stripVariants = (s) => String(s || '').replace(/\[1m\]$/i, '').replace(/--fast$/i, '');

// opencodex 모양의 모델 이름: ocx-claude-<제공자>--<모델>[--fast][[1m]]
export function parseOcx(id) {
  const m = /^ocx-claude-([a-z0-9.]+)--(.+?)(--fast)?(\[1m\])?$/i.exec(String(id || ''));
  if (!m) return null;
  return { provider: m[1].toLowerCase(), base: m[2], variants: [...(m[4] ? ['1m'] : []), ...(m[3] ? ['fast'] : [])] };
}
// 게이트웨이 모델 한 줄: display_name "deepseek-flash (deepseek) · Fast · 1M"이 있으면 그것을, 없으면 "<제공자>/<모델>" 모양의 ID를 읽는다
export function parseGatewayModel(m) {
  const id = String(m.id || '');
  const dn = String(m.display_name || '');
  const d = /^\s*([^()·]+?)\s*\(([^)]+)\)\s*(.*)$/.exec(dn);
  if (d) {
    const tail = d[3].toLowerCase();
    return { id, label: dn, base: d[1].trim(), provider: d[2].trim().toLowerCase(), variants: [...(/1m/.test(tail) ? ['1m'] : []), ...(/fast/.test(tail) ? ['fast'] : [])] };
  }
  const o = parseOcx(id);
  if (o) return { id, label: id, ...o };
  const i = id.lastIndexOf('/');
  const raw = i >= 0 ? id.slice(i + 1) : id;
  return { id, label: dn || id, base: stripVariants(raw), provider: i >= 0 ? id.slice(0, i).toLowerCase() : (m.owned_by ? String(m.owned_by).toLowerCase() : ''), variants: variantsOf(raw) };
}

// 모델 이름이 가리키는 것(같은 모델을 가리키는 줄끼리 하나로 본다)
function targetOfModel(harness, model) {
  const o = parseOcx(model);
  if (o) return { target: `${o.provider}:${o.base.toLowerCase()}`, base: o.base, provider: o.provider, variants: o.variants };
  const m = String(model || '');
  return { target: `${harness}:${(CLAUDE_ALIASES[m.toLowerCase()] || m).toLowerCase()}`, base: m, provider: harness, variants: [] };
}

// 목록 만들기. launchers: 호출자들, gateways: [{ url, host(호출자), ok, models: [/v1/models의 data], why }]
export function buildCatalog({ launchers = [], gateways = [], providers = {} } = {}) {
  const entries = [];
  for (const l of launchers) {
    const h = harnessOf(l.harness);
    if (!AGENT_HARNESS(h)) continue;
    const gw = gatewayOf(l);
    const t = targetOfModel(h.id, l.model || '');
    entries.push({ source: 'launcher', harness: h.id, kind: h.kind, launcher: l.name, launcherId: l.id, model: l.model || '', gateway: gw ? (l.env && l.env.ANTHROPIC_BASE_URL) || gw.url : null, keys: { exact: [l.name, l.id], exactModel: l.model ? [l.model] : [], alias: l.model ? [t.base] : [] }, ...t, words: [l.name, l.model, t.base].filter(Boolean).join(' '), command: `atrium child <이름> --launcher ${launcherRef(l)}` });
  }
  for (const h of Object.values(HARNESSES)) {
    // Provider lists are loaded by Branch through Backend.agentModels. Never
    // substitute a hard-coded Codex model when discovery is unavailable.
    const live = providers[h.kind];
    const rows = h.liveModels ? (Array.isArray(live) ? live : live?.models || []) : h.models || [];
    const seenModels = new Set();
    for (const row of rows) {
      const m = typeof row === 'string' ? row : row?.id || row?.model;
      if (!m || !MODEL_RE.test(m) || seenModels.has(m)) continue;
      seenModels.add(m);
      const label = typeof row === 'object' ? row.name || row.displayName || row.display_name || m : m;
      const aliases = [...Object.entries(CLAUDE_ALIASES).filter(([, v]) => h.id === 'claude' && v === m).map(([k]) => k), ...(label !== m ? [label] : [])];
      entries.push({ source: 'harness', harness: h.id, kind: h.kind, launcher: null, model: m, label, gateway: null, keys: { exact: [], exactModel: [m], alias: aliases }, target: `${h.id}:${m.toLowerCase()}`, base: m, provider: h.id, variants: [], aliases, words: [m, label, ...aliases].join(' '), command: h.id === 'claude' ? `atrium child <이름> --model ${q(m)}` : `atrium child <이름> --kind ${h.kind} --model ${q(m)}` });
    }
  }
  const known = new Set(entries.filter((e) => e.source === 'harness').map((e) => e.model.toLowerCase()));
  const seen = new Set();
  for (const g of gateways) {
    if (!g.ok) continue;
    for (const raw of g.models || []) {
      const p = parseGatewayModel(raw);
      if (!p.id || !MODEL_RE.test(p.id) || seen.has(p.id)) continue;
      if (p.provider === 'anthropic' || known.has(stripVariants(p.id).toLowerCase())) continue; // 판이 게이트웨이 없이 띄우는 모델
      seen.add(p.id);
      const ocx = `ocx-claude-${p.provider}--${p.base}${p.variants.includes('fast') ? '--fast' : ''}${p.variants.includes('1m') ? '[1m]' : ''}`;
      entries.push({ source: 'gateway', harness: 'claude', kind: 'claude', launcher: null, host: g.host ? g.host.name : null, hostId: g.host ? g.host.id : null, model: p.id, label: p.label, gateway: g.url, keys: { exact: [], exactModel: [p.id], alias: [`${p.base}${p.variants.includes('fast') ? '--fast' : ''}${p.variants.includes('1m') ? '[1m]' : ''}`, ocx, `${p.provider}/${p.base}`] }, target: `${p.provider}:${p.base.toLowerCase()}`, base: p.base, provider: p.provider, variants: p.variants, words: [p.base, p.provider, p.label].join(' '), command: `atrium child <이름> --model ${q(p.id)}` });
    }
  }
  return { entries, gateways: gateways.map((g) => ({ url: g.url, host: g.host ? g.host.name : null, ok: !!g.ok, why: g.why || null, count: g.ok ? (g.models || []).length : 0 })) };
}

// 그 하네스 종류만(--kind를 준 경우)
const ofKind = (entries, kind) => (kind ? entries.filter((e) => e.kind === kind) : entries);
// 후보를 고른다: 말의 변형과 가장 가까운 줄만 남기고, 남은 줄이 한 모델을 가리키면 그 가운데 순위가 높은 줄
function pick(matches, qv, how) {
  const score = (e) => (e.source === 'launcher' ? qv.filter((v) => !e.variants.includes(v)).length : qv.filter((v) => !e.variants.includes(v)).length + e.variants.filter((v) => !qv.includes(v)).length);
  const min = Math.min(...matches.map(score));
  const best = matches.filter((e) => score(e) === min).sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  const targets = [...new Set(best.map((e) => e.target))];
  if (targets.length === 1) return { ok: true, how, entry: best[0] };
  const one = new Map(); for (const e of best) if (!one.has(e.target)) one.set(e.target, e);
  return { ok: false, code: 'model_ambiguous', how, candidates: [...one.values()] };
}

// 말로 한 이름 → { ok, how: exact|alias|loose, entry } | { ok: false, code: model_ambiguous|model_unknown, candidates }
export function resolveModel(query, catalog, { kind = null } = {}) {
  const raw = String(query || '').trim();
  const entries = ofKind(catalog.entries, kind);
  const lq = raw.toLowerCase();
  const qv = variantsOf(raw);
  // 1. 정확한 ID: 호출자 이름·ID, 모델 ID. 모델 ID가 같으면 게이트웨이가 필요한 호출자 > 하네스 > 게이트웨이 > 그 밖의 호출자
  const byName = entries.filter((e) => e.keys.exact.some((k) => k && k.toLowerCase() === lq));
  if (byName.length) return { ok: true, how: 'exact', entry: byName[0] };
  const byModel = entries.filter((e) => e.keys.exactModel.some((k) => k.toLowerCase() === lq));
  if (byModel.length) {
    if (new Set(byModel.map((e) => e.target)).size > 1) return pick(byModel, qv, 'exact');
    const rank = (e) => (e.source === 'launcher' ? (e.gateway ? 0 : 3) : SOURCE_RANK[e.source]);
    return { ok: true, how: 'exact', entry: byModel.sort((a, b) => rank(a) - rank(b))[0] };
  }
  // 2. 별칭(opus 등의 짧은 이름, 게이트웨이 모델의 이름, opencodex 모양 이름)
  const byAlias = entries.filter((e) => e.keys.alias.some((k) => k && k.toLowerCase() === lq));
  if (byAlias.length) return pick(byAlias, qv, 'alias');
  // 3. 느슨한 맞춤: 변형 말("1m", "fast")을 뺀 나머지가 같거나(띄어쓰기·하이픈·점·대소문자 무시), 낱말이 모두 들어 있다
  const core = raw.replace(/\[1m\]/ig, ' ').replace(/(^|[\s_-])(1m|fast)(?=$|[\s_-])/ig, ' ');
  const nq = norm(core);
  const qt = tokens(core);
  if (nq) {
    const keysOf = (e) => [...e.keys.exact, ...e.keys.exactModel, ...e.keys.alias, e.base].filter(Boolean).map((k) => norm(stripVariants(k)));
    const strong = entries.filter((e) => keysOf(e).includes(nq));
    if (strong.length) return pick(strong, qv, 'loose');
    const weak = entries.filter((e) => { const et = new Set(tokens(e.words)); return qt.length && qt.every((t) => et.has(t)); });
    if (weak.length) return pick(weak, qv, 'loose');
  }
  return { ok: false, code: 'model_unknown', candidates: nearest(raw, entries) };
}

// 가까운 후보(낱말 겹침, 그다음 글자 거리). 같은 모델은 하나만, n개까지
export function nearest(query, entries, n = 5) {
  const qt = tokens(query).filter((t) => t.length > 1 && /[a-z]/.test(t)); const nq = norm(query); // 숫자 한두 글자("6", "1")는 겹침으로 세지 않는다
  const scored = entries.map((e) => {
    const et = new Set(tokens(e.words));
    const shared = qt.filter((t) => et.has(t) || [...et].some((x) => x.length > 2 && (x.startsWith(t) || t.startsWith(x)))).length;
    const dist = Math.min(...[e.base, e.launcher, e.model].filter(Boolean).map((k) => lev(nq, norm(k))));
    return { e, shared, dist };
  }).filter((x) => x.shared > 0 || x.dist <= Math.max(2, Math.floor(nq.length / 3)));
  scored.sort((a, b) => b.shared - a.shared || a.dist - b.dist || SOURCE_RANK[a.e.source] - SOURCE_RANK[b.e.source]);
  const out = []; const seen = new Set();
  for (const { e } of scored) { if (seen.has(e.target) || e.variants.length) continue; seen.add(e.target); out.push(e); if (out.length >= n) break; }
  return out;
}
function lev(a, b) {
  if (a === b) return 0;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}

// 한 줄 설명(atrium models, 후보 목록)
export function describeEntry(e) {
  if (e.source === 'launcher') return `호출자 ${e.launcher} · ${HARNESSES[e.harness] ? HARNESSES[e.harness].label : e.harness} · 모델 ${e.model || '(하네스 기본)'}${e.gateway ? ` · 게이트웨이 경유(${e.gateway})` : ''}`;
  if (e.source === 'harness') return `${HARNESSES[e.harness].label} 모델 ${e.model}${e.aliases && e.aliases.length ? `(별칭 ${e.aliases.join(', ')})` : ['opus', 'sonnet', 'haiku'].includes(e.model) ? '(Claude Code 별칭)' : ''}`;
  return `게이트웨이 모델 ${e.label || e.model} · Claude Code · 게이트웨이 경유(${e.gateway}${e.host ? `, 호출자 ${e.host}의 env` : ''})`;
}
export const candidateLines = (list) => list.map((e) => `  - ${describeEntry(e)}\n    ${e.command}`).join('\n');

// 게이트웨이 모델 목록 읽기(Claude Code의 게이트웨이 모델 찾기와 같은 머리글). 안 닿으면 { ok: false, why }
export async function fetchGatewayModels(baseUrl, { timeoutMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/v1/models?limit=1000`;
  try {
    const r = await fetchImpl(url, { headers: { 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    const j = await r.json().catch(() => null);
    const data = j && Array.isArray(j.data) ? j.data : null;
    if (!data) return { ok: false, why: '모델 목록이 아니다' };
    return { ok: true, models: data.filter((m) => m && typeof m.id === 'string').map((m) => ({ id: m.id, display_name: m.display_name || null, owned_by: m.owned_by || null })) };
  } catch (e) { return { ok: false, why: e && e.name === 'TimeoutError' ? 'timeout' : (e && e.cause && e.cause.code) || (e && e.message) || 'unreachable' }; }
}
// 게이트웨이를 쓰는 claude 호출자의 주소들(같은 주소는 처음 호출자 하나). extra는 판 설정의 opencodex 주소 등 { url, host }
export function gatewaysOf(launchers, extra = []) {
  const out = new Map();
  for (const l of launchers) {
    if (l.harness !== 'claude' || !l.env || !l.env.ANTHROPIC_BASE_URL) continue;
    const url = l.env.ANTHROPIC_BASE_URL;
    if (!out.has(url)) out.set(url, { url, host: l });
  }
  for (const x of extra) if (x && x.url && !out.has(x.url)) out.set(x.url, x);
  return [...out.values()];
}
