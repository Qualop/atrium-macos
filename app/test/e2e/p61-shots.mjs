// P61 전후 스크린숏: 두 창 크기(1584×921, 1366×768)에서 찾기 창(빈 칸, 결과 있음, 결과 없음)과 아래 바(보임).
// 바꾸기 전 코드와 뒤 코드에서 같은 순서로 찍는다. 사용: node experiments/p61/tools/e2e.cjs p61-shots.mjs --tag before|after [--fresh]
import { board, sleep, until } from './p61-lib.mjs';

const argv = process.argv.slice(2);
const TAG = `p61-shots-${argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : 'after'}`;
const b = board(TAG);
const { log } = b;
let code = 1;
try {
  if (argv.includes('--fresh')) await b.fresh();
  await b.launch();
  await b.seed();
  const page = b.page;
  for (const [w, h] of [[1584, 921], [1366, 768]]) {
    await b.size(w, h);
    const tag = `${w}x${h}`;
    await page.mouse.move(w / 2, 300);
    await sleep(900);
    await b.shot(`${tag}-01-board`);
    await page.evaluate(() => window.__mt.pinBottom(true)); await sleep(500);
    await b.shot(`${tag}-02-bottom`);
    await page.evaluate(() => window.__mt.pinBottom(false)); await sleep(500);
    await page.click('[data-action="search"]'); await sleep(300);
    await page.fill('[data-field="search"]', ''); await sleep(300);
    await b.shot(`${tag}-03-search-idle`);
    await page.fill('[data-field="search"]', 'p61');
    await until(() => page.evaluate(() => document.querySelectorAll('.mt-search-item:not(.empty)').length >= 2), 10000, 200).catch(() => log('결과가 둘 넘게 오지 않았다'));
    await sleep(300);
    await page.keyboard.press('ArrowDown'); await sleep(200);
    await b.shot(`${tag}-04-search-results`);
    await page.fill('[data-field="search"]', 'zzqx none');
    await sleep(900);
    await b.shot(`${tag}-05-search-empty`);
    await page.keyboard.press('Escape'); await sleep(500);
  }
  code = 0;
} catch (e) {
  log('오류', e.stack || e.message);
} finally {
  await b.close();
}
process.exit(code);
