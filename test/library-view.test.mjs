import test from 'node:test';
import assert from 'node:assert/strict';
import {renderLibraryCards} from '../public/library-view.js';

test('card/list rendering preserves safe text, participation state and preview actions',async()=>{
  const nodes=[];
  function element(tag,className='',text){const n={tag,className,textContent:text,children:[],events:{},attributes:{},dataset:{},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(key,value){this.attributes[key]=value;},addEventListener(name,fn){this.events[name]=fn;},focus(){this.focused=true;}};nodes.push(n);return n;}
  const previous=globalThis.document;
  globalThis.document={createElement:element,createDocumentFragment:()=>element('fragment'),getElementById:id=>nodes.find(n=>n.id===id)};
  try{
    const grid=element('grid'),preview=[],excluded=[];
    const visible=[{id:'10',name:'<script>Untrusted game</script>',installed:true,disk:'C:'},{id:'20',name:'Other game',installed:false}];
    const render=()=>renderLibraryCards({$:()=>grid,element,icon:()=>element('svg'),artwork:()=>element('img'),renderCardSize:()=>{},renderCategoryBadges:()=>{},libraryCategoryMenu:()=>element('menu'),onPreview:id=>preview.push(id),onExcluded:async(...args)=>excluded.push(args)}, {visible,excluded:new Set(['20']),busy:false,scanning:false,savingExclusion:false,exclusionsReady:true});
    render();assert.equal(grid.children[0].children.length,2);
    const cards=grid.children[0].children;
    assert.equal(cards[0].children[1].textContent,'<script>Untrusted game</script>');
    cards[0].children[0].events.click();assert.deepEqual(preview,['10']);
    const first=nodes.find(n=>n.id==='toggle-10'),second=nodes.find(n=>n.id==='toggle-20');
    assert.equal(first.checked,true);assert.equal(second.checked,false);
    first.checked=false;await first.events.change();assert.deepEqual(excluded,[['10',true]]);assert.equal(first.focused,true);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
