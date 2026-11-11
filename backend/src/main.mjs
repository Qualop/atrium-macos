// 백엔드 실행: node src/main.mjs [--dev]
// 환경 변수 ATRIUM_PROFILE, ATRIUM_HERDR_SESSION, ATRIUM_PORT, ATRIUM_DATA_DIR(옛 이름 MTASK_*도 받는다)로 프로필 기본값을 바꿀 수 있다.
import { loadConfig } from './config.mjs';
import { Backend } from './backend.mjs';

const cfg = loadConfig();
const backend = new Backend(cfg);
let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  try { await backend.stop(sig); } catch (e) { console.error(e); }
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => shutdown(sig));
process.on('uncaughtException', (e) => { backend.log('uncaught', e.stack); });
process.on('unhandledRejection', (e) => { backend.log('unhandled', e && e.stack ? e.stack : String(e)); });

backend.start().catch((e) => {
  console.error(`백엔드를 시작하지 못했습니다: ${e.message}`);
  try { backend.log('start failed', e.stack); } catch {}
  process.exit(1);
});
