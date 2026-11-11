// P49(원격 R3): atrium remote status|guide|enable|disable. 노트북에서 Tailscale로 이 PC의 판을 브라우저로 쓴다.
// - status: 진단(Tailscale 설치·실행·로그인, MagicDNS, HTTPS 인증서, serve가 판 포트로 가는지, funnel, Host 허용 목록, 짝 맺은 기기, 노트북에서 열 주소).
//   백엔드가 떠 있으면 백엔드의 remote.status를, 아니면 이 자리에서 tailscale을 읽는다(읽기 명령만).
// - guide: 따라 할 단계.
// - block / allow(P58): 원격 받기 끄기·켜기(판 설정 remoteAccess). 끄면 짝 맺은 기기와 Tailscale로 온 요청을 모두 거부하고 붙은 원격 연결을 닫는다. serve는 그대로다.
// - enable / disable: `tailscale serve --bg --https=<포트> http://127.0.0.1:<판 포트>`와 그 끄기. --yes가 있을 때만 실행하고, 없으면 할 명령만 보인다.
//   funnel(인터넷 공개)은 쓰지 않는다. 그 https 포트를 다른 서비스가 쓰고 있으면 덮어쓰지 않고 멈춘다(--https-port로 다른 포트).
import { execFile } from 'node:child_process';
import { readTailscale, diagnose, tailscaleBin, tailscaleHosts, serveCommand, serveOffCommand, portConflict, freeHttpsPort, DEFAULT_HTTPS_PORT } from '../src/tailscale.mjs';
import { allowedHosts } from '../src/web.mjs';
import { wsLabel } from '../src/remote-ws.mjs'; // P82
import { crashLabel, stepsLabel } from '../src/web-crash.mjs'; // P84. P86: stepsLabel

const MARK = { ok: '[ok]  ', warn: '[주의]', fail: '[안 됨]', skip: '[-]   ' };

// 진단 한 줄의 글(한국어, CLI용). 창은 locales의 remote.check.* 열쇠를 쓴다
export function checkText(c, port) {
  const v = c.vars || {};
  const T = {
    installed: { ok: `Tailscale 설치됨${v.version ? ` (${v.version})` : ''}`, fail: 'Tailscale이 설치되어 있지 않습니다. https://tailscale.com/download 에서 설치하세요', skip: 'Tailscale 정보 조회가 꺼져 있습니다 (ATRIUM_TAILSCALE=none)' },
    running: { ok: 'Tailscale이 실행 중입니다', fail: `Tailscale이 실행 중이 아닙니다${v.state ? ` (${v.state})` : ''}. 트레이의 Tailscale 메뉴에서 Connect를 누르세요` },
    login: { ok: `로그인: ${v.login}`, fail: 'Tailscale에 로그인하지 않았습니다' },
    magicdns: { ok: `MagicDNS 켜짐: ${v.name}`, fail: 'MagicDNS가 꺼져 있습니다. tailnet 관리 화면의 DNS에서 켜세요' },
    https: { ok: 'HTTPS 인증서 켜짐', fail: 'HTTPS 인증서가 꺼져 있습니다. tailnet 관리 화면의 DNS > HTTPS Certificates에서 켜세요' },
    serve: { ok: `tailscale serve가 HTTPS 포트 ${v.httpsPort}의 요청을 보드 포트 ${port}로 전달합니다`, fail: `tailscale serve가 이 보드로 연결되도록 설정되어 있지 않습니다. 실행할 명령: atrium remote enable --yes`, warn: `HTTPS 포트 ${v.httpsPort}를 다른 서비스에서 사용 중입니다. 다른 포트로 실행하세요: atrium remote enable --yes --https-port ${v.free || '<다른 포트>'}` },
    funnel: { ok: 'funnel(인터넷 공개) 꺼짐', warn: `funnel이 켜진 포트가 있습니다 (${v.ports}). 보드에는 사용하지 마세요`, fail: `보드 주소에 funnel이 켜져 있습니다 (${v.ports}). 보드가 인터넷에 공개됩니다. tailscale funnel ... off로 끄세요` },
    hosts: { ok: `Host 허용 목록에 ${v.name}가 있습니다`, fail: `Host 허용 목록에 Tailscale 이름이 없습니다${v.name ? ` (${v.name}). 백엔드를 다시 켜거나 잠시 뒤 다시 봅니다` : ''}` },
    built: { ok: '웹 화면 빌드 있음', fail: '웹 화면 빌드가 없습니다. cd app && npm run build' },
    devices: { ok: `등록된 기기 ${v.n}대`, warn: '등록된 기기가 없습니다. 노트북에서 보드 주소를 열고 코드로 기기를 등록하세요' },
    nodes: { ok: '등록된 브라우저는 등록에 사용한 Tailscale 기기에서만 접속할 수 있습니다', warn: `Tailscale 기기 정보가 없는 기존 기기 ${v.n}대는 외부 접속이 차단됩니다. 해당 기기를 다시 등록하세요`, skip: '등록된 브라우저는 등록에 사용한 Tailscale 기기에서만 접속할 수 있습니다 (백엔드가 실행 중이 아니므로 기존 기기 수는 확인 불가)' },
    // P62: 패스키로 확인(판 설정 remotePasskey, 바꾸는 것은 PC 창의 설정 › 연결된 기기)
    passkey_on: { ok: '패스키 인증 사용: 기기 등록을 승인받은 뒤 패스키를 만들고, 세션이 종료되면 휴대폰이나 이 기기의 패스키로 다시 인증합니다' },
    passkey_off: { ok: '패스키 인증 꺼짐: 등록된 Tailscale 기기에서 바로 열립니다(기기 등록을 해제할 때까지)' },
    passkey: { skip: '패스키 인증: 백엔드가 실행 중이 아니므로 확인 불가' },
    users: { ok:`동일한 Tailscale 사용자의 요청만 허용합니다${v.n ? ` (+추가 허용 ${v.n}명)` : ''}`, warn: '로그인 사용자 제한이 꺼져 있습니다. tailnet의 모든 사용자가 기기 등록을 시도할 수 있습니다' },
  };
  return `${MARK[c.level] || ''} ${(T[c.id] && T[c.id][c.level]) || `${c.id} ${c.level}`}`;
}

export function formatStatus(d) {
  const lines = d.checks.map((c) => checkText(c, d.port));
  if (d.enabled === false) lines.unshift('Remote access is off. Enable it in Connected devices or with atrium remote enable --yes.');
  // P58: 원격 받기 스위치(판 설정 remoteAccess)와 지금 붙은 기기 수. 백엔드 없이 읽으면 모른다
  if (d.accepting === false) lines.unshift('[차단] 원격 접속이 차단되어 있습니다. 등록된 기기와 Tailscale을 통한 요청을 모두 거부합니다. 접속 허용: atrium remote allow');
  else if (d.accepting === true) lines.unshift(`[ok]   원격 접속 허용${Number.isInteger(d.connected) ? ` (현재 연결된 기기 ${d.connected}대)` : ''}. 접속 차단: atrium remote block`);
  lines.push('');
  if (d.url) lines.push(`노트북에서 접속할 주소: ${d.url}${d.ready ? '' : ' (위의 [안 됨] 항목을 먼저 해결하세요)'}`);
  if (d.enable) lines.push(`켜기: ${d.enable}`);
  return lines.join('\n');
}

// P58: 연결 기록 한 줄(CLI). 창은 locales의 remoteLog.* 열쇠를 쓴다
const LOG_TEXT = { 'pair.request': '기기 등록 요청', 'pair.grant': '기기 등록 승인', 'pair.ok': '기기 등록 완료', login: '패스키 로그인', logout: '로그아웃', 'passkey.on': '패스키 인증 사용', 'passkey.off': '패스키 인증 사용 안 함', 'passkey.add': '패스키 등록', 'pair.fail': '기기 등록 실패', connect: '연결', disconnect: '연결 종료', deny: '거부', unpair: '기기 등록 해제', kick: 'PC에서 연결 종료', 'remote.block': '원격 접속 차단', 'remote.allow': '원격 접속 허용', boot: '화면이 닫힌 뒤 다시 열림', level: '보드 단계 기억', 'push.on': '알림 켬', 'push.off': '알림 끔', 'push.fail': '알림 보내기 실패', other: '기타' }; // P84: boot. P88: push.*
export function formatLogEntry(e) {
  const p2 = (n) => String(n).padStart(2, '0');
  const d = new Date(e.at);
  const when = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  const parts = [when, (LOG_TEXT[e.event] || e.event).padEnd(8)];
  if (e.reason) parts.push(`사유=${e.reason}`);
  if (e.via) parts.push(`방법=${e.via === 'code' ? '코드' : '승인'}`);
  if (e.passkey === false) parts.push('패스키 없이'); // P62
  if (e.host) parts.push(`푸시 서비스=${e.host}`); // P88
  if (e.deviceName || e.deviceId) parts.push(`기기=${e.deviceName || ''}${e.deviceId ? ` (${e.deviceId.slice(0, 8)})` : ''}`);
  if (e.node) parts.push(`Tailscale 기기=${e.node}`); // P59
  if (e.remote != null) parts.push(e.remote ? '바깥' : '이 PC');
  if (e.login) parts.push(`로그인=${e.login}`);
  if (e.addr) parts.push(`주소=${e.addr}`);
  if (e.browser) parts.push(e.browser);
  if (Number.isInteger(e.n)) parts.push(`닫은 연결 ${e.n}개`);
  if (e.ws) parts.push(`소켓=${wsLabel(e.ws)}${e.ws.out != null ? ` 보냄 ${e.ws.out}개 ${e.ws.outB}B 받음 ${e.ws.in}개 ${e.ws.inB}B${e.ws.last ? ` 마지막 ${e.ws.last.join(',')}` : ''}` : ''}`); // P82
  if (e.prev) parts.push(`직전 닫힘=${e.prev.code}${e.prev.clean ? '' : ' (깨끗하지 않음)'} ${(e.prev.ms / 1000).toFixed(1)}s`); // P82: 창이 본 것
  if (e.light) parts.push('가벼운 화면으로 열림'); // P84
  if (e.crash) parts.push(`닫히기 전=${crashLabel(e.crash)}${e.crash.ago != null ? ` 다시 열기까지 ${(e.crash.ago / 1000).toFixed(1)}s` : ''}${e.crash.inB != null ? ` 받음 ${e.crash.inB}B` : ''}${e.crash.boots ? ` 이어 닫힘 ${e.crash.boots}번` : ''}${e.crash.retry ? ' 보드로 다시 연 뒤' : ''}`);
  if (e.level != null && (e.event === 'level' || e.level > 0)) parts.push(`보드 단계=${e.level}`); // P86
  if (e.crash && e.crash.steps) parts.push(`마지막 단계=${stepsLabel(e.crash.steps)}`); // P86: 죽기 직전의 보드 시작 단계
  if (e.count > 1) parts.push(`×${e.count}`);
  return parts.join('  ');
}

export function guideText(port, httpsPort = DEFAULT_HTTPS_PORT) {
  return [
    '원격 접속(Tailscale) 따라 하기',
    '1. PC와 노트북에 Tailscale을 설치하고 같은 계정으로 로그인합니다(https://tailscale.com/download).',
    '2. tailnet 관리 화면(https://login.tailscale.com/admin/dns)에서 MagicDNS와 HTTPS Certificates를 켭니다.',
    '   기기 이름과 tailnet 이름은 인증서 공개 기록(Certificate Transparency)에 남습니다.',
    `3. PC에서: atrium remote enable --yes${httpsPort !== 443 ? ` --https-port ${httpsPort}` : ''}`,
    `   (= tailscale ${serveCommand(port, httpsPort).join(' ')}. tailnet 안에서만 열리고 인터넷에는 열리지 않습니다)`,
    '4. PC에서 atrium remote status를 실행해 [안 됨] 항목이 없는지 확인하고 노트북에서 접속할 주소를 확인하세요.',
    '5. 노트북 브라우저에서 그 주소(https://<PC 이름>.<tailnet>.ts.net/)를 엽니다.',
    '6. PC 창의 설정 › 연결된 기기에서 "새 코드"를 누르고 노트북에 6자리 코드를 입력하세요. 노트북에서 연결 승인을 요청하고 PC에서 승인해도 됩니다.',
    '7. 브라우저 메뉴의 "앱 설치"로 앱처럼 띄울 수 있습니다.',
    '',
    '주의',
    '- 등록된 기기는 이 PC 사용자와 같은 권한입니다(셸을 띄워 무엇이든 실행할 수 있습니다).',
    '- funnel(tailscale funnel)은 쓰지 않습니다. 보드가 인터넷에 공개됩니다.',
    '- 연결 종료: PC 창 위쪽 "다른 기기" 버튼 > "연결 끊기" 또는 atrium devices kick <ID>. 기기는 다시 연결할 수 있습니다.',
    '- 등록 해제: "기기 등록 해제" 또는 atrium devices rm <ID>. 설정 > 연결된 기기에서도 해제할 수 있습니다.',
    '- 원격 접속 차단: atrium remote block. 트레이 메뉴 또는 설정 > 연결된 기기의 "원격 접속 허용"을 꺼도 됩니다. 접속 허용: atrium remote allow',
    '- 기록: atrium remote log (기기 등록, 연결·끊김, 거부와 사유)',
    `- 끄기: atrium remote disable --yes (= tailscale ${serveOffCommand(port, httpsPort).join(' ')})`,
  ].join('\n');
}

// 이 자리에서 읽기(백엔드가 없을 때)
export async function localStatus(cfg, { run } = {}) {
  const ts = await readTailscale({ port: cfg.port, ...(run ? { run } : {}) });
  const hosts = [...allowedHosts(cfg.port), ...tailscaleHosts(ts)];
  return { ...diagnose(ts, { port: cfg.port, hosts, devices: null, built: undefined, sameUser: true, allowed: [] }), port: cfg.port, offline: true, ts };
}

// 바꾸기 명령을 실제로 부른다(--yes일 때만, enable·disable만)
function runChange(bin, args) {
  return new Promise((res, rej) => execFile(bin, args, { timeout: 30_000, windowsHide: true, env: { ...process.env, TAILSCALE_BE_CLI: '1' } }, (e, out, err) => (e ? rej(Object.assign(e, { stderr: String(err || '') })) : res(String(out || '') + String(err || '')))));
}

// enable·disable 계획. 순수 함수(시험): 실행할지, 무엇을, 왜 멈추는지
export function planChange(op, ts, { port, httpsPort, yes }) {
  if (!ts || !ts.installed) return { run: false, stop: 'not_installed' };
  if (!ts.status || !ts.status.running) return { run: false, stop: 'not_running' };
  const hp = Number(httpsPort) || (op === 'disable' && ts.serve && ts.serve.board ? ts.serve.board.port : DEFAULT_HTTPS_PORT);
  if (op === 'enable') {
    if (!ts.status.https) return { run: false, stop: 'no_https' };
    if (ts.serve && ts.serve.board && ts.serve.board.port === hp) return { run: false, stop: 'already', httpsPort: hp };
    const c = portConflict(ts, port, hp);
    if (c) return { run: false, stop: 'port_in_use', httpsPort: hp, free: freeHttpsPort(ts) };
    return { run: !!yes, args: serveCommand(port, hp), httpsPort: hp };
  }
  if (op === 'disable') {
    if (!ts.serve || !ts.serve.entries.some((e) => e.toBoard && e.port === hp)) return { run: false, stop: 'not_serving', httpsPort: hp };
    return { run: !!yes, args: serveOffCommand(port, hp), httpsPort: hp };
  }
  return { run: false, stop: 'unknown_op' };
}
const STOP = {
  not_installed: 'Tailscale이 설치되어 있지 않습니다. atrium remote guide를 확인하세요',
  not_running: 'Tailscale이 실행 중이 아니거나 로그인하지 않았습니다',
  no_https: 'tailnet의 HTTPS 인증서가 꺼져 있습니다. 관리 화면의 DNS에서 켜세요 (atrium remote guide)',
  already: '이미 이 보드로 연결되도록 설정되어 있습니다',
  port_in_use: 'https 포트를 다른 서비스가 쓰고 있어 덮어쓰지 않습니다',
  not_serving: '이 보드로 연결되는 serve 설정이 없습니다',
  unknown_op: '알 수 없는 명령입니다',
};

// P88: 시험 알림 결과 한 줄
export function pushTestLine(x) {
  const who = `${x.name || ''} (${String(x.id || '').slice(0, 8)})`;
  if (x.ok) return `[ok]   ${who}: 시험 알림을 보냈습니다`;
  const why = String(x.reason || '');
  if (why.startsWith('gone_')) return `[안 됨] ${who}: 푸시 서비스가 구독을 버렸습니다(${why.slice(5)}). 휴대폰에서 알림을 다시 켜세요`;
  return `[안 됨] ${who}: 보내지 못했습니다 (${why || 'error'})`;
}

export async function remoteCommand(cfg, rest, flags, connect, { read = readTailscale, change = runChange, bin: getBin = tailscaleBin } = {}) {
  const op = rest[0] || 'status';
  if (op === 'guide') return console.log(guideText(cfg.port, Number(flags['https-port']) || DEFAULT_HTTPS_PORT));
  if (op === 'status') {
    let d = null;
    try { const c = await connect(); try { d = await c.call('remote.status', { fresh: true }); } finally { c.close?.(); } } catch { d = null; }
    if (!d) { d = await localStatus(cfg); console.log('(백엔드가 떠 있지 않아 이 자리에서 읽었습니다. 등록된 기기 수와 Host 목록은 백엔드를 켜야 보입니다)'); }
    if (flags.json) { const { ts, ...rest2 } = d; return console.log(JSON.stringify(rest2, null, 2)); }
    return console.log(formatStatus(d));
  }
  if (op === 'log') { // P58: 연결 기록(최근 것부터)
    const c = await connect();
    try {
      const r = await c.call('remote.log', { limit: Number.parseInt(flags.limit, 10) || 50 });
      if (flags.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.entries.length) return console.log('원격 연결 기록이 없습니다');
      for (const e of r.entries) console.log(formatLogEntry(e));
    } finally { c.close?.(); }
    return;
  }
  // P88: 알림을 켠 기기에 시험 알림을 보낸다. 기기를 주면(ID 앞부분, 이름, Tailscale 기기 이름) 그 기기에만
  if (op === 'push-test') {
    let c;
    try { c = await connect(); } catch (e) { console.log(`백엔드가 실행 중이 아닙니다 (${(e && e.message) || e})`); process.exitCode = 1; return; }
    try {
      const r = await c.call('push.test', rest[1] ? { device: rest[1] } : {});
      if (flags.json) return console.log(JSON.stringify(r, null, 2));
      if (!r.results.length) { console.log(rest[1] ? `알림을 켠 기기 중에 '${rest[1]}'이(가) 없습니다` : '알림을 켠 기기가 없습니다. 휴대폰 홈 화면 앱의 세션 목록에서 알림을 켜세요'); process.exitCode = 1; return; }
      for (const x of r.results) console.log(pushTestLine(x));
      if (r.results.some((x) => !x.ok)) process.exitCode = 1;
    } finally { c.close?.(); }
    return;
  }
  // P58: 원격 받기 끄기·켜기(판 설정 remoteAccess). Tailscale serve 설정은 건드리지 않는다. 백엔드가 떠 있어야 한다
  if (op === 'block' || op === 'allow') {
    let c;
    try { c = await connect(); } catch (e) { console.log(`백엔드가 실행 중이 아닙니다. 원격 접속 허용 설정은 백엔드 실행 중에 변경할 수 있습니다 (${(e && e.message) || e})`); process.exitCode = 1; return; }
    try {
      const r = await c.call('settings.set', { remoteAccess: op === 'allow' });
      if (flags.json) return console.log(JSON.stringify({ remoteAccess: r.settings.remoteAccess, closed: (r.remote && r.remote.closed) || 0 }, null, 2));
      console.log(op === 'block' ? `원격 접속을 차단하고 연결 ${(r.remote && r.remote.closed) || 0}개를 종료했습니다. 이 PC의 창과 CLI는 계속 사용할 수 있습니다. 접속 허용: atrium remote allow` : '원격 접속을 허용했습니다. 등록된 기기를 다시 연결할 수 있습니다');
    } finally { c.close?.(); }
    return;
  }
  if (op === 'enable' || op === 'disable') {
    const bin = getBin();
    const ts = await read({ port: cfg.port, bin });
    const p = planChange(op, ts, { port: cfg.port, httpsPort: flags['https-port'], yes: !!flags.yes });
    // A dry run never changes either board configuration or Tailscale. Explicit
    // confirmation enables the board gate too, including an already-running serve.
    if (flags.yes && (op === 'disable' || p.run || p.stop === 'already')) {
      const c = await connect();
      try { await c.call('remote.configure', { enabled: op === 'enable' }); }
      finally { c.close?.(); }
    }
    if (p.stop) {
      console.log(`${STOP[p.stop]}${p.stop === 'port_in_use' ? `: https ${p.httpsPort}. 다른 포트: atrium remote enable --yes --https-port ${p.free || '<포트>'}` : ''}`);
      if (p.stop !== 'already' && !(op === 'disable' && p.stop === 'not_serving')) process.exitCode = 1;
      return;
    }
    if ((ts.serve && ts.serve.funnel && ts.serve.funnel.length)) console.log(`주의: funnel이 켜진 포트가 있습니다(${ts.serve.funnel.join(', ')}). 보드에는 funnel을 쓰지 않습니다`);
    if (!p.run) { console.log(`실행할 명령: tailscale ${p.args.join(' ')}\n--yes를 붙이면 실행합니다`); return; }
    console.log(`실행: tailscale ${p.args.join(' ')}`);
    const out = await change(bin, p.args).catch((e) => { process.exitCode = 1; return `실패: ${(e.stderr || e.message || '').trim()}`; });
    if (out.trim()) console.log(out.trim());
    return;
  }
  console.log('사용: atrium remote status|guide|log|block|allow|enable|disable|push-test [기기] [--yes] [--https-port <포트>]');
  process.exitCode = 1;
}
