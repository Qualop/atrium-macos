// atrium CLI의 P6b 명령(ARCH 4절 I): 출력 보기, Thread, 메모, 칸반, 루프, 미션 맵, 설정. 판 API를 그대로 부르는 얇은 층이다(P6c가 볼 예시).
// atrium.mjs가 모르는 명령을 여기로 넘긴다(featureCommand). watch의 새 이벤트 줄도 여기서 찍는다(featureEvent).

export const FEATURES_HELP = `  --- 응답·메모·칸반·반복 작업 ---
  output <이름> [--turn n] [--list] [--save]   응답 보기: 마지막 또는 n번째 응답 (-1: 마지막). --list: 응답 목록, --save: 보드 데이터 폴더 outputs/에 .md로 저장
  thread [--limit n] [--before seq]  명령 입력줄 대화 기록(보낸 글, 대상별 전달 상태, 완료 보고)
  memo | memo add <글> [--ws w] [--x n --y n --w n --h n] | memo set <ID> [--body 글] [--x …] [--ws w|-] | memo rm <ID> [--yes]   메모 카드(\\n은 줄바꿈)
  kanban | kanban add [제목] [--columns 할 일,진행 중,완료] [--ws w] | kanban rm <ID> [--yes]   칸반 카드 (열이 하나면 체크리스트)
  kanban card <ID> <글> [--column 열] [--session 이름] | kanban move <ID> <카드> <열> | kanban link <ID> <카드> <이름|-> | kanban op <ID> <JSON> [--yes]
  loop | loop add @이름 <요청> (--every 1m | --idle | --match 글 [--source answer|screen|any]) [--runs n] [--for 10m] [--until 글] [--no-immediate] [--yes]
  loop pause|resume|rm <ID>         반복 작업 일시 정지·재개·삭제
  mission                           작업 관계도 (사용자와 세션 사이의 작업 위임 관계)
  settings | settings set <키> <값>  보드 설정 (tray on|off: 창을 닫아도 트레이에서 실행)`;
// 값을 받지 않는 플래그
export const FEATURE_BOOL_FLAGS = ['idle', 'save', 'list', 'no-immediate'];

const one = (s, n) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
const nl = (t) => String(t).replace(/\\n/g, '\n');
function needsConfirm(r) {
  if (!r || !r.needsConfirm) return false;
  console.log(`확인 필요: ${r.message}\n계속하려면 --yes`);
  process.exitCode = 2;
  return true;
}

// 처리했으면 true. ctx: { c(판 API 클라이언트), flags, out(결과 찍기), ts(시각 글), json(--json) }
export async function featureCommand(cmd, rest, { c, flags, out, ts, json }) {
  const op = rest[0];
  switch (cmd) {
    case 'output': {
      const turn = flags.turn != null ? Number(flags.turn) : undefined;
      if (flags.save) { out(await c.call('output.save', { session: rest[0], turn })); return true; }
      const r = await c.call('output.get', { session: rest[0], turn });
      if (json) { out(r); return true; }
      console.log(`@${r.name} 턴 ${r.turnCount}개(출처 ${r.source || '-'}, 프로젝트 ${r.workspace || '-'})`);
      if (flags.list) { for (const t of r.turns) console.log(`  #${t.turn} ${t.long ? '[긴 응답] ' : ''}${t.chars}자  지시 "${t.prompt || ''}"  → ${t.answerHead || "(응답 없음)"}`); return true; }
      if (!r.turn) { console.log("(응답 없음)"); return true; }
      console.log(`--- 턴 ${r.turn.turn}${r.turn.long ? ' (긴 응답: 출력 보기)' : ''} ${r.turn.answerAt ? new Date(r.turn.answerAt).toLocaleTimeString() : ''}\n지시: ${r.turn.prompt || '-'}\n---\n${r.turn.markdown}`);
      return true;
    }
    case 'thread': {
      const r = await c.call('thread.list', { limit: Number(flags.limit || 20), before: flags.before != null ? Number(flags.before) : undefined });
      if (json) { out(r); return true; }
      if (!r.items.length) console.log('(Thread 없음)');
      for (const it of r.items) {
        console.log(`#${it.seq} ${ts(it.t)} [${it.source}${it.loopId ? ` ${it.loopId}` : ''}] ${it.phase.padEnd(8)} ${it.targets.join(' ')} "${one(it.text, 70)}"`);
        for (const x of it.results) console.log(`    @${x.name} ${x.phase}${x.status !== x.phase ? `(${x.status}${x.reason ? `: ${x.reason}` : ''})` : ''}${x.report ? `  보고(${x.report.state}${x.report.clipped ? ', 4000자에서 자름' : ''}): ${one(x.report.text, 100)}` : ''}`);
      }
      if (r.more) console.log(`(더 앞의 것: --before ${r.before})`);
      return true;
    }
    case 'memo': {
      const geo = Object.fromEntries(['x', 'y', 'w', 'h'].filter((k) => flags[k] != null).map((k) => [k, Number(flags[k])]));
      const ws = flags.ws === '-' ? null : flags.ws;
      if (op === 'add') { out(await c.call('memo.create', { text: nl(rest.slice(1).join(' ')), workspace: ws, ...geo })); return true; }
      if (op === 'set') { out(await c.call('memo.update', { memo: rest[1], text: flags.body !== undefined ? nl(flags.body) : undefined, workspace: ws, ...geo })); return true; }
      if (op === 'rm') { const r = await c.call('memo.delete', { memo: rest[1], confirm: !!flags.yes }); if (!needsConfirm(r)) out(r); return true; }
      const r = await c.call('memo.list', { workspace: ws, q: flags.q });
      if (json) { out(r); return true; }
      if (!r.length) console.log('(메모 없음)');
      for (const m of r) console.log(`${m.memoId} (${m.x},${m.y} ${m.w}x${m.h}) ws=${m.workspaceKey || '-'}  ${one(m.text, 80)}`);
      return true;
    }
    case 'kanban': {
      const id = rest[1];
      let r;
      if (op === 'add') r = await c.call('kanban.create', { title: rest.slice(1).join(' ') || undefined, columns: flags.columns ? String(flags.columns).split(',') : undefined, workspace: flags.ws });
      else if (op === 'rm') r = await c.call('kanban.delete', { kanban: id, confirm: !!flags.yes });
      else if (op === 'card') r = await c.call('kanban.update', { kanban: id, op: { op: 'addCard', text: rest.slice(2).join(' '), column: flags.column, session: flags.session } });
      else if (op === 'move') r = await c.call('kanban.update', { kanban: id, op: { op: 'moveCard', card: rest[2], column: rest[3] } });
      else if (op === 'link') r = await c.call('kanban.update', { kanban: id, op: { op: 'linkCard', card: rest[2], session: rest[3] === '-' ? null : rest[3] } });
      else if (op === 'op') { const o = JSON.parse(rest[2]); r = await c.call('kanban.update', { kanban: id, ...(Array.isArray(o) ? { ops: o } : { op: o }), confirm: !!flags.yes }); }
      if (r) { if (!needsConfirm(r)) out(r); return true; }
      const list = await c.call('kanban.list', { workspace: flags.ws });
      if (json) { out(list); return true; }
      if (!list.length) console.log('(칸반 없음)');
      for (const k of list) {
        console.log(`${k.kanbanId} "${k.title}" (${k.x},${k.y}) ws=${k.workspaceKey || '-'}`);
        for (const col of k.columns) {
          console.log(`  [${col.name}] ${col.columnId}`);
          for (const x of col.cards) console.log(`    ${x.cardId} ${one(x.text, 60)}${x.session ? `  → @${x.session.name} ${x.session.open ? x.session.state : '(닫힘)'}${x.session.unseen ? ' 작업 완료' : ''}${x.session.ask ? ` 묻는 중: ${x.session.ask}` : ''}` : ''}`);
        }
      }
      return true;
    }
    case 'loop': {
      if (op === 'pause' || op === 'resume' || op === 'rm') { out(await c.call(op === 'rm' ? 'loop.delete' : `loop.${op}`, { loop: rest[1] })); return true; }
      if (op === 'add') {
        const target = String(rest[1] || '').replace(/^@/, '');
        if (!target) throw new Error('대상(@이름)을 준다');
        const trigger = flags.every ? { type: 'interval', every: flags.every, immediate: !flags['no-immediate'] } : flags.idle ? { type: 'idle' } : flags.match ? { type: 'text', text: flags.match, source: flags.source } : null;
        if (!trigger) throw new Error('시작 조건: --every 1m | --idle | --match 글');
        const stop = { maxRuns: flags.runs != null ? Number(flags.runs) : undefined, maxMs: flags.for, untilText: flags.until };
        const r = await c.call('loop.create', { session: target, prompt: rest.slice(2).join(' '), trigger, stop, confirm: !!flags.yes });
        if (!needsConfirm(r)) out(r);
        return true;
      }
      const r = await c.call('loop.list', {});
      if (json) { out(r); return true; }
      if (!r.length) console.log('(루프 없음)');
      for (const l of r) {
        const tr = l.trigger.type === 'interval' ? `${l.trigger.everyMs / 1000}초마다` : l.trigger.type === 'idle' ? '쉴 때' : `글 "${l.trigger.text}"(${l.trigger.source})`;
        const st = [l.stop.maxRuns && `${l.stop.maxRuns}회`, l.stop.maxMs && `${l.stop.maxMs / 1000}초`, l.stop.untilText && `"${l.stop.untilText}"`].filter(Boolean).join(', ') || '사람';
        console.log(`${l.loopId} ${l.status.padEnd(7)} @${l.targetName || l.targets.map((t) => t.name).join(',')} ${tr} 멈춤=${st} 보냄 ${l.runs} 건너뜀 ${l.skips} 돈 시간 ${(l.elapsedMs / 1000).toFixed(0)}초${l.nextInMs != null ? ` 다음 ${(l.nextInMs / 1000).toFixed(0)}초 뒤` : ''}${l.stopReason ? ` (${l.stopReason})` : ''}  "${one(l.prompt, 40)}"`);
        for (const h of l.history.slice(-5)) console.log(`    ${ts(h.t)} ${h.kind}${h.reason ? ` ${h.reason}` : ''}${h.sessions ? ` → ${h.sessions.join(',')}` : ''}${h.n ? ` #${h.n}` : ''}${h.downMs != null ? ` 꺼져 있던 ${(h.downMs / 1000).toFixed(0)}초` : ''}`);
      }
      return true;
    }
    case 'mission': {
      const r = await c.call('mission.graph');
      if (json) { out(r); return true; }
      const name = (id) => { const n = r.nodes.find((x) => x.id === id); return n ? (n.kind === 'human' ? '사람' : `@${n.name}`) : id; };
      console.log(`세션 ${r.counts.all}: 작업 중 ${r.counts.working}, 응답 필요 ${r.counts.needs_you}, 쉼 ${r.counts.idle}, 끝(안 봄) ${r.counts.done}, 끝남 ${r.counts.exited}`);
      for (const col of [0, 1]) console.log(`  열 ${col}: ${r.nodes.filter((n) => n.column === col).map((n) => `${name(n.id)}${n.state ? `(${n.state})` : ''}`).join(', ') || '-'}`);
      for (const e of r.edges) console.log(`  ${e.kind.padEnd(6)} ${name(e.from)} → ${name(e.to)}${e.label ? `  "${e.label}"` : ''}${e.count ? ` ×${e.count}` : ''}${e.active ? ' (도는 중)' : ''}`);
      return true;
    }
    case 'settings': {
      out(op === 'set' ? await c.call('settings.set', { key: rest[1], value: rest[2] }) : await c.call('settings.get'));
      return true;
    }
    default: return false;
  }
}

// watch: P6b 이벤트 한 줄. 찍었으면 true
export function featureEvent(ev, d, ts) {
  if (ev === 'thread.item') console.log(`${ts()} thread #${d.seq} [${d.source}] ${d.phase} ${d.results.map((x) => `@${x.name}:${x.phase}`).join(' ')}`);
  else if (ev === 'loop.updated') console.log(`${ts()} 루프 ${d.loopId} ${d.status} 보냄 ${d.runs} 건너뜀 ${d.skips}${d.stopReason ? ` (${d.stopReason})` : ''}`);
  else if (ev === 'loop.removed') console.log(`${ts()} 루프 ${d.loopId} 지움`);
  else if (ev === 'settings.updated') console.log(`${ts()} 설정 ${JSON.stringify(d)}`);
  else if (ev === 'memo.updated' || ev === 'kanban.updated') console.log(`${ts()} ${ev} ${d.memoId || d.kanbanId}`);
  else return false;
  return true;
}
