// P131 시험: opencode·pi 세션에도 쓰다 만 글 비키기(P128)를 넣는다.
// - 입력 칸 읽기(opencode 2.2.7·pi 1.5.0에서 받은 화면 표본: 빈 칸, 한 줄, 꺾인 줄, 접힌 붙여넣기, 다 보이지 않는 글, 사이드바)
// - 비키기·보내기·되돌리기 차례(Ctrl+C로 비우고, 제출 확인 뒤 접히지 않는 크기의 괄호 붙여넣기로 되돌린다)
// - 정확히 모르면 비키지 않고 'draft'로 기다린다. opencode는 빈 칸의 Ctrl+C가 끝내기라 누르기 직전에 다시 본다. pi는 판의 Ctrl+C 사이를 띄운다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeliveryQueue } from '../src/delivery.mjs';
import { draftEdit, draftMover, readDraftBox, clearDraftText, pasteChunks, clearKeyChanged } from '../src/draft-aside.mjs';
import { opencodeInputBox, piInputBox, cellSlice } from '../src/screen.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'p131');
const fx = (name) => fs.readFileSync(path.join(FIX, `${name}.txt`), 'utf8');
const box = (fn, name) => { const { above, ...r } = fn(fx(name)); return r; };
const LONG = 'next draft line long wrapped 한글도 섞인 draft words go here and keep going until the line wraps past the input box width of the harness so we can see how it folds into the next row of the box ok end';

test('P131 opencode 입력 칸 읽기: 첫 화면·대화 화면의 빈 칸, 한 줄, 꺾인 줄, 접힌 붙여넣기', () => {
  assert.deepEqual(box(opencodeInputBox, 'oc-home-empty'), { found: true, text: '', rows: 0 }, '첫 화면의 흐린 안내 글(Ask anything… "…")은 빈 칸');
  assert.deepEqual(box(opencodeInputBox, 'oc-empty'), { found: true, text: '', rows: 0 }, '대화 화면의 빈 칸(위 대화의 ┃ 줄은 입력 칸이 아니다)');
  assert.deepEqual(box(opencodeInputBox, 'oc-session-one'), { found: true, text: 'next draft line', rows: 1 });
  const w = box(opencodeInputBox, 'oc-session-wrap');
  assert.equal(w.rows, 3);
  const L = LONG.slice('next draft line '.length);
  assert.equal(w.text.replace(/\s+/g, ''), `${LONG} ${L}`.replace(/\s+/g, ''), '꺾인 줄을 이어 읽는다');
  const f = box(opencodeInputBox, 'oc-folded');
  assert.equal(f.folded, true); assert.match(f.text, /\[Pasted ~12 lines\]/);
  assert.equal(opencodeInputBox('no box here\n> prompt').found, false, '모양이 다르면 모른다');
});

test('P131 opencode 입력 칸 읽기: 같은 줄 오른쪽의 사이드바 글은 입력 칸 너비(╹▀ 줄)에서 자른다. 한글은 두 칸', () => {
  const W = 40;
  const sidebar = (l, s) => l + ' '.repeat(Math.max(0, W + 6 - [...l].length)) + s;
  // 한글 다섯 자 = 10칸: 글이 입력 칸 너비 안에 있으면 사이드바 글은 잘린다
  const screen = ['', `  ┃`, sidebar('  ┃  쓰다 만 글 draft', 'Modified Files'), sidebar('  ┃', 'LSP'), '  ┃  Build · model', `  ╹${'▀'.repeat(W)}`, '  C:\\work\\demo'].join('\n');
  assert.deepEqual((({ above, ...r }) => r)(opencodeInputBox(screen)), { found: true, text: '쓰다 만 글 draft', rows: 1 });
  assert.equal(cellSlice('가나다abc', 5), '가나', '두 칸 글자는 반만 들어가면 뺀다');
});

test('P131 pi 입력 칸 읽기: 빈 칸, 한 줄, 꺾인 줄, 접힌 붙여넣기, 다 보이지 않는 글(↑ N more)', () => {
  assert.deepEqual(box(piInputBox, 'pi-empty'), { found: true, text: '', rows: 0 }, '알림 상자의 가로줄이 위에 있어도 마지막 가로줄 둘');
  assert.deepEqual(box(piInputBox, 'pi-session-one'), { found: true, text: 'next draft line', rows: 1 });
  const w = box(piInputBox, 'pi-session-wrap');
  assert.equal(w.rows, 2);
  const f = box(piInputBox, 'pi-folded');
  assert.equal(f.folded, true); assert.equal(f.text, 'note [paste #1 +12 lines] tail');
  const c = box(piInputBox, 'pi-clipped');
  assert.equal(c.clipped, true, '가로줄에 ↑ 9 more');
  assert.equal(clearDraftText(readDraftBox(fx('pi-clipped'), 'pi'), { text: 'x', exact: true }), null, '다 보이지 않는 글은 모른다');
  assert.equal(clearDraftText(readDraftBox(fx('pi-folded'), 'pi'), null), null, '접힌 붙여넣기는 모른다');
  assert.equal(clearDraftText(readDraftBox(fx('oc-folded'), 'opencode'), null), null);
  assert.deepEqual(clearDraftText(readDraftBox(fx('pi-session-one'), 'pi'), null), { text: 'next draft line', from: 'screen' });
  assert.equal(clearDraftText(readDraftBox(fx('pi-session-wrap'), 'pi'), null), null, '여러 줄은 줄바꿈인지 꺾임인지 화면만으로 모른다');
  assert.equal(piInputBox('just text').found, false);
});

test('P131 다시 만들기: opencode·pi의 Ctrl+J는 줄바꿈이다(다른 하네스는 모름)', () => {
  const nl = { newlineKey: true };
  const e = ['first', '\n', 'second'].reduce((p, c) => draftEdit(p, c, nl), null);
  assert.deepEqual(e, { text: 'first\nsecond', exact: true, paste: false });
  assert.equal(['first', '\n', 'second'].reduce((p, c) => draftEdit(p, c), null).exact, false);
});

test('P131 되돌리기 조각: 하네스가 접지 않는 크기(opencode 2줄·150자, pi 9줄·1000자)로 나누고 이으면 같은 글', () => {
  const lines = Array.from({ length: 7 }, (_, i) => `line ${i + 1}`).join('\n');
  const oc = pasteChunks(lines, { lines: 2, chars: 150 });
  assert.equal(oc.join(''), lines);
  for (const p of oc) assert.ok(p.replace(/\n$/, '').split('\n').length <= 2 && p.trim().length <= 150, JSON.stringify(p));
  const long = 'a'.repeat(140) + '/path/to/x ' + 'b'.repeat(300);
  const c = pasteChunks(`${long}\nshort`, { lines: 2, chars: 150 });
  assert.equal(c.join(''), `${long}\nshort`);
  for (const p of c) { assert.ok(p.length <= 150); }
  for (const p of c.slice(1)) assert.ok(!/^[/~.]/.test(p), `조각이 경로 꼴로 시작하지 않는다: ${p.slice(0, 12)}`);
  const pi = pasteChunks(Array.from({ length: 25 }, (_, i) => `r${i}`).join('\n'), { lines: 9, chars: 1000 });
  assert.equal(pi.length, 3);
  for (const p of pi) assert.ok(p.split('\n').length <= 10, 'pi는 끝 줄바꿈을 포함해 10줄 이하');
  assert.deepEqual(pasteChunks('one line', { lines: 2, chars: 150 }), ['one line']);
  assert.deepEqual(pasteChunks('a\n\nb', { lines: 2, chars: 150 }), ['a\n\n', 'b'], '빈 줄도 그대로');
});

test('P131 입력 비우기 키를 바꿨는가: opencode 설정의 keybinds, pi keybindings.json(읽기만)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'p131-'));
  try {
    assert.equal(clearKeyChanged('opencode', { env: {}, home }), false);
    assert.equal(clearKeyChanged('pi', { env: {}, home }), false);
    fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
    fs.writeFileSync(path.join(home, '.config', 'opencode', 'tui.json'), JSON.stringify({ keybinds: { input_clear: 'ctrl+l' } }));
    assert.equal(clearKeyChanged('opencode', { env: {}, home }), true);
    fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'keybindings.json'), JSON.stringify({ 'app.clear': 'ctrl+l' }));
    assert.equal(clearKeyChanged('pi', { env: {}, home }), true);
    assert.equal(clearKeyChanged('pi', { env: { PI_CODING_AGENT_DIR: path.join(home, 'none') }, home }), false, 'PI_CODING_AGENT_DIR');
    assert.equal(clearKeyChanged('codex', { env: {}, home }), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// 가짜 opencode·pi: 받은 키와 붙여넣기로 입력 칸을 바꾸고, 그 하네스 모양의 화면을 그린다
const W = 60;
function ocScreen(text) {
  const rows = text ? text.split('\n') : [''];
  return ['  ┃  hello there', '', '     answer', '', '  ┃', ...rows.map((r) => (r ? `  ┃  ${r}` : '  ┃')), '  ┃', '  ┃  Build · demo-model demo connection', `  ╹${'▀'.repeat(W)}`, '  C:\\work\\demo        ctrl+p commands'].join('\n');
}
function piScreen(text, { clippedBy = 0 } = {}) {
  const R = '─'.repeat(W);
  return [' hello there', ' answer', clippedBy ? `─── ↑ ${clippedBy} more ${'─'.repeat(40)}` : R, ...(text ? text.split('\n') : ['']), R, 'C:\\work\\demo', '0.0%/128k (auto)        (atrium_c0nn) demo-model'].join('\n');
}
// opencode·pi가 붙여넣기를 접는 규칙(opencode: 다듬은 글이 3줄 이상이거나 150자 넘음, pi: 10줄 넘음이나 1000자 넘음)
const folds = (kind, p) => (kind === 'opencode' ? (p.trim().split('\n').length >= 3 || p.trim().length > 150) : (p.split('\n').length > 10 || p.length > 1000));
function fakeHarness(kind, box) {
  const h = { kind, box, keys: [], pastes: [], exited: false, t: 0, clearAt: [] };
  h.screen = () => (kind === 'opencode' ? ocScreen(h.box) : piScreen(h.box));
  h.type = (raw) => {
    h.keys.push(raw);
    if (raw === '\x03') {
      if (kind === 'opencode' && !h.box) h.exited = true; // 빈 칸의 Ctrl+C는 끝내기
      if (kind === 'pi' && h.clearAt.length && h.t - h.clearAt[h.clearAt.length - 1] < 500) h.exited = true; // 0.5초 안 두 번째
      h.clearAt.push(h.t);
      h.box = '';
    }
    if (raw.startsWith('\x1b[F')) h.box = [...h.box].slice(0, Math.max(0, [...h.box].length - (raw.length - 3))).join(''); // P139: End, Backspace×n
  };
  h.paste = (text) => {
    const body = text.replace(/^\x1b\[200~/, '').replace(/\x1b\[201~$/, '');
    h.pastes.push(body);
    h.box += folds(kind, body) ? `[${kind === 'opencode' ? 'Pasted ~N lines' : 'paste #1 +N lines'}]` : body;
  };
  h.submit = (text) => { if (h.box) { h.box += text; return false; } h.submitted = text; return true; };
  return h;
}
const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2, draftLookMs: 2000 };
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const ASK = 'Reply with the single word ok and do nothing else.';
function rig(t, h, { edit = null, clearKey = true, typedSince = () => false, sleep = async () => {} } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { sent: [], events: [], drafts: [], sleeps: [] };
  const v = { state: 'ready', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0 };
  const mover = draftMover({ read: async () => h.screen(), type: async (sid, raw) => h.type(raw), paste: async (sid, text) => h.paste(/\n/.test(text) ? text : `\x1b[200~${text}\x1b[201~`), kindOf: () => h.kind, edit: () => edit, clearKey: () => clearKey, typedSince }, { pollMs: 0, polls: 4, sleep: async (ms) => { log.sleeps.push(ms); await sleep(ms); } });
  const q = new DeliveryQueue({
    store: { rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { Object.assign(this.rows.get(id) || {}, { status: p.status, reason: p.reason ?? null }); }, getDelivery(id) { return this.rows.get(id) || null; } },
    cfg, view: () => v,
    send: async (sid, text) => { log.sent.push(text); log.submitted = h.submit(text); },
    inspect: null, pressEnter: null,
    drafts: { aside: (sid, d) => mover.aside(sid, d), back: (sid, held, d) => mover.back(sid, held, d) },
  });
  q.on('delivery', (d) => log.events.push(`${d.status}${d.reason ? `(${d.reason})` : ''}`));
  q.on('draft', (r) => log.drafts.push(r));
  const step = async (ms) => { t.mock.timers.tick(ms); q.pump(); await tick(); };
  return { q, log, v, step, mover };
}

for (const kind of ['opencode', 'pi']) {
  test(`P131 ${kind}: 한 줄 글은 Ctrl+C로 비우고 지시만 제출, 확인 뒤 괄호 붙여넣기로 되돌린다(Enter 없음)`, async (t) => {
    const h = fakeHarness(kind, '쓰다 만 한 줄 draft, keep me');
    const { q, log } = rig(t, h);
    const d = q.enqueue('s', ASK);
    await tick();
    assert.deepEqual(h.keys, ['\x03'], 'Ctrl+C 한 번');
    assert.equal(h.submitted, ASK, '지시만 제출됐다');
    assert.equal(h.box, '', '확인 전에는 되돌리지 않는다');
    q.onAgentWorking('s');
    await tick();
    assert.equal(d.status, 'confirmed');
    assert.equal(h.box, '쓰다 만 한 줄 draft, keep me');
    assert.deepEqual(h.keys, ['\x03'], 'Enter·다른 키를 누르지 않았다');
    assert.equal(d.reason, 'draft_restored');
    assert.deepEqual(log.drafts.map((r) => `${r.phase}:${r.result || r.how}`), ['aside:clear', 'back:restored']);
    assert.equal(log.drafts[0].from, 'screen');
    assert.equal(h.exited, false);
  });

  test(`P131 ${kind}: 여러 줄 글(판이 받은 입력과 화면이 같음)은 접히지 않는 조각으로 같은 모양으로 되돌린다`, async (t) => {
    const lines = Array.from({ length: kind === 'pi' ? 14 : 5 }, (_, i) => `draft line ${i + 1} 줄`);
    const draft = lines.join('\n');
    const h = fakeHarness(kind, draft);
    const edit = ['\x1b[200~', draft, '\x1b[201~'].reduce((p, c) => draftEdit(p, c, { newlineKey: true }), null);
    const { q, log } = rig(t, h, { edit });
    const d = q.enqueue('s', ASK);
    await tick();
    assert.equal(h.submitted, ASK);
    q.onAgentWorking('s');
    await tick();
    assert.equal(h.box, draft, '접히지 않고 그대로');
    assert.ok(h.pastes.length > 1, '나눠 넣었다');
    assert.equal(d.reason, 'draft_restored');
    assert.equal(log.drafts[0].from, 'typed');
  });

  test(`P139 ${kind}: 정확히 모르는 글(여러 줄인데 판 입력 없음, 접힌 붙여넣기)도 Ctrl+C로 비우고 지시만 제출, 화면에 보이던 대로 되돌린다`, async (t) => {
    for (const draft of ['wrapped or\nmulti line', kind === 'opencode' ? 'note [Pasted ~12 lines] tail' : 'note [paste #1 +12 lines] tail']) {
      const h = fakeHarness(kind, draft);
      const { q, log } = rig(t, h);
      const d = q.enqueue('s', ASK);
      await tick();
      assert.deepEqual(h.keys, ['\x03'], draft);
      assert.equal(h.submitted, ASK);
      q.onAgentWorking('s');
      await tick();
      assert.equal(h.box.replace(/\s+/g, ''), draft.replace(/\s+/g, ''), '화면에 보이던 글');
      assert.equal(d.reason, 'draft_partial');
      const back = log.drafts.find((r) => r.phase === 'back');
      assert.equal(back.partial, true); assert.ok(back.text, '원래 글은 판 기록에');
      assert.equal(h.exited, false);
      t.mock.timers.reset();
    }
  });

  test(`P139 ${kind}: 사람이 입력 비우기 키를 바꿨으면 끝으로 가서 지우고 보낸 뒤 되돌린다`, async (t) => {
    const h = fakeHarness(kind, 'one line');
    const { q, log } = rig(t, h, { clearKey: false });
    const d = q.enqueue('s', ASK);
    await tick();
    assert.ok(!h.keys.includes('\x03'), 'Ctrl+C를 누르지 않는다');
    assert.ok(h.keys[0].startsWith('\x1b[F\x7f'));
    assert.equal(h.submitted, ASK);
    q.onAgentWorking('s');
    await tick();
    assert.equal(h.box, 'one line');
    assert.equal(d.reason, 'draft_restored');
    assert.equal(log.drafts[0].key, 'erase');
  });
}

test('P131 opencode: 빈 칸의 Ctrl+C는 끝내기라 누르기 직전에 다시 본다(그새 글이 바뀌었거나 사람이 쳤으면 누르지 않는다)', async (t) => {
  const h = fakeHarness('opencode', 'draft');
  let reads = 0;
  const base = h.screen;
  h.screen = () => { reads++; if (reads === 2) h.box = ''; return base(); }; // 처음 본 뒤 사람이 그 글을 보냈다
  const { q, log } = rig(t, h);
  q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(h.keys, [], 'Ctrl+C를 누르지 않았다');
  assert.equal(h.exited, false);
  assert.equal(log.drafts[0].why, 'box_changed');
  t.mock.timers.reset();
  const h2 = fakeHarness('opencode', 'draft');
  const r2 = rig(t, h2, { typedSince: () => true });
  r2.q.enqueue('s', ASK);
  await tick();
  assert.deepEqual(h2.keys, []);
  assert.equal(r2.log.drafts[0].why, 'box_changed');
});

test('P131 pi: 판의 Ctrl+C 사이를 0.7초 띄운다(0.5초 안 두 번째 Ctrl+C는 끝내기)', async (t) => {
  const h = fakeHarness('pi', 'first draft');
  const { mover, log } = rig(t, h, { sleep: async (ms) => { h.t += ms; } });
  const a = await mover.aside('s');
  assert.equal(a.state, 'moved');
  h.box = 'second draft'; // 바로 다음 전달
  const b = await mover.aside('s');
  assert.equal(b.state, 'moved');
  assert.ok(log.sleeps.some((ms) => ms >= 600), `기다림: ${log.sleeps}`);
  assert.equal(h.exited, false);
});

test('P131 지시가 제출되지 않으면(입력 칸에 남음) 덮지 않고 그 글을 판 기록에 남긴다', async (t) => {
  for (const kind of ['opencode', 'pi']) {
    const h = fakeHarness(kind, 'my draft');
    h.submit = (text) => { h.box = text; return false; }; // 지시가 입력 칸에 남았다
    const { q, log, step } = rig(t, h);
    const d = q.enqueue('s', ASK);
    await tick();
    for (let i = 0; i < 40 && d.status === 'sent'; i++) await step(1000);
    assert.equal(d.status, 'unconfirmed', kind);
    await tick();
    const back = log.drafts.find((r) => r.phase === 'back');
    assert.equal(back.result, 'held', kind);
    assert.equal(back.text, 'my draft');
    assert.equal(h.box, ASK, '입력 칸을 덮지 않았다');
    t.mock.timers.reset();
  }
});
