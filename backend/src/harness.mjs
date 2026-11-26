// P115: 하네스 어댑터 표. 판이 띄우는 Claude Code 밖의 에이전트 하네스(codex, opencode, pi, 터미널이 아는 그 밖의 종류)를
// 판과 말하게(env, PATH의 atrium, 안내문) 띄우고, 이어 가기·되살리기에서 같은 값으로 돌아오게 한다.
// 모양은 터미널 백엔드와 상관없다: 판은 { command, args, env, pathFirst, files }를 만들고, 터미널 백엔드가 env와 PATH를 준다
// (herdr-core: terminal.run의 env. 실험은 docs/log/p115-harness-common.md 1단계).
// Claude Code는 이 표를 쓰지 않는다. 세션 설정 파일(--settings)·플러그인·hook 길(launch.mjs)이 그대로다.
// 이어 갈 때 다시 줄 것(mustRePass)은 실험에서 빠지면 무엇이 깨지는지 본 목록이다. 판은 이어 가기·되살리기마다 처음과 같은 값을 다시 준다.
import fs from 'node:fs';
import path from 'node:path';
import { codexHomeOf } from './codex-models.mjs';

// 하네스와 상관없는 안내문(한 줄). 줄바꿈·큰따옴표 없이: Codex는 -c 값으로 받고, 판은 이것을 패널에 한 줄로 친다
// P116: 일 시키기·기다리기·읽기는 판의 atrium 명령이다(터미널 백엔드와 상관없다). 터미널 명령을 직접 쓰라고 하지 않는다
export const HARNESS_PROMPT = [
  '너는 Atrium 보드가 띄운 세션 안에서 돈다.',
  '보드와 말할 때는 셸에서 atrium 명령을 쓴다. 자세한 사용법이 필요할 때만 `atrium help`를 본다(기계용 계약은 `atrium help --json`).', // P169: 시작하자마자 help를 치지 않게(맥락 약 2,700토큰)
  '일을 맡길 때는 `atrium prompt <이름> <따옴표로 묶은 할 일>`로 맡기고 턴을 끝낸다. 하위가 `atrium done`으로 닫으면 보드가 그 보고를 가져다주고 보고 없이 멈추면 알린다. 화면은 `atrium read <이름>`(이름은 보드의 세션 이름). 다른 에이전트에게는 이 명령으로만 보낸다. 맡은 일은 끝나면 `atrium done ok|failed <보고>`로 닫고 쉰다. 사람이 결과를 물어도 폴링하지 말고 보고가 오면 전한다(--wait·`atrium wait`는 꼭 필요할 때만).', // P143, P181: 맡기고 턴을 끝낸다
  '하위 세션(워커)은 `atrium child`, 부모·하위 세션·역할 연결의 지금 기록은 `atrium me`, 띄울 수 있는 모델은 `atrium models`.',
  // macOS 판: 하위 세션 규칙(사용자 결정 2026-11-18). 모델은 보드 기본(opus·sol), 추론은 high가 기본, 작은 일은 낮춘다. 토큰을 아낀다
  '일이 서로 기다리지 않는 조각 여럿으로 나뉘면 스스로 `atrium child <이름> --prompt <지시>`로 워커를 띄운다. 모델은 빼면 보드 기본(Codex는 sol, Claude는 opus)이고 추론은 high가 기본이다. 범위가 분명한 구현은 --effort medium, 파일 만들기·찾기·요약 같은 작은 일은 --effort low.',
  '앱 조작은 cua MCP(별도 커서, 사람의 커서를 뺏지 않는다), 웹은 ego-browser 스킬로 한다. 사람의 커서를 가져가는 Computer Use는 쓰지 않는다. 사이트의 이용약관·동의·쿠키 창은 누르지 않고 멈춰 사람에게 묻고, 사이트가 정한 입력 제한(형식·범위)을 브라우저에서 고쳐 피하지 않는다.',
  '토큰은 대부분 길어진 대화를 다시 읽는 데 든다. 국소 작업마다 새 워커를 띄우고 결과를 받으면 atrium child-kill로 닫는다. 큰 파일 읽기·검색은 워커에게 시키고 요약만 받으며, 보고는 짧게 받는다. 만든 워커에게 반려 고침을 이어 시키지 말고 새 고침 워커(--effort medium)에게 맡기며, 검토는 두 차수까지 한다.',
  '[Atrium 보드]로 시작하는 글은 보드가 알려 주는 연결(어느 에이전트가 너의 무슨 역할인지)이다.',
].join(' ');

const hexOf = (id) => String(id || '').toLowerCase().replace(/[^0-9a-f]/g, '');
// 연결(connections.mjs)의 하네스 안 제공자 ID. 연결 ID에서 만들어 이어 가기에서도 같다(Codex·pi 세션은 이 ID를 기억한다)
export const providerIdOf = (c) => `atrium_${c.id}`;
const isAnthropic = (p) => p === 'anthropic-messages';
// 연결의 모델 목록(판이 읽은 것) + 런처의 모델
const modelsFor = (ctx) => [...new Set([...(ctx.connectionModels || []), ...(ctx.model ? [ctx.model] : [])])].filter(Boolean);
// opencode의 제공자 패키지(설정의 package)
const OPENCODE_PACKAGE = { 'openai-chat': '@ai-sdk/openai-compatible', 'openai-responses': '@ai-sdk/openai', 'anthropic-messages': '@ai-sdk/anthropic' };
// pi 확장의 api 값
const PI_API = { 'openai-chat': 'openai-completions', 'openai-responses': 'openai-responses', 'anthropic-messages': 'anthropic-messages' };
// pi 확장 파일(판 데이터 폴더). 연결 + 모델 목록에서 만든다. 키는 환경 변수 이름만($이름). 키가 없는 연결은 아무 글자(pi가 키 칸을 요구한다)
export function piExtensionText(c, models) {
  const def = { name: c.name, baseUrl: c.baseUrl, apiKey: c.auth && c.auth.env ? `$${c.auth.env}` : 'atrium-no-key', api: PI_API[c.protocol], models: models.map((id) => ({ type: 'chat', id, name: id, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 })) };
  return `// Atrium 보드가 만든 pi 확장: 연결 ${JSON.stringify(c.name)}을 제공자로 등록한다. 보드가 다시 만든다(고치지 않는다)\nexport default function (pi) {\n  pi.registerProvider(${JSON.stringify(providerIdOf(c))}, ${JSON.stringify(def, null, 2)});\n}\n`;
}
// Claude Code의 연결: 세션 설정 파일의 env(ANTHROPIC_BASE_URL)와 apiKeyHelper(키는 env 이름에서 그때 읽는다. 값은 설정 파일에 쓰지 않는다)
export function claudeConnection(c, { node = process.execPath } = {}) {
  if (!c) return { env: {}, settings: {} };
  const helper = c.auth && c.auth.env ? `"${String(node).split('\\').join('/')}" -e "process.stdout.write(process.env.${c.auth.env}||'')"` : null;
  return { env: { ANTHROPIC_BASE_URL: c.baseUrl }, settings: helper ? { apiKeyHelper: helper } : {} };
}

// 하네스 어댑터. build(ctx) → { args(명령 낱말 뒤), env, files: [{ file, text }], harnessSessionId, resumed }
// ctx: { sessionId(판 세션 ID), resume, harnessSessionId(알면), model, launcherArgs, instructions: { file, text }, connection, connectionModels, filesDir }
// protocols: 그 하네스가 직접 쓰는 연결 프로토콜(1단계 E3에서 붙는 것을 본 것). 맞지 않는 연결을 고른 런처는 저장하지 않는다
// reserved: 판이 정하므로 호출자 추가 인자·실행 명령에 두지 못하는 것. sessionIdFrom: board(판이 정한 ID로 만들고 이어 간다) | learned(뜬 뒤에 안다)
export const ADAPTERS = {
  codex: {
    command: 'codex',
    sessionIdFrom: 'learned', // 터미널이 아는 agent_session 또는 Codex rollout 파일(codexSessionOf)
    protocols: ['openai-responses'], // wire_api = "chat"은 설정을 읽을 때 거부한다(1단계 E3)
    mustRePass: ['connection', 'instructions'], // 연결 -c를 빼면 "Model provider unavailable"에서 막힌다. 지시문은 rollout에 남지만 다시 준다(실험 E2·E3)
    reserved: { flags: ['resume', 'fork'], configKeys: ['developer_instructions', 'check_for_update_on_startup', 'model_provider', 'model_providers'] },
    modelArgs: (m) => ['-m', m],
    build(ctx) {
      const resumed = !!(ctx.resume && ctx.harnessSessionId);
      const fork = !resumed && ctx.forkFrom ? ctx.forkFrom : null; // P133: Codex 앱 대화를 갈라 연다(원본은 그대로, 새 대화 ID는 뜬 뒤에 안다)
      const c = ctx.connection; const pid = c ? providerIdOf(c) : null;
      // 연결: 세션 단위 -c로 제공자를 정의한다(사용자 config.toml은 고치지 않는다). 키는 env_key(변수 이름)
      const conn = c ? ['-c', `model_provider=${pid}`, '-c', `model_providers.${pid}.name=${c.name}`, '-c', `model_providers.${pid}.base_url=${c.baseUrl}`, '-c', `model_providers.${pid}.wire_api=responses`, ...(c.auth && c.auth.env ? ['-c', `model_providers.${pid}.env_key=${c.auth.env}`] : [])] : [];
      // 시작할 때 업데이트 확인을 끈다(새 버전이 있으면 "Update now" 선택 창이 떠서 판의 첫 요청과 Enter가 그 창에 들어간다. 1단계 뒤 확인)
      const args = [...(resumed ? ['resume', ctx.harnessSessionId] : fork ? ['fork', fork] : []), '-c', 'check_for_update_on_startup=false', ...conn, ...(ctx.model ? ['-m', ctx.model] : []), ...(ctx.instructions ? ['-c', `developer_instructions=${ctx.instructions.text}`] : []), ...(ctx.launcherArgs || []), ...(resumed && ctx.effort ? ['-c', `model_reasoning_effort=${ctx.effort}`] : [])]; // P227: 이어 갈 때 지금 노력 수준(호출자 인자 뒤: 뒤의 -c가 이긴다)
      return { args, env: {}, files: [], harnessSessionId: resumed ? ctx.harnessSessionId : null, resumed };
    },
    // 판의 인자 없이 뜬 이어 가기(`codex resume <id>`, 옛 터미널이 스스로 띄움)인가. 판이 친 줄인가
    isBoardLine: (argv) => argv.some((a) => String(a).startsWith('developer_instructions=')),
  },
  opencode: {
    command: 'opencode',
    sessionIdFrom: 'board', // -s <id>는 없으면 그 ID로 만든다(1단계 뒤 확인)
    protocols: ['openai-chat', 'openai-responses', 'anthropic-messages'], // 설정의 package로(1단계 E3)
    mustRePass: ['connection', 'instructions'], // 연결 설정 없이 이어 가면 모델이 "(unavailable)". 지시문은 세션에 저장되지만 다시 준다. 설정은 env(OPENCODE_CONFIG_CONTENT)로만 들어간다
    reserved: { flags: ['--standalone', '--server', '-s', '--session', '-c', '--continue', '--fork', '--prompt'] },
    modelArgs: () => [], // 대화형에는 --model이 없다. 설정(OPENCODE_CONFIG_CONTENT)의 model로 준다
    build(ctx) {
      const sid = `ses_${hexOf(ctx.sessionId)}`;
      const c = ctx.connection; const pid = c ? providerIdOf(c) : null;
      const models = c ? modelsFor(ctx) : [];
      // 연결: 설정의 providers.<id>(package, settings.baseURL, env, models). 사용자 제공자는 모델을 손으로 적으므로 판이 연결에서 읽은 목록을 채운다
      const providers = c ? { [pid]: { name: c.name, package: OPENCODE_PACKAGE[c.protocol], settings: { baseURL: isAnthropic(c.protocol) ? `${c.baseUrl}/v1` : c.baseUrl }, ...(c.auth && c.auth.env ? { env: [c.auth.env] } : {}), models: Object.fromEntries(models.map((m) => [m, { name: m }])) } } : null;
      const model = c ? (ctx.model || models[0] ? `${pid}/${ctx.model || models[0]}` : null) : ctx.model || null;
      const config = { ...(providers ? { providers } : {}), ...(ctx.instructions ? { instructions: [ctx.instructions.file] } : {}), ...(model ? { model } : {}) };
      // 판이 띄우는 opencode는 늘 --standalone(세션마다 설정과 env. 사용자의 공유 서버는 쓰지 않는다)
      return { args: ['--standalone', '-s', sid, ...(ctx.launcherArgs || [])], env: Object.keys(config).length ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) } : {}, files: [], harnessSessionId: sid, resumed: !!ctx.resume };
    },
    isBoardLine: (argv) => argv.includes('--standalone'),
  },
  pi: {
    command: 'pi',
    sessionIdFrom: 'board', // --session-id <id>는 이 폴더에 그 ID가 있으면 이어 가고 없으면 만든다(1단계 뒤 확인)
    protocols: ['openai-chat', 'openai-responses', 'anthropic-messages'], // 확장의 api로(1단계 E3)
    // 연결 확장(-e)을 빼면 pi는 막히지 않고 사용자 env에 키가 있는 다른 제공자로 넘어간다(실험 E3). 판은 연결이 있는 세션을 -e 없이 띄우지 않는다
    mustRePass: ['extension', 'instructions'], // 이어 갈 때 --append-system-prompt를 빼면 안내문이 빠진다(실험 E2)
    reserved: { flags: ['--session', '--session-id', '-c', '--continue', '-r', '--resume', '--fork', '--no-session', '--session-dir', '-p', '--print', '--mode', '--provider'] },
    modelArgs: (m) => ['--model', m],
    build(ctx) {
      const sid = ctx.sessionId;
      const c = ctx.connection;
      const files = [];
      let ext = [];
      if (c) {
        if (!ctx.filesDir) throw Object.assign(new Error('pi 연결 확장 파일을 둘 폴더가 없어 띄우지 않았습니다.'), { code: 'pi_extension_missing', key: 'connections.err.piExtension' });
        const file = path.join(ctx.filesDir, `pi-${c.id}.mjs`).split('\\').join('/');
        files.push({ file, text: piExtensionText(c, modelsFor(ctx)) });
        ext = ['-e', file];
      }
      const model = c ? (ctx.model ? (String(ctx.model).startsWith(`${providerIdOf(c)}/`) ? ctx.model : `${providerIdOf(c)}/${ctx.model}`) : null) : ctx.model || null; // P227: 이어 갈 지금 값은 이미 제공자/모델 꼴
      const args = ['--session-id', sid, ...ext, ...(model ? ['--model', model] : []), ...(ctx.instructions ? ['--append-system-prompt', ctx.instructions.file] : []), ...(ctx.launcherArgs || [])];
      return { args, env: {}, files, harnessSessionId: sid, resumed: !!ctx.resume };
    },
    isBoardLine: (argv) => argv.includes('--session-id'),
  },
};
// 표에 없는 종류(터미널이 아는 그 밖의 하네스): env와 PATH만 주고 지시문·이어 가기는 없다. 모델은 -m(P96과 같다)
const GENERIC = {
  command: null, sessionIdFrom: null, protocols: [], mustRePass: [], reserved: { flags: [] }, modelArgs: (m) => ['-m', m],
  build: (ctx) => ({ args: [...(ctx.model ? ['-m', ctx.model] : []), ...(ctx.launcherArgs || [])], env: {}, files: [], harnessSessionId: null, resumed: false }),
  isBoardLine: () => true,
};
export const adapterOf = (kind) => (kind && kind !== 'claude' && kind !== 'shell' ? ADAPTERS[kind] || { ...GENERIC, command: kind } : null);
// 판이 이어 갈 수 있는 종류인가(되살리기·다시 열기)
export const resumable = (kind) => !!(ADAPTERS[kind] && ADAPTERS[kind].sessionIdFrom);
// 판이 띄우고 다시 띄울 값을 남긴(P115 뒤) 하네스 세션인가
export const harnessResumable = (s) => !!s && (s.origin || 'board') === 'board' && resumable(s.kind) && !!s.harnessPlan;

// 호출자 추가 인자·실행 명령에 판이 정하는 인자가 있는가 → 그 인자 | null
export function reservedArg(kind, words = []) {
  const a = adapterOf(kind);
  if (!a) return null;
  const flags = new Set(a.reserved.flags || []);
  const keys = a.reserved.configKeys || [];
  for (let i = 0; i < words.length; i++) {
    const w = String(words[i]); const flag = w.split('=')[0];
    if (flags.has(flag)) return w;
    if (keys.length && (w === '-c' || w === '--config') && keys.some((k) => String(words[i + 1] || '').trim().startsWith(`${k}=`))) return `${w} ${words[i + 1]}`;
    if (keys.length && (w.startsWith('--config=') || (w.startsWith('-c') && w.length > 2)) && keys.some((k) => w.replace(/^(--config=|-c)/, '').startsWith(`${k}=`))) return w;
  }
  return null;
}

// 그 하네스가 쓰는 연결 프로토콜(claude는 Anthropic messages)
export const protocolsOf = (kind) => (kind === 'claude' ? ['anthropic-messages'] : (adapterOf(kind) || {}).protocols || []);
// 띄울 값 → 터미널 백엔드에 넘길 값. o: { kind, startWords, sessionId, resume, harnessSessionId, model, launcherArgs, instructions, boardEnv, binDir, connection, connectionModels, filesDir }
// → { command: [낱말], args, env(판의 env + 하네스 env), pathFirst: [폴더], files, harnessSessionId, resumed }
export function harnessLaunch(o) {
  const a = adapterOf(o.kind);
  if (!a) throw Object.assign(new Error(`하네스가 아닙니다: ${o.kind}`), { code: 'bad_request' });
  if (o.connection && !protocolsOf(o.kind).includes(o.connection.protocol)) throw Object.assign(new Error(`${o.kind}는 연결 프로토콜 ${o.connection.protocol}을 쓰지 않습니다.`), { code: 'connection_protocol', key: 'connections.err.protocolMismatch', vars: { harness: o.kind, protocol: o.connection.protocol } });
  const r = a.build({ sessionId: o.sessionId, resume: !!o.resume, harnessSessionId: o.harnessSessionId || null, model: o.model || null, effort: o.effort || null, launcherArgs: o.launcherArgs || [], instructions: a === GENERIC || !ADAPTERS[o.kind] ? null : o.instructions || null, connection: o.connection || null, connectionModels: o.connectionModels || [], filesDir: o.filesDir || null, forkFrom: o.forkFrom || null, statusLine: o.statusLine || null }); // P211: statusLine(AGY 상태 줄 명령 만들기)
  // P115: 연결이 있는 pi는 -e 없이 띄우지 않는다(빠지면 pi가 조용히 다른 실제 제공자로 넘어간다)
  if (o.kind === 'pi' && o.connection && !r.args.includes('-e')) throw Object.assign(new Error('pi 연결 확장(-e)이 없어 띄우지 않았습니다.'), { code: 'pi_extension_missing', key: 'connections.err.piExtension' });
  const command = o.startWords && o.startWords.length ? [...o.startWords] : [a.command];
  return { command, args: r.args, env: { ...(o.boardEnv || {}), ...r.env }, pathFirst: o.binDir ? [o.binDir] : [], files: r.files, harnessSessionId: r.harnessSessionId, resumed: r.resumed };
}
export function writeLaunchFiles(files = []) {
  for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text); }
}

// Codex 세션 ID: 그 폴더(cwd)에서 since 뒤에 생긴 rollout(첫 줄 session_meta의 id·cwd). 터미널이 세션 ID를 모를 때만
// 오늘·어제 폴더만 본다. 첫 줄 앞부분만 읽는다(첫 줄에 기본 지시문이 들어 길다). 읽기만 한다
// P133: exclude(갈라 연 원본·다른 판 세션이 가진 대화 ID)는 답에서 뺀다. forkedFrom: 문자열이면 그 대화를 갈라 연 rollout(session_meta의 forked_from_id)만,
//   null이면 갈라 연 것이 아닌 것만, undefined면 가리지 않는다. bornOnly: since 뒤에 생긴 파일만(그새 기록된 옛 대화는 빼고)
// macOS 판(버그 고침): 맞는 rollout이 둘 이상이면(같은 폴더에서 판 밖 Codex도 그즈음 떴다) 고르지 않고 null을 준다(unique). 가장 가까운 것을 고르면
//   사람이 판 밖에서 쓰는 다른 대화를 이어 가거나 판 세션의 것으로 가져갈 수 있다. 판은 정확한 ID만 쓴다(터미널이 아는 ID, 처음 하나뿐일 때 배운 ID)
export function codexSessionOf({ cwd, since = 0, home = codexHomeOf(), now = Date.now(), exclude = [], forkedFrom = undefined, bornOnly = false, unique = true } = {}) {
  const want = path.resolve(String(cwd || '')).toLowerCase().replace(/[\\/]+$/, '');
  const days = [0, 1].map((d) => new Date(now - d * 86400000));
  const found = [];
  for (const d of days) {
    const dir = path.join(home, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /^rollout-.*\.jsonl$/.test(n)); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (st.birthtimeMs < since - 5000 && (bornOnly || st.mtimeMs < since)) continue;
      let head = '';
      try { const fd = fs.openSync(file, 'r'); try { const buf = Buffer.alloc(65536); head = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, 0)); } finally { fs.closeSync(fd); } } catch { continue; }
      const idm = /"payload":\{[^]*?"id":"([0-9a-f-]{36})"/.exec(head);
      const cwdm = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head);
      if (!idm || !cwdm) continue;
      let c; try { c = JSON.parse(`"${cwdm[1]}"`); } catch { continue; }
      if (path.resolve(c).toLowerCase().replace(/[\\/]+$/, '') !== want) continue;
      if (exclude.some((x) => String(x).toLowerCase() === idm[1].toLowerCase())) continue;
      if (forkedFrom !== undefined) { const fm = /"forked_from_id":"([0-9a-f-]{36})"/.exec(head); const from = fm ? fm[1].toLowerCase() : null; if (from !== (forkedFrom ? String(forkedFrom).toLowerCase() : null)) continue; }
      found.push({ id: idm[1], at: st.birthtimeMs || st.mtimeMs });
    }
  }
  const ids = [...new Set(found.map((f) => f.id.toLowerCase()))];
  if (unique && ids.length > 1) return null;
  found.sort((x, y) => Math.abs(x.at - since) - Math.abs(y.at - since));
  return found.length ? found[0].id : null;
}
