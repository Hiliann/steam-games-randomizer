import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupClient } from '../public/backup.js';
import { setLanguage, translate } from '../public/i18n.js';
import { readFile } from 'node:fs/promises';

const browser={includeUninstalled:false,customPaths:[]};
const payload={format:'play-next-backup',browser,data:{marker:'original'}};
const summary={createdAt:'2026-10-14T21:00:00.000Z',appVersion:'2.3.1',categories:7,assignedGames:700,history:9,exclusions:2,customPaths:0};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});

test('prepared backups inspect without restoring and keep the exact inspected payload private', async () => {
  const requests=[]; let reads=0;
  class TestFile extends Blob {async text(){reads++; return JSON.stringify({...payload,data:{marker:reads===1?'original':'changed'}});}}
  const client=createBackupClient(async(route,options)=>{requests.push({route,options});return json(route.endsWith('/preview')?summary:{restored:true,browser});});
  const prepared=await client.prepareBackup(new TestFile(['valid']));
  assert.equal(requests.length,1); assert.equal(requests[0].route,'/api/backup/preview');
  assert.equal(requests[0].options.headers['X-Randomizer'],'1');
  assert.equal(Object.isFrozen(prepared.summary),true);
  assert.deepEqual(prepared.summary,summary); assert.equal(prepared.body,undefined);
  await assert.rejects(client.restorePrepared({summary}));
  await assert.rejects(createBackupClient().restorePrepared(prepared));
  assert.equal(requests.length,1);
  assert.deepEqual(await client.restorePrepared(prepared),{restored:true,browser});
  assert.equal(reads,1); assert.equal(requests[1].route,'/api/backup');
  assert.equal(requests[1].options.body,requests[0].options.body);
  assert.equal(JSON.parse(requests[1].options.body).data.marker,'original');
  await assert.rejects(client.restorePrepared(prepared));
  assert.equal(requests.length,2);
});

test('invalid files and rejected previews never call the restore endpoint', async t => {
  setLanguage('en'); t.after(()=>setLanguage('ru'));
  const routes=[];
  const client=createBackupClient(async route=>{routes.push(route);return json({error:'В резервной копии повреждены категории, история или исключения.'},400);});
  await assert.rejects(client.prepareBackup(new Blob()),error=>/up to 6 MB/.test(translate(error.message)));
  await assert.rejects(client.prepareBackup(new Blob(['not JSON'])),error=>/not a valid JSON/.test(translate(error.message)));
  await assert.rejects(client.prepareBackup(new Blob(['{}'])),error=>/invalid library settings/.test(translate(error.message)));
  assert.deepEqual(routes,[]);
  await assert.rejects(client.prepareBackup(new Blob([JSON.stringify(payload)])),error=>{
    assert.equal(error.message,'В резервной копии повреждены категории, история или исключения.');
    assert.match(translate(error.message),/invalid categories, history or exclusions/);
    setLanguage('ru'); assert.equal(translate(error.message),error.message); return true;
  });
  assert.deepEqual(routes,['/api/backup/preview']);
});

test('a malformed preview cannot authorize a restore', async () => {
  const client=createBackupClient(async()=>json({...summary,assignedGames:-1}));
  await assert.rejects(client.prepareBackup(new Blob([JSON.stringify(payload)])));
});

test('a failed restore remains retryable with the same validated bytes', async t => {
  setLanguage('en');t.after(()=>setLanguage('ru'));
  let restores=0;const bodies=[];
  const client=createBackupClient(async(route,options)=>{
    if(route.endsWith('/preview'))return json(summary);
    bodies.push(options.body); restores++;
    return restores===1?json({error:'Не удалось восстановить данные. Прежние данные возвращены. disk full'},503):json({restored:true,browser});
  });
  const prepared=await client.prepareBackup(new Blob([JSON.stringify(payload)]));
  await assert.rejects(client.restorePrepared(prepared),error=>/Your previous data was restored/.test(translate(error.message)));
  assert.deepEqual(await client.restorePrepared(prepared),{restored:true,browser});
  assert.equal(bodies[0],bodies[1]);
});

test('restore UI checks the file before a safe explicit decision, not a system confirmation', async () => {
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const source=app.slice(app.indexOf('async function restoreBackup(file)'),app.indexOf('function renderDisplaySettings()'));
  assert.doesNotMatch(source,/\bconfirm\(/);
  assert.ok(source.indexOf('prepareBackup(file)')<source.indexOf('decisions.request'));
  assert.match(source,/onDiscard: async \(\) => \{[\s\S]*restorePrepared\(prepared\)/);
  assert.match(source,/cancelLabel: tr\('Отмена', 'Cancel'\)/);
  assert.match(source,/backupPending = false/);
  assert.match(source,/Не удалось подтвердить восстановление/);
});
