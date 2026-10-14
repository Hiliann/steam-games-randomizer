import test from 'node:test';
import assert from 'node:assert/strict';
import { participationDetails, createDescriptionDisclosure, descriptionLineCount } from '../public/game-details.js';
import { setLanguage } from '../public/i18n.js';

test('an excluded game always exposes an inverse action in either language', () => {
  setLanguage('ru');
  assert.equal(participationDetails(true).action, 'Вернуть в выбор');
  assert.equal(participationDetails(false).action, 'Исключить из выбора');
  assert.equal(participationDetails(true).icon, 'close');
  setLanguage('en');
  assert.equal(participationDetails(true).label, 'Excluded from picks');
  assert.equal(participationDetails(true).action, 'Include in picks');
  setLanguage('ru');
});

test('full description opens separately without changing the fixed card', () => {
  let scheduled;
  const properties = {};
  const description = { textContent: 'A long description', scrollHeight: 120, clientHeight: 60, getClientRects: () => [{}], style: { setProperty(name, value) { properties[name] = value; } } };
  const button = { hidden: true, attrs: {}, addEventListener(name, callback) { this[name] = callback; }, setAttribute(name, value) { this.attrs[name] = value; } };
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const fullDescription = {}, dialogTitle = {}, title = { textContent: 'Game' };
  const closeButton = { addEventListener(name, callback) { this[name] = callback; }, focus() { this.focused = true; } };
  const disclosure = createDescriptionDisclosure({ description, button, dialog, fullDescription, dialogTitle, title, closeButton, style: () => ({ lineHeight: '20px' }), schedule(callback) { scheduled = callback; } });
  disclosure.refresh('1'); scheduled();
  assert.equal(button.hidden, false);
  assert.equal(properties['--description-lines'], '3');
  button.disabled = true; button.click(); assert.equal(dialog.open, false);
  button.disabled = false;
  button.click();
  assert.equal(dialog.open, true);
  assert.equal(fullDescription.textContent, description.textContent);
  assert.equal(dialogTitle.textContent, 'Game');
  assert.equal(closeButton.focused, true);
  assert.equal(description.clientHeight, 60);
  disclosure.refresh('1'); scheduled();
  assert.equal(dialog.open, true);
  disclosure.refresh('2'); scheduled();
  assert.equal(dialog.open, false);
  description.scrollHeight = description.clientHeight;
  disclosure.refresh(); scheduled();
  assert.equal(button.hidden, true);
  button.click(); closeButton.click();
  assert.equal(dialog.open, false);
  description.textContent = ''; description.scrollHeight = 120;
  disclosure.refresh(); scheduled(); assert.equal(button.hidden, true);
});

test('description fits whole text lines into the remaining card space', () => {
  assert.equal(descriptionLineCount(90, 22.4), 4);
  assert.equal(descriptionLineCount(44, 22.4), 1);
  assert.equal(descriptionLineCount(15, 22.4), 1);
  assert.equal(descriptionLineCount(50, NaN), 2);
});

test('line count uses the available slot, not the already-clamped text height', () => {
  let measure;
  const properties = {};
  const description = { textContent: 'Long text', scrollHeight: 200, clientHeight: 60, style: { setProperty(name, value) { properties[name] = value; } } };
  const space = { clientHeight: 95, getClientRects: () => [{}] };
  const button = { hidden: false, addEventListener() {} };
  const disclosure = createDescriptionDisclosure({ description, space, button, dialog: { open: false }, closeButton: { addEventListener() {} }, style: () => ({ lineHeight: '20px' }), schedule(callback) { measure = callback; } });
  disclosure.refresh('new-game');
  assert.equal(button.hidden, true);
  measure();
  assert.equal(properties['--description-lines'], '4');
  assert.equal(button.hidden, false);
  space.clientHeight = 155;
  disclosure.refresh(); measure();
  assert.equal(properties['--description-lines'], '7');
});

test('compact description uses a responsive cap without shrinking after repeated measurements', () => {
  let measure, limit = 3;
  const properties = {};
  const description = { textContent: 'Long text', scrollHeight: 200, clientHeight: 44, style: { setProperty(name, value) { properties[name] = value; } } };
  const space = { clientHeight: 44, getClientRects: () => [{}] };
  const button = { addEventListener() {} };
  const disclosure = createDescriptionDisclosure({ description, space, button, dialog: { open: false }, closeButton: { addEventListener() {} }, style: () => ({ lineHeight: '22.4px', getPropertyValue: () => String(limit) }), schedule(callback) { measure = callback; } });
  for (let i = 0; i < 3; i++) { disclosure.refresh('1'); measure(); assert.equal(properties['--description-lines'], '3'); }
  assert.equal(button.hidden, false);
  limit = 4; disclosure.refresh(); measure(); assert.equal(properties['--description-lines'], '4');
  description.textContent = 'Short text'; description.scrollHeight = 44;
  disclosure.refresh(); measure(); assert.equal(button.hidden, true);
});
