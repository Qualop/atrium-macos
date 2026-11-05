// P36 창 시험: 상한 없이 펼친 나무(lead 아래 하위 세션 6개 이상, 5단계 사슬)가 캔버스·미션 맵에서 겹치지 않고 보이고,
// 설정에 가지 펼치기 상한 탭이 없으며, 신뢰 관문의 워크트리 하위 세션(x)이 노드에서 신뢰 질문(trust_wait)으로 보이는지. 신뢰 질문에는 답하지 않는다.
// 사용: node experiments/p36/tools/e2e.cjs p36-board.mjs   (P36 판 atrium-dev-p36, 47854, MT_E2E_OUT=p36)
import fs from 'node:fs';
import path from 'node:path';
import { launch, closeApp, shot, logger, sleep, OUT } from './harness.mjs';

// p8-lib.mjs의 treeView·fitNames와 같다(p8-lib은 P8 판을 강제해 여기서 부르지 않는다)
const treeView = (page) => page.evaluate(() => {
  const st = window.__mt.getState();
  return [...st.sessions.values()].map((s) => {
    const n = st.nodes.get(s.sessionId) || {};
    const el = document.querySelector(`.mt-node[data-session="${s.sessionId}"] [data-role="branch"]`);
    return { name: s.name, state: s.state, depth: s.branch && s.branch.depth, parent: s.branch && s.branch.parentName, role: s.branch && s.branch.role, badge: el ? el.textContent : null, x: n.x, y: n.y, w: n.w, h: n.h };
  });
});
async function fitNames(page, names, pad = 80) {
  await page.evaluate(([ns, p]) => {
    const st = window.__mt.getState();
    const rs = [...st.sessions.values()].filter((s) => ns.includes(s.name)).map((s) => st.nodes.get(s.sessionId)).filter(Boolean);
    const x0 = Math.min(...rs.map((r) => r.x)) - p, y0 = Math.min(...rs.map((r) => r.y)) - p, x1 = Math.max(...rs.map((r) => r.x + r.w)) + p, y1 = Math.max(...rs.map((r) => r.y + r.h)) + p;
    st.navigateToRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 0);
  }, [names, pad]);
  await sleep(1500);
}

if (process.env.ATRIUM_HERDR_SESSION !== 'atrium-dev-p36' || process.env.ATRIUM_PORT !== '47854') throw new Error('P36 판(atrium-dev-p36, 47854)에서만');
if (process.env.MT_E2E_OUT !== 'p36') throw new Error('MT_E2E_OUT=p36');
const log = logger('p36-board');
const result = { steps: [] };
const step = (name, ok, data) => { result.steps.push({ name, ok: !!ok, data }); log(`${ok ? 'PASS' : 'FAIL'} ${name}`, data ? JSON.stringify(data).slice(0, 600) : ''); };
const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const { app, page } = await launch({ log });
try {
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(2000);
  const tree = await treeView(page);
  log('tree', JSON.stringify(tree));
  const kids = tree.filter((t) => t.parent === 'lead');
  const maxDepth = Math.max(...tree.map((t) => t.depth || 1));
  step('lead의 하위 세션 5개 이상, 깊이 4단계 이상', kids.length >= 5 && maxDepth >= 4, { kids: kids.length, maxDepth });
  const placed = tree.filter((t) => t.x != null);
  const bad = [];
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) if (ov(placed[i], placed[j])) bad.push([placed[i].name, placed[j].name]);
  step('캔버스의 세션 노드가 겹치지 않는다', bad.length === 0, { bad });
  step('하위 세션은 부모 오른쪽에 놓인다(다른 워크스페이스의 x는 그 영역에)', tree.filter((t) => t.parent && t.name !== 'x').every((t) => { const p = tree.find((q) => q.name === t.parent); return !p || t.x > p.x; }), null);
  step('머리줄에 "@부모의 워커 · n단계"', tree.filter((t) => t.parent && t.role).every((t) => t.badge && t.badge.includes(String(t.depth))), tree.filter((t) => t.parent).map((t) => t.badge));
  await fitNames(page, tree.filter((t) => t.name !== 'x').map((t) => t.name), 60);
  await shot(page, 'p36-1-tree-canvas', log);

  // 신뢰 관문: x는 신뢰 질문에서 멈춰 있고 노드가 그것을 보인다(답하지 않는다)
  const x = await page.evaluate(() => { const s = [...window.__mt.getState().sessions.values()].find((v) => v.name === 'x'); return s ? { state: s.state, gate: s.branch && s.branch.gate, worktree: s.branch && s.branch.worktree, delivering: s.delivering } : null; });
  step('x 노드: trust_wait, 관문(gate=trust, worktree x), 첫 지시는 대기열에', x && x.state === 'trust_wait' && x.gate === 'trust' && x.worktree === 'x' && x.delivering >= 1, x);
  await fitNames(page, ['x'], 40);
  await shot(page, 'p36-2-trust-gate-node', log);

  // 미션 맵
  await page.click('[data-action="mission-rail"]');
  await page.waitForSelector('[data-role="mm-node"][data-kind="session"]', { timeout: 20000 });
  await sleep(800);
  const mm = await page.evaluate(() => [...document.querySelectorAll('[data-role="mm-node"][data-kind="session"]')].map((e) => { const r = e.getBoundingClientRect(); return { name: e.dataset.name, x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const mbad = [];
  for (let i = 0; i < mm.length; i++) for (let j = i + 1; j < mm.length; j++) if (ov(mm[i], mm[j])) mbad.push([mm[i].name, mm[j].name]);
  step('미션 맵의 세션 상자가 겹치지 않는다', mm.length >= tree.length && mbad.length === 0, { n: mm.length, bad: mbad });
  await shot(page, 'p36-3-mission-map', log);
  await page.click('[data-action="mission-close"]');

  // 설정: 가지 펼치기 상한 탭이 없다
  await page.click('[data-action="settings-open"]');
  await page.waitForSelector('[data-role="settings-tabs"]', { timeout: 10000 });
  const set = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('[data-role="settings-tabs"] [data-tab]')].map((b) => b.dataset.tab), branch: !!document.querySelector('[data-role="branch-settings"]'), text: document.querySelector('[data-role="settings"]').innerText }));
  step('설정에 가지 펼치기 상한 탭과 칸이 없다', !set.tabs.includes('branch') && !set.branch && !/branchMax|상한/.test(set.text), set.tabs);
  await shot(page, 'p36-4-settings-no-limits', log);
  await page.keyboard.press('Escape');
} catch (e) { step('예외', false, { error: e.stack }); }
finally {
  fs.writeFileSync(path.join(OUT, 'p36-board.json'), JSON.stringify(result, null, 2));
  await closeApp(app);
}
const failed = result.steps.filter((s) => !s.ok);
log(`${result.steps.length - failed.length}/${result.steps.length} 통과`);
process.exit(failed.length ? 1 : 0);
