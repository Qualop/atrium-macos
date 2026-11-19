// P165: 창의 마이크 권한. 판 창의 첫 쪽(dist/index.html)이 소리만 청할 때 허락하고, 카메라·화면이나 다른 쪽(바깥 주소)은 막는다.
// 마이크가 아닌 다른 권한은 Electron 기본(허락) 그대로 둔다(알림·클립보드 등 지금 동작을 바꾸지 않는다)
import { pathToFileURL } from 'node:url';

// 같은 파일 주소인가(쿼리·조각은 뺀다, Windows 드라이브 글자는 크기를 가리지 않는다)
function sameFile(a, b) {
  const clean = (u) => String(u || '').split(/[?#]/)[0].replace(/^file:\/\/\/([a-z]):/i, (_m, d) => `file:///${d.toLowerCase()}:`);
  return !!a && clean(a) === clean(b);
}

// permission: Electron 권한 이름, mediaTypes: details.mediaTypes, url: 청한 쪽 주소, boardFile: 판 첫 쪽 파일 경로, fromBoard: 판 창의 webContents인가
export function permissionAllowed({ permission, mediaTypes, url, boardFile, fromBoard }) {
  if (permission !== 'media') return true;
  const types = Array.isArray(mediaTypes) ? mediaTypes : [];
  if (!types.length || types.some((x) => x !== 'audio')) return false;
  if (!fromBoard) return false;
  return sameFile(url, pathToFileURL(boardFile).href);
}
