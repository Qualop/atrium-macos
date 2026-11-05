// 리포지토리 워크스페이스(ARCH 4절 G, 7.1, P5): 리포 열기·빈 워크스페이스 닫기 대화상자와 세션 한 줄 글.
// P6a: P5의 위쪽 워크스페이스 줄과 아래쪽 세션 줄은 캔버스의 워크스페이스 영역, 아래쪽 워크스페이스 단추, 검색으로 바꿨다(Regions.jsx, Search.jsx).
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { selectWorkspace, toast, openDialog } from './store.js';
import { useT, t, errText, tMsg } from './lib/i18n.js';
import { useDialog } from './dialog.js';

// "+ 리포 열기": 폴더를 고르면 그 폴더의 리포지토리(저장소가 아니면 그 폴더)를 빈 워크스페이스로 만들고 그 영역으로 간다
export function OpenRepoDialog({ onClose }) {
  const t = useT();
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useDialog(onClose); // P52
  async function browse() { try { const p = await window.mt.pickFolder(); if (p) setDir(p); } catch {} }
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.call('workspace.open', { path: dir.trim() });
      const ws = r.workspace;
      toast(r.created ? t('workspaces.created', { name: ws.name }) : t('workspaces.exists', { name: ws.name }));
      selectWorkspace(ws.key); // 목록(workspace.updated)은 응답보다 먼저 온다
      onClose();
    } catch (err) { toast(t('workspaces.openFail', { error: errText(err) }), 'error'); setBusy(false); }
  }
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={box} className="mt-modal" onSubmit={submit} data-role="ws-open">
        <h3>{t('workspaces.openTitle')}</h3>
        <div className="mt-card-sub">{t('workspaces.openNote')}</div>
        <div className="mt-row-wide">
          <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder={t('workspaces.pathPlaceholder')} data-field="path" autoFocus />
          <button type="button" className="mt-btn" onClick={browse} data-action="ws-browse">{t('workspaces.browse')}</button>
        </div>
        <div className="mt-card-actions">
          <button className="mt-btn primary" disabled={busy || !dir.trim()} data-action="ws-open-submit">{t('common.open')}</button>
          <button type="button" className="mt-btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          {/* P34: 데스크톱 앱 세션을 리포 영역으로 한 번에 가져온다(그 창이 리포를 연다) */}
          <span className="mt-dimport-sp" />
          <button type="button" className="mt-btn" data-action="desktop-import-open" title={t('desktopImport.openTitle')} onClick={() => openDialog({ kind: 'desktopImport' })}>{t('desktopImport.open')}</button>
        </div>
      </form>
    </div>
  );
}

// 워크스페이스를 판에서 지우기(확인을 받는다). P44: 여럿(ws가 배열)을 한 번에. 안에 세션이 있으면 "모두 보관"(꺼서 보관함) 또는 "모두 삭제"(꺼서 판에서 지움)를 고른다.
// 돌고 있는 CLI 수를 보인다. 디스크의 폴더와 대화 기록 파일은 건드리지 않는다
export function CloseWsDialog({ ws, onClose }) {
  const t = useT();
  const list = Array.isArray(ws) ? ws : [ws];
  const keys = list.map((w) => w.key);
  const [ask, setAsk] = useState(null);
  const [after, setAfter] = useState(null);
  const [busy, setBusy] = useState(false);
  const box = useDialog(() => !busy && onClose()); // P52
  useEffect(() => { api.call('workspace.close', { workspaces: keys }).then((r) => setAsk(r)).catch((e) => setAsk({ error: e })); }, [keys.join('|')]);
  const plan = ask && ask.plan;
  const need = !!(plan && plan.needsChoice);
  async function go() {
    setBusy(true);
    try {
      const r = await api.call('workspace.close', { workspaces: keys, confirm: true, ...(need ? { after } : {}) });
      const s = r.sessions || {};
      const parts = [t('sbRemove.doneWs', { n: (r.removed || []).length })];
      if (s.archived) parts.push(t('sbRemove.doneArchived', { n: s.archived }));
      if (s.deleted) parts.push(t('sbRemove.doneDeleted', { n: s.deleted }));
      if (r.kept && r.kept.length) parts.push(t('sbRemove.doneKept', { n: r.kept.length, failed: (s.failed || []).length }));
      toast(parts.join(' · '), r.kept && r.kept.length ? 'error' : 'info');
      onClose();
    } catch (e) { toast(t('workspaces.closeFail', { error: errText(e) }), 'error'); setBusy(false); }
  }
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="mt-modal mt-wsrm" data-role="ws-close" data-need={need ? '1' : '0'}>
        <h3>{list.length === 1 ? t('workspaces.closeTitle', { name: list[0].name }) : t('sbRemove.title', { n: list.length })}</h3>
        {!ask ? <div>{t('workspaces.confirmLoading')}</div> : ask.error ? <div>{errText(ask.error)}</div> : (
          <>
            {plan && plan.items.length > 1 && (
              <ul className="mt-wsrm-list" data-role="ws-close-list">
                {plan.items.map((x) => <li key={x.key} data-ws={x.key}><b>{x.name}</b> <span className="dim">{x.sessions ? t('sbRemove.itemSessions', { n: x.sessions, running: x.running }) : t('sbRemove.itemEmpty')}</span></li>)}
              </ul>
            )}
            {need ? (
              <>
                <div className="mt-wsrm-warn" data-role="ws-close-warn">{t('sbRemove.hasSessions', { n: plan.sessions })}{plan.running > 0 && <> <b data-count="running">{t('sbRemove.running', { n: plan.running })}</b></>}</div>
                <div className="mt-wsrm-pick" role="radiogroup">
                  <label className={after === 'archive' ? 'on' : ''}><input type="radio" name="wsrm-after" data-action="after-archive" checked={after === 'archive'} onChange={() => setAfter('archive')} /><span><b>{t('sbRemove.archiveAll')}</b><br /><span className="dim">{t('sbRemove.archiveAllNote')}</span></span></label>
                  <label className={after === 'delete' ? 'on' : ''}><input type="radio" name="wsrm-after" data-action="after-delete" checked={after === 'delete'} onChange={() => setAfter('delete')} /><span><b>{t('sbRemove.deleteAll')}</b><br /><span className="dim">{t('sbRemove.deleteAllNote')}</span></span></label>
                </div>
              </>
            ) : <div data-role="ws-close-msg">{tMsg(ask)}</div>}
            <div className="mt-card-sub dim">{t('sbRemove.keepNote')}</div>
          </>
        )}
        <div className="mt-card-actions">
          <button className="mt-btn danger" disabled={busy || !ask || !!ask.error || (need && !after)} data-action="ws-close-confirm" onClick={go}>{busy ? t('sbRemove.working') : need ? t('sbRemove.confirmWith', { n: plan.sessions }) : t('sbRemove.confirm')}</button>
          <button className="mt-btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

// 세션 줄의 한 칸에 보일 종류
export function kindLabel(s) {
  if (s.kind === 'shell') return t('sidebar.kindShell');
  if (s.kind && s.kind !== 'claude') return s.kind;
  return s.origin === 'adopted' ? t('workspaces.claudeAdopted') : 'claude';
}
// 셸의 한 줄: 쉬는 중, 또는 돌고 있는 명령과 프로세스 이름
export function shellLine(s) {
  const sh = s.shell || {};
  if (sh.atPrompt !== false) return sh.command ? t('workspaces.shellLast', { cmd: sh.command }) : t('workspaces.shellPrompt');
  return `${sh.command || '?'}${sh.procs && sh.procs.length ? ` (${sh.procs.join(', ')})` : ''}`;
}
