import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function checkAgyCollaboration({ client, page, dir }) {
  const project = process.env.ATRIUM_AGY_TEST_PROJECT;
  assert.ok(project && /^\/(?:private\/)?tmp\/atrium-/.test(project) && fs.statSync(project).isDirectory(), 'Use a separately created, manually trusted Atrium test directory');
  const until = async (fn, label, timeout = 90000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise((r) => setTimeout(r, 250)); }
    throw new Error(`Timed out: ${label}. Check trust or approval prompts in the test app.`);
  };
  const catalog = await client.call('agent.models', { kind: 'agy' });
  assert.equal(catalog.source, 'agy');
  const model = catalog.models.find((m) => /^gemini-.*-low$/.test(m.id)) || catalog.models.find((m) => m.id.startsWith('gemini-'));
  assert.ok(model, 'Google account has a Gemini model');
  const worker = await client.call('session.spawn', { kind: 'agy', name: 'google-worker', cwd: project, model: model.id });
  const reviewer = await client.call('session.spawn', { kind: 'agy', name: 'google-reviewer', cwd: project, model: model.id });
  const ready = (id) => until(async () => { const s = await client.call('session.get', { session: id }); return s.state === 'ready' && s; }, `ready ${id}`);
  await ready(worker.sessionId); await ready(reviewer.sessionId);
  const link = await client.call('link.create', { from: worker.sessionId, to: reviewer.sessionId, role: 'reviewer' });
  await until(async () => { const s = await client.call('session.get', { session: worker.sessionId }); return s.hooks.count > 0 && s.lastAnswer && s.state === 'ready'; }, 'role notice acknowledged with native hooks');
  const send = async (s, text, marker) => {
    const before = (await client.call('session.get', { session: s.sessionId })).lastAnswerAt || 0;
    await client.call('session.send', { target: s.sessionId, text });
    return until(async () => { const r = await client.call('session.get', { session: s.sessionId }); return r.state === 'ready' && r.lastAnswerAt > before && r.lastAnswer?.includes(marker) && r; }, marker);
  };
  const review = await send(reviewer, 'You are the reviewer. Do not use tools or files. Review this function: function add(a,b){return a-b}. Its requirement is addition. If wrong reply REVIEW_BAD and briefly state the fix.', 'REVIEW_BAD');
  const fix = await send(worker, `Your reviewer found: ${review.lastAnswer}. Do not use tools or files. Return the corrected JavaScript add function and the marker FIXED_OK.`, 'FIXED_OK');
  assert.match(fix.lastAnswer, /a\s*\+\s*b/);
  const final = await send(reviewer, `Do not use tools or files. Re-review this correction: ${fix.lastAnswer}. If correct reply REVIEW_PASS.`, 'REVIEW_PASS');
  assert.ok(final.hooks.count > 0); assert.equal(final.kind, 'agy');
  const lines = await client.call('link.log', { link: link.link.linkId });
  assert.ok(lines.events.some((e) => e.kind === 'role'));
  fs.writeFileSync(path.join(dir, 'google-collaboration.json'), JSON.stringify({ model: model.id, worker: worker.sessionId, reviewer: reviewer.sessionId, review: review.lastAnswer, fix: fix.lastAnswer, final: final.lastAnswer, hooks: final.hooks.count }, null, 2));
  await page.screenshot({ path: path.join(dir, 'google-collaboration.png') });
  console.log('PASS live Google account: model catalog, managed worker/reviewer, role hook, review → correction → re-review via board deliveries');
  for (const s of [worker, reviewer]) await client.call('session.kill', { session: s.sessionId, confirm: true });
}
