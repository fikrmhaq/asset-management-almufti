import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { enUS, id as idLocale } from 'date-fns/locale';

import { en } from './en';
import { id } from './id';

/**
 * Localization — English and Bahasa Indonesia.
 *
 * `07-ui.md` §1.3 assumed English only and §11 flagged Bahasa Indonesia as the
 * open question; this is that question answered. ENGLISH REMAINS THE DEFAULT —
 * an existing user must not find their application in a different language after
 * an upgrade.
 *
 * Everything user-facing resolves through `t()`. No component branches on the
 * current language: a page that says `language === 'id' ? … : …` has to be
 * revisited for every new string and every new language, and the two branches
 * drift the moment one of them is edited.
 *
 * MISSING KEYS FALL BACK TO ENGLISH, then to the key itself. A user must never
 * be shown `undefined`, `null`, or a blank where a label belongs, so both rungs
 * of that ladder matter — `id` may lag `en` by a string and the screen still
 * reads correctly.
 */

export const LANGUAGES = Object.freeze([
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'id', label: 'Bahasa Indonesia', short: 'ID' },
]);

export const DEFAULT_LANGUAGE = 'en';

const STORAGE_KEY = 'asset-management.language';

/** The date-fns locale behind month names and formatted dates. */
const DATE_LOCALES = { en: enUS, id: idLocale };

/**
 * The stored choice, if it is one we still support.
 *
 * `localStorage` and not a cookie or the session: the language is a device
 * preference, it is not sensitive, and it must survive the reload that a
 * memory-only session deliberately does not (`stores/session.js`).
 */
export function readStoredLanguage() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return LANGUAGES.some((language) => language.code === stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    // Private mode, or storage disabled. A preference is not worth an exception.
    return DEFAULT_LANGUAGE;
  }
}

function storeLanguage(code) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, code);
  } catch {
    /* Same reasoning: the choice still applies for this session. */
  }
}

export function initI18n({ language = readStoredLanguage() } = {}) {
  if (!i18next.isInitialized) {
    i18next.use(initReactI18next).init({
      resources: { en: { translation: en }, id: { translation: id } },
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      // `parseMissingKeyHandler` below is the last line of defence; returning the
      // key beats rendering nothing.
      returnNull: false,
      returnEmptyString: false,
      interpolation: { escapeValue: false },
      parseMissingKeyHandler: (key) => key.split('.').at(-1),
    });
  }

  return i18next;
}

export function changeLanguage(code) {
  storeLanguage(code);
  return i18next.changeLanguage(code);
}

export const currentLanguage = () => i18next.resolvedLanguage ?? DEFAULT_LANGUAGE;

/** The date-fns locale for the active language, for `format()` and the calendar. */
export const dateLocale = () => DATE_LOCALES[currentLanguage()] ?? enUS;

/**
 * Translate from outside React.
 *
 * `createResourceHooks` builds toast copy at module scope, where no hook can be
 * called — the same reason `getAccessToken` exists beside the session store.
 */
export const t = (key, options) => i18next.t(key, options);

export default i18next;
