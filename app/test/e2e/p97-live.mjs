// P97 창 시험 live 단계(p97-launchers.mjs가 부른다): 붙여 넣기로 만든 `ocx claude` 런처를 레일 이름 칸으로 띄워
// 판 세션(hook 상태, 승인 카드, 이어 가기 등록)인지, opencodex 프록시를 거치는지(ocx observe logs --conversation <세션 ID>),
// 그 세션의 `atrium child` 하위 세션도 같은 실행 명령인지 본다. 판 다시 켜기는 restart 단계(p97-restart.mjs).
// 시험 세션은 haiku로 짧은 한 줄 일만 시킨다. opencodex 설정과 프록시는 바꾸지 않는다(읽기 명령 ocx observe만 부른다).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { REPO } from './harness.mjs';

const DEV = path.join(REPO, 'backend', '.dev');
const clean = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ATRIUM_|MTASK_|HERDR_|CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
// ocx(node → bun → claude.exe)로 뜬 프로세스 중 그 세션 ID가 명령줄에 든 것
export function ocxProcs(sid) {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match 'opencodex' -and $_.CommandLine -match '${sid}' } | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.Name, ($_.CommandLine -replace '^.*opencodex[\\\\/]bin[\\\\/]ocx\\.mjs', 'ocx.mjs').Substring(0, [Math]::Min(160, ($_.CommandLine -replace '^.*opencodex[\\\\/]bin[\\\\/]ocx\\.mjs', 'ocx.mjs').Length)) }`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000 });
  return (r.stdout || '').split(/\r?\n/).filter(Boolean);
}
// opencodex 요청 기록(읽기 명령). 대화 ID는 Claude Code metadata.user_id의 해시라 세션 ID로는 못 찾는다.
// 그래서 그 세션의 턴(hook UserPromptSubmit → Stop) 시각 안에 든 haiku 요청을 모아, 턴마다 요청이 있고 모두 한 대화 ID인지 본다. 내용은 읽지 않는다
export function ocxRows(model = 'claude-haiku-5-5') {
  const r = spawnSync('ocx', ['observe', 'logs', '--model', model, '--limit', '200', '--json'], { encoding: 'utf8', env: clean(), timeout: 60000, shell: true });
  try { return JSON.parse(r.stdout).logs.map((x) => ({ t: x.timestamp, conv: x.conversationId, model: x.model, provider: x.provider, status: x.status, surface: x.surface })); } catch { return null; }
}
export function turnsOf(events) {
  const out = []; let start = null;
  for (const e of events) {
    if (e.kind !== 'hook') continue;
    if (e.data.ev === 'UserPromptSubmit') start = e.t;
    else if (e.data.ev === 'Stop' && start) { out.push([start, e.t]); start = null; }
  }
  return out;
}
export function proxyMatch(rows, turns) {
  const per = turns.map(([a, b]) => rows.filter((r) => r.t >= a - 1500 && r.t <= b + 1500 && r.status === 200));
  const convs = [...new Set(per.flat().map((r) => r.conv))];
  return { turns: turns.length, perTurn: per.map((x) => x.length), convs: convs.map((c) => String(c).slice(0, 12)), provider: [...new Set(per.flat().map((r) => r.provider))], ok: turns.length > 0 && per.every((x) => x.length > 0) && convs.length === 1 };
}
export const summaryOf = async (call, page, name) => (await call(page, 'session.list')).find((s) => s.name === name) || null;
export async function waitState(call, page, name, states, ms, until) {
  return until(async () => { const s = await summaryOf(call, page, name); return s && states.includes(s.state) ? s : null; }, ms, 1000).catch(() => null);
}
export const needTrust = (name) => { fs.writeFileSync(path.join(DEV, 'p97-need-trust.txt'), `${name} asks the folder trust question on the dev board atrium-dev-p97\n`); throw new Error('trust question (backend/.dev/p97-need-trust.txt)'); };

export async function run({ page, call, atrium, step, shot, log, sleep, until, ENV, WS }) {
  try { fs.rmSync(path.join(WS, 'p97-ask-dir'), { recursive: true, force: true }); } catch {} // 승인 시험의 mkdir이 지난 실행 폴더에 걸리지 않게
  if (spawnSync('where.exe', ['ocx']).status !== 0) { step('ocx가 없어 live 단계는 건너뛴다', true); return; }
  const d = await call(page, 'launcher.list');
  const L = d.launchers.find((l) => l.startCommand === 'ocx claude' && l.favorite);
  step('after 단계가 만든 ocx claude 런처가 레일에 있다', !!L, L && L.preview.line);
  if (!L) return;
  for (const n of ['p97-kid', 'p97-ocx']) { try { atrium('kill', n, '--yes'); log('먼저 끔', n); } catch {} } // 지난 실행이 남긴 세션
  await sleep(1000);
  // 1. 레일 이름 칸으로 띄운다
  await page.click(`[data-role="rail-favorites"] [data-launcher="${L.id}"]`);
  await page.waitForSelector('[data-role="quick-name"]');
  await page.keyboard.type('p97-ocx');
  await page.keyboard.press('Enter');
  const s0 = await waitState(call, page, 'p97-ocx', ['ready', 'trust_wait', 'waiting', 'error', 'exited'], 150000, until);
  if (s0 && s0.state === 'trust_wait') needTrust('p97-ocx');
  step('레일 이름 칸으로 띄운 ocx claude 세션이 준비됨(hook 상태)', s0 && s0.state === 'ready' && s0.kind === 'claude', s0 && { state: s0.state, kind: s0.kind, hooked: s0.hooked, model: s0.model });
  const sid = s0 && s0.sessionId;
  if (!sid) return;
  await shot(page, 'live-1-ready');
  const ev = await call(page, 'session.events', { session: sid, limit: 100 });
  const spawnEv = ev.find((e) => e.kind === 'spawn');
  step('spawn 기록: 실행 명령 ocx claude, 판의 인자(--settings·--session-id)', spawnEv && spawnEv.data.startCommand === 'ocx claude' && spawnEv.data.args.includes('--settings') && spawnEv.data.args.includes(sid), spawnEv && { startCommand: spawnEv.data.startCommand, launcher: spawnEv.data.launcher });
  const reg = await until(async () => (await call(page, 'session.events', { session: sid, limit: 100 })).find((e) => e.kind === 'resume_registered'), 60000, 1000).catch(() => null);
  step('이어 가기 등록: resume_argv의 첫 낱말은 ocx claude', reg && reg.data.argv[0] === 'ocx' && reg.data.argv[1] === 'claude' && reg.data.argv.includes('--resume'), reg && reg.data.argv.slice(0, 5));
  const procs = ocxProcs(sid);
  log('ocx 프로세스', procs);
  step('패널의 claude는 ocx(node → bun → claude.exe)로 떴다', procs.some((p) => /ocx\.mjs claude --session-id/.test(p)), procs.length);
  // 2. 짧은 한 줄 일
  atrium('send', '@p97-ocx', 'Reply with the single word: ok');
  await waitState(call, page, 'p97-ocx', ['working'], 30000, until);
  const s1 = await waitState(call, page, 'p97-ocx', ['ready'], 120000, until);
  step('지시 → working → ready(hook으로 상태가 바뀐다), 답이 온다', s1 && /ok/i.test(String(s1.lastAnswer || '')), s1 && { state: s1.state, lastAnswer: String(s1.lastAnswer || '').slice(0, 40) });
  // 3. 승인 카드: manual 모드에서 묻는 Bash 한 번(echo는 Claude Code가 묻지 않는다. mkdir은 묻는다, P90)
  atrium('send', '@p97-ocx', 'Use the Bash tool to run exactly this command: mkdir p97-ask-dir . Then reply with the single word: done');
  await waitState(call, page, 'p97-ocx', ['working', 'waiting'], 30000, until);
  const s2 = await waitState(call, page, 'p97-ocx', ['waiting', 'ready'], 120000, until);
  step('승인이 필요한 도구는 판의 승인 카드(PermissionRequest hook)', s2 && s2.state === 'waiting' && s2.ask, s2 && { state: s2.state, ask: s2.ask && { kind: s2.ask.kind, tool: s2.ask.tool } });
  await sleep(800);
  await shot(page, 'live-2-approval');
  if (s2 && s2.ask) {
    const r = await call(page, 'session.answer', { session: sid, toolUseId: s2.ask.toolUseId, since: s2.ask.since, choice: 1 });
    log('승인', r);
    const s3 = await waitState(call, page, 'p97-ocx', ['ready'], 120000, until);
    step('판에서 승인하면 이어서 끝난다', s3 && /done/i.test(String(s3.lastAnswer || '')), s3 && String(s3.lastAnswer || '').slice(0, 60));
  }
  // 4. atrium child: 부모 세션의 설정 파일 env로 판 플러그인의 atrium을 부른다(에이전트가 Bash로 치는 것과 같은 길)
  const settingsFile = path.join(ENV.ATRIUM_DATA_DIR, 'sessions', `${sid}.json`);
  const penv = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).env || {};
  // atrium models: 새 런처가 줄로 보이고 --launcher 명령이 붙는다(P41 풀기)
  const models = spawnSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'models'], { encoding: 'utf8', env: { ...clean(), ...penv }, timeout: 60000 });
  const mline = (models.stdout || '').split('\n').map((l, i, a) => (/ocx claude haiku/.test(l) ? `${l.trim()} ${(a[i + 1] || '').trim()}` : null)).filter(Boolean);
  fs.writeFileSync(path.join(REPO, 'experiments', 'p97', 'p97-atrium-models.txt'), models.stdout || models.stderr || '');
  step('atrium models: ocx claude 런처가 실행 명령과 --launcher 명령으로 보인다', mline.some((l) => /실행 명령 ocx claude/.test(l) && /--launcher/.test(l)), mline);
  const child = spawnSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'child', 'p97-kid', '--model', 'haiku', '--prompt', 'Reply with the single word: ok'], { encoding: 'utf8', env: { ...clean(), ...penv }, timeout: 150000 });
  log('atrium child', (child.stdout || '').split('\n').slice(0, 6).join(' | '), (child.stderr || '').slice(0, 200));
  await sleep(3000);
  const kid = await waitState(call, page, 'p97-kid', ['ready', 'trust_wait', 'error', 'exited'], 120000, until);
  if (kid && kid.state === 'trust_wait') needTrust('p97-kid');
  const kev = kid ? (await call(page, 'session.events', { session: kid.sessionId, limit: 50 })).find((e) => e.kind === 'spawn') : null;
  const kprocs = kid ? ocxProcs(kid.sessionId) : [];
  step('하위 세션(atrium child)도 같은 실행 명령(ocx claude)으로 뜬다', kid && kid.state === 'ready' && kev && kev.data.startCommand === 'ocx claude' && kprocs.some((p) => /ocx\.mjs claude --session-id/.test(p)), { state: kid && kid.state, startCommand: kev && kev.data.startCommand, procs: kprocs.length, parent: kid && kid.parentSessionId === sid });
  const kreg = kid ? await until(async () => (await call(page, 'session.events', { session: kid.sessionId, limit: 50 })).find((e) => e.kind === 'resume_registered'), 60000, 1000).catch(() => null) : null;
  step('하위 세션의 이어 가기 명령도 ocx claude', kreg && kreg.data.argv[0] === 'ocx', kreg && kreg.data.argv.slice(0, 3));
  await sleep(800);
  await shot(page, 'live-3-child');
  // 5. 프록시: 부모와 하위 세션의 턴마다 opencodex에 haiku 요청이 있고, 세션마다 한 대화 ID
  await sleep(4000);
  const rows = ocxRows();
  const pm = rows && proxyMatch(rows, turnsOf(await call(page, 'session.events', { session: sid, limit: 300 })));
  step('opencodex 프록시가 부모 세션의 턴마다 요청을 받았다(한 대화)', pm && pm.ok, pm || 'ocx observe logs 실패');
  const km = rows && kid && proxyMatch(rows, turnsOf(await call(page, 'session.events', { session: kid.sessionId, limit: 300 })));
  step('하위 세션의 요청도 opencodex를 지났다(다른 대화)', km && km.ok && pm && km.convs[0] !== pm.convs[0], km || null);
  try { log(execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', 'kill', 'p97-kid', '--yes'], { encoding: 'utf8', env: { ...clean(), ...ENV }, timeout: 60000 }).trim().slice(0, 120)); } catch (e) { log('kid kill', e.message.slice(0, 100)); }
  // p97-ocx는 restart 단계가 쓴다
  fs.writeFileSync(path.join(DEV, 'p97-live.json'), JSON.stringify({ sid, name: 'p97-ocx' }));
}

// restart 단계: p97-launchers.mjs가 창을 띄우기 전에 백엔드와 herdr 서버를 모두 껐다(판 끄기). 다시 켠 판에서
// herdr가 등록된 이어 가기 명령(ocx claude --resume …)으로 패널을 되살리고, 판이 그 세션을 hook으로 다시 잡는지, 지시에 답하는지 본다
export async function restart({ page, call, atrium, step, shot, log, sleep, until }) {
  const { sid } = JSON.parse(fs.readFileSync(path.join(DEV, 'p97-live.json'), 'utf8'));
  const s = await waitState(call, page, 'p97-ocx', ['ready', 'error', 'exited', 'trust_wait'], 180000, until);
  step('판을 다시 켜면 ocx claude 세션이 같은 세션 ID로 돌아온다', s && s.sessionId === sid && s.state === 'ready', s && { state: s.state, sid: s.sessionId === sid });
  const procs = ocxProcs(sid);
  log('ocx 프로세스', procs);
  step('되살린 claude도 ocx로 이어 갔다(ocx.mjs claude --resume <세션 ID> --settings …)', procs.some((p) => new RegExp(`ocx\\.mjs claude --resume ${sid} .*--settings`).test(p)), procs.length);
  const ev = await call(page, 'session.events', { session: sid, limit: 300 });
  log('되살리기 기록', ev.filter((e) => /recover|resume|relaunch|pane_changed|agent_rename/.test(e.kind)).slice(-6).map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 120)}`));
  const renamed = await until(async () => (await call(page, 'session.events', { session: sid, limit: 300 })).find((e) => e.kind === 'agent_renamed'), 30000, 1000).catch(() => null);
  step('herdr가 버린 에이전트 이름을 판이 다시 붙인다(herdr 명령·전달이 그 이름을 쓴다)', !!renamed, renamed && renamed.data);
  await shot(page, 'restart-1');
  atrium('send', '@p97-ocx', 'Reply with the single word: again');
  await waitState(call, page, 'p97-ocx', ['working'], 30000, until);
  const s2 = await waitState(call, page, 'p97-ocx', ['ready'], 120000, until);
  step('다시 켠 뒤에도 hook으로 상태가 바뀌고 답한다', s2 && /again/i.test(String(s2.lastAnswer || '')), s2 && String(s2.lastAnswer || '').slice(0, 40));
  await sleep(4000);
  const rows = ocxRows();
  const turns = turnsOf(await call(page, 'session.events', { session: sid, limit: 400 }));
  const pm = rows && proxyMatch(rows, turns.slice(-1));
  step('다시 켠 뒤의 턴도 opencodex를 지났다', pm && pm.ok, pm);
  try { log(atrium('kill', 'p97-ocx', '--yes').trim().slice(0, 100)); } catch (e) { log('kill', e.message.slice(0, 100)); }
}
