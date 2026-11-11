// P72 창 시험: 빈 데이터 폴더의 새 판. 레일과 설정 › 런처 탭에 Claude Code·Codex·셸 셋만 있고,
// 가짜 CODEX_HOME의 모델 목록 캐시가 Codex 모델 고르기(입력칸 아래 목록)와 atrium models에 보이며, 목록 밖 이름에 경고가 뜨는지 본다.
// 판: herdr 세션 atrium-dev-p72, 포트 47892, 창 원격 디버깅 9372, 이 워크트리의 backend/.dev. 시험 폴더는 새로 만든 C:\Workspace\mtask-p72-ws만 쓴다.
// 사용(워크트리 app 폴더에서): sh ../backend/.dev/clean-env.sh env MT_E2E_OUT=p72 node test/e2e/p72-launchers.mjs
// 그림은 창 안만 찍는다(page.screenshot). 화면 전체·화면 영역을 찍지 않는다(다른 창, 실제 판이 담길 수 있다).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO, OUT, sleep, until, launch, closeApp, logger } from './harness.mjs';
import { assertTestBoard } from './p9-guard.mjs';

if (process.env.MT_E2E_OUT !== 'p72') throw new Error('MT_E2E_OUT=p72를 명령줄에서 준다');
const DEV = path.join(REPO, 'backend', '.dev');
const WS_ROOT = 'C:\\Workspace\\mtask-p72-ws';
const WS = path.join(WS_ROOT, 'demo');
const CODEX_HOME = path.join(DEV, 'codex-home-p72');
const proj = (d) => path.join(os.homedir(), '.claude', 'projects', d.replace(/[^A-Za-z0-9]/g, '-'));
const ENV = {
  ATRIUM_HERDR_SESSION: 'atrium-dev-p72', ATRIUM_PORT: '47892',
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: proj(WS), ATRIUM_CLAUDE_DESKTOP: 'none',
  ATRIUM_CLAUDE_SESSIONS: path.join(DEV, 'fixture-sessions-p72'), ATRIUM_TEST_PREFIX: 'mtask-p72-x',
  CODEX_HOME,
};
assertTestBoard(ENV, { root: DEV });
const log = logger('p72-launchers');
const results = [];
const step = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log(`${ok ? '통과' : '실패'} ${name}`, detail ?? ''); };
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ATRIUM_|MTASK_|HERDR_|CLAUDECODE|CLAUDE_CODE_|CLAUDE_EFFORT|CLAUDE_PID|CLAUDE_AGENT_SDK|ELECTRON_RUN_AS_NODE)/.test(k)));
const env = { ...cleanEnv(), ...ENV };
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env, timeout: 120000 });
const call = (page, m, p = {}) => page.evaluate(([mm, pp]) => window.__mt.api.call(mm, pp), [m, p]);
const shot = async (page, name) => { const f = path.join(OUT, `p72-${name}.png`); await page.screenshot({ path: f }); log('스크린숏', path.basename(f)); return f; };

// 빈 데이터 폴더(이 시험의 판만 쓴다)와 가짜 Codex 캐시(모델 이름은 Codex 목록 모양의 시험용 이름)
if (fs.existsSync(ENV.ATRIUM_DATA_DIR) && fs.readdirSync(ENV.ATRIUM_DATA_DIR).length) throw new Error('데이터 폴더가 비어 있지 않다. 새 판으로 시험하려면 비운 뒤 돌린다');
fs.mkdirSync(CODEX_HOME, { recursive: true });
fs.mkdirSync(WS, { recursive: true });
fs.mkdirSync(ENV.ATRIUM_CLAUDE_SESSIONS, { recursive: true });
const FAKE = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-terra'];
fs.writeFileSync(path.join(CODEX_HOME, 'models_cache.json'), JSON.stringify({
  fetched_at: '2026-01-01T00:00:00Z', client_version: '0.0.0',
  models: [
    ...FAKE.map((slug, i) => ({ slug, display_name: slug.toUpperCase(), visibility: 'list', priority: 100 + i, base_instructions: 'x'.repeat(2000) })),
    { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'hide', priority: 200 },
  ],
}));

let app, page, mainPid;
try {
  ({ app, page, mainPid } = await launch({ log, env: ENV, args: ['--remote-debugging-port=9372'] }));
  const data = await until(async () => { const d = await call(page, 'launcher.list'); return d && d.launchers ? d : null; }, 30000);
  step('새 판의 런처는 Claude Code, Codex, 셸 셋', JSON.stringify(data.launchers.map((l) => l.id)) === '["claude","codex","shell"]', data.launchers.map((l) => `${l.id}:${l.preview.line || l.harness}`));
  step('셋 모두 레일에', JSON.stringify(data.favorites) === '["claude","codex","shell"]', data.favorites);
  step('Claude Code는 권한 방식 manual', data.launchers[0].permissionMode === 'manual', data.launchers[0].preview.line);
  const cx = data.harnesses.find((h) => h.id === 'codex');
  step('Codex 모델 목록은 가짜 CODEX_HOME의 캐시', cx.modelSource === 'codex' && JSON.stringify(cx.models) === JSON.stringify(FAKE), { models: cx.models, hidden: cx.hiddenModels, source: cx.modelSource });

  // 워크스페이스 하나를 연다(새로 만든 시험 폴더)
  log(atrium('ws', 'open', WS).trim().split('\n').slice(-1)[0]);
  await sleep(1500);
  await shot(page, '1-rail');
  const rail = await page.evaluate(() => [...document.querySelectorAll('[data-role="rail-favorites"] [data-action="launch"]')].map((b) => b.dataset.launcher));
  step('레일 단추는 셋', JSON.stringify(rail) === '["claude","codex","shell"]', rail);

  // 설정 › 런처 탭
  await page.click('[data-action="settings-open"]');
  await page.click('[data-tab="launchers"]');
  await page.waitForSelector('[data-role="launchers-list"]');
  await sleep(400);
  await shot(page, '2-launchers-tab');
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-role="launcher-row"]')].map((r) => r.dataset.name));
  step('런처 탭의 줄은 셋(DeepSeek 없음)', JSON.stringify(rows) === '["Claude Code","Codex","Shell"]', rows);

  // Codex 고치기: 모델 고르기(입력칸 아래 목록)
  await page.click('[data-role="launcher-row"][data-launcher="codex"] [data-action="launcher-edit"]');
  await page.waitForSelector('[data-role="launcher-form"][data-harness="codex"]');
  await page.click('[data-field="launcher-model"]');
  await page.waitForSelector('[data-role="launcher-models"]');
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-role="launcher-models"] [data-model]')].map((o) => o.dataset.model));
  step('Codex 모델 고르기에 캐시의 보이는 모델 다섯(숨긴 모델 없음)', JSON.stringify(opts) === JSON.stringify(FAKE), opts);
  await sleep(300);
  await shot(page, '3-codex-models');
  // 고르면 칸에 들어가고, 고른 뒤 다시 눌러도 다른 모델이 다 보인다
  await page.click('[data-role="launcher-models"] [data-model="gpt-6.1-sol"]');
  await sleep(400);
  const picked = await page.inputValue('[data-field="launcher-model"]');
  const pv = await page.textContent('[data-role="launcher-form-preview"]');
  step('목록에서 고르면 칸과 미리보기에 들어간다', picked === 'gpt-6.1-sol' && /codex -m gpt-6\.1-sol/.test(pv), { picked, pv });
  await page.click('[data-field="launcher-model"]');
  const again = await page.$$eval('[data-role="launcher-models"] [data-model]', (els) => els.length);
  step('고른 뒤에도 목록 전체', again === FAKE.length, again);
  // Esc는 목록만 닫는다(설정 창은 그대로)
  await page.keyboard.press('Escape');
  await sleep(200);
  const still = await page.evaluate(() => ({ list: !!document.querySelector('[data-role="launcher-models"]'), form: !!document.querySelector('[data-role="launcher-form"]') }));
  step('Esc는 목록만 닫는다', !still.list && still.form, still);
  // 글자로 거르기
  await page.fill('[data-field="launcher-model"]', 'luna');
  const filtered = await page.$$eval('[data-role="launcher-models"] [data-model]', (els) => els.map((e) => e.dataset.model));
  step('친 글자로 거른다', JSON.stringify(filtered) === '["gpt-6-luna"]', filtered);

  // 목록에 있는 이름: 경고 없음 / 숨긴 이름: 경고 없음 / 틀린 이름: 경고, 저장은 된다
  const warnAfter = async (v) => { await page.fill('[data-field="launcher-model"]', v); await sleep(700); return page.evaluate(() => { const w = document.querySelector('[data-role="launcher-model-warn"]'); return w ? w.textContent : null; }); };
  step('목록의 이름(gpt-6.1-sol)은 경고 없음', (await warnAfter('gpt-6.1-sol')) === null);
  step('숨긴 이름(gpt-5.5)도 경고 없음', (await warnAfter('gpt-5.5')) === null);
  const w = await warnAfter('gpt-6.1-sool');
  step('목록 밖 이름(gpt-6.1-sool)은 경고', w === 'This model is not in the Codex list. Check that the name is right.', w);
  await shot(page, '4-codex-unlisted');
  await page.click('[data-action="launcher-save"]');
  await sleep(800);
  const saved = (await call(page, 'launcher.list')).launchers.find((l) => l.id === 'codex');
  step('경고가 있어도 저장된다', saved.model === 'gpt-6.1-sool', saved.preview);
  // 한국어 화면의 경고
  await call(page, 'settings.set', { key: 'language', value: 'ko' });
  await sleep(500);
  await page.click('[data-role="launcher-row"][data-launcher="codex"] [data-action="launcher-edit"]');
  await sleep(900);
  const wk = await page.evaluate(() => { const e = document.querySelector('[data-role="launcher-model-warn"]'); return e ? e.textContent : null; });
  step('한국어 경고', wk === 'Codex 목록에 없는 모델입니다. 이름이 맞는지 확인하세요.', wk);
  await shot(page, '5-codex-unlisted-ko');
  await page.click('[data-action="launcher-cancel"]');
  await call(page, 'launcher.update', { id: 'codex', patch: { model: '' } });
  await call(page, 'settings.set', { key: 'language', value: 'en' });
  await page.keyboard.press('Escape');

  // atrium models(판이 띄운 세션의 atrium): haiku 세션 하나를 띄우고 그 세션의 env로 부른다
  const sp = JSON.parse(atrium('--json', 'spawn', WS, '--name', 'p72m', '--model', 'haiku'));
  const sj = JSON.parse(fs.readFileSync(sp.settingsPath, 'utf8'));
  const childEnv = { ...cleanEnv(), ...Object.fromEntries(Object.entries(sj.env || {}).filter(([k]) => /^ATRIUM_/.test(k))) };
  const models = execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium-child.mjs'), 'models'], { encoding: 'utf8', env: childEnv, timeout: 60000 });
  fs.writeFileSync(path.join(OUT, 'p72-atrium-models.txt'), models);
  const codexLines = models.split('\n').filter((l) => /Codex 모델/.test(l));
  step('atrium models의 Codex 줄은 캐시의 다섯', FAKE.every((m) => codexLines.some((l) => l.includes(`모델 ${m}`))) && codexLines.length === FAKE.length, codexLines);
  step('atrium models에 게이트웨이(opencodex) 줄이 없다', !/게이트웨이|10100/.test(models), models.split('\n').filter((l) => /게이트웨이/.test(l)));
  try { log(atrium('kill', 'p72m', '--yes').trim().split('\n').slice(-1)[0]); } catch (e) { log('kill', e.message.split('\n')[0]); }

  // 백엔드 기록: opencodex 주소를 묻지 않았는가
  const logDir = path.join(ENV.ATRIUM_DATA_DIR, 'logs');
  const logs = fs.existsSync(logDir) ? fs.readdirSync(logDir).map((f) => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n') : '';
  step('백엔드 기록에 opencodex(10100) 없음', !/10100|opencodex|deepseek/i.test(logs), logs.split('\n').filter((l) => /10100|opencodex|deepseek|launchers created/i.test(l)).slice(0, 5));
} catch (e) {
  step('시험 도중 오류', false, e.stack);
  if (page) await shot(page, 'error').catch(() => {});
} finally {
  if (app) await closeApp(app);
  await sleep(1500);
  try { log(atrium('herdr', 'stop', '--yes').trim().replace(/\s+/g, ' ').slice(0, 200)); } catch (e) { log('herdr stop', e.message.split('\n')[0]); }
  try { log(atrium('backend', 'stop').trim().replace(/\s+/g, ' ').slice(0, 200)); } catch (e) { log('backend stop', e.message.split('\n')[0]); }
  fs.writeFileSync(path.join(OUT, 'p72-launchers.json'), JSON.stringify({ mainPid, results }, null, 2));
  log(`끝: 통과 ${results.filter((r) => r.ok).length} / ${results.length}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
