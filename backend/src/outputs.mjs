// I1 출력 보기(P6b, ARCH 4절 I1): 끝난 답을 문서(마크다운)로 보여주고 판 데이터 폴더의 outputs/<워크스페이스 이름>/에 .md로 저장한다.
// - hook이 붙은 Claude Code 세션: 대화 기록(transcript)에서 턴마다 마지막 답을 읽는다. 지난 턴들도 고를 수 있다.
// - hook이 없는 세션(다른 종류, 판에 올린 에이전트): 턴이 끝날 때 화면에서 고른 답(판 이벤트 `answer_screen`)이다.
// - 사용자 저장소 안에는 쓰지 않는다. 저장 위치는 늘 판 데이터 폴더 아래다.
// 순수 함수(긴 답 판정, 턴 나누기, 파일 이름, 문서 글)와 백엔드에 붙는 Outputs가 있다.
import fs from 'node:fs';
import path from 'node:path';
import { isSyntheticUserText } from './transcript.mjs';
import { shownName } from './session-label.mjs';

export const LONG_ANSWER_CHARS = 80; // 참고 제품: 약 80자 또는 세 문단을 넘으면 "출력 보기"
export const LONG_ANSWER_PARAGRAPHS = 3;

export function paragraphs(text) { return String(text || '').split(/\n\s*\n/).filter((p) => p.trim()).length; }
// 긴 답인가(노드 머리줄에 "출력 보기"를 낼지)
export function isLongAnswer(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return text.trim().length > LONG_ANSWER_CHARS || paragraphs(text) > LONG_ANSWER_PARAGRAPHS;
}

// 대화 기록 메시지(readMessages)를 턴으로 나눈다. 턴은 사람이 쓴 지시 하나로 시작한다(거부·중단 표시 줄은 지시가 아니다).
// 턴의 답은 마지막 assistant 줄(같은 seq의 글 조각들)의 글이다. Stop hook의 last_assistant_message와 같다.
export function turnsFromMessages(messages) {
  const turns = [];
  let cur = null;
  for (const m of messages || []) {
    if (m.role === 'user' && !isSyntheticUserText(m.text)) {
      if (cur && m.seq != null && cur.promptSeq === m.seq) { cur.prompt += '\n\n' + m.text; continue; }
      cur = { turn: turns.length + 1, prompt: m.text, promptAt: m.at, promptSeq: m.seq, answer: null, answerAt: null, answerSeq: null, tools: 0 };
      turns.push(cur);
      continue;
    }
    if (!cur) continue;
    if (m.role === 'tool_use') cur.tools++;
    if (m.role === 'assistant' && m.text) {
      if (cur.answerSeq === m.seq) cur.answer += '\n\n' + m.text;
      else { cur.answer = m.text; cur.answerSeq = m.seq; }
      cur.answerAt = m.at;
    }
  }
  return turns.map(({ answerSeq, promptSeq, ...t }) => ({ ...t, long: isLongAnswer(t.answer) }));
}

// 화면에서 고른 답(판 이벤트)을 턴으로
export function turnsFromScreenEvents(events) {
  return (events || []).map((e, i) => ({ turn: i + 1, prompt: (e.data && e.data.prompt) || null, promptAt: null, answer: (e.data && e.data.text) || '', answerAt: e.t, tools: null, long: isLongAnswer(e.data && e.data.text) }));
}

// turn: 1부터 센 번호, 음수는 뒤에서(-1이 마지막). 없으면 마지막 답이 있는 턴
export function pickTurn(turns, turn) {
  if (!turns.length) return null;
  if (turn == null) { for (let i = turns.length - 1; i >= 0; i--) if (turns[i].answer) return turns[i]; return turns[turns.length - 1]; }
  const n = Number(turn);
  if (!Number.isInteger(n) || n === 0) return null;
  return n > 0 ? turns[n - 1] || null : turns[turns.length + n] || null;
}

// 파일과 폴더 이름에 쓸 수 없는 글자를 바꾼다(워크스페이스 이름은 `부모/이름`일 수 있다)
export function safeName(s, fallback = 'board') {
  const t = String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(t) || !t ? fallback : t;
}
const stamp = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
export function outputFileName({ session, turn, at }) { return `${safeName(session, 'session')}-t${turn}-${stamp(at || Date.now())}.md`; }

// 저장할 문서 글: 머리(세션, 워크스페이스, 턴, 시각, 지시)와 답 본문
export function renderMarkdown({ session, workspace, cwd, turn, prompt, answer, answerAt, source }) {
  const quote = (s) => String(s || '').split('\n').map((l) => `> ${l}`).join('\n');
  const head = [`# @${session} 턴 ${turn}`, '', `- 프로젝트: ${workspace || '-'}`, `- 폴더: ${cwd || '-'}`, `- 완료 시각: ${answerAt ? new Date(answerAt).toLocaleString() : '-'}`, `- 출처: ${source === 'screen' ? "터미널 화면에서 가져온 응답" : '대화 기록'}`];
  return `${head.join('\n')}

## 요청

${prompt ? quote(prompt) : '(알 수 없음)'}

## 응답

${answer || "(응답 없음)"}\n`;
}

// 백엔드에 붙는 부분. ctx: { cfg, store, resolve(ref), summary(s), hooked(s), transcriptOf(s), readMessages(file), workspaceName(key), apiError }
export class Outputs {
  constructor(ctx) { this.ctx = ctx; }

  turnsOf(s) {
    const c = this.ctx;
    if (s.kind === 'claude' || (!s.kind && c.hooked(s))) {
      const file = c.transcriptOf(s);
      const r = file ? c.readMessages(file, { limit: 100000 }) : { exists: false, messages: [] };
      if (r.exists) return { source: 'transcript', file, turns: turnsFromMessages(r.messages) };
    }
    const all = c.store.events({ sessionId: s.sessionId, limit: 2000 });
    const sources = { answer_agy: 'transcript', answer_gemini: 'hook', answer_screen: 'screen' };
    const ev = all.filter((e) => Object.hasOwn(sources, e.kind));
    if (ev.length) {
      const turns = turnsFromScreenEvents(ev).map((turn, i) => ({ ...turn, source: sources[ev[i].kind] }));
      return { source: turns.at(-1).source, file: ev.at(-1).kind === 'answer_agy' ? s.rt.agyTranscriptPath || null : null, turns };
    }
    // 대화 기록도 화면 기록도 없으면 지금 들고 있는 마지막 답 하나
    if (s.rt.lastAnswer) return { source: s.rt.answerSource || 'hook', file: null, turns: [{ turn: 1, prompt: s.rt.lastPrompt || null, promptAt: s.rt.lastPromptAt || null, answer: s.rt.lastAnswer, answerAt: s.rt.lastAnswerAt, tools: null, long: isLongAnswer(s.rt.lastAnswer) }] };
    return { source: null, file: null, turns: [] };
  }

  // output.get { session, turn? } → 고른 턴의 문서와 턴 목록(지난 턴들의 앞부분)
  get(p) {
    const c = this.ctx;
    const s = c.resolve(p.session);
    const { source, turns } = this.turnsOf(s);
    const t = pickTurn(turns, p.turn);
    if (p.turn != null && !t) throw c.apiError('not_found', `응답 기록을 찾을 수 없습니다: ${p.turn}(턴 ${turns.length}개)`);
    return {
      sessionId: s.sessionId, name: shownName(s), address: s.name, label: s.label || null, workspaceKey: s.workspaceKey || null, workspace: c.workspaceName(s.workspaceKey), source: t?.source || source,
      turnCount: turns.length,
      turn: t ? { ...t, markdown: t.answer || '' } : null,
      turns: turns.map((x) => ({ turn: x.turn, prompt: clip1(x.prompt, 120), answerHead: clip1(x.answer, 160), answerAt: x.answerAt, chars: (x.answer || '').length, long: x.long })),
    };
  }

  // output.save { session, turn? } → 판 데이터 폴더의 outputs/<워크스페이스 이름>/<세션>-t<턴>-<시각>.md
  save(p) {
    const c = this.ctx;
    const s = c.resolve(p.session);
    const { source, turns } = this.turnsOf(s);
    const t = pickTurn(turns, p.turn);
    if (!t || !t.answer) throw c.apiError('not_found', p.turn != null ? `응답 기록이 없거나 내용이 없습니다: ${p.turn}` : "저장할 응답이 없습니다.");
    const wsName = c.workspaceName(s.workspaceKey) || 'board';
    const dir = path.join(c.cfg.dataDir, 'outputs', safeName(wsName));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, outputFileName({ session: s.name, turn: t.turn, at: t.answerAt }));
    const text = renderMarkdown({ session: shownName(s), workspace: wsName, cwd: s.cwd, turn: t.turn, prompt: t.prompt, answer: t.answer, answerAt: t.answerAt, source: t.source || source });
    fs.writeFileSync(file, text, 'utf8');
    c.store.addEvent(s.sessionId, 'output_saved', { turn: t.turn, file, bytes: Buffer.byteLength(text) });
    return { saved: true, file, turn: t.turn, bytes: Buffer.byteLength(text), dir };
  }
}
function clip1(s, n) { if (typeof s !== 'string') return s ?? null; const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }
