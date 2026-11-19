// 아래쪽 명령 바(ARCH 4절 B1, BRIEF 5절): `@이름 글`을 보내고 전달 상태를 보여준다. 대기 중인 전달은 취소할 수 있다.
// 일반 입력칸이라 한글 IME와 Windows 음성 입력(Win+H)을 그대로 쓴다(BRIEF 위험 1의 우회로). Ctrl+K로 들어온다.
// P5: 셸에는 보내지 않는다(대상 메뉴에서 뺀다. 보내면 백엔드가 not_agent로 거부).
// P6a(H8): @all은 캔버스 전체의 에이전트 세션이 받는다(셸 빼고).
// P6c(I2): 명령 바 위에 Thread(보낸 글, 전달 상태, 완료 보고)를 펼친다. 단추는 입력칸 옆
// P11: 아래 가운데에 떠 있는 넓은 입력(564×60, 반경 17). 왼쪽에 주황 2×2 마크, 오른쪽에 Thread와 보내기 둥근 단추. 전달 칩은 입력 위에
// P28: 입력을 판 너비의 56%(564~960px, 줌 알약·레일 자리는 비운다)로 넓혔다(styles.css .mt-bottom)
// P45: 스레드의 "고쳐 보내기"는 입력칸에 그 줄(@대상 글)을 넣고 초점을 준다. 스레드를 펼친 동안에는 전달 칩을 숨긴다(같은 것이 스레드에 있다)
// P43: 평소에는 숨고 아래 띠에 마우스가 오거나 초점이 들어오면(Ctrl+K, 판에서 아래 키) 나타난다(useAutoHide)
// P61: 아래쪽 넓은 범위로 들어오면 나타나고 더 넓은 범위를 벗어나야 숨는다. 나타날 때 아래에서 올라온다(styles.css 끝)
// P83: 손가락 포인터(pointer: coarse)에는 마우스가 없어 아래 띠로 열 수 없다. 숨은 동안 아래 가운데에 손잡이 단추를 두고, 탭하면 입력칸에 초점을 줘
//      바가 열리고 키보드가 올라온다(초점이 붙잡는다). 키보드가 올라오면 바를 키보드 바로 위로 올린다. 바 밖을 탭하면 초점을 풀어 닫는다.
//      손가락의 pointermove는 아래 띠 판단에 쓰지 않는다. 마우스가 있는 PC·노트북은 그대로
// P142: 입력칸 다듬기(lib/cmd-input.js). textarea 밑에 같은 글을 그린 겹(mirror)을 두고 앞머리 @태그 자리에 알약 바탕을 그린다
//      (글자는 textarea가 그대로 그려 커서·고르기·IME·되돌리기가 바뀌지 않는다). 받는 세션은 단추 옆 칩으로 보인다.
//      높이는 그려진 글 높이(꺾인 줄 포함)로 정하고, 상한(18줄, 창 높이의 42%)에 닿으면 글칸 안쪽만 스크롤된다(위아래 여백은 그대로).
//      Alt+Enter도 줄바꿈. 바는 아래 기준으로 위로 자라고 단추는 아래 줄에 붙어 있다. 칩 줄은 자란 만큼 위로 비킨다(--mt-cmd-grow)
// P162: 데스크톱 창에서 탐색기로 복사한 파일을 붙이면 그 경로가, 캡처한 그림을 붙이면 [Image 1] 칩이 들어간다(lib/desktop-paste.js, main.mjs mt:clipPaste).
//      칩은 보낼 때 그림 파일 경로로 바뀌고, 마우스를 올리면 작은 미리보기, 칩 뒤 Backspace로 통째로 지운다. 웹 화면(P48 업로드)은 그대로
// P165: 왼쪽 마이크 단추로 음성 입력(Voice.jsx). 들은 글은 녹음을 시작한 커서 자리에 들어가고, 녹음 중에는 겹이 글을 그려 미확정 글을 흐리게 보인다
//      (textarea 글자는 투명, 커서는 그대로). 녹음 중 Enter는 녹음을 끝내고 남은 확정 글을 1초까지 받은 뒤 보낸다
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, toast, setBottomShown } from './store.js';
import { deliveryText } from './lib/labels.js';
import { ThreadPanel, ThreadToggle, commandDraft } from './Thread.jsx';
import { Icon, Mark } from './lib/icons.jsx';
import { useT, errText } from './lib/i18n.js';
import { bandZone, bottomNext } from './lib/bottom.js'; // P43. P61: 들어가는·나가는 범위(bandZone)
import { isWeb, uploadFiles } from './web.js'; // P48: 웹 화면의 파일 붙여넣기·끌어 놓기
import { pathsText, filesOf, hasFiles, insertAt } from './lib/upload.js';
import { imageTokens, mergeTokens, nextImageNo, expandImages, imageLabel, pastePathsText, wantsDesktopPaste } from './lib/desktop-paste.js'; // P162
import { kbLift } from './lib/touch-board.js'; // P83
import { useVoice, VoiceButton } from './Voice.jsx'; // P165
import { splitLive } from './lib/voice-text.js'; // P165
import { mentionTokens, recipients, mirrorParts, isNewlineKey, insertNewline, maxFieldHeight, fieldHeight, toggleTag, switchText, tagDeleteRange } from './lib/cmd-input.js'; // P142. P153: toggleTag. P155: tagDeleteRange

const isCoarse = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } };

const FINAL = new Set(['confirmed', 'unconfirmed', 'failed', 'cancelled']);
const DONE_SHOW_MS = 6000, FAILED_SHOW_MS = 30000;
function useTick(ms) { const [n, set] = useState(Date.now()); useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]); return n; }

// P43: 아래 바 자동 숨김(판단은 lib/bottom.js). 마우스가 아래 띠나 보이는 바·칩 위에 있는지, 명령 바·칩 줄에 초점이 있는지를 지켜보고
// 보일지를 정한다. 칩 줄(Chrome.jsx ChipRow)은 store.bottomShown을 따른다. 숨은 동안 바와 칩은 마우스를 받지 않아 그 밑의 터미널이 눌린다
const BAR_SEL = '.mt-bottom .mt-cmd, .mt-bottom .mt-mention, .mt-bottom-above, .mt-chips';
function useAutoHide(rootRef, { draft, popup }) {
  const pinned = useStore((st) => st.bottomPin);
  const [shown, setShown] = useState(false);
  const [zone, setZone] = useState('out');
  const [focus, setFocusIn] = useState({ focused: false, menu: false });
  const shownRef = useRef(false);
  shownRef.current = shown;
  useEffect(() => {
    const zoneOf = (e) => {
      const tg = e.target;
      // 보이는 바 위(숨은 동안에는 전달 칩만 마우스를 받는다. 그것으로는 띄우지 않는다)
      if (shownRef.current && tg && tg.closest && tg.closest(BAR_SEL)) return 'bar';
      const root = rootRef.current;
      const stage = root && root.closest('.mt-stage');
      if (!stage) return 'out';
      const r = root.getBoundingClientRect(), s = stage.getBoundingClientRect();
      return bandZone({ x: e.clientX, y: e.clientY, buttons: e.buttons }, { left: r.left, right: r.right, bottom: s.bottom }, shownRef.current);
    };
    const onMove = (e) => setZone(e.pointerType === 'touch' ? 'out' : zoneOf(e)); // P83: 손가락은 아래 띠로 열지 않는다(손잡이 단추)
    const onLeave = () => setZone('out');
    const readFocus = () => {
      const a = document.activeElement;
      const at = (sel) => !!(a && a.closest && a.closest(sel));
      const next = { focused: at('.mt-bottom'), menu: at('.mt-chips') };
      setFocusIn((f) => (f.focused === next.focused && f.menu === next.menu ? f : next));
    };
    const onFocusOut = () => setTimeout(readFocus, 0); // 초점이 옮겨 간 뒤에 본다
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);
    document.addEventListener('focusin', readFocus);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('focusin', readFocus);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [rootRef]);
  useEffect(() => {
    const next = bottomNext({ shown, zone, focused: focus.focused, menu: focus.menu, draft, popup, pinned });
    if (next.shown === shown) return undefined;
    if (!next.delay) { setShown(next.shown); return undefined; }
    const id = setTimeout(() => setShown(next.shown), next.delay);
    return () => clearTimeout(id);
  }, [shown, zone, focus, draft, popup, pinned]);
  useEffect(() => { setBottomShown(shown); }, [shown]);
  return shown;
}

// P158: 수정 실패 까닭(이미 보냄, 이미 끝남, 빈 글)
function editErr(t, e) {
  if (e && e.code === 'already_sent') return t('deliveryEdit.alreadySent');
  if (e && e.code === 'not_editable') return t('deliveryEdit.notEditable');
  if (e && e.code === 'empty') return t('deliveryEdit.empty');
  return t('deliveryEdit.failed', { error: errText(e) });
}

// P158: 고치는 칩. Enter 저장(Shift·Alt+Enter 줄바꿈), Esc 되돌림. 저장하면 대기열 차례 그대로 새 글로 간다.
//   저장하지 않고 사라지면(되돌림, 스레드 열기 등) 붙잡은 전달을 놓는다. 고치는 동안 그 전달이 끝나면(다른 곳에서 취소 등) 닫는다
function DeliveryEdit({ d, text, onDone }) {
  const t = useT();
  const [val, setVal] = useState(text);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const settled = useRef(false);
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; el.style.height = 'auto'; const full = el.scrollHeight + (el.offsetHeight - el.clientHeight); el.style.height = `${Math.min(full, 220)}px`; el.style.overflowY = full > 220 ? 'auto' : 'hidden'; }, [val]); // 테두리까지 더해 한 줄에 스크롤 막대가 생기지 않게
  useEffect(() => () => { if (!settled.current) api.call('delivery.release', { deliveryId: d.deliveryId }).catch(() => {}); }, [d.deliveryId]);
  useEffect(() => {
    if (d.status === 'queued' || settled.current) return;
    settled.current = true;
    if (['sending', 'sent', 'confirmed', 'unconfirmed'].includes(d.status)) toast(t('deliveryEdit.alreadySent'), 'error');
    onDone(null);
  }, [d.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = () => { settled.current = true; api.call('delivery.release', { deliveryId: d.deliveryId }).catch(() => {}); onDone(null); };
  async function save() {
    if (busy) return;
    if (!val.trim()) { toast(t('deliveryEdit.empty'), 'error'); return; }
    if (val === text) { cancel(); return; }
    setBusy(true);
    try {
      const r = await api.call('delivery.update', { deliveryId: d.deliveryId, text: val });
      settled.current = true;
      onDone(r.text ?? val);
    } catch (e) {
      setBusy(false);
      toast(editErr(t, e), 'error');
      if (e && (e.code === 'already_sent' || e.code === 'not_editable' || e.code === 'not_found')) { settled.current = true; onDone(null); }
    }
  }
  const onKey = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); save(); return; }
    if (e.key === 'Enter' && e.altKey) { e.preventDefault(); const el = e.currentTarget; const r = insertNewline(el.value, el.selectionStart, el.selectionEnd); setVal(r.text); requestAnimationFrame(() => el.setSelectionRange(r.caret, r.caret)); }
  };
  return (
    <div className="mt-delivery mt-delivery-edit ds-queued" data-delivery={d.deliveryId} data-status={d.status} data-editing="1">
      <div className="mt-delivery-edit-head"><b>@{d.name || '?'}</b><span className="mt-delivery-st">{t('deliveryEdit.holding')}</span></div>
      <textarea ref={ref} className="mt-delivery-edit-input" rows={1} value={val} disabled={busy} spellCheck={false} data-role="delivery-edit-input" aria-label={t('deliveryEdit.inputLabel')}
        onChange={(e) => setVal(e.target.value)} onKeyDown={onKey} />
      <div className="mt-delivery-edit-foot">
        <span className="mt-delivery-edit-hint">{t('deliveryEdit.hint')}</span>
        <button className="mt-btn ghost small" data-action="delivery-edit-cancel" onClick={cancel} disabled={busy}>{t('common.cancel')}</button>
        <button className="mt-btn small primary" data-action="delivery-edit-save" onClick={save} disabled={busy}>{t('common.save')}</button>
      </div>
    </div>
  );
}

export const CommandBar = forwardRef(function CommandBar(_props, ref) {
  const t = useT();
  const sessions = useStore((st) => st.sessions);
  const deliveries = useStore((st) => st.deliveries);
  const allCount = [...sessions.values()].filter((s) => s.kind !== 'shell').length;
  const [text, setText] = useState('');
  const [pick, setPick] = useState(0);
  const [sentTexts, setSentTexts] = useState({}); // deliveryId → 글(이벤트에는 글이 없다)
  const taRef = useRef(null);
  const rootRef = useRef(null);
  const hist = useRef({ list: [], i: -1 });
  const [images, setImages] = useState({}); // P162: 그림 칩 번호 → { path, thumb }
  const [preview, setPreview] = useState(null); // P162: 마우스를 올린 그림 칩 { n, x, y }
  const voice = useVoice({ text, setText, taRef, inline: true }); // P165
  useImperativeHandle(ref, () => ({ focus: () => taRef.current && taRef.current.focus() }));
  useEffect(() => {
    const onDraft = (e) => {
      const v = String(e.detail || '');
      setText(v); setPick(0);
      requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } });
    };
    // P153: 세션 맵의 카드 누르기 = 받는 세션 태그 넣기·빼기(초점은 옮기지 않는다), 맵에서 친 글자 = 입력칸에 초점(그 글자는 입력칸이 받는다)
    const onTag = (e) => setText((cur) => toggleTag(cur, String(e.detail || '')));
    const onFocusBar = () => { const el = taRef.current; if (el && document.activeElement !== el) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n); } };
    commandDraft.addEventListener('draft', onDraft);
    commandDraft.addEventListener('tag', onTag);
    commandDraft.addEventListener('focus', onFocusBar);
    return () => { commandDraft.removeEventListener('draft', onDraft); commandDraft.removeEventListener('tag', onTag); commandDraft.removeEventListener('focus', onFocusBar); };
  }, []);
  // P153: 세션 맵이 지금 글(태그된 카드 표시)을 듣는다
  useEffect(() => { commandDraft.dispatchEvent(new CustomEvent('text', { detail: text })); }, [text]);
  const missionOpen = useStore((st) => st.missionOpen);
  // P153 r6: 판 ↔ 세션 맵을 오갈 때(열기·닫기·더블클릭 이동·M·Esc·닫기 단추 모두) 태그만 남은 명령줄은 비운다(switchText)
  const wasOpen = useRef(missionOpen);
  useEffect(() => { if (wasOpen.current === missionOpen) return; wasOpen.current = missionOpen; setText((cur) => switchText(cur)); }, [missionOpen]);

  // 커서 앞 낱말이 @로 시작하면 대상 메뉴(전체, 각 세션)
  const caretWord = (() => {
    const el = taRef.current;
    const pos = el ? el.selectionStart : text.length;
    const m = text.slice(0, pos).match(/(^|\s)@([^\s@]*)$/);
    return m ? { start: pos - m[2].length - 1, q: m[2] } : null;
  })();
  const options = useMemo(() => {
    if (!caretWord) return [];
    const list = [...sessions.values()].filter((s) => s.kind !== 'shell');
    const names = ['all', ...list.map((s) => s.name)];
    const q = caretWord.q.toLowerCase();
    // P66: 판의 이름을 바꾼 세션은 옛 주소로 쳐도 찾고, 새 이름으로 채운다
    const byAddress = new Set(list.filter((s) => s.address && s.address !== s.name && s.address.toLowerCase().startsWith(q)).map((s) => s.name));
    return names.filter((n) => n.toLowerCase().startsWith(q) || byAddress.has(n)).sort((a, b) => (a.toLowerCase() === q ? -1 : b.toLowerCase() === q ? 1 : 0)).slice(0, 20);
  }, [caretWord && caretWord.q, sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  const addrOf = useMemo(() => new Map([...sessions.values()].filter((s) => s.address && s.address !== s.name).map((s) => [s.name, s.address])), [sessions]); // P66: 목록에 옛 주소를 작게
  function complete(name) {
    const el = taRef.current;
    const pos = el.selectionStart;
    const next = text.slice(0, caretWord.start) + '@' + name + ' ' + text.slice(pos);
    setText(next);
    setPick(0);
    requestAnimationFrame(() => { const p = caretWord.start + name.length + 2; el.setSelectionRange(p, p); });
  }

  async function send() {
    // P165: 녹음 중이면 끝내고 남은 확정 글을 잠깐 받은 뒤 그 글로 보낸다
    let cur = text;
    if (voice.active) { await voice.finish(1000); cur = voice.current(); }
    const line = cur.trim();
    if (!line) return;
    if (!/^@\S/.test(line)) { toast(t('cmd.needTarget'), 'error'); return; }
    const out = expandImages(line, images); // P162: 그림 칩 → 파일 경로
    try {
      const r = await api.call('session.send', { text: out });
      const add = {};
      const body = out.replace(/^(@\S+\s*)+/, '');
      for (const d of r.deliveries) add[d.deliveryId] = body;
      setSentTexts((x) => ({ ...x, ...add }));
      hist.current.list = [out, ...hist.current.list.filter((x) => x !== out)].slice(0, 50);
      hist.current.i = -1;
      setText('');
      setPreview(null);
    } catch (e) { toast(t('cmd.sendFailed', { error: errText(e) }), 'error'); }
  }

  function onKeyDown(e) {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중 Enter는 조합 확정이다
    if (options.length && (e.key === 'Tab' || (e.key === 'Enter' && !isNewlineKey(e) && caretWord && caretWord.q !== options[pick]))) { e.preventDefault(); complete(options[pick] || options[0]); return; }
    if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length); return; }
    // P142: Alt+Enter도 줄바꿈. 되돌리기(Ctrl+Z)에 남도록 insertText로 넣고, 안 되면 직접 넣는다. Shift+Enter는 textarea 기본 동작
    if (isNewlineKey(e)) {
      if (!e.altKey) return;
      e.preventDefault();
      const el = taRef.current;
      let ok = false;
      try { ok = document.execCommand('insertText', false, '\n'); } catch { ok = false; }
      if (!ok && el) {
        const r = insertNewline(el.value, el.selectionStart, el.selectionEnd);
        setText(r.text);
        requestAnimationFrame(() => el.setSelectionRange(r.caret, r.caret));
      }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); send(); return; }
    if (e.key === 'Escape') { taRef.current.blur(); return; }
    // P155: 칩 바로 뒤 Backspace·바로 앞 Delete는 칩을 통째로 지운다(tagDeleteRange). 한글 조합 중(위의 isComposing, keyCode 229)과
    // Ctrl·Alt·Meta 조합은 기본 동작. 되돌리기(Ctrl+Z)에 남도록 그 범위를 골라 execCommand('delete')로 지우고, 안 되면 직접 지운다
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.metaKey && e.keyCode !== 229) {
      const el = taRef.current;
      const r = el && tagDeleteRange(el.value, el.selectionStart, el.selectionEnd, e.key, tokens);
      if (r) {
        e.preventDefault();
        el.setSelectionRange(r.start, r.end);
        let ok = false;
        try { ok = document.execCommand('delete'); } catch { ok = false; }
        if (!ok) {
          const v = el.value.slice(0, r.start) + el.value.slice(r.end);
          setText(v);
          requestAnimationFrame(() => el.setSelectionRange(r.start, r.start));
        }
        return;
      }
    }
    const h = hist.current;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !text.includes('\n')) {
      if (!h.list.length) return;
      e.preventDefault();
      h.i = e.key === 'ArrowUp' ? Math.min(h.list.length - 1, h.i + 1) : Math.max(-1, h.i - 1);
      setText(h.i < 0 ? '' : h.list[h.i]);
    }
  }

  // P48: 웹 화면은 붙여 넣거나 끌어 놓은 파일을 백엔드로 올리고 그 PC 경로를 커서 자리에 넣는다
  function uploadInto(files) {
    const el = taRef.current;
    const at = el ? [el.selectionStart, el.selectionEnd] : [text.length, text.length];
    toast(t('upload.uploading', { n: files.length }));
    uploadFiles(files).then((paths) => {
      setText((cur) => {
        const r = insertAt(cur, at[0], at[1], pathsText(paths));
        requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(r.caret, r.caret); } });
        return r.text;
      });
      toast(t('upload.done', { n: paths.length }));
    }, (err) => toast(t('upload.failed', { error: err.message }), 'error'));
  }

  // P162: 데스크톱 창의 붙여 넣기. 탐색기에서 복사한 파일은 경로(폴더는 뺀다), 캡처한 그림은 [Image n] 칩을 커서 자리에 넣는다
  const desktopPaste = !isWeb && typeof window !== 'undefined' && window.mt && typeof window.mt.clipPaste === 'function';
  function pasteDesktop() {
    const el = taRef.current;
    const at = el ? [el.selectionStart, el.selectionEnd] : [text.length, text.length];
    const put = (add) => setText((cur) => {
      const r = insertAt(cur, at[0], at[1], add);
      requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(r.caret, r.caret); } });
      return r.text;
    });
    window.mt.clipPaste().then((r) => {
      if (!r) return;
      if (r.kind === 'error') { toast(t('desktopPaste.tooBig'), 'error'); return; }
      if (r.kind === 'files') {
        if (r.folders && !r.paths.length) { toast(t('desktopPaste.foldersOnly', { n: r.folders })); return; }
        if (r.folders) toast(t('desktopPaste.foldersSkipped', { n: r.folders }));
        put(pastePathsText(r.paths));
        return;
      }
      if (r.kind === 'image') {
        const n = nextImageNo(el ? el.value : text, images);
        setImages((m) => ({ ...m, [n]: { path: r.path, thumb: r.thumb } }));
        put(`${imageLabel(n)} `);
      }
    }, (e) => toast(t('desktopPaste.failed', { error: e.message }), 'error'));
  }
  // P162: 그림 칩 위에 마우스가 오면 미리보기. 칩은 textarea 밑 겹에 그려지므로 겹의 칩 자리로 찾는다
  function hoverChip(e) {
    const m = mirInRef.current, f = fieldRef.current;
    if (!m || !f) return;
    const fr = f.getBoundingClientRect(); // 미리보기는 글칸(.mt-cmd-field) 안에 둔다(바가 움직이는 동안에도 칩에 붙어 있게)
    let hit = null;
    for (const sp of m.querySelectorAll('[data-img]')) {
      for (const rc of sp.getClientRects()) if (e.clientX >= rc.left && e.clientX <= rc.right && e.clientY >= rc.top && e.clientY <= rc.bottom) { hit = { n: Number(sp.dataset.img), x: rc.left - fr.left, y: rc.top - fr.top }; break; }
      if (hit) break;
    }
    setPreview((o) => (!hit ? null : o && o.n === hit.n && o.x === hit.x && o.y === hit.y ? o : hit));
  }

  // 명령 바 아래 칩: 아직 가는 중인 전달은 늘, 끝난 전달은 잠깐만(지난 기록은 Thread에 있다). 실패는 조금 더 오래 둔다
  const now = useTick(2000);
  const recent = [...deliveries.values()].filter((d) => !FINAL.has(d.status) || (d._at && now - d._at < (d.status === 'failed' || d.status === 'unconfirmed' ? FAILED_SHOW_MS : DONE_SHOW_MS))).slice(-6).reverse();
  const threadOpen = useStore((st) => st.threadOpen);
  // P158: 대기 중 칩의 수정. 백엔드가 그 전달을 붙잡고(보내지 않음) 전체 글을 돌려주면 칩이 글 칸으로 바뀐다
  const [editing, setEditing] = useState(null); // { id, text }
  async function startEdit(d) {
    try {
      const r = await api.call('delivery.hold', { deliveryId: d.deliveryId });
      setEditing({ id: d.deliveryId, text: r.text ?? sentTexts[d.deliveryId] ?? '' });
    } catch (e) { toast(editErr(t, e), 'error'); }
  }
  const shown = useAutoHide(rootRef, { draft: text.trim().length > 0, popup: options.length > 0 || threadOpen || missionOpen }); // P153: 세션 맵이 열린 동안 늘 보인다
  // P83: 손가락 화면. 손잡이 단추, 키보드 위로 올리기, 바 밖을 탭하면 닫기
  const [coarse] = useState(isCoarse);
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!coarse) return undefined;
    const vv = window.visualViewport;
    const fit = () => {
      const root = rootRef.current, stage = root && root.closest('.mt-stage');
      const a = document.activeElement;
      const typing = !!(a && a.closest && a.closest('.mt-bottom'));
      const v = typing && vv && stage ? kbLift({ stageBottom: stage.getBoundingClientRect().bottom, vvTop: vv.offsetTop, vvHeight: vv.height, innerHeight: window.innerHeight }) : 0;
      setLift((o) => (Math.abs(o - v) < 1 ? o : v));
    };
    const outside = (e) => {
      const a = document.activeElement;
      if (!a || !a.closest || !a.closest('.mt-bottom')) return;
      const tg = e.target;
      if (tg && tg.closest && tg.closest('.mt-bottom, .mt-chips, .mt-bottom-handle')) return;
      a.blur(); // 바 밖(판)을 탭하면 키보드를 내리고 바를 닫는다(판은 손가락을 그대로 받는다)
    };
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
    window.addEventListener('resize', fit);
    document.addEventListener('focusin', fit); document.addEventListener('focusout', fit);
    document.addEventListener('touchstart', outside, { capture: true, passive: true });
    return () => { if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); } window.removeEventListener('resize', fit); document.removeEventListener('focusin', fit); document.removeEventListener('focusout', fit); document.removeEventListener('touchstart', outside, { capture: true }); };
  }, [coarse]);
  const openByTouch = () => { const el = taRef.current; if (el) el.focus(); };

  // P142: @태그 조각과 받는 세션
  const sessList = useMemo(() => [...sessions.values()], [sessions]);
  const tagTokens = useMemo(() => mentionTokens(text, sessList), [text, sessList]);
  const tokens = useMemo(() => mergeTokens(tagTokens, imageTokens(text, images)), [tagTokens, text, images]); // P162: 그림 칩도 겹에 그리고 통째로 지운다
  const toList = useMemo(() => recipients(text, sessList), [text, sessList]);
  // P142: 높이. 겹의 안쪽(글과 같은 폭으로 그려진 글)의 높이를 재어 글칸 높이를 정한다. 그리기 전에 정해 깜빡이지 않는다
  const mirRef = useRef(null), mirInRef = useRef(null), fieldRef = useRef(null);
  const [fh, setFh] = useState({ height: 0, scroll: false });
  const measure = useCallback(() => {
    const ta = taRef.current, inner = mirInRef.current;
    if (!ta || !inner) return;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    const next = fieldHeight({ contentHeight: inner.getBoundingClientRect().height, lineHeight: Math.ceil(lh), maxHeight: maxFieldHeight({ lineHeight: lh, viewportHeight: window.innerHeight }) });
    setFh((o) => (o.height === next.height && o.scroll === next.scroll ? o : next));
  }, []);
  useLayoutEffect(measure, [text, measure]);
  useEffect(() => {
    const f = fieldRef.current;
    if (!f || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(f);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure]);
  const syncScroll = () => { const ta = taRef.current, m = mirRef.current; if (ta && m) m.scrollTop = ta.scrollTop; };
  useLayoutEffect(() => {
    syncScroll();
    // 칩 줄(판의 .mt-chips)은 바가 자란 만큼 위로 비킨다
    const root = rootRef.current, stage = root && root.closest('.mt-stage'), bar = root && root.querySelector('.mt-cmd');
    if (stage && bar) stage.style.setProperty('--mt-cmd-grow', `${Math.max(0, Math.round(bar.offsetHeight - 60))}px`);
  });
  const parts = splitLive(mirrorParts(text, tokens), voice.live); // P165: 미확정 들은 글은 흐리게
  const toShown = toList.slice(0, 3), toMore = toList.length - toShown.length;
  const toTitle = (r) => (r.state === 'all' ? t('cmdTo.all', { n: r.count }) : r.state === 'unknown' ? t('cmdTo.unknown', { name: r.ref }) : r.state === 'shell' ? t('cmdTo.shell', { name: r.name }) : t('cmdTo.ok', { name: r.name }));
  return (
    <>
    {/* P43: 숨은 동안 아래에 바가 있다는 얇은 표시. 마우스를 받지 않는다 */}
    <div className="mt-bottom-hint" data-role="bottom-hint" data-on={shown || coarse ? undefined : '1'} aria-hidden="true" />
    {coarse && !shown && <button type="button" className="mt-bottom-handle" data-action="bottom-open" aria-label={t('phoneExit.cmdOpen')} onClick={openByTouch}><Mark /><span>{t('phoneExit.cmdShort')}</span></button>}
    <div className="mt-bottom" ref={rootRef} data-role="bottom" data-hidden={shown ? undefined : '1'} data-mission={missionOpen ? '1' : undefined} data-kb={lift > 0 ? '1' : undefined} style={lift > 0 ? { '--mt-kb-lift': `${lift}px` } : undefined}>
      {/* P11: Thread와 전달 칩은 칩 줄 위로 띄운다 */}
      <div className="mt-bottom-above">
      <ThreadPanel />
      {recent.length > 0 && !threadOpen && (
        <div className="mt-deliveries">
          {recent.map((d) => (editing && editing.id === d.deliveryId ? (
            <DeliveryEdit key={d.deliveryId} d={d} text={editing.text} onDone={(text) => { setEditing(null); if (text != null) setSentTexts((x) => ({ ...x, [d.deliveryId]: text })); }} />
          ) : (
            <div key={d.deliveryId} className={`mt-delivery ds-${d.status}`} data-delivery={d.deliveryId} data-status={d.status}>
              <b>@{d.name || '?'}</b>
              <span className="mt-delivery-st">{deliveryText(d)}</span>
              <span className="mt-delivery-text">{[...(sentTexts[d.deliveryId] ?? d.text ?? '').replace(/\s+/g, ' ')].slice(0, 60).join('')}</span>
              {d.status === 'queued' && <button className="mt-btn ghost small" data-action="delivery-edit" onClick={() => startEdit(d)} title={t('deliveryEdit.editTitle')}>{t('deliveryEdit.edit')}</button>}
              {d.status === 'queued' && <button className="mt-btn ghost small" onClick={() => api.call('delivery.cancel', { deliveryId: d.deliveryId }).catch((e) => toast(errText(e), 'error'))}>{t('common.cancel')}</button>}
              {!FINAL.has(d.status) && <span className="mt-spin" />}
            </div>
          )))}
        </div>
      )}
      </div>
      <div className="mt-cmd">
        {options.length > 0 && (
          <div className="mt-mention">
            {options.map((n, i) => <div key={n} className={`mt-mention-item${i === pick ? ' on' : ''}`} onMouseDown={(e) => { e.preventDefault(); complete(n); }}>@{n}{n === 'all' ? t('cmd.mentionAll', { n: allCount }) : ''}{addrOf.get(n) ? <span className="mt-mention-addr"> {addrOf.get(n)}</span> : null}</div>)}
          </div>
        )}
        <Mark />
        <VoiceButton voice={voice} className="mt-cmd-voice" />
        {/* P142: 글칸. 위아래 여백은 이 틀이 쥐고, 상한에 닿으면 textarea 안쪽만 스크롤된다. 여백을 눌러도 입력칸에 초점 */}
        <div className="mt-cmd-field" ref={fieldRef} data-scroll={fh.scroll ? '1' : undefined} data-voice={voice.active ? '1' : undefined} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); taRef.current && taRef.current.focus(); } }}>
          <div className="mt-cmd-mirror" ref={mirRef} aria-hidden="true">
            <div className="mt-cmd-mirror-in" ref={mirInRef}>{parts.map((p, i) => (p.tag && p.tag.img ? <span key={i} className={`mt-cmd-img${p.live ? ' mt-cmd-live' : ''}`} data-img={p.tag.n}>{p.text}</span> : p.tag ? <span key={i} className={`mt-cmd-tag ${p.tag.lead ? 'to-' + p.tag.state : 'inline'}${p.live ? ' mt-cmd-live' : ''}`} data-tag={p.tag.ref}>{p.text}</span> : <span key={i} className={p.live ? 'mt-cmd-live' : undefined} data-live={p.live ? '1' : undefined}>{p.text}</span>))}{'\u200b'}</div>
          </div>
          <textarea ref={taRef} className="mt-cmd-input" rows={1} style={fh.height ? { height: `${fh.height}px` } : undefined} value={text} placeholder={missionOpen ? t('mmTerr.barHint') : t('cmd.placeholder')} title={t('boardKeys.command')}
            onChange={(e) => { setText(e.target.value); setPick(0); }} onKeyDown={onKeyDown} onScroll={syncScroll} spellCheck={false} data-role="command"
            onPaste={(e) => {
              if (wantsDesktopPaste(e.clipboardData, { desktop: desktopPaste })) { e.preventDefault(); pasteDesktop(); return; } // P162
              const f = isWeb ? filesOf(e.clipboardData) : []; if (f.length) { e.preventDefault(); uploadInto(f); }
            }}
            onMouseMove={hoverChip} onMouseLeave={() => setPreview(null)}
            onDragOver={(e) => { if (isWeb && hasFiles(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
            onDrop={(e) => { const f = isWeb ? filesOf(e.dataTransfer) : []; if (f.length) { e.preventDefault(); uploadInto(f); } }} />
          {preview && images[preview.n] && (
            <div className="mt-cmd-img-preview" data-role="img-preview" style={{ left: `${Math.round(preview.x)}px`, top: `${Math.round(preview.y)}px` }}>
              {images[preview.n].thumb ? <img src={images[preview.n].thumb} alt={imageLabel(preview.n)} /> : null}
              <span>{imageLabel(preview.n)}</span>
            </div>
          )}
        </div>
        {/* P142: 이 글이 가는 세션. 없는 이름·셸은 다른 모양 */}
        {toList.length > 0 && (
          <div className="mt-cmd-to" data-role="cmd-to" aria-label={t('cmdTo.label')}>
            <span className="mt-cmd-to-arrow" aria-hidden="true">→</span>
            {toShown.map((r) => <span key={r.state + r.name} className={`mt-cmd-to-chip st-${r.state}`} data-to={r.name} data-state={r.state} title={toTitle(r)}>@{r.name}{r.state === 'all' ? <span className="n">{r.count}</span> : null}</span>)}
            {toMore > 0 && <span className="mt-cmd-to-chip more" title={toList.slice(3).map((r) => '@' + r.name).join(' ')}>+{toMore}</span>}
          </div>
        )}
        <ThreadToggle />
        <button className={`mt-cmd-send${text.trim() ? ' on' : ''}`} onPointerDown={(e) => { if (e.pointerType === 'touch') e.preventDefault(); }} onClick={send} title={t('cmd.send')} data-action="send"><Icon name="arrowUp" /></button>
      </div>
    </div>
    </>
  );
});
