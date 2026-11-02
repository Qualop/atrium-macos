// 화면 언어(P16): 영어(기본)와 한국어. 라이브러리 없이 작게 만든다.
// - t(key, vars): 사전(locales/en.js, ko.js)에서 열쇠를 찾아 {이름} 자리에 값을 넣는다.
//   열쇠는 'chips.arrange'처럼 화면 자리 이름이다. 영어에 없는 열쇠는 콘솔에 한 번 경고하고 열쇠를 그대로 보인다. 한국어에 없으면 영어로 보인다.
// - 단수·복수: 값이 { one, other } 같은 객체면 vars.n(없으면 vars.count)으로 Intl.PluralRules가 고른다. 한국어는 문자열 하나면 된다.
// - setLanguage(lang): 바꾸면 구독한 화면이 다시 그린다(창을 다시 읽지 않는다). 첫 화면은 영어이고, 백엔드 설정 language를 받으면 그것을 따른다.
// - useT(): React 훅. 그 컴포넌트가 언어 바뀜을 구독하고 t를 돌려준다.
// Electron main(tray.mjs)도 이 파일과 사전을 그대로 불러 쓴다.
import { useSyncExternalStore } from 'react';
import en from '../locales/en.js';
import ko from '../locales/ko.js';
import { shortcutText } from './shortcuts.js';

export const LANGUAGES = ['en', 'ko'];
export const DEFAULT_LANGUAGE = 'en';
const DICTS = { en, ko };

let lang = DEFAULT_LANGUAGE;
const subs = new Set();
const warned = new Set();

export const getLanguage = () => lang;
export function setLanguage(next) {
  const l = LANGUAGES.includes(next) ? next : DEFAULT_LANGUAGE;
  if (l === lang) return;
  lang = l;
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = l;
  for (const fn of [...subs]) { try { fn(l); } catch (e) { console.error(e); } }
}
export function onLanguage(fn) { subs.add(fn); return () => subs.delete(fn); }

function lookup(dict, key) {
  let v = dict;
  for (const part of key.split('.')) { if (v == null || typeof v !== 'object') return undefined; v = v[part]; }
  return v;
}
const plurals = new Map();
function pluralOf(l, n) {
  if (!plurals.has(l)) plurals.set(l, new Intl.PluralRules(l));
  return plurals.get(l).select(n);
}
function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}
function pick(v, l, vars) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && ('other' in v || 'one' in v)) {
    const n = Number(vars && (vars.n ?? vars.count));
    const cat = Number.isFinite(n) ? pluralOf(l, n) : 'other';
    return v[cat] ?? v.other ?? v.one;
  }
  return undefined;
}

// 언어를 정해 찾는다(시험과 main이 쓴다)
export function translate(l, key, vars) {
  let v = pick(lookup(DICTS[l] || en, key), l, vars);
  if (v === undefined && l !== 'en') v = pick(lookup(en, key), 'en', vars);
  if (v === undefined) {
    if (!warned.has(key)) { warned.add(key); console.warn(`[i18n] missing key: ${key}`); }
    return key;
  }
  return fill(shortcutText(v), vars);
}
export const t = (key, vars) => translate(lang, key, vars);
// 열쇠가 있을 때만(백엔드가 준 코드처럼 없을 수도 있는 것)
export function has(key) { return pick(lookup(en, key), 'en', { n: 2 }) !== undefined; }
export function tOr(key, fallback, vars) { return has(key) ? t(key, vars) : fallback; }

// 백엔드가 준 글: { key, vars }가 있으면 번역하고, 없으면 백엔드 글(한국어)을 그대로 보인다
// 값 안의 { key, vars }는 먼저 번역하고, 배열은 쉼표로 잇는다(backend/src/msg.mjs)
function msgText(m) {
  if (m == null) return '';
  if (Array.isArray(m)) return m.map(msgText).join(', ');
  if (typeof m !== 'object') return String(m);
  if (!m.key) return '';
  const vars = {};
  for (const [k, v] of Object.entries(m.vars || {})) vars[k] = v && typeof v === 'object' ? msgText(v) : v;
  return t(`backend.${m.key}`, vars);
}
export const hasMsg = (m) => !!(m && m.key && has(`backend.${m.key}`));
export function tMsg(r, fallback) {
  if (r && hasMsg(r.msg)) return msgText(r.msg);
  return (r && r.message) || fallback || '';
}
// 오류: 백엔드가 준 열쇠(e.key), 잘 아는 코드(errors.<code>), 그 밖에는 백엔드 글
export function errText(e) {
  if (!e) return '';
  if (e.key && has(`backend.${e.key}`)) return msgText({ key: e.key, vars: e.vars });
  if (e.code && has(`errors.${e.code}`)) return t(`errors.${e.code}`, { message: e.message });
  return e.message || String(e);
}

// 날짜와 시각: OS 지역 설정이 아니라 화면 언어를 따른다(한국어 OS에서도 영어 화면이면 AM/PM)
const LOCALE = { en: 'en-US', ko: 'ko-KR' };
export const fmtDateTime = (at, opts) => (at ? new Date(at).toLocaleString(LOCALE[lang], opts) : '');
export const fmtTime = (at, opts) => (at ? new Date(at).toLocaleTimeString(LOCALE[lang], opts) : '');

// React 훅: 언어가 바뀌면 이 컴포넌트를 다시 그린다
export function useLang() { return useSyncExternalStore(onLanguage, getLanguage, getLanguage); }
export function useT() { useLang(); return t; }
