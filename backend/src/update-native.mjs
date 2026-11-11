// Shared by packaging and update verification. Only inspect native files; never
// execute downloaded code to decide whether it is safe to execute.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const magic = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);
export function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(4); return fs.readSync(fd, b, 0, 4, 0) === 4 && magic.has(b.readUInt32BE()); } finally { fs.closeSync(fd); }
}
export const systemLibrary = name => name.startsWith('/usr/lib/') || name.startsWith('/System/Library/');
export function nativeInfo(file, exec = execFileSync) {
  let deps = String(exec('/usr/bin/otool', ['-L', '-m', file], { encoding: 'utf8', timeout: 15000 })).split('\n').slice(1).map(l => l.trim().replace(/ \(compatibility version.*$/, '')).filter(Boolean);
  const load = String(exec('/usr/bin/otool', ['-l', '-m', file], { encoding: 'utf8', timeout: 15000 }));
  const rpaths = [...load.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset \d+\)/g)].map(m => m[1]);
  const id = /cmd LC_ID_DYLIB\s+cmdsize \d+\s+name (.+?) \(offset \d+\)/.exec(load)?.[1];
  if (id) deps = deps.filter(dep => dep !== id);
  const header = String(exec('/usr/bin/otool', ['-hv', '-m', file], { encoding: 'utf8', timeout: 15000 }));
  return { deps, rpaths, id, executable: /\bEXECUTE\b/.test(header) };
}
const inside = (file, root) => file === root || file.startsWith(root + path.sep);
export function nativeFiles(root) {
  const files = [], base = fs.realpathSync(root);
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isSymbolicLink()) { if (!inside(fs.realpathSync(f), base)) throw Error('Bundle contains an external symlink.'); }
      else if (e.isDirectory()) walk(f);
      else if (e.isFile() && isMachO(f)) files.push(f);
    }
  };
  walk(root); return files;
}
function loaderPath(value, file, executableDir) {
  if (value.startsWith('@loader_path/')) return path.resolve(path.dirname(file), value.slice(13));
  if (value === '@loader_path') return path.dirname(file);
  if (value.startsWith('@executable_path/')) return path.resolve(executableDir, value.slice(17));
  if (value === '@executable_path') return executableDir;
  return value;
}
export function auditNativeBundle(bundle, { exec = execFileSync, arch = process.arch } = {}) {
  const base = fs.realpathSync(bundle), files = nativeFiles(bundle);
  for (const f of files) {
    exec('/usr/bin/lipo', ['-verify_arch', arch === 'x64' ? 'x86_64' : arch, f], { timeout: 15000, stdio: 'pipe' });
    const { deps, rpaths, executable } = nativeInfo(f, exec);
    const executableDir = executable ? path.resolve(path.dirname(f)) : path.join(base, 'Contents/MacOS');
    for (const r of rpaths) {
      const resolved = loaderPath(r, f, executableDir);
      if (!systemLibrary(resolved) && !inside(resolved, base)) throw Error('Native runtime has an external library search path.');
    }
    for (const d of deps) {
      if (systemLibrary(d)) continue;
      let candidates;
      if (d.startsWith('@rpath/')) candidates = [...rpaths.map(r => path.join(loaderPath(r, f, executableDir), d.slice(7))), ...(!executable ? [path.join(base, 'Contents/Frameworks', d.slice(7))] : [])];
      else candidates = [loaderPath(d, f, executableDir)];
      if (!candidates.some(c => path.isAbsolute(c) && inside(c, base) && fs.existsSync(c) && inside(fs.realpathSync(c), base))) throw Error(`Native runtime depends on an external or missing library: ${path.basename(d)}`);
    }
  }
  return { nativeFiles: files.length };
}
// Copy non-system dylibs and replace install names with relative loader paths.
// The caller supplies a license collector; a missing dependency/license fails
// packaging instead of shipping a bundle that works only on the builder's Mac.
export function bundleNativeBinary(file, libDir, { exec = execFileSync, onLibrary = () => {}, copied = new Map(), source = file } = {}) {
  const seen = new Set();
  const visit = (destination, source) => {
    if (seen.has(destination) || !isMachO(destination)) return;
    seen.add(destination);
    const info = nativeInfo(source, exec);
    for (const dep of info.deps) {
      if (systemLibrary(dep)) continue;
      // A dylib's first otool row may be its own install ID.
      if (path.isAbsolute(dep) && fs.existsSync(dep) && fs.realpathSync(dep) === fs.realpathSync(source)) continue;
      const candidates = dep.startsWith('@rpath/') ? info.rpaths.map(r => path.join(loaderPath(r, source, path.dirname(source)), dep.slice(7))) : [loaderPath(dep, source, path.dirname(source))];
      const from = candidates.find(c => path.isAbsolute(c) && fs.existsSync(c));
      if (!from) throw Error(`Cannot bundle native dependency ${dep}`);
      const real = fs.realpathSync(from), to = path.join(libDir, path.basename(from));
      if (copied.has(to) && copied.get(to) !== real) throw Error(`Native library name collision: ${path.basename(to)}`);
      if (!copied.has(to)) {
        copied.set(to, real); fs.mkdirSync(libDir, { recursive: true }); fs.copyFileSync(real, to); fs.chmodSync(to, 0o755); onLibrary(real);
        visit(to, real);
        exec('/usr/bin/install_name_tool', ['-id', `@loader_path/${path.basename(to)}`, to], { stdio: 'pipe' });
      }
      const relative = path.relative(path.dirname(destination), to).split(path.sep).join('/');
      exec('/usr/bin/install_name_tool', ['-change', dep, `@loader_path/${relative}`, destination], { stdio: 'pipe' });
    }
    for (const r of info.rpaths) if (path.isAbsolute(r) && !systemLibrary(r)) exec('/usr/bin/install_name_tool', ['-delete_rpath', r, destination], { stdio: 'pipe' });
  };
  visit(file, source);
  return copied;
}
