// 설정(ARCH 4절 I7, P6c): 트레이 상주, 가지 펼치기 상한(P8), 보관 기간과 리포 스스로 찾기(P10), 새 세션 기본값. 켜면 창을 닫아도 앱이 트레이에 남아 OS 알림을 계속 띄운다(Electron main tray.mjs).
// 판 기록에 두므로(settings.set) atrium settings와 같은 값이다. 바꾸면 settings.updated로 main과 창이 함께 따른다.
// P16: 화면 언어(영어 기본, 한국어). 고르면 창을 다시 읽지 않고 곧바로 바뀐다. 글은 사전(locales/)에 있다.
// P28: 스크롤 없이 한 화면에 들어가게 탭으로 나눴다(일반, 새 세션 Claude Code, 새 세션 Codex·DeepSeek, 잠재우기, 가지 펼치기, 보관과 리포 찾기).
//   새 세션 기본값은 한 탭에 넣으면 최소 창(900×600)에서 넘쳐 두 탭으로 나눴다.
//   줄마다 이름·값·풀이 세 칸(styles.css .mt-set-grid)이고, 체크 상자도 값 칸에 둔다. 긴 풀이는 탭 위 한 단락(.mt-set-note). 아래 텍스트 로고는 뺐다.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStore, toast } from './store.js';
import { BranchSettings } from './Branch.jsx'; // P8(K3): 가지 펼치기 상한
import { useT, tOr, errText, setLanguage, getLanguage, LANGUAGES } from './lib/i18n.js';

// 한 줄: 이름, 값, 풀이(짧은 글). 이름을 누르면 값 칸의 입력에 초점이 간다(label)
export function SetRow({ name, hint, children, role }) {
  return (
    <label className="mt-set-row" data-role={role}>
      <span className="mt-set-name">{name}</span>
      <span className="mt-set-value">{children}</span>
      <span className="mt-set-hint">{hint}</span>
    </label>
  );
}
export const SetNote = ({ children }) => <p className="mt-set-note">{children}</p>;
export const SetSub = ({ children }) => <div className="mt-set-sub">{children}</div>;
// 체크 상자 하나와 켜짐·꺼짐 글
function Toggle({ checked, onChange, field }) {
  const t = useT();
  return <span className="mt-set-toggle"><input type="checkbox" checked={checked} data-field={field} onChange={(e) => onChange(e.target.checked)} /><span>{checked ? t('settings.on') : t('settings.off')}</span></span>;
}

// P16: 화면 언어. 이름은 그 언어 자체로 보인다
const LANGUAGE_NAME = { en: 'English', ko: '한국어' };
function LanguageSetting({ settings }) {
  const t = useT();
  const value = (settings && settings.language) || getLanguage();
  const pick = async (lang) => {
    setLanguage(lang); // 백엔드 확인(settings.updated)을 기다리지 않고 곧바로
    try { await api.call('settings.set', { key: 'language', value: lang }); } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); }
  };
  return (
    <div className="mt-set-row" data-role="language-setting">
      <span className="mt-set-name">{t('settings.language')}</span>
      <span className="mt-set-value mt-seg-lang" data-field="setting-language" data-value={value} role="radiogroup">
        {LANGUAGES.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={value === l} className={`mt-btn small${value === l ? ' primary' : ' ghost'}`} data-lang={l} onClick={() => value !== l && pick(l)}>{LANGUAGE_NAME[l]}</button>
        ))}
      </span>
      <span className="mt-set-hint">{t('settings.languageHint')}</span>
    </div>
  );
}

// 일반: 언어와 트레이 상주
function GeneralTab({ settings }) {
  const t = useT();
  const [pending, setPending] = useState(null); // 누른 값(백엔드가 settings.updated로 확정할 때까지 먼저 보인다)
  const set = async (value) => {
    setPending(value);
    try { await api.call('settings.set', { key: 'tray', value }); toast(value ? t('settings.trayOn') : t('settings.trayOff')); } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); }
    setPending(null);
  };
  return (
    <div className="mt-set-grid" data-role="general-settings">
      <LanguageSetting settings={settings} />
      {settings && <>
        <SetRow name={t('settings.trayName')} hint={t('settings.tray')} role="tray-setting"><Toggle checked={pending ?? !!settings.tray} onChange={set} field="setting-tray" /></SetRow>
        <SetNote>{t('settings.trayNote')}</SetNote>
      </>}
    </div>
  );
}

// P10: 보관 기간(0이면 저절로 보관 끔)과 리포 스스로 찾기
function RecallSettings({ settings, schema }) {
  const t = useT();
  const [days, setDays] = useState(null);
  const save = async (key, value) => { try { await api.call('settings.set', { key, value }); setDays(null); toast(key === 'archiveDays' ? (Number(value) ? t('settings.archiveDaysSet', { n: value }) : t('settings.archiveOff')) : value ? t('settings.autoOpenOn') : t('settings.autoOpenOff')); } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); } };
  const sc = (schema && schema.archiveDays) || { min: 0, max: 365, default: 14 };
  return (
    <div className="mt-set-grid" data-role="recall-settings">
      <SetRow name={t('settings.archiveDays')} hint={t('settings.archiveDaysHint', { n: sc.default })}>
        <input type="number" className="mt-set-num" min={sc.min} max={sc.max} data-field="setting-archiveDays" value={days ?? settings.archiveDays} onChange={(e) => setDays(e.target.value)} onBlur={() => days != null && days !== '' && save('archiveDays', Number(days))} onKeyDown={(e) => { if (e.key === 'Enter' && days != null && days !== '') save('archiveDays', Number(days)); }} />
      </SetRow>
      <SetNote>{t('settings.archiveDaysNote')}</SetNote>
      <SetRow name={t('settings.autoOpenName')} hint={t('settings.autoOpen')}><Toggle checked={!!settings.autoOpenRepos} onChange={(v) => save('autoOpenRepos', v)} field="setting-autoOpenRepos" /></SetRow>
      <SetNote>{t('settings.autoOpenNote')}</SetNote>
    </div>
  );
}

// 새 세션 기본값: 왼쪽 레일의 Claude, Codex, DeepSeek를 누르면 이 값으로 바로 뜬다. 대화상자의 처음 값도 이것이다
function SpawnSettings({ settings, schema, part }) {
  const t = useT();
  const [draft, setDraft] = useState({}); // 치는 중인 글(모델, Codex 인자)
  const save = async (key, value) => {
    try { await api.call('settings.set', { key, value }); setDraft((d) => { const n = { ...d }; delete n[key]; return n; }); toast(t('settings.spawnSaved')); } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); }
  };
  const text = (key, placeholder) => (
    <input className="mt-set-text" data-field={`setting-${key}`} placeholder={placeholder} title={placeholder} value={draft[key] ?? settings[key] ?? ''}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      onBlur={() => draft[key] != null && save(key, draft[key])}
      onKeyDown={(e) => { if (e.key === 'Enter' && draft[key] != null) save(key, draft[key]); }} />
  );
  const opts = (key, fallback) => (schema && schema[key] && schema[key].options) || fallback;
  return (
    <div className="mt-set-grid" data-role="spawn-settings">
      <SetNote>{t('settings.spawnNote')}</SetNote>
      {part === 'claude' && <>
      <SetRow name={t('settings.claudeModel')} hint={t('settings.claudeModelHint')}>{text('claudeModel', t('settings.claudeModelPh'))}</SetRow>
      <SetRow name={t('settings.effort')} hint={t('settings.effortHint')}>
        <select value={settings.claudeEffort || ''} data-field="setting-claudeEffort" onChange={(e) => save('claudeEffort', e.target.value)}>
          {opts('claudeEffort', ['', 'low', 'medium', 'high', 'xhigh', 'max']).map((o) => <option key={o} value={o}>{o === '' ? t('settings.effortDefault') : tOr(`effortLevels.${o}`, o)}</option>)}
        </select>
      </SetRow>
      <SetRow name={t('settings.permissionMode')} hint={t('settings.permissionModeHint')}>
        <select value={settings.claudePermissionMode || 'manual'} data-field="setting-claudePermissionMode" onChange={(e) => save('claudePermissionMode', e.target.value)}>
          {opts('claudePermissionMode', ['manual', 'acceptEdits', 'plan', 'auto']).map((o) => <option key={o} value={o}>{tOr(`permissionModes.${o}`, o)}</option>)}
        </select>
      </SetRow>
      <SetRow name={t('settings.allowHerdrName')} hint={t('settings.allowHerdr')}><Toggle checked={!!settings.claudeAllowHerdr} onChange={(v) => save('claudeAllowHerdr', v)} field="setting-claudeAllowHerdr" /></SetRow>
      </>}
      {part === 'others' && <>
      <SetSub>Codex</SetSub>
      <SetRow name={t('settings.codexArgs')} hint={t('settings.codexArgsNote')}>{text('codexArgs', t('settings.codexArgsPh'))}</SetRow>
      {/* P25: DeepSeek. 직접 명령을 비우면 판이 위 모델로 Claude Code를 띄우고, 채우면 새 셸 패널에 그 명령을 그대로 친다 */}
      {settings.deepseekModel != null && <>
        <SetSub>DeepSeek</SetSub>
        <SetRow name={t('settings.deepseekModel')} hint={t('settings.deepseekModelHint')}>{text('deepseekModel', t('settings.deepseekModelPh'))}</SetRow>
        <SetRow name={t('settings.deepseekCommand')} hint={t('settings.deepseekCommandHint')}>{text('deepseekCommand', t('settings.deepseekCommandPh'))}</SetRow>
        <SetNote>{t('settings.deepseekNote')}</SetNote>
      </>}
      </>}
    </div>
  );
}

// P21(D4): 쉬면 잠재우기(분)
function SleepSetting({ settings, schema }) {
  const t = useT();
  const [v, setV] = useState(null);
  const sc = (schema && schema.sleepAfterMin) || { min: 0, max: 1440, default: 30 };
  const save = async (value) => { try { await api.call('settings.set', { key: 'sleepAfterMin', value }); setV(null); toast(value ? t('sleep.afterSet', { n: value }) : t('sleep.afterOff')); } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); } };
  return (
    <div className="mt-set-grid" data-role="sleep-settings">
      <SetRow name={t('sleep.afterLabel')} hint={t('sleep.afterHint', { n: sc.default })}>
        <input type="number" className="mt-set-num" min={sc.min} max={sc.max} data-field="setting-sleepAfterMin" value={v ?? settings.sleepAfterMin} onChange={(e) => setV(e.target.value)} onBlur={() => v != null && v !== '' && save(Number(v))} onKeyDown={(e) => { if (e.key === 'Enter' && v != null && v !== '') save(Number(v)); }} />
      </SetRow>
      <SetNote>{t('sleep.afterNote')}</SetNote>
    </div>
  );
}

// 탭: 있는 설정만(옛 백엔드면 빠진다)
const TABS = [
  { key: 'general', has: () => true },
  { key: 'spawn', has: (s) => s && s.claudePermissionMode != null },
  { key: 'agents', has: (s) => s && s.claudePermissionMode != null },
  { key: 'sleep', has: (s) => s && s.sleepAfterMin != null },
  { key: 'branch', has: (s) => s && s.branchMaxChildren != null },
  { key: 'recall', has: (s) => s && s.archiveDays != null },
];

export function SettingsDialog({ onClose }) {
  const t = useT();
  const settings = useStore((st) => st.settings);
  const [schema, setSchema] = useState(null);
  const [tab, setTab] = useState('general');
  useEffect(() => { api.call('settings.get').then((r) => setSchema(r.schema)).catch((e) => toast(t('settings.saveFailed', { error: errText(e) }), 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const tabs = TABS.filter((x) => x.has(settings));
  const cur = tabs.some((x) => x.key === tab) ? tab : 'general';
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mt-modal mt-settings" data-role="settings" data-tab={cur}>
        <h3>{t('settings.title')}</h3>
        <div className="mt-set-tabs" role="tablist" data-role="settings-tabs">
          {tabs.map((x) => <button key={x.key} type="button" role="tab" aria-selected={cur === x.key} className={`mt-set-tab${cur === x.key ? ' on' : ''}`} data-tab={x.key} onClick={() => setTab(x.key)}>{t(`settings.tab.${x.key}`)}</button>)}
        </div>
        <div className="mt-set-body" role="tabpanel">
          {!settings && <div className="dim">{t('settings.loading')}</div>}
          {cur === 'general' && <GeneralTab settings={settings} />}
          {settings && cur === 'spawn' && <SpawnSettings settings={settings} schema={schema} part="claude" />}
          {settings && cur === 'agents' && <SpawnSettings settings={settings} schema={schema} part="others" />}
          {settings && cur === 'sleep' && <SleepSetting settings={settings} schema={schema} />}
          {settings && cur === 'branch' && <BranchSettings settings={settings} schema={schema} />}
          {settings && cur === 'recall' && <RecallSettings settings={settings} schema={schema} />}
        </div>
        <div className="mt-card-actions"><button className="mt-btn" data-action="settings-close" onClick={onClose}>{t('common.close')}</button></div>
      </div>
    </div>
  );
}
