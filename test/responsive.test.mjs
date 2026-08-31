import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/responsive.css', import.meta.url), 'utf8');

test('library scope uses a labelled native checkbox and wraps on narrow screens', () => {
  assert.match(html, /for="include-uninstalled"/);
  assert.match(html, /id="include-uninstalled" type="checkbox" aria-describedby="scope-note"/);
  assert.match(html, /id="scope-note"[^>]*role="status"/);
  assert.match(css, /\.scope-toggle\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.library-scope\s*\{[^}]*flex-direction:\s*column/s);
});

test('responsive stylesheet is loaded after the theme and zoom remains available', () => {
  assert.ok(html.indexOf('href="/responsive.css"') > html.indexOf('href="/style.css"'));
  assert.match(html, /name="viewport"[^>]*width=device-width[^>]*viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
});
test('responsive CSS covers small screens, tablets and wide monitors with bounded columns', () => {
  for (const width of [1199, 900, 640, 480, 380]) assert.ok(css.includes(`@media (max-width: ${width}px)`));
  assert.ok(css.includes('@media (min-width: 1600px)'));
  const columns = [...css.matchAll(/--library-columns:\s*(\d+)/g)].map(match => Number(match[1]));
  assert.deepEqual(columns, [6, 7, 5, 4, 3, 2]);
  assert.match(css, /grid-template-columns:\s*repeat\(var\(--library-columns\), minmax\(0, 1fr\)\)/);
  assert.match(css, /\.game-card h3\s*\{[^}]*white-space:\s*normal/s);
});
test('touch targets, dialogs and narrow-screen controls have explicit responsive treatment', () => {
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.draw-panel\s*\{\s*order:\s*-1/);
  assert.match(html, /id="libraries-button"[^>]*aria-label=/);
  assert.match(css, /font-size:\s*16px/);
});
test('responsive CSS blocks are balanced and do not hide document overflow to mask layout errors', () => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  for (const character of source) {
    if (character === '{') depth++;
    if (character === '}') depth--;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
  assert.doesNotMatch(css, /(?:html|body)\s*\{[^}]*overflow-x:\s*hidden/s);
});
