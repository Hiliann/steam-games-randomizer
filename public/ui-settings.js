export const DEFAULT_CUSTOM_ACCENT = Object.freeze({ base: '#72e6c1', hover: '#a1f2d8', contrast: '#102a23' });
export const UI_DEFAULTS = Object.freeze({ language: 'ru', theme: 'forest', accent: 'lime', customAccent: DEFAULT_CUSTOM_ACCENT });
export const UI_OPTIONS = Object.freeze({
  language: Object.freeze(['ru', 'en']),
  theme: Object.freeze(['forest', 'midnight', 'graphite']),
  accent: Object.freeze(['lime', 'blue', 'violet', 'orange', 'custom']),
});

export function languageFromLocale(locale, fallback = UI_DEFAULTS.language) {
  const primary = String(locale ?? '').split(',')[0].trim().toLowerCase();
  if (/^ru(?:-|$)/.test(primary)) return 'ru';
  if (/^[a-z]{2,3}(?:-|$)/.test(primary)) return 'en';
  return fallback;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function validCustomAccent(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'base,contrast,hover'
    && Object.values(value).every(color => typeof color === 'string' && HEX_COLOR.test(color));
}

function cloneCustomAccent(value) {
  return Object.fromEntries(Object.entries(value).map(([key, color]) => [key, color.toLowerCase()]));
}

export function validUiSettings(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'accent,customAccent,language,theme'
    && UI_OPTIONS.language.includes(value.language)
    && UI_OPTIONS.theme.includes(value.theme)
    && UI_OPTIONS.accent.includes(value.accent)
    && validCustomAccent(value.customAccent);
}

export function normalizeUiSettings(value) {
  if (validUiSettings(value)) return { ...value, customAccent: cloneCustomAccent(value.customAccent) };
  if (value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'accent,language,theme'
    && UI_OPTIONS.language.includes(value.language)
    && UI_OPTIONS.theme.includes(value.theme)
    && UI_OPTIONS.accent.includes(value.accent) && value.accent !== 'custom') {
    return { ...value, customAccent: { ...DEFAULT_CUSTOM_ACCENT } };
  }
  return null;
}

function hslToHex(hue, saturation, lightness) {
  const saturationRatio = saturation / 100;
  const lightnessRatio = lightness / 100;
  const chroma = (1 - Math.abs(2 * lightnessRatio - 1)) * saturationRatio;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs(section % 2 - 1));
  const [red, green, blue] = section < 1 ? [chroma, secondary, 0]
    : section < 2 ? [secondary, chroma, 0]
      : section < 3 ? [0, chroma, secondary]
        : section < 4 ? [0, secondary, chroma]
          : section < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  const match = lightnessRatio - chroma / 2;
  return '#' + [red, green, blue].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('');
}

export function createRandomAccent(random = Math.random) {
  const sample = () => Math.max(0, Math.min(0.999999, Number(random()) || 0));
  const hue = Math.floor(sample() * 360);
  const saturation = 68 + Math.floor(sample() * 21);
  const lightness = 62 + Math.floor(sample() * 11);
  const contrastLightness = 11 + Math.floor(sample() * 8);
  return {
    base: hslToHex(hue, saturation, lightness),
    hover: hslToHex(hue, Math.max(55, saturation - 8), Math.min(88, lightness + 11)),
    contrast: hslToHex(hue, Math.min(55, saturation), contrastLightness),
  };
}

export function applyUiSettings(value) {
  const settings = normalizeUiSettings(value);
  if (!settings || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = settings.language;
  root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
  for (const property of ['--accent', '--accent-hover', '--accent-dark']) root.style.removeProperty(property);
  if (settings.accent === 'custom') {
    root.style.setProperty('--accent', settings.customAccent.base);
    root.style.setProperty('--accent-hover', settings.customAccent.hover);
    root.style.setProperty('--accent-dark', settings.customAccent.contrast);
  }
  const color = settings.theme === 'forest' ? '#101210' : settings.theme === 'midnight' ? '#0d121b' : '#121212';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

export function createUiSettingsClient(send = globalThis.fetch) {
  async function request(body) {
    const response = await send('/api/ui-settings', body === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(10000) } : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Randomizer': '1' },
      body: JSON.stringify(body), keepalive: true, signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Не удалось сохранить язык и оформление.');
    const settings = normalizeUiSettings(result);
    if (!settings) throw new Error('Приложение вернуло некорректные настройки интерфейса. Обнови страницу.');
    return settings;
  }
  return {
    load: () => request(),
    set: (key, value) => request({ key, value }),
    saveCustomAccent: customAccent => request({ customAccent }),
  };
}
