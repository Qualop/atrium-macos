// P107 단위 시험: 작업 중 테두리 빛. 미션 맵의 일하는 카드 테두리를 따라 도는 빛(styles.css·phone.css P107 덩어리, Mission.jsx MissionLight, lib/work-light.js)과
// 판 노드 둘레(.mt-node-run, P85)의 조건, 판 설정 workLight. P102 번쩍임을 갈음한다(p102-lib.test.mjs를 걷었다). transform만 움직임(합성), 2~3초에 한 바퀴,
// 설정 켬이면 움직임 줄이기에서도 돎(기본 켬), Windows 설정 따름은 no-preference에서만, 끔·가벼운 판은 멈춘 굵은 테두리, 미션 맵을 연 동안 판 둘레는 멈춤,
// 모든 카드가 같은 박자, 일하는 카드에만 층, 가벼움, 두 사전, 글 대비
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignLight, onLightStart, applyWorkLight, applyMissionOpen, workLightOf, LIGHT_MODES } from '../src/renderer/lib/work-light.js';
import { SETTINGS, WORK_LIGHT, normalizePatch, DEFAULTS } from '../../backend/src/settings.mjs';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const block = (css, tag) => { const a = css.indexOf(`/* ---------- ${tag}:`); assert.ok(a >= 0, `${tag} 덩어리`); const b = css.indexOf('/* ---------- P', a + 10); return css.slice(a, b < 0 ? undefined : b); };
const noComments = (s) => s.replace(/\/\*[^]*?\*\//g, '');
const ruleOf = (s, sel) => { const i = s.indexOf(`${sel} {`); assert.ok(i >= 0, `규칙 ${sel}`); return s.slice(i + sel.length + 2, s.indexOf('}', i)); };

test('박자: 빛 층 아래(가상 요소 포함) 움직임의 시작 시각을 문서 시간 0에 맞춘다, 없는 API에도 던지지 않는다', () => {
  const a1 = { startTime: 1234.5 }, a2 = { startTime: 98765 }, a3 = { startTime: 0 };
  let sets = 0, opts = null;
  const watched = (a) => new Proxy(a, { set(o, k, v) { if (k === 'startTime') sets++; o[k] = v; return true; } });
  const el = { getAnimations: (o) => { opts = o; return [watched(a1), watched(a2), watched(a3)]; } };
  alignLight(el);
  assert.deepEqual([a1.startTime, a2.startTime, a3.startTime], [0, 0, 0]);
  assert.deepEqual(opts, { subtree: true }, '돌아가는 원뿔은 감싸개의 ::before라 subtree로 읽는다');
  assert.equal(sets, 2, '이미 맞은 움직임은 건드리지 않는다');
  onLightStart({ currentTarget: el });
  assert.equal(sets, 2, '두 번째 animationstart에서는 바꿀 것이 없다');
  // subtree를 모르는 옛 브라우저: 인자 없이 다시
  const b1 = { startTime: 7 };
  alignLight({ getAnimations: (o) => { if (o) throw new TypeError('no options'); return [b1]; } });
  assert.equal(b1.startTime, 0);
  alignLight(null); alignLight({}); alignLight({ getAnimations: () => [Object.defineProperty({}, 'startTime', { get: () => 5, set: () => { throw new Error('no'); } })] });
});

test('설정 값: 기본 켬, 모르는 값은 켬, 문서 뿌리 data-work-light에 적는다, 미션 맵 덮개는 data-mm-open(문서가 없어도 던지지 않는다), 백엔드 선택지와 같다', () => {
  assert.deepEqual(LIGHT_MODES, ['on', 'system', 'off']);
  assert.deepEqual(WORK_LIGHT, LIGHT_MODES, '백엔드 settings.mjs와 같은 선택지');
  assert.equal(workLightOf(null), 'on'); assert.equal(workLightOf({}), 'on'); assert.equal(workLightOf({ workLight: 'blink' }), 'on');
  assert.equal(workLightOf({ missionLight: 'off' }), 'on', '옛 이름(릴리즈 전)은 읽지 않는다');
  for (const m of LIGHT_MODES) assert.equal(workLightOf({ workLight: m }), m);
  const doc = { documentElement: { dataset: {} } };
  assert.equal(applyWorkLight({ workLight: 'off' }, doc), 'off'); assert.equal(doc.documentElement.dataset.workLight, 'off');
  assert.equal(applyWorkLight(null, doc), 'on'); assert.equal(doc.documentElement.dataset.workLight, 'on');
  assert.equal(applyWorkLight({ workLight: 'system' }, null), null);
  assert.equal(applyWorkLight({ workLight: 'system' }, {}), null);
  assert.equal(applyMissionOpen(true, doc), true); assert.equal(doc.documentElement.dataset.mmOpen, '1');
  assert.equal(applyMissionOpen(false, doc), false); assert.ok(!('mmOpen' in doc.documentElement.dataset), '닫으면 지운다');
  assert.equal(applyMissionOpen(true, null), null);
});

test('판 설정 workLight: 고르기(on 기본, system, off), 다른 값은 거부, 창이 settings.updated로 따른다, 미션 맵 덮개를 문서 뿌리에', () => {
  assert.equal(SETTINGS.workLight.type, 'choice');
  assert.equal(DEFAULTS.workLight, 'on', '사용자의 PC는 늘 움직임 줄이기라 기본은 켬');
  assert.ok(!('missionLight' in SETTINGS), '옛 이름은 없다(릴리즈 전이라 옮기기 없음)');
  assert.match(SETTINGS.workLight.label, /보드/); assert.match(SETTINGS.workLight.label, /미션 맵/);
  assert.deepEqual(normalizePatch({ workLight: 'system' }), { workLight: 'system' });
  assert.deepEqual(normalizePatch({ workLight: ' off ' }), { workLight: 'off' });
  assert.throws(() => normalizePatch({ workLight: 'blink' }), (e) => e.code === 'bad_request');
  assert.throws(() => normalizePatch({ missionLight: 'on' }), (e) => e.code === 'bad_request');
  const store = read('store.js');
  assert.match(store, /function putSettings\(s\) \{[^\n]*applyWorkLight\(s\);/, '설정을 받으면(처음 읽기·settings.updated) 문서 뿌리에 적는다(PC 창·웹·휴대폰)');
  assert.match(store, /export function setMissionOpen\(v\) \{ state\.missionOpen = v; applyMissionOpen\(v\);/, '미션 맵을 열고 닫을 때 문서 뿌리에');
  const st = read('Settings.jsx');
  assert.match(st, /<WorkLightSetting settings=\{settings\} \/>/, '설정 › 일반에 칸');
  assert.match(st, /api\.call\('settings\.set', \{ key: 'workLight', value: mode \}\)/);
  assert.match(st, /LIGHT_MODES\.map/, '켬 / Windows 설정 따름 / 끔 세 단추');
});

test('두 사전: workLight 글이 같은 키로 둘 다 있다(판 노드와 미션 맵을 함께 말한다)', () => {
  const keys = ['name', 'on', 'system', 'off', 'hint', 'note'];
  for (const d of [en, ko]) for (const k of keys) assert.ok(typeof d.workLight[k] === 'string' && d.workLight[k].length > 0, k);
  assert.deepEqual(Object.keys(en.workLight).sort(), Object.keys(ko.workLight).sort());
  assert.ok(!en.missionLight && !ko.missionLight, '옛 키는 지웠다');
  assert.equal(en.workLight.name, 'Working session light'); assert.equal(ko.workLight.name, '작업 중 테두리 빛');
  assert.match(ko.workLight.system, /시스템/); assert.match(en.workLight.system, /system/i);
  assert.match(ko.workLight.note, /동작 줄이기/); assert.match(en.workLight.note, /reduced motion/);
  assert.match(ko.workLight.hint, /보드/); assert.match(ko.workLight.hint, /미션 맵/);
  assert.match(en.workLight.hint, /board/); assert.match(en.workLight.hint, /mission map/);
});

test('CSS 판 노드 둘레: 설정을 따른다(켬은 움직임 줄이기에서도 돎, system은 움직임 줄이기에서 멈춤, 끔은 늘 멈춤), 미션 맵을 연 동안 멈춤, 모양·속도·가벼운 판은 그대로', () => {
  const css = read('styles.css'), body = noComments(css);
  assert.match(body, /\.mt-node-run > i \{[^}]*animation: mt-run 2\.6s linear infinite; \}/, '모양·속도(2.6초, 부드럽게) 그대로');
  assert.match(body, /\nhtml\[data-work-light="off"\] \.mt-node-run > i \{ animation: none; background: var\(--run\); \}/, '끔: 늘 멈춘 고리(움직임 줄이기 모양)');
  assert.match(body, /\nhtml\[data-mm-open="1"\] \.mt-node-run > i \{ animation-play-state: paused; \}/, '미션 맵을 연 동안 멈춤');
  assert.match(body, /\nhtml\[data-mm-open="1"\] \.react-flow \*, html\[data-mm-open="1"\] \.react-flow \*::before, html\[data-mm-open="1"\] \.react-flow \*::after \{ animation-play-state: paused !important; \}/, '덮개 뒤 판의 다른 움직임(응답 필요 깜빡임 등)도 멈춤(no-preference GPU, 작업 기록)');
  const reduced = body.slice(body.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /html\[data-work-light="system"\] \.mt-node-run > i \{ animation: none; background: var\(--run\); \}/, 'system: 움직임 줄이기에서 멈춤');
  assert.ok(!/\n\s*\.mt-node-run > i \{ animation: none/.test(reduced), '켬(값 없음 포함)은 움직임 줄이기에서도 돈다(조건 없는 멈춤 규칙이 없다)');
  assert.match(body, /html\.mt-lite \.mt-node-run, html\.mt-lite \.mt-splash-lit \{ display: none !important; \}/, '가벼운 판은 그대로 숨긴다');
  assert.ok(!/\.mt-node-run[^{]*\{[^}]*steps\(/.test(body), '판 둘레는 부드럽게(steps 없음)');
});

test('CSS PC: transform만 돈다(합성), 2.4초에 한 바퀴·초당 30번, 도는 조건은 설정 켬(값 없음 포함)과 system + no-preference, 가벼운 판은 빠진다', () => {
  const p = block(read('styles.css'), 'P107'), body = noComments(p);
  const kf = (body.match(/@keyframes mt-mm-lturn \{([^]*?\})\s*\}/) || [])[1] || '';
  assert.match(kf, /transform: rotate\(1turn\)/);
  assert.ok(!/opacity|offset|stroke|--|background|width|height|left|top/.test(kf), `키프레임은 transform만 ${kf}`);
  const anims = [...body.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1]);
  assert.equal(anims.length, 1, '움직임은 돌아가는 원뿔 하나');
  assert.match(anims[0], /^mt-mm-lturn ([\d.]+)s steps\(72, end\) infinite$/, 'PC는 초당 30번(steps 72, 가리개 렌더 패스 값, 작업 기록)');
  const sec = Number(anims[0].match(/([\d.]+)s/)[1]);
  assert.ok(sec >= 2 && sec <= 3, `한 바퀴 2~3초 ${sec}`);
  assert.match(body, /\.mt-mm-lspin::before \{[^}]*animation: mt-mm-lturn/, '돌아가는 것은 감싸개의 ::before(정사각형 원뿔)');
  assert.match(body, /\.mt-mm-lspin \{[^}]*transform: scaleX\(1\.86\);/, '가로로 늘린 공간에서 돈다(둘레 속도 차이를 줄인다)');
  // 조건 둘
  const on = 'html:not(.mt-lite):not([data-work-light="off"]):not([data-work-light="system"]) .mt-mm-light';
  assert.match(ruleOf(body, on), /--mm-go: block;/, '켬(기본, 값 없음 포함): 움직임 줄이기와 상관없이 돈다');
  const media = (body.match(/@media \(prefers-reduced-motion: no-preference\) \{([^]*?)\n\}/) || [])[1] || '';
  assert.match(media, /html:not\(\.mt-lite\)\[data-work-light="system"\] \.mt-mm-light \{[^}]*--mm-go: block;/, 'system은 no-preference에서만');
  assert.equal((body.match(/--mm-go: block/g) || []).length, 2, '도는 조건은 둘뿐(끔·가벼운 판은 없다)');
  const ring = ruleOf(body, '.mt-mm-lring');
  assert.match(ring, /display: var\(--mm-go, none\);/, '조건 밖에서는 고리와 빛 무리를 그리지 않는다');
  assert.match(ring, /mask-composite: add, add, exclude, add;/, '가리개 하나: 빛 무리 둘 + (패딩 띠 = 고리)');
  assert.ok(!/mt-mm-lhalo/.test(body), '빛 무리를 따로 두지 않는다(카드마다 렌더 패스 하나)');
  assert.ok(!/prefers-reduced-motion: reduce/.test(p), 'reduce 덩어리를 더하지 않는다(P85 시험은 마지막 reduce 덩어리를 읽는다)');
});

test('CSS PC: 기본(끔·움직임 줄이기의 system·가벼운 판)은 멈춘 굵은 상태 색 테두리, 도는 동안은 옅은 바탕, 가볍다, 토큰만', () => {
  const p = block(read('styles.css'), 'P107'), body = noComments(p);
  const base = ruleOf(body, '\n.mt-mm-light');
  assert.match(base, /border: 2px solid var\(--mm-run\);/, '굵은(2px) 상태 색 테두리');
  assert.match(base, /background-color: color-mix\(in srgb, var\(--mm-run\) 6%, transparent\);/);
  assert.match(base, /z-index: -1;/); assert.match(base, /pointer-events: none;/);
  assert.ok(!/animation|opacity/.test(base), '기본 층은 움직이지 않는다');
  assert.match(body, /\.mt-mm-card\.t-work \{ --mm-run: var\(--st-working\); isolation: isolate; \}/, '층을 카드 글 아래에');
  assert.match(body, /\.mt-mm-card\.t-work\.shell \{ --mm-run: var\(--st-shell_running\); \}/, '일하는 셸은 초록');
  assert.ok(!/filter|backdrop-filter|will-change|box-shadow/.test(body), 'filter·will-change·그림자 없음');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(body), '색은 토큰만');
  assert.ok(!/opacity:\s*\.\d/.test(body), '투명도는 0.x로 적는다(P85 시험)');
  const css = noComments(read('styles.css'));
  assert.ok(!/mt-mm-flash|mt-pm-flash|mt-mm-glint|mt-mm-sweep/.test(css + noComments(read('phone.css'))), 'P102 번쩍임과 P101 빛줄기는 걷었다');
});

test('CSS 휴대폰: 같은 층, 카드 폭에 맞춘 원뿔 크기, steps로 낮은 박자, 가볍다(P89)', () => {
  const p = block(read('phone.css'), 'P107'), body = noComments(p);
  assert.match(body, /\.mt-pm-node \.mt-mm-lspin::before \{[^}]*animation-timing-function: steps\(36, end\);/, '휴대폰은 steps(36): 초당 15번(헤드리스 WebKit CPU, 작업 기록)');
  assert.match(body, /\.mt-pm-node\.t-work \{ --mm-run: var\(--st-working\); isolation: isolate; \}/);
  assert.match(body, /\.mt-pm-node\.t-work\.shell \{ --mm-run: var\(--st-shell_running\); \}/);
  assert.match(body, /\.mt-pm-node \.mt-mm-lspin::before \{[^}]*width: calc\(100% \/ 1\.86 \+ 72px\);[^}]*aspect-ratio: 1 \/ 1;/, '늘린 공간의 대각선(폭/1.86 + 높이 ≤ 72)보다 크다');
  assert.ok(!/filter|backdrop-filter|will-change|box-shadow/.test(body), 'filter·will-change·그림자 없음');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(body), '색은 토큰만');
  assert.ok(!/prefers-reduced-motion: reduce/.test(p));
});

test('그리기: 일하는 카드에만 빛 층(PC 카드, 휴대폰 카드), 가리개 하나, 시작하면 박자를 맞춘다', () => {
  const pc = read('Mission.jsx'), ph = read('PhoneMission.jsx');
  assert.match(pc, /\{tier === 'work' && <MissionLight role="mm-light" \/>\}/);
  assert.match(ph, /\{r\.tier === 'work' && <MissionLight role="pm-light" \/>\}/);
  const comp = pc.slice(pc.indexOf('export function MissionLight'), pc.indexOf('function Node('));
  assert.match(comp, /<span className="mt-mm-light" data-role=\{role\} aria-hidden="true" onAnimationStart=\{onLightStart\}>/);
  assert.match(comp, /<i className="mt-mm-lring"><i className="mt-mm-lspin" \/><\/i>/);
  const pcRows = pc.slice(pc.indexOf("if (b.kind === 'dot')"), pc.indexOf('<div className={`mt-mm-card'));
  assert.ok(!/MissionLight/.test(pcRows), 'PC 한 줄·동그라미에는 층이 없다');
  const card = ph.slice(ph.indexOf('<button type="button" className={`mt-pm-node'));
  assert.ok(card.indexOf('MissionLight') > 0 && card.indexOf('MissionLight') < card.indexOf('</button>'));
  assert.ok(!/MissionLight/.test(ph.slice(ph.indexOf("if (n.kind === 'dot')"), ph.indexOf('const team = r.team'))), '휴대폰 한 줄·동그라미에는 층이 없다');
  assert.ok(!fs.existsSync(path.join(R, 'lib', 'mission-flash.js')) && !fs.existsSync(path.join(R, 'lib', 'mission-light.js')), 'P102 박자 파일은 work-light.js로 바뀌었다');
});

test('글 대비: 멈춘 표시(바탕 6%)와 도는 동안(4%) 위에서 모든 카드 글 4.5 이상', () => {
  const tk = read('tokens.css');
  const hex = (name) => { const m = tk.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i')); assert.ok(m, name); return [1, 3, 5].map((i) => parseInt(m[1].slice(i, i + 2), 16)); };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const mix = (a, b, t) => a.map((x, i) => x * t + b[i] * (1 - t));
  const ratio = (a, b) => { const [h, l] = L(a) > L(b) ? [L(a), L(b)] : [L(b), L(a)]; return (h + 0.05) / (l + 0.05); };
  const body = noComments(block(read('styles.css'), 'P107'));
  const tints = [...body.matchAll(/background-color: color-mix\(in srgb, var\(--mm-run\) (\d+)%, transparent\)/g)].map((m) => Number(m[1]) / 100);
  assert.ok(tints.length >= 2 && Math.max(...tints) <= 0.06, `바탕은 옅게 ${tints}`);
  for (const tint of tints) for (const run of ['st-working', 'st-shell_running']) for (const card of ['mm-card-2', 'mm-card-lead-2']) {
    const bg = mix(hex(run), hex(card), tint);
    for (const t of ['text', 'text-2', 'dim', 'dim-2']) assert.ok(ratio(hex(t), bg) >= 4.5, `${run}/${card} 바탕 ${tint} 위 ${t} ${ratio(hex(t), bg).toFixed(2)}`);
  }
});
