// P46: atrium 스킬의 워커 이름 짓기 안내(번호 이름 대신 맡긴 일에 맞는 이름, 판의 이름 규칙, 겹치면 다시 짓기)
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardSkill, delegateSkill, CHILD_NAME_RE } from '../src/branch.mjs';

test('P46: 스킬 글 — 이름은 맡긴 일·역할을 말하고, 번호 이름은 하찮은 일에만, 예는 몇 개만', () => {
  const s = boardSkill();
  assert.match(s, /무슨 일을 맡은 워커인지 알 수 있게 네가 생각해서 짓는다/);
  assert.match(s, /w1·ds1 같은 번호 이름은 일이 정말 하찮을 때만/);
  assert.match(s, /예를 외우지 말고 이번 일에 맞게 짓는다/);
  const ex = s.match(/\(예: ([^)]+)\)\. w1/);
  assert.ok(ex, '예시 줄');
  const names = ex[1].split(', ');
  assert.ok(names.length >= 3 && names.length <= 6, `예시 ${names.length}개`);
  for (const n of names) assert.ok(CHILD_NAME_RE.test(n), `예시도 판의 이름 규칙에 맞는다: ${n}`);
  assert.ok(!/예: w1/.test(s), '번호 이름을 예로 들지 않는다');
  // 판의 이름 규칙은 그대로, 겹치면 다시 짓는다
  assert.match(s, /영문 소문자로 시작, 소문자·숫자·-·_ 만, 32자까지, 판 전체에서 하나/);
  assert.match(s, /`name_taken`\)이 오면 다른 이름으로 다시 짓는다/);
  assert.equal(delegateSkill().split('\n---\n')[1], s.split('\n---\n')[1], '옛 이름 스킬도 같은 글');
  assert.ok(Buffer.byteLength(s) < 7000, `스킬 글 ${Buffer.byteLength(s)}바이트`);
});
