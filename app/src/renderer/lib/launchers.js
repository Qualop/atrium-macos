// P33 호출자(백엔드 launchers.mjs)를 창에서 보여주는 순수 함수. 왼쪽 레일 즐겨찾기, 설정의 호출자 탭, 새 세션 창이 쓴다.
// 단위 시험 app/test/p33-lib.test.mjs

// 고를 수 있는 아이콘(lib/kinds.js의 로고와 기호). 빈 값은 하네스를 따른다
export const ICONS = ['claude', 'codex', 'agy', 'deepseek', 'pi', 'grok', 'shell'];

// 그릴 종류 아이콘. 아이콘을 골랐으면 그것, 셸은 shell, 직접 명령은 null(터미널 그림 위에 첫 글자), 그 밖은 하네스 종류
export function launcherIcon(l) {
  if (!l) return null;
  if (l.icon) return l.icon;
  if (l.harness === 'command') return null;
  return l.harness || 'claude';
}
// 직접 명령 호출자의 머리글자(이름의 첫 글자)
export const launcherMark = (l) => { const c = String((l && l.name) || '?').trim().charAt(0); return c ? c.toUpperCase() : '?'; };

// 즐겨찾기 순서대로의 호출자들
export function favoriteLaunchers(data) {
  if (!data || !Array.isArray(data.launchers)) return [];
  const by = new Map(data.launchers.map((l) => [l.id, l]));
  return (data.favorites || []).map((id) => by.get(id)).filter(Boolean);
}
// 설정 탭의 목록 순서: 즐겨찾기(레일 순서) 먼저, 그 다음 나머지(만든 순서)
export function orderedLaunchers(data) {
  if (!data || !Array.isArray(data.launchers)) return [];
  const fav = favoriteLaunchers(data);
  const ids = new Set(fav.map((l) => l.id));
  return [...fav, ...data.launchers.filter((l) => !ids.has(l.id))];
}
// 즐겨찾기에서 한 칸 옮긴 새 순서(옮길 수 없으면 null)
export function moveFavorite(favorites, id, delta) {
  const i = favorites.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= favorites.length) return null;
  const a = [...favorites];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

// 명령 미리보기 한 줄. shellText는 셸 호출자일 때의 글(언어별)
export function previewLine(preview, shellText = 'shell') {
  if (!preview) return '';
  if (preview.shell) return shellText;
  return preview.line || '';
}
// 레일에 마우스를 올렸을 때 보일 글: 이름, 명령, 환경 변수 이름(값은 보이지 않는다)
export function launcherTooltip(l, { shellText = 'shell', envText = 'env' } = {}) {
  if (!l) return '';
  const p = l.preview || {};
  const lines = [l.name, previewLine(p, shellText)];
  if (p.env && p.env.length) lines.push(`${envText}: ${p.env.join(', ')}`);
  return lines.filter(Boolean).join('\n');
}

// 환경 변수 { 이름: 값 } ↔ "이름=값" 줄 글(설정 탭의 입력칸)
export const envToText = (env) => Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
// 비밀값처럼 보이는 이름(API 키, 토큰, 비밀번호). 설정 탭이 경고한다
export const SECRET_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;
export function secretNames(envText) {
  return String(envText || '').split(/\r?\n/).map((l) => l.split('=')[0].trim()).filter((k) => k && SECRET_RE.test(k));
}

// 하네스가 보일 칸(백엔드 HARNESSES의 fields). 모르는 종류(herdr가 아는 그 밖)는 추가 인자만
export function harnessFields(harnesses, id) {
  const h = (harnesses || []).find((x) => x.id === id);
  return h ? h.fields : ['codex', 'gemini', 'agy'].includes(id) ? ['model', 'args'] : ['args'];
}
export function harnessModels(harnesses, id) {
  const h = (harnesses || []).find((x) => x.id === id);
  return h ? h.models || [] : [];
}

// 새 호출자의 빈 틀
export const blankLauncher = (harness = 'claude') => ({ id: null, name: '', harness, icon: '', model: '', effort: '', permissionMode: 'manual', allowHerdr: false, args: '', env: {}, command: '', checkUrl: '' });
