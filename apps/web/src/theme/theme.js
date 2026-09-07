import { createContext, useContext } from 'react';

/**
 * The theme context and its hook.
 *
 * Separated from the provider so the module survives Fast Refresh: a file that
 * exports both a component and a hook re-instantiates the context on every edit,
 * and every consumer throws until a full reload.
 */

export const ThemeContext = createContext(null);

/** Light, dark, or follow the system — three real states, not a boolean. */
export const THEME_CHOICES = ['light', 'dark', 'system'];

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
