// git 조사(ARCH 5절, A2): 브랜치, 바뀐 파일 수, `git diff --stat`. 세션 폴더가 git 저장소일 때만.
// P4(F4): 워크트리인가, 본 저장소(공통 git 폴더)가 어디인가. 판은 워크트리를 만들지 않고 읽기만 한다.
// P5(G1): 세션을 시작한 폴더의 리포지토리 워크스페이스(workspaces.mjs)
import path from 'node:path';
import { execFile } from 'node:child_process';
import { workspaceFromProbe, pathKey } from './workspaces.mjs';
import { canonicalPath } from './platform.mjs';

function git(cwd, args) {
  return new Promise((res) => execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, timeout: 5000 }, (err, out) => res(err ? null : String(out))));
}

const norm = canonicalPath;

// `git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir` 출력 → 워크트리 정보
export function parseRevParse(out) {
  const [top, gitDir, commonDir] = String(out || '').split(/\r?\n/).map((l) => l.trim());
  if (!top || !gitDir || !commonDir) return null;
  const isWorktree = pathKey(norm(gitDir)) !== pathKey(norm(commonDir));
  const c = norm(commonDir);
  return { root: norm(top), gitDir: norm(gitDir), commonDir: c, isWorktree, mainRoot: /\/\.git$/i.test(c) ? c.slice(0, -5) : null };
}

const revParse = async (cwd) => parseRevParse(await git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir']));

// 시작 폴더 → 워크스페이스 { key, kind, root }. 폴더가 없거나 git이 아니면 그 폴더가 워크스페이스다
export async function workspaceOf(cwd) {
  const rp = cwd ? await revParse(cwd) : null;
  return workspaceFromProbe(rp, norm(String(cwd || '.')));
}

export async function gitProbe(cwd) {
  const rp = await revParse(cwd);
  if (!rp) return { isRepo: false, cwd: cwd ? norm(cwd) : null, at: Date.now() };
  const [branch, status, stat] = await Promise.all([
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['status', '--porcelain']),
    git(cwd, ['diff', '--stat']),
  ]);
  return {
    isRepo: true,
    cwd: norm(cwd),
    ...rp,
    branch: branch ? branch.trim() : null,
    changedFiles: status ? status.split('\n').filter((l) => l.trim()).length : 0,
    diffStat: stat ? stat.trim().split('\n').slice(-1)[0] || '' : '',
    at: Date.now(),
  };
}
