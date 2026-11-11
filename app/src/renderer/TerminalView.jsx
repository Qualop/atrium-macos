// 가까이 얼굴: 제어기 프레임을 xterm.js로 그리고 입력을 제어기로 넘긴다(ARCH 7.2, E4).
// - allowProposedApi + unicode11(이모지 폭). 프레임의 크기가 바뀌면 쓰기 전에 xterm 크기를 맞춘다.
// - 붙여넣기는 괄호 붙여넣기로 감싸고, 휠은 SGR 마우스 시퀀스로 바꾼다. ctrl+g(외부 편집기)는 막는다.
// - WebGL 렌더러는 예산(기본 8) 안에서만 쓰고, 넘거나 컨텍스트를 잃으면 DOM으로 그린다(BRIEF 위험 2).
// - P6a(H4): 노드를 눌러 들어간 뒤 붙기 전에 친 글(store.pendingInput)은 붙자마자 넣고 초점을 준다.
// - P38: 판 배율 아래에서도 끌어 고르기가 마우스 밑 글자를 따라가게 xterm의 마우스 → 칸 계산에 확대·축소 전 자리를 넘긴다(unscalePoint).
//   고르는 동안 포인터는 글 고르기 모양. 복사는 줄 끝 빈칸을 뺀다.
// - P42: 글 고르기는 웹처럼 한다(term-selection.js). 선택은 글에 붙어 휠·가장자리 자동 스크롤·새 프레임에 함께 움직이고 풀리지 않는다.
//   claude 등은 프레임을 이어 붙인 문서로, 셸은 herdr 기록과 밀려난 줄을 xterm scrollback에 넣어(판 안에서 스크롤) 화면 밖 글까지 고르고 복사한다.
// - P45: 글자 크기 = TERM_FONT_SIZE × 터미널 글자 배율(설정 일반 탭, store.termScale). 바꾸면 곧바로 글자를 바꾸고 줄·칸 수를 다시 재 패널 크기를 맞춘다.
// - P47: 창(클라이언트) 여럿이 한 패널을 함께 본다. 패널 크기는 마지막으로 입력했거나 초점을 준 창이 정하고(terminal.owner),
//   다른 창은 같은 열×행을 노드 크기에 맞춰 비율로 그린다(fitScale). 다른 기기가 방금 친 터미널에는 짧게 표시한다(잠그지 않는다).
// - P65: 판 배율·분수 DPR에서 글자가 흐리지 않게, 배율이 멈추면 WebGL 터미널을 화면 장치 픽셀에 맞춘 해상도로 다시 그리고
//   캔버스를 장치 픽셀 경계에 맞춘다(lib/term-sharp.js). 패널 줄·칸 수는 배율 1 칸으로 잰다(배율을 바꿔도 패널 크기는 그대로).
import { useEffect, useRef, useState } from 'react';
import { useStoreApi } from '@xyflow/react';
import { Terminal } from '@xterm/xterm';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { api } from './api.js';
import { useStore, getState, takePendingInput, pendingFor } from './store.js';
import { wrapPaste, wheelToSgr, shellWheelLines, sgrWheel, keyAction, frameBytes, unscalePoint, clearsSelection, copyText, REDRAW_PREFIX, joinBytes } from './lib/term-input.js';
import { findShift, bigChange, historyAbove, historyPrefill, scrollUpSeq, serializeScreen, stripAnsi } from './lib/term-select.js';
import { TermSelection } from './term-selection.js';
import { RendererBudget, DEFAULT_WEBGL_BUDGET } from './lib/faces.js';
import { onFrame, onWritten, markInput, setTerminal, perfLog } from './perf.js';
import { termTheme, TERM_FONT, TERM_FONT_SIZE, TERM_LINE_HEIGHT } from './lib/tokens.js';
import { termFontSize, clampScale, clampPhoneScale } from './lib/scale.js'; // P45. P83: 휴대폰 글자(fontScale)는 40%까지
import { sharpPlan, compensate, phaseShift, paintedAt, samePlan, cssCanvas, fitDims } from './lib/term-sharp.js'; // P65
import { useT, errText } from './lib/i18n.js';
import { fitScale, inputByLabel } from './lib/multiclient.js'; // P47: 창 여럿이 같은 패널을 볼 때
import { isWeb, uploadFiles } from './web.js'; // P48: 웹 화면의 파일 붙여넣기·끌어 놓기
import { pathsText, filesOf, hasFiles } from './lib/upload.js';
import { termBudgetNow, step } from './crash-watch.js'; // P84: 손가락 웹 화면은 WebGL 없이, 웹은 캔버스 픽셀 상한을 낮게. P86: 단계 기록
import { capDims } from './lib/crumbs.js'; // P86: 웹 화면의 칸·줄 상한

// P86: 단계 기록에 적는 터미널 값(잰 글자 폭·높이, 칸·줄, DOM 셀 수, 판 배율). 내용 없음
const cellsOf = (term) => { const rows = term.element && term.element.querySelector('.xterm-rows'); return rows ? rows.getElementsByTagName('span').length + rows.children.length : 0; };
const charOf = (term) => { const c = term._core && term._core._charSizeService; return c ? { cw: c.width, ch: c.height } : {}; };
function readNumber(key, dflt) {
  const q = new URLSearchParams(location.search).get(key);
  let v = q;
  try { v ??= localStorage.getItem(`mt.${key}`); } catch {}
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? n : dflt;
}
const termPlan = termBudgetNow(Infinity, readNumber('webglBudget', DEFAULT_WEBGL_BUDGET)); // P84: { webgl, maxPx }
export const budget = new RendererBudget(termPlan.webgl);
export const terms = new Map(); // sessionId → Terminal (시험과 E6에서 읽는다)
const SHELL_SCROLLBACK = 5000; // P42: 셸 노드의 판 안 기록 줄 수
const HISTORY_WAIT = 1500; // P42: 셸 기록을 첫 프레임 앞에 넣으려고 기다리는 시간(넘으면 기록 없이 그린다)
const SHARP_SETTLE_MS = 160; // P65: 판이 이만큼 멈춰 있으면 화면 해상도로 다시 그린다(움직이는 동안은 다시 그리지 않는다)
const SHARP_CHECK_MS = 1000; // P65: 노드를 옮겨 캔버스가 장치 픽셀 경계에서 벗어났는지 보는 주기

// P38: xterm은 마우스 위치를 칸으로 바꿀 때 판의 CSS 확대·축소를 모른다(화면 px를 확대·축소 전 칸 크기로 나눈다).
// 마우스 서비스(선택, 링크, 마우스 보고가 함께 쓴다)에 확대·축소 전 자리를 넘긴다. xterm 6.0.0의 내부(_core._mouseService)라
// 판 올릴 때 확인한다. 없으면 기록만 남기고 그대로 둔다(배율 1에서는 그대로 맞는다)
function fixMouseScale(term, sessionId) {
  const ms = term._core && term._core._mouseService;
  if (!ms || typeof ms.getCoords !== 'function' || typeof ms.getMouseReportCoords !== 'function') { window.mt.log(`xterm mouse service not found ${sessionId}: selection may drift when zoomed`); return; }
  const unscale = (ev, el) => unscalePoint({ clientX: ev.clientX, clientY: ev.clientY, rect: el.getBoundingClientRect(), width: el.offsetWidth, height: el.offsetHeight });
  const getCoords = ms.getCoords.bind(ms), getReport = ms.getMouseReportCoords.bind(ms);
  ms.getCoords = (ev, el, ...rest) => getCoords(unscale(ev, el), el, ...rest);
  ms.getMouseReportCoords = (ev, el) => getReport(unscale(ev, el), el);
}

// P11: 색은 tokens.css --term-…, 글꼴은 앱에 넣은 JetBrains Mono(한글 Nanum Gothic Coding). 글 크기와 줄 높이는 lib/tokens.js

// P74: fontScale을 주면 store의 터미널 글자 배율 대신 그 값(휴대폰 화면의 글자 크기). webgl = false면 DOM으로 그린다(휴대폰: 터미널 하나, 높은 DPR)
export function TerminalView({ sessionId, width, height, onActivate, onInput, focusTick, fontScale = null, webgl = true }) {
  const t = useT();
  const flow = useStoreApi(); // P65: 판 배율·이동을 렌더 없이 구독한다
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const hostRef = useRef(null);
  const ref = useRef({});
  const restoreFocus = useRef(false);
  const [status, setStatus] = useState({ kind: 'attaching' });
  const [hint, setHint] = useState(null);
  const [retry, setRetry] = useState(0);
  const [share, setShare] = useState({ shared: 1, ownerIsMe: true, ownerName: null }); // P47
  const [typing, setTyping] = useState(null); // P47: 다른 기기가 방금 입력

  useEffect(() => {
    const host = hostRef.current;
    const st = ref.current = { pid: null, alive: true, disconnected: false, acc: 0, lastSize: null, shared: 1, scale: 1, ownerIsMe: true, attachmentId: crypto.randomUUID(), generation: api.generation, plan: null, comp: { sx: 1, sy: 1 }, shift: { x: 0, y: 0 }, dprMul: 1, movedAt: 0 };
    const current = (generation = st.generation, attachmentId = st.attachmentId) => st.alive && !st.disconnected && generation === st.generation && generation === api.generation && attachmentId === st.attachmentId && api.status === 'open';
    const early = []; // 응답보다 먼저 온 프레임·종료는 controllerPid를 안 뒤에 가린다
    // P42: 셸은 앱이 스스로 스크롤하지 않아(PowerShell은 SGR 휠을 무시) 지난 출력을 xterm scrollback에 두고 판 안에서 스크롤한다
    const shell = (getState().sessions.get(sessionId) || {}).kind === 'shell';
    const term = new Terminal({ allowProposedApi: true, fontFamily: TERM_FONT, fontSize: termFontSize(TERM_FONT_SIZE, fontScale ?? getState().termScale, fontScale != null ? clampPhoneScale : clampScale), lineHeight: TERM_LINE_HEIGHT, fontWeight: 500, fontWeightBold: 700, scrollback: shell ? SHELL_SCROLLBACK : 0, cursorBlink: false, theme: termTheme(), drawBoldTextInBrightColors: false });
    const u11 = new Unicode11Addon();
    term.options.disableStdin = true;
    term.loadAddon(u11);
    term.unicode.activeVersion = '11';
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    terms.set(sessionId, term);
    term._mtInputTarget = () => current() && st.pid != null && !term.options.disableStdin ? { controllerPid: st.pid, attachmentId: st.attachmentId } : null;
    // P65: 터미널 요소의 변환 = 장치 픽셀 경계 맞춤 이동 + 크기(P47 비율, 선명하게 그릴 때는 캔버스 1픽셀 = 화면 장치 픽셀 1개가 되는 값)
    st.layout = () => {
      const el = term.element;
      if (!el) return;
      const c = st.plan ? st.comp : { sx: st.scale, sy: st.scale };
      const { sx, sy } = c, { x, y } = st.shift;
      const tf = `${x || y ? `translate(${+x.toFixed(4)}px, ${+y.toFixed(4)}px) ` : ''}${sx !== 1 || sy !== 1 ? `scale(${+sx.toFixed(6)}, ${+sy.toFixed(6)})` : ''}`.trim();
      if (el.style.transform === tf) return;
      el.style.transformOrigin = '0 0';
      el.style.transform = tf;
    };
    // 배율 1 때의 터미널 CSS 크기(P65로 다시 그려도 노드 안에서 차지하는 크기는 이것)
    st.baseSize = () => {
      const screen = term.element && term.element.querySelector('.xterm-screen');
      if (st.plan) return { w: cssCanvas(term.cols, st.plan.base.w, st.planDpr), h: cssCanvas(term.rows, st.plan.base.h, st.planDpr) };
      return screen ? { w: screen.offsetWidth, h: screen.offsetHeight } : null;
    };
    // P47: 다른 창이 정한 패널 크기를 내 노드에 맞춰 비율로 그린다. 혼자 볼 때와 내가 크기를 가졌을 때는 늘 1(예전과 같다)
    st.applyScale = () => {
      const b = st.baseSize();
      if (!b) return;
      const s = st.shared > 1 && !st.ownerIsMe ? fitScale({ termW: b.w, termH: b.h, boxW: host.clientWidth, boxH: host.clientHeight }) : 1;
      if (s === st.scale) return;
      st.scale = s;
      st.layout();
      host.dataset.scale = String(+s.toFixed(3));
      if (st.sharpen) st.sharpen(); // P65: 비율이 바뀌면 선명하게 그릴 크기도 다시
    };
    // P47: 터미널에 초점을 주면 이 창이 패널 크기를 가져간다
    const onFocusIn = () => { if (st.pid != null && current()) api.call('terminal.focus', { session: sessionId, controllerPid: st.pid, attachmentId: st.attachmentId }).catch(() => {}); };
    if (term.textarea) term.textarea.addEventListener('focus', onFocusIn);
    fixMouseScale(term, sessionId);

    let renderer = webgl === false ? 'dom' : budget.acquire(sessionId);
    st.renderer = renderer;
    perfLog('term_mount', { sessionId, renderer, used: budget.used });
    if (renderer === 'webgl') {
      try {
        const gl = new WebglAddon();
        gl.onContextLoss(() => {
          perfLog('webgl_context_loss', { sessionId, alive: st.alive });
          // 컨텍스트를 잃은 터미널은 DOM으로 그린다. 정리 중 오류가 나도 그 터미널 안에서 끝낸다(E5 2.5)
          try { gl.dispose(); } catch (e) { perfLog('webgl_dispose_error', { sessionId, message: e.message }); window.mt.log(`webgl dispose error ${sessionId}: ${e.stack || e.message}`); }
          budget.release(sessionId, { contextLost: true });
          st.renderer = 'dom'; if (st.unsharp) st.unsharp('context-loss'); // P65: DOM 렌더러는 배율 1 값으로
          setTerminal(sessionId, { renderer: 'dom', contextLost: true });
          window.mt.log(`webgl context lost ${sessionId}`);
        });
        term.loadAddon(gl);
        // P65: WebGL은 캔버스의 device-pixel-content-box(CSS 크기 × 실제 DPR)를 보고 캔버스 픽셀 수를 되돌린다.
        // 선명하게 그리는 동안(xterm이 보는 DPR ≠ 실제 DPR)은 렌더러가 잰 장치 크기를 쓴다(addon-webgl 0.19 내부 _renderer)
        const r = gl._renderer;
        if (r && typeof r._setCanvasDevicePixelDimensions === 'function') {
          const setPx = r._setCanvasDevicePixelDimensions.bind(r);
          r._setCanvasDevicePixelDimensions = (w, h) => {
            const dc = st.dprMul !== 1 && r.dimensions && r.dimensions.device.canvas;
            return dc && dc.width > 0 && dc.height > 0 ? setPx(dc.width, dc.height) : setPx(w, h);
          };
        } else window.mt.log(`webgl canvas sizing hook not found ${sessionId}: sharp rendering off`);
        st.glHooked = !!(r && r._setCanvasDevicePixelDimensions);
      } catch (e) { budget.release(sessionId); renderer = 'dom'; st.renderer = 'dom'; window.mt.log(`webgl failed ${sessionId}: ${e.message}`); }
    }

    // P65: 선명하게 그리기. xterm이 보는 DPR(coreBrowserService.dpr)을 터미널마다 바꿔 WebGL 캔버스를 화면 장치 픽셀에 맞춘 해상도로 그린다.
    // xterm 6.0.0·addon-webgl 0.19의 내부(_core._coreBrowserService, _charSizeService, _onDprChange)라 판 올릴 때 확인한다. 없으면 예전처럼 그린다
    const core = term._core, cbs = core && core._coreBrowserService, chars = core && core._charSizeService;
    const sharpOk = !!(cbs && cbs._onDprChange && typeof cbs._onDprChange.fire === 'function' && chars && 'dpr' in cbs);
    if (sharpOk) Object.defineProperty(cbs, 'dpr', { configurable: true, get: () => cbs.window.devicePixelRatio * st.dprMul });
    else window.mt.log(`xterm dpr service not found ${sessionId}: terminal text is not re-rendered for board zoom`);
    const setPlan = (plan, dpr) => {
      const prev = st.plan;
      st.plan = plan; st.planDpr = dpr;
      const mul = plan ? plan.E / dpr : 1;
      const lh = plan ? plan.lineHeight : TERM_LINE_HEIGHT;
      const t0 = performance.now();
      if (term.options.lineHeight !== lh) term.options.lineHeight = lh;
      if (mul !== st.dprMul) { st.dprMul = mul; cbs._onDprChange.fire(cbs.dpr); }
      host.dataset.sharp = plan ? `${plan.Tw}x${plan.Th}@${+plan.E.toFixed(3)}${plan.capped ? ' capped' : ''}${plan.fillX ? ' fillX' : ''}${plan.fillY ? ' fillY' : ''}` : ''; // 시험이 읽는다
      if (!samePlan(prev, plan)) perfLog('term_sharp', { sessionId, E: plan ? +plan.E.toFixed(4) : null, k: plan ? +plan.k.toFixed(4) : null, cell: plan ? `${plan.Tw}x${plan.Th}` : null, ms: +(performance.now() - t0).toFixed(1) });
    };
    st.unsharp = (why) => {
      if (!sharpOk || !st.plan) return;
      setPlan(null, window.devicePixelRatio);
      st.shift = { x: 0, y: 0 };
      st.layout();
      perfLog('term_sharp_off', { sessionId, why });
    };
    st.sharpen = () => {
      if (!st.alive || !sharpOk || !st.glHooked || st.renderer !== 'webgl') return;
      const screen = term.element && term.element.querySelector('.xterm-screen');
      if (!screen || !host.offsetWidth) return;
      const hs = getComputedStyle(host);
      const hw = parseFloat(hs.width), hh = parseFloat(hs.height);
      const kAnc = host.getBoundingClientRect().width / hw; // 판 배율 × 웹 화면 배율(조상의 변환)
      const zc = parseFloat(getComputedStyle(document.documentElement).zoom) || 1; // P49 웹 화면 배율(Electron은 1)
      const dpr = window.devicePixelRatio;
      if (!(kAnc > 0 && dpr > 0 && hw > 0 && hh > 0)) return;
      // 1:1로 그린 터미널이 들어갈 자리. 셸은 스크롤 막대(FitAddon과 같은 14px) 앞까지, 그 밖은 노드 오른쪽 여백(.mt-term right 12px) 안으로 8px까지
      const room = term.options.scrollback === 0 ? hw + 8 : hw - 14;
      const plan = sharpPlan({ cw: chars.width, ch: chars.height, dpr, lineHeight: TERM_LINE_HEIGHT, k: kAnc * st.scale, cols: term.cols, rows: term.rows, fitW: room / st.scale, fitH: hh / st.scale, ...(termPlan.maxPx ? { maxPx: termPlan.maxPx } : {}) }); // P84: 웹은 캔버스 픽셀 상한이 낮다
      if (!plan) return;
      const sizeKey = `${term.cols}x${term.rows}`;
      if (!samePlan(plan, st.plan) || dpr !== st.planDpr || sizeKey !== st.planSize) { st.planSize = sizeKey; setPlan(plan, dpr); }
      st.comp = compensate(plan, { cols: term.cols, rows: term.rows, dpr, kAnc, s47: st.scale, zc });
      // 캔버스의 화면 자리를 장치 픽셀 경계에 맞춘다. 지금 이동을 뺀 자리로 재서 이동이 쌓이지 않게 한다(실험 p65: 판 배율 1에서도 분수 DPR이면 반 픽셀 번진다)
      st.layout();
      const r = screen.getBoundingClientRect();
      const x0 = r.left - st.shift.x * kAnc, y0 = r.top - st.shift.y * kAnc;
      // Blink는 노드(변환이 걸린 가장 가까운 조상) 안의 레이아웃 자리를 장치 픽셀로 반올림해 그린다. getBoundingClientRect는 반올림 전 자리라 그만큼 고쳐 잰다
      const wr = (host.closest('.react-flow__node') || host).getBoundingClientRect(), g = { kAnc, dpr, zc };
      const shift = { x: phaseShift(paintedAt(x0, wr.left, g), dpr) / kAnc, y: phaseShift(paintedAt(y0, wr.top, g), dpr) / kAnc };
      if (Math.abs(shift.x - st.shift.x) > 1e-4 || Math.abs(shift.y - st.shift.y) > 1e-4) { st.shift = shift; st.layout(); }
    };
    st.sharpSoon = (ms = SHARP_SETTLE_MS) => { clearTimeout(st.sharpTimer); st.sharpTimer = setTimeout(() => st.sharpen(), ms); };
    let lastTf = flow.getState().transform;
    const offFlow = flow.subscribe((s) => { if (s.transform !== lastTf) { lastTf = s.transform; st.movedAt = performance.now(); st.sharpSoon(); } });
    st.sharpCheck = setInterval(() => { if (performance.now() - st.movedAt > 2 * SHARP_SETTLE_MS) st.sharpen(); }, SHARP_CHECK_MS);
    const offResize = term.onResize(() => st.sharpSoon());
    const onWinResize = () => st.sharpSoon();
    window.addEventListener('resize', onWinResize);

    const send = (data) => {
      if (!data || !current()) return;
      if (!st.pid || api.status !== 'open' || term.options.disableStdin) { flash(t('terminal.attaching')); return; }
      markInput(sessionId);
      if (onInputRef.current) onInputRef.current();
      api.call('terminal.input', { session: sessionId, controllerPid: st.pid, attachmentId: st.attachmentId, data }).catch((e) => setHint(t('terminal.inputFail', { error: errText(e) })));
    };
    st.send = send;
    const flash = (t) => { setHint(t); clearTimeout(st.hintTimer); st.hintTimer = setTimeout(() => setHint(null), 2500); };

    // P42: 글 고르기(웹처럼). xterm 자체 선택 대신 문서 줄에 붙은 선택을 쓴다. 판(Canvas)과 시험이 보는 hasSelection·getSelection도 이것으로 답한다
    const sel = new TermSelection({
      term, host, mode: shell ? 'buffer' : 'live',
      sendWheel: (steps, c) => send(sgrWheel(steps, c.cell + 1, c.row + 1, term.cols, term.rows)),
      onActivate: () => { if (onActivateRef.current) onActivateRef.current(); },
      log: (name, d) => perfLog(name, { sessionId, ...d }),
    });
    st.sel = sel;
    term._mtSel = sel; // 시험이 선택 기록(trace)을 읽는다
    term.hasSelection = () => sel.has();
    term.getSelection = () => sel.text();
    term.onData((d) => { if (clearsSelection('input', { hasSelection: sel.has() })) sel.clear('input'); send(d); });
    term.attachCustomKeyEventHandler((e) => {
      const a = keyAction(e, sel.has());
      if (a === 'block-ctrl-g') { e.preventDefault(); flash(t('terminal.ctrlG')); return false; }
      if (a === 'paste') return false; // 브라우저 붙여넣기 이벤트로 넘긴다(아래에서 감싼다)
      if (a === 'clear-selection') { e.preventDefault(); sel.clear('escape'); return false; } // P42: Esc는 선택만 끝낸다
      if (a === 'copy') {
        // P42: 화면 밖으로 나간 부분까지 고른 글 전체. 일하는 중에도 프레임이 선택을 지우지 않는다
        const text = copyText(sel.text());
        navigator.clipboard.writeText(text).then(() => perfLog('term_copy', { sessionId, chars: text.length }), (err) => { window.mt.log(`clipboard write failed ${sessionId}: ${err && err.message}`); flash(t('termSelect.copyFail')); });
        if (clearsSelection('copy', { hasSelection: sel.has() })) sel.clear('copy');
        e.preventDefault(); flash(t('terminal.copied')); return false;
      }
      return true;
    });
    term.attachCustomWheelEventHandler((ev) => {
      if (shell) return false; // 셸은 아래 onShellWheel이 먼저 받는다
      const screen = host.querySelector('.xterm-screen') || host;
      const r = wheelToSgr({ deltaY: ev.deltaY, deltaMode: ev.deltaMode, clientX: ev.clientX, clientY: ev.clientY, rect: screen.getBoundingClientRect(), cols: term.cols, rows: term.rows, acc: st.acc });
      st.acc = r.acc;
      send(r.seq); // P42: 선택은 지우지 않는다. 다음 프레임에서 글과 함께 움직인다(끄는 중이면 늘어난다)
      ev.preventDefault();
      return false;
    });
    // P42: 셸은 판 안 기록을 스크롤한다(선택은 버퍼 줄에 붙어 onScroll로 함께 움직인다).
    // P51(#7): xterm 6의 기록 스크롤(안쪽 스크롤 요소)은 한 칸에 약 2줄, 작은 값마다 한 줄이라, 캡처 단계에서 먼저 받아 모은 뒤 100px에 3줄로 굴린다.
    // 사용자 휠 처리기(attachCustomWheelEventHandler)는 안쪽 스크롤 요소보다 늦게 불려 막지 못한다
    const onShellWheel = (ev) => {
      if (!ev.deltaY) return;
      ev.preventDefault(); ev.stopPropagation();
      const r = shellWheelLines({ deltaY: ev.deltaY, deltaMode: ev.deltaMode, rows: term.rows, acc: st.acc });
      st.acc = r.acc;
      if (r.lines) term.scrollLines(r.lines);
    };
    if (shell) host.addEventListener('wheel', onShellWheel, { capture: true, passive: false });
    // 붙여넣기: xterm보다 먼저(캡처 단계) 받아 괄호 붙여넣기로 감싼다. 감싸지 않으면 줄마다 따로 제출된다(E4 2.5).
    // P48: 웹 화면은 붙여 넣거나 끌어 놓은 파일(그림 등)을 백엔드로 올리고 그 PC 경로를 넣는다
    const uploadInto = (files) => {
      flash(t('upload.uploading', { n: files.length }));
      const generation = st.generation, attachmentId = st.attachmentId;
      uploadFiles(files).then((paths) => { if (!current(generation, attachmentId)) return; send(wrapPaste(pathsText(paths))); flash(t('upload.done', { n: paths.length })); perfLog('term_upload', { sessionId, n: paths.length }); },
        (err) => { flash(t('upload.failed', { error: err.message })); window.mt.log(`upload failed ${sessionId}: ${err.message}`); });
    };
    const onPaste = (e) => {
      e.preventDefault(); e.stopPropagation();
      const files = isWeb ? filesOf(e.clipboardData) : [];
      if (clearsSelection('paste', { hasSelection: sel.has() })) sel.clear('paste');
      if (files.length) return uploadInto(files);
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      // P51(#3): 셸 노드는 줄바꿈을 Shift+Enter로 보내 여러 줄이 입력줄에 쌓이게 한다(지금 종류로 본다. 셸 안에서 띄운 에이전트로 바뀔 수 있다)
      send(wrapPaste(text, { shell: (getState().sessions.get(sessionId) || {}).kind === 'shell', platform: api.info?.platform || window.mt.platform }));
    };
    host.addEventListener('paste', onPaste, true);
    const onDragOver = (e) => { if (isWeb && hasFiles(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
    const onDrop = (e) => { const files = isWeb ? filesOf(e.dataTransfer) : []; if (!files.length) return; e.preventDefault(); e.stopPropagation(); uploadInto(files); };
    host.addEventListener('dragover', onDragOver, true);
    host.addEventListener('drop', onDrop, true);

    // P42: 셸은 그림자 터미널(herdr 화면과 같은 scrollback 0 화면)에 먼저 써서 새 출력으로 화면이 몇 줄 밀렸는지 보고,
    // 프레임을 쓰기 전에 그만큼 xterm 영역을 올려 밀려난 줄을 scrollback으로 보낸다. 첫 프레임 앞에는 herdr 기록(지난 출력)을 넣는다
    let shadow = null, chain = Promise.resolve(), history = 'wait';
    const writeP = (tm, data) => new Promise((res) => tm.write(data, res));
    const rowsOf = (tm) => { const b = tm.buffer.active, out = []; for (let r = 0; r < tm.rows; r++) { const l = b.getLine(b.viewportY + r); out.push(l ? l.translateToString(true) : ''); } return out; };
    if (shell) { shadow = new Terminal({ allowProposedApi: true, scrollback: 0, cols: 80, rows: 24 }); const su = new Unicode11Addon(); shadow.loadAddon(su); shadow.unicode.activeVersion = '11'; }
    // herdr 기록 가운데 지금 화면 위의 줄(ANSI). 맞는 자리가 없으면 null
    const readHistory = async (screen) => {
      const r = await Promise.race([api.call('terminal.history', { session: sessionId }).catch(() => null), new Promise((res) => setTimeout(() => res(null), HISTORY_WAIT))]);
      const ansi = r && r.text ? r.text.split(/\r?\n/) : [];
      const above = ansi.length ? historyAbove(ansi.map(stripAnsi), screen) : -1;
      return { lines: ansi.length, above, ansi: above >= 0 ? ansi.slice(0, above) : null };
    };
    const prefill = async (screen) => {
      const generation = st.generation, attachmentId = st.attachmentId;
      const h = await readHistory(screen);
      if (!current(generation, attachmentId)) return;
      step('hist', { lines: h.lines, above: h.above });
      perfLog('term_history', { sessionId, lines: h.lines, above: h.above });
      if (h.above > 0 && current()) term.write(historyPrefill(h.ansi, term.rows));
    };
    // 빠른 출력이 한 프레임에 지나가거나(화면에 한 번도 안 보인 줄), cls·크기 바뀜으로 판 안 기록이 herdr 기록과 어긋났다.
    // 출력이 멈추면(그리고 고르는 중이나 위로 올려 보는 중이 아니면) herdr 기록으로 다시 맞춘다: 지금 화면을 칸 그대로 적어 두고 reset 뒤 기록 + 화면
    const resync = async () => {
      if (!current()) return;
      st.stale = false;
      const generation = st.generation, attachmentId = st.attachmentId;
      const h = await readHistory(rowsOf(shadow));
      if (!current(generation, attachmentId) || !h.ansi) { perfLog('term_history_resync', { sessionId, lines: h.lines, above: h.above, skipped: true }); return; }
      const b = term.buffer.active;
      if (sel.has() || sel.dragging || b.viewportY < b.baseY) { markStale(); return; }
      const screen = serializeScreen(b, { base: b.baseY, rows: term.rows, cols: term.cols, cursorX: b.cursorX, cursorY: b.cursorY, cell: b.getNullCell() });
      term.reset();
      term.write(historyPrefill(h.ansi, term.rows) + screen);
      perfLog('term_history_resync', { sessionId, lines: h.lines, above: h.above });
    };
    const trySync = () => {
      if (!current() || !st.stale) return;
      const b = term.buffer.active;
      if (sel.has() || sel.dragging || b.viewportY < b.baseY) { clearTimeout(st.syncTimer); st.syncTimer = setTimeout(trySync, 1000); return; }
      chain = chain.then(resync).catch((e) => window.mt.log(`shell resync ${sessionId}: ${e.stack || e.message}`));
    };
    const markStale = () => { st.stale = true; clearTimeout(st.syncTimer); st.syncTimer = setTimeout(trySync, 500); };
    const shellFrame = async (f, bytes, t0) => {
      const valid = () => current() && f.attachmentId === st.attachmentId && f.controllerPid === st.pid && !term.options.disableStdin;
      if (!valid()) return;
      const first = !st.wrote; st.wrote = true;
      let resized = false;
      if (f.width && f.height && (f.width !== shadow.cols || f.height !== shadow.rows)) { const d = capDims({ cols: f.width, rows: f.height }, isWeb); shadow.resize(d.cols, d.rows); resized = true; }
      const before = resized ? null : rowsOf(shadow);
      await writeP(shadow, bytes);
      if (!valid()) return;
      const after = rowsOf(shadow);
      if (f.width && f.height && (f.width !== term.cols || f.height !== term.rows)) { const d = capDims({ cols: f.width, rows: f.height }, isWeb); term.resize(d.cols, d.rows); st.applyScale(); }
      if (history === 'wait') { history = 'done'; await prefill(after); if (!valid()) return; }
      else if (!before) markStale();
      else {
        const s = findShift(before, after);
        // 영역을 올려 밀려난 줄을 scrollback으로 보낸 뒤, 화면은 그림자(herdr의 새 화면)를 칸 그대로 다시 쓴다.
        // herdr 프레임은 herdr 앞 화면에서 바뀐 칸만 쓰므로, 올린 화면에 그대로 쓰면 글이 깨진다. 그 뒤 프레임을 써도 같은 칸을 같은 글로 쓸 뿐이다
        if (s.d > 0) { const sb = shadow.buffer.active; term.write(scrollUpSeq(s.d, s.hi, term.rows) + serializeScreen(sb, { base: sb.baseY, rows: shadow.rows, cols: shadow.cols, cursorX: sb.cursorX, cursorY: sb.cursorY, cell: sb.getNullCell() })); }
        else if (bigChange(before, after)) markStale();
      }
      term.write(bytes, () => { onWritten(t0); if (first) requestAnimationFrame(() => step('fw1', { cells: cellsOf(term), dom: document.getElementsByTagName('*').length, sb: term.buffer.active.length })); }); // P86: 쓰고 그린 뒤(sb: 기록 줄 수)
      if (st.stale) { clearTimeout(st.syncTimer); st.syncTimer = setTimeout(trySync, 500); } // 출력이 이어지는 동안은 미룬다
    };

    const frame = (f) => {
      if (f.sessionId !== sessionId || !current() || f.attachmentId !== st.attachmentId) return;
      if (st.pid === null) { if (early.length < 32) early.push(['frame', f]); return; }
      if (f.controllerPid !== st.pid || term.options.disableStdin) return;
      let bytes = frameBytes(f.bytes);
      if (st.again && f.full) { st.again = false; bytes = joinBytes(REDRAW_PREFIX, bytes); }
      const t0 = onFrame(sessionId, bytes.length, f.width, f.height);
      if (shell) { chain = chain.then(() => shellFrame(f, bytes, t0)).catch((e) => window.mt.log(`shell frame ${sessionId}: ${e.stack || e.message}`)); return; }
      if (f.width && f.height && (f.width !== term.cols || f.height !== term.rows)) { const d = capDims({ cols: f.width, rows: f.height }, isWeb); term.resize(d.cols, d.rows); st.applyScale(); } // 쓰기 전에 크기 맞추기(E4). P86: 웹은 상한
      const first = !st.wrote; st.wrote = true;
      if (first || bytes.length >= 16000) step('fw0', { b: bytes.length, c: f.width || term.cols, r: f.height || term.rows }); // P86: 첫 프레임(과 큰 프레임) 쓰기 전
      term.write(bytes, () => {
        onWritten(t0);
        if (current() && f.attachmentId === st.attachmentId) sel.onFrame();
        if (first && current()) requestAnimationFrame(() => st.alive && step('fw1', { cells: cellsOf(term), dom: document.getElementsByTagName('*').length })); // P42: 고른 글이 있으면 화면이 움직인 만큼 선택을 옮긴다(지우지 않는다)
      });
    };
    const offFrame = api.on('terminal.frame', frame);
    // 백엔드에 다시 붙으면(백엔드 재시작, C2) 옛 연결의 제어기는 이미 놓였다. 다시 붙는다.
    const offClose = api.on('$close', () => {
      if (!st.alive) return;
      restoreFocus.current ||= document.activeElement === term.textarea;
      st.disconnected = true;
      early.length = 0;
      term.options.disableStdin = true;
      if (!isWeb) setStatus({ kind: 'detached', reason: 'disconnected' });
    });
    const offOpen = api.on('$open', () => {
      if (!st.alive) return;
      if (isWeb) {
        st.generation = api.generation; st.attachmentId = crypto.randomUUID();
        st.disconnected = false; st.pid = null; st.again = true; st.wrote = false;
        early.length = 0;
        attach(true);
        return;
      }
      restoreFocus.current ||= document.activeElement === term.textarea;
      perfLog('term_reattach_on_reconnect', { sessionId }); setStatus({ kind: 'attaching' }); setRetry((x) => x + 1);
    });
    // P47: 누가 패널 크기를 정하는지, 몇 창이 함께 보는지. 다른 기기가 방금 친 것
    const offOwner = api.on('terminal.owner', (d) => {
      if (d.sessionId !== sessionId || !current() || d.attachmentId !== st.attachmentId || (st.pid !== null && d.controllerPid !== st.pid)) return;
      st.shared = d.shared || 1; st.ownerIsMe = !!d.ownerIsMe;
      setShare({ shared: st.shared, ownerIsMe: !!d.ownerIsMe, ownerName: d.ownerName || d.owner || null });
      perfLog('term_owner', { sessionId, shared: st.shared, ownerIsMe: !!d.ownerIsMe, cols: d.cols, rows: d.rows });
      requestAnimationFrame(() => st.alive && st.applyScale());
    });
    const offInputBy = api.on('terminal.input_by', (d) => {
      if (d.sessionId !== sessionId || !current() || d.attachmentId !== st.attachmentId || d.controllerPid !== st.pid) return;
      const name = inputByLabel(d, api.clientId);
      if (!name) return;
      setTyping(name); clearTimeout(st.typingTimer); st.typingTimer = setTimeout(() => setTyping(null), 2000);
    });
    const detached = (d) => {
      if (d.sessionId !== sessionId || !current() || d.attachmentId !== st.attachmentId) return;
      if (st.pid === null) { if (early.length < 32) early.push(['detached', d]); return; }
      if (d.controllerPid !== st.pid) return;
      perfLog('term_detached', { sessionId, reason: d.reason });
      restoreFocus.current ||= document.activeElement === term.textarea;
      term.options.disableStdin = true;
      setStatus({ kind: 'detached', reason: d.reason });
    };
    const offDetached = api.on('terminal.detached', detached);

    // P65: 선명하게 다시 그린 동안에도 배율 1 칸으로 잰다(배율이 패널 줄·칸 수를 바꾸지 않게)
    st.propose = () => {
      if (!st.plan || !term.element || !term.element.parentElement) return fit.proposeDimensions();
      const ps = getComputedStyle(term.element.parentElement), es = getComputedStyle(term.element);
      const px = (v) => parseInt(v, 10) || 0;
      const bar = term.options.scrollback === 0 ? 0 : (term.options.overviewRuler && term.options.overviewRuler.width) || 14; // FitAddon과 같은 값
      return fitDims({ freeW: Math.max(0, px(ps.width)) - px(es.paddingLeft) - px(es.paddingRight) - bar, freeH: px(ps.height) - px(es.paddingTop) - px(es.paddingBottom), cellW: st.plan.base.w / st.planDpr, cellH: st.plan.base.h / st.planDpr });
    };
    const dims = capDims(fit.proposeDimensions() || { cols: 100, rows: 30 }, isWeb); // P86: 웹은 칸·줄 상한
    const cols = Math.max(20, dims.cols), rows = Math.max(8, dims.rows);
    term.resize(cols, rows);
    step('term', { c: cols, r: rows, ...charOf(term), z: flow.getState().transform[2], dom: renderer === 'dom' ? 1 : 0, fs: term.options.fontSize }); // P86: 터미널 붙기
    st.lastSize = `${cols}x${rows}`;
    setTerminal(sessionId, { renderer, cols, rows });
    const attach = (again = false) => {
      const generation = st.generation, attachmentId = st.attachmentId;
      const [c, r0] = st.lastSize.split('x').map(Number);
      return api.call('terminal.attach', { session: sessionId, cols: c, rows: r0, attachmentId })
        .then((r) => {
          if (!current(generation, attachmentId)) {
            if (generation === api.generation && api.status === 'open') api.call('terminal.detach', { session: sessionId, controllerPid: r.controllerPid, attachmentId }).catch(() => {});
            return;
          }
          st.pid = r.controllerPid; term.options.disableStdin = false;
          setHint(null);
          st.shared = r.shared || 1; st.ownerIsMe = r.ownerIsMe !== false;
          setShare({ shared: st.shared, ownerIsMe: st.ownerIsMe, ownerName: r.owner || null });
          requestAnimationFrame(() => st.alive && st.applyScale());
          setStatus({ kind: 'attached', pid: r.controllerPid });
          for (const [type, event] of early.splice(0)) (type === 'frame' ? frame : detached)(event);
          if (term.options.disableStdin) return;
          if (again) {
            // 같은 textarea가 계속 초점이면 DOM focus 이벤트는 다시 오지 않는다. 새 attachment로 크기 소유권만 알린다.
            if (document.activeElement === term.textarea) onFocusIn();
            restoreFocus.current = false;
            return;
          }
          const state = getState(), active = document.activeElement;
          const canFocus = !state.dialog && !state.searchOpen && (!state.focusId || state.focusId === sessionId) && (active === document.body || active === term.textarea);
          if (restoreFocus.current) { restoreFocus.current = false; if (canFocus) term.focus(); }
          if (canFocus && pendingFor(sessionId)) { const buf = takePendingInput(sessionId); if (buf) { perfLog('pending_input', { sessionId, chars: buf.length }); send(buf); } term.focus(); }
        })
        .catch((e) => { if (current(generation, attachmentId)) setStatus({ kind: 'error', reason: e.message }); });
    };
    st.attach = attach;
    attach();
    st.term = term; st.fit = fit;

    return () => {
      st.alive = false;
      perfLog('term_unmount', { sessionId });
      offFrame(); offDetached(); offOpen(); offClose(); offOwner(); offInputBy();
      clearTimeout(st.hintTimer);
      offFlow(); offResize.dispose(); window.removeEventListener('resize', onWinResize); clearTimeout(st.sharpTimer); clearInterval(st.sharpCheck);
      if (term.textarea) term.textarea.removeEventListener('focus', onFocusIn);
      clearTimeout(st.typingTimer);
      host.removeEventListener('paste', onPaste, true);
      host.removeEventListener('dragover', onDragOver, true);
      host.removeEventListener('drop', onDrop, true);
      host.removeEventListener('wheel', onShellWheel, { capture: true });
      sel.dispose();
      clearTimeout(st.syncTimer);
      if (shadow) shadow.dispose();
      if (st.pid != null && !st.disconnected && st.generation === api.generation) api.call('terminal.detach', { session: sessionId, controllerPid: st.pid, attachmentId: st.attachmentId }).catch(() => {});
      budget.release(sessionId);
      terms.delete(sessionId);
      setTerminal(sessionId, null);
      term.dispose();
    };
  }, [sessionId, retry]);

  // P45: 터미널 글자 배율이 바뀌면 글자 크기를 바꾼다(아래 효과가 줄·칸 수를 다시 잰다)
  const storeScale = useStore((st) => st.termScale);
  const termScale = fontScale ?? storeScale; // P74
  useEffect(() => {
    const st = ref.current;
    if (!st.term) return;
    const size = termFontSize(TERM_FONT_SIZE, termScale, fontScale != null ? clampPhoneScale : clampScale);
    if (st.term.options.fontSize !== size) { st.term.options.fontSize = size; perfLog('term_font', { sessionId, size }); if (st.sharpSoon) st.sharpSoon(0); } // P65: 글자 크기가 바뀌면 칸도 다시
  }, [sessionId, termScale, retry]);

  // 노드 크기가 바뀌면 패널 크기를 맞춘다(노드 크기 = 패널 크기, ARCH 7.2). 돌아온 프레임의 w·h로 xterm 크기가 바뀐다.
  useEffect(() => {
    const st = ref.current;
    if (!st.fit) return;
    const refit = () => {
      if (!st.fit || st.pid == null || st.disconnected || !st.alive || api.status !== 'open') return;
      if (st.applyScale) st.applyScale(); // P47: 노드 크기가 바뀌면 비율도 다시
      const d0 = st.propose ? st.propose() : st.fit.proposeDimensions(); // P65: 배율 1 칸으로 잰다
      if (!d0) return;
      const d = capDims(d0, isWeb); // P86: 웹은 칸·줄 상한
      const cols = Math.max(20, d.cols), rows = Math.max(8, d.rows);
      const key = `${cols}x${rows}`;
      if (key === st.lastSize) return;
      st.lastSize = key;
      setTerminal(sessionId, { cols, rows });
      api.call('terminal.resize', { session: sessionId, controllerPid: st.pid, attachmentId: st.attachmentId, cols, rows }).catch(() => {});
    };
    // P17: 덩어리 분할선·바깥 크기로 여러 노드 크기가 한꺼번에 바뀌면 120ms 때 아직 자리가 덜 잡혀 한 줄 모자라게 잴 때가 있다. 한 번 더 잰다
    const t = setTimeout(refit, 120), t2 = setTimeout(refit, 600);
    // P47: 노드 크기 말고 터미널 칸의 크기가 바뀌어도(휴대폰 키 패드, 웹 화면의 다른 배치) 다시 잰다. 같은 크기면 refit이 아무것도 하지 않는다
    let t3 = null;
    const host = hostRef.current;
    const ro = host && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { clearTimeout(t3); t3 = setTimeout(refit, 120); }) : null;
    if (ro) ro.observe(host);
    return () => { clearTimeout(t); clearTimeout(t2); clearTimeout(t3); if (ro) ro.disconnect(); };
  }, [sessionId, width, height, termScale, retry]);

  useEffect(() => {
    const st = ref.current;
    if (!focusTick || !st.term) return;
    // 붙기 전에는 초점을 주지 않는다(그동안 친 키는 창이 모은다). 붙은 터미널이면 모아 둔 글을 지금 넣는다
    if (!st.pid || st.disconnected || st.term.options.disableStdin) return;
    if (pendingFor(sessionId)) { const buf = takePendingInput(sessionId); if (buf) { perfLog('pending_input', { sessionId, chars: buf.length, attached: true }); st.send(buf); } }
    st.term.focus();
  }, [focusTick, sessionId]);

  // herdr가 다시 뜨거나(C3) 백엔드가 다시 붙어 제어기가 끝났으면, 세션이 다시 살아난 뒤 저절로 다시 붙는다.
  // 다른 클라이언트가 이 패널을 가져간 경우(takeover)는 서로 빼앗지 않게 저절로 붙지 않는다. 같은 끊김에 다섯 번까지.
  const herdrUp = useStore((st) => st.herdr.connected);
  const sstate = useStore((st) => (st.sessions.get(sessionId) || {}).state);
  const autoTries = useRef(0);
  useEffect(() => {
    if (status.kind === 'attached') { autoTries.current = 0; return; }
    if (status.kind !== 'detached' && status.kind !== 'error') return;
    if (status.reason === 'takeover' || api.status !== 'open' || !herdrUp || !sstate || sstate === 'exited' || sstate === 'starting' || autoTries.current >= 5) return;
    const t = setTimeout(() => { autoTries.current++; perfLog('term_auto_reattach', { sessionId, reason: status.reason, state: sstate }); setStatus({ kind: 'attaching' }); setRetry((x) => x + 1); }, 800);
    return () => clearTimeout(t);
  }, [status.kind, status.reason, herdrUp, sstate, sessionId]);

  return (
    <div className="mt-term-wrap nodrag nowheel nopan" onMouseDown={() => onActivate && onActivate()}>
      <div className="mt-term" ref={hostRef} data-session={sessionId} />
      {status.kind === 'attaching' && <div className="mt-term-note">{t('terminal.attaching')}</div>}
      {(status.kind === 'detached' || status.kind === 'error') && (
        <div className="mt-term-cover">
          <div>{t('terminal.detached', { reason: status.reason })}</div>
          <button className="mt-btn" onClick={() => { autoTries.current = 0; setStatus({ kind: 'attaching' }); setRetry((x) => x + 1); }} data-action="term-reattach">{t('terminal.reattach')}</button>
        </div>
      )}
      {hint && <div className="mt-term-hint">{hint}</div>}
      {typing && <div className="mt-term-typing" data-role="term-typing">{t('peers.typing', { name: typing })}</div>}
      {share.shared > 1 && !share.ownerIsMe && <div className="mt-term-sizeby" data-role="term-sizeby" title={t('peers.sizeBy', { name: share.ownerName || '?' })} />}
    </div>
  );
}

// P84: 죽기 전 기록(crash-watch.js)이 재는 터미널 메모리. 붙은 터미널 수, 터미널 캔버스 장치 픽셀 합, 글자 아틀라스 장치 픽셀 합(WebGL 렌더러가 쥔 캔버스), WebGL 수.
// 아틀라스는 xterm 6.0.0·addon-webgl 0.19의 내부(_renderService._renderer._charAtlas.pages)라 없으면 0으로 센다
export function termStats() {
  let px = 0, atlas = 0;
  const seen = new Set();
  for (const tm of terms.values()) {
    for (const c of tm.element ? tm.element.querySelectorAll('canvas') : []) px += c.width * c.height;
    try {
      let r = tm._core && tm._core._renderService && tm._core._renderService._renderer; r = r && (r.value || r);
      for (const pg of (r && r._charAtlas && r._charAtlas.pages) || []) if (pg.canvas && !seen.has(pg.canvas)) { seen.add(pg.canvas); atlas += pg.canvas.width * pg.canvas.height; }
    } catch {}
  }
  return { terms: terms.size, px, atlas, gl: budget.used };
}
