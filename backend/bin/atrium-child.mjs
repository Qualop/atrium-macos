#!/usr/bin/env node
// 하위 세션 명령(P8, ARCH 4절 K): 판이 띄운 세션 안에서 부른다. 판 플러그인의 bin/atrium(옛 이름 bin/mtask)이 이 파일을 부른다.
// 판의 API 토큰(backend.json)을 읽지 않는다. 세션 설정 파일의 env(ATRIUM_PORT, ATRIUM_SESSION_ID, ATRIUM_SESSION_TOKEN 등. P18 전에 띄운 세션은 MTASK_*)로 그 판의 POST /branch/*만 부른다.
// 사용: atrium child [이름] [--prompt 글] [--role 역할] [--cwd 폴더] [--worktree 이름] [--model 모델] [--launcher 호출자] [--effort 노력] [--kind 종류] [--head] [--no-wait] [--json]
//       atrium me [--json]   (P81: 너의 지금 연결 — 부모, 하위 세션, 역할 연결, 마지막 지시)
//       atrium models [--json]   (P41: 띄울 수 있는 호출자와 모델, 그 명령)
//       atrium child-wait <이름> [--json]   (P36: 신뢰 관문을 지나 지시를 받을 수 있게 될 때까지)
//       atrium children [--all] [--json]
//       atrium child-kill <이름> [--only] [--json]
//       atrium wake <이름> [--json]   (P21: 잠든 세션 깨우기, P24: 그 리포째, P111: 혼자 잠든 세션은 그 세션만)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { envVar } from '../src/config.mjs';

const HELP = `atrium(보드가 띄운 세션의 하위 세션 명령. 옛 이름 mtask도 같다)
  atrium child [이름] [--prompt "첫 요청"] [--role 역할] [--cwd 폴더] [--worktree 이름] [--model 모델] [--launcher 런처] [--effort 노력] [--kind 종류] [--no-wait]
      하위 세션(워커)을 만든다. 너의 폴더·모델·추론 수준·승인 방식·그룹을 물려받고(준 값이 덮는다), 너와 역할 선(기본 "워커")으로 이어진다.
      --model은 말로 한 이름도 받는다("deepseek flash", opus). 보드가 아는 목록에서 풀고, 여럿이 맞거나 없으면 띄우지 않고 후보를 돌려준다.
      --launcher는 그 런처(도구 모음의 단추)의 하네스·모델·옵션·환경 변수 그대로 띄운다.
      --kind codex(다른 종류)는 보드 레일의 그 종류 런처 설정(추가 인자·모델, --model이 모델만 덮는다)으로 띄우고, 너의 승인 방식을 그 종류의 승인 인자로 옮긴다.
      준비될 때까지 기다린 뒤 herdr 이름과 패널, 일 시키기·응답 읽기 명령을 돌려준다. 설정의 워커 수·깊이·전체 상한을 지킨다.
      --worktree는 claude -w로 워크트리를 만든다. 신뢰를 받지 않은 저장소면 신뢰 질문에서 멈추고(needs_trust) 사람에게 할 한 문장을 돌려준다.
      --head는 너의 워커가 아니라 따로 일을 이끄는 세션(헤드)으로 띄운다. 첫 요청 뒤 보드가 부모 관계를 뗀다. 그 뒤로 일을 시키거나 기다리지 않는다(--worktree와 함께 쓰지 않는다).
  atrium me                     너의 지금 연결(부모, 하위 세션, 역할 연결, 연결마다 마지막 지시). 보드의 지금 기록이라 예전 알림과 다르면 이것을 믿는다
  atrium child-wait <이름>      그 하위 세션이 지시를 받을 수 있게 될 때까지 기다린다(신뢰 질문에 사람이 답한 뒤 워크트리에서 다시 뜰 때까지. 한 번에 100초)
  atrium children [--all]       너의 하위 세션(--all이면 그 아래까지) 상태와 마지막 응답
  atrium models                 띄울 수 있는 런처와 모델(하네스 모델, 별칭, 게이트웨이 모델)과 각각을 띄우는 atrium child 명령
  atrium child-kill <이름> [--only]   너의 하위 세션을 끈다(그 아래 하위 세션도 함께. --only면 그것만). 사람이 끄라고 할 때만 쓴다
  atrium wake <이름>   잠든(sleeping) 세션을 깨운다. 혼자 잠든 세션은 그 세션만, 리포째 잠들었으면 그 리포에서 리포째 잠든 세션을 모두 깨운다. 같은 대화로 이어 가고 그 세션이 준비되면 돌려준다. 잠든 세션은 herdr에 없으므로 herdr 명령이 그 이름을 못 찾으면 이것을 먼저 한다
이 명령은 보드가 띄운 세션에서만 된다. 다른 보드 명령은 없다.`;

const BOOL = new Set(['no-wait', 'json', 'all', 'only', 'help', 'head']);
const VALUE = new Set(['prompt', 'role', 'cwd', 'worktree', 'model', 'launcher', 'effort', 'kind']);
const argv = process.argv.slice(2);
const flags = {}; const pos = [];
let parseError = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const equal = a.indexOf('=');
    const k = a.slice(2, equal < 0 ? undefined : equal);
    if (BOOL.has(k) && equal < 0) flags[k] = true;
    else if (!VALUE.has(k)) { parseError = `모르는 옵션: --${k}`; break; }
    else {
      const value = equal < 0 ? argv[i + 1] : a.slice(equal + 1);
      if (value === undefined || (equal < 0 && value.startsWith('--'))) { parseError = `--${k}에 값이 필요하다`; break; }
      flags[k] = value;
      if (equal < 0) i++;
    }
  }
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
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error(`보드의 응답을 읽지 못했습니다 (HTTP ${res.statusCode})`)); } });
    });
    req.on('timeout', () => { req.destroy(new Error('보드 응답 시간이 초과되었습니다.')); });
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? `보드 백엔드가 실행 중이 아닙니다 (포트 ${E('PORT')})` : e.message)));
    req.end(data);
  });
}

function counts(c) { return c ? `너의 하위 세션 ${c.children}/${c.maxChildren}개, 판 전체 ${c.total}/${c.maxTotal}개, 깊이 상한 ${c.maxDepth}단계` : ''; }
// P36: 신뢰 질문에서 멈춘 하위 세션. 사람에게 할 말은 한 문장이다(판 밖 터미널을 열라고 하지 않는다)
function trustLines(x) {
  say(`  상태: needs_trust. 신뢰 질문에서 멈췄다. 보드는 대신 답하지 않고, 너도 키를 보내 답하지 않는다.`);
  say(`  사용자에게 이 한 문장만 말한다: "${x.tellHuman}"`);
  if (x.gate || x.gated) say(`  사람이 답하면 보드가 그 카드에서 워크트리로 다시 띄운다${x.firstPrompt ? '. 첫 요청는 그 뒤에 들어간다' : ''}. 그동안 herdr로 시키지 말고 기다린다: atrium child-wait ${x.name}`);
  else say(`  사람이 답한 뒤 기다리기: atrium child-wait ${x.name}`);
}

async function main() {
  if (parseError) fail(parseError, 2);
  if (!cmd || cmd === 'help' || flags.help) return say(HELP);
  if (!['me', 'child', 'children', 'child-kill', 'child-wait', 'wake', 'models'].includes(cmd)) fail(`알 수 없는 명령입니다: ${cmd}. 이 atrium은 me, child, children, child-kill, child-wait, wake, models만 한다(다른 보드 명령은 사람의 atrium으로)`, 2);
  if (!E('PORT') || !E('SESSION_ID') || !E('SESSION_TOKEN')) fail('보드에서 시작한 세션이 아닙니다 (세션 설정 파일의 환경 변수 없음). 보드에서 시작한 세션 안에서 호출하세요.');
  let r;
  if (cmd === 'child') {
    // P41: 따옴표 없이 친 여러 낱말 모델 이름(--model deepseek flash)은 뒤 낱말이 이름 자리로 새므로 멈춘다
    if (rest.length > 1) fail(`이름 자리에 낱말이 여럿이다(${rest.join(' ')}). 여러 낱말 모델 이름은 따옴표로 묶는다: --model "deepseek flash"`, 2);
    const body = { name: rest[0] || null, prompt: flags.prompt ?? null, role: flags.role ?? null, cwd: flags.cwd ? path.resolve(flags.cwd) : null, worktree: flags.worktree || null, model: flags.model || null, launcher: flags.launcher || null, effort: flags.effort || null, kind: flags.kind || null, wait: !flags['no-wait'], ...(flags.head ? { head: true } : {}) };
    r = await call('child', body, 110000);
  } else if (cmd === 'me') r = await call('me', {}, 20000);
  else if (cmd === 'models') r = await call('models', {}, 20000); else if (cmd === 'children') r = await call('children', { all: !!flags.all }, 20000);
  else if (cmd === 'child-wait') {
    if (!rest[0]) fail("대기할 하위 세션 이름을 지정하세요: atrium child-wait <이름>", 2);
    r = await call('wait', { name: rest[0] }, 110000);
  }
  else if (cmd === 'wake') {
    if (!rest[0]) fail("작업을 재개할 세션 이름을 지정하세요: atrium wake <이름>", 2);
    r = await call('wake', { name: rest[0] }, 110000);
  } else {
    if (!rest[0]) fail('끌 하위 세션 이름을 준다: atrium child-kill <이름>', 2);
    r = await call('kill', { name: rest[0], only: !!flags.only }, 110000);
  }
  // 판을 잘못 찾아가지 않았는지(설정 파일의 env와 응답한 판이 같은 herdr 세션인가)
  if (r.board && E('HERDR_SESSION') && r.board.herdrSession !== E('HERDR_SESSION')) fail(`다른 보드에서 응답했습니다 (${r.board.herdrSession}, 기대 ${E('HERDR_SESSION')})`);
  if (flags.json) { say(JSON.stringify(r.result ?? { error: r.error }, null, 2)); if (r.error) process.exit(1); return; }
  if (r.error) {
    const e = r.error;
    fail(`${cmd === 'child' ? '하위 세션을 생성하지 않았습니다.' : cmd === 'child-kill' ? '종료하지 않았습니다.' : cmd === 'wake' ? '작업을 재개하지 못했습니다.' : '실패'}(${e.code}): ${e.message}`);
  }
  const x = r.result;
  if (cmd === 'child-wait') {
    if (x.needsTrust) { say(`@${x.name}은 아직 신뢰 질문에서 멈춰 있다(${(x.ms / 1000).toFixed(0)}초 기다림).`); trustLines(x); return; }
    if (['exited', 'closed', 'error'].includes(x.state)) return say(`@${x.name}: ${x.state}. 하위 세션이 떠 있지 않다${x.state === 'exited' ? '(신뢰 질문에서 거절했거나 끝났다)' : ''}`);
    if (x.timeout) return say(`@${x.name}: 아직 ${x.state}${x.gated ? '(워크트리로 다시 띄우는 중)' : ''}. 다시 기다리기: atrium child-wait ${x.name}`);
    say(`@${x.name}: ${x.state}${x.worktree ? ` · 워크트리 ${x.worktree}` : ''} (herdr 이름 ${x.agentName}, 패널 ${x.paneId})`);
    say(`일 시키기: ${x.next.prompt}`); say(`끝나기 기다리기: herdr agent wait ${x.agentName} --timeout 600000`); say(`응답 읽기: ${x.next.read}`);
    return;
  }
  if (cmd === 'wake' || (cmd === 'child' && x.woke !== undefined)) {
    say(x.woke ? `@${x.name}을 깨웠다(${((x.ms || 0) / 1000).toFixed(1)}초, 같은 대화로 이어 감): herdr 이름 ${x.agentName}, 패널 ${x.paneId}, 상태 ${x.state}` : `@${x.name}은 이미 깨어 있다: herdr 이름 ${x.agentName}, 패널 ${x.paneId}, 상태 ${x.state}`);
    if (x.firstPrompt) say(`지시를 보냈다(${x.firstPrompt.status}). 끝나기 기다리기: ${x.next.wait}`); else say(`일 시키기: ${x.next.prompt}`);
    say(`응답 읽기: ${x.next.read}`);
    return;
  }
  if (cmd === 'models') return printModels(x);
  if (cmd === 'me') return printMe(x);
  if (cmd === 'child') {
    if (x.resolved) say(`모델 "${x.resolved.from}" → ${x.resolved.to} (${{ exact: '정확한 이름', alias: '별칭', loose: '유사 이름 일치' }[x.resolved.how] || x.resolved.how})`);
    else if (x.launcher) say(`런처 ${x.launcher}로 실행했습니다.${x.gateway ? `(게이트웨이 경유 ${x.gateway})` : ''}`);
    else if (x.inheritedGateway) say(`너의 게이트웨이(${x.inheritedGateway})와 모델을 물려받았다`);
    if (x.head) say(`헤드로 띄웠다: @${x.name} (herdr 이름 ${x.agentName}, 패널 ${x.paneId}, 종류 ${x.kind}). 너의 워커가 아니다. 첫 요청 뒤 보드가 부모 관계를 ${x.head.detached ? '뗐다' : '뗀다'}. 그 뒤로 일을 시키거나 기다리지 않는다`);
    else say(`하위 세션을 생성했습니다: @${x.name} (herdr 이름 ${x.agentName}, 패널 ${x.paneId}, 종류 ${x.kind}, 역할 "${x.role}", ${x.depth}단계)`);
    if (x.harness) {
      // P96: 다른 종류(codex 등). 무엇을 물려받았는지: 바탕 호출자, 띄운 명령, 승인
      const H = x.harness;
      const base = H.base === 'bare' ? '런처 없음(맨 명령)' : `런처 ${H.launcher}${H.base === 'rail' ? '(보드 레일의 기본 설정)' : ''}`;
      const appr = { parent: `너의 승인 방식 ${H.parentPermissionMode}을 옮김`, launcher: '런처의 인자', harness: `${x.kind}의 사용자 설정(너의 승인 방식 ${H.parentPermissionMode}은 옮기지 않음)` }[H.approvalFrom] || '옮기지 않음';
      say(`  폴더 ${x.cwd}${x.model ? ` · 모델 ${x.model}` : ''} · ${base}`);
      say(`  명령 ${[x.kind, ...H.argv].join(' ')} · 승인: ${appr}`);
      say(`  ${x.kind}는 hook이 없다. 끝났는지는 herdr agent wait로 본다`);
    } else say(`  폴더 ${x.cwd}${x.worktree ? ` · 워크트리 ${x.worktree}(claude -w${x.gate ? ', 신뢰를 받은 뒤' : ''})` : ''}${x.model ? ` · 모델 ${x.model}` : ''}${x.effort ? ` · 노력 ${x.effort}` : ''} · 승인 방식 ${x.permissionMode}`);
    const w = x.waited;
    if (x.needsTrust) { trustLines(x); say(`응답 읽기: ${x.next.read}`); say(counts(x.counts)); return; }
    if (!w) say('  상태: 기다리지 않음(--no-wait). 준비되기 전에는 herdr agent wait로 기다린다');
    else if (w.state === 'waiting') say('  상태: 승인을 기다린다. 사용자에게 보드의 승인 카드에 답해 달라고 알린다');
    else if (['error', 'exited', 'closed'].includes(w.state)) say(`  상태: ${w.state}. 하위 세션이 제대로 뜨지 않았다${x.error ? `(${x.error.type}: ${x.error.message || ''})` : ''}`);
    else if (w.timeout) say(`  상태: ${w.state}(아직 준비 중). herdr agent wait ${x.agentName} --timeout 600000 으로 기다린다`);
    else say(`  상태: ${w.state}${x.firstPrompt ? `, 첫 요청 ${w.delivery || x.firstPrompt.status}` : ''} (${(w.ms / 1000).toFixed(1)}초)`);
    // P79: 첫 요청이 들어갔다고 확인하지 못했으면 그 사실과 다음 명령
    const fp = x.firstPrompt ? (w && w.delivery) || x.firstPrompt.status : null;
    if (fp && fp !== 'confirmed') {
      if (['unconfirmed', 'failed', 'cancelled'].includes(fp)) say(`  첫 요청이 들어가지 않았다(${fp}). 화면 보기: herdr agent read ${x.agentName} --source recent-unwrapped --lines 40 · 다시 보내기: ${x.next.prompt}`);
      else say(`  첫 요청은 아직 확인되지 않았다(${fp}). 보드가 들어갈 때까지 보낸다. 확인: atrium children(들어가지 않으면 "첫 요청 안 들어감"이 보인다) · 다시 보내기: ${x.next.prompt}`);
    }
    if (x.head) { say(`화면 보기(필요할 때만): ${x.next.read}`); say('지금 연결: atrium me'); return; }
    if (x.firstPrompt) say(`끝나기 기다리기: ${x.next.wait}`); else say(`일 시키기: ${x.next.prompt}`);
    say(`응답 읽기: ${x.next.read}`);
    say(counts(x.counts));
    return;
  }
  if (cmd === 'children') {
    say(`@${x.parent}(${x.depth}단계)의 하위 세션 ${x.children.length}개. ${counts(x.counts)}`);
    for (const c of x.children) {
      say(`${'  '.repeat(Math.max(1, c.depth - x.depth))}@${c.name} (herdr ${c.agentName}, 패널 ${c.paneId || '없음'}, "${c.role || '-'}", ${c.depth}단계) ${c.state}${c.state === 'sleeping' ? ` — 절전 중. 시키기 전에 atrium wake ${c.name}` : ''}${c.state === 'trust_wait' ? ` — 신뢰 질문(사람이 답한다). 기다리기: atrium child-wait ${c.name}` : c.gated ? ` — 워크트리로 다시 띄울 차례. 기다리기: atrium child-wait ${c.name}` : ''}${c.ask ? ` — 묻는 중: ${c.ask}` : ''}${c.error ? ` — 오류 ${c.error.type}: ${(c.error.message || '').replace(/\s+/g, ' ')}` : ''}${c.model ? ` · 모델 ${c.model}` : ''}${c.children ? ` · 하위 ${c.children}` : ''}`);
      if (c.error && /model/i.test(c.error.type || '')) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}모델을 쓰지 못했다. 다른 모델로 다시 띄운다(atrium models). 끄기는 사람이 끄라고 할 때만`);
      if (c.firstPromptLost) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}첫 요청 안 들어감(${c.firstPromptLost.status}${c.firstPromptLost.reason ? `: ${c.firstPromptLost.reason}` : ''}). 화면 보기: herdr agent read ${c.agentName} --source recent-unwrapped --lines 40 · 다시 보내기: herdr agent prompt ${c.agentName} "<할 일>"`); // P79
      if (c.deliveryStuck) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}보낸 글이 ${Math.round((Date.now() - c.deliveryStuck.since) / 1000)}초째 들어가지 않음(herdr ${c.deliveryStuck.code || c.deliveryStuck.reason}, ${c.deliveryStuck.attempts}번 시도, 보드가 간격을 늘려 다시 보낸다). 화면 보기: herdr agent read ${c.agentName} --source recent-unwrapped --lines 40 · 취소: atrium cancel ${c.deliveryStuck.deliveryId}`); // P106
      if (c.lastAnswer) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}마지막 응답:${c.lastAnswer.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    return;
  }
  say(`껐다: ${x.killed.map((k) => `@${k.name}${k.closed ? '' : `(실패 ${k.error || ''})`}`).join(', ')}`);
}
// P81: atrium me. 보통 20줄 안. 하위 세션이 많으면 10개까지 보이고 나머지는 atrium children으로
function ago(at, now) {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.round(s / 60)}분 전` : s < 86400 ? `${Math.round(s / 3600)}시간 전` : `${Math.round(s / 86400)}일 전`;
}
function printMe(x) {
  const last = (l) => (l ? ` · 마지막 지시 ${ago(l.at, x.at)}${l.text ? ` "${l.text}"` : ''}` : '');
  const m = x.me;
  say(`나: @${m.name} (herdr ${m.agentName}${m.paneId ? `, 패널 ${m.paneId}` : ''}, ${m.kind}) · 워크스페이스 ${m.workspace || '-'}${m.worktree ? ` · 워크트리 ${m.worktree}` : ''}${m.branch ? ` · 브랜치 ${m.branch}` : ''}`);
  const p = x.parent;
  if (!p) say('부모: 부모 없음');
  else if (p.closed) say(`부모: @${p.name} (닫힘)${p.role ? ` — 너는 @${p.name}의 ${p.role}${p.order ? ` ${p.order}` : ''}` : ''}`);
  else say(`부모: @${p.name} (herdr ${p.agentName}, ${p.state})${p.role ? ` — 너는 @${p.name}의 ${p.role}${p.order ? ` ${p.order}` : ''}` : ''}${p.head ? '. 너는 헤드로 떴다. 첫 요청 뒤 보드가 부모 관계를 뗀다' : ''}${last(p.last)}`);
  if (!x.children.length) say('하위 세션: 없음');
  else {
    say(`하위 세션 ${x.children.length}개:`);
    for (const c of x.children.slice(0, 10)) say(`  @${c.name} (herdr ${c.agentName}) ${c.role || '-'}${c.order ? ` ${c.order}` : ''} · ${c.state}${c.state === 'sleeping' ? `(시키기 전에 atrium wake ${c.agentName})` : ''}${c.worktree ? ` · 워크트리 ${c.worktree}` : ''}${last(c.last)}`);
    if (x.children.length > 10) say(`  …외 ${x.children.length - 10}개(atrium children)`);
  }
  if (x.roles.length) {
    say('역할 연결:');
    for (const r of x.roles.slice(0, 8)) say(`  ${r.dir === 'out' ? `너의 ${r.role}은 @${r.name}` : `너는 @${r.name}의 ${r.role}`} (herdr ${r.agentName}, ${r.state})${last(r.last)}`);
  }
  say(`일 시키기: ${x.commands.prompt} · 응답 읽기: ${x.commands.read}`);
  say('이것이 보드의 지금 기록이다. 예전 알림과 다르면 이것을 믿는다.');
}
// P41: atrium models
function printModels(x) {
  const by = (src) => x.entries.filter((e) => e.source === src);
  say(`띄울 수 있는 것(이 목록의 명령을 그대로 친다. <이름>은 워커 이름). 너(@${x.parent.name})의 모델: ${x.parent.model || '(기본)'}${x.parent.gateway ? `, 게이트웨이 ${x.parent.gateway}` : ''}`);
  say('');
  say('런처 (왼쪽 도구 모음과 동일):');
  for (const e of by('launcher')) say(`  ${e.text}
    ${e.command}`);
  say('');
  say('에이전트별 모델과 별칭:');
  for (const e of by('harness')) say(`  ${e.text}
    ${e.command}`);
  for (const g of x.gateways) {
    say('');
    if (!g.ok) { say(`게이트웨이 ${g.url}${g.host ? `(런처 ${g.host})` : ''}: 닿지 않는다(${g.why}). 그 모델은 지금 띄우지 못한다`); continue; }
    const list = x.entries.filter((e) => e.source === 'gateway' && e.gateway === g.url);
    say(`게이트웨이 ${g.url}${g.host ? `(런처 ${g.host}의 env로 띄운다)` : ''}의 모델 ${list.length}개:`);
    for (const e of list) say(`  ${e.label || e.model}
    ${e.command}`);
  }
  say('');
  say('사용자가 모델을 말로 하면(예: "deepseek flash") --model에 그 말을 그대로 줘도 보드가 이 목록에서 푼다. 여럿이 맞으면 보드가 후보를 돌려준다.');
}
main().catch((e) => fail(e.message));
