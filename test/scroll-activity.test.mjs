import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrollActivity } from '../public/scroll-activity.js';

test('native scrollbars fade independently after scrolling, and scrolling extends visibility', () => {
  let listener, next = 0;
  const timers = new Map();
  const root = { addEventListener(name, handler, options) { assert.equal(name, 'scroll'); assert.equal(options.capture, true); listener = handler; }, removeEventListener() { listener = null; } };
  const node = () => { const classes = new Set(); return { classes, matches: () => true, classList: { add: name => classes.add(name), remove: name => classes.delete(name) } }; };
  const a = node(), b = node();
  const activity = createScrollActivity({ root, schedule(fn, delay) { assert.equal(delay, 1100); timers.set(++next, fn); return next; }, cancel(id) { timers.delete(id); } });
  listener({ target: a }); listener({ target: b }); listener({ target: a });
  assert.equal(timers.size, 2);
  assert.ok(a.classes.has('is-scrolling')); assert.ok(b.classes.has('is-scrolling'));
  timers.get(2)(); assert.equal(b.classes.size, 0); assert.equal(a.classes.size, 1);
  activity.dispose(); assert.equal(a.classes.size, 0); assert.equal(listener, null);
});

test('unrelated elements and document scroll events do not alter the interface', () => {
  let listener;
  createScrollActivity({ root: { addEventListener(_, handler) { listener = handler; } }, schedule() { assert.fail('No timer should be scheduled'); } });
  listener({ target: {} }); listener({ target: { matches: () => false } });
});
