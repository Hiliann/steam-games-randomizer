import {createDiagnosticsClient} from './diagnostics.js';
import {tr} from './i18n.js';

export function downloadDiagnosticArchive(blob,filename){
  const link=document.createElement('a'),url=URL.createObjectURL(blob);
  link.href=url;link.download=filename;document.body.append(link);
  try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
}

export function createDiagnosticsController({$,client=createDiagnosticsClient(),download=downloadDiagnosticArchive,canStart=()=>true}){
  const dialog=$('diagnostics-dialog'),launch=$('export-diagnostics'),save=$('save-diagnostics'),cancel=$('cancel-diagnostics'),close=$('close-diagnostics');
  let prepared=null,pending=false,saving=false,generation=0,disposed=false,abort;
  function render(){
    launch.disabled=pending||saving||dialog.open;
    save.disabled=!prepared||pending||saving;
    cancel.disabled=saving;close.disabled=saving;
    $('diagnostics-preview').hidden=!prepared;
    $('diagnostics-files').hidden=!prepared;
  }
  function release(){if(prepared)client.discard(prepared);prepared=null;}
  function dismiss(){
    if(saving)return;
    generation++;abort?.abort();abort=null;pending=false;release();dialog.close();
    $('diagnostics-status').textContent=tr('Экспорт отменён. Файл не создавался.','Export cancelled. No file was created.');render();launch.focus();
  }
  async function open(){
    if(disposed||pending||saving||dialog.open||!canStart())return false;
    const token=++generation;release();pending=true;abort=new AbortController();
    $('diagnostics-preview').textContent='';$('diagnostics-files').textContent='';
    $('diagnostics-dialog-status').textContent=tr('Собираем технические сведения…','Collecting technical information…');
    dialog.showModal();render();cancel.focus();
    try{
      const result=await client.prepare(abort.signal);
      if(token!==generation||disposed){client.discard(result);return false;}
      prepared=result;$('diagnostics-preview').textContent=result.preview;
      $('diagnostics-files').textContent=result.files.map(file=>file.name).join(' · ')+` · ${result.bytes} `+tr('байт','bytes');
      $('diagnostics-dialog-status').textContent=tr('Проверь весь отчёт ниже. ZIP сохранится только после нажатия кнопки.','Review the complete report below. A ZIP is saved only after you press the button.');
      return true;
    }catch(error){if(token===generation&&!disposed)$('diagnostics-dialog-status').textContent=error instanceof TypeError?tr('Нет связи с приложением. Закрой это окно и попробуй ещё раз.','No connection to the app. Close this dialog and try again.'):error.message;return false;}
    finally{if(token===generation&&!disposed){pending=false;abort=null;render();}}
  }
  async function saveArchive(){
    if(!prepared||pending||saving||disposed)return false;
    saving=true;render();
    try{
      await download(client.archive(prepared),prepared.filename);
      release();dialog.close();
      $('diagnostics-status').textContent=tr('ZIP передан на сохранение. Проверь загрузки или выбранную папку. Ничего не отправлено.','ZIP handed off for saving. Check downloads or your chosen folder. Nothing was sent.');
      launch.focus();return true;
    }catch(error){$('diagnostics-dialog-status').textContent=tr('Не удалось начать сохранение ZIP. Можно повторить или отменить.','Could not start saving the ZIP. Retry or cancel.');return false;}
    finally{saving=false;render();}
  }
  const cancelEvent=event=>{event.preventDefault();dismiss();};
  const closed=()=>{if(!dialog.open){generation++;abort?.abort();abort=null;pending=false;release();render();}};
  launch.addEventListener('click',open);save.addEventListener('click',saveArchive);cancel.addEventListener('click',dismiss);close.addEventListener('click',dismiss);
  dialog.addEventListener('cancel',cancelEvent);dialog.addEventListener('close',closed);
  return{open,render,get busy(){return pending||saving||dialog.open;},dispose(){disposed=true;generation++;abort?.abort();release();}};
}
