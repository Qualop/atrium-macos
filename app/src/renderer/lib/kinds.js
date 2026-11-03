// 에이전트 종류의 이름과 아이콘(P10). 종류마다 보여주는 것을 이 파일 한곳에 둔다(노드의 아이콘 얼굴, 이름표).
// 로고 그림이 있는 종류는 `logo`(내 차례일 때 다른 그림이면 `logoWait`, 왼쪽 레일 단추처럼 바탕이 있는 그림은 `logoBadge`)에
// dist/index.html 기준 주소를 둔다. 그림은 app/src/renderer/assets/kinds/에 두고 빌드가 dist/assets/로 옮긴다.
// Claude Code는 Claude 심볼(위키미디어 공용 Claude_AI_symbol.svg, 바탕 없음)과 그것을 주황 바탕에 흰색으로 얹은 레일 단추 그림이다.
// 다른 로고는 사용자가 준 그림을 어두운 판에 맞게 다듬은 것이다. 로고가 없는 종류는 직접 정한 단순한 기호(모양, 색, 머리글자)를 그린다.
// 순수 함수와 자료만 둔다(단위 시험 app/test/p10-lib.test.mjs). 그리는 것은 SessionNode.jsx의 KindIcon

import { t } from './i18n.js';

const LOGO = (name, ext = 'png') => `assets/kinds/${name}.${ext}`;

export const KINDS = {
  claude: { id: 'claude', label: 'Claude Code', mark: 'C', shape: 'circle', color: 'var(--kind-claude)', ink: 'var(--kind-claude-ink)', logo: LOGO('claude', 'svg'), logoBadge: LOGO('claude-badge', 'svg') },
  codex: { id: 'codex', label: 'Codex', mark: 'Cx', shape: 'hexagon', color: 'var(--kind-codex)', ink: 'var(--kind-codex-ink)', logo: LOGO('codex') },
  gemini: { id: 'gemini', label: 'Gemini CLI', mark: 'Gm', shape: 'diamond', color: 'var(--kind-gemini)', ink: 'var(--kind-gemini-ink)', logo: LOGO('gemini', 'svg'), logoBadge: LOGO('gemini-badge', 'svg') },
  agy: { id: 'agy', label: 'Gemini (Antigravity)', mark: 'Gm', shape: 'diamond', color: 'var(--kind-gemini)', ink: 'var(--kind-gemini-ink)', logo: LOGO('gemini', 'svg'), logoBadge: LOGO('gemini-badge', 'svg') },
  // P25: DeepSeek는 herdr 종류가 아니라 띄운 방법(flavor)이다. 판이 띄우는 Claude Code(모델만 DeepSeek)이거나 직접 명령으로 띄운 세션.
  // 로고는 위키미디어 공용 DeepSeek-icon.svg(받은 그대로), 레일 단추는 같은 모양을 로고 파랑 바탕에 흰색으로 얹었다
  deepseek: { id: 'deepseek', label: 'DeepSeek', mark: 'DS', shape: 'circle', color: 'var(--kind-deepseek)', ink: 'var(--kind-deepseek-ink)', logo: LOGO('deepseek', 'svg'), logoBadge: LOGO('deepseek-badge', 'svg') },
  pi: { id: 'pi', label: 'Pi', mark: 'π', shape: 'diamond', color: 'var(--kind-pi)', ink: 'var(--kind-pi-ink)', logo: LOGO('pi') },
  grok: { id: 'grok', label: 'Grok', mark: 'G', shape: 'circle', color: 'var(--kind-grok)', ink: 'var(--kind-grok-ink)', logo: LOGO('grok') },
  shell: { id: 'shell', get label() { return t('kinds.shell'); }, mark: '>_', shape: 'square', color: 'var(--kind-shell)', ink: 'var(--kind-shell-ink)', logo: null },
  other: { id: 'other', get label() { return t('ask.agent'); }, mark: '?', shape: 'rounded', color: 'var(--kind-other)', ink: 'var(--kind-other-ink)', logo: null },
};

// 종류 이름 → 보여줄 것. 모르는 종류는 '그 밖'이고 머리글자는 그 이름의 첫 두 글자다
export function kindOf(kind) {
  const k = String(kind || 'claude').toLowerCase();
  if (KINDS[k]) return KINDS[k];
  const base = KINDS.other;
  const mark = k.replace(/[^a-z0-9]/g, '').slice(0, 2);
  return { ...base, id: k, label: kind, mark: mark ? mark[0].toUpperCase() + mark.slice(1) : base.mark };
}

// P25: 보여줄 종류. 띄운 방법(flavor, 예: deepseek)이 있으면 그것이 herdr 종류(claude, shell)보다 먼저다
export const shownKind = (s) => (s && (s.flavor || s.kind)) || 'claude';

// 모양 → SVG path(100×100 상자 안). 원은 path 대신 circle로 그린다
export const SHAPES = {
  circle: null,
  square: 'M10 10 H90 V90 H10 Z',
  rounded: 'M26 8 H74 Q92 8 92 26 V74 Q92 92 74 92 H26 Q8 92 8 74 V26 Q8 8 26 8 Z',
  diamond: 'M50 4 L96 50 L50 96 L4 50 Z',
  hexagon: 'M27 8 H73 L96 50 L73 92 H27 L4 50 Z',
};

// 상태 → 아이콘 얼굴의 상태 색(테두리와 점). styles.css의 상태 알약 색과 같은 변수다
// P11: 색 값은 tokens.css(--st-…)에 있다. 여기는 변수 이름만
export const STATE_COLOR = Object.fromEntries(['starting', 'trust_wait', 'ready', 'working', 'waiting', 'error', 'exited', 'shell_idle', 'shell_running', 'sleeping'].map((k) => [k, `var(--st-${k})`]));
export const stateColor = (state) => STATE_COLOR[state] || 'var(--dim)';

// 그릴 로고 주소. 내 차례(묻는 중, 신뢰 대기)이고 그때의 그림이 있으면 그것을 쓴다. 로고가 없으면 null(기호를 그린다)
export function logoFor(k, state) {
  if (!k || !k.logo) return null;
  return (state === 'waiting' || state === 'trust_wait') && k.logoWait ? k.logoWait : k.logo;
}
