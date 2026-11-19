// P141(ux2 #14~#17) 단위 시험: 다시 켜도 이어지는 기다린 시간(창 쪽), 먼 얼굴 이름 줄(CSS 자리), 선택 막대가 머리줄을 피하는 거리,
// 기본 역할의 영어 이름, 전달 칩의 draft 까닭, 같은 상태의 영어 이름 하나, 미션 맵 바닥 줄 복수형
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLanguage, translate, t } from '../src/renderer/lib/i18n.js';
import { shownRole } from '../src/renderer/lib/roles.js';
import { branchLabel } from '../src/renderer/lib/branch.js';
import { deliveryText } from '../src/renderer/lib/labels.js';
import { dockLabelParts } from '../src/renderer/lib/dock-links.js';
import { mergeEdges } from '../src/renderer/lib/mission-model.js';
import { headClearance } from '../src/renderer/lib/selbar.js';
import { inboxOf } from '../src/renderer/lib/faces.js';
import { phoneList } from '../src/renderer/lib/phone.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

test('#17 기본 역할(워커·헤드)은 영어 화면에서 영어, 사람이 준 역할은 그대로', () => {
  setLanguage('en');
  assert.equal(shownRole('워커'), 'worker');
  assert.equal(shownRole('헤드'), 'head');
  assert.equal(shownRole('reviewer'), 'reviewer');
  assert.equal(shownRole(null), null);
  const lab = branchLabel({ branch: { child: true, role: '워커', parentName: 'lead', depth: 2, order: 1, parentOpen: true } });
  assert.match(lab.text, /^@lead's worker 1 · level 2$/);
  assert.equal(dockLabelParts({ role: '워커', from: 'a', to: 'b' }, { a: 'x', b: 'y' }, { spawned: 's', directed: 'd' }).role, 'worker');
  assert.equal(mergeEdges([{ from: 'a', to: 'b', kind: 'role', label: '워커', count: 1 }])[0].role, 'worker');
  setLanguage('ko');
  assert.equal(shownRole('워커'), '워커');
  setLanguage('en');
});

test('#17 전달 칩: draft 까닭은 대기·보내는 중 모두 사전 글(원문 "(draft)"이 아니다)', () => {
  setLanguage('ko');
  assert.equal(deliveryText({ status: 'sending', reason: 'draft' }), '전송 중 (입력란에 작성 중인 글 있음)');
  assert.equal(deliveryText({ status: 'queued', reason: 'draft' }), '전송 대기 중 (입력란에 작성 중인 글 있음)');
  setLanguage('en');
  assert.doesNotMatch(deliveryText({ status: 'sending', reason: 'draft' }), /\(draft\)/);
});

test('#17 응답 필요의 영어 이름은 하나(Needs you), "Your turn"이 없다', () => {
  assert.doesNotMatch(read('locales/en.js'), /your turn/i);
  assert.equal(translate('en', 'state.waiting'), 'Needs you');
  assert.equal(translate('en', 'sb2.st_need'), 'Needs you');
});

test('#17 미션 맵 바닥 줄은 수마다 복수형', () => {
  assert.equal(translate('en', 'mmFoot.teams', { n: 1 }), '1 team');
  assert.equal(translate('en', 'mmFoot.teams', { n: 3 }), '3 teams');
  assert.equal(translate('en', 'mmFoot.sessions', { n: 1 }), '1 session');
  assert.equal(translate('ko', 'mmFoot.teams', { n: 1 }), '팀 1');
  assert.match(read('Mission.jsx'), /mmFoot\.teams/);
  assert.ok(!('sumFoot' in en.mmMap) && !('sumFoot' in ko.mmMap));
  // 두 사전에 같은 키
  for (const k of ['roles', 'mmFoot']) assert.deepEqual(Object.keys(en[k]).sort(), Object.keys(ko[k]).sort());
});

test('#14 응답 필요 순서와 시각은 waitingSince(다시 켜도 이어지는 때)를 먼저 본다', () => {
  // 다시 켠 뒤 a의 ask.since는 지금으로 바뀌었지만 waitingSince는 처음 때다. b는 그 사이에 기다리기 시작했다
  const a = { sessionId: 'a', name: 'a', state: 'trust_wait', ask: null, waitingSince: 1000, createdAt: 900, lastActivityAt: 9000 };
  const b = { sessionId: 'b', name: 'b', state: 'waiting', ask: { since: 5000 }, waitingSince: 5000, createdAt: 4000, lastActivityAt: 9000 };
  assert.deepEqual(inboxOf([b, a]).needsYou.map((s) => s.name), ['a', 'b']);
  assert.deepEqual(phoneList([b, a]).needs.map((s) => s.name), ['a', 'b']);
  assert.match(read('Sidebar.jsx'), /s\.waitingSince\) \|\| s\.lastActivityAt/);
  assert.match(read('SessionNode.jsx'), /const since = s\.waitingSince/);
});

test('#16 선택 막대가 고른 노드 머리줄을 덮으면 그만큼 아래로, 아니면 0', () => {
  const bar = { left: 500, right: 1000, top: 17, bottom: 57 };
  assert.equal(headClearance(bar, [{ left: 80, right: 1080, top: 25, bottom: 53 }]), 40); // 57 + 8 - 25
  assert.equal(headClearance(bar, [{ left: 80, right: 1080, top: 120, bottom: 148 }]), 0);
  assert.equal(headClearance(bar, [{ left: 1100, right: 1500, top: 25, bottom: 53 }]), 0); // 옆이라 안 덮는다
  assert.equal(headClearance(null, []), 0);
  const s = read('Search.jsx');
  assert.match(s, /st\.missionOpen/); // 미션 맵을 여는 동안 숨긴다
  assert.match(s, /\|\| mission\) return null/);
});

test('#16 새 그룹 이름 칸은 열릴 때 이름을 골라 둔다', () => {
  assert.match(read('Sidebar.jsx'), /el\.select\(\)/);
});

test('#15 먼 얼굴: 상태 알약이 검토 대기면 칩을 또 두지 않고, 이름이 칩보다 먼저 자리를 받는다. 절전 얼굴은 줄이 겹치지 않게', () => {
  const node = read('SessionNode.jsx');
  assert.match(node, /s\.unseen && !\(s\.state === 'ready' \|\| s\.state === 'shell_idle'\) && <span className="mt-badge review">/);
  const css = read('styles.css');
  assert.match(css, /\.mt-far-name > \.mt-far-nm \{ flex: 0 0 auto; max-width: 100%; \}/);
  assert.match(css, /\.mt-sleepface > \* \{ flex-shrink: 0; \}/);
  assert.match(css, /\.mt-sleepface \.mt-far-line\.one \{ -webkit-line-clamp: 1; \}/);
  assert.match(css, /\.mt-delivery-st \{[^}]*white-space: nowrap/);
});

test('i18n 키가 빠지지 않았다', () => {
  for (const l of ['en', 'ko']) for (const k of ['roles.worker', 'roles.head', 'mmFoot.work', 'mmFoot.sessions', 'mmFoot.teams']) assert.notEqual(translate(l, k, { n: 2 }), k);
  assert.equal(typeof t, 'function');
});
