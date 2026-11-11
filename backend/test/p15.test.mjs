// P15 단위 시험: 노드의 X에서 닫으며 보관·삭제. 삭제는 막 끈 세션의 대화 기록을 휴지통으로 보내고 닫힌 세션 행(노드 자리, 선, 보관 표시)을 지운다.
// 그 대화가 아직 어딘가에서 돌면 지우지 않고 보관한다. herdr와 claude 없이 돈다. 대화 기록은 임시 폴더의 가짜 자료다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../src/store.mjs';
import { newRuntime } from '../src/state.mjs';
import { pathKey, normPath } from '../src/workspaces.mjs';
import { Recall } from '../src/recall.mjs';
import { DEFAULTS } from '../src/settings.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p15-'));
const ID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-00000000a015`;

function setup() {
  const root = tmp(), dataDir = tmp(), sessionsDir = tmp();
  const cwd = path.join(tmp(), 'repo');
  fs.mkdirSync(cwd, { recursive: true });
  const ws = { key: pathKey(cwd), kind: 'folder', root: normPath(cwd) };
  const store = new Store(path.join(dataDir, 'board.db'));
  store.insertWorkspace({ ...ws, createdAt: Date.now() });
  const b = {
    cfg: { convoRoots: [root], claudeProjects: root, claudeSessionsDir: sessionsDir, desktopSessionsDir: null, convoScanMs: 60000, sessionsDir: path.join(dataDir, 'sessions'), dataDir, hookTimeoutSec: 2, claudeJson: path.join(dataDir, 'none.json'), claudeCommand: 'claude' },
    store, bus: new EventEmitter(), sessions: new Map(), killing: new Set(), api: { broadcast: () => {} }, log: () => {}, hooked: () => true,
    ensureWorkspace: () => false, broadcastWorkspaces: () => {},
  };
  const trashed = [];
  const r = new Recall(b, { resolveCwd: async () => ws, readProcs: async () => [], settings: () => ({ ...DEFAULTS, autoOpenRepos: false }), trash: async (paths) => { for (const p of paths) { fs.rmSync(p, { recursive: true, force: true }); trashed.push(p); } return { trashed: paths, failed: [] }; } });
  // 판이 띄우고 막 끈 claude 세션 하나(대화 ID = 세션 ID), 대화 기록과 옆 폴더, 노드 자리, 선, 다른 세션
  const add = (id, name, closed = true) => {
    store.insertSession({ sessionId: id, name, cwd, permissionMode: 'manual', createdAt: 1, runtime: newRuntime({ kind: 'claude', hooked: true }), kind: 'claude', origin: 'board', workspaceKey: ws.key });
    if (closed) store.updateSession(id, { closedAt: Date.now(), closeReason: 'killed' });
  };
  const transcript = (id) => {
    const dir = path.join(root, path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-'));
    fs.mkdirSync(path.join(dir, id, 'subagents'), { recursive: true });
    const f = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(f, JSON.stringify({ type: 'user', cwd, entrypoint: 'cli', message: { role: 'user', content: '지시' } }) + '\n');
    return f;
  };
  return { b, r, store, trashed, add, transcript, sessionsDir, root };
}

test('닫으며 삭제: 대화 기록과 옆 폴더를 휴지통으로, 닫힌 세션 행·노드 자리·선·보관 표시를 지운다', async () => {
  const { r, store, trashed, add, transcript, root } = setup();
  add(ID(1), 's1'); add(ID(2), 's2', false);
  const f = transcript(ID(1));
  store.setNode({ session_id: ID(1), x: 0, y: 0, w: 100, h: 100 });
  store.insertLink({ linkId: 'l1', from: ID(2), to: ID(1), role: '워커', createdAt: 1 });
  store.setArchive('session', ID(1), { archivedAt: Date.now() });
  const out = await r.forgetClosed(ID(1), { waitMs: 0 });
  assert.equal(out.deleted, true);
  assert.equal(out.trashed, 2);
  assert.deepEqual(trashed.map(pathKey).sort(), [pathKey(f), pathKey(f.slice(0, -6))].sort());
  assert.equal(fs.existsSync(f), false);
  assert.equal(fs.existsSync(path.dirname(f)), false, '비게 된 프로젝트 폴더도 지운다');
  assert.ok(fs.existsSync(root), '뿌리는 남는다');
  assert.equal(store.closedSession(ID(1)), null);
  assert.equal(store.nodeOf(ID(1)), null);
  assert.equal(store.links({ all: true }).length, 0);
  assert.equal(store.archiveMarks().has(`session:${ID(1)}`), false);
  assert.ok(store.getSession(ID(2)), '다른 세션은 그대로');
  assert.ok(store.events({ sessionId: ID(1) }).some((e) => e.kind === 'session_deleted'), '이벤트 기록은 남긴다');
});

test('닫으며 삭제: 대화가 아직 어딘가에서 돌면 지우지 않고 보관한다', async () => {
  const { r, store, trashed, add, transcript, sessionsDir } = setup();
  add(ID(3), 's3');
  const f = transcript(ID(3));
  fs.writeFileSync(path.join(sessionsDir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: ID(3), cwd: '.', entrypoint: 'cli' }));
  const out = await r.forgetClosed(ID(3), { waitMs: 0 });
  assert.equal(out.deleted, false);
  assert.equal(out.archived, true);
  assert.equal(out.reason, 'running');
  assert.equal(trashed.length, 0);
  assert.ok(fs.existsSync(f));
  assert.ok(store.closedSession(ID(3)), '행은 남는다');
  assert.ok(store.archiveMarks().get(`session:${ID(3)}`).archivedAt, '보관으로 남는다');
});

test('닫으며 삭제: 대화 기록이 없는 세션(다른 종류 등)은 행만 지운다, 열린 세션은 지우지 않는다', async () => {
  const { r, store, trashed, add } = setup();
  add(ID(4), 's4'); add(ID(5), 's5', false);
  const out = await r.forgetClosed(ID(4), { waitMs: 0 });
  assert.equal(out.deleted, true);
  assert.equal(out.trashed, 0);
  assert.equal(trashed.length, 0);
  assert.equal(store.closedSession(ID(4)), null);
  await assert.rejects(() => r.forgetClosed(ID(5), { waitMs: 0 }), { code: 'not_found' });
  assert.equal(store.deleteClosedSession(ID(5)), false);
  assert.ok(store.getSession(ID(5)));
});
