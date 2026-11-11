import test from 'node:test';import assert from 'node:assert/strict';
import {herdrCandidates,withPathFirst,herdrCompat} from '../src/herdr/discover.mjs';
import {HerdrAdapter} from '../src/herdr/adapter.mjs';
test('mac discovery includes bundled engine and does not use Windows paths or case folding',()=>{
 const list=herdrCandidates({platform:'darwin',home:'/Users/test',envPath:'/Engine/herdr',settingPath:'/engine/herdr',bundledPath:'/Bundle/herdr'});
 assert.deepEqual(list.slice(0,3).map(x=>x.path),['/Engine/herdr','/engine/herdr','/Bundle/herdr']);assert.ok(list.some(x=>x.path==='/opt/homebrew/bin/herdr'));assert.ok(!list.some(x=>x.path.endsWith('.exe')));
 assert.equal(withPathFirst({PATH:'/bin:/engine:/tools'},'/engine','darwin').PATH,'/engine:/bin:/tools');
});
test('workspace creation preserves managed provider credentials and PATH while selecting engine',async()=>{
 const a=new HerdrAdapter({herdrPath:'/engine/herdr',session:'atrium-dev-env',logDir:'/tmp'});a.paneEnv=async()=>({PATH:'/engine:/base'});let params;a.call=async(_method,p)=>{params=p;return{workspace:{workspace_id:'w'},root_pane:{pane_id:'p'}};};
 await a.createWorkspace({cwd:'/work',label:'worker',env:{ATRIUM_BRANCH_FILE:'/private/session.json',GEMINI_CLI_HOME:'/private/profile',PATH:'/runtime:/bin'}});
 assert.equal(params.env.GEMINI_CLI_HOME,'/private/profile');assert.equal(params.env.ATRIUM_BRANCH_FILE,'/private/session.json');assert.ok(params.env.PATH.startsWith('/engine'));
});
test('same protocol permits an untested engine version with a warning',()=>{const result=herdrCompat({version:'0.9.99',protocol:22,capabilities:{}},{protocols:[22],tested:['0.9.5']});assert.equal(result.ok,true);assert.equal(result.level,'untested');assert.ok(result.warning);});

test('reattachment discovery preserves the exact server PID as well as executable', async () => {
 const {herdrServerProcess}=await import('../src/herdr/discover.mjs');
 const rows=[{pid:51,exe:'/app/herdr',cmd:'herdr --session atrium-dev-identity server'},{pid:52,exe:'/other/herdr',cmd:'herdr --session another server'},{pid:53,exe:'/new/herdr',cmd:'herdr --session atrium-dev-identity server'}];
 assert.deepEqual(herdrServerProcess(rows,'atrium-dev-identity',53),{pid:53,exe:'/new/herdr'});
 assert.deepEqual(herdrServerProcess(rows,'atrium-dev-identity'),{pid:51,exe:'/app/herdr'});
 assert.equal(herdrServerProcess(rows,'missing'),null);
});
