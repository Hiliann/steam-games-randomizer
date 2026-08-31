import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { demoGames, englishDemoGames, createDemoPicker } from '../docs/site.js';

const root = new URL('../docs/', import.meta.url);
const site = 'https://hiliann.github.io/steam-games-randomizer/';

test('public demo selects every fictional game and avoids adjacent repeats', () => {
  for (const [language, games] of [['ru', demoGames], ['en', englishDemoGames]]) {
  for (const random of [() => 0, () => 0.9999, Math.random]) {
    const pick = createDemoPicker(random, language);
    const rounds = [games[0].title];
    for (let i = 0; i < 59; i++) rounds.push(pick().title);
    assert.ok(rounds.every(title => games.some(game => game.title === title)));
    for (let i = 1; i < rounds.length; i++) assert.notEqual(rounds[i], rounds[i - 1]);
    for (let i = 0; i < rounds.length; i += 3) assert.equal(new Set(rounds.slice(i, i + 3)).size, 3);
  }
  }
});

test('public page has matching bindings and relative assets for a project subpath', async () => {
  const script = await readFile(new URL('site.js', root), 'utf8');
  for (const [page, language] of [['index.html', 'ru'], ['en/index.html', 'en']]) {
  const pageUrl = new URL(page, root);
  const html = await readFile(pageUrl, 'utf8');
  assert.ok(html.includes(`<html lang="${language}">`));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of script.matchAll(/getElementById\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]));
  for (const match of html.matchAll(/(?:src|href)="(\.\.?\/[^"#]*)"/g)) {
    const local = new URL(match[1], pageUrl);
    assert.ok(local.href.startsWith(root.href), 'Asset stays inside the public website');
    if (match[1].endsWith('/')) assert.ok((await stat(new URL('index.html', local))).isFile());
    else assert.ok((await stat(local)).isFile());
  }
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]));
  assert.doesNotMatch(html, /(?:src|href)="\/[^/]/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, language === 'en' ? /fictional examples/ : /вымышленные игры/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|WebSocket|\.innerHTML|steam:\/\//);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /[\u2013\u2014]|&(?:mdash|ndash);|portable|переносим/iu);
  for (const locale of ['ru', 'en', 'x-default']) assert.ok(html.includes(`hreflang="${locale}"`));
  if (language === 'en') assert.match(html, /interface is currently in Russian/);
  }
  assert.ok((await stat(new URL('.nojekyll', root))).isFile());
});

test('download version and social preview agree with the packaged release', async () => {
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const version = metadata.version.replaceAll('.', '\\.');
  const checksums = [];
  for (const [page, locale, title] of [['index.html', 'ru_RU', 'Play Next - во что поиграть сегодня?'], ['en/index.html', 'en_US', 'Play Next - what will you play today?']]) {
  const html = await readFile(new URL(page, root), 'utf8');
  const assets = [...html.matchAll(/releases\/download\/v([^/]+)\/([^"<]+)/g)];
  assert.ok(assets.length >= 3);
  for (const [, tag, asset] of assets) {
    assert.equal(tag, metadata.version);
    assert.match(asset, new RegExp(`^PlayNext-${version}-win-x64\\.zip(?:\\.sha256)?$`));
  }
  const canonical = html.match(/rel="canonical" href="([^"]+)"/)[1];
  assert.equal(canonical, site + (locale === 'en_US' ? 'en/' : ''));
  assert.ok(html.includes(`<title>${title}</title>`));
  assert.ok(html.includes(`property="og:locale" content="${locale}"`));
  assert.ok(html.includes(`property="og:url" content="${canonical}"`));
  for (const property of ['og:image', 'twitter:image']) {
    assert.match(html, new RegExp(`(?:property|name)="${property}" content="${site.replaceAll('.', '\\.')}og\\.png"`));
  }
  const checksum = html.match(/class="checksum">([a-f0-9]{64})<\/code>/)?.[1];
  assert.ok(checksum);
  checksums.push(checksum);
  }
  assert.equal(checksums[0], checksums[1]);
  const png = await readFile(new URL('og.png', root));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1536);
  assert.equal(png.readUInt32BE(20), 1024);
});

test('project descriptions and application text use ordinary hyphens and neutral naming', async () => {
  for (const file of ['README.md', 'README.en.md', 'READ ME FIRST.txt', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'start.ps1', 'public/index.html', 'public/app.js', 'package.json']) {
    const text = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /[\u2013\u2014]|portable|переносим/iu, file);
  }
  const ru = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const en = await readFile(new URL('../README.en.md', import.meta.url), 'utf8');
  assert.match(ru, /\[English\]\(README\.en\.md\)/);
  assert.match(en, /\[Русский\]\(README\.md\)/);
  assert.match(en, /interface is currently in Russian/);
});
