// P82: 짧은 끊김(몇 초 안에 다시 붙음)에는 화면을 흔들지 않는다. 연결 상태(api.js $conn)와 "끊김을 보일 때인가"를 함께 준다.
// 끊긴 뒤 SHORT_DROP_MS(2초)가 지나도 붙지 않았을 때만 다시 연결 띠·연결 알약을 바꾼다(lib/reconnect.js bannerDue). PC에서 끊었으면(4402) 바로
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { bannerDue } from './lib/reconnect.js';

export function useConnSteady() {
  const [conn, setConn] = useState(api.conn);
  const [, tick] = useState(0);
  useEffect(() => api.on('$conn', (c) => setConn({ ...c })), []);
  const due = bannerDue(conn);
  useEffect(() => {
    if (due == null || due === 0) return undefined;
    const t = setTimeout(() => tick((x) => x + 1), due + 20);
    return () => clearTimeout(t);
  }, [conn, due == null]); // eslint-disable-line react-hooks/exhaustive-deps
  // grace: 끊겼지만 아직 보이지 않는다(열린 것처럼 그린다)
  return { conn, shown: due === 0, grace: due != null && due > 0 };
}
