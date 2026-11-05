#!/usr/bin/env node
// atrium(옛 이름 mtask): 판 API를 그대로 부르는 얇은 시험용 CLI(ARCH 5절). herdr를 직접 부르지 않는다.
// 사용: node bin/atrium.mjs [--dev] [--json] <명령> ...   (도움말: atrium help)
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { connect as connectTo, startBackend as startBackendFor, stopBackend as stopBackendFor } from '../src/client.mjs';
import { remoteCommand } from './atrium-remote.mjs'; // P49(R3): 원격 접속(Tailscale)
import { FEATURES_HELP, FEATURE_BOOL_FLAGS, featureCommand, featureEvent } from './atrium-features.mjs'; // P6b

const HELP = `atrium [--dev] [--json] <명령>
  backend start|stop|status         백엔드 띄우기(없으면 herdr 서버도 띄움), 끄기, 상태
  status                            백엔드와 판 전용 herdr 상태(버전, 프로토콜, 기능)
  devices [code|rm <id>]            웹 화면에 짝 맺은 기기 목록, 짝 맺기 코드 만들기, 끊기(P48)
  remote status|guide               원격 접속(Tailscale) 진단과 따라 할 단계(P49). 읽기만 한다
  remote enable|disable [--yes] [--https-port n]   tailscale serve로 판을 tailnet에 켜고 끈다(--yes가 있을 때만 실행, funnel은 쓰지 않음)
  herdr start|stop|restart [--yes]  판 전용 herdr 서버 켜기, 끄기, 다시 띄우기
  herdr status|rediscover           herdr 진단(고른 실행 파일, 본 후보, 버전 경고), 다시 찾기(P40)
  spawn <폴더> [--launcher 호출자] [--name n] [--prompt 글] [--model m] [--effort e] [--mode 권한모드] [--kind 종류|shell] [--args "인자"] [--allow-herdr]   --launcher면 그 호출자로 띄우고 준 값이 덮는다(P33)
  launchers                         호출자 목록(즐겨찾기 순서, 하네스, 명령 미리보기, P33)
  ls [--ws 워크스페이스]            세션 목록과 상태(워크스페이스별)
  ws                                리포지토리 워크스페이스 목록과 세는 값(세션, 작업 중, 내 차례, 검토 대기)
  ws open <폴더> | ws close <이름|키> [--yes] [--after archive|delete] | ws select <이름|키>   빈 워크스페이스 만들기, 판에서 지우기(세션이 있으면 --after로 모두 보관·삭제), 지금 워크스페이스 고르기
  get <이름>                        세션 상세(묻는 내용, 마지막 답, 화면 꼬리, git, 전달)
  watch [--seconds n]               상태 변화, hook, 전달을 실시간으로
  send @이름 [@이름...] <글> [--wait] [--ws 워크스페이스]   글 보내기. @all은 캔버스 전체의 에이전트 세션(--ws면 그 워크스페이스만). --wait면 확인까지 기다림
  cancel <전달 ID>                  대기 중인 전달 취소
  deliveries [이름]                 전달 기록
  inbox                             내 차례(waiting, trust_wait), 검토 대기, 문제
  last <이름>                       마지막 답 전체
  messages <이름> [--after seq]     대화 기록(지시, 답, 도구)
  events [이름] [--limit n]         판 이벤트 기록
  screen <이름> [--text]            현재 화면(pane.read)
  attach <이름> [--cols c --rows r] [--seconds s] [--input 글] [--raw]   제어기 프레임 받기
  input <이름> <글>                 제어기로 터미널 입력(\\e \\r \\n \\t \\xNN 해석)
  answer <이름> <번호|reject|amend> [--text 글] [--picks 1,3]   승인 카드 답하기(PLAN 4절 A1)
  seen <이름>                       봤음 표시
  kill <이름> [--yes]               판이 띄운 세션 끄기
  trust <폴더>                      신뢰 대화상자 예상(~/.claude.json 읽기만)
  board [--ws 워크스페이스]         판 배치(워크스페이스를 주면 그 판만)
  changes [--minutes n]             복귀 요약(마지막으로 본 뒤, 또는 n분 동안 바뀐 것)
  brief <이름>                      다시 들어가기 브리핑(마지막 지시·답, 상태, 질문)
  res                               자원(세션별 메모리, 제어기, 동시 실행 수)
  sleep [<리포>]                    리포를 잠재운다(판 Claude Code를 끄고 노드는 잠듦으로). 리포를 빼면 쉬는 리포 모두(P24)
  wake <리포|이름>                  리포(또는 그 세션의 리포)에서 잠든 세션을 모두 같은 대화로 깨운다(P24)
  sleep-status                      리포마다 저절로 잠재우지 않는 까닭과 쉰 시간, 잠든 세션(P24)
  clients                           판 전용 herdr 세션에 붙은 다른 화면(D3)
  links                             세션끼리 연결(누가 누구에게 일을 시켰는지, 판에서 정한 역할, 띄움)
  link <A> <B> --role 역할          판에서 A → B를 잇고 A에게 B의 이름·패널·역할을 알린다(F2)
  unlink <연결 ID> [--yes]          연결 끊기(역할이 있었으면 A에게 알린다)
  linklog <연결 ID>                 연결에서 오간 기록
  kinds                             herdr가 아는 에이전트 종류와 이 PC에 깔린 것
  search <글>                       이름, 워크스페이스, 질문, 요청, 답, 메모·칸반 노드에서 찾기(P6a)
  dock <A> <B> [--side right|left|top|bottom] [--at leaf|dock] | dock rm <이름>   B 가장자리에 A를 붙인다(leaf: B를 반으로, dock: B의 덩어리 전체 옆), 덩어리에서 뗀다(P6a, P17)
  dock layout <틀> <A> <B> ...   고른 노드를 배치 틀로 한 덩어리로 짠다(P17). 틀: main-left, grid, row, col 등(P26: dock-tree.mjs PRESETS)
  size <이름> large|normal|small|wide-large|...|tall-small [--dock]   노드 크기 단계(P6a). 가로·세로 크기와 --dock(덩어리 전체 바깥)은 P23
  arrange <워크스페이스> [--apply] [--undo]   연결을 따라 정리(미리 보기, 적용, 한 번 되돌리기)(P6a)
  arrange --all [--apply] [--undo]          판 전체 정리: 영역마다 안을 정리하고 영역도 줄 맞춰 다시 놓는다(P31)
${FEATURES_HELP}
  closed [--ws 워크스페이스]        닫힌 세션(판에서 빠졌지만 다시 열 수 있다, P7)
  reopen <이름|ID> [--model m]      닫힌 세션을 판으로 다시 열기. claude는 같은 대화로 이어 간다(P7)
  dismiss <이름|ID>                 닫힌 세션을 보관(P7의 빼기, P10부터 보관)
  archive <대화 ID|이름> [--ws w --old [--days n] --yes]   판 밖 대화나 닫힌 세션을 보관. --old는 그 리포의 오래된 것(P10)
  unarchive <대화 ID|이름>          보관함에서 꺼내기(P10)
  archived [--ws 워크스페이스]      보관함: 보관된 닫힌 세션과 판 밖 대화(P10)
  convos [--ws 워크스페이스]        열린 워크스페이스의 판 밖 Claude Code 대화와 묶인 곳(새로 훑은 뒤, P7)
  open-convo <대화 ID> [--model m]  묶여 있지 않은 판 밖 대화를 같은 대화 ID로 이어 가는 판 세션으로(P7)
  tree                              가지 펼치기의 나무(부모, 깊이, 역할)와 상한(P8). 판이 띄운 세션 안의 하위 세션 명령은 bin/atrium-child.mjs
  convo-nodes                       캔버스의 판 밖 대화 노드와 띄움 선(P13)
  classify                          대화 기록의 분류별 수(판에 올림, 보관, missed, 도는 중, 데스크톱 등)
  missed                            missed(지울 대화): 폴더가 없어졌거나 이 앱의 시험 폴더인 대화를 폴더별로
  missed rm (--all | --folder <폴더> | <대화 ID>...) [--yes]   휴지통으로 보낸다(--yes 없이는 수와 크기만)
  import-desktop --list             데스크톱 앱(Code 탭)에서 가져올 세션 후보: 리포별 상태, 기본 고름, 지금 도는지(P34)
  import-desktop --all | <앱 세션 ID>...   기본 고름 전부(새것과 더 씀, 도는 것은 뺌) 또는 고른 것을 갈라 열어 잠든 판 세션으로 가져온다
  call <메서드> [JSON]              판 API를 그대로 부른다`;

const argv = process.argv.slice(2);
const cfg = loadConfig({ argv });
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dev') continue;
  if (a.startsWith('--')) { const k = a.slice(2); const nx = argv[i + 1]; if (nx !== undefined && (!nx.startsWith('--') || k === 'args') && !['json', 'wait', 'yes', 'raw', 'text', 'allow-herdr', 'apply', 'undo', 'old', 'all', ...FEATURE_BOOL_FLAGS].includes(k)) { flags[k] = nx; i++; } else flags[k] = true; }
  else pos.push(a);
}
const JSONOUT = !!flags.json;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = (t = Date.now()) => new Date(t).toISOString().slice(11, 23);
const ago = (t) => (t ? `${((Date.now() - t) / 1000).toFixed(1)}s` : '-');
const out = (o) => console.log(JSONOUT ? JSON.stringify(o, null, 2) : o);

const connect = () => connectTo(cfg);

function unescape(s) {
  return String(s).replace(/\\(e|r|n|t|x[0-9a-fA-F]{2}|\\)/g, (_, k) => (k === 'e' ? '\x1b' : k === 'r' ? '\r' : k === 'n' ? '\n' : k === 't' ? '\t' : k === '\\' ? '\\' : String.fromCharCode(parseInt(k.slice(1), 16))));
}
// 제어기 프레임을 글자 격자로 대충 그린다: 커서 위치(CUP), 오른쪽 이동(CUF), 줄 지우기만 다룬다(E1 3.3, E4 2.3).
// 확인용이다. 넓은 글자 폭과 색은 다루지 않는다. 실제 화면은 창의 xterm.js가 그린다.
function roughText(buf, cols, rows) {
  const g = Array.from({ length: rows }, () => Array(cols).fill(' '));
  let r = 0, c = 0;
  const re = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]|([\s\S])/g;
  let m;
  while ((m = re.exec(buf))) {
    if (m[3] !== undefined) {
      const ch = m[3];
      if (ch === '\r') c = 0; else if (ch === '\n') r = Math.min(rows - 1, r + 1); else if (ch >= ' ') { if (r < rows && c < cols) g[r][c] = ch; c++; }
    } else if (m[2]) {
      const p = m[1].split(';').map((x) => parseInt(x, 10));
      if (m[2] === 'H') { r = (p[0] || 1) - 1; c = (p[1] || 1) - 1; }
      else if (m[2] === 'C') c += p[0] || 1;
      else if (m[2] === 'K' && r < rows) for (let i = c; i < cols; i++) g[r][i] = ' ';
      else if (m[2] === 'J' && m[1] === '2') for (const row of g) row.fill(' ');
    }
  }
  return g.map((row) => row.join('').trimEnd()).filter((l) => l.trim()).join('\n');
}

function fmtAsk(a) {
  if (!a) return '';
  if (a.kind === 'question') return `질문: ${(a.questions || []).map((q) => `${q.question} [${q.options.join(' / ')}]${q.multiSelect ? ' (여러 개)' : ''}`).join(' | ')}`;
  if (a.kind === 'plan') return `계획 승인: ${String(a.plan || '').slice(0, 120)}`;
  if (a.kind === 'unknown_dialog') return '알 수 없는 대화상자(화면 확인 필요)';
  const ch = a.choices ? `  선택지: ${a.choices.map((c) => `${c.n}.${c.label}`).join(' | ')}` : '';
  return `권한 요청 ${a.summary || a.tool}${a.question ? ` — "${a.question}"` : ''}${ch}`;
}
function fmtSession(s) {
  const st = s.state + (s.estimate ? '?' : '');
  if (s.kind === 'shell') {
    const sh = s.shell || {};
    const run = sh.atPrompt === false ? `실행 중: ${sh.command || '?'}${sh.procs && sh.procs.length ? ` [${sh.procs.join(', ')}]` : ''}` : '프롬프트';
    return `${s.name.padEnd(8)} ${st.padEnd(13)} ${s.paneId || ''} (셸${s.origin === 'adopted' ? ', 판에 올림' : ''}) ${run}${s.elsewhere ? ` ↪ 다른 곳: ${s.elsewhere.root}` : ''}`;
  }
  const marks = [s.unseen && '검토대기', s.quiet && '조용함', s.delivering && `전달${s.delivering}`, s.interruptedTurn && '재시작으로끊긴턴', s.resume && !s.resume.verified && '이어가기미확인'].filter(Boolean).join(',');
  const who = [s.kind && s.kind !== 'claude' && s.kind, s.origin === 'adopted' && '판에 올림', s.git && s.git.isWorktree && `워크트리 ${s.git.branch}`].filter(Boolean).join(',');
  let line = `${s.name.padEnd(8)} ${st.padEnd(11)} herdr=${String(s.herdrStatus).padEnd(8)} ${s.paneId || ''} ${who ? `(${who}) ` : ''}${marks ? `[${marks}]` : ''}`;
  if (s.state === 'waiting') line += `\n         ↳ ${fmtAsk(s.ask)} (기다린 ${ago(s.ask && s.ask.since)})`;
  if (s.state === 'trust_wait') line += `\n         ↳ 신뢰 대화상자 대기(예상 ${s.trust.predictedDialog ? '뜸' : '안 뜸'}, 화면 확인 ${s.trust.seenOnScreen ? '됨' : '안 됨'}). 터미널에서 답하기`;
  if (s.state === 'error') line += `\n         ↳ 오류 ${JSON.stringify(s.error)}`;
  if (s.state === 'exited') line += `\n         ↳ 끝남: ${s.exit && s.exit.kind}${s.exit && s.exit.reason ? ` (${s.exit.reason})` : ''}${s.exit && s.exit.kind === 'trust_declined' ? ' — 신뢰하지 않아 끝남' : ''}`;
  if (s.lastAnswer && (s.state === 'ready' || s.state === 'error')) line += `\n         ↳ 마지막 답: ${s.lastAnswer.replace(/\s+/g, ' ').slice(0, 100)}`;
  if (s.elsewhere) line += `\n         ↳ 다른 ${s.elsewhere.repo ? '저장소' : '폴더'}에서 일하는 중: ${s.elsewhere.root}`;
  return line;
}

const startBackend = () => startBackendFor(cfg);
const stopBackend = () => stopBackendFor(cfg);

function waitDeliveries(c, ids, timeoutMs = 120000) {
  const left = new Set(ids);
  return new Promise((res) => {
    const timer = setTimeout(() => res({ timeout: [...left] }), timeoutMs);
    c.on((ev, d) => {
      if (ev !== 'delivery' || !left.has(d.deliveryId)) return;
      console.log(`${ts()} 전달 ${d.name} ${d.deliveryId} ${d.status}${d.reason ? `(${d.reason})` : ''}`);
      if (['confirmed', 'unconfirmed', 'failed', 'cancelled'].includes(d.status)) { left.delete(d.deliveryId); if (!left.size) { clearTimeout(timer); res({ done: true }); } }
    });
  });
}

async function main() {
  const [cmd, ...rest] = pos;
  if (!cmd || cmd === 'help') return console.log(HELP);
  if (cmd === 'backend') {
    const op = rest[0] || 'status';
    if (op === 'start') return out(await startBackend());
    if (op === 'stop') return out(await stopBackend());
  }
  if (cmd === 'remote') return remoteCommand(cfg, rest, flags, connect); // P49: 백엔드가 없어도 된다
  const c = await connect();
  try {
    switch (cmd) {
      case 'backend': case 'status': {
        const st = await c.call('backend.status');
        if (JSONOUT) return out(st);
        const h = st.herdr;
        console.log(`백엔드 pid=${st.pid} 포트=${st.port} 프로필=${st.profile} 데이터=${st.dataDir} 세션 ${st.sessions}개`);
        if (st.previousRun) console.log(`  이전 실행: ${st.previousRun.cleanShutdown ? '정상 종료' : '비정상 종료'}, 꺼져 있던 시간 ${(st.previousRun.downMs / 1000).toFixed(1)}초(그동안 세션 화면에 hook 연결 오류 글이 찍혔을 수 있다)`);
        if (st.web) console.log(`  화면 주소=${st.web.url}${st.web.built ? '' : ' (app/dist 없음: cd app && npm run build)'} 짝 맺은 기기 ${st.web.devices}대`); // P48
        console.log(`herdr 세션=${h.session} 실행=${h.running} 연결=${h.connected} 서버 pid=${h.serverPid} CLI=${h.cliVersion}`);
        if (h.compat) console.log(`  version=${h.compat.version} protocol=${h.compat.protocol} 호환=${h.compat.ok}${h.compat.problems.length ? ' 문제: ' + h.compat.problems.join('; ') : ''}\n  capabilities=${JSON.stringify(h.compat.capabilities)}`);
        // P40: 고른 실행 파일과 까닭, 본 후보, 경고
        const ch = h.find && h.find.chosen;
        console.log(`  실행 파일=${h.path || '(못 찾음)'}${ch ? ` (${ch.reason})` : ''}${h.find && h.find.note ? ` [${h.find.note}]` : ''}`);
        if (h.missing || !ch) for (const t of (h.find && h.find.tried) || []) console.log(`    ${t.ok ? 'ok ' : '-- '}${t.source.padEnd(9)} ${t.path}${t.ok ? ` ${t.version}` : ` (${t.error})`}`);
        if (h.warning) console.log(`  경고: ${h.warning}`);
        if (h.update) console.log(`  알림: ${h.update.message}`);
        if (st.relay.length) console.log(`  붙은 제어기: ${JSON.stringify(st.relay)}`);
        return;
      }
      case 'herdr': {
        const op = rest[0] || 'status';
        const r = op === 'status' ? await c.call('herdr.status') : await c.call(`herdr.${op}`, { confirm: !!flags.yes });
        if (r && r.needsConfirm) { console.log(`확인 필요: ${r.message}\n계속하려면 --yes`); process.exitCode = 2; return; }
        return out(r);
      }
      case 'spawn': {
        if (!rest[0]) throw new Error('폴더를 준다');
        const r = await c.call('session.spawn', { cwd: path.resolve(rest[0]), launcher: flags.launcher, name: flags.name, prompt: flags.prompt, model: flags.model, effort: flags.effort, permissionMode: flags.mode, kind: flags.kind, args: flags.args, allowHerdr: flags['allow-herdr'] ? true : undefined });
        if (JSONOUT) return out(r);
        console.log(`시작: ${r.name} (${r.kind}${r.flavor ? `/${r.flavor}` : ''}, ${r.sessionId}) 패널 ${r.paneId}${r.command ? `
  친 명령: ${r.command}` : ''}\n  신뢰 대화상자 예상: ${r.trust.needsTrust == null ? '예상하지 않음' : r.trust.needsTrust ? '뜬다' : `안 뜬다(신뢰한 폴더 ${r.trust.trustedBy})`}\n  실행: ${(r.argv || []).join(' ')}${r.resumeArgv ? `\n  이어 가기 등록: ${r.resumeArgv.join(' ')}` : ''}`);
        return;
      }
      case 'launchers': {
        const r = await c.call('launcher.list');
        if (JSONOUT) return out(r);
        const fav = r.favorites;
        const rows = [...r.launchers].sort((a, b) => (fav.includes(a.id) ? fav.indexOf(a.id) : 1e3) - (fav.includes(b.id) ? fav.indexOf(b.id) : 1e3));
        for (const l of rows) {
          const pv = l.preview || {};
          console.log(`${l.favorite ? `★${fav.indexOf(l.id) + 1}` : '  '} ${l.name.padEnd(16)} ${l.id.padEnd(10)} ${l.harness.padEnd(8)} ${pv.shell ? '(셸)' : pv.line}${pv.env && pv.env.length ? `  [env ${pv.env.join(', ')}]` : ''}`);
        }
        return;
      }
      case 'ls': {
        const l = await c.call('session.list');
        if (JSONOUT) return out(l);
        if (!l.length) console.log('(세션 없음)');
        const { workspaces, current } = await c.call('workspace.list');
        const pick = flags.ws ? workspaces.find((w) => w.key === flags.ws || w.name.toLowerCase() === String(flags.ws).toLowerCase()) : null;
        if (flags.ws && !pick) throw new Error(`없는 워크스페이스: ${flags.ws}`);
        for (const w of [...workspaces, { key: null, name: '(워크스페이스 없음)' }]) {
          const mine = l.filter((s) => (s.workspaceKey || null) === w.key);
          if ((pick && pick.key !== w.key) || (!mine.length && !w.key)) continue;
          console.log(`[${w.name}]${w.key === current ? ' *' : ''} ${w.root || ''}`);
          for (const s of mine) console.log('  ' + fmtSession(s).replace(/\n/g, '\n  '));
        }
        return;
      }
      // P5: 리포지토리 워크스페이스
      case 'ws': {
        const op = rest[0];
        if (op === 'open') return out(await c.call('workspace.open', { path: path.resolve(rest[1] || '.') }));
        if (op === 'select') return out(await c.call('workspace.select', { workspace: rest[1] }));
        if (op === 'close') { const r = await c.call('workspace.close', { workspace: rest[1], confirm: !!flags.yes, ...(flags.after ? { after: flags.after } : {}) }); if (r.needsConfirm) { console.log(`확인 필요: ${r.message}\n계속하려면 --yes`); process.exitCode = 2; return; } return out(r); }
        const r = await c.call('workspace.list');
        if (JSONOUT) return out(r);
        if (!r.workspaces.length) console.log('(워크스페이스 없음)');
        for (const w of r.workspaces) console.log(`${w.key === r.current ? '*' : ' '} ${w.name.padEnd(16)} 세션 ${w.counts.sessions}(셸 ${w.counts.shells}) 작업 중 ${w.counts.working} 내 차례 ${w.counts.needsYou} 검토 대기 ${w.counts.review}  ${w.kind === 'repo' ? '저장소' : '폴더'} ${w.root}`);
        return;
      }
      case 'get': return out(await c.call('session.get', { session: rest[0] }));
      case 'inbox': {
        const r = await c.call('inbox.list');
        if (JSONOUT) return out(r);
        console.log(`내 차례 ${r.needsYou.length}`); for (const s of r.needsYou) console.log('  ' + fmtSession(s).replace(/\n/g, '\n  '));
        console.log(`검토 대기 ${r.review.length}`); for (const s of r.review) console.log('  ' + fmtSession(s).replace(/\n/g, '\n  '));
        console.log(`문제 ${r.problems.length}`); for (const s of r.problems) console.log('  ' + fmtSession(s).replace(/\n/g, '\n  '));
        return;
      }
      case 'last': { const s = await c.call('session.get', { session: rest[0], screen: false }); console.log(JSONOUT ? JSON.stringify({ lastAnswer: s.lastAnswer, at: s.lastAnswerAt }) : `${s.name} 마지막 답 (${s.lastAnswerAt ? new Date(s.lastAnswerAt).toLocaleTimeString() : '-'}):\n${s.lastAnswer ?? '(없음)'}`); return; }
      case 'messages': { const r = await c.call('session.messages', { session: rest[0], afterSeq: flags.after !== undefined ? Number(flags.after) : -1 }); if (JSONOUT) return out(r); for (const m of r.messages) console.log(`#${m.seq} ${m.role.padEnd(11)} ${(m.text ?? `${m.tool} ${JSON.stringify(m.input)}`).replace(/\s+/g, ' ').slice(0, 160)}`); console.log(`(lastSeq ${r.lastSeq})`); return; }
      case 'events': { const r = await c.call('session.events', { session: rest[0], limit: Number(flags.limit || 40) }); if (JSONOUT) return out(r); for (const e of r) console.log(`${ts(e.t)} ${e.kind.padEnd(20)} ${JSON.stringify(e.data).slice(0, 220)}`); return; }
      case 'screen': { const r = await c.call('terminal.snapshot', { session: rest[0], format: flags.text ? 'text' : 'ansi' }); process.stdout.write(r.text + '\n'); return; }
      case 'send': {
        const targets = []; const words = [];
        for (const w of rest) (words.length === 0 && w.startsWith('@') ? targets : words).push(w);
        const r = await c.call('session.send', { target: targets, text: words.join(' '), workspace: flags.ws });
        if (!flags.wait) return out(r);
        await c.call('events.subscribe');
        for (const d of r.deliveries) console.log(`${ts()} 전달 ${d.name} ${d.deliveryId} ${d.status}`);
        const w = await waitDeliveries(c, r.deliveries.map((d) => d.deliveryId), Number(flags.timeout || 120) * 1000);
        if (w.timeout) console.log(`시간 초과: ${w.timeout.join(' ')}`);
        return;
      }
      case 'cancel': return out(await c.call('delivery.cancel', { deliveryId: rest[0] }));
      case 'deliveries': { const r = await c.call('delivery.list', { session: rest[0] }); if (JSONOUT) return out(r); for (const d of r) console.log(`${ts(d.createdAt)} ${d.deliveryId} ${String(d.name).padEnd(8)} ${d.status.padEnd(11)} ${d.reason || ''} 시도 ${d.attempts} ${d.confirmedAt ? `확인 +${d.confirmedAt - d.createdAt}ms` : ''}  "${d.text.replace(/\s+/g, ' ').slice(0, 50)}"`); return; }
      case 'answer': {
        const ch = rest[1];
        const p = { session: rest[0], choice: /^\d+$/.test(ch || '') ? Number(ch) : ch, text: flags.text, picks: flags.picks ? String(flags.picks).split(',').map(Number) : undefined };
        return out(await c.call('session.answer', p));
      }
      case 'seen': return out(await c.call('session.markSeen', { session: rest[0] }));
      case 'kill': {
        const r = await c.call('session.kill', { session: rest[0], confirm: !!flags.yes, after: flags.archive ? 'archive' : flags.delete ? 'delete' : undefined });
        if (r.needsConfirm) { console.log(`확인 필요: ${r.message}\n계속하려면 --yes`); process.exitCode = 2; return; }
        return out(r);
      }
      case 'trust': return out(await c.call('trust.predict', { cwd: path.resolve(rest[0] || '.') }));
      case 'board': return out(await c.call('board.get', { workspace: flags.ws }));
      // P3: 복귀 요약, 메모, 브리핑, 그룹, 묶음, 자원, 다른 곳의 세션
      case 'changes': {
        const r = await c.call('changes.since', { since: flags.minutes ? Date.now() - Number(flags.minutes) * 60000 : undefined });
        if (JSONOUT) return out(r);
        console.log(`${new Date(r.since).toLocaleTimeString()} 뒤 이벤트 ${r.events}개`);
        for (const l of r.lines) console.log(`  ${l.kind.padEnd(11)} ${l.name ? `@${l.name}` : ''}${l.count > 1 ? ` ×${l.count}` : ''} ${l.text}${l.stillOpen ? ' (아직 기다림)' : ''}`);
        return;
      }
      case 'brief': return out(await c.call('session.briefing', { session: rest[0] }));
      case 'res': return out(await c.call('resources.get', { fresh: true }));
      // P24(D4): 리포 단위 잠재우기·깨우기
      case 'sleep': return out(rest[0] ? await c.call('workspace.sleep', { workspace: rest[0] }) : await c.call('workspace.sleepIdle'));
      case 'wake': {
        if (!rest[0]) throw new Error('깨울 리포나 세션 이름을 준다: atrium wake <리포|이름>');
        const ws = await c.call('workspace.list');
        const isWs = ws.workspaces.some((w) => w.name.toLowerCase() === String(rest[0]).toLowerCase() || w.key === rest[0]);
        return out(isWs ? await c.call('workspace.wake', { workspace: rest[0] }) : await c.call('session.wake', { session: rest[0] }));
      }
      case 'sleep-status': return out(await c.call('sleep.status'));
      case 'devices': { // P48: 웹 화면에 짝 맺은 기기
        if (rest[0] === 'code') { const r = await c.call('device.code'); if (JSONOUT) return out(r); console.log(`짝 맺기 코드 ${r.code} (${new Date(r.expiresAt).toLocaleTimeString()}까지, 한 번만)`); return; }
        if (rest[0] === 'rm') return out(await c.call('device.revoke', { id: rest[1] }));
        const r = await c.call('device.list'); if (JSONOUT) return out(r);
        for (const d of r.devices) console.log(`${d.id}  ${d.name.padEnd(20)}  짝 맺음 ${ts(d.createdAt)}  마지막 ${d.lastSeenAt ? ts(d.lastSeenAt) : '-'}`);
        for (const q of r.requests) console.log(`허락 요청 ${q.id} ${q.name} 확인 ${q.check}`);
        if (!r.devices.length && !r.requests.length) console.log('짝 맺은 기기가 없다');
        return;
      }
      case 'clients': return out(await c.call('herdr.clients'));
      // P4: 세션끼리 연결, 에이전트 종류
      case 'links': {
        const ls = await c.call('link.list');
        if (JSONOUT) return out(ls);
        if (!ls.length) console.log('(연결 없음)');
        for (const l of ls) console.log(`${l.linkId} @${l.fromName} → @${l.toName}${l.role ? ` 역할="${l.role}"` : ''}${l.spawned ? ' [띄움]' : ''}${l.observed ? ' [시킴]' : ''} ${l.count}건${l.lastText ? `  마지막 지시 "${l.lastText.replace(/\s+/g, ' ').slice(0, 60)}"` : ''}${l.lastKind ? ` (${l.lastKind} ${ago(l.lastAt)} 전)` : ''}`);
        return;
      }
      case 'link': return out(await c.call('link.create', { from: rest[0], to: rest[1], role: flags.role }));
      case 'unlink': { const r = await c.call('link.delete', { link: rest[0], confirm: !!flags.yes }); if (r.needsConfirm) { console.log(`확인 필요: ${r.message}\n계속하려면 --yes`); process.exitCode = 2; return; } return out(r); }
      case 'linklog': {
        const r = await c.call('link.log', { link: rest[0] });
        if (JSONOUT) return out(r);
        console.log(`@${r.link.fromName} → @${r.link.toName}${r.link.role ? ` (${r.link.role})` : ''}`);
        for (const e of r.events) console.log(`${ts(e.t)} ${e.kind.padEnd(16)} ${(e.text || '').replace(/\s+/g, ' ').slice(0, 140)}${e.data ? `  ${JSON.stringify(e.data).slice(0, 120)}` : ''}`);
        return;
      }
      case 'kinds': { const ks = await c.call('agent.kinds'); if (JSONOUT) return out(ks); for (const k of ks) console.log(`${k.kind.padEnd(12)} ${k.installed ? `깔림 ${k.path}` : '-'}`); return; }
      case 'call': return out(await c.call(rest[0], rest[1] ? JSON.parse(rest[1]) : {}));
      // P7: 세션 되찾기(닫힌 세션, 판 밖 대화)
      case 'closed': {
        const r = await c.call('recall.closed', { workspace: flags.ws });
        if (JSONOUT) return out(r);
        if (!r.length) console.log('(닫힌 세션 없음)');
        for (const x of r) console.log(`${x.name.padEnd(10)} ${String(x.kind).padEnd(7)} ${ts(x.closedAt)} ${String(x.reasonLabel || '').padEnd(14)} ${x.binding && x.binding.bound ? `[${x.binding.label}]` : '열 수 있음'}  ${x.sessionId}`);
        return;
      }
      case 'reopen': return out(await c.call('recall.reopen', { session: rest[0], model: flags.model }));
      case 'dismiss': return out(await c.call('recall.dismiss', { session: rest[0] }));
      // P10: 보관. 대화 ID(UUID)면 판 밖 대화, 아니면 닫힌 세션의 이름이나 ID
      case 'archive': {
        if (flags.old) return out(await c.call('archive.old', { workspace: flags.ws, days: flags.days != null ? Number(flags.days) : undefined, confirm: !!flags.yes }));
        return out(await c.call('archive.add', /^[0-9a-f-]{36}$/i.test(rest[0] || '') ? { convo: rest[0] } : { session: rest[0] }));
      }
      case 'unarchive': return out(await c.call('archive.restore', /^[0-9a-f-]{36}$/i.test(rest[0] || '') ? { convo: rest[0] } : { session: rest[0] }));
      case 'archived': {
        const r = await c.call('archive.list', { workspace: flags.ws });
        if (JSONOUT) return out(r);
        for (const w of r.workspaces) {
          console.log(`${w.name} (보관 ${w.archived})`);
          for (const x of w.closed) console.log(`  세션 ${x.name.padEnd(10)} ${ts(x.closedAt)} ${x.archive.why === 'auto' ? '저절로' : '손으로'}  ${x.sessionId}`);
          for (const x of w.convos) console.log(`  대화 ${x.convId}  ${ts(x.lastAt)} ${x.archive.why === 'auto' ? '저절로' : '손으로'}  ${String(x.title || '').replace(/\s+/g, ' ').slice(0, 60)}`);
        }
        return;
      }
      case 'convos': {
        const r = await c.call('convo.list', { workspace: flags.ws, refresh: true });
        if (JSONOUT) return out(r);
        if (!r.length) console.log('(판 밖 대화 없음)');
        for (const x of r) console.log(`${x.convId}  ${ts(x.lastAt)} ${(x.binding.bound ? `[${x.binding.label}]` : '열 수 있음').padEnd(20)} ${x.branch ? `⎇ ${x.branch} ` : ''}${String(x.title || '').replace(/\s+/g, ' ').slice(0, 70)}`);
        return;
      }
      case 'open-convo': return out(await c.call('convo.open', { convo: rest[0], model: flags.model }));
      // P13: 캔버스의 판 밖 대화 노드와 띄움 선, 분류별 수, missed(지울 대화) 보기와 지우기(휴지통)
      case 'convo-nodes': {
        const r = await c.call('convo.nodes');
        if (JSONOUT) return out(r);
        for (const n of r.nodes) console.log(`${n.convId}  ${String(n.wsName || n.workspaceKey).padEnd(16)} ${n.block ? `⎇ ${n.block} `.padEnd(12) : ''.padEnd(12)} (${n.x},${n.y}) 하위 ${n.subagents} ${n.binding && n.binding.open ? `[${n.binding.label}] ` : ''}${n.spawnedBy ? `띄운 곳 ${n.spawnedBy.onCanvas ? '(선)' : n.spawnedBy.label} ` : ''}${String(n.title || '').replace(/\s+/g, ' ').slice(0, 50)}`);
        for (const e of r.edges) console.log(`선 ${e.from} → ${e.to} (${e.via}${e.name ? ` ${e.name}` : ''}, ${e.by})`);
        return;
      }
      case 'classify': return out(await c.call('convo.classify'));
      case 'missed': {
        const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round((n || 0) / 1024))}KB`);
        if (rest[0] === 'rm') {
          const scope = flags.all ? { all: true } : flags.folder ? { folder: path.resolve(String(flags.folder)) } : { convos: rest.slice(1) };
          const r = await c.call('missed.delete', { ...scope, confirm: !!flags.yes });
          if (r.needsConfirm) { console.log(`확인 필요: ${r.message}`); for (const f of r.folders || []) console.log(`  ${f.folder}  ${f.count}개 ${mb(f.bytes)}`); console.log('계속하려면 --yes'); process.exitCode = 2; return; }
          return out(r);
        }
        const r = await c.call('missed.list', { titles: !flags.json ? true : undefined });
        if (JSONOUT) return out(r);
        console.log(`missed(지울 대화) ${r.count}개, ${mb(r.bytes)}`);
        for (const g of r.folders) {
          console.log(`${g.folder}  [${g.why}] ${g.count}개 ${mb(g.bytes)} ${ts(g.lastAt)}`);
          for (const x of g.items) console.log(`  ${x.convId}  ${ts(x.lastAt)} ${(x.size / 1024).toFixed(0)}KB  ${String(x.title || '').replace(/\s+/g, ' ').slice(0, 50)}`);
        }
        return;
      }
      // P34: 데스크톱 앱 세션 가져오기
      case 'import-desktop': {
        const LABEL = { new: '새것', imported: '이미 옮김', more: '옮긴 뒤 더 씀', onBoard: '이미 판 세션', noTranscript: '기록 없음', noFolder: '폴더 없음' };
        const one = (t) => String(t || '').replace(/\s+/g, ' ').slice(0, 50);
        if (flags.all || rest.length) {
          const r = await c.call('desktop.import', flags.all ? { all: true } : { ids: rest });
          if (JSONOUT) return out(r);
          console.log(`가져옴 ${r.imported.length}, 건너뜀 ${r.skipped.length} (고른 것 ${r.total})`);
          for (const x of r.imported) console.log(`  + @${x.name}  ${x.gen}세대  ${x.folder === 'repo' ? '저장소 폴더에서 ' : ''}${x.cwd}  ${one(x.title)}${x.running ? '  (앱에서 도는 중: 진행 중인 턴은 빠질 수 있다)' : ''}${x.replaced.length ? `  [호출자 값으로: ${x.replaced.join(', ')}]` : ''}`);
          for (const x of r.skipped) console.log(`  - ${x.appSessionId}  ${x.reason}${x.message ? ` (${x.message})` : ''}  ${one(x.title)}`);
          return;
        }
        const r = await c.call('desktop.list');
        if (JSONOUT) return out(r);
        console.log(`데스크톱 앱 세션 ${r.total}개(보관 제외), 기본 고름 ${r.picked}, 지금 도는 것 ${r.running}`);
        for (const g of r.repos) {
          console.log(`${g.name || '(폴더 모름)'}  ${g.root || ''}`);
          for (const x of g.items) console.log(`  ${x.pick ? '[x]' : '[ ]'} ${x.appSessionId}  ${(LABEL[x.status] || x.status).padEnd(8)} ${x.running ? '도는 중 ' : ''}${ts(x.lastActivityAt)}  ${one(x.title)}${x.folder === 'repo' ? '  (워크트리 없음 → 저장소 폴더)' : ''}${x.more ? `  (+지시 ${x.more.prompts}, 답 ${x.more.answers})` : ''}`);
        }
        return;
      }
      // P8: 가지 펼치기의 나무
      case 'tree': {
        const r = await c.call('branch.tree');
        if (JSONOUT) return out(r);
        console.log(`하위 세션 ${r.total}개(상한 없음, P36)`);
        const kids = (id) => r.rows.filter((x) => x.parentSessionId === id);
        const walk = (x, ind) => { console.log(`${'  '.repeat(ind)}@${x.name} ${x.depth}단계 ${x.state}${x.role ? ` "${x.role}"` : x.parentSessionId ? ' (판에 올림)' : ''}`); for (const k of kids(x.sessionId)) walk(k, ind + 1); };
        for (const x of r.rows.filter((y) => !y.parentSessionId || !r.rows.some((z) => z.sessionId === y.parentSessionId))) walk(x, 0);
        return;
      }
      // P6a: 단일 캔버스
      case 'search': {
        const r = await c.call('search.query', { q: rest.join(' '), limit: Number(flags.limit || 20) });
        if (JSONOUT) return out(r);
        if (!r.results.length) console.log('(없음)');
        for (const x of r.results) console.log(`${x.kind === 'workspace' ? '[워크스페이스]' : '@' + x.name.padEnd(12)} ${x.label.padEnd(6)} ${x.snippet}${x.hits > 1 ? `  (+${x.hits - 1})` : ''}`);
        return;
      }
      case 'dock': {
        if (rest[0] === 'rm') return out(await c.call('dock.remove', { session: rest[1] }));
        if (rest[0] === 'layout') return out(await c.call('dock.layout', { preset: rest[1], members: rest.slice(2) })); // P17 배치 틀
        return out(await c.call('dock.attach', { session: rest[0], to: rest[1], side: flags.side || 'right', ...(flags.at ? { at: flags.at } : {}) }));
      }
      case 'size': return out(await c.call('board.setSize', { session: rest[0], size: rest[1], scope: flags.dock ? 'dock' : undefined }));
      case 'arrange': {
        if (flags.all) { // P31: 판 전체(영역도 다시 놓는다)
          const r = await c.call('board.arrange', { all: true, apply: !!flags.apply, undo: !!flags.undo });
          if (JSONOUT || r.undone) return out(r);
          for (const g of r.regions) console.log(`영역 ${g.key.padEnd(40)} (${g.from.x},${g.from.y}) → (${g.to.x},${g.to.y}) ${g.to.w}x${g.to.h}`);
          console.log(r.applied ? '적용했다(arrange --all --undo로 한 번 되돌린다)' : '미리 보기(--apply로 적용)');
          return;
        }
        const ws = (await c.call('workspace.list')).workspaces.find((w) => w.key === rest[0] || w.name.toLowerCase() === String(rest[0] || '').toLowerCase());
        if (!ws) throw new Error(`없는 워크스페이스: ${rest[0]}`);
        const r = await c.call('board.arrange', { workspace: ws.key, apply: !!flags.apply, undo: !!flags.undo });
        if (JSONOUT || r.undone) return out(r);
        for (const b of r.plan) console.log(`${b.kind.padEnd(5)} ${b.names.map((n) => '@' + n).join(' ').padEnd(24)} (${Math.round(b.from.x)},${Math.round(b.from.y)} ${b.from.w}x${b.from.h}) → (${Math.round(b.to.x)},${Math.round(b.to.y)} ${b.to.w}x${b.to.h})${b.to.size ? ' ' + b.to.size : ''}`);
        console.log(r.applied ? '적용했다(arrange --undo로 한 번 되돌린다)' : '미리 보기(--apply로 적용)');
        return;
      }
      case 'watch': {
        const r = await c.call('events.subscribe');
        console.log(`${ts()} 구독함. 세션 ${r.sessions.length}개`);
        for (const s of r.sessions) console.log(fmtSession(s));
        c.on((ev, d) => {
          if (JSONOUT) return console.log(JSON.stringify({ t: Date.now(), ev, d }));
          if (ev === 'session.state') console.log(`${ts()} ${d.name.padEnd(8)} ${String(d.from)} → ${d.to}  (${d.cause || ''})${d.to === 'waiting' ? `  ${fmtAsk(d.summary.ask)}` : ''}${d.to === 'exited' ? `  ${JSON.stringify(d.summary.exit)}` : ''}`);
          else if (ev === 'session.hook') console.log(`${ts()} ${d.name.padEnd(8)}   hook ${d.ev}${d.tool ? `(${d.tool})` : ''} auth=${d.authOk}${d.prompt ? ` prompt="${d.prompt.slice(0, 60)}"` : ''}${d.lastAnswer ? ` 답="${d.lastAnswer.replace(/\s+/g, ' ').slice(0, 60)}"` : ''}${d.reason ? ` reason=${d.reason}` : ''}${d.ask ? `  ${fmtAsk(d.ask)}` : ''}`);
          else if (ev === 'delivery') console.log(`${ts()} ${String(d.name).padEnd(8)}   전달 ${d.deliveryId} ${d.status}${d.reason ? `(${d.reason})` : ''}`);
          else if (ev === 'herdr') console.log(`${ts()} herdr ${d.connected ? '연결됨' : '끊김'}${d.expected ? '(직접 끔)' : ''}`);
          else if (ev === 'session.created' || ev === 'session.removed') console.log(`${ts()} ${ev} ${d.name}${d.reason ? ` (${d.reason})` : ''}${d.adopted ? ' (판에 올림)' : ''}`);
          else if (featureEvent(ev, d, ts)) return;
          else if (ev === 'link.event') console.log(`${ts()} 연결 ${d.linkId} ${d.kind}${d.text ? ` "${d.text.replace(/\s+/g, ' ').slice(0, 80)}"` : ''}`);
        });
        if (flags.seconds) { await sleep(Number(flags.seconds) * 1000); return; }
        await new Promise(() => {});
        return;
      }
      case 'attach': case 'input': {
        const cols = Number(flags.cols || 120), rows = Number(flags.rows || 40);
        const frames = [];
        let screen = ''; let fw = cols, fh = rows;
        c.on((ev, d) => {
          if (ev === 'terminal.frame') {
            const bytes = Buffer.from(d.bytes, 'base64').toString('utf8');
            frames.push({ seq: d.seq, full: d.full, w: d.width, h: d.height, bytes: bytes.length });
            if (d.full) { screen = bytes; fw = d.width; fh = d.height; } else screen += bytes;
            if (flags.raw) process.stdout.write(bytes);
            else if (cmd === 'attach') console.log(`${ts()} frame seq=${d.seq} full=${d.full} ${d.width}x${d.height} ${bytes.length}B`);
          } else if (ev === 'terminal.detached') console.log(`${ts()} 놓임: ${d.reason}`);
        });
        const a = await c.call('terminal.attach', { session: rest[0], cols, rows });
        if (!flags.raw) console.log(`${ts()} 붙음: 제어기 pid=${a.controllerPid} 패널 ${a.paneId} ${cols}x${rows}`);
        await sleep(600);
        const text = cmd === 'input' ? rest.slice(1).join(' ') : flags.input;
        if (text) { await c.call('terminal.input', { session: rest[0], data: unescape(text) }); console.log(`${ts()} 입력 보냄 ${JSON.stringify(unescape(text))}`); }
        await sleep(Number(flags.seconds || (cmd === 'input' ? 1.5 : 3)) * 1000);
        await c.call('terminal.detach', { session: rest[0] }).catch(() => {});
        if (!flags.raw) {
          console.log(`프레임 ${frames.length}개, 전체 프레임 ${frames.filter((f) => f.full).length}개, 합계 ${frames.reduce((x, f) => x + f.bytes, 0)}B`);
          if (cmd === 'attach') console.log(`--- 받은 프레임을 쌓아 그린 화면(대충) ---\n${roughText(screen, fw, fh).split('\n').slice(-Number(flags.lines || 14)).join('\n')}`);
        }
        await sleep(300);
        return;
      }
      default: if (await featureCommand(cmd, rest, { c, flags, out, ts, json: JSONOUT })) return; throw new Error(`모르는 명령: ${cmd}\n${HELP}`);
    }
  } finally { c.close(); }
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(`atrium: ${e.message}`); process.exit(1); });
