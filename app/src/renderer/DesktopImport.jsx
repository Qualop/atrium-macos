// P34: "데스크톱 앱에서 가져오기" 창. 리포 열기 창에서 연다. 열 때마다 목록을 새로 읽는다(desktop.list).
// 리포별 목록, 상태 글, 제공자 표시·명시적 고름(처음에는 빈 선택), 모두 고르기·풀기, 진행 표시(desktop.import.progress)와 결과 요약(가져옴, 건너뜀과 까닭).
// 가져온 세션은 그 리포 영역에 잠든 노드로 놓인다(백엔드 desktop-import.mjs). 창은 고정 크기이고 목록 칸만 스크롤된다(P28: 창 최소 크기에서 틀이 넘치지 않는다).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { toast } from './store.js';
import { useT, errText, tOr, getLanguage } from './lib/i18n.js';
import { agoText } from './lib/labels.js';
import { useDialog } from './dialog.js';

const CAN = new Set(['new', 'more']); // 고를 수 있는 상태(나머지는 까닭만 보인다)
const keyOf = (c) => c.selectionId || `${c.provider || 'claude'}:${c.appSessionId}`;
const labelOf = (provider) => provider === 'codex' ? 'Codex' : 'Claude Code';

export function DesktopImportDialog({ onClose }) {
  const t = useT();
  const ko = getLanguage() === 'ko';
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const importing = useRef(false), mounted = useRef(false), loadVersion = useRef(0);
  const close = () => { if (!importing.current) onClose(); };
  const box = useDialog(close); // The ref also covers events before React commits busy.
  async function load(keepPick = false) {
    const version = ++loadVersion.current;
    try {
      const r = await api.call('desktop.list');
      if (!mounted.current || version !== loadVersion.current) return;
      setData(r); setError(null);
      if (!keepPick) setPicked(new Set());
    } catch (e) { if (mounted.current && version === loadVersion.current) setError(e); }
  }
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; loadVersion.current++; }; }, []);
  useEffect(() => api.on('desktop.import.progress', (d) => { if (mounted.current && importing.current) setProgress(d); }), []);
  const items = useMemo(() => (data ? data.repos.flatMap((g) => g.items) : []), [data]);
  const pickable = items.filter((c) => CAN.has(c.status) && !(c.provider === 'codex' && c.running));
  const runningPicked = items.filter((c) => c.running && picked.has(keyOf(c))).length;
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function run() {
    if (importing.current || !mounted.current || !picked.size || error) return;
    importing.current = true;
    setBusy(true); setResult(null); setProgress({ done: 0, total: picked.size });
    try {
      const r = await api.call('desktop.import', { selections: items.filter((c) => picked.has(keyOf(c))).map((c) => ({ provider: c.provider || 'claude', appSessionId: c.appSessionId })) });
      if (!mounted.current) return;
      setResult(r);
      toast(t('desktopImport.done', { n: r.imported.length, skipped: r.skipped.length }));
      await load();
    } catch (e) { if (mounted.current) toast(t('desktopImport.failed', { error: errText(e) }), 'error'); }
    finally { importing.current = false; if (mounted.current) { setBusy(false); setProgress(null); } }
  }
  const statusText = (c) => {
    if (c.provider === 'codex' && c.status === 'more') return ko ? '복사 후 변경됨' : 'Changed since copy';
    if (c.status === 'more' && c.more) return t('desktopImport.st.moreN', { prompts: c.more.prompts, answers: c.more.answers });
    if (c.status === 'imported' && c.imported) return t('desktopImport.st.importedAs', { name: c.imported.name || '?', gen: c.imported.gen });
    return t(`desktopImport.st.${c.status}`);
  };
  return (
    <div className="mt-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={box} className="mt-modal mt-dimport" data-role="desktop-import" role="dialog" aria-modal="true" aria-labelledby="desktop-import-title" aria-busy={busy}>
        <h3 id="desktop-import-title">{ko ? 'Claude · Codex 대화 가져오기' : 'Import Claude · Codex history'}</h3>
        <div className="mt-card-sub">{ko ? '가져올 대화를 직접 고르세요. 원본을 보존하고 새 복사본을 잠든 세션으로 올립니다.' : 'Select conversations to copy into sleeping board sessions. Originals are preserved.'}</div>
        {error ? <div className="mt-warn mt-dimport-body" data-role="import-error">{errText(error)}</div>
          : !data ? <div className="mt-dimport-body dim">{t('desktopImport.loading')}</div>
          : <>
            {data.sources?.filter((s) => !s.allowed).map((s) => <div key={s.provider} className="mt-warn" role="status">{labelOf(s.provider)}: {ko ? '기록을 가져올 수 없음' : 'History unavailable'} ({tOr(`desktopImport.why.${s.reason}`, s.reason)})</div>)}
            <div className="mt-dimport-bar">
              <span data-role="import-counts">{t('desktopImport.counts', { total: data.total, picked: picked.size, running: data.running })}</span>
              <span className="mt-dimport-sp" />
              <button className="mt-btn small" data-action="import-all" disabled={busy || !pickable.length} onClick={() => setPicked(new Set(pickable.map(keyOf)))}>{t('desktopImport.selectAll')}</button>
              <button className="mt-btn small ghost" data-action="import-none" disabled={busy || !picked.size} onClick={() => setPicked(new Set())}>{t('desktopImport.selectNone')}</button>
            </div>
            <div className="mt-dimport-body mt-dimport-list" data-role="import-list">
              {!items.length && <div className="dim">{t('desktopImport.empty')}</div>}
              {data.repos.map((g) => (
                <div key={g.key || g.root || '-'} className="mt-dimport-repo" data-repo={g.name || ''}>
                  <div className="mt-dimport-repo-h" title={g.root || ''}><b>{g.name || t('desktopImport.noRepo')}</b> <span className="dim mono">{g.root || ''}</span></div>
                  {g.items.map((c) => {
                    const can = CAN.has(c.status) && !(c.provider === 'codex' && c.running);
                    return (
                      <label key={keyOf(c)} className={`mt-dimport-row${can ? '' : ' off'}`} data-app={c.appSessionId} data-provider={c.provider || 'claude'} data-status={c.status} data-running={c.running ? '1' : undefined} title={[c.cwd, c.convId].filter(Boolean).join('\n')}>
                        <input type="checkbox" disabled={!can || busy} checked={picked.has(keyOf(c))} onChange={() => toggle(keyOf(c))} />
                        <span className="mt-dimport-st">{labelOf(c.provider)}</span>
                        <span className="mt-dimport-title">{c.title || c.convId || c.appSessionId}</span>
                        <span className={`mt-dimport-st st-${c.status}`} data-role="import-status">{statusText(c)}</span>
                        {c.running && <span className="mt-dimport-st warn" data-role="import-running">{t(c.runningWhere === 'terminal' ? 'desktopImport.runningTerminal' : 'desktopImport.running')}</span>}
                        {c.provider === 'codex' && !c.runningKnown && <span className="dim" title={ko ? '다른 Codex 앱에서 실행 중인지 확인할 수 없습니다. 원본은 복사만 합니다.' : 'Activity in other Codex clients is unknown. Only a copy is created.'}>{ko ? '실행 여부 미확인' : 'Activity unknown'}</span>}
                        {c.folder === 'repo' && can && <span className="mt-dimport-st" data-role="import-repo-folder" title={c.target || ''}>{t('desktopImport.repoFolder')}</span>}
                        <span className="mt-dimport-at dim">{agoText(c.lastActivityAt)}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </>}
        <div className="mt-dimport-foot" data-role="import-foot">
          {busy && progress ? <span data-role="import-progress" role="status">{t('desktopImport.progress', { done: progress.done, total: progress.total })}</span>
            : result ? <span data-role="import-result" title={result.skipped.map((x) => `${x.title || x.appSessionId}: ${tOr(`desktopImport.why.${x.reason}`, x.message || x.reason)}`).join('\n')}>
              {t('desktopImport.result', { n: result.imported.length, skipped: result.skipped.length })}
              {result.skipped.length > 0 && ` · ${[...new Set(result.skipped.map((x) => tOr(`desktopImport.why.${x.reason}`, x.message || x.reason)))].join(', ')}`}
            </span>
            : runningPicked > 0 ? <span className="mt-warn" data-role="import-running-warn">{t('desktopImport.runningWarn', { n: runningPicked })}</span>
            : <span className="dim">{t('desktopImport.hint')}</span>}
        </div>
        {result?.skipped.filter((s) => s.orphanForkId).map((s) => <div key={s.orphanForkId} className="mt-warn" role="status">{ko ? '판 등록 실패 · Codex에 복사본 보존:' : 'Board registration failed; copy preserved in Codex:'} <code>{s.orphanForkId}</code></div>)}
        <div className="mt-card-actions">
          <button className="mt-btn primary" data-action="import-run" disabled={busy || !picked.size || !!error} onClick={run}>{busy ? t('desktopImport.running2') : t('desktopImport.run', { n: picked.size })}</button>
          <button className="mt-btn ghost" data-action="import-close" disabled={busy} onClick={close}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
