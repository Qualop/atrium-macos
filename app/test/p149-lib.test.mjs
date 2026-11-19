// P149 단위 시험: 이전 미션 맵 다듬기. 큰 창 맞춤 배율, 작업 완료 거르기 칸 없음, 넘침 없음(카드 줄마다 말줄임·지도가 칸 폭 안), 카드 네 줄·알약 두 줄, 사전 두 벌.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missionLayout, missionScale, MISSION } from '../src/renderer/lib/mission-layout.js';
import { FILTERS, filterMatch } from '../src/renderer/lib/mission-model.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');

test('P149: 창 크기에 따른 맞춤 배율(작은 창은 1, 2576×1408은 1.2, 위는 1.35)', () => {
  assert.equal(missionScale(1366, 768), 1);
  assert.equal(missionScale(1584, 921), 1);
  assert.equal(missionScale(1920, 1080), 1.05);
  assert.equal(missionScale(2576, 1408), 1.2);
  assert.equal(missionScale(2560, 1440), 1.2);
  assert.equal(missionScale(3840, 2160), 1.35);
  // 넓기만 하고 낮은 창은 높이가 정한다(세로로 넘치지 않게)
  assert.equal(missionScale(3440, 940), 1);
  assert.equal(missionScale(0, 900), 1); assert.equal(missionScale(NaN, NaN), 1);
  // 0.05 단위, 1~1.35
  for (let w = 1000; w < 4000; w += 37) { const s = missionScale(w, w * 0.55); assert.ok(Math.abs(s * 20 - Math.round(s * 20)) < 1e-9 && s >= 1 && s <= 1.35, `${w}: ${s}`); }
  // 2576 창 본문 글자(카드 둘째·셋째 줄 12~12.5px) × 배율 = 14px 안팎
  assert.ok(12 * missionScale(2576, 1408) >= 13.5 && 12.5 * missionScale(2576, 1408) <= 16);
});

test('P149: 위 거르기에 작업 완료 칸이 없다(작업 완료는 판 위 알약과 카드 보라 표시로만)', () => {
  assert.deepEqual(FILTERS, ['all', 'needs_you', 'working', 'idle', 'exited']);
  assert.ok(!FILTERS.includes('done'));
  assert.equal(filterMatch('review', 'all'), true);
  const src = read('Mission.jsx');
  assert.ok(!/done: counts\.review/.test(src), '거르기 수에도 작업 완료가 없다');
  assert.ok(/data-role="mm-sum-review"/.test(src), '오른쪽 요약 열의 작업 완료 칸은 남는다(무엇을 끝냈는지)');
});

let clock = 0;
const node = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', sessionId: id, name: id, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws, parentId: null, role: null, order: null, createdAt: ++clock, loops: 0, ...o });
const work = { state: 'working', category: 'working' };
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('P149: 카드 248×96(일 줄 두 줄까지), 쉬는 알약 44(두 줄), 겹침 없음, 지도가 칸 폭 ÷ 배율 안', () => {
  assert.equal(MISSION.boxW, 248); assert.equal(MISSION.boxH, 96); assert.equal(MISSION.rowH, 44);
  const nodes = [node('lead', 'a', work), node('w1', 'a', { ...work, parentId: 's:lead' }), node('w2', 'a', { parentId: 's:lead', category: 'done' }), node('rest', 'a'), node('zz', 'a', { state: 'sleeping' })];
  for (const k of ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) nodes.push(node(`${k}1`, k), node(`${k}2`, k, work));
  const edges = [{ from: 's:lead', to: 's:w1', kind: 'spawn', count: 1 }, { from: 's:lead', to: 's:w2', kind: 'spawn', count: 1 }];
  for (const [w, h] of [[2576, 1408], [1584, 921], [1366, 768]]) {
    const s = missionScale(w, h);
    const width = Math.floor((w - 288 * s) / s / 40) * 40; // 요약 열을 뺀 칸 폭 ÷ 배율(Mission.jsx와 같은 셈)
    const lay = missionLayout({ nodes, edges }, { width });
    const bs = [...lay.boxes.values()].filter((b) => b.kind !== 'dots');
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) assert.ok(!hit(bs[i], bs[j]), `${w}: ${bs[i].node.id} × ${bs[j].node.id}`);
    assert.ok(lay.width <= width + 1, `${w}: 지도 ${lay.width} ≤ 칸 ${width}`);
    assert.equal(lay.boxes.get('s:rest').kind, 'row'); assert.equal(lay.boxes.get('s:rest').h, 44);
    assert.equal(lay.boxes.get('s:w1').h, 96);
  }
});

test('P149: 카드 줄은 말줄임으로 카드 안에 머문다, 쉬는 알약도 모델·마지막 일을 남긴다, 빛 원뿔이 카드 모서리까지', () => {
  const css = read('styles.css');
  const blk = css.slice(css.indexOf('P149: 이전 미션 맵 다듬기'));
  for (const sel of ['.mt-mm-task', '.mt-mm-rl2', '.mt-mm-r1']) {
    const rule = blk.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`));
    assert.ok(rule && /min-width: 0/.test(rule[1]) && /overflow: hidden/.test(rule[1]), `${sel}: min-width 0 + overflow hidden`);
  }
  assert.ok(/\.mt-mission-head, \.mt-mission-canvas, \.mt-mm-sum \{ zoom: var\(--mm-z, 1\); \}/.test(blk));
  // 위계: 폴더 16 > 워크스페이스 14 > 카드 이름 13.5
  assert.ok(/\.mt-mm-fhead \{[^}]*750 16px/.test(blk) && /\.mt-mm-ws \{[^}]*650 14px/.test(blk) && /\.mt-mm-name \{ font-size: 13\.5px/.test(blk));
  // 원뿔(184px, 가로 1.86배)이 카드(248×96)와 고리(둘레 6px) 모서리를 덮는다: 안쪽 원 반지름 92 ≥ 모서리 거리
  const hx = (MISSION.boxW / 2 + 6) / 1.86, hy = MISSION.boxH / 2 + 6;
  assert.ok(Math.hypot(hx, hy) <= 92, `${Math.hypot(hx, hy)}`);
  const src = read('Mission.jsx');
  assert.ok(/mt-mm-rl2/.test(src) && /f\.last \? t\('mmMap3\.lastDid'/.test(src), '알약 둘째 줄: 모델과 마지막 일');
  assert.ok(/className=\{`mt-mm-task k-\$\{f\.task\.k\}`\}/.test(src), '카드 셋째 줄: 일');
  assert.equal(en.mmMap3.lastDid, 'Last: {text}'); assert.ok(ko.mmMap3.lastDid.includes('{text}'));
  assert.ok(en.mmMap3.noTask && ko.mmMap3.noTask);
});
