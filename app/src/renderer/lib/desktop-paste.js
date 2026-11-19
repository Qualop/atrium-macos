// P162: 데스크톱 창의 파일·그림 붙여 넣기(단위 시험 test/p162-lib.test.mjs).
// - 탐색기에서 복사한 파일: 클립보드의 text/uri-list(file:///…)를 Windows 경로로 바꾼다. 폴더는 main이 걸러 낸다(main.mjs mt:clipPaste)
// - 캡처한 그림: main이 판 데이터 폴더 uploads/에 PNG로 두고, 명령줄에는 [Image 1] 칩을 넣는다. 칩은 보낼 때 그 파일 경로로 바뀐다
// - 칩은 겹(mirror)에 태그처럼 그리고(state 'image'), 칩 뒤 Backspace·앞 Delete는 P155 태그 칩처럼 통째로 지운다(tagDeleteRange)
// 웹 화면(P48 업로드)과 휴대폰은 이 길을 쓰지 않는다.
import { quotePath } from './upload.js';

// text/uri-list → 경로 목록. # 줄(주석)과 file 아닌 주소는 뺀다. file:///C:/a%20b → C:\a b, file://server/share/x → \\server\share\x
export function uriListPaths(text) {
  const out = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !/^file:/i.test(line)) continue;
    let rest = line.replace(/^file:/i, '');
    let host = '';
    if (rest.startsWith('//')) { rest = rest.slice(2); const i = rest.indexOf('/'); host = i < 0 ? rest : rest.slice(0, i); rest = i < 0 ? '' : rest.slice(i); }
    let p;
    try { p = decodeURIComponent(rest); } catch { p = rest; }
    if (host && host.toLowerCase() !== 'localhost') p = `\\\\${host}${p.replace(/\//g, '\\')}`;
    else p = p.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
    if (p) out.push(p);
  }
  return out;
}

// 폴더 거르기: isDir(경로)가 참이면 빼고 수만 센다 → { paths, folders }. 알 수 없는 것(isDir가 던짐)은 파일로 본다
export function splitFolders(paths, isDir) {
  const out = [];
  let folders = 0;
  for (const p of paths || []) {
    let dir = false;
    try { dir = !!isDir(p); } catch { dir = false; }
    if (dir) folders++; else out.push(p);
  }
  return { paths: out, folders };
}

// 붙여 넣은 경로들을 입력에 넣는 글: 빈칸 등이 든 경로는 따옴표, 여럿은 빈칸으로 잇고 끝에 빈칸 하나(P48 pathsText와 같은 꼴)
export const pastePathsText = (paths) => (paths && paths.length ? `${paths.map(quotePath).join(' ')} ` : '');

// 그림 칩
export const imageLabel = (n) => `[Image ${n}]`;
const IMAGE_RE = /\[Image (\d+)\]/g;

// 글 속의 그림 칩 → [{ start, end, ref, n, lead:false, state:'image', img:true }]. images(번호 → { path })에 있는 번호만 칩이다(손으로 친 글은 아니다)
export function imageTokens(text, images) {
  const s = String(text ?? '');
  const out = [];
  IMAGE_RE.lastIndex = 0;
  let m;
  while ((m = IMAGE_RE.exec(s))) {
    const n = Number(m[1]);
    if (!images || !images[n]) continue;
    out.push({ start: m.index, end: m.index + m[0].length, ref: m[0], n, lead: false, state: 'image', img: true });
  }
  return out;
}

// 태그 조각과 그림 칩을 차례대로 합친다(겹에 그리기, 칩 지우기). 겹치면 앞의 것을 남긴다
export function mergeTokens(a, b) {
  const all = [...(a || []), ...(b || [])].sort((x, y) => x.start - y.start);
  const out = [];
  for (const tk of all) if (!out.length || tk.start >= out[out.length - 1].end) out.push(tk);
  return out;
}

// 다음 그림 번호: 지금 글에 있는 칩 번호의 가장 큰 것 + 1
export function nextImageNo(text, images) {
  let max = 0;
  for (const tk of imageTokens(text, images)) max = Math.max(max, tk.n);
  return max + 1;
}

// 보낼 글: 칩을 그 그림 파일 경로로 바꾼다(빈칸이 든 경로는 따옴표). 에이전트(Claude Code·Codex)는 경로로 그림을 연다
export function expandImages(text, images) {
  const s = String(text ?? '');
  let out = '', at = 0;
  for (const tk of imageTokens(s, images)) {
    out += s.slice(at, tk.start) + quotePath(images[tk.n].path);
    at = tk.end;
  }
  return out + s.slice(at);
}

// 붙여 넣기를 가로챌지: 데스크톱이고, 클립보드에 글이 없고 파일(그림 포함)이 있을 때만. 글이 있으면 지금처럼 글
export function wantsDesktopPaste(dt, { desktop }) {
  if (!desktop || !dt) return false;
  let text = '';
  try { text = dt.getData('text/plain') || ''; } catch { text = ''; }
  if (text) return false;
  return !!(dt.types && [...dt.types].includes('Files'));
}
