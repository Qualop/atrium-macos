import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {herdrCall,HerdrAdapter} from '../src/herdr/adapter.mjs';
async function fixture(t,accept){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atrium-transport-'));const pipe=process.platform==='win32'?String.raw`\\.\pipe\atrium-audit-`+path.basename(dir):path.join(dir,'socket');const sockets=[];const server=net.createServer(s=>{sockets.push(s);accept(s);});await new Promise(r=>server.listen(pipe,r));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});return{pipe,dir,sockets};}
test('UTF-8 characters split between socket chunks stay intact',async(t)=>{
 const text='리뷰 완료 🚀';const{pipe}=await fixture(t,s=>s.once('data',()=>{const b=Buffer.from(JSON.stringify({result:{text}})+'\n');const i=b.indexOf(Buffer.from('리'))+1;s.write(b.subarray(0,i));setTimeout(()=>s.end(b.subarray(i)),10);}));
 assert.equal((await herdrCall(pipe,'fixture')).text,text);
});
test('an event subscription with no acknowledgement times out and does not stall later subscriptions',async(t)=>{
 let calls=0;const{pipe,dir,sockets}=await fixture(t,s=>s.once('data',()=>{if(++calls>1)s.write('{"result":{}}\n');}));
 const a=new HerdrAdapter({herdrPath:'unused',session:'atrium-dev-transport',logDir:dir});a.pipe=pipe;a._watching=true;a.subscribeTimeoutMs=25;t.after(()=>a.stopEvents());
 const request=a._subscribe().then(()=>null,e=>e);const got=await Promise.race([request,new Promise(r=>setTimeout(()=>r({code:'hung'}),150))]);
 if(got?.code==='hung')for(const s of sockets)s.destroy();
 assert.equal(got?.code,'timeout');await a._subscribe();assert.ok(a._sub);
});
test('stopEvents cancels an acknowledgement that arrives later',async(t)=>{
 let accept;const received=new Promise(r=>accept=r);const{pipe,dir}=await fixture(t,s=>s.once('data',()=>{accept(s);setTimeout(()=>{if(!s.destroyed)s.write('{"result":{}}\n');},40);}));
 const a=new HerdrAdapter({herdrPath:'unused',session:'atrium-dev-transport',logDir:dir});a.pipe=pipe;a._watching=true;t.after(()=>a.stopEvents());
 const pending=a._subscribe().catch(()=>{});await received;a.stopEvents();await pending;assert.equal(a._sub,null);
});
test('npm launcher prefix does not leak into agent login shells, while deliberate user configuration is preserved', async()=>{
 const {cleanEnv}=await import('../src/herdr/adapter.mjs');
 const fromNpm=cleanEnv({PATH:'/bin',npm_lifecycle_event:'start',npm_config_prefix:'/app',NPM_CONFIG_PREFIX:'/app',npm_config_registry:'https://registry.example',CUSTOM:'keep'});
 assert.equal(fromNpm.npm_config_prefix,undefined);assert.equal(fromNpm.NPM_CONFIG_PREFIX,undefined);assert.equal(fromNpm.CUSTOM,'keep');assert.equal(fromNpm.npm_config_registry,'https://registry.example');
 assert.equal(cleanEnv({npm_config_prefix:'/user-prefix'}).npm_config_prefix,'/user-prefix');
});
