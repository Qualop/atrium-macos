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
// P72: 모델 입력칸 아래 목록에 보일 모델. 비었거나 목록의 이름 그대로면 전부, 아니면 이름·보이는 이름에 든 글자로 거른다(대소문자 무시)
export function modelChoices(models, labels = {}, value = '') {
  const list = models || [];
  const v = String(value || '').trim().toLowerCase();
  if (!v || list.includes(String(value).trim())) return list;
  return list.filter((m) => m.toLowerCase().includes(v) || String(labels[m] || '').toLowerCase().includes(v));
}
// P72: 모델의 보이는 이름(Codex 목록의 display_name). 없으면 빈 묶음
export function harnessModelLabels(harnesses, id) {
  const h = (harnesses || []).find((x) => x.id === id);
  return (h && h.modelLabels) || {};
}

// 새 호출자의 빈 틀. P97: startCommand(Claude Code의 실행 명령, 비면 claude)
export const blankLauncher = (harness = 'claude') => ({ id: null, name: '', harness, icon: '', model: '', effort: '', permissionMode: 'manual', allowHerdr: false, args: '', env: {}, command: '', checkUrl: '', startCommand: '' });

// P97: 붙여 넣은 명령줄을 무엇으로 알아봤는지(백엔드 launcher.parse의 recognized) → 칩 목록 [{ tone: ok|dim|warn, key, vars }]. 사전 launchers.parse.*
export function recognizedChips(rec) {
  if (!rec || rec.as === 'empty') return [];
  const out = [];
  if (rec.board) out.push({ tone: 'ok', key: 'launcherPaste.board', vars: {} });
  else if (rec.as === 'command') out.push({ tone: 'warn', key: `launcherPaste.command_${rec.why || 'unknown'}`, vars: {} });
  else out.push({ tone: 'ok', key: 'launcherPaste.agent', vars: { harness: rec.harness } });
  if (rec.startCommand) out.push({ tone: 'dim', key: 'launcherPaste.start', vars: { cmd: rec.startCommand } });
  for (const m of rec.mapped || []) out.push({ tone: 'dim', key: 'launcherPaste.mapped', vars: { arg: m.arg, field: m.field } });
  if (rec.env && rec.env.length) out.push({ tone: 'dim', key: 'launcherPaste.env', vars: { names: rec.env.join(', ') } });
  if (rec.agentPath) out.push({ tone: 'warn', key: 'launcherPaste.path', vars: { path: rec.agentPath } });
  if (rec.dropped && rec.dropped.length) out.push({ tone: 'warn', key: 'launcherPaste.dropped', vars: { args: rec.dropped.join(' ') } });
  if (rec.skipped && rec.skipped.length) out.push({ tone: 'warn', key: 'launcherPaste.skipped', vars: { lines: rec.skipped.join(' · ') } });
  return out;
}
// 붙여 넣기로 채울 틀 값: 지금 틀(이름을 사람이 이미 썼으면 그대로)에 해석 값을 덮는다. 고치는 중인 호출자는 ID를 지킨다
export function fillFromParse(cur, parsed) {
  const l = parsed || {};
  return { ...cur, ...l, id: cur.id || null, name: cur.name && cur.name.trim() ? cur.name : l.name || '', env: l.env || {}, icon: cur.icon || '' };
}

// P97: 레일 이름 칸의 자리(화면 좌표). 단추 오른쪽 10px, 단추 가운데 높이. 창 밖으로 나가지 않게 줄이고, 화살표는 단추를 가리킨다
export function popoverAt(rect, { w = 300, h = 96, vw = 1280, vh = 800 } = {}) {
  const left = Math.min(Math.max(8, rect.right + 10), Math.max(8, vw - w - 8));
  const top = Math.min(Math.max(8, rect.top + rect.height / 2 - 26), Math.max(8, vh - h - 8));
  return { left, top, arrow: Math.max(10, Math.min(h - 16, rect.top + rect.height / 2 - top - 5)) };
}

// 판 자동 승인은 시작 시 저장된 프리셋 권한 모드를 덮는다. 셸·직접 명령에는 적용하지 않는다.
export const autoApprovalApplies = (settings, harness) => settings?.agentAutoApprove === true && !!harness && !['shell', 'command'].includes(harness);
