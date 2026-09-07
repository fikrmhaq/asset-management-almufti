import { useCallback, useEffect, useMemo, useState } from 'react';

import { ThemeContext, THEME_CHOICES } from './theme';

/**
 * Light / dark / system, persisted in `localStorage`.
 *
 * THREE choices, not two. "System" is a real state, not the absence of a
 * choice: a user who picks it wants the application to follow the machine when
 * it changes at dusk, which a resolved boolean cannot express.
 *
 * The class is applied to `<html>` and read by the `dark:` variant declared in
 * `index.css`. `index.html` sets the same class from the same key before first
 * paint, so there is no flash of the wrong theme; this provider takes over from
 * there and keeps them in step. The context and hook live in `theme.js`.
 */

const STORAGE_KEY = 'assets.theme';

function readStoredChoice() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (THEME_CHOICES.includes(stored)) return stored;
  } catch {
    /* Storage unavailable — "system" is the right default anyway. */
  }
  return 'system';
}

function prefersDark() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

function applyResolved(resolved) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  // Tells the browser which scheme to paint scrollbars and form controls in.
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children, initialChoice }) {
  const [choice, setChoiceState] = useState(() => initialChoice ?? readStoredChoice());
  const [systemDark, setSystemDark] = useState(prefersDark);

  // Only meaningful while the choice is "system", but the listener is cheap and
  // unconditional — attaching it conditionally would mean re-subscribing on
  // every toggle for no gain.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setSystemDark(event.matches);

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  useEffect(() => {
    applyResolved(resolved);
  }, [resolved]);

  const setChoice = useCallback((next) => {
    if (!THEME_CHOICES.includes(next)) return;

    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* The theme still applies for this visit; it just will not be remembered. */
    }
  }, []);

  const value = useMemo(
    () => ({ choice, resolved, setChoice, choices: THEME_CHOICES }),
    [choice, resolved, setChoice]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
