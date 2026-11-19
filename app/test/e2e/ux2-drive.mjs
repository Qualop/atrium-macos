// ux2 탐색 드라이버: ux2 판의 창을 띄워 두고, 로컬 주소(127.0.0.1:47919)로 받은 짧은 스크립트를 그 창에 돌린다(ux1-drive.mjs를 옮김).
// 스크립트는 async 함수 몸통이고 page, app, L(ux2-lib), log, ctx를 받는다.
// 사용: node experiments/ux2/tools/e2e.cjs ux2-drive.mjs [--w 1584 --h 921 --lang ko]
//       node experiments/ux2/tools/do.cjs <스크립트 파일>     (결과 JSON을 찍는다)
//       POST /quit 로 창을 닫고 끝낸다(세션은 끄지 않는다). POST /reopen {w,h,lang}로 창을 다시 연다.
import http from 'node:http';
import * as L from './ux2-lib.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const log = L.logger('ux2-drive');
L.prepare();
let ctx = await L.open({ log, w: +arg('--w', 1584), h: +arg('--h', 921), lang: arg('--lang', 'ko') });
log('드라이버 준비', { mainPid: ctx.mainPid });
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const srv = http.createServer(async (req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj, null, 1)); };
    try {
      if (req.url === '/quit') { reply(200, { ok: true }); await L.closeApp(ctx.app); srv.close(); process.exit(0); }
      if (req.url === '/reopen') { await L.closeApp(ctx.app); const o = JSON.parse(body || '{}'); ctx = await L.open({ log, ...o }); return reply(200, { ok: true, mainPid: ctx.mainPid }); }
      const fn = new AsyncFunction('page', 'app', 'L', 'log', 'ctx', body);
      const out = await Promise.race([fn(ctx.page, ctx.app, L, log, ctx), new Promise((_, rej) => setTimeout(() => rej(new Error('120초 넘음')), 120000))]);
      reply(200, { ok: true, out, errors: ctx.errors.splice(0) });
    } catch (e) { reply(200, { ok: false, error: String(e && (e.stack || e.message)).slice(0, 1500), errors: ctx.errors.splice(0) }); }
  });
});
srv.listen(47919, '127.0.0.1', () => log('듣는 중 127.0.0.1:47919'));
