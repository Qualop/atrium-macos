// 설정(ARCH 4절 I7, P6c): 트레이 상주, 가지 펼치기 상한(P8), 보관 기간과 리포 스스로 찾기(P10), 새 세션 기본값. 켜면 창을 닫아도 앱이 트레이에 남아 OS 알림을 계속 띄운다(Electron main tray.mjs).
// 판 기록에 두므로(settings.set) atrium settings와 같은 값이다. 바꾸면 settings.updated로 main과 창이 함께 따른다.
// P16: 화면 언어(영어 기본, 한국어). 고르면 창을 다시 읽지 않고 곧바로 바뀐다. 글은 사전(locales/)에 있다.
// P45: 일반 탭에 화면 배율과 터미널 글자 배율(이 창의 localStorage, lib/scale.js).
// P28: 스크롤 없이 한 화면에 들어가게 탭으로 나눴다(일반, 호출자, 잠재우기, 가지 펼치기, 보관과 리포 찾기).
//   P33: 옛 새 세션 기본값 두 탭은 호출자 탭(Launchers.jsx) 하나가 대신한다.
//   줄마다 이름·값·풀이 세 칸(styles.css .mt-set-grid)이고, 체크 상자도 값 칸에 둔다. 긴 풀이는 탭 위 한 단락(.mt-set-note). 아래 텍스트 로고는 뺐다.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, getState, toast, setTermScale, setUiScale } from './store.js';
import { pctOf, parsePct, stepScale, SCALE_MIN, SCALE_MAX, SCALE_STEP } from './lib/scale.js'; // P45
import { useT, errText, setLanguage, getLanguage, LANGUAGES } from './lib/i18n.js';
import { LaunchersTab } from './Launchers.jsx'; // P33: 호출자 탭
import { DevicesTab } from './WebDevices.jsx'; // P48: 연결된 기기(웹 화면)
import { useDialog } from './dialog.js'; // P52
import { BranchSettings } from './Branch.jsx';

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
function LanguageSetting() {
  const t = useT();
  const value = getLanguage();
  const request = useRef(0);
  const pick = async (lang) => {
    const id = ++request.current, previous = getLanguage();
    setLanguage(lang); // 백엔드 확인(settings.updated)을 기다리지 않고 곧바로
    try { await api.call('settings.set', { key: 'language', value: lang }); }
    catch (e) {
      if (id === request.current && getLanguage() === lang) setLanguage(getState().settings?.language || previous);
      toast(t('settings.saveFailed', { error: errText(e) }), 'error');
    }
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

// P45: 터미널 글자 배율과 화면 배율. 이 창에만 둔다(판 설정이 아니다). −·+는 5%씩, 칸에 백분율을 적고 Enter. 바꾸면 곧바로 보인다
function ScaleSetting({ kind }) {
  const t = useT();
  const value = useStore((st) => (kind === 'term' ? st.termScale : st.uiScale));
  const [text, setText] = useState(null);
  const set = kind === 'term' ? setTermScale : setUiScale;
  const field = kind === 'term' ? 'termScale' : 'uiScale';
  const apply = () => { if (text == null) return; const f = parsePct(text); if (f != null) set(f); setText(null); };
  return (
    <div className="mt-set-row" data-role={`${field}-setting`}>
      <span className="mt-set-name">{t(`scale.${kind}Name`)}</span>
      <span className="mt-set-value mt-scale">
        <button type="button" className="mt-btn small ghost" data-action={`${field}-down`} disabled={value <= SCALE_MIN} title={t('scale.down')} onClick={() => set(stepScale(value, -1))}>−</button>
        <input type="number" className="mt-set-num mt-scale-num" min={SCALE_MIN * 100} max={SCALE_MAX * 100} step={SCALE_STEP * 100} data-field={`setting-${field}`} data-value={pctOf(value)}
          value={text ?? pctOf(value)} onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.keyCode !== 229 && e.key === 'Enter') { e.preventDefault(); apply(); } }} />
        <span className="mt-scale-pct">%</span>
        <button type="button" className="mt-btn small ghost" data-action={`${field}-up`} disabled={value >= SCALE_MAX} title={t('scale.up')} onClick={() => set(stepScale(value, 1))}>+</button>
        <button type="button" className="mt-btn small ghost" data-action={`${field}-reset`} disabled={value === 1} onClick={() => set(1)}>{t('scale.reset')}</button>
      </span>
      <span className="mt-set-hint">{t(`scale.${kind}Hint`, { min: SCALE_MIN * 100, max: SCALE_MAX * 100 })}</span>
    </div>
  );
}

// 일반: 언어, 배율(P45), 트레이 상주
function GeneralTab({ settings }) {
  const t = useT();
  const [pending, setPending] = useState(null); // 누른 값(백엔드가 settings.updated로 확정할 때까지 먼저 보인다)
  const request = useRef(0);
  const set = async (value) => {
    const id = ++request.current;
    setPending(value);
    try { await api.call('settings.set', { key: 'tray', value }); toast(value ? t('settings.trayOn') : t('settings.trayOff')); } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); }
    if (id === request.current) setPending(null);
  };
  return (
    <div className="mt-set-grid" data-role="general-settings">
      <LanguageSetting />
      <ScaleSetting kind="ui" />
      <ScaleSetting kind="term" />
      {settings && <>
        <SetRow name={t('settings.trayName')} hint={t('settings.tray')} role="tray-setting"><Toggle checked={pending ?? !!settings.tray} onChange={set} field="setting-tray" /></SetRow>
        <SetNote>{t('settings.trayNote')}</SetNote>
        {'herdrPath' in settings && <HerdrPathSetting settings={settings} />}
      </>}
    </div>
  );
}

// P40: herdr 실행 파일 경로. 비우면 찾는다(ATRIUM_HERDR 다음 순서). 저장하면 백엔드가 다시 찾고, 못 붙어 있었으면 서버를 띄워 붙는다
function HerdrPathSetting({ settings }) {
  const t = useT();
  const herdr = useStore((st) => st.herdr);
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (v == null) return;
    setBusy(true);
    try {
      const r = await api.call('settings.set', { key: 'herdrPath', value: v });
      setV((current) => current === v ? null : current);
      const h = r && r.herdr;
      if (h && h.connected) toast(t('settings.herdrPathOk', { path: h.path || '' }));
      else if (h && (h.missing || h.level === 'missing')) toast(t('warn.herdrStillMissing'), 'error');
      else toast(t('settings.herdrPathSaved'));
    } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); }
    setBusy(false);
  };
  const chosen = herdr && herdr.find && herdr.find.chosen;
  const now = herdr && herdr.path ? t('settings.herdrPathNow', { path: herdr.path, version: herdr.version ? ` ${herdr.version}` : '', source: chosen ? t(`settings.herdrFrom.${chosen.source}`) : '' }) : t('settings.herdrPathNone');
  return <>
    <SetRow name={t('settings.herdrPathName')} hint={t('settings.herdrPathHint')} role="herdr-path-setting">
      <span className="mt-set-path">
        <input type="text" className="mt-set-text" spellCheck={false} data-field="setting-herdrPath" placeholder={t('settings.herdrPathPlaceholder')} value={v ?? settings.herdrPath ?? ''} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.keyCode !== 229 && e.key === 'Enter') { e.preventDefault(); save(); } }} />
        <button type="button" className="mt-btn small" data-action="herdr-path-save" disabled={busy || v == null} onClick={save}>{t('settings.herdrPathSave')}</button>
      </span>
    </SetRow>
    <SetNote><span data-role="herdr-path-now">{now}</span> {t('settings.herdrPathNote')}</SetNote>
  </>;
}

// P10: 보관 기간(0이면 저절로 보관 끔)과 리포 스스로 찾기
function RecallSettings({ settings, schema }) {
  const t = useT();
  const [days, setDays] = useState(null);
  const save = async (key, value) => { try { await api.call('settings.set', { key, value }); setDays((current) => key === 'archiveDays' && current === days ? null : current); toast(key === 'archiveDays' ? (Number(value) ? t('settings.archiveDaysSet', { n: value }) : t('settings.archiveOff')) : value ? t('settings.autoOpenOn') : t('settings.autoOpenOff')); } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); } };
  const sc = (schema && schema.archiveDays) || { min: 0, max: 365, default: 14 };
  return (
    <div className="mt-set-grid" data-role="recall-settings">
      <SetRow name={t('settings.archiveDays')} hint={t('settings.archiveDaysHint', { n: sc.default })}>
        <input type="number" className="mt-set-num" min={sc.min} max={sc.max} data-field="setting-archiveDays" value={days ?? settings.archiveDays} onChange={(e) => setDays(e.target.value)} onBlur={() => days != null && days !== '' && save('archiveDays', Number(days))} onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.keyCode !== 229 && e.key === 'Enter' && days != null && days !== '') save('archiveDays', Number(days)); }} />
      </SetRow>
      <SetNote>{t('settings.archiveDaysNote')}</SetNote>
      <SetRow name={t('settings.autoOpenName')} hint={t('settings.autoOpen')}><Toggle checked={!!settings.autoOpenRepos} onChange={(v) => save('autoOpenRepos', v)} field="setting-autoOpenRepos" /></SetRow>
      <SetNote>{t('settings.autoOpenNote')}</SetNote>
    </div>
  );
}

// P21(D4): 쉬면 잠재우기(분)
function SleepSetting({ settings, schema }) {
  const t = useT();
  const [v, setV] = useState(null);
  const sc = (schema && schema.sleepAfterMin) || { min: 0, max: 1440, default: 30 };
  const save = async (value) => { try { await api.call('settings.set', { key: 'sleepAfterMin', value }); setV((current) => current != null && Number(current) === value ? null : current); toast(value ? t('sleep.afterSet', { n: value }) : t('sleep.afterOff')); } catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); } };
  return (
    <div className="mt-set-grid" data-role="sleep-settings">
      <SetRow name={t('sleep.afterLabel')} hint={t('sleep.afterHint', { n: sc.default })}>
        <input type="number" className="mt-set-num" min={sc.min} max={sc.max} data-field="setting-sleepAfterMin" value={v ?? settings.sleepAfterMin} onChange={(e) => setV(e.target.value)} onBlur={() => v != null && v !== '' && save(Number(v))} onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.keyCode !== 229 && e.key === 'Enter' && v != null && v !== '') save(Number(v)); }} />
      </SetRow>
      <SetNote>{t('sleep.afterNote')}</SetNote>
    </div>
  );
}

// 탭: 있는 설정만(옛 백엔드면 빠진다)
const TABS = [
  { key: 'general', has: () => true },
  { key: 'launchers', has: (s, l) => !!l, label: 'launchers.tab' }, // P33: 옛 "새 세션" 두 탭(Claude Code, Codex·DeepSeek)을 대신한다
  { key: 'sleep', has: (s) => s && s.sleepAfterMin != null },
  { key: 'branch', has: (s) => s && s.branchMaxChildren != null },
  { key: 'recall', has: (s) => s && s.archiveDays != null },
  { key: 'devices', has: () => true, label: 'webDevices.tab' }, // P48
];

export function SettingsDialog({ onClose }) {
  const t = useT();
  const settings = useStore((st) => st.settings);
  const launchers = useStore((st) => st.launchers);
  const [schema, setSchema] = useState(null);
  const [tab, setTab] = useState('general');
  useEffect(() => { api.call('settings.get').then((r) => setSchema(r.schema)).catch((e) => toast(t('settings.saveFailed', { error: errText(e) }), 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const box = useDialog(onClose); // P52: Esc 닫기는 공용(dialog.js). 열면 상자에 초점, Tab은 안에서 돈다
  const tabs = TABS.filter((x) => x.has(settings, launchers));
  const cur = tabs.some((x) => x.key === tab) ? tab : 'general';
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="mt-modal mt-settings" data-role="settings" data-tab={cur}>
        <h3>{t('settings.title')}</h3>
        <div className="mt-set-tabs" role="tablist" data-role="settings-tabs">
          {tabs.map((x) => <button key={x.key} type="button" role="tab" aria-selected={cur === x.key} className={`mt-set-tab${cur === x.key ? ' on' : ''}`} data-tab={x.key} onClick={() => setTab(x.key)}>{t(x.label || `settings.tab.${x.key}`)}</button>)}
        </div>
        <div className="mt-set-body" role="tabpanel">
          {!settings && <div className="dim">{t('settings.loading')}</div>}
          {cur === 'general' && <GeneralTab settings={settings} />}
          {cur === 'launchers' && <LaunchersTab />}
          {settings && cur === 'sleep' && <SleepSetting settings={settings} schema={schema} />}
          {settings && cur === 'branch' && <BranchSettings settings={settings} schema={schema} />}
          {settings && cur === 'recall' && <RecallSettings settings={settings} schema={schema} />}
          {cur === 'devices' && <DevicesTab />}
        </div>
        <div className="mt-card-actions"><button className="mt-btn" data-action="settings-close" onClick={onClose}>{t('common.close')}</button></div>
      </div>
    </div>
  );
}
