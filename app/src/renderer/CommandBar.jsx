// 아래쪽 명령 바(ARCH 4절 B1, BRIEF 5절): `@이름 글`을 보내고 전달 상태를 보여준다. 대기 중인 전달은 취소할 수 있다.
// 일반 입력칸이라 한글 IME와 Windows 음성 입력(Win+H)을 그대로 쓴다(BRIEF 위험 1의 우회로). Ctrl+K로 들어온다.
// P5: 셸에는 보내지 않는다(대상 메뉴에서 뺀다. 보내면 백엔드가 not_agent로 거부).
// P6a(H8): @all은 캔버스 전체의 에이전트 세션이 받는다(셸 빼고).
// P6c(I2): 명령 바 위에 Thread(보낸 글, 전달 상태, 완료 보고)를 펼친다. 단추는 입력칸 옆
// P11: 아래 가운데에 떠 있는 넓은 입력(564×60, 반경 17). 왼쪽에 주황 2×2 마크, 오른쪽에 Thread와 보내기 둥근 단추. 전달 칩은 입력 위에
// P28: 입력을 판 너비의 56%(564~960px, 줌 알약·레일 자리는 비운다)로 넓혔다(styles.css .mt-bottom)
// P45: 스레드의 "고쳐 보내기"는 입력칸에 그 줄(@대상 글)을 넣고 초점을 준다. 스레드를 펼친 동안에는 전달 칩을 숨긴다(같은 것이 스레드에 있다)
// P43: 평소에는 숨고 아래 띠에 마우스가 오거나 초점이 들어오면(Ctrl+K, 판에서 아래 키) 나타난다(useAutoHide)
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useStore, toast, setBottomShown } from './store.js';
import { deliveryText } from './lib/labels.js';
import { ThreadPanel, ThreadToggle, commandDraft } from './Thread.jsx';
import { Icon, Mark } from './lib/icons.jsx';
import { useT, errText } from './lib/i18n.js';
import { inBand, bottomNext } from './lib/bottom.js'; // P43
import { isWeb, uploadFiles } from './web.js'; // P48: 웹 화면의 파일 붙여넣기·끌어 놓기
import { pathsText, filesOf, hasFiles, insertAt } from './lib/upload.js';

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
      return inBand({ x: e.clientX, y: e.clientY }, { left: r.left, right: r.right, bottom: s.bottom }) ? 'band' : 'out';
    };
    const onMove = (e) => setZone(zoneOf(e));
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
  useImperativeHandle(ref, () => ({ focus: () => taRef.current && taRef.current.focus() }));
  useEffect(() => {
    const onDraft = (e) => {
      const v = String(e.detail || '');
      setText(v); setPick(0);
      requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } });
    };
    commandDraft.addEventListener('draft', onDraft);
    return () => commandDraft.removeEventListener('draft', onDraft);
  }, []);

  // 커서 앞 낱말이 @로 시작하면 대상 메뉴(전체, 각 세션)
  const caretWord = (() => {
    const el = taRef.current;
    const pos = el ? el.selectionStart : text.length;
    const m = text.slice(0, pos).match(/(^|\s)@([^\s@]*)$/);
    return m ? { start: pos - m[2].length - 1, q: m[2] } : null;
  })();
  const options = useMemo(() => {
    if (!caretWord) return [];
    const names = ['all', ...[...sessions.values()].filter((s) => s.kind !== 'shell').map((s) => s.name)];
    const q = caretWord.q.toLowerCase();
    return names.filter((n) => n.toLowerCase().startsWith(q)).sort((a, b) => (a.toLowerCase() === q ? -1 : b.toLowerCase() === q ? 1 : 0)).slice(0, 20);
  }, [caretWord && caretWord.q, sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  function complete(name) {
    const el = taRef.current;
    const pos = el.selectionStart;
    const next = text.slice(0, caretWord.start) + '@' + name + ' ' + text.slice(pos);
    setText(next);
    setPick(0);
    requestAnimationFrame(() => { const p = caretWord.start + name.length + 2; el.setSelectionRange(p, p); });
  }

  async function send() {
    const line = text.trim();
    if (!line) return;
    if (!/^@\S/.test(line)) { toast(t('cmd.needTarget'), 'error'); return; }
    try {
      const r = await api.call('session.send', { text: line });
      const add = {};
      const body = line.replace(/^(@\S+\s*)+/, '');
      for (const d of r.deliveries) add[d.deliveryId] = body;
      setSentTexts((x) => ({ ...x, ...add }));
      hist.current.list = [line, ...hist.current.list.filter((x) => x !== line)].slice(0, 50);
      hist.current.i = -1;
      setText('');
    } catch (e) { toast(t('cmd.sendFailed', { error: errText(e) }), 'error'); }
  }

  function onKeyDown(e) {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중 Enter는 조합 확정이다
    if (options.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && caretWord && caretWord.q !== options[pick]))) { e.preventDefault(); complete(options[pick] || options[0]); return; }
    if (options.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
    if (e.key === 'Escape') { taRef.current.blur(); return; }
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

  // 명령 바 아래 칩: 아직 가는 중인 전달은 늘, 끝난 전달은 잠깐만(지난 기록은 Thread에 있다). 실패는 조금 더 오래 둔다
  const now = useTick(2000);
  const recent = [...deliveries.values()].filter((d) => !FINAL.has(d.status) || (d._at && now - d._at < (d.status === 'failed' || d.status === 'unconfirmed' ? FAILED_SHOW_MS : DONE_SHOW_MS))).slice(-6).reverse();
  const threadOpen = useStore((st) => st.threadOpen);
  const shown = useAutoHide(rootRef, { draft: text.trim().length > 0, popup: options.length > 0 || threadOpen });
  return (
    <>
    {/* P43: 숨은 동안 아래에 바가 있다는 얇은 표시. 마우스를 받지 않는다 */}
    <div className="mt-bottom-hint" data-role="bottom-hint" data-on={shown ? undefined : '1'} aria-hidden="true" />
    <div className="mt-bottom" ref={rootRef} data-role="bottom" data-hidden={shown ? undefined : '1'}>
      {/* P11: Thread와 전달 칩은 칩 줄 위로 띄운다 */}
      <div className="mt-bottom-above">
      <ThreadPanel />
      {recent.length > 0 && !threadOpen && (
        <div className="mt-deliveries">
          {recent.map((d) => (
            <div key={d.deliveryId} className={`mt-delivery ds-${d.status}`} data-delivery={d.deliveryId} data-status={d.status}>
              <b>@{d.name || '?'}</b>
              <span className="mt-delivery-st">{deliveryText(d)}</span>
              <span className="mt-delivery-text">{[...(sentTexts[d.deliveryId] ?? d.text ?? '').replace(/\s+/g, ' ')].slice(0, 60).join('')}</span>
              {d.status === 'queued' && <button className="mt-btn ghost small" onClick={() => api.call('delivery.cancel', { deliveryId: d.deliveryId }).catch((e) => toast(errText(e), 'error'))}>{t('common.cancel')}</button>}
              {!FINAL.has(d.status) && <span className="mt-spin" />}
            </div>
          ))}
        </div>
      )}
      </div>
      <div className="mt-cmd">
        {options.length > 0 && (
          <div className="mt-mention">
            {options.map((n, i) => <div key={n} className={`mt-mention-item${i === pick ? ' on' : ''}`} onMouseDown={(e) => { e.preventDefault(); complete(n); }}>@{n}{n === 'all' ? t('cmd.mentionAll', { n: allCount }) : ''}</div>)}
          </div>
        )}
        <Mark />
        <textarea ref={taRef} className="mt-cmd-input" rows={Math.min(6, text.split('\n').length)} value={text} placeholder={t('cmd.placeholder')} title={t('boardKeys.command')}
          onChange={(e) => { setText(e.target.value); setPick(0); }} onKeyDown={onKeyDown} spellCheck={false} data-role="command"
          onPaste={(e) => { const f = isWeb ? filesOf(e.clipboardData) : []; if (f.length) { e.preventDefault(); uploadInto(f); } }}
          onDragOver={(e) => { if (isWeb && hasFiles(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDrop={(e) => { const f = isWeb ? filesOf(e.dataTransfer) : []; if (f.length) { e.preventDefault(); uploadInto(f); } }} />
        <ThreadToggle />
        <button className={`mt-cmd-send${text.trim() ? ' on' : ''}`} onClick={send} title={t('cmd.send')} data-action="send"><Icon name="arrowUp" /></button>
      </div>
    </div>
    </>
  );
});
