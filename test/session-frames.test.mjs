import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachSessionFrames } from '../lib/session-frames.mjs';

function socket() {
  const result = new EventEmitter();
  result.writes = []; result.ended = false; result.destroyed = false;
  result.write = bytes => result.writes.push(bytes);
  result.end = bytes => { result.ended = true; result.write(bytes); };
  result.destroy = () => { result.destroyed = true; };
  attachSessionFrames(result); return result;
}
test('ping and pong keep the session open; only a complete close frame ends it', () => {
  const s = socket();
  s.emit('data', Buffer.from([0x89, 0x81, 0, 0, 0, 0, 42]));
  assert.deepEqual(s.writes[0], Buffer.from([0x8a, 1, 42]));
  s.emit('data', Buffer.from([0x8a, 0x80, 0, 0, 0, 0]));
  assert.equal(s.ended, false);
  s.emit('data', Buffer.from([0x88]));
  assert.equal(s.ended, false);
  s.emit('data', Buffer.from([0x80, 0, 0, 0, 0]));
  assert.equal(s.ended, true); assert.equal(s.destroyed, false);
});
test('malformed control frames cannot accumulate unlimited data', () => {
  for (const frame of [[0x88, 126], [0x89, 0], [0x09, 0x80], [0xc9, 0x80], [0x81, 0xff], [0x88, 0x81]]) {
    const s = socket(); s.emit('data', Buffer.from(frame)); assert.equal(s.destroyed, true);
  }
});
