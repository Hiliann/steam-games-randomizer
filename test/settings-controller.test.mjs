import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsController} from '../public/settings-controller.js';

const messages={loading:'Loading',loaded:()=> 'Loaded',saved:()=> 'Saved',failure:error=>error.message};
test('settings groups serialize writes, expose pending state and preserve failed values',async()=>{
  let finish,fail=false;
  const model=createSettingsController({...messages,defaults:{enabled:false},client:{load:async()=>({enabled:true}),set:()=>new Promise((resolve,reject)=>{finish=()=>fail?reject(new Error('Disk error')):resolve({enabled:false});})}});
  assert.equal(await model.set('enabled',true),false);
  assert.equal(await model.load(),true);
  const save=model.set('enabled',false);assert.equal(model.pending,true);
  assert.equal(await model.set('enabled',true),false);assert.equal(await model.load(),false);
  finish();assert.equal(await save,true);assert.equal(model.value.enabled,false);
  fail=true;const failure=model.set('enabled',true);finish();assert.equal(await failure,false);
  assert.equal(model.value.enabled,false);assert.equal(model.ready,false);assert.equal(model.pending,false);
  assert.equal(model.message,'Disk error');
});
test('an optimistic auto-update switch can cancel preparation and rolls back on save failure',async()=>{
  let rejectSave;
  const model=createSettingsController({...messages,optimistic:true,invalidateOnSaveError:false,defaults:{automaticUpdates:false},client:{load:async()=>({automaticUpdates:true}),set:()=>new Promise((resolve,reject)=>{rejectSave=reject;})}});
  await model.load();const pending=model.set('automaticUpdates',false);
  assert.equal(model.value.automaticUpdates,false);assert.equal(model.pending,true);
  rejectSave(new Error('Connection lost'));assert.equal(await pending,false);
  assert.equal(model.value.automaticUpdates,true);assert.equal(model.ready,true);assert.equal(model.pending,false);
});
test('a failed settings read keeps the previous data and requires reloading',async()=>{
  let fail=false;
  const model=createSettingsController({...messages,defaults:{enabled:false},client:{load:async()=>{if(fail)throw new Error('Offline');return{enabled:true};}}});
  await model.load();fail=true;assert.equal(await model.load(),false);
  assert.equal(model.value.enabled,true);assert.equal(model.ready,false);
  assert.equal(await model.set('enabled',false),false);
});
