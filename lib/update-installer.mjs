import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseVersion } from './update-check.mjs';
import { atomicUpdateJson, readUpdateJson, cleanUpdateState, ACTIVE_UPDATE_STAGES, validAttempt } from './update-state.mjs';

const moduleDirectory=path.dirname(fileURLToPath(import.meta.url));
const defaultScript=path.join(moduleDirectory,'..','scripts','apply-update.ps1');
const invalid=(message,status=400)=>Object.assign(new Error(message),{status});
function expectedUrl(value,version,checksum=false) {
  if(typeof value!=='string')return false;
  try {
    const url=new URL(value);
    return url.origin==='https://github.com' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname==='/Hiliann/steam-games-randomizer/releases/download/v'+version+'/PlayNext-'+version+'-win-x64.zip'+(checksum?'.sha256':'');
  }catch{return false;}
}
export function runUpdatePowerShell(scriptPath,options) {
  const systemRoot=process.env.SystemRoot??process.env.SYSTEMROOT??'C:\\Windows';
  const powershell=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  return new Promise((resolve,reject)=>{
    const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath,
      '-Version',options.version,'-DownloadUrl',options.downloadUrl,'-ChecksumUrl',options.checksumUrl,
      '-ProcessId',String(options.processId),'-Port',String(options.port),'-DesktopProcessId',String(options.desktopProcessId??0),'-AttemptId',options.attemptId];
    if(options.automatic)args.push('-Automatic');
    // Give the installer its own hidden Windows console. DETACHED_PROCESS can
    // prevent Windows PowerShell from running at all; inheriting Node's console
    // can terminate the installer when that console closes during replacement.
    const quote=value=>"'"+value.replaceAll("'","''")+"'";
    const argumentsLine=args.map(value=>'"'+value+'"').join(' ');
    const command='Start-Process -FilePath '+quote(powershell)+' -ArgumentList '+quote(argumentsLine)+' -WindowStyle Hidden -ErrorAction Stop';
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{cwd:path.dirname(scriptPath),windowsHide:true,stdio:'ignore'});
    child.once('error',reject);
    child.once('close',code=>code===0?resolve(child.pid):reject(new Error('Could not start the Windows updater.')));
  });
}
export function createUpdateInstaller({platform=process.platform,scriptPath=defaultScript,runner=runUpdatePowerShell,
  statusFile=path.join(path.dirname(scriptPath),'..','data','update-status.json'),
  requestFile=path.join(path.dirname(statusFile),'update-request.json'),clock=Date.now,
  alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}}}={}) {
  let chain=Promise.resolve();
  const serial=operation=>{const next=chain.then(operation);chain=next.catch(()=>{});return next;};
  async function read() {
    let state;
    try { const source=await readUpdateJson(statusFile); if(!source)return {stage:'idle'};state=cleanUpdateState(source); }
    catch{return {stage:'failed',reason:'status-unavailable',targetVersion:null};}
    if(ACTIVE_UPDATE_STAGES.includes(state.stage) && ((clock()-Date.parse(state.updatedAt)>30000 && (!state.updaterProcessId||!alive(state.updaterProcessId))) || clock()-Date.parse(state.startedAt)>30*60*1000)) {
      state={...state,stage:'failed',reason:'interrupted',updatedAt:new Date(clock()).toISOString()};
      await atomicUpdateJson(statusFile,state);
    }
    const request=await readUpdateJson(requestFile).catch(()=>null);
    if(ACTIVE_UPDATE_STAGES.includes(state.stage) && request?.attemptId===state.attemptId) {
      if(request.action==='cancel' && state.stage!=='applying')state.stage='cancelling';
      if(request.action==='apply' && state.stage==='ready')state.stage='applying';
    }
    if(state.stage==='failed')state.automaticRetryAllowed=state.reason!=='rollback-failed'&&clock()-Date.parse(state.updatedAt)>=24*60*60*1000;
    return state;
  }
  return { read,
    install:options=>serial(async()=>{
      if(platform!=='win32')throw invalid('Автоматическая установка доступна только в Windows.',503);
      if(!options || typeof options.version!=='string'||!/^\d+\.\d+\.\d+$/.test(options.version)||!parseVersion(options.version) || !expectedUrl(options.downloadUrl,options.version) || !expectedUrl(options.checksumUrl,options.version,true)
        || !Number.isInteger(options.processId)||options.processId<1||options.processId>0x7fffffff
        || !Number.isInteger(options.port)||options.port<1||options.port>65535
        || (options.automatic!==undefined&&typeof options.automatic!=='boolean')
        || (options.desktopProcessId!==undefined&&(!Number.isInteger(options.desktopProcessId)||options.desktopProcessId<0||options.desktopProcessId>0x7fffffff)))throw invalid('Релиз не прошёл проверку перед установкой.');
      const previous=await read();
      if(ACTIVE_UPDATE_STAGES.includes(previous.stage))throw invalid('Установка обновления уже началась.',409);
      if(options.automatic && previous.stage==='failed' && (['rollback-failed','status-unavailable'].includes(previous.reason)||(previous.automaticRetryAllowed!==true&&previous.targetVersion===options.version)))throw invalid('Автообновление этой версии не удалось. Повтори установку вручную в настройках.',409);
      const attemptId=randomUUID().replaceAll('-','');
      const at=new Date(clock()).toISOString();
      const state={version:1,attemptId,stage:'starting',targetVersion:options.version,automatic:options.automatic===true,startedAt:at,updatedAt:at,updaterProcessId:0};
      await atomicUpdateJson(requestFile,{attemptId,action:'wait'});
      await atomicUpdateJson(statusFile,state);
      try { await runner(scriptPath,{...options,attemptId,automatic:state.automatic}); }
      catch(cause) {await atomicUpdateJson(statusFile,{...state,stage:'failed',reason:'launch-failed'});throw Object.assign(invalid('Не удалось запустить установщик обновления.',503),{cause});}
      return {status:'preparing',attemptId,targetVersion:options.version};
    }),
    apply:options=>serial(async()=>{
      if(!options||!validAttempt(options.attemptId)||typeof options.restartMinimized!=='boolean')throw invalid('Некорректный запрос применения обновления.');
      const state=await read();
      if(state.attemptId!==options.attemptId||!['ready','applying'].includes(state.stage))throw invalid('Обновление ещё не готово или было отменено.',409);
      await atomicUpdateJson(requestFile,{attemptId:state.attemptId,action:'apply',restartMinimized:options.restartMinimized});
      return {status:'applying',attemptId:state.attemptId,targetVersion:state.targetVersion};
    }),
    cancel:attemptId=>serial(async()=>{
      if(!validAttempt(attemptId))throw invalid('Некорректный запрос отмены обновления.');
      const state=await read();
      if(state.attemptId!==attemptId||!ACTIVE_UPDATE_STAGES.includes(state.stage)||state.stage==='applying')throw invalid('Замена файлов уже началась или обновление завершено.',409);
      await atomicUpdateJson(requestFile,{attemptId,action:'cancel'});
      return {status:'cancelling',attemptId};
    }),
  };
}
