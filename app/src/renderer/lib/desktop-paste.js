// P162: 데스크톱 창의 파일·그림 붙여 넣기(단위 시험 test/p162-lib.test.mjs).
// - 탐색기·Finder에서 복사한 파일: 클립보드의 file 주소를 그 OS의 경로로 바꾼다. 폴더는 main이 걸러 낸다(main.mjs mt:clipPaste)
// - 캡처한 그림: main이 판 데이터 폴더 uploads/에 PNG로 두고, 명령줄에는 [Image 1] 칩을 넣는다. 칩은 보낼 때 그 파일 경로로 바뀐다
// - 끌어 놓은 파일(macOS 판): 명령줄에는 그림이면 [Image n], 아니면 [File n] 칩, 터미널에는 경로 그대로
// - 칩은 겹(mirror)에 태그처럼 그리고(state 'image'), 칩 뒤 Backspace·앞 Delete는 P155 태그 칩처럼 통째로 지운다(tagDeleteRange)
// 웹 화면(P48 업로드)과 휴대폰은 이 길을 쓰지 않는다.
import { quotePath } from './upload.js';

// text/uri-list → 경로 목록. # 줄(주석)과 file 아닌 주소는 뺀다.
// Windows: file:///C:/a%20b → C:\a b, file://server/share/x → \\server\share\x
// macOS·Linux: file:///Users/a%20b → /Users/a b(원본은 Windows 꼴로만 바꿔 macOS 경로가 \Users\…로 깨졌다)
const runtimePlatform = () => globalThis.window?.mt?.platform || globalThis.process?.platform || 'win32';
export function uriListPaths(text, { platform = runtimePlatform() } = {}) {
  const win = platform === 'win32';
  const out = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !/^file:/i.test(line)) continue;
    let rest = line.replace(/^file:/i, '');
    let host = '';
    if (rest.startsWith('//')) { rest = rest.slice(2); const i = rest.indexOf('/'); host = i < 0 ? rest : rest.slice(0, i); rest = i < 0 ? '' : rest.slice(i); }
    let p;
    try { p = decodeURIComponent(rest); } catch { p = rest; }
    const remote = host && host.toLowerCase() !== 'localhost';
    if (!win) p = remote ? `//${host}${p}` : p.normalize('NFC');
    else if (remote) p = `\\\\${host}${p.replace(/\//g, '\\')}`;
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

// 칩: 그림은 [Image n], 그 밖의 파일·폴더는 [File n]. 번호는 둘이 함께 센다(images: 번호 → { path, thumb, kind: 'image'|'file', name })
export const imageLabel = (n) => `[Image ${n}]`;
export const fileLabel = (n) => `[File ${n}]`;
export const chipLabel = (n, entry) => (entry && entry.kind === 'file' ? fileLabel(n) : imageLabel(n));
const IMAGE_RE = /\[(Image|File) (\d+)\]/g;

// 글 속의 칩 → [{ start, end, ref, n, lead:false, state:'image', img:true }]. images에 있는 번호이고 종류가 맞을 때만 칩이다(손으로 친 글은 아니다)
export function imageTokens(text, images) {
  const s = String(text ?? '');
  const out = [];
  IMAGE_RE.lastIndex = 0;
  let m;
  while ((m = IMAGE_RE.exec(s))) {
    const n = Number(m[2]);
    const entry = images && images[n];
    if (!entry) continue;
    if ((m[1] === 'File') !== (entry.kind === 'file')) continue;
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

// 붙여 넣기를 가로챌지: 데스크톱이고 클립보드에 파일(그림 포함)이 있을 때.
// Windows: 글이 있으면 지금처럼 글. macOS: Finder는 파일을 복사하면 파일 이름을 글로도 넣으므로 글이 있어도 main에 묻는다
// (main이 파일·그림을 못 찾으면 null이고, 부른 쪽이 그 글을 그대로 넣는다)
export function wantsDesktopPaste(dt, { desktop, platform = runtimePlatform() }) {
  if (!desktop || !dt) return false;
  const files = !!(dt.types && [...dt.types].includes('Files'));
  if (!files) return false;
  if (platform === 'darwin') return true;
  let text = '';
  try { text = dt.getData('text/plain') || ''; } catch { text = ''; }
  return !text;
}

// 이름으로 그림인지(칩 종류, 미리보기)
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i;
export const isImagePath = (p) => IMAGE_EXT.test(String(p || ''));

// 끌어 놓은 것 나누기: 경로가 있는 파일(Finder에서 끈 것)과 경로가 없는 파일(브라우저에서 끈 그림 등, 내용으로 올려야 한다).
// pathFor(file)은 preload의 webUtils.getPathForFile(없거나 빈 값이면 경로 없음)
export function dropParts(dt, pathFor) {
  const files = dt && dt.files ? [...dt.files] : [];
  const paths = [], blobs = [];
  for (const f of files) {
    let p = '';
    try { p = pathFor ? String(pathFor(f) || '') : ''; } catch { p = ''; }
    if (p) paths.push(p.normalize('NFC')); else blobs.push(f);
  }
  return { paths, blobs };
}
