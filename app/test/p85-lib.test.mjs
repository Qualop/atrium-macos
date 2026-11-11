// P85 멀리 보기 강조: 상태 → 강조 등급, 판 밖 대화 카드의 등급, 도는 둘레를 그릴 얼굴과 회전판 크기, "작업 중만 또렷하게" 켜기·끄기 저장,
// 그리고 CSS·레일·사전에 그 규칙이 있는지(움직임 줄이기, 화면 밖 멈춤, 두 사전의 문구)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tierOf, convoTier, runsRing, ringDiag, loadSpot, saveSpot, applySpot, SPOT_KEY, TIERS } from '../src/renderer/lib/overview.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', 'src', 'renderer', p), 'utf8');

test('강조 등급: 일함(working, starting, 셸 실행 중, 깨우는 중)', () => {
  for (const state of ['working', 'starting', 'shell_running']) assert.equal(tierOf({ state }), 'work', state);
  assert.equal(tierOf({ state: 'sleeping', waking: true }), 'work');
});

test('강조 등급: 내 차례와 오류는 일함과 따로', () => {
  assert.equal(tierOf({ state: 'waiting' }), 'turn');
  assert.equal(tierOf({ state: 'trust_wait' }), 'turn');
  assert.equal(tierOf({ state: 'error' }), 'alert');
});

test('강조 등급: 쉼(봤음), 검토 대기(안 봄), 잠듦, 끝남', () => {
  assert.equal(tierOf({ state: 'ready' }), 'rest');
  assert.equal(tierOf({ state: 'shell_idle' }), 'rest');
  assert.equal(tierOf({ state: 'ready', unseen: true }), 'review');
  assert.equal(tierOf({ state: 'shell_idle', unseen: true }), 'review');
  assert.equal(tierOf({ state: 'sleeping' }), 'sleep');
  assert.equal(tierOf({ state: 'exited' }), 'done');
  assert.equal(tierOf({ state: 'exited', unseen: true }), 'done');
});

test('강조 등급: 모르는 상태와 없는 세션은 쉼, 등급은 정해진 일곱 가지', () => {
  assert.equal(tierOf(null), 'rest');
  assert.equal(tierOf({ state: 'unknown' }), 'rest');
  for (const state of ['starting', 'trust_wait', 'ready', 'working', 'waiting', 'error', 'exited', 'shell_idle', 'shell_running', 'sleeping']) assert.ok(TIERS.includes(tierOf({ state })), state);
});

test('판 밖 대화 카드: 열려 있으면 쉼, 닫혔으면 끝남(판은 그 대화가 도는지 모른다)', () => {
  assert.equal(convoTier({ open: true, where: 'terminal' }), 'rest');
  assert.equal(convoTier({ open: false }), 'done');
  assert.equal(convoTier(null), 'done');
});

test('도는 둘레: 일함만, 가까이(터미널) 얼굴은 빼고', () => {
  for (const face of ['middle', 'far', 'icon']) assert.equal(runsRing('work', face), true, face);
  assert.equal(runsRing('work', 'close'), false);
  for (const tier of ['turn', 'alert', 'review', 'rest', 'sleep', 'done']) assert.equal(runsRing(tier, 'far'), false, tier);
});

test('도는 둘레의 회전판: 둘레 상자(노드 + 화면 기준 여백)의 대각선 이상', () => {
  for (const [w, h, z] of [[640, 360, 1], [640, 360, 0.12], [360, 640, 0.3], [1280, 720, 0.02]]) {
    const pad = (2 * 4) / z;
    const d = ringDiag(w, h, z);
    assert.ok(d >= Math.hypot(w + pad, h + pad), `${w}x${h}@${z}: ${d}`);
    assert.ok(d < Math.hypot(w + pad, h + pad) + 4, `${w}x${h}@${z}: 지나치게 크지 않다`);
  }
  assert.equal(ringDiag(640, 360, 0), ringDiag(640, 360, 0.02)); // 배율 0은 가장 작은 배율로 본다
});

test('작업 중만 또렷하게: 창 프로필 저장소에 켜기·끄기, 막힌 저장소에도 동작', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  assert.equal(loadSpot(storage), false);
  assert.equal(saveSpot(storage, true), true);
  assert.equal(m.get(SPOT_KEY), '1');
  assert.equal(loadSpot(storage), true);
  assert.equal(saveSpot(storage, false), false);
  assert.equal(m.has(SPOT_KEY), false);
  assert.equal(loadSpot(storage), false);
  m.set(SPOT_KEY, 'yes'); assert.equal(loadSpot(storage), false); // '1'만 켜짐
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(loadSpot(broken), false);
  assert.equal(saveSpot(broken, true), true); // 저장은 못 해도 이 창에서는 켜진다
  assert.equal(loadSpot(null), false);
  assert.equal(saveSpot(null, true), true);
  // 문서 뿌리 클래스
  const cls = new Set();
  const doc = { documentElement: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } } };
  applySpot(true, doc); assert.ok(cls.has('mt-spot'));
  applySpot(false, doc); assert.ok(!cls.has('mt-spot'));
  applySpot(true, undefined); // 문서가 없어도 던지지 않는다
});

test('CSS: 둘레는 transform만 돌고, 화면 밖이면 멈추고, 움직임 줄이기면 멈춘 고리', () => {
  const css = read('styles.css');
  const key = css.match(/@keyframes mt-run \{([^}]*\{[^}]*\})\s*\}/);
  assert.ok(key && /transform:\s*rotate\(1turn\)/.test(key[1]) && !/box-shadow|opacity|width|border/.test(key[1]), 'mt-run은 transform만');
  assert.match(css, /\.mt-node-run\[data-off="1"\] > i \{ animation-play-state: paused; \}/);
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.mt-node-run > i \{ animation: none;/);
  assert.match(reduced, /\.mt-node\.st-waiting:not\(\.face-close\)[^{]*\{ animation: none; \}/);
  // 쉬는 노드는 기본 보기에서 투명도로 흐리게 하지 않는다(P28). 투명도는 작업 중만 또렷하게(html.mt-spot)에서만
  const p85 = css.slice(css.indexOf('/* P85:'));
  for (const line of p85.split('\n').filter((l) => /opacity:\s*\.\d/.test(l))) assert.match(line, /^html\.mt-spot /, line);
});

test('레일 단추와 두 사전: 작업 중만 또렷하게(단축키 없음)', () => {
  const chrome = read('Chrome.jsx');
  assert.match(chrome, /action="spotlight"/);
  assert.match(chrome, /setSpotlight\(!spot\)/);
  assert.ok(!/spotlight/i.test(read('lib/keys.js')), '단축키를 만들지 않는다');
  for (const d of [en, ko]) { assert.ok(d.spotlight && d.spotlight.on && d.spotlight.off); }
  assert.match(ko.spotlight.on, /작업 중만 또렷하게/);
  assert.match(read('SessionNode.jsx'), /data-tier=\{tier\}/);
});
