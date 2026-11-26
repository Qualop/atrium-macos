// 데스크톱 창(macOS 판)의 끌어 놓기. Finder에서 끈 파일·폴더, 브라우저에서 끈 그림을 판 어디에 놓아도 받는다.
// - 터미널(TerminalView): 그 세션 입력에 경로를 붙여 넣는다(진짜 터미널에 끌어 놓을 때와 같다. Claude Code는 그림 경로를 그림으로 붙인다)
// - 노드(SessionNode): 터미널이 없거나 아직 붙지 않았으면 맡아 두었다가 그 세션 터미널이 붙을 때 넣는다(sendToTerminal)
// - 명령 바·빈 판: 명령 바에 [Image n]·[File n] 칩으로(commandDraft 'attach' 이벤트)
// 경로가 없는 파일(브라우저에서 끈 그림 등)은 main이 판 데이터 폴더 uploads/에 둔 사본의 경로를 쓴다(mt:saveUpload)
import { dropParts, isImagePath } from './desktop-paste.js';

const mt = () => (typeof window !== 'undefined' ? window.mt : null);
export const desktopDrop = () => { const m = mt(); return !!(m && typeof m.pathForFile === 'function' && typeof m.fileInfo === 'function'); };
export const hasDropFiles = (dt) => !!(dt && dt.types && [...dt.types].includes('Files'));

// 놓은 것 → [{ path, name, dir, image, thumb }] (실패한 것은 errors에 이름)
export async function resolveDrop(dt) {
  const m = mt();
  const { paths, blobs } = dropParts(dt, m.pathForFile);
  const errors = [];
  const saved = [];
  for (const f of blobs) {
    try {
      const r = await m.saveUpload(f);
      if (r && r.path) saved.push({ path: r.path, name: f.name || r.path.split('/').pop(), dir: false, image: /^image\//.test(f.type || '') || isImagePath(r.path), thumb: r.thumb || null });
      else errors.push({ name: f.name || '?', code: (r && r.error) || 'failed' });
    } catch (e) { errors.push({ name: f.name || '?', code: e.message }); }
  }
  let info = [];
  if (paths.length) { try { info = await m.fileInfo(paths); } catch { info = paths.map((p) => ({ path: p, name: p.split('/').pop(), dir: false, image: isImagePath(p), thumb: null })); } }
  return { items: [...info, ...saved], errors };
}

// 세션 터미널로 보내기. 붙어 있는 TerminalView가 자기 보내기를 걸어 두고, 없으면 맡아 둔다(붙을 때 takePending)
const senders = new Map(); // sessionId → (text) => boolean(보냈나)
const pending = new Map(); // sessionId → text
export function registerTerminalSender(sessionId, fn) {
  senders.set(sessionId, fn);
  return () => { if (senders.get(sessionId) === fn) senders.delete(sessionId); };
}
export function sendToTerminal(sessionId, text) {
  const fn = senders.get(sessionId);
  if (fn && fn(text)) return 'sent';
  pending.set(sessionId, (pending.get(sessionId) || '') + text);
  return 'queued';
}
export function takePending(sessionId) {
  const v = pending.get(sessionId);
  pending.delete(sessionId);
  return v || '';
}
