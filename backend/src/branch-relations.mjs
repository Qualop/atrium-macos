// 일 관계(P156, ARCH 4절 K): Branch에 붙는 메서드. 계산 규칙은 relations.mjs(순수 함수), 저장은 store-branch.mjs(표 relations)다.
// - 정하는 길: 띄울 때 atrium child --peer(출처 agent), 나중에 atrium relate(에이전트, 자기와 이어진 세션만), 판 API relation.set(사람, 출처 user).
// - 바뀌면: 저장, 연결 기록(link_events kind 'relation'), 판 이벤트, 'relation.updated'와 두 세션(과 그 일 자손) 요약 방송, 받는 쪽에 짧은 알림(link-notice 묶음).
// - 계보(parent_session_id)는 건드리지 않는다. P159부터 잠재우기 묶음·닫힘 알림·작업 완료 세기도 일 부모를 따르고, 사람의 "떼기"는 독립(none)으로 두기다.
import { relationIndex, RELATIONS, RELATION_SET, promptTag, workDescendantsOf } from './relations.mjs';
import { shownName } from './session-label.mjs';

function apiError(code, message, extra = {}) { return Object.assign(new Error(message), { code }, extra); }

// 관계 이름(한국어 낱말. 창은 지금 언어로 바꿔 보인다)
export const RELATION_WORD = { sub: '하위', peer: '동료', none: '독립', auto: '자동' };

// 알림 줄: 세션 me에게 상대 other와의 새 관계를 말한다. rel = { relation, up } | null(자동으로 되돌림)
export function relationLine(me, other, rel, by) {
  const who = by === 'user' ? '사람이 판에서 정함' : `@${by}가 정함`;
  if (!rel) return `@${other}와의 관계를 자동으로 되돌렸다(띄움·역할 선을 따른다, ${who}).`;
  if (rel.relation === 'sub') return rel.up === me
    ? `@${other}는 이제 너의 하위 워커다(${who}). 일을 맡기고 결과를 받는다.`
    : `너는 이제 @${other}의 하위 워커다(${who}). 보고는 지시에 적힌 방법을 따른다(적힌 것이 없으면 그 턴의 마지막 답이 보고다).`;
  if (rel.relation === 'peer') return `@${other}와 너는 이제 동료다(하위가 아니다, ${who}). 필요한 것을 atrium prompt로 주고받고, 끝나면 결과를 @${other}에게 공유한다.`;
  return `@${other}와 너는 이제 독립이다(${who}). 서로 보고하거나 일을 맡기지 않는다.`;
}

// 띄울 때 첫 요청 앞에 붙이는 한 줄(관계에 맞는 보고 방식). 하위는 지시의 보고 방법을 따르고, 동료는 서로 공유한다
export function relationHeader({ relation, parent }) {
  if (relation === 'peer') return `[Atrium 보드] 관계: 너는 @${parent}의 동료다(하위 워커가 아니다). 필요한 것은 \`atrium prompt ${parent} "…"\`로 묻고 주고받는다. 끝나면 결과를 @${parent}에게 공유한다(\`atrium prompt ${parent} --now "<결과>"\`). 사람이 직접 물으면 사람에게 바로 답해도 된다.`;
  return `[Atrium 보드] 관계: 너는 @${parent}의 하위 워커다. 보고는 아래 지시에 적힌 방법을 따른다(적힌 것이 없으면 이 턴의 마지막 답이 보고다).`;
}

export function installRelations(Branch) {
  Object.assign(Branch.prototype, {
    relRows() { if (!this._relRows) this._relRows = this.b.store.relationRows ? this.b.store.relationRows() : []; return this._relRows; },
    lineageOf(id) { const r = this.rowOf(id); return r ? r.parentSessionId || null : null; },
    // withLinks: 자동 규칙의 역할 선까지(선 하나의 관계). 일 부모·동료만 볼 때는 필요 없다
    relIndex({ withLinks = false, rows = null } = {}) {
      return relationIndex({ rows: rows || this.relRows(), lineageOf: (id) => this.lineageOf(id), links: withLinks ? this.b.store.links().filter((l) => !l.removedAt) : [] });
    },
    // 두 세션 사이 지금 관계(역할 선 포함)
    relationBetween(x, y) { return this.relIndex({ withLinks: true }).between(x, y); },
    // atrium prompt의 꼬리표(assign·report·share)
    promptTagOf(fromId, toId) { return promptTag(this.relationBetween(fromId, toId), fromId); },
    // 요약에 붙일 관계(summaryExtra의 branch에 더한다)
    relationSummary(s, idx = this.relIndex()) {
      const wp = idx.workParentOf(s.sessionId);
      const lp = s.parentSessionId || null;
      const pr = lp ? idx.between(lp, s.sessionId) : null;
      return { workParentSessionId: wp, workParentName: wp ? shownName(this.rowOf(wp)) : null, lineageParentSessionId: lp,
        parentRelation: pr ? { relation: pr.relation, source: pr.source } : null, peers: idx.peersOf(s.sessionId).map((p) => p.id).filter((id) => this.b.sessions.has(id)) };
    },
    // P159: 화면에 보이는 위아래(머리줄·사이드바·atrium tree·children)는 일 관계를 따른다. 계보는 사실(lineageParentSessionId)과 옅은 띄움 선으로만 남는다
    // 일 자식인가: 일 부모가 있고, 하위 세션 기록이 있거나(atrium child) 명시한 하위 줄이 있다(판에 올린 에이전트 F3는 옛 판처럼 아니다)
    isWorkChild(id, wp, idx = this.relIndex()) { return !!wp && (this.info.has(id) || !!idx.explicitOf(wp, id)); },
    // 일 단계: 일 부모를 따라 올라간 수 + 1(닫힌 세션도 따라간다). 고리는 끊는다
    workDepth(id, idx = this.relIndex()) {
      let d = 1; const seen = new Set([id]);
      for (let cur = idx.workParentOf(id); cur && !seen.has(cur); cur = idx.workParentOf(cur)) { seen.add(cur); d++; }
      return d;
    },
    // 일 역할: 띄운 부모 아래 하위면 띄울 때 역할(워커 등), 사람·에이전트가 다른 세션 아래로 둔 하위면 그 선의 역할 이름(없으면 null = 창은 "하위"),
    // 동료·독립·맨 위면 null(독립으로 둔 세션에 "워커"가 남지 않는다)
    workRole(s, wp, idx = this.relIndex()) {
      if (!wp) return null;
      const info = this.info.get(s.sessionId);
      if (wp === (s.parentSessionId || null) && info) return info.role || null;
      const l = this.b.store.linkByPair ? this.b.store.linkByPair(wp, s.sessionId) : null;
      return l && !l.removedAt && l.role ? l.role : null;
    },
    // 일 자식(열린 세션). 계보로만 이어지고 하위 세션 기록이 없는 세션(판에 올린 에이전트 F3)은 옛 판처럼 빼고, 명시한 하위 줄은 넣는다
    workChildren(parentId, idx = this.relIndex()) {
      return [...this.b.sessions.values()].filter((x) => idx.workParentOf(x.sessionId) === parentId && (this.info.has(x.sessionId) || idx.explicitOf(parentId, x.sessionId)));
    },

    // 관계 바꾸기. a, b: 세션. relation: sub|peer|none|auto("b는 a의 …"). source: agent|user. by: 바꾼 쪽(에이전트 이름 또는 'user')
    // notify: 알림을 받을 세션들(바꾼 에이전트 자신은 빼고 부른다)
    setRelation(a, b, relation, { source = 'user', by = 'user', notify = null, quiet = false } = {}) {
      const B = this.b;
      if (!a || !b) throw apiError('not_found', '세션을 찾을 수 없습니다.');
      if (a.sessionId === b.sessionId) throw apiError('bad_request', '세션과 자기 자신의 관계는 정할 수 없습니다.');
      if (!RELATION_SET.includes(relation)) throw apiError('bad_request', `관계는 ${RELATION_SET.join(', ')} 가운데 하나입니다: ${relation}`);
      const before = this.relIndex({ withLinks: true }).between(a.sessionId, b.sessionId);
      const pairOut = this.relRows().filter((r) => !((r.a === a.sessionId && r.b === b.sessionId) || (r.a === b.sessionId && r.b === a.sessionId)));
      const at = Date.now();
      const rows = relation === 'auto' ? pairOut : [...pairOut, { a: a.sessionId, b: b.sessionId, relation, source, at }];
      // 하위면 고리를 막는다(a가 b의 일 자손이 되면 안 된다)
      if (relation === 'sub' && this.relIndex({ rows }).isWorkDescendant(a.sessionId, b.sessionId)) throw apiError('cycle', `@${shownName(a)}는 @${shownName(b)} 아래에 있어 @${shownName(b)}를 하위로 둘 수 없습니다.`);
      B.store.setRelation(a.sessionId, b.sessionId, relation === 'auto' ? null : relation, source, at);
      this._relRows = null;
      const after = this.relIndex({ withLinks: true }).between(a.sessionId, b.sessionId);
      // 연결 기록: 명시한 관계면 a → b 연결을 연다(세션 맵에 선이 생긴다). 자동으로 되돌리면 있는 연결에만 남긴다
      // P159: 한쪽이 닫혀 있으면(사람이 닫힌 일 부모에서 독립으로 둘 때) 선을 새로 열지 않는다
      const open = B.sessions.has(a.sessionId) && B.sessions.has(b.sessionId);
      const l = relation === 'auto' || !open ? (B.store.linkByPair(a.sessionId, b.sessionId) || B.store.linkByPair(b.sessionId, a.sessionId)) : B.ensureLink(a.sessionId, b.sessionId, {});
      const data = { relation, source, by, before: before ? { relation: before.relation, source: before.source, up: before.up } : null, after: after ? { relation: after.relation, source: after.source, up: after.up } : null };
      if (l) B.linkEvent(l, 'relation', relation, data, { quiet: true });
      B.store.addEvent(a.sessionId, 'relation_set', { other: b.name, otherSessionId: b.sessionId, ...data });
      B.log(`relation ${shownName(a)} → ${shownName(b)}: ${relation} (${source}${by !== 'user' ? `, ${by}` : ''})`);
      B.api.broadcast('relation.updated', { a: a.sessionId, b: b.sessionId, relation, source: relation === 'auto' ? 'auto' : source, effective: after ? { relation: after.relation, source: after.source, up: after.up } : null, at });
      // 요약(일 부모·동료)이 바뀐 세션: 두 세션과 그 계보 자식들
      if (B.broadcastSession) {
        const touched = new Set([a.sessionId, b.sessionId]);
        for (const x of B.sessions.values()) if (touched.has(x.parentSessionId || '')) touched.add(x.sessionId);
        const idx2 = this.relIndex(), ids = [...B.sessions.keys()]; // P159: 일 단계·일 부모가 바뀌는 일 자손과 옛 일 부모(하위 수)
        for (const id of [a.sessionId, b.sessionId]) { for (const d of workDescendantsOf(id, ids, idx2)) touched.add(d.sessionId); }
        if (before && before.up) touched.add(before.up);
        for (const id of touched) { const x = B.sessions.get(id); if (x) B.broadcastSession(x, { cause: 'relation' }); }
      }
      if (!quiet) for (const s of notify || [a, b]) {
        const other = s === a ? b : a;
        if (this.notices) this.notices.add(s.sessionId, relationLine(s.sessionId, shownName(other), relation === 'auto' ? null : after, by));
      }
      return { a: shownName(a), b: shownName(b), aSessionId: a.sessionId, bSessionId: b.sessionId, relation, source: relation === 'auto' ? 'auto' : source,
        effective: after ? { relation: after.relation, source: after.source, up: after.up ? shownName(B.sessions.get(after.up) || this.rowOf(after.up)) : null } : { relation: 'none', source: 'auto', up: null },
        before: before ? { relation: before.relation, source: before.source } : null };
    },

    // 판 API relation.set(사람, 출처 user). a, b: 세션 ID 또는 이름
    relationSetUser(p = {}) {
      const a = this.b.resolve(p.a), b = this.b.resolve(p.b);
      return this.setRelation(a, b, String(p.relation || ''), { source: 'user', by: 'user' });
    },
    relationList() {
      const B = this.b;
      return { relations: this.relRows().filter((r) => B.sessions.has(r.a) && B.sessions.has(r.b)).map((r) => ({ ...r, aName: shownName(B.sessions.get(r.a)), bName: shownName(B.sessions.get(r.b)) })) };
    },

    // atrium relate <이름> sub|peer|none|auto: 나와 그 세션의 관계("그 세션은 나의 …"). 에이전트는 자기와 이어진 세션만, 사람이 정한 관계는 바꾸지 않는다
    relateVerb(caller, o = {}) {
      const B = this.b;
      const ref = String(o.name || '').replace(/^@/, '').trim();
      const relation = String(o.relation || '').trim();
      if (!ref || !relation) throw apiError('bad_request', '사용법: atrium relate <이름> sub|peer|none|auto');
      if (!RELATION_SET.includes(relation)) throw apiError('bad_request', `관계는 sub(하위), peer(동료), none(독립), auto(자동) 가운데 하나다: ${relation}`);
      const t = [...B.sessions.values()].find((x) => x.name === ref || x.label === ref || x.agentName === ref || x.sessionId === ref);
      if (!t) throw apiError('not_found', `보드에서 세션을 찾을 수 없습니다: ${ref}`);
      if (t === caller) throw apiError('self', '자기 자신과의 관계는 정할 수 없다.');
      const idx = this.relIndex({ withLinks: true });
      const linked = !!idx.between(caller.sessionId, t.sessionId) || B.store.links().some((l) => !l.removedAt && ((l.from === caller.sessionId && l.to === t.sessionId) || (l.from === t.sessionId && l.to === caller.sessionId)));
      if (!linked) throw apiError('not_linked', `@${shownName(t)}는 너와 이어진 세션이 아니다(띄움, 역할 선, 지시, 정한 관계가 없다). 에이전트는 자기와 이어진 세션의 관계만 바꾼다. 지금 연결: atrium me`);
      const ex = idx.explicitOf(caller.sessionId, t.sessionId);
      if (ex && ex.source === 'user') throw apiError('user_set', `@${shownName(t)}와의 관계(${RELATION_WORD[ex.relation]})는 사람이 판에서 정했다. 바꾸려면 사람에게 묻는다.`);
      return this.setRelation(caller, t, relation, { source: 'agent', by: caller.name, notify: [t] });
    },
  });
}

export { RELATIONS };
