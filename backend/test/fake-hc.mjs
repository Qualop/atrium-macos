// P114 시험 도구: 가짜 herdr-core 코어. 이름 있는 파이프에서 hc API의 일부(plain JSON-RPC, 이벤트 구독, 프레임 모드 attach)를 흉내 낸다.
// 시험이 상태를 바꾼다: setStatus, output, finish, size, dropAll(코어 재시작 흉내)
import net from 'node:net';
import crypto from 'node:crypto';
import { FrameDecoder, encodeFrame, FRAME } from '../src/hc/rpc.mjs';

export const FIRST_PAINT = '\x18\x1b[!p\x1b[H\x1b[2Jfake screen';
const APP = { claude: 'claude-code', codex: 'codex', opencode: 'opencode', pi: 'pi' };

export async function startFakeHc({ version = '0.1.20', generation = 1, features = ['framed', 'attach', 'events', 'status', 'shell'] } = {}) {
  const pipe = `\\\\.\\pipe\\atrium-test-hc-${crypto.randomBytes(6).toString('hex')}`;
  const terms = new Map();
  const subs = new Set(); // plain 구독 연결
  const streams = new Map(); // `${conn.id}:${ch}` → { sock, ch, terminal, conn }
  const socks = new Set();
  let n = 0, seq = 0, connN = 0;
  const calls = [];
  const fake = { pipe, terms, calls, streams, version, pid: 4242, restarts: 0 };

  const line = (sock, o) => { if (!sock.destroyed) sock.write(JSON.stringify(o) + '\n'); };
  const emit = (type, terminal, data) => { seq++; for (const s of subs) line(s, { jsonrpc: '2.0', method: 'event', params: { seq, type, terminal, data } }); };
  const err = (kind, message) => ({ code: -32000, message, data: { kind, hint: '' } });
  const live = (t) => t.state === 'live';
  const rec = (t) => ({ ...t, sent: undefined, inputs: undefined, inputKinds: undefined, keys: undefined, env: undefined });
  const streamsOf = (addr) => [...streams.values()].filter((s) => s.terminal === addr);

  fake.setStatus = (addr, status) => { const t = terms.get(addr); t.status = status; t.reported = true; emit('status', addr, { status, records: {}, reported: true }); if (status && ['blocked', 'done'].includes(status.state)) { t.turn++; emit('turn', addr, { turn: t.turn, state: status.state }); } };
  fake.output = (addr, text) => { for (const s of streamsOf(addr)) s.sock.write(encodeFrame(s.ch, FRAME.DATA, Buffer.from(text))); };
  fake.finish = (addr, reason = 'exited', exit_code = 0) => {
    const t = terms.get(addr);
    if (t.status) { t.status = null; emit('status', addr, { status: null, records: {}, reported: true }); }
    t.state = 'finished'; t.reason = reason; t.exit_code = exit_code; t.foreground = null;
    emit('finished', addr, { reason, exit_code, signal: null, finished_ms: Date.now() });
    for (const s of streamsOf(addr)) { s.sock.write(encodeFrame(s.ch, FRAME.CLOSE, Buffer.from(JSON.stringify({ reason, exit_code, signal: null })))); streams.delete(s.key); }
  };
  fake.size = (addr, cols, rows) => { const t = terms.get(addr); t.cols = cols; t.rows = rows; emit('size', addr, { cols, rows }); };
  fake.dropAll = () => { fake.restarts++; for (const s of socks) s.destroy(); subs.clear(); streams.clear(); };
  fake.create = (o = {}) => run(o);

  function run(p) {
    if (p.name && [...terms.values()].some((x) => live(x) && x.name === p.name)) return { error: err('name_taken', `a live terminal is already named "${p.name}"`) };
    const address = `t${(++n).toString(36)}`;
    const argv = p.argv && p.argv.length ? p.argv : ['pwsh.exe'];
    const t = { address, name: p.name || null, argv, cwd: p.cwd || 'C:/x', labels: p.labels || {}, parent: p.parent || null, pid: 1000 + n, state: 'live', status: null, reported: false, reason: null, exit_code: null, cols: 200, rows: 120, title: '', turn: 0, keep: !!p.keep, foreground: { pid: 1000 + n, name: argv[0], argv, cwd: p.cwd || 'C:/x' }, env: p.env || {}, sent: [], inputs: [], inputKinds: [], keys: [], screen: `PS ${p.cwd || 'C:/x'}> ` };
    terms.set(address, t);
    emit('created', address, rec(t));
    const app = APP[String(argv[0]).replace(/\.exe$/i, '')];
    // P117: fake.silent(t)가 참이면 7501을 말하지 않는다(신뢰 대화상자 중인 claude). fake.screenOf(t)로 화면 글을 정한다
    if (fake.screenOf) t.screen = fake.screenOf(t) ?? t.screen;
    if (app && !(fake.silent && fake.silent(t))) setTimeout(() => { if (live(t)) fake.setStatus(address, { app, state: 'idle' }); }, 20);
    return { result: rec(t) };
  }
  const find = (target) => [...terms.values()].find((t) => live(t) && (t.address === target || t.name === target)) || terms.get(target);

  function handle(method, p, conn) {
    calls.push({ method, params: p });
    switch (method) {
      case 'hello': return { result: { core: { id: 'fake', name: 'fake' }, features, framed: !!p.framed, generation, methods: [], version } };
      case 'server.status': return { result: { pid: fake.pid, version, live: [...terms.values()].filter(live).length, holders: [{ pid: 4343, terminals: 1, current: true }] } };
      case 'terminal.list': return { result: { terminals: [...terms.values()].filter((t) => p.all || live(t)).map(rec), hidden_finished: 0 } };
      case 'terminal.get': { const t = find(p.terminal); return t ? { result: rec(t) } : { error: err('not_found', `no terminal ${p.terminal}`) }; }
      case 'terminal.run': return run(p);
      case 'terminal.kill': { const t = find(p.terminal); if (!t) return { error: err('not_found', 'no terminal') }; if (live(t)) fake.finish(t.address, 'killed', 1); return { result: rec(t) }; }
      case 'terminal.rm': { const t = terms.get(p.terminal); if (!t) return { error: err('not_found', 'no terminal') }; terms.delete(t.address); emit('removed', t.address, {}); return { result: {} }; }
      case 'terminal.label': { const t = find(p.terminal); for (const [k, v] of Object.entries(p.labels || {})) { if (v === '') delete t.labels[k]; else t.labels[k] = v; } emit('labels', t.address, { labels: t.labels }); return { result: rec(t) }; }
      case 'terminal.send': { const t = find(p.terminal); if (!t) return { error: err('not_found', 'no terminal') }; if (t.status && t.status.state === 'blocked' && !p.force) return { error: err('blocked', `${t.address} is blocked (permission)`) }; t.sent.push(p.text); return { result: { started: true, status: t.status ? t.status.state : null, turn: t.turn } }; }
      case 'terminal.keys': { const t = find(p.terminal); t.keys.push(...p.keys); return { result: { status: t.status ? t.status.state : null, turn: t.turn } }; }
      case 'terminal.read': { const t = find(p.terminal); return { result: { complete: true, how: 'screen', text: t.screen } }; }
      case 'server.restart': setTimeout(() => fake.dropAll(), 20); return { result: { stopped: true } };
      case 'server.stop': for (const t of terms.values()) if (live(t)) fake.finish(t.address, 'server_stop', null); setTimeout(() => fake.dropAll(), 20); return { result: { stopped: true } };
      case 'terminal.attach': {
        const t = find(p.terminal);
        if (!t || !live(t)) return { error: err('not_found', 'no live terminal') };
        const ch = ++conn.nextCh;
        const key = `${conn.id}:${ch}`;
        streams.set(key, { key, sock: conn.sock, ch, terminal: t.address, conn, credit: 0 });
        if (!p.observe && !p.resumed) { t.cols = p.cols; t.rows = p.rows; }
        // 응답과 첫 화면을 한 번에 쓴다(클라이언트의 첫 프레임 모으기 시험)
        return { result: { channel: ch, automatic_input: fake.automaticInput !== false, resize_notifications: false, terminal: rec(t) }, after: encodeFrame(ch, FRAME.DATA, Buffer.from(FIRST_PAINT)) };
      }
      default: return { error: err('usage', `unknown method ${method}`) };
    }
  }

  const server = net.createServer((sock) => {
    socks.add(sock);
    const conn = { id: ++connN, sock, framed: false, nextCh: 0, credits: 0 };
    let buf = Buffer.alloc(0);
    const dec = new FrameDecoder();
    sock.on('close', () => { socks.delete(sock); subs.delete(sock); for (const [k, s] of streams) if (s.sock === sock) streams.delete(k); });
    sock.on('error', () => {});
    sock.on('data', (d) => {
      if (conn.framed) return frames(d);
      buf = Buffer.concat([buf, d]);
      let i;
      while (!conn.framed && (i = buf.indexOf(0x0a)) >= 0) {
        const m = JSON.parse(buf.subarray(0, i).toString('utf8'));
        buf = buf.subarray(i + 1);
        if (m.method === 'events.subscribe') { subs.add(sock); line(sock, { jsonrpc: '2.0', id: m.id, result: { seq, terminals: [...terms.values()].filter(live).map(rec) } }); continue; }
        const r = handle(m.method, m.params || {}, conn);
        line(sock, { jsonrpc: '2.0', id: m.id, ...(r.error ? { error: r.error } : { result: r.result }) });
        if (m.method === 'hello' && m.params && m.params.framed) { conn.framed = true; if (buf.length) frames(buf); buf = Buffer.alloc(0); }
      }
    });
    function frames(d) {
      for (const f of dec.push(d)) {
        if (f.ch === 0 && f.kind === FRAME.DATA) {
          const m = JSON.parse(f.payload.toString('utf8'));
          const r = handle(m.method, m.params || {}, conn);
          const reply = encodeFrame(0, FRAME.DATA, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: m.id, ...(r.error ? { error: r.error } : { result: r.result }) })));
          sock.write(r.after ? Buffer.concat([reply, r.after]) : reply);
          continue;
        }
        const s = streams.get(`${conn.id}:${f.ch}`);
        if (!s) continue;
        const t = terms.get(s.terminal);
        // P130: 사람 입력(DATA)과 판 입력(AUTOMATIC_INPUT, kind 6)을 함께 inputs에 두고 종류는 inputKinds에('data'|'auto')
        if (f.kind === FRAME.DATA || f.kind === FRAME.AUTOMATIC_INPUT) { t.inputs.push(f.payload.toString('utf8')); t.inputKinds.push(f.kind === FRAME.DATA ? 'data' : 'auto'); }
        else if (f.kind === FRAME.CREDIT) s.credit += f.payload.readUInt32LE(0);
        else if (f.kind === FRAME.RESIZE) { t.cols = f.payload.readUInt16LE(0); t.rows = f.payload.readUInt16LE(2); emit('size', t.address, { cols: t.cols, rows: t.rows }); }
        else if (f.kind === FRAME.FOCUS) t.focus = f.payload[0];
        else if (f.kind === FRAME.CLOSE) { streams.delete(s.key); sock.write(encodeFrame(f.ch, FRAME.CLOSE)); }
      }
    }
  });
  await new Promise((res) => server.listen(pipe, res));
  fake.close = () => new Promise((res) => { for (const s of socks) s.destroy(); server.close(() => res()); });
  fake.streamsOf = streamsOf;
  return fake;
}
