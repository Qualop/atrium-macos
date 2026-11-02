// P16 화면 언어: 사전 열쇠가 두 언어에 다 있는지, 코드가 부르는 열쇠가 사전에 있는지, 백엔드가 주는 열쇠가 사전에 있는지, 고르기·복수·되돌아가기
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';
import { t, translate, setLanguage, getLanguage, tMsg, errText, onLanguage } from '../src/renderer/lib/i18n.js';
import { ago, agoText, STATE_LABEL } from '../src/renderer/lib/labels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isPlural = (v) => v && typeof v === 'object' && Object.keys(v).every((k) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(k));
function leaves(o, at = '', out = new Map()) {
  for (const [k, v] of Object.entries(o)) {
    const p = at ? `${at}.${k}` : k;
    if (typeof v === 'string' || isPlural(v)) out.set(p, v); else leaves(v, p, out);
  }
  return out;
}
const EN = leaves(en), KO = leaves(ko);
const holes = (v) => new Set([...(typeof v === 'string' ? [v] : Object.values(v)).join(' ').matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'locales' && e.name !== 'node_modules') walk(p, exts, out); } else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

test('사전: 두 언어의 열쇠가 같고, 영어 복수형에는 other가 있다', () => {
  assert.deepEqual([...EN.keys()].filter((k) => !KO.has(k)), [], '한국어에 없는 열쇠');
  assert.deepEqual([...KO.keys()].filter((k) => !EN.has(k)), [], '영어에 없는 열쇠');
  for (const [k, v] of EN) if (isPlural(v)) assert.ok(v.other, `${k}에 other가 없다`);
});

test('사전: 자리 표시({이름})가 두 언어에서 같다', () => {
  const bad = [];
  for (const [k, v] of EN) {
    if (!KO.has(k)) continue;
    const a = holes(v), b = holes(KO.get(k));
    // 영어 복수형은 one에서 {n}을 빼고 "a session"처럼 쓸 수 있다
    if ([...b].some((x) => !a.has(x)) || [...a].some((x) => !b.has(x) && x !== 'n')) bad.push(`${k}: en {${[...a]}} ko {${[...b]}}`);
  }
  assert.deepEqual(bad, []);
});

test('사전: 영어 사전에는 한글이 없다(언어 이름 "한국어"만 예외)', () => {
  const bad = [...EN].filter(([, v]) => /[가-힣]/.test(JSON.stringify(v)) && JSON.stringify(v) !== '"한국어"').map(([k]) => k);
  assert.deepEqual(bad, []);
});

test('코드가 부르는 고정 열쇠는 모두 영어 사전에 있다(renderer, Electron main)', () => {
  const files = [...walk(path.join(ROOT, 'src', 'renderer'), ['.js', '.jsx']), ...walk(path.join(ROOT, 'src', 'main'), ['.mjs'])];
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:t|tr)\(\s*'([A-Za-z][\w]*(?:\.[\w-]+)+)'/g)) if (!EN.has(m[1])) missing.push(`${path.relative(ROOT, f)}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('백엔드가 주는 화면 글 열쇠(m, mk, keyed)는 두 사전의 backend.* 에 있다', () => {
  const files = walk(path.join(ROOT, '..', 'backend', 'src'), ['.mjs']);
  const keys = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:m|mk)\('([\w.]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\bkeyed\([^;]*?\),\s*'([\w.]+)'/g)) keys.add(m[1]);
  }
  assert.ok(keys.size > 20, `열쇠를 ${keys.size}개만 찾았다`);
  const missing = [...keys].filter((k) => !EN.has(`backend.${k}`) || !KO.has(`backend.${k}`));
  assert.deepEqual(missing, []);
});

test('고르기: 기본은 영어, 바꾸면 알린다, 한국어에 없으면 영어, 영어에도 없으면 열쇠', () => {
  assert.equal(getLanguage(), 'en');
  assert.equal(t('chips.arrange'), 'Arrange');
  const seen = [];
  const off = onLanguage((l) => seen.push(l));
  setLanguage('ko');
  assert.equal(t('chips.arrange'), '자동 정렬');
  assert.equal(STATE_LABEL.waiting, '응답 필요');
  setLanguage('xx'); // 모르는 언어는 영어
  assert.equal(getLanguage(), 'en');
  off();
  assert.deepEqual(seen, ['ko', 'en']);
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(t('no.such.key'), 'no.such.key'); } finally { console.warn = warn; }
  assert.equal(translate('ko', 'state.working'), '작업 중');
  assert.equal(STATE_LABEL.working, 'Working');
});

test('복수와 시간: 1 session / 2 sessions, 3m 4s ago / 3분 4초 전', () => {
  assert.equal(t('top.connSessions', { n: 1 }), '1 session on the board');
  assert.equal(t('top.connSessions', { n: 2 }), '2 sessions on the board');
  assert.equal(translate('ko', 'top.connSessions', { n: 2 }), '보드의 세션 2개');
  const now = 1_000_000_000;
  assert.equal(ago(now - 184_000, now), '3m 4s');
  assert.equal(agoText(now - 184_000, now), '3m 4s ago');
  setLanguage('ko');
  try { assert.equal(agoText(now - 184_000, now), '3분 4초 전'); assert.equal(ago(now - 3_720_000, now), '1시간 2분'); } finally { setLanguage('en'); }
});

test('백엔드 글: 열쇠가 있으면 번역(값 안의 열쇠와 목록도), 없으면 백엔드 글 그대로', () => {
  const r = { needsConfirm: true, message: '한국어 글', msg: { key: 'wsClose', vars: { name: 'a', root: 'C:/a' } } };
  assert.equal(tMsg(r), 'Close empty workspace a (C:/a). The folder and repo stay.');
  const loop = { msg: { key: 'loopConfirm', vars: { target: '@w', prompt: 'go', when: { key: 'loopEvery', vars: { every: { key: 'dur.m', vars: { n: 5 } } } }, stops: [{ key: 'loopStopRuns', vars: { n: 3 } }, { key: 'loopStopText', vars: { text: 'done' } }] } } };
  assert.match(tMsg(loop), /^Sends "go" to @w every 5 minutes\. Stops: after 3 sends, when "done" appears in the last answer/);
  assert.equal(tMsg({ message: '그대로' }), '그대로');
  assert.equal(errText(Object.assign(new Error('이미 있는 이름: x'), { code: 'name_taken', key: 'nameTaken', vars: { name: 'x' } })), 'Name already taken: x');
  assert.equal(errText(Object.assign(new Error('연결 끊김'), { code: 'disconnected' })), 'Not connected to the backend');
  assert.equal(errText(Object.assign(new Error('모르는 오류'), { code: 'weird' })), '모르는 오류');
  setLanguage('ko');
  try { assert.equal(tMsg(r), '빈 프로젝트 a (C:/a)을 닫습니다. 폴더와 Git 저장소는 그대로 유지합니다.'); } finally { setLanguage('en'); }
});
