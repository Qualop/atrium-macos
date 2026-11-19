import { spawn } from 'node:child_process';
// P72: Codex가 아는 모델 목록. Codex CLI는 쓸 수 있는 모델 목록(서버에서 받은 카탈로그)을 `$CODEX_HOME/models_cache.json`(기본 ~/.codex)에 둔다.
// 모양: { fetched_at, client_version, models: [{ slug, display_name, visibility: 'list' | 'hide', priority, ... }] }. `codex -m <slug>`의 이름이 slug다.
// Codex의 모델 고르기는 visibility가 list인 것만 priority 순서로 보인다. hide인 것도 -m으로는 쓸 수 있으므로 "아는 이름"에는 넣는다.
// (같은 목록은 `codex debug models`가 JSON으로 보이고, `--bundled`는 실행 파일에 든 목록이다. 판은 프로세스를 띄우지 않고 캐시 파일만 읽는다.)
// 파일은 크다(모델마다 지시문이 든다). 몇 초마다 한 번만 파일의 크기·시각을 보고, 바뀌었을 때만 다시 읽는다. 읽지 못하면 하네스의 고정 목록을 쓴다.
// P96: Codex 설정(config.toml)의 model_catalog_json이 가리키는 카탈로그(사용자가 쓰는 게이트웨이 도구가 넣는다. 모양은 캐시와 같다)가 있으면 그 목록도 읽어 앞에 둔다.
// Codex는 이 설정이 있으면 카탈로그를 모델 목록으로 쓴다. config.toml은 맨 위(첫 [표] 전)의 model_catalog_json 한 줄만 찾고 다른 값은 쓰지 않는다.
// 이 파일들은 읽기만 한다. 같은 폴더의 인증 파일은 열지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import { findExecutable, nodeCliInvocation } from './platform.mjs';

export function normalizeModels(rows) {
  const seen = new Set();
  return rows.filter((x) => x && !x.hidden && typeof x.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,199}$/.test(x.model) && !seen.has(x.model) && seen.add(x.model))
    .map((x) => ({ id: x.model, name: typeof x.displayName === 'string' && x.displayName ? x.displayName : x.model, isDefault: !!x.isDefault }));
}

// 목록만 요청한다. thread/start·turn/start나 사용자 인증 정보 직접 읽기는 하지 않는다.
export function listCodexModels({ executable = findExecutable('codex'), spawnImpl = spawn, timeoutMs = 12000, platform = process.platform } = {}) {
  if (!executable) return Promise.reject(Object.assign(new Error('Codex CLI not found'), { code: 'codex_not_installed' }));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(Object.assign(new Error('Invalid model list timeout'), { code: 'bad_request' }));
  return new Promise((resolve, reject) => {
    let child;
    try {
      const { command, args } = nodeCliInvocation(executable, ['app-server', '--listen', 'stdio://'], '@openai/codex', { platform });
      child = spawnImpl(command, args, { cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    }
    catch { reject(Object.assign(new Error('model_list_failed'), { code: 'model_list_failed' })); return; }
    let done = false, initialized = false, buf = '', rows = [], requestId = 2, pageCount = 0;
    const cursors = new Set();
    const finish = (error) => {
      if (done) return; done = true; clearTimeout(timer);
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000); force.unref();
        child.once('exit', () => clearTimeout(force));
      }
      if (error) reject(error); else resolve({ models: normalizeModels(rows), source: 'codex', fetchedAt: Date.now() });
    };
    const fail = (code) => finish(Object.assign(new Error(code), { code }));
    const send = (message) => { if (!done) { try { child.stdin.write(JSON.stringify(message) + '\n'); } catch { fail('model_list_failed'); } } };
    const timer = setTimeout(() => fail('model_list_timeout'), timeoutMs);
    child.on('error', () => fail('model_list_failed'));
    child.stdin.on('error', () => fail('model_list_failed'));
    child.stderr.on('data', () => {}); // CLI 진단에는 개인 경로 등이 포함될 수 있어 UI로 전달하지 않는다.
    child.stdout.setEncoding('utf8');
    child.stdout.on('error', () => fail('model_list_failed'));
    child.stderr.on('error', () => fail('model_list_failed'));
    // exit can precede the final stdout data; close follows stream drainage.
    child.on('close', () => { if (!done) fail('model_list_failed'); });
    child.stdout.on('data', (chunk) => {
      if (done) return;
      buf += chunk;
      if (buf.length > 4 * 1024 * 1024) return fail('model_list_failed');
      let end;
      while (!done && (end = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, end); buf = buf.slice(end + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (!m || typeof m !== 'object') continue;
        if (m.id === 1 && !initialized) {
          if (m.error) return fail('model_list_failed');
          initialized = true;
          send({ method: 'initialized', params: {} });
          send({ id: requestId, method: 'model/list', params: { limit: 100, includeHidden: false } });
        } else if (initialized && m.id === requestId) {
          if (m.error || !Array.isArray(m.result?.data) || rows.length + m.result.data.length > 10000) return fail('model_list_failed');
          rows.push(...m.result.data);
          const cursor = m.result.nextCursor;
          if (!cursor) return finish();
          if (typeof cursor !== 'string' || cursors.has(cursor) || ++pageCount >= 10) return fail('model_list_failed');
          cursors.add(cursor); requestId++;
          send({ id: requestId, method: 'model/list', params: { limit: 100, cursor, includeHidden: false } });
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'atrium_model_picker', title: 'Atrium', version: '0.1.0' }, capabilities: { experimentalApi: true, explicitGatewayOauth: true } } });
  });
}

// Optional synchronous cache compatibility; native model/list RPC above remains authoritative.
export * from './codex-cache.mjs';
