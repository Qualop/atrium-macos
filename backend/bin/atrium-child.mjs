#!/usr/bin/env node
// 하위 세션 명령(P8, ARCH 4절 K): 판이 띄운 세션 안에서 부른다. 판 플러그인의 bin/atrium(옛 이름 bin/mtask)이 이 파일을 부른다.
// 판의 API 토큰(backend.json)을 읽지 않는다. 세션 설정 파일의 env(ATRIUM_PORT, ATRIUM_SESSION_ID, ATRIUM_SESSION_TOKEN 등. P18 전에 띄운 세션은 MTASK_*)로 그 판의 POST /branch/*만 부른다.
// 사용: atrium child [이름] [--prompt 글] [--role 역할] [--cwd 폴더] [--worktree 이름] [--model 모델] [--kind 종류] [--no-wait] [--json]
//       atrium children [--all] [--json]
//       atrium child-kill <이름> [--only] [--json]
//       atrium wake <이름> [--json]   (P21: 잠든 세션 깨우기, P24: 그 리포째)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { envVar } from '../src/config.mjs';

const HELP = `atrium(판이 띄운 세션의 하위 세션 명령. 옛 이름 mtask도 같다)
  atrium child [이름] [--prompt "첫 지시"] [--role 역할] [--cwd 폴더] [--worktree 이름] [--model 모델] [--kind 종류] [--no-wait]
      하위 세션(워커)을 만든다. 너의 폴더·모델·노력 수준·권한 모드·그룹을 물려받고, 너와 역할 선(기본 "워커")으로 이어진다.
      준비될 때까지 기다린 뒤 herdr 이름과 패널, 일 시키기·답 읽기 명령을 돌려준다.
  atrium children [--all]       너의 하위 세션(--all이면 그 아래까지) 상태와 마지막 답
  atrium child-kill <이름> [--only]   너의 하위 세션을 끈다(그 아래 하위 세션도 함께. --only면 그것만). 사람이 끄라고 할 때만 쓴다
  atrium wake <이름>   잠든(sleeping) 세션과 그 리포에서 잠든 세션을 모두 깨운다. 같은 대화로 이어 가고 그 세션이 준비되면 돌려준다. 잠든 세션은 herdr에 없으므로 herdr 명령이 그 이름을 못 찾으면 이것을 먼저 한다
이 명령은 판이 띄운 세션에서만 된다. 다른 판 명령은 없다.`;

const BOOL = new Set(['no-wait', 'json', 'all', 'only', 'help']);
const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); if (BOOL.has(k)) flags[k] = true; else { flags[k] = argv[i + 1]; i++; } }
  else pos.push(a);
}
const [cmd, ...rest] = pos;
// Gemini may redact token-shaped environment variables from shell tools. Read only
// this managed session's private branch credentials, never the board API token.
let branchEnv = {};
if (process.env.ATRIUM_BRANCH_FILE) {
  try { branchEnv = JSON.parse(fs.readFileSync(process.env.ATRIUM_BRANCH_FILE, 'utf8')); } catch {}
}
const E = (name) => envVar(name) || (['PORT', 'SESSION_ID', 'SESSION_TOKEN', 'HERDR_SESSION'].includes(name) ? branchEnv[`ATRIUM_${name}`] : undefined);
const say = (s) => process.stdout.write(s + '\n');
const fail = (msg, code = 1) => { process.stderr.write(`atrium: ${msg}\n`); process.exit(code); };

function call(op, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: Number(E('PORT')), path: `/branch/${op}`, method: 'POST', timeout: timeoutMs,
      headers: { 'content-type': 'application/json', 'content-length': data.length, authorization: `Bearer ${E('SESSION_TOKEN')}`, 'x-mt-session': E('SESSION_ID'), 'x-mt-pane': process.env.HERDR_PANE_ID || '' } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error(`판의 응답을 읽지 못했다(HTTP ${res.statusCode})`)); } });
    });
    req.on('timeout', () => { req.destroy(new Error('판이 제때 답하지 않았다')); });
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? `판 백엔드가 돌지 않는다(포트 ${E('PORT')})` : e.message)));
    req.end(data);
  });
}

function counts(c) { return c ? `너의 하위 세션 ${c.children}/${c.maxChildren}, 판 전체 ${c.total}/${c.maxTotal}, 깊이 상한 ${c.maxDepth}단계` : ''; }

async function main() {
  if (!cmd || cmd === 'help' || flags.help) return say(HELP);
  if (!['child', 'children', 'child-kill', 'wake'].includes(cmd)) fail(`모르는 명령: ${cmd}. 이 atrium은 child, children, child-kill, wake만 한다(다른 판 명령은 사람의 atrium으로)`, 2);
  if (!E('PORT') || !E('SESSION_ID') || !E('SESSION_TOKEN')) fail('판이 띄운 세션이 아니다(세션 설정 파일의 env가 없다). 판에서 띄운 세션 안에서 부른다');
  let r;
  if (cmd === 'child') {
    const body = { name: rest[0] || null, prompt: flags.prompt ?? null, role: flags.role ?? null, cwd: flags.cwd ? path.resolve(flags.cwd) : null, worktree: flags.worktree || null, model: flags.model || null, kind: flags.kind || null, wait: !flags['no-wait'] };
    r = await call('child', body, 110000);
  } else if (cmd === 'children') r = await call('children', { all: !!flags.all }, 20000);
  else if (cmd === 'wake') {
    if (!rest[0]) fail('깨울 세션 이름을 준다: atrium wake <이름>', 2);
    r = await call('wake', { name: rest[0] }, 110000);
  } else {
    if (!rest[0]) fail('끌 하위 세션 이름을 준다: atrium child-kill <이름>', 2);
    r = await call('kill', { name: rest[0], only: !!flags.only }, 110000);
  }
  // 판을 잘못 찾아가지 않았는지(설정 파일의 env와 응답한 판이 같은 herdr 세션인가)
  if (r.board && E('HERDR_SESSION') && r.board.herdrSession !== E('HERDR_SESSION')) fail(`다른 판이 답했다(${r.board.herdrSession}, 기대 ${E('HERDR_SESSION')})`);
  if (flags.json) { say(JSON.stringify(r.result ?? { error: r.error }, null, 2)); if (r.error) process.exit(1); return; }
  if (r.error) {
    const e = r.error;
    fail(`${cmd === 'child' ? '하위 세션을 만들지 않았다' : cmd === 'child-kill' ? '끄지 않았다' : cmd === 'wake' ? '깨우지 못했다' : '실패'}(${e.code}): ${e.message}`);
  }
  const x = r.result;
  if (cmd === 'wake' || (cmd === 'child' && x.woke !== undefined)) {
    say(x.woke ? `@${x.name}을 깨웠다(${((x.ms || 0) / 1000).toFixed(1)}초, 같은 대화로 이어 감): herdr 이름 ${x.agentName}, 패널 ${x.paneId}, 상태 ${x.state}` : `@${x.name}은 이미 깨어 있다: herdr 이름 ${x.agentName}, 패널 ${x.paneId}, 상태 ${x.state}`);
    if (x.firstPrompt) say(`지시를 보냈다(${x.firstPrompt.status}). 끝나기 기다리기: ${x.next.wait}`); else say(`일 시키기: ${x.next.prompt}`);
    say(`답 읽기: ${x.next.read}`);
    return;
  }
  if (cmd === 'child') {
    say(`하위 세션을 만들었다: @${x.name} (herdr 이름 ${x.agentName}, 패널 ${x.paneId}, 종류 ${x.kind}, 역할 "${x.role}", ${x.depth}단계)`);
    say(`  폴더 ${x.cwd}${x.worktree ? ` · 워크트리 ${x.worktree}(claude -w)` : ''}${x.model ? ` · 모델 ${x.model}` : ''} · 권한 모드 ${x.permissionMode}`);
    const w = x.waited;
    if (!w) say('  상태: 기다리지 않음(--no-wait). 준비되기 전에는 herdr agent wait로 기다린다');
    else if (w.state === 'trust_wait') say('  상태: 신뢰 대화상자에서 멈췄다. 판은 대신 신뢰하지 않는다. 사용자에게 판에서 그 노드의 터미널로 답해 달라고 알린다');
    else if (w.state === 'waiting') say('  상태: 승인을 기다린다. 사용자에게 판의 승인 카드에 답해 달라고 알린다');
    else if (['error', 'exited', 'closed'].includes(w.state)) say(`  상태: ${w.state}. 하위 세션이 제대로 뜨지 않았다`);
    else if (w.timeout) say(`  상태: ${w.state}(아직 준비 중). herdr agent wait ${x.agentName} --timeout 600000 으로 기다린다`);
    else say(`  상태: ${w.state}${x.firstPrompt ? `, 첫 지시 ${w.delivery || x.firstPrompt.status}` : ''} (${(w.ms / 1000).toFixed(1)}초)`);
    if (x.firstPrompt) say(`끝나기 기다리기: ${x.next.wait}`); else say(`일 시키기: ${x.next.prompt}`);
    say(`답 읽기: ${x.next.read}`);
    say(counts(x.counts));
    return;
  }
  if (cmd === 'children') {
    say(`@${x.parent}(${x.depth}단계)의 하위 세션 ${x.children.length}개. ${counts(x.counts)}`);
    for (const c of x.children) {
      say(`${'  '.repeat(Math.max(1, c.depth - x.depth))}@${c.name} (herdr ${c.agentName}, 패널 ${c.paneId || '없음'}, "${c.role || '-'}", ${c.depth}단계) ${c.state}${c.state === 'sleeping' ? ` — 잠듦. 시키기 전에 atrium wake ${c.name}` : ''}${c.ask ? ` — 묻는 중: ${c.ask}` : ''}${c.children ? ` · 하위 ${c.children}` : ''}`);
      if (c.lastAnswer) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}마지막 답: ${c.lastAnswer.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    return;
  }
  say(`껐다: ${x.killed.map((k) => `@${k.name}${k.closed ? '' : `(실패 ${k.error || ''})`}`).join(', ')}`);
}
main().catch((e) => fail(e.message));
