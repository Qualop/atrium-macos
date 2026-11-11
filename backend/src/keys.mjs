// P104: 휴대폰 키 줄(창 Phone.jsx PhoneKeyPad)이 세션 패널에 보내는 키(session.keys). 판이 터미널의 질문에 답하는 UI(승인 줄·카드)는 없앴고,
// 사람은 터미널에서 직접 답한다. 휴대폰은 방향키를 칠 수 없으니 키를 이름으로 보내고, herdr pane.send_keys가 그 패널의 바이트로 바꾼다.
// 그래서 Claude Code, Codex, 셸 어디서나 같다(하네스마다 키 순서를 알 필요가 없다).
// - 받는 키는 허용 목록(KEY_NAMES)으로만 정한다. 글(pane.send_text)과 ctrl 조합은 받지 않는다. 한 번에 KEYS_MAX개까지
// - 한 세션의 요청은 차례로 보낸다(keyChain). herdr 요청은 부를 때마다 연결이 따로라, 겹쳐 보내면 차례가 섞일 수 있다
// - 무엇을 보냈는지는 세션 이벤트 'keys'로 남긴다(키 이름과 보낸 쪽만. 글은 없다)

export const KEY_NAMES = Object.freeze(['up', 'down', 'left', 'right', 'enter', 'esc', 'tab', 'space', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
const ALLOWED = new Set(KEY_NAMES);
export const KEYS_MAX = 32;

const bad = (message, key, vars = {}) => Object.assign(new Error(message), { code: 'bad_request', key, vars });

// 받은 키 목록을 검사한다. 맞으면 같은 키 배열(문자열), 아니면 bad_request(key: keysEmpty | keysTooMany | keysBad)
export function checkKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) throw bad('keys에 보낼 키를 하나 이상 지정하세요.', 'keysEmpty');
  if (keys.length > KEYS_MAX) throw bad(`한 번에 보낼 수 있는 키는 ${KEYS_MAX}개까지입니다: ${keys.length}`, 'keysTooMany', { n: keys.length, max: KEYS_MAX });
  const out = [];
  for (const k of keys) {
    const name = typeof k === 'number' && Number.isInteger(k) ? String(k) : k;
    if (typeof name !== 'string' || !ALLOWED.has(name)) throw bad(`허용되지 않은 키입니다: ${String(k).slice(0, 20)}`, 'keysBad', { key: String(k).slice(0, 20) });
    out.push(name);
  }
  return out;
}

// 세션마다 줄을 세워 하나씩 한다. 앞 일이 실패해도 다음 일은 한다. 반환: run(id, fn) → fn의 결과
export function keyChain() {
  const tails = new Map();
  const run = (id, fn) => {
    const prev = tails.get(id) || Promise.resolve();
    const next = prev.then(fn);
    const tail = next.then(() => {}, () => {});
    tails.set(id, tail);
    tail.then(() => { if (tails.get(id) === tail) tails.delete(id); });
    return next;
  };
  run.pending = () => tails.size;
  return run;
}

// 이벤트에 남길 보낸 쪽: 이 PC(창·CLI) 또는 짝 맺은 기기(ID와 이름)
export function keysBy(c) {
  const a = c && c.auth;
  if (a && a.kind === 'device' && a.device) return { via: 'device', deviceId: a.device.id, deviceName: a.device.name };
  return { via: a && a.kind ? a.kind : 'local' };
}
