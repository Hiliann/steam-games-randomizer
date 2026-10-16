import {stat} from 'node:fs/promises';
import os from 'node:os';
import {STORE_NAMES,DIAGNOSTIC_AREAS,DIAGNOSTIC_CODES,INSTALL_STAGES,UPDATE_REASONS,validateDiagnosticReport} from '../public/diagnostics.js';

const choice=(value,allowed,fallback)=>allowed.includes(value)?value:fallback;
const count=value=>Number.isSafeInteger(value)&&value>=0?Math.min(value,1000000):0;
const safeVersion=value=>typeof value==='string'&&/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(value)?value:'0.0.0';

export function createDiagnosticsService({appVersion,stores={},desktopWindow=false,
  runtime={node:process.versions.node,platform:process.platform,architecture:process.arch,systemRelease:os.release()}}) {
  const events=[];
  function record(area,code,status=null){
    if(!DIAGNOSTIC_AREAS.includes(area)||!DIAGNOSTIC_CODES.includes(code))return;
    status=Number.isInteger(status)&&status>=400&&status<=599?status:null;
    const previous=events.at(-1);
    if(previous?.area===area&&previous.code===code&&previous.status===status)previous.occurrences=Math.min(previous.occurrences+1,1000000);
    else{events.push({area,code,status,occurrences:1});if(events.length>40)events.shift();}
  }
  async function storeHealth(entry){
    if(!entry||typeof entry.file!=='string'||typeof entry.read!=='function')return 'unreadable';
    try{
      const info=await stat(entry.file);
      if(!info.isFile())return 'unreadable';
      await entry.read();return 'readable';
    }catch(error){return error.code==='ENOENT'?'missing':'unreadable';}
  }
  async function collect({snapshot,scanFailed=false,updateCheck,installation}={}) {
    const health=Object.fromEntries(await Promise.all(STORE_NAMES.map(async name=>[name,await storeHealth(stores[name])])));
    const games=Array.isArray(snapshot?.games)?snapshot.games:[];
    const libraries=Array.isArray(snapshot?.libraries)?snapshot.libraries:[];
    const warnings=count(snapshot?.warnings?.length);
    const ownedCache=choice(snapshot?.ownedLibrary?.status,['not-requested','ready','partial','unavailable'],'unknown');
    const report={format:'play-next-diagnostics',version:1,
      application:{version:safeVersion(appVersion),node:safeVersion(runtime.node),platform:choice(runtime.platform,['win32','linux','darwin'],'other'),architecture:choice(runtime.architecture,['x64','arm64','ia32'],'other'),
        systemRelease:typeof runtime.systemRelease==='string'&&/^(?:\d{1,8}\.){0,3}\d{1,8}$/.test(runtime.systemRelease)?runtime.systemRelease:'unknown',desktopWindow:desktopWindow===true},
      library:{status:scanFailed?'failed':!snapshot?'not-scanned':warnings||libraries.some(library=>library.available===false)||ownedCache==='partial'||ownedCache==='unavailable'?'partial':'ready',
        installedGames:count(games.filter(game=>game.installed!==false).length),uninstalledGames:count(games.filter(game=>game.installed===false).length),
        libraries:count(libraries.length),unavailableLibraries:count(libraries.filter(library=>library.available===false).length),warnings,skipped:count(snapshot?.skipped),ownedCache},
      stores:health,update:{check:choice(updateCheck?.status,['not-checked','ready','offline'],'unknown'),installation:choice(installation?.stage,INSTALL_STAGES,'unknown'),
        reason:installation?.reason==null?null:choice(installation.reason,UPDATE_REASONS,'unknown')},
      events:events.map(event=>({...event}))};
    validateDiagnosticReport(report);return report;
  }
  return {record,collect};
}
