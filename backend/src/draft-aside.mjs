// P128: 판이 세션에 지시를 보낼 때(B1 전달) 받는 세션의 입력 칸에 사람이 쓰다 만 글이 있으면, 그 글을 잠시 비키고 지시만 제출한 뒤 입력 칸에 되돌린다.
// 되돌린 글은 제출하지 않는다(사람이 이어 쓰거나 보낸다). 사람이 3초 안에 치는 중이면 지금처럼 기다린다(B1 규칙 4, 대기열이 먼저 본다).
// P139: 정확히 되돌릴 수 없는 글도 비키고 보낸다(화면에 보이던 대로 되돌리고 원래 글은 판 기록에 남긴다). 기다리는 것은 입력 칸을 비우지 못했을 때뿐이다.
//   아래 하네스별 설명의 "비키지 않는다"는 P128·P131 때 규칙이다. 지금은 그런 글도 끝으로 가서 지우기(End, Backspace)로 비킨다(draftMover 머리).
//
// 하네스마다:
// - Claude Code: 입력 치워 두기(Ctrl+S, chat:stash). 글·커서·붙여넣기(접힌 [Pasted text]와 그림 포함)를 Claude Code가 쥐고,
//   다음 지시가 제출되면 스스로 입력 칸에 되돌린다("Draft restored", `/`로 시작하는 명령은 되돌리지 않는다). 그래서 판은 글을 다시 만들 필요가 없다.
//   빈 입력 칸에서 Ctrl+S를 누르면 치워 둔 글을 꺼낸다(되돌리기가 안 됐을 때 판이 한 번 누른다). 치워 둔 글이 이미 있으면 Ctrl+S가 그 위에 덮으므로,
//   사람이 그 세션에서 Ctrl+S를 누른 뒤 아직 제출하지 않았으면 비키지 않는다. 사람이 ctrl+s나 chat:stash를 다른 키로 바꿨으면(keybindings.json) 쓰지 않는다.
// - Codex: 치워 두기가 없다. Ctrl+C(글이 있을 때)가 입력 칸을 비운다(빈 칸의 Ctrl+C는 끝내기 안내라 글이 보일 때만 누른다).
//   되돌릴 글은 판이 노드 터미널로 받은 사람 입력에서 다시 만든 글(draftEdit)이 화면의 입력 칸과 같을 때 그것을, 아니면 화면의 한 줄 입력 칸(꺾이지 않고
//   접힌 붙여넣기·그림이 없는 것)을 쓴다. 둘 다 아니면 비키지 않는다. 되돌리기는 괄호 붙여넣기(Enter 없음)다.
// - opencode·pi(P131): Codex와 같은 길이다. 판이 그 글을 정확히 알 때만 Ctrl+C로 비우고(둘 다 Ctrl+C가 "입력 칸 비우기"다) 제출 뒤 괄호 붙여넣기로 되돌린다.
//   opencode는 빈 칸의 Ctrl+C가 끝내기라 글이 보일 때만, 누르기 직전에 다시 보고 누른다. pi는 0.5초 안 두 번째 Ctrl+C가 끝내기라 판의 Ctrl+C 사이를 띄운다.
//   붙여넣기는 하네스가 큰 붙여넣기를 접어 보이므로(opencode 3줄·150자, pi 10줄·1000자를 넘으면 [Pasted ~N lines]·[paste #N …]) 접히지 않는 크기로 나눠 넣는다.
//   opencode의 입력 치워 두기(prompt.stash)는 기본 키가 없고(명령 팔레트로만) 사용자의 opencode 상태 폴더 파일에 남으므로 쓰지 않는다. pi는 치워 두기가 없다.
//   사람이 그 하네스 설정에서 입력 비우기 키를 바꿨으면(opencode keybinds, pi keybindings.json) 비키지 않는다.
// - 셸: 판이 글을 보내지 않는다. 그 밖의 종류는 입력 칸을 읽지 못하므로 손대지 않는다(전처럼 보낸다).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeInputBox, codexInputBox, opencodeInputBox, piInputBox, mouseNoise, claudeSuggestion } from './screen.mjs';

const MOUSE_NOISE_G = /\[<\d{1,3};\d{1,4};\d{1,4}[Mm]/g;
const bare = (s) => String(s || '').replace(/\s+/g, '');
// 화면에서 읽은 입력 칸 글끼리, 또는 다시 만든 글과 화면 글을 견준다(화면 폭에서 꺾인 줄과 여러 줄은 빈칸 없이 견준다)
export const sameDraft = (a, b) => bare(a) === bare(b);

// 판이 노드 터미널로 받은 사람 입력에서 입력 칸의 글을 다시 만든다. prev: { text, exact, paste } | null, data: 그 덩어리.
// - 글자와 붙여넣기(괄호 안의 줄바꿈 포함)는 끝에 붙고, 지우기(BS, DEL)는 끝 글자를 지운다(커서가 끝에 있을 때만 맞다)
// - Enter(\r)·Ctrl+C는 입력 칸을 비우거나 제출한다 → 빈 글, 정확함. Ctrl+U는 한 줄 글이면 빈 글
// - 커서를 옮기거나(화살표, Home 등) 고치는 키(Tab, Ctrl+W, Esc, Ctrl+J…)를 치면 더는 정확히 모른다(exact: false). 다음 Enter·Ctrl+C까지
// - 터미널이 대신 보낸 보고(마우스, 초점, 장치 속성, OSC·DCS 답)는 빼고 본다(P120·P126)
// 순수 함수. 덩어리 경계에서 끊긴 붙여넣기는 paste로 이어 간다
// opts.newlineKey: Ctrl+J가 줄바꿈인 하네스(opencode, pi)면 참. 아니면 Ctrl+J는 "모름"이다
export function draftEdit(prev, data, opts = {}) {
  let text = prev ? prev.text : '', exact = prev ? prev.exact !== false : true, paste = !!(prev && prev.paste);
  const s = String(data || '')
    .replace(/\x1b[\]P_^X][\s\S]*?(\x07|\x1b\\|\x9c)/g, '') // OSC·DCS 답
    .replace(/\x1b\[M[\s\S]{3}/g, '') // X10 마우스
    .replace(/\x1b\[<\d+;\d+;\d+[Mm]/g, '') // SGR 마우스
    .replace(/\x1b\[[IO]/g, '') // 초점 알림
    .replace(/\x1b\[[?>=][\d;]*c/g, ''); // 장치 속성 답
  const add = (ch) => { if (exact) text += ch; };
  for (let i = 0; i < s.length;) {
    if (s.startsWith('\x1b[200~', i)) { paste = true; i += 6; continue; }
    if (s.startsWith('\x1b[201~', i)) { paste = false; i += 6; continue; }
    const cp = s.codePointAt(i), ch = String.fromCodePoint(cp), n = ch.length;
    if (paste) { // 붙여넣은 글은 줄바꿈까지 그대로(CRLF·CR은 LF로)
      if (ch === '\r') { add('\n'); i += s[i + 1] === '\n' ? 2 : 1; continue; }
      if (cp >= 0x20 || ch === '\n' || ch === '\t') add(ch);
      i += n; continue;
    }
    if (ch === '\r' || cp === 0x03) { text = ''; exact = true; i += n; continue; } // 제출 또는 비우기
    if (cp === 0x15) { if (exact && !text.includes('\n')) text = ''; else exact = false; i += n; continue; } // Ctrl+U: 줄 앞까지 지우기
    if (cp === 0x7f || cp === 0x08) { if (exact) text = [...text].slice(0, -1).join(''); i += n; continue; }
    if (ch === '\x1b') { // 이스케이프 열(CSI, SS3, 두 글자): 커서·고치기 키. 끝의 Delete(ESC[3~)는 커서가 끝이면 아무 일도 없다
      const m = s.slice(i).match(/^\x1b(\[[0-?]*[ -/]*[@-~]|O.|.?)/);
      const seq = m ? m[0] : ch;
      if (seq !== '\x1b[3~') exact = false;
      i += seq.length || 1; continue;
    }
    if (cp === 0x0a && opts.newlineKey) { add('\n'); i += n; continue; } // P131: opencode·pi의 Ctrl+J = 줄바꿈 넣기
    if (cp < 0x20) { exact = false; i += n; continue; } // Tab(완성), Ctrl+J(줄바꿈인지 제출인지 하네스마다 다르다), Ctrl+W 등
    add(ch); i += n;
  }
  return { text: exact ? text : '', exact, paste };
}

const READERS = { claude: claudeInputBox, codex: codexInputBox, opencode: opencodeInputBox, pi: piInputBox };
// 화면에서 읽은 입력 칸. → { found, text(마우스 보고 글을 뗀 것), rows(입력 칸 줄 수), folded?, clipped? }
export function readDraftBox(screen, kind) {
  const b = (READERS[kind] || claudeInputBox)(screen);
  const noise = mouseNoise(b.text);
  const text = noise ? b.text.replace(MOUSE_NOISE_G, '').trim() : b.text;
  return { found: b.found, text, rows: b.rows || (b.found ? 1 : 0), ...(b.folded ? { folded: true } : {}), ...(b.clipped ? { clipped: true } : {}) };
}

// 접힌 붙여넣기·그림 표시(Claude Code·Codex [Pasted text #N …]·[Pasted Content N chars]·[Image #N], opencode [Pasted ~N lines]·[SVG: …], pi [paste #N …])
const FOLDED = /\[(Pasted (text|Content|~)|Image|SVG:|paste #\d)/i;
// Ctrl+C로 비우는 하네스(Codex, opencode, pi)에서 되돌릴 글을 정한다. → { text, from: 'typed'|'screen' } | null(정확히 모른다)
// 입력 칸 글이 다 보이지 않거나(clipped) 접힌 표시가 있으면 모른다
export function clearDraftText(box, edit) {
  if (!box || !box.found || !box.text || box.clipped || box.folded || FOLDED.test(box.text)) return null;
  if (edit && edit.exact && edit.text && sameDraft(edit.text, box.text)) return { text: edit.text, from: 'typed' };
  if (box.rows === 1) return { text: box.text, from: 'screen' }; // 한 줄이면 꺾임이 없다(끝 빈칸만 잃는다)
  return null;
}
export const codexDraftText = clearDraftText; // P128 이름

// P139: 접힌 붙여넣기 표시가 있는 입력 칸이라도, 판이 받은 사람 입력에서 다시 만든 글(정확함)이 화면의 접히지 않은 부분을 모두 품으면 그 글이 원래 글이다
//   (하네스가 접어 보일 뿐 판은 붙여넣은 글을 다 받았다). 다 보이지 않는 칸(clipped)은 견줄 수 없어 쓰지 않는다
const FOLDED_G = /\[(Pasted (text|Content|~)[^\]]*|Image[^\]]*|SVG:[^\]]*|paste #\d+[^\]]*)\]/gi;
export function foldedDraftText(box, edit) {
  if (!box || !box.found || !box.text || box.clipped || !(box.folded || FOLDED.test(box.text))) return null;
  if (!edit || !edit.exact || !edit.text) return null;
  const whole = bare(edit.text);
  if (/\[Image|\[SVG:/i.test(box.text)) return null; // 그림은 글로 되돌릴 수 없다
  const parts = box.text.replace(FOLDED_G, '\u0000').split('\u0000').map(bare).filter(Boolean);
  return parts.every((p) => whole.includes(p)) ? { text: edit.text, from: 'typed' } : null;
}

// P131: 되돌릴 글을 하네스가 접지 않는 크기의 붙여넣기 조각으로 나눈다. lines: 한 조각의 줄 수, chars: 한 조각의 글자 수.
// 조각은 줄바꿈 뒤에서 끊고, 한 줄이 chars보다 길면 그 줄 안에서 끊되 다음 조각이 / ~ . 로 시작하지 않게 한다(pi는 낱말 글자 뒤에 붙인 경로 꼴 붙여넣기 앞에 빈칸을 넣는다)
export function pasteChunks(text, { lines = 2, chars = 150 } = {}) {
  const out = [];
  let cur = '', curLines = 0;
  const flush = () => { if (cur) out.push(cur); cur = ''; curLines = 0; };
  const parts = String(text).split('\n');
  parts.forEach((line, i) => {
    let rest = line + (i < parts.length - 1 ? '\n' : '');
    while (rest) {
      if (curLines >= lines || cur.length >= chars) flush();
      const room = chars - cur.length;
      if (rest.length <= room) { cur += rest; curLines++; rest = ''; break; }
      if (cur) { flush(); continue; } // 긴 줄은 새 조각에서 시작한다
      let cut = room;
      while (cut > 1 && /[/~.]/.test(rest[cut])) cut--; // 다음 조각 첫 글자
      out.push(rest.slice(0, cut)); rest = rest.slice(cut);
    }
  });
  flush();
  return out;
}
// 하네스마다 비우기 키와 되돌리기 조각 크기. gapMs: 판이 이어 누르는 비우기 키 사이(pi는 0.5초 안 두 번째 Ctrl+C가 끝내기)
// recheck: 빈 칸에서 비우기 키가 끝내기라 누르기 직전에 입력 칸을 다시 본다(opencode)
const CLEARS = {
  codex: { key: '\x03' },
  opencode: { key: '\x03', chunks: { lines: 2, chars: 150 }, recheck: true },
  pi: { key: '\x03', chunks: { lines: 9, chars: 1000 }, gapMs: 700 },
};
export const draftKinds = ['claude', ...Object.keys(CLEARS)];

// 사람이 Claude Code 입력 치워 두기 키(chat:stash)를 다른 키로 바꿨는가. 바꿨으면 판은 Ctrl+S를 쓰지 않는다(다른 일을 할 수 있다)
export function stashKeyChanged(dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')) {
  try { const t = fs.readFileSync(path.join(dir, 'keybindings.json'), 'utf8'); return /ctrl\+s\b|chat:stash/i.test(t); } catch { return false; }
}

// P131: 사람이 opencode·pi 설정에서 입력 비우기 키(Ctrl+C)를 바꿨는가. 바꿨으면 판은 그 하네스에서 비키지 않는다(읽기만 한다)
// opencode: 사용자 설정(opencode.json(c), tui.json(c), OPENCODE_CONFIG)에 input_clear·prompt.clear·app_exit 키 설정이 있으면
// pi: <agent-dir>/keybindings.json(PI_CODING_AGENT_DIR, 기본 ~/.pi/agent)에 app.clear나 ctrl+c가 있으면
export function clearKeyChanged(kind, { env = process.env, home = os.homedir() } = {}) {
  const has = (files, re) => files.some((f) => { try { return re.test(fs.readFileSync(f, 'utf8')); } catch { return false; } });
  if (kind === 'opencode') {
    const dir = path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode');
    const files = ['opencode.json', 'opencode.jsonc', 'config.json', 'tui.json', 'tui.jsonc'].map((f) => path.join(dir, f)).concat(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []);
    return has(files, /input_clear|prompt\.clear|app_exit|app\.exit/);
  }
  if (kind === 'pi') return has([path.join(env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent'), 'keybindings.json')], /app\.clear|ctrl\+c/i);
  return false;
}

const CTRL_S = '\x13';
const END = '\x1b[F', BS = '\x7f';

// P139: 판이 되돌릴 글. 다시 만든 글(draftEdit)이 화면 글과 같으면 그것(정확함), 아니면 화면에서 읽은 글(꺾인 줄은 빈칸으로 이어진다).
// 화면 글이 정확한 것은 한 줄이고 접힌 붙여넣기·그림이 없고 다 보일 때뿐이다(exact: false면 원래 글은 판 기록에도 남긴다)
export function restoreText(box, edit) {
  if (!box || !box.text) return null;
  const want = clearDraftText(box, edit) || foldedDraftText(box, edit);
  if (want) return { ...want, exact: true };
  return { text: box.text, from: 'screen', exact: false };
}

// 비키기·되돌리기. io: { pending(sid) → 판이 받은 사람 입력으로 보아 보내지 않은 글이 있을 수 있는가(P135, 없으면 거짓), read(sid) → 화면 글, type(sid, 바이트) → Promise(키), paste(sid, 글) → Promise(괄호 붙여넣기, Enter 없음), kindOf(sid), edit(sid) → draftEdit 결과,
//   readAnsi(sid) → ANSI 화면(P139, Claude Code 제안 글 가르기. 없으면 가르지 않는다),
//   userStash(sid) → 사람이 Ctrl+S로 치워 둔 글이 있을 수 있는가, stashKey: Ctrl+S를 써도 되는가,
//   clearKey(kind) → 그 하네스에서 Ctrl+C를 비우기 키로 써도 되는가(P131, 없으면 참), typedSince(sid, t) → 사람이 t 뒤에 쳤는가(P131, 없으면 거짓) }
// pastePolls(P130): 되돌린 붙여넣기가 보이기까지 볼 횟수. hc는 terminal.send 뒤 그 전달이 끝날 때까지 들어온 입력을 잡아 두었다가 넣는다.
//   턴이 곧바로 끝나면(가짜 모델) 사람 입력도 약 1.7초 뒤에 보여 2초(8번) 보기가 빠듯했다
//
// P139(사용자 결정 2026-11-13): 사람이 지금 치는 중(3초 안, 대기열이 먼저 본다)이 아니면 입력 칸에 무엇이 있든 판의 지시만 제출하고 입력 칸을 되돌린다.
//   쓰다 만 글 때문에 기다리지 않는다. 비우는 길은 차례로: Claude Code 치워 두기(Ctrl+S) → 하네스의 비우기 키(Ctrl+C, Claude Code는 쓰지 않는다:
//   빈 칸의 두 번째 Ctrl+C가 끝내기다) → 끝으로 가서 지우기(End, Backspace). 판이 정확히 모르는 글(꺾인 여러 줄, 접힌 붙여넣기, 그림)은 화면에
//   보이던 대로 되돌리고 원래 글은 판 기록(delivery_draft의 text)에 남긴다. 셋 다 입력 칸을 비우지 못했을 때만 기다린다(지시가 사람의 글과 함께 제출되지 않게).
//   입력 칸을 못 읽으면(다른 화면, 읽기 실패) 기다리지 않고 보낸다.
//   Claude Code의 다음 메시지 제안(흐린 글)은 사람의 글이 아니다. 빈 칸으로 보고 그대로 보낸다(친 글이 제안을 바꾼다. 되돌릴 것이 없다)
export function draftMover(io, { pollMs = 250, polls = 8, pastePolls = 16, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const look = async (sid, kind) => {
    const b = readDraftBox(await io.read(sid), kind);
    if (kind === 'claude' && b.found && b.text && io.readAnsi) { // P139: 흐린 제안 글은 빈 칸이다
      let sug = null;
      try { sug = claudeSuggestion(await io.readAnsi(sid)); } catch {}
      if (sug && sameDraft(sug, b.text)) return { ...b, text: '', suggestion: b.text };
    }
    return b;
  };
  // 입력 칸이 바뀔 때까지(want(box)가 참) 몇 번 본다
  const lastClear = new Map(); // 세션 → 판이 마지막으로 비우기 키를 누른 때(pi)
  const until = async (sid, kind, want, n = polls) => { let b = null; for (let i = 0; i < n; i++) { await sleep(pollMs); b = await look(sid, kind); if (want(b)) return { ok: true, box: b }; } return { ok: false, box: b }; };
  const emptied = (b) => b.found && !b.text;
  // 끝으로 가서 글자 수만큼 지운다(빈 칸의 Backspace는 아무 일도 하지 않는다). 꺾인 줄을 이은 빈칸만큼 더 누르므로 넉넉하다
  const erase = async (sid, kind, box) => {
    const n = [...box.text].length + (box.rows || 1) + 4;
    await io.type(sid, END + BS.repeat(n));
    return until(sid, kind, emptied);
  };
  return {
    // → { state: 'clear', why }(그대로 보낸다. why: kind·empty·empty_twice·suggestion·no_box·no_box_draft·read_error·read_error_draft)
    //   | { state: 'moved', held }(비켰다. 제출 뒤 back으로 되돌린다) | { state: 'keep', why, text? }(입력 칸을 비우지 못했다: 기다린다)
    async aside(sid) {
      const kind = io.kindOf(sid);
      if (!draftKinds.includes(kind)) return { state: 'clear', why: 'kind' };
      const t0 = Date.now();
      // P135: 판이 받은 사람 입력으로 보아 보내지 않은 글이 있을 수 있는가(io.pending). P139: 그래도 입력 칸을 못 읽으면 기다리지 않고 보낸다(까닭은 판 기록에)
      const pending = !!(io.pending && io.pending(sid));
      let box;
      try { box = await look(sid, kind); } catch (e) { return { state: 'clear', why: pending ? 'read_error_draft' : 'read_error', error: e.code || e.message }; }
      if (!box.found) return { state: 'clear', why: pending ? 'no_box_draft' : 'no_box' };
      if (!box.text) {
        // P135: 보내지 않은 글이 있을 수 있는데(pending, 다시 만든 글 draftEdit) 빈 칸으로 읽혔다. 다시 그리는 중인 칸일 수 있어 한 번 더 본다
        const e = io.edit ? io.edit(sid) : null;
        if (!pending && !(e && e.exact && e.text)) return { state: 'clear', why: box.suggestion ? 'suggestion' : 'empty' };
        await sleep(pollMs);
        let again;
        try { again = await look(sid, kind); } catch (err) { return { state: 'clear', why: 'read_error_draft', error: err.code || err.message }; }
        if (!again.found) return { state: 'clear', why: 'no_box_draft' };
        if (!again.text) return { state: 'clear', why: again.suggestion ? 'suggestion' : 'empty_twice' };
        box = again;
      }
      const edit = io.edit ? io.edit(sid) : null;
      const want = restoreText(box, edit);
      const held = (how, extra = {}) => ({ state: 'moved', held: { kind, how, text: want.text, from: want.from, exact: want.exact, rows: box.rows, ...extra } });
      if (kind === 'claude') {
        // 1) 치워 두기: 글·커서·접힌 붙여넣기·그림을 Claude Code가 쥐고 다음 제출 뒤 스스로 되돌린다. 사람이 치워 둔 글이 있으면 덮으므로 쓰지 않는다
        if (io.stashKey && !(io.userStash && io.userStash(sid))) {
          await io.type(sid, CTRL_S);
          const r = await until(sid, kind, emptied);
          if (r.ok) return { state: 'moved', held: { kind, how: 'stash', text: box.text, rows: box.rows } };
          // 비지 않았다(옛 판 등). 글이 바뀌었으면 무엇이 일어났는지 모른다: 손대지 않는다(다음 차례에 다시 본다)
          if (r.box && r.box.found && r.box.text && !sameDraft(r.box.text, box.text)) return { state: 'keep', why: 'stash_unclear', text: box.text };
        }
        // 2) 지우기(Claude Code는 Ctrl+C를 쓰지 않는다). 되돌리기는 판이 아는 글의 붙여넣기다
        const r = await erase(sid, kind, box);
        if (r.ok) return held('clear', { key: 'erase', ...(io.userStash && io.userStash(sid) ? { userStash: true } : {}) });
        return { state: 'keep', why: 'clear_failed', text: box.text };
      }
      const c = CLEARS[kind];
      if (!io.clearKey || io.clearKey(kind)) {
        if (c.gapMs) { const wait = (lastClear.get(sid) || 0) + c.gapMs - Date.now(); if (wait > 0) await sleep(wait); }
        let go = true;
        if (c.recheck) { // 빈 칸의 비우기 키는 끝내기다: 누르기 직전에 글이 그대로 있고 그새 사람이 치지 않았는지 다시 본다
          const again = await look(sid, kind);
          if (!again.found || !again.text || !sameDraft(again.text, box.text) || (io.typedSince && io.typedSince(sid, t0))) go = false;
        }
        if (go) {
          await io.type(sid, c.key);
          lastClear.set(sid, Date.now());
          const r = await until(sid, kind, emptied);
          if (r.ok) return held('clear');
          if (r.box && r.box.found && r.box.text && !sameDraft(r.box.text, box.text)) return { state: 'keep', why: 'clear_unclear', text: box.text };
        } else return { state: 'keep', why: 'box_changed', text: box.text };
      }
      // 비우기 키를 바꿨거나 먹히지 않았다: 끝으로 가서 지운다
      const r = await erase(sid, kind, box);
      if (r.ok) return held('clear', { key: 'erase' });
      return { state: 'keep', why: 'clear_failed', text: box.text };
    },
    // 지시를 보낸 뒤(제출됐든 아니든) 쓰다 만 글을 입력 칸에 되돌린다. Enter는 누르지 않는다.
    // → { result: 'restored'(입력 칸에 돌아왔다) | 'stashed'(Claude Code가 아직 쥐고 있다: 다음 제출이나 빈 칸의 Ctrl+S로 돌아온다) | 'held'(판 기록에만 있다), by, why?, partial? }
    //   partial(P139): 판이 정확히 모르는 글을 화면에 보이던 대로 되돌렸다(원래 글은 판 기록에)
    async back(sid, held, d = null) {
      const kind = held.kind, stash = held.how === 'stash';
      const partial = !stash && held.exact === false ? { partial: true } : {};
      let empties = 0, b = null;
      for (let i = 0; i < polls; i++) {
        if (i) await sleep(pollMs);
        b = await look(sid, kind);
        if (!b.found) { empties = 0; continue; }
        if (b.text && bare(b.text).includes(bare(held.text))) return { result: 'restored', by: stash ? 'harness' : 'already', ...partial }; // Claude Code가 제출하며 되돌렸다(뒤에 사람이 더 친 글이 있어도)
        if (b.text) break; // 다른 글(제출되지 않은 지시, 그새 사람이 친 글): 덮지 않는다
        if (++empties >= 2) break; // 두 번 이어 빈 칸(그리기가 늦은 것이 아니다)
      }
      if (!b || !b.found) return { result: stash ? 'stashed' : 'held', why: 'no_box' };
      if (b.text && held.userStash && d && d.status === 'confirmed') {
        // P139: 지시가 제출되자 Claude Code가 사람이 치워 둔 글을 입력 칸에 되돌렸다("Draft restored"). 그 글을 다시 치워 두고 판이 지운 글을 붙여 넣으면
        //   원래 모양(입력 칸의 글 + 사람이 치워 둔 글)이다
        await io.type(sid, CTRL_S, { back: true });
        const r0 = await until(sid, kind, emptied);
        if (r0.ok) b = r0.box;
      }
      if (b.text) return { result: stash ? 'stashed' : 'held', why: 'box_other' };
      if (stash) await io.type(sid, CTRL_S, { back: true }); // 빈 칸의 Ctrl+S = 치워 둔 글 꺼내기(back: 되돌리는 키, P130)
      else if (CLEARS[kind] && CLEARS[kind].chunks) { for (const p of pasteChunks(held.text, CLEARS[kind].chunks)) await io.paste(sid, p); } // P131: 접히지 않는 조각으로
      else await io.paste(sid, held.text); // 괄호 붙여넣기(Enter 없음). Claude Code는 긴 붙여넣기를 접어 보이지만 글은 쥐고 있다
      // P130: 붙여넣기는 다 그려지기 전의 칸을 볼 수 있다(처음 보인 글에서 멈추면 box_differs). 같은 글이 보일 때까지 본다
      const paste = !stash;
      const shown = paste ? (x) => x.found && !!x.text && (sameDraft(x.text, held.text) || FOLDED.test(x.text)) : (x) => x.found && !!x.text;
      let r = await until(sid, kind, shown, paste ? pastePolls : polls);
      if (!r.ok && paste && r.box && r.box.found && r.box.text) r = { ok: true, box: r.box }; // 끝까지 다른 글이 보였다
      if (r.ok && sameDraft(r.box.text, held.text)) return { result: 'restored', by: 'board', ...partial };
      if (r.ok && paste && FOLDED.test(r.box.text)) return { result: 'restored', by: 'board', folded: true, ...partial }; // 긴 붙여넣기는 하네스가 접어 보인다
      return { result: stash ? (r.ok ? 'restored' : 'stashed') : 'held', why: r.ok ? 'box_differs' : 'not_shown', ...(r.ok && stash ? { by: 'board', differs: true } : {}) };
    },
  };
}
