import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Keeps every place that names the app version in step with package.json.
// node scripts/set-version.mjs 2.7.0                                 source files before building
// node scripts/set-version.mjs --release dist/PlayNext-2.7.0-win-x64.zip  website and history after building
const project=path.resolve(import.meta.dirname,'..');
const VERSION=/^\d+\.\d+\.\d+$/;
const REPOSITORY='https://github.com/Hiliann/steam-games-randomizer';

function replaceAll(text,pattern,replacement,file){
  if(!pattern.test(text))throw new Error(`${file}: expected text was not found (${pattern}).`);
  pattern.lastIndex=0;
  return text.replace(pattern,replacement);
}

export const SOURCE_FILES={
  'package.json':(text,version,file)=>replaceAll(text,/^(  "version": ")[^"]+(")/m,`$1${version}$2`,file),
  'release.json':(text,version,file)=>replaceAll(text,/^(\s*"version":\s*")[^"]+(")/m,`$1${version}$2`,file),
  'server.mjs':(text,version,file)=>replaceAll(text,/^(export const APP_VERSION = ')[^']+(';)/m,`$1${version}$2`,file),
  'public/index.html':(text,version,file)=>replaceAll(text,/(id="update-status"[^>]*>Текущая версия: )[^<]+/,`$1${version}`,file),
  'launcher/PlayNextLauncher.cs':(text,version,file)=>replaceAll(text,/(Assembly(?:File)?Version\(")[^"]+("\))/g,`$1${version}.0$2`,file),
  'README.md':(text,version,file)=>replaceAll(text,/(\*\*PlayNext-)\d+\.\d+\.\d+(-win-x64\.zip\*\*)/g,`$1${version}$2`,file),
};

function website(text,{version,sha256,megabytes},file){
  text=replaceAll(text,/releases\/download\/v\d+\.\d+\.\d+\/PlayNext-\d+\.\d+\.\d+-win-x64/g,`releases/download/v${version}/PlayNext-${version}-win-x64`,file);
  text=replaceAll(text,/releases\/tag\/v\d+\.\d+\.\d+/g,`releases/tag/v${version}`,file);
  text=replaceAll(text,/\bv\d+\.\d+\.\d+(?= · Windows)/g,`v${version}`,file);
  text=replaceAll(text,/(Play Next )\d+\.\d+\.\d+(?= · Windows)/g,`$1${version}`,file);
  text=replaceAll(text,/(ZIP(?:, | · ))\d+( (?:MB|МБ))/g,`$1${megabytes}$2`,file);
  return replaceAll(text,/(class="checksum">)[a-f0-9]{64}/,`$1${sha256}`,file);
}

export const RELEASE_FILES={
  'docs/index.html':website,
  'docs/ru/index.html':website,
  'RELEASE_HISTORY.md':(text,{version,sha256},file)=>{
    text=replaceAll(text,/(Актуальная версия: \*\*)\d+\.\d+\.\d+(\*\*)/,`$1${version}$2`,file);
    const row=`| [${version}](${REPOSITORY}/releases/tag/v${version}) | \`PlayNext-${version}-win-x64.zip\` | \`${sha256}\` |`;
    const existing=new RegExp(`^\\| \\[${version.replaceAll('.','\\.')}\\]\\(.*$`,'m');
    if(existing.test(text))return text.replace(existing,row);
    return replaceAll(text,/^(\| --- \| --- \| --- \|)$/m,`$1\n${row}`,file);
  },
};

export async function releaseInfo(archive,version){
  const name=path.basename(archive);
  if(name!==`PlayNext-${version}-win-x64.zip`)throw new Error(`The archive must be PlayNext-${version}-win-x64.zip to match package.json, not ${name}.`);
  const bytes=await readFile(archive);
  return {version,sha256:createHash('sha256').update(bytes).digest('hex'),megabytes:Math.max(1,Math.round(bytes.length/1024**2))};
}

async function update(files,value,root){
  for(const [file,apply] of Object.entries(files)){
    const target=path.join(root,file);
    const before=await readFile(target,'utf8');
    const after=apply(before,value,file);
    if(after!==before)await writeFile(target,after);
  }
}

export async function setVersion(args,root=project){
  if(args[0]==='--release'&&args.length===2){
    const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
    const info=await releaseInfo(path.resolve(args[1]),version);
    await update(RELEASE_FILES,info,root);
    return `Website and release history now point to ${version} (${info.megabytes} MB, SHA-256 ${info.sha256}).`;
  }
  if(args.length===1&&VERSION.test(args[0])){
    await update(SOURCE_FILES,args[0],root);
    return `Source files now use version ${args[0]}. Build the release, then run: node scripts/set-version.mjs --release <archive>`;
  }
  throw new Error('Usage: node scripts/set-version.mjs <major.minor.patch> | --release <PlayNext-version-win-x64.zip>');
}

if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
  try{console.log(await setVersion(process.argv.slice(2)));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
