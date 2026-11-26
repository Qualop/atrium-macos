// P48(원격 R2): 웹 화면에서 올린 파일의 PC 경로를 입력에 넣는 글로 바꾼다. 빈칸 등이 든 경로는 따옴표로 감싸고, 여럿이면 빈칸으로 잇고 끝에 빈칸 하나
export const quotePath = (p) => (/[\s"'&()^;,]/.test(p) ? `"${String(p).replace(/"/g, '')}"` : String(p));
export const pathsText = (paths) => (paths && paths.length ? `${paths.map(quotePath).join(' ')} ` : '');
// 터미널에 넣는 경로(셸·에이전트 입력줄). Windows는 위 따옴표 꼴(cmd·PowerShell).
// macOS·Linux는 Terminal.app에 끌어 놓을 때처럼 백슬래시로 하나씩 막는다: zsh는 큰따옴표 안의 $·`·!를 풀고, [ ] * ?는 글롭이다.
// (Claude Code가 터미널에 끌어 놓은 그림을 받는 꼴과 같다)
const POSIX_SAFE = /[\p{L}\p{N}\p{M}_./@%+=:,-]/u;
export function termPath(p, platform) {
  const s = String(p);
  if (platform === 'win32') return quotePath(s);
  let out = '';
  for (const ch of s) out += POSIX_SAFE.test(ch) ? ch : ch === '\n' ? "$'\\n'" : `\\${ch}`;
  return out;
}
export const termPathsText = (paths, platform) => (paths && paths.length ? `${paths.map((p) => termPath(p, platform)).join(' ')} ` : '');
// 끌어 놓기·붙여넣기에 파일이 있는지
export const filesOf = (dt) => (dt && dt.files ? [...dt.files] : []);
export const hasFiles = (dt) => !!(dt && dt.types && [...dt.types].includes('Files'));
// 글 상자의 커서 자리에 끼워 넣은 글과 새 커서 자리
export function insertAt(text, start, end, add) {
  const s = Math.max(0, Math.min(start ?? text.length, text.length)), e = Math.max(s, Math.min(end ?? s, text.length));
  const pad = s > 0 && !/\s$/.test(text.slice(0, s)) ? ' ' : '';
  const next = text.slice(0, s) + pad + add + text.slice(e);
  return { text: next, caret: s + pad.length + add.length };
}
