// 업로드 자리(판 데이터 폴더 uploads/)의 파일 이름, 자리, 정리(P48에서 web.mjs에 두었던 것을 P162에서 떼었다).
// - 웹 화면의 붙여 넣기·끌어 놓기(POST /web/upload, web.mjs)와 데스크톱 창의 그림 붙여 넣기(app/src/main/main.mjs)가 같이 쓴다.
// - 정리 규칙: 7일 지난 것과 총 500MB를 넘는 만큼(오래된 것부터)을 지운다. 올릴 때·붙여 넣을 때와 백엔드가 뜰 때 돈다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_MAX_AGE_MS = 7 * 24 * 3600_000;
export const UPLOAD_MAX_TOTAL = 500 * 1024 * 1024;
// 데이터 폴더의 업로드 자리
export const uploadDirOf = (dataDir) => path.join(dataDir, 'uploads');
// P162: 판이 띄운 Claude Code가 업로드 자리의 파일(붙여 넣은 그림 등)을 묻지 않고 읽게 하는 허용 규칙.
// 작업 폴더 밖이라 규칙이 없으면 읽기마다 권한을 묻는다. 절대 경로 규칙은 //c/… 꼴(드라이브 글자는 작게)
export function uploadsReadRule(dataDir) {
  // C:\a\uploads → /c/a/uploads, /home/a/uploads는 그대로. 규칙은 앞에 / 하나를 더 붙인 //c/a/uploads/**
  const p = path.resolve(uploadDirOf(dataDir)).replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
  return `Read(/${p}/**)`;
}

// macOS 판: 시스템 임시 폴더 읽기(쓰기는 아님). 자동 모드여도 Claude Code는 작업 폴더 밖 읽기를 사람에게 묻는다.
// 도구(ego-browser 등)가 결과를 임시 폴더에 쓰면 워커마다 그 읽기를 물어 일이 멈췄다(2026-11-18 Stock: report-view가 $TMPDIR/egob.md)
export function tempReadRules({ tmpdir = os.tmpdir(), platform = process.platform } = {}) {
  if (platform === 'win32') return [];
  const dirs = new Set(['/tmp', '/private/tmp']);
  const t = path.resolve(tmpdir).replace(/\/+$/, '');
  if (t && t !== '/') { dirs.add(t); if (t.startsWith('/private/')) dirs.add(t.slice('/private'.length)); else if (t.startsWith('/var/')) dirs.add(`/private${t}`); }
  return [...dirs].map((d) => `Read(/${d}/**)`);
}

export function safeUploadName(name, contentType = '') {
  let base = path.basename(String(name || '').replace(/\\/g, '/')).normalize('NFC');
  base = base.replace(/[^\p{L}\p{N}._\- ()]/gu, '_').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  if (!base) {
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'text/plain': '.txt', 'application/pdf': '.pdf' }[String(contentType).split(';')[0].trim()] || '.bin';
    base = `pasted${ext}`;
  }
  if (base.length > 80) { const ext = path.extname(base).slice(0, 12); base = base.slice(0, 80 - ext.length) + ext; }
  return base;
}
export function uploadPath(dir, name, contentType, now = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
  return path.join(dir, `${stamp}-${crypto.randomBytes(3).toString('hex')}-${safeUploadName(name, contentType)}`);
}
// 오래된 것과 총량이 넘친 만큼(오래된 것부터) 지운다
export function cleanupUploads(dir, { maxAgeMs = UPLOAD_MAX_AGE_MS, maxTotal = UPLOAD_MAX_TOTAL, now = Date.now(), keep = null } = {}) {
  let files;
  try { files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => { const f = path.join(dir, e.name); const st = fs.statSync(f); return { f, size: st.size, mtime: st.mtimeMs }; }); } catch { return { removed: 0 }; }
  files.sort((a, b) => a.mtime - b.mtime);
  let total = files.reduce((n, x) => n + x.size, 0), removed = 0;
  for (const x of files) {
    if (x.f === keep) continue;
    if (now - x.mtime > maxAgeMs || total > maxTotal) { try { fs.rmSync(x.f, { force: true }); total -= x.size; removed++; } catch {} }
  }
  return { removed, total };
}
