// A lost acknowledgement must not silently reset a saved setting.
export function createSettingsController({client,defaults,loading,loaded,saved,failure,
  onChange=()=>{},onSettled=()=>{},optimistic=false,invalidateOnSaveError=true}) {
  let value={...defaults},ready=false,pending=false,message=loading;
  async function run(operation,key,next) {
    if(pending||(operation==='save'&&!ready))return false;
    const previous=value;
    pending=true;message=operation==='load'?loading:'Сохраняем…';
    if(operation==='save'&&optimistic)value={...value,[key]:next};
    onChange();
    try {
      value=operation==='load'?await client.load():await client.set(key,next);
      ready=true;message=operation==='load'?loaded(value):saved(key,next,value);
      return true;
    } catch(error) {
      value=previous;
      if(operation==='load'||invalidateOnSaveError)ready=false;
      message=failure(error,operation);
      return false;
    } finally {pending=false;onChange();onSettled();}
  }
  return {load:()=>run('load'),set:(key,next)=>run('save',key,next),
    get value(){return value;},get ready(){return ready;},get pending(){return pending;},get message(){return message;}};
}
