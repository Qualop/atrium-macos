// P165: 음성 입력 글 넣기의 순수 함수(단위 시험 test/p165-lib.test.mjs).
// 녹음을 시작한 커서 자리(start)부터 들은 글이 들어간다. 자리 = { start, fin, live }
//   start: 들은 글이 들어가는 첫 자리, fin: 그 뒤 확정된 글 길이, live: 그 뒤 아직 확정 안 된 글 길이(창이 흐리게 그린다)
// 글은 그냥 입력칸의 글이라 고치기·@태그·그림 칩과 섞인다. 손으로 고친 자리가 들은 글 앞이면 자리를 옮기고, 뒤면 그대로,
// 들은 글 안이면 거기까지를 손으로 고친 보통 글로 보고(live 0) 다음 글은 그 끝에 이어 붙인다.

export const VOICE_SAMPLE_RATE = 16000;

const isSpace = (ch) => /\s/.test(ch || '');
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// 녹음 시작. 커서 자리(고른 글이 있으면 그 끝)
export function voiceStart(text, caret) {
  const s = String(text ?? '');
  return { start: clamp(Number.isFinite(caret) ? caret : s.length, 0, s.length), fin: 0, live: 0 };
}

// 들은 글 끝(확정 + 미확정)
export const voiceEnd = (reg) => (reg ? reg.start + reg.fin + reg.live : 0);
// 흐리게 그릴 범위 [a, b)
export const liveRange = (reg) => (reg && reg.live > 0 ? { a: reg.start + reg.fin, b: reg.start + reg.fin + reg.live } : null);

// 들은 글 토막 하나(final: 새로 확정된 글, interim: 지금 미확정 글 전체)를 넣는다 → { text, reg, at, removed, added }
// 첫 글은 앞 글자와 띄어 쓴다(앞이 빈칸·줄 머리면 들은 글의 앞 빈칸을 뺀다). at~removed는 바뀐 범위(커서 옮기기용)
export function voiceApply(text, reg, { final = '', interim = '' } = {}) {
  const s = String(text ?? '');
  if (!reg) return { text: s, reg, at: s.length, removed: 0, added: 0 };
  const start = clamp(reg.start, 0, s.length);
  let fin = clamp(reg.fin, 0, s.length - start);
  let live = clamp(reg.live, 0, s.length - start - fin);
  let f = String(final), i = String(interim);
  if (fin === 0) {
    // 아직 확정 글이 없으면 앞 띄어 쓰기를 여기서 맞춘다(미확정 글이 바뀔 때마다 다시)
    const before = start > 0 ? s[start - 1] : '';
    const lead = (x) => (start === 0 || isSpace(before) ? x.replace(/^\s+/, '') : x && !isSpace(x[0]) ? ' ' + x : x);
    if (f) f = lead(f); else if (i) i = lead(i);
  }
  const at = start + fin;
  const added = f + i;
  const rest = s.slice(at + live);
  // 글 가운데에 넣으면 뒤 글자와도 띄어 쓴다(빈칸은 들은 글 밖에 한 번만 둔다)
  const tail = added && rest && !isSpace(rest[0]) && !isSpace(added[added.length - 1]) ? ' ' : '';
  const out = s.slice(0, at) + added + tail + rest;
  return { text: out, reg: { start, fin: fin + f.length, live: i.length }, at, removed: live, added: added.length + tail.length };
}

// 바뀐 범위(at에서 removed 글자를 지우고 added 글자를 넣음)를 지나 커서를 옮긴다.
// 바뀐 범위 뒤(끝 포함)의 커서는 함께 밀리고, 안의 커서는 새 글 끝으로 간다
export function shiftPos(pos, at, removed, added) {
  if (pos < at) return pos;
  if (pos >= at + removed) return pos + added - removed;
  return at + added;
}

// 두 글의 다른 범위 → { at, removed, added }(앞뒤 같은 부분을 뺀 가운데)
export function diffRange(prev, next) {
  const a = String(prev ?? ''), b = String(next ?? '');
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a[p] === b[p]) p++;
  let q = 0;
  while (q < max - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return { at: p, removed: a.length - p - q, added: b.length - p - q };
}

// 손으로 고친 글(prev → next)에 맞춰 자리를 옮긴다
export function voiceEdit(prev, next, reg) {
  if (!reg || prev === next) return reg;
  const d = diffRange(prev, next);
  const delta = d.added - d.removed;
  const rs = reg.start, re = voiceEnd(reg);
  const editEnd = d.at + d.removed;
  // 들은 글 앞: 자리를 민다(아직 들은 글이 없을 때 그 자리에 친 글도 앞으로 본다. 들은 글은 친 글 뒤에 이어진다)
  if (editEnd <= rs) return { ...reg, start: rs + delta };
  // 들은 글 뒤: 그대로
  if (d.at > re || (d.at === re && d.added === 0)) return reg;
  // 들은 글과 겹침, 또는 들은 글 끝에 이어 친 글: 거기까지를 보통 글(확정)로 두고 다음 들은 글은 그 끝에 이어 붙인다
  const ns = Math.min(rs, d.at);
  const ne = Math.max(re, editEnd) + delta;
  return { start: ns, fin: Math.max(0, ne - ns), live: 0 };
}

// 녹음 끝: 남은 미확정 글은 그대로 보통 글이 된다(지우지 않는다)
export function voiceDone(reg) { return reg ? { ...reg, fin: reg.fin + reg.live, live: 0 } : reg; }

// 겹(mirror) 조각을 흐린 범위로 더 나눈다. parts: [{ text, tag? }] → 흐린 조각에는 live: true
export function splitLive(parts, range) {
  if (!range || range.b <= range.a) return parts;
  const out = [];
  let pos = 0;
  for (const p of parts || []) {
    const s = p.text, a = pos, b = pos + s.length;
    pos = b;
    if (b <= range.a || a >= range.b) { out.push(p); continue; }
    const x = Math.max(a, range.a) - a, y = Math.min(b, range.b) - a;
    if (x > 0) out.push({ ...p, text: s.slice(0, x) });
    out.push({ ...p, text: s.slice(x, y), live: true });
    if (y < s.length) out.push({ ...p, text: s.slice(y) });
  }
  return out;
}

// 마이크 소리(Float32, 브라우저 표본율) → 16kHz 16비트 PCM. 구간 평균으로 줄인다(높은 소리 접힘을 줄인다)
export function toPcm16(input, inRate, outRate = VOICE_SAMPLE_RATE) {
  const src = input || new Float32Array(0);
  const ratio = inRate / outRate;
  if (!(ratio >= 1)) {
    const out = new Int16Array(src.length);
    for (let k = 0; k < src.length; k++) out[k] = clamp(Math.round(src[k] * 32767), -32768, 32767);
    return out;
  }
  const n = Math.floor(src.length / ratio);
  const out = new Int16Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.floor(k * ratio), b = Math.min(src.length, Math.floor((k + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += src[j];
    const v = b > a ? sum / (b - a) : src[a] || 0;
    out[k] = clamp(Math.round(v * 32767), -32768, 32767);
  }
  return out;
}

// 오류 까닭 → 화면 글 열쇠
export function voiceErrorKey(code) {
  switch (code) {
    case 'voice_no_key': return 'voice.noKey';
    case 'voice_busy': return 'voice.busy';
    case 'denied': case 'NotAllowedError': case 'SecurityError': return 'voice.denied';
    case 'NotFoundError': case 'nomic': return 'voice.noMic';
    case 'insecure': return 'voice.insecure';
    case 'limit': return 'voice.limit';
    case 'disconnected': case 'dropped': return 'voice.dropped';
    default: return 'voice.failed';
  }
}
