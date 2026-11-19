// P9 시험 판 정리: 시험 세션을 끄고(atrium kill), herdr 서버와 백엔드를 멈추고, 그 herdr 세션(atrium-dev-p9)과 데이터 폴더를 지운다.
// --dirs를 주면 시험 폴더(C:\Workspace\mtask-p9-*)도 지운다. 다른 herdr 세션과 판은 건드리지 않는다. 열린 창은 먼저 닫는다(열린 창은 꺼진 백엔드를 다시 띄운다)
// 사용(app 폴더에서): MT_E2E_OUT=p9 node test/e2e/p9-clean.mjs [--dirs]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ENV, DEV, DIRS, atrium, sleep } from './p9-lib.mjs';
import { loadConfig } from '../../../backend/src/config.mjs';
import { hcStateDir } from '../../../backend/src/hc/core.mjs'; // P129: 이 판의 hc 상태 폴더(세션을 지우는 자리)

const say = (...a) => console.log(...a);
const cfg = loadConfig({ argv: ['--dev'], env: { ...process.env, ...ENV } });
if (cfg.terminalSession !== 'atrium-dev-p9') throw new Error('P9 판만');
let up = true;
try { atrium('status'); } catch { up = false; }
if (up) {
  const list = JSON.parse(atrium('--json', 'ls'));
  const sessions = Array.isArray(list) ? list : list.sessions || [];
  for (const s of sessions) { try { say('kill', s.name, atrium('kill', s.name, '--yes').trim().slice(0, 120)); } catch (e) { say('kill 실패', s.name, String(e.message).slice(0, 200)); } }
  await sleep(3000);
  try { say('herdr stop', atrium('herdr', 'stop', '--yes').trim().slice(0, 200)); } catch (e) { say('herdr stop 실패', String(e.message).slice(0, 200)); }
  try { say('backend stop', atrium('backend', 'stop').trim()); } catch (e) { say('backend stop 실패', String(e.message).slice(0, 200)); }
}
{ const d = hcStateDir(cfg.terminalSession); fs.rmSync(d, { recursive: true, force: true }); say('hc 상태 지움', d); }
for (const d of [ENV.ATRIUM_DATA_DIR, ENV.ATRIUM_APP_USERDATA, path.join(DEV, 'app-dev'), path.join(DEV, 'app-npm')]) { fs.rmSync(d, { recursive: true, force: true }); say('지움', d); }
if (process.argv.includes('--dirs')) for (const d of Object.values(DIRS)) { fs.rmSync(d, { recursive: true, force: true }); say('지움', d); }
say('남은 herdr 세션', fs.existsSync(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'herdr', 'sessions')) ? fs.readdirSync(path.join(process.env.APPDATA, 'herdr', 'sessions')).join(', ') : '-');
process.exit(0);
