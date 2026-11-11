// P83 휴대폰 화면 다듬기: 휴대폰 글자 배율의 새 하한(40%)과 저장값 맞추기, PC 창 배율은 그대로,
// 화면 높이(iOS 홈 화면 앱의 짧은 창 높이, 안전 영역, 브라우저 도구 막대 접힘, 키보드 열림), 전체 보기 칸 나누기, 명령 바를 키보드 위로 올릴 양
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clampScale, clampPhoneScale, termFontSize, PHONE_SCALE_MIN, PHONE_SCALE_DEFAULT, SCALE_MIN, SCALE_MAX } from '../src/renderer/lib/scale.js';
import { screenBox, viewportBox, TALL_GAP_MAX } from '../src/renderer/lib/phone.js';
import { fullLayout, kbLift, KB_OPEN_PX } from '../src/renderer/lib/touch-board.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', 'src', 'renderer', p), 'utf8');

test('휴대폰 글자 배율: 40%까지 5% 단위, 위는 150%', () => {
  assert.equal(PHONE_SCALE_MIN, 0.4);
  assert.equal(clampPhoneScale(0.4), 0.4);
  assert.equal(clampPhoneScale(0.45), 0.45);
  assert.equal(clampPhoneScale(0.3), 0.4);
  assert.equal(clampPhoneScale(0.42), 0.4);
  assert.equal(clampPhoneScale(0.7), 0.7);
  assert.equal(clampPhoneScale(2), SCALE_MAX);
  // A−(0.05씩)로 줄이면 0.8 → 0.4에서 멈춘다(떠도는 소수 없이)
  let v = 0.8; const seen = [];
  for (let i = 0; i < 12; i++) { v = clampPhoneScale(Math.round((v - 0.05) * 100) / 100); seen.push(v); }
  assert.deepEqual(seen.slice(0, 8), [0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4]);
  assert.equal(seen[seen.length - 1], 0.4);
});

test('휴대폰 글자 배율: 저장값 맞추기(없음, 이상한 글, 0, 음수, 무한은 기본 80%, 범위 밖은 끝 값)', () => {
  assert.equal(PHONE_SCALE_DEFAULT, 0.8);
  for (const bad of [null, undefined, '', 'abc', 'NaN', '0', 0, -1, Infinity]) assert.equal(clampPhoneScale(bad), PHONE_SCALE_DEFAULT, String(bad));
  assert.equal(clampPhoneScale('0.7'), 0.7); // P76까지 저장된 가장 작은 값은 그대로
  assert.equal(clampPhoneScale('0.55'), 0.55);
  assert.equal(clampPhoneScale('0.1'), 0.4);
  assert.equal(clampPhoneScale('9'), SCALE_MAX);
});

test('PC 창의 터미널 글자 배율(70~150%)은 그대로, 글자 크기는 고른 맞추기 함수를 따른다', () => {
  assert.equal(SCALE_MIN, 0.7);
  assert.equal(clampScale(0.4), 0.7);
  assert.equal(termFontSize(14, 0.4), 9.8); // PC: 70% 아래로 내려가지 않는다
  assert.equal(termFontSize(14, 0.4, clampPhoneScale), 5.6); // 휴대폰: 5.6px
  assert.equal(termFontSize(14, 0.8, clampPhoneScale), 11.2);
  // 세로 iPhone(390px, 터미널 칸 384px)에서 JetBrains Mono(글자 폭 0.6em) 칸 수: 40%면 110칸 넘게
  const cols = (f) => Math.floor(384 / (termFontSize(14, f, clampPhoneScale) * 0.6));
  assert.ok(cols(0.4) >= 110, String(cols(0.4)));
  assert.ok(cols(0.7) < 70);
});

test('휴대폰 화면만 휴대폰 맞추기를 쓴다(TerminalView fontScale, Phone, PhoneFull)', () => {
  assert.match(read('TerminalView.jsx'), /fontScale != null \? clampPhoneScale : clampScale/);
  assert.match(read('Phone.jsx'), /clampPhoneScale\(store\(\)\.getItem\(PHONE_SCALE_KEY\)\)/);
  assert.match(read('PhoneFull.jsx'), /clampPhoneScale\(Math\.round/);
});

const vv = (height, offsetTop = 0) => ({ height, offsetTop });
const IPHONE = { innerWidth: 393, screenW: 393, screenH: 852 };

test('화면 높이: 브라우저 탭은 보이는 높이 그대로(도구 막대가 펴지고 접혀도)', () => {
  const tab = { ...IPHONE, standalone: false };
  assert.deepEqual(screenBox({ ...tab, vv: vv(659), innerHeight: 659 }), { height: 659, top: 0 }); // 도구 막대 펴짐
  assert.deepEqual(screenBox({ ...tab, vv: vv(745), innerHeight: 745 }), { height: 745, top: 0 }); // 도구 막대 접힘
  assert.deepEqual(screenBox({ ...tab, vv: null, innerHeight: 700 }), viewportBox(null, 700));
});

test('화면 높이: iOS 홈 화면 앱이 창 높이를 상태 표시줄(위 안전 영역 59px)만큼 짧게 주면 화면 높이', () => {
  const app = { ...IPHONE, standalone: true };
  assert.deepEqual(screenBox({ ...app, vv: vv(793), innerHeight: 793 }), { height: 852, top: 0, tall: 59 });
  assert.deepEqual(screenBox({ ...app, vv: vv(852), innerHeight: 852 }), { height: 852, top: 0 }); // 바른 높이면 그대로
  // 화면 값이 가로·세로로 바뀌어 와도 세로면 긴 변
  assert.equal(screenBox({ ...app, screenW: 852, screenH: 393, vv: vv(793), innerHeight: 793 }).height, 852);
  // 가로: 짧은 변
  assert.deepEqual(screenBox({ ...app, innerWidth: 852, vv: vv(340), innerHeight: 340 }), { height: 393, top: 0, tall: 53 });
  // 모자란 높이가 너무 크면(분할 화면 등) 손대지 않는다
  const h = 852 - TALL_GAP_MAX - 1;
  assert.deepEqual(screenBox({ ...app, vv: vv(h), innerHeight: h }), { height: h, top: 0 });
  // 화면 값을 모르면 그대로
  assert.deepEqual(screenBox({ standalone: true, innerWidth: 393, vv: vv(793), innerHeight: 793 }), { height: 793, top: 0 });
});

test('화면 높이: 키보드가 열리면 보이는 높이(홈 화면 앱도)', () => {
  const app = { ...IPHONE, standalone: true };
  assert.deepEqual(screenBox({ ...app, vv: vv(457), innerHeight: 793 }), { height: 457, top: 0 });
  assert.deepEqual(screenBox({ ...app, vv: vv(500, 40), innerHeight: 793 }), { height: 500, top: 40 }); // 화면이 밀려 올라감
});

test('전체 보기 칸 나누기: 바로잡은 높이만큼 터미널이 크고, 키보드 판단은 그대로', () => {
  const shortLay = fullLayout({ vvHeight: 793, innerHeight: 793, top: 99, line: 47, keys: 72 });
  const tallLay = fullLayout({ vvHeight: 852, innerHeight: 793, top: 99, line: 47, keys: 72 });
  assert.equal(tallLay.open, false);
  assert.equal(tallLay.room - shortLay.room, 59);
  // 키보드: 터미널 높이는 닫혔을 때 그대로(P76)
  const kb = fullLayout({ vvHeight: 457, innerHeight: 793, top: 99, line: 47, keys: 46, closedTerm: tallLay.room });
  assert.equal(kb.open, true);
  assert.equal(kb.term, tallLay.room);
  assert.equal(kb.room, 457 - 99 - 47 - 46);
});

test('명령 바를 키보드 위로 올릴 양', () => {
  assert.equal(KB_OPEN_PX, 120);
  assert.equal(kbLift({ stageBottom: 844, vvTop: 0, vvHeight: 844, innerHeight: 844 }), 0); // 키보드 없음
  assert.equal(kbLift({ stageBottom: 844, vvTop: 0, vvHeight: 780, innerHeight: 844 }), 0); // 도구 막대 정도의 차이는 키보드가 아니다
  assert.equal(kbLift({ stageBottom: 844, vvTop: 0, vvHeight: 500, innerHeight: 844 }), 344);
  assert.equal(kbLift({ stageBottom: 844, vvTop: 120, vvHeight: 500, innerHeight: 844 }), 224); // 브라우저가 화면을 밀어 올린 만큼 덜
  assert.equal(kbLift({ stageBottom: 852, vvTop: 0, vvHeight: 457, innerHeight: 793 }), 395); // 홈 화면 앱(늘린 판)
  assert.equal(kbLift({ stageBottom: 844, vvHeight: 0, innerHeight: 844 }), 0);
});

test('전체 보기: 나가기 단추, "탭하면 보드로" 글 없음, 글자 단추의 끝 막기, 두 사전', async () => {
  const src = read('PhoneFull.jsx');
  assert.match(src, /data-action="phone-full-exit"[^\n]*onClick=\{\(\) => closeFull\(\)\}/);
  assert.doesNotMatch(src, /mt-full-hint/);
  assert.match(src, /disabled=\{scale <= PHONE_SCALE_MIN\}/);
  const en = (await import('../src/renderer/locales/en.js')).default;
  const ko = (await import('../src/renderer/locales/ko.js')).default;
  for (const d of [en, ko]) for (const k of ['button', 'label', 'cmdOpen', 'cmdShort']) assert.ok(d.phoneExit && d.phoneExit[k], k);
  assert.equal(ko.phoneExit.button, '보드');
});

test('명령 바: 손가락은 아래 띠로 열지 않고 손잡이 단추로 연다(마우스는 그대로)', () => {
  const src = read('CommandBar.jsx');
  assert.match(src, /e\.pointerType === 'touch' \? 'out' : zoneOf\(e\)/);
  assert.match(src, /coarse && !shown && <button[^>]*data-action="bottom-open"/);
  const css = read('phone.css');
  assert.match(css, /\.mt-app\.phone-board \.mt-bottom \{[^}]*width: auto/);
  assert.match(css, /html\.mt-tall, html\.mt-tall body, html\.mt-tall #root \{ height: var\(--mt-screen-h\); \}/);
});
