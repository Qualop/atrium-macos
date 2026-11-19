// P103 나무 모양 사이드바의 순수 함수: 줄마다 나무 단계(들여쓰기와 세로 안내선 수), 머리줄 오른쪽 상태 수(응답 필요·오류는 늘, 작업 중은 접혔을 때만)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRows, levelOf, headBadges, MAX_INDENT, TREE, ROW_H } from '../src/renderer/lib/sidebar-tree.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const WS = (key, name = key, kind = 'folder') => ({ key, name, kind, root: `C:/${name}` });
let seq = 0;
const S = (name, ws, state = 'ready', extra = {}) => ({ sessionId: `id-${name}`, name, kind: 'claude', state, workspaceKey: ws, lastActivityAt: 1000 + seq++, ...extra });
const lv = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.lv]));

test('P103 사이드바: 나무 단계는 그룹 0 → 워크스페이스 1 → 세션 2 → 하위 세션 3, 그룹이 없으면 한 단계 위로', () => {
  const workspaces = [WS('a'), WS('b')];
  const groups = [{ id: 'g1', name: 'G', members: ['a'] }];
  const sessions = [S('lead', 'a', 'working'), S('w1', 'a', 'working', { parentSessionId: 'id-lead' }), S('w2', 'a', 'waiting', { parentSessionId: 'id-w1' }), S('b1', 'b')];
  const { rows } = buildRows({ workspaces, groups, sessions });
  const L = lv(rows);
  assert.equal(L['g:g1'], 0);
  assert.equal(L['w:a'], 1);
  assert.equal(L['s:id-lead'], 2);
  assert.equal(L['s:id-w1'], 3, '하위 세션은 부모보다 한 단계 더');
  assert.equal(L['s:id-w2'], 4, '하위의 하위는 또 한 단계');
  assert.equal(L['g:'], 0, '"그룹 없음"도 머리줄 단계');
  assert.equal(L['w:b'], 1);
  assert.equal(L['s:id-b1'], 2);
  // 그룹이 하나도 없으면 워크스페이스가 맨 위 단계
  const flat = lv(buildRows({ workspaces, groups: [], sessions }).rows);
  assert.equal(flat['w:a'], 0);
  assert.equal(flat['s:id-lead'], 1);
  assert.equal(flat['s:id-w1'], 2);
  // 줄마다 lv가 있고 levelOf와 같다(가상 목록 칸이 그 수만큼 안내선을 긋는다)
  for (const r of rows) assert.equal(r.lv, levelOf(r), r.id);
});

test('P103 사이드바: 하위 세션 들여쓰기는 MAX_INDENT단계에서 멈춘다', () => {
  const chain = [S('s0', 'a')];
  for (let i = 1; i < 9; i++) chain.push(S(`s${i}`, 'a', 'ready', { parentSessionId: `id-s${i - 1}` }));
  const { rows } = buildRows({ workspaces: [WS('a')], sessions: chain });
  const deepest = Math.max(...rows.filter((r) => r.type === 'session').map((r) => r.lv));
  assert.equal(deepest, 1 + MAX_INDENT);
});

test('P103 사이드바: 닫힌 세션·판 밖 대화 줄은 세션과 같은 단계, 펼친 절 이름과 항목은 한 단계 더, 접힌 곳의 "n개 더"는 세션 단계', () => {
  const data = { workspaces: [{ key: 'a', closed: [{ sessionId: 'c1', name: 'old', kind: 'claude', closedAt: 5 }], convos: [{ convId: 'v1', title: 'chat', lastAt: 6 }] }] };
  const { rows } = buildRows({ workspaces: [WS('a')], sessions: [S('a1', 'a')], data, extra: { a: true } });
  const L = lv(rows);
  assert.equal(L['s:id-a1'], 1);
  assert.equal(L['x:a'], 1, '펼침 줄은 세션과 같은 단계');
  assert.equal(L['h:a|closed'], 2);
  assert.equal(L['c:c1'], 2);
  assert.equal(L['h:a|convos'], 2);
  assert.equal(L['v:v1'], 2);
  const many = Array.from({ length: 9 }, (_, i) => S(`n${i}`, 'a', 'waiting'));
  const folded = buildRows({ workspaces: [WS('a')], sessions: many, collapsed: { a: true } }).rows;
  const more = folded.find((r) => r.type === 'more');
  assert.equal(more.lv, 1, '접힌 워크스페이스 아래 응답 필요 "n개 더"는 남은 세션 줄과 같은 단계');
  assert.ok(folded.filter((r) => r.type === 'session').every((r) => r.lv === 1));
});

test('P103 사이드바: 머리줄 오른쪽 상태 수는 응답 필요·오류는 늘, 작업 중은 접혔을 때만', () => {
  const c = { sessions: 7, need: 2, error: 1, working: 3, idle: 1, sleeping: 0 };
  assert.deepEqual(headBadges(c, true), { need: 2, error: 1, working: 0 });
  assert.deepEqual(headBadges(c, false), { need: 2, error: 1, working: 3 });
  assert.deepEqual(headBadges({}, false), { need: 0, error: 0, working: 0 });
  assert.deepEqual(headBadges(null, true), { need: 0, error: 0, working: 0 });
});

test('P103 사이드바: CSS의 안내선 간격·줄 높이가 lib 값과 같다', () => {
  const css = fs.readFileSync(new URL('../src/renderer/sidebar.css', import.meta.url), 'utf8');
  const guide = css.match(/\.mt-sb2-slot::after \{[^}]*left: (\d+)px; width: calc\(var\(--lv, 0\) \* (\d+)px\)/);
  assert.ok(guide, '안내선 규칙');
  assert.equal(Number(guide[1]), TREE.pad);
  assert.equal(Number(guide[2]), TREE.step);
  assert.match(css, new RegExp(`repeating-linear-gradient\\(90deg, transparent 0 ${TREE.step / 2 - 1}px, var\\(--sb-guide\\) ${TREE.step / 2 - 1}px ${TREE.step / 2}px, transparent ${TREE.step / 2}px ${TREE.step}px\\)`), '선은 화살표 칸 가운데');
  assert.equal(ROW_H.session, 30); // P132: 글자를 키워 28 → 30
  assert.equal(ROW_H.ws, 30);
  // 사람이 지은 이름을 대문자로 바꾸지 않는다(사이드바 줄·머리줄·메뉴 머리)
  for (const sel of ['.mt-sb2-row.grp', '.mt-sb2-row.ws', '.mt-sb2-row.sec', '.mt-sb2-mh', '.mt-sb-archive-head', '.mt-sb-sec-head']) {
    const rule = css.match(new RegExp(`${sel.replace(/\./g, '\\.')} \\{[^}]*\\}`));
    assert.ok(rule, sel);
    assert.doesNotMatch(rule[0], /text-transform:\s*uppercase/, sel);
  }
});

test('P103 사이드바: 새 글은 영어·한국어 사전 둘 다 있다', () => {
  for (const k of Object.keys(en.sb3)) assert.ok(ko.sb3[k], `ko.sb3.${k}`);
  for (const k of Object.keys(ko.sb3)) assert.ok(en.sb3[k], `en.sb3.${k}`);
});
