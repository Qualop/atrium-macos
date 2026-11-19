// macOS 판: Claude 계정 자동 전환(account-failover.mjs)과 계정 우선순위·한도(claude-accounts.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { limitSignal, isLimitText, parseResetAt, limitUntil, copyConversation, AccountFailover, FALLBACK_MS, SHORT_FALLBACK_MS, continueNotice, movedNotice } from '../src/account-failover.mjs';
import { attachAccounts, orderAccounts, pickAccount, activeLimit, normalizeAccount } from '../src/claude-accounts.mjs';
import { transcriptPathFor } from '../src/launch.mjs';

// 2026-11-18 이 PC에서 실제로 본 한도 글(시험을 고치던 세션이 멈춘 답)
const REAL = "You've hit your 5-hour limit · resets 5:50am (Asia/Seoul)";

test('한도 신호: 실제 한도 글, StopFailure rate_limit·billing_error, 평범한 답과 다른 오류는 아니다', () => {
  assert.ok(isLimitText(REAL));
  assert.ok(isLimitText('Claude AI usage limit reached|1757980800'));
  assert.ok(isLimitText("You've hit your limit · resets 3pm"));
  assert.ok(!isLimitText('테스트 37개가 모두 통과했습니다. 429 대기도 확인했습니다.'));
  assert.deepEqual(limitSignal('StopFailure', { error: 'rate_limit', error_details: REAL }), { type: 'rate_limit', text: REAL });
  assert.equal(limitSignal('StopFailure', { error: 'billing_error' }).type, 'billing_error');
  assert.equal(limitSignal('StopFailure', { error: 'model_not_found', message: 'no such model' }), null);
  assert.equal(limitSignal('StopFailure', { error: 'server_error' }), null);
  assert.deepEqual(limitSignal('Stop', { last_assistant_message: REAL }), { type: 'rate_limit', text: REAL });
  assert.equal(limitSignal('Stop', { last_assistant_message: '끝났습니다.' }), null);
  assert.equal(limitSignal('Stop', { last_assistant_message: `한도 이야기를 길게 쓴 보통 답: usage limit ${'x'.repeat(500)}` }), null, '긴 보통 답은 한도 글로 보지 않는다');
  assert.equal(limitSignal('UserPromptSubmit', { prompt: REAL }), null);
});

test('풀리는 때: 시각만 있으면 다음에 오는 그 시각(이 PC 시간대), 날짜·epoch, 모르면 대신 값', () => {
  const now = new Date(2026, 10, 18, 3, 0, 0).getTime(); // 11월 18일 03:00
  assert.equal(parseResetAt(REAL, now), new Date(2026, 10, 18, 5, 50).getTime());
  assert.equal(parseResetAt('resets 3pm', now), new Date(2026, 10, 18, 15, 0).getTime());
  assert.equal(parseResetAt('resets 2am', now), new Date(2026, 10, 19, 2, 0).getTime(), '지난 시각이면 다음 날');
  assert.equal(parseResetAt('resets 12am', now), new Date(2026, 10, 19, 0, 0).getTime());
  assert.equal(parseResetAt('Weekly limit reached · resets Nov 20, 9am', now), new Date(2026, 10, 20, 9, 0).getTime());
  assert.equal(parseResetAt('resets Jan 2 at 9am', now), new Date(2027, 0, 2, 9, 0).getTime(), '지난 날짜면 내년');
  assert.equal(parseResetAt('Claude AI usage limit reached|1757980800', now), 1757980800000);
  assert.equal(parseResetAt('resets 25:99', now), null);
  assert.equal(parseResetAt('no time here', now), null);
  assert.equal(limitUntil({ type: 'rate_limit', text: REAL }, now), new Date(2026, 10, 18, 5, 50).getTime());
  assert.equal(limitUntil({ type: 'rate_limit', text: 'usage limit reached' }, now), now + FALLBACK_MS);
  assert.equal(limitUntil({ type: 'rate_limit', text: '' }, now), now + SHORT_FALLBACK_MS, '한도 글 없는 rate_limit은 짧게');
});

test('우선순위: 저장한 차례, 빠진 계정은 뒤에. 한도·쓸 수 없는 계정·뺄 계정은 건너뛴다', () => {
  const list = [{ id: 'default' }, { id: 'work' }, { id: 'home' }];
  assert.deepEqual(orderAccounts(list, ['home', 'default']).map((a) => a.id), ['home', 'default', 'work']);
  assert.deepEqual(orderAccounts(list, []).map((a) => a.id), ['default', 'work', 'home']);
  const now = 1000;
  const limits = { default: { until: 2000 }, work: { until: 500 } }; // work는 이미 풀림
  assert.equal(activeLimit(limits, 'default', now).until, 2000);
  assert.equal(activeLimit(limits, 'work', now), null);
  assert.equal(pickAccount(list, { limits, now }).id, 'work');
  assert.equal(pickAccount(list, { limits, now, exclude: ['work'] }).id, 'home');
  assert.equal(pickAccount(list, { limits, now, usable: (a) => a.id === 'default' }), null);
  assert.throws(() => normalizeAccount({ name: 'x', id: 'auto' }, { home: '/h' }), (e) => e.key === 'accounts.err.id', 'auto는 계정 ID가 될 수 없다');
});

// 가짜 판: meta 저장, 세션, 잠재우기·깨우기, 전달 대기열
function fixture(t, { loggedIn = ['default', 'work'], failover = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-acct-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const meta = new Map();
  const events = [], queued = [], broadcasts = [], calls = [];
  const claudeJson = path.join(home, '.claude.json');
  const workDir = path.join(home, '.claude-work');
  fs.mkdirSync(workDir, { recursive: true });
  const login = (file, email) => fs.writeFileSync(file, JSON.stringify({ oauthAccount: { emailAddress: email } }));
  if (loggedIn.includes('default')) login(claudeJson, 'a@example.com');
  if (loggedIn.includes('work')) login(path.join(workDir, '.claude.json'), 'b@example.com');
  const cwd = path.join(home, 'proj'); fs.mkdirSync(cwd);
  const settings = { claudeAccountFailover: failover };
  const b = {
    cfg: { claudeJson, claudeProjects: path.join(home, '.claude', 'projects'), convoRoots: [] },
    store: { getMeta: (k) => meta.get(k), setMeta: (k, v) => meta.set(k, v), addEvent: (id, kind, data) => events.push([kind, data]), updateSession: () => {} },
    api: { broadcast: (e, d) => broadcasts.push([e, d]) },
    features: { settings: { get: () => settings } },
    sessions: new Map(),
    log: () => {},
    hooked: (s) => s.kind === 'claude',
    broadcastSession: () => {},
    queue: { enqueue: (id, text) => { queued.push([id, text]); return { deliveryId: 'd1', status: 'queued' }; } },
    sleeper: {
      sleep: async (s, o) => { calls.push(['sleep', o, s.rt.claudeAccount, s.rt.claudeConfigDir || null]); if (b.sleepError) { const e = b.sleepError; b.sleepError = null; throw e; } s.rt.sleep = { at: 1 }; },
      wake: async (s, why) => { calls.push(['wake', why, s.rt.claudeAccount, s.rt.claudeConfigDir || null]); s.rt.sleep = null; return { plan: 'resume', state: 'ready' }; },
    },
  };
  const os0 = os.homedir; os.homedir = () => home; t.after(() => { os.homedir = os0; });
  attachAccounts(b);
  b.addAccount({ name: 'work', configDir: workDir });
  const s = { sessionId: 'S1', name: 'lead', kind: 'claude', cwd, rt: { claudeAccount: 'default' } };
  b.sessions.set('S1', s);
  // 기본 계정의 대화 기록과 하위 에이전트 폴더
  const tx = transcriptPathFor(b.cfg.claudeProjects, cwd, 'S1');
  fs.mkdirSync(path.join(path.dirname(tx), 'S1', 'subagents'), { recursive: true });
  fs.writeFileSync(tx, '{"type":"user"}\n');
  fs.writeFileSync(path.join(path.dirname(tx), 'S1', 'subagents', 'a.jsonl'), '{}\n');
  return { b, s, home, workDir, tx, events, queued, broadcasts, calls, settings, meta };
}

test('계정을 고르지 않은 새 세션: 우선순위의 첫 계정, 한도에 걸린 계정·로그인 안 한 계정은 건너뜀, 고른 계정은 그대로', (t) => {
  const f = fixture(t);
  assert.equal(f.b.accountFor({}).id, 'default');
  f.b.setAccountOrder({ ids: ['work', 'default'] });
  assert.equal(f.b.accountFor({}).id, 'work');
  assert.equal(f.b.accountFor({ account: 'auto' }).id, 'work');
  f.b.markAccountLimited('work', { until: Date.now() + 60000 });
  assert.equal(f.b.accountFor({}).id, 'default', '한도에 걸린 계정은 건너뛴다');
  assert.equal(f.b.accountFor({ account: 'work' }).id, 'work', '사람이 고른 계정은 그대로');
  assert.equal(f.b.accountFor({}, { account: 'default' }).id, 'default', '런처가 고른 기본 계정');
  // 하위 세션은 부모 계정을 물려받되 그 계정이 한도면 다음 계정
  const parent = { kind: 'claude', rt: { claudeAccount: 'work' } };
  assert.equal(f.b.accountFor({}, {}, parent).id, 'default');
  f.b.clearAccountLimit('work');
  assert.equal(f.b.accountFor({}, {}, parent).id, 'work');
  // 자동 전환을 끄면 예전처럼: 부모 → 기본
  f.settings.claudeAccountFailover = false;
  assert.equal(f.b.accountFor({}).id, 'default');
  const view = f.b.accountsView();
  assert.deepEqual(view.map((a) => [a.id, a.rank]), [['work', 1], ['default', 2]]);
});

test('로그인하지 않은 계정으로는 넘기지 않는다', (t) => {
  const f = fixture(t, { loggedIn: ['default'] });
  f.b.markAccountLimited('default', { until: Date.now() + 60000 });
  assert.equal(f.b.nextAccount(['default']), null);
  assert.equal(f.b.accountFor({}).id, 'default', '쓸 계정이 없으면 기본으로(한도 화면은 Claude Code가 보인다)');
});

test('대화 기록 복사: 같은 폴더 이름으로, 하위 에이전트 폴더까지, 원본은 그대로', (t) => {
  const f = fixture(t);
  const to = path.join(f.workDir, 'projects');
  const dest = copyConversation({ transcript: f.tx, fromProjects: f.b.cfg.claudeProjects, toProjects: to, cwd: f.s.cwd, convId: 'S1' });
  assert.equal(dest, transcriptPathFor(to, f.s.cwd, 'S1'));
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"type":"user"}\n');
  assert.ok(fs.existsSync(path.join(path.dirname(dest), 'S1', 'subagents', 'a.jsonl')));
  assert.ok(fs.existsSync(f.tx), '원본은 그대로');
  fs.appendFileSync(f.tx, '{"type":"assistant"}\n');
  copyConversation({ transcript: f.tx, fromProjects: f.b.cfg.claudeProjects, toProjects: to, cwd: f.s.cwd, convId: 'S1' });
  assert.equal(fs.readFileSync(dest, 'utf8').split('\n').filter(Boolean).length, 2, '다시 넘기면 새 기록으로 덮는다');
});

test('한도 → 그 계정을 한도로 두고, 기록을 복사하고, 계정을 바꾼 뒤 재우고 깨우고, 이어 가라는 알림을 보낸다', async (t) => {
  const f = fixture(t);
  const fo = new AccountFailover(f.b, { retryMs: 5 });
  t.after(() => fo.stop());
  const r = fo.onHook(f.s, 'StopFailure', { error: 'rate_limit', error_details: REAL });
  assert.equal(r.limited, 'default'); assert.equal(r.switched, 'scheduled');
  assert.ok(f.b.accountLimit('default'));
  for (let i = 0; i < 50 && !f.queued.length; i++) await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(f.calls.map((c) => c.slice(0, 1).concat(c.slice(2))), [['sleep', 'work', f.workDir], ['wake', 'work', f.workDir]], '재우기 전에 계정을 바꿨다');
  assert.equal(f.calls[0][1].by, 'account');
  assert.equal(f.s.rt.claudeAccount, 'work'); assert.equal(f.s.rt.claudeConfigDir, f.workDir);
  assert.equal(f.s.rt.transcriptPath, transcriptPathFor(path.join(f.workDir, 'projects'), f.s.cwd, 'S1'));
  assert.ok(fs.existsSync(f.s.rt.transcriptPath));
  assert.deepEqual(f.queued, [['S1', continueNotice({ from: 'Claude', to: 'work' })]]);
  assert.ok(f.events.some(([k, d]) => k === 'account_switched' && d.from === 'default' && d.to === 'work' && d.copied));
  assert.ok(f.broadcasts.some(([e, d]) => e === 'account.failover' && d.ok && d.to === 'work'));
  // 새 계정으로 턴이 끝나면 그 계정의 한도는 없다. 옛 계정으로 돌아갈 때는 계정 폴더 env를 지운다
  f.b.markAccountLimited('work', { until: Date.now() + 60000 });
  f.b.clearAccountLimit('default');
  await fo.switchAccount(f.s, f.b.accountById('default'), { why: 'hand' });
  assert.equal(f.s.rt.claudeAccount, 'default'); assert.equal(f.s.rt.claudeConfigDir, undefined);
  assert.equal(f.queued.length, 1, '사람이 옮길 때는 이어 가라는 알림을 보내지 않는다');
  // 일하는 중에 멈추고 옮겼으면(accounts.switch stop) 멈춘 일을 이어 하라고 알린다
  f.b.clearAccountLimit('work');
  await fo.switchAccount(f.s, f.b.accountById('work'), { why: 'hand', resume: true });
  assert.deepEqual(f.queued[1], ['S1', movedNotice({ from: 'Claude', to: 'work' })]);
});

test('넘길 계정이 없으면 알리기만 하고, 자동 전환을 끄면 한도만 기록한다', async (t) => {
  const f = fixture(t, { loggedIn: ['default'] });
  const fo = new AccountFailover(f.b, { retryMs: 5 });
  t.after(() => fo.stop());
  const r = await fo.failover(f.s, {}).catch((e) => e);
  assert.equal(r.why, 'not_limited');
  f.b.markAccountLimited('default', { until: Date.now() + 60000 });
  assert.equal((await fo.failover(f.s)).why, 'none');
  assert.ok(f.broadcasts.some(([e, d]) => e === 'account.failover' && !d.ok && d.why === 'none'));
  assert.deepEqual(f.calls, []);
  const g = fixture(t, { failover: false });
  const go = new AccountFailover(g.b, { retryMs: 5 });
  assert.equal(go.onHook(g.s, 'StopFailure', { error: 'rate_limit', error_details: REAL }).why, 'off');
  assert.ok(g.b.accountLimit('default'));
  await new Promise((res) => setTimeout(res, 30));
  assert.deepEqual(g.calls, []);
});

test('지금 재울 수 없으면(쓰다 만 글 등) 다시 해 보고, 다른 실패는 계정을 되돌린다', async (t) => {
  const f = fixture(t);
  const fo = new AccountFailover(f.b, { retryMs: 5 });
  t.after(() => fo.stop());
  f.b.markAccountLimited('default', { until: Date.now() + 60000 });
  f.b.sleepError = Object.assign(new Error('draft'), { code: 'sleep_draft' });
  const r = await fo.failover(f.s);
  assert.equal(r.retry, true);
  assert.equal(f.s.rt.claudeAccount, 'default', '재우지 못하면 계정을 되돌린다');
  for (let i = 0; i < 50 && f.s.rt.claudeAccount !== 'work'; i++) await new Promise((res) => setTimeout(res, 10));
  assert.equal(f.s.rt.claudeAccount, 'work', '다시 해 보아 넘겼다');
  // 다시 해 볼 수 없는 실패
  const g = fixture(t);
  const go = new AccountFailover(g.b, { retryMs: 5 });
  g.b.markAccountLimited('default', { until: Date.now() + 60000 });
  g.b.sleepError = Object.assign(new Error('no convo'), { code: 'sleep_no_convo' });
  await assert.rejects(go.failover(g.s), (e) => e.code === 'sleep_no_convo');
  assert.equal(g.s.rt.claudeAccount, 'default'); assert.equal(g.s.rt.claudeConfigDir, undefined);
});

test('판이 띄우지 않은 세션·다른 종류는 넘기지 않는다', (t) => {
  const f = fixture(t);
  const fo = new AccountFailover(f.b);
  assert.equal(fo.onHook({ ...f.s, kind: 'codex' }, 'StopFailure', { error: 'rate_limit' }), null);
  f.b.hooked = () => false;
  assert.equal(fo.onHook(f.s, 'StopFailure', { error: 'rate_limit' }), null);
  assert.equal(f.b.accountLimit('default'), null);
});
