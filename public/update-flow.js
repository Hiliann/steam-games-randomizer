const activeStages=['starting','downloading','verifying','ready','applying','cancelling'];
export const updateInProgress=value=>activeStages.includes(value?.stage);
export function installationStatus(value) {
  if(value?.stage==='idle')return {stage:'idle'};
  if(value?.stage==='failed'&&value.reason==='status-unavailable')return {stage:'failed',reason:value.reason,targetVersion:null};
  if(!value||!activeStages.concat(['complete','failed','cancelled']).includes(value.stage)
    || typeof value.attemptId!=='string'||!/^[a-f0-9]{32}$/.test(value.attemptId)
    || typeof value.targetVersion!=='string'||!/^\d+\.\d+\.\d+$/.test(value.targetVersion)||typeof value.automatic!=='boolean')throw new Error('Некорректный статус установки обновления.');
  return {stage:value.stage,attemptId:value.attemptId,targetVersion:value.targetVersion,automatic:value.automatic,
    automaticRetryAllowed:value.automaticRetryAllowed===true,
    reason:typeof value.reason==='string'?value.reason:null,
    receivedBytes:Number.isSafeInteger(value.receivedBytes)&&value.receivedBytes>=0?value.receivedBytes:0,
    totalBytes:Number.isSafeInteger(value.totalBytes)&&value.totalBytes>=0?value.totalBytes:0};
}
export function createUpdateFlow({client,onStatus=()=>{},canApply=()=>true,automaticEnabled=()=>true,nativeApply,
  reload=()=>location.reload(),pause=()=>new Promise(resolve=>setTimeout(resolve,1000))}) {
  let active=false,current={stage:'idle'},generation=0;
  const emit=value=>{current=value;onStatus(value);};
  async function monitor(initial,token) {
    let failures=0,applied=false;
    emit(initial);
    for(let attempt=0;attempt<1800&&token===generation;attempt++) {
      let state;
      try {state=await client.loadInstallation();failures=0;}
      catch(error){if(++failures>15)throw error;await pause();continue;}
      if(token!==generation)return;
      emit(state);
      if(['failed','cancelled','idle'].includes(state.stage))return;
      if(state.stage==='complete') {
        if(!applied)return;
        try {if(await client.healthVersion()===state.targetVersion){reload();return;}}catch{}
        await pause();continue;
      }
      if(state.stage==='ready'&&!applied) {
        if(state.automatic&&!automaticEnabled()) {await client.cancelUpdate(state.attemptId);await pause();continue;}
        if(!canApply()){emit({...state,waiting:true});await pause();continue;}
        // Block new interactions only during the brief verified replacement.
        emit({...state,stage:'applying'});
        try {if(nativeApply)await nativeApply(state.attemptId);else await client.applyUpdate(state.attemptId,false);}
        catch(error){if(error.status===409){emit({...state,waiting:true});await pause();continue;}throw error;}
        applied=true;
      } else if(state.automatic&&!automaticEnabled()&&!['applying','cancelling'].includes(state.stage))await client.cancelUpdate(state.attemptId);
      await pause();
    }
    if(token===generation)throw new Error('Не удалось подтвердить завершение обновления. Проверь настройки или повтори запуск.');
  }
  async function run(initializer) {
    if(active)return false;
    active=true;const token=++generation;
    try {await monitor(await initializer(),token);return true;}
    catch(error){if(token===generation)emit({...current,stage:'failed',reason:'monitor-failed',message:error.message});return false;}
    finally {if(token===generation)active=false;}
  }
  return {
    start:(version,automatic=false)=>run(async()=>{const receipt=await client.installUpdate(version,automatic);return {stage:'starting',attemptId:receipt.attemptId,targetVersion:version,automatic};}),
    resume:state=>run(async()=>state),
    async cancel(){if(!active||!current.attemptId||current.stage==='applying')return false;await client.cancelUpdate(current.attemptId);emit({...current,stage:'cancelling'});return true;},
    dispose(){generation++;active=false;},
    get active(){return active;},get state(){return current;},
  };
}
