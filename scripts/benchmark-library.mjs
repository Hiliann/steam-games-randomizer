// Developer-only synthetic benchmark. Never reads Steam files or sends telemetry.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { sortLibraryGames } from '../public/workspace.js';
import { collectionView } from '../public/collections.js';

const sizes = process.argv.slice(2).map(Number);
if (!sizes.length) sizes.push(700, 5000);
if (sizes.some(n=>!Number.isSafeInteger(n)||n<2||n>20000)) throw new Error('Use synthetic library sizes from 2 to 20000.');
const baseline = games => [...games].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true,sensitivity:'base'})||a.id.localeCompare(b.id));
function median(operation) {
  const samples=[];
  for(let repeat=0;repeat<3;repeat++){const start=performance.now();operation();samples.push(performance.now()-start);}
  return Number(samples.sort((a,b)=>a-b)[1].toFixed(2));
}
for(const count of sizes){
  const games=Array.from({length:count},(_,index)=>({id:String(90000000+index),name:`${index%2?'Игра':'Game'} ${(index*37)%count}`}));
  const expected=baseline(games).map(g=>g.id);
  assert.deepEqual(sortLibraryGames(games).map(g=>g.id),expected);
  assert.deepEqual(collectionView(games).map(g=>g.id),expected);
  console.log(JSON.stringify({dataset:'synthetic-only',games:count,baselineSortMs:median(()=>baseline(games)),librarySortMs:median(()=>sortLibraryGames(games)),collectionSortMs:median(()=>collectionView(games)),orderingUnchanged:true}));
}
