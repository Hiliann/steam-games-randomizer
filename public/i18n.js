import * as english from './i18n-en.js';
import * as ukrainian from './i18n-uk.js';

// Russian is the source language: the interface is written in Russian and each
// dictionary translates the rendered Russian text. tr(ru, en) carries its own
// English text; other languages look up the Russian text and fall back to English.
const dictionary = ({ exact, patterns }) => ({ exact: new Map(exact), patterns });
export const LANGUAGES = Object.freeze({
  ru: Object.freeze({ name: 'Русский', locale: 'ru-RU', dictionary: null }),
  en: Object.freeze({ name: 'English', locale: 'en-US', dictionary: dictionary(english) }),
  uk: Object.freeze({ name: 'Українська', locale: 'uk-UA', dictionary: dictionary(ukrainian) }),
});

let language = 'ru';
let observer;
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const listeners = new Set();

export function getLanguage() { return language; }
export function getLocale() { return LANGUAGES[language].locale; }
export function tr(ru, en) {
  if (language === 'ru') return ru;
  if (language === 'en') return en;
  return findTranslation(ru) ?? en;
}

// Each lookup returns undefined when the dictionary has no entry, so a
// translation that happens to equal the Russian text still counts.
function findWhole(source, { exact, patterns }) {
  if (exact.has(source)) return exact.get(source);
  for (const [pattern, replacer] of patterns) {
    const match = pattern.exec(source);
    if (match) return replacer(match, translate);
  }
}

// Messages are often joined from a prefix, a server error and a hint, so a
// message without its own entry is translated sentence by sentence.
function findSentences(source, words) {
  const sentences = source.split(/(?<=[.!?…])\s+(?=[«"(]?[А-ЯЁA-Z])/);
  if (sentences.length < 2) return;
  const translated = [];
  let changed = false;
  for (let start = 0; start < sentences.length;) {
    // Prefer the longest run of sentences that has its own entry, such as a multi-sentence server error.
    let end = sentences.length;
    let result;
    for (; end > start; end--) {
      result = findWhole(sentences.slice(start, end).join(' '), words);
      if (result !== undefined) break;
    }
    if (end === start) { translated.push(sentences[start]); start++; continue; }
    translated.push(result);
    changed = true;
    start = end;
  }
  return changed ? translated.join(' ') : undefined;
}

export function findTranslation(source) {
  const words = LANGUAGES[language].dictionary;
  if (!words || typeof source !== 'string' || !source) return;
  return findWhole(source, words) ?? findSentences(source, words);
}

export function translate(source) {
  return findTranslation(source) ?? source;
}

function translateTextNode(node) {
  const current = node.data;
  let record = textSources.get(node);
  if (!record || current !== record.output) record = { source: current, output: current };
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(record.source);
  record.output = match ? match[1] + translate(match[2]) + match[3] : record.source;
  textSources.set(node, record);
  if (current !== record.output) node.data = record.output;
}

function translateAttribute(element, name) {
  if (!element.hasAttribute(name)) return;
  let records = attributeSources.get(element);
  if (!records) { records = new Map(); attributeSources.set(element, records); }
  const current = element.getAttribute(name);
  let record = records.get(name);
  if (!record || current !== record.output) record = { source: current, output: current };
  record.output = translate(record.source);
  records.set(name, record);
  if (current !== record.output) element.setAttribute(name, record.output);
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) { translateTextNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) translateTextNode(node);
  const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : root.querySelectorAll('*');
  for (const element of elements) for (const name of ['aria-label', 'title', 'placeholder']) translateAttribute(element, name);
}

export function setLanguage(next) {
  if (!Object.hasOwn(LANGUAGES, next)) return;
  language = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
    translateTree(document);
    document.dispatchEvent(new CustomEvent('playnext-language-change', { detail: { language: next } }));
  }
  for (const listener of listeners) listener(next);
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startLocalization() {
  if (typeof document === 'undefined' || observer) return;
  translateTree(document);
  observer = new MutationObserver(records => {
    observer.disconnect();
    for (const record of records) {
      if (record.type === 'characterData') translateTextNode(record.target);
      else if (record.type === 'attributes') translateAttribute(record.target, record.attributeName);
      else for (const node of record.addedNodes) translateTree(node);
    }
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
}
