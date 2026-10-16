import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32} from 'node:zlib';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseAppInfo,parsePackageInfo,parseLicenses,decodeLicenseCache} from '../lib/steam-cache.mjs';
import {scanSteam,parseVdf} from '../lib/steam.mjs';
import {scanOwnedLibrary} from '../lib/owned.mjs';
import {appCache,packageCache,licenseCache,steamId,u32,varint} from '../fixtures/steam-cache.mjs';

test('every incomplete prefix of supported small Steam cache layouts is rejected',()=>{
  for(const version of [0x07564427,0x07564428,0x07564429]){
    const bytes=appCache([[10,'Synthetic game']],version);
    for(let size=0;size<bytes.length;size++)assert.throws(()=>parseAppInfo(bytes.subarray(0,size)),`appinfo ${version} prefix ${size}`);
  }
  for(const version of [0x06565527,0x06565528]){
    const bytes=packageCache([[1,[10],[11]]],version);
    for(let size=0;size<bytes.length;size++)assert.throws(()=>parsePackageInfo(bytes.subarray(0,size)),`packageinfo ${version} prefix ${size}`);
  }
});
test('repeated package records replace stale depot ownership and corrupt reads cannot partially mutate it',()=>{
  for(const version of [0x06565527,0x06565528]){
    const depots=new Set(['900']);
    const bytes=packageCache([[1,[10],[11,12]],[2,[20],[21]],[1,[30],[31]]],version);
    assert.deepEqual([...parsePackageInfo(bytes,new Set(['1']),{ownedDepots:depots})],[['1',['30']]]);
    assert.deepEqual([...depots],['900','31']);
    const unchanged=new Set(['900']);assert.throws(()=>parsePackageInfo(bytes.subarray(0,-1),new Set(['1']),{ownedDepots:unchanged}));
    assert.deepEqual([...unchanged],['900']);
  }
});
test('appinfo missing required fields is unknown rather than an invented game',()=>{
  for(const version of [0x07564427,0x07564428,0x07564429]){
    const apps=parseAppInfo(appCache([[10,''],[20,'  '],[30,'Valid'],[40,'No type','']],version));
    assert.equal(apps.has('10'),false);assert.equal(apps.has('20'),false);
    assert.equal(apps.get('30').name,'Valid');
    // An empty type is not valid metadata and must not become a playable title.
    assert.equal(apps.has('40'),false);
  }
});
test('invalid string-table indexes and overflowing license varints fail closed',()=>{
  const bytes=appCache([[10,'Synthetic']]);bytes.writeUInt32LE(0xffffffff,16+8+60+1);
  assert.throws(()=>parseAppInfo(bytes));
  const payload=Buffer.concat([Buffer.from([8]),Buffer.from(Array(9).fill(0x80)),Buffer.from([2])]);
  const encoded=decodeLicenseCache(Buffer.concat([payload,u32(crc32(payload))]),123);
  assert.throws(()=>parseLicenses(encoded,123),/varint/);
});
test('a fixed artificial license-cache vector guards account decoding independently of fixture generation',()=>{
  const encoded=Buffer.from('372b61344f281a6c687f544bef6cb1dfedfeeaa6c9323c487536114b14585d3ee732d0e2c4e1b8dfcb3a1cc493e6','hex');
  assert.deepEqual(parseLicenses(encoded,123),[{packageId:'1',flags:0,owner:123,type:1},{packageId:'2',flags:8,owner:123,type:1}]);
  assert.throws(()=>parseLicenses(encoded,124));
});
test('different unavailable or stale ownership caches keep installed games usable and unmodified',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'playnext-cache-regression-'));t.after(()=>rm(root,{recursive:true,force:true}));
  async function put(name,bytes){const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);return file;}
  await put('config/loginusers.vdf',`"users" { "${steamId(123)}" { "PersonaName" "Synthetic user" "MostRecent" "1" } }`);
  const license=await put('userdata/123/config/licensecache',licenseCache([{id:1}]));
  const packages=await put('appcache/packageinfo.vdf',packageCache([[1,[10,20]]]));
  const apps=await put('appcache/appinfo.vdf',appCache([[10,'Installed fixture'],[20,'Owned fixture']]));
  const manifest=await put('steamapps/appmanifest_10.acf','"AppState" { "appid" "10" "name" "Installed fixture" "StateFlags" "4" "installdir" "Fixture" }');
  await put('steamapps/common/Fixture/file.txt','synthetic installation');const original=await readFile(manifest);
  const scan=()=>scanSteam({candidates:[root],includeUninstalled:true,ownedScan:(roots,parse)=>scanOwnedLibrary(roots,parse,{activeUser:123})});
  for(const[file,valid,broken]of [[license,licenseCache([{id:1}]),Buffer.from('broken license')],[packages,packageCache([[1,[10,20]]]),u32(0)],[apps,appCache([[10,'Installed fixture'],[20,'Owned fixture']]),appCache([[10,'Installed fixture']]).subarray(0,-1)]]){
    await writeFile(file,broken);const snapshot=await scan();
    assert.deepEqual(snapshot.games.map(game=>game.id),['10']);assert.equal(snapshot.ownedLibrary.status,'unavailable');
    assert.deepEqual(await readFile(manifest),original);assert.deepEqual(await readFile(file),broken);
    await writeFile(file,valid);
  }
  await writeFile(apps,appCache([[10,'Installed fixture']]));
  const stale=await scan();assert.equal(stale.ownedLibrary.status,'partial');assert.deepEqual(stale.games.map(game=>game.id),['10']);
});
