// P48(원격 R2): 웹 화면의 짝 맺기. 기기 토큰이 없는 브라우저는 보드를 보지 못하고 이 화면만 본다.
// PC 보드(설정 > 연결된 기기)에서 만든 6자리 코드를 넣거나, PC에 허락을 청하고 PC 창에서 "허락"을 누르면 기기 토큰을 받아 이 브라우저에 저장한다.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useT, setLanguage } from './lib/i18n.js';
import { saveDeviceToken, webMe, markPaired, deviceToken } from './web.js';
import { BRAND_WORDMARK } from './lib/icons.jsx';

// 기본 기기 이름: 브라우저와 OS
export function guessDeviceName(ua = navigator.userAgent) {
  const b = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} · ${os}` : b;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error((j && j.error && j.error.message) || String(r.status)), { code: j && j.error && j.error.code, status: r.status, retryAfterMs: j && j.error && j.error.retryAfterMs });
  return j;
}

function PairScreen({ onDone }) {
  const t = useT();
  const [name, setName] = useState(guessDeviceName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [req, setReq] = useState(null); // { requestId, secret, check, expiresAt }
  const timer = useRef(null);
  const why = (e) => (e.code === 'rate_limited' ? t('pair.rateLimited', { s: Math.ceil((e.retryAfterMs || 60000) / 1000) }) : e.code === 'bad_code' || e.code === 'no_code' ? t('pair.badCode') : t('pair.failed', { error: e.message }));
  const finish = (r) => { saveDeviceToken(r.token); markPaired(); onDone(); };

  async function submitCode(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try { finish(await post('/web/pair/code', { code: code.trim(), name })); } catch (err) { setError(why(err)); setBusy(false); }
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
        if (r.status === 'approved') return finish(r);
        if (r.status === 'denied') { setReq(null); return setError(t('pair.denied')); }
        if (r.status !== 'pending') { setReq(null); return setError(t('pair.expired')); }
      } catch {}
      if (live) timer.current = setTimeout(poll, 1500);
    };
    timer.current = setTimeout(poll, 1000);
    return () => { live = false; clearTimeout(timer.current); };
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-pair" data-role="pair">
      <form className="mt-pair-card" onSubmit={submitCode}>
        <img className="mt-pair-brand" src={BRAND_WORDMARK} alt="Atrium" draggable={false} />
        <h3>{t('pair.title')}</h3>
        <p className="mt-pair-note">{t('pair.note')}</p>
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
      </form>
    </div>
  );
}

// 짝을 맺은 브라우저면 곧바로, 아니면 짝 맺기 화면을 보이고 맺은 뒤에 끝난다
export async function webGate() {
  let me = null;
  try { me = await webMe(); } catch { if (deviceToken()) { markPaired(); return; } } // 백엔드가 잠깐 없으면 처음 화면이 연결 오류를 보인다
  if (me) { markPaired(); return; }
  try { if (/^ko\b/i.test(navigator.language || '')) setLanguage('ko'); } catch {}
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await new Promise((res) => root.render(<PairScreen onDone={res} />));
  root.unmount(); host.remove();
}
