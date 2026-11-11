// P6b 남은 기능(ARCH 4절 I1~I7)을 백엔드에 붙인다: 출력 보기, Thread, 메모 노드, 칸반 노드, 루프, 미션 맵, 설정.
// backend.mjs에는 이 파일을 부르는 몇 줄만 둔다(attachFeatures, 요약에 덧붙이는 값, 핸들러, 내부 알림 bus). 기능마다 모듈은 따로다.
// 백엔드가 이 파일에 알리는 것(b.bus): 'session'(요약을 보낼 때마다), 'closed'(세션이 판에서 빠짐), 'screenAnswer'(hook이 없는 세션의 턴 끝 화면 답)
import fs from 'node:fs';
import { deriveState } from './state.mjs';
import { readMessages, readCodexMessages } from './transcript.mjs';
import { transcriptPathFor } from './launch.mjs';
import { clip } from './text.mjs';
import { Outputs, isLongAnswer, turnsFromMessages } from './outputs.mjs';
import { ThreadLog } from './thread.mjs';
import { Memos } from './memos.mjs';
import { Kanbans } from './kanban.mjs';
import { LoopEngine, normalizeTrigger, normalizeStop, describeLoop, describeLoopMsg } from './loops.mjs';
import { confirmResult, keyed } from './msg.mjs'; // P16: 화면 글 열쇠
import { missionGraph } from './mission.mjs';
import { Settings } from './settings.mjs';
import { Launchers, HARNESSES } from './launchers.mjs'; // P33: 호출자
import { CodexModels } from './codex-models.mjs'; // P72: Codex 모델 목록
import { placeItem } from './canvas-ops.mjs';

const SHELL = 'shell';
function apiError(code, message) { return Object.assign(new Error(message), { code }); }

export function attachFeatures(b, { timers = true } = {}) {
  const store = b.store;
  const broadcast = (ev, data) => b.api && b.api.broadcast(ev, data);
  const wsName = (key) => { if (!key) return null; const w = b.workspaceList().find((x) => x.key === key); return w ? w.name : null; };
  const transcriptOf = (s) => {
    if (b.hooked(s)) return s.rt.transcriptPath || transcriptPathFor(b.cfg.claudeProjects, s.cwd, s.rt.claudeSessionId || s.sessionId);
    // 판이 띄우지 않은 Claude Code(셸에서 띄움, 판에 올림)는 herdr가 아는 대화 ID로 대화 기록을 찾아 본다
    const id = s.rt.herdr && s.rt.herdr.agentSessionId;
    const f = s.kind === 'claude' && id ? transcriptPathFor(b.cfg.claudeProjects, s.rt.cwd || s.cwd, id) : null;
    return f && fs.existsSync(f) ? f : null;
  };
  const deliveryOf = (id) => { const d = b.queue.items.get(id) || store.getDelivery(id); return d ? { status: d.status, reason: d.reason } : null; };
  const occupied = () => [
    ...store.nodes().map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
    ...store.memos(), ...store.kanbans(),
  ];
  // P6c: 새 메모·칸반의 자리는 단일 캔버스 빈자리(워크스페이스 영역 안이나 바로 옆, 소속이 없으면 어느 영역과도 겹치지 않는 곳)
  const place = (size, wsKey, near) => placeItem(b, { wsKey, size, near });

  const f = {};
  f.settings = new Settings({ store, broadcast });
  // P72: Codex 모델 목록은 Codex의 캐시 파일을 읽는다(설정 탭의 모델 고르기와 atrium models). 폴더를 주지 않은 판(시험)은 고정 목록
  f.codexModels = b.cfg.codexHome ? new CodexModels({ home: b.cfg.codexHome, fallback: HARNESSES.codex.models }) : null;
  f.launchers = new Launchers({ store, broadcast, gateway: { healthUrl: b.cfg.ocxHealthUrl, baseUrl: b.cfg.ocxBaseUrl }, codexModels: f.codexModels }); // 처음 켤 때 옛 새 세션 기본값을 옮긴다
  if (f.launchers.migrated) b.log(`launchers created (${f.launchers.migrated.oldBoard ? 'from old settings' : 'new board'}): favorites ${f.launchers.migrated.favorites.join(',')}`);
  f.outputs = new Outputs({ cfg: b.cfg, store, resolve: (r) => b.resolve(r), hooked: (s) => b.hooked(s), transcriptOf, readMessages, workspaceName: wsName, apiError });
  // Native history is fetched only for explicit output.get/output.save calls.
  const outputAction = async (action, p) => {
    const s = b.resolve(p.session);
    if (s.kind !== 'codex' || !s.rt.codexSessionId || !b.desktopImport?.codex) return f.outputs[action](p);
    const rt = s.rt, threadId = rt.codexSessionId;
    const r = await readCodexMessages(b.desktopImport.codex, threadId, { limit: 2000 });
    if (b.sessions.get(s.sessionId) !== s || s.rt !== rt || rt.codexSessionId !== threadId) throw apiError('closed', 'Session changed while reading output');
    const scoped = new Outputs(f.outputs.ctx);
    scoped.turnsOf = () => ({ source: 'transcript', file: null, turns: turnsFromMessages(r.messages) });
    return scoped[action](p);
  };
  f.thread = new ThreadLog({
    store, broadcast,
    runtimeOf: (sessionId) => { const s = b.sessions.get(sessionId); if (!s) return null; const d = deriveState(s.rt); return { state: d.state, turn: s.rt.turn, lastAnswer: s.rt.lastAnswer, error: d.error || s.rt.lastError, answerSource: s.rt.answerSource || null }; },
  });
  f.memos = new Memos({ store, broadcast, resolveWorkspace: (r) => b.resolveWorkspace(r), occupied, place, apiError });
  f.kanbans = new Kanbans({
    store, broadcast, resolveWorkspace: (r) => b.resolveWorkspace(r), occupied, place, apiError, resolveSession: (r) => b.resolve(r),
    sessionCard: (sessionId) => {
      const s = b.sessions.get(sessionId);
      if (!s) { const row = store.getSession(sessionId); return { open: false, sessionId, name: row ? row.name : null, closedAt: row ? row.closedAt : null }; }
      const sum = b.summary(s);
      return { open: true, sessionId, name: sum.name, kind: sum.kind, state: sum.state, unseen: sum.unseen, workspaceKey: sum.workspaceKey, ask: sum.ask ? clip(sum.ask.summary || (sum.ask.questions && sum.ask.questions[0] && sum.ask.questions[0].question) || sum.ask.kind, 120) : null, lastAnswer: clip(s.rt.lastAnswer, 160), lastAnswerAt: s.rt.lastAnswerAt };
    },
  });
  f.loops = new LoopEngine({
    store, broadcast, log: (m) => b.log(m), canRun: () => !!(b.adapter && b.adapter.connected && b.herdrOk),
    targetsOf: (l) => {
      const toT = (s) => {
        const per = (l.per || {})[s.sessionId] || {};
        return { sessionId: s.sessionId, name: s.name, kind: s.kind || 'claude', state: deriveState(s.rt).state, turnEndedAt: s.rt.turn.endedAt, lastAnswer: s.rt.lastAnswer, lastAnswerAt: s.rt.lastAnswerAt, screenHas: f.loops ? f.loops.screenHas(l.loopId, s.sessionId) : null, delivery: per.deliveryId ? deliveryOf(per.deliveryId) : null };
      };
      const s = l.target.kind === 'session' ? b.sessions.get(l.target.id) : null;
      return s ? [toT(s)] : null;
    },
    enqueue: (sessionId, text) => b.queue.enqueue(sessionId, text),
    deliveryOf, cancel: (id) => b.queue.cancel(id),
    readScreen: (sessionId) => { const s = b.sessions.get(sessionId); return s && s.paneId && b.adapter.connected ? b.adapter.readScreen(s.paneId, { source: 'visible' }) : Promise.resolve(null); },
    thread: (x) => f.thread.add({ ...x, source: 'loop' }),
  });

  // 내부 알림
  let tickQueued = false;
  const scheduleTick = () => { if (tickQueued) return; tickQueued = true; setImmediate(() => { tickQueued = false; try { f.loops.tick(); } catch (e) { b.log('loop tick error', e.stack); } }); };
  b.queue.on('delivery', (d) => { try { f.thread.onDelivery(d); } catch (e) { b.log('thread delivery error', e.stack); } });
  b.bus.on('session', (s) => { try { f.thread.check(s.sessionId); } catch (e) { b.log('thread check error', e.stack); } scheduleTick(); });
  b.bus.on('closed', (s) => { f.thread.onClosed(s.sessionId); f.kanbans.onSessionClosed(s.sessionId); scheduleTick(); });
  // hook이 없는 세션의 턴 끝 답을 출력 보기의 지난 턴으로 남긴다(지시는 그 세션에 마지막으로 들어간 전달)
  b.bus.on('screenAnswer', (s) => {
    const last = store.deliveries({ sessionId: s.sessionId, limit: 5 }).find((d) => d.status === 'confirmed');
    store.addEvent(s.sessionId, 'answer_screen', { text: clip(s.rt.lastAnswer, 20000), prompt: last ? clip(last.text, 2000) : null });
  });
  f.loops.start({ timers });

  // 루프 만들기: 대상 확인(셸 거부), 시작·멈춤 조건 확인, 확인(confirm)
  const loopCreate = (p) => {
    if (!p.session) throw apiError('bad_request', 'session required');
    const s = b.resolve(p.session);
    if (s.kind === SHELL) throw keyed(apiError('not_agent', `@${s.name} 세션은 일반 셸입니다. 반복 작업은 에이전트 세션에서만 사용할 수 있습니다.`), 'shellNoLoop', { name: s.name });
    const target = { kind: 'session', id: s.sessionId, name: s.name };
    const trigger = normalizeTrigger(p.trigger), stop = normalizeStop(p.stop || {});
    if (!String(p.prompt || '').trim()) throw apiError('bad_request', "보낼 요청을 입력하세요.");
    if (!p.confirm) return confirmResult(describeLoop({ targetLabel: `@${target.name}`, prompt: p.prompt, trigger, stop }), describeLoopMsg({ target: `@${target.name}`, prompt: p.prompt, trigger, stop }));
    const v = f.loops.create({ target, prompt: p.prompt, trigger, stop });
    store.addEvent(target.id, 'loop_created', { loopId: v.loopId, target, trigger, stop });
    return v;
  };
  const loopRef = (p) => p.loop || p.loopId;

  f.handlers = {
    // I1 출력 보기
    'output.get': (p) => outputAction('get', p),
    'output.save': (p) => outputAction('save', p),
    // I2 Thread
    'thread.list': (p) => f.thread.list(p),
    // I3 메모 노드
    'memo.create': (p) => f.memos.create(p),
    'memo.update': (p) => f.memos.update(p),
    'memo.delete': (p) => f.memos.delete(p),
    'memo.list': (p) => f.memos.list(p),
    // I4 칸반 노드
    'kanban.create': (p) => f.kanbans.create(p),
    'kanban.update': (p) => f.kanbans.update(p),
    'kanban.delete': (p) => f.kanbans.delete(p),
    'kanban.list': (p) => f.kanbans.list(p),
    // I5 루프
    'loop.create': (p) => loopCreate(p),
    'loop.pause': (p) => f.loops.pause(loopRef(p)),
    'loop.resume': (p) => f.loops.resume(loopRef(p)),
    'loop.delete': (p) => f.loops.delete(loopRef(p)),
    'loop.list': (p) => f.loops.list({ sessionId: p.session ? b.resolve(p.session).sessionId : null }),
    // I6 미션 맵
    'mission.graph': () => missionGraph({ sessions: [...b.sessions.values()].map((s) => b.summary(s)), links: b.linksOpen(), thread: f.thread.list({ limit: 500 }).items, loops: [...f.loops.loops.values()] }),
    // I7 설정(트레이 상주)
    'settings.get': () => ({ settings: f.settings.get(), schema: f.settings.describe() }),
    'settings.set': (p) => ({ settings: f.settings.set(p) }),
    // P33 호출자
    'launcher.list': () => f.launchers.list(),
    'launcher.create': (p) => f.launchers.create(p),
    'launcher.update': (p) => f.launchers.update(p),
    'launcher.delete': (p) => f.launchers.delete(p),
    'launcher.favorite': (p) => f.launchers.favorite(p),
    'launcher.order': (p) => f.launchers.order(p),
    'launcher.preview': (p) => f.launchers.preview(p),
    // P97: 붙여 넣은 명령줄 → 호출자 칸(herdr가 아는 에이전트 종류로 하네스를 알아본다)
    'launcher.parse': async (p) => f.launchers.parse({ ...p, kinds: await b.adapter.agentKinds().then((ks) => ks.map((k) => k.kind)).catch(() => []) }),
  };
  // 세션 요약에 덧붙이는 값: 긴 답인지(출력 보기), 켜진 루프 수(노드 배지)
  f.summaryExtra = (s) => ({ output: { long: isLongAnswer(s.rt.lastAnswer), chars: typeof s.rt.lastAnswer === 'string' ? s.rt.lastAnswer.length : 0 }, loops: f.loops.activeCount(s.sessionId) });
  f.stop = () => f.loops.stop();
  return f;
}
