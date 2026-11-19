// macOS 판: 설정의 "Claude 계정" 탭. 계정 하나 = Claude Code 설정 폴더 하나(CLAUDE_CONFIG_DIR, 백엔드 claude-accounts.mjs).
// 기본 계정은 ~/.claude다. 계정을 더하면 그 폴더를 만들고, 그 계정으로 띄운 세션의 터미널에서 사람이 직접 로그인한다(/login).
// 런처마다 계정을 정할 수 있고, 새 세션 창에서 고를 수 있으며, 하위 세션은 부모의 계정을 물려받는다.
// 우선순위(↑·↓)와 자동 전환: 고르지 않은 새 세션은 차례대로 한도에 걸리지 않은 계정으로 뜨고, 한도에 걸린 세션은 다음 계정으로 같은 대화를 잇는다(backend account-failover.mjs).
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStore, toast, loadAccounts, openDialog } from './store.js';
import { useT, errText, fmtDateTime } from './lib/i18n.js';

const call = async (m, p, t, ok) => { try { const r = await api.call(m, p); if (ok) toast(ok); return r; } catch (e) { toast(t('accounts.saveFailed', { error: errText(e) }), 'error'); return null; } };

function AccountRow({ a, onChanged, onMove, first, last }) {
  const t = useT();
  const [name, setName] = useState(null);
  const [busy, setBusy] = useState(false);
  const rename = async () => {
    if (name == null || !name.trim() || name.trim() === a.name) { setName(null); return; }
    setBusy(true);
    const r = await call('accounts.rename', { id: a.id, name: name.trim() }, t, t('accounts.renamed', { name: name.trim() }));
    setBusy(false);
    if (r) { setName(null); onChanged(); }
  };
  const remove = async () => {
    if (!window.confirm(t('accounts.removeConfirm', { name: a.name, dir: a.configDir }))) return;
    setBusy(true);
    const r = await call('accounts.remove', { id: a.id }, t, t('accounts.removed', { name: a.name }));
    setBusy(false);
    if (r) onChanged();
  };
  const clearLimit = async () => {
    setBusy(true);
    const r = await call('accounts.clearLimit', { id: a.id }, t, t('accounts.limitCleared', { name: a.builtin ? t('accounts.defaultName') : a.name }));
    setBusy(false);
    if (r) onChanged();
  };
  const status = a.loggedIn ? (a.email ? t('accounts.signedInAs', { email: a.email }) : t('accounts.signedIn')) : a.exists === false ? t('accounts.folderMissing') : t('accounts.notLoggedIn');
  const limited = a.limit && a.limit.until > Date.now() ? a.limit : null;
  return (
    <div className="mt-acct-row" data-role="account-row" data-account={a.id}>
      <div className="mt-acct-order">
        <span className="mt-acct-rank" title={t('accounts.rankTitle')}>{a.rank}</span>
        <button type="button" className="mt-btn small ghost mt-acct-mv" data-action="account-up" disabled={first || busy} aria-label={t('accounts.up')} title={t('accounts.up')} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="mt-btn small ghost mt-acct-mv" data-action="account-down" disabled={last || busy} aria-label={t('accounts.down')} title={t('accounts.down')} onClick={() => onMove(1)}>↓</button>
      </div>
      <div className="mt-acct-main">
        {name == null
          ? <span className="mt-acct-name">{a.builtin ? t('accounts.defaultName') : a.name}</span>
          : <input className="mt-set-text" data-field="account-rename" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); rename(); } if (e.key === 'Escape') setName(null); }} />}
        <span className="mt-acct-dir mono" title={a.home}>{a.builtin ? '~/.claude' : a.configDir}</span>
        <span className={`mt-acct-status${a.loggedIn && !limited ? ' ok' : ' warn'}`} data-role="account-status">{limited ? t('accounts.limited', { time: fmtDateTime(limited.until, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }) : status}{a.sessions ? ` · ${t('accounts.sessions', { n: a.sessions })}` : ''}</span>
      </div>
      <div className="mt-acct-actions">
        {limited && <button type="button" className="mt-btn small ghost" data-action="account-clear-limit" disabled={busy} title={t('accounts.clearLimitHint')} onClick={clearLimit}>{t('accounts.clearLimit')}</button>}
        <button type="button" className="mt-btn small" data-action="account-spawn" onClick={() => openDialog({ kind: 'spawn', account: a.id, agentKind: 'claude' })}>{a.loggedIn ? t('accounts.newSession') : t('accounts.signIn')}</button>
        {!a.builtin && name == null && <button type="button" className="mt-btn small ghost" data-action="account-rename" disabled={busy} onClick={() => setName(a.name)}>{t('accounts.rename')}</button>}
        {!a.builtin && <button type="button" className="mt-btn small ghost danger" data-action="account-remove" disabled={busy || a.sessions > 0} title={a.sessions > 0 ? t('accounts.busyHint') : undefined} onClick={remove}>{t('accounts.remove')}</button>}
      </div>
    </div>
  );
}

export function AccountsTab() {
  const t = useT();
  const accounts = useStore((st) => st.accounts) || [];
  const settings = useStore((st) => st.settings) || {};
  const [failPending, setFailPending] = useState(null);
  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadAccounts().catch(() => {}); }, []);
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await call('accounts.add', { name: name.trim(), ...(dir.trim() ? { configDir: dir.trim() } : {}) }, t, t('accounts.added', { name: name.trim() }));
    setBusy(false);
    if (r) { setName(''); setDir(''); loadAccounts().catch(() => {}); }
  };
  const reload = () => loadAccounts().catch(() => {});
  // 우선순위: 한 칸 올리거나 내린 ID 목록을 저장한다
  const move = async (i, dir) => {
    const ids = accounts.map((a) => a.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    if (await call('accounts.order', { ids }, t)) reload();
  };
  const failover = failPending ?? settings.claudeAccountFailover !== false;
  const setFailover = async (value) => {
    setFailPending(value);
    try { await api.call('settings.set', { key: 'claudeAccountFailover', value }); }
    catch (e) { toast(t('settings.saveFailed', { error: errText(e) }), 'error'); }
    setFailPending(null);
  };
  return (
    <div className="mt-acct" data-role="accounts-tab">
      <p className="mt-set-note">{t('accounts.intro')}</p>
      <label className="mt-acct-failover" data-role="account-failover">
        <input type="checkbox" data-field="setting-claudeAccountFailover" checked={failover} disabled={failPending != null} onChange={(e) => setFailover(e.target.checked)} />
        <span><b>{t('accounts.failover')}</b><br /><span className="mt-set-note">{t('accounts.failoverHint')}</span></span>
      </label>
      <div className="mt-acct-list">{accounts.map((a, i) => <AccountRow key={a.id} a={a} first={i === 0} last={i === accounts.length - 1} onMove={(dir) => move(i, dir)} onChanged={reload} />)}</div>
      <form className="mt-acct-add" onSubmit={add} data-role="account-add">
        <label className="mt-ln-f"><span>{t('accounts.name')}</span><input className="mt-set-text" data-field="account-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t('accounts.namePh')} /></label>
        <label className="mt-ln-f"><span>{t('accounts.dir')}</span><input className="mt-set-text mono" data-field="account-dir" value={dir} spellCheck={false} onChange={(e) => setDir(e.target.value)} placeholder={t('accounts.dirPh')} /></label>
        <button className="mt-btn small primary" data-action="account-add" disabled={busy || !name.trim()}>{t('accounts.add')}</button>
      </form>
      <p className="mt-set-note">{t('accounts.note')}</p>
    </div>
  );
}
