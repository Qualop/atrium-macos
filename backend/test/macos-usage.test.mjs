// macOS 판: 대화 기록에서 쓴 토큰 모으기(usage-meter.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { foldUsage, usageOf, refreshUsage, sumUsage, weighted } from '../src/usage-meter.mjs';

const line = (id, u, ts = '2026-11-21T01:00:00Z') => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, usage: { input_tokens: u[0], cache_creation_input_tokens: u[1], cache_read_input_tokens: u[2], output_tokens: u[3] } } });

test('같은 응답(message.id)의 줄 여럿은 한 번만, 마지막 값으로 센다', () => {
  const lines = [line('m1', [1, 100, 1000, 5]), line('m1', [1, 100, 1000, 40]), JSON.stringify({ type: 'user', message: { content: 'usage' } }), line('m2', [2, 0, 2000, 10], '2026-11-21T02:00:00Z')];
  const u = usageOf(foldUsage(lines));
  assert.deepEqual({ in: u.in, cw: u.cw, cr: u.cr, out: u.out, msgs: u.msgs }, { in: 3, cw: 100, cr: 3000, out: 50, msgs: 2 });
  assert.equal(u.weighted, weighted({ in: 3, cw: 100, cr: 3000, out: 50 }));
  assert.equal(u.weighted, Math.round(3 + 125 + 300 + 250));
  assert.equal(u.lastAt - u.firstAt, 3600000);
});

test('파일을 이어 읽고, 줄이 덜 쓰였으면 다음에 읽는다', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-')), 'a.jsonl');
  fs.writeFileSync(f, line('m1', [1, 0, 10, 2]) + '\n' + line('m2', [1, 0, 10, 3]).slice(0, 20));
  let st = refreshUsage(f, null);
  assert.equal(usageOf(st.acc).msgs, 1);
  fs.writeFileSync(f, line('m1', [1, 0, 10, 2]) + '\n' + line('m2', [1, 0, 10, 3]) + '\n');
  st = refreshUsage(f, st);
  assert.equal(usageOf(st.acc).msgs, 2);
  assert.equal(usageOf(st.acc).out, 5);
});

test('나무 합계', () => {
  const t = sumUsage([{ cr: 10, cw: 1, in: 1, out: 1, msgs: 1, firstAt: 5, lastAt: 9 }, null, { cr: 20, cw: 0, in: 0, out: 2, msgs: 2, firstAt: 3, lastAt: 7 }]);
  assert.deepEqual({ cr: t.cr, out: t.out, msgs: t.msgs, firstAt: t.firstAt, lastAt: t.lastAt, sessions: t.sessions }, { cr: 30, out: 3, msgs: 3, firstAt: 3, lastAt: 9, sessions: 2 });
});
