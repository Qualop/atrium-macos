// 창 화면(renderer)을 한 파일로 묶는다: src/renderer → dist/renderer.js, dist/renderer.css, dist/index.html, dist/fonts/(P11 글꼴)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
console.log('built', path.relative(process.cwd(), out));
