import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createUpdateInstaller,runUpdatePowerShell} from '../lib/update-installer.mjs';
import {atomicUpdateJson} from '../lib/update-state.mjs';

const options={version:'2.5.0',downloadUrl:'https://github.com/Hiliann/steam-games-randomizer/releases/download/v2.5.0/PlayNext-2.5.0-win-x64.zip',checksumUrl:'https://github.com/Hiliann/steam-games-randomizer/releases/download/v2.5.0/PlayNext-2.5.0-win-x64.zip.sha256',processId:42,port:3210,desktopProcessId:43};
async function fixture(t,extras={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'playnext-update-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const statusFile=path.join(root,'data/update-status.json'),requestFile=path.join(root,'data/update-request.json'),calls=[];
  const settings={platform:'win32',scriptPath:path.join(root,'scripts/apply-update.ps1'),statusFile,requestFile,runner:async(...args)=>{calls.push(args);return 99;},alive:()=>true,...extras};
  const installer=createUpdateInstaller(settings);
  async function stage(value){const before=JSON.parse(await readFile(statusFile,'utf8'));await atomicUpdateJson(statusFile,{...before,stage:value,updaterProcessId:99});}
  return {installer,settings,statusFile,requestFile,calls,stage};
}
test('preparation is persistent, deduplicated and cannot apply before verification',async t=>{
  const f=await fixture(t);assert.deepEqual(await f.installer.read(),{stage:'idle'});
  const receipt=await f.installer.install(options);
  assert.equal(receipt.status,'preparing');assert.match(receipt.attemptId,/^[a-f0-9]{32}$/);
  assert.equal(f.calls.length,1);assert.equal((await f.installer.read()).stage,'starting');
  await assert.rejects(f.installer.install(options),{status:409});
  await assert.rejects(f.installer.apply({attemptId:receipt.attemptId,restartMinimized:false}),{status:409});
  await f.stage('ready');
  const restarted=createUpdateInstaller(f.settings);
  assert.equal((await restarted.read()).attemptId,receipt.attemptId);
  const apply=await restarted.apply({attemptId:receipt.attemptId,restartMinimized:true});
  assert.equal(apply.status,'applying');assert.equal((await restarted.read()).stage,'applying');
  assert.equal(JSON.parse(await readFile(f.requestFile,'utf8')).restartMinimized,true);
  await assert.rejects(restarted.cancel(receipt.attemptId),{status:409});
});
test('cancellation before application cannot be overridden by an apply request',async t=>{
  const f=await fixture(t);const receipt=await f.installer.install(options);await f.stage('ready');
  await f.installer.cancel(receipt.attemptId);assert.equal((await f.installer.read()).stage,'cancelling');
  await assert.rejects(f.installer.apply({attemptId:receipt.attemptId,restartMinimized:false}),{status:409});
});
test('launch failure prevents automatic retry loops but allows an explicit manual retry',async t=>{
  const f=await fixture(t,{runner:async()=>{throw new Error('Simulated spawn failure');}});
  await assert.rejects(f.installer.install({...options,automatic:true}),{status:503});
  assert.equal((await f.installer.read()).reason,'launch-failed');
  const calls=[];const retry=createUpdateInstaller({...f.settings,runner:async()=>calls.push(1)});
  await assert.rejects(retry.install({...options,automatic:true}),{status:409});assert.equal(calls.length,0);
  assert.equal((await retry.install({...options,automatic:false})).status,'preparing');assert.equal(calls.length,1);
});
test('invalid URLs, attempts and options are rejected before launching',async t=>{
  const f=await fixture(t);
  for(const downloadUrl of ['https://example.com/a.zip',options.downloadUrl+'?x=1',options.downloadUrl+'#x',options.downloadUrl.replace('github.com','github.com:444'),options.downloadUrl.replace('github.com','user@github.com')])await assert.rejects(f.installer.install({...options,downloadUrl}),{status:400});
  await assert.rejects(f.installer.install({...options,automatic:'yes'}),{status:400});
  await assert.rejects(f.installer.cancel('../other'),{status:400});assert.equal(f.calls.length,0);
});
test('interrupted helpers do not strand an update forever and malformed state is preserved',async t=>{
  let now=Date.parse('2026-10-15T00:00:00Z');const f=await fixture(t,{clock:()=>now,alive:()=>false});
  await f.installer.install(options);now+=31000;
  assert.equal((await f.installer.read()).reason,'interrupted');
  await writeFile(f.statusFile,'{invalid');
  assert.deepEqual(await f.installer.read(),{stage:'failed',reason:'status-unavailable',targetVersion:null});
  await assert.rejects(f.installer.install({...options,automatic:true}),{status:409});
  assert.equal(await readFile(f.statusFile,'utf8'),'{invalid');
});

test('a failed automatic attempt can retry on a later startup only after a full day',async t=>{
  let now=Date.parse('2026-10-16T00:00:00Z');
  const f=await fixture(t,{clock:()=>now,runner:async()=>{throw new Error('Unavailable');}});
  await assert.rejects(f.installer.install({...options,automatic:true}));
  assert.equal((await f.installer.read()).automaticRetryAllowed,false);
  now+=24*60*60*1000;
  assert.equal((await f.installer.read()).automaticRetryAllowed,true);
  const next=createUpdateInstaller({...f.settings,runner:async()=>99});
  assert.equal((await next.install({...options,automatic:true})).status,'preparing');
});

test('rollback recovery files prevent all automatic retries, even for newer versions',async t=>{
  const f=await fixture(t);await f.installer.install(options);
  const state=JSON.parse(await readFile(f.statusFile,'utf8'));
  await atomicUpdateJson(f.statusFile,{...state,stage:'failed',reason:'rollback-failed',updatedAt:'2020-01-01T00:00:00Z'});
  assert.equal((await f.installer.read()).automaticRetryAllowed,false);
  await assert.rejects(f.installer.install({...options,automatic:true}),{status:409});
  const version='2.6.0';await assert.rejects(f.installer.install({...options,automatic:true,version,downloadUrl:options.downloadUrl.replaceAll('2.5.0',version),checksumUrl:options.checksumUrl.replaceAll('2.5.0',version)}),{status:409});
});

test('Windows helper really executes after its hidden bootstrap exits, including quoted paths',{skip:process.platform!=='win32'},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"playnext updater 'quoted' "));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const script=path.join(root,'update helper.ps1'),marker=path.join(root,'executed.json');
  await writeFile(script,"param($Version,$DownloadUrl,$ChecksumUrl,$ProcessId,$Port,$DesktopProcessId,$AttemptId,[switch]$Automatic)\nStart-Sleep -Milliseconds 250\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'executed.json'),($PSBoundParameters | ConvertTo-Json -Compress))");
  const attemptId='d'.repeat(32);
  await runUpdatePowerShell(script,{...options,attemptId,automatic:true});
  let actual;const until=Date.now()+10000;
  while(Date.now()<until){try{actual=JSON.parse(await readFile(marker,'utf8'));break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  assert.equal(actual?.AttemptId,attemptId);assert.equal(actual?.Version,options.version);assert.equal(actual?.Automatic?.IsPresent,true);
});
