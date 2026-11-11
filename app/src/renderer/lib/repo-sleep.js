// P24(ARCH 4절 D4): 리포 단위 잠재우기의 창 쪽 순수 함수. 영역 이름표(Regions.jsx)와 메모리 알약 목록(Chrome.jsx)이 쓴다
// 리포 하나의 잠듦(영역 이름표): 잠든 수, 깨우는 중인 수, 깨어 있는 잠재울 수 있는 수, 아낀 메모리. all이면 잠재울 수 있는 세션이 모두 잠들었다. 순수 함수
export function repoSleep(sessions, key) {
  let asleep = 0, waking = 0, awake = 0, mb = 0;
  for (const s of sessions) {
    if ((s.workspaceKey || '') !== key) continue;
    if (s.waking) waking++;
    if (s.state === 'sleeping') { asleep++; mb += (s.sleep && s.sleep.memMB) || 0; }
    else if (s.sleepable) awake++;
  }
  return { asleep, waking, awake, mb, all: asleep > 0 && awake === 0 };
}

// P111: 세션 규칙으로 혼자 잠든 세션(깨우면 그 세션만 깬다). 옛 백엔드·리포째 잠든 세션은 scope가 없거나 repo. 순수 함수
export const sleptAlone = (s) => !!(s && s.state === 'sleeping' && s.sleep && s.sleep.scope === 'session');

// 메모리 알약 목록을 리포별로 묶는다. 순수 함수.
// rows: 자원 표본의 세션 줄({ sessionId, name, memMB, state }), sessions: 세션 요약 Map, workspaces: [{ key, name }]
// → [{ key, name, memMB, asleep: [세션 요약], savedMB, rows }]. 깨어 있는 메모리가 큰 리포가 먼저, 잠든 세션만 있는 리포는 뒤
export function memByRepo(rows, sessions, workspaces) {
  const by = new Map();
  const get = (key) => {
    if (!by.has(key)) { const w = workspaces.find((x) => x.key === key); by.set(key, { key, name: w ? w.name : key ? key.split('/').filter(Boolean).pop() : '-', memMB: 0, asleep: [], savedMB: 0, rows: [] }); }
    return by.get(key);
  };
  for (const x of rows) {
    const s = sessions.get(x.sessionId);
    if (!(x.memMB > 0) || (s && s.state === 'sleeping')) continue; // 잰 뒤 잠든 세션은 잠든 줄로만
    const g = get((s && s.workspaceKey) || '');
    g.rows.push(x); g.memMB += x.memMB;
  }
  for (const s of sessions.values()) {
    if (s.state !== 'sleeping') continue;
    const g = get(s.workspaceKey || '');
    g.asleep.push(s); g.savedMB += (s.sleep && s.sleep.memMB) || 0;
  }
  const out = [...by.values()];
  for (const g of out) g.rows.sort((a, b) => b.memMB - a.memMB);
  return out.sort((a, b) => b.memMB - a.memMB || b.savedMB - a.savedMB || a.name.localeCompare(b.name));
}
