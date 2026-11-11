// P92 창 시험: 휴대폰 알림을 "작업 사이클 끝"에 한 번으로. 휴대폰(iPhone 흉내, Chromium) → 흉내 원격(ts-sim) → 백엔드(47892) → 흉내 푸시 서비스(로컬 https, 47882).
// 1. 휴대폰에서 알림을 켠다(흉내 구독, P88과 같은 방법). 알림 시트의 "하위 세션(워커) 알림"은 기본 "응답 필요만"이다. 세션 화면의 "이 세션 알림 끄기"를 켜고 끈다.
//    그 뒤 브라우저를 닫는다(보는 기기가 없어야 푸시가 간다).
// 2. haiku 리드가 atrium child로 haiku 워커 둘을 띄워 짧은 일을 시키고, 뒤에서 기다리며 턴을 끝낸 뒤(뒤 셸) 결과를 받아 끝낸다.
// 3. 흉내 푸시 서비스가 받은 알림이 맨 끝 하나(@리드 · 끝남, 하위 2개 포함)뿐인지 본다. 같은 상태 순서를 고치기 전 web-push.mjs(6fb7de8)에 넣어 그때의 알림 수도 센다.
// 따로 띄운 개발용 판(atrium-dev-p92, 47892, backend/.dev)만 쓴다. PC 창은 띄우지 않는다. 결과는 experiments/p92/(git 밖).
// 실행: bash backend/.dev/clean-env.sh node app/test/e2e/p92-cycle.mjs
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
const DEV = path.join(REPO, 'backend', '.dev');
const OUT = path.join(REPO, 'experiments', 'p92');
const TLS = path.join(OUT, 'tls');
const CONVOS = path.join(OUT, 'convos');
const DIR = 'C:\\Workspace\\mtask-p92-cycle';
const L = await import('./p59-lib.mjs');
const { NAME, LOGIN, LAPTOP_A } = L;
const B0 = L.board({ session: 'atrium-dev-p92', port: 47892, sim: 47881, sim2: 47881 });
const PUSH_PORT = 47882;
const PUSH_ORIGIN = `https://localhost:${PUSH_PORT}`;
const LEAD = 'p92-lead';
const W = ['p92-w1', 'p92-w2'];
fs.mkdirSync(TLS, { recursive: true }); fs.mkdirSync(CONVOS, { recursive: true }); fs.mkdirSync(path.join(DIR, '.claude'), { recursive: true });
// 리드와 워커가 atrium·herdr 명령을 묻지 않고 치게 한다(시험 폴더에만)
fs.writeFileSync(path.join(DIR, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(atrium:*)', 'Bash(atrium *)', 'Bash(herdr:*)', 'Bash(herdr *)', 'Bash(ping:*)', 'Bash(ping *)'] } }, null, 1));
if (!fs.existsSync(path.join(TLS, 'cert.pem'))) execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', path.join(TLS, 'key.pem'), '-out', path.join(TLS, 'cert.pem'), '-days', '7', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1'], { stdio: 'pipe' });
export const ENV = {
  ATRIUM_HERDR_SESSION: B0.session, ATRIUM_PORT: String(B0.port),
  ATRIUM_DATA_DIR: path.join(DEV, 'data'), ATRIUM_APP_USERDATA: path.join(DEV, 'app'),
  ATRIUM_CLAUDE_PROJECTS: CONVOS, ATRIUM_CLAUDE_DESKTOP: 'none', MT_E2E_OUT: 'p92',
  ATRIUM_TEST_PREFIX: 'p92-none-',
  ATRIUM_TAILSCALE: path.join(REPO, 'app', 'test', 'e2e', 'p49-fake-tailscale.mjs'), P49_FAKE_TS_PORT: String(B0.port),
  ATRIUM_WEB_HOSTS: `${NAME}:${B0.sim},localhost:${B0.sim}`,
  ATRIUM_PUSH_TEST_ORIGINS: PUSH_ORIGIN, ATRIUM_PUSH_TEST_CA: path.join(TLS, 'cert.pem'),
};
for (const k of Object.keys(process.env)) if (/^(ATRIUM_|MTASK_|HERDR_)/.test(k)) delete process.env[k]; // 실제 판의 값을 물려받지 않는다
Object.assign(process.env, ENV);
const { logger, sleep, until } = await import('./harness.mjs');
const { assertTestBoard } = await import('./p9-guard.mjs');
assertTestBoard(ENV, { root: DEV });
const toUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const { startTsSim } = await import(toUrl(path.join(REPO, 'backend', 'tools', 'ts-sim-proxy.mjs')));
const WP = await import(toUrl(path.join(REPO, 'backend', 'src', 'web-push.mjs')));
const OLD = await import(toUrl(path.join(OUT, 'old-web-push.mjs'))); // git show 6fb7de8:backend/src/web-push.mjs
const { chromium } = await import('playwright');

const log = logger('p92-cycle');
const atrium = (...a) => execFileSync(process.execPath, [path.join(REPO, 'backend', 'bin', 'atrium.mjs'), '--dev', ...a], { encoding: 'utf8', env: process.env, timeout: 180000 });
const call = (m, p = {}) => JSON.parse(atrium('--json', 'call', m, JSON.stringify(p)));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 1600)}` : ''}`); };
const sessions = () => call('session.list');
const byName = (n) => sessions().find((s) => s.name === n);
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: SAFARI, permissions: ['notifications'] };
const loadedOpen = (pg, ms = 60000) => pg.waitForFunction(() => window.__mt && window.__mt.getState().boardLoaded && window.__mt.api.conn.phase === 'open', null, { timeout: ms });
const splashGone = (pg) => pg.waitForFunction(() => !document.querySelector('[data-role=splash]'), null, { timeout: 15000 }).catch(() => {});
const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, `${name}.png`) }).catch((e) => log(`스크린숏 실패 ${name} ${e.message.slice(0, 80)}`));

// ---- 흉내 푸시 서비스 ----
const got = [];
const pushSrv = https.createServer({ key: fs.readFileSync(path.join(TLS, 'key.pem')), cert: fs.readFileSync(path.join(TLS, 'cert.pem')) }, (req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => { got.push({ at: Date.now(), headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); });
});
await new Promise((r) => pushSrv.listen({ port: PUSH_PORT, host: '::', ipv6Only: false }, r));
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const AUTH = crypto.randomBytes(16);
const SUB = { endpoint: `${PUSH_ORIGIN}/push/p92-phone`, p256dh: ua.getPublicKey().toString('base64url'), auth: AUTH.toString('base64url') };
const open = (body) => JSON.parse(WP.decryptPayload(body, { uaPrivate: ua.getPrivateKey(), auth: AUTH }).toString());
const FAKE_PUSH = (s) => {
  let cur = null;
  PushManager.prototype.getSubscription = async function () { return cur; };
  PushManager.prototype.subscribe = async function (opts) {
    const key = new Uint8Array(opts.applicationServerKey);
    cur = { endpoint: s.endpoint, options: { applicationServerKey: key.buffer, userVisibleOnly: true }, toJSON: () => ({ endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } }), unsubscribe: async () => { cur = null; return true; } };
    return cur;
  };
};
const STANDALONE = () => { try { Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true }); } catch {} };

const trustStop = () => {
  const tr = sessions().find((s) => /^p92-/.test(s.name) && s.state === 'trust_wait');
  if (tr) { fs.writeFileSync(path.join(DEV, 'p92-need-trust.txt'), `${tr.name} asks the folder trust question in ${tr.cwd || '?'}\n`); throw new Error('trust question (backend/.dev/p92-need-trust.txt)'); }
};

// 같은 상태 순서를 고치기 전 Pusher(6fb7de8)에 넣는다: 시계는 기록의 시각, 묶음(1.5초)은 다음 바뀜 전에 보낸다. 보는 기기·PC 사용 중은 없다(이 시험과 같다)
async function replayOld(transitions, names) {
  let t = transitions.length ? transitions[0].at : Date.now();
  const sent = [];
  const p = new OLD.Pusher({ store: null, subject: 'https://github.com/x/y', now: () => t, batchMs: 3_600_000, transport: async (endpoint, opts) => { sent.push({ at: t, ...opts }); return { status: 201 }; } });
  p.subscribe('dev-old', { endpoint: 'https://web.push.apple.com/3/device/p92-old', keys: { p256dh: SUB.p256dh, auth: SUB.auth } }, 'ko');
  let firstAt = null;
  const due = async (now) => { if (firstAt != null && now - firstAt >= OLD.BATCH_MS) { t = firstAt + OLD.BATCH_MS; await p.flush('dev-old'); firstAt = null; } };
  for (const e of transitions) {
    await due(e.at);
    t = e.at;
    const before = p.pending.get('dev-old') ? p.pending.get('dev-old').items.size : 0;
    p.onState({ sessionId: e.sessionId, name: names[e.sessionId] || e.sessionId, kind: 'claude', state: e.to, workspaceKey: null, exit: e.exit || null }, e.from);
    const after = p.pending.get('dev-old') ? p.pending.get('dev-old').items.size : 0;
    if (after > before && firstAt == null) firstAt = t;
  }
  await due(Number.MAX_SAFE_INTEGER);
  p.stop();
  return sent.map((s) => ({ at: s.at, ...open(s.body) }));
}

let ts; let browser;
const metrics = {};
try {
  log(atrium('backend', 'start').trim().slice(0, 300));
  const st0 = call('settings.get').settings;
  for (const d of call('device.list').devices) call('device.revoke', { id: d.id });
  if (st0.remotePasskey !== false) call('settings.set', { remotePasskey: false });
  if (st0.remoteAccess === false) call('settings.set', { remoteAccess: true });
  if (st0.language !== 'ko') call('settings.set', { language: 'ko' });
  for (const n of [LEAD, ...W]) if (byName(n)) atrium('kill', n, '--yes');
  JSON.parse(atrium('--json', 'spawn', DIR, '--model', 'haiku', '--name', LEAD, '--allow-herdr'));
  await until(() => { const s = byName(LEAD); return s && ['ready', 'trust_wait'].includes(s.state) ? s : null; }, 150000, 1500).catch(() => null);
  trustStop();

  // ---- 1. 휴대폰: 알림 켜기, 하위 세션 알림(기본 응답 필요만), 이 세션 알림 끄기 ----
  ts = startTsSim({ listen: B0.sim, target: B0.port, name: NAME, login: LOGIN, keepOrigin: true }); ts.cfg.ip = LAPTOP_A;
  await ts.ready;
  const pwDir = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const chromeExe = (() => { try { return fs.readdirSync(pwDir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse().map((d) => path.join(pwDir, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f)); } catch { return null; } })();
  browser = await chromium.launch({ headless: true, ...(chromeExe ? { executablePath: chromeExe } : { channel: 'chromium' }) });
  const BASE = `http://localhost:${B0.sim}`;
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(STANDALONE);
  await ctx.addInitScript(FAKE_PUSH, SUB);
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => log(`[pageerror] ${e.message}`));
  await pg.goto(`${BASE}/`);
  await pg.waitForSelector('[data-role=pair]', { timeout: 30000 });
  await pg.fill('[data-field=pair-code]', call('device.code').code);
  await pg.click('[data-action=pair-submit]');
  await loadedOpen(pg); await splashGone(pg); await sleep(1500);
  const devId = call('device.list').devices[0].id;
  await pg.click('[data-action=phone-push]');
  await pg.waitForFunction(() => { const i = document.querySelector('[data-role=push-main] input'); return i && !i.disabled; }, null, { timeout: 15000 });
  const subOff = await pg.evaluate(() => ({ value: document.querySelector('[data-role=push-sub]').dataset.value, disabled: [...document.querySelectorAll('[data-role=push-sub] button')].every((b) => b.disabled) }));
  await pg.click('[data-role=push-main] input');
  await pg.waitForFunction(() => document.querySelector('[data-role=push-line]').dataset.key === 'push.on', null, { timeout: 15000 }).catch(() => {});
  const sheet = await pg.evaluate(() => ({ line: document.querySelector('[data-role=push-line]').dataset.key, value: document.querySelector('[data-role=push-sub]').dataset.value, labels: [...document.querySelectorAll('[data-role=push-sub] button')].map((b) => `${b.textContent}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`), title: document.querySelector('[data-role=push-sub] b').textContent }));
  check('알림 시트: 켜기 전에는 하위 세션 알림을 고를 수 없고, 켜면 "하위 세션(워커) 알림"의 기본은 "응답 필요만"', subOff.disabled && sheet.line === 'push.on' && sheet.value === 'need' && sheet.labels.join('|') === '응답 필요만*|모두|끔' && /하위 세션/.test(sheet.title), { subOff, sheet });
  await shot(pg, '01-sheet-sub-default');
  await pg.click('[data-action=push-sub-off]');
  await pg.waitForFunction(() => document.querySelector('[data-role=push-sub]').dataset.value === 'off', null, { timeout: 8000 }).catch(() => {});
  const offSt = call('device.list').devices.length && (await pg.evaluate(() => window.__mt.api.call('push.status')));
  await pg.click('[data-action=push-sub-need]');
  await pg.waitForFunction(() => document.querySelector('[data-role=push-sub]').dataset.value === 'need', null, { timeout: 8000 }).catch(() => {});
  const needSt = await pg.evaluate(() => window.__mt.api.call('push.status'));
  check('하위 세션 알림을 바꾸면 기기 설정에 남는다(끔 → 응답 필요만)', offSt.sub === 'off' && needSt.sub === 'need', { off: offSt.sub, need: needSt.sub });
  await pg.click('[data-action=phone-push-close]');
  // 세션 화면: 이 세션 알림 끄기
  const lead = byName(LEAD);
  await pg.click(`[data-session="${lead.sessionId}"], [data-role=phone-row][data-session="${lead.sessionId}"]`).catch(() => {});
  await pg.waitForSelector('[data-role=phone-session]', { timeout: 10000 }).catch(() => {});
  await pg.waitForSelector('[data-action=phone-session-mute]', { timeout: 10000 }).catch(() => {});
  const m0 = await pg.getAttribute('[data-action=phone-session-mute]', 'data-muted').catch(() => null);
  await pg.click('[data-action=phone-session-mute]').catch(() => {});
  await pg.waitForSelector('[data-action=phone-session-mute][data-muted="1"]', { timeout: 8000 }).catch(() => {});
  const m1 = await pg.evaluate(() => window.__mt.api.call('push.status')).then((s) => s.muted);
  await shot(pg, '02-session-muted');
  await pg.click('[data-action=phone-session-mute]').catch(() => {});
  await pg.waitForSelector('[data-action=phone-session-mute][data-muted="0"]', { timeout: 8000 }).catch(() => {});
  const m2 = await pg.evaluate(() => window.__mt.api.call('push.status')).then((s) => s.muted);
  check('세션 화면의 "이 세션 알림 끄기": 누르면 이 기기의 muted에 들고, 다시 누르면 빠진다', m0 === '0' && m1.includes(lead.sessionId) && !m2.includes(lead.sessionId), { m0, m1, m2 });
  await ctx.close();
  await browser.close(); browser = null; // 보는 기기가 없어야 보낸다. 메모리도 아낀다
  await sleep(1500);
  check('브라우저를 닫은 뒤 기기 구독은 켜져 있다', call('device.list').devices.find((d) => d.id === devId).push.on === true);

  // ---- 2. 리드 → 워커 둘 → 뒤에서 기다림 → 결과 모음 ----
  const t0 = Date.now();
  const prompt = [
    'You are the lead in a short test. Follow these steps exactly, one command per Bash call, no shell variables or pipes.',
    `1. Run: atrium child ${W[0]} --model haiku --prompt "Run this Bash command once: ping -n 30 127.0.0.1 . Then reply with only the word apple."`,
    `2. Run: atrium child ${W[1]} --model haiku --prompt "Run this Bash command once: ping -n 40 127.0.0.1 . Then reply with only the word banana."`,
    `3. Start two Bash calls with run_in_background set to true: herdr agent wait ${W[0]} --timeout 300000 and herdr agent wait ${W[1]} --timeout 300000. Then end your turn with the words: workers started, waiting.`,
    `4. After both background waits have finished, read each answer: herdr agent read ${W[0]} --source recent-unwrapped --lines 20 and herdr agent read ${W[1]} --source recent-unwrapped --lines 20. Then reply with one line: RESULT followed by the two words.`,
  ].join('\n');
  atrium('send', `@${LEAD}`, prompt);
  // 끝: 리드의 마지막 답에 RESULT, 리드·워커가 모두 쉼
  const fin = await until(() => {
    trustStop();
    const all = sessions(); const l = all.find((s) => s.name === LEAD); const ws = W.map((n) => all.find((s) => s.name === n));
    return l && l.state === 'ready' && /RESULT/.test(l.lastAnswer || '') && ws.every((w) => w && w.state === 'ready') ? { l, ws } : null;
  }, 420000, 2000).catch(() => null);
  const tEnd = Date.now();
  check('리드가 워커 둘을 띄워 결과를 받아 끝냈다', !!fin, fin ? { lead: (fin.l.lastAnswer || '').slice(0, 80), workers: fin.ws.map((w) => `${w.name}:${w.branch && w.branch.parentSessionId === fin.l.sessionId ? 'child' : 'top'}`) } : sessions().filter((s) => /^p92-/.test(s.name)).map((s) => `${s.name}:${s.state}`));
  // 사이클 끝(60초) 뒤 여유를 두고 받은 알림을 센다
  const dec0 = call('push.decisions', { limit: 5 });
  await sleep(dec0.settleMs + 25000);
  const recv = got.filter((g) => g.at >= t0).map((g) => ({ at: g.at, urgency: g.headers.urgency, ...open(g.body) }));
  metrics.received = recv.map((r) => ({ t: Math.round((r.at - t0) / 1000), title: r.title, body: r.body, kind: r.kind, urgency: r.urgency }));
  const leadId = byName(LEAD).sessionId;
  const one = recv.length === 1 && recv[0].sessionId === leadId && recv[0].kind === 'done';
  check('흉내 푸시 서비스가 받은 알림은 맨 끝 하나: "@p92-lead · 끝남"(하위 2개 포함), 리드가 끝난 뒤 정한 시간이 지나서', one && recv[0].title === `@${LEAD} · 끝남` && /하위 2개 포함/.test(recv[0].body) && recv[0].at - tEnd >= -5000, metrics.received);
  const dec = call('push.decisions', { limit: 200 });
  const names = Object.fromEntries(sessions().filter((s) => /^p92-/.test(s.name)).map((s) => [s.sessionId, s.name]));
  metrics.decisions = dec.decisions.filter((d) => d.at >= t0).map((d) => ({ t: Math.round((d.at - t0) / 1000), name: names[d.sessionId] || d.sessionId, kind: d.kind, why: d.why }));
  const whys = new Set(metrics.decisions.map((d) => d.why));
  check('보내지 않은 까닭이 진단 기록에 남는다(하위 세션 끝남 = sub-session, 리드가 정한 시간 안에 다시 일함 = busy-again, 워커가 일함 = cycle-open, 뒤 일 = background-task)', whys.has('sub-session') && ['busy-again', 'cycle-open', 'background-task'].some((w) => whys.has(w)), [...whys]);
  check('진단 기록에 글이 없다(세션 ID·종류·기기·까닭·시각만)', dec.decisions.every((d) => Object.keys(d).sort().join(',') === 'at,deviceId,kind,sessionId,why'));

  // ---- 3. 고치기 전 코드: 같은 상태 순서 ----
  const transitions = [];
  for (const [sid, nm] of Object.entries(names)) {
    for (const e of call('session.events', { session: sid, limit: 400 })) if (e.kind === 'state' && e.t >= t0 - 1000 && e.t <= tEnd + 1000) transitions.push({ at: e.t, sessionId: sid, name: nm, from: e.data.from, to: e.data.to, exit: e.data.exit });
  }
  transitions.sort((a, b) => a.at - b.at);
  metrics.transitions = transitions.map((e) => ({ t: Math.round((e.at - t0) / 100) / 10, name: e.name, from: e.from, to: e.to }));
  const old = await replayOld(transitions, names);
  metrics.oldCode = old.map((r) => ({ t: Math.round((r.at - t0) / 1000), title: r.title, body: r.body }));
  check('고치기 전 코드(6fb7de8)는 같은 순서에서 알림을 여럿 보냈다', old.length > 1, metrics.oldCode);
  metrics.counts = { before: old.length, after: recv.length };
  log(`알림 수: 고치기 전 ${old.length}, 고친 뒤 ${recv.length}`);
} catch (e) {
  check('시험이 끝까지 돌았다', false, e.stack || e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (ts) await ts.close().catch(() => {});
  await new Promise((r) => pushSrv.close(r));
  fs.writeFileSync(path.join(OUT, 'p92-cycle.json'), JSON.stringify({ results, metrics }, null, 2));
  const bad = results.filter((r) => !r.ok);
  log(`결과 ${results.length - bad.length}/${results.length} 통과${bad.length ? ` 실패: ${bad.map((b) => b.name).join(', ')}` : ''}`);
  process.exit(bad.length ? 1 : 0);
}
