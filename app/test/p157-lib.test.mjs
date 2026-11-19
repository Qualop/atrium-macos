// P157 단위 시험: 세션 맵 솔로 칸 규칙(동료·관계·닫힌 하위·지시 기록·아무것도 없음), "혼자" → "솔로", 미리 보기 하나(카드·줄 머리 풍선 없음),
// Alt 없이 줄 머리 강조 없음, 폴더 기둥(너비 = 가장 긴 이름, 수 두 줄, 띠 최소 높이), 세션 맵에서 판으로 갈 때 날아가기 없음(navDuration instant).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lineageLayout, spineWidth, glyphW, LINE, SPINE_PX } from '../src/renderer/lib/mission-lineage.js';
import { navDuration, NAV_MS } from '../src/renderer/lib/nav.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

const WS = 'c:/work/demo/.git';
const node = (name, extra = {}) => ({ id: `s:${name}`, kind: 'session', sessionId: `x-${name}`, name, workspaceKey: WS, state: 'sleeping', parentId: null, createdAt: 1, ...extra });
const depthOf = (lay, name) => lay.cards.get(`s:${name}`).depth;

test('솔로 칸: 어떤 관계도 없고 누구도 부르지 않은 세션만', () => {
  const nodes = [
    node('alone'),
    node('pa', { peers: ['s:pb'] }), node('pb', { peers: ['s:pa'] }),
    node('closer', { closedKids: 2 }),
    node('assigner', { assignAt: 1000 }),
    node('orphan', { parentClosed: true }),
    node('lead'), node('kid', { parentId: 's:lead' }),
    node('alone2', { closedKids: 0, assignAt: null, parentClosed: false }),
  ];
  const lay = lineageLayout({ nodes, edges: [] }, { order: [WS] });
  assert.equal(depthOf(lay, 'alone'), -1, '아무 관계 없음 → 솔로');
  assert.equal(depthOf(lay, 'alone2'), -1);
  assert.equal(depthOf(lay, 'pa'), 0, '동료 → 시작 칸');
  assert.equal(depthOf(lay, 'pb'), 0);
  assert.equal(depthOf(lay, 'closer'), 0, '닫힌 하위가 있었다 → 시작 칸');
  assert.equal(depthOf(lay, 'assigner'), 0, '최근 하위에게 지시했다 → 시작 칸');
  assert.equal(depthOf(lay, 'orphan'), 0, '상위가 닫혔다 → 시작 칸');
  assert.equal(depthOf(lay, 'lead'), 0);
  assert.equal(depthOf(lay, 'kid'), 1);
});

test('"혼자" 낱말은 세션 맵·휴대폰에서 "솔로"(영어 Solo)', () => {
  assert.equal(ko.mmLine.colSolo, '솔로');
  assert.equal(ko.mmTerr.solo, '솔로');
  assert.equal(en.mmLine.colSolo, 'Solo');
  for (const k of ['closedKids', 'assigned', 'parentClosed', 'altMoveHint']) { assert.ok(ko.mmLine[k], k); assert.ok(en.mmLine[k], k); }
  for (const f of ['MissionLineage.jsx', 'lib/mission-lineage.js']) assert.ok(!read(f).includes('혼자'), f);
  // 다른 뜻의 "혼자"(절전)는 그대로
  assert.match(JSON.stringify(ko), /혼자 절전/);
});

test('카드에 마우스를 올리면 미리 보기 하나만(브라우저 풍선 title 없음)', () => {
  const src = read('MissionLineage.jsx');
  const card = src.slice(src.indexOf('className="mt-ta-card"'), src.indexOf('{tier === \'work\' && <MissionLight'));
  assert.ok(card.length > 50);
  assert.ok(!/\btitle=/.test(card), '카드에 title이 없다');
  assert.match(card, /aria-label=/);
  const head = src.slice(src.indexOf('className="mt-sm-head"'), src.indexOf('className="wsc"'));
  assert.ok(!/\btitle=/.test(head), '줄 머리에 옮기기 풍선이 없다');
  assert.match(head, /mt-sm-althint/);
  assert.equal((src.match(/<Peek /g) || []).length, 1, '미리 보기 그리는 곳은 하나');
});

test('Alt 없이 줄 머리를 지나가도 강조 없음(P161부터 세션 맵은 .mt-sm-*라 설정 목록 규칙이 걸리지 않는다), 안내 글은 Alt 동안만', () => {
  const css = read('styles.css');
  assert.ok(!/\.mt-sm-row:hover/.test(css), '세션 맵 줄에는 hover 칠이 없다');
  assert.match(css, /\.mt-sm-althint \{ display: none;/);
  assert.match(css, /\.mt-ta-vp\[data-alt="1"\] \.mt-sm-althint \{ display: block; \}/);
  // 강조 규칙은 모두 data-alt 아래에만
  for (const m of css.matchAll(/^.*\.mt-sm-(head|grab):hover.*\{(.*)\}/gm)) if (/outline|background:/.test(m[2])) assert.match(m[0], /data-alt="1"/, m[0]);
});

test('폴더 기둥: 너비는 가장 긴 폴더 이름에 맞추고, 짧으면 최소 폭', () => {
  assert.equal(spineWidth(['Hub']), LINE.SPINE);
  const long = 'Northwind-research-lab';
  const w = spineWidth(['Hub', long]);
  assert.ok(w >= glyphW(long, SPINE_PX.NAME) + 32, `${w}`);
  assert.ok(glyphW('가나다', 10) === 30 && glyphW('ab', 10) < 20);
  const nodes = [node('a', { workspaceKey: 'c:/x/.git' }), node('b', { workspaceKey: 'c:/y/.git' })];
  const vgroups = [{ id: 'g1', name: 'Hub', members: ['c:/x/.git'] }, { id: 'g2', name: long, members: ['c:/y/.git'] }];
  const base = lineageLayout({ nodes, edges: [] }, { order: ['c:/x/.git', 'c:/y/.git'], vgroups: [{ id: 'g1', name: 'Hub', members: ['c:/x/.git', 'c:/y/.git'] }] });
  const lay = lineageLayout({ nodes, edges: [] }, { order: ['c:/x/.git', 'c:/y/.git'], vgroups, spineText: (n, s) => [`Workspaces ${n}`, `Sessions ${s}`] });
  assert.equal(base.spine, LINE.SPINE);
  assert.equal(lay.spine, w);
  assert.equal(lay.headx - base.headx, w - LINE.SPINE, '워크스페이스 머리부터 늘어난 만큼 민다');
  for (const r of lay.rows) assert.equal(r.x, w);
  assert.ok(lay.cards.get('s:a').x - base.cards.get('s:a').x === w - LINE.SPINE);
  // 말줄임 없음, 수는 두 줄
  const css = read('styles.css');
  assert.match(css, /\.mt-sm-spine \.fn \{ overflow: visible; text-overflow: clip; \}/);
  assert.match(css, /\.mt-sm-spine \.fs \{ display: flex; flex-direction: column;/);
  const src = read('MissionLineage.jsx');
  assert.match(src, /className="mt-sm-spine" style=\{\{ width: lay\.spine \}\}/);
  assert.match(src, /data-role="ln-band-stat"><span>\{t\('mmTerr\.workspaces'/);
  assert.ok(!src.includes("t('mmTerr.workspaces', { n: b.nWs })} · ${"), '가운뎃점 없음');
});

test('폴더 띠 최소 높이: 워크스페이스 하나인 폴더도 BANDMIN 이상', () => {
  const nodes = [node('a', { workspaceKey: 'c:/x/.git' }), node('b', { workspaceKey: 'c:/y/.git' }), node('c', { workspaceKey: 'c:/y/.git' })];
  const lay = lineageLayout({ nodes, edges: [] }, { order: ['c:/x/.git', 'c:/y/.git'], vgroups: [{ id: 'g1', name: 'Hub', members: ['c:/x/.git'] }] });
  assert.ok(LINE.BANDMIN >= 300);
  for (const b of lay.bands) assert.ok(b.h >= LINE.BANDMIN, `${b.name} ${b.h}`);
  // 줄 높이 합 = 띠 높이(마지막 줄이 늘어난다)
  for (const b of lay.bands) { const rs = lay.rows.filter((r) => (r.band || null) === (b.id || null)); assert.equal(rs.reduce((s, r) => s + r.h, 0), b.h); }
});

test('세션 맵에서 판으로: 날아가기 없이 한 번에(instant)', () => {
  assert.equal(navDuration({ instant: true }), 0);
  assert.equal(navDuration(), NAV_MS);
  assert.match(read('MissionLineage.jsx'), /st\.navigateTo\(b\.node\.sessionId, \{ instant: true \}\)/);
  const cv = read('Canvas.jsx');
  assert.match(cv, /st\.navigateTo = \(id, \{ focusTerminal = false, viewOnly = false, instant = false \} = \{\}\)/);
  assert.match(cv, /const duration = navDuration\(\{ instant \}\);/);
});

test('다른 워크스페이스의 동료·정한 관계도 솔로가 아니다', () => {
  const W2 = 'c:/work/other/.git';
  const nodes = [
    node('crawler', { peers: ['s:researcher'] }),
    node('researcher', { workspaceKey: W2, peers: ['s:crawler'] }),
    node('rkid', { workspaceKey: W2, parentId: 's:researcher' }),
    node('indep'), node('owner', { workspaceKey: W2 }),
    node('alone'),
  ];
  const edges = [
    { from: 's:crawler', to: 's:researcher', kind: 'relation', relation: 'peer', relationSource: 'user' },
    { from: 's:owner', to: 's:indep', kind: 'relation', relation: 'none', relationSource: 'user' },
  ];
  const lay = lineageLayout({ nodes, edges }, { order: [WS, W2] });
  assert.equal(depthOf(lay, 'crawler'), 0, '다른 워크스페이스 동료 → 시작 칸');
  assert.equal(depthOf(lay, 'researcher'), 0);
  assert.equal(depthOf(lay, 'indep'), 0, '사람이 정한 관계(독립) → 솔로 아님');
  assert.equal(depthOf(lay, 'alone'), -1);
});
