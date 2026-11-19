// Claude Code 계정 여럿(macOS 판). 계정 하나 = Claude Code 설정 폴더 하나(CLAUDE_CONFIG_DIR).
// - 기본 계정(default)은 ~/.claude(환경 변수 없음)이고 지울 수 없다. 더한 계정은 판 기록(meta claudeAccounts)에 { id, name, configDir }로 둔다.
// - Claude Code는 CLAUDE_CONFIG_DIR마다 로그인(키체인 항목 "Claude Code-credentials-<폴더 해시>"), .claude.json, projects/(대화 기록)을 따로 쓴다.
//   판은 그 세션의 터미널에 CLAUDE_CONFIG_DIR만 준다. 로그인은 사람이 그 세션의 터미널에서 직접 한다(/login). 판은 인증 정보를 읽거나 쓰지 않는다.
// - 하위 세션은 부모의 계정을 물려받는다. 세션 runtime에 claudeAccount(ID)와 claudeConfigDir(경로)을 남긴다(다시 열기·깨우기·되살리기가 같은 계정으로).
// - 표시용으로 그 폴더 .claude.json의 oauthAccount 이메일·이름만 읽는다(이 PC의 화면에만 보인다. 토큰은 그 파일에 없고 판은 키체인을 읽지 않는다).
// - 우선순위와 한도(account-failover.mjs): 계정 차례는 판 기록(meta claudeAccountOrder, ID 목록)이고 기본 계정이 맨 앞에서 시작한다.
//   사용 한도에 걸린 계정은 meta claudeAccountLimits에 { until, at, type, text }로 남긴다. 계정을 고르지 않은 새 세션(자동)은 차례대로 보아
//   한도에 걸리지 않고 로그인한 첫 계정으로 띄운다. 사람이 고른 계정(런처·새 세션 창의 계정, 'default' 포함)은 그대로 쓴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_ACCOUNT = 'default';
export const ACCOUNTS_KEY = 'claudeAccounts';
export const AUTO_ACCOUNT = 'auto'; // 고르지 않음: 우선순위에서 쓸 수 있는 첫 계정
export const ORDER_KEY = 'claudeAccountOrder';
export const LIMITS_KEY = 'claudeAccountLimits';
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const NAME_MAX = 40;
const CTRL_RE = /[\x00-\x1f\x7f]/;
const MAX_ACCOUNTS = 8;

const bad = (message, key, vars) => Object.assign(new Error(message), { code: 'bad_request', ...(key ? { key: `accounts.err.${key}`, vars: vars || {} } : {}) });
const expandHome = (p, home) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);

// 이름 → 계정 ID 후보(영문 소문자·숫자·-). 비면 무작위
export function slugOf(name) {
  const s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return s && /^[a-z0-9]/.test(s) ? s : `acct-${crypto.randomBytes(3).toString('hex')}`;
}

// 저장한 목록(검사 전) → 판이 쓰는 목록(기본 계정이 맨 앞)
export function accountList(stored, { home = os.homedir() } = {}) {
  const out = [{ id: DEFAULT_ACCOUNT, name: 'Claude', configDir: null, home: path.join(home, '.claude'), builtin: true }];
  for (const a of Array.isArray(stored) ? stored : []) {
    if (!a || !ID_RE.test(String(a.id || '')) || a.id === DEFAULT_ACCOUNT || a.id === AUTO_ACCOUNT || !a.configDir || !path.isAbsolute(String(a.configDir))) continue;
    if (out.some((x) => x.id === a.id)) continue;
    out.push({ id: a.id, name: String(a.name || a.id).slice(0, NAME_MAX), configDir: path.resolve(a.configDir), home: path.resolve(a.configDir), builtin: false });
  }
  return out;
}

// 계정 더하기 값 확인 → 저장할 행
// 계정 목록을 저장한 차례(ID 목록)로 놓는다. 차례에 없는 계정은 원래 순서로 뒤에(기본 계정은 처음에 맨 앞)
export function orderAccounts(list, order) {
  const at = new Map((Array.isArray(order) ? order : []).map((id, i) => [String(id), i]));
  return list.map((a, i) => ({ a, i, k: at.has(a.id) ? at.get(a.id) : list.length + i })).sort((x, y) => x.k - y.k || x.i - y.i).map((x) => x.a);
}
// 지금도 걸려 있는 한도(지난 것은 null)
export function activeLimit(limits, id, now = Date.now()) {
  const l = limits && typeof limits === 'object' ? limits[id] : null;
  return l && Number.isFinite(l.until) && l.until > now ? l : null;
}
// 차례대로 보아 쓸 수 있는 첫 계정(빼는 계정, 한도, 쓸 수 있는가). 없으면 null
export function pickAccount(list, { limits = {}, now = Date.now(), exclude = [], usable = () => true } = {}) {
  const skip = new Set(exclude);
  return list.find((a) => !skip.has(a.id) && !activeLimit(limits, a.id, now) && usable(a)) || null;
}

// 더한 계정의 설정 폴더에 기본 계정(~/.claude)의 전역 지시(CLAUDE.md)와 사용자 스킬(skills/)을 링크한다(없을 때만, 있는 파일은 건드리지 않는다).
// 계정이 달라도 같은 사람의 작업 규칙(브라우저는 ego-browser, 앱 조작은 CUA 등)과 스킬을 쓰게 한다. → 링크한 이름들
export const SHARED_SETUP = ['CLAUDE.md', 'skills'];
export function shareUserSetup(configDir, { home = os.homedir() } = {}) {
  const linked = [];
  for (const n of SHARED_SETUP) {
    const src = path.join(home, '.claude', n), dst = path.join(configDir, n);
    try { if (!fs.existsSync(src)) continue; fs.lstatSync(dst); continue; } catch {}
    try { fs.symlinkSync(src, dst); linked.push(n); } catch {}
  }
  return linked;
}
// 기본 계정의 사용자 범위 MCP 서버(~/.claude.json mcpServers, 예: cua)를 다른 계정 세션에 --mcp-config로 줄 파일로 쓴다. → 파일 경로 | null(서버 없음)
export function writeUserMcpConfig({ claudeJson, file }) {
  let servers = null;
  try { const j = JSON.parse(fs.readFileSync(claudeJson, 'utf8')); servers = j && j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : null; } catch {}
  if (!servers || !Object.keys(servers).length) { try { fs.rmSync(file, { force: true }); } catch {} return null; }
  const keep = {};
  for (const [name, v] of Object.entries(servers)) if (v && typeof v === 'object') keep[name] = Object.fromEntries(Object.entries(v).filter(([k]) => ['type', 'command', 'args', 'env', 'url', 'headers'].includes(k)));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: keep }, null, 2) + '\n', { mode: 0o600 });
  return file;
}

export function normalizeAccount(input, { existing = [], home = os.homedir() } = {}) {
  const name = String(input?.name ?? '').trim();
  if (!name || name.length > NAME_MAX || CTRL_RE.test(name)) throw bad(`계정 이름은 1~${NAME_MAX}자 한 줄입니다.`, 'name', { max: NAME_MAX });
  const all = accountList(existing, { home });
  if (all.length - 1 >= MAX_ACCOUNTS) throw bad(`계정은 ${MAX_ACCOUNTS}개까지 더할 수 있습니다.`, 'tooMany', { max: MAX_ACCOUNTS });
  if (all.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw bad(`이미 있는 계정 이름입니다: ${name}`, 'nameTaken', { name });
  let id = input?.id ? String(input.id) : slugOf(name);
  if (!ID_RE.test(id) || id === DEFAULT_ACCOUNT || id === AUTO_ACCOUNT) throw bad(`계정 ID: ${id}`, 'id', { id });
  for (let i = 2; all.some((a) => a.id === id); i++) id = `${slugOf(name).slice(0, 28)}-${i}`;
  const raw = String(input?.configDir ?? '').trim();
  if (CTRL_RE.test(raw)) throw bad('설정 폴더 경로는 한 줄입니다.', 'dir');
  const configDir = path.resolve(expandHome(raw || `~/.claude-${id}`, home));
  if (!path.isAbsolute(configDir)) throw bad('설정 폴더는 절대 경로여야 합니다.', 'dir');
  const def = path.join(home, '.claude');
  if (configDir === def || configDir === home || configDir === path.parse(configDir).root) throw bad('기본 계정(~/.claude)이나 홈 폴더는 쓸 수 없습니다.', 'dirDefault');
  if (all.some((a) => a.configDir && a.configDir === configDir)) throw bad(`이미 다른 계정이 쓰는 폴더입니다: ${configDir}`, 'dirTaken', { dir: configDir });
  return { id, name, configDir };
}

// 그 계정의 표시 정보(.claude.json의 oauthAccount 이메일·표시 이름). 읽지 못하면 로그인 안 됨으로 본다
export function accountProfile(account, { claudeJson }) {
  const file = account.configDir ? path.join(account.configDir, '.claude.json') : claudeJson;
  let j = null;
  try { const st = fs.statSync(file); if (st.size < 32 * 1024 * 1024) j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const o = j && j.oauthAccount && typeof j.oauthAccount === 'object' ? j.oauthAccount : null;
  return { loggedIn: !!o, email: o && typeof o.emailAddress === 'string' ? o.emailAddress : null, displayName: o && typeof o.displayName === 'string' ? o.displayName : null, exists: account.configDir ? fs.existsSync(account.configDir) : true };
}

// 판(Backend)에 계정 도우미를 붙인다. 판 기록(store meta)에 목록을 둔다
export function attachAccounts(b) {
  const home = () => os.homedir();
  const stored = () => b.store.getMeta(ACCOUNTS_KEY) || [];
  const order = () => b.store.getMeta(ORDER_KEY) || [];
  const limits = () => b.store.getMeta(LIMITS_KEY) || {};
  const list = () => orderAccounts(accountList(stored(), { home: home() }), order()); // 우선순위 차례
  const byId = (id) => list().find((a) => a.id === (id || DEFAULT_ACCOUNT)) || null;
  const def = () => byId(DEFAULT_ACCOUNT);
  // 띄울 수 있는 계정: 폴더가 있고 로그인한 것(로그인하지 않은 계정으로 넘어가면 로그인 화면에서 멈춘다)
  const usable = (a) => { const p = accountProfile(a, { claudeJson: b.cfg.claudeJson }); return p.exists && p.loggedIn; };
  const failoverOn = () => { try { return b.features?.settings?.get?.().claudeAccountFailover !== false; } catch { return true; } };
  for (const a of accountList(stored(), { home: home() })) if (a.configDir) { try { shareUserSetup(a.configDir, { home: home() }); } catch {} }
  Object.assign(b, {
    claudeAccounts: list,
    accountById: byId,
    // 띄울 계정: 호출자가 고른 것(p.account) → 런처의 계정 → 부모(하위 세션) → 기본
    // 고르지 않았거나 'auto'면 자동: 부모의 계정(한도에 걸리지 않았으면) → 우선순위에서 쓸 수 있는 첫 계정 → 기본
    accountFor(p = {}, plan = {}, parentS = null) {
      const chosen = [p.account, plan.account].find((x) => x && x !== AUTO_ACCOUNT) || null;
      const inherited = parentS && parentS.kind === 'claude' && parentS.rt && parentS.rt.claudeAccount ? parentS.rt.claudeAccount : null;
      if (!chosen) {
        const now = Date.now(), lim = limits();
        const parentA = inherited ? byId(inherited) : null;
        if (parentA && (!failoverOn() || !activeLimit(lim, parentA.id, now))) return parentA;
        if (!failoverOn()) return def();
        return pickAccount(list(), { limits: lim, now, usable }) || parentA || def();
      }
      const want = chosen;
      const a = byId(want);
      if (!a) throw Object.assign(new Error(`Claude 계정을 찾을 수 없습니다: ${want}. 설정 › Claude 계정에서 확인하세요.`), { code: 'account_missing', key: 'accounts.err.missing', vars: { id: String(want).slice(0, 40) } });
      return a;
    },
    // 세션의 계정(없거나 지운 계정이면 세션에 남은 폴더로, 그것도 없으면 기본)
    accountOf(s) {
      const rt = (s && s.rt) || {};
      const a = rt.claudeAccount ? byId(rt.claudeAccount) : null;
      if (a) return a;
      if (rt.claudeConfigDir) return { id: rt.claudeAccount || 'removed', name: rt.claudeAccount || 'removed', configDir: rt.claudeConfigDir, home: rt.claudeConfigDir, builtin: false, removed: true };
      return def();
    },
    claudeJsonOf(account) { return account && account.configDir ? path.join(account.configDir, '.claude.json') : b.cfg.claudeJson; },
    accountEnv(account) { return account && account.configDir ? { CLAUDE_CONFIG_DIR: account.configDir } : null; },
    // 다른 계정 세션에 더할 실행 값: 기본 계정의 사용자 MCP 서버(cua 등). 기본 계정은 자기 ~/.claude.json을 읽으므로 넘기지 않는다
    accountLaunch(configDir) {
      if (!configDir || !b.cfg.dataDir) return {};
      const f = writeUserMcpConfig({ claudeJson: b.cfg.claudeJson, file: path.join(b.cfg.dataDir, 'mcp', 'user-mcp.json') });
      return f ? { mcpConfig: f } : {};
    },
    projectsOfAccount(account) { return account && account.configDir ? path.join(account.configDir, 'projects') : b.cfg.claudeProjects; },
    projectsOf(s) { return s && s.kind && s.kind !== 'claude' ? b.cfg.claudeProjects : b.projectsOfAccount(b.accountOf(s)); },
    // 판 밖 대화를 읽을 폴더: 설정의 폴더들 + 더한 계정의 projects
    convoRootsAll() { return [...new Set([...(b.cfg.convoRoots || []), ...list().filter((a) => a.configDir).map((a) => path.join(a.configDir, 'projects'))])]; },
    // 대화 기록 파일이 든 계정(더한 계정의 projects 안이면 그 계정, 아니면 기본)
    accountOfFile(file) {
      const f = path.resolve(String(file || ''));
      for (const a of list()) if (a.configDir && (f + path.sep).startsWith(path.join(a.configDir, 'projects') + path.sep)) return a;
      return def();
    },
    accountsView() {
      const lim = limits(), now = Date.now();
      return list().map((a, i) => ({ id: a.id, name: a.name, configDir: a.configDir, home: a.home, builtin: a.builtin, rank: i + 1, ...accountProfile(a, { claudeJson: b.cfg.claudeJson }), limit: activeLimit(lim, a.id, now), sessions: [...b.sessions.values()].filter((s) => s.kind === 'claude' && (s.rt?.claudeAccount || DEFAULT_ACCOUNT) === a.id).length }));
    },
    // ---------- 우선순위와 한도(account-failover.mjs가 쓴다) ----------
    accountUsable: usable,
    accountFailoverOn: failoverOn,
    accountLimit(id, now = Date.now()) { return activeLimit(limits(), id, now); },
    // 한도 다음에 쓸 계정(빼는 계정 말고, 차례대로). 없으면 null
    nextAccount(exclude = []) { return pickAccount(list(), { limits: limits(), exclude, usable }); },
    markAccountLimited(id, { until, type = null, text = null } = {}) {
      const all = { ...limits() };
      for (const [k, v] of Object.entries(all)) if (!v || !(v.until > Date.now())) delete all[k]; // 지난 것은 치운다
      all[id] = { until, at: Date.now(), type: type ? String(type).slice(0, 40) : null, text: text ? String(text).slice(0, 200) : null };
      b.store.setMeta(LIMITS_KEY, all);
      b.api?.broadcast('accounts.changed', { why: 'limit', id });
      return all[id];
    },
    clearAccountLimit(id) {
      const all = { ...limits() };
      if (!(id in all)) return false;
      delete all[id];
      b.store.setMeta(LIMITS_KEY, all);
      b.api?.broadcast('accounts.changed', { why: 'limit_cleared', id });
      return true;
    },
    // 우선순위 바꾸기: 계정 ID 목록(빠진 계정은 원래 차례로 뒤에)
    setAccountOrder({ ids }) {
      if (!Array.isArray(ids) || ids.length > MAX_ACCOUNTS + 1) throw bad('계정 차례가 올바르지 않습니다.', 'order');
      const known = new Set(accountList(stored(), { home: home() }).map((a) => a.id));
      const next = [...new Set(ids.map(String))].filter((id) => known.has(id));
      b.store.setMeta(ORDER_KEY, next);
      b.api?.broadcast('accounts.changed', { why: 'order' });
      return b.accountsView();
    },
    addAccount(input) {
      const row = normalizeAccount(input, { existing: stored(), home: home() });
      fs.mkdirSync(row.configDir, { recursive: true, mode: 0o700 });
      shareUserSetup(row.configDir, { home: home() }); // 전역 지시·스킬을 같이 쓴다
      b.store.setMeta(ACCOUNTS_KEY, [...stored(), row]);
      b.log(`claude account added ${row.id} (${row.configDir})`);
      b.api?.broadcast('accounts.changed', { why: 'add', id: row.id });
      return b.accountsView().find((a) => a.id === row.id);
    },
    renameAccount({ id, name }) {
      const rows = stored();
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw bad(`계정을 찾을 수 없습니다: ${id}`, 'missing', { id });
      const n = String(name ?? '').trim();
      if (!n || n.length > NAME_MAX || CTRL_RE.test(n)) throw bad(`계정 이름은 1~${NAME_MAX}자 한 줄입니다.`, 'name', { max: NAME_MAX });
      if (list().some((a) => a.id !== id && a.name.toLowerCase() === n.toLowerCase())) throw bad(`이미 있는 계정 이름입니다: ${n}`, 'nameTaken', { name: n });
      rows[i] = { ...rows[i], name: n };
      b.store.setMeta(ACCOUNTS_KEY, rows);
      b.api?.broadcast('accounts.changed', { why: 'rename', id });
      return b.accountsView().find((a) => a.id === id);
    },
    // 목록에서만 뺀다(설정 폴더와 로그인은 그대로 둔다. 판은 사람의 파일을 지우지 않는다). 그 계정으로 도는 세션이 있으면 거부한다
    removeAccount({ id }) {
      if (id === DEFAULT_ACCOUNT) throw bad('기본 계정은 뺄 수 없습니다.', 'builtin');
      const rows = stored();
      if (!rows.some((r) => r.id === id)) throw bad(`계정을 찾을 수 없습니다: ${id}`, 'missing', { id });
      const busy = [...b.sessions.values()].filter((s) => s.kind === 'claude' && s.rt?.claudeAccount === id).map((s) => s.name);
      if (busy.length) throw Object.assign(new Error(`이 계정으로 띄운 세션이 있습니다: ${busy.slice(0, 5).join(', ')}`), { code: 'account_busy', key: 'accounts.err.busy', vars: { names: busy.slice(0, 5).join(', ') } });
      b.store.setMeta(ACCOUNTS_KEY, rows.filter((r) => r.id !== id));
      b.store.setMeta(ORDER_KEY, order().filter((x) => x !== id));
      b.clearAccountLimit(id);
      b.api?.broadcast('accounts.changed', { why: 'remove', id });
      return { removed: true, id };
    },
  });
  return b;
}
