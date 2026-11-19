// P142 창 시험: 명령 바 입력칸. 한 줄 → 꺾여 늘어나는 긴 글 → 상한을 넘는 글에서 바 높이·여백·단추 자리를 재고 그림을 남긴다.
// @태그 두 개가 든 글의 알약·받는 세션 칩, Alt+Enter·Shift+Enter 줄바꿈과 되돌리기, 한글 IME 조합(CDP)으로 @이름 뒤에 쓰기,
// 보내면 두 세션에 전달, 움직임 줄이기(reduce)에서도 같은 값인지 본다.
// 사용: node experiments/p142/tools/e2e.cjs p142-cmd.mjs  (판: atrium-dev-p142, 47912, 창 원격 디버깅 9392. 결과는 experiments/p142/)
import fs from 'node:fs';
import path from 'node:path';
import * as L from './ux2-lib.mjs';

const log = L.logger('p142-cmd');
const rec = L.recorder('p142-cmd', log);
let app, page, sp;
const sel = '[data-role="command"]';

// 바, 글칸, 입력칸, 단추, 마크, 칩 줄의 자리
const measure = () => page.evaluate(() => {
  const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), left: +b.left.toFixed(2), right: +b.right.toFixed(2), h: +b.height.toFixed(2), w: +b.width.toFixed(2) }; };
  const ta = document.querySelector('.mt-cmd-input'), mir = document.querySelector('.mt-cmd-mirror'), inner = document.querySelector('.mt-cmd-mirror-in');
  const bar = r('.mt-cmd'), t = r('.mt-cmd-input');
  return {
    bar, ta: t, send: r('.mt-cmd-send'), thread: r('.mt-cmd-thread'), mark: r('.mt-cmd > .mt-mark'), chips: r('.mt-chips'), to: r('.mt-cmd-to'),
    padTop: +(t.top - bar.top).toFixed(2), padBottom: +(bar.bottom - t.bottom).toFixed(2),
    sendBottom: +(bar.bottom - document.querySelector('.mt-cmd-send').getBoundingClientRect().bottom).toFixed(2),
    scrollH: ta.scrollHeight, clientH: ta.clientHeight, scrollTop: ta.scrollTop, overflowY: getComputedStyle(ta).overflowY,
    mirScroll: mir.scrollTop, mirW: mir.clientWidth, taW: ta.clientWidth, innerH: +inner.getBoundingClientRect().height.toFixed(2),
    grow: getComputedStyle(document.querySelector('.mt-stage')).getPropertyValue('--mt-cmd-grow').trim(),
    lines: Math.round(ta.scrollHeight / parseFloat(getComputedStyle(ta).lineHeight)),
  };
});
const setText = async (v) => { await page.click(sel); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); if (v) await page.keyboard.insertText(v); await L.sleep(150); };
const value = () => page.$eval(sel, (e) => e.value);
const clipShot = async (name) => {
  const b = await page.evaluate(() => { const c = document.querySelector('.mt-cmd').getBoundingClientRect(); const ch = document.querySelector('.mt-chips'); const top = Math.min(c.top, ch ? ch.getBoundingClientRect().top : c.top) - 60; return { x: c.left - 40, y: Math.max(0, top), width: c.width + 80, height: c.bottom + 30 - Math.max(0, top) }; });
  const f = path.join(L.OUT, `${name}.png`);
  await page.screenshot({ path: f, clip: b });
  log('그림', path.relative(L.REPO, f));
};

async function sizes(tag) {
  const out = {};
  await setText('');
  out.empty = await measure();
  await setText('@lead 한 줄');
  out.one = await measure();
  await clipShot(`${tag}-1-one`);
  const long = '@lead ' + '아주 긴 글이 바 너비를 넘어 저절로 꺾여 늘어나는지 본다. '.repeat(10);
  await setText(long);
  out.wrap = await measure();
  await clipShot(`${tag}-2-wrap`);
  await setText('@lead ' + Array.from({ length: 40 }, (_, i) => `줄 ${i + 1} — 상한을 넘는 글`).join('\n'));
  out.over = await measure();
  await clipShot(`${tag}-3-over`);
  const same = (a, b) => Math.abs(a - b) < 0.6;
  rec.step(`${tag}: 한 줄 바 높이 60`, same(out.one.bar.h, 60), out.one.bar.h);
  rec.step(`${tag}: 꺾인 줄로 높이가 는다`, out.wrap.bar.h > 80 && out.wrap.overflowY === 'hidden' && out.wrap.scrollH <= out.wrap.clientH + 1, { h: out.wrap.bar.h, lines: out.wrap.lines });
  rec.step(`${tag}: 상한 18줄(창 높이 42% 이내), 안쪽 스크롤`, out.over.overflowY === 'auto' && out.over.scrollH > out.over.clientH && out.over.ta.h <= 21.75 * 18 + 1, { taH: out.over.ta.h, scrollH: out.over.scrollH });
  rec.step(`${tag}: 위아래 여백이 늘 같다(18+1)`, [out.one, out.wrap, out.over].every((m) => same(m.padTop, out.one.padTop) && same(m.padBottom, out.one.padBottom)), [out.one, out.wrap, out.over].map((m) => [m.padTop, m.padBottom]));
  rec.step(`${tag}: 바 아래 끝과 단추 자리가 그대로`, [out.wrap, out.over].every((m) => same(m.bar.bottom, out.one.bar.bottom) && same(m.sendBottom, out.one.sendBottom) && same(m.send.left, out.one.send.left)), [out.one, out.wrap, out.over].map((m) => [m.bar.bottom, m.sendBottom, m.send.left]));
  rec.step(`${tag}: 칩 줄이 바 위로 비킨다`, [out.one, out.wrap, out.over].every((m) => !m.chips || m.chips.bottom <= m.bar.top - 10), [out.one, out.wrap, out.over].map((m) => [m.chips && m.chips.bottom, m.bar.top, m.grow]));
  rec.step(`${tag}: 겹과 입력칸 폭·스크롤이 같다`, [out.one, out.wrap, out.over].every((m) => m.mirW === m.taW && m.mirScroll === m.scrollTop), [out.one, out.wrap, out.over].map((m) => [m.mirW, m.taW, m.mirScroll, m.scrollTop]));
  rec.step(`${tag}: 커서(끝)가 보인다`, out.over.scrollTop + out.over.clientH >= out.over.scrollH - 2, [out.over.scrollTop, out.over.clientH, out.over.scrollH]);
  return out;
}

try {
  L.prepare();
  ({ app, page } = await L.open({ log, bottomPin: true }));
  sp = L.spawner(page, log);
  await sp.spawn(L.T.DIR, 'lead', '--model', 'haiku');
  await sp.spawn(L.T.DIR, 'w2', '--model', 'haiku');
  await sp.spawn(L.T.DIR, 'sh', '--kind', 'shell');
  await L.sleep(1500);

  const normal = await sizes('a');

  // 휠: 상한에 닿은 글칸 안에서 위로 굴리면 글칸만 스크롤된다
  const b0 = await measure();
  await page.mouse.move(b0.ta.left + 40, b0.ta.top + 40);
  await page.mouse.wheel(0, -300);
  await L.sleep(300);
  const b1 = await measure();
  rec.step('휠로 글칸 안쪽이 스크롤되고 겹이 따라온다', b1.scrollTop < b0.scrollTop && b1.mirScroll === b1.scrollTop, [b0.scrollTop, b1.scrollTop, b1.mirScroll]);

  // @태그 두 개 + 없는 이름 + 글 중간
  await setText('@lead @w2 @ghost 결과를 @sh 에게도 알려 줘');
  const tags = await page.evaluate(() => ({
    tags: [...document.querySelectorAll('.mt-cmd-tag')].map((e) => [e.dataset.tag, e.className]),
    to: [...document.querySelectorAll('.mt-cmd-to-chip')].map((e) => [e.dataset.to, e.dataset.state, e.title]),
  }));
  rec.step('@태그 알약과 받는 세션 칩', JSON.stringify(tags.to.map((x) => [x[0], x[1]])) === JSON.stringify([['lead', 'ok'], ['w2', 'ok'], ['ghost', 'unknown']]) && tags.tags.length === 4, tags);
  await clipShot('b-tags');
  await setText('@all @lead 모두에게');
  const all = await page.evaluate(() => [...document.querySelectorAll('.mt-cmd-to-chip')].map((e) => [e.dataset.to, e.dataset.state, e.textContent]));
  rec.step('@all 칩에 에이전트 수', all.length === 2 && all[0][1] === 'all' && /2$/.test(all[0][2]), all);

  // 줄바꿈 키
  await setText('@lead 첫 줄');
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.insertText('둘째');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.insertText('셋째');
  const v1 = await value();
  rec.step('Alt+Enter·Shift+Enter 줄바꿈(보내지 않음)', v1 === '@lead 첫 줄\n둘째\n셋째', JSON.stringify(v1));
  await page.keyboard.press('Control+Z'); await page.keyboard.press('Control+Z'); await page.keyboard.press('Control+Z');
  const v2 = await value();
  rec.step('되돌리기(Ctrl+Z)가 Alt+Enter 줄바꿈도 되돌린다', !v2.includes('둘째\n') && v2.startsWith('@lead 첫 줄'), JSON.stringify(v2));
  // 후보가 떠 있을 때 Enter는 그대로 채우기
  await setText('@le');
  const menu = await page.$$eval('.mt-mention-item', (els) => els.map((e) => e.textContent));
  await page.keyboard.press('Enter');
  rec.step('@ 후보가 떠 있을 때 Enter는 채우기', (await value()) === '@lead ' && menu.length > 0, { menu, v: await value() });

  // 한글 IME 조합(CDP): @lead 뒤에 '안녕'을 조합하며 쓴다
  await setText('@lead ');
  const cdp = await page.context().newCDPSession(page);
  for (const [txt, s] of [['ㅇ', 1], ['아', 1], ['안', 1], ['안ㄴ', 2], ['안녀', 2], ['안녕', 2]]) { await cdp.send('Input.imeSetComposition', { text: txt, selectionStart: s, selectionEnd: s }); await L.sleep(60); }
  const mid = await measure();
  const midTags = await page.$$eval('.mt-cmd-tag', (els) => els.map((e) => e.textContent));
  await cdp.send('Input.insertText', { text: '안녕' });
  await L.sleep(150);
  const v3 = await value();
  rec.step('한글 IME로 @이름 뒤에 쓰기', v3 === '@lead 안녕' && midTags[0] === '@lead' && mid.mirW === mid.taW, { v3, midTags });
  await clipShot('c-ime');
  await cdp.detach();

  // 보내기: 두 세션에 전달
  await L.waitStateOf(page, 'lead', ['idle', 'done', 'waiting', 'needs-input', 'ready'], 40000).catch(() => {});
  await setText('@lead @w2 reply with the single word ok');
  await page.keyboard.press('Enter');
  await L.sleep(1500);
  const dels = await page.evaluate(() => [...window.__mt.getState().deliveries.values()].map((d) => [d.name, d.status]));
  rec.step('보내면 두 세션에 전달', (await value()) === '' && ['lead', 'w2'].every((n) => dels.some((d) => d[0] === n)), dels);
  await clipShot('d-sent');

  // 움직임 줄이기(reduce)
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduce = await sizes('r');
  rec.step('reduce: 같은 값', ['one', 'wrap', 'over'].every((k) => Math.abs(reduce[k].bar.h - normal[k].bar.h) < 0.6), ['one', 'wrap', 'over'].map((k) => [normal[k].bar.h, reduce[k].bar.h]));
  await page.emulateMedia({ reducedMotion: null });

  // 좁은 창(휴대폰 폭에 가까운 판)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(760, 700));
  await L.sleep(600);
  await setText('@lead @w2 ' + '좁은 창에서 꺾이는 글. '.repeat(12));
  const narrow = await measure();
  rec.step('좁은 창: 바가 창 안, 겹 폭이 같다', narrow.bar.left >= 0 && narrow.mirW === narrow.taW && narrow.bar.top > 0, { bar: narrow.bar, mirW: narrow.mirW, taW: narrow.taW, to: narrow.to });
  await clipShot('e-narrow');
  await setText('');
  rec.save({ normal, reduce, narrow });
} catch (e) {
  log('오류', e.stack || e.message);
  rec.step('각본 오류', false, e.message);
  rec.save();
} finally {
  try { if (sp) sp.killAll(); } catch {}
  if (app) await L.closeApp(app);

  const bad = rec.results.filter((r) => r.ok === false);
  console.log(bad.length ? `실패 ${bad.length}` : `통과 ${rec.results.length}`);
  fs.writeFileSync(path.join(L.OUT, 'p142-cmd.summary.txt'), rec.results.map((r) => `${r.ok ? 'OK ' : 'NG '} ${r.name}`).join('\n') + '\n');
  process.exit(rec.results.some((r) => r.ok === false) ? 1 : 0); // playwright가 남긴 연결 때문에 node가 끝나지 않는 것을 막는다
}
