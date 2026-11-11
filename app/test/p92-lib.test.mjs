// P92 단위 시험: 휴대폰 알림 시트의 하위 세션(워커) 알림 고르기와 세션 하나 끄기(lib/push.js), 두 사전의 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUB_MODES, subModeOf, isMuted } from '../src/renderer/lib/push.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

test('하위 세션 알림: 세 가지(응답 필요만이 기본), 모르는 값은 기본으로', () => {
  assert.deepEqual(SUB_MODES, ['need', 'all', 'off']);
  assert.equal(subModeOf(undefined), 'need');
  assert.equal(subModeOf('bogus'), 'need');
  assert.equal(subModeOf('off'), 'off');
  assert.equal(subModeOf('all'), 'all');
});

test('세션 하나 끄기: 기기 상태의 muted 목록', () => {
  assert.equal(isMuted(null, 's1'), false);
  assert.equal(isMuted({ muted: [] }, 's1'), false);
  assert.equal(isMuted({ muted: ['s1'] }, 's1'), true);
  assert.equal(isMuted({ muted: 'x' }, 's1'), false);
});

test('두 사전에 같은 글 열쇠가 있고, 끝남 설명이 "모두 끝났을 때"로 바뀌었다', () => {
  const keys = ['title', 'hint', 'mute', 'unmute', 'muted', 'unmuted', ...SUB_MODES.map((m) => `mode_${m}`)];
  for (const d of [en, ko]) for (const k of keys) assert.equal(typeof d.pushSub[k], 'string', k);
  assert.deepEqual(Object.keys(en.pushSub).sort(), Object.keys(ko.pushSub).sort());
  assert.match(ko.push.kind_done, /모두/);
  assert.match(en.push.kind_done, /All/);
});
