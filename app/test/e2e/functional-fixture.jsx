// 실제 컴포넌트 + 메모리 API. 백엔드·herdr·사용자 기록에 연결하지 않는다.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@xterm/xterm/css/xterm.css';
import '../../src/renderer/tokens.css';
import '../../src/renderer/styles.css';
import { api } from '../../src/renderer/api.js';
import * as store from '../../src/renderer/store.js';
import { SpawnDialog, quickSpawn } from '../../src/renderer/SpawnDialog.jsx';
import { SearchBox } from '../../src/renderer/Search.jsx';
import { SettingsDialog } from '../../src/renderer/Settings.jsx';
import { TerminalView, terms } from '../../src/renderer/TerminalView.jsx';
import { Canvas } from '../../src/renderer/Canvas.jsx';
import { LeftRail, TopRight } from '../../src/renderer/Chrome.jsx';
import { DividerNode } from '../../src/renderer/Docks.jsx';
import { LinkPanel } from '../../src/renderer/Links.jsx';

window.mt = { log() {} };
const calls = [], held = new Set();
const settings = { language: 'en', tray: true, herdrPath: '', claudePermissionMode: 'manual', sleepAfterMin: 30, archiveDays: 14, branchMaxChildren: 4, branchMaxDepth: 3, branchMaxTotal: 16 };
const launchers = {
  launchers: ['claude', 'codex', 'gemini', 'shell'].map((id) => ({
    id, name: id === 'gemini' ? 'Gemini' : id, harness: id === 'gemini' ? 'agy' : id,
    icon: '', model: '', args: '', env: {}, favorite: true, permissionMode: 'manual',
    preview: { line: id === 'gemini' ? 'agy' : id, env: [], shell: id === 'shell' },
  })),
  favorites: ['claude', 'codex', 'gemini', 'shell'],
  harnesses: [
    { id: 'claude', fields: ['model', 'effort', 'permissionMode', 'allowHerdr', 'args', 'env', 'checkUrl'], models: [] },
    ...['codex', 'gemini', 'agy'].map((id) => ({ id, fields: ['model', 'args', 'env'], models: [] })),
    { id: 'shell', fields: [], models: [] }, { id: 'command', fields: ['command', 'env'], models: [] },
  ],
};
const st = store.getState();
Object.assign(st, { conn: 'open', settings, launchers, currentWs: 'fixture', workspaces: [{ key: 'fixture', name: 'Fixture', root: '/tmp/atrium-fixture', x: 0, y: 0 }], boardLoaded: true, viewport: { x: 0, y: 0, zoom: 0.5 } });
for (const [i, id] of ['a', 'b'].entries()) {
  st.sessions.set(id, { sessionId: id, name: id, kind: 'shell', state: 'idle', workspaceKey: 'fixture', createdAt: 1 });
  st.nodes.set(id, { x: i * 500, y: 0, w: 500, h: 400 });
}
api.status = 'open';
api.call = (method, params = {}) => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  calls.push({ method, params, resolve, reject });
  if (!held.has(method)) resolve(method === 'agent.kinds' ? ['claude', 'codex', 'agy', 'gemini'].map((kind) => ({ kind, installed: true }))
    : method === 'agent.models' ? { models: [], source: 'fixture' }
    : method === 'trust.predict' ? { needsTrust: true }
    : method === 'settings.get' ? { settings, schema: {} }
    : method === 'launcher.list' ? launchers
    : method === 'launcher.preview' ? { preview: { line: `${params.launcher.harness} ${params.launcher.model || ''}`, env: [] } }
    : method === 'terminal.attach' ? { controllerPid: 10, attachmentId: params.attachmentId }
    : method === 'terminal.history' ? { text: '' }
    : method === 'web.status' ? { enabled: false, built: true, devices: [], requests: [] }
    : method === 'device.list' ? { enabled: false, devices: [], requests: [] }
    : method === 'remote.status' ? { enabled: false, ready: false, checks: [] }
    : method === 'search.query' ? { results: [] } : {});
  return promise;
};
const root = createRoot(document.getElementById('root'));
let closeCount = 0;
const onClose = () => { closeCount++; };
function render(which, props = {}) {
  flushSync(() => root.render(which === 'spawn' ? <SpawnDialog onClose={onClose} {...props} />
    : which === 'search' ? <SearchBox /> : which === 'settings' ? <SettingsDialog onClose={onClose} />
    : which === 'link' ? <LinkPanel linkId="role" onClose={onClose} />
    : which === 'terminal' ? <ReactFlowProvider><div style={{ position: 'relative', width: 600, height: 400 }}><TerminalView sessionId="a" width={600} height={400} {...props} /></div></ReactFlowProvider>
    : which === 'canvas' ? <ReactFlowProvider><div className="mt-app"><div className="mt-stage"><Canvas /></div></div></ReactFlowProvider>
    : which === 'chrome' ? <><LeftRail linking={false} setLinking={() => {}} /><TopRight maxControllers={8} /></>
    : which === 'divider' ? <ReactFlowProvider><DividerNode data={{ dockId: 'dock', path: [], index: 0, dir: 'row' }} /></ReactFlowProvider>
    : null));
}
window.audit = { api, store, render, terms, quickSpawn, held, calls, get closeCount() { return closeCount; },
  attachment(index = -1) { return calls.filter((c) => c.method === 'terminal.attach').at(index).params.attachmentId; },
  resolve(method, result, index = 0) {
    const call = calls.filter((c) => c.method === method)[index];
    call.resolve(method === 'terminal.attach' ? { attachmentId: call.params.attachmentId, ...result } : result);
  },
  reject(method, index = 0) { calls.filter((c) => c.method === method)[index].reject(new Error('fixture failure')); },
};
