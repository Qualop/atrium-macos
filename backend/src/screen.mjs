// 화면 요약(ARCH 5절): pane.read 글자에서 마지막 줄, 권한 요청 선택지, 신뢰 대화상자를 읽는다.
// 상태는 화면 글자로 정하지 않는다(2.2). 여기 결과는 상세와 확인에만 쓴다.

export function tailLines(text, n = 12) {
  return String(text || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n);
}

// 신뢰 대화상자(E10 2.2)
export function isTrustDialog(text) { return /Quick safety check/i.test(text) && /trust this folder/i.test(text); }

// P71: 워크트리 나가기 질문. `claude -w`로 띄운 세션이 끝날 때 Claude Code가 묻는다(제목 "Exiting worktree session").
// "You have 13 commits on worktree-x. The branch will be deleted if you remove the worktree." 아래에 "1. Keep worktree", "2. Remove worktree"
// (tmux가 있으면 "Keep worktree and tmux session" 등)가 있다. 선택지 설명(Stays at <경로>)은 같은 줄 뒤나 다음 줄이라 번호 줄의 이름만 읽는다.
// 패널이 낮으면 Claude Code는 고른 선택지 하나만 보인다(P71에서 본 2.1.319: "❯ 1. Keep worktree    Stays at …"만 있고 2번은 화면 밖).
// 그때 보이지 않는 쪽은 Claude Code의 선택지 순서로 정한다: 남기기는 1번, 지우기는 2번(tmux가 있으면 3번). 그렇게 정한 것은 hidden: true다.
// → null | { commits(모르면 null), files(커밋 안 한 파일 수, 없으면 0), branch, keep: { n, label, hidden? }, remove: { n, label, hidden? }, choices }
export function parseWorktreeExit(text) {
  const s = String(text || '');
  if (!/Exiting worktree session/i.test(s)) return null;
  const choices = [];
  for (const raw of s.split('\n')) {
    const m = raw.match(/^[\s│|]*(❯\s*)?(\d)\.\s+((?:Keep|Remove) worktree[^│|]*?)\s*[│|]?\s*$/);
    if (m) choices.push({ n: Number(m[2]), label: m[3].trim().split(/\s{2,}/)[0] }); // 같은 줄에 설명(Stays at …)이 붙으면 떼어 낸다
  }
  if (!choices.length) return null;
  const tmux = choices.some((c) => /tmux/i.test(c.label));
  const keep = choices.find((c) => /^Keep worktree( and tmux session)?$/i.test(c.label)) || { n: 1, label: tmux ? 'Keep worktree and tmux session' : 'Keep worktree', hidden: true };
  const remove = choices.find((c) => /^Remove worktree/i.test(c.label)) || { n: tmux ? 3 : 2, label: tmux ? 'Remove worktree and tmux session' : 'Remove worktree', hidden: true };
  if (keep.n === remove.n) return null;
  const flat = s.replace(/[│|]/g, ' ').replace(/\s+/g, ' '); // 화면 폭에서 꺾인 문장을 잇는다
  const c = flat.match(/\b(\d+) commits?\b/i);
  const f = flat.match(/\b(\d+) uncommitted files?\b/i);
  const b = flat.match(/\bcommits? on (\S+?)\.?\s/i) || flat.match(/\bbranch (\S+?) (?:will be deleted|may hold)/i);
  return { commits: c ? Number(c[1]) : null, files: f ? Number(f[1]) : 0, branch: b ? b[1] : null, keep, remove, choices };
}

// 권한 요청 선택지(E9 2.1): "❯ 1. Yes", "  2. Yes, and …", "  3. No". 화면 아래쪽 마지막 번호 목록을 읽는다.
export function parseChoices(text) {
  const lines = String(text || '').split('\n');
  let block = [];
  let cur = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*(❯\s*)?(\d+)\.\s+(.*\S)\s*$/);
    if (m) cur.push({ n: Number(m[2]), label: m[3], selected: !!m[1] });
    else if (cur.length && /^\s{3,}\S/.test(raw)) cur[cur.length - 1].label += ' ' + raw.trim(); // 화면 폭에서 줄바꿈된 선택지를 이어 붙인다(P2)
    else if (cur.length && raw.trim()) { block = cur; cur = []; }
  }
  if (cur.length) block = cur;
  // 1부터 이어지는 번호만 선택지로 본다
  return block.length && block[0].n === 1 && block.every((c, i) => c.n === i + 1) ? block : [];
}

// 대화상자의 질문 줄("Do you want to create e9-a.txt?")
export function parsePromptLine(text) {
  const m = String(text || '').match(/^\s*(Do you want[^\n]*\?)\s*$/m);
  return m ? m[1].trim() : null;
}


// G2(P5): 일반 셸이 프롬프트에서 쉬는가, 명령을 돌리는가. Windows에서 터미널의 process_info는 셸 프로세스만 주고
// 셸 아래에서 도는 명령은 주지 않는다(P5에서 확인). 그래서 화면 마지막 줄이 프롬프트인지 보고, 마지막 프롬프트 줄의 명령 글을 읽는다.
// 프로세스 이름은 따로 프로세스 표(셸 PID의 자식)에서 얻는다. 이 결과는 셸의 표시에만 쓴다.
const PROMPTS = [/^PS [^>]*>\s?(.*)$/, /^[A-Za-z]:\\[^>]*>(.*)$/]; // PowerShell, cmd
export function shellPromptState(text) {
  const lines = String(text || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  if (!lines.length) return { atPrompt: false, command: null };
  const cmdOf = (l) => { for (const re of PROMPTS) { const m = l.match(re); if (m) return m[1].trim(); } return null; };
  const last = lines[lines.length - 1];
  const atPrompt = cmdOf(last) === '' || /[$#%❯]$/.test(last); // bash, zsh 기본 프롬프트
  let command = null;
  for (let i = lines.length - (atPrompt ? 2 : 1); i >= 0; i--) { const c = cmdOf(lines[i]); if (c) { command = c; break; } }
  return { atPrompt, command };
}

// P79: Claude Code 입력 칸 읽기. 화면 아래쪽 가로줄(───) 둘 사이가 입력 칸이고 첫 줄은 "❯ "(옛 판은 "> ")로 시작한다.
// → { found, text(입력 칸 글, 앞 기호를 뗀 것), above(입력 칸 위의 줄들) }. 그런 가로줄 쌍이 없으면 found: false
const RULE = /^\s*[─━]{12,}\s*$/;
// P90: 대기 메시지가 있을 때 빈 입력 칸의 안내 글(흐린 글이라 글자로는 구별되지 않는다). 빈 칸으로 본다
// P106: 빈 입력 칸의 흐린 추천 글(예: Try "fix lint errors")도 빈 칸으로 본다
const BOX_HINTS = [/^Press up to edit queued messages$/i, /^Try "[^"]*"$/];
export function claudeInputBox(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const rules = [];
  for (let i = 0; i < lines.length; i++) if (RULE.test(lines[i])) rules.push(i);
  for (let k = rules.length - 1; k > 0; k--) {
    const top = rules[k - 1], bottom = rules[k];
    const body = lines.slice(top + 1, bottom);
    if (!body.length || !/^\s*[❯>](\s|$)/.test(body[0])) continue;
    const t = body.map((l, i) => (i === 0 ? l.replace(/^\s*[❯>]\s?/, '') : l.trim())).join(' ').replace(/\s+/g, ' ').trim();
    return { found: true, text: BOX_HINTS.some((re) => re.test(t)) ? '' : t, above: lines.slice(0, top), rows: body.length }; // P128: rows(입력 칸 줄 수)
  }
  return { found: false, text: '', above: lines };
}
// P106: Codex 입력 칸 읽기. 화면 아래쪽의 마지막 "› " 줄이 입력 칸이고, 꺾인 글은 그 아래 들여 쓴 줄로 이어지며 빈 줄에서 끝난다(그 아래는 모델·폴더 줄).
// 빈 입력 칸은 흐린 안내 글(예: "Ask Codex to do anything")을 보인다. 글자로는 구별되지 않아 알려진 안내 글은 빈 칸으로 본다(Codex에는 다시 보내지 않으므로 틀려도 손대지 않을 뿐이다)
const CODEX_HINTS = [/^Ask Codex to do anything$/i, /^Find and fix a bug in @filename$/i, /^Explain this codebase$/i, /^Summarize recent commits$/i, /^Implement \{feature\}$/i, /^Write tests for @filename$/i, /^Improve documentation in @filename$/i, /^Run \/review on my current changes$/i, /^Use \/skills to list available skills$/i];
export function codexInputBox(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  let at = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) if (/^\s*›(\s|$)/.test(lines[i])) { at = i; break; }
  if (at < 0) return { found: false, text: '', above: lines };
  const body = [lines[at].replace(/^\s*›\s?/, '')];
  for (let i = at + 1; i < lines.length && lines[i].trim() && /^\s{2}/.test(lines[i]); i++) body.push(lines[i].trim());
  const t = body.join(' ').replace(/\s+/g, ' ').trim();
  return { found: true, text: CODEX_HINTS.some((re) => re.test(t)) ? '' : t, above: lines.slice(0, at), rows: body.length }; // P128: rows(입력 칸 줄 수)
}
// 보낸 글(prompt)과 화면을 견준다 → { box: 'ours' | 'empty' | 'other' | 'unknown', seen(입력 칸 위에 보낸 글 첫머리가 보인다 = 이미 들어갔을 수 있다) }
// 긴 글은 입력 칸에서 접히거나([Pasted text #1 +N lines], Codex는 [Pasted Content N chars]) 잘릴 수 있어 첫머리(40자)로 본다. kind: 'claude' | 'codex'
const flatText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export function promptOnScreen(screenText, prompt, kind = 'claude') {
  const box = kind === 'codex' ? codexInputBox(screenText) : claudeInputBox(screenText);
  const want = flatText(prompt);
  const head = want.slice(0, 40);
  const seen = !!head && box.above.some((l) => flatText(l).includes(head.slice(0, 30)));
  if (!box.found) return { box: 'unknown', seen };
  if (!box.text) return { box: 'empty', seen };
  // P126: 입력 칸 앞뒤의 마우스 보고 글(ESC가 떨어져 글로 들어간 `[<65;101;61M`)은 사람의 글이 아니다. 떼고 견준다(noise에 남긴다)
  const noise = (box.text.match(MOUSE_NOISE_G) || []).join('');
  const text = noise ? box.text.replace(MOUSE_NOISE_G, '').trim() : box.text;
  if (!text) return { box: 'empty', seen, ...(noise ? { noise } : {}) };
  const pasted = /^\[Past(ed text #\d+|ed Content)/.test(text) && (/\n/.test(String(prompt)) || want.length > 200);
  const bare = (s) => s.replace(/\s+/g, ''); // 화면 폭에서 꺾인 줄을 이을 때 낱말 가운데 빈칸이 생긴다
  const bx = bare(text), wn = bare(want);
  if (bx.startsWith(bare(head)) || (bx.length >= 12 && wn.startsWith(bx)) || pasted) return { box: 'ours', seen, ...(noise ? { noise } : {}) };
  return { box: 'other', seen, ...(noise ? { noise } : {}) };
}
// P126: ESC가 떨어져 글로 남은 SGR 마우스 보고(휠 64·65, 누르기·움직임). 숫자 셋과 M·m으로 끝나는 꼴이라 사람의 글과 헷갈리지 않는다
const MOUSE_NOISE_G = /\[<\d{1,3};\d{1,4};\d{1,4}[Mm]/g;
export const mouseNoise = (s) => (String(s || '').match(MOUSE_NOISE_G) || []).join('');

// P131: 터미널 칸 너비(한글·한자·전각·그림 글자는 두 칸, 결합 문자는 0칸). 화면 글자 줄을 칸 단위로 자를 때 쓴다
export function cellWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x20 || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfe0f) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff)
    || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}
// 줄의 앞 n칸
export function cellSlice(line, n) {
  let w = 0, out = '';
  for (const ch of String(line || '')) { const c = cellWidth(ch); if (w + c > n) break; w += c; out += ch; }
  return out;
}
const cellsOf = (s) => { let w = 0; for (const ch of String(s || '')) w += cellWidth(ch); return w; };

// P131: opencode 입력 칸 읽기(2.2.7에서 본 모양). 입력 칸은 왼쪽 굵은 세로줄(┃) 줄들이고 그 아래 "╹▀▀▀…" 줄이 끝이다.
//   ┃                       ← 위 여백
//   ┃  글 첫 줄(꺾인 줄은 다음 ┃ 줄로 이어진다)
//   ┃                       ← 아래 여백
//   ┃  Build · <모델> …     ← 에이전트·모델 줄(입력 칸 글이 아니다)
//   ╹▀▀▀▀▀▀▀▀
// 대화 화면에서는 입력 칸 오른쪽에 사이드바가 같은 줄에 그려지므로 아래 "╹▀…" 줄의 칸 너비까지만 읽는다.
// 빈 입력 칸은 흐린 안내 글("Ask anything… "<예시>"", 셸 모드는 "Run a command… "<예시>"")을 보인다. 글자로는 구별되지 않아 그 꼴은 빈 칸으로 본다.
// → { found, text, rows(글 줄 수), above, folded?(접힌 붙여넣기·첨부 표시가 있다) }. 모양이 다르면 found: false(모른다)
const OPENCODE_HINT = /^(Ask anything|Run a command)…( ".*"?)?$/;
export function opencodeInputBox(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  let bottom = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^\s*╹▀{8,}/.test(lines[i])) { bottom = i; break; } // 첫 화면에서는 입력 칸이 화면 가운데에 있다
  if (bottom < 0) return { found: false, text: '', above: lines };
  const m = lines[bottom].match(/^(\s*)(╹▀+)/);
  const left = cellsOf(m[1]), width = cellsOf(m[2]);
  let top = bottom;
  while (top - 1 >= 0 && /^\s*┃/.test(lines[top - 1]) && cellsOf(lines[top - 1].match(/^\s*/)[0]) === left) top--;
  // 각 줄: 입력 칸 너비까지 자르고 "┃" 뒤 여백(두 칸)을 뗀다
  const rows = lines.slice(top, bottom).map((l) => cellSlice(l, left + width).replace(/^\s*┃ {0,2}/, '').replace(/\s+$/, ''));
  if (rows.length < 3) return { found: false, text: '', above: lines };
  const body = rows.slice(0, -1); // 끝 줄은 에이전트·모델 줄
  if (body.length && !body[0]) body.shift(); // 위 여백
  if (body.length && !body[body.length - 1]) body.pop(); // 아래 여백
  const t = body.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ').trim();
  const hint = body.length === 1 && OPENCODE_HINT.test(t);
  return { found: true, text: hint ? '' : t, rows: hint || !t ? 0 : body.length, above: lines.slice(0, top), ...(/\[(Pasted ~\d+ lines|SVG:|Image \d)/.test(t) ? { folded: true } : {}) };
}

// P131: pi 입력 칸 읽기(1.5.0에서 본 모양). 입력 칸은 화면 아래쪽 마지막 가로줄(─) 둘 사이이고 앞 기호가 없다.
// 글이 입력 칸 높이(화면의 30%)보다 길면 가로줄에 "↑ N more"·"↓ N more"가 붙는다: 글이 다 보이지 않으므로 clipped(모른다)다.
// 큰 붙여넣기(10줄이나 1000자 넘음)는 "[paste #1 +N lines]"·"[paste #2 N chars]"로 접혀 보인다(folded).
// 가로줄 아래는 폴더·모델 줄(또는 자동 완성 목록)이다. → { found, text, rows, above, clipped?, folded? }
const PI_RULE = /^─{12,}$/;
const PI_SCROLL_RULE = /^─{2,}.*[↑↓]\s*\d+\s+more.*$/;
export function piInputBox(text) {
  const lines = String(text || '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const isRule = (l) => PI_RULE.test(l.trim()) || PI_SCROLL_RULE.test(l.trim());
  let bottom = -1;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) if (isRule(lines[i])) { bottom = i; break; }
  if (bottom < 1) return { found: false, text: '', above: lines };
  let top = -1;
  for (let i = bottom - 1; i >= Math.max(0, bottom - 60); i--) if (isRule(lines[i])) { top = i; break; }
  if (top < 0) return { found: false, text: '', above: lines };
  const body = lines.slice(top + 1, bottom);
  const t = body.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ').trim();
  const clipped = PI_SCROLL_RULE.test(lines[top].trim()) || PI_SCROLL_RULE.test(lines[bottom].trim());
  return { found: true, text: t, rows: t ? body.length : 0, above: lines.slice(0, top), ...(clipped ? { clipped: true } : {}), ...(/\[paste #\d+( \+\d+ lines| \d+ chars)?\]/.test(t) ? { folded: true } : {}) };
}

// P139: ANSI 화면(hc 관찰 붙기로 받은 지금 화면, adapter._paint)을 줄마다 글자와 그 글자의 흐림(SGR 2)·뒤집힘(SGR 7)으로 푼다.
// 커서 옮기기 같은 다른 이스케이프는 버린다(hc는 지금 화면을 줄 단위로 그려 준다). → [{ text, cells: [{ ch, dim, inv }] }]
export function ansiRows(ansi) {
  const rows = [];
  let dim = false, inv = false, cur = [];
  const s = String(ansi || '');
  const sgr = (params) => {
    const p = params === '' ? [0] : params.split(/[;:]/).map((x) => (x === '' ? 0 : Number(x)));
    for (let i = 0; i < p.length; i++) {
      const v = p[i];
      if (v === 0) { dim = false; inv = false; } else if (v === 2) dim = true; else if (v === 22) dim = false; else if (v === 7) inv = true; else if (v === 27) inv = false;
      else if (v === 38 || v === 48 || v === 58) { if (p[i + 1] === 5) i += 2; else if (p[i + 1] === 2) i += 4; } // 색 값 안의 2·7을 흐림·뒤집힘으로 읽지 않는다
    }
  };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\x1b') {
      const m = s.slice(i, i + 64).match(/^\x1b\[([0-?]*)([ -/]*)([@-~])/);
      if (m) { if (m[3] === 'm' && !m[2] && !/[<=>?]/.test(m[1])) sgr(m[1]); i += m[0].length; continue; }
      const o = s.slice(i).match(/^\x1b[\]P_^X][\s\S]*?(\x07|\x1b\\)/);
      if (o) { i += o[0].length; continue; }
      i += 2; continue;
    }
    if (c === '\n') { rows.push(cur); cur = []; i++; continue; }
    const cp = s.codePointAt(i), ch = String.fromCodePoint(cp);
    if (cp >= 0x20 && cp !== 0x7f) cur.push({ ch, dim, inv });
    i += ch.length;
  }
  rows.push(cur);
  return rows.map((cells) => ({ text: cells.map((x) => x.ch).join(''), cells }));
}

// P139: Claude Code의 다음 메시지 제안(턴이 끝난 뒤 입력 칸에 흐리게 보이는 글, Tab·→로 받는다)인가.
// 2.1.323에서 본 모양: 빈 입력 칸의 자리 글(placeholder)로 그려 글 전체가 흐림(ESC[2m)이고, 창에 초점이 있으면 첫 글자만 커서(뒤집힘)다.
// 사람이 친 글은 흐리지 않다. 입력 칸 글자 가운데 흐린 글자가 있고, 흐리지 않은 글자가 첫 글자(커서)뿐이면 제안이다. → 제안 글 | null
export function claudeSuggestion(ansi) {
  const rows = ansiRows(ansi);
  const box = claudeInputBox(rows.map((r) => r.text).join('\n'));
  if (!box.found || !box.text) return null;
  const top = box.above.length + 1;
  let dims = 0, plain = 0, first = true;
  for (let k = 0; k < box.rows; k++) {
    const cells = (rows[top + k] || { cells: [] }).cells;
    let j = 0;
    if (k === 0) { while (j < cells.length && /\s/.test(cells[j].ch)) j++; if (j < cells.length && /[❯>]/.test(cells[j].ch)) j++; } // 앞 기호
    for (; j < cells.length; j++) {
      const x = cells[j];
      if (/\s/.test(x.ch)) continue;
      if (x.dim) dims++;
      else if (!(first && x.inv)) plain++; // 첫 글자의 뒤집힘은 커서다
      first = false;
    }
  }
  return dims > 0 && plain === 0 ? box.text : null;
}
