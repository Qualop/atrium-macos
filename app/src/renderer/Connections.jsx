// P115 설정의 "연결" 탭: 모델 연결(이름, 프로토콜, base URL, 인증 환경 변수 이름과 싣는 방식, health 주소, 모델 목록 주소) 목록과 만들기·고치기·지우기·확인.
// 연결은 런처와 따로 둔 목록이고 런처가 ID로 참조한다(백엔드 connections.mjs). 인증은 값이 아니라 환경 변수 이름만 둔다.
// 확인은 백엔드 connection.check가 시작 전 확인과 같은 검사(health 또는 base URL)와 모델 목록을 본다. 쓰는 런처가 있는 연결은 지우지 않는다(백엔드가 막는다)
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { toast } from './store.js';
import { useT, errText } from './lib/i18n.js';
import { blankConnection, baseUrlHintKey } from './lib/launchers.js';

const call = async (m, p, t, ok) => { try { const r = await api.call(m, p); if (ok) toast(ok); return r; } catch (e) { toast(t('connections.saveFailed', { error: errText(e) }), 'error'); return null; } };

function CheckLine({ r }) {
  const t = useT();
  if (!r) return null;
  if (r.busy) return <span className="mt-cn-check dim">{t('connections.checking')}</span>;
  return (
    <span className="mt-cn-check" data-role="connection-check" data-ok={r.health && r.health.ok ? '1' : '0'}>
      <span className={r.health && r.health.ok ? 'ok' : 'bad'}>{r.health && r.health.ok ? t('connections.checkOk') : t('connections.checkBad', { why: (r.health && r.health.why) || '?' })}</span>
      {' · '}
      <span className={r.models && r.models.ok ? 'dim' : 'bad'}>{r.models && r.models.ok ? t('connections.modelsOk', { n: r.models.count }) : t('connections.modelsBad', { why: (r.models && r.models.why) || '?' })}</span>
    </span>
  );
}

function ConnectionForm({ init, protocols, schemes, onDone }) {
  const t = useT();
  const [d, setD] = useState(() => ({ ...blankConnection(), ...init, auth: { env: '', scheme: '', ...(init.auth || {}) } }));
  const [busy, setBusy] = useState(false);
  const [chk, setChk] = useState(null);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const setAuth = (k, v) => setD((x) => ({ ...x, auth: { ...x.auth, [k]: v } }));
  const body = () => ({ name: d.name, protocol: d.protocol, baseUrl: d.baseUrl, auth: { env: d.auth.env, ...(d.auth.scheme ? { scheme: d.auth.scheme } : {}) }, healthUrl: d.healthUrl, modelsUrl: d.modelsUrl });
  const save = async () => {
    setBusy(true);
    const r = d.id ? await call('connection.update', { id: d.id, patch: body() }, t, t('connections.saved', { name: d.name || d.baseUrl })) : await call('connection.create', { connection: body() }, t, t('connections.created', { name: d.name || d.baseUrl }));
    setBusy(false);
    if (r) onDone();
  };
  const check = async () => {
    setChk({ busy: true });
    try { setChk(await api.call('connection.check', { connection: { ...body(), id: d.id || undefined } })); }
    catch (e) { setChk({ health: { ok: false, why: errText(e) }, models: { ok: false, why: '' } }); }
  };
  return (
    <div className="mt-cn-form" data-role="connection-form">
      <div className="mt-ln-grid">
        <label className="mt-ln-f"><span>{t('connections.name')}</span><input className="mt-set-text" data-field="connection-name" value={d.name} maxLength={40} onChange={(e) => set('name', e.target.value)} placeholder={t('connections.namePh')} /></label>
        <label className="mt-ln-f"><span>{t('connections.protocol')}</span>
          <select data-field="connection-protocol" value={d.protocol} onChange={(e) => set('protocol', e.target.value)}>{protocols.map((p) => <option key={p} value={p}>{t(`connections.protocols.${p}`)}</option>)}</select>
        </label>
        <label className="mt-ln-f wide"><span>{t('connections.baseUrl')}</span><input className="mt-set-text mono" data-field="connection-baseUrl" value={d.baseUrl} spellCheck={false} onChange={(e) => set('baseUrl', e.target.value)} placeholder={t(baseUrlHintKey(d.protocol))} /></label>
        <label className="mt-ln-f"><span>{t('connections.authEnv')}</span><input className="mt-set-text mono" data-field="connection-authEnv" value={d.auth.env} spellCheck={false} onChange={(e) => setAuth('env', e.target.value)} placeholder={t('connections.authEnvPh')} /></label>
        <label className="mt-ln-f"><span>{t('connections.authScheme')}</span>
          <select data-field="connection-authScheme" value={d.auth.scheme || ''} onChange={(e) => setAuth('scheme', e.target.value)}>
            <option value="">{t(`connections.schemes.${d.protocol === 'anthropic-messages' ? 'x-api-key' : 'bearer'}`)}</option>
            {schemes.map((s) => <option key={s} value={s}>{t(`connections.schemes.${s}`)}</option>)}
          </select>
        </label>
        <label className="mt-ln-f"><span>{t('connections.healthUrl')}</span><input className="mt-set-text mono" data-field="connection-healthUrl" value={d.healthUrl} spellCheck={false} onChange={(e) => set('healthUrl', e.target.value)} placeholder={t('connections.healthUrlPh')} /></label>
        <label className="mt-ln-f"><span>{t('connections.modelsUrl')}</span><input className="mt-set-text mono" data-field="connection-modelsUrl" value={d.modelsUrl} spellCheck={false} onChange={(e) => set('modelsUrl', e.target.value)} placeholder={t('connections.modelsUrlPh')} /></label>
      </div>
      <div className="mt-ln-secret" data-role="connection-auth-note">{t('connections.authEnvNote')}</div>
      <div className="mt-ln-foot">
        <button type="button" className="mt-btn small primary" data-action="connection-save" disabled={busy || !d.baseUrl.trim()} onClick={save}>{d.id ? t('connections.save') : t('connections.create')}</button>
        <button type="button" className="mt-btn small" data-action="connection-check" disabled={!d.baseUrl.trim() || (chk && chk.busy)} onClick={check}>{t('connections.check')}</button>
        <button type="button" className="mt-btn small ghost" data-action="connection-cancel" onClick={onDone}>{t('common.cancel')}</button>
        <CheckLine r={chk} />
      </div>
    </div>
  );
}

export function ConnectionsTab() {
  const t = useT();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sure, setSure] = useState(null);
  const [checks, setChecks] = useState({});
  const load = () => api.call('connection.list').then(setData).catch((e) => toast(t('connections.saveFailed', { error: errText(e) }), 'error'));
  useEffect(() => { load(); return api.on('connections.updated', setData); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="dim">{t('settings.loading')}</div>;
  if (editing) return <ConnectionForm key={editing.id || 'new'} init={editing} protocols={data.protocols} schemes={data.schemes} onDone={() => { setEditing(null); load(); }} />;
  const del = async (c) => { if (sure !== c.id) { setSure(c.id); return; } setSure(null); await call('connection.delete', { id: c.id }, t, t('connections.deleted', { name: c.name })); load(); };
  const check = async (c) => { setChecks((x) => ({ ...x, [c.id]: { busy: true } })); const r = await api.call('connection.check', { id: c.id }).catch((e) => ({ health: { ok: false, why: errText(e) }, models: { ok: false, why: '' } })); setChecks((x) => ({ ...x, [c.id]: r })); };
  return (
    <div className="mt-cn" data-role="connections-list">
      <p className="mt-set-note">{t('connections.note')}</p>
      <div className="mt-ln-rows">
        {/* P161: 연결이 없으면 흐린 한 줄 대신 무엇을 하는 칸이고 어떻게 더하는지 보인다 */}
        {!data.connections.length && (
          <div className="mt-cn-empty" data-role="connections-empty">
            <b>{t('connEmpty.title')}</b>
            <span>{t('connEmpty.what')}</span>
            <span>{t('connEmpty.how')}</span>
          </div>
        )}
        {data.connections.map((c) => (
          <div key={c.id} className="mt-cn-row" data-role="connection-row" data-connection={c.id} data-protocol={c.protocol}>
            <span className="mt-cn-name" title={c.name}>{c.name}</span>
            <span className="mt-cn-proto">{t(`connections.protocols.${c.protocol}`)}</span>
            <span className="mt-cn-url mono" title={c.baseUrl}>{c.baseUrl}{c.auth && c.auth.env ? <span className="dim"> · ${c.auth.env}</span> : null}</span>
            <span className="mt-cn-used dim">{c.usedBy && c.usedBy.length ? t('connections.usedBy', { names: c.usedBy.join(', ') }) : t('connections.unused')}</span>
            <span className="mt-ln-acts">
              <button type="button" className="mt-btn small" data-action="connection-check-row" onClick={() => check(c)}>{t('connections.check')}</button>
              <button type="button" className="mt-btn small" data-action="connection-edit" onClick={() => setEditing(c)}>{t('connections.edit')}</button>
              <button type="button" className={`mt-btn small ${sure === c.id ? 'danger' : 'ghost'}`} data-action="connection-delete" title={t('connections.delete')} onBlur={() => sure === c.id && setSure(null)} onClick={() => del(c)}>{sure === c.id ? t('connections.deleteSure') : '×'}</button>
            </span>
            {checks[c.id] && <span className="mt-cn-rowcheck"><CheckLine r={checks[c.id]} /></span>}
          </div>
        ))}
      </div>
      <div className="mt-ln-foot">
        <button type="button" className="mt-btn small primary" data-action="connection-new" onClick={() => setEditing(blankConnection())}>{t('connections.new')}</button>
      </div>
    </div>
  );
}
