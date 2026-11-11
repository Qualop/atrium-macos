// 오래된 dev 릴리즈 지우기(2026-11-07 사용자 요청, 같은 날 남기는 범위를 줄임). 정식 릴리즈를 낼 때마다 릴리즈 절차(release-check.mjs 머리) 3번 뒤에 돌린다.
// 규칙: 정식 버전을 새것부터 S0(이번), S1(전)이라 하면, dev 빌드 vX.Y.Z-dev.N 가운데 X.Y.Z가 S1 이하인 것을 지운다.
//   남는 것: S0-dev.*(전과 이번 사이)와 그 뒤의 dev. 정식이 둘보다 적으면 지우지 않는다.
//   dev 빌드의 X.Y.Z는 다음 정식 버전이라(release-check.mjs dev 빌드 절차 1번) X.Y.Z ≤ S1이면 전 정식이 나오기 전의 빌드다.
//   지워도 옛 버전이 깔린 판은 그대로 돈다. 업데이트는 최신 릴리즈만 받고, 실행기와 되돌리기는 설치 폴더의 파일만 쓴다.
//   초안과 버전 꼴이 아닌 태그(예: ux1-evidence)는 건드리지 않는다.
//   node scripts/prune-dev-releases.mjs          지울 것과 남길 것만 보인다
//   node scripts/prune-dev-releases.mjs --yes    GitHub 릴리즈와 그 태그(원격, 로컬에 있으면 로컬도)를 지운다
// 종료 코드: 0 통과, 2 실행 불가(gh·git 오류)
import { execFileSync } from 'node:child_process';
import { compareVersions } from '../backend/src/update.mjs';
import { STABLE_TAG_RE, DEV_TAG_RE } from './release-check.mjs';

const baseOf = (tag) => tag.replace(/^v/, '').replace(/-dev\.\d+$/, '');

// releases: [{ tagName, isPrerelease, isDraft }] → { stable: [S0, S1], remove: [tag], keep: [tag] }(dev만, 오래된 것부터)
export function pruneDevReleases(releases) {
  const live = (releases || []).filter((r) => r && r.tagName && !r.isDraft);
  const stable = live.map((r) => r.tagName).filter((t) => STABLE_TAG_RE.test(t)).sort((a, b) => compareVersions(b, a));
  const dev = live.map((r) => r.tagName).filter((t) => DEV_TAG_RE.test(t)).sort((a, b) => compareVersions(a, b));
  if (stable.length < 2) return { stable: stable.slice(0, 2), remove: [], keep: dev };
  const s1 = stable[1].replace(/^v/, '');
  const remove = dev.filter((t) => compareVersions(baseOf(t), s1) <= 0);
  return { stable: stable.slice(0, 2), remove, keep: dev.filter((t) => !remove.includes(t)) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const yes = process.argv.includes('--yes');
  let list;
  try { list = JSON.parse(execFileSync('gh', ['release', 'list', '--limit', '500', '--json', 'tagName,isPrerelease,isDraft'], { encoding: 'utf8' })); }
  catch (e) { console.error(`릴리즈 목록을 읽지 못했다: ${e.message}`); process.exit(2); }
  const r = pruneDevReleases(list);
  console.log(`정식(새것부터): ${r.stable.join(', ') || '-'}`);
  console.log(`남길 dev: ${r.keep.join(', ') || '-'}`);
  console.log(`지울 dev: ${r.remove.join(', ') || '-'}`);
  if (!r.remove.length) process.exit(0);
  if (!yes) { console.log('지우려면 --yes를 붙인다.'); process.exit(0); }
  let failed = 0;
  for (const tag of r.remove) {
    try { execFileSync('gh', ['release', 'delete', tag, '--yes', '--cleanup-tag'], { stdio: 'ignore' }); }
    catch (e) { failed++; console.error(`지우지 못했다: ${tag} (${e.message})`); continue; }
    try { execFileSync('git', ['tag', '-d', tag], { stdio: 'ignore' }); } catch {} // 로컬에 없으면 그대로
    console.log(`지웠다: ${tag}`);
  }
  process.exit(failed ? 2 : 0);
}
