import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { desktopOwnerId, watchDesktopOwner } from '../lib/desktop-owner.mjs';

test('native owner IDs cannot accept invalid process targets', () => {
  assert.equal(desktopOwnerId('42'), 42);
  for (const id of [undefined, '', '0', '-1', '42x', '01', '2.3', '2147483648', NaN]) assert.equal(desktopOwnerId(id), 0);
});
test('an idle or disconnected renderer cannot stop an open desktop host', () => {
  let tick, stops = 0, clears = 0, alive = true;
  const dispose = watchDesktopOwner(42, { isAlive: () => alive, setTimer: cb => { tick = cb; return 1; }, clearTimer: () => clears++, onExit: () => stops++ });
  for (let index = 0; index < 100; index++) tick();
  assert.equal(stops, 0);
  alive = false; tick(); tick();
  assert.equal(stops, 1); assert.equal(clears, 1);
  dispose(); tick(); assert.equal(stops, 1);
});
test('browser-only mode does not watch an unrelated parent process', () => {
  let scheduled = 0;
  watchDesktopOwner(0, { setTimer: () => scheduled++ })();
  assert.equal(scheduled, 0);
});
test('native app restricts navigation, releases files for updates and preserves browser data', async () => {
  const source = await readFile(new URL('../launcher/PlayNextLauncher.cs', import.meta.url), 'utf8');
  assert.match(source, /Path.Combine\(PlayNextLauncher.DirectoryPath, "data", "webview"\)/);
  assert.match(source, /health\["desktopOwner"\]/);
  assert.match(source, /WebMessageReceived/);
  assert.match(source, /e\.Source/);
  assert.match(source, /uri\.Scheme != "https"/);
  assert.match(source, /if \(serverStarted && !updating\)/);
  const updater = await readFile(new URL('../scripts/update-common.ps1', import.meta.url), 'utf8');
  assert.ok(updater.indexOf('$desktopProcess.WaitForExit') < updater.lastIndexOf('Move-Item -LiteralPath $incoming'));
  assert.match(updater, /Protected path in manifest/);
  assert.match(updater, /if \(\$Minimized\) \{ Start-Process[^\r\n]+-WindowStyle Hidden/);
  assert.match(updater, /else \{ Start-Process[^\r\n]+-WindowStyle Normal/);
  assert.match(source,/CheckBackgroundUpdateAsync/);
  assert.match(source,/DownloadStarting \+= SaveLocalExport/);
  assert.match(source,/SaveFileDialog/);
  assert.match(source,/"blob:" \+ origin/);
  assert.match(source,/if \(exportDialogOpen \|\| activeExports > 0\)/);
  assert.ok(source.indexOf('UpdateRequestAsync("\/api\/update-apply"')<source.indexOf('updating = true; Close();'));
});
