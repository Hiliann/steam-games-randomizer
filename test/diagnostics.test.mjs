import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {crc32} from 'node:zlib';
import {createDiagnosticsService} from '../lib/diagnostics.mjs';
import {validateDiagnosticReport,encodeDiagnosticArchive,createDiagnosticsClient,STORE_NAMES} from '../public/diagnostics.js';

const runtime={node:'24.20.0',platform:'win32',architecture:'x64',systemRelease:'10.0.26100'};
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'playnext-diagnostics-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const stores={};for(const name of STORE_NAMES){const file=path.join(root,name+'.json');await writeFile(file,JSON.stringify({secret:'private-token-'+name}));stores[name]={file,read:async()=>JSON.parse(await readFile(file,'utf8'))};}
  const service=createDiagnosticsService({appVersion:'2.6.0',runtime,stores,desktopWindow:true});
  return{root,stores,service};
}
test('diagnostics allowlists fields instead of exporting account, game, path or raw error data',async t=>{
  const f=await fixture(t),secret='PRIVATE_DO_NOT_EXPORT';
  f.service.record('storage','request-failed',503);f.service.record(secret,secret,secret);
  const report=await f.service.collect({snapshot:{games:[{id:'123',name:secret,installed:true},{name:secret,installed:false}],libraries:[{path:secret,available:false}],warnings:[secret],skipped:2,cacheRoots:[secret],ownedLibrary:{status:'partial',accountName:secret}},updateCheck:{status:'offline',token:secret},installation:{stage:'failed',reason:secret,attemptId:secret}});
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE|private-token|123|attemptId|accountName|cacheRoots|warnings":\[/);
  assert.equal(report.library.installedGames,1);assert.equal(report.library.uninstalledGames,1);assert.equal(report.library.status,'partial');
  assert.equal(report.update.reason,'unknown');assert.deepEqual(report.events,[{area:'storage',code:'request-failed',status:503,occurrences:1}]);
  assert.deepEqual(Object.values(report.stores),Array(5).fill('readable'));validateDiagnosticReport(report);
});
test('collection leaves saved stores and raw log files exactly unchanged',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.root,'.launcher-error.log'),'private-path-and-token');
  const names=await readdir(f.root),before=await Promise.all(names.map(name=>readFile(path.join(f.root,name),'utf8')));
  const report=await f.service.collect();assert.equal(report.library.status,'not-scanned');
  assert.deepEqual(await readdir(f.root),names);assert.deepEqual(await Promise.all(names.map(name=>readFile(path.join(f.root,name),'utf8'))),before);
  assert.doesNotMatch(JSON.stringify(report),/private-path-and-token/);
});

test('an unavailable Steam library makes the snapshot partial even without warning text',async t=>{
  const report=await(await fixture(t)).service.collect({snapshot:{games:[],libraries:[{available:false}],warnings:[]}});
  assert.equal(report.library.status,'partial');assert.equal(report.library.unavailableLibraries,1);
});
test('missing and damaged stores remain distinct and do not leak exception messages',async t=>{
  const f=await fixture(t);await rm(f.stores.profile.file);await writeFile(f.stores.exclusions.file,'{broken-private-token');
  await rm(f.stores.display.file);await mkdir(f.stores.display.file);
  const report=await f.service.collect({scanFailed:true});
  assert.equal(report.stores.profile,'missing');assert.equal(report.stores.exclusions,'unreadable');assert.equal(report.stores.display,'unreadable');
  assert.equal(report.library.status,'failed');assert.doesNotMatch(JSON.stringify(report),/broken-private-token|Unexpected|[A-Z]:\\/);
  assert.equal(await readFile(f.stores.exclusions.file,'utf8'),'{broken-private-token');
});
test('structured session events are bounded, aggregate duplicates and accept no free text',async t=>{
  const f=await fixture(t);for(let i=0;i<10;i++)f.service.record('http','request-rejected',400);
  assert.equal((await f.service.collect()).events[0].occurrences,10);
  for(let i=0;i<100;i++)f.service.record(i%2?'http':'storage','request-failed',500);
  const report=await f.service.collect();assert.equal(report.events.length,40);
  report.events[0].code='mutated';assert.equal((await f.service.collect()).events[0].code,'request-failed');
});
test('report validation rejects added fields and sensitive strings at every nested boundary',async t=>{
  const report=await(await fixture(t)).service.collect();
  for(const modify of [r=>r.username='secret',r=>r.application.hostname='secret',r=>r.library.games=[],r=>r.stores.custom='secret',r=>r.update.url='secret',r=>r.events.push({area:'http',code:'request-failed',status:500,occurrences:1,message:'secret'}),r=>r.application.systemRelease='C:\\private',r=>r.update.reason='private-token']){
    const bad=structuredClone(report);modify(bad);assert.throws(()=>validateDiagnosticReport(bad));assert.throws(()=>encodeDiagnosticArchive(bad));
  }
});
export function unzipStored(bytes){
  const buffer=Buffer.from(bytes),entries=new Map();let offset=0;
  while(buffer.readUInt32LE(offset)===0x04034b50){
    assert.equal(buffer.readUInt16LE(offset+6),0x800);assert.equal(buffer.readUInt16LE(offset+8),0);
    const size=buffer.readUInt32LE(offset+18),nameBytes=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28);
    assert.equal(extra,0);const name=buffer.subarray(offset+30,offset+30+nameBytes).toString('utf8');
    const data=buffer.subarray(offset+30+nameBytes,offset+30+nameBytes+size);assert.equal(crc32(data),buffer.readUInt32LE(offset+14));
    assert.equal(entries.has(name),false);entries.set(name,data.toString('utf8'));offset+=30+nameBytes+size;
  }
  const end=buffer.length-22;assert.equal(buffer.readUInt32LE(end),0x06054b50);assert.equal(buffer.readUInt16LE(end+8),2);assert.equal(buffer.readUInt32LE(end+16),offset);
  return entries;
}
test('the ZIP contains exactly the reviewed JSON and a fixed description with valid CRC32',async t=>{
  const report=await(await fixture(t)).service.collect();const archive=encodeDiagnosticArchive(report),entries=unzipStored(archive.bytes);
  assert.deepEqual([...entries.keys()],['diagnostics.json','CONTENTS.txt']);assert.equal(entries.get('diagnostics.json'),archive.preview);
  assert.deepEqual(JSON.parse(entries.get('diagnostics.json')),report);assert.match(entries.get('CONTENTS.txt'),/No automatic upload/);
  assert.equal(archive.filename,'PlayNext-diagnostics-2.6.0.zip');assert.ok(archive.bytes.length<65536);
  assert.deepEqual(encodeDiagnosticArchive(report).bytes,archive.bytes,'No hidden timestamps or machine IDs');
});
test('the diagnostic client freezes the preview and downloads only its exact prepared bytes',async t=>{
  const report=await(await fixture(t)).service.collect(),requests=[];
  const client=createDiagnosticsClient(async(route,options)=>{requests.push({route,options});return new Response(JSON.stringify(report));});
  const prepared=await client.prepare();assert.equal(requests.length,1);assert.equal(requests[0].route,'/api/diagnostics');assert.equal(requests[0].options.body,'{}');
  assert.equal(requests[0].options.headers['X-Randomizer'],'1');assert.equal(Object.isFrozen(prepared),true);
  report.library.installedGames=99;const zip=unzipStored(await client.archive(prepared).arrayBuffer());
  assert.equal(zip.get('diagnostics.json'),prepared.preview);assert.equal(JSON.parse(zip.get('diagnostics.json')).library.installedGames,0);
  assert.throws(()=>client.archive({...prepared}));client.discard(prepared);assert.throws(()=>client.archive(prepared));assert.equal(requests.length,1);
});
test('a forged report or an error response cannot be saved as diagnostics',async()=>{
  for(const response of [new Response('{broken'),new Response(JSON.stringify({error:'private-token'}),{status:500}),new Response('x'.repeat(65537))]){
    const client=createDiagnosticsClient(async()=>response);await assert.rejects(client.prepare(),error=>!error.message.includes('private-token'));
  }
});
