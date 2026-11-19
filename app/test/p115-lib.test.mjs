// P115 창 단위 시험: 런처 틀의 연결 고르기(쓸 수 없는 연결은 흐리게와 까닭), 연결 틀의 기본값, 두 언어 사전의 연결 글
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionChoices, harnessProtocols, baseUrlHintKey, blankConnection, blankLauncher } from '../src/renderer/lib/launchers.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const HS = [
  { id: 'claude', fields: ['connection'], protocols: ['anthropic-messages'] },
  { id: 'codex', fields: ['connection'], protocols: ['openai-responses'] },
  { id: 'pi', fields: ['connection'], protocols: ['openai-chat', 'openai-responses', 'anthropic-messages'] },
  { id: 'shell', fields: [], protocols: [] },
];
const CS = [{ id: 'ca', name: 'A', protocol: 'anthropic-messages', baseUrl: 'http://a' }, { id: 'co', name: 'O', protocol: 'openai-chat', baseUrl: 'http://o/v1' }];

test('P115 연결 고르기: 그 하네스의 프로토콜만 고를 수 있다', () => {
  assert.deepEqual(connectionChoices(CS, HS, 'claude').map((c) => [c.id, c.ok]), [['ca', true], ['co', false]]);
  assert.deepEqual(connectionChoices(CS, HS, 'codex').map((c) => c.ok), [false, false]);
  assert.deepEqual(connectionChoices(CS, HS, 'pi').map((c) => c.ok), [true, true]);
  assert.deepEqual(connectionChoices(CS, HS, 'grok').map((c) => c.ok), [false, false], '표에 없는 하네스는 연결을 쓰지 않는다');
  assert.deepEqual(connectionChoices(null, HS, 'pi'), []);
  assert.deepEqual(harnessProtocols(HS, 'codex'), ['openai-responses']);
  assert.equal(baseUrlHintKey('anthropic-messages'), 'connections.baseUrlPhAnthropic');
  assert.equal(baseUrlHintKey('openai-chat'), 'connections.baseUrlPhOpenai');
  assert.equal(blankLauncher('codex').connection, ''); assert.equal('checkUrl' in blankLauncher(), false);
  assert.deepEqual(blankConnection().auth, { env: '', scheme: '' });
});

test('P115 사전: 연결 탭·연결 칸·오류 글이 두 언어에 같은 키로 있다', () => {
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
  assert.deepEqual(keys(en.connections), keys(ko.connections));
  assert.deepEqual(keys(en.launcherConn), keys(ko.launcherConn));
  for (const d of [en, ko]) {
    for (const p of ['anthropic-messages', 'openai-responses', 'openai-chat']) assert.equal(typeof d.connections.protocols[p], 'string', p);
    for (const k of ['connectionMissing', 'connectionProtocol', 'connectionHarness']) assert.equal(typeof d.launchers.err[k], 'string', k);
    for (const k of ['missingStart', 'piExtension', 'inUse', 'exists', 'protocolMismatch']) assert.equal(typeof d.connections.err[k], 'string', k);
    assert.match(d.connections.plainNotice, /\{name\}/); assert.match(d.connections.plainNotice, /\{names\}/);
    assert.equal(typeof d.backend.commandNoPrompt, 'string');
  }
});
