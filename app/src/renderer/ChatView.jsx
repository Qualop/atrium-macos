// 중간 얼굴: 대화 보기(ARCH 7.2). 대화 기록에서 사용자 지시, AI 답, 도구 사용을 채팅 형태로 보여준다.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useT } from './lib/i18n.js';

function toolLine(m) {
  const i = m.input || {};
  const arg = i.command || i.file_path || i.pattern || i.url || (i.questions && i.questions.map((q) => q.question).join(' / ')) || '';
  return `${m.tool}${arg ? `: ${String(arg).replace(/\s+/g, ' ').slice(0, 120)}` : ''}`;
}

// P4: 판의 hook이 없는 세션은 대화 기록을 모르니 턴이 끝날 때 읽은 화면 끝을 보여준다
function ScreenView({ s }) {
  const t = useT();
  return (
    <div className="mt-chat nowheel">
      <div className="mt-chat-empty">{t('chat.screenHead', { kind: s.kind || t('ask.agent') })}</div>
      {s.lastPrompt && <div className="mt-msg user" data-role="screen-prompt">{String(s.lastPrompt).slice(0, 600)}</div>}{/* P124: 마지막 요청도(답 위에) */}
      {s.lastAnswer ? <pre className="mt-msg assistant mono">{s.lastAnswer}</pre> : <div className="mt-chat-empty">{t('chat.noTurn')}</div>}
    </div>
  );
}

// P5(G2): 일반 셸의 중간 얼굴. 쉬는지, 돌고 있는 명령과 프로세스, 지금 폴더
function ShellView({ s }) {
  const t = useT();
  const sh = s.shell || {};
  return (
    <div className="mt-chat nowheel" data-role="shell-view">
      <div className="mt-chat-empty">{t('chat.shellHead', { cwd: s.cwdNow || s.cwd })}</div>
      <div className={`mt-msg ${sh.atPrompt === false ? 'user' : 'assistant'} mono`}>{sh.atPrompt === false ? t('chat.running', { cmd: sh.command || '?' }) : sh.command ? t('chat.promptLast', { cmd: sh.command }) : t('chat.prompt')}</div>
      {sh.atPrompt === false && sh.procs && sh.procs.length > 0 && <div className="mt-msg tool_use">{t('chat.procs', { list: sh.procs.join(', ') })}</div>}
      <div className="mt-chat-empty">{t('chat.shellHint')}</div>
    </div>
  );
}

export function ChatView({ s }) {
  if (s.kind === 'shell') return <ShellView s={s} />;
  if (s.hooked === false) return <ScreenView s={s} />;
  return <ChatLog s={s} />;
}

function ChatLog({ s }) {
  const t = useT();
  const [msgs, setMsgs] = useState(null);
  const box = useRef(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs]); // 마지막 메시지가 보이게
  const key = `${s.lastPrompt || ''}|${s.lastAnswerAt || ''}|${s.state}`;
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api.call('session.messages', { session: s.sessionId, limit: 60 }).then((r) => { if (alive) setMsgs(r.messages.filter((m) => m.role !== 'tool_result').slice(-14)); }).catch(() => alive && setMsgs([]));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [s.sessionId, key]);
  return (
    <div className="mt-chat nowheel" ref={box}>
      {msgs === null && <div className="mt-chat-empty">{t('common.loading')}</div>}
      {msgs && !msgs.length && <div className="mt-chat-empty">{t('chat.empty')}</div>}
      {msgs && msgs.map((m, i) => (
        <div key={`${m.seq}-${i}`} className={`mt-msg ${m.role}`}>
          {m.role === 'tool_use' ? <span className="mono">⚙ {toolLine(m)}</span> : <span>{String(m.text || '').slice(0, 600)}</span>}
        </div>
      ))}
    </div>
  );
}
