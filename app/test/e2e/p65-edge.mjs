// P65: 스크린숏의 글자 가장자리 폭(px)을 잰다(p65-sharp.mjs와 같은 식). PNG(8비트 RGB/RGBA, 비월 없음)는 여기서 푼다.
import zlib from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG가 아니다');
  let p = 8, W = 0, H = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('8비트 비월 없는 PNG만'); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`색 형식 ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = W * bpp, out = Buffer.alloc(H * stride);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = out.subarray(y * stride, (y + 1) * stride), up = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = up ? up[x] : 0, c = up && x >= bpp ? up[x - bpp] : 0;
      const pr = () => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      row[x] = (src[x] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pr())) & 255;
    }
  }
  const Y = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) Y[i] = 0.2126 * out[i * bpp] + 0.7152 * out[i * bpp + 1] + 0.0722 * out[i * bpp + 2];
  return { W, H, Y };
}

// 가로·세로 줄에서 밝기가 대비(p99.5 - p0.5)의 절반 넘게 한쪽으로 바뀌는 구간의 10%→90% 거리 평균. 한 픽셀에 끝나면 0.8
export function edgeWidth({ W, H, Y }) {
  const sorted = Float32Array.from(Y).sort();
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const contrast = q(0.995) - q(0.005);
  const widths = [];
  const scan = (len, at) => {
    const close = (a, b) => {
      const d = at(b) - at(a);
      if (b <= a || Math.abs(d) < 0.5 * contrast) return;
      const cross = (lv) => { for (let k = a; k < b; k++) { const u = at(k), v = at(k + 1); if ((u - lv) * (v - lv) <= 0 && u !== v) return k + (lv - u) / (v - u); } return b; };
      widths.push(Math.abs(cross(at(a) + 0.9 * d) - cross(at(a) + 0.1 * d)));
    };
    let a = 0, dir = 0;
    for (let k = 1; k < len; k++) {
      const sg = Math.sign(at(k) - at(k - 1));
      if (sg === 0) { close(a, k - 1); a = k; dir = 0; continue; }
      if (dir !== 0 && sg !== dir) { close(a, k - 1); a = k - 1; }
      dir = sg;
    }
    close(a, len - 1);
  };
  for (let y = 0; y < H; y++) scan(W, (x) => Y[y * W + x]);
  for (let x = 0; x < W; x++) scan(H, (y) => Y[y * W + x]);
  return { edge: widths.length ? +(widths.reduce((s, v) => s + v, 0) / widths.length).toFixed(3) : null, edges: widths.length, contrast: +contrast.toFixed(1) };
}
