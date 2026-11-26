// 실행 계획(ARCH 4절 B3, 5절): 세션 설정 파일, claude 실행 인자, 이어 가기 명령(resume_argv), 신뢰 예상.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { splitArgs } from './gemini-args.mjs';
import { resolvePath, canonicalPath, windowsPath } from './platform.mjs';

// http hook으로 받을 이벤트. SessionStart는 http hook을 부르지 않으므로 넣지 않는다(E2 2.5).
export const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'SubagentStop', 'SessionEnd', 'PreCompact', 'PostCompact']; // P173: 압축 시작·끝(턴이 아니다)

export const slash = resolvePath;

// B3 1번: http hook(시간 제한 2초), hook 토큰, 세션 표시를 값으로 직접 쓴다. 작업 공간 env는 터미널 재시작 뒤 되살아나지 않는다(E7).
// P8(K1·K2): env(하위 세션 명령이 판과 자기를 찾는 값)와 allow(하위 세션 명령, 일 시키기·기다리기·읽기 승인 규칙. P116: atrium prompt|wait|read)를 더 받는다. 값은 branch.mjs가 만든다
// P115: settings는 설정 파일에 더할 값(연결의 apiKeyHelper 등). 판의 hook·env·승인 규칙이 이긴다
export function writeSessionSettings({ file, hookUrl, token, sessionId, timeoutSec = 2, env = null, allow = [], settings: more = null }) {
  const hook = { type: 'http', url: hookUrl, timeout: timeoutSec, headers: { Authorization: `Bearer ${token}`, 'X-MT-Session': sessionId } };
  const settings = { ...(more || {}), hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [hook] }]])) };
  const rules = [...allow];
  if (rules.length) settings.permissions = { allow: rules };
  if (env && Object.keys(env).length) settings.env = env;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return slash(file);
}

// P258: 옛 세션 설정 파일(HOOK_EVENTS가 늘기 전에 쓴 것, 예: P173 전에 띄운 세션에는 PreCompact·PostCompact가 없다)에 빠진 판 hook을 채운다.
//   순수 함수(j를 그대로 고친다) → 더한 이벤트 목록. 판 hook = type http + X-MT-Session 머리글(writeSessionSettings가 쓰는 꼴).
//   빠진 이벤트에는 그 파일에 이미 있는 판 hook의 값(url, headers, 가장 많이 쓰인 timeout)을 넣는다. 그 파일의 토큰을 그대로 써서 도는 세션과 맞는다.
//   있는 이벤트(그 값과 rig 역할의 시간 제한 amp)와 판 hook이 아닌 것(사용자가 넣은 것)은 그대로 둔다. 판 hook을 하나도 못 찾으면 손대지 않는다
export function fillBoardHooks(j) {
  if (!j || typeof j !== 'object' || !j.hooks || typeof j.hooks !== 'object' || Array.isArray(j.hooks)) return [];
  const isBoard = (h) => !!h && h.type === 'http' && !!h.url && !!h.headers && !!h.headers['X-MT-Session'];
  const groups = (ev) => (Array.isArray(j.hooks[ev]) ? j.hooks[ev] : []);
  const boardIn = (ev) => groups(ev).some((m) => m && Array.isArray(m.hooks) && m.hooks.some(isBoard));
  const found = [];
  for (const ev of Object.keys(j.hooks)) for (const m of groups(ev)) for (const h of (m && Array.isArray(m.hooks) ? m.hooks : [])) if (isBoard(h)) found.push(h);
  if (!found.length) return [];
  const count = new Map();
  for (const h of found) count.set(h.timeout, (count.get(h.timeout) || 0) + 1);
  const timeout = [...count].reduce((a, c) => (c[1] > a[1] ? c : a))[0]; // 같은 수면 먼저 본 값
  const base = found[0];
  const added = [];
  for (const ev of HOOK_EVENTS) {
    if (boardIn(ev)) continue;
    const hook = { type: 'http', url: base.url, ...(timeout != null ? { timeout } : {}), headers: { ...base.headers } };
    j.hooks[ev] = [...groups(ev), { hooks: [hook] }];
    added.push(ev);
  }
  return added;
}
// P258: 세션 설정 파일 하나에 빠진 판 hook을 채운다(바뀐 것이 있을 때만 쓴다) → 더한 이벤트 목록. 파일이 없거나 읽지 못하면 []
export function fillSessionHooks(file) {
  if (!file || !fs.existsSync(file)) return [];
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const added = fillBoardHooks(j);
  if (added.length) fs.writeFileSync(file, JSON.stringify(j, null, 2));
  return added;
}

// 처음 띄울 때와 이어 갈 때가 공통 인자를 한곳에서 만든다
// P4: 판 플러그인(스킬과 atrium 명령)을 쥐여 준다. Claude Code는 ~/.agents/skills를 읽지 않으므로 실행마다 --plugin-dir로 넘긴다(사용자 설정은 고치지 않는다).
//     짧은 안내(--append-system-prompt-file)는 판의 연결 알림을 알아듣게 한다.
// P33: extraArgs는 호출자의 추가 인자(판이 정하는 인자는 호출자 검사가 막는다). 끝에 붙인다
function commonArgs({ settingsPath, permissionMode, model, effort, pluginDir, extraPluginDirs = [], mcpConfig = null, systemPromptFile, extraArgs = [] }) {
  const a = ['--no-chrome', '--permission-mode', permissionMode, '--settings', settingsPath];
  if (model) a.push('--model', model);
  if (effort) a.push('--effort', effort);
  if (pluginDir) a.push('--plugin-dir', pluginDir);
  for (const d of extraPluginDirs || []) if (d) a.push('--plugin-dir', d); // macOS 판: 판 세션에만 주는 추가 플러그인 묶음(boardExtraPlugins)
  if (mcpConfig) a.push('--mcp-config', mcpConfig); // macOS 판: 다른 계정 세션에 기본 계정의 사용자 MCP 서버(cua 등)
  if (systemPromptFile) a.push('--append-system-prompt-file', systemPromptFile);
  if (extraArgs && extraArgs.length) a.push(...extraArgs);
  return a;
}

// P4: 판 플러그인 폴더(atrium 스킬, 옛 이름 delegate 스킬, bin/atrium).
// P132: 플러그인 이름은 atrium(스킬 atrium:atrium)이다. 판이 다시 띄우는 길(launchOf → 깨우기·되살리기·다시 시작)은 늘 이 폴더를 넘긴다.
//   옛 이름 atrium-herdr(P18~P131) 폴더는 남아 있으면 같은 글로 계속 쓴다: 그 전에 띄워 아직 도는 Claude Code는 시작할 때 받은
//   --plugin-dir(옛 폴더)의 bin/atrium과 스킬(atrium-herdr:atrium)을 쓰기 때문이다. 새로 만들지는 않는다
export const PLUGIN_NAME = 'atrium';
export const OLD_PLUGIN_NAMES = ['atrium-herdr'];
export const LEGACY_PLUGIN_NAME = 'multitask-herdr'; // P18 전의 플러그인 폴더 이름(옮기기가 이어 가기 인자를 고칠 때 찾는다)
// P116: 일 시키기·기다리기·읽기는 판의 atrium 명령이다(터미널 백엔드와 상관없다). 터미널 명령을 직접 쓰라고 하지 않는다
export const BOARD_SYSTEM_PROMPT = [
  '너는 Atrium 보드가 띄운 세션 안에서 돈다. 보드와는 셸의 `atrium` 명령으로 말한다(사용법 `atrium help`).',
  '다른 에이전트에게 일을 맡길 때는 `atrium prompt <이름> "<할 일>"`(새 워커는 `atrium child <이름> --prompt "<할 일>"`)로 맡기고 턴을 끝낸다. 하위가 `atrium done`으로 닫으면 보드가 그 보고를 가져다주고, 보고 없이 멈추면 한 번 알린다. 기다리며 폴링하지 않는다. 화면은 `atrium read <이름>`, 이름은 보드의 세션 이름이다. 지금 답이 꼭 필요할 때만 `--wait`(맡긴 뒤면 `atrium wait <이름>`).', // P143, P181: 맡기고 턴을 끝낸다(판이 done 보고를 가져다준다)
  '다른 에이전트에게는 `atrium prompt`로만 보낸다. 보드가 받는 쪽 차례에 맞춰 넣고 그 연결을 판에 남긴다. 터미널 명령으로 직접 보내지 않는다.',
  '"[Atrium 보드]"으로 시작하는 글은 보드가 알려 주는 연결(어느 에이전트가 너의 무슨 역할인지)이다. 이 보드의 예전 이름으로 시작하는 지난 알림도 같다.',
  '일이 서로 기다리지 않는 조각 여럿으로 나뉘거나 사용자가 워커·하위 세션·병렬·워크트리를 말하면 atrium 스킬(atrium:atrium, 옛 이름 delegate)대로 `atrium child`로 워커를 만들어 맡긴다. 설정의 워커 수·깊이·전체 상한을 지킨다. 워커의 모델을 말로 들으면 `atrium models`에서 골라 띄운다. 모델·추론은 빼면 보드 기본(opus·sol, high)이고 작은 일은 --effort low, 작은 조각은 직접 한다. 예전 이름 mtask도 같은 명령이다.', // P8(K2), P36, P41. macOS 판: 하위 세션 기본값과 토큰
  '보드는 오래 쉬는 리포의 세션을 모두 잠재우고, 리포가 바빠도 오래 쉰 세션은 혼자 잠재운다(sleeping). 잠든 세션에 `atrium prompt`하면 보드가 깨운 뒤 넣는다. 미리 깨우려면 `atrium wake <이름>`으로 그 세션을(리포째 잠들었으면 그 리포를) 깨운다.', // P21·P24(D4), P111, P116
  '세션을 띄울 때 관계를 고른다: 협력·동료·같이·파트너면 `atrium child <이름> --peer`(동료: 필요한 것을 주고받고 끝나면 결과를 공유), 워커·하위·맡겨·나눠면 기본(하위 워커: 끝나면 띄운 쪽에 보고), 그 밖에는 첫 지시와 역할로 판단한다. 첫 요청 앞의 "[Atrium 보드] 관계:" 줄이 너의 관계와 보고 방식이다. 맡은 일은 끝나면 `atrium done ok|failed "<보고>"`로 닫고 쉬고, 동료면 결과를 상대에게 공유하며 사람에게 직접 답해도 된다. 나중에 바꾸기: `atrium relate <이름> sub|peer|none|auto`.', // P156
  '상위·동료·하위·독립과 역할 연결은 `atrium me`가 보드의 지금 기록이다. 누구의 무엇인지, 누구에게 맡길지 헷갈리면 먼저 치고, 예전 알림과 다르면 이것을 믿는다. 매 턴 치지는 않는다.', // P81
  // macOS 판(2026-11-19): 이 줄들은 하네스 안내문(harness.mjs HARNESS_PROMPT)에만 있어 Claude Code 세션에는 가지 않았다(약관 동의·입력 제한 우회가 그래서 막히지 않았다)
  '앱 조작은 cua MCP(별도 커서), 웹은 ego-browser 스킬로 한다. 사이트의 이용약관·동의·쿠키 창은 누르지 않고 멈춰 사람에게 묻고, 사이트가 정한 입력 제한(형식·범위)을 브라우저에서 고쳐 피하지 않는다.',
  '일하는 동안 진행 메모(`.atrium/progress/<너의 이름>.md`)와 결과를 자주 파일에 쓴다(끊기면 메모부터 잇는다). 만들기 전에 이 일에 맞는 공개 사례·스킬·라이브러리를 찾아 고르고 이유를 한 줄 남긴다(흔한 기본 모양을 그대로 쓰지 않는다). 스크린샷은 필요한 화면만 작게 찍고 글 스냅샷을 먼저 쓴다. 여러 줄 스크립트는 heredoc 대신 파일(`.atrium/tmp/`)에 써서 실행한다(heredoc 명령은 자동 모드에서도 확인 창이 떠 사람이 없으면 멈춘다).',
].join('\n');
// P8(K2): skills는 더할 스킬 { 이름: SKILL.md 글 }, bin은 Bash 도구 PATH에 오르는 명령 { 파일 이름: 글 }(플러그인 bin/)
// P129: 옛 터미널 스킬(P4~P116에 둔 것)은 지운다
const OLD_TERMINAL_SKILL = 'herdr';
function writePluginAt(root, name, { skills, bin }) {
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '0.1.0', description: 'Atrium 보드가 띄운 에이전트에게 주는 보드 명령(atrium)과 스킬' }, null, 2));
  fs.rmSync(path.join(root, 'skills', OLD_TERMINAL_SKILL), { recursive: true, force: true });
  for (const [n, text] of Object.entries(skills)) { fs.mkdirSync(path.join(root, 'skills', n), { recursive: true }); fs.writeFileSync(path.join(root, 'skills', n, 'SKILL.md'), text); }
  if (Object.keys(bin).length) fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  for (const [n, text] of Object.entries(bin)) { const f = path.join(root, 'bin', n); fs.writeFileSync(f, text); try { fs.chmodSync(f, 0o755); } catch {} }
}
export function writeBoardPlugin({ dir, skills = {}, bin = {} }) {
  const root = path.join(dir, PLUGIN_NAME);
  writePluginAt(root, PLUGIN_NAME, { skills, bin });
  // P132: 옛 이름 폴더가 있으면(그 이름으로 띄운 세션이 아직 돌 수 있다) 같은 스킬과 명령으로 다시 쓴다
  for (const old of OLD_PLUGIN_NAMES) { const r = path.join(dir, old); if (fs.existsSync(r)) writePluginAt(r, old, { skills, bin }); }
  const promptFile = path.join(dir, 'board-system-prompt.md');
  fs.writeFileSync(promptFile, BOARD_SYSTEM_PROMPT + '\n');
  return { pluginDir: slash(root), systemPromptFile: slash(promptFile) };
}
// macOS 판: 판 세션에만 주는 추가 플러그인(사용자 전역 설정에는 넣지 않는다). <데이터 폴더>/plugins/<이름>/.claude-plugin/plugin.json이 있는 폴더들.
// Claude Code는 플러그인 묶음 폴더를 --plugin-dir로 받으면 그 안의 플러그인을 모두 읽는다(2.1.x --help). 다른 하네스(Codex 등)에는 스킬 파일 위치를 안내문 한 줄로 준다.
// 모델이 스스로 부를 수 있는 스킬만 안내한다(SKILL.md 머리의 disable-model-invocation: true는 사람이 부르는 것)
export const EXTRA_PLUGINS_DIR = 'plugins';
function frontOf(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line); if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, ''); }
  return out;
}
export function boardExtraPlugins(dataDir) {
  const root = path.join(dataDir, EXTRA_PLUGINS_DIR);
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, '.claude-plugin', 'plugin.json'))).map((d) => d.name).sort(); } catch {}
  const skills = [];
  for (const n of names) {
    let dirs = [];
    try { dirs = fs.readdirSync(path.join(root, n, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch {}
    for (const d of dirs) {
      const file = path.join(root, n, 'skills', d, 'SKILL.md');
      let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      const f = frontOf(text);
      if (String(f['disable-model-invocation']).toLowerCase() === 'true') continue;
      skills.push({ plugin: n, name: f.name || d, file: slash(file), description: String(f.description || '').replace(/["\r\n]+/g, ' ').trim() });
    }
  }
  return { dir: names.length ? slash(root) : null, plugins: names, skills };
}
// 하네스 안내문에 붙이는 한 줄(줄바꿈·큰따옴표 없이). 스킬이 없으면 ''
export function skillLine(skills = []) {
  if (!skills.length) return '';
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  return ` 보드가 준 스킬(작업이 맞으면 먼저 그 파일을 읽고 따른다): ${skills.map((s) => `${s.name}(${clip(s.description, 70)}) ${s.file}`).join('; ')}.`;
}
// P115: Claude Code 밖 하네스에 주는 파일. binDir에 플러그인 bin/과 같은 명령(atrium, mtask)을 두고(그 세션의 PATH 앞에 둔다),
// dir에 하네스와 상관없는 안내문 파일(harness-system-prompt.md)을 쓴다 → { binDir, promptFile }
export function writeHarnessFiles({ dir, binDir, bin = {}, prompt }) {
  fs.mkdirSync(binDir, { recursive: true });
  for (const [name, text] of Object.entries(bin)) { const f = path.join(binDir, name); fs.writeFileSync(f, text); try { fs.chmodSync(f, 0o755); } catch {} }
  fs.mkdirSync(dir, { recursive: true });
  const promptFile = path.join(dir, 'harness-system-prompt.md');
  fs.writeFileSync(promptFile, prompt + '\n');
  return { binDir: path.resolve(binDir), promptFile: slash(promptFile) };
}
// P115: 세션 토큰 파일(Claude Code 밖 하네스의 atrium이 읽는다). 친 줄과 셸 기록에 토큰이 남지 않게 env 대신 판 데이터 폴더의 세션별 파일에 둔다
export const tokenFileOf = (sessionsDir, sessionId) => path.join(sessionsDir, `${sessionId}.token`);
export function writeTokenFile(sessionsDir, sessionId, token) { fs.mkdirSync(sessionsDir, { recursive: true }); const f = tokenFileOf(sessionsDir, sessionId); fs.writeFileSync(f, token); return f; }
// P8(K1): worktree면 Claude Code가 자기 규칙으로 워크트리를 만든다(claude -w <이름>). 판은 워크트리를 만들지 않는다. 처음 띄울 때만 넣는다
export function buildStartArgs({ sessionId, worktree = null, ...o }) { return ['--session-id', sessionId, ...(worktree ? ['--worktree', worktree] : []), ...commonArgs(o)]; }
// B3 4번: 첫 요소는 명령 이름, 경로는 슬래시(E7 2.3)
// P97: startCommand(호출자의 실행 명령, 예: 래퍼 명령 `mywrap claude`)가 있으면 그 낱말들로 시작한다. 판이 이어 갈 때 이 명령으로 시작한다
export function buildResumeArgv({ claudeCommand = 'claude', startCommand = '', sessionId, ...o }) {
  const head = splitArgs(startCommand);
  return [...(head.length ? head : [claudeCommand]), '--resume', sessionId, ...commonArgs(o)];
}
// P97: PowerShell 패널에 칠 낱말(안전한 글자가 아니면 작은따옴표로 묶고 '는 두 번). 실행 명령 호출자는 판이 이 줄을 패널에 친다
const PS_SAFE = /^[A-Za-z0-9_\-.:/\\=]+$/;
export const psQuote = (w) => (PS_SAFE.test(String(w)) ? String(w) : `'${String(w).replace(/'/g, "''")}'`);
export const psLine = (words) => {
  const quoted = words.map(psQuote);
  return (quoted[0]?.startsWith("'") ? '& ' : '') + quoted.join(' ');
};
// argv → 패널 셸 명령. POSIX에서는 작은따옴표를 닫고 따옴표 자체를 붙인다.
export const platformLine = (words, platform = process.platform) => platform === 'win32' ? psLine(words) : words.map((w) => {
  const s = String(w);
  return /^[A-Za-z0-9_./:@=-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'";
}).join(' ');
// PowerShell: 친 줄 앞에 env를 붙인다($env:이름='값'; 작은따옴표는 두 번). P115: PATH는 바꾸지 않고 앞에 더한다
export const psEnvPrefix = (env) => Object.entries(env || {}).map(([k, v]) => `$env:${k}='${String(v).replace(/'/g, "''")}'; `).join('');
export const psPathPrefix = (dirs = []) => (dirs.length ? `$env:PATH='${dirs.map((d) => String(d).replace(/'/g, "''")).join(';')};' + $env:PATH; ` : '');
// C3 대책(P3): 판이 직접 이어 갈 때 agent.start에 넘기는 인자(명령 이름 없이)
export function buildResumeArgs({ sessionId, ...o }) { return ['--resume', sessionId, ...commonArgs(o)]; }

// 돌고 있는 claude의 명령줄에 판의 설정 파일이 있는가(pane.process_info의 argv)
export function argvHasSettings(argv, settingsPath) {
  if (!Array.isArray(argv) || typeof settingsPath !== 'string' || !settingsPath) return false;
  let effective;
  for (let i = 0; i < argv.length && argv[i] !== '--'; i++) {
    if (argv[i] === '--settings') effective = argv[++i];
    else if (typeof argv[i] === 'string' && argv[i].startsWith('--settings=')) effective = argv[i].slice(11);
  }
  if (typeof effective !== 'string' || !effective || effective.startsWith('-')) return false;
  const a = canonicalPath(effective), b = canonicalPath(settingsPath);
  return windowsPath(settingsPath) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// C3 대책(P3): 터미널 서버가 다시 뜬 뒤 판 세션 하나를 어떻게 되살릴지.
// - 패널이 없다(hc: 코어가 꺼지면 터미널도 끝난다): 작업 공간을 다시 만들고, 대화 기록이 있으면 판의 인자로 이어 가고 없으면 같은 세션 ID로 새로 띄운다.
// - claude가 판의 설정 파일 없이 돈다(`claude --resume <ID>`): hook을 잃었으므로 /exit 뒤 판의 인자로 다시 이어 간다.
// - 기다려도 claude가 뜨지 않았다: 대화 기록이 있으면 판의 인자로 이어 가고, 없으면 새로 띄운다.
// - 이어 가기를 시도했다가 실패한 경우(해제 이벤트)는 P1 규칙(relaunchIfEmpty)을 따른다.
export function recoveryPlan({ paneExists, agentPresent, argv = null, settingsPath, transcriptExists, waitedMs = 0, graceMs = 15000, releasedSinceRestart = false }) {
  if (!paneExists) return transcriptExists ? 'recreate_resume' : 'recreate_fresh';
  if (agentPresent) {
    if (!argv) return 'wait';
    return argvHasSettings(argv, settingsPath) ? 'ok' : 'restart_with_settings';
  }
  if (releasedSinceRestart) return 'leave'; // relaunchIfEmpty가 다룬다
  if (waitedMs < graceMs) return 'wait';
  return transcriptExists ? 'start_resume' : 'start_fresh';
}

// 3절 trust_wait 예상: ~/.claude.json의 projects에서 폴더와 모든 상위 폴더의 hasTrustDialogAccepted(E10). 읽기만 한다.
// P1에서 더한 규칙: 폴더가 git 저장소 안이면 그 저장소 루트까지만 올라간다. 루트보다 위의 신뢰는 물려받지 않았다
// (저장소 폴더 C:/Workspace/multitask를 신뢰했는데 그 아래 따로 git init한 폴더에서 대화상자가 떴다. docs/log/p1-backend.md).
// P36(Claude Code 2.1.318 실험): 커밋이 하나도 없는 저장소는 git이 아닌 폴더처럼 상위 폴더의 신뢰를 물려받아 대화상자가 뜨지 않았다. 첫 커밋 뒤에는 떴다.
//   그래서 루트에서 멈추는 것은 커밋이 있는 저장소만이다. claude -w는 둘 다 "Workspace trust not yet accepted"로 거부했다(대화상자를 띄우지 않고 바로 끝난다)
export function predictTrust(cwd, claudeJsonPath) {
  let projects = {};
  try { projects = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8')).projects || {}; } catch { return { needsTrust: null, reason: 'claude.json unreadable' }; }
  const gitRoot = gitTop(cwd);
  return predictTrustFrom(cwd, projects, gitRoot && repoHasCommit(cwd) ? gitRoot : null);
}
const gitOut = (cwd, args) => { try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); } catch { return null; } };
export function gitTop(cwd) { return gitOut(cwd, ['rev-parse', '--show-toplevel']) || null; }
// P36: 저장소에 커밋이 하나라도 있는가(HEAD가 가리키는 커밋). 없으면 claude -w가 워크트리를 만들 곳이 없다
export function repoHasCommit(cwd) { return !!gitOut(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']); }
export function predictTrustFrom(cwd, projects, gitRoot = null) {
  const win = windowsPath(cwd);
  const keyOf = (p) => { const c = canonicalPath(p).replace(/\/$/, ''); return win ? c.toLowerCase() : c; };
  const trusted = new Map(Object.entries(projects || {}).map(([name, value]) => [keyOf(name), { name, value }]));
  const stop = gitRoot ? keyOf(gitRoot) : null;
  let current = canonicalPath(cwd);
  while (true) {
    const found = trusted.get(keyOf(current));
    if (found?.value?.hasTrustDialogAccepted === true) return { needsTrust: false, trustedBy: found.name };
    if (stop && keyOf(current) === stop) break;
    const parent = win ? path.win32.dirname(current).replace(/\\/g, '/') : path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { needsTrust: true, trustedBy: null };
}
// 대화 기록 경로: ~/.claude/projects/<cwd의 영숫자 밖 글자를 '-'로>/<세션 ID>.jsonl(E1 2절). hook의 transcript_path가 있으면 그것을 쓴다.
export function transcriptPathFor(projectsDir, cwd, sessionId) {
  return path.join(projectsDir, resolvePath(cwd).replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`);
}
