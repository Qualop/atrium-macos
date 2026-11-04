import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {macCliDirectories} from '../src/main/cli-paths.mjs';
test('portable app discovers recipient CLI directories and nvm versions without builder paths',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'atrium-cli-home-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 for(const dir of ['.local/bin','.nvm/versions/node/v22.23.4/bin','.nvm/versions/node/v26.13.0/bin','.nvm/versions/node/not-a-version/bin'])fs.mkdirSync(path.join(home,dir),{recursive:true});
 const dirs=macCliDirectories(home,{});assert.ok(dirs.includes(path.join(home,'.local/bin')));assert.ok(dirs.indexOf(path.join(home,'.nvm/versions/node/v26.13.0/bin'))<dirs.indexOf(path.join(home,'.nvm/versions/node/v22.23.4/bin')));assert.ok(!dirs.some(d=>d.includes('not-a-version')));
});
