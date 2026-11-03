import fs from 'node:fs';
// Read only the exact transcript path supplied by an authenticated session hook.
// Bounded tail, tolerate a partially written last row, never expose thought rows.
export function readAgyAnswer(file) {
  if (!file) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - 2 * 1024 * 1024);
    const bytes = Buffer.alloc(size - start); fs.readSync(fd, bytes, 0, bytes.length, start);
    const lines = bytes.toString('utf8').split('\n'); if (start) lines.shift();
    let prompt = null, answer = null;
    for (const line of lines) {
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!r || typeof r.content !== 'string') continue;
      if (r.type === 'USER_INPUT') { prompt = r.content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/)?.[1] || r.content; answer = null; }
      if (r.type === 'PLANNER_RESPONSE' && r.source === 'MODEL' && r.status === 'DONE') answer = { text: r.content, prompt, step: r.step_index, at: Date.parse(r.created_at) || null };
    }
    return answer;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
