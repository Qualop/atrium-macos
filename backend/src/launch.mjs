// 실행 계획(ARCH 4절 B3, 5절): 세션 설정 파일, claude 실행 인자, 이어 가기 명령(resume_argv), 신뢰 예상.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolvePath, canonicalPath, windowsPath } from './platform.mjs';

// http hook으로 받을 이벤트. SessionStart는 http hook을 부르지 않으므로 넣지 않는다(E2 2.5).
export const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'SubagentStop', 'SessionEnd'];

export const slash = resolvePath;

// P4: 세션 설정 파일에 넣는 "herdr 명령만 자동 승인" 규칙(새 세션 대화상자에서 고를 때만). herdr 스킬이 먼저 부르는 test·printf도 넣는다.
// Claude Code는 ${…}나 $PWD 같은 셸 확장이 든 명령은 규칙과 상관없이 묻는다(P4 시험). 그때는 판의 승인 카드로 답한다.
export const HERDR_ALLOW = ['Bash(herdr:*)', 'Bash(herdr *)', 'PowerShell(herdr *)', 'Bash(test:*)', 'Bash(printf:*)', 'Bash(echo:*)'];

// B3 1번: http hook(시간 제한 2초), hook 토큰, 세션 표시를 값으로 직접 쓴다. 작업 공간 env는 herdr 재시작 뒤 되살아나지 않는다(E7).
// P8(K1·K2): env(하위 세션 명령이 판과 자기를 찾는 값)와 allow(하위 세션 명령, herdr 일 시키기·답 읽기 승인 규칙)를 더 받는다. 값은 branch.mjs가 만든다
export function writeSessionSettings({ file, hookUrl, token, sessionId, timeoutSec = 2, allowHerdr = false, env = null, allow = [] }) {
  const hook = { type: 'http', url: hookUrl, timeout: timeoutSec, headers: { Authorization: `Bearer ${token}`, 'X-MT-Session': sessionId } };
  const settings = { hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [hook] }]])) };
  const rules = [...(allowHerdr ? HERDR_ALLOW : []), ...allow.filter((r) => !(allowHerdr && HERDR_ALLOW.includes(r)))];
  if (rules.length) settings.permissions = { allow: rules };
  if (env && Object.keys(env).length) settings.env = env;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return slash(file);
}

// 처음 띄울 때와 이어 갈 때가 같은 설정을 쓰도록 공통 인자를 한곳에서 만든다
// P4: herdr 스킬을 쥐여 준다. Claude Code는 ~/.agents/skills를 읽지 않으므로 실행마다 --plugin-dir로 넘긴다(사용자 설정은 고치지 않는다).
//     짧은 안내(--append-system-prompt-file)는 판의 연결 알림을 알아듣게 한다.
function commonArgs({ settingsPath, permissionMode, model, effort, pluginDir, systemPromptFile }) {
  const a = ['--no-chrome', '--permission-mode', permissionMode, '--settings', settingsPath];
  if (model) a.push('--model', model);
  if (effort) a.push('--effort', effort);
  if (pluginDir) a.push('--plugin-dir', pluginDir);
  if (systemPromptFile) a.push('--append-system-prompt-file', systemPromptFile);
  return a;
}

// P4: herdr 스킬 플러그인 폴더. 스킬 글은 고정한 herdr의 `herdr --skill`(~/.agents/skills/herdr/SKILL.md와 같음)에서 받는다.
export const PLUGIN_NAME = 'atrium-herdr';
export const LEGACY_PLUGIN_NAME = 'multitask-herdr'; // P18 전의 플러그인 폴더 이름(옮기기가 이어 가기 인자를 고칠 때 찾는다)
export const BOARD_SYSTEM_PROMPT = [
  '너는 Atrium 판이 띄운 herdr 패널 안에서 돈다(HERDR_ENV=1).',
  '다른 에이전트에게 일을 시키거나, 답을 받아 오거나, 새 에이전트를 띄우라는 말을 들으면 herdr 스킬(atrium-herdr:herdr)로 한다.',
  'herdr 명령에 --session, --machine, --remote를 붙이지 않는다. 패널의 herdr 명령은 이미 이 판의 herdr 세션에 붙는다.',
  '"[Atrium 판]"으로 시작하는 글은 판이 알려 주는 연결(어느 에이전트가 너의 무슨 역할인지)이다. 이 판의 예전 이름으로 시작하는 지난 알림도 같다.',
  '워커·하위 세션을 만들어 일을 나누라는 말을 들으면 delegate 스킬(atrium-herdr:delegate)대로 `atrium child`로 만들고 herdr로 시킨다. 예전 이름 mtask도 같은 명령이다.', // P8(K2)
  '판은 오래 쉬는 리포의 세션을 모두 잠재운다(sleeping, herdr에 없다). herdr 명령이 판의 세션 이름을 찾지 못하면 `atrium wake <이름>`으로 그 리포를 깨운 뒤 다시 한다.', // P21·P24(D4)
].join('\n');
// P8(K2): skills는 herdr 옆에 더할 스킬 { 이름: SKILL.md 글 }, bin은 Bash 도구 PATH에 오르는 명령 { 파일 이름: 글 }(플러그인 bin/)
export function writeBoardPlugin({ dir, skillText, skills = {}, bin = {} }) {
  const root = path.join(dir, PLUGIN_NAME);
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'herdr'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: PLUGIN_NAME, version: '0.1.0', description: 'Atrium 판이 띄운 에이전트에게 주는 herdr 스킬' }, null, 2));
  fs.writeFileSync(path.join(root, 'skills', 'herdr', 'SKILL.md'), skillText);
  for (const [name, text] of Object.entries(skills)) { fs.mkdirSync(path.join(root, 'skills', name), { recursive: true }); fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), text); }
  if (Object.keys(bin).length) fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  for (const [name, text] of Object.entries(bin)) { const f = path.join(root, 'bin', name); fs.writeFileSync(f, text); try { fs.chmodSync(f, 0o755); } catch {} }
  const promptFile = path.join(dir, 'board-system-prompt.md');
  fs.writeFileSync(promptFile, BOARD_SYSTEM_PROMPT + '\n');
  return { pluginDir: slash(root), systemPromptFile: slash(promptFile) };
}
// P8(K1): worktree면 Claude Code가 자기 규칙으로 워크트리를 만든다(claude -w <이름>). 판은 워크트리를 만들지 않는다. 처음 띄울 때만 넣는다
export function buildStartArgs({ sessionId, worktree = null, ...o }) { return ['--session-id', sessionId, ...(worktree ? ['--worktree', worktree] : []), ...commonArgs(o)]; }
// B3 4번: 첫 요소는 명령 이름, 경로는 슬래시(E7 2.3)
export function buildResumeArgv({ claudeCommand = 'claude', sessionId, ...o }) { return [claudeCommand, '--resume', sessionId, ...commonArgs(o)]; }
// C3 대책(P3): 판이 직접 이어 갈 때 agent.start에 넘기는 인자(명령 이름 없이)
export function buildResumeArgs({ sessionId, ...o }) { return ['--resume', sessionId, ...commonArgs(o)]; }

// 돌고 있는 claude의 명령줄에 판의 설정 파일이 있는가(pane.process_info의 argv)
export function argvHasSettings(argv, settingsPath) {
  if (!Array.isArray(argv)) return false;
  const i = argv.indexOf('--settings');
  if (i < 0) return false;
  const a = canonicalPath(argv[i + 1] || ''), b = canonicalPath(settingsPath);
  return windowsPath(settingsPath) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// C3 대책(P3): herdr가 다시 뜬 뒤 판 세션 하나를 어떻게 되살릴지.
// herdr는 session.json을 띄엄띄엄 저장한다. 저장 전에 서버가 죽으면 작업 공간째로, 또는 이어 가기 명령(resume_argv)만 잃는다(docs/log/p3-v02.md 보고 3.1).
// - 패널이 없다: 작업 공간을 다시 만들고, 대화 기록이 있으면 판의 인자로 이어 가고 없으면 같은 세션 ID로 새로 띄운다.
// - claude가 판의 설정 파일 없이 돈다(herdr 기본 이어 가기 `claude --resume <ID>`): hook을 잃었으므로 /exit 뒤 판의 인자로 다시 이어 간다.
// - 기다려도 claude가 뜨지 않았다(herdr가 이어 가기를 시도하지 않음): 대화 기록이 있으면 판의 인자로 이어 가고, 없으면 새로 띄운다.
// - herdr가 이어 가기를 시도했다가 실패한 경우(해제 이벤트)는 P1 규칙(relaunchIfEmpty)을 따른다.
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
export function predictTrust(cwd, claudeJsonPath) {
  let projects = {};
  try { projects = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8')).projects || {}; } catch { return { needsTrust: null, reason: 'claude.json unreadable' }; }
  let gitRoot = null;
  try { gitRoot = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null; } catch {}
  return predictTrustFrom(cwd, projects, gitRoot);
}
export function predictTrustFrom(cwd, projects, gitRoot = null) {
  const win = windowsPath(cwd);
  const keyOf = (p) => { const c = canonicalPath(p).replace(/\/$/, ''); return win ? c.toLowerCase() : c; };
  const trusted = new Map(Object.entries(projects).map(([name, value]) => [keyOf(name), { name, value }]));
  const stop = gitRoot ? keyOf(gitRoot) : null;
  let current = canonicalPath(cwd);
  while (true) {
    const found = trusted.get(keyOf(current));
    if (found?.value?.hasTrustDialogAccepted) return { needsTrust: false, trustedBy: found.name };
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
