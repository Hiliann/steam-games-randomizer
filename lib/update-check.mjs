export const LATEST_RELEASE_API = 'https://api.github.com/repos/Hiliann/steam-games-randomizer/releases/latest';
const RELEASE_ROOT = 'https://github.com/Hiliann/steam-games-randomizer/releases';
const MAX_RELEASE_BYTES = 256 * 1024;

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ''));
  if (!match) return null;
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Invalid semantic version.');
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

function safeDownloadUrl(value, version) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const expected = `/Hiliann/steam-games-randomizer/releases/download/v${version}/PlayNext-${version}-win-x64.zip`;
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname === expected ? url.href : null;
  } catch { return null; }
}

export function createUpdateService({ currentVersion, request = fetch, clock = Date.now, cacheMilliseconds = 6 * 60 * 60 * 1000 } = {}) {
  if (!parseVersion(currentVersion)) throw new Error('Current version must use major.minor.patch.');
  let cached = null;
  const read = () => cached?.result ?? { status: 'not-checked', currentVersion };
  const check = async ({ force = false } = {}) => {
    if (!force && cached && clock() - cached.at < cacheMilliseconds) return cached.result;
    let result;
    try {
      const response = await request(LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Play-Next/${currentVersion}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
      const announcedLength = Number(response.headers.get('content-length') ?? 0);
      if (announcedLength > MAX_RELEASE_BYTES) throw new Error('GitHub response is too large.');
      const source = await response.text();
      if (Buffer.byteLength(source, 'utf8') > MAX_RELEASE_BYTES) throw new Error('GitHub response is too large.');
      const release = JSON.parse(source);
      const latestParts = parseVersion(release.tag_name);
      if (!latestParts || release.draft === true || release.prerelease === true || !Array.isArray(release.assets)) throw new Error('GitHub returned an invalid release.');
      const latestVersion = latestParts.join('.');
      const expectedName = `PlayNext-${latestVersion}-win-x64.zip`;
      const asset = release.assets.find(item => item?.name === expectedName);
      result = {
        status: 'ready',
        currentVersion,
        latestVersion,
        updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
        releaseUrl: `${RELEASE_ROOT}/tag/v${latestVersion}`,
        downloadUrl: safeDownloadUrl(asset?.browser_download_url, latestVersion),
        checkedAt: new Date(clock()).toISOString(),
      };
    } catch {
      result = { status: 'offline', currentVersion, checkedAt: new Date(clock()).toISOString() };
    }
    cached = { at: clock(), result };
    return result;
  };
  return { read, check };
}
