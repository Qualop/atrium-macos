// P161 단위 시험: 세션 맵(.mt-sm-*)과 설정 런처·연결·새 세션 대화상자(.mt-ln-*)의 CSS 이름이 겹치지 않는다.
// 겹치면 세션 맵의 .mt-ln-row { position: absolute }가 런처 목록 줄에 걸려 글이 한 자리에 포개졌다. 연결 칸은 빈 상태 안내를 보인다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const css = read('styles.css');
const SETTINGS = ['Launchers.jsx', 'Connections.jsx', 'SpawnDialog.jsx'];

test('세션 맵은 mt-sm, 설정 쪽은 mt-ln만 쓴다', () => {
  const map = read('MissionLineage.jsx');
  assert.ok(!/mt-ln/.test(map), '세션 맵에 mt-ln 이름이 남지 않는다');
  assert.match(map, /className=\{`mt-mission mt-ta mt-sm /);
  for (const f of SETTINGS) assert.ok(!/mt-sm/.test(read(f)), `${f}에 세션 맵 이름이 없다`);
  assert.ok(!/mt-ln/.test(read('PhoneMap.jsx')));
});

test('styles.css의 .mt-ln 규칙은 모두 설정 쪽 클래스만 가리킨다', () => {
  // 설정 파일들이 실제로 쓰는 mt-ln 클래스
  const used = new Set();
  for (const f of [...SETTINGS, 'Phone.jsx', 'PhoneLaunch.jsx'].filter((f) => fs.existsSync(path.join(R, f)))) for (const m of read(f).matchAll(/mt-ln(-[a-z-]+)?/g)) used.add(m[0]);
  for (const m of css.matchAll(/\.(mt-ln(?:-[a-z-]+)?)/g)) assert.ok(used.has(m[1]), `세션 맵이 쓰던 이름이 남았다: .${m[1]}`);
  // 런처 줄에 걸리던 세션 맵 규칙이 없다
  for (const m of css.matchAll(/^([^{]*\.mt-ln-row[^{]*)\{([^}]*)\}/gm)) assert.ok(!/position:\s*absolute/.test(m[2]), m[0]);
  for (const m of css.matchAll(/^\.mt-ln \{([^}]*)\}/gm)) assert.ok(!/--ln-|color:/.test(m[1]), m[0]);
  // P157의 덮개 줄은 필요 없어졌다
  assert.ok(!/\.mt-mission \.mt-(ln|sm)-row/.test(css));
});

test('세션 맵 규칙과 반짝임 키프레임은 mt-sm 이름', () => {
  assert.match(css, /^\.mt-sm \{ --ln-line:/m);
  assert.match(css, /^\.mt-sm-row \{ position: absolute;/m);
  assert.match(css, /@keyframes mt-sm-blink /);
  assert.match(read('PhoneMap.jsx'), /className="mt-pmap-stage mt-ta mt-sm"/, 'P166: 휴대폰 맵도 .mt-sm 반짝임을 쓴다');
});

test('연결 칸 빈 상태: 무엇을 하는 칸인지와 더하는 법, 두 사전', () => {
  const src = read('Connections.jsx');
  assert.match(src, /data-role="connections-empty"/);
  for (const k of ['title', 'what', 'how']) {
    assert.match(src, new RegExp(`connEmpty\\.${k}`));
    assert.ok(en.connEmpty[k] && ko.connEmpty[k], k);
  }
  assert.match(css, /\.mt-cn-empty \{/);
});
