import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecisionDialog } from '../public/decision.js';

function fixture() {
  const node = () => ({ events: {}, hidden: false, disabled: false, classList: { toggle() {} },
    addEventListener(event, handler) { this.events[event] = handler; }, focus() { this.focused = true; } });
  const nodes = Object.fromEntries(['dialog', 'title', 'message', 'status', 'save', 'discard', 'cancel'].map(key => [key, node()]));
  nodes.dialog.open = false;
  nodes.dialog.showModal = () => { nodes.dialog.open = true; };
  nodes.dialog.close = () => { nodes.dialog.open = false; nodes.dialog.events.close(); };
  return { ...nodes, controller: createDecisionDialog(nodes) };
}

test('the category decision keeps focus on the non-destructive option and cancel never discards', () => {
  const f = fixture();
  let writes = 0;
  f.controller.request({ title: 'Save?', message: 'Unsaved', onSave: () => writes++, onDiscard: () => writes++ });
  assert.equal(f.dialog.open, true);
  assert.equal(f.cancel.focused, true);
  assert.equal(f.title.textContent, 'Save?');
  f.cancel.events.click();
  assert.equal(writes, 0);
  assert.equal(f.dialog.open, false);
});

test('save must finish successfully before navigation can continue', async () => {
  const f = fixture();
  let resolve, navigations = 0, writes = 0;
  f.controller.request({ onSave() { writes++; return new Promise(done => { resolve = done; }); }, proceed: () => navigations++ });
  const pending = f.save.events.click();
  await f.save.events.click();
  let prevented = false;
  f.dialog.events.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.dialog.open, true);
  assert.equal(navigations, 0);
  assert.equal(writes, 1);
  assert.equal(f.cancel.disabled, true);
  resolve(true); await pending;
  assert.equal(navigations, 1);
  assert.equal(f.dialog.open, false);
});

test('failed writes keep the draft decision visible and allow retry or cancel', async () => {
  const f = fixture();
  let navigations = 0;
  f.controller.request({ onSave: async () => false, proceed: () => navigations++ });
  await f.save.events.click();
  assert.equal(f.dialog.open, true);
  assert.equal(f.status.hidden, false);
  assert.match(f.status.textContent, /Изменения оставлены на экране/);
  assert.equal(f.save.disabled, false);
  assert.equal(navigations, 0);
});

test('discard resolves before continuing, and continuations may open the next decision', async () => {
  const f = fixture();
  const events = [];
  f.controller.request({ onDiscard() { events.push('discard'); }, proceed() {
    events.push('continue');
    assert.equal(f.controller.request({ title: 'Delete?', onDiscard: async () => true }), true);
  } });
  await f.discard.events.click();
  assert.deepEqual(events, ['discard', 'continue']);
  assert.equal(f.dialog.open, true);
  // A queued close event from the old dialog must not erase the new decision.
  f.dialog.events.close();
  await f.discard.events.click();
  assert.equal(f.dialog.open, false);
});

test('exceptions stay visible, and a second request cannot overwrite an open decision', async () => {
  const f = fixture();
  f.controller.request({ title: 'Original', onSave: async () => { throw new Error('No connection'); } });
  assert.equal(f.controller.request({ title: 'Other' }), false);
  await f.save.events.click();
  assert.equal(f.title.textContent, 'Original');
  assert.equal(f.status.textContent, 'No connection');
  assert.equal(f.dialog.open, true);
});
