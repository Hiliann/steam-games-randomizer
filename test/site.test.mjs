import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { demoGames, createDemoPicker } from '../docs/site.js';

const root = new URL('../docs/', import.meta.url);

test('public demo selects every fictional game and avoids adjacent repeats', () => {
  for (const random of [() => 0, () => 0.9999, Math.random]) {
    const pick = createDemoPicker(random);
    const rounds = [demoGames[0].title];
    for (let i = 0; i < 59; i++) rounds.push(pick().title);
    for (let i = 1; i < rounds.length; i++) assert.notEqual(rounds[i], rounds[i - 1]);
    for (let i = 0; i < rounds.length; i += 3) assert.equal(new Set(rounds.slice(i, i + 3)).size, 3);
  }
});

test('public page has matching bindings and relative assets for a project subpath', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const script = await readFile(new URL('site.js', root), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of script.matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]));
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]*)"/g)) {
    if (match[1] !== './') assert.ok((await stat(new URL(match[1], root))).isFile());
  }
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]));
  assert.doesNotMatch(html, /(?:src|href)="\/[^/]/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /вымышленные игры/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|WebSocket|\.innerHTML|steam:\/\//);
  assert.match(html, /connect-src 'none'/);
  assert.ok((await stat(new URL('.nojekyll', root))).isFile());
});

test('download version and social preview agree with the packaged release', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const version = metadata.version.replaceAll('.', '\\.');
  const assets = [...html.matchAll(/releases\/download\/v([^/]+)\/([^"<]+)/g)];
  assert.ok(assets.length >= 3);
  for (const [, tag, asset] of assets) {
    assert.equal(tag, metadata.version);
    assert.match(asset, new RegExp(`^PlayNext-Portable-${version}-win-x64\\.zip(?:\\.sha256)?$`));
  }
  const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
  for (const property of ['og:image', 'twitter:image']) {
    assert.ok(html.includes(`content="${canonical}og.png"`), property);
  }
  const png = await readFile(new URL('og.png', root));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1536);
  assert.equal(png.readUInt32BE(20), 1024);
});
