// P129: 옛 판(herdr)을 herdr-core로 옮기는 진행(백엔드 terminal.migrate)을 글로 바꾸는 순수 함수. 판 위 띠(InboxBar)와 설정 › 터미널 표가 쓴다

// 끝난(처리한) 세션 수: 옮김, 되살림, 절전 그대로
export function migrationDone(m) { return (m.moved || 0) + (m.recreated || 0) + (m.asleep || 0); }

// 기다리는 까닭(sleep 규칙의 까닭 등)의 글. 사전에 없으면 백엔드가 준 그대로
export function migrationReason(r, t) {
  if (!r) return '';
  const k = `terminalMigrate.reason.${r}`;
  const v = t(k);
  return v === k ? r : v;
}

// 기다리는 세션 몇 개("@lead (working)")와 남은 수
export function migrationWaiting(m, t, max = 3) {
  const rows = ((m && m.rows) || []).filter((x) => x.result === 'waiting');
  const list = rows.slice(0, max).map((x) => t('terminalMigrate.who', { name: x.name, why: migrationReason(x.reason, t) }));
  return rows.length > max ? [...list, t('terminalMigrate.more', { n: rows.length - max })] : list;
}
