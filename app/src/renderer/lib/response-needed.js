// 응답 안내용 읽기 전용 모델. 승인 키나 답변을 만들지 않는다.
import { askLine } from './labels.js';
import { t } from './i18n.js';

const clean = (value) => String(value || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim();
export function responseNeeded(s) {
  if (!s || s.kind === 'shell') return null;
  const a = s.ask || {};
  if (!['waiting', 'trust_wait', 'error'].includes(s.state)) return null;
  const detail = clean(a.summary || a.tail || a.text || '');
  let kind = s.state === 'error' ? 'error' : s.state === 'trust_wait' ? 'trust' : a.kind === 'question' ? 'question' : 'terminal';
  if (kind === 'terminal' && (a.kind === 'trust' || /(?:trust (?:this |the )?(?:folder|directory|workspace)|폴더.{0,12}신뢰)/i.test(detail))) kind = 'trust';
  if (kind === 'terminal' && (['login', 'auth', 'authentication'].includes(a.kind) || /(?:sign[ -]?in|log[ -]?in|authenticate|로그인|인증 코드)/i.test(detail))) kind = 'login';
  const context = kind === 'error' ? clean(s.error?.message || s.error?.type || (typeof s.error === 'string' ? s.error : '')) : detail || askLine(s);
  return { kind, title: t(`response.${kind}`), context: context.slice(0, 800), hint: t('response.hint') };
}
