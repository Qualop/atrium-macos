// P139: Claude Code의 다음 메시지 제안(흐린 글)은 사람의 글이 아니다. 그리고 사람이 치는 중이 아니면 입력 칸에 무엇이 있든 지시만 보내고 되돌린다
import test from 'node:test';
import assert from 'node:assert/strict';
import { ansiRows, claudeSuggestion } from '../src/screen.mjs';
import { draftMover, restoreText } from '../src/draft-aside.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';

const RULE = '─'.repeat(40);
const E = '\x1b[';
// hc 관찰 붙기가 주는 지금 화면 모양(2.1.323에서 잡은 것을 줄였다): 모드 끄기·켜기, 화면 지우기, 줄마다 색과 글
const paint = (boxLine) => [
  `${E}?2026l${E}?1049h${E}H${E}2J${E}0m${E}38;2;215;119;87m▐▛███▛█${E}0m   Claude Code`,
  `${E}0m${E}38;2;153;153;153m${E}48;2;55;55;55m❯ ${E}0m${E}38;2;255;255;255m${E}48;2;55;55;55mSay hi in two words.${E}0m`,
  `${E}0m${E}38;2;136;136;136m${RULE}${E}0m`,
  boxLine,
  `${E}0m${E}38;2;136;136;136m${RULE}${E}0m`,
  '  Haiku (medium)',
].join('\n');
const plainOf = (ansi) => ansiRows(ansi).map((r) => r.text).join('\n');
const SUG = 'show me the Python example';
const dimBox = paint(`❯ ${E}0m${E}2m${SUG}${E}0m`); // 잡은 그대로: 글 전체가 흐림
const dimCursor = paint(`❯ ${E}0m${E}7m${SUG[0]}${E}0m${E}2m${SUG.slice(1)}${E}0m`); // 초점이 있으면 첫 글자가 커서
const typed = paint(`❯ ${E}0m${E}38;2;255;255;255m${SUG}${E}7m ${E}0m`); // 사람이 친 글(끝에 커서)
const typedGray = paint(`❯ ${E}0m${E}38;2;2;2;2m${SUG}${E}0m`); // 색 값 안의 2는 흐림이 아니다

test('P139 ANSI 화면 풀기: 줄마다 글자와 흐림·뒤집힘. 색 값 안의 2·7은 흐림·뒤집힘이 아니다', () => {
  const rows = ansiRows(dimCursor);
  const box = rows[3];
  assert.equal(box.text, `❯ ${SUG}`);
  assert.equal(box.cells[2].inv, true); assert.equal(box.cells[2].dim, false);
  assert.ok(box.cells.slice(3).every((c) => c.dim));
  assert.ok(ansiRows(typedGray)[3].cells.every((c) => !c.dim && !c.inv));
});

test('P139 Claude Code 다음 메시지 제안 가르기: 흐린 글(첫 글자 커서 포함)은 제안, 사람이 친 글은 아니다', () => {
  assert.equal(claudeSuggestion(dimBox), SUG);
  assert.equal(claudeSuggestion(dimCursor), SUG);
  assert.equal(claudeSuggestion(typed), null);
  assert.equal(claudeSuggestion(typedGray), null);
  assert.equal(claudeSuggestion(paint(`❯ ${E}0m`)), null, '빈 칸');
  assert.equal(claudeSuggestion(paint(`❯ ${E}0mhalf ${E}2mtyped${E}0m`)), null, '흐리지 않은 글자가 섞였다');
  assert.equal(claudeSuggestion('no box at all'), null);
});

// 가짜 Claude Code: 입력 칸이 제안(흐림)이나 사람의 글을 보인다. 판의 키는 화면 글로 바뀐다
function harness({ box = '', suggestion = '' } = {}) {
  const h = { box, suggestion, stash: null, keys: [], pastes: [], submitted: null };
  const shown = () => h.box || h.suggestion;
  h.text = () => ['▐▛███▛█   Claude Code', '', RULE, `❯ ${shown()}`, RULE, '  Haiku'].join('\n');
  h.ansi = () => paint(h.box ? `❯ ${E}0m${h.box}${E}7m ${E}0m` : h.suggestion ? `❯ ${E}0m${E}2m${h.suggestion}${E}0m` : `❯ ${E}0m`);
  h.type = (raw) => {
    h.keys.push(raw);
    if (raw === '\x13') { if (h.box) { h.stash = h.box; h.box = ''; } else if (h.stash != null) { h.box = h.stash; h.stash = null; } } // 빈 칸(제안만 보임)의 Ctrl+S는 치워 둘 것이 없다
    if (raw.startsWith('\x1b[F')) h.box = [...h.box].slice(0, Math.max(0, [...h.box].length - (raw.length - 3))).join('');
  };
  h.paste = (t) => { h.pastes.push(t); h.box += t; };
  h.submit = (t) => { if (h.box) { h.box += t; return false; } h.suggestion = ''; if (h.stash != null && !t.startsWith('/')) { h.box = h.stash; h.stash = null; } h.submitted = t; return true; };
  return h;
}
const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2, draftLookMs: 2000 };
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const ASK = 'Reply with the single word ok and do nothing else.';
function rig(t, h, { pending = false, view = {}, stashKey = true } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { sent: [], events: [], drafts: [], ansiReads: 0 };
  const v = { state: 'ready', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0, ...view };
  const mover = draftMover({
    pending: () => pending, read: async () => h.text(), readAnsi: async () => { log.ansiReads++; return h.ansi(); },
    type: async (sid, raw) => h.type(raw), paste: async (sid, text) => h.paste(text), kindOf: () => 'claude', edit: () => null, userStash: () => false, stashKey,
  }, { pollMs: 0, polls: 4, sleep: async () => {} });
  const q = new DeliveryQueue({
    store: { rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, { status: p.status, reason: p.reason ?? null }); }, getDelivery(id) { return this.rows.get(id) || null; } },
    cfg, view: () => v,
    send: async (sid, text) => { log.sent.push(text); h.submit(text); },
    inspect: async () => ({ box: h.box ? 'other' : 'empty', seen: false }), pressEnter: async () => {},
    drafts: { aside: (sid, d) => mover.aside(sid, d), back: (sid, held, d) => mover.back(sid, held, d) },
  });
  q.on('delivery', (d) => log.events.push(`${d.status}${d.reason ? `(${d.reason})` : ''}`));
  q.on('draft', (r) => log.drafts.push(r));
  return { q, log, v };
}

test('P139 입력 칸에 다음 메시지 제안만 보이면 빈 칸으로 보고 키 없이 바로 보낸다(전에는 stash_no_effect로 기다렸다)', async (t) => {
  const h = harness({ suggestion: SUG });
  const { q, log } = rig(t, h);
  const d = q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(h.keys, [], 'Ctrl+S도 지우기도 누르지 않는다');
  assert.deepEqual(log.sent, [ASK]); assert.equal(h.submitted, ASK);
  assert.deepEqual(log.drafts.map((r) => `${r.phase}:${r.why}`), ['clear:suggestion']);
  q.onUserPromptSubmit('s', ASK);
  await tick();
  assert.equal(d.status, 'confirmed'); assert.equal(d.reason, null, '되돌릴 것이 없다');
  assert.deepEqual(h.pastes, []);
});

test('P139 사람의 글을 치워 둔 뒤 빈 칸에 제안이 뜨면 비운 것으로 본다', async (t) => {
  const h = harness({ box: 'half written', suggestion: SUG });
  const { q, log } = rig(t, h);
  const d = q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(h.keys, ['\x13']);
  assert.equal(h.submitted, ASK);
  q.onUserPromptSubmit('s', ASK);
  await tick();
  assert.equal(h.box, 'half written'); assert.equal(d.reason, 'draft_restored');
  assert.equal(log.drafts[0].how, 'stash');
});

test('P139 사람이 치워 둔 글이 있으면(Ctrl+S) 지우고 보낸다. 제출 뒤 Claude Code가 꺼낸 그 글을 다시 치워 두고 판이 지운 글을 붙여 넣는다(원래 모양)', async (t) => {
  const h = harness({ box: 'typed after stash' });
  h.stash = 'person stashed this';
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { sent: [], drafts: [] };
  const mover = draftMover({ pending: () => true, read: async () => h.text(), readAnsi: async () => h.ansi(), type: async (sid, raw) => h.type(raw), paste: async (sid, text) => h.paste(text), kindOf: () => 'claude', edit: () => null, userStash: () => true, stashKey: true }, { pollMs: 0, polls: 4, sleep: async () => {} });
  const q = new DeliveryQueue({
    store: { rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, p); }, getDelivery(id) { return this.rows.get(id) || null; } },
    cfg, view: () => ({ state: 'ready', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0 }),
    send: async (sid, text) => { log.sent.push(text); h.submit(text); }, inspect: null, pressEnter: null,
    drafts: { aside: (sid, d) => mover.aside(sid, d), back: (sid, held, d) => mover.back(sid, held, d) },
  });
  q.on('draft', (r) => log.drafts.push(r));
  const d = q.enqueue('s', ASK);
  await tick();
  assert.equal(h.submitted, ASK);
  assert.equal(h.box, 'person stashed this', 'Claude Code가 치워 둔 글을 꺼냈다');
  q.onUserPromptSubmit('s', ASK);
  await tick();
  assert.equal(h.box, 'typed after stash'); assert.equal(h.stash, 'person stashed this');
  assert.equal(d.reason, 'draft_restored');
});

test('P139 사람이 3초 안에 쳤으면(규칙 4) 입력 칸을 보지도 않고 기다린다', async (t) => {
  const h = harness({ box: 'typing now' });
  const { q, log } = rig(t, h, { view: { lastUserInputAt: 1_000_000 - 500 } });
  const d = q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(h.keys, []); assert.deepEqual(log.sent, []);
  assert.equal(d.reason, 'user_typing');
});

test('P139 되돌릴 글 고르기: 정확한 글이 없으면 화면 글(exact: false)', () => {
  assert.deepEqual(restoreText({ found: true, text: 'one line', rows: 1 }, null), { text: 'one line', from: 'screen', exact: true });
  assert.deepEqual(restoreText({ found: true, text: 'a b', rows: 2 }, null), { text: 'a b', from: 'screen', exact: false });
  assert.deepEqual(restoreText({ found: true, text: 'x [Pasted text #1 +9 lines]', rows: 1 }, null), { text: 'x [Pasted text #1 +9 lines]', from: 'screen', exact: false });
  assert.deepEqual(restoreText({ found: true, text: 'a b', rows: 2 }, { text: 'a\nb', exact: true }), { text: 'a\nb', from: 'typed', exact: true });
  assert.equal(restoreText({ found: true, text: '' }, null), null);
  // 접힌 붙여넣기라도 판이 받은 글(정확함)이 화면의 나머지를 품으면 그 글(원래 글)로 되돌린다
  const long = 'note:\n' + 'pasted line\n'.repeat(30);
  assert.deepEqual(restoreText({ found: true, text: 'note: [Pasted Content 366 chars]', rows: 1 }, { text: long, exact: true }), { text: long, from: 'typed', exact: true });
  assert.equal(restoreText({ found: true, text: 'other: [Pasted Content 366 chars]', rows: 1 }, { text: long, exact: true }).exact, false, '다른 글');
  assert.equal(restoreText({ found: true, text: 'see [Image #1]', rows: 1 }, { text: 'see ', exact: true }).exact, false, '그림');
});
