// P39 한국어 화면 글: Qualop 번역을 가져온 뒤에도 키 집합, 자리 표시, 복수형이 영어 사전과 맞고, macOS 낱말이 없다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const isPlural = (v) => v && typeof v === 'object' && Object.keys(v).length > 0 && Object.keys(v).every((k) => CATS.includes(k));
function leaves(o, at = '', out = new Map()) {
  for (const [k, v] of Object.entries(o)) {
    const p = at ? `${at}.${k}` : k;
    if (typeof v === 'string' || isPlural(v)) out.set(p, v); else leaves(v, p, out);
  }
  return out;
}
const EN = leaves(en), KO = leaves(ko);
const holes = (s) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const texts = (v) => (typeof v === 'string' ? [v] : Object.values(v));

test('P39: 한국어와 영어 사전의 키 집합이 같다', () => {
  assert.deepEqual([...EN.keys()].filter((k) => !KO.has(k)), [], '한국어에 없는 키');
  assert.deepEqual([...KO.keys()].filter((k) => !EN.has(k)), [], '영어에 없는 키');
  assert.equal(EN.size, KO.size);
});

test('P39: 모든 값의 자리 표시와 복수형이 영어와 같다', () => {
  const bad = [];
  for (const [k, e] of EN) {
    const v = KO.get(k);
    if (v === undefined) continue;
    // 복수형: 한국어 값이 복수형이면 영어도 복수형이고, 한국어에 other가 있다. 문자열 하나도 된다(한국어는 수를 가리지 않는다)
    if (isPlural(v)) {
      if (!isPlural(e)) bad.push(`${k}: 영어는 복수형이 아닌데 한국어는 복수형`);
      if (!('other' in v)) bad.push(`${k}: 한국어 복수형에 other가 없다`);
    }
    if (typeof v !== 'string' && !isPlural(v)) bad.push(`${k}: 값이 문자열이나 복수형이 아니다`);
    // 자리 표시: 한국어의 각 변형은 영어 other(또는 문자열)의 자리 표시와 같다
    const want = holes(isPlural(e) ? e.other : e);
    for (const s of texts(v)) {
      const got = holes(s);
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${k}: en {${want}} ko {${got}}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('P39: only platform guidance uses Mac wording; keyboard labels are adapted at runtime', () => {
  const platformGuidance = new Set(['settings.tray', 'settings.trayNote']);
  const koBad = [];
  for (const [k, v] of KO) {
    if (platformGuidance.has(k)) continue;
    for (const s of texts(v)) if (/\bMac\b|macOS|\bCommand\b|⌘|\bCmd\b|(^|[^가-힣])맥([^가-힣]|$)|맥OS|맥북|메뉴 막대|Finder/.test(s)) koBad.push(`${k}: ${s}`);
  }
  assert.deepEqual(koBad, []);
  // 영어 사전에서 Command는 "Command bar"처럼 보통 낱말로 쓰이므로 Mac 계열만 본다
  const enBad = [];
  for (const [k, v] of EN) for (const s of texts(v)) if (/\bMac\b|macOS|⌘|\bCmd\b|Finder/.test(s)) enBad.push(`${k}: ${s}`);
  assert.deepEqual(enBad, []);
});

test('P39: ko.js 머리에 번역 기여 표기가 있다', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'locales', 'ko.js'), 'utf8');
  assert.match(src.split(/\r?\n/)[0],/^\/\/ 한국어 번역: Qualop\(https:\/\/github\.com\/Qualop\/atrium-macos\)의 번역을 바탕으로 다듬었다\.$/);
});
