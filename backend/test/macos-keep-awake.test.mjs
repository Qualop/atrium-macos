// macOS 판: 일하는 세션이 있으면 caffeinate로 잠들기를 막고, 모두 쉬면 잠시 뒤 푼다(keep-awake.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { KeepAwake } from '../src/keep-awake.mjs';

function fake() {
  const calls = [];
  const spawn = (cmd, args) => { const c = new EventEmitter(); c.kill = () => { c.killed = true; calls.push(['kill']); c.emit('exit'); }; calls.push([cmd, ...args]); return c; };
  return { calls, spawn };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('일하면 caffeinate -i -s -w <pid>, 모두 쉬면 잠시 뒤 끈다, 그 사이 다시 일하면 그대로', async () => {
  const f = fake();
  const k = new KeepAwake({ platform: 'darwin', spawn: f.spawn, pid: 4242, graceMs: 30 });
  k.onState('a', 'working');
  assert.deepEqual(f.calls[0], ['/usr/bin/caffeinate', '-i', '-s', '-w', '4242']);
  k.onState('b', 'working');
  assert.equal(f.calls.length, 1, '하나만 띄운다');
  k.onState('a', 'ready'); k.onState('b', 'ready');
  assert.equal(k.status().active, true, '바로 끄지 않는다');
  await sleep(10); k.onState('a', 'working'); await sleep(40);
  assert.equal(k.status().active, true, '다시 일하면 그대로');
  k.onClosed('a'); await sleep(50);
  assert.equal(k.status().active, false);
  assert.deepEqual(f.calls.at(-1), ['kill']);
});

test('설정을 끄면 바로 풀고, macOS가 아니면 아무것도 하지 않는다', () => {
  const f = fake(); let on = true;
  const k = new KeepAwake({ platform: 'darwin', spawn: f.spawn, enabled: () => on, graceMs: 10000 });
  k.onState('a', 'working'); assert.equal(k.status().active, true);
  on = false; k.update(); assert.equal(k.status().active, false);
  k.onState('b', 'working'); assert.equal(k.status().active, false);
  const g = fake();
  const w = new KeepAwake({ platform: 'win32', spawn: g.spawn });
  w.onState('a', 'working'); assert.equal(g.calls.length, 0);
});
