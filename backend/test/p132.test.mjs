// P132: herdr 의존 정리. 터미널은 herdr-core 하나, 옛 판 옮기기는 계속 지원, 플러그인 이름 atrium
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Backend } from '../src/backend.mjs';
import { BOARD_SYSTEM_PROMPT, PLUGIN_NAME, OLD_PLUGIN_NAMES } from '../src/launch.mjs';
import { terminalSessionVar, terminalSessionEnv } from '../src/config.mjs';

test('P132 옛 API 이름(herdr.*)은 받지 않는다. 터미널 API는 terminal.*', () => {
  const h = Backend.prototype.handlers.call({});
  assert.deepEqual(Object.keys(h).filter((k) => /^herdr\./.test(k)), []);
  for (const k of ['terminal.status', 'terminal.stop', 'terminal.start', 'terminal.restart']) assert.equal(typeof h[k], 'function', k);
});

test('P132 터미널 이벤트는 terminal 하나(옛 이름 herdr는 내지 않는다)', () => {
  const sent = [];
  Backend.prototype.broadcastTerminal.call({ api: { broadcast: (ev) => sent.push(ev) } }, { connected: true });
  assert.deepEqual(sent, ['terminal']);
});

test('P132 backend.status는 0.1.7까지의 바꾸기(update-swap)가 보는 옛 칸 herdr를 함께 낸다(옛 판에서 올라오는 길)', async () => {
  const term = { connected: true, running: true };
  const self = { terminalStatus: async () => term, cfg: { port: 1, profile: 'dev', dataDir: 'x' }, sessions: new Map(), relay: { stats: () => [] }, migrationView: () => null };
  const st = await Backend.prototype.handlers.call(self)['backend.status'].call(self);
  assert.equal(st.terminal, term); assert.equal(st.herdr, term);
});

test('P132 플러그인 이름 atrium, 안내문은 atrium:atrium. 옛 이름 atrium-herdr는 남은 폴더를 다시 쓸 때만', () => {
  assert.equal(PLUGIN_NAME, 'atrium'); assert.deepEqual(OLD_PLUGIN_NAMES, ['atrium-herdr']);
  assert.match(BOARD_SYSTEM_PROMPT, /atrium:atrium/); assert.doesNotMatch(BOARD_SYSTEM_PROMPT, /herdr/);
});

test('P132 터미널 세션 env: 옛 이름 ATRIUM_HERDR_SESSION을 계속 받고, 자식에게 두 이름을 같은 값으로 준다', () => {
  assert.equal(terminalSessionVar({ ATRIUM_HERDR_SESSION: 'old' }), 'old');
  assert.equal(terminalSessionVar({ ATRIUM_TERMINAL_SESSION: 'now' }), 'now');
  assert.throws(() => terminalSessionVar({ ATRIUM_TERMINAL_SESSION: 'a', ATRIUM_HERDR_SESSION: 'b' }));
  assert.deepEqual(terminalSessionEnv('s'), { ATRIUM_TERMINAL_SESSION: 's', ATRIUM_HERDR_SESSION: 's' });
});
