import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {TerminalRelay} from '../src/relay.mjs';
test('late commands from a replaced controller cannot detach, resize or type into its replacement',()=>{
 let pid=0;const controls=[];const relay=new TerminalRelay({adapter:{openController(){const c=new EventEmitter();Object.assign(c,{pid:++pid,closed:false,input(){c.inputSent=true;},resize(){c.resized=true;},close(){c.closed=true;}});controls.push(c);return c;}},onInput(){}});
 const client={sendEvent(){}};const s={sessionId:'s',paneId:'p'};const old=relay.attach(s,100,30,client);relay.attach(s,100,30,client);
 for(const op of [()=>relay.input('s','stale',client,old.controllerPid),()=>relay.resize('s',30,10,client,old.controllerPid),()=>relay.detach('s',client,old.controllerPid)])assert.throws(op,{code:'stale_controller'});
 assert.equal(controls[1].closed,false);assert.equal(controls[1].inputSent,undefined);assert.equal(controls[1].resized,undefined);
});
