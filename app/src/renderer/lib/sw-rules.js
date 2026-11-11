// P74: 서비스 워커(sw.js)가 무엇을 캐시하는지 정하는 순수 함수(단위 시험 app/test/p74-lib.test.mjs).
// 앱 껍데기(index.html, renderer.js·css, 글꼴, 그림, 매니페스트)만 캐시한다.
// API·WebSocket(/api), 짝 맺기·로그인·패스키·업로드(/web/*), hook(/hooks/*), 하위 세션 명령(/branch/*), /health, sw.js 자신,
// 다른 출처, GET이 아닌 요청은 손대지 않는다(서비스 워커가 응답하지 않으니 브라우저가 늘 백엔드에 묻는다. 쿠키·인증은 그대로).
// 껍데기 파일도 늘 네트워크를 먼저 묻고(새 버전이면 그것을 쓰고 캐시를 바꾼다), 네트워크가 안 될 때만 캐시를 쓴다.
// 백엔드가 거절한 응답(원격 막음 503, Host 421 등)은 캐시로 덮지 않고 그대로 보인다.

export const CACHE_PREFIX = 'atrium-shell-';
const NEVER = [/^\/api(\/|$)/, /^\/web\//, /^\/hooks\//, /^\/branch\//, /^\/health$/, /^\/sw\.js$/];
const SHELL = new Set(['/', '/index.html', '/renderer.js', '/renderer.css']);
const ASSET = [/^\/fonts\/[A-Za-z0-9._-]+$/, /^\/assets\/[A-Za-z0-9._\-/]+\.(svg|png|webmanifest|ico|webp|jpg)$/];

// 'pass' = 손대지 않음, 'shell' = 네트워크 먼저(안 되면 캐시), 'asset' = 네트워크 먼저(안 되면 캐시). 글꼴은 이름에 해시가 있어 캐시 먼저
export function swRoute({ url, method = 'GET', origin, mode = '' }) {
  if (String(method).toUpperCase() !== 'GET') return 'pass';
  let u;
  try { u = new URL(url); } catch { return 'pass'; }
  if (origin && u.origin !== origin) return 'pass';
  const p = u.pathname;
  if (NEVER.some((re) => re.test(p))) return 'pass';
  if (mode === 'navigate') return p === '/' || p === '/index.html' ? 'shell' : 'pass';
  if (SHELL.has(p)) return 'shell';
  if (/^\/fonts\//.test(p) && ASSET[0].test(p)) return 'font';
  if (ASSET[1].test(p)) return 'asset';
  return 'pass';
}

// 캐시에 넣어도 되는 응답: 같은 출처의 200, 쿠키를 주지 않음, no-store가 아님
export function cacheableResponse({ status, type = 'basic', headers = {} }) {
  const h = (k) => (typeof headers.get === 'function' ? headers.get(k) : headers[k]);
  if (status !== 200 || (type !== 'basic' && type !== 'default')) return false;
  if (h('set-cookie')) return false;
  if (/no-store/i.test(String(h('cache-control') || ''))) return false;
  return true;
}

// 설치할 때 미리 받는 목록(build.mjs가 dist의 파일로 만든다). 주소는 서비스 워커 범위(/) 기준.
// 글꼴(유니코드 범위로 나뉜 100여 개, 수 MB)은 미리 받지 않는다. 화면이 쓰는 것만 처음 쓸 때 캐시에 넣는다
export function shellList(files) {
  const out = ['./'];
  for (const f of files) {
    const p = '/' + String(f).replace(/\\/g, '/').replace(/^\/+/, '');
    if (p === '/index.html' || p.endsWith('.map')) continue;
    const r = swRoute({ url: `http://x${p}`, origin: 'http://x' });
    if (r === 'shell' || r === 'asset') out.push('.' + p);
  }
  return out;
}

export const cacheName = (version) => `${CACHE_PREFIX}${version}`;
// 활성화할 때 지울 옛 캐시(이 앱의 것만)
export const staleCaches = (names, version) => names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== cacheName(version));
