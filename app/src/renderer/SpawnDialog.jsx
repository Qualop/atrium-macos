// 새 세션 시작(ARCH 4절 B3): 이름, 폴더, 모델, 권한 모드, 첫 지시. 처음 쓰는 폴더면 신뢰 확인이 필요하다고 미리 보여준다.
// herdr가 아는 에이전트 종류를 고른다. 모델 목록과 실행 인자는 종류별로 받고, hook 지원 여부는 세션 정보에 따른다.
// P5: 폴더는 지금 워크스페이스의 저장소 루트가 기본이다. 다른 저장소의 폴더를 고르면 그 세션은 그 저장소의 워크스페이스에 생긴다(G1).
//     종류 "셸(PowerShell)"은 에이전트 없이 패널만 연다(G2).
// P25: 종류 DeepSeek은 모델(설정 deepseekModel)과 직접 명령(deepseekCommand)을 받는다. 직접 명령을 채우면 hook 없는 세션이라 권한 모드와 첫 지시를 받지 않는다.
// 왼쪽 레일의 Claude, Codex, Gemini, DeepSeek, 셸은 이 대화상자 없이 quickSpawn으로 바로 띄운다. 값은 설정의 새 세션 기본값이다.
//     대화상자는 Shift+누르기, 칩 "새 세션…", 영역·그룹의 "+ 세션"으로 연다. 처음 값도 설정의 기본값이다.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { toast, getState, wsName, openDialog, goWhenOpen } from './store.js';
import { useT, t, tOr, errText } from './lib/i18n.js';
import { kindOf } from './lib/kinds.js';
import { hasModelCatalog, spawnDefaults } from './lib/spawn.js';

// P25: DeepSeek는 herdr 종류가 아니다. 백엔드가 설정의 deepseek*로 판의 Claude Code(모델만 DeepSeek)나 직접 명령(새 셸 패널)으로 띄운다
const DEEPSEEK = 'deepseek';

const startedText = (r) => t('spawn.started', { name: r.name, kind: r.flavor ? t('spawn.startedKind', { kind: kindOf(r.flavor).label + (r.command ? t('spawn.startedCommand') : '') }) : r.kind && r.kind !== 'claude' ? t('spawn.startedKind', { kind: r.kind === 'shell' ? t('spawn.shell') : kindOf(r.kind).label }) : '', trust: r.trust && r.trust.needsTrust ? t('spawn.startedTrust') : '', ws: r.workspaceKey && r.workspaceKey !== getState().currentWs ? t('spawn.startedWs', { ws: wsName(r.workspaceKey) || r.workspaceRoot }) : '' });

let quickBusy = false;
// 지금 워크스페이스의 폴더에 설정의 기본값으로 띄우고 그 터미널로 들어간다. 지금 워크스페이스가 없으면 폴더를 묻는 대화상자를 연다
export async function quickSpawn(kind) {
  const st = getState();
  const cur = st.workspaces.find((w) => w.key === st.currentWs);
  if (!cur) { openDialog({ kind: 'spawn', agentKind: kind }); return; }
  if (quickBusy) return;
  quickBusy = true;
  const p = { cwd: cur.root, kind };
  const info = api.info || {};
  if (kind === 'claude' && !(st.settings && st.settings.claudeModel) && info.defaultModel) p.model = info.defaultModel; // 개발용 판은 haiku
  try { const r = await api.call('session.spawn', p); toast(startedText(r)); goWhenOpen(r.sessionId); }
  catch (e) { toast(t('spawn.failed', { error: errText(e) }), 'error'); }
  quickBusy = false;
}

// cwd: 영역 이름표의 "+ 세션"에서 열면 그 워크스페이스의 폴더(P6a)
// agentKind: 왼쪽 레일의 단추로 열면 그 종류를 먼저 고른다
export function SpawnDialog({ onClose, cwd: cwd0 = null, agentKind = 'claude' }) {
  const t = useT();
  const info = api.info || {};
  const def = getState().settings || {};
  const cur = getState().workspaces.find((w) => w.key === getState().currentWs);
  const [cwd, setCwd] = useState(cwd0 || (cur && cur.root) || info.defaultCwd || '');
  const [name, setName] = useState('');
  const [kind, setKind] = useState(agentKind || 'claude');
  const [kinds, setKinds] = useState([{ kind: agentKind || 'claude', installed: true }]);
  const defaultsFor = (k) => spawnDefaults(k, def, info);
  const [model, setModel] = useState(() => defaultsFor(kind).model);
  const [mode, setMode] = useState(def.claudePermissionMode || 'manual');
  const [args, setArgs] = useState(() => defaultsFor(kind).args);
  const [command, setCommand] = useState(def.deepseekCommand || '');
  const [allowHerdr, setAllowHerdr] = useState(!!def.claudeAllowHerdr);
  const [prompt, setPrompt] = useState('');
  const [trust, setTrust] = useState(null);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState({ status: 'loading', models: [], source: null });
  const [refreshModels, setRefreshModels] = useState(0);
  const [customModel, setCustomModel] = useState(false);
  const deepseek = kind === DEEPSEEK;
  const direct = deepseek && !!command.trim(); // 직접 명령: 새 셸 패널에 그대로 친다(hook 없음)
  const claude = kind === 'claude' || (deepseek && !direct);
  const shell = kind === 'shell';
  const modelPicker = hasModelCatalog(kind);
  const kindLabel = kindOf(kind).label;
  const pickKind = (k) => { setKind(k); const defaults = defaultsFor(k); setArgs(defaults.args); setModel(defaults.model); setCustomModel(false); setCatalog({ status: 'loading', models: [], source: null }); };
  const manualModel = customModel || (!!model && catalog.status !== 'loading' && !catalog.models.some((m) => m.id === model));

  useEffect(() => {
    if (!hasModelCatalog(kind)) return;
    let alive = true;
    setCatalog({ status: 'loading', models: [], source: null });
    api.call('agent.models', { kind }).then((r) => { if (alive) setCatalog({ status: r.models.length ? 'ready' : 'empty', models: r.models, source: r.source || null }); })
      .catch(() => { if (alive) setCatalog({ status: 'error', models: [], source: null }); });
    return () => { alive = false; };
  }, [kind, refreshModels]);

  useEffect(() => { api.call('agent.kinds').then((ks) => setKinds([...ks].sort((a, b) => (b.installed - a.installed) || (a.kind === 'claude' ? -1 : b.kind === 'claude' ? 1 : 0)))).catch(() => {}); }, []);
  useEffect(() => {
    if (!cwd || !claude) return setTrust(null);
    const tm = setTimeout(() => api.call('trust.predict', { cwd }).then(setTrust).catch(() => setTrust(null)), 250);
    return () => clearTimeout(tm);
  }, [cwd, claude]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = { cwd, name: name.trim() || undefined, kind, prompt: shell || direct ? undefined : prompt.trim() || undefined };
      if (deepseek) p.command = command.trim(); // 빈 글이면 기본 실행(설정의 직접 명령보다 이 값이 먼저다)
      if (claude) Object.assign(p, { model: model.trim() || undefined, permissionMode: mode, allowHerdr });
      else if (!shell && !deepseek) { p.args = args.trim(); if (modelPicker) p.model = model.trim(); }
      const r = await api.call('session.spawn', p);
      toast(startedText(r));
      onClose();
      goWhenOpen(r.sessionId);
    } catch (err) { toast(t('spawn.failed', { error: errText(err) }), 'error'); setBusy(false); }
  }

  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="mt-modal" onSubmit={submit} data-role="spawn">
        <h3>{t('spawn.title')}</h3>
        <label>{t('spawn.folder')}<input value={cwd} onChange={(e) => setCwd(e.target.value)} data-field="cwd" /></label>
        {claude && trust && trust.needsTrust && <div className="mt-warn">{t('spawn.trustNeeded')}</div>}
        {claude && trust && trust.needsTrust === false && <div className="mt-ok">{t('spawn.trusted', { by: trust.trustedBy })}</div>}
        <div className="mt-row">
          <label>{t('spawn.name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('spawn.namePh')} data-field="name" /></label>
          <label>{t('spawn.kind')}
            <select value={kind} onChange={(e) => pickKind(e.target.value)} data-field="kind">
              <option value="shell">{t('spawn.shellOption')}</option>
              {kinds.filter((k) => k.kind !== 'shell' && k.kind !== DEEPSEEK).map((k) => <option key={k.kind} value={k.kind} disabled={!k.installed}>{kindOf(k.kind).label}{k.installed ? '' : t('spawn.notInstalled')}</option>)}
              <option value={DEEPSEEK}>{t('spawn.deepseekOption')}</option>
            </select>
          </label>
        </div>
        <div className="mt-card-sub">{t('spawn.nameHelp')}</div>
        {deepseek && <>
          <label>{t('spawn.deepseekCommand')}<input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('spawn.deepseekCommandPh')} data-field="deepseek-command" /></label>
          <div className="mt-card-sub" data-role="deepseek-note">{direct ? t('spawn.deepseekDirectNote') : t('spawn.deepseekNote')}</div>
        </>}
        {shell ? <div className="mt-card-sub" data-role="shell-note">{t('spawn.shellNote')}</div> : direct ? null : claude ? <>
          <div className="mt-row">
            <label>{t('spawn.model')}<input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('spawn.modelPh')} data-field="model" /></label>
            <label>{t('spawn.mode')}
              <select data-field="permission-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                {['manual', 'acceptEdits', 'plan', 'auto', ...(['manual', 'acceptEdits', 'plan', 'auto'].includes(mode) ? [] : [mode])].map((m) => <option key={m} value={m}>{tOr(`permissionModes.${m}`, m)}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-check"><input type="checkbox" checked={allowHerdr} onChange={(e) => setAllowHerdr(e.target.checked)} data-field="allow-herdr" /><span>{t('settings.allowHerdrName')}</span></label>
          <div className="mt-card-sub">{t('spawn.allowHerdr')}</div>
        </> : <>
          {modelPicker ? <>
            <label>{t('spawn.model')}
              <select data-field="model-select" aria-describedby="spawn-model-status" value={manualModel ? '__custom__' : model} onChange={(e) => {
                const v = e.target.value; setCustomModel(v === '__custom__'); if (v !== '__custom__') setModel(v);
              }}>
                <option value="">{t('spawn.modelDefault', { kind: kindLabel })}</option>
                {catalog.status === 'loading' && model && <option value={model}>{model}</option>}
                {catalog.models.map((m) => <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>)}
                <option value="__custom__">{t('spawn.modelCustom')}</option>
              </select>
            </label>
            <div id="spawn-model-status" className="mt-card-sub" role="status" data-role="model-status" data-status={catalog.status} data-source={catalog.source || undefined}>
              {t(`spawn.modelList_${catalog.status}`, { kind: kindLabel })}{' '}
              <button type="button" className="mt-btn small ghost" disabled={catalog.status === 'loading'} onClick={() => setRefreshModels((n) => n + 1)} data-action="models-refresh">{t('spawn.modelRefresh')}</button>
            </div>
            {manualModel && <label>{t('spawn.modelId')}<input data-field="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('spawn.modelIdPh')} /></label>}
            <details data-role="advanced-args"><summary>{t('spawn.advanced')}</summary>
              <label>{t('spawn.extraArgs')}<input value={args} onChange={(e) => setArgs(e.target.value)} placeholder={kind === 'codex' ? '-c model_reasoning_effort=high' : undefined} data-field="args" /></label>
              <div className="mt-card-sub">{t('spawn.modelOverridesArgs')}</div>
            </details>
          </> : <label>{t('spawn.args')}<input value={args} onChange={(e) => setArgs(e.target.value)} data-field="args" /></label>}
          <div className="mt-card-sub" data-role="agent-note">{t(kind === 'agy' ? 'spawn.agyNote' : kind === 'gemini' ? 'spawn.geminiNote' : 'spawn.otherNote', { kind: kindLabel })}</div>
        </>}
        {!shell && !direct && <label>{t('spawn.prompt')}<textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} data-field="prompt" /></label>}
        <div className="mt-card-actions">
          <button className="mt-btn primary" disabled={busy || !cwd} data-action="spawn-submit">{busy ? t('spawn.starting') : t('spawn.start')}</button>
          <button type="button" className="mt-btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  );
}
