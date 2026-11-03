import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {herdrCall} from '../../../backend/src/herdr/adapter.mjs';
import {herdrSocket} from '../../../backend/src/platform.mjs';

export async function checkWorkspaceAudit({client,page,dir,session}) {
 const project=path.join(dir,'audit-project');fs.mkdirSync(project);
 const until=async(fn,label)=>{const end=Date.now()+30000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw Error(`Audit timeout: ${label}`);};
 const w=(await client.call('workspace.open',{path:project})).workspace;
 const a=await client.call('session.spawn',{kind:'shell',name:'audit-a',cwd:project});
 const b=await client.call('session.spawn',{kind:'shell',name:'audit-b',cwd:project});
 await assert.rejects(client.call('workspace.close',{workspace:w.key,confirm:true}),/not_empty/);
 const dock=await client.call('dock.create',{members:[a.sessionId,b.sessionId],dir:'row'});
 assert.equal(dock.dock.members.length,2);
 await client.call('dock.update',{dock:dock.dock.dockId,w:1500,h:500});
 await client.call('dock.remove',{dock:dock.dock.dockId});
 assert.equal((await client.call('dock.list')).length,0);
 const board=await client.call('board.get');const before=board.nodes.filter(n=>n.session_id===a.sessionId||n.session_id===b.sessionId);
 await client.call('board.arrange',{workspace:w.key,apply:true});await client.call('board.arrange',{workspace:w.key,undo:true});
 const restored=(await client.call('board.get')).nodes;
 for(const n of before){const after=restored.find(x=>x.session_id===n.session_id);assert.equal(after.x,n.x);assert.equal(after.y,n.y);}
 const memo=await client.call('memo.create',{workspace:w.key,text:'# 검토 메모\nAUDIT_PERSIST_ME'});
 await Promise.all([client.call('memo.update',{memo:memo.memoId,text:'AUDIT_PERSIST_UPDATED'}),client.call('memo.update',{memo:memo.memoId,w:560})]);
 const saved=(await client.call('memo.list')).find(x=>x.memoId===memo.memoId);assert.equal(saved.text,'AUDIT_PERSIST_UPDATED');assert.equal(saved.w,560);
 let kanban=await client.call('kanban.create',{workspace:w.key,title:'AUDIT_BOARD',columns:['Todo','Done']});
 kanban=await client.call('kanban.update',{kanban:kanban.kanbanId,op:{op:'addCard',text:'AUDIT_REVIEW_CARD',session:b.sessionId}});
 const card=kanban.columns[0].cards[0];
 kanban=await client.call('kanban.update',{kanban:kanban.kanbanId,op:{op:'moveCard',card:card.cardId,column:kanban.columns[1].columnId}});
 assert.equal(kanban.columns[1].cards[0].cardId,card.cardId);
 const results=(await client.call('search.query',{q:'AUDIT_'})).results;assert.ok(results.some(r=>r.kind==='memo'));assert.ok(results.some(r=>r.kind==='kanban'));
 assert.equal((await client.call('memo.delete',{memo:memo.memoId})).needsConfirm,true);
 assert.equal((await client.call('kanban.delete',{kanban:kanban.kanbanId})).needsConfirm,true);
 const pipe=herdrSocket(path.join(dir,'xdg/herdr/sessions',session));
 await herdrCall(pipe,'pane.split',{target_pane_id:a.paneId,direction:'right'});
 const sibling=await until(async()=> (await client.call('session.list')).find(s=>s.herdrWorkspaceId===a.herdrWorkspaceId&&s.paneId!==a.paneId),'split pane adoption');
 await client.call('session.kill',{session:a.sessionId,confirm:true});
 const surviving=await herdrCall(pipe,'pane.get',{pane_id:sibling.paneId});assert.ok(surviving.pane);
 await client.call('session.kill',{session:sibling.sessionId,confirm:true});
 await client.call('session.kill',{session:b.sessionId,confirm:true,after:'archive'});
 await client.call('archive.restore',{session:b.sessionId});
 const reopened=await client.call('recall.reopen',{session:b.sessionId});assert.equal(reopened.sessionId,b.sessionId);
 await client.call('session.kill',{session:reopened.sessionId,confirm:true});
 await client.call('workspace.close',{workspace:w.key,confirm:true});
 const keptMemo=(await client.call('memo.list')).find(x=>x.memoId===memo.memoId);const keptBoard=(await client.call('kanban.list')).find(x=>x.kanbanId===kanban.kanbanId);
 assert.equal(keptMemo.workspaceKey,null);assert.equal(keptMemo.text,'AUDIT_PERSIST_UPDATED');assert.equal(keptBoard.workspaceKey,null);assert.equal(keptBoard.columns[1].cards[0].text,'AUDIT_REVIEW_CARD');
 await page.screenshot({path:path.join(dir,'audit-workspace.png')});
 await client.call('memo.delete',{memo:memo.memoId,confirm:true});await client.call('kanban.delete',{kanban:kanban.kanbanId,confirm:true});
 console.log('PASS workspace audit: docks/resize/arrange undo, concurrent memo edits, linked kanban move/search, deletion confirmation, shared-pane-only close, archive/reopen, workspace-close content retention');
}
