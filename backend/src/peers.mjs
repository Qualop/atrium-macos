// P47(원격 R1): 붙은 클라이언트(창, 웹, 트레이) 목록과 알림 받을 클라이언트. 판단은 multiclient.mjs의 순수 함수가 한다.
// 이벤트 clients.updated {clients, notify}: 목록이나 알림 받을 클라이언트가 바뀔 때 구독한 클라이언트 모두에게 보낸다.
import { clientList, pickNotifyClient, parseClientHello, bindAuth, ACTIVE_MS } from './multiclient.mjs';

const TICK_MS = 15000; // 활성이 저절로 끝나는 것(ACTIVE_MS)을 알아채는 주기

export class Peers {
  constructor({ api, now = () => Date.now(), log = () => {} }) {
    this.api = api; this.now = now; this.log = log;
    this.last = null;
    this.timer = setInterval(() => this.publish(), TICK_MS);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); }
  conns() { return [...this.api.clients]; }
  view() {
    const list = clientList(this.conns());
    return { clients: list, notify: pickNotifyClient(list, this.now()), activeMs: ACTIVE_MS };
  }
  // 바뀐 때만 보낸다(lastInputAt만 바뀐 것은 알림 받을 클라이언트가 바뀔 때만)
  publish(force = false) {
    const v = this.view();
    const sig = JSON.stringify({ c: v.clients.map((c) => [c.clientId, c.name, c.kind, c.conns]), n: v.notify });
    if (!force && sig === this.last) return v;
    this.last = sig;
    this.api.broadcast('clients.updated', v);
    return v;
  }
  // 사람이 무엇을 했다(터미널 입력, 초점, 화면 옮기기, 창의 키·마우스). 알림 받을 클라이언트를 고르는 데 쓴다
  touch(c) { if (!c) return; c.lastInputAt = this.now(); this.publish(); }
  opened() { this.publish(); }
  closed() { this.publish(); }
}

// API 처리기. 백엔드가 handlers()를 만들 때는 Peers가 아직 없어(ApiServer보다 늦게 만든다) b.peers를 부를 때 읽는다
export function peerHandlers(b) {
  return {
    // 연결 주소 대신 첫 메시지로 알릴 수도 있다(P48 웹 화면). 주소 값과 같은 이름을 쓴다
    'client.hello': (p, c) => { const h = bindAuth(parseClientHello(p || {}), c && c.auth); /* P49: 기기 연결은 web */ if (h.clientId) Object.assign(c, h); else if (p && p.name) c.name = String(p.name).slice(0, 60); b.peers.publish(); return { clientId: c.clientId, name: c.name, kind: c.kind }; },
    'client.active': (_p, c) => { b.peers.touch(c); return { ok: true, notify: b.peers.view().notify }; },
    'clients.list': (_p, c) => ({ ...b.peers.view(), me: c ? c.clientId : null }),
    // P49: 웹 화면이 15초마다 부른다. 왕복 지연(ms)을 재고, 잠자기·네트워크 바뀜 뒤 죽은 연결을 알아챈다
    'ping': (p) => ({ t: p && Number.isFinite(p.t) ? p.t : null, at: Date.now() }),
  };
}
