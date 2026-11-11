// 창 화면(renderer)을 한 파일로 묶는다: src/renderer → dist/renderer.js, dist/renderer.css, dist/index.html, dist/fonts/(P11 글꼴)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'dist');
fs.mkdirSync(out, { recursive: true });

await esbuild.build({
  absWorkingDir: ROOT,
  entryPoints: { renderer: path.join(ROOT, 'src', 'renderer', 'main.jsx') },
  outdir: out,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome140',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.woff2': 'file', '.woff': 'file' },
  // P11: 글꼴 파일(npm의 OFL 글꼴, src/renderer/fonts.css)은 dist/fonts/로 옮긴다. 창은 오프라인에서도 글꼴이 나온다
  assetNames: 'fonts/[name]-[hash]',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), path.join(out, 'index.html'));
// 종류 로고 같은 그림은 그대로 옮긴다(lib/kinds.js가 dist/index.html 기준 assets/… 주소로 가리킨다)
fs.rmSync(path.join(out, 'assets'), { recursive: true, force: true }); // 지운 그림(예: 옛 Claude 봇)이 dist에 남지 않게
fs.cpSync(path.join(ROOT, 'src', 'renderer', 'assets'), path.join(out, 'assets'), { recursive: true });

// P74: 원격 웹 화면의 서비스 워커(dist/sw.js). 껍데기 파일(sw-rules.js가 고른 것)의 내용 해시를 버전으로 넣는다.
// 껍데기가 바뀌면 sw.js의 바이트가 바뀌어 브라우저가 새 서비스 워커를 받고 캐시를 바꾼다. Electron 창은 쓰지 않는다
const { shellList } = await import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'lib', 'sw-rules.js')).href);
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`]));
const shellFiles = walk(out).filter((f) => f !== 'sw.js').sort();
const shell = shellList(shellFiles);
const hash = crypto.createHash('sha256');
for (const f of ['index.html', ...shellFiles.filter((x) => shell.includes(`./${x}`))]) { hash.update(f); hash.update(fs.readFileSync(path.join(out, f))); }
await esbuild.build({
  entryPoints: [path.join(ROOT, 'src', 'renderer', 'sw.js')],
  outfile: path.join(out, 'sw.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  define: { __SW_VERSION__: JSON.stringify(hash.digest('hex').slice(0, 16)), __SW_SHELL__: JSON.stringify(shell) },
  logLevel: 'warning',
});
console.log('built', path.relative(process.cwd(), out));
