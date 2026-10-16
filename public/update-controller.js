import { createUpdateFlow, updateInProgress } from './update-flow.js';
import { startupUpdateAction } from './app-settings.js';
import { tr } from './i18n.js';

export function createNativeUpdateBridge(bridge, timeoutMilliseconds=15000) {
  return attemptId=>new Promise((resolve,reject)=>{
    const finish=error=>{clearTimeout(timeout);bridge.removeEventListener('message',receive);error?reject(error):resolve();};
    const receive=event=>{
      if(event.data==='update-applying')finish();
      else if(event.data==='update-apply-deferred')finish(Object.assign(new Error(tr('Ожидаем завершения сохранения данных.','Waiting for data to finish saving.')),{status:409}));
      else if(event.data==='update-apply-failed')finish(new Error(tr('Не удалось подтвердить применение обновления. Приложение остаётся открытым.','Could not confirm the update. The app remains open.')));
    };
    const timeout=setTimeout(()=>finish(new Error(tr('Установка не подтверждена. Проверь статус в настройках.','Installation was not confirmed. Check its status in Settings.'))),timeoutMilliseconds);
    bridge.addEventListener('message',receive);
    try { bridge.postMessage('update-starting:'+attemptId); } catch(error) { finish(error); }
  });
}

// Owns update state and presentation; callers supply only application guards.
export function createUpdateController({client,$,version,getSettings,canApply,onApplying=()=>{},onStatus=()=>{},toast,bridge,schedule=setTimeout,unschedule=clearTimeout}) {
  let updateInfo={status:'not-checked',currentVersion:version};
  let updatePending=false,updateInstalling=false,updateApplying=false;
  let updateInstallation={stage:'idle'},startupUpdateRetries=0,updateDialogShownVersion=null,retryTimer=null,disposed=false;
  const flow=createUpdateFlow({client,canApply,automaticEnabled:()=>getSettings().value.automaticUpdates,
    nativeApply:bridge?createNativeUpdateBridge(bridge):undefined,
    onStatus(value){
      const changed=updateApplying!==(value.stage==='applying');
      updateInstallation=value;updateInstalling=updateInProgress(value);updateApplying=value.stage==='applying';
      if(changed)onApplying(updateApplying);
      renderUpdateStatus();onStatus(value);
    },
  });
function showUpdateDialog() {
  if (!getSettings().value.showUpdateNotifications || updateInstalling || updateInfo.status !== 'ready' || !updateInfo.updateAvailable || !updateInfo.installable || updateDialogShownVersion === updateInfo.latestVersion) return;
  updateDialogShownVersion = updateInfo.latestVersion;
  $('update-dialog-description').textContent = `Доступна версия ${updateInfo.latestVersion}. Сейчас установлена ${updateInfo.currentVersion}. Можно обновиться сейчас или вернуться к этому позже.`;
  if (!$('update-dialog').open) $('update-dialog').showModal();
}
function renderUpdateStatus() {
  $('check-update').disabled = updatePending || updateInstalling;
  $('check-update').textContent = updatePending ? 'Проверяем…' : 'Проверить сейчас';
  const link = $('download-update');
  const install = $('install-update');
  link.hidden = true;
  link.removeAttribute('href');
  install.hidden = true;
  install.disabled = updateInstalling;
  const stage=updateInstallation.stage, version=updateInstallation.targetVersion??updateInfo.latestVersion;
  install.textContent=stage==='failed'?tr('Повторить обновление','Retry update'):tr('Установить сейчас','Install now');
  $('cancel-update').hidden=!updateInstalling||updateApplying||!updateInstallation.attemptId;
  const progress=$('update-progress');progress.hidden=!['downloading','verifying'].includes(stage);
  if(updateInstallation.totalBytes>0)progress.value=Math.min(100,100*updateInstallation.receivedBytes/updateInstallation.totalBytes);else progress.removeAttribute('value');
  if (updateInstalling) {
    const labels={starting:tr('Запускаем загрузку','Starting download'),downloading:tr('Скачиваем обновление','Downloading update'),verifying:tr('Проверяем файлы','Verifying files'),ready:updateInstallation.waiting?tr('Обновление готово. Сохрани изменения или закрой открытое окно подтверждения.','Update ready. Save your changes or close the open confirmation first.'):tr('Обновление готово','Update ready'),applying:tr('Применяем проверенное обновление. Программа перезапустится сама.','Applying verified update. The app will restart automatically.'),cancelling:tr('Останавливаем обновление. Приложение остаётся открытым.','Stopping update. The app remains open.')};
    $('update-status').textContent=(labels[stage]??'')+(version?' · '+version:'');
  }
  else if(stage==='failed')$('update-status').textContent=updateInstallation.reason==='rollback-failed'?tr('Откат обновления не завершился. Не удаляй папку программы и сохрани журнал .update.log.','Update rollback could not finish. Keep the app folder and preserve .update.log.'):tr('Обновление не завершилось. Текущая версия остаётся доступна; повторить можно вручную.','Update did not finish. Your current version remains available; retry manually.');
  else if(stage==='cancelled')$('update-status').textContent=tr('Обновление отменено. Твои данные не изменены.','Update cancelled. Your data was not changed.');
  else if (updatePending) $('update-status').textContent = `Проверяем обновления. Текущая версия: ${updateInfo.currentVersion}.`;
  else if (updateInfo.status === 'offline') $('update-status').textContent = `Не удалось связаться с GitHub. Текущая версия: ${updateInfo.currentVersion}.`;
  else if (updateInfo.status === 'ready' && updateInfo.updateAvailable) {
    $('update-status').textContent = `Доступна версия ${updateInfo.latestVersion}. Установлена ${updateInfo.currentVersion}.`;
    if (updateInfo.releaseUrl) { link.href = updateInfo.releaseUrl; link.hidden = false; }
    install.hidden = !updateInfo.installable;
  } else if (updateInfo.status === 'ready') $('update-status').textContent = `Установлена актуальная версия ${updateInfo.currentVersion}.`;
  else $('update-status').textContent = `Текущая версия: ${updateInfo.currentVersion}.`;
  if(updateInstalling)install.hidden=true;
  else if(stage==='failed'||stage==='cancelled')install.hidden=!(updateInfo.status==='ready'&&updateInfo.updateAvailable&&updateInfo.installable);
}
async function checkForUpdate({ force = false, notify = false } = {}) {
  if (disposed || updatePending || updateInstalling) return;
  updatePending = true;
  let automatic = false;
  let showDialog = false;
  let resumeStatus=null;
  renderUpdateStatus();
  try {
    updateInfo = await client.checkUpdate(force);
    updateInstallation=await client.loadInstallation();
    if(disposed)return;
    const startupAction = updateInProgress(updateInstallation)?'resume':notify && getSettings().ready ? startupUpdateAction(getSettings().value, updateInfo,updateInstallation) : 'none';
    automatic = startupAction === 'install';
    showDialog = startupAction === 'notify';
    if(startupAction==='resume')resumeStatus=updateInstallation;
    if(startupAction==='failed')toast(tr('Автообновление этой версии не удалось. Программа работает; повторить можно в настройках.','This version could not update automatically. The app is available; retry in Settings.'));
  } catch {
    updateInfo = { status: 'offline', currentVersion: updateInfo.currentVersion };
  } finally {
    updatePending = false;
    renderUpdateStatus();
  }
  if(disposed)return;
  if(resumeStatus)installUpdate({resume:resumeStatus});
  else if (automatic) installUpdate({automatic:true});
  else if (showDialog) showUpdateDialog();
  else if(notify&&getSettings().value.automaticUpdates&&updateInfo.status==='offline'&&++startupUpdateRetries<3)retryTimer=schedule(()=>checkForUpdate({notify:true}),60000);
}
async function installUpdate({automatic=false,resume}={}) {
  if (disposed || flow.active || updatePending || (!resume&&(updateInfo.status !== 'ready' || !updateInfo.updateAvailable || !updateInfo.installable))) return;
  if ($('update-dialog').open) $('update-dialog').close();
  try {
    const current=resume??await client.loadInstallation();
    if(updateInProgress(current))await flow.resume(current);else await flow.start(updateInfo.latestVersion,automatic);
  } catch(error) { toast(error.message); }
}

  return {
    render:renderUpdateStatus,check:checkForUpdate,install:installUpdate,
    cancel:()=>flow.cancel(),showDialog:showUpdateDialog,
    setInfo(value){updateInfo=value;renderUpdateStatus();},
    get applying(){return updateApplying;},
    dispose(){disposed=true;if(retryTimer!==null)unschedule(retryTimer);flow.dispose();},
  };
}
