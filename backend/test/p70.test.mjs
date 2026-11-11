// P70 단위 시험(백엔드): 업데이트 dev 채널. 릴리즈 목록 읽기(dev는 사전 릴리즈 포함, 초안·버전 꼴이 아닌 태그 제외, 정식은 사전 릴리즈를 보지 않음),
// 목록 주소 만들기, 채널을 바꾸면 다시 확인(앞 채널의 결과로 알리지 않음), dev에서 정식으로 돌리면 낮은 버전을 알리지 않음, 한 번만 다른 채널, release-check의 dev 태그 검사
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as U from '../src/update.mjs';
import { Updater } from '../src/updater.mjs';
import { SETTINGS, normalizePatch } from '../src/settings.mjs';
import { checkRelease, checkDevRelease, isDevTag } from '../../scripts/release-check.mjs';
import { channelFlag } from '../bin/atrium-update.mjs';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `mtask-p70-${p}-`));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const pkg = (v) => JSON.stringify({ name: 'x', version: v });
const REPO = 'https://api.github.com/repos/Qualop/atrium-macos';
const rel = (tag, extra = {}) => ({ tag_name: tag, name: tag, draft: false, prerelease: /-/.test(tag), html_url: `https://github.com/Qualop/atrium-macos/releases/tag/${tag}`, tarball_url: `${REPO}/tarball/${tag}`, ...extra });

test('판 설정 updateChannel: stable·dev, 기본 stable', () => {
  assert.equal(SETTINGS.updateChannel.default, 'stable');
  assert.deepEqual(SETTINGS.updateChannel.options, ['stable', 'dev']);
  assert.deepEqual(normalizePatch({ updateChannel: 'dev' }), { updateChannel: 'dev' });
  assert.throws(() => normalizePatch({ updateChannel: 'beta' }), (e) => e.code === 'bad_request');
  assert.deepEqual(U.CHANNELS, ['stable', 'dev']);
  assert.equal(U.channelOf('dev'), 'dev'); assert.equal(U.channelOf('x'), 'stable'); assert.equal(U.channelOf(undefined), 'stable');
});

test('목록 읽기: dev는 사전 릴리즈를 포함해 가장 높은 것, 초안과 버전 꼴이 아닌 태그는 뺀다. 정식은 사전 릴리즈를 보지 않는다', () => {
  const list = [
    rel('v0.1.1'),
    rel('v0.1.2-dev.1'),
    rel('v0.1.2-dev.10'),
    rel('v0.1.2-dev.2'),
    rel('v0.9.0', { draft: true }), // 초안
    rel('nightly', { prerelease: true }), // 버전 꼴이 아님
    rel('v0.1.0'),
  ];
  const dev = U.pickRelease(list, 'dev');
  assert.equal(dev.tag, 'v0.1.2-dev.10'); assert.equal(dev.prerelease, true); assert.equal(dev.version, '0.1.2-dev.10');
  const stable = U.pickRelease(list, 'stable');
  assert.equal(stable.tag, 'v0.1.1'); assert.equal(stable.prerelease, false);
  // 정식이 dev 빌드보다 높으면 dev도 정식을 고른다
  assert.equal(U.pickRelease([...list, rel('v0.1.2')], 'dev').tag, 'v0.1.2');
  // 정식 채널은 사전 릴리즈만 있으면 없다
  assert.equal(U.pickRelease([rel('v0.2.0-dev.1')], 'stable'), null);
  assert.equal(U.pickRelease([], 'dev'), null);
  assert.equal(U.pickRelease(null, 'dev'), null);
  assert.equal(U.pickRelease({ message: 'rate limited' }, 'dev'), null);
  // 한 항목 읽기는 그대로 정식만(P69), 켜면 사전 릴리즈도
  assert.equal(U.parseRelease(rel('v0.1.2-dev.1')), null);
  assert.equal(U.parseRelease(rel('v0.1.2-dev.1'), { prerelease: true }).tag, 'v0.1.2-dev.1');
  assert.equal(U.parseRelease(rel('v0.1.2-dev.1', { draft: true }), { prerelease: true }), null);
});

test('목록 주소 만들기: releases/latest → releases?per_page=100, 가짜 서버도', () => {
  assert.equal(U.releasesListUrl(), `${REPO}/releases?per_page=100`);
  assert.equal(U.releasesListUrl(U.DEFAULT_UPDATE_API), `${REPO}/releases?per_page=100`);
  assert.equal(U.releasesListUrl('http://127.0.0.1:47897/repos/Qualop/atrium-macos/releases/latest'), 'http://127.0.0.1:47897/repos/Qualop/atrium-macos/releases?per_page=100');
  assert.equal(U.releasesListUrl('http://127.0.0.1:47897/releases/latest/'), 'http://127.0.0.1:47897/releases?per_page=100');
  assert.equal(U.releasesListUrl('http://127.0.0.1:47897/somewhere'), null);
  assert.equal(U.releasesListUrl('not a url'), null);
  // 받기 주소 검사는 그대로(가짜 서버 출처)
  assert.ok(U.checkDownloadUrl('http://127.0.0.1:47897/tarball/v0.1.2-dev.1', 'http://127.0.0.1:47897/releases/latest').ok);
});

test('fetchLatest: stable은 releases/latest, dev는 목록 주소를 읽는다', async () => {
  const asked = [];
  const fetchJson = async (u) => { asked.push(u); return u.endsWith('/latest') ? rel('v0.1.1') : [rel('v0.1.1'), rel('v0.1.2-dev.1')]; };
  assert.equal((await U.fetchLatest(fetchJson, U.DEFAULT_UPDATE_API, 'stable')).tag, 'v0.1.1');
  assert.equal((await U.fetchLatest(fetchJson, U.DEFAULT_UPDATE_API, 'dev')).tag, 'v0.1.2-dev.1');
  assert.deepEqual(asked, [U.DEFAULT_UPDATE_API, `${REPO}/releases?per_page=100`]);
  await assert.rejects(U.fetchLatest(fetchJson, 'http://127.0.0.1:1/x', 'dev'), { code: 'bad_api_url' });
});

// 가짜 판: 판 설정(features.settings)과 판 기록
function fakeBoard(d, settings = {}) {
  const meta = new Map(), events = [];
  const s = { updateCheck: true, updateChannel: 'stable', ...settings };
  const b = {
    cfg: { profile: 'real', logDir: path.join(d, 'logs') }, herdrCompat: { ok: true, protocol: 22 },
    features: { settings: { get: () => ({ ...s }) } },
    store: { getMeta: (k) => (meta.has(k) ? JSON.parse(JSON.stringify(meta.get(k))) : null), setMeta: (k, v) => meta.set(k, JSON.parse(JSON.stringify(v))), addEvent() {} },
    api: { broadcast: (e, x) => events.push([e, x]) },
    stop: async () => {},
  };
  return { b, meta, events, s };
}
// 가짜 GitHub: releases/latest는 정식 중 가장 높은 것, 목록은 모두
function fakeGithub(tags) {
  const asked = [];
  const fetchJson = async (u) => {
    asked.push(u);
    const list = tags.map((t) => rel(t));
    if (u.endsWith('/releases/latest')) { const r = U.pickRelease(list, 'stable'); if (!r) throw Object.assign(new Error('릴리즈가 없습니다'), { code: 'no_release' }); return list.find((x) => x.tag_name === r.tag); }
    return list;
  };
  return { fetchJson, asked };
}
function installed(d, tag) {
  const inst = path.join(d, 'versions');
  const codeRoot = path.join(inst, tag);
  write(path.join(codeRoot, 'app', 'package.json'), pkg(tag.slice(1)));
  return { inst, codeRoot };
}

test('채널을 바꾸면 결과를 다시 확인한다. 앞 채널의 결과로 알리지 않는다', async () => {
  const d = tmp('channel');
  try {
    const { inst, codeRoot } = installed(d, 'v0.1.1');
    const { b, meta, events, s } = fakeBoard(d);
    const gh = fakeGithub(['v0.1.1', 'v0.1.2-dev.1']);
    const up = new Updater(b, { env: { ATRIUM_INSTALL_DIR: inst }, codeRoot, timers: false, fetchJson: gh.fetchJson });
    // 정식: 알림 없음
    let v = await up.check('start');
    assert.equal(v.channel, 'stable'); assert.equal(v.available, false); assert.equal(v.latest.tag, 'v0.1.1');
    assert.equal(meta.get('update').channel, 'stable');
    assert.equal(v.current.prerelease, false);
    // dev로 바꾼다: 곧바로 앞 채널의 결과를 감추고(아직 확인하지 않은 것으로) 다시 확인한다
    s.updateChannel = 'dev';
    assert.equal(up.view().latest, null); assert.equal(up.view().available, false); assert.equal(up.view().checkedAt, null);
    events.length = 0;
    await up.channelChanged();
    v = up.view();
    assert.equal(v.channel, 'dev'); assert.equal(v.available, true); assert.equal(v.latest.tag, 'v0.1.2-dev.1'); assert.equal(v.latest.prerelease, true);
    assert.ok(gh.asked.at(-1).endsWith('/releases?per_page=100'));
    assert.equal(events[0][0], 'update.state'); assert.equal(events[0][1].latest, null); // 바꾼 직후 알린 상태에는 앞 채널의 결과가 없다
    assert.ok(events.some(([e, x]) => e === 'update.state' && x.available && x.latest.tag === 'v0.1.2-dev.1'));
    // 확인을 묻는 글에 채널이 보인다
    await assert.rejects(up.apply({}, { auth: { kind: 'local' } }), (e) => e.code === 'source_install');
    // 정식으로 되돌리면 dev 결과(v0.1.2-dev.1)로 알리지 않는다
    s.updateChannel = 'stable';
    assert.equal(up.view().available, false); assert.equal(up.view().latest, null);
    await up.channelChanged();
    assert.equal(up.view().available, false); assert.equal(up.view().latest.tag, 'v0.1.1');
    await assert.rejects(up.apply({ confirm: true }, { auth: { kind: 'local' } }), (e) => e.code === 'source_install');
    // Pre-migration cache without repository identity is never offered for install.
    meta.set('update', { checkedAt: 1, latest: U.parseRelease(rel('v0.2.0')), error: null });
    assert.equal(up.view().available, false);
    s.updateChannel = 'dev';
    assert.equal(up.view().available, false);
  } finally { rm(d); }
});

test('확인 중에 채널을 바꾸면 앞 채널의 결과를 버리고 새 채널로 다시 확인한다', async () => {
  const d = tmp('race');
  try {
    const { inst, codeRoot } = installed(d, 'v0.1.1');
    const { b, meta, s } = fakeBoard(d);
    let release;
    const gate = new Promise((r) => { release = r; });
    const gh = fakeGithub(['v0.1.1', 'v0.1.2', 'v0.1.3-dev.1']);
    let waiting = 0;
    const fetchJson = async (u) => { if (u.endsWith('/latest')) { waiting++; await gate; } return gh.fetchJson(u); };
    const up = new Updater(b, { env: { ATRIUM_INSTALL_DIR: inst }, codeRoot, timers: false, fetchJson });
    const first = up.check('start'); // 정식, 기다린다
    await new Promise((r) => setImmediate(r));
    assert.equal(waiting, 1); // 정식 확인이 releases/latest에서 기다리는 중
    s.updateChannel = 'dev';
    const second = up.channelChanged();
    release();
    await first; await second;
    assert.equal(meta.get('update').channel, 'dev');
    assert.equal(gh.asked.length, 2); assert.ok(gh.asked[1].endsWith('/releases?per_page=100'));
    assert.equal(up.view().latest.tag, 'v0.1.3-dev.1'); assert.equal(up.view().available, true);
    // 같은 채널의 확인은 하나로 묶는다
    const n = gh.asked.length;
    await Promise.all([up.check('a'), up.check('b')]);
    assert.equal(gh.asked.length, n + 1);
  } finally { rm(d); }
});

test('dev에서 정식으로 돌리면 낮은 버전을 알리지 않고, 더 높은 정식이 나오면 알린다', async () => {
  const d = tmp('devstable');
  try {
    const { inst, codeRoot } = installed(d, 'v0.1.2-dev.2');
    const { b, s } = fakeBoard(d, { updateChannel: 'stable' });
    const tags = ['v0.1.1', 'v0.1.2-dev.1', 'v0.1.2-dev.2'];
    const gh = fakeGithub(tags);
    const up = new Updater(b, { env: { ATRIUM_INSTALL_DIR: inst }, codeRoot, timers: false, fetchJson: gh.fetchJson });
    assert.equal(up.view().current.prerelease, true);
    let v = await up.check('start');
    assert.equal(v.latest.tag, 'v0.1.1'); assert.equal(v.available, false); // v0.1.1 < v0.1.2-dev.2
    tags.push('v0.1.2');
    v = await up.check('timer');
    assert.equal(v.latest.tag, 'v0.1.2'); assert.equal(v.available, true);
    // dev 채널도 같은 정식(v0.1.2)을 알린다(dev 빌드보다 높다)
    s.updateChannel = 'dev';
    await up.channelChanged();
    assert.equal(up.view().latest.tag, 'v0.1.2'); assert.equal(up.view().available, true);
    // P71: 손으로 하는 되돌리기는 뺐다
    assert.equal('canRollback' in up.view(), false); assert.equal('previous' in up.view(), false);
  } finally { rm(d); }
});

test('한 번만 다른 채널(atrium update --channel): 판 기록과 판 설정은 그대로', async () => {
  const d = tmp('once');
  try {
    const { inst, codeRoot } = installed(d, 'v0.1.1');
    const { b, meta, s } = fakeBoard(d);
    const gh = fakeGithub(['v0.1.1', 'v0.1.2-dev.1']);
    const swaps = [];
    const up = new Updater(b, { env: { ATRIUM_INSTALL_DIR: inst }, codeRoot, timers: false, leaveWaitMs: 10, fetchJson: gh.fetchJson, prepare: async ({ release: r }) => { const root = path.join(inst, r.tag); fs.mkdirSync(root, { recursive: true }); return { root }; }, spawnSwap: (f, job) => swaps.push(job), exit: () => {} });
    await up.check('start');
    const v = await up.handlers['update.check']({ channel: 'dev' });
    assert.equal(v.once, true); assert.equal(v.channel, 'dev'); assert.equal(v.available, true); assert.equal(v.latest.tag, 'v0.1.2-dev.1');
    assert.equal(meta.get('update').channel, 'stable'); assert.equal(s.updateChannel, 'stable');
    assert.equal(up.view().available, false);
    // 같은 채널을 주면 보통 확인
    assert.equal((await up.handlers['update.check']({ channel: 'stable' })).once, undefined);
    // This source installation checks an alternate channel without changing
    // board preferences, but never executes the former source updater.
    await assert.rejects(up.apply({ channel: 'dev', confirm: true }, { auth: { kind: 'local' } }), (e) => e.code === 'source_install');
    assert.equal(swaps.length, 0); assert.equal(s.updateChannel, 'stable');

  } finally { rm(d); }
});

test('CLI --channel 값 검사', () => {
  assert.equal(channelFlag({}), null);
  assert.equal(channelFlag({ channel: 'dev' }), 'dev');
  assert.equal(channelFlag({ channel: 'stable' }), 'stable');
  assert.throws(() => channelFlag({ channel: 'beta' }), /--channel/);
  assert.throws(() => channelFlag({ channel: true }), /--channel/); // 값 없이
});

test('release-check: dev 태그 검사(통과와 실패), 정식 태그 검사는 그대로', () => {
  const main = 'a'.repeat(40), dev = 'b'.repeat(40);
  const ok = { tag: 'v0.1.2-dev.1', main, dev, tagCommit: null, appVersion: '0.1.2-dev.1', backendVersion: '0.1.2-dev.1', stableVersion: '0.1.1', mainIsAncestor: true };
  assert.ok(isDevTag('v0.1.2-dev.1')); assert.ok(!isDevTag('v0.1.2')); assert.ok(!isDevTag('v0.1.2-rc.1')); assert.ok(!isDevTag('0.1.2-dev.1'));
  assert.deepEqual(checkDevRelease(ok), []);
  assert.deepEqual(checkDevRelease({ ...ok, tagCommit: dev }), []);
  assert.deepEqual(checkDevRelease({ ...ok, dev: main, tagCommit: main }), []); // main = dev여도 된다
  assert.match(checkDevRelease({ ...ok, mainIsAncestor: false }).join(), /조상이 아닙니다/);
  assert.match(checkDevRelease({ ...ok, tagCommit: main }).join(), /dev가 아닌 커밋/);
  assert.match(checkDevRelease({ ...ok, appVersion: '0.1.1' }).join(), /app\/package\.json/);
  assert.match(checkDevRelease({ ...ok, backendVersion: '0.1.2-dev.2' }).join(), /backend\/package\.json/);
  assert.match(checkDevRelease({ ...ok, stableVersion: '0.1.2' }).join(), /높지 않습니다/); // 0.1.2-dev.1 < 0.1.2
  assert.match(checkDevRelease({ ...ok, tag: 'v0.1.0-dev.1', appVersion: '0.1.0-dev.1', backendVersion: '0.1.0-dev.1' }).join(), /높지 않습니다/);
  assert.match(checkDevRelease({ ...ok, stableVersion: null }).join(), /main의 version/);
  assert.match(checkDevRelease({ ...ok, dev: null }).join(), /dev 브랜치가 없습니다/);
  assert.match(checkDevRelease({ ...ok, tag: 'v0.1.2-rc.1' }).join(), /-dev\.<n> 꼴/);
  // 정식 태그는 dev 꼴을 받지 않고(main = dev 검사를 건너뛰지 않게), 검사는 P69 그대로
  const st = { tag: 'v0.1.2', main, dev: main, tagCommit: null, appVersion: '0.1.2', backendVersion: '0.1.2' };
  assert.deepEqual(checkRelease(st), []);
  assert.match(checkRelease({ ...st, dev }).join(), /fast-forward/);
  assert.match(checkRelease({ ...st, tag: 'v0.1.2-dev.1', appVersion: '0.1.2-dev.1', backendVersion: '0.1.2-dev.1' }).join(), /꼴이어야/);
});
