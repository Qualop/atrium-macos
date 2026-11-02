// 응답·연결 종료·시간 초과 중 먼저 끝난 경로가 대기 항목과 타이머를 함께 정리한다.
export function pendingRequest(wait, id, send, { method, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (fn, value) => { clearTimeout(timer); wait.delete(id); fn(value); };
    const entry = { res: (v) => finish(resolve, v), rej: (e) => finish(reject, e) };
    wait.set(id, entry);
    timer = setTimeout(() => entry.rej(Object.assign(new Error(`Request timed out: ${method}`), { code: 'timeout' })), timeoutMs);
    try { send(); } catch (e) { entry.rej(e); }
  });
}
