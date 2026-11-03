import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import test from 'node:test';import assert from 'node:assert/strict';
import {readAgyAnswer} from '../src/agy-transcript.mjs';import {newRuntime,deriveState} from '../src/state.mjs';
test('native Antigravity answer excludes prompt, thoughts, old turns and partial writes', (t) => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atrium-agy-tx-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); const file=path.join(dir,'t.jsonl');
 const rows=[{type:'USER_INPUT',content:'<USER_REQUEST>review</USER_REQUEST><ADDITIONAL_METADATA>private</ADDITIONAL_METADATA>'},{type:'PLANNER_THOUGHT',source:'MODEL',status:'DONE',content:'hidden'},{type:'PLANNER_RESPONSE',source:'MODEL',status:'DONE',step_index:2,content:'REVIEW_BAD'}];
 fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n{"unfinished');
 assert.deepEqual(readAgyAnswer(file),{text:'REVIEW_BAD',prompt:'review',step:2,at:null});
 fs.writeFileSync(file,rows.concat({type:'USER_INPUT',content:'fix it'}).map(JSON.stringify).join('\n'));
 assert.equal(readAgyAnswer(file),null);
});
test('fully idle native Stop plus composer overrides stale herdr working; menus stay waiting',()=>{
 const rt=newRuntime({kind:'agy',hooked:false});Object.assign(rt,{agyStoppedAt:1,agyTurnActive:false,agyComposer:'ready'});rt.herdr.status='working';
 assert.equal(deriveState(rt).state,'ready');rt.agyComposer='waiting';assert.equal(deriveState(rt).state,'waiting');
 rt.agyComposer='ready';rt.agyTurnActive=true;assert.equal(deriveState(rt).state,'working');
});
