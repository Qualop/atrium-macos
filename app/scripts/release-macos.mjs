import { assertMacosVersions } from '../../backend/src/update-version.mjs';
// Package an already verified .app into portable ZIP/DMG assets. Publishing is
// separate, so failed preparation never creates a half-finished GitHub release.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('macOS에서 실행하세요.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const version=JSON.parse(fs.readFileSync(path.join(root,'app/package.json'),'utf8')).version;
const bundle=path.join(root,'out/Atrium.app'), plist=path.join(bundle,'Contents/Info.plist');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const resources=path.join(bundle,'Contents/Resources');
const metadata=readJson(path.join(resources,'runtime/update-manifest.json'));
const plistValue=key=>execFileSync('/usr/libexec/PlistBuddy',['-c',`Print :${key}`,plist],{encoding:'utf8'}).trim();
assertMacosVersions(version,{shortVersion:plistValue('CFBundleShortVersionString'),bundleVersion:plistValue('CFBundleVersion'),appVersion:readJson(path.join(resources,'app/package.json')).version,backendVersion:readJson(path.join(resources,'backend/package.json')).version,manifestVersion:metadata.version,manifestBaseVersion:metadata.baseVersion,manifestBundleVersion:metadata.bundleVersion});
if(readJson(path.join(root,'backend/package.json')).version!==version)throw Error('Source app/backend release versions disagree.');
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
const node=path.join(bundle,'Contents/Resources/runtime/node');
const arch=execFileSync(node,['-p','process.arch'],{encoding:'utf8'}).trim();
if(!['arm64','x64'].includes(arch))throw Error('Unsupported architecture');
execFileSync('/usr/bin/lipo',['-verify_arch',arch==='x64'?'x86_64':'arm64',path.join(bundle,'Contents/MacOS/Electron')]);
const output=path.join(root,'release',`v${version}`);if(fs.existsSync(output))throw Error(`이미 있는 릴리스 폴더를 먼저 옮기세요: ${output}`);
fs.mkdirSync(path.dirname(output),{recursive:true});const staging=fs.mkdtempSync(path.join(path.dirname(output),'.release-'));const volume=fs.mkdtempSync(path.join(os.tmpdir(),'atrium-dmg-'));
try{
 const stem=`Atrium-${version}-macos-${arch}`, zip=path.join(staging,stem+'.zip'),dmg=path.join(staging,stem+'.dmg');
 execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',bundle,zip]);
 execFileSync('/usr/bin/ditto',[bundle,path.join(volume,'Atrium.app')]);
 fs.symlinkSync('/Applications',path.join(volume,'Applications'));
 fs.writeFileSync(path.join(volume,'Read Me.txt'),`Atrium ${version}\n\nDrag Atrium.app to Applications. Node and herdr are included. Install and sign in to your agent CLI separately.\n\nThis build is ad-hoc signed, not Apple-notarized. macOS may require an explicit Open Anyway in Privacy & Security.\n\nSource and licenses: https://github.com/Qualop/atrium-macos\nBundled licenses are in Atrium.app/Contents/Resources/licenses.\n`);
 execFileSync('/usr/bin/hdiutil',['create','-volname',`Atrium ${version}`,'-srcfolder',volume,'-format','UDZO',dmg],{stdio:'inherit'});
 const sums=[zip,dmg].map(file=>`${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`).join('\n')+'\n';
 fs.writeFileSync(path.join(staging,'SHA256SUMS.txt'),sums);fs.renameSync(staging,output);console.log(output);
}finally{fs.rmSync(staging,{recursive:true,force:true});fs.rmSync(volume,{recursive:true,force:true});}
