import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanState, cleanDrawState, gamesInScope, gameAction, eligibleGames, drawGame, randomIndex, matchesMode } from '../public/randomizer.js';

const games = [{ id: '10', name: 'One' }, { id: '20', name: 'Two' }, { id: '30', name: 'Three' }];

test('uninstalled checkbox changes visible and draw pools and preserves saved exclusions', () => {
  const library = [...games, { id: '40', name: 'Not installed', installed: false }];
  const off = cleanState({ excluded: ['20'] });
  assert.equal(off.includeUninstalled, false);
  assert.equal(cleanState({ includeUninstalled: 'true' }).includeUninstalled, false);
  assert.equal(gamesInScope(library, off).length, 3);
  assert.deepEqual(eligibleGames(library, off).map(game => game.id), ['10', '30']);
  const on = cleanState({ ...off, includeUninstalled: true, seen: ['10', '30'] });
  assert.equal(gamesInScope(library, on).length, 4);
  assert.equal(drawGame(library, on, () => 0).game.id, '40');
  assert.deepEqual(cleanState(JSON.parse(JSON.stringify(on))), on);
  assert.equal(drawGame([library[3]], off), null);
  assert.equal(drawGame(library, { ...on, includeUninstalled: false }, () => 0).game.installed === false, false);
});

test('selected game action installs only uninstalled games and cannot create arbitrary URLs', () => {
  assert.deepEqual(gameAction({ id: '40', installed: false }), { href: 'steam://install/40', label: 'Установить в Steam' });
  assert.deepEqual(gameAction({ id: '10', installed: true }), { href: 'steam://run/10', label: 'Играть в Steam' });
  assert.throws(() => gameAction({ id: 'javascript:alert(1)' }));
});

test('empty library and all-excluded pools never draw', () => {
  assert.equal(drawGame([], cleanState()), null);
  assert.equal(drawGame(games, cleanState({ excluded: ['10', '20', '30'] })), null);
});
test('every eligible game appears exactly once in a complete cycle', () => {
  let state = cleanState();
  const ids = [];
  for (let i = 0; i < games.length; i++) {
    const result = drawGame(games, state, () => 0);
    ids.push(result.game.id); state = result.state;
    assert.equal(result.newCycle, false);
  }
  assert.deepEqual(ids, ['10', '20', '30']);
  assert.equal(state.history.length, 3);
});
test('cycle boundary avoids the previous game and resets the bag', () => {
  const state = cleanState({ seen: ['10', '20', '30'], current: '10' });
  const result = drawGame(games, state, () => 0);
  assert.equal(result.newCycle, true);
  assert.equal(result.game.id, '20');
  assert.deepEqual(result.state.seen, ['20']);
});
test('a single eligible game can start another cycle', () => {
  const result = drawGame(games, cleanState({ excluded: ['20', '30'], current: '10', seen: ['10'] }), () => 0);
  assert.equal(result.game.id, '10');
  assert.equal(result.newCycle, true);
});
test('excluded games are never drawn and newly installed games join the current cycle', () => {
  const state = cleanState({ excluded: ['20'], seen: ['10'] });
  assert.equal(drawGame(games, state, () => 0).game.id, '30');
  assert.deepEqual(eligibleGames(games, state).map(game => game.id), ['10', '30']);
});
test('allow-repeats mode can select the previous game', () => {
  const result = drawGame(games, cleanState({ noRepeats: false, current: '10', seen: ['10', '20', '30'] }), () => 0);
  assert.equal(result.game.id, '10');
  assert.equal(result.newCycle, false);
});
test('drawing does not mutate input state and caps history', () => {
  const now = '2026-08-31T12:00:00.000Z';
  const state = cleanState({ history: Array.from({ length: 30 }, () => ({ id: '20', at: now })) });
  const copy = structuredClone(state);
  const result = drawGame(games, state, () => 0, now);
  assert.deepEqual(state, copy);
  assert.equal(result.state.history.length, 30);
  assert.deepEqual(result.state.history[0], { id: '10', at: now });
});
test('saved state sanitizes corrupted fields and round-trips settings', () => {
  for (const value of [null, [], 'bad', 4]) assert.deepEqual(cleanState(value), cleanState());
  const clean = cleanState({ excluded: ['10', '10', '../secret', 25], seen: 'bad', history: [null, {}, { id: '20', at: 'broken' }], customPaths: [null, '', 'D:\\Steam', 'D:\\Steam'], current: 'javascript:alert(1)' });
  assert.deepEqual(clean.excluded, ['10']);
  assert.deepEqual(clean.history, []);
  assert.deepEqual(clean.customPaths, ['D:\\Steam']);
  assert.equal(clean.current, null);
  const state = cleanState({ excluded: ['30'], seen: ['10'], noRepeats: false, current: '10', history: [{ id: '10', at: '2026-08-31T12:00:00Z' }], customPaths: ['D:\\Steam'] });
  assert.deepEqual(cleanState(JSON.parse(JSON.stringify(state))), state);
});
test('random index stays within bounds and rejects invalid ranges', () => {
  for (const length of [1, 2, 3, 34, 1000]) {
    for (let i = 0; i < 200; i++) {
      const index = randomIndex(length);
      assert.ok(index >= 0 && index < length);
    }
  }
  for (const invalid of [0, -1, 0.5, NaN, 2 ** 32]) assert.throws(() => randomIndex(invalid));
});
test('removing an installation does not block the remaining bag', () => {
  const result = drawGame(games.slice(0, 2), cleanState({ seen: ['10', '20', '30'], current: '30' }), () => 0);
  assert.equal(result.newCycle, true);
  assert.equal(result.game.id, '10');
});

test('modes filter the draw pool without changing probabilities', () => {
  const library = [
    { id: '10', name: 'Installed new', installed: true, lastPlayed: 0 },
    { id: '20', name: 'Installed recent', installed: true, lastPlayed: 2_000_000_000 },
    { id: '30', name: 'Uninstalled', installed: false },
  ];
  const assignments = { '10': ['favorite'], '30': ['favorite'] };
  assert.deepEqual(eligibleGames(library, cleanState({ mode: 'installed', includeUninstalled: true }), assignments).map(game => game.id), ['10', '20']);
  assert.deepEqual(eligibleGames(library, cleanState({ mode: 'uninstalled', includeUninstalled: true }), assignments).map(game => game.id), ['30']);
  assert.deepEqual(eligibleGames(library, cleanState({ mode: 'unplayed', includeUninstalled: true }), assignments).map(game => game.id), ['10', '30']);
  assert.deepEqual(eligibleGames(library, cleanState({ mode: 'category:favorite', includeUninstalled: true }), assignments).map(game => game.id), ['10', '30']);
  assert.equal(matchesMode(library[0], 'dormant', assignments, 2_000_000_000), true);
  assert.equal(matchesMode(library[1], 'dormant', assignments, 2_000_000_000), false);
  assert.equal(drawGame(library, cleanState({ mode: 'category:favorite', includeUninstalled: true }), () => 1, undefined, assignments).game.id, '30');
});

test('draw state accepts only supported modes and Steam IDs', () => {
  assert.equal(cleanDrawState({ mode: 'category:favorite' }).mode, 'category:favorite');
  for (const mode of ['category:../file', 'weighted', '', null]) assert.equal(cleanDrawState({ mode }).mode, 'all');
  assert.deepEqual(cleanDrawState({ seen: ['10', '4294967296', '1'.repeat(20)] }).seen, ['10']);
  assert.equal(cleanDrawState({ current: '4294967296' }).current, null);
  assert.deepEqual(cleanDrawState({ history: [{ id: '4294967296', at: '2026-09-01T00:00:00Z' }] }).history, []);
});
