// P72: Codex가 아는 모델 목록. Codex CLI는 쓸 수 있는 모델 목록(서버에서 받은 카탈로그)을 `$CODEX_HOME/models_cache.json`(기본 ~/.codex)에 둔다.
// 모양: { fetched_at, client_version, models: [{ slug, display_name, visibility: 'list' | 'hide', priority, ... }] }. `codex -m <slug>`의 이름이 slug다.
// Codex의 모델 고르기는 visibility가 list인 것만 priority 순서로 보인다. hide인 것도 -m으로는 쓸 수 있으므로 "아는 이름"에는 넣는다.
// (같은 목록은 `codex debug models`가 JSON으로 보이고, `--bundled`는 실행 파일에 든 목록이다. 판은 프로세스를 띄우지 않고 캐시 파일만 읽는다.)
// 파일은 크다(모델마다 지시문이 든다). 몇 초마다 한 번만 파일의 크기·시각을 보고, 바뀌었을 때만 다시 읽는다. 읽지 못하면 하네스의 고정 목록을 쓴다.
// P96: Codex 설정(config.toml)의 model_catalog_json이 가리키는 카탈로그(opencodex가 넣는다. 모양은 캐시와 같다)가 있으면 그 목록도 읽어 앞에 둔다.
// Codex는 이 설정이 있으면 카탈로그를 모델 목록으로 쓴다. config.toml은 맨 위(첫 [표] 전)의 model_catalog_json 한 줄만 찾고 다른 값은 쓰지 않는다.
// 이 파일들은 읽기만 한다. 같은 폴더의 인증 파일은 열지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isModelName } from './model-name.mjs';

export const CACHE_FILE = 'models_cache.json';
export const CONFIG_FILE = 'config.toml';
export const CHECK_MS = 5000;

export const codexHomeOf = (env = process.env) => (env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(os.homedir(), '.codex'));

// 캐시(카탈로그) 파일 글 → { ok, models: [보일 slug, priority 순서], hidden: [hide인 slug], labels: { slug: display_name } } | { ok: false, why }
export function parseCodexCache(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, why: 'bad_json' }; }
  if (!j || !Array.isArray(j.models)) return { ok: false, why: 'no_models' };
  const rows = j.models.filter((m) => m && isModelName(m.slug)); // 호출자·하위 세션이 받는 이름만(그 밖의 이름은 넘길 수 없다)
  if (!rows.length) return { ok: false, why: 'empty' };
  const shown = rows.filter((m) => m.visibility !== 'hide');
  const prio = (m) => (Number.isFinite(m.priority) ? m.priority : Infinity);
  const models = [...new Set(shown.map((m, i) => ({ m, i })).sort((a, b) => prio(a.m) - prio(b.m) || a.i - b.i).map((x) => x.m.slug))];
  const hidden = [...new Set(rows.filter((m) => m.visibility === 'hide').map((m) => m.slug))].filter((s) => !models.includes(s));
  // 보이는 이름은 slug와 대소문자만 다르면 두지 않는다(GPT-6.1-Sol ↔ gpt-6.1-sol)
  const labels = Object.fromEntries(shown.filter((m) => typeof m.display_name === 'string' && m.display_name && m.display_name.toLowerCase() !== m.slug.toLowerCase()).map((m) => [m.slug, m.display_name.slice(0, 80)]));
  return models.length ? { ok: true, models, hidden, labels } : { ok: false, why: 'empty' };
}

// P96: config.toml 글 → model_catalog_json 경로(없으면 null). 맨 위 키만 본다(첫 [표] 전). 큰따옴표 글(\\ 같은 이스케이프)과 작은따옴표 글을 받는다.
// 상대 경로는 Codex 폴더 기준, ~는 홈
const TOML_ESC = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
export function catalogPathOf(text, home, homedir = os.homedir()) {
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) break;
    const m = /^model_catalog_json\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (!m) continue;
    let p = m[1] != null ? m[1].replace(/\\(.)/g, (_, c) => TOML_ESC[c] || c) : m[2];
    if (!p) return null;
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = /^[A-Za-z]:[\\/]/.test(homedir) ? path.win32.join(homedir, p.slice(1)) : path.join(homedir, p.slice(1));
    return /^[A-Za-z]:[\\/]|^\\\\/.test(p) || /^[A-Za-z]:[\\/]|^\\\\/.test(home)
      ? path.win32.resolve(home, p).replace(/\\/g, '/') : path.resolve(home, p);
  }
  return null;
}
// 두 목록 합치기: 앞 목록(카탈로그)이 먼저, 뒤 목록에만 있는 이름은 그 뒤. 숨긴 이름은 보이는 이름에서 뺀다
export function mergeCodexLists(a, b) {
  const models = [...new Set([...a.models, ...b.models])];
  const hidden = [...new Set([...a.hidden, ...b.hidden])].filter((s) => !models.includes(s));
  return { ok: true, models, hidden, labels: { ...b.labels, ...a.labels } };
}

// 판이 쥐는 목록. models()는 늘 무언가를 돌려준다: 카탈로그·캐시 파일의 목록, 아니면 fallback(하네스의 고정 목록)
export class CodexModels {
  constructor({ home = codexHomeOf(), fallback = [], checkMs = CHECK_MS, now = () => Date.now(), fsImpl = fs } = {}) {
    this.home = home; this.file = path.join(home, CACHE_FILE); this.configFile = path.join(home, CONFIG_FILE);
    this.fallback = [...fallback]; this.checkMs = checkMs; this.now = now; this.fs = fsImpl;
    this.checkedAt = -Infinity; this.stamp = null; this.cur = null;
  }
  statOf(file) { try { const st = this.fs.statSync(file); return { st, stamp: `${st.size}:${st.mtimeMs}` }; } catch { return { st: null, stamp: '-' }; } }
  readList(file, st) {
    if (!st) return { ok: false, why: 'missing' };
    try { return parseCodexCache(this.fs.readFileSync(file, 'utf8')); } catch { return { ok: false, why: 'unreadable' }; }
  }
  read() {
    const t = this.now();
    if (t - this.checkedAt < this.checkMs && this.cur) return this.cur;
    this.checkedAt = t;
    // 설정 파일이 바뀌면 카탈로그 경로를 다시 찾는다
    const cfg = this.statOf(this.configFile);
    if (cfg.stamp !== this.cfgStamp) {
      this.cfgStamp = cfg.stamp;
      let text = ''; if (cfg.st) { try { text = this.fs.readFileSync(this.configFile, 'utf8'); } catch {} }
      this.catalogFile = catalogPathOf(text, this.home);
    }
    const cache = this.statOf(this.file);
    const cat = this.catalogFile ? this.statOf(this.catalogFile) : { st: null, stamp: '-' };
    const stamp = `${cache.st ? cache.stamp : 'none'}|${this.catalogFile || ''}:${cat.stamp}`;
    if (this.cur && stamp === this.stamp) return this.cur;
    this.stamp = stamp;
    const a = this.catalogFile ? this.readList(this.catalogFile, cat.st) : { ok: false, why: 'missing' };
    const b = this.readList(this.file, cache.st);
    const r = a.ok && b.ok ? mergeCodexLists(a, b) : a.ok ? a : b;
    this.cur = r.ok ? { source: 'codex', models: r.models, hidden: r.hidden, labels: r.labels, ...(a.ok ? { catalog: true } : {}) } : { source: 'default', why: r.why, models: [...this.fallback], hidden: [], labels: {} };
    return this.cur;
  }
  models() { return this.read().models; }
}

// 목록에 없는 이름인가(직접 입력 경고). 빈 이름(하네스 기본)과 목록·숨긴 이름은 아니다. 대소문자도 그대로 본다(Codex가 slug를 그대로 맞춘다)
export function unlistedModel(model, { models = [], hidden = [] } = {}) {
  const m = String(model || '').trim();
  return !!m && !models.includes(m) && !hidden.includes(m);
}
