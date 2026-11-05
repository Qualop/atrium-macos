// I7 트레이 상주(P6b, ARCH 4절 I7). Electron main에서 돈다.
// - 트레이 아이콘은 앱이 도는 동안 늘 있다(P14). 판 설정 tray(기본 켜짐)는 창을 닫아도 앱이 트레이에 남는지다. 끄면 창을 닫을 때 앱이 끝난다.
// - 트레이 메뉴(P14): 열기, 내 차례 수(누르면 그 세션), 백엔드 상태와 켜기·끄기·다시 띄우기, herdr까지 모두 끄기(확인), 앱 끝내기, 백엔드도 끄고 끝내기.
//   백엔드를 끌 때는 창을 먼저 닫는다(열린 창은 꺼진 백엔드를 다시 띄운다). herdr를 끄면 판의 claude가 모두 끝나고, 다시 띄우면 이어 가기로 돌아온다.
// - 창이 없는 동안에는 main이 OS 알림을 띄운다. 규칙은 창(renderer notify.js)과 같다: 내 차례(waiting, trust_wait)가 되고 1.2초 뒤에도 같은 대기면,
//   같은 대기에는 한 번만. 창이 있으면 창이 정한다. 알림을 누르면 창을 다시 열고 그 노드로 간다.
// - main은 백엔드에 따로 WebSocket으로 붙는다. 백엔드가 없으면 띄우지 않고 2초마다 다시 붙어 본다(백엔드를 끄는 정리 순서를 막지 않게).
import { Tray, Menu, nativeImage, Notification } from 'electron';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiClient, backendInfo, health } from '../../../backend/src/client.mjs';
import { translate, DEFAULT_LANGUAGE, LANGUAGES } from '../renderer/lib/i18n.js'; // P16: 창과 같은 사전. 언어는 판 설정 language를 따른다
import { APP_NAME } from '../../../backend/src/config.mjs';

export const NOTIFY_DELAY_MS = 1200; // 창의 규칙(renderer lib/attention.js)과 같다
const NEEDS_YOU = new Set(['waiting', 'trust_wait']);
const DAY = 24 * 3600 * 1000;
// 같은 대기에 한 번만 띄우기 위한 열쇠. 창(renderer lib/attention.js notifyKey)과 같은 모양이라 창도 같은 대기로 본다
export function notifyKey(s) {
  if (!s || !NEEDS_YOU.has(s.state)) return null;
  const a = s.ask;
  return `${s.sessionId}|${s.state}|${(a && (a.toolUseId || a.since)) || 'x'}`;
}

// 트레이 아이콘: 16x16 동그라미 PNG를 직접 만든다(에셋 파일 없이). 내 차례가 있으면 주황, 없으면 청록
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function circlePng([r, g, b], size = 16) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const a = Math.max(0, Math.min(1, size / 2 - 0.5 - d + 0.5));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const ICON = { idle: [38, 166, 154], needsYou: [245, 146, 40] }; // 로고 파일이 없을 때만 쓰는 색 원

// 트레이·알림 로고(app/assets, 원본은 app/design/brand). 트레이는 16·24·32px을 배율 1·1.5·2로 넣는다.
// 내 차례면 같은 로고의 오른쪽 아래에 주황 점(#ff6b3d, 테마 --accent)을 얹는다. 점 둘레의 어두운 고리는 초록 로고와 갈라 보이게 한다
const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
export const NOTIFY_ICON = path.join(ASSETS, 'atrium-icon-256.png');
const TRAY_SIZES = [[16, 1], [24, 1.5], [32, 2]];
const ACCENT = [0xff, 0x6b, 0x3d], RING = [0x0f, 0x0f, 0x0b];
// toBitmap()은 Windows에서 BGRA다. 점과 고리를 덮어 그린 PNG를 돌려준다
function badgePng(img) {
  const { width: w, height: h } = img.getSize();
  const px = Buffer.from(img.toBitmap());
  const r = w * 0.22, cx = w - r - 0.5, cy = h - r - 0.5, ring = Math.max(1, w / 16);
  const over = (o, [R, G, B], a) => {
    if (a <= 0) return;
    const da = px[o + 3] / 255, oa = a + da * (1 - a);
    const mix = (src, dst) => Math.round((src * a + dst * da * (1 - a)) / oa);
    px[o + 2] = mix(R, px[o + 2]); px[o + 1] = mix(G, px[o + 1]); px[o] = mix(B, px[o]); px[o + 3] = Math.round(oa * 255);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), o = (y * w + x) * 4;
    over(o, RING, Math.min(1, Math.max(0, r + ring + 0.5 - d)));
    over(o, ACCENT, Math.min(1, Math.max(0, r + 0.5 - d)));
  }
  return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG();
}
export function trayImage(turn) {
  const out = nativeImage.createEmpty();
  for (const [size, scaleFactor] of TRAY_SIZES) {
    const img = nativeImage.createFromPath(path.join(ASSETS, `atrium-icon-${size}.png`));
    if (img.isEmpty()) continue;
    out.addRepresentation({ scaleFactor, buffer: turn ? badgePng(img) : img.toPNG() });
  }
  return out.isEmpty() ? nativeImage.createFromBuffer(circlePng(turn ? ICON.needsYou : ICON.idle)) : out;
}

// 창이 판을 다 읽어 노드로 갈 수 있게 될 때까지 기다린다(창을 새로 열었을 때 navigate를 잃지 않게)
export async function whenBoardReady(wc, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!wc || wc.isDestroyed()) return false;
    const ok = await wc.executeJavaScript('!!(window.__mt && window.__mt.getState().boardLoaded && window.__mt.getState().navigateTo)').catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// cfg: 프로필 설정, log, hasWindow() → 창이 있는가, showNode(sessionId|null) → 창을 열고 그 노드로, quit() → 앱 끝내기, notifications: 알림 기록 배열(시험이 누름을 흉내 낸다)
// P14: closeWindow() → 창 닫기, startBackend() → 백엔드가 없으면 띄움, stopBackend() → 백엔드 끄기, confirm({ message, detail, ok }) → 참이면 진행(기본은 Electron 확인창)
const TRAY_ID = 'tray-main'; // P47: 트레이의 클라이언트 ID(앱 하나에 트레이 하나)

export function startTray({ cfg, log, hasWindow, showNode, quit, notifications = [], closeWindow = () => {}, startBackend = async () => {}, stopBackend = async () => {}, confirm = async () => false }) {
  const st = { lang: DEFAULT_LANGUAGE, enabled: true, connected: false, sessions: new Map(), notified: new Map(), pending: new Map(), tray: null, client: null, menuKey: null, stopped: false, busy: null, lastError: null, migration: null, migrationNoted: false };

  const tr = (key, vars) => translate(st.lang, key, vars);
  const needsYou = () => [...st.sessions.values()].filter((s) => NEEDS_YOU.has(s.state)).sort((a, b) => ((a.ask && a.ask.since) || a.createdAt || 0) - ((b.ask && b.ask.since) || b.createdAt || 0));

  // P14: 메뉴의 동작. 한 번에 하나만 돈다(busy). 시험은 run(id)로 부른다
  const closeFirst = async () => { if (hasWindow()) { closeWindow(); await new Promise((r) => setTimeout(r, 300)); } };
  const ACTIONS = {
    open: () => showNode(null),
    'backend-start': () => work('busyStart', () => startBackend()),
    'backend-restart': () => work('busyRestart', async () => { await stopBackend(); await startBackend(); }),
    'backend-stop': () => work('busyStop', async () => { await closeFirst(); await stopBackend(); }),
    'herdr-stop': async () => {
      const ok = await confirm({ message: tr('tray.herdrStopAsk'), detail: tr('tray.herdrStopDetail'), ok: tr('tray.herdrStopOk') });
      if (!ok) return log('tray herdr stop canceled');
      return work('busyHerdrStop', async () => {
        await closeFirst();
        if (st.client) await st.client.call('herdr.stop', { confirm: true }).catch((e) => log('tray herdr stop error', e.message));
        await stopBackend();
      });
    },
    // P21(D4)·P24: 쉬는 리포 모두 잠재우기(일이 있는 리포, 보는 노드가 있는 리포는 백엔드가 뺀다)
    'sleep-idle': () => work('busySleep', async () => {
      if (!st.client) return;
      const r = await st.client.call('workspace.sleepIdle');
      log(`tray sleep idle ${JSON.stringify({ repos: r.repos, slept: r.slept, savedMB: r.savedMB, skipped: (r.skipped || []).length })}`);
      st.lastSleep = r;
      if (Notification.isSupported()) new Notification({ title: tr('app.name'), body: r.slept ? tr('sleep.trayDone', { repos: r.repos, n: r.slept, mb: r.savedMB >= 1024 ? `${(r.savedMB / 1024).toFixed(1)}GB` : `${r.savedMB}MB` }) : tr('sleep.sleepIdleNone'), icon: NOTIFY_ICON, silent: true }).show();
    }),
    quit: () => quit(),
    'quit-all': () => work('busyQuitAll', async () => { await closeFirst(); log('tray stop backend', JSON.stringify(await stopBackend())); quit(); }),
  };
  // label: 사전 열쇠(tray.<label>). 메뉴를 그릴 때 그때의 언어로 바꾼다
  async function work(label, fn) {
    if (st.busy) return;
    st.busy = label; st.lastError = null; log(`tray ${label}`); refreshTray();
    try { await fn(); } catch (e) { st.lastError = String((e && e.message) || e); log('tray action error', st.lastError); }
    st.busy = null; refreshTray();
  }

  function refreshTray() {
    if (st.stopped) return;
    const mine = needsYou();
    const key = JSON.stringify([st.lang, st.connected, st.busy, st.lastError, st.migration, st.sessions.size, mine.map((s) => [s.sessionId, s.name, s.state])]);
    if (!st.tray) { st.images = { idle: trayImage(false), turn: trayImage(true) }; st.tray = new Tray(st.images.idle); st.icon = 'idle'; st.tray.on('click', () => showNode(null)); st.menuKey = null; log('tray created'); }
    if (key === st.menuKey) return;
    st.menuKey = key;
    st.icon = mine.length ? 'turn' : 'idle';
    st.tray.setImage(st.images[st.icon]);
    const status = st.busy ? `${tr(`tray.${st.busy}`)}…` : st.connected ? tr('tray.backendOn', { n: st.sessions.size }) : `${tr('tray.backendOff')}${st.lastError ? ` · ${st.lastError.slice(0, 60)}` : ''}`;
    st.tooltip = `${tr('app.name')}${cfg.profile === 'dev' ? ' (dev)' : ''} · ${tr('tray.turn', { n: mine.length })} · ${status}${st.migration ? ` · ${st.migration}` : ''}`;
    st.tray.setToolTip(st.tooltip.slice(0, 127));
    const busy = !!st.busy;
    const item = (id, label, enabled = true) => ({ id, label, enabled: enabled && !busy, click: () => ACTIONS[id]() });
    const template = [
      item('open', tr('tray.open')),
      { label: tr('tray.turn', { n: mine.length }), enabled: mine.length > 0, submenu: mine.length ? mine.slice(0, 12).map((s) => ({ label: `@${s.name} ${tr(`state.${s.state === 'trust_wait' ? 'trust_wait' : 'waiting'}`)}`, click: () => showNode(s.sessionId) })) : undefined },
      { type: 'separator' },
      { id: 'status', label: status, enabled: false },
      ...(st.migration ? [{ id: 'migration', label: st.migration.slice(0, 120), enabled: false }] : []),
      st.connected ? item('backend-restart', tr('tray.backendRestart')) : item('backend-start', tr('tray.backendStart')),
      item('backend-stop', tr('tray.backendStop'), st.connected),
      item('herdr-stop', tr('tray.herdrStop'), st.connected),
      { type: 'separator' },
      item('sleep-idle', tr('sleep.trayItem'), st.connected), // P21, P24: 쉬는 리포 모두
      { type: 'separator' },
      item('quit', tr('tray.quit')),
      item('quit-all', tr('tray.quitAll')),
    ];
    st.menu = template.filter((x) => x.label).map((x) => (x.submenu ? `${x.label} [${x.submenu.map((y) => y.label).join(', ')}]` : `${x.label}${x.enabled === false && x.id !== 'status' ? ' (off)' : ''}`)); // 시험이 읽는다
    st.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  function apply(settings) {
    const was = st.enabled;
    st.enabled = !!(settings && settings.tray !== false);
    st.lang = settings && LANGUAGES.includes(settings.language) ? settings.language : DEFAULT_LANGUAGE; // P16
    if (was !== st.enabled) log(`tray setting ${st.enabled ? 'on' : 'off'}`);
    refreshTray();
    // 트레이를 끈 때 창이 없으면 지금처럼 앱을 끝낸다(창을 닫으면 끝나는 것과 같다)
    if (was && !st.enabled && !hasWindow()) { log('tray turned off with no window, app quits'); quit(); }
  }

  // 창이 없는 동안의 OS 알림
  function scan() {
    if (st.stopped || !st.enabled || hasWindow()) return;
    for (const s of st.sessions.values()) {
      const key = notifyKey(s);
      if (!key || st.notified.has(key) || st.pending.has(key)) continue;
      st.pending.set(key, setTimeout(() => decide(s.sessionId, key), NOTIFY_DELAY_MS));
    }
  }
  function decide(sessionId, key) {
    st.pending.delete(key);
    const s = st.sessions.get(sessionId);
    if (st.stopped || !s || notifyKey(s) !== key || !st.enabled || hasWindow()) return; // 그새 풀렸거나 창이 열렸다(창이 정한다)
    // P47: 다른 기기(웹 화면 등)가 최근에 쓰는 중이면 그쪽에서 띄운다. 백엔드가 트레이를 고르거나 아무도 고르지 못했을 때만 띄운다
    if (st.peers && st.peers.notify && st.peers.notify !== TRAY_ID) { st.notified.set(key, Date.now()); log(`tray notification skipped ${sessionId} (client ${st.peers.notify} is active)`); return; }
    st.notified.set(key, Date.now());
    if (!Notification.isSupported()) return log('tray notification unsupported');
    const ask = s.ask ? (s.ask.summary || (s.ask.questions && s.ask.questions[0] && s.ask.questions[0].question) || s.ask.kind) : '';
    const note = new Notification({ title: `@${s.name} ${tr(`state.${s.state === 'trust_wait' ? 'trust_wait' : 'waiting'}`)}`.slice(0, 120), body: String(ask || '').slice(0, 240), icon: NOTIFY_ICON, silent: false });
    const rec = { sessionId, key, at: Date.now(), shown: false, clicked: false, note, source: 'tray' };
    note.on('show', () => { rec.shown = true; log(`tray notification shown ${sessionId} ${key}`); });
    note.on('click', () => { rec.clicked = true; log(`tray notification clicked ${sessionId}`); showNode(sessionId); });
    notifications.push(rec);
    if (notifications.length > 50) notifications.shift();
    note.show();
  }

  // P18: 옛 이름(multitask) 판을 옮기다 생긴 문제를 툴팁·메뉴에 두고, 처음 한 번 알림을 띄운다
  function noteMigration(m) {
    const problems = (m && m.problems) || [];
    st.migration = problems.length ? tr('tray.migrationProblems', { list: problems.join(' / ') }) : null;
    if (problems.length) log(`tray migration problems ${JSON.stringify(problems)}`);
    if (problems.length && !st.migrationNoted && Notification.isSupported()) {
      st.migrationNoted = true;
      const note = new Notification({ title: tr('tray.migrationTitle', { name: APP_NAME }), body: problems.join('\n').slice(0, 240), icon: NOTIFY_ICON, silent: false });
      note.on('click', () => showNode(null));
      notifications.push({ source: 'migration', at: Date.now(), note, shown: true }); note.show();
    }
    refreshTray();
  }

  function onEvent(ev, d) {
    if (st.stopped) return;
    if (ev === 'settings.updated') return apply(d);
    if (ev === 'backend.migration') return noteMigration(d);
    if (ev === 'clients.updated') { st.peers = d; return; } // P47
    if (ev === 'session.updated') st.sessions.set(d.sessionId, d);
    else if (ev === 'session.state' && d.summary) st.sessions.set(d.sessionId, d.summary);
    else if (ev === 'session.removed') st.sessions.delete(d.sessionId);
    else return;
    refreshTray();
    scan();
  }

  let retryTimer = null;
  const retry = () => { clearTimeout(retryTimer); if (!st.stopped) retryTimer = setTimeout(connect, 2000); };
  const clearPending = () => { for (const timer of st.pending.values()) clearTimeout(timer); st.pending.clear(); };
  async function connect() {
    if (st.stopped) return;
    let c;
    const current = () => !st.stopped && st.client === c;
    try {
      const info = backendInfo(cfg);
      if (!info || !(await health(info.port))) throw new Error('backend not running');
      if (st.stopped) return;
      c = new ApiClient(info);
      st.client = c; // 연결 중인 클라이언트도 stop에서 정리한다
      await c.open();
      if (!current()) { c.close(); return; }
      c.on((ev, d) => { if (current()) onEvent(ev, d); });
      c.ws.on('close', () => { if (!current()) return; st.connected = false; st.client = null; clearPending(); refreshTray(); retry(); });
      await c.call('client.hello', { client: TRAY_ID, name: 'tray', kind: 'tray' }).catch(() => {});
      if (!current()) return;
      const sub = await c.call('events.subscribe');
      if (!current()) return;
      st.peers = sub.clients || null;
      st.sessions = new Map(sub.sessions.map((s) => [s.sessionId, s]));
      // 붙기 전에 이미 기다리던 대기는 창이 정했다고 본다(같은 대기에 다시 띄우지 않는다)
      for (const s of st.sessions.values()) { const k = notifyKey(s); if (k) st.notified.set(k, Date.now()); }
      const { settings } = await c.call('settings.get');
      if (!current()) return;
      st.connected = true;
      const bst = await c.call('backend.status').catch(() => null);
      if (!current()) return;
      if (bst && bst.migration) noteMigration(bst.migration);
      log(`tray connected to backend port=${info.port} tray=${!!settings.tray}`);
      apply(settings);
    } catch (e) {
      if (c && st.client !== c) return;
      st.client = null;
      c?.close();
      st.connected = false;
      clearPending(); refreshTray(); retry();
    }
  }
  refreshTray();
  connect();

  return {
    keepRunning: () => st.enabled,
    // 창을 닫았다: 지금 기다리는 대기는 창이 이미 정했으므로 알린 것으로 친다
    onWindowClosed() { for (const s of st.sessions.values()) { const k = notifyKey(s); if (k) st.notified.set(k, Date.now()); } refreshTray(); },
    // 창이 새로 뜰 때 창의 "알린 대기" 기록에 합칠 열쇠들(preload가 읽는다)
    notifiedKeys() { const now = Date.now(); return [...st.notified].filter(([, t]) => now - t < DAY); },
    lang: () => st.lang, // P16: main의 대화상자도 같은 언어로
    tr,
    state: () => ({ icon: st.tray ? st.icon : null, lang: st.lang, enabled: st.enabled, connected: st.connected, busy: st.busy, lastError: st.lastError, migration: st.migration, hasTray: !!st.tray, menu: st.tray ? st.menu : null, tooltip: st.tray ? st.tooltip : null, needsYou: needsYou().map((s) => s.name), notified: [...st.notified.keys()], pending: [...st.pending.keys()], lastSleep: st.lastSleep || null }),
    run: (id) => ACTIONS[id] && ACTIONS[id](), // 시험이 메뉴 누르기를 흉내 낸다
    iconPng: (kind, scaleFactor = 1) => (st.images ? st.images[kind].toPNG({ scaleFactor }).toString('base64') : null), // 시험이 트레이 그림을 저장한다
    // P18: 창이 백엔드를 띄우지 못한 까닭(옛 판을 옮기지 못함 등)이나 옛 창 프로필 문제를 툴팁에 보인다
    noteError(msg) { st.lastError = String(msg || '').slice(0, 200); refreshTray(); },
    stop() { st.stopped = true; clearTimeout(retryTimer); clearPending(); if (st.client) st.client.close(); st.client = null; st.connected = false; if (st.tray) st.tray.destroy(); st.tray = null; },
  };
}
