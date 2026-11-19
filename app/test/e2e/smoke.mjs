// 창이 뜨고 백엔드·herdr에 붙는지 본다(완료 기준 1의 앞부분)
import { launch, shot, logger } from './harness.mjs';

const log = logger('smoke');
const { app, page } = await launch({ log });
await page.waitForFunction(() => window.__mt.getState().conn === 'open' && window.__mt.getState().terminal.connected, null, { timeout: 60000 });
log('상태', await page.evaluate(() => ({ conn: window.__mt.getState().conn, terminal: window.__mt.getState().terminal, sessions: window.__mt.getState().sessions.size, info: { ...window.__mt.api.info, token: undefined } })));
await shot(page, 'smoke', log);
await app.close();
