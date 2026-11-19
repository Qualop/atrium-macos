// P123: herdr-core(hc) 판의 업데이트 확인. 업데이터가 지금 도는 터미널 서버의 프로토콜을 새 버전의 herdr 프로토콜에서만 찾아,
// hc 판(세대 1)은 "herdr 프로토콜 1을 받지 않음(22)"으로 업데이트하지 못했다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as U from '../src/update.mjs';
import { Updater } from '../src/updater.mjs';
import { HERDR_PROTOCOLS } from '../src/herdr-migrate/index.mjs'; // P129: 옛 업데이터가 herdr 판에서 올라오게 내는 값
import { HC_PIN } from '../src/hc/pin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// macOS 판: 업데이트는 원본의 소스 트리 교체(versions/current.json, 소스 update-verify 출력)가 아니라 Qualop/atrium-macos 완성 번들 교체다(BRIEF 앱 업데이트).
// 그 업데이터가 없는 판에서는 이 파일을 건너뛴다. hc 세대 1 판의 업데이트 허용(P123)은 macos-update.test.mjs의 번들 검사가 본다
const SKIP = typeof U.electronExe === 'function' ? false : 'macOS 판은 번들 업데이터(macos-update.test.mjs)';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `mtask-p123-${p}-`));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const ready = (d) => { write(path.join(d, 'app', 'dist', 'index.html'), ''); write(U.electronExe(d), ''); write(path.join(d, 'backend', 'node_modules', 'ws', 'index.js'), ''); };
const verifyOut = (d, o) => write(path.join(d, 'backend', 'src', 'update-verify.mjs'), `console.log(JSON.stringify(${JSON.stringify(o)}));\n`);

test('미리 보기 출력: herdr 프로토콜과 hc 세대를 따로 내고, 옛 업데이터를 위해 protocols에 둘 다 둔다', { skip: SKIP }, () => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(HERE, '..', 'src', 'update-verify.mjs')], { cwd: path.join(HERE, '..'), encoding: 'utf8', timeout: 60000 });
  const info = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  assert.deepEqual(info.problems, []);
  assert.deepEqual(info.herdrProtocols, HERDR_PROTOCOLS);
  assert.deepEqual(info.hcGenerations, [HC_PIN.generation]);
  // 0.1.6까지의 업데이터 판정(`info.protocols.includes(protocol)`)이 herdr 판(22)과 hc 판(1) 둘 다 통과한다
  for (const p of [...HERDR_PROTOCOLS, HC_PIN.generation]) assert.ok(info.protocols.includes(p), `protocols에 ${p}`);
});

test('verifyRoot(P129): 판의 터미널은 hc 하나라 프로토콜은 hc 세대에서 찾는다', { skip: SKIP }, async () => {
  const d = tmp('verify');
  try {
    ready(d);
    verifyOut(d, { version: '0.1.7', protocols: [22, 1], herdrProtocols: [22], hcGenerations: [1], problems: [] });
    assert.equal((await U.verifyRoot(d, { protocol: 1 })).ok, true);
    // herdr 프로토콜(22)은 hc 세대와 섞지 않는다
    let v = await U.verifyRoot(d, { protocol: 22 });
    assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /herdr-core 세대 22/.test(p)));
    v = await U.verifyRoot(d, { protocol: 2 });
    assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /herdr-core 세대 2/.test(p)));
    // hc를 모르는 옛 버전(세대 목록 없음)으로는 판을 바꾸지 않는다
    verifyOut(d, { version: '0.1.5', protocols: [22], problems: [] });
    v = await U.verifyRoot(d, { protocol: 1 });
    assert.equal(v.ok, false); assert.ok(v.problems.some((p) => /herdr-core를 모르는/.test(p)));
    // 프로토콜을 모르면(터미널 서버가 붙지 않음) 세대를 보지 않는다
    assert.equal((await U.verifyRoot(d, { protocol: null })).ok, true);
  } finally { rm(d); }
});

test('업데이터: 준비에 hc 세대(protocol)를 넘긴다', { skip: SKIP }, async () => {
  const d = tmp('up');
  const inst = path.join(d, 'versions');
  const codeRoot = path.join(inst, 'v0.1.6');
  write(path.join(codeRoot, 'backend', 'package.json'), JSON.stringify({ version: '0.1.6' }));
  write(path.join(codeRoot, 'app', 'package.json'), JSON.stringify({ version: '0.1.6' }));
  write(path.join(inst, 'current.json'), JSON.stringify({ current: 'v0.1.6' }));
  const meta = new Map();
  const b = {
    cfg: { profile: 'real', logDir: path.join(d, 'logs') }, termCompat: { ok: true, protocol: 1 }, adapter: { backend: 'hc' }, features: null,
    store: { getMeta: (k) => (meta.has(k) ? JSON.parse(JSON.stringify(meta.get(k))) : null), setMeta: (k, v) => meta.set(k, JSON.parse(JSON.stringify(v))), addEvent() {} },
    api: { broadcast() {} }, stop: async () => {},
  };
  const prepared = [];
  try {
    const up = new Updater(b, {
      env: { ATRIUM_INSTALL_DIR: inst }, codeRoot, timers: false, leaveWaitMs: 50,
      fetchJson: async () => ({ tag_name: 'v0.1.7', prerelease: false, draft: false, tarball_url: 'https://api.github.com/repos/Gudals0320/atrium/tarball/v0.1.7', html_url: 'https://github.com/Gudals0320/atrium/releases/tag/v0.1.7', published_at: new Date().toISOString(), body: '' }),
      prepare: async ({ release: rel, protocol }) => { prepared.push({ tag: rel.tag, protocol }); throw new Error('stop here'); },
      spawnSwap: () => {}, exit: () => {},
    });
    await up.check('timer');
    await up.handlers['update.apply']({ confirm: true }, { auth: { kind: 'local' } });
    const end = Date.now() + 3000; while (!prepared.length && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(prepared, [{ tag: 'v0.1.7', protocol: 1 }]);
  } finally { rm(d); }
});
