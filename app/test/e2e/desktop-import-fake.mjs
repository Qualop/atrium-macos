// Isolated browser fixture; no real provider history or network access.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = fs.mkdtempSync(path.join(os.tmpdir(),'atrium-import-ui-'));
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(appRoot, 'src/renderer/DesktopImport.jsx');
const mocks = {
 api: `window.fixture={lists:[],imports:[],toasts:[],closed:0}; export const api={call(method,payload){return new Promise((resolve,reject)=>{window.fixture[method==='desktop.list'?'lists':'imports'].push({resolve,reject,payload});});},on(){return ()=>{};}};`,
 store: `export const toast=(...args)=>window.fixture.toasts.push(args);`,
 dialog: `import {useRef} from 'react'; export const useDialog=()=>useRef(null);`,
};
await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {DesktopImportDialog} from ${JSON.stringify(source)}; window.root=createRoot(document.getElementById('root'));window.root.render(<React.StrictMode><DesktopImportDialog onClose={()=>window.fixture.closed++}/></React.StrictMode>);`,resolveDir:appRoot,loader:'jsx'},outfile:path.join(root,'bundle.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'synthetic-api',setup(b){b.onResolve({filter:/^\.\/(api|store|dialog)\.js$/},args=>args.importer===source?{path:args.path.slice(2,-3),namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],resolveDir:appRoot}));}}]});
fs.writeFileSync(path.join(root,'index.html'),'<div id="root"></div><script src="./bundle.js"></script>');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executable = process.env.ATRIUM_TEST_BROWSER || (fs.existsSync(chromium.executablePath()) ? undefined : process.platform === 'darwin' && fs.existsSync(chrome) ? chrome : undefined);
const browser=await chromium.launch({headless:true,executablePath:executable});
try {
 const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https?:/,r=>r.abort());await page.goto(pathToFileURL(path.join(root,'index.html')).href);
 await page.waitForFunction(()=>window.fixture?.lists.length===2);
 await page.evaluate(()=>{window.response=title=>({sources:[{provider:'codex',allowed:false,reason:'codex_not_installed'}],total:1,running:0,repos:[{key:'fake',name:'Fake',items:[{provider:'claude',appSessionId:'local_fake',selectionId:'claude:local_fake',title,status:'new'}]}]});window.fixture.lists[1].resolve(window.response('Newest'));});
 await page.getByText('Newest',{exact:true}).waitFor();
 await page.evaluate(()=>window.fixture.lists[0].resolve(window.response('Stale')));await page.waitForTimeout(10);
 assert.equal(await page.getByText('Stale',{exact:true}).count(),0);
 assert.equal(await page.locator('input[type=checkbox]').isChecked(),false);
 assert.ok(!(await page.locator('[role=status]').first().innerText()).includes('codex_not_installed'));
 await page.locator('input[type=checkbox]').check();
 await page.evaluate(()=>{const b=document.querySelector('[data-action=import-run]');const props=b[Object.keys(b).find(k=>k.startsWith('__reactProps$'))];props.onClick();props.onClick();});
 assert.equal(await page.evaluate(()=>window.fixture.imports.length),1);
 assert.deepEqual(await page.evaluate(()=>window.fixture.imports[0].payload),{selections:[{provider:'claude',appSessionId:'local_fake'}]});
 await page.evaluate(()=>{const b=document.querySelector('[data-action=import-close]');b[Object.keys(b).find(k=>k.startsWith('__reactProps$'))].onClick();});
 assert.equal(await page.evaluate(()=>window.fixture.closed),0);
 await page.evaluate(()=>{window.root.unmount();window.fixture.imports[0].resolve({imported:[{sessionId:'fake'}],skipped:[]});});await page.waitForTimeout(10);
 assert.equal(await page.evaluate(()=>window.fixture.toasts.length),0);assert.deepEqual(errors,[]);
 console.log('Synthetic UI passed: explicit selection, localized reason, stale StrictMode load ignored, synchronous duplicate submit blocked, close locked, unmounted completion ignored.');
} finally {await browser.close();fs.rmSync(root,{recursive:true,force:true});}
