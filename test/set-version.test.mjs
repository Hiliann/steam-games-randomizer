import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RELEASE_FILES, SOURCE_FILES, setVersion } from '../scripts/set-version.mjs';

const project = path.resolve(import.meta.dirname, '..');
const read = file => readFile(path.join(project, file), 'utf8');

test('every file that names the app version agrees with package.json', async () => {
  const { version } = JSON.parse(await read('package.json'));
  for (const [file, apply] of Object.entries(SOURCE_FILES)) {
    const text = await read(file);
    assert.equal(apply(text, version, file), text, `${file} names another version`);
  }
  const page = await read('docs/index.html');
  const release = { version, sha256: page.match(/class="checksum">([a-f0-9]{64})/)[1], megabytes: Number(page.match(/ZIP, (\d+) MB/)[1]) };
  for (const [file, apply] of Object.entries(RELEASE_FILES)) {
    const text = await read(file);
    assert.equal(apply(text, release, file), text, `${file} names another release`);
  }
});

test('a new version updates sources first and the website after the archive is built', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'play-next-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of [...Object.keys(SOURCE_FILES), ...Object.keys(RELEASE_FILES)]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await cp(path.join(project, file), path.join(root, file));
  }
  const { version: previous } = JSON.parse(await read('package.json'));
  assert.match(await setVersion(['9.8.7'], root), /9\.8\.7/);
  for (const file of Object.keys(SOURCE_FILES)) assert.match(await readFile(path.join(root, file), 'utf8'), /9\.8\.7/, file);
  assert.equal(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version, '9.8.7');
  assert.match(await readFile(path.join(root, 'launcher/PlayNextLauncher.cs'), 'utf8'), /AssemblyFileVersion\("9\.8\.7\.0"\)/);
  assert.doesNotMatch(await readFile(path.join(root, 'server.mjs'), 'utf8'), new RegExp(`APP_VERSION = '${previous.replaceAll('.', '\\.')}'`));

  const wrong = path.join(root, 'PlayNext-9.8.6-win-x64.zip');
  await writeFile(wrong, 'old');
  await assert.rejects(setVersion(['--release', wrong], root), /PlayNext-9\.8\.7-win-x64\.zip/);
  const archive = path.join(root, 'PlayNext-9.8.7-win-x64.zip');
  const bytes = Buffer.alloc(3 * 1024 ** 2 + 1, 7);
  await writeFile(archive, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await setVersion(['--release', archive], root);
  for (const [page, unit] of [['docs/index.html', 'MB'], ['docs/ru/index.html', 'МБ']]) {
    const html = await readFile(path.join(root, page), 'utf8');
    assert.ok(html.includes(`class="checksum">${sha256}`), page);
    assert.ok(html.includes(`v9.8.7 · Windows 10 / 11, x64 · ZIP, 3 ${unit}`), page);
    assert.ok(html.includes('Play Next 9.8.7 · Windows x64'), page);
    assert.doesNotMatch(html, new RegExp(`v${previous.replaceAll('.', '\\.')}/|releases/tag/v${previous.replaceAll('.', '\\.')}`), page);
  }
  const history = await readFile(path.join(root, 'RELEASE_HISTORY.md'), 'utf8');
  assert.match(history, /Актуальная версия: \*\*9\.8\.7\*\*/);
  const row = `| [9.8.7](https://github.com/Hiliann/steam-games-randomizer/releases/tag/v9.8.7) | \`PlayNext-9.8.7-win-x64.zip\` | \`${sha256}\` |`;
  assert.ok(history.includes(`| --- | --- | --- |\n${row}\n| [${previous}]`));
  await setVersion(['--release', archive], root);
  assert.equal(await readFile(path.join(root, 'RELEASE_HISTORY.md'), 'utf8'), history, 'running the release step twice changes nothing');
});

test('version arguments are validated before any file changes', async () => {
  for (const args of [[], ['2.7'], ['v2.7.0'], ['2.7.0', 'extra'], ['--release']]) await assert.rejects(setVersion(args, path.join(tmpdir(), 'missing-play-next')), /Usage/);
});
