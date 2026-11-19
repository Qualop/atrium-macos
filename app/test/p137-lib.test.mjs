// P137 단위 시험: 폴더 상자 안의 워크스페이스 상자(두 겹). 워크스페이스 상자(판)는 폴더 상자 안 여백(m) 안쪽에 들고, 서로 겹치지 않고 판 사이 틈(16)만큼 떨어진다.
// 폴더 머리(폴더 이름 줄)와 첫 워크스페이스 상자가 겹치지 않는다. 폴더 밖 워크스페이스도 같은 워크스페이스 상자(판)다.
// 카드 메타의 모델: 요약 model(백엔드가 지금 값으로 준다)을 그대로 보인다(modelText). 화면 토큰·CSS 자리.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { missionLayout, FOLDER, MISSION } from '../src/renderer/lib/mission-layout.js';
import { modelText } from '../src/renderer/lib/mission-model.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
let clock = 0;
const node = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', sessionId: id, name: id, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws, parentId: null, role: null, order: null, createdAt: ++clock, loops: 0, ...o });
const E = (a, b, kind = 'spawn') => ({ from: a === 'human' ? 'human' : `s:${a}`, to: `s:${b}`, kind, label: null, count: 1 });
const GUT = MISSION.slotGap - 2 * MISSION.plate;
const apart = (a, b, g) => a.x + a.w + g <= b.x + 0.01 || b.x + b.w + g <= a.x + 0.01 || a.y + a.h + g <= b.y + 0.01 || b.y + b.h + g <= a.y + 0.01;

// 폴더 둘(alpha: 팀 a1 + 혼자 a2·a3, beta: 혼자 b1·b2), 폴더 밖 o1(팀)·o2(혼자). 팀이 폴더를 넘는다(lead → b1의 away)
function board() {
  clock = 0;
  const nodes = [
    { id: 'human', kind: 'human', name: 'you' },
    node('lead', 'a1', { state: 'working', category: 'working' }), node('w1', 'a1', { parentId: 's:lead' }), node('away', 'b1', { parentId: 's:lead' }),
    node('a2x', 'a2'), node('a2y', 'a2'), node('a3x', 'a3'),
    node('b1x', 'b1'), node('b2x', 'b2'), node('b2y', 'b2'),
    node('olead', 'o1'), node('ow', 'o1', { parentId: 's:olead' }), node('o2x', 'o2'),
  ];
  return { nodes, edges: [E('lead', 'w1'), E('lead', 'away'), E('olead', 'ow'), E('human', 'lead', 'bar')] };
}
const ORDER = ['a1', 'a2', 'a3', 'o1', 'b1', 'b2', 'o2'];
const VG = [{ id: 'fa', name: 'alpha', members: ['a1', 'a2', 'a3'] }, { id: 'fb', name: 'beta', members: ['b1', 'b2'] }];

test('P137 폴더 안 워크스페이스 상자: 상자 안 여백 안쪽, 머리 아래, 서로 틈만큼 떨어진다(폭 여럿, 접기 포함)', () => {
  for (const width of [640, 1000, 1400, 2000]) for (const collapsed of [[], ['a2'], ['a1', 'b2']]) {
    const lay = missionLayout(board(), { order: ORDER, vgroups: VG, width, collapsed });
    const tag = `폭 ${width} 접기 ${collapsed.join(',') || '-'}`;
    assert.equal(lay.folders.length, 2, tag);
    for (const f of lay.folders) {
      const ps = lay.groups.filter((g) => g.folder === f.id).map((g) => ({ key: g.key, ...g.plate }));
      assert.equal(ps.length, f.keys.length, `${tag}: ${f.id}의 워크스페이스마다 상자`);
      for (const p of ps) {
        assert.ok(p.x - f.x >= FOLDER.m - 0.01 && f.x + f.w - (p.x + p.w) >= FOLDER.m - 0.01, `${tag}: ${p.key} 좌우 여백`);
        assert.ok(p.y - f.y >= FOLDER.head - 0.01 && f.y + f.h - (p.y + p.h) >= FOLDER.m - 0.01, `${tag}: ${p.key} 위(머리)·아래 여백`);
      }
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(apart(ps[i], ps[j], GUT - 0.02), `${tag}: ${ps[i].key}·${ps[j].key} 사이 틈`);
    }
    // 폴더 밖 워크스페이스 상자와 폴더 상자도 겹치지 않는다
    for (const g of lay.groups.filter((x) => !x.folder)) for (const f of lay.folders) assert.ok(apart(g.plate, f, GUT - 0.02), `${tag}: ${g.key}·${f.id}`);
    // 세션은 제 워크스페이스 상자 안(팀이 폴더를 넘으면 부모 팀 상자 안)
    for (const b of lay.boxes.values()) {
      if (!b.node || b.node.kind !== 'session' || b.kind === 'dot') continue;
      const p = lay.groups.find((g) => g.key === b.group).plate;
      assert.ok(b.x >= p.x && b.y >= p.y && b.x + b.w <= p.x + p.w + 0.01 && b.y + b.h <= p.y + p.h + 0.01, `${tag}: ${b.node.id} 상자 안`);
    }
    assert.equal(lay.boxes.get('s:away') ? lay.boxes.get('s:away').group : 'a1', 'a1', `${tag}: 폴더를 넘는 하위 세션은 부모 팀 안`);
  }
});

test('P137 두 겹 모양: 폴더 테두리 > 워크스페이스 테두리, 폴더 안 판에도 테두리, 머리 글 크기가 겹마다 다르다', () => {
  const tk = read('tokens.css'), css = read('styles.css');
  const alpha = (k) => Number((new RegExp(`${k}:\\s*rgba\\([^)]*?([0-9.]+)\\)`).exec(tk) || [])[1]);
  assert.ok(alpha('--mm-folder-line-2') > alpha('--mm-ws-line'), '폴더 테두리가 더 밝다');
  assert.ok(alpha('--mm-ws-line') > alpha('--mm-plate-line'), '워크스페이스 상자 테두리는 옛 판보다 또렷하다');
  const p137 = css.slice(css.indexOf('P137: 폴더 상자 안의 워크스페이스 상자'));
  assert.match(p137, /\.mt-mm-plate\.inf\s*\{[^}]*border-color:\s*var\(--mm-ws-line\)/);
  assert.match(p137, /\.mt-mm-fhead\s*\{[^}]*13px/);
  assert.match(css, /\.mt-mm-ws\s*\{[^}]*12px/);
  assert.ok(FOLDER.m > MISSION.plate, '폴더 안 여백이 워크스페이스 판 안 여백보다 넓다');
});

test('P137 카드 메타 모델: 지금 모델(대화 기록의 ID나 /model이 보인 이름)을 짧게', () => {
  assert.equal(modelText('claude-sonnet-5-5', 'high'), 'sonnet 5.5·high');
  assert.equal(modelText('Sonnet 5.5', null), 'sonnet 5.5', '/model이 보인 이름도 다음 답의 ID와 같은 글');
  assert.equal(modelText('gpt-6.1-sol', 'xhigh'), 'gpt-6.1-sol·xhigh');
  assert.equal(modelText(null, null), null);
});
