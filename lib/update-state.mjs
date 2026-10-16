import { readFile, stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

export const UPDATE_STAGES = ['starting','downloading','verifying','ready','applying','complete','failed','cancelled','cancelling'];
export const ACTIVE_UPDATE_STAGES = ['starting','downloading','verifying','ready','applying','cancelling'];
export const validAttempt = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export async function atomicUpdateJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive:true });
  const temporary=filename+'.'+randomUUID()+'.tmp';
  try {
    await writeFile(temporary,JSON.stringify(value)+'\n',{flag:'wx'});
    for(let retry=0;;retry++) {
      try { await rename(temporary,filename); break; }
      catch(error) {
        if(!['EPERM','EBUSY','EACCES'].includes(error.code)||retry>=9)throw error;
        await pause(50);
      }
    }
  }
  finally { await unlink(temporary).catch(()=>{}); }
}
export async function readUpdateJson(filename) {
  try {
    if((await stat(filename)).size>16384) throw new Error('Update state too large.');
    return JSON.parse((await readFile(filename,'utf8')).replace(/^\uFEFF/,''));
  } catch(error) { if(error.code==='ENOENT') return null; throw error; }
}
export function cleanUpdateState(value) {
  if(!value || value.version!==1 || !validAttempt(value.attemptId) || !UPDATE_STAGES.includes(value.stage)
    || typeof value.targetVersion!=='string' || !/^\d+\.\d+\.\d+$/.test(value.targetVersion)
    || typeof value.automatic!=='boolean' || typeof value.startedAt!=='string' || typeof value.updatedAt!=='string' || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.updatedAt))
    || !Number.isInteger(value.updaterProcessId) || value.updaterProcessId<0 || value.updaterProcessId>0x7fffffff) throw new Error('Invalid update state.');
  return {version:1,attemptId:value.attemptId,stage:value.stage,targetVersion:value.targetVersion,automatic:value.automatic,
    startedAt:value.startedAt,updatedAt:value.updatedAt,updaterProcessId:value.updaterProcessId,
    reason:typeof value.reason==='string'?value.reason.slice(0,64):null,
    receivedBytes:Number.isSafeInteger(value.receivedBytes)&&value.receivedBytes>=0?value.receivedBytes:0,
    totalBytes:Number.isSafeInteger(value.totalBytes)&&value.totalBytes>=0?value.totalBytes:0};
}
