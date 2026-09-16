import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSessions, validBrowserSessionId } from '../lib/browser-sessions.mjs';
import { connectBrowserSession } from '../public/browser-session.js';

function fakeClock() {
  let time = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at: time + delay, callback });
      return id;
    },
    clearTimer: id => timers.delete(id),
    advance(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].callback();
      }
      time = target;
    },
  };
}

test('browser session IDs are narrow and predictable', () => {
  assert.equal(validBrowserSessionId('1234567890abcdef'), true);
  for (const value of [null, '', 'short', '1234567890abcdef?', 'x'.repeat(81)]) assert.equal(validBrowserSessionId(value), false);
});

test('the last disconnected tab stops the app after a reload-safe grace period', () => {
  const clock = fakeClock();
  let stops = 0;
  const sessions = createBrowserSessions({ ...clock, shutdownDelayMs: 4000, onEmpty: () => { stops++; } });
  const closeFirst = sessions.open();
  closeFirst();
  clock.advance(3000);
  const closeReplacement = sessions.open();
  clock.advance(2000);
  assert.equal(stops, 0, 'a replacement connection cancels shutdown during a reload');
  closeReplacement();
  clock.advance(4000);
  assert.equal(stops, 1);
});

test('one disconnected tab does not stop another connected tab', () => {
  const clock = fakeClock();
  let stops = 0;
  const sessions = createBrowserSessions({ ...clock, shutdownDelayMs: 4000, onEmpty: () => { stops++; } });
  const closeFirst = sessions.open();
  const closeSecond = sessions.open();
  closeFirst();
  clock.advance(10000);
  assert.equal(stops, 0);
  closeSecond();
  clock.advance(4000);
  assert.equal(stops, 1);
});

test('a background startup without an opened page stays available', () => {
  const clock = fakeClock();
  let stops = 0;
  createBrowserSessions({ ...clock, shutdownDelayMs: 4000, onEmpty: () => { stops++; } });
  clock.advance(60000);
  assert.equal(stops, 0);
});

test('browser client opens one local socket and reconnects after a restored page', () => {
  const listeners = {};
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.closed = false; sockets.push(this); }
    close() { this.closed = true; }
  }
  const windowObject = {
    location: { protocol: 'http:', host: '127.0.0.1:3210' },
    addEventListener(name, listener) { listeners[name] = listener; },
  };
  const disconnect = connectBrowserSession({ windowObject, WebSocketClass: FakeSocket });
  assert.match(sockets[0].url, /^ws:\/\/127\.0\.0\.1:3210\/api\/browser-session\?id=[a-zA-Z0-9_-]{16,80}$/);
  listeners.pagehide();
  assert.equal(sockets[0].closed, true);
  listeners.pageshow();
  assert.equal(sockets.length, 2);
  disconnect();
  assert.equal(sockets[1].closed, true);
});
