// P67: 같은 띄움을 두 번 긋지 않기(판 세션끼리의 띄움은 판의 연결 하나로), 선 이름표의 지시 수(linkPromptCount)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boardSpawnDup, BOARD_SPAWN_VIA } from '../src/convo-canvas.mjs';
import { Store } from '../src/store.mjs';

test('P67: 판 세션끼리의 띄움은 판의 연결이 있으면 대화 띄움 선을 긋지 않는다', () => {
  const links = new Set(['s-lead>s-w1']);
  const linked = (a, b) => links.has(`${a}>${b}`);
  // 판이 띄운 하위 세션(atrium child): 연결이 있든 없든 판의 연결이 맡는다
  assert.equal(boardSpawnDup({ from: 's-lead', to: 's-w1', via: 'atrium-child' }, linked), true);
  assert.equal(boardSpawnDup({ from: 's-lead', to: 's-w2', via: 'atrium-child' }, linked), true);
  assert.equal(boardSpawnDup({ from: 's-lead', to: 's-w2', via: 'mtask-spawn' }, linked), true);
  // 다른 방법(claude -w)으로 띄웠어도 판의 연결이 이미 있으면(어느 방향이든) 하나로
  assert.equal(boardSpawnDup({ from: 's-lead', to: 's-w1', via: 'claude' }, linked), true);
  assert.equal(boardSpawnDup({ from: 's-w1', to: 's-lead', via: 'herdr' }, linked), true);
  // 판의 연결이 없는 판 세션끼리의 다른 띄움은 그대로 긋는다
  assert.equal(boardSpawnDup({ from: 's-lead', to: 's-w2', via: 'claude' }, linked), false);
  // 판 밖 대화가 낀 띄움(J6 본래 목적)은 그대로
  assert.equal(boardSpawnDup({ from: 'convo:abc', to: 's-w1', via: 'atrium-child' }, linked), false);
  assert.equal(boardSpawnDup({ from: 's-lead', to: 'convo:def', via: 'atrium-child' }, linked), false);
  assert.equal(boardSpawnDup({ from: 'convo:abc', to: 'convo:def', via: 'claude' }, linked), false);
  assert.ok(BOARD_SPAWN_VIA.has('atrium-spawn'));
});

test('P67: 연결의 지시 수와 마지막 지시 시각은 prompt 기록만 본다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p67-'));
  const store = new Store(path.join(dir, 'board.db'));
  try {
    store.insertLink({ linkId: 'l1', from: 'a', to: 'b', spawned: true, createdAt: 1 });
    assert.deepEqual(store.linkPromptStats('l1'), { n: 0, at: null });
    store.addLinkEvent('l1', 'spawn', 'atrium child b', null, 10);
    store.addLinkEvent('l1', 'prompt', 'one', null, 20);
    store.addLinkEvent('l1', 'target_working', null, null, 25);
    store.addLinkEvent('l1', 'prompt', 'two', null, 30);
    store.addLinkEvent('l1', 'prompt', 'three', null, 40);
    store.addLinkEvent('l1', 'target_done', null, null, 50);
    store.addLinkEvent('l1', 'reply', 'THREE', null, 60);
    assert.deepEqual(store.linkPromptStats('l1'), { n: 3, at: 40 });
    assert.deepEqual(store.linkPromptStats('nope'), { n: 0, at: null });
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
