// macOS 판: 노드 머리에서 모델·추론 바꾸기(session.setModel). Claude Code의 /model, /effort를 그 터미널에 넣는다.
// 슬래시 명령은 UserPromptSubmit hook이 없어 판의 전달 대기열(제출 확인 30초, 다시 보내기)에 넣지 않고 바로 친다.
// 쉬는 중(ready)이면 바로, 일하는 중이면 그 턴이 끝나 쉬게 될 때 친다(마지막으로 고른 값 하나만 남긴다).
// 바뀐 값은 대화 기록의 "Set model to …"·"Set effort level to …" 줄을 model-now.mjs가 읽어 머리에 보인다.
import { deriveState } from './state.mjs';
import { EFFORTS } from './settings.mjs';

export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,79}$/;
const STEP_MS = 900; // /model 뒤 /effort까지(앞 명령이 끝나기를 기다린다)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = (msg) => Object.assign(new Error(msg), { code: 'bad_request' });

// 입력을 고른다 → { model, effort } (없는 것은 null)
export function modelChoice(p = {}) {
  const model = p.model == null || p.model === '' ? null : String(p.model).trim();
  const effort = p.effort == null || p.effort === '' ? null : String(p.effort).trim().toLowerCase();
  if (!model && !effort) throw bad('바꿀 모델이나 추론 수준을 주세요.');
  if (model && !MODEL_RE.test(model)) throw bad(`모델 이름이 올바르지 않습니다: ${model.slice(0, 40)}`);
  if (effort && !EFFORTS.includes(effort)) throw bad(`추론 수준은 ${EFFORTS.filter(Boolean).join(', ')} 가운데 하나입니다.`);
  return { model, effort };
}
export const switchLines = ({ model, effort }) => [...(model ? [`/model ${model}`] : []), ...(effort ? [`/effort ${effort}`] : [])];

export class ModelSwitch {
  constructor(b, { stepMs = STEP_MS } = {}) { this.b = b; this.stepMs = stepMs; this.pending = new Map(); }
  async request(s, p) {
    if ((s.kind || 'claude') !== 'claude') throw Object.assign(new Error(`@${s.name}: 모델 바꾸기는 Claude Code 세션만 됩니다.`), { code: 'not_claude' });
    const want = modelChoice(p);
    const st = deriveState(s.rt).state;
    if (st === 'ready' || st === 'error') return { applied: true, ...(await this.apply(s, want)) };
    if (['exited', 'sleeping'].includes(st)) throw Object.assign(new Error(`@${s.name}이(가) ${st === 'sleeping' ? '잠들어' : '끝나'} 있어 바꾸지 못했습니다.`), { code: 'not_running' });
    const prev = this.pending.get(s.sessionId) || {};
    this.pending.set(s.sessionId, { model: want.model || prev.model || null, effort: want.effort || prev.effort || null });
    this.b.store.addEvent(s.sessionId, 'model_switch_pending', { ...this.pending.get(s.sessionId), state: st });
    return { applied: false, pending: this.pending.get(s.sessionId), state: st };
  }
  async apply(s, want) {
    const lines = switchLines(want);
    for (let i = 0; i < lines.length; i++) {
      if (i) await sleep(this.stepMs);
      await this.b.sendPrompt(s.sessionId, lines[i]);
    }
    this.b.store.addEvent(s.sessionId, 'model_switch', { model: want.model, effort: want.effort });
    this.b.log(`model switch ${s.name}: ${lines.join(' ; ')}`);
    return { sent: lines };
  }
  // 상태가 바뀔 때(backend.broadcastSession) 부른다. 기다리던 값이 있고 이제 쉬면 친다
  onState(s, state) {
    const want = this.pending.get(s.sessionId);
    if (!want) return;
    if (state === 'exited' || state === 'sleeping') { this.pending.delete(s.sessionId); return; }
    if (state !== 'ready') return;
    this.pending.delete(s.sessionId);
    this.apply(s, want).catch((e) => this.b.log(`model switch ${s.name} failed: ${e.code || e.message}`));
  }
}
