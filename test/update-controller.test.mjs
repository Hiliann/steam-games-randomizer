import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeUpdateBridge,createUpdateController} from '../public/update-controller.js';

test('native update bridge waits for acknowledgement, handles deferral and removes listeners',async()=>{
  const handlers=new Set(),sent=[];
  const bridge={addEventListener:(_,handler)=>handlers.add(handler),removeEventListener:(_,handler)=>handlers.delete(handler),postMessage:value=>sent.push(value)};
  const apply=createNativeUpdateBridge(bridge,100);
  const pending=apply('a'.repeat(32));assert.equal(sent[0],'update-starting:'+'a'.repeat(32));
  for(const handler of handlers)handler({data:'update-applying'});await pending;
  assert.equal(handlers.size,0);
  const deferred=apply('a'.repeat(32));for(const handler of handlers)handler({data:'update-apply-deferred'});
  await assert.rejects(deferred,{status:409});assert.equal(handlers.size,0);
});
test('native acknowledgement timeout or a disconnected bridge cannot strand listeners',async()=>{
  const handlers=new Set();
  const bridge={addEventListener:(_,handler)=>handlers.add(handler),removeEventListener:(_,handler)=>handlers.delete(handler),postMessage(){}};
  await assert.rejects(createNativeUpdateBridge(bridge,1)('a'.repeat(32)));
  assert.equal(handlers.size,0);
  bridge.postMessage=()=>{throw new Error('Disconnected');};
  await assert.rejects(createNativeUpdateBridge(bridge,100)('a'.repeat(32)),/Disconnected/);
  assert.equal(handlers.size,0);
});
function fixture(client){
  const nodes=new Map(),timers=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,open:false,removeAttribute(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const settings={ready:true,value:{automaticUpdates:true,showUpdateNotifications:true}};
  const controller=createUpdateController({client,$,version:'2.5.0',getSettings:()=>settings,canApply:()=>true,toast(){},schedule:(fn,ms)=>{timers.push(fn);return timers.length;},unschedule:id=>{timers[id-1]=null;}});
  return{controller,timers,$,settings};
}
test('offline startup checks are bounded and disposed controllers cannot schedule late work',async()=>{
  let checks=0;
  const f=fixture({checkUpdate:async()=>{checks++;return{status:'offline',currentVersion:'2.5.0'};},loadInstallation:async()=>({stage:'idle'})});
  await f.controller.check({notify:true});await f.timers[0]();await f.timers[1]();
  assert.equal(checks,3);assert.equal(f.timers.length,2);
  f.controller.dispose();await f.controller.check({notify:true});assert.equal(checks,3);
});
