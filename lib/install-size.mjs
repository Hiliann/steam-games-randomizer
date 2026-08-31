const list = value => String(value ?? '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
const enabled = value => value !== undefined && value !== null && value !== '' && value !== false && value !== 0 && value !== '0';
const bytesValue = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
};

// An estimate of uncompressed public-branch base-game content, NOT download
// traffic or required free space. DLC, optional content and shared prerequisites
// are deliberately excluded. Unknown required sizes never become partial totals.
export function estimateInstallSize(app, { apps = new Map(), ownedDepots, platform = 'windows', architecture = '64', language = 'english' } = {}) {
  const unknown = reason => ({ bytes: null, estimated: true, platform, language, reason });
  const source = app?.depots;
  if (!source || typeof source !== 'object') return unknown('missing-metadata');
  const resolved = [];
  function resolve(id, depot, visited = new Set()) {
    const parent = String(depot?.depotfromapp ?? '');
    if (!parent || depot.manifests?.public) return depot;
    if (visited.has(parent)) return null;
    visited.add(parent);
    const inherited = apps.get(parent)?.depots?.[id];
    if (!inherited) return null;
    const result = resolve(id, inherited, visited);
    return result ? { ...result, ...depot, config: { ...result.config, ...depot.config }, manifests: result.manifests } : null;
  }
  for (const [id, raw] of Object.entries(source)) {
    if (!/^\d+$/.test(id) || !raw || typeof raw !== 'object') continue;
    if (ownedDepots && !ownedDepots.has(id)) continue;
    if (enabled(raw.sharedinstall) || enabled(raw.optional) || enabled(raw.dlcappid)) continue;
    if (raw.config?.oslist && !list(raw.config.oslist).includes(platform)) continue;
    // Empty placeholders are not active public content.
    if (!raw.manifests && !raw.depotfromapp) continue;
    const depot = resolve(id, raw);
    if (!depot) return unknown('missing-shared-depot');
    const config = depot.config ?? {};
    if (enabled(depot.sharedinstall) || enabled(depot.optional) || enabled(depot.dlcappid) || enabled(config.optionaldlc) || enabled(config.lowviolence)) continue;
    if (config.oslist && !list(config.oslist).includes(platform)) continue;
    if (enabled(config.steamdeck) && platform !== 'linux') continue;
    if (config.realm && !list(config.realm).includes('global')) continue;
    if (depot.manifests && !Object.hasOwn(depot.manifests, 'public')) continue;
    resolved.push({ depot, config });
  }
  const localized = resolved.filter(({ config }) => config.language);
  const hasLanguage = name => localized.some(({ config }) => list(config.language).includes(name));
  const usedLanguage = hasLanguage(language) ? language : 'english';
  // Many games bundle English inside the language-neutral base depot. Other
  // localized depots alone do not make that base content incomplete.
  const languageContent = resolved.filter(({ config }) => !config.language || list(config.language).includes(usedLanguage));
  // 32-bit-only titles can still run on a 64-bit system; never sum both variants.
  const has64 = languageContent.some(({ config }) => String(config.osarch) === '64');
  const usedArch = architecture === '64' && !has64 ? '32' : architecture;
  let total = 0, count = 0;
  for (const { depot, config } of languageContent) {
    if (config.osarch && String(config.osarch) !== usedArch) continue;
    if (config.language && !list(config.language).includes(usedLanguage)) continue;
    const size = bytesValue(depot.manifests?.public?.size);
    if (size === null || !Number.isSafeInteger(total + size)) return unknown('missing-size');
    total += size; count++;
  }
  if (!count || !total) return unknown('missing-content');
  return { bytes: total, estimated: true, platform, language: usedLanguage, reason: null };
}
