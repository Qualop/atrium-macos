// P128 시험: 판이 지시를 보낼 때 받는 세션의 입력 칸에 쓰다 만 글이 있으면 잠시 비키고 지시만 제출한 뒤 되돌린다.
// - 쓰다 만 글 다시 만들기(한 줄, 여러 줄, 붙여넣기, 지우기, 커서 키 뒤 모름)
// - 비키기·보내기·되돌리기 차례(Claude Code: Ctrl+S 치워 두기, Codex: Ctrl+C로 비우고 괄호 붙여넣기)
// - 정확히 되돌릴 수 없으면 비키지 않고 'draft'로 기다린다. 사람이 3초 안에 쳤으면 비키지도 않고 기다린다(규칙 4)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue } from '../src/delivery.mjs';
import { draftEdit, draftMover, readDraftBox, codexDraftText, sameDraft } from '../src/draft-aside.mjs';

const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2, draftLookMs: 2000 };
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const RULE = '─'.repeat(40);
const claudeScreen = (lines) => ['▐▛███▛█   Claude Code', '', RULE, ...[].concat(lines).map((l, i) => (i ? `  ${l}` : `❯ ${l}`)), RULE, '  Haiku (medium)'].join('\n');
const codexScreen = (lines) => ['>_ OpenAI Codex', '', ...[].concat(lines).map((l, i) => (i ? `  ${l}` : `› ${l}`)), '', '  model-x default · C:\\repo'].join('\n');
const ASK = 'Reply with the single word ok and do nothing else.';
const typeAll = (chunks) => chunks.reduce((p, c) => draftEdit(p, c), null);

test('P128 다시 만들기: 한 줄 글자, 지우기, 한글', () => {
  assert.deepEqual(typeAll(['h', 'e', 'l', 'x', '\x7f', 'lo']), { text: 'hello', exact: true, paste: false });
  assert.equal(typeAll(['안녕', '하세요', '\x08', '\x08']).text, '안녕하');
  assert.equal(typeAll(['abc', '\x1b[3~']).text, 'abc', '끝의 Delete는 아무 일도 없다');
  assert.equal(typeAll(['abc', '\x1b[<65;10;4M', '\x1b[I', 'd']).text, 'abcd', '터미널 보고는 뺀다');
});

test('P128 다시 만들기: 붙여넣기(여러 줄, CRLF, 덩어리 경계에서 끊김)와 Enter·Ctrl+C·Ctrl+U', () => {
  assert.equal(typeAll(['note: ', '\x1b[200~line one\r\nline two\rline three\x1b[201~', ' end']).text, 'note: line one\nline two\nline three end');
  const half = draftEdit(null, '\x1b[200~first\r\nsec');
  assert.equal(half.paste, true);
  assert.deepEqual(draftEdit(half, 'ond\x1b[201~!'), { text: 'first\nsecond!', exact: true, paste: false });
  assert.deepEqual(typeAll(['draft', '\r']), { text: '', exact: true, paste: false }, 'Enter는 제출(빈 칸)');
  assert.equal(typeAll(['draft', '\x03', 'new']).text, 'new', 'Ctrl+C는 비우기');
  assert.equal(typeAll(['one line', '\x15']).text, '', 'Ctrl+U(한 줄)');
  assert.equal(typeAll(['\x1b[200~a\nb\x1b[201~', '\x15']).exact, false, 'Ctrl+U(여러 줄)는 어디까지 지웠는지 모른다');
});

test('P128 다시 만들기: 커서 키·Tab·Esc·Ctrl+J 뒤에는 모른다(다음 Enter·Ctrl+C까지)', () => {
  for (const k of ['\x1b[D', '\x1b[A', '\x1bOH', '\t', '\x1b', '\n', '\x17', '\x1b\x7f']) {
    const e = typeAll(['abc', k, 'x']);
    assert.equal(e.exact, false, JSON.stringify(k));
    assert.equal(e.text, '');
  }
  assert.deepEqual(typeAll(['abc', '\x1b[D', 'x', '\r', 'new']), { text: 'new', exact: true, paste: false });
});

test('P128 입력 칸 읽기: 줄 수와 Codex 되돌릴 글 고르기', () => {
  assert.deepEqual(readDraftBox(claudeScreen('half typed'), 'claude'), { found: true, text: 'half typed', rows: 1 });
  assert.equal(readDraftBox(claudeScreen(['first', 'second']), 'claude').rows, 2);
  assert.deepEqual(readDraftBox(codexScreen('[<65;101;61Mhalf'), 'codex'), { found: true, text: 'half', rows: 1 }, '마우스 보고 글은 뗀다');
  const one = readDraftBox(codexScreen('just one line'), 'codex');
  assert.deepEqual(codexDraftText(one, null), { text: 'just one line', from: 'screen' }, '한 줄이면 화면 글로 된다');
  const two = readDraftBox(codexScreen(['line one', 'line two']), 'codex');
  assert.equal(codexDraftText(two, null), null, '여러 줄은 줄바꿈인지 꺾임인지 화면만으로 모른다');
  assert.deepEqual(codexDraftText(two, { text: 'line one\nline two', exact: true }), { text: 'line one\nline two', from: 'typed' }, '판이 받은 입력과 같으면 그것');
  assert.equal(codexDraftText(two, { text: 'line one\nline 2', exact: true }), null, '다르면 모른다');
  assert.equal(codexDraftText(readDraftBox(codexScreen('[Pasted Content 1800 chars]'), 'codex'), { text: 'x'.repeat(1800), exact: true }), null, '접힌 붙여넣기');
  assert.equal(codexDraftText(readDraftBox(codexScreen('[Image #1] look'), 'codex'), null), null, '그림');
  assert.ok(sameDraft('a b\nc', 'a bc'));
});

// 가짜 하네스 화면: 키를 받으면 Claude Code·Codex처럼 입력 칸을 바꾼다
function fakeHarness(kind, box) {
  const h = { kind, box, stash: null, keys: [], pastes: [], screen() { return kind === 'codex' ? codexScreen(h.box ? h.box.split('\n') : ['']) : claudeScreen(h.box ? h.box.split('\n') : ['']); } };
  h.type = (raw) => {
    h.keys.push(raw);
    if (raw === '\x13' && kind === 'claude') { if (h.box) { h.stash = h.box; h.box = ''; } else if (h.stash != null) { h.box = h.stash; h.stash = null; } }
    if (raw === '\x03' && kind === 'codex' && h.box) h.box = '';
    if (raw.startsWith('\x1b[F')) h.box = [...h.box].slice(0, Math.max(0, [...h.box].length - (raw.length - 3))).join(''); // P139: End, Backspace×n
  };
  h.paste = (text) => { h.pastes.push(text); h.box += text; };
  // 판이 지시를 보낸다(hc terminal.send): 입력 칸이 비었으면 제출되고, Claude Code는 치워 둔 글을 되돌린다
  h.submit = (text) => { if (h.box) { h.box += text; return false; } if (kind === 'claude' && h.stash != null && !text.startsWith('/')) { h.box = h.stash; h.stash = null; } h.submitted = text; return true; };
  return h;
}
function rig(t, h, { view = {}, edit = null, userStash = false, stashKey = true } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { sent: [], events: [], drafts: [] };
  const v = { state: 'ready', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0, ...view };
  const mover = draftMover({ read: async () => h.screen(), type: async (sid, raw) => h.type(raw), paste: async (sid, text) => h.paste(text), kindOf: () => h.kind, edit: () => edit, userStash: () => userStash, stashKey }, { pollMs: 0, polls: 4, sleep: async () => {} });
  const q = new DeliveryQueue({
    store: { rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, { status: p.status, reason: p.reason ?? null }); }, getDelivery(id) { return this.rows.get(id) || null; } },
    cfg, view: () => v,
    send: async (sid, text) => { log.sent.push(text); log.submitted = h.submit(text); },
    inspect: async () => ({ box: h.box ? 'other' : 'empty', seen: false }), pressEnter: async () => {},
    drafts: { aside: (sid, d) => mover.aside(sid, d), back: (sid, held, d) => mover.back(sid, held, d) },
  });
  q.on('delivery', (d) => log.events.push(`${d.status}${d.reason ? `(${d.reason})` : ''}`));
  q.on('draft', (r) => log.drafts.push(r));
  const step = async (ms) => { t.mock.timers.tick(ms); q.pump(); await tick(); };
  return { q, log, v, step };
}

test('P128 Claude Code: 쓰다 만 글(한 줄)을 Ctrl+S로 치워 두고 지시만 제출, 제출 때 Claude Code가 되돌린다', async (t) => {
  const h = fakeHarness('claude', 'half written note');
  const { q, log } = rig(t, h);
  const d = q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(h.keys, ['\x13'], 'Ctrl+S 한 번');
  assert.equal(h.submitted, ASK, '지시만 제출됐다');
  assert.equal(h.box, 'half written note', '입력 칸에 돌아왔다');
  q.onUserPromptSubmit('s', ASK);
  await tick();
  assert.equal(d.status, 'confirmed');
  assert.equal(d.reason, 'draft_restored');
  assert.deepEqual(log.drafts.map((r) => `${r.phase}:${r.result || r.how}`), ['aside:stash', 'back:restored']);
  assert.equal(log.drafts[1].by, 'harness');
  assert.equal(log.drafts[1].text, undefined, '되돌렸으면 판 기록에 글을 남기지 않는다');
  assert.deepEqual(h.keys, ['\x13'], '되돌리기에 키를 더 누르지 않는다');
  assert.ok(log.events.includes('confirmed(draft_moved)'));
});

test('P128 Claude Code: 여러 줄 글과 접힌 붙여넣기도 Claude Code가 쥐고 되돌린다. /로 시작하는 지시는 판이 빈 칸에서 Ctrl+S로 꺼낸다', async (t) => {
  const h = fakeHarness('claude', 'first line\n[Pasted text #1 +40 lines]\nlast');
  const { q, log } = rig(t, h);
  const d = q.enqueue('s', '/compact');
  await tick();
  assert.equal(h.submitted, '/compact');
  assert.equal(h.box, '', '명령은 Claude Code가 되돌리지 않는다');
  q.onUserPromptSubmit('s', '/compact');
  await tick();
  assert.equal(h.box, 'first line\n[Pasted text #1 +40 lines]\nlast');
  assert.deepEqual(h.keys, ['\x13', '\x13'], '치우기 한 번, 꺼내기 한 번');
  assert.equal(d.reason, 'draft_restored');
  assert.equal(log.drafts[1].by, 'board');
});

test('P128 Codex: 판이 받은 입력(여러 줄 붙여넣기)과 화면이 같으면 Ctrl+C로 비우고 지시만 제출, 제출된 뒤 괄호 붙여넣기로 되돌린다', async (t) => {
  const draft = 'look at this:\nline two';
  const h = fakeHarness('codex', draft);
  const { q, log } = rig(t, h, { edit: typeAll(['look at this:', '\x1b[200~\nline two\x1b[201~']) });
  const d = q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(h.keys, ['\x03']);
  assert.equal(h.submitted, ASK);
  assert.equal(d.status, 'sent');
  assert.equal(h.box, '', '확인 전에는 되돌리지 않는다(지시와 섞이지 않게)');
  q.onAgentWorking('s');
  await tick();
  assert.equal(d.status, 'confirmed');
  assert.deepEqual(h.pastes, [draft], '같은 모양(줄바꿈 그대로), Enter 없음');
  assert.equal(h.box, draft);
  assert.equal(d.reason, 'draft_restored');
  assert.equal(log.drafts[0].from, 'typed');
});

test('P128 Codex: 한 줄 글은 판이 받은 입력이 없어도 화면 글로 되돌린다', async (t) => {
  const h = fakeHarness('codex', 'typed somewhere else');
  const { q } = rig(t, h);
  const d = q.enqueue('s', ASK);
  await tick();
  q.onAgentWorking('s');
  await tick();
  assert.equal(h.box, 'typed somewhere else');
  assert.equal(d.reason, 'draft_restored');
});

test('P139 정확히 모르는 글도 비키고 보낸다: Codex 여러 줄(입력 기록 없음)은 Ctrl+C로 비우고 지시만 제출, 화면에 보이던 대로 되돌린다(원래 글은 판 기록에)', async (t) => {
  const h = fakeHarness('codex', 'wrapped or\nmulti line');
  const { q, log } = rig(t, h);
  const d = q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(h.keys, ['\x03']);
  assert.equal(h.submitted, ASK, '지시만 제출됐다');
  q.onAgentWorking('s');
  await tick();
  assert.deepEqual(h.pastes, ['wrapped or multi line'], '화면에서 읽은 글(꺾인 줄은 빈칸으로 이어진다)');
  assert.equal(d.reason, 'draft_partial');
  assert.equal(log.drafts[0].exact, false);
  const back = log.drafts.find((r) => r.phase === 'back');
  assert.equal(back.result, 'restored'); assert.equal(back.partial, true); assert.equal(back.text, 'wrapped or multi line', '판 기록에 남긴다');
});

test('P139 Claude Code: 사람이 치워 둔 글이 있을 수 있거나 치워 두기 키를 바꿨으면 Ctrl+S 대신 끝으로 가서 지우고 보낸 뒤 붙여넣기로 되돌린다', async (t) => {
  for (const o of [{ userStash: true }, { stashKey: false }]) {
    const h = fakeHarness('claude', 'draft');
    const { q, log } = rig(t, h, o);
    const d = q.enqueue('s', ASK);
    await tick();
    assert.ok(!h.keys.includes('\x13'), 'Ctrl+S를 누르지 않는다');
    assert.ok(h.keys[0].startsWith('\x1b[F\x7f'), '끝으로 가서 지운다');
    assert.deepEqual(log.sent, [ASK]); assert.equal(h.submitted, ASK);
    q.onUserPromptSubmit('s', ASK);
    await tick();
    assert.deepEqual(h.pastes, ['draft']); assert.equal(h.box, 'draft');
    assert.equal(d.reason, 'draft_restored');
    assert.equal(log.drafts[0].how, 'clear'); assert.equal(log.drafts[0].key, 'erase');
    t.mock.timers.reset();
  }
});

test('P139 Claude Code: Ctrl+S가 듣지 않으면(옛 판) 지우고 보낸다. 지우기도 듣지 않으면 기다린다(clear_failed)', async (t) => {
  const h = fakeHarness('claude', 'draft');
  const type0 = h.type;
  h.type = (raw) => { if (raw === '\x13') { h.keys.push(raw); return; } type0(raw); }; // 치워 두기만 듣지 않는다
  const { q, log } = rig(t, h);
  q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(log.sent, [ASK]);
  assert.equal(h.keys[0], '\x13'); assert.ok(h.keys[1].startsWith('\x1b[F'));
  t.mock.timers.reset();
  const h2 = fakeHarness('claude', 'draft');
  h2.type = (raw) => h2.keys.push(raw); // 아무 키도 듣지 않는다
  const r2 = rig(t, h2);
  const d2 = r2.q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(r2.log.sent, [], '사람의 글과 함께 제출되지 않게 보내지 않는다');
  assert.equal(d2.reason, 'draft'); assert.equal(r2.log.drafts[0].why, 'clear_failed');
});

test('P128 사람이 3초 안에 쳤으면 비키지도 않고 기다린다(규칙 4). 비키는 사이에 치면 되돌리고 기다린다', async (t) => {
  const h = fakeHarness('codex', 'one line');
  const { q, log, v, step } = rig(t, h, { view: { lastUserInputAt: 1_000_000 - 500 } });
  const d = q.enqueue('s', ASK);
  await tick();
  assert.equal(d.reason, 'user_typing'); assert.deepEqual(h.keys, []);
  // 3초 지나 비키기 시작, 비키는 동안 사람이 친다
  const orig = h.type;
  h.type = (raw) => { orig(raw); v.lastUserInputAt = Date.now(); };
  await step(3000);
  assert.deepEqual(log.sent, [], '보내지 않았다');
  assert.equal(h.box, 'one line', '비킨 글을 곧바로 되돌렸다');
  assert.equal(d.status, 'queued'); assert.equal(d.reason, 'user_typing');
  assert.deepEqual(log.drafts.map((r) => r.phase), ['aside', 'back']);
});

test('P128 지시가 제출되지 않으면(입력 칸에 남음) 덮지 않고 그 글을 판 기록에 남긴다. Claude Code는 계속 쥐고 있다(stashed)', async (t) => {
  for (const kind of ['codex', 'claude']) {
    const h = fakeHarness(kind, 'my draft');
    h.submit = (text) => { h.box = text; return false; }; // 넣었지만 제출되지 않았다
    const { q, log, step } = rig(t, h);
    const d = q.enqueue('s', ASK);
    await tick();
    for (let i = 0; i < 40 && d.status === 'sent'; i++) await step(1000);
    assert.equal(d.status, 'unconfirmed', kind);
    await tick();
    const back = log.drafts.find((r) => r.phase === 'back');
    assert.equal(back.result, kind === 'claude' ? 'stashed' : 'held', kind);
    assert.equal(back.text, 'my draft', '판 기록에 글');
    assert.equal(h.box, ASK, '입력 칸을 덮지 않았다');
    t.mock.timers.reset();
  }
});

test('P128 받지 않으면(터미널 거부) 비켜 둔 글부터 되돌리고 물러난다', async (t) => {
  const h = fakeHarness('codex', 'keep me');
  const { q, log } = rig(t, h);
  q.send = async () => { throw Object.assign(new Error('blocked'), { code: 'agent_blocked' }); };
  const d = q.enqueue('s', ASK);
  await tick();
  assert.equal(d.status, 'queued'); assert.equal(d.reason, 'waiting');
  assert.equal(h.box, 'keep me');
  assert.equal(log.drafts.at(-1).result, 'restored');
});

test('P128 빈 입력 칸, 입력 칸을 못 읽는 화면, 다른 종류는 전처럼 바로 보낸다', async (t) => {
  const h = fakeHarness('claude', '');
  const { q, log } = rig(t, h);
  q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(log.sent, [ASK]); assert.deepEqual(h.keys, []); assert.deepEqual(log.drafts, []);
  const mover = draftMover({ read: async () => 'some dialog without a box', kindOf: () => 'claude', type: async () => assert.fail('no keys') }, { sleep: async () => {} });
  assert.equal((await mover.aside('s')).state, 'clear');
  const other = draftMover({ read: async () => assert.fail('not read'), kindOf: () => 'gemini' }); // P131: opencode·pi는 이제 읽는다. 표에 없는 종류는 손대지 않는다
  assert.equal((await other.aside('s')).state, 'clear');
});
