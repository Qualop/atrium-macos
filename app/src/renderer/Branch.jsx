// P8(K3·K4): 가지 펼치기의 화면. 노드 머리줄의 "@lead의 워커 · 2단계" 표시, 상한에 막힌 하위 세션 요청 알림, 설정 대화상자의 상한 칸.
// 하위 세션은 판이 띄운 세션이 atrium child로 만든다(창에는 만드는 단추가 없다). 선은 역할 선(Links.jsx) 그대로다.
import { useState } from 'react';
import { api } from './api.js';
import { toast } from './store.js';
import { branchLabel } from './lib/branch.js';
import { useT, t, errText } from './lib/i18n.js';

export function BranchBadge({ s, short = false }) {
  useT();
  const l = branchLabel(s);
  if (!l) return null;
  return <span className="mt-badge branch" data-role="branch" data-depth={s.branch.depth} title={l.title}>{short ? l.short : l.text}</span>;
}

// 상한을 넘어 거부된 요청(판 이벤트 branch_refused)을 사람에게도 알린다
const REFUSED = ['too_many_children', 'too_deep', 'board_full', 'not_parent'];
api.on('branch.refused', (d) => toast(t('branch.refused', { name: d.name, code: REFUSED.includes(d.code) ? t(`branch.refusedCode.${d.code}`) : d.code, limit: d.limit ? ` ${d.limit}` : '', reason: d.reason }), 'warn'));

const KEYS = ['branchMaxChildren', 'branchMaxDepth', 'branchMaxTotal'];
export function BranchSettings({ settings, schema }) {
  const t = useT();
  const [draft, setDraft] = useState({});
  const save = async (k) => {
    const v = draft[k];
    if (v == null || v === '') return;
    try { await api.call('settings.set', { key: k, value: Number(v) }); setDraft((d) => d[k] === v ? { ...d, [k]: undefined } : d); toast(t('branch.saved')); } catch (e) { toast(t('branch.settingError', { error: errText(e) }), 'error'); }
  };
  // P28: 설정 탭의 세 칸 줄(이름·값·풀이, Settings.jsx와 같은 모양)
  return (
    <div className="mt-set-grid" data-role="branch-settings">
      <p className="mt-set-note">{t('branch.settingsHelp')}</p>
      {KEYS.map((k) => {
        const label = t(`branch.key.${k}`);
        const sc = schema && schema[k];
        return (
          <label key={k} className="mt-set-row">
            <span className="mt-set-name">{label}</span>
            <span className="mt-set-value"><input type="number" className="mt-set-num" min={sc ? sc.min : 1} max={sc ? sc.max : 64} data-field={`setting-${k}`} value={draft[k] ?? (settings && settings[k]) ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} onBlur={() => save(k)} onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.keyCode !== 229 && e.key === 'Enter') save(k); }} /></span>
            <span className="mt-set-hint">{sc ? t('branch.range', { min: sc.min, max: sc.max, def: sc.default }) : ''}</span>
          </label>
        );
      })}
    </div>
  );
}
