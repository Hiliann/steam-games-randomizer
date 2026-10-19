export const DIAGNOSTIC_LIMIT = 64 * 1024;
export const STORE_NAMES = ['profile','exclusions','display','application','appearance'];
export const DIAGNOSTIC_AREAS = ['library','storage','update','steam','http'];
export const DIAGNOSTIC_CODES = ['scan-failed','scan-incomplete','request-rejected','request-failed'];
export const INSTALL_STAGES = ['unknown','idle','starting','downloading','verifying','ready','applying','complete','failed','cancelled','cancelling'];
export const STORE_DETAIL_STATES = ['not-requested','idle','loading','blocked','disabled'];
export const UPDATE_REASONS = ['interrupted','launch-failed','prepare-failed','apply-failed','rollback-failed','cancelled','status-unavailable','unknown'];
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000;
const version=value=>typeof value==='string'&&/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(value);
const invalid=()=>new Error('Приложение вернуло некорректный отчёт диагностики.');

export function validateDiagnosticReport(value) {
  if(!exact(value,['format','version','application','library','stores','update','events'])||value.format!=='play-next-diagnostics'||value.version!==1)throw invalid();
  const app=value.application,library=value.library,update=value.update;
  if(!exact(app,['version','node','platform','architecture','systemRelease','desktopWindow'])||!version(app.version)||!version(app.node)
    ||!['win32','linux','darwin','other'].includes(app.platform)||!['x64','arm64','ia32','other'].includes(app.architecture)
    ||typeof app.systemRelease!=='string'||!(/^(?:\d{1,8}\.){0,3}\d{1,8}$/.test(app.systemRelease)||app.systemRelease==='unknown')||typeof app.desktopWindow!=='boolean')throw invalid();
  if(!exact(library,['status','installedGames','uninstalledGames','libraries','unavailableLibraries','warnings','skipped','ownedCache','storeDetails','storeDetailsKnown','storeDetailsMissing'])
    ||!['not-scanned','ready','partial','failed'].includes(library.status)||!['not-requested','ready','partial','unavailable','unknown'].includes(library.ownedCache)
    ||!STORE_DETAIL_STATES.includes(library.storeDetails)
    ||['installedGames','uninstalledGames','libraries','unavailableLibraries','warnings','skipped','storeDetailsKnown','storeDetailsMissing'].some(key=>!count(library[key])))throw invalid();
  if(!exact(value.stores,STORE_NAMES)||STORE_NAMES.some(key=>!['missing','readable','unreadable'].includes(value.stores[key])))throw invalid();
  if(!exact(update,['check','installation','reason'])||!['not-checked','ready','offline','unknown'].includes(update.check)||!INSTALL_STAGES.includes(update.installation)
    ||!(update.reason===null||UPDATE_REASONS.includes(update.reason)))throw invalid();
  if(!Array.isArray(value.events)||value.events.length>40||value.events.some(event=>!exact(event,['area','code','status','occurrences'])
    ||!DIAGNOSTIC_AREAS.includes(event.area)||!DIAGNOSTIC_CODES.includes(event.code)||!(event.status===null||Number.isInteger(event.status)&&event.status>=400&&event.status<=599)
    ||!count(event.occurrences)||event.occurrences<1))throw invalid();
  return value;
}

const CONTENTS = `Play Next diagnostic archive / Диагностический архив Play Next

diagnostics.json: the complete report shown before saving.
CONTENTS.txt: this description.

Includes: application/runtime/system versions, library counts and cache status,
numbers of games with and without loaded Store genres,
settings-file health, last known update status, fixed error codes from this session.
No game IDs or titles, accounts, credentials, paths, settings values, categories,
play history, screenshots, raw logs, environment variables or machine identifiers.
No precise timestamps. No automatic upload. This archive is not a settings backup.

diagnostics.json содержит весь отчёт, показанный перед сохранением.
Включены версии, сводные количества и статусы, число игр с загруженными
и незагруженными жанрами Steam Store, состояние файлов настроек,
последний известный статус обновления и технические коды ошибок этой сессии.
Имена игр, аккаунты, токены, пути, категории, история, настройки и исходные журналы
не включаются. Архив не отправляется автоматически и не заменяет резервную копию.
`;
const encoder=new TextEncoder();
const crcTable=Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes){let value=0xffffffff;for(const byte of bytes)value=crcTable[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}

// ZIP method 0 (stored), fixed ASCII names, UTF-8 content, CRC32 and no extra
// metadata. No dependencies or user-controlled paths. ZIP64 is unnecessary.
export function encodeDiagnosticArchive(report) {
  validateDiagnosticReport(report);
  const preview=JSON.stringify(report,null,2)+'\n';
  const entries=[['diagnostics.json',encoder.encode(preview)],['CONTENTS.txt',encoder.encode(CONTENTS)]];
  const payload=entries.reduce((n,[name,bytes])=>n+bytes.length+76+name.length*2,22);
  if(payload>DIAGNOSTIC_LIMIT)throw invalid();
  const archive=new Uint8Array(payload),view=new DataView(archive.buffer),records=[];
  let offset=0;
  for(const[name,bytes]of entries){
    const filename=encoder.encode(name),start=offset,crc=crc32(bytes);
    view.setUint32(offset,0x04034b50,true);view.setUint16(offset+4,20,true);view.setUint16(offset+6,0x800,true);
    view.setUint16(offset+12,33,true);view.setUint32(offset+14,crc,true);
    view.setUint32(offset+18,bytes.length,true);view.setUint32(offset+22,bytes.length,true);view.setUint16(offset+26,filename.length,true);
    archive.set(filename,offset+30);archive.set(bytes,offset+30+filename.length);offset+=30+filename.length+bytes.length;
    records.push({filename,bytes,crc,start});
  }
  const central=offset;
  for(const{filename,bytes,crc,start}of records){
    view.setUint32(offset,0x02014b50,true);view.setUint16(offset+4,20,true);view.setUint16(offset+6,20,true);view.setUint16(offset+8,0x800,true);
    view.setUint16(offset+14,33,true);view.setUint32(offset+16,crc,true);view.setUint32(offset+20,bytes.length,true);view.setUint32(offset+24,bytes.length,true);
    view.setUint16(offset+28,filename.length,true);view.setUint32(offset+42,start,true);archive.set(filename,offset+46);offset+=46+filename.length;
  }
  const centralSize=offset-central;
  view.setUint32(offset,0x06054b50,true);view.setUint16(offset+8,entries.length,true);view.setUint16(offset+10,entries.length,true);
  view.setUint32(offset+12,centralSize,true);view.setUint32(offset+16,central,true);
  return {bytes:archive,preview,filename:`PlayNext-diagnostics-${report.application.version}.zip`,files:entries.map(([name,bytes])=>({name,bytes:bytes.length}))};
}

export function createDiagnosticsClient(send=globalThis.fetch) {
  const archives=new WeakMap();
  return {
    async prepare(signal){
      const timeout=AbortSignal.timeout(15000);
      const response=await send('/api/diagnostics',{method:'POST',headers:{'Content-Type':'application/json','X-Randomizer':'1'},body:'{}',signal:signal?AbortSignal.any([signal,timeout]):timeout});
      // Bound response size even if a broken local service returns a wrong body.
      if(Number(response.headers.get('content-length'))>DIAGNOSTIC_LIMIT)throw invalid();
      const reader=response.body?.getReader();if(!reader)throw invalid();
      const chunks=[];let length=0;
      try{
        while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>DIAGNOSTIC_LIMIT){await reader.cancel();throw invalid();}chunks.push(part.value);}
      }finally{reader.releaseLock();}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const text=new TextDecoder().decode(bytes);
      let report;try{report=JSON.parse(text);}catch{throw invalid();}
      if(!response.ok)throw new Error('Не удалось подготовить диагностику. Попробуй ещё раз.');
      const result=encodeDiagnosticArchive(report);
      const prepared=Object.freeze({preview:result.preview,filename:result.filename,bytes:result.bytes.length,files:Object.freeze(result.files.map(Object.freeze))});
      archives.set(prepared,new Blob([result.bytes],{type:'application/zip'}));return prepared;
    },
    archive(prepared){const blob=archives.get(prepared);if(!blob)throw invalid();return blob;},
    discard(prepared){archives.delete(prepared);},
  };
}
