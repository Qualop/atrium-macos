// P49(원격 R3): atrium remote status|guide|enable|disable. 노트북에서 Tailscale로 이 PC의 판을 브라우저로 쓴다.
// - status: 진단(Tailscale 설치·실행·로그인, MagicDNS, HTTPS 인증서, serve가 판 포트로 가는지, funnel, Host 허용 목록, 짝 맺은 기기, 노트북에서 열 주소).
//   백엔드가 떠 있으면 백엔드의 remote.status를, 아니면 이 자리에서 tailscale을 읽는다(읽기 명령만).
// - guide: 따라 할 단계.
// - enable / disable: `tailscale serve --bg --https=<포트> http://127.0.0.1:<판 포트>`와 그 끄기. --yes가 있을 때만 실행하고, 없으면 할 명령만 보인다.
//   funnel(인터넷 공개)은 쓰지 않는다. 그 https 포트를 다른 서비스가 쓰고 있으면 덮어쓰지 않고 멈춘다(--https-port로 다른 포트).
import { execFile } from 'node:child_process';
import { readTailscale, diagnose, tailscaleBin, tailscaleHosts, serveCommand, serveOffCommand, portConflict, freeHttpsPort, DEFAULT_HTTPS_PORT } from '../src/tailscale.mjs';
import { allowedHosts } from '../src/web.mjs';

const MARK = { ok: '[ok]  ', warn: '[주의]', fail: '[안 됨]', skip: '[-]   ' };

// 진단 한 줄의 글(한국어, CLI용). 창은 locales의 remote.check.* 열쇠를 쓴다
export function checkText(c, port) {
  const v = c.vars || {};
  const T = {
    installed: { ok: `Tailscale 설치됨${v.version ? ` (${v.version})` : ''}`, fail: 'Tailscale이 없습니다. https://tailscale.com/download 에서 설치합니다', skip: 'Tailscale 읽기를 껐습니다(ATRIUM_TAILSCALE=none)' },
    running: { ok: 'Tailscale이 돌고 있습니다', fail: `Tailscale이 돌고 있지 않습니다${v.state ? ` (${v.state})` : ''}. 트레이의 Tailscale에서 Connect를 누릅니다` },
    login: { ok: `로그인: ${v.login}`, fail: 'Tailscale에 로그인하지 않았습니다' },
    magicdns: { ok: `MagicDNS 켜짐: ${v.name}`, fail: 'MagicDNS가 꺼져 있습니다. tailnet 관리 화면 DNS에서 켭니다' },
    https: { ok: 'HTTPS 인증서 켜짐', fail: 'HTTPS 인증서가 꺼져 있습니다. tailnet 관리 화면 DNS의 HTTPS Certificates에서 켭니다' },
    serve: { ok: `tailscale serve가 https ${v.httpsPort} → 판 포트 ${port}로 갑니다`, fail: `tailscale serve가 판으로 가지 않습니다. atrium remote enable --yes`, warn: `https ${v.httpsPort}는 다른 서비스가 쓰고 있습니다. 덮어쓰지 않으려면 atrium remote enable --yes --https-port ${v.free || '<다른 포트>'}` },
    funnel: { ok: 'funnel(인터넷 공개) 꺼짐', warn: `funnel이 켜진 포트가 있습니다(${v.ports}). 판에는 쓰지 않습니다`, fail: `판 주소에 funnel이 켜져 있습니다(${v.ports}). 인터넷에 공개됩니다. tailscale funnel ... off로 끕니다` },
    hosts: { ok: `Host 허용 목록에 ${v.name}가 있습니다`, fail: `Host 허용 목록에 Tailscale 이름이 없습니다${v.name ? ` (${v.name}). 백엔드를 다시 켜거나 잠시 뒤 다시 봅니다` : ''}` },
    built: { ok: '웹 화면 빌드 있음', fail: '웹 화면 빌드가 없습니다. cd app && npm run build' },
    devices: { ok: `짝 맺은 기기 ${v.n}대`, warn: '짝 맺은 기기가 없습니다. 노트북에서 주소를 열고 코드로 짝을 맺습니다' },
    users: { ok: `같은 Tailscale 사용자만 받습니다${v.n ? ` (+허용 ${v.n}명)` : ''}`, warn: '로그인 사용자 제한이 꺼져 있습니다. tailnet의 누구든 짝 맺기를 시도할 수 있습니다' },
  };
  return `${MARK[c.level] || ''} ${(T[c.id] && T[c.id][c.level]) || `${c.id} ${c.level}`}`;
}

export function formatStatus(d) {
  const lines = d.checks.map((c) => checkText(c, d.port));
  if (d.enabled === false) lines.unshift('Remote access is off. Enable it in Connected devices or with atrium remote enable --yes.');
  lines.push('');
  if (d.url) lines.push(`노트북에서 열 주소: ${d.url}${d.ready ? '' : ' (위의 [안 됨]을 먼저 고칩니다)'}`);
  if (d.enable) lines.push(`켜기: ${d.enable}`);
  return lines.join('\n');
}

export function guideText(port, httpsPort = DEFAULT_HTTPS_PORT) {
  return [
    '원격 접속(Tailscale) 따라 하기',
    '1. PC와 노트북에 Tailscale을 설치하고 같은 계정으로 로그인합니다(https://tailscale.com/download).',
    '2. tailnet 관리 화면(https://login.tailscale.com/admin/dns)에서 MagicDNS와 HTTPS Certificates를 켭니다.',
    '   기기 이름과 tailnet 이름은 인증서 공개 기록(Certificate Transparency)에 남습니다.',
    `3. PC에서: atrium remote enable --yes${httpsPort !== 443 ? ` --https-port ${httpsPort}` : ''}`,
    `   (= tailscale ${serveCommand(port, httpsPort).join(' ')}. tailnet 안에서만 열리고 인터넷에는 열리지 않습니다)`,
    '4. PC에서: atrium remote status 로 [안 됨]이 없는지와 노트북에서 열 주소를 봅니다.',
    '5. 노트북 브라우저에서 그 주소(https://<PC 이름>.<tailnet>.ts.net/)를 엽니다.',
    '6. PC 창의 설정 › 연결된 기기에서 "새 코드"를 누르고, 노트북에 6자리 코드를 넣습니다(또는 노트북에서 허락을 청하고 PC에서 허락).',
    '7. 브라우저 메뉴의 "앱 설치"로 앱처럼 띄울 수 있습니다.',
    '',
    '주의',
    '- 짝 맺은 기기는 이 PC 사용자와 같은 권한입니다(셸을 띄워 무엇이든 실행할 수 있습니다).',
    '- funnel(tailscale funnel)은 쓰지 않습니다. 판이 인터넷에 공개됩니다.',
    '- 끊기: PC 창 설정 › 연결된 기기에서 "끊기", 또는 atrium devices rm <ID>.',
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
  return new Promise((res, rej) => execFile(bin, args, { timeout: 30_000, windowsHide: true }, (e, out, err) => (e ? rej(Object.assign(e, { stderr: String(err || '') })) : res(String(out || '') + String(err || '')))));
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
  not_installed: 'Tailscale이 없습니다. atrium remote guide를 봅니다',
  not_running: 'Tailscale이 돌고 있지 않거나 로그인하지 않았습니다',
  no_https: 'tailnet의 HTTPS 인증서가 꺼져 있습니다. 관리 화면 DNS에서 켭니다(atrium remote guide)',
  already: '이미 판으로 가고 있습니다',
  port_in_use: 'https 포트를 다른 서비스가 쓰고 있어 덮어쓰지 않습니다',
  not_serving: '판으로 가는 serve가 없습니다',
  unknown_op: '모르는 명령',
};

export async function remoteCommand(cfg, rest, flags, connect, { read = readTailscale, change = runChange, bin: getBin = tailscaleBin } = {}) {
  const op = rest[0] || 'status';
  if (op === 'guide') return console.log(guideText(cfg.port, Number(flags['https-port']) || DEFAULT_HTTPS_PORT));
  if (op === 'status') {
    let d = null;
    try { const c = await connect(); try { d = await c.call('remote.status', { fresh: true }); } finally { c.close?.(); } } catch { d = null; }
    if (!d) { d = await localStatus(cfg); console.log('(백엔드가 떠 있지 않아 이 자리에서 읽었습니다. 짝 맺은 기기 수와 Host 목록은 백엔드를 켜야 보입니다)'); }
    if (flags.json) { const { ts, ...rest2 } = d; return console.log(JSON.stringify(rest2, null, 2)); }
    return console.log(formatStatus(d));
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
    if ((ts.serve && ts.serve.funnel && ts.serve.funnel.length)) console.log(`주의: funnel이 켜진 포트가 있습니다(${ts.serve.funnel.join(', ')}). 판에는 funnel을 쓰지 않습니다`);
    if (!p.run) { console.log(`실행할 명령: tailscale ${p.args.join(' ')}\n--yes를 붙이면 실행합니다`); return; }
    console.log(`실행: tailscale ${p.args.join(' ')}`);
    const out = await change(bin, p.args).catch((e) => { process.exitCode = 1; return `실패: ${(e.stderr || e.message || '').trim()}`; });
    if (out.trim()) console.log(out.trim());
    return;
  }
  console.log('사용: atrium remote status|guide|enable|disable [--yes] [--https-port <포트>]');
  process.exitCode = 1;
}
