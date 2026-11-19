// P87 단위 시험: 휴대폰이면 늘 목록, 태블릿·데스크톱은 보드(lib/phone.js isPhoneDevice·firstView),
// 휴대폰 미션 맵 배치(lib/phone-mission.js: 무리, 나무, 들여쓰기, 강조 등급, 접기, 다른 무리 부모, 나무 밖 연결),
// 죽음 기록을 한 번만 알림(lib/crumbs.js reportId·crumbSent, 같은 기록을 두 번 세지 않음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPhoneDevice, firstView, PHONE_MAX_WIDTH } from '../src/renderer/lib/phone.js';
import { phoneMission, phoneTier, PM_INDENT_MAX } from '../src/renderer/lib/phone-mission.js';
import { parseCrumbs, bootDecide, crumbAlive, crumbLeave, crumbSent, chooseBoard, CRASH_WINDOW_MS } from '../src/renderer/lib/crumbs.js';

const json = (x) => JSON.parse(JSON.stringify(x)); // localStorage를 거친 것처럼

test('휴대폰이면 늘 목록, 태블릿·데스크톱 웹·PC 창은 보드', () => {
  assert.equal(firstView({ width: 393, height: 852, coarse: true }), 'list', 'iPhone 세로');
  assert.equal(firstView({ width: 852, height: 393, coarse: true }), 'list', 'iPhone 가로도 목록(가로 보드도 죽는다)');
  assert.equal(firstView({ width: PHONE_MAX_WIDTH, height: 932, coarse: true }), 'list', '큰 iPhone(경계)');
  assert.equal(firstView({ width: 412, height: 915, coarse: true }), 'list', 'Android 휴대폰');
  assert.equal(firstView({ width: 820, height: 1180, coarse: true }), 'board', 'iPad 세로');
  assert.equal(firstView({ width: 1180, height: 820, coarse: true }), 'board', 'iPad 가로');
  assert.equal(firstView({ width: 744, height: 1133, coarse: true }), 'board', 'iPad mini');
  assert.equal(firstView({ width: 1440, height: 900, coarse: false }), 'board', '데스크톱 웹');
  assert.equal(firstView({ width: 390, height: 844, coarse: false }), 'board', '마우스 창을 좁힌 것');
  assert.equal(firstView({ width: 0, height: 0, coarse: true }), 'board');
  assert.equal(isPhoneDevice(), false);
});

// ---- 미션 맵 ----
const node = (id, ws, o = {}) => ({ id: `s:${id}`, kind: 'session', sessionId: id, name: id, agentKind: 'claude', state: 'ready', category: 'idle', workspaceKey: ws, parentId: null, role: null, order: null, createdAt: 0, loops: 0, ...o });
function graph() {
  const nodes = [
    { id: 'human', kind: 'human', name: 'you', column: 0 },
    node('lead', 'wa', { state: 'working', category: 'working', createdAt: 1 }),
    node('w1', 'wa', { parentId: 's:lead', role: 'reviewer', order: 1, createdAt: 2 }),
    node('w2', 'wa', { parentId: 's:lead', role: 'tester', order: 2, createdAt: 3, state: 'waiting', category: 'needs_you', ask: 'Bash: npm test' }),
    node('w1a', 'wa', { parentId: 's:w1', role: 'helper', order: 1, createdAt: 4 }),
    node('solo', 'wb', { createdAt: 5, state: 'sleeping' }),
    node('far', 'wc', { parentId: 's:lead', role: 'porter', order: 3, createdAt: 6 }), // 다른 무리의 하위 세션
    node('old', 'wc', { createdAt: 7, state: 'exited', category: 'exited' }),
  ];
  const edges = [
    { from: 's:lead', to: 's:w1', kind: 'role', label: 'reviewer', active: true },
    { from: 's:lead', to: 's:w1', kind: 'spawn' },
    { from: 's:lead', to: 's:w2', kind: 'spawn' },
    { from: 's:w1', to: 's:w1a', kind: 'spawn' },
    { from: 's:lead', to: 's:far', kind: 'spawn' },
    { from: 's:w2', to: 's:w1', kind: 'role', label: 'second opinion' }, // 나무 밖 연결
    { from: 'human', to: 's:lead', kind: 'bar', count: 2 },
  ];
  return { nodes, edges, counts: {}, at: 0 };
}
const names = (g) => g.rows.map((r) => `${'  '.repeat(r.depth)}${r.name}`);

test('미션 맵: 워크스페이스 무리(판 순서), 위 → 아래 나무, 들여쓰기, 역할 이름표', () => {
  const m = phoneMission(graph(), { order: ['wa', 'wb', 'wc'] });
  assert.deepEqual(m.groups.map((g) => g.key), ['wa', 'wb', 'wc']);
  const wa = m.groups[0];
  assert.deepEqual(names(wa), ['lead', '  w1', '    w1a', '  w2']);
  const by = Object.fromEntries(wa.rows.map((r) => [r.name, r]));
  assert.equal(by.w1.role, 'reviewer'); assert.equal(by.w2.role, 'tester'); assert.equal(by.w1a.role, 'helper');
  assert.equal(by.lead.depth, 0); assert.equal(by.w1a.depth, 2);
  // 나무 선: w1은 마지막 형제가 아니다(├), w2는 마지막(└), w1a의 위 단계에는 w1의 줄이 이어진다
  assert.equal(by.w1.last, false); assert.equal(by.w2.last, true); assert.deepEqual(by.w1a.guides, [true]);
  assert.equal(by.w1.active, true, '역할 선이 일하는 중');
  // 나무에 들지 못한 연결은 보내는 줄에
  assert.deepEqual(by.w2.links, [{ to: 'w1', toId: 's:w1', role: 'second opinion', kind: 'role', rel: 'role', active: false }]);
  assert.deepEqual(by.lead.links, [], '사람(명령 바) 선은 그리지 않는다');
  // 다른 무리의 하위 세션: 그 무리의 뿌리, 부모 표시
  const wc = m.groups[2];
  assert.deepEqual(names(wc), ['far', 'old']);
  assert.deepEqual(wc.rows[0].from, { name: 'lead', key: 'wa' });
  assert.equal(wc.rows[0].role, 'porter');
  // 판 순서를 모르는 무리는 뒤로, 키 없는 무리는 맨 끝
  const m2 = phoneMission({ nodes: [node('x', null), node('y', 'zz'), node('z', 'wa')], edges: [] }, { order: ['wa'] });
  assert.deepEqual(m2.groups.map((g) => g.key), ['wa', 'zz', null]);
});

test('미션 맵: 강조 등급(일함, 내 차례, 쉼, 잠듦, 끝남)과 판의 상태로 덧입히기, 세기', () => {
  const m = phoneMission(graph(), { order: ['wa', 'wb', 'wc'] });
  const tier = Object.fromEntries(m.groups.flatMap((g) => g.rows).map((r) => [r.name, r.tier]));
  assert.deepEqual(tier, { lead: 'work', w1: 'rest', w1a: 'rest', w2: 'turn', solo: 'sleep', far: 'rest', old: 'done' });
  assert.deepEqual(m.counts, { all: 7, work: 1, turn: 1, review: 0 }); // P119: review = 작업 완료
  assert.deepEqual([m.groups[0].count, m.groups[0].work, m.groups[0].turn], [4, 1, 1]);
  // 판의 세션 요약이 더 새롭다: w1이 일하기 시작, 셸은 명령이 돌면 일함
  const live = new Map([['w1', { sessionId: 'w1', name: 'w1', state: 'working' }], ['solo', { sessionId: 'solo', name: 'solo', kind: 'shell', state: 'ready', shell: { atPrompt: false } }]]);
  const m2 = phoneMission(graph(), { live, order: ['wa', 'wb', 'wc'] });
  const t2 = Object.fromEntries(m2.groups.flatMap((g) => g.rows).map((r) => [r.name, r.tier]));
  assert.equal(t2.w1, 'work'); assert.equal(t2.solo, 'work');
  assert.equal(m2.counts.work, 3);
  // 상태가 바뀌어도 줄의 자리는 그대로(띄운 순서)
  assert.deepEqual(m2.groups.map(names), phoneMission(graph(), { order: ['wa', 'wb', 'wc'] }).groups.map(names));
  assert.equal(phoneTier({ state: 'error' }), 'alert');
  assert.equal(phoneTier({ state: 'ready', category: 'done' }), 'review');
});

test('미션 맵: 접은 무리는 줄 없이 수만, 깊은 나무는 들여쓰기를 멈춘다, 고리는 빠뜨리지 않는다', () => {
  const m = phoneMission(graph(), { order: ['wa', 'wb', 'wc'], folded: ['wa'] });
  assert.equal(m.groups[0].folded, true); assert.equal(m.groups[0].rows.length, 0); assert.equal(m.groups[0].count, 4);
  assert.equal(m.counts.all, 7, '접어도 위쪽 요약은 모두를 센다');
  const chain = Array.from({ length: 8 }, (_, i) => node(`c${i}`, 'wa', { parentId: i ? `s:c${i - 1}` : null, createdAt: i }));
  const deep = phoneMission({ nodes: chain, edges: [] }).groups[0].rows;
  assert.equal(deep.length, 8);
  assert.equal(deep[7].depth, 7); assert.equal(deep[7].indent, PM_INDENT_MAX); assert.ok(deep[7].guides.length <= PM_INDENT_MAX);
  // 서로 지시하는 두 세션(고리): 하나는 뿌리, 둘 다 나온다
  const loop = phoneMission({ nodes: [node('a', 'wa', { createdAt: 1 }), node('b', 'wa', { createdAt: 2 })], edges: [{ from: 's:a', to: 's:b', kind: 'prompt' }, { from: 's:b', to: 's:a', kind: 'prompt' }] });
  assert.deepEqual(names(loop.groups[0]), ['a', '  b']);
  assert.deepEqual(loop.groups[0].rows[1].links, [{ to: 'a', toId: 's:a', role: null, kind: 'prompt', rel: 'prompt', active: false }]);
  assert.deepEqual(phoneMission(null).groups, []);
});

// ---- 죽음 기록은 한 번만 ----
test('죽음 기록: reportId(죽은 페이지의 부팅 시각), 알린 뒤에는 같은 기록을 다시 알리지도 세지도 않는다', () => {
  const t0 = 1_000_000;
  const a = bootDecide(parseCrumbs(null), t0); // 보드 부팅
  let s = json(crumbAlive(a.state, { view: 'board' }, t0 + 14000)); // 14초 살고 죽음(떠남 없음)
  const b = bootDecide(s, t0 + 20000);
  assert.equal(b.crashed, true); assert.equal(b.reportId, t0); assert.equal(b.report.up, 14000);
  // 알림이 받아들여짐 → sent. 이 기록(sent)은 다음 상태에도 남는다
  let s2 = json(crumbSent(b.state, b.reportId));
  assert.equal(parseCrumbs(JSON.stringify(s2)).sent, t0);
  s2 = json(crumbLeave(crumbAlive(s2, { view: 'list' }, t0 + 22000), t0 + 23000));
  assert.equal(s2.sent, t0, '살아 있음·떠남이 지우지 않는다');
  const c = bootDecide(s2, t0 + 30000);
  assert.equal(c.crashed, false); assert.equal(c.reportId, null);
  // 새 부팅 기록이 남지 못해(쓰기 실패 등) 죽은 페이지의 기록이 그대로 다시 읽혀도: 알렸으면 다시 알리지 않고 세지 않는다
  const stale = json({ ...s, sent: t0 });
  const d = bootDecide(stale, t0 + 40000);
  assert.equal(d.crashed, false); assert.equal(d.report, null); assert.equal(d.light, false);
  // 알리지 못한 채 같은 기록이 두 번 읽혀도 한 번만 센다(같은 시각을 두 번 넣지 않는다 → 1분 안에 두 번 죽음으로 가벼운 화면이 되지 않는다)
  const twice = bootDecide(json({ ...s, crashes: [t0 + 14000] }), t0 + 40000);
  assert.equal(twice.crashed, true); assert.equal(twice.light, false); assert.deepEqual(twice.state.crashes, [t0 + 14000]);
  // 진짜로 1분 안에 두 번 죽으면 그대로 가벼운 화면
  let x = json(crumbAlive(b.state, { view: 'board' }, t0 + 24000));
  const e = bootDecide(x, t0 + 26000);
  assert.ok(t0 + 24000 - (t0 + 14000) <= CRASH_WINDOW_MS);
  assert.equal(e.crashed, true); assert.equal(e.light, true); assert.equal(e.reportId, t0 + 20000);
  // 보드로 다시 열기(chooseBoard)도 sent를 지우지 않는다
  assert.equal(chooseBoard(json(crumbSent(e.state, e.reportId)), t0 + 30000).sent, t0 + 20000);
});
