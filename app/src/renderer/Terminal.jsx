// P117: 설정 › 터미널 탭. P129: 판의 터미널 백엔드는 herdr-core(hc) 하나다. 지금 백엔드와 버전, 세션 수를 보이고,
// 옛 판 옮기기(백엔드가 판을 띄울 때 저절로 한다)가 있으면 그 진행과 지난 결과를 세션마다 보인다. 사람이 누르는 옮기기·되돌리기는 없앴다
import { useStore } from './store.js';
import { useT, errText } from './lib/i18n.js';
import { SetRow, SetNote } from './Settings.jsx';
import { migrationDone, migrationReason } from './lib/migration.js';

function Rows({ rows }) {
  const t = useT();
  if (!rows || !rows.length) return null;
  return (
    <ul className="mt-tmove-list" data-role="terminal-migrate-rows">
      {rows.map((x) => (
        <li key={x.sessionId || x.name} data-name={x.name} data-result={x.result}>
          <span className="mt-tmove-name">{x.name}</span>
          <span className="mt-tmove-kind">{x.kind}</span>
          <span className={`mt-tmove-result ${x.result || ''}`}>{t(`terminalMigrate.result.${x.result || 'pending'}`)}</span>
          <span className="mt-tmove-why">{x.reason ? t('terminalMove.why', { why: migrationReason(x.reason, t) }) : ''}</span>
        </li>
      ))}
    </ul>
  );
}

export function TerminalTab() {
  const t = useT();
  const term = useStore((st) => st.terminal);
  const m = useStore((st) => st.migration);
  const sessions = useStore((st) => st.sessions);
  const all = [...sessions.values()];
  const asleep = all.filter((s) => s.state === 'sleeping').length;
  const live = all.filter((s) => s.state !== 'sleeping' && s.state !== 'exited').length;
  const version = term && (term.hcVersion || term.version);
  return (
    <div className="mt-set-grid" data-role="terminal-settings" data-backend="hc">
      <SetNote>{t('terminalMove.note')}</SetNote>
      <SetRow name={t('terminalMove.now')} hint={t('terminalMove.nowHint')} role="terminal-now">
        <span data-field="terminal-backend" data-value="hc">herdr-core{version ? ` ${version}` : ''}</span>
      </SetRow>
      <SetRow name={t('terminalMove.sessions')} hint={t('terminalMove.sessionsHint')} role="terminal-counts">
        <span data-field="terminal-counts">{t('terminalMove.counts', { live, asleep })}</span>
      </SetRow>
      {m && (
        <div className="mt-tmigrate" data-role="terminal-migrate-table" data-state={m.state}>
          <SetNote>
            <b>{t('terminalMigrate.title')}</b> {t(`terminalMigrate.state.${m.state}`)}{' '}
            {t('terminalMigrate.summary', { done: migrationDone(m), total: m.total || 0, waiting: m.waiting || 0, failed: m.failed || 0 })}
            {m.error ? ` ${errText(m.error)}` : ''}
          </SetNote>
          <Rows rows={m.rows} />
        </div>
      )}
    </div>
  );
}
