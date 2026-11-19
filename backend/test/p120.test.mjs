// P120: 폴더가 없어진 빈 영역 치우기, 저장소가 없어진 워크트리 상자, 깨운 뒤 헛 초안
import test from 'node:test';
import assert from 'node:assert/strict';
import { goneWorkspaces } from '../src/workspaces.mjs';
import { draftAfterInput } from '../src/sleep.mjs';
import { attachWorktrees } from '../src/worktrees.mjs';

const ESC = '\x1b';

test('goneWorkspaces: 폴더가 없고 세션이 없는 영역만, 유예 뒤에', () => {
  const ws = [{ key: 'a', root: 'C:/x/a' }, { key: 'b', root: 'C:/x/b' }, { key: 'c', root: 'C:/x/c' }];
  const disk = new Set(['C:/x/a']);
  const exists = (p) => disk.has(p);
  const missingSince = new Map();
  // 처음 본 때는 지우지 않는다(잠깐 안 보이는 폴더)
  assert.deepEqual(goneWorkspaces(ws, { exists, busyKeys: new Set(['c']), missingSince, now: 1000, graceMs: 60000 }), []);
  assert.deepEqual([...missingSince.keys()].sort(), ['b', 'c']);
  // 유예가 지나면 폴더 없음 + 세션 없음(b)만. 세션이 든 c는 남는다. 폴더가 있는 빈 a는 사람이 지운다
  assert.deepEqual(goneWorkspaces(ws, { exists, busyKeys: new Set(['c']), missingSince, now: 61000, graceMs: 60000 }), ['b']);
  // 폴더가 돌아오면 셈을 지운다
  disk.add('C:/x/b');
  assert.deepEqual(goneWorkspaces(ws, { exists, busyKeys: new Set(['c']), missingSince, now: 62000, graceMs: 60000 }), []);
  assert.equal(missingSince.has('b'), false);
  // 판에서 빠진 워크스페이스의 셈도 지운다
  goneWorkspaces([{ key: 'a', root: 'C:/x/a' }], { exists, missingSince, now: 63000 });
  assert.equal(missingSince.size, 0);
});

test('draftAfterInput: 터미널이 대신 한 답은 초안이 아니다', () => {
  const replies = [
    `${ESC}]11;rgb:0c0c/0c0c/0c0c${ESC}\\`, // OSC 11 배경색(ST)
    `${ESC}]10;rgb:ffff/ffff/ffff\x07`, // OSC 10 글자색(BEL)
    `${ESC}P>|xterm.js(5.5.0)${ESC}\\`, // XTVERSION(DCS)
    `${ESC}P1$r0m${ESC}\\`, // DECRQSS
    `${ESC}[>0;276;0c`, // DA2
    `${ESC}[?1;2c`, // DA1
    `${ESC}[?2004;1$y`, // DECRPM
    `${ESC}[?u`, // 키보드 프로토콜
    `${ESC}[<0;3;4M${ESC}[<0;3;4m`, // SGR 마우스
    `${ESC}[M !!`, // X10 마우스
    `${ESC}[I${ESC}[O`, // 초점 알림
    `${ESC}[12;40R`, // 커서 자리 보고
    `${ESC}]11;rgb:0c0c/0c0c`, // 덩어리 끝에서 잘린 OSC
  ];
  for (const r of replies) assert.equal(draftAfterInput(false, r), false, JSON.stringify(r));
  // 깨운 뒤 이어서 온 답 묶음
  assert.equal(draftAfterInput(false, replies.join('')), false);
  // 이미 초안이 있으면 답이 와도 그대로
  assert.equal(draftAfterInput(true, `${ESC}[>0;276;0c`), true);
});

test('draftAfterInput: 사람이 친 글은 초안이다', () => {
  assert.equal(draftAfterInput(false, 'hello'), true);
  assert.equal(draftAfterInput(false, `${ESC}[200~pasted${ESC}[201~`), true);
  assert.equal(draftAfterInput(false, `${ESC}]11;rgb:0/0/0${ESC}\\a`), true); // 답 뒤에 친 글
  assert.equal(draftAfterInput(false, 'abc\r'), false); // 보냈다
  assert.equal(draftAfterInput(true, '\x15'), false); // Ctrl+U로 비웠다
  assert.equal(draftAfterInput(true, `${ESC}[A`), true); // 화살표는 그대로
});

// 워크트리 sync를 가짜 판으로 돌린다
function fakeBoard({ workspaces, sessions = [], closedKeys = [], areas = [] }) {
  const wss = new Map(workspaces.map((w) => [w.key, { kind: 'repo', ...w }]));
  let rows = [...areas];
  const removed = [], pruned = [];
  const b = {
    sessions: new Map(sessions.map((s) => [s.sessionId, s])),
    log: () => {},
    store: new Proxy({
      workspaces: () => [...wss.values()],
      getWorkspace: (k) => wss.get(k) || null,
      closedWorkspaceKeys: () => new Set(closedKeys),
      worktreeAreas: () => rows,
      deleteWorktreeArea: (k, wt) => { rows = rows.filter((a) => !(a.wsKey === k && a.wt === wt)); },
      putWorktreeArea: (a) => { rows = [...rows.filter((x) => !(x.wsKey === a.wsKey && x.wt === a.wt)), a]; },
      addEvent: () => {},
      nodes: () => [],
    }, { get: (o, k) => (k in o ? o[k] : () => []) }), // 나머지 읽기(메모, 칸반, 대화 노드 등)는 빈 목록
    removeWorkspace: (k, o) => { removed.push([k, o && o.why]); wss.delete(k); },
    onWorkspacesPruned: (l) => pruned.push(...l),
  };
  return { b, removed, pruned, rows: () => rows };
}

test('worktrees sync: 폴더가 없어진 빈 영역과 그 상자를 치운다, 세션이 든 영역은 상자만', async () => {
  const disk = new Set(['C:/r/live']);
  let t = 0;
  const { b, removed, pruned, rows } = fakeBoard({
    workspaces: [{ key: 'c:/r/live', root: 'C:/r/live' }, { key: 'c:/r/gone', root: 'C:/r/gone' }, { key: 'c:/r/kept', root: 'C:/r/kept' }],
    closedKeys: ['c:/r/kept'],
    areas: [{ wsKey: 'c:/r/gone', wt: 'c:/r/gone-wt', path: 'C:/r/gone-wt' }, { wsKey: 'c:/r/kept', wt: 'c:/r/kept-wt', path: 'C:/r/kept-wt' }],
  });
  const calls = [];
  const wt = attachWorktrees(b, { tickMs: 0, exists: (p) => disk.has(p), list: async (root) => { calls.push(root); return disk.has(root) ? `worktree ${root}\nHEAD 0\nbranch refs/heads/main\n` : null; }, goneGraceMs: 60000, now: () => t });
  await wt.sync('t1');
  assert.deepEqual(removed, []); // 유예 중
  assert.equal(rows().length, 2); // git을 못 읽으면 상자를 그대로 둔다
  t = 61000;
  const before = calls.length;
  await wt.sync('t2');
  assert.deepEqual(removed, [['c:/r/gone', 'gone']]);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].root, 'C:/r/gone');
  // 닫힌 기록이 남은 영역은 남고, 저장소가 없어졌으므로 빈 상자만 치운다(git을 부르지 않는다)
  assert.deepEqual(rows(), []);
  assert.deepEqual(calls.slice(before), ['C:/r/live']);
  wt.stop();
});
