// P111 창 단위 시험: 세션 혼자 잠재우기. 설정 › 절전의 두 칸(리포 전체, 세션 하나), 혼자 잠든 노드의 깨우기 글, 두 사전
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';
import { sleptAlone } from '../src/renderer/lib/repo-sleep.js';
import { setLanguage, t } from '../src/renderer/lib/i18n.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

test('혼자 잠든 세션: scope session인 잠든 세션만', () => {
  assert.equal(sleptAlone({ state: 'sleeping', sleep: { scope: 'session' } }), true);
  assert.equal(sleptAlone({ state: 'sleeping', sleep: { scope: 'repo' } }), false);
  assert.equal(sleptAlone({ state: 'sleeping', sleep: { at: 1 } }), false, '옛 백엔드(scope 없음)는 리포째');
  assert.equal(sleptAlone({ state: 'ready', sleep: null }), false);
  assert.equal(sleptAlone(null), false);
});

test('두 사전: sessionSleep 키가 같고 비지 않으며, 리포 칸 글은 리포 전체', () => {
  const keys = ['afterLabel', 'afterHint', 'afterNote', 'afterSet', 'afterOff', 'menuWake', 'menuWakeHint', 'wakeTitle'];
  assert.deepEqual(Object.keys(en.sessionSleep).sort(), [...keys].sort());
  assert.deepEqual(Object.keys(ko.sessionSleep).sort(), [...keys].sort());
  for (const k of keys) { assert.ok(en.sessionSleep[k].trim(), `en ${k}`); assert.ok(ko.sessionSleep[k].trim(), `ko ${k}`); }
  for (const k of ['afterHint', 'afterSet']) { assert.match(en.sessionSleep[k], /\{n\}/); assert.match(ko.sessionSleep[k], /\{n\}/); }
  assert.match(en.sleep.afterLabel, /whole/i); assert.match(ko.sleep.afterLabel, /프로젝트 전체/);
  assert.match(ko.sessionSleep.afterNote, /합니다\.$/, '한국어는 지금 말투(합니다체)');
  setLanguage('ko');
  assert.equal(t('sessionSleep.afterSet', { n: 2 }), '세션에 2분간 활동이 없으면 그 세션만 절전 모드로 전환합니다.');
  setLanguage('en');
  assert.equal(t('sessionSleep.afterSet', { n: 2 }), 'Idle sessions sleep after 2 minutes');
});

test('설정 › 절전: 리포 칸 옆에 세션 칸(sessionSleepAfterMin), 혼자 잠든 노드의 메뉴·얼굴 글', () => {
  const s = read('Settings.jsx');
  assert.match(s, /k="sleepAfterMin"/);
  assert.match(s, /k="sessionSleepAfterMin"/);
  assert.match(s, /data-field=\{`setting-\$\{k\}`\}/);
  const n = read('SessionNode.jsx');
  assert.match(n, /sleptAlone\(s\) \? 'sessionSleep\.menuWake' : 'sleep\.menuWake'/);
  assert.match(n, /sleptAlone\(s\) \? 'sessionSleep\.wakeTitle' : 'sleep\.wakeTitle'/);
  assert.match(n, /data-sleep-scope=/);
});
