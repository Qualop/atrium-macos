// P138 단위 시험: 웹 화면(PC 브라우저) 확대·축소 끊김.
// 새 Chromium(웹 화면의 브라우저)은 조상의 transform이 바뀔 때마다 SVG <text>를 화면 배율에 맞춰 다시 배치한다.
// 판을 움직이는 매 프레임 셸 종류 아이콘(>_)마다 레이아웃이 돌아 웹 각본의 레이아웃이 데스크톱 창의 7배였다.
// 종류 아이콘 글자를 HTML 글로 바꿨다(SessionNode.jsx KindIcon, styles.css P138 덩어리).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const noComments = (s) => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[^]*?\*\/\}/g, '');
const jsxFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? jsxFiles(path.join(dir, e.name)) : /\.(jsx|js)$/.test(e.name) ? [path.join(dir, e.name)] : []));

test('P138: 화면 코드 어디에도 SVG <text>가 없다(판 위 글은 HTML 글)', () => {
  const hits = jsxFiles(R).filter((f) => /<text[\s>]/.test(noComments(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(R, f));
  assert.deepEqual(hits, []);
});

test('P138: KindIcon 글자는 HTML(b)이고 크기는 상자 너비의 비율(cqw)이다', () => {
  const src = noComments(read('SessionNode.jsx'));
  const body = src.slice(src.indexOf('export function KindIcon'), src.indexOf('}', src.indexOf('</span>', src.indexOf('export function KindIcon'))));
  assert.match(body, /className="mt-kind-icon mt-kind-mk"/);
  assert.match(body, /role="img" aria-label=\{k\.label\} title=\{title \|\| k\.label\}/); // 예전 svg의 <title>과 aria-label을 지킨다
  assert.match(body, /<svg viewBox="0 0 100 100" aria-hidden="true">/); // 모양(원·육각형 등)은 그대로 svg
  assert.match(body, /<b style=\{\{ color: k\.ink, fontSize: `\$\{fs\}cqw` \}\}>\{k\.mark\}<\/b>/);
  assert.match(body, /const fs = k\.mark\.length > 1 \? 34 : 46;/); // 예전 viewBox 100의 글 크기와 같은 비율
});

test('P138: 아이콘 상자는 정사각형이고 너비로 글 크기를 잰다(styles.css P138 덩어리)', () => {
  const css = read('styles.css');
  const at = css.indexOf('/* ---------- P138:');
  assert.ok(at > 0, 'P138 덩어리');
  const block = css.slice(at);
  assert.match(block, /\.mt-kind-mk \{[^}]*aspect-ratio: 1;[^}]*container-type: inline-size;/);
  assert.match(block, /\.mt-kind-mk > svg \{[^}]*position: absolute; inset: 0; width: 100%; height: 100%;/);
  assert.match(block, /\.mt-kind-mk > b \{[^}]*position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;[^}]*font-weight: 800;/);
  // 예전 크기 규칙(.mt-kind-icon 너비·높이)은 그대로 이 상자에 걸린다
  assert.match(css, /\.mt-kind-icon \{ width: 70%; height: 70%; pointer-events: none; \}/);
});
