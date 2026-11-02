// P9 시험 판 막기: 실제 판 프로필(--dev 없음)로 창을 띄우는 시험은 herdr 세션, 포트, 데이터 폴더, 창 프로필 네 값을 모두 시험 판 값으로 덮어야 한다.
// 하나라도 빠지거나 실제 판·다른 판의 값이면 띄우지 않는다(CLAUDE.md: 실제 판으로는 시험하지 않는다). Playwright를 부르지 않아 단위 시험에서도 쓴다
// P18: 값 이름은 ATRIUM_*가 본 이름이고 옛 이름 MTASK_*도 받는다(ATRIUM_*가 이긴다). 시험 판 이름은 atrium-dev-<이름>, 옛 multitask-dev-<이름>도 받는다.
//      실제 판 값은 새 것(atrium, %LOCALAPPDATA%\atrium, atrium-app-real)과 옛 것(multitask …)을 모두 막는다.
//      옮기기 시험(assertLegacyTestBoard)은 옛 판 값(ATRIUM_LEGACY_*)도 시험 판 값인지 본다
import os from 'node:os';
import path from 'node:path';
import { appDataDir, canonicalPath } from '../../../backend/src/platform.mjs';

const NAMES = ['HERDR_SESSION', 'PORT', 'DATA_DIR', 'APP_USERDATA'];
const IDS = ['atrium', 'multitask'];
const localAppData = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const appData = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (p, root) => { const r = path.relative(path.resolve(root), path.resolve(p)); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

// 값 하나: ATRIUM_<이름>, 없으면 옛 MTASK_<이름>
const val = (env, name) => (env[`ATRIUM_${name}`] !== undefined ? env[`ATRIUM_${name}`] : env[`MTASK_${name}`]);
// 옛 이름(MTASK_*)으로 적힌 판 값을 ATRIUM_*로(experiments/*/tools/env.cjs는 기록이라 고치지 않는다)
export const atriumEnv = (env) => Object.fromEntries(Object.entries(env || {}).map(([k, v]) => [k.replace(/^MTASK_/, 'ATRIUM_'), v]));

function checkSession(s, what = 'herdr 세션') {
  const ok = IDS.some((id) => s.startsWith(`${id}-dev-`));
  if (!s || IDS.some((id) => s === id || s === `${id}-dev`) || s === 'default' || !ok) throw new Error(`${what} ${s}: 시험 판 이름(atrium-dev-<이름>)만 쓴다`);
}
function checkDataDir(d, what = '데이터 폴더') {
  for (const id of IDS) if ([localAppData(), appDataDir()].some((base) => same(canonicalPath(d), canonicalPath(path.join(base, id))))) throw new Error(`${what}가 실제 판의 폴더다(${id})`);
}
function checkAppProfile(d, what = '창 프로필') {
  for (const id of IDS) for (const p of [`${id}-app-real`, `${id}-app-dev`]) if ([appData(), appDataDir({ roaming: true })].some((base) => same(canonicalPath(d), canonicalPath(path.join(base, p))))) throw new Error(`${what}이 ${p}다`);
}

// env: 창에 넘길 환경 변수, root: 시험 데이터가 있어야 할 폴더(이 워크트리의 backend/.dev) → 문제가 있으면 Error를 던진다
export function assertTestBoard(env, { root } = {}) {
  const missing = NAMES.filter((n) => !val(env, n)).map((n) => `ATRIUM_${n}`);
  if (missing.length) throw new Error(`시험 판 값이 빠졌다: ${missing.join(', ')}. 네 값을 모두 덮어야 띄운다`);
  checkSession(val(env, 'HERDR_SESSION'));
  const port = Number(val(env, 'PORT'));
  if (!Number.isInteger(port) || port === 47800 || (port >= 47811 && port <= 47820)) throw new Error(`포트 ${val(env, 'PORT')}: 실제 판(47800)과 다른 판(47811~47820)은 쓰지 않는다`);
  checkDataDir(val(env, 'DATA_DIR'));
  checkAppProfile(val(env, 'APP_USERDATA'));
  if (root) for (const n of ['DATA_DIR', 'APP_USERDATA']) if (!inside(val(env, n), root)) throw new Error(`ATRIUM_${n}(${val(env, n)})가 시험 폴더(${root}) 밖이다`);
  return true;
}

// P18 옮기기 시험: 판 값과 함께 옮길 옛 판 값(ATRIUM_LEGACY_HERDR_SESSION, ATRIUM_LEGACY_DATA_DIR, ATRIUM_LEGACY_APP_USERDATA)도 모두 시험 판 값이어야 한다.
// 빠지면 백엔드는 기본 옛 판(진짜 multitask)을 옮기지 않지만(config.mjs legacyOf), 시험이 무엇을 옮기는지 분명하도록 셋 다 요구한다
export function assertLegacyTestBoard(env, { root } = {}) {
  assertTestBoard(env, { root });
  const L = { HERDR_SESSION: env.ATRIUM_LEGACY_HERDR_SESSION, DATA_DIR: env.ATRIUM_LEGACY_DATA_DIR, APP_USERDATA: env.ATRIUM_LEGACY_APP_USERDATA };
  const missing = Object.keys(L).filter((k) => !L[k]).map((k) => `ATRIUM_LEGACY_${k}`);
  if (missing.length) throw new Error(`옛 판 값이 빠졌다: ${missing.join(', ')}`);
  checkSession(L.HERDR_SESSION, '옛 herdr 세션');
  checkDataDir(L.DATA_DIR, '옛 데이터 폴더');
  checkAppProfile(L.APP_USERDATA, '옛 창 프로필');
  if (L.HERDR_SESSION === val(env, 'HERDR_SESSION') || same(L.DATA_DIR, val(env, 'DATA_DIR')) || same(L.APP_USERDATA, val(env, 'APP_USERDATA'))) throw new Error('옛 판 값과 새 판 값이 같다');
  if (root) for (const k of ['DATA_DIR', 'APP_USERDATA']) if (!inside(L[k], root)) throw new Error(`ATRIUM_LEGACY_${k}(${L[k]})가 시험 폴더(${root}) 밖이다`);
  return true;
}
