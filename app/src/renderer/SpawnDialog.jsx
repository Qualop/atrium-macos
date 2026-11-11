// 새 세션 시작(ARCH 4절 B3): 이름, 폴더, 모델, 권한 모드, 첫 지시. 처음 쓰는 폴더면 신뢰 확인이 필요하다고 미리 보여준다.
// herdr가 아는 에이전트 종류를 고른다. 모델 목록과 실행 인자는 종류별로 받고, hook 지원 여부는 세션 정보에 따른다.
// P5: 폴더는 지금 워크스페이스의 저장소 루트가 기본이다. 다른 저장소의 폴더를 고르면 그 세션은 그 저장소의 워크스페이스에 생긴다(G1).
//     종류 "셸(PowerShell)"은 에이전트 없이 패널만 연다(G2).
// P33: 띄우는 방법은 호출자(설정의 호출자 탭)다. 창 맨 위에서 호출자를 고르면 그 값으로 띄우고, 여기서 바꾼 모델은 호출자 값을 덮는다(session.spawn { launcher, model }).
//     "직접 고르기"는 옛 방식(종류, 모델, 권한 모드, 인자)이다. 왼쪽 레일의 즐겨찾기 호출자는 이 창 없이 quickSpawn으로 띄우고(P97: 먼저 이름 칸 QuickName.jsx), Shift+누르기는 그 호출자를 채워 이 창을 연다.
//     칩 "새 세션…"과 영역의 "+ 세션"은 첫 즐겨찾기 호출자를 고른 채로 연다.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { toast, getState, useStore, wsName, openDialog, goWhenOpen } from './store.js';
import { useT, t, tOr, errText } from './lib/i18n.js';
import { kindOf } from './lib/kinds.js';
import { hasModelCatalog, spawnDefaults } from './lib/spawn.js';
import { favoriteLaunchers, orderedLaunchers, previewLine, autoApprovalApplies } from './lib/launchers.js';
import { useDialog } from './dialog.js';

export const startedText = (r) => t('spawn.started', { name: r.name, kind: r.flavor ? t('spawn.startedKind', { kind: kindOf(r.flavor).label + (r.command ? t('spawn.startedCommand') : '') }) : r.command ? t('spawn.startedKind', { kind: t('launchers.harness.command') }) : r.kind && r.kind !== 'claude' ? t('spawn.startedKind', { kind: r.kind === 'shell' ? t('spawn.shell') : kindOf(r.kind).label }) : '', trust: r.trust && r.trust.needsTrust ? t('spawn.startedTrust') : '', ws: r.workspaceKey && r.workspaceKey !== getState().currentWs ? t('spawn.startedWs', { ws: wsName(r.workspaceKey) || r.workspaceRoot }) : '' });

const findLauncher = (id) => { const d = getState().launchers; return (d && d.launchers.find((l) => l.id === id)) || null; };
const MODEL_HARNESS = new Set(['claude', 'codex', 'gemini', 'agy']);
// 개발용 판은 모델을 비운 Claude Code 호출자를 haiku로 띄운다(api.info.defaultModel)
export const devModel = (l) => (l && l.harness === 'claude' && !l.model ? (api.info || {}).defaultModel || '' : '');

let quickBusy = false;
// 지금 워크스페이스의 폴더에 그 호출자로 띄우고 그 터미널로 들어간다. 지금 워크스페이스가 없으면 폴더를 묻는 창을 연다
// P97: name은 레일 이름 칸에 친 세션 이름(없으면 판이 짓는다). 돌려주는 값: true(띄움), false(실패, 알림을 보였다), 'dialog'(새 세션 창을 열었다), null(이미 띄우는 중)
export async function quickSpawn(launcherId, name) {
  const st = getState();
  const cur = st.workspaces.find((w) => w.key === st.currentWs);
  if (!cur) { openDialog({ kind: 'spawn', launcher: launcherId }); return 'dialog'; }
  if (quickBusy) return null;
  quickBusy = true;
  const p = { cwd: cur.root, launcher: launcherId, ...(name ? { name } : {}) };
  const dm = devModel(findLauncher(launcherId));
  if (dm) p.model = dm;
  let ok = false;
  try { const r = await api.call('session.spawn', p); toast(startedText(r)); goWhenOpen(r.sessionId); ok = true; }
  catch (e) { toast(t('spawn.failed', { error: errText(e) }), 'error'); }
  quickBusy = false;
  return ok;
}

// cwd: 영역 이름표의 "+ 세션"에서 열면 그 워크스페이스의 폴더(P6a)
// launcher: 레일의 Shift+누르기로 열면 그 호출자. agentKind: 옛 길(그 종류를 직접 고르기로 연다)
export function SpawnDialog({ onClose, cwd: cwd0 = null, agentKind = null, launcher: launcher0 = null }) {
  const t = useT();
  const info = api.info || {};
  const data = useStore((st) => st.launchers);
  const settings = useStore((st) => st.settings);
  const list = orderedLaunchers(data);
  const first = favoriteLaunchers(data)[0] || list[0] || null;
  const cur = getState().workspaces.find((w) => w.key === getState().currentWs);
  const [cwd, setCwd] = useState(cwd0 || (cur && cur.root) || info.defaultCwd || '');
  const [name, setName] = useState('');
  const [lid, setLid] = useState(launcher0 || (agentKind ? '' : first ? first.id : '')); // ''면 직접 고르기
  const L = lid ? list.find((l) => l.id === lid) || null : null;
  useEffect(() => { if (lid && data && !data.launchers.some((l) => l.id === lid)) setLid(''); }, [lid, data]);
  const [lmodel, setLmodel] = useState(() => { const l = findLauncher(launcher0 || (agentKind ? '' : first ? first.id : '')); return l ? l.model || devModel(l) : ''; });
  const [kind, setKind] = useState(agentKind || 'claude');
  const def = getState().settings || {};
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
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const harness = L ? L.harness : kind;
  const deepseek = harness === 'deepseek';
  const direct = !L && deepseek && !!command.trim();
  const claude = harness === 'claude' || (!L && deepseek && !direct);
  const shell = harness === 'shell';
  const typed = harness === 'command';
  const autoApprove = !direct && autoApprovalApplies(settings, harness);
  const modelPicker = hasModelCatalog(kind);
  const kindLabel = kindOf(kind).label;
  const pickKind = (k) => { setKind(k); const defaults = defaultsFor(k); setArgs(defaults.args); setModel(defaults.model); };
  const box = useDialog(onClose);
  const pickLauncher = (id) => { setLid(id); const l = findLauncher(id); setLmodel(l ? l.model || devModel(l) : ''); };

  useEffect(() => { let active = true; api.call('agent.kinds').then((ks) => active && setKinds([...ks].sort((a, b) => (b.installed - a.installed) || (a.kind === 'claude' ? -1 : b.kind === 'claude' ? 1 : 0)))).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => {
    setTrust(null);
    if (!cwd || !claude) return;
    let current = true;
    const tm = setTimeout(() => api.call('trust.predict', { cwd }).then((r) => { if (current) setTrust(r); }).catch(() => { if (current) setTrust(null); }), 250);
    return () => { current = false; clearTimeout(tm); };
  }, [cwd, claude]);

  async function submit(e) {
    e.preventDefault();
    if (submitting.current || !cwd.trim()) return;
    submitting.current = true;
    setBusy(true);
    try {
      const p = { cwd, name: name.trim() || undefined, prompt: shell || typed || direct ? undefined : prompt.trim() || undefined };
      if (L) {
        p.launcher = L.id;
        if (MODEL_HARNESS.has(L.harness) && lmodel.trim() !== (L.model || '')) p.model = lmodel.trim();
      } else {
        p.kind = kind;
        if (deepseek) p.command = command.trim();
        if (claude) Object.assign(p, { model: model.trim() || undefined, permissionMode: mode, allowHerdr });
        else if (!shell && !deepseek) { p.args = args.trim(); if (modelPicker) p.model = model.trim(); }
      }
      const r = await api.call('session.spawn', p);
      toast(startedText(r));
      if (alive.current) onClose();
      goWhenOpen(r.sessionId);
    } catch (err) { toast(t('spawn.failed', { error: errText(err) }), 'error'); if (alive.current) setBusy(false); }
    finally { submitting.current = false; }
  }

  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} className="mt-modal" onSubmit={submit} data-role="spawn" data-launcher={lid || ''}>
        <h3>{t('spawn.title')}</h3>
        {data && <>
          <label>{t('launchers.pick')}
            <select value={lid} onChange={(e) => pickLauncher(e.target.value)} data-field="launcher">
              {list.map((l) => <option key={l.id} value={l.id}>{l.favorite ? '★ ' : ''}{l.name}</option>)}
              <option value="">{t('launchers.custom')}</option>
            </select>
          </label>
          {L && <div className="mt-ln-preview mono" data-role="launcher-preview" title={previewLine(L.preview, t('launchers.shellPreview'))}>{previewLine(L.preview, t('launchers.shellPreview'))}{L.preview && L.preview.env && L.preview.env.length ? <span className="dim">  · {t('launchers.envShort')}: {L.preview.env.join(', ')}</span> : null}</div>}
        </>}
        {autoApprove && <div className="mt-effective-approval" data-role="spawn-effective-approval" role="status"><strong>{t('autoApproval.effective')}</strong><span>{t('autoApproval.override')}</span></div>}
        {/* P48: 찾아보기. Electron 창은 OS 대화상자, 웹 화면은 PC 폴더 탐색기(window.mt.pickFolder) */}
        <label>{t('spawn.folder')}<span className="mt-row-wide"><input value={cwd} onChange={(e) => setCwd(e.target.value)} data-field="cwd" /><button type="button" className="mt-btn" data-action="spawn-browse" onClick={async () => { try { const p = await window.mt.pickFolder(); if (p && alive.current) setCwd(p); } catch {} }}>{t('workspaces.browse')}</button></span></label>
        {claude && trust && trust.needsTrust && <div className="mt-warn">{t('spawn.trustNeeded')}</div>}
        {claude && trust && trust.needsTrust === false && <div className="mt-ok">{t('spawn.trusted', { by: trust.trustedBy })}</div>}
        <div className="mt-row">
          <label>{t('spawn.name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('spawn.namePh')} data-field="name" /></label>
          {!L && <label>{t('spawn.kind')}
            <select value={kind} onChange={(e) => pickKind(e.target.value)} data-field="kind">
              <option value="shell">{t('spawn.shellOption')}</option>
              {kinds.filter((k) => k.kind !== 'shell' && k.kind !== 'deepseek').map((k) => <option key={k.kind} value={k.kind} disabled={!k.installed}>{kindOf(k.kind).label}{k.installed ? '' : t('spawn.notInstalled')}</option>)}
              <option value="deepseek">{t('spawn.deepseekOption')}</option>
            </select>
          </label>}
        </div>
        <div className="mt-card-sub">{t('spawn.nameHelp')}</div>
        {!L && deepseek && <>
          <label>{t('spawn.deepseekCommand')}<input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t('spawn.deepseekCommandPh')} data-field="deepseek-command" /></label>
          <div className="mt-card-sub" data-role="deepseek-note">{direct ? t('spawn.deepseekDirectNote') : t('spawn.deepseekNote')}</div>
        </>}
        {L ? <>
          {MODEL_HARNESS.has(L.harness) && (hasModelCatalog(L.harness)
            ? <ModelField key={L.id} kind={L.harness} value={lmodel} onChange={setLmodel} />
            : <label>{t('spawn.model')}<input value={lmodel} onChange={(e) => setLmodel(e.target.value)} placeholder={t('spawn.modelPh')} data-field="model" /></label>)}
          {claude && <div className="mt-card-sub" data-role="launcher-permission">{t('spawn.mode')}: {autoApprove ? t('autoApproval.short') : tOr(`permissionModes.${L.permissionMode || 'manual'}`, L.permissionMode || 'manual')}</div>}
          {typed ? <div className="mt-card-sub" data-role="command-note">{t('launchers.commandNote')}</div>
            : shell ? <div className="mt-card-sub" data-role="shell-note">{t('spawn.shellNote')}</div> : null}
        </> : shell ? <div className="mt-card-sub" data-role="shell-note">{t('spawn.shellNote')}</div> : direct ? null : claude ? <>
          <div className="mt-row">
            <label>{t('spawn.model')}<input value={model} onChange={(e) => setModel(e.target.value)} placeholder={t('spawn.modelPh')} data-field="model" /></label>
            <label>{t('spawn.mode')}
              <select data-field="permission-mode" disabled={autoApprove} value={mode} onChange={(e) => setMode(e.target.value)}>
                {['manual', 'acceptEdits', 'plan', 'auto', ...(['manual', 'acceptEdits', 'plan', 'auto'].includes(mode) ? [] : [mode])].map((m) => <option key={m} value={m}>{tOr(`permissionModes.${m}`, m)}</option>)}
              </select>
            </label>
          </div>
          {!autoApprove && <><label className="mt-check"><input type="checkbox" checked={allowHerdr} disabled={autoApprove} onChange={(e) => setAllowHerdr(e.target.checked)} data-field="allow-herdr" /><span>{t('settings.allowHerdrName')}</span></label>
          <div className="mt-card-sub">{t('spawn.allowHerdr')}</div></>}
        </> : <>
          {modelPicker ? <ModelField key={kind} kind={kind} value={model} onChange={setModel} /> : <label>{t('spawn.args')}<input value={args} onChange={(e) => setArgs(e.target.value)} data-field="args" /></label>}
          {modelPicker && <details data-role="advanced-args"><summary>{t('spawn.advanced')}</summary>
            <label>{t('spawn.extraArgs')}<input value={args} onChange={(e) => setArgs(e.target.value)} placeholder={kind === 'codex' ? '-c model_reasoning_effort=high' : undefined} data-field="args" /></label>
            <div className="mt-card-sub">{t('spawn.modelOverridesArgs')}</div>
          </details>}
          <div className="mt-card-sub" data-role="agent-note">{t(kind === 'agy' ? 'spawn.agyNote' : kind === 'gemini' ? 'spawn.geminiNote' : 'spawn.otherNote', { kind: kindLabel })}</div>
        </>}
        {!shell && !typed && !direct && <label>{t('spawn.prompt')}<textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} data-field="prompt" /></label>}
        <div className="mt-card-actions">
          <button className="mt-btn primary" disabled={busy || !cwd} data-action="spawn-submit">{busy ? t('spawn.starting') : t('spawn.start')}</button>
          <button type="button" className="mt-btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </form>
    </div>
  );
}

// The CLI catalog remains authoritative for Codex and both Gemini entry points.
export function ModelField({ kind, value, onChange }) {
  const t = useT();
  const model = value;
  const kindLabel = kindOf(kind).label;
  const [catalog, setCatalog] = useState({ status: 'loading', models: [], source: null });
  const [refreshModels, setRefreshModels] = useState(0);
  const [customModel, setCustomModel] = useState(false);
  useEffect(() => {
    let active = true;
    setCatalog({ status: 'loading', models: [], source: null });
    api.call('agent.models', { kind }).then((r) => {
      if (active) setCatalog({ status: r.models.length ? 'ready' : 'empty', models: r.models, source: r.source || null });
    }).catch(() => { if (active) setCatalog({ status: 'error', models: [], source: null }); });
    return () => { active = false; };
  }, [kind, refreshModels]);
  const manualModel = customModel || (!!model && catalog.status !== 'loading' && !catalog.models.some((m) => m.id === model));
  return <>
            <label>{t('spawn.model')}
              <select data-field="model-select" aria-describedby="spawn-model-status" value={manualModel ? '__custom__' : value} onChange={(e) => {
                const v = e.target.value; setCustomModel(v === '__custom__'); if (v !== '__custom__') onChange(v);
              }}>
                <option value="">{t('spawn.modelDefault', { kind: kindLabel })}</option>
                {catalog.status === 'loading' && model && <option value={value}>{value}</option>}
                {catalog.models.map((m) => <option key={m.id} value={m.id}>{m.name === m.id ? m.id : `${m.name} (${m.id})`}</option>)}
                <option value="__custom__">{t('spawn.modelCustom')}</option>
              </select>
            </label>
            <div id="spawn-model-status" className="mt-card-sub" role="status" data-role="model-status" data-status={catalog.status} data-source={catalog.source || undefined}>
              {t(`spawn.modelList_${catalog.status}`, { kind: kindLabel })}{' '}
              <button type="button" className="mt-btn small ghost" disabled={catalog.status === 'loading'} onClick={() => setRefreshModels((n) => n + 1)} data-action="models-refresh">{t('spawn.modelRefresh')}</button>
            </div>
            {manualModel && <label>{t('spawn.modelId')}<input data-field="model" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('spawn.modelIdPh')} /></label>}
  </>;
}
