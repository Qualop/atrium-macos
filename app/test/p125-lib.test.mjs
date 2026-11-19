// P125: 사람이 닫은 세션(exit.kind 'user')은 오류가 아니다, 사이드바 다시 열기, 끌어 고르면 복사·고른 글이 있으면 Ctrl+C는 복사만
import test from 'node:test';
import assert from 'node:assert/strict';
import { exitKindOf, userClosed, problemExit, canReopen } from '../src/renderer/lib/user-close.js';
import { bucketOf, countOf, buildRows } from '../src/renderer/lib/sidebar-tree.js';
import { inboxOf } from '../src/renderer/lib/faces.js';
import { EXIT_LABEL } from '../src/renderer/lib/labels.js';
import { setLanguage, t } from '../src/renderer/lib/i18n.js';
import { keyAction, clearsSelection, copyOnRelease } from '../src/renderer/lib/term-input.js';

const ex = (kind, extra = {}) => ({ sessionId: `id-${kind}`, name: kind, kind: 'claude', state: 'exited', exit: { kind, reason: null, at: 1 }, workspaceKey: 'a', createdAt: 1, ...extra });

test('P125 끝남 가르기: 직접 종료(user)·판이 끈 것(normal)은 오류가 아니고, 나머지는 오류', () => {
  assert.equal(exitKindOf(ex('user')), 'user');
  assert.equal(exitKindOf({ state: 'ready', exit: { kind: 'user' } }), null); // 다시 뜬 세션의 옛 값은 보지 않는다
  assert.equal(userClosed(ex('user')), true); assert.equal(userClosed(ex('other')), false);
  for (const k of ['user', 'normal']) assert.equal(problemExit(ex(k)), false, k);
  for (const k of ['other', 'trust_declined', 'terminal_stopped']) assert.equal(problemExit(ex(k)), true, k);
  assert.equal(problemExit({ state: 'error' }), false); // 턴 오류는 따로(state error)
});

test('P125 사이드바 묶음·세는 값·문제 목록: 직접 종료는 오류 묶음·문제 알약에 들지 않는다', () => {
  assert.equal(bucketOf(ex('user')), 'idle');
  assert.equal(bucketOf(ex('normal')), 'idle');
  assert.equal(bucketOf(ex('other')), 'error');
  assert.equal(bucketOf({ state: 'error' }), 'error');
  const list = [ex('user'), ex('other')];
  assert.deepEqual(countOf(list), { sessions: 2, need: 0, error: 1, working: 0, idle: 1, sleeping: 0 });
  assert.deepEqual(inboxOf(list).problems.map((s) => s.name), ['other']);
  // 사람이 봐야 하는 줄(attn)도 오류만: 직접 종료 줄은 질문 줄이 없다
  const rows = buildRows({ workspaces: [{ key: 'a', name: 'a' }], groups: [], sessions: list }).rows;
  const byName = (n) => rows.find((r) => r.type === 'session' && r.s.name === n);
  assert.ok(byName('user') && !byName('user').attn);
  assert.ok(byName('other') && byName('other').attn);
});

test('P125 다시 열기 단추: 끝난 에이전트 세션만(셸·도는 세션·깨우는 중은 아님)', () => {
  assert.equal(canReopen(ex('user')), true);
  assert.equal(canReopen(ex('other')), true); // 오류로 끝난 것도 같은 자리에서 다시 연다
  assert.equal(canReopen(ex('user', { kind: 'shell' })), false);
  assert.equal(canReopen(ex('user', { waking: { at: 1 } })), false);
  assert.equal(canReopen({ state: 'ready', kind: 'claude' }), false);
  assert.equal(canReopen(null), false);
});

test('P125 화면 글: 두 사전에 직접 종료·다시 열기', () => {
  setLanguage('en');
  assert.equal(EXIT_LABEL.user, 'Closed by you');
  assert.equal(t('userClose.reopen'), 'Reopen');
  assert.match(t('userClose.reopenedResume', { name: 'c1' }), /@c1/);
  setLanguage('ko');
  assert.equal(EXIT_LABEL.user, '직접 종료');
  assert.equal(t('userClose.reopen'), '다시 열기');
  assert.equal(t('backend.chgExitUser'), '직접 종료'); // 복귀 요약(changes.mjs)
  setLanguage('en');
});

test('P125 복사 키: 고른 글이 있으면 Ctrl+C는 복사(터미널로 보내지 않음), 없으면 ^C. Ctrl+Shift+C는 그대로 복사', () => {
  const k = (key, mods = {}) => ({ type: 'keydown', key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
  assert.equal(keyAction(k('c', { ctrlKey: true }), true), 'copy');
  assert.equal(keyAction(k('c', { ctrlKey: true }), false), 'pass');
  assert.equal(keyAction(k('C', { ctrlKey: true, shiftKey: true }), false), 'copy');
  assert.equal(keyAction(k('C', { ctrlKey: true, shiftKey: true }), true), 'copy');
  // 복사로는 선택을 지우지 않는다: 두 번째 Ctrl+C도 복사(복사하려고 두 번 눌러 세션이 끝나던 것을 막는다)
  assert.equal(clearsSelection('copy'), false);
  let hasSel = true;
  const seq = [1, 2, 3].map(() => { const a = keyAction(k('c', { ctrlKey: true }), hasSel); if (a === 'copy' && clearsSelection('copy', { hasSelection: hasSel })) hasSel = false; return a; });
  assert.deepEqual(seq, ['copy', 'copy', 'copy']);
  // 고르기를 끝내면(Esc, 글 입력, 밖 누르기) 다시 ^C
  assert.equal(keyAction(k('Escape'), true), 'clear-selection');
  for (const e of ['escape', 'input', 'outside', 'paste']) assert.equal(clearsSelection(e), true, e);
  assert.equal(keyAction(k('c', { ctrlKey: true }), false), 'pass');
});

test('P125 끌어 고르면 복사: 놓을 때 고른 글이 있을 때만(그냥 누르기·빈칸만은 아님)', () => {
  assert.equal(copyOnRelease({ hasSelection: true, text: 'hello' }), true);
  assert.equal(copyOnRelease({ hasSelection: false, text: 'hello' }), false);
  assert.equal(copyOnRelease({ hasSelection: true, text: '   \n  ' }), false);
  assert.equal(copyOnRelease({}), false);
});
