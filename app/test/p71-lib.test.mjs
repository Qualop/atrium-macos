// P71 단위 시험(창): 버전이 든 창 제목, 워크트리 나가기 질문의 이름, 닫기에서 고른 답, 사이드바 메뉴 아이콘, 되돌리기가 없어진 것
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowTitle } from '../src/renderer/lib/update-notice.js';
import { killWorktreeParam } from '../src/renderer/lib/worktree-exit.js';
import { translate } from '../src/renderer/lib/i18n.js';
const ICONS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'lib', 'icons.jsx'), 'utf8'); // .jsx는 node로 불러오지 못한다
import en from '../src/renderer/locales/en.js';
import ko from '../src/renderer/locales/ko.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tKo = (k, v) => translate('ko', k, v);
const tEn = (k, v) => translate('en', k, v);

test('창 제목: 이름 뒤에 지금 창의 버전, 개발용 판은 (dev)', () => {
  assert.equal(windowTitle('Atrium', '0.1.2', 'real'), 'Atrium 0.1.2');
  assert.equal(windowTitle('Atrium', '0.1.2', 'dev'), 'Atrium 0.1.2 (dev)');
  assert.equal(windowTitle('Atrium', '0.1.3-dev.1', 'real'), 'Atrium 0.1.3-dev.1'); // dev 빌드는 그대로
  assert.equal(windowTitle('Atrium', 'v0.1.2', 'real'), 'Atrium 0.1.2');
  assert.equal(windowTitle('Atrium', null, 'dev'), 'Atrium (dev)'); // package.json을 못 읽으면 이름만
  // main과 트레이가 이 함수로 제목과 풍선 글을 만든다
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.mjs'), 'utf8');
  assert.match(main, /title: windowTitle\(APP_NAME, APP_VERSION, cfg\.profile\)/);
  assert.match(main, /appVersion: APP_VERSION \}\)/);
  const tray = fs.readFileSync(path.join(ROOT, 'src', 'main', 'tray.mjs'), 'utf8');
  assert.match(tray, /st\.tooltip = `\$\{windowTitle\(tr\('app\.name'\), appVersion, cfg\.profile\)\}/);
});

test('워크트리 나가기 질문: 판은 이름만 보인다(응답 필요 목록·먼 얼굴). P104부터 답하는 줄은 없고 터미널에서 고른다', () => {
  assert.equal(tKo('wtExit.title'), '워크트리를 남길까요?');
  assert.equal(tEn('wtExit.title'), 'Keep the worktree?');
  for (const d of [en, ko]) for (const k of ['keep', 'remove', 'removeConfirm', 'removeWarn', 'commits', 'files']) assert.equal(d.wtExit[k], undefined, k);
});

test('닫기에서 고른 답: 워크트리 세션이면 고른 값, 고르지 않았으면 남기기, 아니면 넘기지 않는다', () => {
  assert.deepEqual(killWorktreeParam({ name: 'p9' }, 'remove'), { worktree: 'remove' });
  assert.deepEqual(killWorktreeParam({ name: 'p9' }, 'keep'), { worktree: 'keep' });
  assert.deepEqual(killWorktreeParam({ name: 'p9' }, undefined), { worktree: 'keep' });
  assert.deepEqual(killWorktreeParam(null, 'remove'), {});
  assert.deepEqual(killWorktreeParam(undefined, 'keep'), {});
  assert.equal(tKo('wtExit.closeKeep', { name: 'p9' }), '워크트리 남기기(p9, 기본)');
  assert.equal(tKo('wtExit.closeRemove'), '워크트리와 브랜치 지우기');
  // 닫기 확인이 이 글과 값을 쓴다(P104: 승인 줄은 없다)
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'ApprovalCard.jsx')), false);
  const node = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'SessionNode.jsx'), 'utf8');
  assert.equal((node.match(/killWorktreeParam\(msg && msg\.worktree, wtChoice\)/g) || []).length, 2); // X의 확인과 Delete의 대화상자
  assert.equal(tKo('backend.chgWorktreeExit'), '워크트리를 남길지 확인 필요');
});

test('메뉴 아이콘(⋯): 길이 0인 선이 아니라 보이는 점 셋', () => {
  const d = ICONS.match(/^  more: '([^']*)'/m)[1];
  assert.ok(!/h\.01/.test(d), d);
  assert.equal((d.match(/M/g) || []).length, 3);
  assert.equal((d.match(/a1 1 0 1 0/g) || []).length, 6); // 점마다 반원 둘
});

test('버전 되돌리기가 없어졌다: 단추, 사전 열쇠, 창의 API 부르기', () => {
  for (const d of [en, ko]) for (const k of ['rollbackTo', 'rollback', 'rollbackTitle', 'rollbackHint']) assert.equal(d.update[k], undefined, k);
  assert.ok(en.update.toastRolledBack && ko.update.toastRolledBack); // 자동 되돌리기 알림은 그대로
  const upd = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'Update.jsx'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'update.js'), 'utf8');
  assert.ok(!/data-action=[\"']update-rollback|api\.call\(['\"]update\.rollback|applyRollback/.test(upd), 'No manual rollback control or API call');
  assert.match(upd, /lastResult\?\.rollbackError/, 'Automatic recovery failures remain visible');
  assert.ok(!/update\.rollback/.test(js), 'update.js');
});
