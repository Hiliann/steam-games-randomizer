import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnosticsController} from '../public/diagnostics-controller.js';

function fixture(options={}){
  const nodes=new Map(),downloads=[],discarded=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,{events:{},hidden:false,disabled:false,open:false,focus(){this.focused=true;},addEventListener(name,fn){this.events[name]=fn;},showModal(){this.open=true;},close(){this.open=false;this.events.close?.();}});return nodes.get(id);};
  const prepared=Object.freeze({preview:'{"format":"test"}',filename:'test.zip',bytes:100,files:[{name:'diagnostics.json'},{name:'CONTENTS.txt'}]});
  const client={prepare:async()=>prepared,archive:()=>new Blob(['zip']),discard:value=>discarded.push(value),...options.client};
  const controller=createDiagnosticsController({$,client,download:(blob,name)=>downloads.push(name),...options,client});
  return{$,controller,downloads,discarded,prepared};
}
test('diagnostics focus Cancel, preview all content and never download before consent',async()=>{
  const f=fixture();await f.controller.open();assert.equal(f.$('diagnostics-dialog').open,true);assert.equal(f.controller.busy,true);
  assert.equal(f.$('cancel-diagnostics').focused,true);assert.equal(f.$('diagnostics-preview').textContent,f.prepared.preview);
  assert.deepEqual(f.downloads,[]);f.$('cancel-diagnostics').events.click();assert.equal(f.controller.busy,false);assert.deepEqual(f.downloads,[]);
  assert.equal(f.$('export-diagnostics').focused,true);
});
test('late preparation after Cancel cannot reopen the dialog or expose its old report',async()=>{
  let finish,signal;const f=fixture({client:{prepare:s=>{signal=s;return new Promise(resolve=>{finish=resolve;});}}});
  const loading=f.controller.open();f.$('cancel-diagnostics').events.click();assert.equal(signal.aborted,true);
  finish(f.prepared);await loading;assert.equal(f.$('diagnostics-dialog').open,false);assert.equal(f.$('diagnostics-preview').hidden,true);assert.deepEqual(f.downloads,[]);
});
test('explicit saving is deduplicated and a failed download remains retryable',async()=>{
  let finish,fail=true,calls=0;
  const f=fixture({download:()=>{calls++;return new Promise((resolve,reject)=>{finish=()=>fail?reject(new Error('Save error')):resolve();});}});
  await f.controller.open();const pending=f.$('save-diagnostics').events.click();assert.equal(f.$('cancel-diagnostics').disabled,true);
  assert.equal(await f.$('save-diagnostics').events.click(),false);finish();await pending;
  assert.equal(calls,1);assert.equal(f.$('diagnostics-dialog').open,true);assert.equal(f.$('save-diagnostics').disabled,false);
  fail=false;const retry=f.$('save-diagnostics').events.click();finish();await retry;assert.equal(calls,2);assert.equal(f.$('diagnostics-dialog').open,false);
});
test('an interrupted collection stays cancellable and disposed controllers do not collect again',async()=>{
  const f=fixture({client:{prepare:async()=>{throw new TypeError('Offline');}}});
  await f.controller.open();assert.equal(f.$('save-diagnostics').disabled,true);assert.equal(f.$('cancel-diagnostics').disabled,false);
  f.$('diagnostics-dialog').events.cancel({preventDefault(){}});assert.equal(f.controller.busy,false);
  f.controller.dispose();assert.equal(await f.controller.open(),false);
});
