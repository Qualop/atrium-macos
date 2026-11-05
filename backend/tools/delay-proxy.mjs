#!/usr/bin/env node
// P47(원격 R1) 지연 시험 도구: 127.0.0.1의 한 포트에서 받아 백엔드 포트로 넘기며, 오가는 TCP 조각마다 지연과 흔들림을 넣는다.
// WebSocket(API)과 HTTP를 가리지 않는다. 방향마다 순서는 지킨다(앞 조각보다 먼저 보내지 않는다). R3(Tailscale) 전에 원격 지연을 흉내 낼 때 쓴다.
// 사용: node backend/tools/delay-proxy.mjs --listen 47870 --target 47865 --delay 100 [--jitter 20] [--seed 1]
//   지연은 한쪽 방향의 값이다(왕복은 두 배). 흔들림은 ±jitter ms의 고른 분포.
// 받는 주소는 늘 127.0.0.1이다. 네트워크에 열지 않는다.
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// 조각 하나를 보낼 시각. prev: 같은 방향 앞 조각을 보낸(보낼) 시각. rand: [0,1)
export function deliverAt({ now, prev = 0, delay = 0, jitter = 0, rand = 0.5 }) {
  const d = Math.max(0, delay + (jitter ? (rand * 2 - 1) * jitter : 0));
  return Math.max(prev, now + d);
}

// 작은 결정적 난수(시험을 다시 돌려도 같은 흔들림)
export function seeded(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}

// 지연 프록시를 띄운다. setDelay로 도는 중에 지연을 바꿀 수 있다
export function startDelayProxy({ listen, target, delay = 0, jitter = 0, seed = 1, host = '127.0.0.1', log = () => {} }) {
  const cfg = { delay, jitter };
  const rand = seeded(seed);
  const socks = new Set();
  const pipe = (from, to) => {
    let prev = 0;
    from.on('data', (chunk) => {
      const now = Date.now();
      const at = deliverAt({ now, prev, delay: cfg.delay, jitter: cfg.jitter, rand: rand() });
      prev = at;
      if (at <= now) { if (!to.destroyed) to.write(chunk); return; }
      setTimeout(() => { if (!to.destroyed) to.write(chunk); }, at - now);
    });
    from.on('end', () => setTimeout(() => to.end(), Math.max(0, prev - Date.now())));
  };
  const server = net.createServer((client) => {
    const up = net.connect(target, host);
    socks.add(client); socks.add(up);
    const done = () => { client.destroy(); up.destroy(); socks.delete(client); socks.delete(up); };
    client.on('error', done); up.on('error', done); client.on('close', done); up.on('close', done);
    pipe(client, up); pipe(up, client);
  });
  const ready = new Promise((res, rej) => { server.once('error', rej); server.listen(listen, '127.0.0.1', () => { log(`delay proxy 127.0.0.1:${server.address().port} → ${host}:${target} delay=${cfg.delay}ms jitter=${cfg.jitter}ms`); res(server.address().port); }); });
  return {
    ready,
    setDelay(d, j = cfg.jitter) { cfg.delay = d; cfg.jitter = j; log(`delay proxy delay=${d}ms jitter=${j}ms`); },
    close() { for (const s of socks) s.destroy(); return new Promise((r) => server.close(() => r())); },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const a = process.argv.slice(2);
  const arg = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? Number(a[i + 1]) : d; };
  const listen = arg('listen'), target = arg('target');
  if (!listen || !target) { console.error('사용: node backend/tools/delay-proxy.mjs --listen <포트> --target <백엔드 포트> --delay <ms> [--jitter <ms>] [--seed n]'); process.exit(2); }
  const p = startDelayProxy({ listen, target, delay: arg('delay', 0), jitter: arg('jitter', 0), seed: arg('seed', 1), log: (m) => console.log(m) });
  p.ready.catch((e) => { console.error(e.message); process.exit(1); });
}
