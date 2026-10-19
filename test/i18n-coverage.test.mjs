import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setLanguage, translate } from '../public/i18n.js';

// Russian is the source language: the English interface translates rendered text,
// so every Russian string that can reach the screen needs an English entry.
const project = path.resolve(import.meta.dirname, '..');
const CYRILLIC = /[А-Яа-яЁё]/;
// Language names stay in their own language in the language picker, and the
// diagnostic archive description is written in both languages on purpose.
const untranslated = text => CYRILLIC.test(text.replaceAll('Русский', ''));
const BILINGUAL = ['Play Next diagnostic archive / Диагностический архив Play Next'];
const WORD_BEFORE_REGEX = /\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

// Returns string and template literals with their static text. Literals passed as
// the Russian argument of tr(ru, en) already carry their own English text.
function stringLiterals(source) {
  const found = [];
  let index = 0;
  function skipRegex() {
    let inClass = false;
    for (index++; index < source.length; index++) {
      const char = source[index];
      if (char === '\\') index++;
      else if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) break;
    }
    index++;
    while (/[a-z]/.test(source[index] ?? '')) index++;
  }
  function quoted(quote) {
    let value = '';
    for (index++; source[index] !== quote; index++) {
      if (source[index] === '\\') { index++; value += source[index] === 'n' ? '\n' : source[index]; } else value += source[index];
    }
    index++;
    return value;
  }
  function template(covered) {
    const parts = [''];
    for (index++; source[index] !== '`'; index++) {
      if (source[index] === '\\') { index++; parts[parts.length - 1] += source[index] === 'n' ? '\n' : source[index]; } else if (source[index] === '$' && source[index + 1] === '{') {
        index += 2;
        code(covered, true);
        index--;
        parts.push('');
      } else parts[parts.length - 1] += source[index];
    }
    index++;
    return parts;
  }
  function code(covered, untilBrace) {
    let depth = 0;
    let previous = '';
    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char)) { index++; continue; }
      if (char === '/' && source[index + 1] === '/') { index = source.indexOf('\n', index); if (index < 0) index = source.length; continue; }
      if (char === '/' && source[index + 1] === '*') { index = source.indexOf('*/', index + 2) + 2; continue; }
      const start = index;
      const tr = covered || /\btr\(\s*$/.test(source.slice(Math.max(0, start - 20), start));
      if (char === '\'' || char === '"') { const value = quoted(char); found.push({ parts: [value], covered: tr, line: source.slice(0, start).split('\n').length }); previous = 'x'; continue; }
      if (char === '`') { const parts = template(tr); found.push({ parts, covered: tr, line: source.slice(0, start).split('\n').length }); previous = 'x'; continue; }
      if (char === '/' && (!previous || /[(,=:[!&|?{};+\-*%<>~^]$/.test(previous) || WORD_BEFORE_REGEX.test(previous))) { skipRegex(); previous = 'x'; continue; }
      if (untilBrace && char === '{') depth++;
      if (untilBrace && char === '}' && depth-- === 0) { index++; return; }
      if (/[\w$]/.test(char)) {
        let word = '';
        while (/[\w$]/.test(source[index] ?? '')) word += source[index++];
        previous = word;
        continue;
      }
      previous = char;
      index++;
    }
  }
  code(false, false);
  return found;
}

function missingTranslations(literals) {
  setLanguage('en');
  try {
    return literals.filter(({ parts, covered }) => {
      if (covered || !parts.some(part => CYRILLIC.test(part)) || BILINGUAL.some(text => parts[0].startsWith(text))) return false;
      if (!untranslated(translate(parts.join('1').trim()))) return false;
      return parts.some(part => part.trim() && untranslated(translate(part.trim())));
    });
  } finally { setLanguage('ru'); }
}

async function scripts(directory, filter) {
  const names = (await readdir(path.join(project, directory))).filter(filter).sort();
  return Promise.all(names.map(async name => ({ file: path.join(directory, name), source: await readFile(path.join(project, directory, name), 'utf8') })));
}

function describe(file, missing) {
  return missing.map(({ parts, line }) => `${file}:${line} ${parts.join('${…}').replace(/\s+/g, ' ').slice(0, 160)}`);
}

test('the literal scanner separates tr() text, templates and regular expressions', () => {
  const literals = stringLiterals("const a = /'не строка'/g; tr('Готово', 'Done'); x = `Привет, ${name ? 'друг' : 'гость'}!` // 'комментарий'\nreturn /\"/.test(b) ? 'Ошибка' : c / 2;");
  assert.deepEqual(literals.map(({ parts, covered }) => ({ parts, covered })), [
    { parts: ['Готово'], covered: true }, { parts: ['Done'], covered: false },
    { parts: ['друг'], covered: false }, { parts: ['гость'], covered: false },
    { parts: ['Привет, ', '!'], covered: false }, { parts: ['Ошибка'], covered: false },
  ]);
  assert.deepEqual(stringLiterals("tr(`Удалить ${a ? 'всё' : 'одно'}?`, 'Delete?')").map(item => item.covered), [true, true, true, false]);
});

test('every Russian interface string in the browser code has an English translation', async () => {
  const problems = [];
  for (const { file, source } of await scripts('public', name => name.endsWith('.js') && name !== 'i18n.js')) problems.push(...describe(file, missingTranslations(stringLiterals(source))));
  assert.deepEqual(problems, []);
});

test('every Russian text and label in the page markup has an English translation', async () => {
  const html = (await readFile(path.join(project, 'public', 'index.html'), 'utf8')).replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
  const literals = [];
  for (const match of html.matchAll(/>([^<>]+)</g)) literals.push({ parts: [match[1].replace(/\s+/g, ' ')], line: html.slice(0, match.index).split('\n').length });
  for (const match of html.matchAll(/\s(?:aria-label|title|placeholder)="([^"]+)"/g)) literals.push({ parts: [match[1]], line: html.slice(0, match.index).split('\n').length });
  assert.deepEqual(describe('public/index.html', missingTranslations(literals)), []);
});

test('every Russian message the local server can return has an English translation', async () => {
  const problems = [];
  const files = [{ file: 'server.mjs', source: await readFile(path.join(project, 'server.mjs'), 'utf8') }, ...await scripts('lib', name => name.endsWith('.mjs'))];
  for (const { file, source } of files) problems.push(...describe(file, missingTranslations(stringLiterals(source))));
  assert.deepEqual(problems, []);
});

test('combined messages are translated sentence by sentence', () => {
  setLanguage('en');
  try {
    assert.equal(translate('Не удалось загрузить категории и историю. Проверь, что приложение запущено. Нажми «Обновить список», чтобы перечитать данные.'),
      'Could not load collections and history. Check that the app is running. Press “Refresh list” to read the data again.');
    assert.equal(translate('Не удалось сохранить настройку. Не удалось сохранить настройки программы. Проверь доступ к папке data.'),
      'Could not save the setting. Could not save application settings. Check access to the data folder.');
    assert.equal(translate('Не удалось подтвердить сохранение. Portal 2. Нажми «Повторить загрузку».'), 'Could not confirm the save. Portal 2. Press “Retry loading”.');
    assert.equal(translate('Совершенно новая фраза. Ещё одна.'), 'Совершенно новая фраза. Ещё одна.');
  } finally { setLanguage('ru'); }
});
