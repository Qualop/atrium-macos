// P97 창 시험 after 단계(p97-launchers.mjs가 부른다): 새 런처 만들기 흐름과 레일 이름 칸.
// 1) 레일 +로 새 런처(붙여 넣기 칸에 초점) 2) ocx claude 한 줄 붙여 넣기 → 판 세션으로 알아봄, 칸 채움, 레일 고정을 켠 채 만들기
// 3) 여러 줄·codex 붙여 넣기 4) 드롭다운에서 시작해도 실행 명령·추가 인자를 같은 화면에서 고침, PATH 경고 5) 최소 창(영어·한국어)
// 6) 레일 이름 칸: 초점, 겹침·글자 알림, Esc·바깥 취소, 이름으로 만들기, 빈칸이면 판이 짓기, Shift+누르기는 새 세션 창
const pasteInto = (page, text) => page.evaluate((t) => {
  const el = document.querySelector('[data-field="launcher-paste"]');
  el.focus();
  const dt = new DataTransfer(); dt.setData('text/plain', t);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);
const val = (page, f) => page.inputValue(`[data-field="${f}"]`);

export async function run({ page, call, atrium, step, shot, log, settings, closeSettings, sessionsByName, sleep, until }) {
  // 1. 레일 + → 설정 › 런처 › 새 런처, 붙여 넣기 칸에 초점
  await shot(page, '1-rail');
  await page.click('[data-action="launcher-add"]');
  await page.waitForSelector('[data-role="launcher-form"]');
  await sleep(400);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.field);
  step('레일 +는 새 런처 틀을 열고 명령줄 칸에 초점', focused === 'launcher-paste', focused);
  await shot(page, '2-new-form');

  // 2. ocx claude 한 줄 붙여 넣기
  await pasteInto(page, 'ocx claude --model haiku --permission-mode manual --verbose');
  await page.waitForSelector('[data-role="launcher-recognized"][data-as="claude"]', { timeout: 10000 });
  await sleep(500);
  const filled = { name: await val(page, 'launcher-name'), start: await val(page, 'launcher-startCommand'), model: await val(page, 'launcher-model'), mode: await page.$eval('[data-field="launcher-permissionMode"]', (e) => e.value), args: await val(page, 'launcher-args'), harness: await page.$eval('[data-field="launcher-harness"]', (e) => e.value) };
  step('붙여 넣기: 하네스·실행 명령·모델·승인 방식·추가 인자를 나눠 채운다', filled.harness === 'claude' && filled.start === 'ocx claude' && filled.model === 'haiku' && filled.mode === 'manual' && filled.args === '--verbose' && filled.name === 'ocx claude haiku', filled);
  const board = await page.$eval('[data-role="launcher-recognized"]', (e) => ({ board: e.dataset.board, text: e.textContent }));
  step('무엇으로 알아봤는지 보인다(판 세션)', board.board === '1' && /hook|연동/.test(board.text), board.text);
  const pv = await page.textContent('[data-role="launcher-form-preview"]');
  step('미리보기는 실행 명령 + 판 연동', /ocx claude --permission-mode manual --model haiku --verbose/.test(pv) && /board|보드/.test(pv), pv);
  step('ocx는 PATH에 있어 경고가 없다', !(await page.$('[data-role="launcher-start-warn"]')));
  const pin = await page.isChecked('[data-field="launcher-favorite"]');
  step('레일에 고정이 만들기 옆에서 켜져 있다', pin === true && !!(await page.$('.mt-ln-foot [data-field="launcher-favorite"]')), pin);
  await shot(page, '3-pasted');
  await page.click('[data-action="launcher-save"]');
  await page.waitForSelector('[data-role="launchers-list"]');
  await sleep(600);
  const d = await call(page, 'launcher.list');
  const made = d.launchers.find((l) => l.name === 'ocx claude haiku');
  step('만들면서 레일에 고정(한 번에)', !!made && made.startCommand === 'ocx claude' && made.favorite && d.favorites.at(-1) === made.id, made && { id: made.id, startCommand: made.startCommand, favorite: made.favorite, line: made.preview.line });
  await shot(page, '4-list');

  // 3. 여러 줄(PowerShell) 붙여 넣기와 codex
  await page.click('[data-action="launcher-new"]');
  await page.waitForSelector('[data-role="launcher-form"]');
  await pasteInto(page, "$env:MY_FLAG='on'\r\nclaude --model sonnet --effort high `\r\n  --permission-mode acceptEdits");
  await page.waitForSelector('[data-role="launcher-recognized"][data-as="claude"]', { timeout: 10000 });
  await sleep(400);
  const ml = { model: await val(page, 'launcher-model'), effort: await page.$eval('[data-field="launcher-effort"]', (e) => e.value), mode: await page.$eval('[data-field="launcher-permissionMode"]', (e) => e.value), env: await page.inputValue('[data-field="launcher-env"]'), start: await val(page, 'launcher-startCommand') };
  step('여러 줄 붙여 넣기: 환경 변수, 이어 쓴 줄의 옵션', ml.model === 'sonnet' && ml.effort === 'high' && ml.mode === 'acceptEdits' && ml.env === 'MY_FLAG=on' && ml.start === '', ml);
  await shot(page, '5-multiline');
  await page.fill('[data-field="launcher-name"]', '');
  await page.fill('[data-field="launcher-paste"]', 'codex -m deepseek/deepseek-flash --search');
  await page.press('[data-field="launcher-paste"]', 'Enter');
  await page.waitForSelector('[data-role="launcher-recognized"][data-as="codex"]', { timeout: 10000 });
  await sleep(400);
  const cx = { harness: await page.$eval('[data-field="launcher-harness"]', (e) => e.value), model: await val(page, 'launcher-model'), args: await val(page, 'launcher-args'), start: await page.$('[data-field="launcher-startCommand"]') };
  step('codex 한 줄: Codex, -m 모델, 나머지는 추가 인자(실행 명령 칸 없음)', cx.harness === 'codex' && cx.model === 'deepseek/deepseek-flash' && cx.args === '--search' && !cx.start, { ...cx, start: !!cx.start });
  await shot(page, '6-codex');
  await page.fill('[data-field="launcher-paste"]', 'aider --yes');
  await page.press('[data-field="launcher-paste"]', 'Enter');
  await page.waitForSelector('[data-role="launcher-recognized"][data-as="command"]', { timeout: 10000 });
  await sleep(300);
  const cmd = { harness: await page.$eval('[data-field="launcher-harness"]', (e) => e.value), command: await val(page, 'launcher-command'), chip: await page.textContent('[data-role="launcher-recognized"]') };
  step('모르는 명령은 명령 한 줄(판 연동 없음)이라고 알린다', cmd.harness === 'command' && cmd.command === 'aider --yes' && /no board hooks|보드 연동 없음/.test(cmd.chip), cmd);
  await page.click('[data-action="launcher-cancel"]');
  await page.waitForSelector('[data-role="launchers-list"]');

  // 4. 드롭다운에서 시작: 실행 명령·추가 인자를 같은 화면에서, PATH에 없으면 경고
  await page.click('[data-action="launcher-new"]');
  await page.waitForSelector('[data-role="launcher-form"]');
  const grid = await page.evaluate(() => { const g = [...document.querySelectorAll('.mt-ln-grid > *')]; const sub = g.findIndex((e) => e.classList.contains('mt-set-sub')); const at = (f) => g.findIndex((e) => e.querySelector(`[data-field="${f}"]`)); return { start: at('launcher-startCommand'), args: at('launcher-args'), sub }; });
  step('Claude Code 틀: 실행 명령과 추가 인자가 고급 위에 있다(내보내기 없이 고친다)', grid.start >= 0 && grid.args >= 0 && grid.start < grid.sub && grid.args < grid.sub, grid);
  await page.fill('[data-field="launcher-name"]', 'p97-missing');
  await page.fill('[data-field="launcher-startCommand"]', 'nothere-p97 claude');
  await page.waitForSelector('[data-role="launcher-start-warn"]', { timeout: 5000 }).catch(() => null);
  const warn = await page.$('[data-role="launcher-start-warn"]');
  step('실행 명령이 PATH에 없으면 경고(저장은 막지 않는다)', !!warn && !(await page.$('[data-action="launcher-save"][disabled]')), warn ? await warn.textContent() : null);
  await page.fill('[data-field="launcher-startCommand"]', 'ocx claude --model x');
  await sleep(600);
  const bad = await page.textContent('[data-role="launcher-form-preview"]');
  step('실행 명령에 판이 정하는 인자를 쓰면 그 자리에서 알린다', /--model/.test(bad) && /board sets|보드가 직접/.test(bad), bad);
  await shot(page, '7-dropdown-start');
  await page.click('[data-action="launcher-cancel"]');
  await page.waitForSelector('[data-role="launchers-list"]');
  await closeSettings(page);
  await sleep(300);

  // 5. 최소 창(900×600): 새 런처 틀이 넘치지 않는다(영어·한국어)
  for (const lang of ['en', 'ko']) {
    await call(page, 'settings.set', { key: 'language', value: lang });
    await page.setViewportSize({ width: 900, height: 600 });
    await sleep(300);
    await page.click('[data-action="launcher-add"]');
    await page.waitForSelector('[data-role="launcher-form"]');
    await pasteInto(page, 'ocx claude --model haiku --permission-mode manual --verbose');
    await page.waitForSelector('[data-role="launcher-recognized"][data-as="claude"]', { timeout: 10000 });
    await sleep(400);
    const fit = await page.evaluate(() => { const b = document.querySelector('.mt-set-body'); const f = document.querySelector('[data-role="launcher-form"]'); const save = document.querySelector('[data-action="launcher-save"]').getBoundingClientRect(); return { body: b && [b.scrollHeight, b.clientHeight], form: f && [f.scrollHeight, f.clientHeight], saveBottom: Math.round(save.bottom), vh: window.innerHeight }; });
    step(`최소 창(900×600, ${lang})에서 새 런처 틀이 스크롤 없이 들어간다`, fit.body && fit.body[0] <= fit.body[1] + 1 && fit.saveBottom <= fit.vh, fit);
    await shot(page, `8-min-${lang}`);
    await page.click('[data-action="launcher-cancel"]');
    await closeSettings(page);
    await sleep(200);
  }
  await call(page, 'settings.set', { key: 'language', value: 'en' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(300);

  // 6. 레일 이름 칸
  const rail = (id) => `[data-role="rail-favorites"] [data-launcher="${id}"]`;
  const count = async () => (await sessionsByName(page)).length;
  const n0 = await count();
  await page.click(rail('shell'));
  await page.waitForSelector('[data-role="quick-name"]', { timeout: 5000 });
  const qf = await page.evaluate(() => document.activeElement && document.activeElement.dataset.field);
  step('레일 단추는 바로 만들지 않고 이름 칸을 띄운다(초점)', qf === 'quick-name' && (await count()) === n0, qf);
  await shot(page, '9-quick-name');
  await page.keyboard.press('Escape');
  await sleep(300);
  step('Esc는 취소(칸이 닫히고 세션이 생기지 않는다)', !(await page.$('[data-role="quick-name"]')) && (await count()) === n0);
  await page.click(rail('shell'));
  await page.waitForSelector('[data-role="quick-name"]');
  await page.mouse.click(700, 450);
  await sleep(300);
  step('바깥 누르기도 취소', !(await page.$('[data-role="quick-name"]')) && (await count()) === n0);
  // 이름을 쳐서 만들기(Enter)
  await page.click(rail('shell'));
  await page.waitForSelector('[data-role="quick-name"]');
  await page.keyboard.type('p97-sh');
  await page.keyboard.press('Enter');
  await until(async () => (await sessionsByName(page)).some((s) => s.name === 'p97-sh'), 20000).catch(() => null);
  await sleep(800);
  step('이름을 치고 Enter → 그 이름으로 만든다', (await sessionsByName(page)).some((s) => s.name === 'p97-sh') && !(await page.$('[data-role="quick-name"]')), (await sessionsByName(page)).map((s) => s.name));
  // 겹치는 이름과 허용하지 않는 글자
  await page.click(rail('shell'));
  await page.waitForSelector('[data-role="quick-name"]');
  await page.keyboard.type('P97-SH');
  await sleep(200);
  const taken = { note: await page.textContent('[data-role="quick-name-note"]'), disabled: !!(await page.$('[data-action="quick-name-go"][disabled]')) };
  step('겹치는 이름을 그 자리에서 알리고 만들기를 막는다', /already|이미/.test(taken.note) && taken.disabled, taken);
  await shot(page, '10-quick-taken');
  await page.fill('[data-field="quick-name"]', 'p97 셸');
  await sleep(200);
  const badName = { note: await page.textContent('[data-role="quick-name-note"]'), disabled: !!(await page.$('[data-action="quick-name-go"][disabled]')) };
  step('허용하지 않는 글자를 알린다', /letters|영문/.test(badName.note) && badName.disabled, badName);
  await shot(page, '11-quick-bad');
  await page.keyboard.press('Enter');
  await sleep(300);
  step('막힌 이름은 Enter로도 만들지 않는다', (await count()) === n0 + 1);
  // 빈칸 Enter·확인 단추 → 판이 이름을 짓는다
  await page.fill('[data-field="quick-name"]', '');
  await page.click('[data-action="quick-name-go"]');
  await until(async () => (await count()) === n0 + 2, 20000).catch(() => null);
  await sleep(800);
  const names = (await sessionsByName(page)).map((s) => s.name);
  step('빈칸으로 확인 → 판이 이름을 지어 만든다', names.length === n0 + 2 && names.some((n) => /^sh\d+$/.test(n)), names);
  await shot(page, '12-quick-auto');
  // Shift+누르기는 지금처럼 새 세션 창
  await page.keyboard.down('Shift'); await page.click(rail('claude')); await page.keyboard.up('Shift');
  await page.waitForSelector('[data-role="spawn"]', { timeout: 5000 }).catch(() => null);
  step('Shift+누르기는 새 세션 창', !!(await page.$('[data-role="spawn"]')) && !(await page.$('[data-role="quick-name"]')));
  await page.keyboard.press('Escape');
  await sleep(300);
  // 정리: 만든 셸
  for (const s of await sessionsByName(page)) { try { atrium('kill', s.name, '--yes'); } catch (e) { log('kill', s.name, e.message.slice(0, 80)); } }
  // 만든 런처 하나(ocx claude haiku)는 live 단계가 쓴다
}
