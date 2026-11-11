// P33 설정의 "호출자" 탭: 호출자 목록(이름, 하네스 아이콘, 명령 미리보기, 즐겨찾기, 순서, 고치기, 지우기)과 만들기·고치기 틀.
// 만들기는 두 길이다. (a) 하네스를 고르고 드롭다운(모델은 알려진 목록 + 직접 입력, 노력 수준, 권한 모드)을 조합한다. (b) 하네스 "직접 명령"을 골라 명령 한 줄을 쓴다.
// 고르는 대로 백엔드 launcher.preview가 확인하고 실제 명령줄을 미리 보인다. 고급 칸은 추가 인자, 환경 변수(이름=값), 게이트웨이 확인 주소다.
// 환경 변수 값은 판 기록에 평문으로 남으므로 API 키 같은 비밀값을 넣지 말라는 풀이를 늘 보이고, 비밀값처럼 보이는 이름이면 경고한다.
// P97: 틀 맨 위에 명령줄 붙여 넣기 칸(PasteLine). Claude Code는 실행 명령 칸(예: ocx claude)이 있고, 추가 인자는 고급 밖에 둔다. "레일에 고정"은 만들기 단추 옆(기본 켜짐).
// P28 원칙: 최소 창(900×600)에서도 스크롤 없이 들어간다. 목록이 길면 목록 칸만 넘긴다.
import { useEffect, useId, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, toast, loadLaunchers } from './store.js';
import { KindIcon } from './SessionNode.jsx';
import { Icon } from './lib/icons.jsx';
import { useT, tOr, errText } from './lib/i18n.js';
import { kindOf } from './lib/kinds.js';
import { hasModelCatalog } from './lib/spawn.js';
import { ICONS, orderedLaunchers, moveFavorite, launcherIcon, launcherMark, previewLine, envToText, secretNames, harnessFields, harnessModels, blankLauncher, harnessModelLabels, modelChoices, recognizedChips, fillFromParse, autoApprovalApplies } from './lib/launchers.js';

const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const MODES = ['manual', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

export function LauncherIcon({ l }) {
  const k = launcherIcon(l);
  if (k === 'shell') return <span className="mt-ln-ico"><Icon name="terminal" /></span>;
  if (k) return <span className="mt-ln-ico"><KindIcon kind={k} badge /></span>;
  return <span className="mt-ln-ico mark">{launcherMark(l)}</span>;
}

const call = async (m, p, t, ok) => { try { const r = await api.call(m, p); if (ok) toast(ok); return r; } catch (e) { toast(t('launchers.saveFailed', { error: errText(e) }), 'error'); return null; } };

function LauncherList({ data, onEdit }) {
  const t = useT();
  const settings = useStore((st) => st.settings);
  const rows = orderedLaunchers(data);
  const favs = data.favorites || [];
  const [sure, setSure] = useState(null); // 지우기는 두 번 누른다(한 번 누르면 '지울까요?'로 바뀐다)
  const move = (id, d) => { const ids = moveFavorite(favs, id, d); if (ids) call('launcher.order', { ids }, t); };
  const del = async (l) => { if (sure !== l.id) { setSure(l.id); return; } setSure(null); await call('launcher.delete', { id: l.id }, t, t('launchers.deleted', { name: l.name })); };
  return (
    <div className="mt-ln" data-role="launchers-list">
      <p className="mt-set-note">{t('launchers.note')}</p>
      <div className="mt-ln-rows">
        {rows.map((l) => {
          const fi = favs.indexOf(l.id);
          return (
            <div key={l.id} className={`mt-ln-row${l.favorite ? ' fav' : ''}`} data-role="launcher-row" data-launcher={l.id} data-name={l.name}>
              <button type="button" className={`mt-ln-star${l.favorite ? ' on' : ''}`} data-action="launcher-favorite" title={l.favorite ? t('launchers.unfavorite') : t('launchers.favorite')} aria-pressed={l.favorite} onClick={() => call('launcher.favorite', { id: l.id, favorite: !l.favorite }, t)}>{l.favorite ? '★' : '☆'}</button>
              <LauncherIcon l={l} />
              <span className="mt-ln-name" title={l.name}>{l.name}{autoApprovalApplies(settings, l.harness) && <span className="mt-badge mode" data-role="launcher-effective-approval" title={t('autoApproval.override')}>{t('autoApproval.short')}</span>}</span>
              <span className="mt-ln-line mono" title={previewLine(l.preview, t('launchers.shellPreview'))}>{previewLine(l.preview, t('launchers.shellPreview'))}{l.preview && l.preview.env && l.preview.env.length ? <span className="dim"> · {t('launchers.envShort')}: {l.preview.env.join(', ')}</span> : null}</span>
              <span className="mt-ln-acts">
                <button type="button" className="mt-btn small ghost" data-action="launcher-up" disabled={fi <= 0} title={t('launchers.up')} onClick={() => move(l.id, -1)}>↑</button>
                <button type="button" className="mt-btn small ghost" data-action="launcher-down" disabled={fi < 0 || fi >= favs.length - 1} title={t('launchers.down')} onClick={() => move(l.id, 1)}>↓</button>
                <button type="button" className="mt-btn small" data-action="launcher-edit" onClick={() => onEdit(l)}>{t('launchers.edit')}</button>
                <button type="button" className={`mt-btn small ${sure === l.id ? 'danger' : 'ghost'}`} data-action="launcher-delete" title={t('launchers.delete')} onBlur={() => sure === l.id && setSure(null)} onClick={() => del(l)}>{sure === l.id ? t('launchers.deleteSure') : <Icon name="x" />}</button>
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-ln-foot">
        <button type="button" className="mt-btn small primary" data-action="launcher-new" onClick={() => onEdit(blankLauncher('claude'))}>{t('launchers.new')}</button>
        <button type="button" className="mt-btn small" data-action="launcher-new-command" onClick={() => onEdit(blankLauncher('command'))}>{t('launchers.newCommand')}</button>
        <span className="mt-set-hint">{t('launchers.railHint')}</span>
      </div>
    </div>
  );
}

// P72: 모델 입력칸. 누르면 아래에 하네스가 아는 모델(Codex는 Codex의 목록)이 뜨고, 고르거나 직접 친다.
// 브라우저의 datalist는 친 글자로 목록을 줄여 다른 모델이 안 보이므로 창 안 목록으로 그린다. Esc는 목록만 닫는다
function ModelInput({ value, onChange, models, labels = {}, placeholder }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const listId = useId();
  const shown = modelChoices(models, labels, value);
  const pick = (m) => { if (m) onChange(m); setOpen(false); setCursor(-1); };
  const onKey = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.key === 'Process') return;
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && shown.length) {
      e.preventDefault(); setOpen(true);
      setCursor((i) => i < 0 ? (e.key === 'ArrowDown' ? 0 : shown.length - 1) : (i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length); return;
    }
    if (e.key === 'Enter' && open && cursor >= 0 && shown[cursor]) { e.preventDefault(); pick(shown[cursor]); }
  };
  return (
    <span className="mt-ln-model">
      <input className="mt-set-text" data-field="launcher-model" value={value} autoComplete="off" spellCheck={false} role="combobox" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={open && cursor >= 0 && shown[cursor] ? `${listId}-${cursor}` : undefined} aria-expanded={open && shown.length > 0}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setCursor(-1); }} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey} placeholder={placeholder} />
      {open && shown.length > 0 && (
        <span id={listId} className="mt-ln-models" role="listbox" data-role="launcher-models">
          {shown.map((m, i) => <button type="button" key={m} id={`${listId}-${i}`} role="option" tabIndex={-1} aria-selected={i === cursor || m === value} className={i === cursor || m === value ? 'on' : ''} data-model={m} onMouseDown={(e) => { e.preventDefault(); pick(m); }}><span className="mono">{m}</span>{labels[m] ? <span className="dim">{labels[m]}</span> : null}</button>)}
        </span>
      )}
    </span>
  );
}

// P97: 명령줄 붙여 넣기 칸. 붙여 넣거나 Enter·채우기를 누르면 백엔드 launcher.parse가 하네스·실행 명령·모델·옵션·추가 인자·환경 변수로 나누고,
// 아래 칸을 채운 뒤 무엇으로 알아봤는지 칩으로 보인다. 여러 줄(PowerShell `·bash \ 이어 쓰기)을 받으려고 textarea다(input은 붙여 넣은 줄바꿈을 지운다)
function PasteLine({ onParsed, autoFocus, except, revision }) {
  const t = useT();
  const [text, setText] = useState('');
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState(false);
  const last = useRef('');
  const textNow = useRef('');
  const inFlight = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus]);
  const parse = async (v = text) => {
    if (!v.trim() || inFlight.current) return;
    const request = {}, version = revision();
    inFlight.current = request; last.current = v; setBusy(true);
    try {
      const r = await api.call('launcher.parse', { text: v, ...(except ? { except } : {}) });
      if (alive.current && textNow.current === v && revision() === version) { setRec(r.recognized); onParsed(r, version); }
    } catch (e) {
      if (alive.current && textNow.current === v && revision() === version) { setRec(null); toast(t('launcherPaste.failed', { error: errText(e) }), 'error'); }
    } finally { inFlight.current = null; if (alive.current) setBusy(false); }
  };
  const onPaste = (e) => {
    const v = e.clipboardData.getData('text');
    if (!v) return;
    e.preventDefault();
    const el = e.currentTarget;
    const next = text.slice(0, el.selectionStart) + v + text.slice(el.selectionEnd);
    textNow.current = next; setText(next); parse(next);
  };
  const lines = Math.min(4, Math.max(1, text.split(/\r?\n/).length));
  const chipText = (c) => t(c.key, { ...c.vars, ...(c.vars.field ? { field: t(`launcherPaste.field.${c.vars.field}`) } : {}), ...(c.vars.harness ? { harness: harnessLabel(c.vars.harness, t) } : {}) });
  return (
    <div className="mt-ln-paste wide" data-role="launcher-paste">
      <label className="mt-ln-f wide"><span>{t('launcherPaste.label')}</span>
        <span className="mt-ln-paste-row">
          <textarea ref={ref} className="mt-set-text mono" rows={lines} data-field="launcher-paste" value={text} spellCheck={false} autoComplete="off" placeholder={t('launcherPaste.ph')} aria-describedby="mt-ln-paste-note"
            onChange={(e) => { textNow.current = e.target.value; setText(e.target.value); }} onPaste={onPaste}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); parse(); } }}
            onBlur={() => { if (text.trim() && text !== last.current) parse(); }} />
          <button type="button" className="mt-btn small" data-action="launcher-parse" disabled={busy || !text.trim()} onClick={() => parse()}>{t('launcherPaste.fill')}</button>
        </span>
      </label>
      <div className="mt-ln-chips" id="mt-ln-paste-note" data-role="launcher-recognized" data-as={rec ? rec.as : ''} data-board={rec && rec.board ? '1' : '0'} aria-live="polite">
        {rec ? recognizedChips(rec).map((c, i) => <span key={i} className={`mt-ln-chip ${c.tone}`}>{chipText(c)}</span>) : <span className="mt-set-hint">{t('launcherPaste.hint')}</span>}
      </div>
    </div>
  );
}
const harnessLabel = (h, t) => (h === 'claude' ? 'Claude Code' : h === 'codex' ? 'Codex' : h === 'command' ? t('launchers.harness.command') : h === 'shell' ? t('launchers.harness.shell') : h);

function LauncherForm({ init, harnesses, onDone, focusPaste = false }) {
  const t = useT();
  const [d, setD] = useState(() => ({ ...init, startCommand: init.startCommand || '', envText: envToText(init.env) }));
  const [kinds, setKinds] = useState([]);
  const [pv, setPv] = useState(null); // { line, env } 또는 { error }
  const [busy, setBusy] = useState(false);
  const [fav, setFav] = useState(!init.id);
  const saving = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [catalog, setCatalog] = useState({ status: 'loading', models: [] });
  const [refreshModels, setRefreshModels] = useState(0);
  const revision = useRef(0);
  const set = (k, v) => { revision.current++; setD((x) => ({ ...x, [k]: v })); };
  const settings = useStore((st) => st.settings);
  const autoApprove = autoApprovalApplies(settings, d.harness);
  const fields = harnessFields(harnesses, d.harness);
  const has = (f) => fields.includes(f);
  const body = () => ({ id: d.id || undefined, name: d.name || '…', harness: d.harness, icon: d.icon, model: d.model, effort: d.effort, permissionMode: d.permissionMode || 'manual', allowHerdr: d.allowHerdr, args: d.args, env: d.envText, command: d.command, checkUrl: d.checkUrl, startCommand: d.startCommand });
  useEffect(() => { let active = true; api.call('agent.kinds').then((ks) => { if (active) setKinds([...new Set(['agy', 'gemini', ...ks.map((k) => k.kind)])].filter((k) => !['claude', 'codex', 'shell', 'command'].includes(k))); }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!hasModelCatalog(d.harness)) return;
    let active = true;
    setCatalog({ status: 'loading', models: [] });
    api.call('agent.models', { kind: d.harness }).then((r) => {
      if (active) setCatalog({ status: r.models.length ? 'ready' : 'empty', models: r.models });
    }).catch(() => { if (active) setCatalog({ status: 'error', models: [] }); });
    return () => { active = false; };
  }, [d.harness, refreshModels]);
  // 고르는 대로 미리보기(백엔드가 확인한다). 이름이 비었으면 이름 검사만 건너뛴다
  useEffect(() => {
    let active = true;
    setPv(null);
    const tm = setTimeout(() => {
      if (d.harness === 'command' && !d.command.trim()) { setPv({ line: '', env: [] }); return; }
      api.call('launcher.preview', { launcher: body() }).then((r) => { if (active) setPv(r.preview); }).catch((e) => { if (active) setPv({ error: errText(e) }); });
    }, 180);
    return () => { active = false; clearTimeout(tm); };
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  // P97: 붙여 넣은 명령줄로 칸을 채운다(이름은 비었을 때만 제안 이름)
  const onParsed = (r) => setD((x) => { const n = fillFromParse(x, r.launcher); return { ...n, permissionMode: n.permissionMode || 'manual', envText: envToText(n.env) }; });
  const save = async () => {
    if (saving.current) return;
    if (!d.name.trim()) { setPv({ error: t('launchers.err.name', { max: 40 }) }); return; }
    saving.current = true;
    setBusy(true);
    const b = { ...body(), name: d.name };
    const r = d.id ? await call('launcher.update', { id: d.id, patch: b }, t, t('launchers.saved', { name: d.name })) : await call('launcher.create', { launcher: b, favorite: fav }, t, t(fav ? 'launcherPin.created' : 'launchers.created', { name: d.name }));
    saving.current = false;
    if (alive.current) { setBusy(false); if (r) onDone(); }
  };
  const secrets = secretNames(d.envText);
  const dynamicModels = hasModelCatalog(d.harness);
  const models = dynamicModels ? catalog.models : harnessModels(harnesses, d.harness).map((id) => ({ id, name: id }));
  const labels = dynamicModels ? Object.fromEntries(models.map((m) => [m.id, m.name])) : harnessModelLabels(harnesses, d.harness);
  const shellText = t('launchers.shellPreview');
  const warns = pv && !pv.error ? pv.warns || (pv.warn ? [pv.warn] : []) : [];
  return (
    <div className="mt-ln-form" data-role="launcher-form" data-harness={d.harness}>
      {autoApprove && <div className="mt-effective-approval" data-role="launcher-effective-approval" role="status" id="launcher-auto-override"><strong>{t('autoApproval.effective')}</strong><span>{t('autoApproval.override')}</span></div>}
      <fieldset className="mt-ln-grid" disabled={busy}>
        <PasteLine onParsed={onParsed} revision={() => revision.current} autoFocus={focusPaste || !init.id} except={d.id || undefined} />
        <label className="mt-ln-f"><span>{t('launchers.name')}</span><input className="mt-set-text" data-field="launcher-name" value={d.name} maxLength={40} onChange={(e) => set('name', e.target.value)} placeholder={t('launchers.namePh')} /></label>
        <label className="mt-ln-f"><span>{t('launchers.harnessLabel')}</span>
          <select data-field="launcher-harness" value={d.harness} onChange={(e) => { revision.current++; setD((prev) => ({ ...prev, harness: e.target.value, model: '', effort: '', args: '', command: '', permissionMode: 'manual', allowHerdr: false })); }}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
            {kinds.map((k) => <option key={k} value={k}>{kindOf(k).label}</option>)}
            {!['claude', 'codex', 'shell', 'command', ...kinds].includes(d.harness) && <option value={d.harness}>{d.harness}</option>}
            <option value="shell">{t('launchers.harness.shell')}</option>
            <option value="command">{t('launchers.harness.command')}</option>
          </select>
        </label>
        {has('startCommand') && <label className="mt-ln-f"><span>{t('launcherStart.label')}</span><input className="mt-set-text mono" data-field="launcher-startCommand" value={d.startCommand} spellCheck={false} autoComplete="off" onChange={(e) => set('startCommand', e.target.value)} placeholder={t('launcherStart.ph')} title={t('launcherStart.title')} /></label>}
        {has('command') ? (
          <label className="mt-ln-f wide"><span>{t('launchers.command')}</span><input className="mt-set-text mono" data-field="launcher-command" value={d.command} onChange={(e) => set('command', e.target.value)} placeholder={t('launchers.commandPh')} /></label>
        ) : has('model') ? (
          <label className="mt-ln-f"><span>{t('launchers.model')}</span>
            <ModelInput value={d.model} onChange={(v) => set('model', v)} models={models.map((m) => m.id)} labels={labels} placeholder={t('launchers.modelPh')} />
            <datalist id={`ln-models-${d.harness}`}>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
            {dynamicModels && <span className="mt-card-sub mt-ln-model-status" role="status" data-role="launcher-model-status" data-status={catalog.status}>
              {t(`spawn.modelList_${catalog.status}`, { kind: kindOf(d.harness).label })}{' '}
              <button type="button" className="mt-btn small ghost" disabled={catalog.status === 'loading'} onClick={() => setRefreshModels((n) => n + 1)}>{t('spawn.modelRefresh')}</button>
            </span>}
          </label>
        ) : <span />}
        {has('effort') && <label className="mt-ln-f"><span>{t('settings.effort')}</span>
          <select data-field="launcher-effort" value={d.effort} onChange={(e) => set('effort', e.target.value)}>{EFFORTS.map((o) => <option key={o} value={o}>{o === '' ? t('settings.effortDefault') : tOr(`effortLevels.${o}`, o)}</option>)}</select>
        </label>}
        {has('permissionMode') && <label className="mt-ln-f"><span>{t('settings.permissionMode')}</span>
          <select data-field="launcher-permissionMode" disabled={autoApprove} aria-describedby={autoApprove ? 'launcher-auto-override' : undefined} value={d.permissionMode || 'manual'} onChange={(e) => set('permissionMode', e.target.value)}>{MODES.map((o) => <option key={o} value={o}>{tOr(`permissionModes.${o}`, o)}</option>)}</select>
        </label>}
        {/* P97: 추가 인자는 고급 밖(드롭다운으로 시작해도 같은 화면에서 실행 명령과 함께 고친다) */}
        {has('args') && <label className="mt-ln-f"><span>{t('launchers.args')}</span><input className="mt-set-text mono" data-field="launcher-args" value={d.args} onChange={(e) => set('args', e.target.value)} placeholder={t('launchers.argsPh')} /></label>}
        {has('allowHerdr') ? <label className="mt-ln-f check"><input type="checkbox" data-field="launcher-allowHerdr" disabled={autoApprove} checked={!!d.allowHerdr} onChange={(e) => set('allowHerdr', e.target.checked)} /><span>{t('settings.allowHerdrName')}</span></label> : has('args') ? <span /> : null}
        <div className="mt-set-sub wide">{t('launchers.advanced')}</div>
        <label className="mt-ln-f"><span>{t('launchers.icon')}</span>
          <select data-field="launcher-icon" value={d.icon} onChange={(e) => set('icon', e.target.value)}>
            <option value="">{t('launchers.iconAuto')}</option>
            {d.icon && !ICONS.includes(d.icon) && <option value={d.icon}>{kindOf(d.icon).label}</option>}
            {ICONS.map((k) => <option key={k} value={k}>{kindOf(k).label}</option>)}
          </select>
        </label>
        {has('checkUrl') ? <label className="mt-ln-f"><span>{t('launchers.checkUrl')}</span><input className="mt-set-text mono" data-field="launcher-checkUrl" value={d.checkUrl} onChange={(e) => set('checkUrl', e.target.value)} placeholder={t('launchers.checkUrlPh')} /></label> : <span />}
        {has('env') && <label className="mt-ln-f wide"><span>{t('launchers.env')}</span><textarea className="mono" rows={2} data-field="launcher-env" value={d.envText} onChange={(e) => set('envText', e.target.value)} placeholder="ANTHROPIC_BASE_URL=http://127.0.0.1:10100" /></label>}
      </fieldset>
      {has('env') && <div className={`mt-ln-secret${secrets.length ? ' warn' : ''}`} data-role="launcher-secret">{secrets.length ? t('launchers.secretWarn', { names: secrets.join(', ') }) : t('launchers.secretNote')}</div>}
      <div className={`mt-ln-preview mono${pv && pv.error ? ' bad' : ''}`} data-role="launcher-form-preview">
        {pv && pv.error ? pv.error : pv ? <>
          <span className="dim">{pv.typed ? t('launchers.previewTyped') : pv.board ? t('launchers.previewBoard') : '$ '}</span>{previewLine(pv, shellText)}{pv.env && pv.env.length ? <span className="dim"> · {t('launchers.envShort')}: {pv.env.join(', ')}</span> : null}
        </> : '…'}
      </div>
      {warns.map((w, i) => <div key={i} className="mt-ln-secret warn" data-role={w.key === 'launcherStart.notFound' ? 'launcher-start-warn' : 'launcher-model-warn'}>{t(w.key, w.vars)}</div>)}
      <div className="mt-ln-foot">
        <button type="button" className="mt-btn small primary" data-action="launcher-save" disabled={busy} onClick={save}>{d.id ? t('launchers.save') : t('launchers.create')}</button>
        {/* P97: 만들면서 레일에 고정(기본 켜짐). 만들기 단추 바로 옆 */}
        {!d.id && <label className="mt-ln-f check mt-ln-pin"><input type="checkbox" data-field="launcher-favorite" checked={fav} onChange={(e) => setFav(e.target.checked)} /><span>{t('launcherPin.label')}</span></label>}
        <button type="button" className="mt-btn small ghost" data-action="launcher-cancel" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

// startNew: P97 레일 +로 열면 새 런처 틀(명령줄 붙여 넣기 칸에 초점)부터
export function LaunchersTab({ startNew = false }) {
  const t = useT();
  const data = useStore((st) => st.launchers);
  const [editing, setEditing] = useState(() => (startNew ? blankLauncher('claude') : null));
  if (!data) return <div className="dim">{t('settings.loading')}</div>;
  return editing ? <LauncherForm key={editing.id || 'new'} init={editing} harnesses={data.harnesses} focusPaste={startNew} onDone={() => setEditing(null)} /> : <LauncherList data={data} onEdit={setEditing} />;
}
