#!/usr/bin/env node
// P49 시험용 가짜 tailscale: 읽기 명령(status --json, serve status --json)에만 예시 값을 낸다. 판은 ATRIUM_TAILSCALE=<이 파일>로 부른다.
// 이름은 예시다(pc.example.ts.net, me@example.com). 판 포트는 P49_FAKE_TS_PORT(기본 47868).
const args = process.argv.slice(2).join(' ');
const NAME = 'pc.example.ts.net';
const port = Number(process.env.P49_FAKE_TS_PORT || 47868);
if (args === 'status --json') {
  console.log(JSON.stringify({
    Version: '0.0.0-fake', BackendState: 'Running',
    Self: { HostName: 'pc', DNSName: `${NAME}.`, UserID: 1, TailscaleIPs: ['100.64.0.1'] },
    MagicDNSSuffix: 'example.ts.net',
    CurrentTailnet: { Name: 'example', MagicDNSSuffix: 'example.ts.net', MagicDNSEnabled: true },
    CertDomains: [NAME], User: { 1: { ID: 1, LoginName: 'me@example.com', DisplayName: 'Me' } }, Health: [],
  }));
} else if (args === 'serve status --json') {
  console.log(JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [`${NAME}:443`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } } }));
} else {
  console.error(`fake tailscale: only read commands (${args})`);
  process.exit(2);
}
