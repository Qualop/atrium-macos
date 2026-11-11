// P66 창: 판의 이름 미리 보기(규칙, 겹침, 비우기), F2 대상, 주소 보이기, 사전의 이유 문구
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLabel, sameLabel, addressOf, renamed, renameKeyTarget, LABEL_MAX } from '../src/renderer/lib/session-name.js';
import { setLanguage, tMsg } from '../src/renderer/lib/i18n.js';

// 요약 모양: name은 보이는 이름, address는 주소, label은 사람이 정한 이름
const A = { sessionId: 'a', name: 'reviewer', address: 's12', label: 'reviewer' };
const B = { sessionId: 'b', name: 's3', address: 's3', label: null };
const C = { sessionId: 'c', name: 'Wine', address: 'p1-wine', label: 'Wine' };
const all = [A, B, C];

test('P66 창 미리 보기: 비우거나 주소면 원래 이름, 규칙·길이·all, 남의 주소·이름(대소문자 무시)', () => {
  assert.deepEqual(checkLabel('', all, A), { ok: true, label: null });
  assert.deepEqual(checkLabel('s12', all, A), { ok: true, label: null });
  assert.deepEqual(checkLabel('@lead', all, A), { ok: true, label: 'lead' });
  assert.deepEqual(checkLabel('REVIEWER', all, A), { ok: true, label: 'REVIEWER' });
  assert.equal(checkLabel('리뷰', all, A).key, 'labelBad');
  assert.equal(checkLabel('_x', all, A).key, 'labelBad');
  assert.equal(checkLabel('x'.repeat(LABEL_MAX + 1), all, A).key, 'labelTooLong');
  assert.equal(checkLabel('All', all, A).key, 'labelAll');
  assert.deepEqual(checkLabel('S3', all, A), { ok: false, key: 'labelTaken', vars: { name: 'S3', other: 's3' } });
  assert.equal(checkLabel('wine', all, A).vars.other, 'Wine');
  assert.equal(checkLabel('P1-WINE', all, A).vars.other, 'Wine', '이름을 바꾼 세션의 옛 주소도');
  assert.ok(sameLabel(A, 'reviewer') && sameLabel(B, null) && !sameLabel(A, null));
  assert.equal(addressOf(A), 's12'); assert.equal(addressOf({ name: 'x' }), 'x');
  assert.ok(renamed(A) && !renamed(B));
});

test('P66 F2: 고른 세션 노드가 하나일 때만, 조합 키·대화상자·한글 조합 중이면 아니다', () => {
  const sessions = new Map(all.map((s) => [s.sessionId, s]));
  const ev = (o = {}) => ({ key: 'F2', ...o });
  assert.equal(renameKeyTarget(ev(), { selected: ['a'], sessions }), 'a');
  assert.equal(renameKeyTarget(ev(), { selected: ['a', 'b'], sessions }), null);
  assert.equal(renameKeyTarget(ev(), { selected: ['memo:1'], sessions }), null);
  assert.equal(renameKeyTarget(ev({ ctrlKey: true }), { selected: ['a'], sessions }), null);
  assert.equal(renameKeyTarget(ev({ isComposing: true }), { selected: ['a'], sessions }), null);
  assert.equal(renameKeyTarget(ev(), { selected: ['a'], sessions, dialog: { kind: 'spawn' } }), null);
  assert.equal(renameKeyTarget({ key: 'Delete' }, { selected: ['a'], sessions }), null);
});

test('P66 사전: 이유 문구가 두 언어에 있고 값을 채운다', () => {
  for (const lang of ['ko', 'en']) {
    setLanguage(lang);
    const r = checkLabel('s3', all, A);
    const text = tMsg({ msg: { key: r.key, vars: r.vars } });
    assert.ok(text.includes('s3') && !text.includes('{'), `${lang}: ${text}`);
    assert.ok(!tMsg({ msg: { key: 'labelTooLong', vars: { max: 32 } } }).includes('{'));
  }
  setLanguage('ko');
});
