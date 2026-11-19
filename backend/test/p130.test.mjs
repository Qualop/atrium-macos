// P130: 판이 hc 터미널에 친 키(쓰다 만 글 비키기·되돌리기, 키 패드, 답하기, 끄기의 키)는 AUTOMATIC_INPUT(kind 6)으로 보낸다.
// hc는 attach DATA만 사람 입력으로 세어 그 뒤 terminal.send·keys가 약 3초 조용한 틈을 기다린다. 사람이 판 터미널로 친 키(relay)는 그대로 DATA다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HcAdapter } from '../src/hc/adapter.mjs';
import { HcController } from '../src/hc/stream.mjs';
import { TerminalRelay } from '../src/relay.mjs';
import { blockReason } from '../src/delivery.mjs';
import { draftMover } from '../src/draft-aside.mjs';
import { keysToBytes } from '../src/hc/model.mjs';
import { KEY_NAMES } from '../src/keys.mjs';
import { startFakeHc } from './fake-hc.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(20); } throw new Error('timed out'); };
const kinds = (fake, addr) => fake.terms.get(addr).inputKinds;

test('P130 잠깐 붙어 치기: 판이 친 키·글은 kind 6(automatic_input), hc가 받지 않으면 DATA', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p130-unit', dataDir: null, pipe: fake.pipe, env: {} });
  try {
    const t = fake.create({ argv: ['claude'] }).result;
    // 쓰다 만 글 비키기의 Ctrl+S(draftIo.type = sendText)
    const k = await a.sendText(t.address, '');
    assert.equal(k.via, 'attach'); assert.equal(k.automatic, true);
    await until(() => fake.terms.get(t.address).inputs.join('') === '\x13');
    assert.deepEqual(kinds(fake, t.address), ['auto']);
    // 되돌리는 붙여넣기(sendText)도 판 입력
    await a.sendText(t.address, 'a\nb');
    await until(() => kinds(fake, t.address).length === 2);
    assert.deepEqual(kinds(fake, t.address), ['auto', 'auto']);
    assert.equal(fake.terms.get(t.address).inputs[1], '\x1b[200~a\nb\x1b[201~');
    // 사람의 글을 되돌리는 붙여넣기(person)는 DATA
    const back = await a.sendText(t.address, 'half', { person: true });
    assert.equal(back.automatic, false);
    await until(() => kinds(fake, t.address).length === 3);
    assert.equal(kinds(fake, t.address)[2], 'data');
    fake.terms.get(t.address).inputs.pop(); fake.terms.get(t.address).inputKinds.pop();
    // 옛 hc(automatic_input 없음): DATA로 보낸다(키는 들어가고 3초 기다림만 남는다)
    fake.automaticInput = false;
    const old = await a.paneKeys(t.address, ['enter']); // 키 패드·Enter 되살리기
    assert.equal(old.automatic, false);
    await until(() => kinds(fake, t.address).length === 3);
    assert.equal(kinds(fake, t.address)[2], 'data');
  } finally { a.stopEvents(); await fake.close(); }
});

test('P130 붙은 화면 스트림: 사람 입력(relay·input)은 DATA, 판이 친 키(paneKeys·sendText)는 kind 6, 붙기 전 판 입력은 줄 세웠다가 kind 6', async () => {
  const fake = await startFakeHc();
  const a = new HcAdapter({ session: 'p130-unit', dataDir: null, pipe: fake.pipe, env: {}, moveWaitMs: 100 });
  try {
    const t = fake.create({ argv: ['claude'] }).result;
    const c = a.openController(t.address, 100, 30);
    c.inputAuto('\x13'); // 붙기 전: 줄 세움
    await until(() => c.conn && c.ch != null);
    await until(() => kinds(fake, t.address).length === 1);
    assert.equal(c.autoInput, true);
    c.input('hi'); // 사람(창의 xterm → relay)
    await until(() => kinds(fake, t.address).length === 2);
    const r = await a.paneKeys(t.address, ['esc']);
    assert.equal(r.via, 'stream'); assert.equal(r.automatic, true);
    await a.sendText(t.address, 'draft');
    await a.sendText(t.address, 'back', { person: true }); // 되돌리는 붙여넣기
    await until(() => kinds(fake, t.address).length === 5);
    assert.deepEqual(fake.terms.get(t.address).inputs, ['\x13', 'hi', '\x1b', 'draft', 'back']);
    assert.deepEqual(kinds(fake, t.address), ['auto', 'data', 'auto', 'auto', 'data']);
    c.close();
  } finally { a.stopEvents(); await fake.close(); }
});

test('P130 hc가 kind 6을 받지 않는 스트림: 판 입력도 DATA(키가 사라지지 않게)', async () => {
  const fake = await startFakeHc();
  fake.automaticInput = false;
  const c = new HcController({ pipe: fake.pipe, terminal: fake.create({ argv: ['claude'] }).result.address, cols: 80, rows: 24 });
  try {
    await until(() => c.conn && c.ch != null);
    assert.equal(c.autoInput, false);
    c.inputAuto('\x13');
    await until(() => kinds(fake, c.terminal).length === 1);
    assert.deepEqual(kinds(fake, c.terminal), ['data']);
  } finally { c.close(); await fake.close(); }
});

test('P130 사람 입력 판단(B1 규칙 4)은 그대로: relay 입력은 ctl.input(DATA)과 onInput으로, 3초 안이면 user_typing', () => {
  const calls = [];
  const ctl = Object.assign(new EventEmitter(), { pid: 'hc:1', exited: null, resize() {}, close() {}, focus() {}, input(d) { calls.push(['input', d]); }, inputAuto(d) { calls.push(['auto', d]); } });
  const seen = [];
  const relay = new TerminalRelay({ adapter: { openController: () => ctl }, onInput: (sid, d) => seen.push([sid, d]) });
  const client = { clientId: 'A', sendEvent: () => {} };
  relay.attach({ sessionId: 's1', paneId: 't1' }, 100, 30, client);
  relay.input('s1', 'x', client);
  assert.deepEqual(calls, [['input', 'x']]);
  assert.deepEqual(seen, [['s1', 'x']]);
  const now = Date.now();
  const view = { state: 'ready', agentPresent: true, termConnected: true, closed: false };
  assert.equal(blockReason({ ...view, lastUserInputAt: now - 1000 }, now, { inputQuietMs: 3000 }), 'user_typing');
  assert.equal(blockReason({ ...view, lastUserInputAt: now - 3500 }, now, { inputQuietMs: 3000 }), null);
});

test('P130 판이 쓰는 키 이름은 모두 바이트가 있다(hc terminal.keys의 3초 기다림으로 빠지지 않는다)', () => {
  // 키 패드(session.keys), 끄기·깨우기(ctrl+c·ctrl+d·esc·enter), 답하기(숫자·tab·esc·enter)
  for (const k of [...KEY_NAMES, 'ctrl+c', 'ctrl+d', 'ctrl+u', 'shift+tab', 'backspace']) assert.ok(keysToBytes([k]), k);
});

test('P130 Codex 되돌리는 붙여넣기: hc가 잡아 두었다가 늦게(2초 넘어) 넣어도 되돌림으로 본다', async () => {
  const codexScreen = (line) => ['>_ OpenAI Codex', '', `› ${line}`, '', '  model-x default · C:\\repo'].join('\n');
  let box = '', looks = 0, pending = null;
  // 붙여넣기는 보낸 뒤 열 번째 보기(250ms씩이면 2.5초)에 입력 칸에 보인다
  const io = { read: async () => { looks++; if (pending && looks >= pending.at) { box = pending.text; pending = null; } return codexScreen(box); }, kindOf: () => 'codex', type: async () => {}, paste: async (sid, text) => { pending = { text, at: looks + 10 }; } };
  const r = await draftMover(io, { pollMs: 0, sleep: async () => {} }).back('s1', { kind: 'codex', how: 'clear', text: 'half typed' });
  assert.deepEqual(r, { result: 'restored', by: 'board' });
  // 옛 횟수(8번)였으면 보이기 전에 그만 보고 held(not_shown)였다
  box = ''; looks = 0; pending = null;
  const old = await draftMover(io, { pollMs: 0, pastePolls: 8, sleep: async () => {} }).back('s1', { kind: 'codex', how: 'clear', text: 'half typed' });
  assert.equal(old.result, 'held'); assert.equal(old.why, 'not_shown');
});

test('P130 Codex 되돌리는 붙여넣기: 다 그려지기 전의 칸(글 일부)을 보면 더 보고, 끝까지 다르면 box_differs', async () => {
  const codexScreen = (line) => ['>_ OpenAI Codex', '', `› ${line}`, '', '  model-x default · C:\\repo'].join('\n');
  const frames = (seq) => { let i = 0; return async () => codexScreen(seq[Math.min(i++, seq.length - 1)]); };
  const io = (seq) => ({ read: frames(seq), kindOf: () => 'codex', type: async () => {}, paste: async () => {} });
  const ok = await draftMover(io(['', '', '쓰다 만', '쓰다 만 한 줄 draft']), { pollMs: 0, sleep: async () => {} }).back('s1', { kind: 'codex', how: 'clear', text: '쓰다 만 한 줄 draft' });
  assert.deepEqual(ok, { result: 'restored', by: 'board' });
  const other = await draftMover(io(['', '', 'someone typed']), { pollMs: 0, pastePolls: 3, sleep: async () => {} }).back('s1', { kind: 'codex', how: 'clear', text: 'half' });
  assert.deepEqual(other, { result: 'held', why: 'box_differs' });
});

test('P130 비키는 키와 되돌리는 키: Claude Code 비키기 Ctrl+S는 표시 없이(판 입력), 빈 칸의 꺼내기 Ctrl+S는 back(사람 입력)', async () => {
  const RULE = '─'.repeat(40);
  const claudeScreen = (line) => ['▐▛███▛█   Claude Code', '', RULE, `❯ ${line}`, RULE, '  Haiku (medium)'].join('\n');
  let box = 'half typed', stash = null;
  const typed = [];
  const io = {
    read: async () => claudeScreen(box), kindOf: () => 'claude', stashKey: true, userStash: () => false,
    type: async (sid, raw, o) => { typed.push([raw, !!(o && o.back)]); if (raw === '\x13') { if (box) { stash = box; box = ''; } else if (stash != null) { box = stash; stash = null; } } },
  };
  const m = draftMover(io, { pollMs: 0, sleep: async () => {} });
  const a = await m.aside('s1');
  assert.equal(a.state, 'moved');
  // `/` 명령을 보낸 뒤처럼 Claude Code가 되돌리지 않았다: 판이 빈 칸에서 Ctrl+S로 꺼낸다
  const r = await m.back('s1', a.held);
  assert.deepEqual(r, { result: 'restored', by: 'board' });
  assert.deepEqual(typed, [['\x13', false], ['\x13', true]]);
});
