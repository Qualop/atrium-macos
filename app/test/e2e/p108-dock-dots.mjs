// P108: 별도 개발용 판의 덩어리 안 선 장식과 가운데 잇기 손잡이 검사.
// 깨끗한 환경에서 ATRIUM_* 판 값과 P108_OUT(그림·JSON 폴더)을 주고 실행한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { closeApp, sleep } from './harness.mjs';
import { layout } from '../../../backend/src/dock-tree.mjs';
import assert from 'node:assert/strict';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
if (process.env.ATRIUM_HERDR_SESSION !== 'atrium-dev-p108' || process.env.ATRIUM_PORT !== '47897') throw new Error('P108 시험 판만');
const OUT = process.env.P108_OUT;
if (!OUT) throw new Error('P108_OUT 필요');
fs.mkdirSync(OUT, { recursive: true });
const tag = process.env.P108_TAG || 'probe';
const app = await electron.launch({args:['.', '--dev', '--remote-debugging-port=9377'], cwd:path.join(ROOT,'app'), env:process.env});
let report = [];
const branch = (dir, kids) => ({ dir, kids, ratios: kids.map(() => 1 / kids.length) });
function scene(n, leadInside, both, extra, collision = false) {
  const ids = Array.from({length:n}, (_,i)=>`p108-cell-${i}`);
  const tree = n === 2 ? branch('row',ids) : n === 4 ? branch('col',[branch('row',ids.slice(0,2)),branch('row',ids.slice(2))]) : branch('row',[ids[0],branch('col',ids.slice(1))]);
  const rects = layout(tree,{x:600,y:100,w:1200,h:900}).rects;
  rects.set('p108-lead',{x:0,y:250,w:500,h:400});
  rects.set('p108-remote',{x:2000,y:250,w:500,h:400});
  let links = [];
  const add = (from,to) => links.push({linkId:`${from}-${to}`,from,to,role:'worker',spawned:true,prompts:3,lastText:'UI test',lastAt:1,createdAt:1});
  const lead = leadInside ? ids[0] : 'p108-lead';
  for(const id of ids.filter(id=>id!==lead)) {add(lead,id);if(both)add(id,lead);}
  if(extra)for(const id of ids){add(id,'p108-remote');if(both)add('p108-remote',id);}
  if(collision){
    rects.clear();
    rects.set(ids[0],{x:1100,y:500,w:420,h:300});
    rects.set(ids[1],{x:1100,y:800,w:420,h:300});
    rects.set('p108-lead',{x:0,y:400,w:500,h:400});
    rects.set('p108-right-a',{x:1600,y:400,w:500,h:400});
    rects.set('p108-right-b',{x:1600,y:400,w:500,h:400});
    links=[];add('p108-lead','p108-right-a');add('p108-lead','p108-right-b');add(ids[0],ids[1]);
  }
  return {ids,tree:collision?branch('col',ids):tree,rects:[...rects],links,extra};
}
async function installScene(page,s) {
  await page.evaluate(s=>{
    const st=window.__mt.getState(), template=[...st.sessions.values()][0], ws=st.workspaces[0];
    st.sessions=new Map();st.nodes=new Map(s.rects);st.links=new Map(s.links.map(l=>[l.linkId,l]));
    st.docks=new Map([['p108-dock',{dockId:'p108-dock',members:s.ids,tree:s.tree,dir:s.tree.dir,workspaceKey:ws.key}]]);
    st.convoNodes=new Map();st.convoEdges=[];st.selected=[];st.focusId=null;
    st.workspaces=[ws,{...ws,key:'p108-other',name:'other'}];
    for(const [id] of s.rects) window.__mt.api.emit('session.updated',{...template,sessionId:id,name:id,kind:id===s.ids[1]?'codex':'claude',model:'haiku',state:'sleeping',unseen:true,ask:null,turn:{endedAt:1},workspaceKey:s.extra&&id==='p108-remote'?'p108-other':ws.key,parentSessionId:null,branch:null,lastPrompt:'UI test',lastAnswer:'UI test complete'});
  },s);
  await sleep(130);
}
async function zoomTo(page,zoom) {
  let w=1920/zoom,h=1080/zoom;
  for(let i=0;i<2;i++){
    await page.evaluate(({w,h})=>window.__mt.getState().navigateToRect({x:1250-w/2,y:550-h/2,w,h},0),{w,h});
    await sleep(100);
    const actual=await page.evaluate(()=>window.__mt.getState().vpNow.zoom);
    w*=actual/zoom;h*=actual/zoom;
  }
}
async function decorations(page,on) {
  return page.evaluate(on=>{
    const ns=[...document.querySelectorAll('.mt-node.docked')].map(e=>({r:e.getBoundingClientRect(),name:e.dataset.name,face:e.dataset.face}));
    const inside=(r,n)=>r.x+r.width/2>n.r.left+2&&r.x+r.width/2<n.r.right-2&&r.y+r.height/2>n.r.top+2&&r.y+r.height/2<n.r.bottom-2;
    const visible=e=>{const c=getComputedStyle(e);return c.display!=='none'&&c.visibility!=='hidden'&&+c.opacity>.1;};
    const bad=[...document.querySelectorAll('.mt-edge-label,.mt-edge-end,.mt-handle')].filter(visible).filter(e=>ns.some(n=>inside(e.getBoundingClientRect(),n))&&!(on&&e.matches('.mt-handle.h-c'))).map(e=>e.getAttribute('class'));
    return {bad,faces:ns.map(n=>n.face),tabs:document.querySelectorAll('.mt-dl-bridge,.mt-dl-rlabel,.mt-dl-chip').length,heads:document.querySelectorAll('.mt-node.docked .mt-node-head').length,handles:[...document.querySelectorAll('.mt-node.docked .h-c')].map(e=>+getComputedStyle(e).opacity),ends:[...document.querySelectorAll('.mt-edge-end')].filter(e=>ns.some(n=>inside(e.getBoundingClientRect(),n))).length};
  },on);
}
async function pixels(page,on) {
  const buffer=await page.screenshot();
  const count=await page.evaluate(async({b64,on})=>{
    const img=new Image();img.src=`data:image/png;base64,${b64}`;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const data=ctx.getImageData(0,0,c.width,c.height).data,scale=c.width/innerWidth;
    let count=0;
    for(const e of document.querySelectorAll('.mt-node.docked')){
      const r=e.getBoundingClientRect(),cx=r.x+r.width/2,cy=r.y+r.height/2;
      for(let y=Math.max(0,Math.ceil((r.top+r.height*.15)*scale));y<Math.min(c.height,(r.bottom-r.height*.15)*scale);y++)for(let x=Math.max(0,Math.ceil((r.left+r.width*.15)*scale));x<Math.min(c.width,(r.right-r.width*.15)*scale);x++){
        if(on&&Math.abs(x/scale-cx)<12&&Math.abs(y/scale-cy)<12)continue;
        const i=(y*c.width+x)*4,[red,g,b]=data.slice(i,i+3);
        if(g>150&&g>red+50&&g>b+25)count++;
      }
    }
    return count;
  },{b64:buffer.toString('base64'),on});
  return {count,buffer};
}
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__mt?.getState().boardLoaded, null, {timeout:90000});
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(1920,1080));
  await sleep(2000);
  await page.evaluate(() => window.__mt.getState().fitAll(0));
  await sleep(1000);
  report = await page.evaluate(() => ({
    linking: document.querySelector('.mt-app').classList.contains('linking'),
    sessions:[...window.__mt.getState().sessions.values()].map(s=>({name:s.name,state:s.state,kind:s.kind,unseen:s.unseen})),
    handles:[...document.querySelectorAll('.mt-handle.h-c')].map(e=>({cls:e.className,opacity:getComputedStyle(e).opacity,background:getComputedStyle(e).backgroundColor,rect:e.getBoundingClientRect().toJSON()})),
    ends:document.querySelectorAll('.mt-edge-end').length,
    tabs:[...document.querySelectorAll('.mt-dl-bridge')].map(e=>e.textContent),
  }));
  await page.screenshot({path:path.join(OUT,`${tag}.png`)});
  report.realScan=await decorations(page,false);
  await page.click('[data-action="link-mode"]');
  await sleep(300);
  report.linkingHandles = await page.locator('.mt-handle.h-c').evaluateAll(es=>es.map(e=>({opacity:getComputedStyle(e).opacity,width:e.getBoundingClientRect().width})));
  await page.screenshot({path:path.join(OUT,`${tag}-linking.png`)});
  // F2: 가운데 손잡이로 끌어 잇기는 역할 창까지 도달해야 한다. 제출은 하지 않는다.
  const centers=await page.locator('.mt-handle.h-c').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}));
  if(centers.length===2){
    await page.mouse.move(centers[0].x,centers[0].y);await sleep(150);await page.mouse.down();
    for(let i=1;i<=14;i++){await page.mouse.move(centers[0].x+(centers[1].x-centers[0].x)*i/14,centers[0].y+(centers[1].y-centers[0].y)*i/14);await sleep(20);}
    await sleep(200);report.connectionLine=await page.locator('.react-flow__connectionline').count();
    await page.mouse.up();
    await sleep(700);report.connectDialog=await page.locator('[data-role="link-role"]').count();
    report.connectState=await page.evaluate(()=>window.__mt.getState().dialog);
    await page.keyboard.press('Escape');
  }
  await page.click('[data-action="tool-select"]');
  // 실제 세션은 위 두 칸만 쓴다. 나머지 조합은 잠든 haiku/Codex 요약으로 그려 메모리를 아낀다.
  await installScene(page,scene(2,false,false,false,true));await zoomTo(page,.3);await page.mouse.move(5,1050);await sleep(300);
  const collision=await pixels(page,false);
  report.collision={...(await decorations(page,false)),pixels:collision.count};
  fs.writeFileSync(path.join(OUT,`${tag}-shifted-label.png`),collision.buffer);
  await page.evaluate(()=>{const st=window.__mt.getState();st.dialog={kind:'link',linkId:'p108-lead-p108-right-b'};window.__mt.api.emit('session.updated',[...st.sessions.values()][0]);});
  await sleep(100);
  report.dialogLabel=await page.locator('.mt-edge-label[data-link="p108-lead-p108-right-b"]').count();
  await page.evaluate(()=>{const st=window.__mt.getState();st.dialog=null;window.__mt.api.emit('session.updated',[...st.sessions.values()][0]);});
  if(process.env.P108_MATRIX==='1'){
    report.scenes=[];
    for(const n of [2,3,4,5])for(const leadInside of [false,true])for(const both of [false,true])for(const extra of [false,true]){
      await installScene(page,scene(n,leadInside,both,extra));
      for(const [face,zoom] of [['close',.75],['middle',.45],['far',.28]]){
        await zoomTo(page,zoom);
        for(const on of [false,true]){
          await page.click(`[data-action="${on?'link-mode':'tool-select'}"]`);await page.mouse.move(5,1050);await sleep(140);
          const px=await pixels(page,on);
          for(const posture of ['plain','hover','selected']){
            if(posture==='hover'){const r=await page.locator('.mt-node.docked').first().boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);}
            if(posture==='selected')await page.locator('.mt-node.docked .mt-node-head').first().click({position:{x:25,y:10},modifiers:['Control']});
            await sleep(70);
            report.scenes.push({n,leadInside,both,extra,face,on,posture,pixels:px.count,...(await decorations(page,on))});
          }
          if(!leadInside&&both&&extra&&face==='close'&&!on)fs.writeFileSync(path.join(OUT,`${tag}-${n}-cells.png`),px.buffer);
          await page.evaluate(()=>window.__mt.getState().clearSelection());
        }
      }
      console.log(`${tag} matrix ${report.scenes.length}/576`);
    }
    report.failures=report.scenes.filter(s=>s.bad.length||s.ends||s.pixels||(s.leadInside&&s.tabs===0)||s.heads!==s.n||s.faces.some(f=>f!==s.face)||s.handles.some(o=>s.on?o!==.85:o!==0));
    console.log(`${tag}: ${report.scenes.length} scenes, ${report.failures.length} failures; collision ${report.collision.pixels}px / ${report.collision.bad.length} elements`);
  }
  if(tag.startsWith('after')){
    assert.equal(report.connectDialog,1,'가운데 손잡이 F2');
    assert.equal(report.dialogLabel,1,'열린 대화상자의 이름표 예외');
    assert.equal(report.collision.pixels,0,'옮긴 이름표의 칸 안 초록');
    assert.equal(report.collision.bad.length,0,'옮긴 이름표의 칸 안 장식');
    assert.equal(report.failures?.length||0,0,'조합 검사');
  }
} finally {
  fs.writeFileSync(path.join(OUT,`${tag}.json`),JSON.stringify(report,null,2));
  await closeApp(app);
}
