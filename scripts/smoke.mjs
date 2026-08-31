const base = process.env.APP_URL ?? 'http://127.0.0.1:3210';
const health = await fetch(base + '/api/health').then(response => response.json());
if (health.app !== 'steam-games-randomizer') throw new Error('Wrong application');
const snapshot = await fetch(base + '/api/games').then(response => response.json());
const artwork = await Promise.all(snapshot.games.map(async game => {
  const response = await fetch(`${base}/art/${game.id}/cover`);
  await response.arrayBuffer();
  if (![200, 204].includes(response.status)) throw new Error(`Artwork failed for ${game.id}: ${response.status}`);
  return response.status === 200;
}));
for (const asset of ['/', '/app.js', '/randomizer.js', '/style.css', '/responsive.css', '/icon.svg']) {
  const response = await fetch(base + asset);
  if (!response.ok) throw new Error(`Asset failed: ${asset}`);
  await response.arrayBuffer();
}
console.log(JSON.stringify({ installedGames: snapshot.games.length, coversAvailable: artwork.filter(Boolean).length, libraries: snapshot.libraries, skipped: snapshot.skipped, utilities: snapshot.utilities, warnings: snapshot.warnings }, null, 2));
