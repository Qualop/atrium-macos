import { modelFromArgs } from '../../../../backend/src/codex-args.mjs';

export const hasModelCatalog = (kind) => kind === 'codex' || kind === 'gemini' || kind === 'agy';

// 다른 종류에 Claude의 모델·개발용 기본값을 물려주지 않는다.
export function spawnDefaults(kind, settings = {}, info = {}) {
  const args = settings[`${kind}Args`] || '';
  const model = kind === 'claude' ? settings.claudeModel || info.defaultModel || ''
    : kind === 'codex' ? modelFromArgs(args)
    : settings[`${kind}Model`] || '';
  return { model, args };
}
