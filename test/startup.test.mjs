import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupScreen } from '../public/startup.js';

function fixture() {
  let hide;
  const node = { hidden: false, attrs: {}, classes: [], setAttribute(name, value) { this.attrs[name] = value; }, addEventListener(name, handler) { this[name] = handler; }, classList: { add: value => node.classes.push(value) } };
  const content = { setAttribute(name, value) { this[name] = value; } };
  const status = {};
  const skip = { addEventListener(name, handler) { this[name] = handler; } };
  const startup = createStartupScreen({ node, content, status, skip, schedule(fn) { hide = fn; } });
  return { node, content, status, skip, startup, hide: () => hide() };
}
test('startup shows real stages and immediately releases the UI when ready', () => {
  const f = fixture(); assert.equal(f.content.inert, true);
  f.startup.stage('Reading games'); assert.equal(f.status.textContent, 'Reading games');
  f.startup.finish(); assert.equal(f.content.inert, false); assert.equal(f.content['aria-busy'], 'false');
  assert.equal(f.node.inert, true); assert.equal(f.node.attrs['aria-hidden'], 'true');
  assert.equal(f.node.hidden, false); f.hide(); assert.equal(f.node.hidden, true);
  f.startup.finish(); assert.equal(f.node.classes.length, 1);
});
test('startup can be dismissed without cancelling the actual loading task', () => {
  const f = fixture(); f.skip.click(); f.startup.stage('A late stage');
  assert.equal(f.content.inert, false); assert.equal(f.status.textContent, undefined);
  f.node.transitionend({ target: f.node }); assert.equal(f.node.hidden, true);
});
