import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createHeroArtwork, playDrawFrames } from '../public/draw-animation.js';

function fixture() {
  const requests = [];
  let live;
  function mockImage() {
    return { id: 'hero-image', className: 'hero-image', alt: '', hidden: true, dataset: {}, decode: async () => {}, removeAttribute() { delete this.src; }, replaceWith(next) { live = next; }, cloneNode() { return mockImage(); } };
  }
  live = mockImage();
  const artwork = createHeroArtwork({ image: live, makeImage() { const next = mockImage(); requests.push(next); return next; } });
  return { get image() { return live; }, artwork, requests };
}
test('a late image cannot replace the current frame artwork', async () => {
  const f = fixture();
  f.artwork.show({ id: '10' }); f.artwork.show({ id: '20' });
  f.requests[1].onload(); await tick();
  assert.equal(f.image.src, '/art/20/hero?v=3');
  f.requests[0].onload(); await tick();
  assert.equal(f.image.src, '/art/20/hero?v=3');
  assert.equal(f.image.dataset.gameId, '20'); assert.equal(f.image.hidden, false);
});
test('preloaded artwork is reused and a missing hero falls back to the same game cover', async () => {
  const f = fixture();
  const preparing = f.artwork.preload([{ id: '10' }, { id: '10' }]);
  assert.equal(f.requests.length, 1);
  f.requests[0].onerror(); await tick();
  assert.equal(f.requests[1].src, '/art/10/cover?v=3');
  f.requests[1].onload(); await preparing;
  f.artwork.show({ id: '10' }); await tick();
  assert.equal(f.requests.length, 2); assert.equal(f.image.dataset.artwork, 'cover');
  assert.equal(f.image.src, '/art/10/cover?v=3');
  f.artwork.show({ id: '10' });
  assert.equal(f.image, f.requests[1]);
});
test('missing artwork clears the previous game instead of showing a wrong cover', async () => {
  const f = fixture();
  f.artwork.show({ id: '10' }); f.requests[0].onload(); await tick();
  f.artwork.show({ id: '20' });
  assert.equal(f.image.hidden, true); assert.equal(f.image.src, undefined);
  f.requests[1].onerror(); await tick(); f.requests[2].onerror(); await tick();
  assert.equal(f.image.hidden, true); assert.equal(f.image.dataset.gameId, '20');
});
test('reset invalidates pending image callbacks and invalid IDs never create requests', async () => {
  const f = fixture();
  f.artwork.show({ id: '10' }); f.artwork.reset(); f.requests[0].onload(); await tick();
  assert.equal(f.image.hidden, true); assert.equal(f.image.src, undefined);
  await f.artwork.preload([{ id: '../file' }, { id: '4294967296' }]);
  assert.equal(f.requests.length, 1);
});
test('unavailable preparation never stalls the complete-card frame sequence', async () => {
  let release;
  const frames = [], waits = [], sequence = [{ id: '10' }, { id: '20' }];
  const playback = playDrawFrames(sequence, { prepare: () => new Promise(() => {}), render: game => frames.push(game.id), wait: async ms => waits.push(ms), schedule: callback => { release = callback; return 1; }, cancel() {} });
  release(); await playback;
  assert.deepEqual(frames, ['10', '20']); assert.deepEqual(waits, [110, 140]);
  assert.deepEqual(sequence, [{ id: '10' }, { id: '20' }]);
});
test('reduced-motion empty sequences do not prepare or render frames', async () => {
  let touched = false;
  await playDrawFrames([], { prepare() { touched = true; }, render() { touched = true; } });
  assert.equal(touched, false);
});
