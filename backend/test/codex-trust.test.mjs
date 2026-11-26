// 2026-11-23 시험: Codex가 처음 쓰는 폴더면 신뢰를 묻는다. 그 화면에서는 터미널이 Codex를 에이전트로 알아보지 못해 세션이 시작 중(starting)으로 남았고,
// atrium answer <Codex 세션> 1은 answer_in_terminal로 거부됐다(DesignSkill 밤샘 실행: 지휘 세션이 atrium input으로 Enter를 쳐서 넘겼다).
// 판은 신뢰 화면을 읽어 trust_wait로 보이고, 사람이나 지휘 세션이 atrium answer로 답할 수 있다. 판이 저절로 답하지는 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCodexTrustDialog, isTrustDialog, parseChoices } from '../src/screen.mjs';
import { deriveState, newRuntime } from '../src/state.mjs';
import { blockReason } from '../src/delivery.mjs';
import { Backend } from '../src/backend.mjs';

// codex-cli 0.169.1 실제 화면(120x40, 맨 위 줄은 지난 출력의 찌꺼기). 폴더만 바꿨다
const SCREEN_0169 = (sel = 1) => [
  ' 0 q',
  '  Folder access',
  '  /Users/me/Tasks/DesignSkill',
  '',
  '  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings',
  '  can run code automatically, even without a model request. Continue only if you trust these files. Your trust',
  '  decision will be saved.',
  '',
  `${sel === 1 ? '›' : ' '} 1. Trust and continue`,
  `${sel === 2 ? '›' : ' '} 2. Back to Agent Command Center`,
  '',
  '  enter continue · esc back',
].join('\n');
// 옛 Codex 화면들
const SCREEN_OLD = [
  '> You are in /Users/me/Tasks/X',
  '',
  '  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.',
  '',
  '› 1. Yes, continue',
  '  2. No, quit',
  '',
  '  Press enter to continue',
].join('\n');
const SCREEN_OLDER = [
  '> You are running Codex in /Users/me/Tasks/X',
  '',
  '  Since this folder is version controlled, you may wish to allow Codex to work in this folder without asking for approval.',
  '',
  '› 1. Yes, allow Codex to work in this folder without asking for approval',
  '  2. No, ask me to approve edits and commands',
  '',
  '  Press enter to continue',
].join('\n');
const COMPOSER = [
  '╭───────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.169.1)            │',
  '│ directory: ~/Tasks/DesignSkill        │',
  '╰───────────────────────────────────────╯',
  '',
  '  Trust this folder? 라는 글을 사람이 입력 칸에 썼다',
  '',
  '› Ask Codex to do anything',
  '',
  '  gpt-6 high · ~/Tasks/DesignSkill',
].join('\n');

test('Codex 신뢰 화면 읽기: 0.169 문장과 옛 문장, 번호 선택지(› 고른 줄)', () => {
  assert.equal(isCodexTrustDialog(SCREEN_0169()), true);
  assert.equal(isCodexTrustDialog(SCREEN_OLD), true);
  assert.equal(isCodexTrustDialog(SCREEN_OLDER), true);
  assert.equal(isCodexTrustDialog(COMPOSER), false, '평소 입력 화면(선택지 없음)');
  assert.equal(isCodexTrustDialog(''), false);
  const narrow = ['  Trust this folder? Codex', '  can read, edit, and run', '  files here.', '', '› 1. Trust and continue', '  2. Quit'].join('\n');
  assert.equal(isCodexTrustDialog(narrow), true, '좁은 카드에서 꺾인 문장');
  assert.equal(isTrustDialog(SCREEN_0169()), false, 'Claude 신뢰 화면 판단은 그대로');
  assert.deepEqual(parseChoices(SCREEN_0169()).map((c) => [c.n, c.label, c.selected]), [[1, 'Trust and continue', true], [2, 'Back to Agent Command Center', false]]);
  assert.deepEqual(parseChoices(SCREEN_0169(2)).map((c) => c.selected), [false, true]);
});

test('상태: Codex에 신뢰 화면 표시가 있으면 터미널이 알아보기 전(상태 없음)·blocked에도 trust_wait, 돌기 시작하면 따르지 않는다', () => {
  const rt = newRuntime({ kind: 'codex', hooked: false });
  assert.equal(deriveState(rt).state, 'starting', '고치기 전에는 신뢰 화면에서도 여기 머물렀다');
  rt.trustScreen = { at: 1, kind: 'codex' };
  assert.equal(deriveState(rt).state, 'trust_wait');
  rt.term.status = 'blocked';
  assert.equal(deriveState(rt).state, 'trust_wait');
  for (const s of ['idle', 'done']) { rt.term.status = s; assert.equal(deriveState(rt).state, 'ready', s); }
  rt.term.status = 'working';
  assert.equal(deriveState(rt).state, 'working');
  const other = newRuntime({ kind: 'gemini', hooked: false });
  other.trustScreen = { at: 1 };
  assert.equal(deriveState(other).state, 'starting', '다른 종류는 그대로');
});

test('전달: trust_wait인 Codex는 터미널이 에이전트를 알아보기 전이어도 trust_wait로 기다린다(no_agent가 아니다)', () => {
  assert.equal(blockReason({ state: 'trust_wait', agentPresent: false, termConnected: true, closed: false }, 0, { inputQuietMs: 3000 }), 'trust_wait');
});

// 가짜 판: 화면은 screens[]에서 차례로(마지막 것은 계속), 키는 keys에
function fakeB({ screens, kind = 'codex', trust = true, hooked = false }) {
  const keys = [], events = [], broadcasts = [];
  const rt = newRuntime({ kind, hooked });
  if (trust) rt.trustScreen = { at: 1, kind: 'codex' };
  const s = { sessionId: 's1', name: 'review-a', kind, paneId: 'p1', agentName: 'review-a', rt };
  let i = 0;
  const b = {
    sessions: new Map([['s1', s]]), killing: new Set(), cfg: { answerStepMs: 0 },
    resolve: () => s, requireTerminal() {}, touch() {}, log() {},
    broadcastSession: (x, o) => broadcasts.push(o && o.cause),
    store: { addEvent: (sid, kind2, data) => events.push({ kind: kind2, data }) },
    api: { broadcast: (ev, d) => broadcasts.push(ev) },
    adapter: { readScreen: async () => screens[Math.min(i++, screens.length - 1)], paneKeys: async (p, k) => { keys.push(k.join('+')); } },
  };
  for (const k of ['answer', 'answerCodexTrust', 'checkCodexTrust', 'hooked', 'currentSession']) b[k] = Backend.prototype[k].bind(b);
  return { b, s, keys, events, broadcasts };
}

test('화면 보기: 시작 중인 Codex가 신뢰 화면이면 trust_wait로 두고 기록하며, 화면이 사라지면 지운다', async () => {
  const { b, s, events, broadcasts } = fakeB({ screens: [SCREEN_0169(), SCREEN_0169(), COMPOSER], trust: false });
  await b.checkCodexTrust(s);
  assert.equal(deriveState(s.rt).state, 'trust_wait');
  assert.equal(events.filter((e) => e.kind === 'trust_dialog').length, 1);
  assert.equal(events[0].data.kind, 'codex');
  await b.checkCodexTrust(s); // 같은 화면: 다시 기록하지 않는다
  assert.equal(events.filter((e) => e.kind === 'trust_dialog').length, 1);
  await b.checkCodexTrust(s);
  assert.equal(s.rt.trustScreen, null);
  assert.equal(deriveState(s.rt).state, 'starting');
  assert.deepEqual(broadcasts, ['codex:trust', 'codex:trust_gone']);
});

test('화면 보기: 이미 돌고 있는 Codex(ready)는 화면을 읽지 않는다', async () => {
  const { b, s, events } = fakeB({ screens: [SCREEN_0169()], trust: false });
  s.rt.term.status = 'idle';
  await b.checkCodexTrust(s);
  assert.equal(s.rt.trustScreen, null);
  assert.equal(events.length, 0);
});

test('atrium answer <Codex> 1: 고른 줄이 1이면 Enter만(고치기 전: answer_in_terminal)', async () => {
  const { b, keys, events } = fakeB({ screens: [SCREEN_0169(1)] });
  const r = await b.answer({ session: 'review-a', choice: 1 });
  assert.deepEqual(r, { sent: true, label: '1. Trust and continue', steps: ['enter'] });
  assert.deepEqual(keys, ['enter']);
  assert.equal(events.at(-1).kind, 'answer');
  assert.equal(events.at(-1).data.kind, 'codex_trust');
});

test('atrium answer <Codex> 2: 번호로 고른 뒤 화면이 그대로면 Enter, 번호로 바로 넘어갔으면 Enter를 치지 않는다', async () => {
  let x = fakeB({ screens: [SCREEN_0169(1), SCREEN_0169(2)] });
  assert.deepEqual(await x.b.answer({ session: 'review-a', choice: 2 }), { sent: true, label: '2. Back to Agent Command Center', steps: ['2', 'enter'] });
  assert.deepEqual(x.keys, ['2', 'enter']);
  x = fakeB({ screens: [SCREEN_OLD, COMPOSER] });
  x.s.rt.trustScreen = { at: 1 };
  // 옛 화면에서 1이 이미 골라져 있다 → Enter
  assert.deepEqual((await x.b.answer({ session: 'review-a', choice: 1 })).steps, ['enter']);
  x = fakeB({ screens: [SCREEN_0169(2), COMPOSER] });
  assert.deepEqual((await x.b.answer({ session: 'review-a', choice: 1 })).steps, ['1'], '번호로 넘어갔다(화면이 사라짐)');
});

test('atrium answer <Codex>: 화면이 이미 사라졌으면 키를 넣지 않고, 번호가 아니거나 범위 밖이면 거부한다', async () => {
  let x = fakeB({ screens: [COMPOSER] });
  assert.deepEqual(await x.b.answer({ session: 'review-a', choice: 1 }), { sent: false, reason: 'no_pending_ask' });
  assert.deepEqual(x.keys, []);
  assert.equal(x.s.rt.trustScreen, null);
  x = fakeB({ screens: [SCREEN_0169()] });
  await assert.rejects(x.b.answer({ session: 'review-a', choice: 'reject' }), (e) => e.code === 'bad_request');
  await assert.rejects(x.b.answer({ session: 'review-a', choice: 3 }), (e) => e.code === 'bad_request');
  assert.deepEqual(x.keys, []);
  // 고른 번호가 화면에서 골라지지 않았으면 Enter를 치지 않는다(다른 선택지가 들어가지 않게)
  x = fakeB({ screens: [SCREEN_0169(1), SCREEN_0169(1)] });
  assert.deepEqual(await x.b.answer({ session: 'review-a', choice: 2 }), { sent: false, reason: 'not_selected', steps: ['2'] });
  assert.deepEqual(x.keys, ['2']);
});

test('신뢰 화면 표시가 없는 hook 없는 세션은 그대로 answer_in_terminal', async () => {
  const { b } = fakeB({ screens: [SCREEN_0169()], trust: false });
  await assert.rejects(b.answer({ session: 'review-a', choice: 1 }), (e) => e.code === 'answer_in_terminal');
});
