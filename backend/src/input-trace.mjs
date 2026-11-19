// P136: 터미널(패널)마다 최근 입력·초점·크기·모드·기록 읽기를 값만 적어 두고, 입력 칸에 마우스 보고 꼴 글(`[<65;101;61M`)이 보이면
// 그 기록을 판 로그에 한 번 남긴다. 같은 일이 다시 생기면 그 줄로 무엇이 그 앞에 터미널에 들어갔는지 바로 본다.
// - 남기는 것은 값뿐이다: 바이트 수, 마우스 보고 수·휠 수·마지막 보고의 단추;열;줄, 초점 보고(I·O), 크기, 모드, 기록 읽기의 줄 수·방식·걸린 시간.
//   사람이 친 글과 화면 글은 남기지 않는다(입력 칸에서 찾은 마우스 보고 꼴 글만 남긴다)
// - P136에서 찾은 것: hc의 기록 읽기(terminal.read lines>0)는 전체 화면 앱(Codex 등)을 휠 보고로 굴려 읽는다(stitched). 아무도 보지 않는
//   터미널은 hc 기본 크기 200x120이라 그 보고는 늘 가운데 `101;61`이다. 보고가 수백 개 몰리면 한 보고가 ESC와 나머지로 갈려 입력 칸에 글로 남는다

export const TRACE_KEEP = 80; // 패널마다 이만큼
export const TRACE_MS = 5 * 60 * 1000; // 이보다 오래된 것은 버린다

const MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])|\x1b\[M[\s\S]{3}/g;
const FOCUS = /\x1b\[([IO])/g;

// 터미널로 보낸 글의 값 요약. 글 내용은 남기지 않는다
export function inputSummary(data) {
  const s = String(data ?? '');
  let reports = 0, wheel = 0, last = null;
  let rest = s.replace(MOUSE, (m, b, x, y, f) => {
    reports++;
    const code = b != null ? Number(b) : m.charCodeAt(3) - 32;
    if (code & 64) wheel++;
    last = b != null ? `${b};${x};${y}${f}` : 'x10';
    return '';
  });
  let focus = '';
  rest = rest.replace(FOCUS, (m, k) => { focus += k; return ''; });
  const out = { bytes: s.length };
  if (reports) Object.assign(out, { reports, wheel, last });
  if (focus) out.focus = focus;
  if (rest.length) out.other = rest.length; // 마우스·초점 보고가 아닌 글의 길이(키·글)
  return out;
}

// 프레임 바이트에서 마우스·초점·대체 화면 모드(DECSET·DECRST)를 읽는다 → ['1003h', '1006h', …] 또는 null
const MODE_SET = new Set([9, 1000, 1002, 1003, 1004, 1005, 1006, 1007, 1015, 1016, 1047, 1049, 2004]);
export function modeChanges(bytes) {
  const s = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('latin1');
  if (!s.includes('\x1b[?')) return null;
  const out = [];
  for (const m of s.matchAll(/\x1b\[\?([\d;]+)([hl])/g)) for (const n of m[1].split(';')) if (MODE_SET.has(Number(n))) out.push(`${n}${m[2]}`);
  return out.length ? out : null;
}

// 화면 글의 입력 칸(마지막 프롬프트 줄부터 몇 줄)에 든 마우스 보고 꼴 글 → ['[<65;101;61M', …] 또는 null.
// 입력 칸 앞 기호: Codex `›`, Claude Code `❯`(옛 판 `>`)
const JUNK = /\[<\d{1,3};\d{1,4};\d{1,4}[Mm]/g;
const PROMPT = /^\s*[›❯>](\s|$)/;
export function inputBoxJunk(text) {
  const L = String(text || '').split(/\r?\n/);
  let at = -1;
  for (let i = L.length - 1; i >= 0; i--) if (PROMPT.test(L[i])) { at = i; break; }
  if (at < 0) return null;
  const m = L.slice(at, at + 6).join('\n').match(JUNK);
  return m && m.length ? m : null;
}

export class InputTrace {
  constructor({ log = () => {}, now = () => Date.now(), keep = TRACE_KEEP, ms = TRACE_MS } = {}) {
    this.log = log; this.now = now; this.keep = keep; this.ms = ms;
    this.panes = new Map(); // paneId → [{ t, kind, ...값 }]
    this.seen = new Map(); // paneId → 마지막으로 남긴 찌꺼기 글(같은 것을 거듭 남기지 않는다)
  }
  note(pane, kind, data = {}) {
    if (!pane) return;
    const now = this.now();
    let a = this.panes.get(pane);
    if (!a) { a = []; this.panes.set(pane, a); }
    a.push({ t: now, kind, ...data });
    while (a.length > this.keep || (a.length && now - a[0].t > this.ms)) a.shift();
  }
  recent(pane) { const now = this.now(); return (this.panes.get(pane) || []).filter((e) => now - e.t <= this.ms); }
  forget(pane) { this.panes.delete(pane); this.seen.delete(pane); }
  // 읽은 화면 글을 본다. 입력 칸에 새 마우스 보고 꼴 글이 있으면 그 패널의 최근 기록을 로그에 남기고 돌려준다
  checkScreen(pane, text, via = 'read') {
    const junk = inputBoxJunk(text);
    if (!junk) { this.seen.delete(pane); return null; }
    const sig = junk.join('');
    if (this.seen.get(pane) === sig) return null;
    this.seen.set(pane, sig);
    const now = this.now();
    const trace = this.recent(pane).map((e) => { const { t, kind, ...v } = e; return `${t - now}ms ${kind}${Object.keys(v).length ? ' ' + JSON.stringify(v) : ''}`; });
    const rec = { pane, via, junk: junk.slice(0, 4), count: junk.length, trace };
    this.log(`input junk in ${pane} (${via}): ${junk.length}x ${junk.slice(0, 2).join(' ')}; recent ${JSON.stringify(trace)}`);
    return rec;
  }
}
