// P104 단위 시험(창): 판이 터미널 질문에 답하는 UI(승인 줄·카드)가 없어졌다. 휴대폰 키 패드의 키(백엔드 허용 목록 안), 보내는 줄(차례, 모으기, 실패하면 버림),
// 펼칠지, 사전, 새 CSS 클래스 이름이 다른 화면과 겹치지 않음
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAD_KEYS, PAD_MAX, keyQueue, padKeyOf, padOpen, KEY_ROW } from '../src/renderer/lib/phone.js';
import { KEY_NAMES, KEYS_MAX } from '../../backend/src/keys.mjs';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (...p) => fs.readFileSync(path.join(ROOT, 'src', 'renderer', ...p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('답하기 UI가 없다: ApprovalCard, 승인 줄과 휴대폰 카드의 클래스, 창의 session.answer 부르기', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'ApprovalCard.jsx')), false);
  const all = fs.readdirSync(path.join(ROOT, 'src', 'renderer')).filter((f) => /\.(jsx?|css)$/.test(f)).map((f) => [f, R(f)]);
  for (const [f, src] of all) {
    assert.ok(!/ApprovalCard|ANSWER_H|['"]session\.answer['"]|mt-answer|mt-a-(yes|no|term|more|wait)\b|mt-ph-answer|mt-ph-cardback|dismissAsk|dismissedAsks/.test(src), f);
  }
  const node = R('SessionNode.jsx');
  assert.ok(!/ asking'/.test(node), '노드에 asking 표시가 없다');
  assert.match(node, /function AskCallout/, '먼 얼굴의 묻는 글 말풍선은 남는다(알림)');
  assert.ok(!/reserve/.test(R('TerminalView.jsx')), '터미널을 줄이는 reserve가 없다');
  for (const d of [en, ko]) { assert.equal(d.approval, undefined); assert.equal(d.phone.showCard, undefined); }
  // 응답 필요를 알리는 것은 남는다: 상태 알약의 글, 응답 필요 목록 칩 글, 휴대폰 목록의 묻는 줄
  for (const d of [en, ko]) { assert.ok(d.state.waiting || d.state.waiting === '', 'state.waiting'); assert.ok(d.phone.secNeeds && d.phone.nextNeed); }
});

test('키 패드의 키는 백엔드 허용 목록(keys.mjs) 안에 있고, 한 요청에 담는 수도 같다', () => {
  assert.deepEqual(PAD_KEYS, ['esc', '1', '2', '3', '4', 'up', 'tab', 'space', 'enter', 'left', 'down', 'right']);
  for (const k of PAD_KEYS) assert.ok(KEY_NAMES.includes(k), k);
  assert.equal(PAD_MAX, KEYS_MAX);
  for (const k of ['up', 'down', 'left', 'right', 'enter', 'esc', 'tab']) assert.ok(PAD_KEYS.includes(k), `필수 키 ${k}`);
  assert.deepEqual(KEY_ROW, ['enter', 'esc', 'ctrlc', 'up', 'down', 'tab', 'shifttab', 'slash'], '키 줄은 그대로');
});

test('keyQueue: 누른 차례대로, 앞 요청이 도는 동안 누른 키는 다음 요청 하나로 모은다', async () => {
  const sent = [];
  let release;
  const q = keyQueue(async (keys) => { sent.push(keys.join('+')); await new Promise((r) => { release = r; }); });
  q.push('down');
  assert.deepEqual(sent, ['down']);
  q.push('down'); q.push('down'); q.push('enter');
  assert.equal(q.pending(), 3);
  assert.deepEqual(sent, ['down'], '앞 요청이 돌아오기 전에는 보내지 않는다');
  release(); await sleep(0);
  assert.deepEqual(sent, ['down', 'down+down+enter']);
  q.push('3');
  release(); await sleep(0);
  assert.deepEqual(sent, ['down', 'down+down+enter', '3']);
  release(); await sleep(0);
  assert.equal(q.pending(), 0); assert.equal(q.busy(), false);
});

test('keyQueue: 많이 눌러도 빠지지 않는다(요청 하나에 PAD_MAX개씩)', async () => {
  const sent = [];
  const q = keyQueue(async (keys) => { await sleep(1); sent.push(...keys); });
  const want = [];
  for (let i = 0; i < 80; i++) { const k = ['up', 'down', 'left', 'right', '1'][i % 5]; want.push(k); q.push(k); }
  for (let i = 0; i < 50 && (q.busy() || q.pending()); i++) await sleep(5);
  assert.deepEqual(sent, want);
});

test('keyQueue: 요청이 실패하면 모아 둔 키를 버리고 알린다(끊긴 뒤 늦게 닿지 않게). 그 뒤 누른 키는 보낸다', async () => {
  const sent = []; const errs = [];
  let fail = true; let release;
  const q = keyQueue(async (keys) => { sent.push(keys.join('+')); await new Promise((r) => { release = r; }); if (fail) throw Object.assign(new Error('x'), { code: 'disconnected' }); }, (e, n) => errs.push([e.code, n]));
  q.push('down'); q.push('enter'); q.push('1');
  release(); await sleep(0);
  assert.deepEqual(errs, [['disconnected', 3]]);
  assert.equal(q.pending(), 0);
  assert.deepEqual(sent, ['down'], '실패한 뒤 모아 둔 키를 보내지 않는다');
  fail = false;
  q.push('esc');
  release(); await sleep(0);
  assert.deepEqual(sent, ['down', 'esc']);
});

test('키 패드를 펼칠까: 응답이 필요하면 펼치고, 사람이 고른 것이 있으면 그것. 요청이 바뀌면 열쇠가 바뀐다', () => {
  const ak = (a) => (a ? a.toolUseId || String(a.since || '') : '');
  const w = { state: 'waiting', ask: { toolUseId: 't1' } };
  assert.equal(padOpen(w, null), true);
  assert.equal(padOpen(w, false), false);
  assert.equal(padOpen({ state: 'working' }, null), false);
  assert.equal(padOpen({ state: 'working' }, true), true);
  assert.equal(padOpen({ state: 'trust_wait' }, null), true, '신뢰 질문도 키로 답한다(판은 대신 답하지 않는다)');
  assert.equal(padKeyOf(w, ak), 'need|waiting|t1');
  assert.notEqual(padKeyOf({ state: 'waiting', ask: { toolUseId: 't2' } }, ak), padKeyOf(w, ak));
  assert.equal(padKeyOf({ state: 'working' }, ak), 'calm');
  assert.equal(padKeyOf({ state: 'ready' }, ak), 'calm');
});

test('Phone.jsx: 키 패드는 session.keys로 보내고, 패드가 펼쳐지면 키 줄 대신 보인다', () => {
  const src = R('Phone.jsx');
  assert.match(src, /phoneInputCall\(api, terms, id, 'session\.keys', \{ keys: list \}, target\)/);
  assert.match(src, /phoneInputTarget\(api, terms, id\)/);
  assert.match(src, /\{pad && <PhoneKeyPad /);
  assert.match(src, /\{live && !pad && \(\s*<div className="mt-ph-keys"/);
  assert.match(src, /data-action="phone-pad-open"/);
  assert.match(src, /data-action="phone-pad-close"/);
  assert.match(src, /onPointerDown=\{noFocus\}/, '눌러도 입력 줄의 초점과 화면 키보드를 건드리지 않는다');
});

test('새 CSS 클래스(mt-ph-pad, mt-ph-pk, mt-ph-padopen, mt-ph-padicon)는 phone.css 끝 덩어리에만 있고 다른 화면이 쓰지 않는다', () => {
  const NEW = ['mt-ph-pad', 'mt-ph-pk', 'mt-ph-padopen', 'mt-ph-padicon'];
  const css = fs.readdirSync(path.join(ROOT, 'src', 'renderer')).filter((f) => f.endsWith('.css'));
  for (const f of css) {
    const src = R(f);
    for (const c of NEW) {
      const n = (src.match(new RegExp(`\\.${c}(?![\\w-])`, 'g')) || []).length;
      if (f !== 'phone.css') assert.equal(n, 0, `${f} ${c}`);
    }
  }
  const phone = R('phone.css');
  const at = phone.indexOf('/* P104: 키 패드');
  assert.ok(at > 0);
  for (const c of NEW) assert.equal(phone.slice(0, at).match(new RegExp(`\\.${c}(?![\\w-])`)), null, `${c}는 P104 덩어리 앞에 없다`);
  const jsx = fs.readdirSync(path.join(ROOT, 'src', 'renderer')).filter((f) => f.endsWith('.jsx') && f !== 'Phone.jsx');
  for (const f of jsx) for (const c of NEW) assert.ok(!new RegExp(`['" ]${c}['" ]`).test(R(f)), `${f} ${c}`);
  // 칸 배치: 키마다 자리가 있고 Enter는 두 칸
  const block = phone.slice(at);
  for (const k of PAD_KEYS.filter((x) => x !== 'enter')) assert.match(block, new RegExp(`\\[data-pad-key="${k}"\\]`), k);
  assert.match(block, /"esc k1 k2 k3 k4 up tab" "close space enter enter left down right"/);
  assert.match(block, /min-height: 44px/);
  assert.match(block, /\.mt-ph-pk \{[^}]*touch-action: manipulation/);
  assert.match(block, /\.mt-ph-padopen \{[^}]*touch-action: manipulation/);
  // 패드가 열려 터미널 칸이 줄어든 직후 옛 높이의 xterm이 패드를 덮어 누름을 가져갔다(창 시험 quick). 칸 밖을 자른다
  assert.match(block, /\.mt-ph-term \{ overflow: hidden; \}/);
});

test('사전: 키 패드 글이 두 언어에 있고, 지운 열쇠는 없다', () => {
  const keys = ['group', 'open', 'close', 'space', 'left', 'right', 'up', 'down', 'digit', 'failed'];
  for (const d of [en, ko]) for (const k of keys) assert.ok(typeof d.phoneKeys[k] === 'string' && d.phoneKeys[k], k);
  assert.equal(ko.phoneKeys.open, '키 패드 열기');
  assert.equal(en.phoneKeys.digit.replace('{n}', '2'), 'Number 2');
  assert.ok(!/Answer in terminal/.test(JSON.stringify(en)), '없어진 단추 이름을 가리키는 글이 없다');
  assert.ok(!/터미널에서 답하기/.test(JSON.stringify(ko)));
  assert.ok(!/approval bar/.test(JSON.stringify(en)));
});
