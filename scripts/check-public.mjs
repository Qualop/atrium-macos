#!/usr/bin/env node
// 공개 저장소 검사. 이 저장소는 GitHub에 공개되어 있다. 올리면 안 되는 것을 커밋 전과 푸시 전에 막는다.
//
//   node scripts/check-public.mjs --staged          커밋 전(.githooks/pre-commit): 스테이지된 파일과 작성자·커미터
//   node scripts/check-public.mjs --message <파일>   커밋 메시지(.githooks/commit-msg)
//   node scripts/check-public.mjs --push <원격>      푸시 전(.githooks/pre-push): 표준 입력의 ref 줄로 올라갈 커밋 전부
//   node scripts/check-public.mjs --tree [rev]      저장소 전체(기본 HEAD)
//
// 막는 것: 이 컴퓨터의 사용자 이름·홈 폴더·개인 메일, 남의 홈 폴더 경로, 토큰과 개인 키, 공개하지 않는 폴더(.gitignore와 같다),
// 1MiB가 넘는 파일, noreply가 아닌 커미터 메일, 개인 메일인 작성자.
// 사용자 이름, 홈 폴더, 개인 메일은 코드에 적지 않고 실행할 때 이 컴퓨터에서 읽는다(검사기가 그것을 공개하지 않게).
// 찾은 값은 가려서 보인다. 검사를 건너뛰지 않는다(--no-verify 금지). 잘못 걸리면 이 파일의 규칙을 고친다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const MAX_BYTES = 1024 * 1024;
export const BLOCKED_PATHS = [
  [/^experiments\//, '화면 시험 결과 폴더(git 밖)'],
  // Reviewed research notes belong in git under this fork's docs/README.md.
  [/^app\/design\//, '디자인 작업 폴더(git 밖)'],
  [/^\.claude\/launch\.json$/, '사용자 로컬 설정'],
  [/^backend\/\.dev\//, '개발용 판 데이터'],
  [/(^|\/)node_modules\//, 'node_modules'],
  [/(^|\/)\.env(\.[^/]*)?$/, '.env 파일'],
  [/(^|\/)backend\.json$/, '판 API 토큰 파일'],
];
const NOREPLY = /^(\d+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com$|^noreply@github\.com$/i;
const GENERIC_USERS = new Set(['user', 'users', 'admin', 'administrator', 'public', 'default', 'runneradmin', 'runner', 'test', 'guest']);
const TOKENS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic 키'],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/, 'OpenAI 형식 키'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub 토큰'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}/, 'GitHub 토큰'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS 키'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack 토큰'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API 키'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, '개인 키'],
  [/\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_\-./+]{16,}/, '키 값 대입'],
];
// 남의 것까지 포함한 사용자 홈 경로. %USERPROFILE%, <user>, {user}, Public, Default, 두 글자 이하 이름(시험의 u, x) 같은 자리표시는 괜찮다.
// 이 컴퓨터의 사용자는 이름 길이와 상관없이 localSecrets가 따로 잡는다
const HOME_PATH = /\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?![<{%$*…]|\.\.\.|Public\b|Default\b|All Users\b)[^\\/\s"'`)\]]{3,}|(?:^|[\s"'`(])\/[a-z]\/Users\/(?![<{%$*…]|\.\.\.|Public\b|Default\b)[^/\s"'`)\]]{3,}/i;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 이 컴퓨터에서 읽은 개인 값. env로 덧붙일 수 있다(ATRIUM_PRIVATE_WORDS, 쉼표로 나눔)
export function localSecrets({ home = os.homedir(), user = os.userInfo().username, emails = personalEmails(), extra = process.env.ATRIUM_PRIVATE_WORDS || '' } = {}) {
  const words = [];
  if (user && user.length >= 4 && !GENERIC_USERS.has(user.toLowerCase())) words.push([user, '사용자 이름']);
  for (const e of emails) if (e && !NOREPLY.test(e)) words.push([e, '개인 메일']);
  for (const w of String(extra).split(',').map((x) => x.trim()).filter((x) => x.length >= 3)) words.push([w, '개인 낱말']);
  const res = words.map(([w, kind]) => [new RegExp(`(?<![A-Za-z0-9])${esc(w)}(?![A-Za-z0-9])`, 'i'), kind]);
  if (home) {
    const parts = home.split(/[\\/]/).filter(Boolean);
    if (parts.length >= 2) res.push([new RegExp(parts.map(esc).join('[\\\\/]{1,2}'), 'i'), '홈 폴더']);
  }
  return res;
}
export function personalEmails() {
  const out = new Set();
  for (const scope of ['--global', '--system']) {
    try { const v = execFileSync('git', ['config', scope, 'user.email'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (v) out.add(v); } catch {}
  }
  return [...out];
}

// 글 하나를 본다 → [{ line, kind, text }]. text는 찾은 값을 가린 줄
export function scanText(text, secrets) {
  const out = [];
  const rules = [...secrets, ...TOKENS, [HOME_PATH, '사용자 홈 경로']];
  String(text).split(/\r?\n/).forEach((l, i) => {
    for (const [re, kind] of rules) {
      const m = l.match(re);
      if (m) { out.push({ line: i + 1, kind, text: mask(l, m) }); break; }
    }
  });
  return out;
}
function mask(l, m) {
  const s = Math.max(0, m.index - 30);
  return (s ? '…' : '') + l.slice(s, m.index) + '‹가림›' + l.slice(m.index + m[0].length, m.index + m[0].length + 30);
}
export function blockedPath(p) { for (const [re, why] of BLOCKED_PATHS) if (re.test(p)) return why; return null; }
export function committerOk(email) { return NOREPLY.test(String(email || '').trim()); }
export function authorOk(email, secrets) { const e = String(email || '').trim(); return NOREPLY.test(e) || !secrets.some(([re, kind]) => kind === '개인 메일' && re.test(e)); }
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

// ---------- git ----------
const git = (args, opts = {}) => execFileSync('git', args, { encoding: opts.buffer ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const emailOf = (ident) => (String(ident).match(/<([^>]*)>/) || [])[1] || '';

function checkBlob(where, spec, path, secrets, problems) {
  const why = blockedPath(path);
  if (why) problems.push(`${where}${path}: 공개하지 않는 경로(${why})`);
  let size = 0;
  try { size = Number(git(['cat-file', '-s', spec]).trim()); } catch { return; }
  if (size > MAX_BYTES) problems.push(`${where}${path}: ${(size / 1048576).toFixed(1)}MiB, 1MiB가 넘는 파일`);
  if (size > 8 * MAX_BYTES) return;
  const buf = git(['cat-file', 'blob', spec], { buffer: true });
  if (isBinary(buf)) return;
  for (const f of scanText(buf.toString('utf8'), secrets)) problems.push(`${where}${path}:${f.line}: ${f.kind}: ${f.text}`);
}

function checkStaged(secrets) {
  const problems = [];
  const committer = emailOf(git(['var', 'GIT_COMMITTER_IDENT']));
  const author = emailOf(git(['var', 'GIT_AUTHOR_IDENT']));
  if (!committerOk(committer)) problems.push(`커미터 메일이 noreply가 아니다(${mask(committer, { index: 0, 0: committer })}). git config user.email 을 GitHub noreply 주소로 둔다`);
  if (!authorOk(author, secrets)) problems.push('작성자 메일이 개인 메일이다. git config user.email 을 GitHub noreply 주소로 둔다');
  const out = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
  for (const p of out.split('\0').filter(Boolean)) checkBlob('', `:${p}`, p, secrets, problems);
  return problems;
}

function checkMessage(file, secrets) {
  const text = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n');
  return scanText(text, secrets).map((f) => `커밋 메시지:${f.line}: ${f.kind}: ${f.text}`);
}

function checkCommits(commits, secrets) {
  const problems = [];
  for (const c of commits) {
    const short = c.slice(0, 7);
    const [ae, ce] = git(['log', '-1', '--format=%ae%n%ce', c]).split('\n');
    if (!committerOk(ce)) problems.push(`${short}: 커미터 메일이 noreply가 아니다`);
    if (!authorOk(ae, secrets)) problems.push(`${short}: 작성자 메일이 개인 메일이다`);
    for (const f of scanText(git(['log', '-1', '--format=%B', c]), secrets)) problems.push(`${short} 커밋 메시지:${f.line}: ${f.kind}: ${f.text}`);
    const files = git(['diff-tree', '--no-commit-id', '-r', '-z', '--root', '-m', '--name-only', '--diff-filter=ACMR', c]).split('\0').filter(Boolean);
    for (const p of [...new Set(files)]) checkBlob(`${short} `, `${c}:${p}`, p, secrets, problems);
  }
  return problems;
}

function pushCommits(remote, stdin) {
  const zero = /^0+$/;
  const commits = new Set();
  for (const line of stdin.split(/\r?\n/).filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(' ');
    if (!localSha || zero.test(localSha)) continue; // 지우기
    let list;
    try {
      list = !zero.test(remoteSha) && git(['cat-file', '-t', remoteSha]).trim() === 'commit'
        ? git(['rev-list', `${remoteSha}..${localSha}`])
        : git(['rev-list', localSha, '--not', `--remotes=${remote || '*'}`]);
    } catch { list = git(['rev-list', localSha, '--not', '--remotes']); }
    for (const c of list.split('\n').filter(Boolean)) commits.add(c);
  }
  return [...commits];
}

function checkTree(rev, secrets) {
  const problems = [];
  const files = git(['ls-tree', '-r', '-z', '--name-only', rev]).split('\0').filter(Boolean);
  for (const p of files) checkBlob('', `${rev}:${p}`, p, secrets, problems);
  return problems;
}

function main(argv) {
  const secrets = localSecrets();
  const mode = argv[0];
  let problems;
  if (mode === '--staged') problems = checkStaged(secrets);
  else if (mode === '--message') problems = checkMessage(argv[1], secrets);
  else if (mode === '--push') problems = checkCommits(pushCommits(argv[1], fs.readFileSync(0, 'utf8')), secrets);
  else if (mode === '--tree') problems = checkTree(argv[1] || 'HEAD', secrets);
  else { process.stderr.write('쓰는 법: check-public.mjs --staged | --message <파일> | --push <원격> | --tree [rev]\n'); return 2; }
  if (!problems.length) { if (mode === '--tree') process.stdout.write('[공개 검사] 통과\n'); return 0; }
  process.stderr.write(`[공개 검사] 공개 저장소에 올리면 안 되는 것 ${problems.length}개:\n${problems.slice(0, 50).map((p) => `- ${p}`).join('\n')}\n${problems.length > 50 ? `… 외 ${problems.length - 50}개\n` : ''}고친 뒤 다시 한다. 건너뛰지 않는다.\n`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
