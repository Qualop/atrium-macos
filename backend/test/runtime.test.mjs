import test from 'node:test';import assert from 'node:assert/strict';import {supportedNode,requireSupportedNode,NODE_RANGE} from '../src/runtime.mjs';
test('supported runtime range includes maintained LTS minimums and rejects unsupported/preview runtimes',()=>{
 for(const v of ['22.13.0','22.23.4','24.0.0','24.22.2','26.0.0','26.13.0']) {assert.equal(supportedNode(v),true,v);assert.doesNotThrow(()=>requireSupportedNode(v));}
 for(const v of ['20.20.0','22.12.0','23.11.0','25.0.0','27.0.0-alpha.1','28.0.0','bad']) {assert.equal(supportedNode(v),false,v);assert.throws(()=>requireSupportedNode(v),/Node.js/);}
 assert.equal(NODE_RANGE,'^22.13.0 || ^24.0.0 || ^26.0.0');
});
