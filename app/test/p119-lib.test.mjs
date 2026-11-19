// P119 단위 시험: "확인할 결과" → "작업 완료"(Review → Done) 두 사전, 작업 완료는 맨 위 세션만(백엔드 요약 unseen을 따른다),
// 미션 맵·휴대폰 미션 맵의 작업 완료 카드 표식(움직이지 않는 꼬리표·테두리), 휴대폰 머리 칩
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';
import { translate } from '../src/renderer/lib/i18n.js';
import { inboxOf } from '../src/renderer/lib/faces.js';
import { tierOf } from '../src/renderer/lib/overview.js';
import { toneOf } from '../src/renderer/lib/phone.js';
import { inFocus } from '../src/renderer/lib/phone-graph.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const p119Block = (css) => { const i = css.lastIndexOf('/* ---------- P119'); assert.ok(i >= 0, 'P119 덩어리'); const j = css.indexOf('/* ---------- P', i + 10); return css.slice(i, j < 0 ? undefined : j); }; // P127: 뒤 덩어리(움직임 멈춤)는 빼고

test('이름: 작업 완료 / Done (받은 함, 노드, 칸반, 미션 맵, 영역, 사이드바, 휴대폰)', () => {
  for (const k of ['top.review', 'node.review', 'kanban.review', 'mission.cat.done', 'mmMap.sumReview', 'doneMark.tag']) {
    assert.equal(translate('ko', k), '작업 완료', k);
    assert.equal(translate('en', k), 'Done', k);
  }
  assert.equal(translate('ko', 'regions.review', { n: 3 }), '작업 완료 3개');
  assert.equal(translate('en', 'regions.review', { n: 3 }), 'Done 3');
  assert.equal(translate('ko', 'doneMark.phone', { n: 2 }), '작업 완료 2');
  assert.match(translate('ko', 'top.wsTitle', { kind: '', root: '', sessions: 1, shells: 0, working: 0, needsYou: 0, review: 4 }), /작업 완료 4개/);
  assert.match(translate('en', 'wsGroupTab.title', { name: 'g', n: 2, kind: '', sessions: 1, shells: 0, working: 0, needsYou: 0, review: 4 }), /done 4/);
  // 옛 이름이 화면 사전에 남지 않았다
  const flat = (o) => Object.values(o).flatMap((v) => (v && typeof v === 'object' ? flat(v) : [String(v)]));
  assert.equal(flat(ko).filter((x) => x.includes('확인할 결과')).length, 0);
  assert.ok(!/'Review'/.test(read('locales/en.js').replace(/check: 'Review'/, '')), 'en에 Review가 남음');
});

test('작업 완료는 백엔드 요약의 unseen만 센다: 하위 세션(unseenSub)은 받은 함·미션 맵·휴대폰 점에 들지 않는다', () => {
  const lead = { sessionId: 'l', state: 'ready', unseen: true, turn: { endedAt: 2 } };
  const worker = { sessionId: 'w', state: 'ready', unseen: false, unseenSub: true, turn: { endedAt: 1 } };
  const asking = { sessionId: 'q', state: 'waiting', unseen: false, ask: { since: 1 }, parentSessionId: 'l' };
  const inbox = inboxOf([lead, worker, asking]);
  assert.deepEqual(inbox.review.map((s) => s.sessionId), ['l']);
  assert.deepEqual(inbox.needsYou.map((s) => s.sessionId), ['q']); // 워커의 응답 필요는 그대로
  assert.equal(tierOf(worker), 'rest'); assert.equal(tierOf(lead), 'review');
  assert.equal(toneOf(worker), 'ready'); assert.equal(toneOf(lead), 'review');
  // 노드를 열면 하위 세션의 안 본 턴도 봤음으로 친다
  assert.match(read('store.js'), /s\.unseen \|\| s\.unseenSub/);
});

test('미션 맵: 작업 완료 카드의 꼬리표(모양과 글), 굵은 보라 테두리와 왼쪽 띠, 머리 개수 알약. 움직임 없음', () => {
  const css = p119Block(read('styles.css'));
  assert.match(css, /\.mt-mm-card\.t-review \{[^}]*inset 3px 0 0 var\(--st-review\)/);
  assert.match(css, /\.mt-mm-donetag \{[^}]*position: absolute; top: -8px/);
  assert.match(css, /\.mt-mm-filter\.c-done:not\(\[data-n="0"\]\) \.mt-mm-fn/);
  assert.ok(!/animation|transition/.test(css), '움직이지 않는다(움직임 줄이기에서도 같다)');
  const jsx = read('Mission.jsx');
  assert.match(jsx, /tier === 'review' && <span className="mt-mm-donetag" data-role="mm-done"><DoneMark \/>\{t\('doneMark\.tag'\)\}/);
  // 휴대폰도 같은 모양과 머리 칩
  const pcss = p119Block(read('phone.css'));
  assert.match(pcss, /\.mt-pm-donetag \{[^}]*position: absolute/);
  assert.match(pcss, /\.mt-pm-chip\.t-review/);
  assert.ok(!/animation|transition/.test(pcss));
  const pj = read('PhoneMission.jsx');
  assert.match(pj, /data-role="pm-done"/);
  assert.match(pj, /data-action="pm-focus-review"/);
  assert.equal(inFocus('review', 'review'), true); assert.equal(inFocus('review', 'work'), false);
  assert.equal(inFocus('turn', 'alert'), true); assert.equal(inFocus('work', 'work'), true);
});
