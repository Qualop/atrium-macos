// P25: DeepSeek 세션. 왼쪽 레일에서 바로 띄운다(BRIEF "에이전트 종류").
// - 기본 실행: 판이 띄우는 Claude Code 세션(종류 claude, hook·이어 가기·승인 줄·잠재우기가 그대로 붙는다)이고 모델만 opencodex 프록시의 DeepSeek 모델이다.
//   세션 설정 파일의 env로 Claude Code를 프록시 주소에 붙이고(proxyEnv), 프록시가 이 모델 이름을 DeepSeek로 보낸다.
//   저장은 종류 claude에 flavor 'deepseek'을 더한다(표시만 DeepSeek). 시작 전에 프록시의 health 주소를 보고, 돌지 않으면 알기 쉬운 오류를 낸다. 판이 프록시를 켜지 않는다.
// - 직접 명령(설정 deepseekCommand): 판이 새 셸 패널에 그 PowerShell 명령 한 줄을 그대로 친다. 판이 덧붙이는 인자는 없다.
//   그 패널에 에이전트가 나타나면 셸에서 띄운 에이전트처럼(hook 없음, F3·G2) 다룬다. 표시는 DeepSeek이다.

export const FLAVOR = 'deepseek';
export const DEFAULT_MODEL = 'ocx-claude-deepseek--deepseek-flash[1m]';
export const DEFAULT_HEALTH_URL = 'http://127.0.0.1:10100/healthz'; // `ocx status`가 보이는 health 주소
export const COMMAND_MAX = 400;

// 판의 세션 설정 파일(--settings)의 env. 사용자의 Claude Code는 HTTPS_PROXY로 프록시를 거치지만, 그 길(CLI first-party 가로채기)은
// Anthropic 모델만 그대로 넘기고 DeepSeek 모델 이름은 Anthropic으로 가서 model_not_found가 난다(P25 실험).
// `ocx claude`처럼 ANTHROPIC_BASE_URL을 프록시의 로컬 주소로 두면 프록시가 모델 이름으로 DeepSeek에 보낸다. 구독 방식이라 토큰은 넣지 않는다.
// 설정 파일은 이어 가기·깨우기·되살리기 인자에도 들어가므로 어느 길로 다시 띄워도 같은 env다.
export function proxyEnv(baseUrl) { return { ANTHROPIC_BASE_URL: baseUrl, CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1' }; }
// 프록시 주소: 따로 주지 않으면 health 주소의 origin(`ocx status`의 Health와 같은 포트)
export const baseUrlOf = ({ baseUrl = null, healthUrl = DEFAULT_HEALTH_URL } = {}) => baseUrl || new URL(healthUrl).origin;

const err = (code, message, key, vars = {}) => Object.assign(new Error(message), { code, key, vars });

// 직접 명령 글 검사: 한 줄(줄바꿈과 제어 글자 없음), 길이 제한. 앞뒤 빈칸은 뗀다. 빈 글이면 ''(기본 실행)
export function checkCommand(text) {
  const c = String(text ?? '').trim();
  if (c.length > COMMAND_MAX) throw err('bad_request', `실행 명령이 너무 깁니다 (${c.length}자, ${COMMAND_MAX}자까지)`, 'deepseekCommandLong', { n: c.length, max: COMMAND_MAX });
  if (/[\x00-\x1f\x7f]/.test(c)) throw err('bad_request', "실행 명령은 줄바꿈, 탭, 제어 문자 없이 한 줄로 입력하세요.", 'deepseekCommandLine');
  return c;
}

// 프록시가 도는지(health 주소가 2초 안에 ok를 주는지). 안 돌면 오류 deepseek_proxy_down
export async function checkProxy({ url = DEFAULT_HEALTH_URL, timeoutMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  let why;
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) {
      const body = await r.json().catch(() => null);
      if (!body || body.status == null || body.status === 'ok') return { ok: true, url };
      why = `status ${body.status}`;
    } else why = `HTTP ${r.status}`;
  } catch (e) { why = e && e.name === 'TimeoutError' ? 'timeout' : (e && (e.cause && e.cause.code)) || (e && e.message) || 'unreachable'; }
  throw err('deepseek_proxy_down', `opencodex 프록시가 실행 중이 아닙니다 (${url}: ${why}). PowerShell에서 \`ocx status\`로 상태를 확인하고 \`ocx start\`로 실행한 뒤 다시 시도하세요.`, 'deepseekProxyDown', { url, why });
}
