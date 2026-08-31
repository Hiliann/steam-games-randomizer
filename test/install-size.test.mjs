import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateInstallSize } from '../lib/install-size.mjs';

const depot = (size, config = {}, extra = {}) => ({ config, manifests: { public: { size, download: '1' } }, ...extra });
const estimate = (depots, options) => estimateInstallSize({ depots }, options);

test('size is uncompressed public content, with large string values preserved', () => {
  const result = estimate({ 1: depot('6000000000'), 2: depot(123), branches: { public: {} } });
  assert.equal(result.bytes, 6000000123);
  assert.equal(result.estimated, true);
  assert.equal(result.platform, 'windows');
});
test('OS, architecture, language and ownership choose applicable content only', () => {
  const content = { 1: depot(10), 2: depot(20, { oslist: 'windows', osarch: '64' }), 3: depot(30, { oslist: 'windows', osarch: '32' }), 4: depot(40, { oslist: 'linux' }), 5: depot(50, { language: 'russian' }), 6: depot(60, { language: 'english' }), 7: depot(70) };
  const options = { language: 'russian', ownedDepots: new Set(['1', '2', '3', '4', '5', '6']) };
  assert.equal(estimate(content, options).bytes, 80);
  assert.equal(estimate(content, { ...options, architecture: '32' }).bytes, 90);
  assert.equal(estimate(content, { ...options, language: 'german' }).bytes, 90);
  assert.equal(estimate(content, { ...options, language: 'german' }).language, 'english');
  assert.equal(estimate({ 1: depot(10), 2: depot(20, { osarch: '32' }) }).bytes, 30);
});
test('base estimate excludes DLC, optional content, prerequisites, censored and beta-only depots', () => {
  assert.equal(estimate({
    1: depot(10), 2: depot(100, {}, { dlcappid: '42' }), 3: depot(100, {}, { optional: '1' }),
    4: { depotfromapp: '228980', sharedinstall: '1' }, 5: depot(100, { optionaldlc: '1' }),
    6: depot(100, { lowviolence: '1' }), 7: { manifests: { beta: { size: '100' } } },
    8: {}, 9: depot(100, { steamdeck: '1' }), 10: depot(100, { realm: 'china' }),
  }).bytes, 10);
});
test('shared base content resolves its parent, but absent or cyclic parents give unknown', () => {
  const apps = new Map([['42', { depots: { 2: depot(50) } }]]);
  assert.equal(estimate({ 1: depot(10), 2: { depotfromapp: '42' } }, { apps }).bytes, 60);
  assert.equal(estimate({ 1: depot(10), 2: { depotfromapp: '42' } }).bytes, null);
  apps.set('42', { depots: { 2: { depotfromapp: '43' } } });
  apps.set('43', { depots: { 2: { depotfromapp: '42' } } });
  assert.equal(estimate({ 2: { depotfromapp: '42' } }, { apps }).bytes, null);
  assert.equal(estimate({ 1: depot(10), 2: { depotfromapp: '42', config: { oslist: 'linux' } } }).bytes, 10);
});
test('missing or invalid sizes never produce zero or misleading partial totals', () => {
  assert.equal(estimateInstallSize({}).bytes, null);
  assert.equal(estimate({}).bytes, null);
  assert.equal(estimate({ 1: depot(0) }).bytes, null);
  for (const size of [undefined, null, '', -1, true, {}, 'NaN', '123abc', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(estimate({ 1: depot(10), 2: depot(size) }).bytes, null);
  }
  assert.equal(estimate({ 1: depot(Number.MAX_SAFE_INTEGER), 2: depot(1) }).bytes, null);
  assert.equal(estimate({ 1: depot(10), 2: depot(20, { language: 'japanese' }) }).bytes, 10);
  assert.equal(estimate({ 2: depot(20, { language: 'japanese' }) }).bytes, null);
  assert.equal(estimate({ 1: depot(10) }, { ownedDepots: new Set() }).bytes, null);
});
