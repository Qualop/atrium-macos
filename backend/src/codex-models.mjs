import { spawn } from 'node:child_process';
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
