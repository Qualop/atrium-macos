// P132: 사이드바 줄 글자 크기(폴더 > 워크스페이스 > 세션)와 줄 높이
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROW_H } from '../src/renderer/lib/sidebar-tree.js';

const css = fs.readFileSync(new URL('../src/renderer/sidebar.css', import.meta.url), 'utf8');
// 같은 선택자의 마지막 font-size(파일 끝 규칙이 이긴다)
function lastSize(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[},\\n])\\s*(?:[^{}]*,\\s*)?${esc}\\s*(?:,[^{}]*)?\\{[^}]*font-size:\\s*([\\d.]+)px`, 'g');
  let m, v = null;
  while ((m = re.exec(css))) v = Number(m[1]);
  return v;
}

test('P132 사이드바: 위 단계일수록 조금 크다(단계마다 0.5~1px), 세션은 P103(13px)보다 약 1px 크다', () => {
  const grp = lastSize('.mt-sb2-row.grp'), ws = lastSize('.mt-sb2-row.ws'), sess = lastSize('.mt-sb2-row.sess');
  assert.ok(grp > ws && ws > sess, `${grp} > ${ws} > ${sess}`);
  for (const d of [grp - ws, ws - sess]) assert.ok(d >= 0.5 && d <= 1, `단계 차이 ${d}`);
  assert.ok(sess >= 13.5 && sess <= 14.5, `세션 ${sess}`);
  // 작은 글도 함께 키웠다(시간·수는 세션 글보다 작다)
  for (const sel of ['.mt-sb2-time', '.mt-sb2-gn', '.mt-sb2-kind', '.mt-sb2-tag']) { const v = lastSize(sel); assert.ok(v && v < sess && v >= 11, `${sel} ${v}`); }
});

test('P132 사이드바: 줄 높이가 글자보다 넉넉하다(잘리지 않게)', () => {
  const lh = (px) => Math.ceil(px * 1.35); // 글줄 높이 어림(창 글꼴의 normal)
  assert.ok(ROW_H.group >= lh(lastSize('.mt-sb2-row.grp')) + 8, `폴더 ${ROW_H.group}`);
  assert.ok(ROW_H.ws >= lh(lastSize('.mt-sb2-row.ws')) + 8, `워크스페이스 ${ROW_H.ws}`);
  assert.ok(ROW_H.session >= lh(lastSize('.mt-sb2-row.sess')) + 8, `세션 ${ROW_H.session}`);
  // 응답 필요 줄: 이름 줄 + 질문 한 줄
  assert.ok(ROW_H.attn >= lh(lastSize('.mt-sb2-row.sess')) + lh(lastSize('.mt-sb2-ask')) + 6, `응답 필요 ${ROW_H.attn}`);
  assert.ok(ROW_H.group > ROW_H.ws, '폴더 줄은 위 틈(padding-top)만큼 더 높다');
});
