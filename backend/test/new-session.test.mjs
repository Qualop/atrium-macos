// 새 세션 기본값 단위 시험. P33부터 새 세션 기본값(claude*, codexArgs, deepseek*)은 설정이 아니라 호출자(launchers.mjs, p33.test.mjs)다.
// 여기서는 설정이 옛 키를 받지도 보이지도 않고, 판 기록에 남은 옛 키는 지우지 않는지만 본다
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePatch, DEFAULTS, Settings, SETTINGS } from '../src/settings.mjs';
import { LEGACY_KEYS } from '../src/launchers.mjs';

test('새 세션 기본값: 설정에는 옛 키가 없다(호출자로 옮김)', () => {
  for (const k of LEGACY_KEYS) {
    assert.ok(!(k in DEFAULTS), k);
    assert.throws(() => normalizePatch({ [k]: 'x' }), /(?:알 수 없는|모르는) 설정/); // macOS 판의 문구는 "모르는 설정"
  }
  assert.match(SETTINGS.sleepAfterMin.label, /프로젝트/, '뒤의 정의(P24 리포 단위) 하나만');
});

test('새 세션 기본값: 판 기록에 남은 옛 키는 get이 보이지 않고, set도 지우지 않는다', () => {
  const meta = new Map([['settings', { tray: false, claudeModel: 'opus', codexArgs: '-m x' }]]);
  const s = new Settings({ store: { getMeta: (k) => meta.get(k), setMeta: (k, v) => meta.set(k, v) }, broadcast: () => {} });
  assert.equal(s.get().tray, false);
  assert.ok(!('claudeModel' in s.get()));
  const next = s.set({ key: 'language', value: 'ko' });
  assert.ok(!('claudeModel' in next));
  assert.equal(meta.get('settings').claudeModel, 'opus');
  assert.equal(meta.get('settings').language, 'ko');
});
