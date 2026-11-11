// 검색(ARCH 4절 H2, P6a). 순수 함수만 둔다. 판 기록(세션 요약, 이벤트의 지시·답, 전달, 메모, 연결로 받은 지시)에서 찾는다.
// 대화 기록 파일 전체는 뒤지지 않는다(PLAN 열린 결정). 결과는 세션마다 하나(가장 잘 맞은 곳)와 워크스페이스 이름.
// P6c: 출력(hook이 없는 세션의 화면 답), 메모 노드, 칸반(제목, 열, 카드)도 찾는다. 메모·칸반은 노드마다 하나.

export const FIELD_LABEL = { name: '이름', workspace: '프로젝트', ask: '질문', prompt: '요청', answer: "응답", history: "이전 요청", reply: "이전 응답", linked: "받은 요청", output: '출력', memo: '메모 카드', kanban: '칸반', card: '카드' };
const WEIGHT = { name: 100, ask: 80, prompt: 60, workspace: 45, answer: 40, linked: 35, history: 30, reply: 25, output: 25, memo: 50, kanban: 55, card: 50 };

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// 맞은 곳 앞뒤를 조금 붙인 한 줄
export function snippet(text, q, span = 60) {
  const t = norm(text);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return t.slice(0, span * 2);
  const a = Math.max(0, i - span), b = Math.min(t.length, i + q.length + span);
  return `${a > 0 ? '…' : ''}${t.slice(a, b)}${b < t.length ? '…' : ''}`;
}

// 한 글이 q와 얼마나 맞는가: 같으면 1.5, 앞부분이면 1.2, 낱말 머리면 1.1, 안에 있으면 1. 없으면 0
export function matchScore(text, q) {
  const t = norm(text).toLowerCase(), k = q.toLowerCase();
  if (!k || !t) return 0;
  if (t === k) return 1.5;
  if (t.startsWith(k)) return 1.2;
  const i = t.indexOf(k);
  if (i < 0) return 0;
  return /[\s@/\\._-]/.test(t[i - 1] || ' ') ? 1.1 : 1;
}

// sessions: [{ sessionId, name, workspaceKey, ask, lastPrompt, lastAnswer, state }], workspaces: [{ key, name }]
// texts: [{ sessionId, field, text, t }](판 기록에서 미리 고른 글), limit
// → [{ kind: 'session' | 'workspace', sessionId?, workspaceKey, name, field, label, snippet, score, hits }]
export function searchBoard({ q, sessions = [], workspaces = [], texts = [], limit = 20 }) {
  const query = norm(q);
  if (!query) return [];
  const wsName = new Map(workspaces.map((w) => [w.key, w.name]));
  const best = new Map(); // sessionId → 결과
  const hit = (s, field, text, bonus = 0) => {
    const m = matchScore(text, query);
    if (!m) return;
    const score = WEIGHT[field] * m + bonus;
    const prev = best.get(s.sessionId);
    if (prev) { prev.hits++; if (score <= prev.score) return; }
    best.set(s.sessionId, { kind: 'session', sessionId: s.sessionId, workspaceKey: s.workspaceKey || null, name: s.name, field, label: FIELD_LABEL[field], snippet: snippet(text, query), score, hits: prev ? prev.hits : 1, state: s.state || null });
  };
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  for (const s of sessions) {
    hit(s, 'name', s.name);
    if (s.address && s.address !== s.name) hit(s, 'name', s.address); // P66: 판의 이름을 바꿔도 옛 주소로 찾는다
    hit(s, 'workspace', wsName.get(s.workspaceKey) || '');
    if (s.ask) hit(s, 'ask', [s.ask.question, ...(s.ask.questions || []).map((x) => x.question), s.ask.summary].filter(Boolean).join(' / '), 10);
    hit(s, 'prompt', s.lastPrompt);
    hit(s, 'answer', s.lastAnswer);
  }
  for (const x of texts) { const s = byId.get(x.sessionId); if (s) hit(s, x.field, x.text); }
  const out = [...best.values()];
  for (const w of workspaces) { const m = matchScore(w.name, query); if (m) out.push({ kind: 'workspace', workspaceKey: w.key, name: w.name, field: 'workspace', label: FIELD_LABEL.workspace, snippet: w.root || w.name, score: WEIGHT.workspace * m + 5, hits: 1 }); }
  return out.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name))).slice(0, limit);
}

// 메모 노드와 칸반 노드에서 찾는다(P6c). memos: store.memos(), kanbans: store.kanbans()
// → [{ kind: 'memo' | 'kanban', memoId | kanbanId, cardId?, workspaceKey, name, field, label, snippet, score, hits }]
export function searchItems({ q, memos = [], kanbans = [], limit = 20 }) {
  const query = norm(q);
  if (!query) return [];
  const out = [];
  const firstLine = (t) => norm(String(t || '').split('\n').find((l) => l.trim()) || '').replace(/^#+\s*/, '').slice(0, 60);
  for (const m of memos) {
    const s = matchScore(m.text, query);
    if (s) out.push({ kind: 'memo', memoId: m.memoId, workspaceKey: m.workspaceKey || null, name: firstLine(m.text) || '(빈 메모)', field: 'memo', label: FIELD_LABEL.memo, snippet: snippet(m.text, query), score: WEIGHT.memo * s, hits: 1 });
  }
  for (const k of kanbans) {
    let best = null, hits = 0;
    const hit = (field, text, cardId = null) => {
      const s = matchScore(text, query);
      if (!s) return;
      hits++;
      const score = WEIGHT[field] * s;
      if (!best || score > best.score) best = { kind: 'kanban', kanbanId: k.kanbanId, cardId, workspaceKey: k.workspaceKey || null, name: k.title, field, label: FIELD_LABEL[field], snippet: snippet(text, query), score };
    };
    hit('kanban', k.title);
    for (const c of k.columns || []) { hit('kanban', c.name); for (const card of c.cards || []) hit('card', card.text, card.cardId); }
    if (best) out.push({ ...best, hits });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
