// P4 단위 시험: herdr와 claude 없이 돌릴 수 있는 규칙들(세션끼리 연결, 판에 올린 에이전트의 상태, 다른 종류, 워크트리, herdr 스킬 플러그인)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { splitCommands, parseHerdrCommands, parseHerdrOutput, readTextOf, tailText, screenAnswerText, freeSlotNear, facingSides, repoEdges, roleNotice, unlinkNotice, paneChangedNotice, linkLabel, ROLE_RE } from '../src/links.mjs';
import { newRuntime, applyHerdrStatus, applyAgentDetected, applyAgentReleased, deriveState, flags } from '../src/state.mjs';
import { parseRevParse } from '../src/git.mjs';
import { parseKinds } from '../src/herdr/adapter.mjs';
import { writeSessionSettings, buildStartArgs, buildResumeArgv, writeBoardPlugin, HERDR_ALLOW } from '../src/launch.mjs';
import { Store } from '../src/store.mjs';
import { DeliveryQueue } from '../src/delivery.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mtask-p4-'));

test('F1: 셸 명령 글을 명령 단위로 나눈다(따옴표 안의 줄바꿈과 구분자는 그대로)', () => {
  assert.deepEqual(splitCommands('herdr agent prompt b "a && b; c" --wait && herdr agent read b'), [['herdr', 'agent', 'prompt', 'b', 'a && b; c', '--wait'], ['herdr', 'agent', 'read', 'b']]);
  assert.deepEqual(splitCommands("herdr agent prompt b 'line1\nline2'"), [['herdr', 'agent', 'prompt', 'b', 'line1\nline2']]);
  assert.deepEqual(splitCommands('test "${HERDR_ENV:-}" = 1 || echo no'), [['test', '${HERDR_ENV:-}', '=', '1'], ['echo', 'no']]);
  assert.deepEqual(splitCommands('herdr agent prompt b "say \\"hi\\"" | cat'), [['herdr', 'agent', 'prompt', 'b', 'say "hi"'], ['cat']]);
  assert.deepEqual(splitCommands("herdr agent prompt b 'it''s'"), [['herdr', 'agent', 'prompt', 'b', "it's"]]); // PowerShell ''
});

test('F1: herdr 호출 읽기 — 일 시키기, 답 읽기, 띄우기, 나누기, 다른 세션은 foreign', () => {
  const p = parseHerdrCommands('test "${HERDR_ENV:-}" = 1 && herdr agent prompt reviewer "Reply with exactly: pong" --wait --timeout 120000 && herdr agent read reviewer --source recent-unwrapped --lines 40', { boardSession: 'multitask-dev' });
  assert.equal(p.length, 2);
  assert.deepEqual({ verb: p[0].verb, target: p[0].target, text: p[0].text, wait: p[0].wait, timeout: p[0].timeout, foreign: p[0].foreign }, { verb: 'agent.prompt', target: 'reviewer', text: 'Reply with exactly: pong', wait: true, timeout: 120000, foreign: false });
  assert.deepEqual({ verb: p[1].verb, target: p[1].target, source: p[1].source, lines: p[1].lines }, { verb: 'agent.read', target: 'reviewer', source: 'recent-unwrapped', lines: 40 });
  const st = parseHerdrCommands('herdr agent start helper --kind claude --pane w3:p2 -- --model haiku')[0];
  assert.deepEqual({ verb: st.verb, name: st.name, kind: st.kind, pane: st.pane, args: st.args }, { verb: 'agent.start', name: 'helper', kind: 'claude', pane: 'w3:p2', args: ['--model', 'haiku'] });
  const sp = parseHerdrCommands('herdr pane split --current --direction right --cwd "$PWD" --no-focus')[0];
  assert.deepEqual({ verb: sp.verb, pane: sp.pane, direction: sp.direction }, { verb: 'pane.split', pane: 'current', direction: 'right' });
  // PowerShell 호출 연산자와 전체 경로, 환경 변수 경로
  assert.equal(parseHerdrCommands('& "C:\\Users\\u\\.herdr\\herdr.exe" agent prompt w2:p1 "hi"')[0].target, 'w2:p1');
  assert.equal(parseHerdrCommands('"$HERDR_BIN_PATH" agent read b')[0].verb, 'agent.read');
  // 다른 herdr 세션·기계를 부른 호출은 판이 보지 않는다. 판 전용 세션을 이름으로 부른 것은 우리 것
  assert.equal(parseHerdrCommands('herdr --session default agent prompt x "y"', { boardSession: 'multitask-dev' })[0].foreign, true);
  assert.equal(parseHerdrCommands('herdr --machine box agent list', { boardSession: 'multitask-dev' })[0].foreign, true);
  assert.equal(parseHerdrCommands('herdr --session multitask-dev agent prompt x "y"', { boardSession: 'multitask-dev' })[0].foreign, false);
  // herdr라는 글자가 따옴표 안에만 있으면 호출이 아니다
  assert.equal(parseHerdrCommands('echo "herdr agent prompt x y"').length, 0);
  assert.equal(parseHerdrCommands('herdr worktree create --branch mtask-test/w1 --path ../wt')[0].branch, 'mtask-test/w1');
});

test('F1: herdr CLI 결과(JSON 줄)와 agent read 글', () => {
  const out = parseHerdrOutput({ stdout: '{"id":"cli:agent:prompt","result":{"type":"agent_prompted","agent":{"name":"b","agent_status":"idle"}}}\nsome text\n', stderr: '' });
  assert.equal(out.results[0].type, 'agent_prompted');
  assert.equal(out.text, 'some text');
  assert.equal(readTextOf(parseHerdrOutput('{"result":{"type":"agent_read","read":{"text":"pong\\n"}}}')), 'pong\n');
  assert.equal(readTextOf(parseHerdrOutput('pong')), 'pong');
  assert.equal(tailText('a\n\n b \nc\n\n', 2), ' b\nc');
  // Claude Code 화면: 머리 그림, 사용자 줄(❯), 답(●), 턴 시간(✻), 입력칸 ──── ❯ ────, 아래 줄
  const screen = [' ▐▛███▜▌   Claude Code v2', '', '❯ Reply with exactly: hi', '', '● hi', '', '✻ Crunched for 1s', '', '────────────────────', '❯ ', '────────────────────', '  ⏸ manual mode on'].join('\n');
  assert.equal(screenAnswerText(screen), 'hi');
  assert.equal(screenAnswerText('just\nsome\nlines'), 'just\nsome\nlines'); // 모르는 화면은 끝 줄들
});

test('F3: 새 노드는 부모 오른쪽 빈자리, 차 있으면 다음 자리. 겹치지 않는다', () => {
  const A = { x: 0, y: 0, w: 720, h: 460 };
  assert.deepEqual(freeSlotNear(A, [A]), { x: 760, y: 0 });
  const right = { x: 760, y: 0, w: 720, h: 460 };
  const s2 = freeSlotNear(A, [A, right]);
  assert.deepEqual(s2, { x: 0, y: 500 }); // 부모 아래
  const taken = [A, right, { x: 0, y: 500, w: 720, h: 460 }];
  const s3 = freeSlotNear(A, taken);
  const overlap = taken.some((n) => s3.x < n.x + n.w + 40 && n.x < s3.x + 720 + 40 && s3.y < n.y + n.h + 40 && n.y < s3.y + 460 + 40);
  assert.equal(overlap, false);
  // 선은 마주 보는 쪽에: 오른쪽 이웃은 r→l, 아래 이웃은 b→t, 왼쪽 위는 l→r
  assert.deepEqual(facingSides(A, right), { sourceHandle: 'r', targetHandle: 'l' });
  assert.deepEqual(facingSides(A, { x: 0, y: 500, w: 720, h: 460 }), { sourceHandle: 'b', targetHandle: 't' });
  assert.deepEqual(facingSides(right, { x: -900, y: -100, w: 720, h: 460 }), { sourceHandle: 'l', targetHandle: 'r' });
});

test('F2: 연결 알림 글에는 herdr 이름, 패널, 역할, 쓸 명령이 있고 --session·--machine은 없다', () => {
  const t = roleNotice({ role: '리뷰어', agentName: 'rv', paneId: 'w4:p1', kind: 'claude' });
  for (const x of ['`rv`', 'w4:p1', '"리뷰어"', 'herdr agent prompt rv', 'herdr agent read rv']) assert.ok(t.includes(x), x);
  assert.ok(!/--session|--machine|--remote/.test(t + unlinkNotice({ role: '리뷰어', agentName: 'rv' }) + paneChangedNotice({ role: '리뷰어', agentName: 'rv', paneId: 'w5:p1' })));
  assert.ok(ROLE_RE.test('리뷰어')); assert.ok(!ROLE_RE.test('a"b')); assert.ok(!ROLE_RE.test('')); assert.ok(!ROLE_RE.test('x\ny'));
  assert.equal(linkLabel({ role: '리뷰어', lastText: 'Reply with exactly: pong' }), '리뷰어 · "Reply with exactly: pong"');
  assert.equal(linkLabel({ spawned: true }), '띄움');
});

test('F3·F5: hook이 없는 세션은 herdr 상태만으로 — 막히면 화면을 보는 내 차례, unknown은 추정 준비', () => {
  const rt = newRuntime({ kind: 'codex', hooked: false });
  assert.equal(deriveState(rt).state, 'starting');
  applyAgentDetected(rt); applyHerdrStatus(rt, 'idle');
  assert.equal(deriveState(rt).state, 'ready');
  applyHerdrStatus(rt, 'working');
  assert.equal(deriveState(rt).state, 'working');
  assert.ok(rt.turn.startedAt && !rt.turn.endedAt); // 턴은 herdr로 센다
  applyHerdrStatus(rt, 'blocked');
  rt.screenAsk = { tail: 'Allow command? 1. Yes 2. No', at: 1 };
  const w = deriveState(rt);
  assert.equal(w.state, 'waiting'); assert.equal(w.ask.kind, 'screen'); assert.match(w.ask.tail, /Allow/);
  applyHerdrStatus(rt, 'idle');
  assert.equal(rt.screenAsk, null);
  assert.equal(deriveState(rt).state, 'ready');
  assert.ok(rt.turn.endedAt);
  assert.equal(flags(rt, { seenAt: null }).unseen, true);
  applyHerdrStatus(rt, 'unknown');
  assert.deepEqual(deriveState(rt), { state: 'ready', estimate: 'herdr unknown' });
  // hook이 없어 launch_pending만 남은 종료를 신뢰 거절로 보지 않는다. 판이 끄라고 했으면 정상 종료
  const r2 = newRuntime({ kind: 'codex', hooked: false }); applyAgentDetected(r2); applyAgentReleased(r2);
  assert.equal(r2.exit.kind, 'other');
  const r3 = newRuntime({ kind: 'codex', hooked: false }); applyAgentDetected(r3); r3.exitRequested = true; applyAgentReleased(r3);
  assert.equal(r3.exit.kind, 'normal');
  // 판에 올린 Claude Code의 신뢰 대화상자는 화면으로만
  const r4 = newRuntime({ kind: 'claude', hooked: false }); applyAgentDetected(r4); applyHerdrStatus(r4, 'blocked'); r4.trustScreen = { at: 1 };
  assert.equal(deriveState(r4).state, 'trust_wait');
  // P1~P3 runtime(종류 없음)은 hook이 붙은 Claude Code로 본다
  const old = newRuntime(); delete old.hooked; applyHerdrStatus(old, 'blocked');
  assert.equal(deriveState(old).state, 'trust_wait');
});

test('F4: rev-parse로 워크트리와 본 저장소를 가른다', () => {
  const main = parseRevParse('C:/r\nC:/r/.git\nC:/r/.git\n');
  assert.deepEqual({ isWorktree: main.isWorktree, mainRoot: main.mainRoot }, { isWorktree: false, mainRoot: 'C:/r' });
  const wt = parseRevParse('C:/r/wt/a\nC:/r/.git/worktrees/a\nC:/r/.git\n');
  assert.deepEqual({ isWorktree: wt.isWorktree, root: wt.root, commonDir: wt.commonDir, mainRoot: wt.mainRoot }, { isWorktree: true, root: 'C:/r/wt/a', commonDir: 'C:/r/.git', mainRoot: 'C:/r' });
  assert.equal(parseRevParse(''), null);
});

test('F4: 같은 저장소 관계선 — 워크트리마다 하나, 이어진 세션을 먼저', () => {
  const g = (isWorktree, root) => ({ isRepo: true, commonDir: 'C:/r/.git', isWorktree, root, branch: isWorktree ? 'mtask-test/w' : 'main' });
  const S = [
    { sessionId: 'm1', createdAt: 1, git: g(false, 'C:/r') },
    { sessionId: 'm2', createdAt: 2, git: g(false, 'C:/r') },
    { sessionId: 'w1', createdAt: 3, git: g(true, 'C:/r/wt/1') },
    { sessionId: 'o', createdAt: 4, git: { isRepo: true, commonDir: 'C:/other/.git', isWorktree: false } },
  ];
  assert.deepEqual(repoEdges(S).map((e) => `${e.from}>${e.to}`), ['m2>w1']); // 가장 늦게 만든 본 저장소 세션
  assert.deepEqual(repoEdges(S, (a, b) => a === 'm1' && b === 'w1').map((e) => `${e.from}>${e.to}`), ['m1>w1']);
  assert.deepEqual(repoEdges(S.filter((s) => s.sessionId !== 'w1')), []); // 워크트리가 없으면 선도 없다
  const two = [{ sessionId: 'a', createdAt: 1, git: g(true, 'C:/r/wt/a') }, { sessionId: 'b', createdAt: 2, git: g(true, 'C:/r/wt/b') }];
  assert.deepEqual(repoEdges(two).map((e) => `${e.from}>${e.to}`), ['a>b']); // 본 저장소 세션이 없으면 워크트리끼리
});

test('F5: herdr 도움말의 kinds 줄', () => {
  assert.deepEqual(parseKinds('herdr agent commands:\n  herdr agent list\n  kinds: pi|claude|codex|hermes\n'), ['pi', 'claude', 'codex', 'hermes']);
  assert.deepEqual(parseKinds('nothing'), []);
});

test('2: herdr 스킬은 --plugin-dir로, 안내는 --append-system-prompt-file로. 이어 가기도 같다. herdr만 자동 승인은 고를 때만', () => {
  const dir = tmp();
  const pl = writeBoardPlugin({ dir, skillText: '---\nname: herdr\n---\nbody' });
  assert.ok(fs.existsSync(path.join(dir, 'atrium-herdr', '.claude-plugin', 'plugin.json')));
  assert.equal(fs.readFileSync(path.join(dir, 'atrium-herdr', 'skills', 'herdr', 'SKILL.md'), 'utf8'), '---\nname: herdr\n---\nbody');
  assert.match(fs.readFileSync(pl.systemPromptFile, 'utf8'), /--session/); // 붙이지 말라는 안내
  const launch = { sessionId: 's', settingsPath: 'C:/x/s.json', permissionMode: 'manual', model: 'haiku', ...pl };
  const a = buildStartArgs(launch);
  assert.equal(a[a.indexOf('--plugin-dir') + 1], pl.pluginDir);
  assert.equal(a[a.indexOf('--append-system-prompt-file') + 1], pl.systemPromptFile);
  assert.deepEqual(buildResumeArgv(launch).slice(3), a.slice(2));
  const f1 = path.join(dir, 'a.json'), f2 = path.join(dir, 'b.json');
  writeSessionSettings({ file: f1, hookUrl: 'http://127.0.0.1:1/hooks/claude', token: 't', sessionId: 's' });
  writeSessionSettings({ file: f2, hookUrl: 'http://127.0.0.1:1/hooks/claude', token: 't', sessionId: 's', allowHerdr: true });
  assert.equal(JSON.parse(fs.readFileSync(f1, 'utf8')).permissions, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(f2, 'utf8')).permissions.allow, HERDR_ALLOW);
  assert.ok(HERDR_ALLOW.every((r) => /^(Bash|PowerShell)\((herdr|test|printf|echo)[ :]/.test(r)));
});

test('저장소: 연결과 오간 기록, P3 board.db에 종류·출처 열 더하기', () => {
  const f = path.join(tmp(), 'b.db');
  const s0 = new Store(f);
  s0.db.exec('ALTER TABLE sessions DROP COLUMN kind'); // P3 표를 흉내 낸다
  s0.close();
  const st = new Store(f);
  st.insertSession({ sessionId: 'a', name: 'a', cwd: 'C:/p', permissionMode: 'manual', settingsPath: 'x', hookToken: 't', createdAt: 1 });
  st.insertSession({ sessionId: 'b', name: 'b', cwd: 'C:/p', permissionMode: 'manual', createdAt: 2, kind: 'codex', origin: 'adopted', parentSessionId: 'a' });
  assert.deepEqual(st.openSessions().map((s) => [s.kind, s.origin, s.parentSessionId, s.settingsPath]), [['claude', 'board', null, 'x'], ['codex', 'adopted', 'a', '']]);
  st.insertLink({ linkId: 'l1', from: 'a', to: 'b', observed: true, createdAt: 3 });
  st.updateLink('l1', { role: '리뷰어', lastText: 'do it', lastKind: 'prompt', lastAt: 4, count: 1 });
  st.addLinkEvent('l1', 'prompt', 'do it', { wait: true });
  st.addLinkEvent('l1', 'reply', 'done');
  const l = st.linkByPair('a', 'b');
  assert.deepEqual([l.role, l.observed, l.spawned, l.lastText], ['리뷰어', true, false, 'do it']);
  assert.deepEqual(st.linkEvents('l1').map((e) => [e.kind, e.text]), [['prompt', 'do it'], ['reply', 'done']]);
  st.updateLink('l1', { removedAt: 9 });
  assert.equal(st.links().length, 0); assert.equal(st.links({ all: true }).length, 1);
  st.close();
});

test('F5: hook이 없는 세션은 보낸 뒤 herdr working으로 제출을 확인한다(응답보다 먼저 와도)', async () => {
  const store = new Store(path.join(tmp(), 'q.db'));
  const cfg = { inputQuietMs: 0, submitConfirmMs: 30000, deliveryMaxWaitMs: 60000 };
  let release, started;
  const sending = new Promise((r) => { started = r; });
  const q = new DeliveryQueue({ store, cfg, view: () => ({ state: 'ready', agentPresent: true, herdrConnected: true, closed: false }), send: () => new Promise((r) => { release = r; started(); }) });
  const d = q.enqueue('c', 'hi');
  await sending;
  assert.equal(d.status, 'sending');
  q.onAgentWorking('c'); // working이 agent.prompt 응답보다 먼저
  const confirmed = new Promise((r) => q.on('delivery', (event) => { if (event.status === 'confirmed') r(); }));
  release();
  await confirmed;
  assert.equal(store.getDelivery(d.deliveryId).status, 'confirmed');
  assert.equal(store.getDelivery(d.deliveryId).reason, 'herdr working');
  store.close();
});
