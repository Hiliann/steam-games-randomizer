import test from 'node:test';
import assert from 'node:assert/strict';
import { createToast } from '../public/toast.js';

function fixture() {
  const timers = new Map();
  let timerId = 0;
  const element = () => ({ hidden: true, children: [], events: {}, disabled: false, hovered: false,
    replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); },
    addEventListener(name, handler) { this.events[name] = handler; },
    contains(child) { return this.children.includes(child); }, matches() { return this.hovered; },
  });
  const node = element();
  const document = { activeElement: null, createElement: element };
  const errors = [];
  const toast = createToast({ node, document, schedule(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, cancel(id) { timers.delete(id); }, onError: error => errors.push(error.message) });
  return { toast, node, document, timers, errors, expire() { const entry = [...timers.values()][0]; entry?.fn(); } };
}

test('notifications replace previous timers and Undo remains visible longer', () => {
  const f = fixture();
  f.toast.show('Saved');
  assert.equal([...f.timers.values()][0].ms, 4000);
  f.toast.show('Excluded', { label: 'Undo', run() {} });
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].ms, 10000);
  assert.equal(f.node.children[0].textContent, 'Excluded');
  assert.equal(f.node.children[1].textContent, 'Undo');
  f.expire();
  assert.equal(f.node.hidden, true);
});

test('hover and keyboard focus pause notification expiration', () => {
  const f = fixture();
  f.toast.show('Excluded', { label: 'Undo', run() {} });
  f.node.events.pointerenter();
  assert.equal(f.timers.size, 0);
  f.node.events.pointerleave();
  assert.equal(f.timers.size, 1);
  f.document.activeElement = f.node.children[1];
  f.node.events.focusin();
  f.node.events.pointerleave();
  assert.equal(f.timers.size, 0);
  f.document.activeElement = null;
  f.node.events.focusout();
  assert.equal(f.timers.size, 1);
});

test('Undo cannot run twice and a late result cannot dismiss a newer notification', async () => {
  const f = fixture();
  let resolve;
  let calls = 0;
  f.toast.show('Excluded', { label: 'Undo', run() { calls++; return new Promise(done => { resolve = done; }); } });
  const button = f.node.children[1];
  const pending = button.events.click();
  await button.events.click();
  assert.equal(calls, 1);
  assert.equal(button.disabled, true);
  assert.equal(f.timers.size, 0);
  f.toast.show('New message');
  resolve(true);
  await pending;
  assert.equal(f.node.hidden, false);
  assert.equal(f.node.children[0].textContent, 'New message');
  f.expire();
  assert.equal(f.node.hidden, true);
});

test('failed actions stay visible, unlock retry and report exceptions', async () => {
  const f = fixture();
  f.toast.show('Excluded', { label: 'Undo', run: async () => false });
  await f.node.children[1].events.click();
  assert.equal(f.node.hidden, false);
  assert.equal(f.node.children[1].disabled, false);
  f.toast.show('Excluded', { label: 'Undo', run: async () => { throw new Error('Offline'); } });
  await f.node.children[1].events.click();
  assert.deepEqual(f.errors, ['Offline']);
});

test('successful Undo dismisses its own notification', async () => {
  const f = fixture();
  f.toast.show('Excluded', { label: 'Undo', run: async () => true });
  await f.node.children[1].events.click();
  assert.equal(f.node.hidden, true);
  assert.equal(f.timers.size, 0);
});
