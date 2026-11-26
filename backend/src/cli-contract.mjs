// P115: 판이 띄운 세션의 atrium 명령 계약(atrium help --json). 동사, 인자, 출력 모양, 종료 코드, 계약 버전.
// 하네스마다 스킬·hook을 맞추지 않고, 모델은 `atrium help` 하나로 쓸 수 있어야 한다(이슈 #11 4.1 1층). 동사와 출력은 P8~P81 그대로다.
// 버전: 동사·인자·출력 모양을 바꾸거나 빼면 올린다. 더하기만 하면 그대로 둔다.
// 2(P116): 에이전트끼리 일 시키기 prompt·wait·read를 더하고(전에는 터미널 명령), 하위 세션 응답의 다음 명령(next)이 atrium 명령이 되었다. 종료 코드 3(기다리는 시간이 끝남)
// 3(P156): 일 관계(하위·동료·독립). child --peer와 응답 relation, relate 동사, children은 하위 관계만(동료는 peers), child-kill은 하위 관계로만 내려가고 남긴 세션(kept),
//   me는 상위(parent)·동료(peers)·하위(children)·독립(independent)으로 나눈다(parent·children이 계보가 아니라 일 관계를 따른다)
// P180: done·item·items 동사와 prompt·wait 응답의 unit 칸을 더했다(더하기만이라 3 그대로)
export const CONTRACT_VERSION = 3;

// out: --json일 때 result의 주요 칸. 사람이 읽는 출력(--json 없음)은 같은 내용의 글이다
export const VERBS = [
  { name: 'help', args: ['[--json]'], does: '이 사용법. --json은 이 계약(동사, 인자, 출력, 종료 코드, 버전)', out: ['contract', 'verbs', 'exit'] },
  { name: 'prompt', args: ['<이름>', '"<할 일>"', '[--wait | --now]', '[--timeout ms]', '[--json]'], does: '다른 에이전트에게 일을 맡긴다. 보드가 받는 쪽 차례에 맞춰 넣고(일하는 중·응답 대기면 끝난 뒤, 잠들었으면 깨운 뒤) 연결을 판에 남긴다. 하위에게 맡겼으면 턴을 끝낸다: 하위가 atrium done으로 닫으면 보드가 그 보고를 너에게 넣고, 보고 없이 멈추면 알린다. --wait면 그 턴(또는 done)까지 기다려 답을 돌려준다(기본 100초, 지금 답이 꼭 필요할 때만). --now면 일하는 중인 Claude Code에 기다리지 않고 대기 메시지로 넣는다(--wait와 함께 쓰지 않는다)', out: ['name', 'agentName', 'kind', 'state', 'woke', 'deliveryId', 'delivery', 'turn', 'next', 'unit'] },
  { name: 'wait', args: ['<이름>', '[--timeout ms]', '[--json]'], does: '그 세션이 지금 턴(너의 글이 대기열에 있으면 그 글의 턴)을 끝낼 때까지 기다려 마지막 답을 돌려준다(기본 100초). 사람의 답을 기다리면 바로 돌아온다. 맡긴 일의 보고는 보드가 가져다주므로 되풀이해 치지 않는다', out: ['name', 'agentName', 'kind', 'status', 'state', 'ms', 'answer', 'ask', 'error', 'delivery', 'next', 'unit'] },
  { name: 'read', args: ['<이름>', '[--lines n]', '[--json]'], does: '그 세션 화면의 최근 줄(기본 80줄). 잠든 세션은 마지막 답', out: ['name', 'agentName', 'kind', 'state', 'lines', 'source', 'text', 'answer', 'next'] },
  { name: 'me', args: ['[--json]'], does: '너의 지금 연결: 상위(너를 하위로 둔 세션), 동료, 하위, 독립, 역할 연결, 연결마다 마지막 지시. 보드의 지금 기록', out: ['me', 'parent', 'peers', 'children', 'independent', 'lineage', 'roles'] },
  { name: 'child', args: ['[이름]', '[--peer]', '[--prompt "첫 요청"]', '[--role 역할]', '[--cwd 폴더]', '[--worktree 이름]', '[--model 모델]', '[--launcher 런처]', '[--effort 수준]', '[--kind 종류]', '[--head]', '[--no-wait]', '[--json]'], does: '세션을 띄우고 준비될 때까지 기다린다. 기본은 하위 워커(--prompt의 일을 atrium done으로 너에게 보고), --peer면 동료(같은 위계의 협력자, 결과를 서로 공유). 응답 첫 줄이 관계다', out: ['name', 'agentName', 'paneId', 'kind', 'relation', 'role', 'depth', 'state', 'status', 'next'] },
  { name: 'relate', args: ['<이름>', 'sub|peer|none|auto', '[--json]'], does: '나와 그 세션의 관계를 바꾼다(그 세션이 나의 sub 하위, peer 동료, none 독립, auto 자동 = 띄움·역할 선을 따름). 너와 이어진 세션만, 사람이 정한 관계는 바꾸지 않는다', out: ['a', 'b', 'relation', 'source', 'effective', 'before'] },
  { name: 'children', args: ['[--all]', '[--json]'], does: '너의 하위 세션(--all이면 그 아래까지) 상태와 마지막 응답. 하위 관계만, 동료는 따로 한 줄', out: ['children', 'peers'] },
  { name: 'child-kill', args: ['<이름>', '[--only]', '[--json]'], does: '너의 하위 세션을 끈다(하위 관계로만 그 아래도 함께, --only면 그것만). 동료·독립은 끄지 않고 남긴 이름을 적는다. 사람이 끄라고 할 때만', out: ['killed', 'kept'] },
  { name: 'child-wait', args: ['<이름>', '[--json]'], does: '그 하위 세션이 지시를 받을 수 있게 될 때까지 기다린다(한 번에 100초)', out: ['name', 'state', 'timeout', 'next'] },
  { name: 'wake', args: ['<이름>', '[--json]'], does: '잠든 세션을 깨운다(같은 대화로 이어 간다). atrium prompt는 잠든 세션을 깨운 뒤 넣으므로 미리 깨울 때만', out: ['name', 'woke', 'state', 'next'] },
  { name: 'models', args: ['[--json]'], does: '띄울 수 있는 런처·모델과 각각을 띄우는 atrium child 명령', out: ['entries', 'gateways', 'parent'] },
  // P180: 일 단위. 첫 요청 앞에 "[Atrium 보드] … 맡긴 일 u…" 머리가 붙은 일을 받은 세션이 끝을 알린다
  { name: 'done', args: ['ok|failed', '"<보고>"', '[--file 경로]', '[--json]'], does: '보드가 맡긴 지금 일을 닫는다(ok 끝냈다, failed 못 했다). 값과 보고는 맡긴 세션에게 한 번 간다(그 세션이 기다리는 중이면 그 기다림이 받는다). 닫은 뒤 쉰다. 열린 일이 없으면 종료 코드 1', out: ['unit', 'result', 'parent', 'claimedBy', 'next', 'queued'] },
  { name: 'item', args: ['[--json]'], does: '너의 지금 일: 맡긴 세션, 할 일, 시작, 뒤에 줄 선 일 수', out: ['item', 'queued'] },
  { name: 'items', args: ['[--json]'], does: '네가 맡긴 일들: 맡은 세션, 상태(open·done·failed·cancelled), 결과와 보고', out: ['items', 'open'] },
];
// 종료 코드: 0 성공, 1 보드가 거절하거나 실패(이유는 stderr와 --json의 error), 2 명령을 잘못 씀, 3 기다리는 시간이 끝남(일은 계속된다. 다시 atrium wait)
export const EXIT = { ok: 0, refused: 1, usage: 2, timeout: 3 };
export const VERB_NAMES = VERBS.map((v) => v.name).filter((n) => n !== 'help');
// P116: atrium wait의 결과(status)
export const WAIT_STATUS = ['done', 'idle', 'waiting', 'timeout', 'failed', 'unconfirmed', 'closed', 'exited', 'sleeping', 'error'];

// P156: 띄울 때 관계를 고르는 안내(짧은 help, --long, 스킬, 판의 짧은 안내가 같은 뜻을 말한다)
export const RELATION_HELP = [
  '띄울 때 관계를 고른다: 사용자가 협력·동료·같이·파트너·나란히를 말하면 --peer(동료: 같은 위계, 필요한 것을 주고받고 끝나면 결과를 서로 공유, 사람에게 직접 답해도 된다). 워커·하위·맡겨·나눠·병렬을 말하면 기본(하위 워커: 끝나면 atrium done으로 너에게 보고, child-kill로 함께 꺼진다). 그 밖에는 첫 지시와 역할 이름으로 판단한다(같은 수준의 다른 일을 맡은 상대면 동료, 네 일의 한 조각이면 하위). 나중에 바꾸기: atrium relate <이름> sub|peer|none|auto.',
];

// 모델이 읽는 짧은 사용법(동사마다 한 줄)
export function shortHelp() {
  return [
    `atrium(계약 ${CONTRACT_VERSION}): 보드가 띄운 세션이 보드와 말하는 명령. 옛 이름 mtask도 같다.`,
    ...VERBS.map((v) => `  atrium ${v.name}${v.args.length ? ' ' + v.args.join(' ') : ''}\n      ${v.does}`),
    '이름은 보드의 세션 이름이다(@ 없이도 된다). 다른 에이전트에게는 atrium prompt로만 보낸다(터미널 명령으로 직접 보내면 보드가 연결을 남기지 못한다).',
    ...RELATION_HELP,
    '종료 코드: 0 성공, 1 보드가 거절·실패, 2 명령을 잘못 씀, 3 기다리는 시간이 끝남(다시 atrium wait). 기계용 계약: atrium help --json. 자세한 설명: atrium help --long',
  ].join('\n');
}
export const contractJson = () => ({ contract: CONTRACT_VERSION, verbs: VERBS, exit: EXIT, waitStatus: WAIT_STATUS, relations: ['sub', 'peer', 'none', 'auto'], relationHelp: RELATION_HELP.join('\n') }); // P156
