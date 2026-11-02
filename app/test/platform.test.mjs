import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { electronExecutable } from '../scripts/platform.mjs';
import { keyAction } from '../src/renderer/lib/term-input.js';
import { pickAttached } from '../src/renderer/lib/faces.js';

test('Electron 실행 파일은 OS별 배포 구조를 따른다', () => {
  assert.ok(electronExecutable('app', 'darwin').endsWith(path.join('Electron.app', 'Contents', 'MacOS', 'Electron')));
  assert.ok(electronExecutable('app', 'win32').endsWith('electron.exe'));
  assert.ok(electronExecutable('app', 'linux').endsWith(path.join('dist', 'electron')));
});
test('Command 복사·붙여넣기와 Ctrl-C 인터럽트를 구분한다', () => {
  assert.equal(keyAction({ type: 'keydown', key: 'v', metaKey: true }, false), 'paste');
  assert.equal(keyAction({ type: 'keydown', key: 'c', metaKey: true }, true), 'copy');
  assert.equal(keyAction({ type: 'keydown', key: 'c', ctrlKey: true }, false), 'pass');
});

test('연결 예산이 꽉 차도 사용자가 고른 터미널을 우선 연결한다', () => {
  const nodes = [{ id: 'picked', x: 0, y: 0, w: 420, h: 220 }, { id: 'center', x: 600, y: 350, w: 420, h: 220 }];
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 1 }, { width: 1600, height: 900 }, { max: 1, focusId: 'picked' }), ['picked']);
  assert.deepEqual(pickAttached(nodes, { x: 0, y: 0, zoom: 0.15 }, { width: 1600, height: 900 }, { max: 1, focusId: 'picked' }), []);
});
