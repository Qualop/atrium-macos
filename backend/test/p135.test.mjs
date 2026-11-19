// P135 시험: 판이 받은 사람 입력으로 보아 보내지 않은 글이 있을 수 있는데 입력 칸을 못 읽으면 보내지 않고 기다린다.
// - 못 읽음(다른 화면·다시 그리는 중)·읽기 실패 + 쓰다 만 글 → keep(no_box_draft·read_error_draft), 대기열은 queued(draft)로 기다리다 읽히면 비키고 보낸다
// - 쓰다 만 글이 없으면 전처럼 보내고, 그 까닭(no_box·read_error)을 draft 이벤트(phase clear)로 남긴다
// - 다시 만든 글이 있는데 빈 칸으로 읽히면 한 번 더 본다
// - 한글이 든 한 줄·꺾인 Claude Code 입력 칸, 끝에 백틱이 있는 글을 읽는다
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue } from '../src/delivery.mjs';
import { draftEdit, draftMover, readDraftBox } from '../src/draft-aside.mjs';
import { claudeInputBox } from '../src/screen.mjs';

const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2, draftLookMs: 2000 };
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const RULE = '─'.repeat(40);
const claudeScreen = (lines) => ['▐▛███▛█   Claude Code', '', RULE, ...[].concat(lines).map((l, i) => (i ? `  ${l}` : `❯ ${l}`)), RULE, '  Opus (xhigh) | Context 10k', '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n');
const DRAFT = '아니 codex 창에서 다른거 보다가 다시 돌아오면 자꾸 `';
const ASK = 'p132 done: worktree-p132, 0f6138d, tests pass';

test('P135 Claude Code 입력 칸 읽기: 한글 한 줄, 끝의 백틱, 좁은 노드에서 꺾인 글', () => {
  assert.deepEqual([claudeInputBox(claudeScreen(DRAFT)).found, claudeInputBox(claudeScreen(DRAFT)).text], [true, DRAFT]);
  // 노드 폭이 좁아 꺾였다(두 칸 글자가 줄 끝에 맞지 않으면 다음 줄로 넘어간다)
  const wrapped = claudeScreen(['아니 codex 창에서 다른거 보다가', '다시 돌아오면 자꾸 `']);
  const b = readDraftBox(wrapped, 'claude');
  assert.equal(b.found, true); assert.equal(b.rows, 2);
  assert.equal(b.text, DRAFT);
  // 빈 칸의 흐린 추천 글(Claude Code 2.1.323: Try "edit <filepath> to...")은 빈 칸
  assert.equal(readDraftBox(claudeScreen('Try "edit <filepath> to..."'), 'claude').text, '');
  // 다시 만든 글(판 터미널로 받은 한글 입력)
  assert.deepEqual(draftEdit(null, DRAFT), { text: DRAFT, exact: true, paste: false });
});

// 화면을 차례로 돌려주는 가짜 하네스(Claude Code). screens: 읽을 때마다 하나씩(끝은 되풀이). null이면 읽기 실패
function harness(screens) {
  const h = { i: 0, keys: [], box: DRAFT, stash: null, submitted: null };
  h.read = async () => { const s = screens[Math.min(h.i++, screens.length - 1)]; if (s === null) throw Object.assign(new Error('timeout'), { code: 'timeout' }); return s === 'box' ? claudeScreen(h.box) : s; };
  h.type = (raw) => { h.keys.push(raw); if (raw === '\x13') { if (h.box) { h.stash = h.box; h.box = ''; } else if (h.stash != null) { h.box = h.stash; h.stash = null; } } };
  h.submit = (text) => { if (h.box) { h.box += text; return false; } if (h.stash != null) { h.box = h.stash; h.stash = null; } h.submitted = text; return true; };
  return h;
}
function rig(t, h, { pending = true, edit = null } = {}) {
  if (!t.__timers) { t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 }); t.__timers = true; }
  const log = { sent: [], events: [], drafts: [] };
  const v = { state: 'ready', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0 };
  const mover = draftMover({ pending: () => pending, read: () => h.read(), type: async (sid, raw) => h.type(raw), paste: async () => {}, kindOf: () => 'claude', edit: () => edit, userStash: () => false, stashKey: true }, { pollMs: 0, polls: 4, sleep: async () => {} });
  const q = new DeliveryQueue({
    store: { rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, { status: p.status, reason: p.reason ?? null }); }, getDelivery(id) { return this.rows.get(id) || null; } },
    cfg, view: () => v,
    send: async (sid, text) => { log.sent.push(text); h.submit(text); },
    inspect: async () => ({ box: h.box ? 'other' : 'empty', seen: false }), pressEnter: async () => {},
    drafts: { aside: (sid, d) => mover.aside(sid, d), back: (sid, held, d) => mover.back(sid, held, d) },
  });
  q.on('delivery', (d) => log.events.push(`${d.status}${d.reason ? `(${d.reason})` : ''}`));
  q.on('draft', (r) => log.drafts.push(r));
  const step = async (ms) => { t.mock.timers.tick(ms); q.pump(); await tick(); };
  return { q, log, step };
}

test('P139 입력 칸을 못 읽으면(다시 그리는 중, 읽기 실패) 쓰다 만 글이 있어도 기다리지 않고 보낸다(까닭은 판 기록에)', async (t) => {
  const h = harness(['Claude Code redrawing the transcript…\nno box yet']); h.box = '';
  const { q, log } = rig(t, h);
  q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(log.sent, [ASK]);
  assert.deepEqual(log.drafts.map((r) => `${r.phase}:${r.why}`), ['clear:no_box_draft']);

  const h1 = harness([null]); h1.box = '';
  const r1 = rig(t, h1);
  r1.q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(r1.log.sent, [ASK]);
  assert.equal(r1.log.drafts[0].why, 'read_error_draft'); assert.equal(r1.log.drafts[0].error, 'timeout');

  const h2 = harness(['no box here']); h2.box = '';
  const r2 = rig(t, h2, { pending: false });
  r2.q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(r2.log.sent, [ASK], '쓰다 만 글이 없으면 전처럼 보낸다');
  assert.deepEqual(r2.log.drafts.map((r) => `${r.phase}:${r.why}`), ['clear:no_box'], '그대로 보낸 까닭을 남긴다');
});

test('P135 다시 만든 글이 있는데 빈 칸으로 읽히면 한 번 더 본다(그리기가 늦은 칸)', async () => {
  const typed = { text: DRAFT, exact: true, paste: false };
  const h = harness([claudeScreen(''), 'box']);
  const m = draftMover({ pending: () => true, read: () => h.read(), type: async (sid, raw) => h.type(raw), kindOf: () => 'claude', edit: () => typed, userStash: () => false, stashKey: true }, { pollMs: 0, polls: 4, sleep: async () => {} });
  const a = await m.aside('s');
  assert.equal(a.state, 'moved', '두 번째 읽기에서 글을 보고 비켰다');
  // 두 번 다 빈 칸이면 화면을 믿고 보낸다
  const h2 = harness([claudeScreen('')]);
  const m2 = draftMover({ pending: () => true, read: () => h2.read(), type: async () => assert.fail('no keys'), kindOf: () => 'claude', edit: () => typed, stashKey: true }, { pollMs: 0, sleep: async () => {} });
  assert.deepEqual(await m2.aside('s'), { state: 'clear', why: 'empty_twice' });
  // 판이 받은 입력으로 보아 쓰다 만 글이 없으면 한 번만 본다
  const h3 = harness([claudeScreen('')]);
  const m3 = draftMover({ pending: () => false, read: () => h3.read(), kindOf: () => 'claude', edit: () => null, stashKey: true }, { pollMs: 0, sleep: async () => {} });
  assert.deepEqual(await m3.aside('s'), { state: 'clear', why: 'empty' });
  assert.equal(h3.i, 1);
});
