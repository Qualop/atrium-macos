// P129: 옛 판 옮기기 모듈(herdr → herdr-core). 판의 터미널 백엔드는 hc 하나이고, herdr로 돌던 옛 판은 판이 뜰 때 한 번 hc로 옮긴다.
// 판에서 herdr를 아는 코드는 이 폴더(herdr-migrate/)뿐이다. 판(backend.mjs)은 여기 셋만 부른다:
//   openTerminal(b, hc)  판이 뜰 때: 옛 판이면 hc(주)와 herdr를 함께 쥐는 라우터를, 아니면 hc 어댑터를 그대로 돌려준다
//   startMigration(b)    첫 resync 뒤: 옛 판이면 옮기기를 시작한다(move.mjs). 아니면 아무것도 하지 않는다
//   migrationView(b)     설정 › 터미널과 판 위 띠가 보는 진행(없으면 null)
// update-verify.mjs는 HERDR_PROTOCOLS를 낸다(옛 업데이터가 herdr 판에서 이 버전으로 올라오게).
// P132: 계속 지원한다(사용자 결정, 2026-11-13). herdr가 깔려 있지 않아도 옮긴다(소켓으로 읽고 옮기며, 실행 파일은 있으면 끄기·세션 지우기에만 쓴다).
// 판의 나머지 코드는 herdr를 부르지 않는다. 옛 판 옮기기에 필요한 것만 이 폴더에 둔다.
import fs from 'node:fs';
import { HerdrAdapter, findHerdr, readServerExe, herdrSessionDir } from './adapter.mjs';
import { TerminalRouter, paneBackend } from './router.mjs';
import { Migrator } from './move.mjs';
import { envVar } from '../config.mjs';

export { HERDR_PROTOCOLS } from './discover.mjs';

// 옛 herdr 판인가(순수에 가깝다). meta: 판 기록의 terminalBackend, openRows: 열린 세션 행, oldBoard: P117 전 판의 herdr 흔적
// → { legacy, why }
export function legacyOf({ meta = null, openRows = [], oldBoard = false } = {}) {
  if (openRows.some((r) => r.paneId && paneBackend(r.paneId) === 'herdr')) return { legacy: true, why: 'herdr panes' };
  if (meta && String(meta.backend || '').toLowerCase() === 'herdr') return { legacy: true, why: 'board record' };
  if (!meta && oldBoard) return { legacy: true, why: 'old board' };
  return { legacy: false, why: meta ? 'board record' : 'new board' };
}
// P117 전 판(판 기록이 없음)의 herdr 흔적: 세션 행이 있거나(열린·닫힌), herdr 서버 PID를 저장했거나, 이 판의 herdr 세션 폴더가 있다
export function isOldBoard({ store, session, exists = (p) => fs.existsSync(p) }) {
  try { if (store && store.anySessionRow && store.anySessionRow()) return true; } catch {}
  try { if (store && store.getMeta('herdrServerPid')) return true; } catch {}
  try { if (session && exists(herdrSessionDir(session))) return true; } catch {}
  return false;
}

// 판이 뜰 때(어댑터를 만들 때). 옛 판이면 판 기록을 hc로 바꾸고(새 세션은 hc에 뜬다) herdr 어댑터를 함께 쥔 라우터를 돌려준다
export async function openTerminal(b, hc, { env = process.env, makeHerdr = null } = {}) {
  const store = b.store, cfg = b.cfg;
  const meta = store.getMeta('terminalBackend');
  const openRows = store.openSessions();
  const l = legacyOf({ meta, openRows, oldBoard: !meta && isOldBoard({ store, session: cfg.terminalSession }) });
  // 이미 hc였던 판(P117로 옮김, 새 판): 옛 이름으로 저장한 hc 서버 PID를 새 이름으로 옮긴다(판이 "꺼진 동안 서버가 바뀜"을 견준다, C3).
  // herdr 판의 옛 값은 herdr 서버 PID라 옮기지 않는다
  if (meta && meta.backend === 'hc' && store.getMeta('herdrServerPid') && !store.getMeta('terminalServerPid')) store.setMeta('terminalServerPid', store.getMeta('herdrServerPid'));
  if (!l.legacy) {
    if (!meta || meta.backend !== 'hc') store.setMeta('terminalBackend', { backend: 'hc', by: 'new-board', at: Date.now() });
    return hc;
  }
  // herdr 실행 파일: 도는 판 서버의 것 → 찾기(ATRIUM_HERDR, 옛 설정 herdrPath, 설치기·PATH). 없어도 소켓으로 붙어 옮긴다(끄기·지우기만 못 한다)
  let herdrPath = null;
  if (!makeHerdr) {
    herdrPath = await readServerExe(cfg.terminalSession).catch(() => null);
    if (!herdrPath) { const s = store.getMeta('settings') || {}; herdrPath = (await findHerdr({ envPath: envVar('HERDR', env) || '', settingPath: String(s.herdrPath || '').trim().replace(/^"(.*)"$/, '$1'), env }).catch(() => ({}))).path || null; }
  }
  const herdr = makeHerdr ? makeHerdr() : new HerdrAdapter({ herdrPath, session: cfg.terminalSession, logDir: cfg.logDir });
  herdr.backend = 'herdr';
  const router = new TerminalRouter({ primary: hc, others: [herdr] });
  const startPanes = openRows.filter((r) => r.paneId && paneBackend(r.paneId) === 'herdr').map((r) => r.sessionId);
  b._herdrMigration = { herdr, startPanes, why: l.why, herdrPath };
  store.setMeta('terminalBackend', { backend: 'hc', by: 'migrate', from: 'herdr', at: Date.now() });
  b.log(`old herdr board (${l.why}): moving ${startPanes.length} session(s) to herdr-core; herdr exe ${herdrPath || 'not found'}`);
  return router;
}

// 첫 resync 뒤 한 번. 옛 판이면 옮기기를 시작한다
export function startMigration(b, opts = {}) {
  const m = b._herdrMigration;
  if (!m || m.migrator) return null;
  m.migrator = new Migrator(b, b.adapter, { herdr: m.herdr, startPanes: m.startPanes, ...opts });
  m.migrator.start();
  return m.migrator;
}
export function stopMigration(b) { const m = b._herdrMigration; if (m && m.migrator) m.migrator.stop(); }

// 진행(지금 옮기는 중이면 그것, 아니면 지난 결과, 옛 판이 아니었으면 null)
export function migrationView(b) {
  const m = b._herdrMigration;
  if (m && m.migrator) return m.migrator.view();
  if (m) return { state: 'preparing', startedAt: null, endedAt: null, error: null, total: m.startPanes.length, rows: [], moved: 0, asleep: 0, waiting: m.startPanes.length, failed: 0, recreated: 0, stoppedOld: null, deleted: null };
  return b.store ? b.store.getMeta('herdrMigration') || null : null;
}
