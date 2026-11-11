// 경로는 표시할 때만 줄인다. POSIX의 /와 대소문자, Windows 드라이브·UNC 접두부를 지킨다.
const windows = (p) => /^[a-z]:[\\/]/i.test(p) || p.startsWith('//') || p.startsWith('\\\\');
const slash = (p) => { const raw = String(p || ''); return windows(raw) ? raw.replace(/\\/g, '/') : raw; };
export function shortFolder(path, count = 2) {
  const p = slash(path), parts = p.split('/').filter(Boolean);
  if (parts.length <= count) return p;
  return `…/${parts.slice(-count).join('/')}`;
}
export function autoRootPath(group, workspaces) {
  const original = slash(group?.root);
  const root = original === '/' ? '/' : original.replace(/\/$/, '');
  if (!root) return null;
  const win = windows(original);
  const same = (p) => win ? p.toLowerCase() : p;
  const key = same(root), prefix = root === '/' ? '/' : `${key}/`;
  for (const w of workspaces || []) {
    if (!group?.members?.includes(w.key) || !w.root) continue;
    const p = slash(w.root);
    if (same(p) === key || same(p).startsWith(prefix)) return p.slice(0, root.length) + (/^[a-z]:$/i.test(root) ? '/' : '');
  }
  return null;
}
