// P33 창 단위 시험: 호출자 보이기(lib/launchers.js). 레일 아이콘, 즐겨찾기 순서와 옮기기, 미리보기·풍선 글(환경 변수 값은 보이지 않음),
// 비밀값처럼 보이는 이름, 하네스 칸, 두 언어 사전의 글, 백엔드 오류 열쇠(launchers.err.*)가 사전에 다 있는지
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ICONS, launcherIcon, launcherMark, favoriteLaunchers, orderedLaunchers, moveFavorite, previewLine, launcherTooltip, envToText, secretNames, harnessFields, harnessModels, blankLauncher } from '../src/renderer/lib/launchers.js';
import { KINDS } from '../src/renderer/lib/kinds.js';
import { errText, setLanguage } from '../src/renderer/lib/i18n.js';
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const data = {
  launchers: [
    { id: 'claude', name: 'Claude Code', harness: 'claude', icon: '', preview: { line: 'claude --permission-mode manual', env: [] } },
    { id: 'codex', name: 'Codex', harness: 'codex', icon: '', preview: { line: 'codex', env: [] } },
    { id: 'shell', name: 'Shell', harness: 'shell', icon: '', preview: { line: '', shell: true, env: [] } },
    { id: 'deepseek', name: 'DeepSeek', harness: 'claude', icon: 'deepseek', preview: { line: 'claude --model ds', env: ['ANTHROPIC_BASE_URL'] } },
    { id: 'l1', name: 'echo it', harness: 'command', icon: '', preview: { line: 'echo hi', typed: true, env: [] } },
  ],
  favorites: ['codex', 'claude', 'l1'],
  harnesses: [{ id: 'claude', fields: ['model', 'effort', 'permissionMode', 'allowHerdr', 'args', 'env', 'checkUrl'], models: ['haiku'] }, { id: 'codex', fields: ['model', 'args'], models: ['gpt-6-astra'] }, { id: 'shell', fields: [] }, { id: 'command', fields: ['command', 'env'] }],
};

test('P33 레일 아이콘: 고른 아이콘, 하네스 로고, 셸, 직접 명령은 머리글자', () => {
  const by = Object.fromEntries(data.launchers.map((l) => [l.id, l]));
  assert.equal(launcherIcon(by.claude), 'claude');
  assert.equal(launcherIcon(by.deepseek), 'deepseek');
  assert.equal(launcherIcon(by.shell), 'shell');
  assert.equal(launcherIcon(by.l1), null);
  assert.equal(launcherIcon({ harness: 'pi' }), 'pi');
  assert.equal(launcherMark(by.l1), 'E');
  assert.equal(launcherMark({ name: '' }), '?');
  for (const k of ICONS) assert.ok(KINDS[k], `${k}는 kinds.js에 그림이 있다`);
});

test('P33 즐겨찾기: 레일 순서, 설정 목록 순서(즐겨찾기 먼저), 한 칸 옮기기', () => {
  assert.deepEqual(favoriteLaunchers(data).map((l) => l.id), ['codex', 'claude', 'l1']);
  assert.deepEqual(favoriteLaunchers({ ...data, favorites: ['gone', 'shell'] }).map((l) => l.id), ['shell'], '없는 ID는 건너뛴다');
  assert.deepEqual(orderedLaunchers(data).map((l) => l.id), ['codex', 'claude', 'l1', 'shell', 'deepseek']);
  assert.deepEqual(moveFavorite(data.favorites, 'claude', -1), ['claude', 'codex', 'l1']);
  assert.deepEqual(moveFavorite(data.favorites, 'claude', 1), ['codex', 'l1', 'claude']);
  assert.equal(moveFavorite(data.favorites, 'codex', -1), null);
  assert.equal(moveFavorite(data.favorites, 'shell', 1), null);
  assert.deepEqual(favoriteLaunchers(null), []);
});

test('P33 미리보기와 풍선 글: 이름과 명령, 환경 변수는 이름만', () => {
  const by = Object.fromEntries(data.launchers.map((l) => [l.id, l]));
  assert.equal(previewLine(by.shell.preview, '셸'), '셸');
  assert.equal(launcherTooltip(by.deepseek, { envText: 'env' }), 'DeepSeek\nclaude --model ds\nenv: ANTHROPIC_BASE_URL');
  assert.equal(launcherTooltip(by.l1), 'echo it\necho hi');
  assert.equal(envToText({ A: '1', B: 'x=y' }), 'A=1\nB=x=y');
  assert.deepEqual(secretNames('ANTHROPIC_BASE_URL=http://x\nOPENAI_API_KEY=sk\nMY_TOKEN=1\n=bad'), ['OPENAI_API_KEY', 'MY_TOKEN']);
  assert.deepEqual(secretNames(''), []);
});

test('P33 하네스 칸: 정의에 있는 하네스는 그 칸, 모르는 종류는 추가 인자만', () => {
  assert.ok(harnessFields(data.harnesses, 'claude').includes('env'));
  assert.deepEqual(harnessFields(data.harnesses, 'pi'), ['args']);
  assert.deepEqual(harnessModels(data.harnesses, 'codex'), ['gpt-6-astra']);
  assert.deepEqual(harnessModels(data.harnesses, 'pi'), []);
  assert.equal(blankLauncher('command').harness, 'command');
});

test('P33 화면 글: 두 언어 사전에 호출자 절이 같은 열쇠로 있고, 백엔드 오류 열쇠가 다 있다', () => {
  const leaves = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(leaves(ko.launchers).sort(), leaves(en.launchers).sort());
  const src = fs.readFileSync(new URL('../../backend/src/launchers.mjs', import.meta.url), 'utf8');
  const keys = new Set([...src.matchAll(/err\('[a-z_]+', [^;]*?, '([A-Za-z]+)'/g)].map((m) => m[1]));
  for (const k of ['commandLong', 'commandLine']) keys.add(k);
  assert.ok(keys.size >= 15, `열쇠 ${keys.size}개`);
  for (const k of keys) assert.ok(en.launchers.err[k] && ko.launchers.err[k], k);
  // errText는 launchers.err.* 열쇠를 번역한다
  setLanguage('ko');
  assert.equal(errText({ code: 'name_taken', key: 'launchers.err.nameTaken', vars: { name: 'X' }, message: 'm' }), '이미 있는 런처 이름입니다: X');
  setLanguage('en');
  assert.equal(errText({ code: 'gateway_down', key: 'launchers.err.gatewayDown', vars: { name: 'GW', url: 'http://h', why: 'ECONNREFUSED' } }), 'GW: the gateway at http://h is not reachable (ECONNREFUSED). Start it, then try again');
});
