// P126 시험: 노드 위 휠이 남긴 마우스 보고 글과 판의 전달.
// - 터미널이 대신 보낸 보고(휠·초점·장치 속성)만 든 입력은 사람 입력(전달 규칙 4)으로 세지 않는다
// - 입력 칸 앞에 마우스 보고 글(`[<65;101;61M`)이 붙어 있어도 나머지가 보낸 글이면 '우리 글'로 보고 Enter를 누른다
// - 입력 칸에 다른 글이 끝까지 남으면 조용히 기다리지 않고 곧바로 "제출 안 됨"(unconfirmed, input_box_other)으로 끝낸다
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue } from '../src/delivery.mjs';
import { promptOnScreen, mouseNoise } from '../src/screen.mjs';
import { terminalReportsOnly, draftAfterInput } from '../src/sleep.mjs';

const cfg = { submitConfirmMs: 30000, deliveryMaxWaitMs: 900000, inputQuietMs: 3000, submitRetryMs: 6000, submitRetries: 2 };
const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const fakeStore = () => ({ rows: new Map(), activeDeliveries: () => [], insertDelivery(d) { this.rows.set(d.deliveryId, { ...d }); }, updateDelivery(id, p) { const r = this.rows.get(id) || {}; Object.assign(r, { status: p.status, reason: p.reason ?? null }); }, getDelivery(id) { return this.rows.get(id) || null; } });
const ASK = 'Reply with the single word ok-w1 and do nothing else.';
const JUNK = '[<65;101;61M';
const RULE = '─'.repeat(40);
const claudeScreen = (box) => ['▐▛███▛█   Claude Code', '', RULE, `❯ ${box}`, RULE, '  Haiku (medium)'].join('\n');
const codexScreen = (box) => ['>_ OpenAI Codex', '', `› ${box}`, '', '  model-x default · C:\\repo', '  ? for shortcuts'].join('\n');
const long = (n) => { let s = ''; let i = 0; while (s.length < n) s += `P126 delivery probe line ${++i}.\n`; return s.slice(0, n); };

function rig(t, { look, view = {} }) {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const log = { sent: [], enter: 0, inspect: 0, recover: [], events: [], notSubmitted: [] };
  const v = { state: 'ready', agentPresent: true, termConnected: true, closed: false, lastUserInputAt: 0, ...view };
  const q = new DeliveryQueue({
    store: fakeStore(), cfg, view: () => v,
    send: async (sid, text) => { log.sent.push(text); },
    inspect: async () => { log.inspect++; return look(); }, pressEnter: async () => { log.enter++; },
  });
  q.on('delivery', (d) => log.events.push(`${d.status}${d.reason ? `(${d.reason})` : ''}`));
  q.on('recover', (r) => log.recover.push(r));
  q.on('not_submitted', (r) => log.notSubmitted.push(r));
  const step = async (ms) => { t.mock.timers.tick(ms); q.pump(); await tick(); };
  return { q, log, v, step };
}

test('P126 터미널 보고뿐인 입력(휠·누르기·움직임·초점·장치 속성·커서 자리·OSC 답)은 사람 입력이 아니다. 글자·Enter·붙여 넣기는 사람 입력', () => {
  for (const d of ['\x1b[<65;101;61M', '\x1b[<64;89;17M\x1b[<64;89;17M\x1b[<64;89;17M', '\x1b[<35;89;12M', '\x1b[<0;3;4m', '\x1b[I', '\x1b[O', '\x1b[I\x1b[<35;89;12M\x1b[<65;89;12M', '\x1b[>0;276;0c', '\x1b[?62;22c', '\x1b[12;40R', '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\', '\x1b[M`!!']) {
    assert.equal(terminalReportsOnly(d), true, JSON.stringify(d));
    assert.equal(draftAfterInput(false, d), false, `P120 판정과 같다 ${JSON.stringify(d)}`);
  }
  for (const d of ['a', '\r', '\x03', '\x1b[200~hi\x1b[201~', '\x1b[A', '\x1b', '\x1b[<65;101;61Mx', '[<65;101;61M', '']) assert.equal(terminalReportsOnly(d), false, JSON.stringify(d));
});

test('P126 입력 칸 앞뒤의 마우스 보고 글은 떼고 견준다: 보낸 글이면 ours(noise에 남김), 그것뿐이면 empty, 사람 글이면 other', () => {
  const text = long(1273);
  // 실제로 본 화면(Codex): 쓰레기 뒤에 판이 넣은 긴 글이 접혀 있다
  assert.deepEqual(promptOnScreen(codexScreen(`${JUNK}[Pasted Content 1274 chars]`), text, 'codex'), { box: 'ours', seen: false, noise: JUNK });
  assert.equal(promptOnScreen(codexScreen(`${JUNK}${JUNK}${ASK}`), ASK, 'codex').box, 'ours', '여러 번');
  assert.equal(promptOnScreen(claudeScreen(`${JUNK}${ASK}`), ASK).box, 'ours', 'Claude Code도');
  assert.equal(promptOnScreen(claudeScreen(`${ASK}${JUNK}`), ASK).box, 'ours', '뒤에 붙은 것');
  assert.deepEqual(promptOnScreen(codexScreen(JUNK), ASK, 'codex'), { box: 'empty', seen: false, noise: JUNK });
  assert.equal(promptOnScreen(codexScreen(`${JUNK}사람이 쓰는 글`), ASK, 'codex').box, 'other');
  assert.equal(promptOnScreen(codexScreen('[<b>] 사람의 글 [1;2;3]'), ASK, 'codex').box, 'other', '비슷한 꼴의 사람 글은 떼지 않는다');
  assert.equal(mouseNoise(`a${JUNK}b[<0;3;4m`), `${JUNK}[<0;3;4m`);
  // 고치기 전 판정: 쓰레기가 앞에 있으면 other였다(그래서 판이 손대지 않고 조용히 끝났다)
  assert.equal(promptOnScreen(codexScreen(`${JUNK}[Pasted Content 1274 chars]`).replace(JUNK, 'x'), text, 'codex').box, 'other');
});

test('P126 전달: 입력 칸에 쓰레기 + 보낸 글이 남았으면 3초 뒤 Enter 한 번(다시 보내지 않는다), 기록에 noise', async (t) => {
  const text = long(1273);
  let submitted = false;
  const { q, log, step } = rig(t, { look: () => (submitted ? { box: 'empty', seen: true } : { box: 'ours', seen: false, noise: JUNK }) });
  const d = q.enqueue('s', text);
  await tick();
  assert.equal(d.status, 'sent');
  await step(3500);
  assert.equal(log.enter, 1, 'Enter 한 번');
  assert.equal(log.recover[0].action, 'enter'); assert.equal(log.recover[0].noise, JUNK);
  submitted = true; q.onAgentWorking('s');
  assert.equal(d.status, 'confirmed');
  assert.deepEqual(log.sent, [text], '다시 보내지 않는다');
});

test('P126 전달: 입력 칸에 다른 글이 끝까지 남으면 지우지도 Enter도 하지 않고 곧바로 unconfirmed(input_box_other), not_submitted를 알린다', async (t) => {
  const { q, log, step } = rig(t, { look: () => ({ box: 'other', seen: false, peek: `${JUNK}사람이 쓰는 글` }) });
  const d = q.enqueue('s', ASK);
  await tick();
  let at = 0;
  for (let i = 0; i < 60 && d.status === 'sent'; i++) { await step(1000); at = i + 1; }
  assert.equal(d.status, 'unconfirmed'); assert.equal(d.reason, 'input_box_other');
  assert.ok(at < 20, `같은 글이 세 번 보이면 끝낸다(확인 기한 30초를 기다리지 않는다): ${at}초`);
  assert.equal(log.enter, 0); assert.deepEqual(log.sent, [ASK], '사람의 글에 손대지 않는다');
  assert.equal(log.notSubmitted.length, 1); assert.equal(log.notSubmitted[0].peek, `${JUNK}사람이 쓰는 글`);
  assert.equal(log.events.at(-1), 'unconfirmed(input_box_other)');
  const n = log.inspect;
  for (let i = 0; i < 10; i++) await step(1000);
  assert.equal(log.inspect, n, '끝난 뒤에는 더 보지 않는다');
});

test('P126 전달 규칙 4: 휠 보고만 온 터미널은 사람이 치는 중이 아니다(백엔드 relay가 lastUserInputAt을 바꾸지 않는다)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/backend.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(!terminalReportsOnly\(data\)\) s\.lastUserInputAt = Date\.now\(\)/);
});
