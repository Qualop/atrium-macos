import { requireSupportedNode } from '../../backend/src/runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { HERDR_VERSION } from '../../backend/src/config.mjs';
import { MAC_HC_PINS } from '../../backend/src/hc/pin.mjs';

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('macOS Apple Silicon 또는 Intel이 필요합니다.');
requireSupportedNode();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// herdrdev/herdr v0.9.5 공식 GitHub 릴리스의 SHA-256. 버전 변경 시 함께 갱신한다.
const assets = {
  arm64: ['herdr-macos-aarch64', 'fb77c2232a05a8035421382c894392f4174e4e38a18e48af3dd0290157c3a7e2'],
  x64: ['herdr-macos-x86_64', '5fb0a908ec7f6745e3e245738b06bfad56c46391c391ab3c0955fbead01f1369'],
};
if (HERDR_VERSION !== '0.9.5') throw new Error('herdr 버전에 맞는 체크섬 갱신이 필요합니다.');
const [asset, digest] = assets[process.arch];
const dest = path.join(root, '.tools', 'herdr', `${HERDR_VERSION}-${process.arch}`, 'herdr');
const valid = () => fs.existsSync(dest) && crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex') === digest;
if (!valid()) {
  console.log(`herdr ${HERDR_VERSION} (${process.arch}) 다운로드`);
  const response = await fetch(`https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/${asset}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`다운로드 실패: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('herdr 체크섬 불일치');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const temporary = `${dest}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o755, flag: 'wx' });
    fs.renameSync(temporary, dest);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
fs.chmodSync(dest, 0o755);
// herdr-core(hc): 보드의 터미널 엔진. 고정한 공식 tar.gz(Developer ID 서명 그대로)를 받아 둔다. 보드가 처음 뜰 때 데이터 폴더에 풀고 서명을 확인한다
const hcPin = MAC_HC_PINS[process.arch];
const hcDest = path.join(root, '.tools', 'hc', `${hcPin.version}-${hcPin.target}.tar.gz`);
const hcValid = () => fs.existsSync(hcDest) && crypto.createHash('sha256').update(fs.readFileSync(hcDest)).digest('hex') === hcPin.sha256;
if (!hcValid()) {
  console.log(`herdr-core ${hcPin.version} (${hcPin.target}) 다운로드`);
  const response = await fetch(hcPin.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`다운로드 실패: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== hcPin.sha256) throw new Error('herdr-core 체크섬 불일치');
  fs.mkdirSync(path.dirname(hcDest), { recursive: true });
  const temporary = `${hcDest}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, bytes, { mode: 0o644, flag: 'wx' }); fs.renameSync(temporary, hcDest); }
  finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
for (const folder of ['backend', 'app']) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: path.join(root, folder), stdio: 'inherit' });
console.log('설치 완료. app 폴더에서 npm run mac으로 실행하세요.');
