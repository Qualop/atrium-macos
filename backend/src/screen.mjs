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


// G2(P5): 일반 셸이 프롬프트에서 쉬는가, 명령을 돌리는가. Windows에서 herdr pane.process_info는 셸 프로세스만 주고
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
    return { found: true, text: BOX_HINTS.some((re) => re.test(t)) ? '' : t, above: lines.slice(0, top) };
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
  return { found: true, text: CODEX_HINTS.some((re) => re.test(t)) ? '' : t, above: lines.slice(0, at) };
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
  const pasted = /^\[Past(ed text #\d+|ed Content)/.test(box.text) && (/\n/.test(String(prompt)) || want.length > 200);
  const bare = (s) => s.replace(/\s+/g, ''); // 화면 폭에서 꺾인 줄을 이을 때 낱말 가운데 빈칸이 생긴다
  const bx = bare(box.text), wn = bare(want);
  if (bx.startsWith(bare(head)) || (bx.length >= 12 && wn.startsWith(bx)) || pasted) return { box: 'ours', seen };
  return { box: 'other', seen };
}
