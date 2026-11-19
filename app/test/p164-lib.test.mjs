// P164 단위 시험: 세션 맵의 뒤 일 표시 판정(lib/bg-work.js). 쉬는 세션 + 뒤 일 = 표시, 작업 중·절전·끝남은 표시 안 함,
// 요약(live)이 그래프 노드보다 먼저, 뒤 일이 있는 세션은 얇은 줄(P163)로 줄이지 않음, 글, 창 연결(PC 카드와 미리 보기, 두 사전). P166 지휘 결정으로 휴대폰 세션 맵은 넣지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bgOf, bgShow, bgText, bgKindsText, keepCard } from '../src/renderer/lib/bg-work.js';
import { lineageLayout } from '../src/renderer/lib/mission-lineage.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const BG = { n: 2, kinds: ['shell', 'agent'], items: [{ kind: 'shell', label: 'sleep 60' }, { kind: 'agent', label: null }], at: 1 };
// 사전 흉내(i18n.js와 같은 {n} 채우기)
const tOf = (dict) => (key, vars = {}) => { const v = key.split('.').reduce((o, k) => (o ? o[k] : undefined), dict); return String(v ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); };

test('쉬는 세션 + 뒤 일 = 표시. 작업 중은 겹치지 않고, 절전·끝남은 없다', () => {
  const n = { state: 'ready', background: BG };
  for (const tier of ['rest', 'review', 'turn', 'alert']) assert.equal(bgShow(n, null, tier), BG, tier);
  for (const tier of ['work', 'sleep', 'done']) assert.equal(bgShow(n, null, tier), null, tier);
  assert.equal(bgShow({ state: 'ready', background: null }, null, 'rest'), null);
  assert.equal(bgShow({ state: 'ready', background: { n: 0, kinds: [], items: [] } }, null, 'rest'), null);
});

test('판의 요약(live)이 그래프 노드보다 새것이라 먼저 본다(끝나면 바로 꺼짐)', () => {
  const n = { state: 'ready', background: BG };
  assert.equal(bgOf(n, { background: null }), null, '요약이 비었으면 끝났다');
  assert.equal(bgOf(n, {}), BG, '요약에 필드가 없으면(옛 판) 그래프 노드');
  assert.equal(bgOf({}, { background: BG }), BG);
  assert.equal(keepCard(n), true);
  assert.equal(keepCard({}), false);
});

test('글: "백그라운드 2"와 종류별 수', () => {
  assert.equal(bgText(BG, tOf(ko)), '백그라운드 2');
  assert.equal(bgText(BG, tOf(en)), 'Background 2');
  assert.equal(bgKindsText(BG, tOf(ko)), '셸 1 · 에이전트 1');
  assert.equal(bgKindsText({ n: 3, kinds: ['shell'], items: [{ kind: 'shell' }, { kind: 'shell' }, { kind: 'monitor' }] }, tOf(en)), 'Shell 2 · Other 1');
  assert.equal(bgText(null, tOf(ko)), '');
});

test('뒤 일이 있는 세션은 얇은 줄(P163)로 줄이지 않는다(PC)', () => {
  const A = 'd:/work/app/.git';
  let seq = 0;
  const node = (n, parent = null, o = {}) => ({ id: `s:${n}`, kind: 'session', sessionId: `x-${n}`, name: n, workspaceKey: A, state: 'ready', parentId: parent ? `s:${parent}` : null, createdAt: 100 + seq++, ...o });
  const nodes = [node('lead'), node('w1', 'lead', { state: 'sleeping' }), node('w2', 'lead', { state: 'sleeping', background: BG }), node('w3', 'lead', { state: 'sleeping' })];
  const edges = nodes.filter((n) => n.parentId).map((n) => ({ from: n.parentId, to: n.id, kind: 'spawn', count: 1 }));
  const l = lineageLayout({ nodes, edges }, { order: [A] });
  assert.deepEqual([...l.cards].filter(([, c]) => c.thin).map(([id]) => id).sort(), ['s:w1', 's:w3']);
});

test('창 연결: PC 카드·멀리 타일·미리 보기, 두 사전, 움직임 없음', () => {
  const ml = read('MissionLineage.jsx'), css = read('styles.css');
  assert.match(ml, /bgShow\(n, live, tier\)/);
  assert.match(ml, /<BgBadge f=\{f\} role="ta-bg" \/>/);
  assert.match(ml, /data-role="ta-bg-tile"/);
  assert.match(ml, /<BgList f=\{f\} t=\{t\} \/>/);
  for (const d of [ko, en]) { assert.ok(d.mmBg.badge.includes('{n}')); for (const k of ['shell', 'agent', 'other']) assert.ok(d.mmBg.kind[k]); assert.ok(d.mmBg.title && d.mmBg.noLabel); }
  const block = css.slice(css.indexOf('/* P164'));
  assert.ok(!/animation|transition/.test(block), '뒤 일 표시는 움직이지 않는다');
});
