// P61: 아래 바의 넓힌 범위와 들어가는·나가는 선(lib/bottom.js bandZone), 숨김 늦추기, 찾기 창의 맞는 글자 나누기(lib/search-ui.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { inBand, bandZone, bottomNext, BAND_PX, BAND_SIDE_PX, EXIT_BAND_PX, EXIT_SIDE_PX, SHOW_DELAY_MS, HIDE_DELAY_MS } from '../src/renderer/lib/bottom.js';
import { markRanges, showField, showSnip, movePick, kindIcon, SEARCH_LEAVE_MS } from '../src/renderer/lib/search-ui.js';
import fs from 'node:fs';

// icons.jsx는 JSX라 node로 불러오지 못한다. PATHS의 이름만 글에서 읽는다
const ICONS = fs.readFileSync(new URL('../src/renderer/lib/icons.jsx', import.meta.url), 'utf8');
const hasIcon = (name) => new RegExp(`^  ${name}: '`, 'm').test(ICONS);

const BAR = { left: 400, right: 1200, bottom: 900 };

test('P61 범위: 들어오는 범위는 명령 바(아래 26px + 60px)와 칩 줄(아래 104px + 26px)을 덮고, 나가는 범위는 그보다 넓다', () => {
  assert.ok(BAND_PX >= 104 + 26 + 10, '칩 줄 위까지 여유');
  assert.ok(BAND_SIDE_PX >= 60, '명령 바 폭보다 넉넉히');
  assert.ok(EXIT_BAND_PX > BAND_PX && EXIT_SIDE_PX > BAND_SIDE_PX, '나가는 선이 들어가는 선보다 밖');
  // 바가 있는 자리, 칩 줄 자리, 그 위 여유
  assert.equal(inBand({ x: 800, y: 900 - 60 }, BAR), true, '명령 바 자리');
  assert.equal(inBand({ x: 800, y: 900 - 118 }, BAR), true, '칩 줄 자리');
  assert.equal(inBand({ x: 800, y: 900 - BAND_PX }, BAR), true);
  assert.equal(inBand({ x: 800, y: 900 - BAND_PX - 1 }, BAR), false);
  assert.equal(inBand({ x: 400 - BAND_SIDE_PX, y: 880 }, BAR), true);
  assert.equal(inBand({ x: 1200 + BAND_SIDE_PX + 1, y: 880 }, BAR), false, '줌 알약 쪽');
});

test('P61 범위: 숨은 동안은 들어오는 범위, 보이는 동안은 나가는 범위로 본다', () => {
  const between = { x: 800, y: 900 - (BAND_PX + EXIT_BAND_PX) / 2 }; // 두 선 사이(위)
  const side = { x: 1200 + (BAND_SIDE_PX + EXIT_SIDE_PX) / 2, y: 880 }; // 두 선 사이(옆)
  for (const p of [between, side]) {
    assert.equal(bandZone(p, BAR, false), 'out', '숨은 동안 두 선 사이로는 나타나지 않는다');
    assert.equal(bandZone(p, BAR, true), 'band', '보이는 동안 두 선 사이에서는 숨지 않는다');
  }
  assert.equal(bandZone({ x: 800, y: 900 - EXIT_BAND_PX - 1 }, BAR, true), 'out', '나가는 선 밖');
  assert.equal(bandZone({ x: 800, y: 880 }, BAR, false), 'band');
  assert.equal(bandZone(null, BAR, true), 'out');
});

test('P61 범위: 마우스 단추를 누른 채(글 고르기, 끌기) 들어오면 띄우지 않고, 보이는 동안에는 그대로 둔다', () => {
  assert.equal(bandZone({ x: 800, y: 880, buttons: 1 }, BAR, false), 'out');
  assert.equal(bandZone({ x: 800, y: 880, buttons: 1 }, BAR, true), 'band');
  assert.equal(bandZone({ x: 800, y: 880, buttons: 0 }, BAR, false), 'band');
});

test('P61 숨김 늦추기: 나가는 범위를 벗어난 뒤 HIDE_DELAY_MS가 지나야 숨고, 그 안에 돌아오면 숨지 않는다', () => {
  assert.ok(HIDE_DELAY_MS >= 500, '깜빡이지 않을 만큼 늦춘다');
  assert.ok(SHOW_DELAY_MS >= 80 && SHOW_DELAY_MS < HIDE_DELAY_MS);
  // 보이는 중 두 선 사이로 내려가도 그대로
  const z = bandZone({ x: 800, y: 900 - (BAND_PX + EXIT_BAND_PX) / 2 }, BAR, true);
  assert.deepEqual(bottomNext({ shown: true, zone: z }), { shown: true, delay: 0 });
  // 나가면 늦게 숨는다(기다리는 동안 돌아오면 같은 상태라 기다리던 숨김은 버린다)
  assert.deepEqual(bottomNext({ shown: true, zone: 'out' }), { shown: false, delay: HIDE_DELAY_MS });
  assert.deepEqual(bottomNext({ shown: true, zone: 'band' }), { shown: true, delay: 0 });
  // 숨은 뒤 다시 들어오면 잠깐 머문 뒤 나타난다
  assert.deepEqual(bottomNext({ shown: false, zone: 'band' }), { shown: true, delay: SHOW_DELAY_MS });
  // 쓰다 만 글, 초점이 있으면 범위 밖이어도 숨지 않는다
  assert.deepEqual(bottomNext({ shown: true, zone: 'out', draft: true }), { shown: true, delay: 0 });
  assert.deepEqual(bottomNext({ shown: true, zone: 'out', focused: true }), { shown: true, delay: 0 });
});

test('P61 찾기: 맞는 글자 나누기(대소문자 무시, 낱말 여럿, 겹침 합치기)', () => {
  const join = (r) => r.map((m) => m.text).join('');
  const hits = (r) => r.filter((m) => m.hit).map((m) => m.text);
  assert.deepEqual(markRanges('mtask-p61-dir', 'p61'), [{ text: 'mtask-', hit: false }, { text: 'p61', hit: true }, { text: '-dir', hit: false }]);
  assert.deepEqual(hits(markRanges('P61 Search board', 'p61 BOARD')), ['P61', 'board']);
  const r = markRanges('abcabc', 'ab bc');
  assert.equal(join(r), 'abcabc');
  assert.deepEqual(hits(r), ['abcabc'], '겹치거나 붙은 곳은 하나로');
  assert.deepEqual(markRanges('hello', ''), [{ text: 'hello', hit: false }]);
  assert.deepEqual(markRanges('hello', 'zz'), [{ text: 'hello', hit: false }]);
  assert.deepEqual(markRanges('', 'a'), []);
  assert.equal(join(markRanges('검색 창 다시 그리기', '창 그리')), '검색 창 다시 그리기');
  assert.deepEqual(hits(markRanges('검색 창 다시 그리기', '창 그리')), ['창', '그리']);
});

test('P61 찾기: 종류 아이콘, 필드 이름 한 번만, 위아래 키 돌기, 닫는 시간', () => {
  for (const k of ['session', 'workspace', 'memo', 'kanban', 'other']) assert.ok(hasIcon(kindIcon(k)), k);
  assert.equal(showField('메모', '메모'), false);
  assert.equal(showField('Workspace', 'workspace'), false);
  assert.equal(showField('질문', '세션'), true);
  assert.equal(showField('', '세션'), false);
  assert.equal(showSnip('p61 search board', 'P61 Search Board'), false, '칸반 제목이 맞으면 이름과 같은 글');
  assert.equal(showSnip('C:/x/dir', 'dir'), true);
  assert.equal(showSnip('', 'a'), false);
  assert.equal(movePick(0, 3, 1), 1);
  assert.equal(movePick(2, 3, 1), 0);
  assert.equal(movePick(0, 3, -1), 2);
  assert.equal(movePick(0, 0, 1), 0);
  assert.ok(SEARCH_LEAVE_MS >= 120 && SEARCH_LEAVE_MS <= 200);
});
