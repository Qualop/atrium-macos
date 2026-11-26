// macOS 판 실제 시험: 맡기고 턴을 끝내면 판이 done 보고를 넣어 준다(P180·P181), 일하는 동안 잠들기 막기(keep-awake), 토큰 계기(usage-meter).
// 새 /tmp 폴더·포트·hc 세션의 판에 haiku 리드 하나를 띄워 워커 하나에게 작은 일을 맡기게 한다. 리드와 워커는 실제 Claude Code(사용자 로그인)다.
// 신뢰 질문: 이 시험이 만든 폴더라 판이 키(아래·Enter)로 답한다(CLAUDE.md: 지휘 세션이 실험용으로 만든 폴더). 실제 판·사용자 세션은 건드리지 않는다.
// 실행: node app/test/e2e/mac-push.mjs
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { ApiClient } from '../../../backend/src/client.mjs';
import { assertTestBoard } from './p9-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = fs.mkdtempSync('/tmp/atrium-push-');
const session = `atrium-dev-push-${process.pid}`;
const server = net.createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port; await new Promise((r) => server.close(r));
const project = path.join(dir, 'project'); fs.mkdirSync(project, { recursive: true });
for (const n of ['sessions', 'xdg']) fs.mkdirSync(path.join(dir, n));
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ATRIUM_|MTASK_|HERDR_|HC_|CLAUDECODE|CLAUDE_CODE_|ELECTRON_RUN_AS_NODE)/.test(k))),
  ATRIUM_TERMINAL_SESSION: session, ATRIUM_HERDR_SESSION: session, ATRIUM_PORT: String(port), ATRIUM_PROFILE: 'dev',
  ATRIUM_DATA_DIR: path.join(dir, 'data'), ATRIUM_APP_USERDATA: path.join(dir, 'app'), ATRIUM_CLAUDE_SESSIONS: path.join(dir, 'sessions'), ATRIUM_CLAUDE_DESKTOP: 'none',
};
assertTestBoard(env, { root: dir });
const cli = (...a) => spawnSync(process.execPath, [path.join(root, 'backend/bin/atrium.mjs'), '--dev', ...a], { env, encoding: 'utf8', timeout: 120000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 60000, step = 1000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error(`Timed out: ${label}`); await sleep(step); } }
const pass = (m) => console.log(`PASS ${m}`);
console.log(JSON.stringify({ dir, session, port }));
let client;
try {
  const st = cli('backend', 'start'); if (st.status !== 0) throw new Error(`backend start: ${st.stderr || st.stdout}`);
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'data/backend.json'), 'utf8'));
  client = new ApiClient(info); await client.open();
  await until(async () => { const s = await client.call('backend.status'); return (s.terminal || s.herdr || {}).connected; }, 'terminal engine', 60000);
  for (const [key, value] of [['childModelClaude', 'haiku'], ['childEffort', 'low'], ['agentAutoApprove', true]]) await client.call('settings.set', { key, value }).catch((e) => console.log(`setting ${key}: ${e.message}`));
  await client.call('workspace.open', { path: project });
  const lead = await client.call('session.spawn', { kind: 'claude', name: 'lead', cwd: project, model: 'haiku', effort: 'low' });
  const get = (id) => client.call('session.get', { session: id, lines: 40 });
  // 신뢰 질문(이 시험이 만든 폴더): Yes를 고른다
  const trustOnce = async (id) => { const s = await get(id); if (/trust/i.test(s.screenTail || '') && /Yes/.test(s.screenTail || '')) { await client.call('session.keys', { session: id, keys: /❯\s*1\.\s*Yes/.test(s.screenTail) ? ['enter'] : ['up', 'enter'] }); return true; } return false; };
  await until(async () => { await trustOnce(lead.sessionId); const s = await get(lead.sessionId); return s.state === 'ready' ? s : null; }, 'lead ready', 90000, 1500);
  pass('lead Claude Code is ready');
  const ask = 'Run exactly this one shell command, then end your turn without waiting: atrium child w1 --prompt "Create a file named hello.txt containing the word hi. Then close your task with: atrium done ok \\"made hello.txt\\"". When the board later brings you the report from w1, write the report text into a file named report.txt and stop. Do not poll or wait.';
  await client.call('session.send', { target: 'lead', text: ask });
  let sawAwake = false;
  const child = await until(async () => {
    const ka = await client.call('backend.keepAwake').catch(() => null); if (ka && ka.active) sawAwake = true;
    const list = await client.call('session.list'); const w = list.find((s) => s.name === 'w1');
    if (w) await trustOnce(w.sessionId);
    return w || null;
  }, 'worker w1 spawned', 180000, 1500);
  pass('lead spawned w1 through atrium child');
  await until(async () => { const ka = await client.call('backend.keepAwake').catch(() => null); if (ka && ka.active) sawAwake = true; await trustOnce(child.sessionId).catch(() => {}); return fs.existsSync(path.join(project, 'report.txt')) || fs.existsSync(path.join(project, '.claude', 'worktrees')) && false; }, 'report.txt written by lead after the pushed done report', 360000, 2000);
  const report = fs.readFileSync(path.join(project, 'report.txt'), 'utf8');
  assert.match(report, /hello/i);
  pass(`lead received the pushed report: ${report.trim().slice(0, 80)}`);
  assert.ok(sawAwake, 'keep-awake held caffeinate while sessions worked');
  pass('keep-awake was active while sessions worked');
  // 리드가 atrium wait를 되풀이하지 않았는지(폴링 없음)
  const evs = await client.call('session.events', { session: lead.sessionId, limit: 400 }).catch(() => null);
  if (evs) { const waits = (evs.events || evs).filter((e) => /wait/.test(e.type || '')).length; console.log(`INFO lead wait events: ${waits}`); }
  const sum = await until(async () => { const s = await client.call('session.get', { session: lead.sessionId }); return s.treeUsage && s.treeUsage.sessions >= 2 ? s : null; }, 'tree usage on the lead', 30000, 2000);
  pass(`token meter: lead own ${sum.usage && sum.usage.weighted}, tree ${sum.treeUsage.weighted} over ${sum.treeUsage.sessions} sessions`);
} finally {
  try { if (client) { for (const s of await client.call('session.list').catch(() => [])) await client.call('session.kill', { session: s.sessionId, confirm: true, force: true }).catch(() => {}); } } catch {}
  try { cli('backend', 'stop'); } catch {}
  try { if (client) client.close(); } catch {}
  try {
    const out = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
    for (const line of out.split('\n')) if (line.includes(session) || line.includes(dir)) { const pid = Number(line.trim().split(/\s+/)[0]); if (pid && pid !== process.pid) try { process.kill(pid); } catch {} }
  } catch {}
}
