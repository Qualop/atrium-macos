// P48(원격 R2): 설정의 "연결된 기기" 탭과 PC 창의 허락 요청 카드.
// P60: 탭을 차례 있는 묶음으로 다시 짰다. 묶음마다 제목과 한 줄 설명이 있다(lib/devices-tab.js).
//   1. 요약: 원격 받기 스위치, 받는 중·막음과 지금 붙은 기기 수, 노트북에서 열 주소(복사), serve가 판으로 가지 않으면 켜기 명령(복사), 진단 문제 한 줄
//   2. 짝 맺기: 새 코드(큰 코드와 남은 시간), 허락 요청
//   3. 짝 맺은 기기: Tailscale 기기 이름, 브라우저 별칭, 패스키 종류, 지금 연결, 마지막 접속, 끊기·짝 풀기. "다시 짝 맺기 필요"는 따로
//   4. 보안 설정: 패스키로 확인(P62, 기본 끔), 세션 시간·끊긴 뒤 유지 시간(켬일 때만 쓰임), Tailscale 사용자 규칙
//   5. Tailscale 진단: 기본으로 접힘
//   6. 연결 기록: 최근 몇 줄, "더 보기"로 늘린다
//   웹 화면(브라우저)은 자기 기기 정보, 로그아웃, 이 브라우저 짝 풀기만 본다.
// - 카드: 브라우저가 허락을 청하면 PC 창 위쪽에 뜬다. 확인 번호를 브라우저 화면과 견주고 허락하거나 거절한다
// 백엔드가 device.updated로 바뀐 목록을 보낸다(기기 클라이언트에는 자기 기록만). 기기에서 자기를 끊으면 짝 맺기 화면으로 돌아간다
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { toast, useStore } from './store.js';
import { useT, errText, tOr } from './lib/i18n.js';
import { isWeb } from './web.js';
import { webLogout } from './lib/passkey.js'; // P56
import { logRow, reasonKeys } from './lib/remote.js'; // P58
import { needsRepair, isRepair, groupDevices, connectedIds, diagProblems, kindKey, LOG_PREVIEW, LOG_STEP } from './lib/devices-tab.js'; // P60

export { needsRepair };
const when = (t) => (t ? new Date(t).toLocaleString() : '—');

function useDevices() {
  const [view, setView] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => api.call('device.list').then((v) => live && setView(v)).catch(() => {});
    load();
    const off1 = api.on('device.updated', (v) => setView((prev) => ({ ...(prev || {}), ...v })));
    const off2 = api.on('$open', load);
    return () => { live = false; off1(); off2(); };
  }, []);
  return view;
}
function useNow(ms, on) { const [n, set] = useState(Date.now()); useEffect(() => { if (!on) return; const id = setInterval(() => set(Date.now()), ms); return () => clearInterval(id); }, [ms, on]); return n; }
// 판 설정(원격 받기, 사용자 규칙, 세션 시간). settings.updated로 따라간다
function useBoardSettings() {
  const [s, setS] = useState(null);
  useEffect(() => { api.call('settings.get').then((r) => setS(r.settings)).catch(() => {}); return api.on('settings.updated', (v) => setS(v)); }, []);
  return s;
}

async function decide(id, allow, t) {
  try { await api.call(allow ? 'device.approve' : 'device.deny', { id }); toast(allow ? t('webDevices.allowed') : t('webDevices.denied')); } catch (e) { toast(t('webDevices.failed', { error: errText(e) }), 'error'); }
}

// 글을 클립보드에 넣고 "복사했습니다"를 잠깐 보인다
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try { // 보안 출처가 아닌 웹 화면 등
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
function CopyLine({ text, role, action, wrap = false }) {
  const t = useT();
  const [state, setState] = useState(null); // 'ok' | 'fail'
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => { const ok = await copyText(text); setState(ok ? 'ok' : 'fail'); clearTimeout(timer.current); timer.current = setTimeout(() => setState(null), 1600); };
  return (
    <div className={`mt-copy${wrap ? ' wrap' : ''}`}>
      <code className="mt-copy-text" data-role={role} title={text}>{text}</code>
      <button type="button" className={`mt-btn small${state === 'ok' ? ' on' : ''}`} data-action={action} onClick={copy}>{t('devTab.copy')}</button>
      <span className={`mt-copy-done${state ? ' show' : ''}${state === 'fail' ? ' fail' : ''}`} data-role={`${role}-copied`} aria-live="polite">{state === 'ok' ? t('devTab.copied') : state === 'fail' ? t('termSelect.copyFail') : ''}</span>
    </div>
  );
}

// 묶음: 제목, 한 줄 설명, 내용
function Section({ id, title, desc, children, aside }) {
  return (
    <section className="mt-dsec" data-section={id}>
      <header className="mt-dsec-head">
        <h4 className="mt-dsec-title">{title}</h4>
        {aside}
      </header>
      {desc && <p className="mt-dsec-desc">{desc}</p>}
      <div className="mt-dsec-body">{children}</div>
    </section>
  );
}

function Requests({ requests }) {
  const t = useT();
  if (!requests || !requests.length) return null;
  return (
    <div className="mt-wdev-reqs" data-role="device-requests">
      {requests.map((r) => (
        <div key={r.id} className="mt-wdev-req" data-request={r.id}>
          {/* P57: Tailscale이 확인한 기기 이름을 크게, 브라우저가 보낸 이름은 별칭으로 작게 */}
          <span className="mt-wdev-who">
            <span data-role="request-node">{t('webDevices.request', { name: r.tsNode ? r.tsNode.name : r.name })}</span>
            <span className="mt-wdev-sub dim" data-role="request-alias">{r.tsNode ? [t('webDevices.alias', { name: r.name }), r.tsNode.login && t('webDevices.tsLogin', { login: r.tsNode.login })].filter(Boolean).join(' · ') : t('webDevices.requestLocal')}</span>
          </span>
          <span className="mt-wdev-check" data-role="request-check">{r.check}</span>
          <button type="button" className="mt-btn small primary" onClick={() => decide(r.id, true, t)} data-action="device-allow">{t('webDevices.allow')}</button>
          <button type="button" className="mt-btn small ghost" onClick={() => decide(r.id, false, t)} data-action="device-deny">{t('webDevices.deny')}</button>
        </div>
      ))}
    </div>
  );
}

export function DevicesTab() {
  return isWeb ? <WebSelf /> : <PcDevices />;
}

// ---------- 이 PC의 창 ----------
function PcDevices() {
  const t = useT();
  const view = useDevices();
  const s = useBoardSettings();
  const peers = useStore((st) => st.peers);
  const [d, setD] = useState(null); // remote.status
  const [busy, setBusy] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const diagRef = useRef(null);
  const load = (fresh) => { setBusy(true); api.call('remote.status', { fresh }).then(setD).catch(() => {}).finally(() => setBusy(false)); };
  useEffect(() => { load(true); const off = api.on('device.updated', () => load(false)); const offOpen = api.on('$open', () => load(false)); return () => { off(); offOpen(); }; }, []);
  const connected = connectedIds(peers);
  const openDiag = () => { setDiagOpen(true); requestAnimationFrame(() => diagRef.current && diagRef.current.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })); };
  return (
    <div className="mt-wdev mt-dtab" data-role="devices-tab">
      <Summary s={s} d={d} connected={connected} onDiag={openDiag} onConfigure={() => load(false)} />
      <PairSection view={view} />
      <DeviceList view={view} connected={connected} />
      <SecuritySection s={s} />
      <Diagnostics d={d} busy={busy} onRefresh={() => load(true)} open={diagOpen} setOpen={setDiagOpen} boxRef={diagRef} />
      <RemoteLog />
    </div>
  );
}

// 1. 요약
function Summary({ s, d, connected, onDiag, onConfigure }) {
  const t = useT();
  const has = s && 'remoteAccess' in s;
  const on = !!d?.enabled && (!has || s.remoteAccess !== false);
  const set = (v) => api.call('settings.set', { remoteAccess: v }).then((r) => toast(v ? t('remoteAccess.allowed') : t('remoteAccess.blocked', { n: (r.remote && r.remote.closed) || 0 }))).catch((e) => toast(t('webDevices.failed', { error: errText(e) }), 'error'));
  const problems = d ? diagProblems(d.checks) : [];
  const first = problems[0];
  return (
    <Section id="summary" title={t('devTab.summary')} desc={t('devTab.summaryDesc')}>
      {d && <label className="mt-remote-row mt-switch-row">
        <input type="checkbox" className="mt-switch" checked={!!d.enabled} disabled={d.locked} data-field="remoteEnabled" onChange={(e) => api.call('remote.configure', { enabled: e.target.checked }).then(onConfigure).catch((err) => toast(t('webDevices.failed', { error: errText(err) }), 'error'))} />
        <b>{t('remote.title')}</b>
      </label>}
      {has && (
        <div className={`mt-remote-access mt-dsum${on ? '' : ' off'}`} data-role="remote-access" data-on={on ? '1' : '0'}>
          <div className="mt-dsum-top">
            <label className="mt-remote-row mt-switch-row">
              <input type="checkbox" className="mt-switch" checked={has && s.remoteAccess !== false} disabled={!d?.enabled} data-field="remoteAccess" onChange={(e) => set(e.target.checked)} />
              <b>{t('remoteAccess.label')}</b>
            </label>
            <span className={`mt-dsum-pill${on ? ' ok' : ' off'}`} data-role="remote-state">{on ? t('devTab.accepting') : t('devTab.blocked')}</span>
            <span className="mt-dsum-count dim" data-role="remote-connected" data-n={connected.size}>{t('devTab.connectedNow', { n: connected.size })}</span>
          </div>
          <span className="mt-set-hint">{on ? t('remoteAccess.onHint') : t('remoteAccess.offHint')}</span>
        </div>
      )}
      {d && (
        <div className="mt-dsum-rows" data-role="remote-status-summary">
          <div className="mt-dsum-row">
            <span className="mt-dsum-label">{t('remote.laptopUrl')}</span>
            {d.url ? <CopyLine text={d.url} role="remote-url" action="copy-remote-url" /> : <span className="dim" data-role="remote-url-none">{t('devTab.noUrl')}</span>}
          </div>
          {d.enableCmd && (
            <div className="mt-dsum-row" data-role="remote-enable-row">
              <span className="mt-dsum-label">{t('devTab.enableLabel')}</span>
              <div className="mt-dsum-stack">
                <span className="mt-set-hint">{t('devTab.enableHint')}</span>
                <CopyLine text={d.enableCmd} role="remote-enable" action="copy-remote-enable" wrap />
                {d.serveOthers > 0 && <span className="mt-set-hint mt-wdev-warn" data-role="remote-admin-hint">{t('devTab.adminHint', { n: d.serveOthers })}</span>}
              </div>
            </div>
          )}
          {first && (
            <div className="mt-dsum-warn" data-role="remote-problem" data-check={first.id} data-level={first.level}>
              <span className={`mt-remote-mark lv-${first.level}`} />
              <span>{t(`remote.check_${first.id}_${first.level}`, checkVars(first))}{problems.length > 1 ? ` ${t('devTab.moreProblems', { n: problems.length - 1 })}` : ''}</span>
              <button type="button" className="mt-btn small ghost" data-action="remote-diag-open" onClick={onDiag}>{t('devTab.showDiag')}</button>
            </div>
          )}
        </div>
      )}
      <LocalUrl />
    </Section>
  );
}
// 이 PC의 브라우저로 열 주소(빌드가 없으면 알린다)
function LocalUrl() {
  const t = useT();
  const [web, setWeb] = useState(null);
  useEffect(() => { api.call('web.status').then(setWeb).catch(() => {}); }, []);
  if (!web) return null;
  return <div className="mt-wdev-url dim">{t('webDevices.url')} <code data-role="web-url">{web.url}</code>{!web.built && <span className="mt-wdev-warn"> {t('webDevices.notBuilt')}</span>}</div>;
}

// 2. 짝 맺기
function PairSection({ view }) {
  const t = useT();
  const now = useNow(1000, !!(view && view.code));
  const code = view && view.code && view.code.expiresAt > now ? view.code : null;
  const reqs = view && view.requests ? view.requests : [];
  return (
    <Section id="pair" title={t('devTab.pair')} desc={t('devTab.pairDesc')}>
      <div className="mt-wdev-code" data-role="device-code">
        {code ? (
          <>
            <span className="mt-wdev-codebig" data-role="pair-code">{code.code}</span>
            <span className="dim">{t('webDevices.codeLeft', { s: Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) })}</span>
            <button type="button" className="mt-btn small ghost" onClick={() => api.call('device.cancelCode').catch(() => {})}>{t('common.cancel')}</button>
          </>
        ) : (
          <>
            <button type="button" className="mt-btn primary" disabled={view?.enabled === false} data-action="device-new-code" onClick={() => api.call('device.code').catch((e) => toast(t('webDevices.failed', { error: errText(e) }), 'error'))}>{t('webDevices.newCode')}</button>
            <span className="mt-set-hint">{t('webDevices.codeHint')}</span>
          </>
        )}
      </div>
      {reqs.length ? <Requests requests={reqs} /> : <div className="dim mt-dsec-empty">{t('devTab.noRequests')}</div>}
    </Section>
  );
}

// 3. 짝 맺은 기기
function DeviceList({ view, connected }) {
  const t = useT();
  const { ok, repair } = groupDevices(view && view.devices, connected);
  const revoke = async (d) => {
    try { await api.call('device.revoke', { id: d.id }); toast(t('webDevices.revoked', { name: d.name })); } catch (e) { toast(t('webDevices.failed', { error: errText(e) }), 'error'); }
  };
  const kick = async (d) => {
    try { const r = await api.call('device.disconnect', { id: d.id }); toast(t('peers.kicked', { name: (d.tsNode && d.tsNode.name) || d.name, n: r.closed })); } catch (e) { toast(t('webDevices.failed', { error: errText(e) }), 'error'); }
  };
  return (
    <Section id="devices" title={t('devTab.devices')} desc={t('devTab.devicesDesc')}>
      <div className="mt-wdev-list" data-role="device-list">
        {view && !ok.length && !repair.length && <div className="dim mt-dsec-empty">{t('webDevices.none')}</div>}
        {ok.map((d) => <DeviceRow key={d.id} d={d} on={connected.has(d.id)} onKick={kick} onRevoke={revoke} />)}
        {repair.length > 0 && (
          <div className="mt-wdev-repair" data-role="device-repair-group">
            <div className="mt-dsec-sub">{t('webDevices.needsRepair')}</div>
            <span className="mt-set-hint">{t('webDevices.needsRepairHint')}</span>
            {repair.map((d) => <DeviceRow key={d.id} d={d} on={false} onKick={kick} onRevoke={revoke} />)}
          </div>
        )}
      </div>
    </Section>
  );
}
function DeviceRow({ d, on, onKick, onRevoke }) {
  const t = useT();
  const rep = isRepair(d);
  const kk = kindKey(d.passkey);
  return (
    <div className={`mt-wdev-row mt-dev-row${rep ? ' repair' : ''}${on ? ' live' : ''}`} data-device={d.id} data-needs-repair={rep ? '1' : undefined} data-connected={on ? '1' : '0'}>
      <span className={`mt-dev-dot${on ? ' on' : ''}`} title={on ? t('devTab.online') : t('devTab.offline')} />
      <span className="mt-wdev-who">
        <span className="mt-wdev-name" data-role="device-node">{d.tsNode ? d.tsNode.name || d.name : d.name}</span>
        {/* P56·P57: 다시 짝 맺기가 필요한 기기는 그 표시, 아니면 브라우저 별칭(또는 이 PC 안) · 패스키 종류 */}
        {rep
          ? <span className="mt-wdev-sub mt-wdev-warn warn" title={t('webDevices.needsRepairHint')} data-role="needs-repair" data-bind="repair">{t('webDevices.needsRepair')}</span>
          : <span className="mt-wdev-sub dim">
              <span data-role="device-bind" data-bind={d.tsNode ? 'tailscale' : 'local'}>{d.tsNode ? t('webDevices.alias', { name: d.name }) : t('webDevices.localOnly')}</span>
              {kk ? <span data-role="device-kind" data-kind={d.passkey.kind}> · {t(kk)}</span> : <span data-role="device-kind" data-kind="none"> · {t('devTab.kind_none')}</span>}
            </span>}
      </span>
      <span className="mt-dev-state dim" data-role="device-state">
        {on ? <b className="mt-dev-on">{t('devTab.online')}</b> : t('webDevices.lastSeen', { at: when(d.lastSeenAt) })}
        {d.sessions != null && !rep && <span data-role="device-sessions"> · {t('webDevices.sessions', { n: d.sessions })}</span>}
        {d.needsPasskey && !rep && <span className="mt-wdev-warn" data-role="needs-passkey" title={t('devTab.needsPasskeyHint')}> · {t('devTab.needsPasskey')}</span>}
        {/* P88: 알림(웹 푸시) 켜짐과 마지막으로 보낸 때, 마지막 실패 */}
        {d.push && d.push.on && !rep && <span data-role="device-push" data-on="1"> · {t('push.pcOn')}{d.push.lastSentAt ? ` (${t('push.pcLast', { at: when(d.push.lastSentAt) })})` : ''}</span>}
        {d.push && d.push.on && d.push.lastFail && !rep && <span className="mt-wdev-warn" data-role="device-push-fail"> · {t('push.pcFail', { reason: d.push.lastFail.reason })}</span>}
      </span>
      <span className="mt-dev-acts">
        {on && <button type="button" className="mt-btn small" onClick={() => onKick(d)} data-action="device-disconnect" title={t('peers.kickHint')}>{t('peers.kick')}</button>}
        <button type="button" className="mt-btn small danger" onClick={() => onRevoke(d)} data-action="device-revoke" title={t('devTab.paired', { at: when(d.createdAt) })}>{t('webDevices.revoke')}</button>
      </span>
    </div>
  );
}

// 4. 보안 설정: 패스키로 확인(P62), 세션 시간, 끊긴 뒤 유지 시간(P56, 패스키 켬일 때만), Tailscale 사용자 규칙(P49)
function SecuritySection({ s }) {
  const t = useT();
  const [allowed, setAllowed] = useState(null);
  if (!s || !('remoteSameUser' in s)) return null;
  const set = (patch) => api.call('settings.set', patch).then(() => toast(t('remote.saved'))).catch((e) => toast(t('webDevices.failed', { error: errText(e) }), 'error'));
  const hasPk = 'remotePasskey' in s;
  const pk = hasPk ? s.remotePasskey === true : true; // 옛 백엔드는 늘 패스키
  const setPk = (v) => api.call('settings.set', { remotePasskey: v }).then((r) => toast(v ? t('passkeyMode.turnedOn', { n: (r.passkey && r.passkey.closed) || 0 }) : t('passkeyMode.turnedOff'))).catch((e) => toast(t('webDevices.failed', { error: errText(e) }), 'error'));
  return (
    <Section id="security" title={t('devTab.security')} desc={t('devTab.securityDesc')}>
      <div className="mt-remote-rules" data-role="remote-rules">
        {hasPk && (
          <div className="mt-pk-mode" data-role="passkey-mode" data-on={pk ? '1' : '0'}>
            <label className="mt-remote-row mt-switch-row">
              <input type="checkbox" className="mt-switch" checked={pk} data-field="remotePasskey" onChange={(e) => setPk(e.target.checked)} />
              <b>{t('passkeyMode.label')}</b>
            </label>
            <span className="mt-set-hint" data-role="passkey-mode-hint">{pk ? t('passkeyMode.onHint') : t('passkeyMode.offHint')}</span>
          </div>
        )}
        <div className={`mt-pk-limits${pk ? '' : ' off'}`} data-role="session-limits" aria-disabled={pk ? undefined : 'true'}>
          <SessionLimit field="remoteSessionHours" label={t('remote.sessionHours')} s={s} set={set} min={1} max={168} disabled={!pk} />
          <SessionLimit field="remoteIdleMinutes" label={t('remote.idleMinutes')} s={s} set={set} min={5} max={1440} disabled={!pk} />
          <span className="mt-set-hint">{pk ? t('remote.sessionHint') : t('passkeyMode.limitsOff')}</span>
        </div>
        <label className="mt-remote-row">
          <input type="checkbox" checked={s.remoteSameUser !== false} data-field="remoteSameUser" onChange={(e) => set({ remoteSameUser: e.target.checked })} />
          <span>{t('remote.sameUser')}</span>
        </label>
        <span className="mt-set-hint">{t('remote.sameUserHint')}</span>
        <div className="mt-remote-row">
          <input type="text" className="mt-set-text" spellCheck={false} data-field="remoteAllowedLogins" placeholder={t('remote.allowed')} value={allowed ?? s.remoteAllowedLogins ?? ''} onChange={(e) => setAllowed(e.target.value)} />
          <button type="button" className="mt-btn small" disabled={allowed == null} onClick={() => set({ remoteAllowedLogins: allowed }).then(() => setAllowed(null))}>{t('remote.save')}</button>
        </div>
      </div>
    </Section>
  );
}
function SessionLimit({ field, label, s, set, min, max, disabled = false }) {
  const t = useT();
  const [v, setV] = useState(null);
  if (!(field in s)) return null;
  const val = v ?? String(s[field]);
  const ok = /^\d+$/.test(val) && Number(val) >= min && Number(val) <= max;
  return (
    <div className="mt-remote-row mt-dsec-limit">
      <span>{label}</span>
      <input type="number" className="mt-set-text mt-nospin" min={min} max={max} data-field={field} value={val} disabled={disabled} onChange={(e) => setV(e.target.value)} />
      {v != null && <button type="button" className="mt-btn small" disabled={!ok} onClick={() => set({ [field]: Number(val) }).then(() => setV(null))} data-action={`save-${field}`}>{t('remote.save')}</button>}
    </div>
  );
}

// 5. Tailscale 진단(P49, atrium remote status와 같은 값). 기본으로 접혀 있다. 줄은 접혀 있어도 DOM에 있다
const checkVars = (c) => ({ ...c.vars, version: c.vars && c.vars.version ? ` (${c.vars.version})` : '', state: c.vars && c.vars.state ? ` (${c.vars.state})` : '' });
function Diagnostics({ d, busy, onRefresh, open, setOpen, boxRef }) {
  const t = useT();
  if (!d) return null;
  return (
    <section className="mt-dsec" data-section="diagnostics" ref={boxRef}>
      <details className="mt-dsec-fold mt-remote" data-role="remote-status" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="mt-dsec-head">
          <span className="mt-dsec-caret" aria-hidden="true" />
          <h4 className="mt-dsec-title">{t('remote.title')}</h4>
          <span className={`mt-remote-badge${d.ready ? ' ok' : ''}`} data-role="remote-ready">{t(d.ready ? 'remote.ready' : 'remote.notReady')}</span>
        </summary>
        <p className="mt-dsec-desc">{t('devTab.diagDesc')}</p>
        <div className="mt-remote-head">
          <span className="mt-set-hint">{t('remote.note')}</span>
          <button type="button" className="mt-btn small ghost" disabled={busy} onClick={onRefresh} data-action="remote-refresh">{t('remote.refresh')}</button>
        </div>
        <ul className="mt-remote-checks">
          {d.checks.map((c) => (
            <li key={c.id} className={`lv-${c.level}`} data-check={c.id} data-level={c.level}>
              <span className="mt-remote-mark" />
              {t(`remote.check_${c.id}_${c.level}`, checkVars(c))}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// 6. 연결 기록(P58, 최근 것부터). 기본으로 최근 몇 줄, "더 보기"로 늘린다. 새 줄은 remote.logged로 따라온다
function RemoteLog() {
  const t = useT();
  const [rows, setRows] = useState(null);
  const [shown, setShown] = useState(LOG_PREVIEW);
  useEffect(() => {
    let live = true;
    const load = () => api.call('remote.log', { limit: 100 }).then((r) => live && setRows(r.entries)).catch(() => {});
    load();
    let timer = null;
    const off1 = api.on('remote.logged', () => { clearTimeout(timer); timer = setTimeout(load, 300); }); // 합친 줄(count)도 다시 읽어 맞춘다
    const off2 = api.on('$open', load);
    return () => { live = false; clearTimeout(timer); off1(); off2(); };
  }, []);
  if (!rows) return null;
  // P59: 'tailscale_node:other_node'처럼 앞말이 있는 까닭은 통째 글, 없으면 앞말 글과 뒤 코드(P56 passkey:<코드>, P57 tailscale_node:<까닭>)
  const reasonText = (r) => { const k = reasonKeys(r); return tOr(k.full, k.prefix ? `${tOr(k.prefix, r.split(':')[0])}: ${tOr(`remoteLog.reason_${k.rest}`, k.rest)}` : r); };
  const list = rows.slice(0, shown);
  return (
    <Section id="log" title={t('remoteLog.title')} desc={t('remoteLog.hint')}>
      <div className="mt-remote-log" data-role="remote-log" data-total={rows.length} data-shown={list.length}>
        {!rows.length && <div className="dim mt-dsec-empty">{t('remoteLog.none')}</div>}
        <div className="mt-remote-log-list">
          {list.map((e, i) => {
            const r = logRow(e);
            return (
              <div key={`${e.at}-${i}`} className={`mt-remote-log-row${r.bad ? ' bad' : ''}`} data-event={e.event} data-reason={e.reason || ''}>
                <span className="dim mono">{new Date(e.at).toLocaleString()}</span>
                <span className="mt-remote-log-ev">{t(r.key)}{r.noPasskey ? ` · ${t('remoteLog.noPasskey')}` : ''}{r.reason ? ` · ${r.key.startsWith('push.') ? tOr(`push.reason_${r.reason}`, reasonText(r.reason)) : reasonText(r.reason)}` : ''}{r.host ? ` · ${r.host}` : ''}{r.count ? ` ×${r.count}` : ''}{r.sock ? <span className="mono dim" data-role="remote-log-sock">{` · ${r.sock}`}</span> : null}{r.prev ? <span className="mono dim" data-role="remote-log-prev">{` · ${t('remoteSock.prevClose', { v: r.prev })}`}</span> : null}{r.light ? ` · ${t('remoteCrash.light')}` : ''}{r.crash ? <span className="mono dim" data-role="remote-log-crash">{` · ${t('remoteCrash.last', { v: r.crash })}`}</span> : null}{r.level != null ? ` · ${t('remoteSteps.level', { n: r.level })}` : ''}{r.steps ? <span className="mono dim" data-role="remote-log-steps">{` · ${t('remoteSteps.steps', { v: r.steps })}`}</span> : null}</span>
                <span className="mt-remote-log-who">{r.who || ''}{r.remote === true ? ` · ${t('peers.remote')}` : r.remote === false ? ` · ${t('remoteLog.local')}` : ''}{r.browser ? ` · ${r.browser}` : ''}</span>
              </div>
            );
          })}
        </div>
        {(rows.length > shown || shown > LOG_PREVIEW) && (
          <div className="mt-dsec-more">
            {rows.length > shown && <button type="button" className="mt-btn small ghost" data-action="remote-log-more" onClick={() => setShown((n) => n + LOG_STEP)}>{t('devTab.more', { n: Math.min(LOG_STEP, rows.length - shown) })}</button>}
            {shown > LOG_PREVIEW && <button type="button" className="mt-btn small ghost" data-action="remote-log-less" onClick={() => setShown(LOG_PREVIEW)}>{t('devTab.less')}</button>}
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------- 웹 화면(브라우저): 자기 기기 정보, 로그아웃, 이 브라우저 짝 풀기 ----------
function WebSelf() {
  const t = useT();
  const view = useDevices();
  const me = view && view.me;
  const d = view && view.devices && (view.devices.find((x) => me && x.id === me.id) || view.devices[0]);
  // P59: 웹 화면(기기)은 자기 짝만 풀 수 있다(device.forget)
  const forget = async () => {
    try { await api.call('device.forget', {}); toast(t('webDevices.revoked', { name: d ? d.name : '' })); } catch (e) { toast(t('webDevices.failed', { error: errText(e) }), 'error'); }
  };
  const kk = d && kindKey(d.passkey);
  return (
    <div className="mt-wdev mt-dtab" data-role="devices-tab">
      <Section id="self" title={t('devTab.self')} desc={t('devTab.selfDesc')}>
        <div className="mt-wdev-list" data-role="device-list">
          {d && (
            <div className="mt-wdev-row mt-dev-row live" data-device={d.id}>
              <span className="mt-dev-dot on" />
              <span className="mt-wdev-who">
                <span className="mt-wdev-name" data-role="device-node">{d.tsNode ? d.tsNode.name || d.name : d.name}<span className="mt-wdev-me"> {t('webDevices.thisBrowser')}</span></span>
                <span className="mt-wdev-sub dim">
                  <span data-role="device-bind" data-bind={d.tsNode ? 'tailscale' : 'local'}>{d.tsNode ? t('webDevices.alias', { name: d.name }) : t('webDevices.localOnly')}</span>
                  {kk ? <span data-role="device-kind" data-kind={d.passkey.kind}> · {t(kk)}</span> : <span data-role="device-kind" data-kind="none"> · {t('devTab.kind_none')}</span>}
                </span>
              </span>
              <span className="mt-dev-state dim">{t('devTab.paired', { at: when(d.createdAt) })}</span>
            </div>
          )}
        </div>
        <div className="mt-card-actions">
          <button type="button" className="mt-btn" data-action="web-sign-out" onClick={() => webLogout().then(() => location.reload())}>{t('webDevices.signOut')}</button>
          {d && <button type="button" className="mt-btn danger" data-action="device-revoke" onClick={forget}>{t('devTab.forgetThis')}</button>}
        </div>
        {d && !d.passkey && <span className="mt-set-hint" data-role="self-no-passkey">{t('passkeyMode.selfNoPasskey')}</span>}
        <span className="mt-set-hint">{t('devTab.selfPcOnly')}</span>
      </Section>
    </div>
  );
}

// PC 창 위쪽의 허락 요청 카드(웹 화면에는 없다)
export function PairRequestBanner() {
  const view = useDevices();
  if (isWeb || !view || !view.requests || !view.requests.length) return null;
  return <div className="mt-wdev-banner" data-role="pair-request-banner"><Requests requests={view.requests} /></div>;
}
