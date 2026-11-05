// 저장소(store.mjs)의 P34 표: 데스크톱 앱 세션 가져오기 장부(desktop_imports). 화면에 표로 보이지 않는다.
// store.mjs가 이 파일을 불러 표를 만들고 Store에 메서드를 붙인다. 저장소 모듈의 일부라 SQL은 store*.mjs에만 둔다(ARCH 5절 "저장소").
// 한 줄이 한 번 갈라 연 것이다. 앱 세션 하나(app_session_id)를 다시 가져오면 세대(gen)가 하나 늘고 옛 줄은 그대로 남는다.
// - source_conv: 갈라 연 원본 대화 ID(앱의 cliSessionId), new_conv: 판이 쓴 갈래 대화 ID, session_id: 판 세션 ID(Claude는 new_conv와 같고 Codex는 별도 판 UUID)
// - point_uuid·point_at·point_lines: 갈라 연 시점(원본 마지막 답 uuid, 그 시각, 갈래에 넣은 줄 수). 원본이 그 뒤로 이어진 만큼을 센다
export const IMPORTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS desktop_imports (
  app_session_id TEXT NOT NULL, gen INTEGER NOT NULL, source_conv TEXT NOT NULL, new_conv TEXT NOT NULL, session_id TEXT NOT NULL,
  point_uuid TEXT, point_at INTEGER, point_lines INTEGER NOT NULL, title TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (app_session_id, gen)
) STRICT;
CREATE INDEX IF NOT EXISTS desktop_imports_session ON desktop_imports(session_id);
`;

// Keep the P34 table readable without a migration in store.mjs. Claude IDs are
// local_*; Codex UUIDs use a reserved namespace in the existing primary key.
export const importKey = (provider, id) => `${provider || 'claude'}:${id}`;
const storedKey = (provider, id) => provider === 'codex' ? importKey(provider, id) : id;
const importRow = (r) => (r ? { provider: r.app_session_id.startsWith('codex:') ? 'codex' : 'claude', appSessionId: r.app_session_id.replace(/^codex:/, ''), gen: r.gen, sourceConv: r.source_conv, newConv: r.new_conv, sessionId: r.session_id, pointUuid: r.point_uuid ?? null, pointAt: r.point_at ?? null, pointLines: r.point_lines, title: r.title ?? null, createdAt: r.created_at } : null);

export function installImports(Store) {
  Object.assign(Store.prototype, {
    importedProviderConversations(provider) {
      const ids = new Set();
      for (const r of this.st('SELECT runtime FROM sessions WHERE kind = ?').all(provider)) {
        try { const id = JSON.parse(r.runtime || '{}')[`${provider}SessionId`]; if (id) ids.add(id); } catch {}
      }
      return ids;
    },
    desktopImports() { return this.st('SELECT * FROM desktop_imports ORDER BY app_session_id, gen').all().map(importRow); },
    // 앱 세션마다 마지막 세대 → Map(app_session_id → 줄)
    latestDesktopImports(provider = 'claude') {
      const out = new Map();
      for (const r of this.desktopImports()) if (!provider || r.provider === provider) out.set(provider ? r.appSessionId : importKey(r.provider, r.appSessionId), r);
      return out;
    },
    desktopImportBySession(sessionId) { return importRow(this.st('SELECT * FROM desktop_imports WHERE session_id = ? ORDER BY gen DESC LIMIT 1').get(sessionId)); },
    // 다음 세대로 한 줄을 더한다. 같은 (앱 세션, 세대)가 이미 있으면 PRIMARY KEY가 막는다
    addDesktopImport(r) {
      if (r.provider && !['claude', 'codex'].includes(r.provider)) throw new Error('unsupported import provider');
      const key = storedKey(r.provider, r.appSessionId);
      const prev = this.st('SELECT MAX(gen) AS g FROM desktop_imports WHERE app_session_id = ?').get(key);
      const gen = r.gen ?? ((prev && prev.g) || 0) + 1;
      this.st(`INSERT INTO desktop_imports (app_session_id, gen, source_conv, new_conv, session_id, point_uuid, point_at, point_lines, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(key, gen, r.sourceConv, r.newConv, r.sessionId, r.pointUuid ?? null, r.pointAt ?? null, r.pointLines, r.title ?? null, r.createdAt || Date.now());
      return gen;
    },
  });
}
