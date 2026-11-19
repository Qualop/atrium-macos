#!/usr/bin/env node
// 하위 세션 명령(P8, ARCH 4절 K): 판이 띄운 세션 안에서 부른다. 판 플러그인의 bin/atrium(옛 이름 bin/mtask)이 이 파일을 부른다.
// 판의 API 토큰(backend.json)을 읽지 않는다. 세션 설정 파일의 env(ATRIUM_PORT, ATRIUM_SESSION_ID, ATRIUM_SESSION_TOKEN 등. P18 전에 띄운 세션은 MTASK_*)로 그 판의 POST /branch/*만 부른다.
// 사용: atrium prompt <이름> "<글>" [--wait | --now] [--timeout ms] [--file 경로] [--json]   (P116: 다른 에이전트에게 일 시키기. 판의 전달 규칙으로 넣는다)
//       atrium wait <이름> [--timeout ms] [--json]   (P116: 그 세션의 지금 턴이 끝날 때까지, 마지막 답)
//       atrium read <이름> [--lines n] [--json]   (P116: 그 세션 화면의 최근 줄)
//       atrium relate <이름> sub|peer|none|auto [--json]   (P156: 나와 그 세션의 일 관계)
//       atrium child [이름] [--peer] [--prompt 글] [--role 역할] [--cwd 폴더] [--worktree 이름] [--model 모델] [--launcher 호출자] [--effort 노력] [--kind 종류] [--head] [--no-wait] [--json]
//       atrium me [--json]   (P81: 너의 지금 연결 — 부모, 하위 세션, 역할 연결, 마지막 지시)
//       atrium models [--json]   (P41: 띄울 수 있는 호출자와 모델, 그 명령)
//       atrium child-wait <이름> [--json]   (P36: 신뢰 관문을 지나 지시를 받을 수 있게 될 때까지)
//       atrium children [--all] [--json]
//       atrium child-kill <이름> [--only] [--json]
//       atrium wake <이름> [--json]   (P21: 잠든 세션 깨우기, P24: 그 리포째, P111: 혼자 잠든 세션은 그 세션만)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { envVar, terminalSessionVar } from '../src/config.mjs';
import { shortHelp, contractJson, VERB_NAMES, RELATION_HELP } from '../src/cli-contract.mjs'; // P115: 계약(atrium help --json). P156: 관계 고르기 안내

const HELP = `atrium(보드가 띄운 세션의 명령. 옛 이름 mtask도 같다)
  atrium prompt <이름> "<할 일>" [--wait | --now] [--timeout ms] [--file 경로]
      다른 에이전트에게 일을 시킨다. 이름은 보드의 세션 이름이다(@ 없이도). 보드가 받는 쪽 차례에 맞춰 넣는다: 일하는 중이거나 사람의 답을 기다리면 끝난 뒤,
      사람이 그 터미널에 치는 중이면 3초 뒤, 잠들었으면 깨운 뒤. 보낸 쪽 → 받는 쪽 연결과 오간 기록이 판에 남는다.
      --wait면 그 글로 시작한 턴이 끝날 때까지 기다려 마지막 답을 돌려준다(기본 100초. 더 길게는 --timeout 600000과 셸 도구의 시간 제한을 함께 늘린다).
      --now는 받는 쪽이 일하는 중인 Claude Code면 끝나기를 기다리지 않고 그 세션의 대기 메시지로 바로 넣는다(지금 턴 안에서 읽는다). 워커가 지휘 세션에 결과를 알릴 때 쓴다.
      그 밖(쉬는 중, 다른 종류, 사람의 답을 기다림, 잠듦)은 위와 같다. --wait와 함께 쓰지 않는다.
      --file은 글을 파일에서 읽는다(긴 글, 따옴표가 많은 글).
  atrium wait <이름> [--timeout ms]
      그 세션이 지금 턴(너의 글이 대기열에 있으면 그 글의 턴)을 끝낼 때까지 기다려 마지막 답을 돌려준다(Claude Code는 hook의 답, 다른 종류는 보드가 화면에서 고른 답).
      사람의 답을 기다리면 바로 돌아온다(waiting). 시간이 끝나면 종료 코드 3이고 일은 계속된다. 다시 atrium wait
  atrium read <이름> [--lines n]   그 세션 화면의 최근 줄(기본 80줄). 잠든 세션은 마지막 답
  atrium child [이름] [--peer] [--prompt "첫 요청"] [--role 역할] [--cwd 폴더] [--worktree 이름] [--model 모델] [--launcher 런처] [--effort 노력] [--kind 종류] [--no-wait]
      세션을 띄운다. 너의 폴더·모델·추론 수준·승인 방식·그룹을 물려받고(준 값이 덮는다), 너와 역할 선(기본 "워커", --peer면 "동료")으로 이어진다.
      관계: 기본은 하위 워커다(끝나면 너에게 보고한다. atrium children에 보이고 child-kill로 함께 꺼진다).
      --peer는 동료다(같은 위계의 협력자. 필요한 것을 서로 주고받고, 끝나면 결과를 너에게 공유하며, 사람에게 직접 답해도 된다. child-kill 연쇄에서 빠진다).
      누가 띄웠는지(계보)는 둘 다 남는다. 보드가 첫 요청 앞에 관계 한 줄을 붙이고, 응답 첫 줄에 관계를 쓴다.
      --model은 말로 한 이름도 받는다("glm flash", opus). 보드가 아는 목록에서 풀고, 여럿이 맞거나 없으면 띄우지 않고 후보를 돌려준다.
      --launcher는 그 런처(도구 모음의 단추)의 하네스·모델·옵션·환경 변수 그대로 띄운다.
      --kind codex(다른 종류)는 보드 레일의 그 종류 런처 설정(추가 인자·모델, --model이 모델만 덮는다)으로 띄우고, 너의 승인 방식을 그 종류의 승인 인자로 옮긴다.
      준비될 때까지 기다린 뒤 워커 이름과 일 시키기·기다리기·읽기 명령을 돌려준다. 설정의 워커 수·깊이·전체 상한을 지킨다.
      --worktree는 claude -w로 워크트리를 만든다. 신뢰를 받지 않은 저장소면 신뢰 질문에서 멈추고(needs_trust) 사람에게 할 한 문장을 돌려준다.
      --head는 너의 워커가 아니라 따로 일을 이끄는 세션(헤드)으로 띄운다. 첫 요청 뒤 보드가 부모 관계를 뗀다. 그 뒤로 일을 시키거나 기다리지 않는다(--worktree와 함께 쓰지 않는다).
  atrium relate <이름> sub|peer|none|auto
      나와 그 세션의 관계를 바꾼다: 그 세션이 나의 sub(하위), peer(동료), none(독립: 서로 보고하거나 맡기지 않음), auto(자동: 띄움·역할 선 = 하위).
      너와 이어진 세션(띄움, 역할 선, 지시, 정한 관계)만 바꾼다. 사람이 판에서 정한 관계는 바꾸지 않는다(사람에게 묻는다). 상대에게 보드가 짧게 알린다.
  atrium me                     너의 지금 연결: 상위(너를 하위로 둔 세션)·동료·하위·독립, 역할 연결, 연결마다 마지막 지시. 보드의 지금 기록이라 예전 알림과 다르면 이것을 믿는다
  atrium child-wait <이름>      그 하위 세션이 지시를 받을 수 있게 될 때까지 기다린다(신뢰 질문에 사람이 답한 뒤 워크트리에서 다시 뜰 때까지. 한 번에 100초)
  atrium children [--all]       너의 하위 세션(--all이면 그 아래까지) 상태와 마지막 응답. 하위 관계만 보이고 동료는 따로 한 줄
  atrium models [--all]         기본 모델·추론과 띄울 수 있는 런처·모델과 그 명령(--all이면 연결 모델 목록까지)
  atrium child-kill <이름> [--only] [--force]   너의 하위 세션을 끈다(하위 관계로만 그 아래도 함께. --only면 그것만). 동료·독립은 끄지 않고 남긴 이름을 적는다. 사람이 끄라고 할 때만 쓴다. 일하는 중이면 끄지 않는다(하던 일이 사라진다). 필요 없어진 일이면 --force
  atrium wake <이름>   잠든(sleeping) 세션을 깨운다. 혼자 잠든 세션은 그 세션만, 리포째 잠들었으면 그 리포에서 리포째 잠든 세션을 모두 깨운다. 같은 대화로 이어 가고 그 세션이 준비되면 돌려준다. atrium prompt는 잠든 세션을 깨운 뒤 넣으므로 미리 깨울 때만 쓴다
${RELATION_HELP.join('\n')}
이 명령은 보드가 띄운 세션에서만 된다. 다른 보드 명령은 없다. 다른 에이전트에게는 atrium prompt로만 보낸다(터미널 명령으로 직접 보내면 보드가 연결을 남기지 못한다).`;

const BOOL = new Set(['no-wait', 'json', 'all', 'only', 'help', 'head', 'long', 'wait', 'now', 'peer', 'force']); // macOS 판: child-kill --force(일하는 하위도 끈다)
const VALUE = new Set(['prompt', 'role', 'cwd', 'worktree', 'model', 'launcher', 'effort', 'kind', 'lines', 'timeout', 'file']); // P116: prompt·wait·read의 값 옵션 // P156: child --peer // P116: prompt --wait, P143: prompt --now
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
const E = (name) => envVar(name) || (['PORT', 'SESSION_ID', 'SESSION_TOKEN', 'DATA_DIR', 'TERMINAL_SESSION', 'HERDR_SESSION'].includes(name) ? branchEnv[`ATRIUM_${name}`] : undefined);
// P115: 세션 토큰. Claude Code는 세션 설정 파일의 env, 다른 하네스는 판 데이터 폴더의 sessions/<세션 ID>.token(친 줄에 토큰을 싣지 않는다)
function sessionToken() {
  if (E('SESSION_TOKEN')) return E('SESSION_TOKEN');
  if (!E('DATA_DIR') || !E('SESSION_ID')) return null;
  try { return fs.readFileSync(path.join(E('DATA_DIR'), 'sessions', `${E('SESSION_ID')}.token`), 'utf8').trim() || null; } catch { return null; }
}
let TOKEN = null;
const say = (s) => process.stdout.write(s + '\n');
const fail = (msg, code = 1) => { process.stderr.write(`atrium: ${msg}\n`); process.exit(code); };

function call(op, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: Number(E('PORT')), path: `/branch/${op}`, method: 'POST', timeout: timeoutMs,
      headers: { 'content-type': 'application/json', 'content-length': data.length, authorization: `Bearer ${TOKEN}`, 'x-mt-session': E('SESSION_ID') } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error(`보드의 응답을 읽지 못했습니다 (HTTP ${res.statusCode})`)); } });
    });
    req.on('timeout', () => { req.destroy(new Error('보드 응답 시간이 초과되었습니다.')); });
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? `보드 백엔드가 실행 중이 아닙니다 (포트 ${E('PORT')})` : e.message)));
    req.end(data);
  });
}

function counts(c) { return c ? `너의 하위 세션 ${c.children}/${c.maxChildren}개${c.peers ? `, 동료 ${c.peers}명` : ''}, 판 전체 ${c.total}/${c.maxTotal}개, 깊이 상한 ${c.maxDepth}단계` : ''; } // P156: 하위는 하위 관계만
// P36: 신뢰 질문에서 멈춘 하위 세션. 사람에게 할 말은 한 문장이다(판 밖 터미널을 열라고 하지 않는다)
function trustLines(x) {
  say(`  상태: needs_trust. 신뢰 질문에서 멈췄다. 보드는 대신 답하지 않고, 너도 키를 보내 답하지 않는다.`);
  say(`  사용자에게 이 한 문장만 말한다: "${x.tellHuman}"`);
  if (x.gate || x.gated) say(`  사람이 답하면 보드가 그 카드에서 워크트리로 다시 띄운다${x.firstPrompt ? '. 첫 요청는 그 뒤에 들어간다' : ''}. 그동안 따로 시키지 말고 기다린다: atrium child-wait ${x.name}`);
  else say(`  사람이 답한 뒤 기다리기: atrium child-wait ${x.name}`);
}

async function main() {
  // P115: help는 모델이 읽는 짧은 사용법, --json은 기계용 계약, --long은 예전의 긴 설명. 보드에 묻지 않는다
  if (parseError) fail(parseError, 2);
  if (!cmd || cmd === 'help' || flags.help) return flags.json ? say(JSON.stringify(contractJson(), null, 2)) : say(flags.long ? HELP : shortHelp());
  if (!VERB_NAMES.includes(cmd)) fail(`알 수 없는 명령입니다: ${cmd}. 이 atrium은 ${VERB_NAMES.join(', ')}만 한다(다른 보드 명령은 사람의 atrium으로). 사용법: atrium help`, 2);
  TOKEN = sessionToken();
  if (!E('PORT') || !E('SESSION_ID') || !TOKEN) fail('보드에서 시작한 세션이 아닙니다 (보드가 준 환경 변수나 세션 토큰 파일 없음). 보드에서 시작한 세션 안에서 호출하세요.');
  let r;
  // P116: 일 시키기·기다리기·읽기
  if (cmd === 'prompt' || cmd === 'wait' || cmd === 'read') return verb(cmd);
  if (cmd === 'child') {
    // P41: 따옴표 없이 친 여러 낱말 모델 이름(--model glm flash)은 뒤 낱말이 이름 자리로 새므로 멈춘다
    if (rest.length > 1) fail(`이름 자리에 낱말이 여럿이다(${rest.join(' ')}). 여러 낱말 모델 이름은 따옴표로 묶는다: --model "glm flash"`, 2);
    const body = { name: rest[0] || null, prompt: flags.prompt ?? null, role: flags.role ?? null, cwd: flags.cwd ? path.resolve(flags.cwd) : null, worktree: flags.worktree || null, model: flags.model || null, launcher: flags.launcher || null, effort: flags.effort || null, kind: flags.kind || null, wait: !flags['no-wait'], ...(flags.head ? { head: true } : {}), ...(flags.peer ? { peer: true } : {}) };
    r = await call('child', body, 110000);
  } else if (cmd === 'me') r = await call('me', {}, 20000);
  else if (cmd === 'models') r = await call('models', {}, 20000); else if (cmd === 'children') r = await call('children', { all: !!flags.all }, 20000);
  else if (cmd === 'relate') {
    if (!rest[0] || !rest[1]) fail('사용법: atrium relate <이름> sub|peer|none|auto (그 세션이 나의 하위·동료·독립, auto는 자동으로 되돌림)', 2);
    if (!['sub', 'peer', 'none', 'auto'].includes(rest[1])) fail(`관계는 sub(하위), peer(동료), none(독립), auto(자동) 가운데 하나다: ${rest[1]}`, 2);
    r = await call('relate', { name: rest[0], relation: rest[1] }, 20000);
  }
  else if (cmd === 'child-wait') {
    if (!rest[0]) fail("대기할 하위 세션 이름을 지정하세요: atrium child-wait <이름>", 2);
    r = await call('wait', { name: rest[0] }, 110000);
  }
  else if (cmd === 'wake') {
    if (!rest[0]) fail("작업을 재개할 세션 이름을 지정하세요: atrium wake <이름>", 2);
    r = await call('wake', { name: rest[0] }, 110000);
  } else {
    if (!rest[0]) fail('끌 하위 세션 이름을 준다: atrium child-kill <이름>', 2);
    r = await call('kill', { name: rest[0], only: !!flags.only, force: !!flags.force }, 110000);
  }
  // 판을 잘못 찾아가지 않았는지(설정 파일의 env와 응답한 판이 같은 터미널 세션인가)
  { const want = terminalSessionVar(); if (r.board && want && r.board.terminalSession !== want) fail(`다른 보드에서 응답했습니다 (${r.board.terminalSession}, 기대 ${want})`); }
  if (flags.json) { say(JSON.stringify(r.result ?? { error: r.error }, null, 2)); if (r.error) process.exit(1); return; }
  if (r.error) {
    const e = r.error;
    fail(`${cmd === 'child' ? '하위 세션을 생성하지 않았습니다.' : cmd === 'child-kill' ? '종료하지 않았습니다.' : cmd === 'wake' ? '작업을 재개하지 못했습니다.' : cmd === 'relate' ? '관계를 바꾸지 않았다.' : '실패'}(${e.code}): ${e.message}`);
  }
  const x = r.result;
  if (cmd === 'child-wait') {
    if (x.needsTrust) { say(`@${x.name}은 아직 신뢰 질문에서 멈춰 있다(${(x.ms / 1000).toFixed(0)}초 기다림).`); trustLines(x); return; }
    if (['exited', 'closed', 'error'].includes(x.state)) return say(`@${x.name}: ${x.state}. 하위 세션이 떠 있지 않다${x.state === 'exited' ? '(신뢰 질문에서 거절했거나 끝났다)' : ''}`);
    if (x.timeout) return say(`@${x.name}: 아직 ${x.state}${x.gated ? '(워크트리로 다시 띄우는 중)' : ''}. 다시 기다리기: atrium child-wait ${x.name}`);
    say(`@${x.name}: ${x.state}${x.worktree ? ` · 워크트리 ${x.worktree}` : ''}`);
    say(`일 시키기: ${x.next.prompt}`); say(`끝나기 기다리기: atrium wait ${x.name} · 화면 읽기: ${x.next.read}`); // P116
    return;
  }
  if (cmd === 'wake' || (cmd === 'child' && x.woke !== undefined)) {
    say(x.woke ? `@${x.name}을 깨웠다(${((x.ms || 0) / 1000).toFixed(1)}초, 같은 대화로 이어 감): 상태 ${x.state}` : `@${x.name}은 이미 깨어 있다: 상태 ${x.state}`);
    if (x.firstPrompt) say(`지시를 보냈다(${x.firstPrompt.status}). 끝나기 기다리기: ${x.next.wait}`); else say(`일 시키기: ${x.next.prompt}`);
    say(`화면 읽기: ${x.next.read}`);
    return;
  }
  if (cmd === 'models') return printModels(x);
  if (cmd === 'me') return printMe(x);
  if (cmd === 'relate') return printRelate(x);
  if (cmd === 'child') {
    if (x.resolved) say(`모델 "${x.resolved.from}" → ${x.resolved.to} (${{ exact: '정확한 이름', alias: '별칭', loose: '유사 이름 일치' }[x.resolved.how] || x.resolved.how})`);
    else if (x.launcher) say(`런처 ${x.launcher}로 실행했습니다.${x.gateway ? `(게이트웨이 경유 ${x.gateway})` : ''}`);
    else if (x.inheritedGateway) say(`너의 게이트웨이(${x.inheritedGateway})와 모델을 물려받았다`);
    if (x.head) say(`헤드로 띄웠다: @${x.name} (종류 ${x.kind}). 너의 워커가 아니다. 첫 요청 뒤 보드가 부모 관계를 ${x.head.detached ? '뗐다' : '뗀다'}. 그 뒤로 일을 시키거나 기다리지 않는다`);
    else if (x.relation === 'peer') { say(`관계: 동료. @${x.name}는 너의 하위 워커가 아니다(같은 위계의 협력자). 필요한 것을 주고받고, 끝나면 결과를 너에게 공유한다. child-kill 연쇄에서 빠진다`); say(`동료를 띄웠다: @${x.name} (종류 ${x.kind}, 역할 "${x.role}")`); }
    else { say(`관계: 하위 워커. @${x.name}는 너의 워커다. 끝나면 너에게 보고하고(보고 방법은 네 지시를 따른다), child-kill로 함께 꺼진다`); say(`하위 세션을 생성했습니다: @${x.name} (종류 ${x.kind}, 역할 "${x.role}", ${x.depth}단계)`); }
    if (x.harness) {
      // P96: 다른 종류(codex 등). 무엇을 물려받았는지: 바탕 호출자, 띄운 명령, 승인
      const H = x.harness;
      const base = H.base === 'bare' ? '런처 없음(맨 명령)' : `런처 ${H.launcher}${H.base === 'rail' ? '(보드 레일의 기본 설정)' : ''}`;
      const appr = { parent: `너의 승인 방식 ${H.parentPermissionMode}을 옮김`, launcher: '런처의 인자', harness: `${x.kind}의 사용자 설정(너의 승인 방식 ${H.parentPermissionMode}은 옮기지 않음)` }[H.approvalFrom] || '옮기지 않음';
      say(`  폴더 ${x.cwd}${x.model ? ` · 모델 ${x.model}` : ''} · ${base}`);
      say(`  명령 ${[x.kind, ...H.argv].join(' ')} · 승인: ${appr}`);
      say(`  ${x.kind}는 hook이 없다. 보드가 화면으로 끝과 답을 보고, atrium wait가 같은 모양으로 돌려준다`);
    } else say(`  폴더 ${x.cwd}${x.worktree ? ` · 워크트리 ${x.worktree}(claude -w${x.gate ? ', 신뢰를 받은 뒤' : ''})` : ''}${x.model ? ` · 모델 ${x.model}` : ''}${x.effort ? ` · 노력 ${x.effort}` : ''} · 승인 방식 ${x.permissionMode}`);
    const w = x.waited;
    if (x.needsTrust) { trustLines(x); say(`응답 읽기: ${x.next.read}`); say(counts(x.counts)); return; }
    if (!w) say(`  상태: 기다리지 않음(--no-wait). 준비되면 보드가 첫 요청을 넣는다. 끝나기 기다리기: atrium wait ${x.name}`);
    else if (w.state === 'waiting') say('  상태: 승인을 기다린다. 사용자에게 보드의 승인 카드에 답해 달라고 알린다');
    else if (['error', 'exited', 'closed'].includes(w.state)) say(`  상태: ${w.state}. 하위 세션이 제대로 뜨지 않았다${x.error ? `(${x.error.type}: ${x.error.message || ''})` : ''}`);
    else if (w.timeout) say(`  상태: ${w.state}(아직 준비 중). atrium wait ${x.name}으로 기다린다`);
    else say(`  상태: ${w.state}${x.firstPrompt ? `, 첫 요청 ${w.delivery || x.firstPrompt.status}` : ''} (${(w.ms / 1000).toFixed(1)}초)`);
    // P79: 첫 요청이 들어갔다고 확인하지 못했으면 그 사실과 다음 명령
    const fp = x.firstPrompt ? (w && w.delivery) || x.firstPrompt.status : null;
    if (fp && fp !== 'confirmed') {
      if (['unconfirmed', 'failed', 'cancelled'].includes(fp)) say(`  첫 요청이 들어가지 않았다(${fp}). 화면 보기: atrium read ${x.name} --lines 40 · 다시 보내기: ${x.next.prompt}`);
      else say(`  첫 요청은 아직 확인되지 않았다(${fp}). 보드가 들어갈 때까지 보낸다. 확인: atrium children(들어가지 않으면 "첫 요청 안 들어감"이 보인다) · 다시 보내기: ${x.next.prompt}`);
    }
    if (x.head) { say(`화면 보기(필요할 때만): ${x.next.read}`); say('지금 연결: atrium me'); return; }
    if (x.relation === 'peer') say(`동료는 끝나면 결과를 너에게 공유한다(--now로 들어온다). atrium wait·--wait로 기다리지 않는다(같은 결과가 두 번 온다). 주고받기: atrium prompt ${x.name} "<할 일>"`);
    else if (x.firstPrompt) say(`끝나기 기다리기: ${x.next.wait}`); else say(`일 시키기: ${x.next.prompt}`);
    say(`화면 읽기: ${x.next.read}`);
    say(counts(x.counts));
    return;
  }
  if (cmd === 'children') {
    say(`@${x.parent}(${x.depth}단계)의 하위 세션 ${x.children.length}개. ${counts(x.counts)}`);
    // P156: 하위 관계만 나무로, 동료는 따로 한 줄. 들여쓰기는 부르는 세션에서 몇 단계 아래인지(level)
    for (const c of x.children) c.depth = x.depth + (c.level || Math.max(1, c.depth - x.depth));
    for (const c of x.children) {
      say(`${'  '.repeat(Math.max(1, c.depth - x.depth))}@${c.name} ("${c.role || '-'}", ${c.depth}단계${c.kind && c.kind !== 'claude' ? `, ${c.kind}` : ''}) ${c.state}${c.state === 'sleeping' ? ` — 절전 중. 시키기 전에 atrium wake ${c.name}` : ''}${c.state === 'trust_wait' ? ` — 신뢰 질문(사람이 답한다). 기다리기: atrium child-wait ${c.name}` : c.gated ? ` — 워크트리로 다시 띄울 차례. 기다리기: atrium child-wait ${c.name}` : ''}${c.ask ? ` — 묻는 중: ${c.ask}` : ''}${c.error ? ` — 오류 ${c.error.type}: ${(c.error.message || '').replace(/\s+/g, ' ')}` : ''}${c.model ? ` · 모델 ${c.model}` : ''}${c.children ? ` · 하위 ${c.children}` : ''}`);
      if (c.error && /model/i.test(c.error.type || '')) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}모델을 쓰지 못했다. 다른 모델로 다시 띄운다(atrium models). 끄기는 사람이 끄라고 할 때만`);
      if (c.firstPromptLost) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}첫 요청 안 들어감(${c.firstPromptLost.status}${c.firstPromptLost.reason ? `: ${c.firstPromptLost.reason}` : ''}). 화면 보기: atrium read ${c.name} --lines 40 · 다시 보내기: atrium prompt ${c.name} "<할 일>"`); // P79
      if (c.deliveryStuck) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}보낸 글이 ${Math.round((Date.now() - c.deliveryStuck.since) / 1000)}초째 들어가지 않음(${c.deliveryStuck.code || c.deliveryStuck.reason}, ${c.deliveryStuck.attempts}번 시도, 보드가 간격을 늘려 다시 보낸다). 화면 보기: atrium read ${c.name} --lines 40 · 취소는 사람이 보드에서 한다(전달 ${c.deliveryStuck.deliveryId})`); // P106. P116: 이 atrium에는 cancel이 없다
      if (c.lastAnswer) say(`${'  '.repeat(Math.max(1, c.depth - x.depth) + 1)}마지막 응답:${c.lastAnswer.replace(/\s+/g, ' ').slice(0, 400)}`);
    }
    if (x.peers && x.peers.length) say(`동료(하위가 아니다, 결과를 서로 공유): ${x.peers.map((p) => `@${p.name} ${p.state}`).join(', ')}`);
    return;
  }
  say(`껐다: ${x.killed.map((k) => `@${k.name}${k.closed ? '' : `(실패 ${k.error || ''})`}`).join(', ')}`);
  if (x.kept && x.kept.length) say(`남겼다(하위가 아니라 끄지 않음): ${x.kept.map((k) => `@${k.name}(${REL_WORD[k.relation] || k.relation})`).join(', ')}`); // P156
}
// ---------- P116: atrium prompt | wait | read ----------
const secs = (ms) => `${((ms || 0) / 1000).toFixed(1)}초`;
const WAIT_HTTP_EXTRA = 20000;
async function verb(cmd) {
  const name = rest[0];
  if (!name) fail(`받을 세션 이름을 준다: atrium ${cmd} <이름>${cmd === 'prompt' ? ' "<할 일>"' : ''}`, 2);
  const timeoutMs = flags.timeout != null ? Number(flags.timeout) : null;
  if (flags.timeout != null && !(timeoutMs > 0)) fail(`--timeout은 밀리초 수다: ${flags.timeout}`, 2);
  let r;
  if (cmd === 'prompt') {
    let text = rest.slice(1).join(' ');
    if (flags.file) { if (text) fail('글은 인자나 --file 가운데 하나로 준다', 2); try { text = fs.readFileSync(path.resolve(String(flags.file)), 'utf8'); } catch (e) { fail(`--file을 읽지 못했다: ${e.message}`, 2); } }
    if (!text.trim()) fail('보낼 글을 준다: atrium prompt <이름> "<할 일>"', 2);
    if (flags.now && flags.wait) fail('--now와 --wait는 함께 쓸 수 없다(--now는 받는 쪽의 지금 턴에 넣어 짝지을 답이 없다). 답을 받으려면 --wait만, 일하는 중에도 바로 알리려면 --now만 준다.', 2); // P143
    r = await call('prompt', { name, text, wait: !!flags.wait, ...(flags.now ? { now: true } : {}), timeoutMs }, flags.wait ? (timeoutMs || 100000) + WAIT_HTTP_EXTRA : 60000);
  } else if (cmd === 'wait') r = await call('turn', { name, timeoutMs }, (timeoutMs || 100000) + WAIT_HTTP_EXTRA);
  else {
    const lines = flags.lines != null ? Number(flags.lines) : null;
    if (flags.lines != null && !(lines > 0)) fail(`--lines는 줄 수다: ${flags.lines}`, 2);
    r = await call('read', { name, lines }, 30000);
  }
  { const want = terminalSessionVar(); if (r.board && want && r.board.terminalSession !== want) fail(`다른 보드에서 응답했습니다 (${r.board.terminalSession}, 기대 ${want})`); }
  const x = r.result;
  const turn = cmd === 'wait' ? x : x && x.turn;
  const code = r.error ? 1 : turn ? turnExit(turn.status) : x && x.delivery && ['failed', 'cancelled'].includes(x.delivery.status) ? 1 : 0;
  process.exitCode = code; // 출력을 다 쓴 뒤 끝나게 exit를 부르지 않는다(파이프 출력)
  if (flags.json) return say(JSON.stringify(x ?? { error: r.error }, null, 2));
  if (r.error) fail(`${cmd === 'prompt' ? '보내지 않았다' : cmd === 'wait' ? '기다리지 않았다' : '읽지 않았다'}(${r.error.code}): ${r.error.message}`);
  if (cmd === 'read') return printRead(x);
  if (cmd === 'prompt') printDelivery(x);
  if (turn) printTurn(x, turn);
  else if (cmd === 'prompt' && flags.now) say(`--now로 보냈으니 기다리지 않는다. 화면 보기: ${x.next.read}`); // P143: 밀어 넣기는 기다리지 않는다(한 길로)
  else if (cmd === 'prompt') say(`끝나기 기다리기: ${x.next.wait} · 화면 보기: ${x.next.read}`);
}
// 기다린 결과의 종료 코드: 기다리는 시간이 끝남 3, 글이 들어가지 않음·받는 세션이 끝남 1
function turnExit(status) { return status === 'timeout' || status === 'interrupted' ? 3 : ['failed', 'closed', 'exited', 'aborted'].includes(status) ? 1 : 0; }
const REASON = {
  working: (n) => `@${n}는 일하는 중이다. 보드가 이번 턴이 끝나면 넣는다(대기열, 지금 턴은 끊지 않는다). 진행이 궁금하면 글을 보내지 말고(턴이 하나 더 든다) atrium read ${n}로 화면을 본다`,
  waiting: (n) => `@${n}는 사람의 답을 기다린다. 보드가 사람이 답한 뒤 넣는다. 대신 답하지 않는다. 사용자에게 "보드에서 @${n}에 답해 주세요"라고 알린다`,
  trust_wait: (n) => `@${n}는 신뢰 질문에서 멈춰 있다. 보드가 사람이 답한 뒤 넣는다. 사용자에게 "보드에서 @${n} 카드의 신뢰 질문에 답해 주세요"라고 알린다`,
  user_typing: (n) => `사람이 @${n}의 터미널에 치는 중이다. 보드가 멈춘 뒤 넣는다`,
  // P139: 쓰다 만 글은 비키고 보낸다. 이 까닭은 입력 칸을 아직 비우지 못했을 때(또는 일하는 중에 바로 넣기를 못 할 때)뿐이다
  draft: (n) => `@${n}의 입력 칸에 글이 있어 보드가 아직 넣지 못했다(지시가 그 글과 함께 제출되지 않게). 보드가 그 칸을 비키고 곧 넣는다. 다시 보내지 않는다`,
  sleeping: (n) => `@${n}는 잠들어 있다. 보드가 깨운 뒤 넣는다`,
  starting: (n) => `@${n}는 뜨는 중이다. 준비되면 보드가 넣는다`,
};
// P128: 받는 쪽 입력 칸에 사람이 쓰다 만 글이 있어 잠시 비키고 보냈다(되돌리기 결과는 전달 기록의 까닭)
const DRAFT_NOTE = {
  draft_moved: '입력 칸에 쓰다 만 글이 있어 잠시 비키고 지시만 제출했다. 보드가 그 글을 입력 칸에 되돌린다.',
  draft_restored: '입력 칸에 쓰다 만 글이 있어 잠시 비키고 지시만 제출한 뒤 되돌렸다.',
  draft_partial: '입력 칸에 쓰다 만 글이 있어 잠시 비키고 지시만 제출한 뒤 화면에 보이던 대로 되돌렸다(접힌 붙여넣기 같은 원래 글은 보드 기록 delivery_draft에 있다).', // P139
  draft_stashed: '입력 칸에 쓰다 만 글이 있어 잠시 비키고 지시만 제출했다. 그 글은 Claude Code가 쥐고 있다(빈 입력 칸에서 Ctrl+S로 꺼낸다).',
  draft_held: '입력 칸에 쓰다 만 글이 있어 잠시 비키고 지시만 제출했지만 되돌리지 못했다. 그 글은 보드 기록(delivery_draft)에 있다. 사용자에게 알린다.',
};
// P126: 받는 쪽 입력 칸에 다른 글이 남아 보낸 글이 제출되지 않았다(판은 사람의 글일 수 있어 지우지 않는다)
const boxOther = (n, next, id) => `@${n}의 입력 칸에 다른 글이 남아 있어 보낸 글이 제출되지 않았다${id ? `(${id})` : ''}. 보드가 그 글을 지우지 않는다. 사용자에게 "보드에서 @${n}의 입력 칸을 확인하고 Enter를 눌러 주세요"라고 알린다. 화면 보기: ${next.read}`;
function printDelivery(x) {
  const d = x.delivery || {};
  const id = `전달 ${x.deliveryId}`;
  if (d.reason === 'duplicate') return say(`@${x.name}에게 같은 글을 이미 보냈다(${id}, ${d.status === 'confirmed' ? '그 일을 하는 중' : '대기열에 있음'}). 다시 넣지 않았다(두 번 하면 토큰이 두 배로 든다). 결과 기다리기: ${x.next.wait}`);
  if (x.woke) say(`@${x.name}는 잠들어 있어 보드가 깨웠다(같은 대화로 이어 간다).`);
  if (d.how === 'typed' && ['confirmed', 'sent', 'sending'].includes(d.status)) say(`@${x.name}는 일하는 중이라 Claude Code의 대기 메시지로 바로 넣었다(지금 턴 안에서 읽는다, ${d.status === 'confirmed' ? '들어감' : '들어갔는지 확인하는 중'}, ${id}).${DRAFT_NOTE[d.reason] ? ` ${DRAFT_NOTE[d.reason]}` : ''}`); // P143: --now
  else if (d.status === 'confirmed') say(`@${x.name}에게 보냈다(들어감, ${id}).${DRAFT_NOTE[d.reason] ? ` ${DRAFT_NOTE[d.reason]}` : ''}`);
  else if (d.status === 'sent' || d.status === 'sending') say(`@${x.name}에게 넣었다(들어갔는지 확인하는 중, ${id}).`);
  else if (d.status === 'queued') say(`${(REASON[d.reason] || ((n) => `아직 넣지 못했다(${d.reason || '대기'}). 보드가 다시 넣는다`))(x.name)} (${id}).${d.how === 'queue' && d.reason === 'working' ? ' --now로 바로 넣지 못했다(판이 띄운 Claude Code가 아니거나 입력 칸을 읽지 못했다). 판 대기열에 두었다.' : ''}`);
  else if (d.status === 'unconfirmed' && d.reason === 'input_box_other') fail(boxOther(x.name, x.next, id));
  else if (d.status === 'unconfirmed') say(`@${x.name}에게 넣었지만 들어갔는지 확인하지 못했다(${id}). 화면 보기: ${x.next.read}`);
  else if (d.status === 'failed' || d.status === 'cancelled') fail(`@${x.name}에게 보낸 글이 들어가지 않았다(${d.status}${d.reason ? `: ${d.reason}` : ''}, ${id}).`);
}
function printAnswer(x, a, label = '마지막 답') {
  if (!a || !a.text) return say(`  (${label} 없음. 화면 보기: ${x.next.read})`);
  say(`--- @${x.name}의 ${label}(${a.source === 'hook' ? 'Claude Code가 준 답' : '보드가 화면에서 고른 답'}${a.clipped ? ', 앞부분만' : ''}) ---`);
  say(a.text.replace(/\s+$/, ''));
  say('---');
}
function printTurn(x, t) {
  const n = x.name;
  switch (t.status) {
    case 'done': say(`@${n}: 턴이 끝났다(${secs(t.ms)} 기다림).`); printAnswer(x, t.answer); break;
    case 'error': say(`@${n}: 턴이 오류로 끝났다${t.error ? `(${t.error.type}: ${t.error.message || ''})` : ''}.`); printAnswer(x, t.answer); break;
    case 'idle': say(`@${n}: 지금 일하지 않는다(기다릴 턴 없음, 상태 ${t.state}).`); printAnswer(x, t.answer); break;
    case 'sleeping': say(`@${n}: 잠들어 있다(기다릴 턴 없음). 시키면 보드가 깨운 뒤 넣는다.`); printAnswer(x, t.answer); break;
    case 'waiting': say(`@${n}: 사람의 답을 기다린다${t.ask && t.ask.summary ? `(${t.ask.summary})` : ''}. 대신 답하지 않는다. 사용자에게 "보드에서 @${n}에 답해 주세요"라고 알린다. 답한 뒤 다시 기다리기: ${t.next.wait}`); break;
    case 'timeout': say(`@${n}: 아직 일하는 중이다(${secs(t.ms)} 기다림, 상태 ${t.state}). 일은 계속된다. 다시 기다리기: ${t.next.wait}`); break;
    case 'interrupted': say(`@${n}: 사람이 이 턴을 멈췄다(Esc·중지 단추). 끝난 결과가 아니다(마지막 답은 옛 턴 것이라 주지 않는다). 같은 일을 다시 보내거나 끄지 않는다. 사람이 이어 가게 하면(continue 등) 그 턴의 답을 받는다: ${t.next.wait}. 오래 멈춰 있으면 사용자에게 이어 갈지 묻는다`); break;
    case 'unconfirmed':
      if (t.delivery && t.delivery.reason === 'input_box_other') fail(boxOther(n, t.next, t.delivery.deliveryId ? `전달 ${t.delivery.deliveryId}` : ''));
      say(`@${n}: 넣은 글이 들어갔는지 확인하지 못했다. 화면 보기: ${t.next.read}`); printAnswer(x, t.answer); break;
    case 'failed': fail(`@${n}에게 보낸 글이 들어가지 않았다${t.delivery ? `(${t.delivery.status}${t.delivery.reason ? `: ${t.delivery.reason}` : ''})` : ''}.`); break;
    default: fail(`@${n}: ${t.status}(상태 ${t.state}). 받는 세션이 떠 있지 않다. 지금 연결: atrium me`);
  }
}
function printRead(x) {
  if (x.text != null) { say(`@${x.name} (${x.kind}, ${x.state}) 화면 최근 ${x.lines}줄:`); say(x.text); return; }
  say(`@${x.name} (${x.kind}, ${x.state}): ${x.why === 'sleeping' ? '잠들어 있어 화면이 없다' : `화면을 읽지 못했다(${x.why})`}.`);
  printAnswer(x, x.answer);
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
  // P116: 이름은 보드의 세션 이름(atrium prompt|wait|read가 받는다). 에이전트 주소·패널은 보이지 않는다(--json에는 남는다)
  say(`나: @${m.name} (${m.kind}) · 워크스페이스 ${m.workspace || '-'}${m.worktree ? ` · 워크트리 ${m.worktree}` : ''}${m.branch ? ` · 브랜치 ${m.branch}` : ''}`);
  const p = x.parent;
  const src = (s) => (s === 'user' ? ' · 사람이 정함' : s === 'agent' ? ' · 에이전트가 정함' : '');
  // P156: 상위(너를 하위로 둔 세션)·동료·하위·독립. 끝나면 상위에게 보고, 동료와는 공유
  if (!p) say('상위: 없음');
  else if (p.closed) say(`상위: @${p.name} (닫힘)${p.role ? ` — 너는 @${p.name}의 ${p.role}${p.order ? ` ${p.order}` : ''}` : ''}`);
  else say(`상위: @${p.name} (${p.state})${p.role ? ` — 너는 @${p.name}의 ${p.role}${p.order ? ` ${p.order}` : ''}` : ''}${src(p.source)}${p.head ? '. 너는 헤드로 떴다. 첫 요청 뒤 보드가 부모 관계를 뗀다' : ''}. 끝나면 @${p.name}에게 보고한다${last(p.last)}`);
  const peers = x.peers || [], indep = x.independent || [];
  if (peers.length) { say(`동료 ${peers.length}명(하위가 아니다. 필요한 것을 주고받고 끝나면 결과를 공유한다):`); for (const c of peers.slice(0, 10)) say(`  @${c.name} · ${c.state}${c.spawnedBy ? ' · 너를 띄운 세션' : c.spawned ? ' · 네가 띄움' : ''}${src(c.source)}${last(c.last)}`); }
  if (!x.children.length) say('하위 세션: 없음');
  else {
    say(`하위 세션 ${x.children.length}개:`);
    for (const c of x.children.slice(0, 10)) say(`  @${c.name} ${c.role || '-'}${c.order ? ` ${c.order}` : ''} · ${c.state}${c.state === 'sleeping' ? '(atrium prompt하면 보드가 깨운다)' : ''}${c.worktree ? ` · 워크트리 ${c.worktree}` : ''}${last(c.last)}`);
    if (x.children.length > 10) say(`  …외 ${x.children.length - 10}개(atrium children)`);
  }
  if (indep.length) say(`독립(서로 보고하거나 맡기지 않는다): ${indep.slice(0, 10).map((c) => `@${c.name} ${c.state}${c.spawnedBy ? '(너를 띄운 세션)' : c.spawned ? '(네가 띄움)' : ''}`).join(', ')}`);
  if (x.roles.length) {
    say('역할 연결:');
    for (const r of x.roles.slice(0, 8)) say(`  ${r.dir === 'out' ? `너의 ${r.role}은 @${r.name}` : `너는 @${r.name}의 ${r.role}`} (${r.state})${last(r.last)}`);
  }
  say(`일 시키기: ${x.commands.prompt} · 끝나기 기다리기: ${x.commands.wait || 'atrium wait <이름>'} · 화면 읽기: ${x.commands.read}`);
  say('이것이 보드의 지금 기록이다. 예전 알림과 다르면 이것을 믿는다.');
}
// P156: atrium relate
const REL_WORD = { sub: '하위', peer: '동료', none: '독립', auto: '자동' };
function printRelate(x) {
  const e = x.effective || {};
  const now = e.relation === 'sub' ? (e.up === x.a ? `@${x.b}는 너의 하위 워커다` : `너는 @${x.b}의 하위 워커다`) : e.relation === 'peer' ? `@${x.b}와 너는 동료다` : `@${x.b}와 너는 독립이다`;
  say(`관계를 바꿨다: ${x.before ? `${REL_WORD[x.before.relation]}(${x.before.source === 'auto' ? '자동' : x.before.source === 'user' ? '사람' : '에이전트'})` : '없음'} → ${REL_WORD[x.relation]}. 지금: ${now}${x.relation === 'auto' ? '(자동)' : ''}.`);
  say(`보드가 @${x.b}에게 짧게 알린다. 지금 연결: atrium me`);
}
// P41: atrium models
function printModels(x) {
  const by = (src) => x.entries.filter((e) => e.source === src);
  // macOS 판: 기본을 맨 위에. 사용자가 모델을 말하지 않았으면 목록을 고르지 않고 이 기본으로 띄운다
  const d = x.defaults || {};
  if (d.claude || d.codex || d.effort) {
    say(`기본(--model·--launcher를 빼면): Claude Code ${d.claude || '부모의 모델'}, Codex ${d.codex || '부모의 모델'}, 추론 ${d.effort || '부모의 것'}. 사용자가 모델을 말하지 않았으면 이 기본으로 띄운다(모델 옵션 없이 atrium child <이름>).`);
    say('추론만 일에 맞춘다: 설계·디버깅·리뷰는 기본, 범위가 분명한 구현은 --effort medium, 기계적인 조각은 --effort low.');
    say('');
  }
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
    const label = `연결 ${g.connection || g.url}(${g.url}${g.protocol ? `, ${g.protocol}` : ''})`; // P115: 연결마다
    if (!g.ok) { say(`${label}${g.host ? `, 런처 ${g.host}` : ''}: 닿지 않는다(${g.why}). 그 모델은 지금 띄우지 못한다`); continue; }
    const list = x.entries.filter((e) => e.source === 'gateway' && e.gateway === g.url && (e.connection || null) === (g.connection || null));
    say(`${label}의 모델 ${list.length}개${g.host ? `(런처 ${g.host}로 띄운다)` : ''}${flags.all ? ':' : `. 목록: atrium models --all`}`);
    if (!flags.all) continue; // macOS 판: 연결 모델 목록은 길어(약 1.3KB) 물을 때만
    for (const e of list) say(`  ${e.label || e.model}
    ${e.command}`);
  }
  say('');
  say('사용자가 모델을 말로 하면(예: "glm flash") --model에 그 말을 그대로 줘도 보드가 이 목록에서 푼다. 여럿이 맞으면 보드가 후보를 돌려준다.');
}
main().catch((e) => fail(e.message));
