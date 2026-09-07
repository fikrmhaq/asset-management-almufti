import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Dirty-form handling — `IMPLEMENTATION_PLAN.md` §15.6.
 *
 * Two escape routes have to be covered, and they are different mechanisms:
 *
 *   - navigating away inside the app — React Router's `useBlocker`, which lets
 *     the caller show a real confirm dialog;
 *   - closing the tab or reloading — `beforeunload`, where the browser shows its
 *     own dialog and the page cannot customise it.
 *
 * Returns the router blocker so a page can render its own confirmation, rather
 * than this hook deciding what that looks like.
 */
export function useUnsavedChanges(isDirty) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (!isDirty) return undefined;

    const warn = (event) => {
      event.preventDefault();
      // Required by some browsers for the prompt to appear at all; the string
      // itself has been ignored by every major browser for years.
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  return blocker;
}
