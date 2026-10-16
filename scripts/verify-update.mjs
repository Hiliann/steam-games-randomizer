import assert from 'node:assert/strict';
import {readFile,writeFile,cp,mkdir,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {getInstanceId} from '../server.mjs';
import {createExclusionsStore} from '../lib/exclusions.mjs';
import {createDisplayStore} from '../lib/display-settings.mjs';
import {createAppSettingsStore} from '../lib/app-settings.mjs';
import {createUiSettingsStore} from '../lib/ui-settings.mjs';
import {createProfileStore} from '../lib/profile.mjs';
import {UI_DEFAULTS} from '../public/ui-settings.js';

// Generated fixtures never touch the installed app or real Steam metadata.
const source=path.resolve(process.argv[2]??'');
if(process.platform!=='win32'||!process.argv[2])throw new Error('Pass a clean Windows package directory.');
await access(path.join(source,'release-manifest.json'));
try{await access(path.join(source,'data'));throw new Error('Use an unused package, not a personal app folder.');}catch(error){if(error.code!=='ENOENT')throw error;}
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.join(project,'dist','update-smoke-'+randomUUID());await mkdir(root,{recursive:true});
const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const exec=promisify(execFile),quote=value=>"'"+value.replaceAll("'","''")+"'";
const ps=command=>exec(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const currentVersion=(await json(path.join(source,'package.json'))).version;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,limit=90000){const until=Date.now()+limit;let last;while(Date.now()<until){try{const value=await check();if(value)return value;}catch(error){last=error;}await delay(250);}throw new Error('Update check timed out: '+(last?.message??''));}
const dataFiles=['exclusions.json','display-settings.json','app-settings.json','ui-settings.json','profile.json','sentinel.txt'];
async function seed(directory){
  const data=path.join(directory,'data');await mkdir(data,{recursive:true});
  await createExclusionsStore(path.join(data,dataFiles[0])).replace(['10','20']);
  await createDisplayStore(path.join(data,dataFiles[1])).replace({showUninstalledSize:false,showInstalledBadge:true});
  await createAppSettingsStore(path.join(data,dataFiles[2])).replace({automaticUpdates:true,showUpdateNotifications:false});
  await createUiSettingsStore(path.join(data,dataFiles[3])).replace({...UI_DEFAULTS,language:'en',theme:'midnight',accent:'blue'});
  await createProfileStore(path.join(data,dataFiles[4])).replace({version:1,revision:7,categories:[{id:'evening',name:'Test collection',color:'violet'}],assignments:{10:['evening']},draw:{seen:['10'],history:[{id:'10',at:'2026-10-16T00:00:00Z'}],noRepeats:true,current:'10',mode:'category:evening'}});
  await writeFile(path.join(data,dataFiles[5]),'Personal sentinel - must not change.');
  return snapshot(directory);
}
async function snapshot(directory){return Promise.all(dataFiles.map(async name=>[name,hash(await readFile(path.join(directory,'data',name)))]));}
async function stopOwned(directory){
  let record;try{record=await json(path.join(directory,'.server-process.json'));}catch{return;}
  if(record.instanceId!==getInstanceId(directory))throw new Error('Unexpected process identity.');
  for(const [pid,expected]of [[record.desktopOwner,path.join(directory,'Play Next.exe')],[record.processId,path.join(directory,'runtime/node.exe')]]){
    if(!Number.isInteger(pid)||pid<=0)continue;
    await ps(`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue;if($p){if($p.Path -ne ${quote(expected)}){throw 'Refusing to stop unrelated process.'};Stop-Process -Id ${pid} -Force};exit 0`);
  }
}
const targetVersion='9.9.9',releaseName=`PlayNext-${targetVersion}-win-x64`;
const future=path.join(root,releaseName);await cp(source,future,{recursive:true});
for(const name of ['package.json','release.json']){const value=await json(path.join(future,name));value.version=targetVersion;await writeFile(path.join(future,name),JSON.stringify(value)+'\n');}
const server=await readFile(path.join(future,'server.mjs'),'utf8');
await writeFile(path.join(future,'server.mjs'),server.replace(/export const APP_VERSION = '[^']+';/,`export const APP_VERSION = '${targetVersion}';`));
const manifest=await json(path.join(future,'release-manifest.json'));manifest.appVersion=targetVersion;
for(const item of [...manifest.files,...manifest.bootstrapFiles]){const bytes=await readFile(path.join(future,item.path));item.bytes=bytes.length;item.sha256=hash(bytes);}
await writeFile(path.join(future,'release-manifest.json'),JSON.stringify(manifest)+'\n');
const archive=path.join(root,releaseName+'.zip');
await ps(`Compress-Archive -LiteralPath ${quote(future)} -DestinationPath ${quote(archive)}`);
const checksum=archive+'.sha256';await writeFile(checksum,hash(await readFile(archive))+'  '+releaseName+'.zip\n');

const wrapper=`import {createApp} from './server-production.mjs';
import {watchDesktopOwner,desktopOwnerId} from './lib/desktop-owner.mjs';
const version='9.9.9',asset='https://github.com/Hiliann/steam-games-randomizer/releases/download/v'+version+'/PlayNext-'+version+'-win-x64.zip';
const info={status:'ready',currentVersion:'${currentVersion}',latestVersion:version,updateAvailable:true,downloadUrl:asset,checksumUrl:asset+'.sha256'};
const owner=desktopOwnerId(process.env.PLAYNEXT_DESKTOP_OWNER);
let app;const stop=()=>{app.closeBrowserSessions();app.close(()=>process.exit(0));};
app=createApp({desktopOwner:owner,onUpdateInstall:stop,onBrowserSessionsEmpty:stop,updates:{read:()=>info,check:async()=>info},scan:async()=>({games:[],libraries:[],warnings:[],cacheRoots:[],skipped:0,utilities:0})});
const unwatch=watchDesktopOwner(owner,{onExit:stop});app.once('close',unwatch);
app.listen(Number(process.env.PORT),'127.0.0.1');`;
async function nativeFixture(mode){
  const directory=path.join(root,'native-'+mode);await cp(source,directory,{recursive:true});const before=await seed(directory);
  await cp(path.join(directory,'server.mjs'),path.join(directory,'server-production.mjs'));
  await writeFile(path.join(directory,'server.mjs'),wrapper);
  const config={archive,checksum,mode,count:path.join(directory,'qa-download-count.txt')};
  await writeFile(path.join(directory,'qa-download.json'),JSON.stringify(config));
  let entry=await readFile(path.join(directory,'scripts/apply-update.ps1'),'utf8');
  if(mode==='rollback')entry=entry.replace('Invoke-PlayNextUpdate @PSBoundParameters',`$script:failedOnce=$false
function Move-Item {
  param($LiteralPath,$Destination,[switch]$Force)
  if(-not $script:failedOnce -and $Destination.EndsWith('public\\app.js')){$script:failedOnce=$true;throw 'QA: simulated replacement failure'}
  Microsoft.PowerShell.Management\\Move-Item @PSBoundParameters
}
Invoke-PlayNextUpdate @PSBoundParameters`);
  entry=entry.replace('Invoke-PlayNextUpdate @PSBoundParameters',`Invoke-PlayNextUpdate @PSBoundParameters -Download {
    param($Uri,$Destination,$Limit,$Root,$State)
    $config=Get-Content -LiteralPath (Join-Path $Root 'qa-download.json') -Raw | ConvertFrom-Json
    [IO.File]::AppendAllText($config.count,'download'+[Environment]::NewLine)
    if($Uri.EndsWith('.sha256')){
      if($config.mode -eq 'corrupt'){[IO.File]::WriteAllText($Destination,(('0'*64)+'  PlayNext-9.9.9-win-x64.zip'))}
      else{Copy-Item -LiteralPath $config.checksum -Destination $Destination}
    }else{
      if($config.mode -eq 'cancel'){Start-Sleep -Milliseconds 2000;Assert-UpdateContinuing $Root $State.attemptId}
      Copy-Item -LiteralPath $config.archive -Destination $Destination
    }
  }`);
  await writeFile(path.join(directory,'scripts/apply-update.ps1'),entry);
  const originalManifest=await json(path.join(source,'release-manifest.json'));
  const appBefore=await Promise.all([...originalManifest.files,...originalManifest.bootstrapFiles].map(async item=>[item.path,hash(await readFile(path.join(directory,item.path)))]));
  const minimized=mode!=='success-window';
  const child={pid:Number((await ps(`$p=Start-Process -FilePath ${quote(path.join(directory,'Play Next.exe'))} -WorkingDirectory ${quote(directory)} ${minimized?"-WindowStyle Hidden -ArgumentList '--minimized'":'-WindowStyle Normal'} -PassThru;$p.Id`)).stdout.trim())};
  const record=async()=>json(path.join(directory,'.server-process.json'));
  const state=async()=>json(path.join(directory,'data/update-status.json'));
  try{
    const initial=await waitFor(async()=>{const value=await record();return value.desktopOwner===child.pid?value:false;});
    const base=`http://127.0.0.1:${initial.port}`;
    const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Randomizer':'1'},body:JSON.stringify(body)});
    if(mode==='cancel'){
      await waitFor(async()=>['starting','downloading'].includes((await state()).stage));
      assert.equal((await post('/api/app-settings',{key:'automaticUpdates',value:false})).status,200);
      // Native background monitors must observe opt-out before file replacement.
      const active=await state();assert.equal((await post('/api/update-cancel',{attemptId:active.attemptId})).status,202);
    }
    const finished=await waitFor(async()=>{const value=await state();return ['complete','failed','cancelled'].includes(value.stage)?value:false;});
    if(mode==='success'||mode==='success-window'){
      assert.equal(finished.stage,'complete');
      const restarted=await waitFor(async()=>{const value=await record();if(value.desktopOwner===initial.desktopOwner)return false;const health=await fetch(`http://127.0.0.1:${value.port}/api/health`).then(r=>r.json());return health.version===targetVersion&&health.instanceId===getInstanceId(directory)?value:false;});
      assert.notEqual(restarted.processId,initial.processId);
      assert.equal((await json(path.join(directory,'data/update-request.json'))).restartMinimized,minimized);
      if(minimized)await assert.rejects(access(path.join(directory,'data/webview')), {code:'ENOENT'});
      else{
        await waitFor(async()=>{const value=await ps(`$p=Get-Process -Id ${restarted.desktopOwner} -ErrorAction Stop;if($p.Path -ne ${quote(path.join(directory,'Play Next.exe'))}){throw 'Unexpected desktop process.'};$p.MainWindowHandle.ToInt64()`);return Number(value.stdout.trim())>0;});
        await waitFor(async()=>{try{await access(path.join(directory,'data/webview'));return true;}catch{return false;}});
        await delay(3000);
        await assert.rejects(access(path.join(directory,'.launcher-error.log')), {code:'ENOENT'});
      }
    }else{
      assert.equal(finished.stage,mode==='cancel'?'cancelled':'failed');
      if(mode==='rollback'){
        assert.equal(finished.reason,'apply-failed');
        await waitFor(async()=>{const value=await record();if(value.processId===initial.processId)return false;return (await fetch(`http://127.0.0.1:${value.port}/api/health`).then(r=>r.json())).version===currentVersion;});
      }else{
        const health=await fetch(base+'/api/health').then(r=>r.json());assert.equal(health.processId,initial.processId);
      }
      assert.equal((await json(path.join(directory,'package.json'))).version,currentVersion);
      const appAfter=await Promise.all(appBefore.map(async([name])=>[name,hash(await readFile(path.join(directory,name)))]));
      assert.deepEqual(appAfter,appBefore);
      if(mode==='corrupt'){
        const attempt=finished.attemptId,count=await readFile(config.count,'utf8');
        await stopOwned(directory);await delay(2000);
        spawn(path.join(directory,'Play Next.exe'),['--minimized'],{cwd:directory,windowsHide:true,stdio:'ignore'}).once('error',()=>{});
        await waitFor(async()=>{const value=await record();return value.desktopOwner!==initial.desktopOwner?value:false;});
        await delay(6000);assert.equal((await state()).attemptId,attempt);assert.equal(await readFile(config.count,'utf8'),count);
      }
    }
    if(mode==='cancel'){
      // This was an intentional user setting change, not updater data loss.
      await createAppSettingsStore(path.join(directory,'data/app-settings.json')).replace({automaticUpdates:true,showUpdateNotifications:false});
    }
    assert.deepEqual(await snapshot(directory),before);
    console.log(JSON.stringify({scenario:mode,result:'passed',fiveStoresAndSentinelUnchanged:true}));
  }catch(error){console.error('Fixture kept at '+directory);throw error;}
  finally{await stopOwned(directory);await delay(1500);}
}
for(const mode of ['success','success-window','corrupt','cancel','rollback'])await nativeFixture(mode);

if(process.argv[3]){
  const legacy=path.resolve(process.argv[3]),directory=path.join(root,'legacy-2.4.0');
  await cp(legacy,directory,{recursive:true});const before=await seed(directory);
  const original=await readFile(path.join(legacy,'scripts/apply-update.ps1'));
  const command=`function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing)if($Uri.EndsWith('.sha256')){Copy-Item -LiteralPath ${quote(source+'.zip.sha256')} -Destination $OutFile}else{Copy-Item -LiteralPath ${quote(source+'.zip')} -Destination $OutFile}}
function Start-Process {param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle)}
& ${quote(path.join(directory,'scripts/apply-update.ps1'))} -Version ${currentVersion} -DownloadUrl 'https://github.com/Hiliann/steam-games-randomizer/releases/download/v${currentVersion}/PlayNext-${currentVersion}-win-x64.zip' -ChecksumUrl 'https://github.com/Hiliann/steam-games-randomizer/releases/download/v${currentVersion}/PlayNext-${currentVersion}-win-x64.zip.sha256' -ProcessId 2147483647 -Port 3210`;
  assert.deepEqual(await readFile(path.join(directory,'scripts/apply-update.ps1')),original);
  await ps(command);
  const expected=await json(path.join(source,'release-manifest.json'));
  for(const item of [...expected.files,...expected.bootstrapFiles])assert.equal(hash(await readFile(path.join(directory,item.path))),item.sha256,item.path);
  assert.deepEqual(await snapshot(directory),before);
  console.log(JSON.stringify({scenario:'unchanged-2.4.0-updater-to-current-package',result:'passed',fiveStoresAndSentinelUnchanged:true}));
}
console.log(JSON.stringify({fixtures:root,personalAppTouched:false}));
