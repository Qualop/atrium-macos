// P10 창 단위 시험: 아이콘 얼굴 경계(140px, 이력), 종류 아이콘(한곳, 모르는 종류), 덩어리 안의 노드로 들어갈 때의 화면, 보관함 줄
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { faceFor, FACE_ICON_PX, FACE_HYSTERESIS_PX } from '../src/renderer/lib/faces.js';
import { kindOf, KINDS, SHAPES, stateColor, logoFor } from '../src/renderer/lib/kinds.js';
import { enterView, dockRect, NAV_CLOSE_PX } from '../src/renderer/lib/nav.js';
import { archiveRows } from '../src/renderer/lib/sidebar.js';

test('얼굴: 화면 140px 아래는 아이콘, 경계에 이력', () => {
  assert.equal(faceFor(720, 0.2), 'far'); // 144px
  assert.equal(faceFor(720, 0.19), 'icon'); // 137px
  assert.equal(faceFor(720, (FACE_ICON_PX - 4) / 720, 'far'), 'far'); // 멀리에서 줄일 때는 이력만큼 남는다
  assert.equal(faceFor(720, (FACE_ICON_PX - FACE_HYSTERESIS_PX - 1) / 720, 'far'), 'icon');
  assert.equal(faceFor(720, (FACE_ICON_PX + 4) / 720, 'icon'), 'far');
  assert.equal(faceFor(480, 0.25), 'icon'); // 작은 노드(120px)
});

test('종류 아이콘: Claude Code, Codex, Pi, 셸, 그 밖. 모르는 종류는 그 밖의 모양에 이름 머리글자. 로고 칸은 비어 있다', () => {
  for (const k of ['claude', 'codex', 'gemini', 'pi', 'grok', 'shell', 'other']) { assert.ok(KINDS[k].mark); assert.ok(KINDS[k].shape === 'circle' || SHAPES[KINDS[k].shape]); }
  // 로고가 있는 종류는 빌드가 옮기는 assets/kinds/ 아래 그림을 가리키고, 그 파일이 저장소에 있다
  for (const k of ['claude', 'codex', 'gemini', 'pi', 'grok']) { assert.match(KINDS[k].logo, /^assets\/kinds\/[a-z-]+\.(png|svg)$/); assert.ok(fs.existsSync(new URL(`../src/renderer/${KINDS[k].logo}`, import.meta.url))); }
  for (const k of ['shell', 'other']) assert.equal(KINDS[k].logo ?? null, null);
  // Claude Code는 상태와 상관없이 같은 심볼(내 차례는 테두리와 점으로 보인다). 레일 단추 그림(logoBadge)도 저장소에 있다. 로고가 없으면 null
  assert.equal(logoFor(KINDS.claude, 'waiting'), KINDS.claude.logo);
  assert.ok(fs.existsSync(new URL(`../src/renderer/${KINDS.claude.logoBadge}`, import.meta.url)));
  assert.equal(logoFor(KINDS.claude, 'working'), KINDS.claude.logo);
  assert.equal(logoFor(KINDS.codex, 'waiting'), KINDS.codex.logo);
  assert.equal(logoFor(KINDS.shell, 'ready'), null);
  assert.equal(kindOf(null).id, 'claude');
  assert.equal(kindOf('Codex').id, 'codex');
  const g = kindOf('custom-agent');
  assert.equal(g.shape, KINDS.other.shape); assert.equal(g.mark, 'Cu'); assert.equal(g.label, 'custom-agent');
  assert.notEqual(stateColor('waiting'), stateColor('ready'));
  assert.ok(stateColor('nope'));
});

const screen = { width: 1600, height: 900 };
test('들어가기(P26): 혼자인 노드는 화면의 85%를 채우게, 배율 상한 1(지금 배율과 상관없이)', () => {
  const r = { x: 0, y: 0, w: 720, h: 460 };
  assert.deepEqual(enterView({ node: r, screen, zoomNow: 1.2 }), { cx: 360, cy: 230, zoom: 1, mode: 'node' });
  assert.equal(enterView({ node: r, screen, zoomNow: 0.3 }).zoom, 1);
  const big = { x: 0, y: 0, w: 1440, h: 810 };
  assert.ok(Math.abs(enterView({ node: big, screen }).zoom - (0.85 * 900) / 810) < 1e-9, '큰 노드는 높이의 85%');
});

test('들어가기: 덩어리 안의 노드면 덩어리 전체가 들어오게. 너무 커서 누른 노드가 가까이 얼굴이 못 되면 누른 노드를 가까이로 두고 덩어리 쪽으로 옮긴다', () => {
  // P26: 가로 둘(1440×460): 0.85×1600/1440 = 0.944 → 덩어리가 화면 너비의 85%
  const a = { x: 0, y: 0, w: 720, h: 460 }, b = { x: 720, y: 0, w: 720, h: 460 };
  const two = enterView({ node: a, dock: dockRect([a, b]), screen, zoomNow: 0.4 });
  assert.equal(two.mode, 'dock'); assert.equal(two.cx, 720); assert.ok(Math.abs(two.zoom - 0.944) < 0.001);
  // 가로 셋(2160): 0.85×1600/2160 = 0.63 → 누른 노드 453px, 가까이 얼굴
  const c = { x: 1440, y: 0, w: 720, h: 460 };
  const three = enterView({ node: c, dock: dockRect([a, b, c]), screen, zoomNow: 1 });
  assert.equal(three.mode, 'dock'); assert.ok(Math.abs(three.zoom - 0.63) < 0.01); assert.equal(three.cx, 1080);
  // 가로 여섯(4320): 0.31 → 누른 노드 227px라 가까이 얼굴이 아니다 → 누른 노드를 380px로, 덩어리 가운데 쪽으로
  const six = [0, 1, 2, 3, 4, 5].map((i) => ({ x: i * 720, y: 0, w: 720, h: 460 }));
  const v = enterView({ node: six[0], dock: dockRect(six), screen, zoomNow: 1 });
  assert.equal(v.mode, 'node-close');
  assert.ok(Math.abs(v.zoom - NAV_CLOSE_PX / 720) < 1e-9);
  const vw = screen.width / v.zoom;
  assert.ok(v.cx - vw / 2 <= six[0].x && six[0].x + 720 <= v.cx + vw / 2, '누른 노드는 화면 안에 다 든다');
  assert.ok(v.cx > 360, '가운데가 덩어리 쪽(오른쪽)으로 옮겨 간다');
  // 맨 오른쪽 노드를 누르면 왼쪽으로
  const w = enterView({ node: six[5], dock: dockRect(six), screen, zoomNow: 1 });
  assert.ok(w.cx < six[5].x + 360 && w.cx + vw / 2 >= six[5].x + 720);
  assert.equal(dockRect([a]), null);
});

test('보관함 줄: 리포마다 닫힌 세션과 대화를 섞어 마지막 활동 순, 거르기, 빈 리포는 뺀다', () => {
  const ws = [
    { key: 'a', name: 'alpha', closed: [{ sessionId: 's1', name: 'old', lastActivityAt: 5, reasonLabel: '판에서 끔' }], convos: [{ convId: 'c1', title: '배포 스크립트', lastAt: 9 }, { convId: 'c2', title: '문서', lastAt: 1 }] },
    { key: 'b', name: 'beta', closed: [], convos: [] },
  ];
  const all = archiveRows({ workspaces: ws });
  assert.deepEqual(all.map((g) => g.key), ['a']);
  assert.deepEqual(all[0].rows.map((r) => r.sessionId || r.convId), ['c1', 's1', 'c2']);
  assert.deepEqual(archiveRows({ workspaces: ws, filter: '배포' })[0].rows.map((r) => r.convId), ['c1']);
  assert.equal(archiveRows({ workspaces: ws, filter: 'alpha' })[0].rows.length, 3); // 리포 이름으로도
});
