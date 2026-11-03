import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { Backend } from '../src/backend.mjs';
import { newRuntime } from '../src/state.mjs';
const defer = () => { let resolve; const promise = new Promise((r) => resolve = r); return { promise, resolve }; };
function fixture(t, kind='shell') {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atrium-audit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const b=new Backend({logDir:dir,killWaitMs:0}); const s={sessionId:'s',name:'s',agentName:'s',kind,paneId:'w1:p1',herdrWorkspaceId:'w1',rt:newRuntime({kind,hooked:false})};
 b.sessions.set('s',s); b.requireHerdr=()=>{}; b.broadcastSession=()=>{};
 b.closed=[];b.closeSession=(x)=>{b.closed.push(x.sessionId);b.sessions.delete(x.sessionId);};
 b.adapter={workspacePanes:async()=>[],closePane:async()=>{},closeWorkspace:async()=>{}};
 return {b,s};
}
test('closing a session never closes sibling panes when enumeration is unavailable',async(t)=>{
 const {b}=fixture(t);const calls=[];
 b.adapter.workspacePanes=async()=>{throw Error('temporarily unavailable');};
 b.adapter.closePane=async(p)=>calls.push(['pane',p]);b.adapter.closeWorkspace=async(w)=>calls.push(['workspace',w]);
 await b.kill({session:'s',confirm:true});assert.deepEqual(calls,[['pane','w1:p1']]);
});
test('a failed pane close preserves the live session and reports failure',async(t)=>{
 const {b}=fixture(t);b.adapter.workspacePanes=async()=>[{paneId:'w1:p1'},{paneId:'w1:p2'}];
 b.adapter.closePane=async()=>{throw Object.assign(Error('offline'),{code:'unreachable'});};
 await assert.rejects(b.kill({session:'s',confirm:true}),{code:'unreachable'});assert.equal(b.closed.length,0);assert.ok(b.sessions.has('s'));
});
test('duplicate simultaneous closes share one operation',async(t)=>{
 const {b}=fixture(t);const gate=defer();let calls=0;
 b.adapter.workspacePanes=()=>gate.promise;b.adapter.closePane=async()=>calls++;b.adapter.closeWorkspace=async()=>calls++;
 const a=b.kill({session:'s',confirm:true});const c=b.kill({session:'s',confirm:true});gate.resolve([]);
 await Promise.all([a,c]);assert.equal(calls,1);assert.equal(b.closed.length,1);
});
test('terminal send never follows a session that is closed while composer inspection awaits',async(t)=>{
 const {b,s}=fixture(t,'agy');const gate=defer();let sends=0;
 b.adapter.readScreen=()=>gate.promise;b.adapter.prompt=async()=>sends++;
 const sending=b.promptManaged('s','request');b.sessions.delete('s');gate.resolve('> \n──── ? for shortcuts');
 await assert.rejects(sending);assert.equal(sends,0);assert.equal(s.rt.agyComposer,undefined);
});
test('late composer inspection cannot mark a new pane ready',async(t)=>{
 const {b,s}=fixture(t,'agy');const gate=defer();b.adapter.readScreen=()=>gate.promise;
 const checking=b.checkAgyComposer(s);s.paneId='w2:p1';gate.resolve('> \n──── ? for shortcuts');await checking;
 assert.notEqual(s.rt.agyComposer,'ready');
});
test('late output from an old turn cannot overwrite the new turn answer',async(t)=>{
 const {b,s}=fixture(t,'codex');const gate=defer();b.adapter.readScreen=()=>gate.promise;b.bus.emit=()=>{};
 s.rt.turn={startedAt:1,endedAt:2}; const reading=b.readScreenAnswer(s);s.rt.turn={startedAt:3,endedAt:null};s.rt.lastAnswer='new answer';gate.resolve('OLD ANSWER');await reading;
 assert.equal(s.rt.lastAnswer,'new answer');
});
test('a Stop callback queued before a new Antigravity invocation cannot finish that new invocation',async(t)=>{
 const {b,s}=fixture(t,'agy');s.hookToken='secret';s.origin='board';s.rt.agyTurnActive=true;s.rt.turn={startedAt:1,endedAt:null};s.rt.agySessionId='native';
 b.store={addEvent(){}};b.api={broadcast(){}};b.queue={onAgentWorking(){}};b.probeGit=()=>{};
 let reads=0;b.readScreenAnswer=async()=>{reads++;s.rt.lastAnswer='OLD';};
 const hook=(body)=>b.processHook({'x-mt-session':'s',authorization:'Bearer secret'},JSON.stringify({conversationId:'native',...body}),'agy');
 hook({atriumEvent:'Stop',fullyIdle:true});hook({atriumEvent:'PreInvocation'});await new Promise(r=>setImmediate(r));
 assert.equal(s.rt.agyTurnActive,true);assert.equal(s.rt.agyStoppedAt,null);assert.equal(reads,0);
});
test('a delayed hook from a cleared native conversation does not restore its old identity',async(t)=>{
 const {b,s}=fixture(t,'agy');s.hookToken='secret';s.rt.agySessionId='new-conversation';s.rt.agyTurnActive=true;s.rt.turn={startedAt:2,endedAt:null};
 b.store={addEvent(){}};b.api={broadcast(){}};b.queue={onAgentWorking(){}};b.probeGit=()=>{};b.readScreenAnswer=async()=>{};
 b.processHook({'x-mt-session':'s',authorization:'Bearer secret'},JSON.stringify({conversationId:'old-conversation',atriumEvent:'Stop',fullyIdle:true}),'agy');await new Promise(r=>setImmediate(r));
 assert.equal(s.rt.agySessionId,'new-conversation');assert.equal(s.rt.agyTurnActive,true);
});
test('Claude recovery uses the current conversation after clear, keeping the board ID stable',t=>{
 const{b,s}=fixture(t,'claude');s.rt.claudeSessionId='new-native';s.settingsPath='/fixture/settings.json';s.resumeArgv=['claude','--resume','s','--settings',s.settingsPath];
 assert.equal(b.launchOf(s).sessionId,'new-native');assert.equal(s.sessionId,'s');
});
test('resume registration reports the current Claude conversation ID',async(t)=>{
 const{b,s}=fixture(t,'claude');s.rt.claudeSessionId='new-native';s.rt.herdr={status:'idle',present:true};s.resumeArgv=['claude','--resume','new-native','--settings','fixture'];
 let captured;b.adapter.registerResume=async args=>{captured=args;};b.store={addEvent(){}};b.verifyResume=async()=>true;
 await b.registerResume(s);assert.equal(captured.sessionId,'new-native');
});
for(const kind of ['codex','gemini','agy'])test(`${kind} explicit default model is not stored as the literal null string`,async(t)=>{
 const{b}=fixture(t,kind);const cwd=b.cfg.logDir;let model;
 b.adapter.agentKinds=async()=>[];b.ensureWorkspace=()=>{};b.geminiSettings=b.agySettings=()=>({settingsPath:'fixture',env:{}});
 b.withNewPane=async(_create,register)=>register({paneId:'p',workspaceId:'w'});
 b.store={insertSession(s){model=s.model;throw Error('fixture captured before launch');}};
 await assert.rejects(b.spawnReserved({model:null,args:'--model old'},{name:'test',cwd,kind,shell:false}),/fixture captured/);
 assert.equal(model,null);
});
