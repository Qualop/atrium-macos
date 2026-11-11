// 휴대폰 화면 시험 전용. 저장소·프로필·서버 없이 예시 API만 쓴다.
import { api } from './upstream-ui-api.js';
export { api };
const fixture = window.__fixture;
api.conn = { phase: 'open', wasOpen: true, attempt: 0, since: null, lastClose: null };
fixture.seed(4);
fixture.sessions.forEach((s) => { s.state = 'ready'; delete s.sleep; });
fixture.sessions.push({ ...fixture.sessions[2], sessionId: 'session-4', name: 'gemini-fixture', kind: 'gemini' });
const base = api.call.bind(api);
api.call = async (method, p = {}) => {
  if (!method.startsWith('terminal.') && method !== 'session.keys' && method !== 'session.send') return base(method, p);
  fixture.calls.push({ method, params: structuredClone(p) });
  if (method === 'terminal.attach') {
    api.emit('terminal.frame', { sessionId: p.session, controllerPid: 7, attachmentId: p.attachmentId, width: p.cols, height: p.rows, full: true, bytes: btoa('\x1b[2J\x1b[Hphone fixture screen') });
    return { controllerPid: 7, attachmentId: p.attachmentId, shared: 1, ownerIsMe: true };
  }
  if (method === 'session.send') return { deliveries: [{ deliveryId: 'synthetic-delivery', state: 'queued' }] };
  return { ok: true };
};
