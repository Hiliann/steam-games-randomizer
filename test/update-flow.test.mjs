import test from 'node:test';
import assert from 'node:assert/strict';
import {createUpdateFlow,installationStatus} from '../public/update-flow.js';
import {startupUpdateAction} from '../public/app-settings.js';
const attemptId='a'.repeat(32),targetVersion='2.5.0';
const state=stage=>({stage,attemptId,targetVersion,automatic:true});
function fixture(stages,extras={}) {
  const {client:clientOverrides,...flowOptions}=extras;
  const calls=[],seen=[];let count=0;
  const client={installUpdate:async(v,a)=>{calls.push(['start',v,a]);return{status:'preparing',attemptId,targetVersion};},
    loadInstallation:async()=>state(stages[Math.min(count++,stages.length-1)]),
    applyUpdate:async id=>{calls.push(['apply',id]);return{status:'applying',attemptId,targetVersion};},
    cancelUpdate:async id=>calls.push(['cancel',id]),healthVersion:async()=>targetVersion,...clientOverrides};
  const flow=createUpdateFlow({client,onStatus:s=>seen.push(s),pause:async()=>{},reload:()=>calls.push(['reload']),...flowOptions});
  return{flow,calls,seen};
}
test('downloads and verification cannot close the app; verified data apply once and reload after recovery',async()=>{
  const f=fixture(['downloading','verifying','ready','applying','complete']);
  const first=f.flow.start(targetVersion,true);assert.equal(await f.flow.start(targetVersion,true),false);await first;
  assert.deepEqual(f.calls.map(c=>c[0]),['start','apply','reload']);
  assert.equal(f.seen.findIndex(s=>s.stage==='verifying')<f.seen.findIndex(s=>s.stage==='applying'),true);
});
test('unsaved or pending changes defer replacement until they finish',async()=>{
  let safe=false;const f=fixture(['ready','ready','complete'],{canApply:()=>safe,pause:async()=>{safe=true;}});
  await f.flow.start(targetVersion,true);assert.equal(f.seen.some(s=>s.waiting),true);
  assert.equal(f.calls.filter(c=>c[0]==='apply').length,1);
});
test('turning off automatic updates cancels preparation without applying or reloading',async()=>{
  const f=fixture(['downloading','cancelling','cancelled'],{automaticEnabled:()=>false});
  await f.flow.start(targetVersion,true);assert.deepEqual(f.calls.map(c=>c[0]),['start','cancel']);
});
test('preparation failure leaves the app available and persisted failures block automatic retries',async()=>{
  const f=fixture(['failed']);await f.flow.start(targetVersion,true);
  assert.equal(f.flow.active,false);assert.deepEqual(f.calls.map(c=>c[0]),['start']);
  const settings={automaticUpdates:true,showUpdateNotifications:true},info={status:'ready',updateAvailable:true,installable:true,latestVersion:targetVersion};
  assert.equal(startupUpdateAction(settings,info,state('failed')),'failed');
  assert.equal(startupUpdateAction(settings,{...info,latestVersion:'2.6.0'},state('failed')),'install');
  assert.equal(startupUpdateAction(settings,{status:'offline'},state('downloading')),'resume');
  assert.equal(startupUpdateAction(settings,{...info,latestVersion:'2.6.0'},{...state('failed'),reason:'rollback-failed',automaticRetryAllowed:true}),'failed');
});
test('a native window is notified only after verification and safe-to-apply checks',async()=>{
  let calls=0;const f=fixture(['downloading','ready','failed'],{nativeApply:async id=>{assert.equal(id,attemptId);calls++;}});
  await f.flow.resume(state('downloading'));assert.equal(calls,1);assert.equal(f.calls.some(c=>c[0]==='apply'),false);
});
test('other-window saves can defer applying without losing the prepared download',async()=>{
  let writes=0;const f=fixture(['ready','ready','complete'],{client:{applyUpdate:async()=>{if(++writes===1)throw Object.assign(new Error('Still saving'),{status:409});}}});
  await f.flow.start(targetVersion,true);assert.equal(writes,2);assert.equal(f.seen.some(s=>s.waiting),true);
});
test('malformed updater status cannot drive the frontend',()=>{
  assert.deepEqual(installationStatus({stage:'idle'}),{stage:'idle'});
  for(const value of [null,{stage:'ready'},{...state('ready'),attemptId:'../data'},{...state('ready'),targetVersion:'x'}])assert.throws(()=>installationStatus(value));
});
