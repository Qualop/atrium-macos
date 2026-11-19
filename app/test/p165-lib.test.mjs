// P165: 음성 입력 글 넣기(lib/voice-text.js). 흐린 글 → 확정, 커서 자리, 태그·그림 칩과 섞임, 녹음 중 손으로 고친 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceStart, voiceApply, voiceEdit, voiceDone, voiceEnd, liveRange, shiftPos, diffRange, splitLive, toPcm16, voiceErrorKey } from '../src/renderer/lib/voice-text.js';
import { mentionTokens, mirrorParts, recipients, toggleTag } from '../src/renderer/lib/cmd-input.js';
import { imageTokens, mergeTokens, expandImages } from '../src/renderer/lib/desktop-paste.js';

// 토막 여럿을 차례로 넣는다
function run(text, caret, steps) {
  let reg = voiceStart(text, caret), s = text;
  for (const m of steps) { const r = voiceApply(s, reg, m); s = r.text; reg = r.reg; }
  return { text: s, reg };
}

test('흐린 글 → 확정: 미확정 글은 바뀔 때마다 갈아 끼우고, 확정 글은 쌓인다', () => {
  let reg = voiceStart('', 0), s = '';
  let r = voiceApply(s, reg, { interim: '안녕' });
  assert.equal(r.text, '안녕'); assert.deepEqual(r.reg, { start: 0, fin: 0, live: 2 }); assert.deepEqual(liveRange(r.reg), { a: 0, b: 2 });
  r = voiceApply(r.text, r.reg, { interim: '안녕하세' });
  assert.equal(r.text, '안녕하세'); assert.deepEqual(r.reg, { start: 0, fin: 0, live: 4 });
  r = voiceApply(r.text, r.reg, { final: '안녕하세요', interim: ' 오늘' });
  assert.equal(r.text, '안녕하세요 오늘'); assert.deepEqual(r.reg, { start: 0, fin: 5, live: 3 }); assert.deepEqual(liveRange(r.reg), { a: 5, b: 8 });
  r = voiceApply(r.text, r.reg, { final: ' 오늘은', interim: '' });
  assert.equal(r.text, '안녕하세요 오늘은'); assert.equal(liveRange(r.reg), null);
  assert.equal(voiceEnd(r.reg), 9);
});

test('커서 자리: 녹음을 시작한 자리에 들어가고 뒤 글은 그대로, 앞 글자와 띄어 쓴다', () => {
  // 글 가운데(앞이 글자): 띄어 쓴다
  assert.equal(run('@a 고쳐 줘', 2, [{ final: '이거' }]).text, '@a 이거 고쳐 줘');
  assert.equal(run('@a 고쳐 줘', 3, [{ final: '이거 ' }]).text, '@a 이거 고쳐 줘');
  // 끝(앞이 빈칸): 들은 글 앞 빈칸을 뺀다
  assert.equal(run('@a ', 3, [{ final: ' hello', interim: ' wor' }]).text, '@a hello wor');
  // 끝(앞이 글자): 한 칸 띄운다
  assert.equal(run('@a 보고', 5, [{ interim: '해 줘' }]).text, '@a 보고 해 줘');
  // 확정 뒤 다음 토막은 Soniox 토큰의 빈칸을 그대로 쓴다
  assert.equal(run('', 0, [{ final: 'one' }, { final: ' two' }]).text, 'one two');
  // 시작 자리는 글 길이 안으로
  assert.deepEqual(voiceStart('abc', 99), { start: 3, fin: 0, live: 0 });
  assert.deepEqual(voiceStart('abc'), { start: 3, fin: 0, live: 0 });
});

test('shiftPos·diffRange: 바뀐 범위를 지나 커서를 옮긴다', () => {
  assert.equal(shiftPos(2, 5, 3, 4), 2);
  assert.equal(shiftPos(8, 5, 3, 4), 9); // 끝(바로 뒤)의 커서는 함께 밀린다
  assert.equal(shiftPos(6, 5, 3, 4), 9); // 미확정 글 안의 커서는 새 글 끝으로
  assert.equal(shiftPos(5, 5, 0, 4), 9); // 넣는 자리의 커서는 들은 글 뒤로
  assert.deepEqual(diffRange('abcdef', 'abXYef'), { at: 2, removed: 2, added: 2 });
  assert.deepEqual(diffRange('abc', 'abc'), { at: 3, removed: 0, added: 0 });
});

test('녹음 중 손으로 친 글·태그가 깨지지 않는다: 앞은 자리를 밀고, 뒤는 그대로', () => {
  // 들은 글이 들어가는 중에 앞머리에 @태그를 넣는다(세션 맵 카드 누르기 = toggleTag 포함)
  let { text, reg } = run('', 0, [{ final: '빌드 돌려', interim: ' 줘' }]);
  assert.equal(text, '빌드 돌려 줘');
  let next = toggleTag(text, 'worker');
  assert.equal(next, '@worker 빌드 돌려 줘');
  reg = voiceEdit(text, next, reg); text = next;
  assert.deepEqual(reg, { start: 8, fin: 5, live: 2 });
  let r = voiceApply(text, reg, { final: ' 줘.', interim: '' });
  assert.equal(r.text, '@worker 빌드 돌려 줘.');
  assert.deepEqual(recipients(r.text, [{ name: 'worker', kind: 'claude' }]).map((x) => x.name), ['worker']);
  // 손으로 앞을 지운다
  reg = voiceEdit(r.text, r.text.replace('@worker ', ''), r.reg);
  assert.deepEqual(reg, { start: 0, fin: 8, live: 0 });
  // 들은 글 뒤(끝 다음 글)를 고쳐도 자리는 그대로
  ({ text, reg } = run('@a  끝', 3, [{ final: '앞', interim: '말' }]));
  assert.equal(text, '@a 앞말 끝');
  assert.deepEqual(voiceEdit(text, text + '!', reg), reg);
});

test('들은 글 안·끝을 손으로 고치면 거기까지 보통 글로 두고 다음 들은 글은 그 끝에 이어진다', () => {
  let { text, reg } = run('', 0, [{ final: '하나 둘', interim: ' 셋' }]);
  // 들은 글 끝에 이어 친다(멈춘 사이 쉼표)
  let next = text + ',';
  reg = voiceEdit(text, next, reg); text = next;
  assert.deepEqual(reg, { start: 0, fin: 7, live: 0 });
  const r = voiceApply(text, reg, { final: ' 넷' });
  assert.equal(r.text, '하나 둘 셋, 넷');
  // 확정 글 가운데를 고친다
  ({ text, reg } = run('', 0, [{ final: 'abc', interim: 'de' }]));
  next = 'aXc' + 'de';
  reg = voiceEdit(text, next, reg);
  assert.deepEqual(reg, { start: 0, fin: 5, live: 0 });
  // 아직 들은 글이 없을 때 그 자리에 친 글은 앞으로 본다(들은 글은 친 글 뒤에)
  reg = voiceStart('@a ', 3);
  reg = voiceEdit('@a ', '@a 급함: ', reg);
  assert.equal(voiceApply('@a 급함: ', reg, { final: '서버 봐 줘' }).text, '@a 급함: 서버 봐 줘');
});

test('그림 칩과 섞임: 칩 뒤에서 녹음해도 칩은 그대로 보낼 때 경로로 바뀐다', () => {
  const images = { 1: { path: 'C:\\up\\shot.png' } };
  const start = '@a [Image 1] ';
  const { text } = run(start, start.length, [{ final: '이 그림 봐 줘' }]);
  assert.equal(text, '@a [Image 1] 이 그림 봐 줘');
  assert.equal(expandImages(text, images), '@a C:\\up\\shot.png 이 그림 봐 줘');
  // 칩 앞에서 녹음
  const r2 = run(start, 3, [{ final: '먼저' }]);
  assert.equal(r2.text, '@a 먼저 [Image 1] ');
  assert.equal(imageTokens(r2.text, images).length, 1);
});

test('splitLive: 겹 조각을 흐린 범위로 더 나눈다(태그 조각 안에 걸쳐도)', () => {
  const sessions = [{ name: 'a', kind: 'claude' }];
  const text = '@a 안녕 하세';
  const tokens = mergeTokens(mentionTokens(text, sessions), imageTokens(text, {}));
  const parts = splitLive(mirrorParts(text, tokens), { a: 5, b: 8 });
  assert.equal(parts.map((p) => p.text).join(''), text);
  assert.deepEqual(parts.filter((p) => p.live).map((p) => p.text), [' 하세']);
  assert.ok(parts[0].tag && !parts[0].live);
  assert.deepEqual(splitLive(parts, null), parts);
  const p2 = splitLive([{ text: 'abcdef' }], { a: 2, b: 4 });
  assert.deepEqual(p2, [{ text: 'ab' }, { text: 'cd', live: true }, { text: 'ef' }]);
});

test('voiceDone: 녹음 끝에 남은 미확정 글은 지우지 않고 보통 글로', () => {
  assert.deepEqual(voiceDone({ start: 1, fin: 2, live: 3 }), { start: 1, fin: 5, live: 0 });
  assert.equal(voiceDone(null), null);
});

test('toPcm16: 48kHz Float32 → 16kHz Int16(구간 평균), 범위 밖 값은 자른다', () => {
  const src = new Float32Array(4800).fill(0.5);
  const out = toPcm16(src, 48000);
  assert.equal(out.length, 1600);
  assert.equal(out[0], Math.round(0.5 * 32767));
  const clip = toPcm16(new Float32Array([2, -2, 2, -2, 2, -2]), 16000);
  assert.deepEqual([...clip], [32767, -32768, 32767, -32768, 32767, -32768]);
  assert.equal(toPcm16(new Float32Array(441), 44100).length, 160);
});

test('voiceErrorKey: 까닭 → 화면 글 열쇠, 영어·한국어 사전에 다 있다', async () => {
  assert.equal(voiceErrorKey('voice_no_key'), 'voice.noKey');
  assert.equal(voiceErrorKey('NotAllowedError'), 'voice.denied');
  assert.equal(voiceErrorKey('NotFoundError'), 'voice.noMic');
  assert.equal(voiceErrorKey('dropped'), 'voice.dropped');
  assert.equal(voiceErrorKey('whatever'), 'voice.failed');
  const en = (await import('../src/renderer/locales/en.js')).default;
  const ko = (await import('../src/renderer/locales/ko.js')).default;
  for (const k of ['start', 'stop', 'connecting', 'listening', 'stopping', 'noKey', 'denied', 'noMic', 'insecure', 'busy', 'limit', 'dropped', 'failed']) {
    assert.ok(en.voice[k], `en voice.${k}`); assert.ok(ko.voice[k], `ko voice.${k}`);
  }
  assert.match(ko.voice.noKey, /SONIOX_API_KEY/);
  assert.match(en.voice.noKey, /SONIOX_API_KEY/);
});

test('창 마이크 권한: 판 창 첫 쪽의 소리만 허락, 카메라·화면·다른 쪽은 막고 다른 권한은 그대로', async () => {
  const { permissionAllowed } = await import('../src/main/media-permission.mjs');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const boardFile = path.resolve('dist', 'index.html');
  const url = pathToFileURL(boardFile).href + '?x=1#y';
  assert.equal(permissionAllowed({ permission: 'media', mediaTypes: ['audio'], url, boardFile, fromBoard: true }), true);
  assert.equal(permissionAllowed({ permission: 'media', mediaTypes: ['audio', 'video'], url, boardFile, fromBoard: true }), false);
  assert.equal(permissionAllowed({ permission: 'media', mediaTypes: ['video'], url, boardFile, fromBoard: true }), false);
  assert.equal(permissionAllowed({ permission: 'media', mediaTypes: [], url, boardFile, fromBoard: true }), false);
  assert.equal(permissionAllowed({ permission: 'media', mediaTypes: ['audio'], url: 'https://example.com/', boardFile, fromBoard: true }), false);
  assert.equal(permissionAllowed({ permission: 'media', mediaTypes: ['audio'], url, boardFile, fromBoard: false }), false);
  assert.equal(permissionAllowed({ permission: 'notifications', url: 'x', boardFile, fromBoard: false }), true);
});
