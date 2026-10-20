import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');

test('a signed release hashes the signed launcher into its manifest', async () => {
  const builder = await read('scripts/build-release.ps1');
  const finish = builder.search(/if \(\$SignedLauncher\) \{\r?\n\s+\$signature/);
  const manifest = builder.indexOf("Set-Content -LiteralPath (Join-Path $packageDirectory 'release-manifest.json')");
  assert.ok(finish > 0 && manifest > finish);
  // Both launcher copies are replaced before the manifest is written.
  for (const copy of ['-Destination $launcher -Force', "'scripts\\PlayNextLauncher.exe') -Force"]) {
    const position = builder.indexOf(copy, finish);
    assert.ok(position > finish && position < manifest, copy);
  }
  // Only -TestCertificate lets an untrusted or untimestamped signature through.
  assert.match(builder, /-not \$TestCertificate -and \(\$signature\.Status -ne 'Valid' -or -not \$signature\.TimeStamperCertificate\)/);
  assert.match(builder, /A finished release is never changed/);
});

test('the release workflow signs between the prepare and finish steps and verifies the result', async () => {
  const workflow = await read('.github/workflows/release.yml');
  const steps = ["@('-Prepare')", 'actions/upload-artifact', 'signpath/github-action-submit-signing-request', "-SignedLauncher 'signed/Play Next.exe'", '--signed'];
  const positions = steps.map(step => workflow.indexOf(step));
  assert.ok(positions.every(position => position > 0), 'Every signing step is present');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /persist-credentials: false/);
});

test('both READMEs publish the SignPath code signing policy', async () => {
  for (const file of ['README.md', 'README.ru.md']) {
    const text = await read(file);
    assert.match(text, /Code signing policy/, file);
    assert.match(text, /Free code signing provided by \[SignPath\.io\]\(https:\/\/about\.signpath\.io\/\), certificate by \[SignPath Foundation\]\(https:\/\/signpath\.org\/\)/, file);
  }
});
