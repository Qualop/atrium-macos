// 휴대폰의 키·글도 지금 붙은 터미널에만 보낸다. 비동기 전송 중 재접속하면 남은 입력은 버린다.
export function phoneInputTarget(api, terms, id) {
  const target = terms.get(id)?._mtInputTarget?.();
  return api.status === 'open' && target ? JSON.stringify({ generation: api.generation, ...target }) : null;
}

export function phoneInputCall(api, terms, id, method, params = {}, target = phoneInputTarget(api, terms, id)) {
  if (!target || target !== phoneInputTarget(api, terms, id)) return Promise.reject(Object.assign(new Error('terminal attachment changed'), { code: 'stale_attachment' }));
  const { generation, ...attachment } = JSON.parse(target);
  return api.call(method, { ...params, session: id, ...attachment });
}
