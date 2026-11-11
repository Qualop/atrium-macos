#!/usr/bin/env node
// 릴리즈 확인(P69, P70 dev 빌드). 앱 안 업데이트는 릴리즈 태그와 app·backend의 package.json version으로 버전을 읽는다. 태그를 달기 전과 뒤에 돌린다.
//   node scripts/release-check.mjs <태그>            정식 v0.2.0: main이 dev와 같은 커밋인지, main의 두 version이 태그와 같은지, 태그가 있으면 main을 가리키는지
//                                                    dev 빌드 v0.2.1-dev.1: main이 dev의 조상인지, dev의 두 version이 태그와 같은지, 그 버전이 main의 version(지금 정식)보다 높은지, 태그가 있으면 dev를 가리키는지
//   node scripts/release-check.mjs <태그> --remote   origin/main·origin/dev로 본다(git fetch 뒤)
// 종료 코드: 0 통과, 1 맞지 않음, 2 실행 불가(인자, git 오류)
// 릴리즈 절차(작업은 dev에서 한다):
//   1. dev에서 app/package.json·backend/package.json과 두 잠금 파일 맨 위의 version을 새 버전으로 올려 커밋하고 푸시한다.
//   2. git checkout main && git merge --ff-only dev, 그리고 node scripts/release-check.mjs v<버전>이 통과하면 main에 git tag -a v<버전>을 달고 main과 태그를 푸시한다.
//   3. GitHub에서 그 태그로 정식 릴리즈를 만든다(초안은 앱 안 업데이트가 보지 않는다). node scripts/release-check.mjs v<버전> --remote로 원격을 확인한다.
//   4. 오래된 dev 릴리즈는 scripts/prune-dev-releases.mjs의 미리보기로 확인한다. 공개 릴리즈·태그 삭제는 별도로 선택한 경우에만 한다.
//   5. 다시 dev로 돌아간다(git checkout dev).
// dev 빌드 절차(P70. dev 채널을 고른 판만 알린다. 사전 릴리즈라 GitHub의 Latest와 정식 채널은 그대로다):
//   1. dev에서 두 package.json과 두 잠금 파일 맨 위의 version을 x.y.z-dev.n으로 올려 커밋하고 푸시한다(x.y.z는 다음 정식 버전, n은 1부터).
//   2. node scripts/release-check.mjs v<x.y.z-dev.n>이 통과하면 dev 커밋에 git tag -a v<x.y.z-dev.n>을 달고 태그를 푸시한다(main은 그대로).
//   3. gh release create v<x.y.z-dev.n> --prerelease로 사전 릴리즈를 만든다. node scripts/release-check.mjs v<x.y.z-dev.n> --remote로 원격을 확인한다.
import { execFileSync } from 'node:child_process';
import { compareVersions } from '../backend/src/update.mjs';

export const STABLE_TAG_RE = /^v\d+\.\d+\.\d+$/;
export const DEV_TAG_RE = /^v\d+\.\d+\.\d+-dev\.\d+$/;
export const isDevTag = (tag) => DEV_TAG_RE.test(String(tag || ''));

// 정식 태그. main·dev·tagCommit은 커밋 해시, 두 version은 main의 것
export function checkRelease({ tag, main, dev, tagCommit, appVersion, backendVersion }) {
  const problems = [];
  const version = String(tag || '').replace(/^v/, '');
  if (!STABLE_TAG_RE.test(String(tag || ''))) problems.push(`태그는 정식 v<주>.<부>.<수> 또는 dev 빌드 v<주>.<부>.<수>-dev.<n> 꼴이어야 합니다(다른 사전 릴리즈는 업데이트가 보지 않습니다): ${tag}`);
  if (!main) problems.push('main 브랜치가 없습니다');
  if (!dev) problems.push('dev 브랜치가 없습니다');
  if (main && dev && main !== dev) problems.push(`main(${main.slice(0, 8)})이 dev(${dev.slice(0, 8)})와 다릅니다. main을 dev로 fast-forward합니다: git checkout main && git merge --ff-only dev`);
  if (appVersion !== version) problems.push(`app/package.json version(${appVersion})이 태그(${version})와 다릅니다`);
  if (backendVersion !== version) problems.push(`backend/package.json version(${backendVersion})이 태그(${version})와 다릅니다`);
  if (tagCommit && main && tagCommit !== main) problems.push(`태그 ${tag}가 main이 아닌 커밋(${tagCommit.slice(0, 8)})을 가리킵니다`);
  return problems;
}

// P70 dev 빌드 태그. 두 version은 dev의 것, stableVersion은 main의 version(지금 정식 릴리즈), mainIsAncestor는 main이 dev의 조상인지(같아도 참)
export function checkDevRelease({ tag, main, dev, tagCommit, appVersion, backendVersion, stableVersion, mainIsAncestor }) {
  const problems = [];
  const version = String(tag || '').replace(/^v/, '');
  if (!isDevTag(tag)) problems.push(`dev 빌드 태그는 v<주>.<부>.<수>-dev.<n> 꼴이어야 합니다: ${tag}`);
  if (!main) problems.push('main 브랜치가 없습니다');
  if (!dev) problems.push('dev 브랜치가 없습니다');
  if (main && dev && !mainIsAncestor) problems.push(`main(${main.slice(0, 8)})이 dev(${dev.slice(0, 8)})의 조상이 아닙니다. dev에 main을 먼저 합칩니다`);
  if (appVersion !== version) problems.push(`dev의 app/package.json version(${appVersion})이 태그(${version})와 다릅니다`);
  if (backendVersion !== version) problems.push(`dev의 backend/package.json version(${backendVersion})이 태그(${version})와 다릅니다`);
  if (main && !stableVersion) problems.push('main의 version을 읽지 못했습니다');
  else if (stableVersion && compareVersions(version, stableVersion) <= 0) problems.push(`dev 빌드 버전(${version})이 지금 정식 릴리즈(main의 ${stableVersion})보다 높지 않습니다. x.y.z를 다음 정식 버전으로 올립니다`);
  if (tagCommit && dev && tagCommit !== dev) problems.push(`태그 ${tag}가 dev가 아닌 커밋(${tagCommit.slice(0, 8)})을 가리킵니다`);
  return problems;
}

const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const versionAt = (ref, file) => { const s = git('show', `${ref}:${file}`); try { return s ? JSON.parse(s).version : null; } catch { return null; } };
const isAncestor = (a, b) => { try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch { return false; } };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = process.argv.slice(2);
  const tag = args.find((a) => !a.startsWith('--'));
  if (!tag) { console.error('사용: node scripts/release-check.mjs <태그> [--remote]'); process.exit(2); }
  const remote = args.includes('--remote');
  const mainRef = remote ? 'origin/main' : 'main', devRef = remote ? 'origin/dev' : 'dev';
  const main = git('rev-parse', '--verify', `${mainRef}^{commit}`), dev = git('rev-parse', '--verify', `${devRef}^{commit}`);
  const tagCommit = git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
  const devBuild = isDevTag(tag);
  const problems = devBuild
    ? checkDevRelease({ tag, main, dev, tagCommit, appVersion: dev && versionAt(devRef, 'app/package.json'), backendVersion: dev && versionAt(devRef, 'backend/package.json'), stableVersion: main && versionAt(mainRef, 'app/package.json'), mainIsAncestor: !!(main && dev && isAncestor(main, dev)) })
    : checkRelease({ tag, main, dev, tagCommit, appVersion: main && versionAt(mainRef, 'app/package.json'), backendVersion: main && versionAt(mainRef, 'backend/package.json') });
  if (problems.length) { console.error(`릴리즈 확인 실패 (${tag}):`); for (const p of problems) console.error(`- ${p}`); process.exit(1); }
  if (devBuild) console.log(`dev 빌드 확인 통과: ${tag}, ${devRef} = ${dev.slice(0, 8)}, ${mainRef}(${main.slice(0, 8)})는 그 조상${tagCommit ? ', 태그가 dev를 가리킴' : ', 태그 아직 없음'}`);
  else console.log(`릴리즈 확인 통과: ${tag}, ${mainRef} = ${devRef} = ${main.slice(0, 8)}${tagCommit ? ', 태그가 main을 가리킴' : ', 태그 아직 없음'}`);
}
