import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const project=path.resolve(import.meta.dirname,'..');
async function collect(directory){
  const result=[];
  for(const item of await readdir(path.join(project,directory),{withFileTypes:true})){
    const name=path.join(directory,item.name);
    if(item.isDirectory())result.push(...await collect(name));
    else if(/\.(mjs|js)$/.test(item.name))result.push(name);
  }
  return result;
}
const files=['server.mjs'];
for(const directory of ['lib','public','scripts','test','docs','fixtures'])files.push(...await collect(directory));
for(const file of files){
  const result=spawnSync(process.execPath,['--check',path.join(project,file)],{windowsHide:true,encoding:'utf8'});
  if(result.error)throw result.error;
  if(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status??1);}
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
