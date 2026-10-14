import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = name => readFile(new URL('../' + name, import.meta.url));
test('Windows icon has seven distinct alpha-enabled frames, including a 256px PNG', async () => {
  const ico = await file('public/icon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
  const sizes = [];
  let end = 6 + 7 * 16;
  for (let i = 0; i < 7; i++) {
    const at = 6 + i * 16;
    const size = ico[at] || 256;
    sizes.push(size);
    assert.equal(ico[at + 1] || 256, size);
    assert.equal(ico.readUInt16LE(at + 4), 1);
    assert.equal(ico.readUInt16LE(at + 6), 32);
    const length = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    assert.equal(offset, end);
    assert.ok(length > 0 && offset + length <= ico.length);
    const frame = ico.subarray(offset, offset + length);
    if (size === 256) {
      assert.deepEqual(frame, await file('public/icon.png'));
      assert.equal(frame.readUInt32BE(16), 256);
      assert.equal(frame.readUInt32BE(20), 256);
      assert.equal(frame[25], 6); // RGBA, not an opaque RGB image.
    } else {
      assert.equal(frame.readUInt32LE(0), 40);
      assert.equal(frame.readInt32LE(4), size);
      assert.equal(frame.readInt32LE(8), size * 2);
      assert.equal(frame.readUInt16LE(14), 32);
      const alpha = Array.from({ length: size * size }, (_, pixel) => frame[40 + pixel * 4 + 3]);
      assert.ok(alpha.includes(0) && alpha.some(value => value === 255));
    }
    end = offset + length;
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
  assert.equal(end, ico.length);
  assert.deepEqual(await file('docs/icon.png'), await file('public/icon.png'));
  assert.deepEqual(await file('docs/icon.ico'), ico);
});

test('native builds and shortcuts use the same production app icon', async () => {
  const build = (await file('scripts/build-desktop.ps1')).toString('utf8');
  const release = (await file('scripts/build-release.ps1')).toString('utf8');
  const integration = (await file('scripts/windows-integration.ps1')).toString('utf8');
  const html = (await file('public/index.html')).toString('utf8');
  assert.match(build, /public\\icon\.ico/);
  assert.match(build, /\/win32icon:\$iconPath/);
  assert.doesNotMatch(build, /FillPolygon|GetHicon/);
  for (const name of ['icon.ico', 'icon.png', 'toast.js']) assert.ok(release.includes(name));
  assert.match(integration, /IconLocation/);
  assert.match(integration, /public\\icon\.ico/);
  assert.match(integration, /Test-ManagedLink \$entry.Path \$entry.Minimized/);
  assert.match(html, /href="\/icon.ico"/);
  assert.match(html, /src="\/icon.png"/);
});
