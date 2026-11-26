// P227 시험: 잠들었다 깨는(되살리기·다시 열기) 세션은 사람이 세션 안에서 바꾼 모델·노력 수준으로 이어 간다.
// - resumeModel: 모델만 바뀜, 노력 수준만 바뀜, 둘 다, 모름 → 띄운 값. 같은 모델의 다른 이름은 띄운 값(별명·[1m])
// - 깨우기(wakeArgs)·되살리기(recoverSession)·다시 열기(user-close)의 인자, 판이 다시 뜬 뒤(판 DB의 runtime.modelNow)
// - Codex(-m, -c model_reasoning_effort)·pi(--model)의 이어 가기
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resumeModel, cliModelName } from '../src/model-now.mjs';
import { wakeArgs } from '../src/sleep.mjs';
import { transcriptPathFor } from '../src/launch.mjs';
import { harnessLaunch } from '../src/harness.mjs';
import { Backend } from '../src/backend.mjs';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p227-'));
const J = (o) => JSON.stringify(o);
const asst = (model) => J({ type: 'assistant', message: { model, content: [{ type: 'text', text: 'ok' }] } });
const cmdOut = (text) => J({ type: 'user', message: { content: '<local-command-stdout>' + text + '</local-command-stdout>' } });
const SET_MODEL = (name) => cmdOut('Set model to ' + '\u0060' + name + '\u0060' + ' and saved as your default for new sessions');
const SET_EFFORT = (e) => cmdOut('Set effort level to ' + e + ' (saved as your default for new sessions): x');
const ID = '00000000-0000-4000-8000-000000000227';
const LAUNCH = { sessionId: ID, settingsPath: 'C:/d/s.json', permissionMode: 'manual', model: 'opus', effort: 'xhigh' };
const flag = (args, f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };

test('P227 명령줄 이름: ID·별명·프록시 이름은 그대로, Claude 표시 이름은 ID로, 그 밖 표시 이름은 모름', () => {
  assert.equal(cliModelName('claude-fable-5-2'), 'claude-fable-5-2');
  assert.equal(cliModelName('Fable 5.2'), 'claude-fable-5-2');
  assert.equal(cliModelName('Haiku 5.5'), 'claude-haiku-5-5');
  assert.equal(cliModelName('Opus 5.5 (1M context)'), 'claude-opus-5-5[1m]');
  assert.equal(cliModelName('ocx-claude-native--gpt-6-luna[1m]'), 'ocx-claude-native--gpt-6-luna[1m]');
  assert.equal(cliModelName('GPT 6.1 Terra (native)'), null);
  assert.equal(cliModelName(''), null);
});

test('P227 이어 갈 값: 모델만, 노력 수준만, 둘 다, 모름', () => {
  const L = { model: 'opus', effort: 'xhigh' };
  // 모름 → 띄운 값
  assert.deepEqual(resumeModel('claude', L, null), { model: 'opus', effort: 'xhigh', from: { model: 'launched', effort: 'launched' } });
  // 같은 모델(다른 이름) → 띄운 값(별명을 지킨다)
  assert.deepEqual(resumeModel('claude', L, { model: 'claude-opus-5-5', effort: null }).model, 'opus');
  assert.equal(resumeModel('claude', { model: 'claude-opus-5-5[1m]' }, { model: 'claude-opus-5-5' }).model, 'claude-opus-5-5[1m]');
  // 모델만 바뀜(노력 수준은 대화 기록에 없음) → 노력 수준을 넘기지 않는다
  assert.deepEqual(resumeModel('claude', L, { model: 'Fable 5.2', effort: null }), { model: 'claude-fable-5-2', effort: null, from: { model: 'now', effort: 'none' } });
  // 노력 수준만 바뀜
  assert.deepEqual(resumeModel('claude', L, { model: 'claude-opus-5-5', effort: 'high' }), { model: 'opus', effort: 'high', from: { model: 'launched', effort: 'now' } });
  assert.deepEqual(resumeModel('claude', L, { model: null, effort: 'low' }), { model: 'opus', effort: 'low', from: { model: 'launched', effort: 'now' } });
  // 둘 다
  assert.deepEqual(resumeModel('claude', L, { model: 'claude-fable-5-2', effort: 'high' }), { model: 'claude-fable-5-2', effort: 'high', from: { model: 'now', effort: 'now' } });
  // 명령줄 이름으로 바꿀 수 없는 표시 이름 → 띄운 값
  assert.equal(resumeModel('claude', L, { model: 'GPT 6.1 Terra (native)' }).model, 'opus');
  // 띄운 값이 없으면(사용자 기본) 지금 값
  assert.deepEqual(resumeModel('claude', {}, { model: 'claude-haiku-5-5', effort: null }), { model: 'claude-haiku-5-5', effort: null, from: { model: 'now', effort: 'none' } });
  // Codex·pi
  assert.deepEqual(resumeModel('codex', { model: 'gpt-a' }, { model: 'gpt-b', effort: 'high' }), { model: 'gpt-b', effort: 'high', from: { model: 'now', effort: 'now' } });
  assert.deepEqual(resumeModel('pi', { model: 'm1' }, { model: 'p/m2', effort: 'high' }), { model: 'p/m2', effort: null, from: { model: 'now', effort: 'none' } });
  assert.equal(resumeModel('pi', { model: 'm1' }, { model: 'p/m1' }).model, 'm1', '제공자만 붙은 같은 모델');
});

test('P227 깨우기 인자: 이어 갈 때는 지금 값, 대화 기록이 없어 새로 띄울 때는 띄운 값', () => {
  const conv = { exists: true, convId: ID };
  let w = wakeArgs(LAUNCH, conv, { model: 'Fable 5.2', effort: null });
  assert.equal(w.plan, 'resume');
  assert.equal(flag(w.args, '--model'), 'claude-fable-5-2');
  assert.equal(flag(w.args, '--effort'), null, '모델이 바뀌고 노력 수준을 모르면 넘기지 않는다');
  assert.equal(w.model.from.model, 'now');
  w = wakeArgs(LAUNCH, conv, { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual([flag(w.args, '--model'), flag(w.args, '--effort')], ['opus', 'high']);
  w = wakeArgs(LAUNCH, conv, null);
  assert.deepEqual([flag(w.args, '--model'), flag(w.args, '--effort')], ['opus', 'xhigh']);
  w = wakeArgs(LAUNCH, { exists: false, convId: ID }, { model: 'claude-fable-5-2', effort: 'high' });
  assert.equal(w.plan, 'fresh');
  assert.deepEqual([flag(w.args, '--model'), flag(w.args, '--effort')], ['opus', 'xhigh'], '새로 띄울 때는 띄운 값');
});

// 진짜 판(Backend)과 판 DB, 가짜 터미널
function board() {
  const dir = tmp(), cwd = tmp(), projects = tmp();
  const b = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2 });
  b.cfg.claudeProjects = projects;
  b.store = new Store(path.join(dir, 'board.db'));
  b.sessions = new Map();
  const starts = [];
  b.adapter = {
    connected: true,
    waitShellReady: async () => true,
    startAgent: async (o) => { starts.push(o); return { agent: { launchPending: true }, argv: ['claude', ...(o.args || [])] }; },
    createWorkspace: async () => ({ paneId: 'w9:p1', workspaceId: 'w9' }),
    refreshSubscription: async () => {},
    getPane: async () => null,
  };
  b.broadcastSession = () => {};
  const rt = newRuntime({ kind: 'claude', hooked: true });
  const s = { sessionId: ID, name: 'z1', cwd, paneId: null, termWorkspaceId: null, agentName: 'z1', model: 'opus', effort: 'xhigh', permissionMode: 'manual', settingsPath: 'C:/d/s.json', hookToken: 't', resumeArgv: null, resumeVerified: false, createdAt: Date.now(), closedAt: null, seenAt: null, touchedAt: null, rt, lastState: null, kind: 'claude', origin: 'board', parentSessionId: null, workspaceKey: 'k', flavor: null, extraArgs: [], startCommand: '' };
  b.store.insertSession({ ...s, runtime: rt });
  b.sessions.set(ID, s);
  const tx = transcriptPathFor(projects, cwd, ID);
  fs.mkdirSync(path.dirname(tx), { recursive: true });
  return { b, s, tx, starts, dir };
}

test('P227 잠든 세션: 패널이 없어도 대화 기록에서 지금 값을 읽고 판 DB에 남긴다. 되살리기도 지금 값으로 이어 간다', async () => {
  const { b, s, tx, starts } = board();
  fs.writeFileSync(tx, [asst('claude-opus-5-5'), SET_MODEL('Fable 5.2'), asst('claude-fable-5-2'), SET_EFFORT('high'), ''].join('\n'));
  const launch = b.resumeLaunchOf(s);
  assert.deepEqual([launch.model, launch.effort], ['claude-fable-5-2', 'high']);
  assert.deepEqual(b.launchOf(s).model, 'opus', '처음 띄울 값은 그대로');
  assert.deepEqual(b.store.getSession(ID).runtime.modelNow && [b.store.getSession(ID).runtime.modelNow.model, b.store.getSession(ID).runtime.modelNow.effort], ['claude-fable-5-2', 'high'], '판 DB에 남는다');
  // 되살리기(패널을 다시 만들고 이어 가기)
  await b.recoverSession(s, 'recreate_resume');
  const a = starts.at(-1).args;
  assert.equal(a[0], '--resume');
  assert.deepEqual([flag(a, '--model'), flag(a, '--effort')], ['claude-fable-5-2', 'high']);
  // 대화 기록이 없어 새로 띄우는 되살리기는 띄운 값
  await b.recoverSession(s, 'recreate_fresh');
  assert.deepEqual([flag(starts.at(-1).args, '--model'), flag(starts.at(-1).args, '--effort')], ['opus', 'xhigh']);
  b.store.close();
});

test('P227 판이 다시 뜬 뒤: 대화 기록에서 값을 읽지 못하면 판 DB의 지금 값으로 깨운다', async () => {
  const { b, s, tx, dir } = board();
  fs.writeFileSync(tx, [asst('claude-opus-5-5'), SET_MODEL('Haiku 5.5'), ''].join('\n'));
  b.modelNowFor(s);
  b.store.close();
  // 판을 다시 띄운다: 판 DB의 행에서 세션을 만든다(rt는 DB의 runtime)
  const b2 = new Backend({ quietMs: 600000, port: 0, logDir: dir, sessionsDir: path.join(dir, 'sessions'), claudeJson: path.join(dir, 'none.json'), claudeCommand: 'claude', hookTimeoutSec: 2 });
  b2.cfg.claudeProjects = b.cfg.claudeProjects;
  b2.store = new Store(path.join(dir, 'board.db'));
  b2.sessions = new Map();
  const row = b2.store.getSession(ID);
  const s2 = { ...s, rt: row.runtime, model: row.model, effort: row.effort };
  b2.sessions.set(ID, s2);
  assert.equal(s2.rt.modelNow.model, 'Haiku 5.5');
  // 대화 기록이 모델 줄 없이 다시 쓰였다(읽어도 값이 없음) → DB 값
  fs.writeFileSync(tx, J({ type: 'user', message: { content: 'hi' } }) + '\n');
  const w = wakeArgs(b2.launchOf(s2), { exists: true, convId: ID }, b2.modelNowFor(s2));
  assert.deepEqual([flag(w.args, '--model'), flag(w.args, '--effort')], ['claude-haiku-5-5', null]);
  b2.store.close();
});

test('P227 Codex·pi 이어 가기: 지금 모델(Codex는 노력 수준도), 처음 띄울 때는 띄운 값', () => {
  const { b } = board();
  const home = tmp(); const cid = '01a1d2a6-c7a4-7f42-86ab-a32e2e857a48';
  const day = path.join(home, 'sessions', '2026', '11', '19'); fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, 'rollout-2026-11-19T00-00-00-' + cid + '.jsonl'), J({ type: 'turn_context', payload: { model: 'gpt-b', effort: 'high' } }) + '\n');
  b.cfg.codexConvoHome = home;
  const cx = { sessionId: 'C1', name: 'cx', cwd: home, kind: 'codex', origin: 'board', rt: newRuntime({ kind: 'codex', hooked: false }), harnessPlan: { model: 'gpt-a', args: ['-c', 'model_reasoning_effort=low'], harnessSessionId: cid } };
  b.sessions.set('C1', cx);
  let hl = b.harnessLaunchOf(cx, { resume: true });
  assert.equal(hl.args[0], 'resume');
  assert.equal(flag(hl.args, '-m'), 'gpt-b');
  assert.equal(hl.args.at(-1), 'model_reasoning_effort=high', '호출자 인자 뒤(뒤의 -c가 이긴다)');
  hl = b.harnessLaunchOf(cx, { resume: false });
  assert.equal(flag(hl.args, '-m'), 'gpt-a');
  assert.ok(!hl.args.includes('model_reasoning_effort=high'));
  // pi 세션 파일의 모델 읽기(원본 P201)는 macOS 판에 없어 pi 부분은 뺐다
  b.store.close();
});

test('P227 pi 연결: 이어 갈 지금 값(제공자/모델)에 제공자를 두 번 붙이지 않는다', () => {
  const conn = { id: 'c1', name: 'Gw', protocol: 'openai-chat', baseUrl: 'http://127.0.0.1:1/v1', auth: null };
  const a = harnessLaunch({ kind: 'pi', sessionId: 'P', resume: true, model: 'm1', connection: conn, filesDir: tmp() });
  const m = flag(a.args, '--model');
  const b2 = harnessLaunch({ kind: 'pi', sessionId: 'P', resume: true, model: m, connection: conn, filesDir: tmp() });
  assert.equal(flag(b2.args, '--model'), m);
});
