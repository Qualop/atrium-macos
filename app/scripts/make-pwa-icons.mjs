// P49: 설치형 웹 앱(PWA) 아이콘을 브랜드 SVG(src/renderer/assets/brand/atrium-icon.svg)에서 만든다.
// 사용: cd app && node scripts/make-pwa-icons.mjs  → src/renderer/assets/pwa/icon-192.png, icon-512.png, maskable-512.png
// Playwright Chromium으로 그린다(시험용으로 이미 받은 브라우저). 그림이 바뀔 때만 다시 돌린다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'brand', 'atrium-icon.svg'), 'utf8');
const out = path.join(ROOT, 'src', 'renderer', 'assets', 'pwa');
fs.mkdirSync(out, { recursive: true });
const BG = '#070705'; // 판 바탕(어두운 테마)
const browser = await chromium.launch();
try {
  for (const [name, size, pad, round] of [['icon-192.png', 192, 0.12, 0.22], ['icon-512.png', 512, 0.12, 0.22], ['maskable-512.png', 512, 0.22, 0]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const inner = Math.round(size * (1 - 2 * pad));
    await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;background:${BG};border-radius:${Math.round(size * round)}px;display:grid;place-items:center">${svg.replace('<svg ', `<svg style="width:${inner}px;height:${inner}px" `)}</div></body></html>`);
    await page.screenshot({ path: path.join(out, name), omitBackground: true });
    await page.close();
    console.log(`${name} ${size}px`);
  }
} finally { await browser.close(); }
