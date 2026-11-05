// 가지 펼치기(ARCH 4절 K, P8): 판이 띄운 세션이 부르는 하위 세션 명령(atrium child, atrium children, atrium child-kill. 옛 이름 mtask도 같다).
// backend.mjs에는 이 파일을 부르는 몇 줄만 둔다(attachBranch, onHttp, spawn의 설정 파일·자리·부모, summary).
//
// - 판을 찾아가기(K1): 판은 세션 설정 파일의 env로 판의 값(프로필, herdr 세션, 포트, 데이터 폴더)과 그 세션의 ID, 그 세션만의 토큰을 넘긴다.
//   명령은 판 플러그인의 bin/atrium과 별칭 bin/mtask(Bash 도구 PATH에 오른다)이고, node로 backend/bin/atrium-child.mjs를 부른다. 사용자의 PATH와 설정 파일은 고치지 않는다.
// - 할 수 있는 일(보안): 명령은 판의 API 토큰(backend.json)을 쓰지 않는다. 세션 토큰(판 API 토큰과 세션 ID의 HMAC)으로 POST /branch/*만 부르고,
//   백엔드는 부르는 세션을 부모로 정해 그 세션의 하위 세션 만들기·목록·끄기만 한다. 다른 판 API는 지금처럼 승인 카드로 묻는 atrium CLI(판 API 토큰)로만 된다.
// - 하위 세션(K1): Backend.spawn으로 띄우는 정식 판 세션(hook, 스킬 플러그인, 짧은 안내, 권한 모드, herdr 이름, 이어 가기 등록). 부모의 폴더·모델·노력 수준·권한 모드·그룹을 물려받는다.
// - 상한(K3): 하위 세션 수, 깊이, 판 전체 상한과 동시 요청 예약을 유지한다. 자기 자손이 아니면 끄기를 not_parent로 거부한다. 고리는 depthOf가 끊는다.
// - 신뢰 관문(P36): 신뢰를 받지 않은 저장소의 --worktree는 claude -w가 신뢰 대화상자 없이 바로 끝난다. 그래서 먼저 그 저장소에서 claude를 띄워 신뢰 질문을 노드에 보이고,
//   사람이 답해 ready가 되면 같은 패널·같은 세션 ID로 claude -w를 다시 띄운다. 그동안 판의 전달(--prompt)은 멈춰 둔다(passGate).
// - 나무 자리(K4): 새 하위 세션은 부모 오른쪽 열에, 형제는 위아래로 쌓는다(새 노드를 놓을 때만). 다른 워크스페이스면 그 영역의 빈자리.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { workspaceOf, gitProbe } from './git.mjs';
import { ROLE_RE } from './links.mjs';
import { SIZE_STEPS, GAP, REGION_GAP, overlaps, regionRect } from './canvas.mjs';
import { canvasItems, regions, areaOfNode } from './canvas-ops.mjs';
import { parseArea, wsOfArea } from './worktree-areas.mjs'; // P27
import { deriveState, isModelError } from './state.mjs';
import { EFFORTS, DEFAULTS } from './settings.mjs';
import { clip } from './text.mjs';
import { BACKEND_ROOT } from './config.mjs';
import { predictTrust, repoHasCommit, buildStartArgs } from './launch.mjs';
import { harnessOf, joinArgs } from './launchers.mjs'; // P41
import { buildCatalog, resolveModel, gatewaysOf, fetchGatewayModels, candidateLines, describeEntry, launcherRef } from './models.mjs'; // P41
import { baseUrlOf, proxyEnv } from './deepseek.mjs'; // P41

export const DEFAULT_ROLE = '워커';
export const CHILD_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/; // herdr 에이전트 이름 규칙과 같다(herdr --skill)
export const WORKTREE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,511}$/;
export const CHILD_SIZE = 'small'; // H7 정리처럼 받는 쪽은 작게(480×300). 사람이 크기를 바꾸면 그대로 둔다
const READY_WAIT_MS = 75000; // atrium child가 하위 세션이 준비되기를 기다리는 시간. Claude Code Bash 도구의 기본 시간 제한(2분) 안쪽
const SUBMIT_WAIT_MS = 20000; // --prompt를 준 경우 첫 지시가 들어가 일을 시작하기까지 더 기다리는 시간
const CHILD_WAIT_MS = 100000; // P36: atrium child-wait 한 번의 최대(Bash 도구 2분 안쪽). 더 기다리려면 다시 부른다
const GATE_TRUST_WAIT_MS = 5000; // P36: 신뢰를 받은 뒤 ~/.claude.json에 쓰이기까지 기다리는 시간
const BODY_MAX = 256 * 1024;
const CATALOG_TTL_MS = 20000; // P41: 게이트웨이 모델 목록을 다시 읽기 전까지
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function apiError(code, message, extra = {}) { return Object.assign(new Error(message), { code }, extra); }

// ---------- 승인 규칙(K2) ----------
// 판이 띄운 세션의 설정 파일에 넣어 묻지 않고 돌게 하는 것: 하위 세션 명령 셋, herdr 일 시키기(prompt, wait)와 답 읽기(read). 다른 atrium 명령과 herdr 명령은 넣지 않는다.
// P18: 새 이름 atrium과 옛 이름 mtask(P18 전에 띄운 세션의 스킬 글이 말한다)를 함께 넣는다
// Claude Code는 $변수, $(…) 같은 셸 확장이 든 명령은 규칙과 상관없이 묻는다(P4). 스킬은 그런 모양을 쓰지 말라고 한다
export const BRANCH_ALLOW = [
  ...['atrium', 'mtask'].flatMap((c) => [`Bash(${c} child:*)`, `Bash(${c} child *)`, `Bash(${c} children:*)`, `Bash(${c} children)`, `Bash(${c} child-kill:*)`, `Bash(${c} child-kill *)`, `Bash(${c} wake:*)`, `Bash(${c} wake *)`, `Bash(${c} child-wait:*)`, `Bash(${c} child-wait *)`, `Bash(${c} models)`, `Bash(${c} models:*)`, `Bash(${c} models *)`]), // P21: wake, P36: child-wait, P41: models
  'Bash(herdr agent prompt:*)', 'Bash(herdr agent prompt *)', 'Bash(herdr agent wait:*)', 'Bash(herdr agent wait *)', 'Bash(herdr agent read:*)', 'Bash(herdr agent read *)',
  ...['atrium', 'mtask'].flatMap((c) => [`PowerShell(${c} child *)`, `PowerShell(${c} children)`, `PowerShell(${c} children *)`, `PowerShell(${c} child-kill *)`, `PowerShell(${c} wake *)`, `PowerShell(${c} child-wait *)`, `PowerShell(${c} models)`, `PowerShell(${c} models *)`]),
  'PowerShell(herdr agent prompt *)', 'PowerShell(herdr agent wait *)', 'PowerShell(herdr agent read *)',
];

// ---------- 나무 계산(순수 함수) ----------
// rowOf(id) → { parentSessionId } | null. 사람이 띄운 세션(부모 없음)이 1단계. 닫힌 중간 세션도 따라간다. 고리는 끊는다
export function depthOf(id, rowOf, max = 64) {
  let d = 1; const seen = new Set([id]);
  let cur = rowOf(id);
  while (cur && cur.parentSessionId && !seen.has(cur.parentSessionId) && d < max) { seen.add(cur.parentSessionId); d++; cur = rowOf(cur.parentSessionId); }
  return d;
}
// id가 ancestorId의 자손인가(자기 자신은 아니다)
export function isDescendant(id, ancestorId, rowOf) {
  if (!id || !ancestorId || id === ancestorId) return false;
  const seen = new Set([id]);
  let cur = rowOf(id);
  while (cur && cur.parentSessionId && !seen.has(cur.parentSessionId)) {
    if (cur.parentSessionId === ancestorId) return true;
    seen.add(cur.parentSessionId); cur = rowOf(cur.parentSessionId);
  }
  return false;
}
// rootId 아래의 자손(rows: [{ sessionId, parentSessionId }]). 깊은 것부터(끄는 순서). rel은 rootId에서 몇 단계 아래인지
export function descendantsOf(rootId, rows) {
  const kids = new Map();
  for (const r of rows) { if (!r.parentSessionId) continue; if (!kids.has(r.parentSessionId)) kids.set(r.parentSessionId, []); kids.get(r.parentSessionId).push(r); }
  const out = []; const seen = new Set([rootId]);
  const walk = (id, rel) => { for (const k of kids.get(id) || []) { if (seen.has(k.sessionId)) continue; seen.add(k.sessionId); out.push({ ...k, rel }); walk(k.sessionId, rel + 1); } };
  walk(rootId, 1);
  return out.sort((a, b) => b.rel - a.rel);
}
export function checkLimits({ parentDepth, children, total, limits }) {
  if (parentDepth + 1 > limits.branchMaxDepth) return { code: 'too_deep', limit: limits.branchMaxDepth, now: parentDepth, message: `깊이 상한(${limits.branchMaxDepth}단계)에 닿았다. 너는 ${parentDepth}단계라서 하위 세션을 더 만들지 않는다. 직접 하거나 너를 만든 세션에게 맡긴다` };
  if (children >= limits.branchMaxChildren) return { code: 'too_many_children', limit: limits.branchMaxChildren, now: children, message: `세션 하나의 하위 세션 상한(${limits.branchMaxChildren}개)에 닿았다. 지금 ${children}개. 있는 하위 세션에 나눠 시키거나, 사람이 끄라고 한 하위 세션을 끈 뒤 만든다` };
  if (total >= limits.branchMaxTotal) return { code: 'board_full', limit: limits.branchMaxTotal, now: total, message: `판 전체 하위 세션 상한(${limits.branchMaxTotal}개)에 닿았다. 지금 ${total}개. 있는 하위 세션에 나눠 시키거나 직접 한다` };
  return null;
}
// 하위 세션 이름. want가 있으면 그대로(herdr 이름 규칙), 없으면 <부모>-w<n>(부모 이름이 규칙에 안 맞으면 w<n>)
export function childName({ want, parentName, taken }) {
  if (want) {
    if (!CHILD_NAME_RE.test(want) || want === 'all') throw apiError('bad_request', `하위 세션 이름은 영문 소문자로 시작하고 소문자·숫자·-·_ 만, 32자까지: ${want}`);
    if (taken.has(want)) throw apiError('name_taken', `판에 이미 있는 이름: ${want}. 다른 이름을 준다`);
    return want;
  }
  const p = String(parentName || '').toLowerCase();
  const base = CHILD_NAME_RE.test(`${p}-w`) ? `${p.slice(0, 26)}-w` : 'w';
  for (let i = 1; i < 1000; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  throw apiError('name_taken', '이름을 짓지 못했다');
}
// K4: 부모 오른쪽 열에 형제끼리 위아래로. parent·siblings는 노드 사각형, fits(c)는 겹침과 영역 규칙을 본다.
// 부모와 열 사이 200은 선 위의 역할·상태 글이 접히지 않는 너비(창 labelFit: 172 이상). 열에 이미 형제가 있으면 그 맨 아래 다음 칸부터, 없으면 부모 윗변과 같은 높이부터 아래로. 막히면 한 열 더 오른쪽. 끝내 없으면 null(빈자리 규칙으로 넘긴다)
// 열 하나는 부모 높이의 약 두 배까지만 쌓는다(P9: 한 열에 12개까지 쌓아 영역이 좁고 길어졌다). rows를 주면 그 값
// P36: 설정에서 형제 수를 늘린 경우에도 자리 배치를 유지한다. 형제가 많으면 열의 칸 수를 √(형제 수)까지 늘려 한쪽으로만 길어지지 않게 하고, 열은 64개까지 본다(옛 6열이면 24개 뒤로는 나무 밖 빈자리로 갔다)
export function childSlot({ parent, siblings = [], size, fits, gapX = 200, gap = GAP, rows = null, cols = 64 }) {
  if (!parent) return null;
  rows ??= Math.max(2, Math.round((2 * parent.h + gap) / (size.h + gap)), Math.ceil(Math.sqrt(siblings.length + 1)));
  let x = parent.x + parent.w + gapX;
  const yEnd = parent.y + rows * (size.h + gap); // 열의 아래 끝(부모 윗변에서 rows칸)
  for (let c = 0; c < cols; c++) {
    const inCol = siblings.filter((s) => Math.abs(s.x - x) < size.w / 2);
    let y = inCol.length ? Math.max(...inCol.map((s) => s.y + s.h)) + gap : parent.y;
    for (; y + size.h + gap <= yEnd; y += size.h + gap) {
      const cand = { x: Math.round(x), y: Math.round(y), w: size.w, h: size.h };
      if (fits(cand)) return cand;
    }
    x += Math.max(size.w, ...siblings.map((s) => s.w)) + gap;
  }
  return null;
}
// P36: 하위 세션이 신뢰 질문에서 멈췄을 때 부모가 사람에게 할 한 문장
// P41: Claude Code의 StopFailure(model_not_found)는 글 없이 온다. 판이 부모에게 보일 까닭
export const modelErrorText = (model) => `쓰지 못한 모델: ${model || '(기본)'}. 없는 모델이거나, 이 길(게이트웨이 env 없이 등)로는 닿지 않는 모델이다`;
export const trustSentence = (name) => `판에서 @${name} 노드의 신뢰 질문에 답해 주세요.`;
// 부모가 받는 알림 글(명령의 응답에 넣는다. F2 연결 알림과 같은 내용)
export function childNotice({ role, agentName, paneId, kind = 'claude', depth }) {
  return [
    `[Atrium 판] 하위 세션: herdr 에이전트 \`${agentName}\`(패널 ${paneId}, 종류 ${kind}, ${depth}단계)가 너의 "${role}"이다.`,
    `일 시키기: herdr agent prompt ${agentName} "<할 일>" --wait --timeout 600000`,
    `답 읽기: herdr agent read ${agentName} --source recent-unwrapped --lines 80`,
    `끄기(사람이 끄라고 할 때만): atrium child-kill ${agentName}`,
  ].join('\n');
}

// ---------- 플러그인에 넣는 것(K2) ----------
// P36: 일 맡기기 스킬(delegate)을 판에서 일하는 법 전체를 담은 atrium 스킬로 넓혔다. 이미 돌고 있는 세션은 시작 때 본 목록의 옛 이름 delegate를 부르므로
// skills/delegate/SKILL.md에도 같은 글을 이름만 바꿔 쓴다(그 세션은 새로 생긴 스킬 atrium을 목록에 갖고 있지 않다)
export const SKILL_NAME = 'atrium';
export const LEGACY_SKILL_NAME = 'delegate';
const SKILL_BODY = `# Atrium 판에서 일하기: 워커로 나눠 맡기기

너는 \`atrium\` 명령으로 워커(하위 세션)를 만든다. 워커는 판의 정식 세션이다. 판에 노드로 보이고, 너와 역할 선으로 이어지고, 너의 폴더·모델·노력 수준·권한 모드를 물려받는다. 워커도 같은 방법으로 다시 펼친다. 설정의 워커 수·깊이·전체 상한을 지킨다. 상한에 닿으면 있는 워커에게 나눠 시키거나 직접 한다.

## 쓰는 때

- 사용자가 워커, 하위 세션, 병렬, 나눠 맡기기, 워크트리를 말할 때.
- 사용자가 말하지 않아도, 일이 서로 기다리지 않는 조각 여럿(파일·모듈·조사 주제별)으로 나뉘면 네가 판단해 쓴다. 한 조각이 작거나 조각끼리 계속 맞춰야 하면 직접 한다.

## 순서

1. 만들기(조각 하나에 워커 하나): \`atrium child <이름> --prompt "<지시>"\`
   - 이름은 사람이 판에서 보고 무슨 일을 맡은 워커인지 알 수 있게 네가 생각해서 짓는다. 맡긴 일이나 역할을 짧게 말한다(예: p31-worker, api-tests, reviewer, ko-copy, login-bug). w1·ds1 같은 번호 이름은 일이 정말 하찮을 때만 쓴다. 예를 외우지 말고 이번 일에 맞게 짓는다.
   - 규칙: 영문 소문자로 시작, 소문자·숫자·-·_ 만, 32자까지, 판 전체에서 하나. 겹친다는 답(\`name_taken\`)이 오면 다른 이름으로 다시 짓는다.
   - 워커가 준비되고 지시가 들어가면 돌아온다. 응답에 herdr 이름과 다음에 칠 명령이 있다.
   - 코드를 고치는 조각은 \`--worktree <이름>\`을 붙인다. Claude Code가 \`claude -w\`로 \`.claude/worktrees/<이름>\`과 브랜치 \`worktree-<이름>\`을 만든다. 손으로 \`git worktree add\`를 하거나 판 밖 형제 폴더를 만들지 않는다.
   - 다른 폴더는 \`--cwd C:/Workspace/x\`(슬래시로). 역할 이름 \`--role 리뷰어\`(기본 워커), 다른 종류 \`--kind codex\`.
   - 모델과 노력 수준은 조각에 맞게 고른다: 찾기·요약·단순 수정은 \`--model haiku\`나 \`--effort low\`, 설계·어려운 디버깅은 \`--effort high\`. 빼면 너의 것을 물려받는다.
   - 사용자가 모델을 말로 하면("deepseek flash", "opus", "gpt-6.1-sol") \`atrium models\`로 목록을 보고 가장 맞는 줄의 명령으로 띄운다. \`--model "deepseek flash"\`처럼 들은 말을 줘도 판이 푼다. 정확한 ID를 사용자에게 묻지 않고, 판이 후보 여럿을 돌려줄 때만 묻는다. 판의 워커 대신 너의 내부 하위 에이전트로 우회하지 않는다.
2. 지시 쓰는 법(\`--prompt\`나 \`herdr agent prompt\`의 글): 목표, 할 것, 손대지 말 것, 완료 기준, 끝났음을 알리는 법("끝나면 바꾼 파일과 결과를 다섯 줄로 답한다", 워크트리면 "자기 브랜치에 커밋하고 커밋 해시를 답한다"). 워커는 너의 대화를 모른다. 필요한 파일 경로와 사실을 글에 넣는다.
3. 기다리기: \`herdr agent wait <이름> --timeout 600000\`. 처음부터 시키지 않았으면 \`herdr agent prompt <이름> "<지시>" --wait --timeout 600000\`.
   - 여럿에게 함께 시킬 때는 한 응답에 Bash 호출을 여러 개 낸다(워커마다 하나).
4. 답 읽기: \`herdr agent read <이름> --source recent-unwrapped --lines 80\`. 목록·상태·마지막 답은 \`atrium children\`(\`--all\`이면 그 아래까지).
5. 모아 보고, 합치기: 워커마다 답을 확인하고(완료 기준을 채웠는지, 시험이 통과했는지) 정리해 사용자에게 보고한다. 워크트리 브랜치는 네가 합친다(\`git merge worktree-<이름>\`). 충돌이나 빠진 것은 그 워커에게 다시 시킨다.

## 신뢰 질문

- 응답이 \`needs_trust\`(신뢰 질문에서 멈춤)면 사용자에게 응답에 적힌 한 문장만 말한다. 예: "판에서 @wt1 노드의 신뢰 질문에 답해 주세요." 판 밖 터미널을 열라고 하지 않는다. 신뢰는 사람만 준다. 네가 키를 보내 답하지 않는다.
- 워크트리 워커는 사람이 답하면 판이 그 노드에서 워크트리로 다시 띄우고, \`--prompt\`의 지시는 그 뒤에 들어간다. 그동안 그 워커에게 herdr로 시키지 말고 \`atrium child-wait <이름>\`으로 기다린다.
- \`needs_commit\`이면 저장소에 커밋이 없는 것이다. 사용자에게 알리고, 첫 커밋을 만들라고 한 경우에만 만든다.

## 지킬 것

- 명령은 위 모양 그대로 한 줄씩 친다. \`$변수\`, \`$(…)\`, 파이프, \`&&\`, \`;\`를 섞지 않는다(섞으면 사람의 승인을 기다린다).
- herdr 명령에 \`--session\`, \`--machine\`, \`--remote\`를 붙이지 않는다. \`test "$HERDR_ENV"\` 확인은 하지 않는다(늘 herdr 안이다).
- 끝난 워커는 끄지 않고 둔다(사람이 나무와 결과를 본다). 사람이 끄라고 할 때만 \`atrium child-kill <이름>\`으로 끈다(그 아래도 함께, 자기 자손만).
- 워커가 권한을 묻고 멈추면(\`herdr agent prompt\`가 blocked) 대신 답하지 않는다. 사용자에게 "판에서 @이름의 승인 카드에 답해 주세요"라고 알린다.
- 잠든 워커는 \`atrium wake <이름>\`으로 깨운 뒤 시킨다.
- 워커가 모델 오류로 답하지 못하면(\`atrium children\`의 오류 줄) 사용자에게 알리고 \`atrium models\`의 다른 줄로 다시 띄운다.
`;
export function boardSkill(name = SKILL_NAME, limits = DEFAULTS) {
  const description = name === SKILL_NAME
    ? 'Atrium 판에서 일하는 법: 워커(하위 세션)를 만들어 일을 나눠 맡기고, 코드 조각은 워크트리에서 시키고, 답을 모아 합친다. 사용자가 워커, 하위 세션, 병렬, 나눠 맡기기, 워크트리, spawn workers, sub-sessions를 말할 때, 그리고 일이 서로 기다리지 않는 조각 여럿으로 나뉠 때 사용자가 말하지 않아도 쓴다. Atrium 판이 띄운 세션에서만 된다.'
    : 'atrium 스킬의 옛 이름(내용이 같다). 워커(하위 세션)를 만들어 일을 나눠 맡기고 답을 모아 온다. Atrium 판이 띄운 세션에서만 된다.';
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${SKILL_BODY}\n상한: 세션 하나에 하위 세션 ${limits.branchMaxChildren}개, 깊이 ${limits.branchMaxDepth}단계, 판 전체 ${limits.branchMaxTotal}개.\n`;
}
export const delegateSkill = (limits = DEFAULTS) => boardSkill(LEGACY_SKILL_NAME, limits); // P8 이름(시험과 옛 호출)
// 플러그인 bin/: Git Bash(Bash 도구)용 sh와 PowerShell·cmd용 .cmd. 이 판의 node와 명령 파일을 절대 경로로 부른다
// P18: atrium이 본 이름이고, 옛 이름 mtask도 같은 명령이다(P18 전에 띄운 세션의 스킬 글이 mtask child를 말한다)
export function childShims({ node = process.execPath, script = path.join(BACKEND_ROOT, 'bin', 'atrium-child.mjs') } = {}) {
  const fwd = (p) => p.replace(/\\/g, '/').replace(/["`$]/g, '\\$&');
  const out = {};
  for (const c of ['atrium', 'mtask']) {
    out[c] = `#!/bin/sh\n# Atrium 판(P8): 하위 세션 명령. ${c} child | children | child-kill | child-wait | wake | models 만 된다\nexec "${fwd(node)}" "${fwd(script)}" "$@"\n`;
    out[`${c}.cmd`] = `@echo off\r\nrem Atrium 판(P8): 하위 세션 명령. ${c} child ^| children ^| child-kill ^| child-wait ^| wake ^| models 만 된다\r\n"${node}" "${script}" %*\r\n`;
  }
  return out;
}

export function attachBranch(b, opts) { return new Branch(b, opts); }

export class Branch {
  constructor(b, { readyWaitMs = READY_WAIT_MS, submitWaitMs = SUBMIT_WAIT_MS, childWaitMs = CHILD_WAIT_MS, gateTrustWaitMs = GATE_TRUST_WAIT_MS, fetchModels = fetchGatewayModels } = {}) {
    this.b = b; this.readyWaitMs = readyWaitMs; this.submitWaitMs = submitWaitMs; this.childWaitMs = childWaitMs; this.gateTrustWaitMs = gateTrustWaitMs;
    this.fetchModels = fetchModels; this.gwCache = new Map(); // P41: 게이트웨이 주소 → { at, r }
    this.modelErrors = new Map(); // P41: 세션 ID → 마지막으로 알린 모델 오류(rt.lastError 객체. P55: 시각으로 가리면 같은 밀리초의 다음 오류를 놓친다)
    this.passing = new Set(); // P36: 신뢰 관문을 지나는 중인 세션 ID(claude -w로 다시 띄우는 중)
    this.info = new Map(); // 세션 ID → 하위 세션 기록(sessions.branch)
    this.closed = new Map(); // 닫힌 세션 ID → { parentSessionId, name }(깊이·자손을 셀 때 따라간다)
    this.pending = []; // 만드는 중인 하위 세션의 { parentId, name }(등록된 세션은 두 번 세지 않는다)
    this.pendingNames = new Set(); // 만드는 중인 하위 세션 이름(동시에 같은 이름을 짓지 않게)
    for (const r of b.store.branchRows()) {
      if (r.branch) this.info.set(r.sessionId, r.branch);
      if (r.closedAt) this.closed.set(r.sessionId, { parentSessionId: r.parentSessionId, name: r.name });
    }
    b.bus.on('closed', (s) => this.closed.set(s.sessionId, { parentSessionId: s.parentSessionId || null, name: s.name }));
    b.bus.on('session', (s, sum) => this.onSession(s, sum)); // P36: 신뢰 관문
    this.handlers = {
      'branch.tree': () => this.tree(),
      'branch.limits': () => this.limits(),
    };
  }

  // ---------- 판을 찾아가기, 승인 규칙 ----------
  token(sessionId) { return crypto.createHmac('sha256', this.b.apiToken).update(`branch:${sessionId}`).digest('hex'); }
  envFor(sessionId) {
    const c = this.b.cfg;
    return { ATRIUM_PROFILE: c.profile, ATRIUM_HERDR_SESSION: c.herdrSession, ATRIUM_PORT: String(c.port), ATRIUM_DATA_DIR: c.dataDir, ATRIUM_SESSION_ID: sessionId, ATRIUM_SESSION_TOKEN: this.token(sessionId) };
  }
  // writeSessionSettings에 더할 값
  settingsExtra(sessionId) { return { env: this.envFor(sessionId), allow: BRANCH_ALLOW }; }
  // writeBoardPlugin에 더할 것: 일 맡기기 스킬, atrium 명령(별칭 mtask)
  // P36: atrium 스킬과 옛 이름 delegate(같은 글)
  pluginExtra() { return { skills: { [SKILL_NAME]: boardSkill(SKILL_NAME, this.limits()), [LEGACY_SKILL_NAME]: boardSkill(LEGACY_SKILL_NAME, this.limits()) }, bin: childShims() }; }
  // P8 전에 띄운 판 세션의 설정 파일에도 env와 규칙을 더한다(이어 갈 때 다시 읽힌다). hook과 다른 규칙은 그대로
  // P18: 옛 이름의 env(MTASK_*)는 빼고 ATRIUM_*로 바꾼다(옛 데이터 폴더를 가리키는 값이 남지 않게)
  refreshSettings() {
    let n = 0;
    for (const s of this.b.sessions.values()) {
      if (!this.b.hooked(s) || !s.settingsPath || !fs.existsSync(s.settingsPath)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(s.settingsPath, 'utf8'));
        const env = this.envFor(s.sessionId);
        const kept = Object.fromEntries(Object.entries(j.env || {}).filter(([k]) => !k.startsWith('MTASK_')));
        const allow = [...new Set([...((j.permissions && j.permissions.allow) || []), ...BRANCH_ALLOW])];
        if (JSON.stringify(j.env || {}) === JSON.stringify({ ...kept, ...env }) && allow.length === ((j.permissions && j.permissions.allow) || []).length) continue;
        j.env = { ...kept, ...env }; j.permissions = { ...(j.permissions || {}), allow };
        fs.writeFileSync(s.settingsPath, JSON.stringify(j, null, 2)); n++;
      } catch (e) { this.b.log(`branch settings refresh failed ${s.name}: ${e.message}`); }
    }
    if (n) this.b.log(`branch: settings refreshed for ${n} session(s)`);
    return n;
  }
  limits() { return { ...DEFAULTS, ...(this.b.store.getMeta('settings') || {}) }; }
  // backend.spawn이 하위 세션을 등록할 때(첫 요약을 보내기 전)
  noteChild(sessionId, info) { this.info.set(sessionId, info); this.b.store.setBranch(sessionId, info); }

  // ---------- 나무 ----------
  rowOf = (id) => {
    const s = this.b.sessions.get(id);
    if (s) return { parentSessionId: s.parentSessionId || null, name: s.name };
    return this.closed.get(id) || null;
  };
  depth(id) { return depthOf(id, this.rowOf); }
  openChildren(parentId) { return [...this.b.sessions.values()].filter((x) => x.parentSessionId === parentId && this.info.has(x.sessionId)); }
  openTotal() { return [...this.b.sessions.values()].filter((x) => this.info.has(x.sessionId)).length; }
  // 세션 요약에 붙인다(창의 머리줄·사이드바·미션 맵)
  summaryExtra(s) {
    const info = this.info.get(s.sessionId) || null;
    const parentId = s.parentSessionId || null;
    const parent = parentId ? this.rowOf(parentId) : null;
    return { branch: { depth: this.depth(s.sessionId), parentSessionId: parentId, parentName: parent ? parent.name : null, parentOpen: !!(parentId && this.b.sessions.has(parentId)), child: !!info, role: info ? info.role : null, worktree: info ? info.worktree || null : null, gate: info && info.gate ? info.gate : null, children: this.openChildren(s.sessionId).length } };
  }
  tree() {
    const rows = [...this.b.sessions.values()].map((s) => ({ sessionId: s.sessionId, name: s.name, parentSessionId: s.parentSessionId || null, depth: this.depth(s.sessionId), child: this.info.has(s.sessionId), role: (this.info.get(s.sessionId) || {}).role || null, state: deriveState(s.rt).state, workspaceKey: s.workspaceKey || null }));
    return { limits: this.limits(), total: this.openTotal(), rows };
  }

  // K4: 하위 세션 노드 자리. backend.spawn이 부른다. 부모와 같은 워크스페이스면 부모 오른쪽 열, 아니면 null(그 워크스페이스의 빈자리 규칙)
  placeChild(parentId, wsKey) {
    const b = this.b;
    const parent = b.sessions.get(parentId);
    if (!parent || parent.workspaceKey !== wsKey) return null;
    const nodes = b.store.nodes();
    const pn = nodes.find((n) => n.session_id === parentId);
    if (!pn) return null;
    const size = SIZE_STEPS[CHILD_SIZE];
    const kidIds = new Set(this.openChildren(parentId).map((x) => x.sessionId));
    const siblings = nodes.filter((n) => kidIds.has(n.session_id));
    const all = canvasItems(b);
    const regs = regions(b, all);
    const ak = areaOfNode(b, parentId, all); // P27: 부모가 든 영역(워크트리 영역일 수 있다)
    const items = all.filter((i) => i.box !== ak); // P35: 워크트리 상자 안에 놓을 때 그 상자 자신은 피하지 않는다
    const own = items.filter((i) => i.ws === ak);
    const others = [...regs].filter(([k]) => wsOfArea(k) !== wsOfArea(ak)).map(([, r]) => r); // P35: 같은 리포의 영역(리포 영역, 상자)은 빼고. 상자 겹침은 settleRegions가 민다
    const free = (c) => !items.some((i) => overlaps(c, i, GAP - 1));
    const fits = (c) => free(c) && !others.some((r) => overlaps(regionRect([...own, c]), r, REGION_GAP / 2 - 1));
    // 옆 영역 때문에 자리가 없으면 노드끼리만 피해 나무 모양을 지킨다. 그때 생기는 영역 겹침은 spawn 뒤 settleRegions가 옆 영역을 밀어 푼다(P9)
    const at = childSlot({ parent: pn, siblings, size, fits }) || childSlot({ parent: pn, siblings, size, fits: free });
    return at ? { ...at, size: CHILD_SIZE, area: parseArea(ak).wt } : null;
  }

  // ---------- HTTP: 하위 세션 명령 ----------
  // POST /branch/child | /branch/children | /branch/kill. 머리글 X-MT-Session(부르는 세션 ID), Authorization: Bearer <세션 토큰>
  handleHttp(req, res) {
    const url = req.url.split('?')[0];
    if (req.method !== 'POST' || !url.startsWith('/branch/')) return false;
    const op = url.slice('/branch/'.length);
    const chunks = []; let size = 0, tooBig = false;
    req.on('data', (d) => { size += d.length; if (size > BODY_MAX) tooBig = true; else chunks.push(d); });
    req.on('end', async () => {
      const send = (status, obj) => { if (!res.headersSent) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); } };
      if (tooBig) return send(413, { error: { code: 'too_big', message: '요청이 너무 크다' } });
      let body = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { return send(400, { error: { code: 'bad_json', message: 'JSON이 아니다' } }); }
      const caller = this.auth(req.headers, op);
      if (caller.error) return send(caller.status, { error: caller.error });
      try {
        const result = await this.dispatch(op, caller.s, body, res);
        send(200, { result, board: { herdrSession: this.b.cfg.herdrSession, port: this.b.cfg.port } });
      } catch (e) {
        if (!e.code) this.b.log(`branch ${op} failed: ${e.stack}`);
        send(e.code === 'not_parent' ? 403 : e.code === 'not_found' ? 404 : 400, { error: { code: e.code || 'error', message: e.message, ...(e.limit ? { limit: e.limit, now: e.now } : {}), ...(e.candidates ? { candidates: e.candidates } : {}) } });
      }
    });
    return true;
  }
  auth(headers, op) {
    const sid = String(headers['x-mt-session'] || '');
    const s = this.b.sessions.get(sid);
    if (!s) return { status: 404, error: { code: 'not_on_board', message: `이 판(${this.b.cfg.herdrSession})에 없는 세션이다. 판이 띄운 세션에서만 부른다` } };
    const given = String(headers.authorization || '').replace(/^Bearer /, '');
    const want = this.token(sid);
    const ok = given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
    if (!ok) { this.b.store.addEvent(sid, 'branch_rejected', { op, why: 'bad token' }); return { status: 401, error: { code: 'bad_token', message: '세션 토큰이 맞지 않는다' } }; }
    const managedProvider = (['gemini', 'agy'].includes(s.kind) || (s.kind === 'codex' && s.rt?.codexIntegration)) && s.origin === 'board' && s.hookToken;
    if (!this.b.hooked(s) && !managedProvider) return { status: 403, error: { code: 'not_board_session', message: '판이 협업 설정을 연결한 세션만 하위 세션을 만든다' } };
    return { s };
  }
  dispatch(op, s, body, res) {
    if (op === 'child') return this.spawnChild(s, body, res);
    if (op === 'children') return this.listChildren(s, body);
    if (op === 'kill') return this.killChild(s, body);
    if (op === 'wake') return this.wakeAgent(s, body); // P21(D4)
    if (op === 'wait') return this.waitChild(s, body); // P36
    if (op === 'models') return this.listModels(s, body); // P41
    throw apiError('unknown_op', `모르는 명령: ${op}`);
  }

  refuse(parent, r, want) {
    this.b.store.addEvent(parent.sessionId, 'branch_refused', { code: r.code, reason: r.message, limit: r.limit, now: r.now, want: want || null });
    this.b.api.broadcast('branch.refused', { sessionId: parent.sessionId, name: parent.name, code: r.code, reason: r.message, limit: r.limit, now: r.now, want: want || null });
    this.b.log(`branch refused ${parent.name}: ${r.code} (${r.now}/${r.limit})`);
    throw apiError(r.code, r.message, { limit: r.limit, now: r.now });
  }

  // K1: 하위 세션 만들기. o: { name, prompt, role, cwd(절대 경로), worktree, model, kind, wait }
  async spawnChild(parent, o = {}, res = null) {
    const b = this.b;
    b.requireHerdr();
    // P21(D4): 잠든 자기 하위 세션의 이름이면 새로 만들지 않고 깨운다(첫 지시가 있으면 깬 뒤 보낸다)
    const asleep = o.name && [...b.sessions.values()].find((x) => x.name === String(o.name).replace(/^@/, '') && x.parentSessionId === parent.sessionId && (x.rt.sleep || (b.sleeper && b.sleeper.wakes.has(x.sessionId))));
    if (asleep) return this.wakeAgent(parent, { name: asleep.name, prompt: o.prompt });
    const role = o.role == null || o.role === '' ? DEFAULT_ROLE : String(o.role).trim();
    if (!ROLE_RE.test(role)) throw apiError('bad_request', '역할은 1~40자, 줄바꿈·따옴표·$·\\ 없이');
    if (o.kind === 'shell') throw apiError('bad_request', '하위 세션은 에이전트만 만든다(셸은 herdr pane split으로)');
    // P41: 무엇으로 띄우는가(호출자, 말로 한 모델 이름 풀기, 부모의 게이트웨이 물려받기)
    const route = await this.routeOf(parent, o);
    const kind = route.kind;
    const claude = kind === 'claude';
    if (kind === 'shell') throw apiError('bad_request', '하위 세션은 에이전트만 만든다(셸은 herdr pane split으로)');
    const pcwd = parent.rt.cwd && fs.existsSync(parent.rt.cwd) ? parent.rt.cwd : parent.cwd;
    const cwd = o.cwd ? path.resolve(pcwd, String(o.cwd)) : pcwd;
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw apiError('bad_request', `폴더가 없다: ${o.cwd}. Windows 경로는 슬래시로 쓴다(--cwd C:/Workspace/x). 따옴표 없는 백슬래시는 Bash가 지운다`);
    const worktree = o.worktree ? String(o.worktree) : null;
    if (worktree && !WORKTREE_RE.test(worktree)) throw apiError('bad_request', `워크트리 이름은 영문·숫자·.·-·_ 만: ${worktree}`);
    if (worktree && !claude) throw apiError('bad_request', '--worktree는 Claude Code(claude -w)만 된다');
    if (worktree && !(await gitProbe(cwd)).isRepo) throw apiError('bad_request', `--worktree는 git 저장소 안에서만 된다: ${cwd}`);
    // P36: 커밋이 없는 저장소는 워크트리를 만들 곳이 없다. 판과 명령은 빈 커밋을 대신 만들지 않는다
    if (worktree && !repoHasCommit(cwd)) throw apiError('needs_commit', `이 저장소(${cwd.split(path.sep).join('/')})에 커밋이 하나도 없어 워크트리를 만들 수 없다. 첫 커밋이 있어야 한다(판은 대신 만들지 않는다)`);
    // Claude Code는 신뢰를 받지 않은 저장소에서 -w를 신뢰 대화상자 없이 거부하고 바로 끝난다("Workspace trust not yet accepted", P8·P36 시험).
    // P36: 미리 거부하지 않고 신뢰 관문으로 띄운다(그 저장소에서 claude를 띄워 신뢰 질문을 노드에 보이고, 사람이 답하면 claude -w로 다시 띄운다)
    const gate = worktree && predictTrust(cwd, b.cfg.claudeJson).needsTrust !== false ? worktree : null;
    // P41: 모델은 풀린 값(호출자면 호출자의 모델). 빼면 부모의 것
    const model = route.type === 'launcher' ? route.launcher.model || null : route.type === 'model' || route.type === 'gateway' ? route.model : kind === (parent.kind || 'claude') ? parent.model || null : null;
    if (model && !MODEL_RE.test(model)) throw apiError('bad_request', `모델: ${model}`);
    const launcherEffort = route.type === 'launcher' && harnessOf(route.launcher.harness).fields.includes('effort') ? route.launcher.effort || null : null;
    const effort = claude ? (o.effort ? String(o.effort) : route.type === 'launcher' ? launcherEffort : parent.effort || null) : null; // P36: --effort, 빼면 물려받는다. P41: 호출자면 호출자의 것
    if (effort && !EFFORTS.includes(effort)) throw apiError('bad_request', `노력 수준은 ${EFFORTS.filter(Boolean).join(', ')} 가운데 하나: ${effort}`);
    const prompt = o.prompt == null ? null : String(o.prompt);
    if (prompt != null && !prompt.trim()) throw apiError('bad_request', '첫 지시가 비었다');
    const ws = await workspaceOf(cwd);
    if (b.sessions.get(parent.sessionId) !== parent || b.killing?.has(parent.sessionId)) throw apiError('not_on_board', '부모 세션이 닫혔다');
    // 비동기 폴더 조회 뒤 이름·상한 확인과 예약을 한 번에 한다.
    const taken = new Set([...b.sessions.values()].map((x) => x.name).concat([...this.pendingNames], [...(b.spawningNames || [])]));
    const name = childName({ want: o.name ? String(o.name) : null, parentName: parent.name, taken });

    // K3: 만드는 중인 세션도 상한에 포함한다.
    const limits = this.limits();
    const parentDepth = this.depth(parent.sessionId);
    const registered = new Set([...b.sessions.values()].filter((s) => this.info.has(s.sessionId)).map((s) => s.name));
    const pending = this.pending.filter((p) => !registered.has(p.name));
    const r = checkLimits({ parentDepth, children: this.openChildren(parent.sessionId).length + pending.filter((p) => p.parentId === parent.sessionId).length, total: this.openTotal() + pending.length, limits });
    if (r) this.refuse(parent, r, name);
    const allowHerdr = !!((b.store.spawnInfo(parent.sessionId) || {}).allowHerdr);
    const depth = parentDepth + 1;
    const viaLauncher = route.type === 'launcher';
    const info = { role, depth, by: parent.sessionId, at: Date.now(), worktree, kind, via: 'atrium child', inherited: { cwd: !o.cwd, model: kind === (parent.kind || 'claude') && !o.model && !o.launcher, effort: claude && !o.effort && !viaLauncher && !!parent.effort, permissionMode: !viaLauncher }, ...(viaLauncher ? { launcher: route.launcher.name } : {}), ...(route.resolved ? { resolved: route.resolved } : {}), ...(gate ? { gate: 'trust' } : {}) };

    const reservation = { parentId: parent.sessionId, name };
    this.pending.push(reservation); this.pendingNames.add(name);
    let out;
    try {
      // 신뢰 관문이면 처음에는 -w 없이 띄운다(그 저장소의 신뢰 질문이 뜬다)
      // P41: 호출자면 그 호출자의 하네스·모델·옵션·env를 그대로 쓴다(준 --effort만 덮는다). 게이트웨이 모델과 게이트웨이 물려받기는 그 게이트웨이 호출자의 env로, 권한 모드는 부모의 것
      const base = { cwd, name, worktree: gate ? null : worktree, parentSessionId: parent.sessionId, branch: info };
      const sp = viaLauncher ? { ...base, launcher: route.launcher.id, effort: o.effort ? effort : undefined }
        : route.launcherDef ? { ...base, launcherDef: route.launcherDef, model, effort, permissionMode: parent.permissionMode, allowHerdr }
        : { ...base, kind, flavor: route.type === 'plain' && kind === (parent.kind || 'claude') ? parent.flavor || null : null, model, effort, permissionMode: parent.permissionMode, allowHerdr, ...(route.args ? { args: route.args } : {}) };
      out = await b.spawn(sp);
    } finally { this.pending.splice(this.pending.indexOf(reservation), 1); this.pendingNames.delete(name); }
    const child = b.sessions.get(out.sessionId);
    if (!child) throw apiError('spawn_failed', '하위 세션이 판에 남지 않았다');

    // 부모와 역할 선(F2처럼), 띄움 기록
    const l = b.ensureLink(parent.sessionId, child.sessionId, { role, spawned: true });
    b.linkEvent(l, 'spawn', `atrium child ${name}`, { by: 'atrium child', paneId: child.paneId, kind, depth }, { quiet: true });
    const notice = childNotice({ role, agentName: child.agentName, paneId: child.paneId, kind, depth });
    b.linkEvent(l, 'role', role, { notice, via: 'command' });
    b.store.addEvent(parent.sessionId, 'branch_child', { child: name, sessionId: child.sessionId, role, depth, cwd: cwd.split(path.sep).join('/'), workspace: ws.key, worktree, kind, model, ...(viaLauncher ? { launcher: route.launcher.name } : {}), ...(route.resolved ? { resolved: route.resolved } : {}) });
    b.store.addEvent(child.sessionId, 'branch_parent', { parent: parent.name, parentSessionId: parent.sessionId, role, depth });
    b.log(`branch child ${parent.name} → ${name} (${kind}, ${depth}단계, ws=${ws.key}${worktree ? `, worktree ${worktree}` : ''})`);
    // 명령의 응답이 부모에게 닿지 않았으면(명령이 시간 제한으로 끊김 등) F2처럼 판이 알림을 보낸다
    if (res) {
      const lost = () => { if (!res.writableFinished && b.sessions.has(parent.sessionId)) { const d = b.queue.enqueue(parent.sessionId, `${notice}\n이 알림에는 "알겠다"고만 답해라.`); b.linkEvent(l, 'notice', notice, { deliveryId: d.deliveryId, why: 'command response lost' }, { quiet: true }); } };
      if (res.destroyed) lost(); else res.once('close', lost);
    }

    let first = null;
    if (prompt) {
      // 첫 지시는 ready 뒤 B1 규칙으로 보낸다
      const d = b.queue.enqueue(child.sessionId, prompt);
      b.linkEvent(l, 'prompt', prompt, { via: 'board', deliveryId: d.deliveryId });
      child.openPromptFrom = { linkId: l.linkId, at: Date.now(), text: prompt };
      first = { deliveryId: d.deliveryId, status: d.status };
    }
    const wait = o.wait === false ? null : await this.waitReady(child, first);
    const sum = b.sessions.has(child.sessionId) ? b.summary(child) : null;
    const state = sum ? sum.state : 'closed';
    // P36: 신뢰 질문에서 멈췄으면 needs_trust와 사람에게 할 한 문장(판 밖 터미널을 열라고 하지 않는다)
    const needsTrust = state === 'trust_wait' || (wait && wait.state === 'trust_wait') || (!!gate && !['exited', 'closed', 'error'].includes(state) && this.gated(child.sessionId));
    return {
      name, sessionId: child.sessionId, agentName: child.agentName, paneId: child.paneId, kind, role, depth, cwd: cwd.split(path.sep).join('/'), workspaceKey: ws.key, worktree, model: child.model || model, effort: child.effort || effort,
      launcher: viaLauncher ? route.launcher.name : null, resolved: route.resolved || null, gateway: route.gateway || null, inheritedGateway: route.type === 'inherit-gateway' ? route.gateway : null, // P41
      permissionMode: child.permissionMode, state, trust: out.trust, waited: wait,
      status: needsTrust ? 'needs_trust' : state, needsTrust, tellHuman: needsTrust ? trustSentence(name) : null, gate: gate ? 'trust' : null,
      firstPrompt: first ? { ...first, status: (b.store.getDelivery(first.deliveryId) || {}).status || first.status } : null,
      notice, next: this.nextOf(child, { gated: !!gate && needsTrust }),
      counts: this.countsOf(parent),
    };
  }
  // ---------- P41: 모델 목록과 말로 한 이름 풀기 ----------
  launchersList() { const L = this.b.features && this.b.features.launchers; return L ? L.data().items : []; }
  findLauncher(ref) { const L = this.b.features && this.b.features.launchers; return L ? L.find(ref) : null; }
  // 판 설정의 opencodex 주소(호출자가 없어도 게이트웨이 모델을 볼 수 있게). 그 env는 DeepSeek 예시 호출자와 같다
  defaultGateway() {
    const c = this.b.cfg;
    if (!c.ocxHealthUrl && !c.ocxBaseUrl) return null;
    let url; try { url = baseUrlOf({ baseUrl: c.ocxBaseUrl || null, healthUrl: c.ocxHealthUrl || undefined }); } catch { return null; }
    return { url, host: { id: null, name: 'opencodex', harness: 'claude', icon: '', model: '', effort: '', permissionMode: 'manual', allowHerdr: false, args: '', env: proxyEnv(url), command: '', checkUrl: c.ocxHealthUrl || '' } };
  }
  async catalog() {
    const launchers = this.launchersList();
    const gws = gatewaysOf(launchers, [this.defaultGateway()]);
    const [probed, live] = await Promise.all([Promise.all(gws.map(async (g) => {
      const hit = this.gwCache.get(g.url);
      const r = hit && Date.now() - hit.at < CATALOG_TTL_MS ? hit.r : await this.fetchModels(g.url);
      if (r.ok) this.gwCache.set(g.url, { at: Date.now(), r }); else this.gwCache.delete(g.url);
      return { ...g, ...r };
    })), Promise.all(['codex', 'gemini', 'agy'].map(async (kind) => {
      try { return [kind, await this.b.agentModels({ kind })]; }
      catch { return [kind, { models: [], error: 'model_list_unavailable' }]; }
    }))]);
    return { ...buildCatalog({ launchers, gateways: probed, providers: Object.fromEntries(live) }), hosts: probed };
  }
  // atrium models: 띄울 수 있는 것과 그 명령
  async listModels(parent) {
    const cat = await this.catalog();
    const row = (e) => ({ source: e.source, harness: e.harness, kind: e.kind, launcher: e.launcher, model: e.model || null, label: e.label || null, aliases: e.aliases || [], gateway: e.gateway, host: e.host || null, variants: e.variants, text: describeEntry(e), command: e.command });
    const inherit = await this.routeOf(parent, {}).catch(() => null);
    return { entries: cat.entries.map(row), gateways: cat.gateways, parent: { name: parent.name, model: parent.model || null, effort: parent.effort || null, gateway: inherit && inherit.gateway ? inherit.gateway : null } };
  }
  // 풀지 못한 이름의 오류(후보와 고르는 명령을 글에 넣는다)
  modelError(query, r, cat) {
    const down = cat.gateways.filter((g) => !g.ok);
    const downLine = down.length ? `\n게이트웨이가 닿지 않아 그 모델 목록은 보지 못했다: ${down.map((g) => `${g.url}(${g.why})`).join(', ')}` : '';
    if (r.code === 'model_ambiguous') return apiError('model_ambiguous', `모델 "${query}"에 맞는 것이 여럿이다. 띄우지 않았다. 사용자에게 어느 것인지 묻거나 아래 명령 가운데 하나로 띄운다:\n${candidateLines(r.candidates)}`, { candidates: r.candidates.map((e) => ({ text: describeEntry(e), command: e.command })) });
    return apiError('model_unknown', `판이 모르는 모델: "${query}". 띄우지 않았다.${r.candidates.length ? ` 가까운 것:\n${candidateLines(r.candidates)}` : ''}\n전체 목록: atrium models${downLine}`, { candidates: r.candidates.map((e) => ({ text: describeEntry(e), command: e.command })) });
  }
  // 무엇으로 띄우는가. type: launcher(호출자 그대로) | model(하네스 모델) | gateway(게이트웨이 모델, 그 호출자의 env) | inherit-gateway(부모가 게이트웨이 세션) | plain
  async routeOf(parent, o) {
    if (o.launcher) {
      const l = this.findLauncher(o.launcher);
      if (!l) throw apiError('no_launcher', `없는 호출자: ${o.launcher}. 호출자와 모델 목록: atrium models`);
      const h = harnessOf(l.harness);
      if (!h || h.id === 'shell' || h.id === 'command') throw apiError('bad_request', `하위 세션은 에이전트를 띄우는 호출자만 쓴다: ${l.name}(${h ? h.label : l.harness})`);
      if (o.kind && o.kind !== h.kind) throw apiError('bad_request', `호출자 ${l.name}은 종류 ${h.kind}다(--kind ${o.kind}와 다르다)`);
      if (o.model) throw apiError('bad_request', '--launcher와 --model을 함께 주지 않는다. 다른 모델이면 그 모델의 명령으로 띄운다(atrium models)');
      const gw = h.id === 'claude' && l.env && l.env.ANTHROPIC_BASE_URL ? l.env.ANTHROPIC_BASE_URL : null;
      return { type: 'launcher', launcher: l, kind: h.kind, gateway: gw, resolved: null };
    }
    if (o.model) {
      const cat = await this.catalog();
      const r = resolveModel(String(o.model), cat, { kind: o.kind || null });
      if (!r.ok) throw this.modelError(String(o.model), r, cat);
      const e = r.entry;
      const resolved = { from: String(o.model), how: r.how, source: e.source, to: describeEntry(e), launcher: e.launcher || null, model: e.model || null, gateway: e.gateway || null, command: e.command };
      if (e.source === 'launcher') {
        const l = this.findLauncher(e.launcherId);
        return { type: 'launcher', launcher: l, kind: e.kind, gateway: e.gateway, resolved };
      }
      if (e.source === 'harness') return { type: 'model', kind: e.kind, model: e.model, gateway: null, resolved };
      const hostG = cat.hosts.find((g) => g.url === e.gateway);
      const host = hostG && hostG.host ? hostG.host : null;
      if (!host) throw apiError('gateway_down', `게이트웨이 ${e.gateway}의 호출자를 찾지 못했다`);
      return { type: 'gateway', kind: 'claude', model: e.model, launcherDef: { ...host, id: host.id || null, icon: e.provider === 'deepseek' ? 'deepseek' : '', model: e.model }, gateway: e.gateway, resolved };
    }
    // 물려받기: 부모가 게이트웨이를 거치는 세션이면(spawn 이벤트의 env) 하위 세션도 같은 env로 띄운다
    const kind = o.kind ? String(o.kind) : parent.kind || 'claude';
    if (kind === 'claude' && this.b.hooked(parent)) {
      const sp = this.b.store.spawnInfo(parent.sessionId) || {};
      // New spawn events contain env names only. Credentials stay in the private
      // session settings; old event env remains readable for migration.
      let env = sp.env && !Array.isArray(sp.env) ? sp.env : {};
      try { env = JSON.parse(fs.readFileSync(parent.settingsPath, 'utf8')).env || env; } catch {}
      env = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(ATRIUM_|MTASK_|HERDR_|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT$)/i.test(key)));
      const url = env.ANTHROPIC_BASE_URL;
      if (url) {
        const found = sp.launcher ? this.findLauncher(sp.launcher) : null;
        const def = found && found.harness === 'claude' && found.env && found.env.ANTHROPIC_BASE_URL === url ? found
          : { id: null, name: sp.launcher || 'gateway', harness: 'claude', icon: parent.flavor || '', model: '', effort: '', permissionMode: 'manual', allowHerdr: false, args: joinArgs(parent.extraArgs || sp.extraArgs || []), env, command: '', checkUrl: '' };
        return { type: 'inherit-gateway', kind, launcherDef: { ...def, env, icon: parent.flavor || '', model: parent.model || def.model || '' }, gateway: url, resolved: null };
      }
    }
    return { type: 'plain', kind, gateway: null, resolved: null };
  }

  nextOf(x, { gated = false } = {}) {
    return { prompt: `herdr agent prompt ${x.agentName} "<할 일>" --wait --timeout 600000`, wait: gated ? `atrium child-wait ${x.name}` : `herdr agent wait ${x.agentName} --timeout 600000`, read: `herdr agent read ${x.agentName} --source recent-unwrapped --lines 80`, ...(gated ? { childWait: `atrium child-wait ${x.name}` } : {}) };
  }
  countsOf(parent) { const l = this.limits(); return { children: this.openChildren(parent.sessionId).length, total: this.openTotal(), maxChildren: l.branchMaxChildren, maxDepth: l.branchMaxDepth, maxTotal: l.branchMaxTotal }; }

  // ---------- P36: 신뢰 관문 ----------
  gated(sessionId) { const i = this.info.get(sessionId); return !!(i && i.gate === 'trust'); }
  // backend.deliveryView가 부른다: 관문을 지나기 전에는 판의 전달(첫 지시 등)을 보내지 않는다(신뢰 질문이나 다시 띄울 claude에 글이 들어가지 않게)
  holds(sessionId) { return this.gated(sessionId); }
  // 상태가 바뀔 때(bus 'session'). 사람이 신뢰 질문에 답해 ready(또는 그 사이 들어간 지시로 working)가 되면 claude -w로 다시 띄운다
  onSession(s, sum) {
    this.noteModelError(s);
    if (!this.gated(s.sessionId) || this.passing.has(s.sessionId)) return;
    if (!['ready', 'working'].includes(sum.state)) return;
    this.passing.add(s.sessionId);
    this.passGate(s).catch((e) => { this.b.log(`trust gate failed ${s.name}: ${e.code || 'launch_failed'}`); this.b.store.addEvent(s.sessionId, 'trust_gate_failed', { error: e.code || 'launch_failed' }); })
      .finally(() => this.passing.delete(s.sessionId));
  }
  // P41: 모델 오류(없는 모델, 닿지 않는 모델)로 턴이 끝났으면 판 이벤트로 남기고 부모에게도 남긴다(같은 오류는 한 번)
  noteModelError(s) {
    const e = s.rt && s.rt.lastError;
    if (!e || !isModelError(e) || this.modelErrors.get(s.sessionId) === e) return;
    this.modelErrors.set(s.sessionId, e);
    const data = { type: e.type, message: clip(e.message, 300) || modelErrorText(s.model), model: s.model || null };
    this.b.store.addEvent(s.sessionId, 'model_error', data);
    if (s.parentSessionId && this.info.has(s.sessionId)) this.b.store.addEvent(s.parentSessionId, 'branch_child_error', { child: s.name, sessionId: s.sessionId, ...data });
    this.b.log(`model error ${s.name}: ${e.type} ${clip(e.message, 120) || ''}`);
  }
  async passGate(s) {
    const b = this.b; const info = this.info.get(s.sessionId);
    if (!info || info.gate !== 'trust' || !info.worktree) return;
    const paneId = s.paneId;
    const alive = () => b.sessions.get(s.sessionId) === s && s.paneId === paneId && !b.killing?.has(s.sessionId);
    const check = () => { if (!alive()) throw apiError('not_on_board', '신뢰를 기다리던 패널이 닫혔다'); };
    const t0 = Date.now();
    // 신뢰가 ~/.claude.json에 쓰였는지(claude -w가 다시 묻지 않고 만들게)
    while (alive() && predictTrust(s.cwd, b.cfg.claudeJson).needsTrust !== false && Date.now() - t0 < this.gateTrustWaitMs) await sleep(250);
    check();
    if (predictTrust(s.cwd, b.cfg.claudeJson).needsTrust !== false) throw apiError('needs_trust', trustSentence(s.name));
    // 그 사이 herdr로 직접 들어간 지시(UserPromptSubmit)는 워크트리에서 다시 보낸다
    const slipped = s.rt.lastPromptAt && s.rt.lastPromptAt >= (info.at || 0) && s.rt.lastPrompt ? String(s.rt.lastPrompt) : null;
    const st = () => deriveState(s.rt).state;
    if (st() === 'working') { await b.adapter.sendKeys(s.agentName, ['esc']); for (let i = 0; i < 25 && alive() && st() === 'working'; i++) await sleep(200); }
    check();
    if (st() !== 'ready') throw apiError('not_ready', '승인 또는 작업이 끝난 뒤 워크트리로 다시 띄운다');
    await b.adapter.sendText(paneId, '/exit'); await sleep(150); check(); await b.adapter.paneKeys(paneId, ['enter']);
    for (const t = Date.now(); alive() && s.rt.herdr.present && Date.now() - t < (b.cfg.killWaitMs || 8000);) await sleep(200);
    check();
    if (s.rt.herdr.present) throw apiError('timeout', '기존 에이전트가 아직 끝나지 않았다');
    if (await b.adapter.waitShellReady(paneId, 8000) !== true) throw apiError('timeout', '패널 셸이 준비되지 않았다');
    check();
    if (predictTrust(s.cwd, b.cfg.claudeJson).needsTrust !== false) throw apiError('needs_trust', trustSentence(s.name));
    const args = buildStartArgs({ ...b.launchOf(s), worktree: info.worktree });
    await b.adapter.startAgent({ name: s.agentName, paneId, kind: 'claude', args });
    check();
    s.rt.exit = null; s.rt.phase = 'starting'; s.rt.launchedAt = Date.now(); s.rt.hooksSinceLaunch = 0; s.rt.sessionEnd = null;
    s.rt.herdr.launchPending = true; s.rt.herdr.agentSessionId = null; s.rt.trustPredicted = false; s.rt.trustScreen = null;
    const next = { ...info, gate: null, gatePassedAt: Date.now() };
    this.noteChild(s.sessionId, next);
    b.store.addEvent(s.sessionId, 'trust_gate_passed', { worktree: info.worktree, trusted: true, slipped: !!slipped, ms: Date.now() - t0 });
    b.log(`trust gate passed ${s.name}: relaunch with --worktree ${info.worktree}`);
    b.broadcastSession(s, { cause: 'trust_gate' });
    b.registerResume(s);
    if (slipped) b.queue.enqueue(s.sessionId, slipped);
  }
  // atrium child-wait <이름>: 자기 자손이 지시를 받을 수 있게 될 때까지(ready, 관문을 지난 뒤). 신뢰 질문·승인 대기·끝남이면 그대로 돌려준다
  async waitChild(parent, o = {}) {
    const b = this.b;
    const ref = String(o.name || '').replace(/^@/, '');
    if (!ref) throw apiError('bad_request', '기다릴 하위 세션 이름을 준다: atrium child-wait <이름>');
    const t = [...b.sessions.values()].find((x) => x.name === ref || x.agentName === ref);
    if (!t) throw apiError('not_found', `판에 없는 세션: ${ref}`);
    if (!isDescendant(t.sessionId, parent.sessionId, this.rowOf)) throw apiError('not_parent', `@${t.name}은 너(@${parent.name})의 하위 세션이 아니다`);
    const limit = Math.min(Number(o.timeoutMs) || this.childWaitMs, this.childWaitMs);
    const t0 = Date.now();
    const st = () => (b.sessions.has(t.sessionId) ? deriveState(t.rt).state : 'closed');
    let s = st();
    while (Date.now() - t0 < limit) {
      s = st();
      if (['exited', 'closed', 'error'].includes(s)) break;
      if (!this.gated(t.sessionId) && !this.passing.has(t.sessionId) && ['ready', 'working', 'waiting'].includes(s)) break;
      if (s === 'trust_wait' && o.untilTrusted === false) break;
      await sleep(250);
    }
    const gated = this.gated(t.sessionId) || this.passing.has(t.sessionId);
    const v = b.sessions.has(t.sessionId) ? this.childView(t) : { name: t.name, state: 'closed' };
    const needsTrust = s === 'trust_wait' || (gated && !this.passing.has(t.sessionId) && predictTrust(t.cwd, b.cfg.claudeJson).needsTrust !== false);
    return { ...v, state: s, ms: Date.now() - t0, timeout: Date.now() - t0 >= limit, gated, needsTrust, status: needsTrust ? 'needs_trust' : s, tellHuman: needsTrust ? trustSentence(t.name) : null, next: this.nextOf(t, { gated }) };
  }
  // 하위 세션이 지시를 받을 수 있게 될 때까지(ready). 첫 지시를 줬으면 그것이 들어가 일을 시작할 때까지(그래야 부모의 herdr agent wait가 바로 끝나지 않는다)
  async waitReady(child, first) {
    const b = this.b; const t0 = Date.now();
    const st = () => (b.sessions.has(child.sessionId) ? deriveState(child.rt).state : 'closed');
    while (Date.now() - t0 < this.readyWaitMs) {
      const s = st();
      if (['trust_wait', 'waiting', 'error', 'exited', 'closed'].includes(s)) return { state: s, ms: Date.now() - t0 };
      if (s === 'ready' && !first && !this.gated(child.sessionId) && !this.passing.has(child.sessionId)) return { state: s, ms: Date.now() - t0 }; // P36: 관문을 지나 -w로 뜬 뒤가 ready다
      if (first) {
        const d = b.store.getDelivery(first.deliveryId);
        if (d && ['failed', 'cancelled', 'unconfirmed'].includes(d.status)) return { state: s, delivery: d.status, ms: Date.now() - t0 };
        if (d && d.status === 'confirmed' && (s === 'working' || child.rt.herdr.status === 'working' || (child.rt.turn && child.rt.turn.endedAt && child.rt.turn.endedAt > d.createdAt))) return { state: s, delivery: 'confirmed', ms: Date.now() - t0 };
        if (Date.now() - t0 > this.readyWaitMs - this.submitWaitMs && s === 'ready' && d && d.status === 'confirmed') return { state: s, delivery: 'confirmed', ms: Date.now() - t0 };
      }
      await sleep(250);
    }
    return { state: st(), timeout: true, ms: Date.now() - t0 };
  }

  // P21(D4)·P24: atrium wake <이름>(또는 잠든 하위 세션 이름으로 atrium child). 판의 어느 세션이든 그 리포째 깨운다(herdr 명령도 대상을 가리지 않는다)
  async wakeAgent(caller, o = {}) {
    const b = this.b;
    const ref = String(o.name || '').replace(/^@/, '');
    if (!ref) throw apiError('bad_request', '깨울 세션 이름을 준다: atrium wake <이름>');
    const t = [...b.sessions.values()].find((x) => x.name === ref || x.agentName === ref || x.sessionId === ref);
    if (!t) throw apiError('not_found', `판에 없는 세션: ${ref}`);
    const was = !!(t.rt.sleep || (b.sleeper && b.sleeper.wakes.has(t.sessionId)));
    const r = was ? await b.sleeper.wakeFor(t, `atrium:${caller.name}`) : null; // P24: 그 리포의 잠든 세션을 모두 깨우고 이 세션이 준비될 때까지
    let first = null;
    if (o.prompt != null && String(o.prompt).trim()) { const d = b.queue.enqueue(t.sessionId, String(o.prompt)); first = { deliveryId: d.deliveryId, status: d.status }; }
    b.store.addEvent(caller.sessionId, 'branch_wake', { target: t.name, woke: was, ms: r ? r.ms : null });
    const v = this.childView(t);
    return { ...v, woke: was, ms: r ? r.ms : null, firstPrompt: first, next: { prompt: `herdr agent prompt ${t.agentName} "<할 일>" --wait --timeout 600000`, wait: `herdr agent wait ${t.agentName} --timeout 600000`, read: `herdr agent read ${t.agentName} --source recent-unwrapped --lines 80` } };
  }

  childView(x) {
    const sum = this.b.summary(x);
    const info = this.info.get(x.sessionId) || {};
    return { name: x.name, sessionId: x.sessionId, agentName: x.agentName, paneId: x.paneId, kind: x.kind || 'claude', role: info.role || null, depth: this.depth(x.sessionId), parent: (this.rowOf(x.parentSessionId) || {}).name || null, state: sum.state, ask: sum.ask ? clip(sum.ask.summary || sum.ask.kind, 160) : null, lastPrompt: clip(x.rt.lastPrompt, 300), lastAnswer: clip(x.rt.lastAnswer, 1500), lastAnswerAt: x.rt.lastAnswerAt || null, error: sum.error ? { type: sum.error.type || null, message: clip(sum.error.message, 300) || (isModelError(sum.error) ? modelErrorText(x.model) : null) } : null, model: x.model || null, cwd: x.rt.cwd || x.cwd, worktree: info.worktree || null, gated: this.gated(x.sessionId), children: this.openChildren(x.sessionId).length };
  }
  // atrium children: 자기의 하위 세션(all이면 그 아래 모두, 나무 순서)
  listChildren(parent, o = {}) {
    const b = this.b;
    const rows = new Map([...this.closed].map(([sessionId, row]) => [sessionId, { ...row, sessionId }]));
    for (const x of b.sessions.values()) rows.set(x.sessionId, x);
    const list = [];
    const seen = new Set([parent.sessionId]);
    const walk = (id) => {
      for (const x of [...rows.values()].filter((y) => y.parentSessionId === id).sort((a, c) => (a.createdAt || 0) - (c.createdAt || 0))) {
        if (seen.has(x.sessionId)) continue;
        seen.add(x.sessionId);
        if (b.sessions.has(x.sessionId) && this.info.has(x.sessionId)) list.push(this.childView(x));
        if (o.all) walk(x.sessionId);
      }
    };
    walk(parent.sessionId);
    return { parent: parent.name, depth: this.depth(parent.sessionId), children: list, counts: this.countsOf(parent) };
  }
  // atrium child-kill <이름>: 자기 자손만. 그 아래 자손도 깊은 것부터 끈다(only면 그것 하나)
  async killChild(parent, o = {}) {
    const b = this.b;
    const ref = String(o.name || '').replace(/^@/, '');
    if (!ref) throw apiError('bad_request', '끌 하위 세션 이름을 준다');
    const t = [...b.sessions.values()].find((x) => x.name === ref || x.agentName === ref || x.paneId === ref || x.sessionId === ref);
    if (!t) throw apiError('not_found', `판에 없는 세션: ${ref}`);
    if (t === parent || !isDescendant(t.sessionId, parent.sessionId, this.rowOf)) {
      const msg = t === parent ? '자기 자신은 atrium child-kill로 끄지 않는다' : `@${t.name}은 너(@${parent.name})가 만든 하위 세션이 아니다. 자기 하위 세션(그 아래 포함)만 끈다`;
      b.store.addEvent(parent.sessionId, 'branch_refused', { code: 'not_parent', reason: msg, target: t.name });
      b.api.broadcast('branch.refused', { sessionId: parent.sessionId, name: parent.name, code: 'not_parent', reason: msg, target: t.name });
      throw apiError('not_parent', msg);
    }
    const tree = new Map([...this.closed].map(([sessionId, row]) => [sessionId, { sessionId, parentSessionId: row.parentSessionId }]));
    for (const x of b.sessions.values()) tree.set(x.sessionId, { sessionId: x.sessionId, parentSessionId: x.parentSessionId || null });
    const rows = [...tree.values()];
    const order = o.only ? [] : descendantsOf(t.sessionId, rows).map((x) => x.sessionId);
    order.push(t.sessionId);
    const killed = [];
    for (const id of order) {
      const x = b.sessions.get(id);
      if (!x) continue;
      try { const r = await b.kill({ session: id, confirm: true }); killed.push({ name: x.name, closed: !!r.closed }); }
      catch (e) { killed.push({ name: x.name, closed: false, error: e.code || e.message }); }
    }
    b.store.addEvent(parent.sessionId, 'branch_kill', { target: t.name, killed });
    return { killed };
  }
}
