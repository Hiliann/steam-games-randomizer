import { UI_DEFAULTS, createUiSettingsClient, applyUiSettings } from './ui-settings.js';
import { setLanguage } from './i18n.js';

export function createAppearanceController({$,client=createUiSettingsClient(),apply=applyUiSettings,localize=setLanguage,onLocalized=()=>{},toast=()=>{}}) {
let uiSettings = { ...UI_DEFAULTS };
let uiSettingsReady = false;
let uiSettingsPending = false;
let uiSettingsMessage = 'Загружаем язык и оформление…';
let customAccentDraft = { ...UI_DEFAULTS.customAccent };
let accentPreviewing = false;
let accentPreviewMessage = 'Сохранённая палитра готова к предпросмотру.';
function renderUiSettings() {
  for (const key of ['language', 'theme', 'accent']) {
    $(key === 'language' ? 'interfaceLanguage' : key).value = uiSettings[key];
    $(key === 'language' ? 'interfaceLanguage' : key).disabled = !uiSettingsReady || uiSettingsPending;
  }
  if (accentPreviewing) $('accent').value = 'custom';
  for (const [key, id] of [['base', 'accent-base'], ['hover', 'accent-hover'], ['contrast', 'accent-contrast']]) {
    $(id).value = customAccentDraft[key];
    $(id).disabled = !uiSettingsReady || uiSettingsPending;
  }
  $('randomize-accent').disabled = !uiSettingsReady || uiSettingsPending;
  $('save-custom-accent').disabled = !uiSettingsReady || uiSettingsPending || !accentPreviewing;
  $('cancel-accent-preview').disabled = !uiSettingsReady || uiSettingsPending || !accentPreviewing;
  $('accent-preview-status').textContent = accentPreviewMessage;
  $('ui-settings-status').textContent = uiSettingsMessage;
  $('retry-ui-settings').hidden = uiSettingsReady || uiSettingsPending;
}
async function loadUiSettings() {
  if (uiSettingsPending) return false;
  uiSettingsPending = true;
  uiSettingsMessage = 'Загружаем язык и оформление…';
  renderUiSettings();
  try {
    uiSettings = await client.load();
    uiSettingsReady = true;
    customAccentDraft = { ...uiSettings.customAccent };
    accentPreviewing = false;
    accentPreviewMessage = uiSettings.accent === 'custom' ? 'Сохранённая палитра включена.' : 'Сохранённая палитра готова к предпросмотру.';
    apply(uiSettings);
    localize(uiSettings.language);
    uiSettingsMessage = 'Язык и оформление сохраняются в папке приложения.';
    onLocalized();
    return true;
  } catch (error) {
    uiSettingsReady = false;
    uiSettingsMessage = error instanceof TypeError ? 'Нет связи с приложением. Повтори загрузку.' : error.message;
    return false;
  } finally {
    uiSettingsPending = false;
    renderUiSettings();
  }
}
async function setUiSetting(key, value) {
  if (!uiSettingsReady || uiSettingsPending) return;
  const previous = { ...uiSettings, customAccent: { ...uiSettings.customAccent } };
  uiSettingsPending = true;
  uiSettingsMessage = 'Сохраняем…';
  renderUiSettings();
  try {
    uiSettings = await client.set(key, value);
    if (key === 'accent') {
      customAccentDraft = { ...uiSettings.customAccent };
      accentPreviewing = false;
      accentPreviewMessage = value === 'custom' ? 'Сохранённая палитра включена.' : 'Сохранённая палитра готова к предпросмотру.';
    }
    apply(accentPreviewing ? { ...uiSettings, accent: 'custom', customAccent: customAccentDraft } : uiSettings);
    localize(uiSettings.language);
    uiSettingsMessage = 'Язык и оформление сохранены.';
    onLocalized();
  } catch (error) {
    uiSettings = previous;
    uiSettingsReady = false;
    accentPreviewing = false;
    customAccentDraft = { ...previous.customAccent };
    apply(uiSettings);
    localize(uiSettings.language);
    uiSettingsMessage = `Не удалось подтвердить сохранение. ${error instanceof TypeError ? 'Проверь, что приложение запущено.' : error.message}`;
  } finally {
    uiSettingsPending = false;
    renderUiSettings();
  }
}
function previewCustomAccent(next, message = 'Это предпросмотр. Сохрани палитру, если она понравилась.') {
  if (!uiSettingsReady || uiSettingsPending) return;
  customAccentDraft = { ...next };
  accentPreviewing = true;
  accentPreviewMessage = message;
  apply({ ...uiSettings, accent: 'custom', customAccent: customAccentDraft });
  renderUiSettings();
}
function cancelAccentPreview() {
  if (!accentPreviewing) return;
  accentPreviewing = false;
  customAccentDraft = { ...uiSettings.customAccent };
  accentPreviewMessage = uiSettings.accent === 'custom' ? 'Сохранённая палитра включена.' : 'Предпросмотр отменён. Возвращена сохранённая тема.';
  apply(uiSettings);
  renderUiSettings();
}
async function saveCustomAccent() {
  if (!uiSettingsReady || uiSettingsPending || !accentPreviewing) return;
  const previous = { ...uiSettings, customAccent: { ...uiSettings.customAccent } };
  uiSettingsPending = true;
  uiSettingsMessage = 'Сохраняем палитру…';
  renderUiSettings();
  try {
    uiSettings = await client.saveCustomAccent(customAccentDraft);
    customAccentDraft = { ...uiSettings.customAccent };
    accentPreviewing = false;
    accentPreviewMessage = 'Своя палитра сохранена и включена.';
    uiSettingsMessage = 'Язык и оформление сохранены.';
    apply(uiSettings);
    toast('Цветовая палитра сохранена');
  } catch (error) {
    uiSettings = previous;
    uiSettingsReady = false;
    accentPreviewing = false;
    customAccentDraft = { ...previous.customAccent };
    apply(previous);
    uiSettingsMessage = `Не удалось подтвердить сохранение. ${error instanceof TypeError ? 'Проверь, что приложение запущено.' : error.message}`;
  } finally {
    uiSettingsPending = false;
    renderUiSettings();
  }
}
  return {render:renderUiSettings,load:loadUiSettings,set:setUiSetting,preview:previewCustomAccent,cancel:cancelAccentPreview,save:saveCustomAccent,
    get value(){return uiSettings;},get pending(){return uiSettingsPending;},get previewing(){return accentPreviewing;},get draft(){return {...customAccentDraft};}};
}
