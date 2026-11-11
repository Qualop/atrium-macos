// P48(원격 R2): 웹 화면의 짝 맺기. 로그인하지 않은 브라우저는 보드를 보지 못하고 이 화면만 본다.
// PC 보드(설정 > 연결된 기기)에서 만든 6자리 코드를 넣거나, PC에 허락을 청하고 PC 창에서 "허락"을 누르면 짝을 맺는다.
// P56(원격 S2·S3): 짝을 맺으면 기기 토큰 대신 몇 분짜리 등록 허가를 받고, 이 브라우저에서 패스키(Windows Hello 등)를 만들어야 기기가 생긴다.
// P60: 짝 맺기와 다시 확인에서 휴대폰(iPhone·Android, QR과 블루투스)과 이 기기(Windows Hello·보안 키) 가운데 고른다(ViaChoice).
//   세션이 끝나면(12시간, 연결이 끊긴 채 30분, 4401) "다시 확인" 화면에서 패스키로 다시 확인한다. 짝이 풀렸으면 짝 맺기 화면으로 간다.
//   패스키를 쓸 수 없는 브라우저(보안 출처가 아님, WebAuthn 없음, IP 주소)는 이유를 보이고 막는다. 토큰으로 되돌아가는 길은 없다.
// P62: 판의 "패스키로 확인"이 꺼져 있으면(기본) 짝 맺기 응답이 곧바로 세션 쿠키를 주고 보드로 간다(패스키 만들기 단계 없음, 패스키를 못 쓰는 브라우저도 짝 맺는다).
//   켜져 있는데 이 브라우저가 패스키 없이 짝 맺었으면 "패스키 등록" 화면(EnrollScreen)에서 지금 세션으로 패스키를 한 번 만든다.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useT, setLanguage } from './lib/i18n.js';
import { webMe, markPaired, webDenied } from './web.js';
import { BRAND_WORDMARK } from './lib/icons.jsx';
import { isStandalone } from './lib/pwa.js'; // P74: 홈 화면 웹 앱
import { passkeySupport, savedPasskey, clearPasskey, registerPasskey, loginPasskey, enrollPasskey, webauthnError, savedVia, saveVia, PASSKEY_VIAS } from './lib/passkey.js';

// 기본 기기 이름: 브라우저와 OS
export function guessDeviceName(ua = navigator.userAgent) {
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  // P74: iPhone·iPad의 UA에도 "like Mac OS X"가 있어 iOS를 먼저 본다
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} · ${os}` : b;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error((j && j.error && j.error.message) || String(r.status)), { code: j && j.error && j.error.code, status: r.status, retryAfterMs: j && j.error && j.error.retryAfterMs, reason: j && j.error && j.error.reason });
  return j;
}
function useNow(on) { const [n, set] = useState(Date.now()); useEffect(() => { if (!on) return; const id = setInterval(() => set(Date.now()), 1000); return () => clearInterval(id); }, [on]); return n; }

// P59: P57 Tailscale 기기 확인의 까닭(짝 맺은 기기와 다름 등)
export const nodeWhy = (reason, t) => t(`pair.node_${['other_node', 'other_user', 'local_only', 'not_bound', 'login_mismatch'].includes(reason) ? reason : 'unknown'}`);
// 짝 맺은 Tailscale 기기와 달라 다시 확인해도 소용없는 거부(401). 짝 맺기 화면으로 간다
export const needsPairAgain = (e) => !!e && e.code === 'tailscale_node' && e.status === 401;

// 패스키·서버 오류를 화면 글로
function passkeyWhy(e, t) {
  const k = webauthnError(e);
  if (k) return t(`pair.pk_${k}`);
  if (e && (e.code === 'bad_grant')) return t('pair.grantExpired');
  if (e && e.code === 'grant_node') return t('pair.grantNode'); // P59: 허가를 받은 Tailscale 기기가 아님
  if (e && e.code === 'tailscale_node') return nodeWhy(e.reason, t);
  if (e && e.code === 'remote_blocked') return t('remoteAccess.blockedTitle');
  if (e && e.code === 'ip_host') return t('pair.unsupported_ip_host', { url: `http://localhost:${location.port}/` });
  return t('pair.pkFailed', { error: (e && e.message) || String(e) });
}

function Card({ children, onSubmit }) {
  return (
    <div className="mt-pair" data-role="pair">
      <form className="mt-pair-card" onSubmit={onSubmit || ((e) => e.preventDefault())}>
        <img className="mt-pair-brand" src={BRAND_WORDMARK} alt="Atrium" draggable={false} />
        {children}
      </form>
    </div>
  );
}

// P60: 패스키를 무엇으로 확인할지. 휴대폰(iPhone·Android, 하이브리드)을 먼저 둔다. 고른 것은 이 브라우저에 기억하고(비밀 아님) 서버가 hints로 바꾼다
export function ViaChoice({ via, onPick, disabled }) {
  const t = useT();
  return (
    <div className="mt-pk-via-wrap">
      <div className="mt-pk-via" role="radiogroup" aria-label={t('passkeyVia.label')} data-role="passkey-via" data-value={via || ''}>
        {PASSKEY_VIAS.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={via === v} className={`mt-pk-via-opt${via === v ? ' on' : ''}`} data-via={v} disabled={disabled} onClick={() => onPick(v)}>
            <b>{t(`passkeyVia.${v}`)}</b>
            <span>{t(`passkeyVia.${v}Sub`)}</span>
          </button>
        ))}
      </div>
      {via === 'phone' && <div className="mt-pair-hint mt-pk-via-hint" data-role="passkey-phone-hint">{t('passkeyVia.phoneHint')}</div>}
      {!via && <div className="mt-pair-hint">{t('passkeyVia.pickHint')}</div>}
    </div>
  );
}
function useVia() {
  const [via, setVia] = useState(() => savedVia());
  return [via, (v) => { setVia(v); saveVia(v); }];
}

// 짝을 맺은 뒤: 등록 허가로 패스키를 만든다(몸짓이 필요한 브라우저가 있어 버튼으로)
function RegisterStep({ grant, onDone, onRestart }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [via, pickVia] = useVia();
  const now = useNow(true);
  const left = Math.max(0, Math.ceil((grant.expiresAt - now) / 1000));
  async function create() {
    setBusy(true); setError(null);
    try { await registerPasskey(grant.grant, navigator.credentials, via); markPaired(); onDone(); } catch (e) { setError(passkeyWhy(e, t)); setBusy(false); }
  }
  return (
    <div className="mt-pair-wait" data-role="passkey-register">
      <h3>{t('pair.passkeyTitle')}</h3>
      <p className="mt-pair-note">{t('passkeyVia.registerNote')}</p>
      <ViaChoice via={via} onPick={pickVia} disabled={busy} />
      <div className="mt-card-actions">
        <button type="button" className="mt-btn primary" disabled={busy || left <= 0} onClick={create} data-action="passkey-create">{t('pair.createPasskey')}</button>
        <button type="button" className="mt-btn ghost" onClick={onRestart}>{t('common.cancel')}</button>
      </div>
      <div className="mt-pair-hint">{left > 0 ? t('pair.grantLeft', { s: left }) : t('pair.grantExpired')}</div>
      {error && <div className="mt-pair-error" data-role="pair-error">{error}</div>}
    </div>
  );
}

function PairScreen({ onDone, onHaveKey }) {
  const t = useT();
  const [name, setName] = useState(() => guessDeviceName() + (isStandalone() ? ' · App' : '')); // P74: 홈 화면 앱은 Safari와 따로 등록된다
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [req, setReq] = useState(null); // { requestId, secret, check, expiresAt }
  const [grant, setGrant] = useState(null); // P56: { grant, expiresAt } 등록 허가(이 페이지의 메모리에만)
  const timer = useRef(null);
  const why = (e) => (e.code === 'remote_blocked' ? t('remoteAccess.blockedTitle') : e.code === 'rate_limited' ? t('pair.rateLimited', { s: Math.ceil((e.retryAfterMs || 60000) / 1000) }) : e.code === 'bad_code' || e.code === 'no_code' ? t('pair.badCode') : t('pair.failed', { error: e.message }));

  async function submitCode(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await post('/web/pair/code', { code: code.trim(), name });
      if (r && r.paired) { markPaired(); onDone(); return; } // P62: 패스키 끔이면 이 응답이 세션 쿠키를 준다
      setGrant(r);
    } catch (err) { setError(why(err)); }
    setBusy(false);
  }
  async function ask() {
    setBusy(true); setError(null);
    try { setReq(await post('/web/pair/request', { name })); } catch (err) { setError(why(err)); }
    setBusy(false);
  }
  useEffect(() => {
    if (!req) return;
    let live = true;
    const poll = async () => {
      try {
        const r = await fetch(`/web/pair/poll?id=${encodeURIComponent(req.requestId)}&secret=${encodeURIComponent(req.secret)}`, { cache: 'no-store' }).then((x) => x.json());
        if (!live) return;
        if (r.status === 'approved') { setReq(null); if (r.paired) { markPaired(); return onDone(); } return setGrant({ grant: r.grant, expiresAt: r.expiresAt }); } // P62: 끔이면 곧바로 보드
        if (r.status === 'denied') { setReq(null); return setError(t('pair.denied')); }
        if (r.status !== 'pending') { setReq(null); return setError(t('pair.expired')); }
      } catch {}
      if (live) timer.current = setTimeout(poll, 1500);
    };
    timer.current = setTimeout(poll, 1000);
    return () => { live = false; clearTimeout(timer.current); };
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  if (grant) return <Card><RegisterStep grant={grant} onDone={onDone} onRestart={() => { setGrant(null); setCode(''); }} /></Card>;
  return (
    <Card onSubmit={submitCode}>
      <h3>{t('pair.title')}</h3>
      <p className="mt-pair-note">{t('pair.note')}</p>
      {isStandalone() && <div className="mt-pair-hint" data-role="pair-standalone">{webDenied && webDenied.passkey ? t('phone.pairAppPasskey') : t('phone.pairApp')}</div>}
      <label>{t('pair.name')}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} data-field="pair-name" /></label>
      {!req && (
        <>
          <label>{t('pair.code')}
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus data-field="pair-code" className="mt-pair-code" />
          </label>
          <div className="mt-pair-hint">{t('pair.codeHint')}</div>
          <div className="mt-card-actions">
            <button className="mt-btn primary" disabled={busy || code.length !== 6} data-action="pair-submit">{t('pair.connect')}</button>
            <span className="mt-pair-or">{t('pair.or')}</span>
            <button type="button" className="mt-btn" disabled={busy} onClick={ask} data-action="pair-ask">{t('pair.ask')}</button>
          </div>
          {onHaveKey && <div className="mt-pair-hint"><button type="button" className="mt-btn small ghost" onClick={onHaveKey} data-action="passkey-have">{t('pair.haveKey')}</button></div>}
        </>
      )}
      {req && (
        <div className="mt-pair-wait" data-role="pair-wait">
          <div>{t('pair.waiting')}</div>
          <div className="mt-pair-check" data-role="pair-check">{req.check}</div>
          <div className="mt-pair-hint">{t('pair.checkHint')}</div>
          <div className="mt-card-actions"><button type="button" className="mt-btn ghost" onClick={() => setReq(null)}>{t('common.cancel')}</button></div>
        </div>
      )}
      {error && <div className="mt-pair-error" data-role="pair-error">{error}</div>}
    </Card>
  );
}

// 다시 확인: 패스키로 서명해 새 세션을 받는다
function ReauthScreen({ saved, onDone, onPair, note }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [via, pickVia] = useVia(); // P60
  async function verify() {
    setBusy(true); setError(null);
    try {
      const r = await loginPasskey(saved && saved.credentialId, navigator.credentials, via);
      if (r.status === 'unpaired') { onPair(t('reauth.unpaired')); return; }
      markPaired(); onDone();
    } catch (e) {
      if (needsPairAgain(e)) { clearPasskey(); onPair(nodeWhy(e.reason, t)); return; } // P59: 다시 확인을 되풀이하지 않는다
      setError(e && e.code === 'rate_limited' ? t('pair.rateLimited', { s: Math.ceil((e.retryAfterMs || 60000) / 1000) }) : passkeyWhy(e, t)); setBusy(false); }
  }
  return (
    <Card>
      <div data-role="reauth">
        <h3>{t('reauth.title')}</h3>
        <p className="mt-pair-note">{saved && saved.name ? t('passkeyVia.reauthNote', { name: saved.name }) : t('passkeyVia.reauthNoteAny')}</p>
        {note && <div className="mt-pair-hint">{note}</div>}
        <ViaChoice via={via} onPick={pickVia} disabled={busy} />
        <div className="mt-card-actions">
          <button type="button" className="mt-btn primary" disabled={busy} onClick={verify} autoFocus data-action="passkey-verify">{t('reauth.verify')}</button>
          <button type="button" className="mt-btn ghost" disabled={busy} onClick={() => { clearPasskey(); onPair(null); }} data-action="reauth-pair">{t('reauth.repair')}</button>
        </div>
        {error && <div className="mt-pair-error" data-role="pair-error">{error}</div>}
      </div>
    </Card>
  );
}

// P62: 패스키 없이 짝 맺은 브라우저. PC에서 "패스키로 확인"을 켰으므로 지금 세션으로 패스키를 한 번 만든다(그 Tailscale 기기에서만)
function EnrollScreen({ onDone, onPair }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [via, pickVia] = useVia();
  async function enroll() {
    setBusy(true); setError(null);
    try { await enrollPasskey(navigator.credentials, via); markPaired(); onDone(); } catch (e) {
      if (e && (e.code === 'has_passkey' || e.code === 'passkey_off')) { location.reload(); return; } // 다른 탭에서 이미 만들었거나 PC에서 다시 껐다
      if (e && e.code === 'login_required') { onPair(t('reauth.unpaired')); return; }
      if (needsPairAgain(e)) { onPair(nodeWhy(e.reason, t)); return; }
      setError(passkeyWhy(e, t)); setBusy(false);
    }
  }
  return (
    <Card>
      <div data-role="passkey-enroll">
        <h3>{t('enroll.title')}</h3>
        <p className="mt-pair-note">{t('enroll.note')}</p>
        <ViaChoice via={via} onPick={pickVia} disabled={busy} />
        <div className="mt-card-actions">
          <button type="button" className="mt-btn primary" disabled={busy} onClick={enroll} autoFocus data-action="passkey-enroll">{t('pair.createPasskey')}</button>
        </div>
        {error && <div className="mt-pair-error" data-role="pair-error">{error}</div>}
      </div>
    </Card>
  );
}

function Unsupported({ sup }) {
  const t = useT();
  return (
    <Card>
      <div data-role="passkey-unsupported" data-reason={sup.reason}>
        <h3>{t('pair.unsupportedTitle')}</h3>
        <p className="mt-pair-note">{t(`pair.unsupported_${sup.reason}`, { url: sup.localUrl || 'http://localhost/' })}</p>
        {sup.reason === 'ip_host' && sup.localUrl && <p><a href={sup.localUrl} data-action="open-localhost">{sup.localUrl}</a></p>}
        <div className="mt-pair-hint">{t('pair.unsupportedNote')}</div>
      </div>
    </Card>
  );
}

function UnpairedNote() { const t = useT(); return t('reauth.unpaired'); }
function NodeNote({ reason }) { const t = useT(); return <span data-reason={reason}>{nodeWhy(reason, t)}</span>; }
// passkeyOff: 판의 패스키로 확인이 꺼져 있다(P62). 짝 맺기에는 패스키가 필요 없으므로 패스키를 못 쓰는 브라우저도 짝 맺기 화면을 본다
function Gate({ sup, onDone, initial, initialNote, passkeyOff }) {
  const [mode, setMode] = useState(initial);
  const [note, setNote] = useState(initialNote || null);
  const toPair = (n) => { setNote(n); setMode('pair'); };
  if (!sup.ok && !(passkeyOff && mode === 'pair')) return <Unsupported sup={sup} />;
  if (mode === 'enroll') return <EnrollScreen onDone={onDone} onPair={toPair} />;
  if (mode === 'login') return <ReauthScreen saved={savedPasskey()} onDone={onDone} note={null} onPair={toPair} />;
  return (
    <>
      {note && <div className="mt-pair-banner" data-role="pair-note">{note}</div>}
      <PairScreen onDone={onDone} onHaveKey={sup.ok ? () => setMode('login') : null} />
    </>
  );
}

// 로그인한 브라우저면 곧바로, 아니면 다시 확인이나 짝 맺기 화면을 보이고 마친 뒤에 끝난다
export async function webGate() {
  let me = null;
  try { me = await webMe(); } catch { if (savedPasskey()) { markPaired(); return; } } // 백엔드가 잠깐 없으면 처음 화면이 연결 오류를 보인다
  if (me) { markPaired(); return; }
  try { if (/^ko\b/i.test(navigator.language || '')) setLanguage('ko'); } catch {}
  const sup = passkeySupport(window);
  // P59: 짝 맺은 Tailscale 기기와 다르면(옛 기기 포함) 다시 확인해도 소용없다. 기억한 패스키를 버리고 짝 맺기 화면에 그 까닭을 보인다
  const nodeDenied = webDenied && webDenied.code === 'tailscale_node' ? webDenied.reason || 'unknown' : null;
  if (nodeDenied) clearPasskey();
  // 기억한 패스키가 아직 짝인지 먼저 묻는다(짝이 풀렸으면 곧바로 짝 맺기 화면). credential ID는 비밀이 아니다
  // P62: 패스키 없이 짝 맺은 기기인데 PC에서 패스키로 확인을 켰다 → 패스키 등록 화면
  const needEnroll = !!webDenied && webDenied.code === 'passkey_required';
  const passkeyOff = !!webDenied && webDenied.passkey === false;
  let initial = needEnroll ? 'enroll' : savedPasskey() ? 'login' : 'pair', unpaired = false;
  if (sup.ok && initial === 'login') {
    try { const r = await post('/web/passkey/login/options', { credentialId: savedPasskey().credentialId }); if (r.status === 'unpaired') { clearPasskey(); initial = 'pair'; unpaired = true; } } catch {}
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const note = nodeDenied ? <NodeNote reason={nodeDenied} /> : unpaired ? <UnpairedNote /> : null;
  await new Promise((res) => root.render(<Gate sup={sup} onDone={res} initial={initial} initialNote={note} passkeyOff={passkeyOff} />));
  root.unmount(); host.remove();
}
