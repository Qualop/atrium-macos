// macOS 판: 세션마다 쓴 토큰(대화 기록의 usage)을 모은다. 노드 머리와 리드의 나무 합계에 보인다.
// - Claude Code 대화 기록(.jsonl)의 assistant 줄 message.usage: input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens.
//   한 응답이 내용 조각마다 줄을 나눠 쓰고 같은 message.id·usage를 되풀이하므로 id가 바뀔 때 앞 응답을 한 번만 센다(마지막 줄 값).
// - 처음에는 파일 처음부터 읽되 한 번에 CHUNK만 읽는다(큰 기록에서 판을 오래 멈추지 않게). 다음 읽기에서 이어 간다.
// - 가중(weighted): 캐시 읽기 0.1 + 캐시 쓰기 1.25 + 입력 1 + 출력 5(입력 토큰 값으로 환산한 상대 비용). 실험 비교에 쓴 셈과 같다
import fs from 'node:fs';

const CHUNK = 8 * 1024 * 1024;
export const WEIGHTS = { cr: 0.1, cw: 1.25, in: 1, out: 5 };
export const weighted = (u) => (u ? Math.round((u.cr || 0) * WEIGHTS.cr + (u.cw || 0) * WEIGHTS.cw + (u.in || 0) * WEIGHTS.in + (u.out || 0) * WEIGHTS.out) : 0);
const empty = () => ({ cr: 0, cw: 0, in: 0, out: 0, msgs: 0 });

// 줄들 → 누적. acc: { sum, lastId, last, firstAt, lastAt }
export function foldUsage(lines, acc = null) {
  const a = acc ? { ...acc, sum: { ...acc.sum } } : { sum: empty(), lastId: null, last: null, firstAt: null, lastAt: null };
  for (const line of lines) {
    if (!line || !line.includes('"usage"') || !line.includes('"assistant"')) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'assistant' || !j.message || !j.message.usage) continue;
    const u = j.message.usage;
    const cur = { cr: Number(u.cache_read_input_tokens) || 0, cw: Number(u.cache_creation_input_tokens) || 0, in: Number(u.input_tokens) || 0, out: Number(u.output_tokens) || 0 };
    const id = j.message.id || j.requestId || j.uuid || null;
    if (a.lastId !== null && id !== a.lastId && a.last) addTo(a.sum, a.last);
    a.lastId = id; a.last = cur;
    const at = Date.parse(j.timestamp || '') || null;
    if (at) { if (!a.firstAt) a.firstAt = at; a.lastAt = at; }
  }
  return a;
}
function addTo(sum, u) { sum.cr += u.cr; sum.cw += u.cw; sum.in += u.in; sum.out += u.out; sum.msgs += 1; }
// 누적 → 보일 값(마지막 응답까지 넣는다)
export function usageOf(acc) {
  if (!acc) return null;
  const s = { ...acc.sum };
  if (acc.last) addTo(s, acc.last);
  return { ...s, weighted: weighted(s), firstAt: acc.firstAt, lastAt: acc.lastAt };
}

// 파일을 이어 읽는다. st: { file, pos, acc }. 파일이 바뀌거나 줄었으면 처음부터
export function refreshUsage(file, st = null) {
  let size; try { size = fs.statSync(file).size; } catch { return st && st.file === file ? st : null; }
  if (!st || st.file !== file || size < st.pos) st = { file, pos: 0, acc: null };
  if (size === st.pos) return st;
  const end = Math.min(size, st.pos + CHUNK);
  const buf = Buffer.alloc(end - st.pos);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, st.pos); } finally { fs.closeSync(fd); }
  const nl = buf.lastIndexOf(10);
  if (nl < 0) return end === size ? st : { ...st, pos: end }; // 아주 긴 한 줄(그림 등): 건너뛴다
  const acc = foldUsage(buf.subarray(0, nl).toString('utf8').split('\n'), st.acc);
  return { file, pos: st.pos + nl + 1, acc, partial: st.pos + nl + 1 < size };
}

// 나무 합계: 세션과 그 일 하위 전부(descendants: 세션 ID 목록)
export function sumUsage(list) {
  const s = empty(); let firstAt = null, lastAt = null, n = 0;
  for (const u of list) {
    if (!u) continue; n++;
    s.cr += u.cr || 0; s.cw += u.cw || 0; s.in += u.in || 0; s.out += u.out || 0; s.msgs += u.msgs || 0;
    if (u.firstAt && (!firstAt || u.firstAt < firstAt)) firstAt = u.firstAt;
    if (u.lastAt && (!lastAt || u.lastAt > lastAt)) lastAt = u.lastAt;
  }
  return n ? { ...s, weighted: weighted(s), firstAt, lastAt, sessions: n } : null;
}
