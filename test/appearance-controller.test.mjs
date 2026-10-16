import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppearanceController} from '../public/appearance-controller.js';
import {UI_DEFAULTS} from '../public/ui-settings.js';

function fixture(client){
  const nodes=new Map(),applied=[],languages=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  const controller=createAppearanceController({$,client,apply:value=>applied.push(structuredClone(value)),localize:value=>languages.push(value)});
  return{controller,$,applied,languages};
}
test('palette preview is isolated, editable and cancellable without a saved write',async()=>{
  let writes=0;
  const f=fixture({load:async()=>({...UI_DEFAULTS,language:'en'}),saveCustomAccent:async()=>{writes++;}});
  await f.controller.load();
  const colors={base:'#123456',hover:'#234567',contrast:'#ffffff'};
  f.controller.preview(colors);colors.base='#000000';
  assert.equal(f.controller.previewing,true);assert.equal(f.controller.draft.base,'#123456');
  const exposed=f.controller.draft;exposed.base='#abcdef';assert.equal(f.controller.draft.base,'#123456');
  assert.equal(f.applied.at(-1).accent,'custom');assert.equal(writes,0);
  f.controller.cancel();assert.equal(f.controller.previewing,false);assert.equal(f.applied.at(-1).accent,UI_DEFAULTS.accent);
  assert.deepEqual(f.languages,['en']);
});
test('a failed palette save restores the last theme and unlocks retry loading',async()=>{
  let fail=false;
  const f=fixture({load:async()=>({...UI_DEFAULTS,language:'en'}),saveCustomAccent:async()=>{throw new Error('Disk full');}});
  await f.controller.load();f.controller.preview({base:'#123456',hover:'#234567',contrast:'#ffffff'});
  await f.controller.save();assert.equal(f.controller.pending,false);assert.equal(f.controller.previewing,false);
  assert.equal(f.applied.at(-1).accent,UI_DEFAULTS.accent);assert.equal(f.$('retry-ui-settings').hidden,false);
  assert.equal(f.$('theme').disabled,true);assert.match(f.$('ui-settings-status').textContent,/Disk full/);
  await f.controller.load();assert.equal(f.$('theme').disabled,false);
});
