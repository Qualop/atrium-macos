// P45 요청 기록 스레드(Thread.jsx)의 판단. 순수 함수만 둔다(단위 시험 test/p45-lib.test.mjs).
// 줄(item) = 보낸 글 하나: { itemId, t, source, text, targets: ['@a', '@all'], results: [{ deliveryId, sessionId, name, status, reason, phase, report }], phase }

// 그 줄을 받은 세션 이름들. 결과가 있으면 결과의 이름(@all을 푼 것), 없으면 대상에서 @를 뗀 것
export function itemNames(it) {
  const rs = (it && it.results) || [];
  const names = rs.length ? rs.map((r) => r.name).filter(Boolean) : ((it && it.targets) || []).map((x) => String(x).replace(/^@/, '')).filter((x) => x && x !== 'all');
  return [...new Set(names)];
}

// 묶어 보기 단추: 받은 세션마다 줄 수와 진행 중 수. 가장 최근에 받은 세션이 앞
export function threadSessions(items) {
  const m = new Map();
  for (const it of items || []) {
    for (const r of it.results && it.results.length ? it.results : itemNames(it).map((name) => ({ name, phase: 'delivering' }))) {
      if (!r.name) continue;
      const e = m.get(r.name) || { name: r.name, count: 0, active: 0, last: 0 };
      e.count++;
      if (r.phase === 'delivering' || r.phase === 'running') e.active++;
      e.last = Math.max(e.last, it.t || 0);
      m.set(r.name, e);
    }
  }
  return [...m.values()].sort((a, b) => b.last - a.last || a.name.localeCompare(b.name));
}

// 한 세션으로 묶기(name이 비면 모두). 그 세션의 결과만 남긴다(같은 줄의 다른 세션 결과는 가린다)
export function filterThread(items, name) {
  if (!name) return items || [];
  const out = [];
  for (const it of items || []) {
    if (!itemNames(it).includes(name)) continue;
    out.push({ ...it, results: (it.results || []).filter((r) => r.name === name), hiddenResults: (it.results || []).filter((r) => r.name !== name).length });
  }
  return out;
}

// 긴 글인가(접어 보인다): 글자 수나 줄 수가 넘는다
export const LONG_CHARS = 240;
export const LONG_LINES = 3;
export function isLong(text, { chars = LONG_CHARS, lines = LONG_LINES } = {}) {
  const s = String(text || '');
  return s.length > chars || s.split('\n').length > lines;
}

// 한 줄 미리보기: 빈칸을 하나로 줄이고 n자에서 자른다(글자 단위, 이모지를 반으로 자르지 않는다)
export function oneLine(text, n = 160) {
  const chars = [...String(text || '').replace(/\s+/g, ' ').trim()];
  return chars.length > n ? chars.slice(0, n).join('') + '…' : chars.join('');
}

// 다시 보내기·고쳐 보내기의 명령 바 글: 처음의 대상(@all 그대로) + 글
export function resendLine(it) {
  const targets = ((it && it.targets) || []).map((x) => '@' + String(x).replace(/^@/, '')).filter((x) => x.length > 1);
  return `${targets.join(' ')} ${(it && it.text) || ''}`.trim();
}

// 결과 하나의 색 묶음: ok(보고 받음), run(가는 중·도는 중), bad(실패·시간 초과), dim(취소)
export function resultTone(r) {
  const p = r && r.phase;
  if (p === 'done') return r.report && (r.report.state === 'error' || r.report.state === 'exited' || r.report.state === 'closed') ? 'bad' : 'ok';
  if (p === 'delivering' || p === 'running') return 'run';
  if (p === 'failed' || p === 'abandoned') return 'bad';
  return 'dim';
}

// 머리줄 요약: 모두, 진행 중, 실패 섞인 줄
export function threadSummary(items) {
  let active = 0, failed = 0;
  for (const it of items || []) { if (it.phase === 'active') active++; else if (it.phase === 'failed' || it.phase === 'partial') failed++; }
  return { total: (items || []).length, active, failed };
}

// 같은 날인가(시각만 보일지, 날짜도 보일지)
export function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
