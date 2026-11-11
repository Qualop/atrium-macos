// Isolated browser test: real React/xterm/TerminalView, deterministic API and store.
// No backend, herdr, agents, Tailscale, or user's board is started.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = await fs.mkdtemp(path.join(os.tmpdir(), 'atrium-terminal-browser-'));
const mock = `
export const state = { sessions: new Map([['s', { kind: 'claude' }]]), termScale: 1, herdr: { connected: true } };
export const getState = () => state;
export const useStore = fn => fn(state);
export const takePendingInput = () => ''; export const pendingFor = () => null;
export const isWeb = new URLSearchParams(location.search).has('fixtureWeb'); export const uploadFiles = async () => [];
export const useT = () => (key) => key; export const errText = e => e.message;
const listeners = new Map();
export const api = {
 generation: 1, status: 'open', info: { platform: 'darwin' }, clientId: 'test', calls: [],
 on(k, fn) { if (!listeners.has(k)) listeners.set(k,new Set()); listeners.get(k).add(fn); return () => listeners.get(k).delete(fn); },
 emit(k,v) { for (const fn of [...(listeners.get(k)||[])]) fn(v); },
 frame(start=0, attachmentId=this.attachmentId) { const lines=Array.from({length:this.rows},(_,i)=>'line '+String(start+i).padStart(3,'0')+' terminal content'); this.emit('terminal.frame',{sessionId:'s',controllerPid:7,attachmentId,width:this.cols,height:this.rows,full:true,bytes:btoa('\\x1b[2J\\x1b[H'+lines.join('\\r\\n'))}); },
 async call(k,p={}) { this.calls.push([k,p]);
  if(k==='terminal.attach') { this.attachmentId=p.attachmentId;this.cols=p.cols;this.rows=p.rows;
   this.frame(0); await new Promise(r=>setTimeout(r,30)); return {controllerPid:7,attachmentId:p.attachmentId,shared:1,ownerIsMe:true}; }
  if(k==='fs.roots') return {drives:['/'],home:'/home',recent:[]};
  if(k==='fs.list') { await new Promise(r=>setTimeout(r,p.path==='/slow'?150:10)); return {path:p.path,parent:'/',dirs:[],total:0}; }
  if(k==='terminal.history') return { text: Array.from({length:10},(_,i)=>'old history '+i).concat(Array.from({length:this.rows},(_,i)=>'line '+String(i).padStart(3,'0')+' terminal content')).join('\\n') };
  return {}; }
};
window.fixture = { api, state };
`;
let browser;
try {
  await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {ReactFlowProvider} from '@xyflow/react';
import {TerminalView, terms} from './src/renderer/TerminalView.jsx';
import {openFolderPicker} from './src/renderer/FolderPicker.jsx'; window.openPicker=()=>openFolderPicker().then(v=>window.picked=v);
import '@xterm/xterm/css/xterm.css';
window.mt={platform:'darwin',web:new URLSearchParams(location.search).has('fixtureWeb'),log(){}}; Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied=text}});
const root=createRoot(document.getElementById('root')); let n=0;
window.mount=()=>flushSync(()=>root.render(<ReactFlowProvider><TerminalView key={++n} sessionId="s" width={800} height={300}/></ReactFlowProvider>));
window.unmount=()=>flushSync(()=>root.render(null)); window.terms=terms; window.mount();
`, loader: 'jsx', resolveDir: app }, outfile: path.join(out, 'bundle.js'), bundle: true, jsx: 'automatic', write: true, plugins: [{ name: 'isolated-fixtures', setup(b) {
    b.onResolve({ filter: /^\.\/(api\.js|store\.js|web\.js|lib\/i18n\.js)$/ }, args => ({ path: 'fixture', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: mock, loader: 'js' }));
  } }] });
  await fs.writeFile(path.join(out, 'index.html'), `<!doctype html><link rel="stylesheet" href="bundle.css"><style>:root{--term-bg:#111;--term-text:#eee;--term-cursor:#fff;--term-select:#345}body{margin:20px}.mt-term-wrap{position:relative;width:800px;height:300px}.mt-term{position:absolute;inset:0}#root{transform:scale(.75);transform-origin:top left}</style><div id="root"></div><script src="bundle.js"></script>`);
  browser = await chromium.launch({ headless: true, channel: process.env.ATRIUM_TEST_BROWSER || 'chrome' });
  const page = await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href + '?webglBudget=' + (process.env.ATRIUM_TERMINAL_GPU === '1' ? '1' : '0') + (process.env.ATRIUM_TERMINAL_WEB === '1' ? '&fixtureWeb=1' : ''));
  await page.waitForFunction(() => window.terms?.get('s')?.buffer.active.getLine(0)?.translateToString(true).includes('line 000'));
  assert.equal(await page.locator('.mt-term-note').count(),0,'early full frame replayed after attach response');
  const point=async(col,row)=>page.evaluate(({col,row})=>{const t=terms.get('s'),r=document.querySelector('.xterm-screen').getBoundingClientRect();return{x:r.left+(col+.2)*r.width/t.cols,y:r.top+(row+.5)*r.height/t.rows};},{col,row});
  const a=await point(0,1),b=await point(18,3); await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();
  const selected=await page.evaluate(()=>terms.get('s').getSelection()); assert.match(selected,/line 001/);assert.match(selected,/line 003/);
  await page.evaluate(()=>fixture.api.frame(2));
  await page.waitForFunction(()=>terms.get('s').buffer.active.getLine(0).translateToString(true).includes('line 002'));
  assert.equal(await page.evaluate(()=>terms.get('s').getSelection()),selected,'selection follows content off screen across frames');
  await page.keyboard.press('Meta+c'); await page.waitForFunction(()=>typeof copied==='string'); assert.equal(await page.evaluate(()=>copied),selected.replace(/[ \t]+(?=\r?\n|$)/g,''));
  assert.equal(await page.evaluate(()=>terms.get('s').hasSelection()),false);
  await page.evaluate(()=>{const t=terms.get('s').textarea; const d=new DataTransfer();d.setData('text/plain','echo a\necho b');t.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:d}));});
  assert.equal(await page.evaluate(()=>fixture.api.calls.filter(([k])=>k==='terminal.input').at(-1)[1].data),'\x1b[200~echo a\recho b\x1b[201~');
  const old=await page.evaluate(()=>fixture.api.attachmentId);await page.evaluate(()=>mount());
  await page.waitForFunction(old=>fixture.api.attachmentId!==old&&!terms.get('s').options.disableStdin,old);
  await page.evaluate(old=>{fixture.api.frame(900,old);fixture.api.emit('terminal.detached',{sessionId:'s',controllerPid:7,attachmentId:old,reason:'late'});},old);
  await page.waitForTimeout(60);
  assert.equal(await page.locator('.mt-term-cover').count(),0,'late detach from reused PID ignored');
  assert.match(await page.evaluate(()=>terms.get('s').buffer.active.getLine(0).translateToString(true)),/line 000/);
  await page.evaluate(()=>{const term=terms.get('s');term.focus();window.beforeReconnect=term;window.focusCountBeforeReconnect=fixture.api.calls.filter(([k])=>k==='terminal.focus').length;fixture.api.generation++;fixture.api.status='closed';fixture.api.emit('$close');});
  assert.equal(await page.evaluate(()=>terms.get('s').options.disableStdin),true,'connection invalidation disables stdin immediately');
  await page.evaluate(()=>{fixture.api.status='open';fixture.api.emit('$open');});
  assert.equal(await page.evaluate(()=>fixture.api.calls.filter(([k])=>k==='terminal.focus').length),await page.evaluate(()=>focusCountBeforeReconnect),'focus is not sent while reattachment is pending');
  await page.waitForFunction(()=>!terms.get('s').options.disableStdin);
  assert.equal(await page.evaluate(()=>document.activeElement===terms.get('s').textarea),true,'reconnect retains/restores focused terminal');
  const focus = await page.evaluate(()=>fixture.api.calls.filter(([k])=>k==='terminal.focus').at(-1)?.[1]);
  assert.equal(focus?.attachmentId,await page.evaluate(()=>fixture.api.attachmentId),'reconnect focus claims the fresh attachment rather than the previous attachment');
  assert.equal(focus?.controllerPid,7);
  if (process.env.ATRIUM_TERMINAL_WEB === '1') assert.equal(await page.evaluate(()=>terms.get('s')===beforeReconnect),true,'web reconnect retains xterm instance');
  await page.evaluate(()=>{
    const input=document.createElement('input');input.id='reconnect-other-input';document.body.append(input);input.focus();
    window.unfocusedFocusCount=fixture.api.calls.filter(([k])=>k==='terminal.focus').length;
    fixture.api.generation++;fixture.api.status='closed';fixture.api.emit('$close');
    fixture.api.status='open';fixture.api.emit('$open');
  });
  await page.waitForFunction(()=>!terms.get('s').options.disableStdin);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'reconnect-other-input','reconnect never steals another input focus');
  assert.equal(await page.evaluate(()=>fixture.api.calls.filter(([k])=>k==='terminal.focus').length),await page.evaluate(()=>unfocusedFocusCount),'unfocused terminal does not claim the new attachment');
  await page.evaluate(()=>document.getElementById('reconnect-other-input').remove());
  await page.evaluate(()=>{fixture.state.sessions.set('s',{kind:'shell'});mount();});
  await page.waitForFunction(()=>terms.get('s').buffer.active.baseY>=10);
  const history=await page.evaluate(()=>{const t=terms.get('s');t.scrollToTop();return t.buffer.active.getLine(0).translateToString(true);});
  assert.match(history,/old history 0/,'shell history is loaded into real xterm scrollback');
  const s0=await point(0,0),s1=await point(13,2);await page.mouse.move(s0.x,s0.y);await page.mouse.down();await page.mouse.move(s1.x,s1.y,{steps:8});await page.mouse.up();
  assert.match(await page.evaluate(()=>terms.get('s').getSelection()),/old history 0/);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>terms.get('s').hasSelection()),false);
  await page.evaluate(()=>{openPicker();});
  await page.waitForFunction(()=>document.querySelector('[data-field=fpick-path]')?.value==='/home');
  await page.fill('[data-field=fpick-path]','/slow');await page.click('[data-action=fpick-go]');
  await page.fill('[data-field=fpick-path]','/fast');await page.click('[data-action=fpick-go]');
  await page.waitForTimeout(200);
  assert.equal(await page.inputValue('[data-field=fpick-path]'),'/fast','late folder listing cannot override current navigation');
  await page.evaluate(()=>document.querySelector('[data-field=fpick-path]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true})));
  assert.equal(await page.locator('[data-role=folder-picker]').count(),1,'IME Escape does not dismiss folder picker');
  await page.click('[data-action=fpick-choose]');await page.waitForFunction(()=>window.picked==='/fast');
  if (process.env.ATRIUM_TERMINAL_GPU === '1') {
    const dims = await page.evaluate(() => [terms.get('s').cols, terms.get('s').rows]);
    for (const zoom of [.75, 1, 1.25]) {
      await page.evaluate((z) => { document.getElementById('root').style.transform = `scale(${z})`; }, zoom);
      await page.waitForTimeout(1250);
      const sharp = await page.evaluate(() => {
        const canvas = document.querySelector('.xterm-screen canvas:not(.xterm-link-layer)'), host = document.querySelector('.mt-term');
        const box = canvas?.getBoundingClientRect();
        return { plan: host.dataset.sharp, sx: box ? box.width * devicePixelRatio / canvas.width : null, sy: box ? box.height * devicePixelRatio / canvas.height : null, dims: [terms.get('s').cols, terms.get('s').rows] };
      });
      assert.ok(sharp.plan, 'WebGL re-renders to device pixels');
      assert.ok(Math.abs(sharp.sx - 1) < .02 && Math.abs(sharp.sy - 1) < .02, JSON.stringify(sharp));
      assert.deepEqual(sharp.dims, dims, 'board zoom leaves PTY rows and columns stable');
    }
  }
  assert.deepEqual(errors,[]);console.log('PASS: scaled selection, retained off-screen content, Cmd+C, POSIX paste, early frames, reused-PID attachment filtering, reconnect, shell scrollback, folder navigation and IME dialog guards.');
} finally { await browser?.close(); await fs.rm(out,{recursive:true,force:true}); }
