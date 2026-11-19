// P25 창 단위 시험: DeepSeek 종류(로고, 레일 단추 그림, 보여줄 종류), 두 언어 사전의 글, 받은 로고에 스크립트가 없는지
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { kindOf, KINDS, shownKind, logoFor } from '../src/renderer/lib/kinds.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const file = (rel) => new URL(`../src/renderer/${rel}`, import.meta.url);

test('P25: DeepSeek 종류는 로고와 레일 단추 그림이 있고, 이름은 DeepSeek', () => {
  const k = kindOf('deepseek');
  assert.equal(k, KINDS.deepseek);
  assert.equal(k.label, 'DeepSeek');
  assert.equal(k.logo, 'assets/kinds/deepseek.svg');
  assert.equal(k.logoBadge, 'assets/kinds/deepseek-badge.svg');
  assert.ok(fs.existsSync(file(k.logo)) && fs.existsSync(file(k.logoBadge)));
  assert.equal(logoFor(k, 'waiting'), k.logo);
});

test('P25: 로고 파일에 스크립트, 이벤트 속성, 바깥 주소가 없다', () => {
  for (const f of [KINDS.deepseek.logo, KINDS.deepseek.logoBadge]) {
    const svg = fs.readFileSync(file(f), 'utf8');
    assert.match(svg, /^<svg[\s>]/);
    assert.doesNotMatch(svg, /<script|\son[a-z]+\s*=|href\s*=|<foreignObject|<image|url\(/i, f);
  }
});

test('P25: 보여줄 종류는 flavor가 먼저다(셸 패널에서 뜬 직접 명령 세션도 DeepSeek)', () => {
  assert.equal(shownKind({ kind: 'claude', flavor: 'deepseek' }), 'deepseek');
  assert.equal(shownKind({ kind: 'shell', flavor: 'deepseek' }), 'deepseek');
  assert.equal(shownKind({ kind: 'codex', flavor: null }), 'codex');
  assert.equal(shownKind({}), 'claude');
  assert.equal(shownKind(null), 'claude');
});

// P115: 게이트웨이 전용 글(레일 단추, 새 세션 창, 설정, 프록시 오류)은 뺐다. 아이콘과 띄운 방법(flavor) 글만 남는다
test('P25·P115: 아이콘·flavor 글은 두 언어 사전에 있고, 게이트웨이 전용 글은 없다', () => {
  const keys = [['spawn', 'startedCommand'], ['node', 'flavorHookedTitle'], ['node', 'flavorCommandTitle'], ['sidebar', 'kindDeepseek'], ['backend', 'commandNoPrompt']];
  for (const [a, b] of keys) for (const [name, d] of [['en', en], ['ko', ko]]) assert.ok(d[a] && typeof d[a][b] === 'string' && d[a][b], `${name}.${a}.${b}`);
  for (const d of [en, ko]) {
    for (const [a, b] of [['rail', 'deepseek'], ['spawn', 'deepseekOption'], ['settings', 'deepseekModel'], ['backend', 'deepseekProxyDown']]) assert.equal(d[a][b], undefined, `${a}.${b}`);
    assert.ok(!/opencodex|\bocx\b|10100/i.test(JSON.stringify(d)), '게이트웨이 도구 이름·포트가 없다');
  }
});
