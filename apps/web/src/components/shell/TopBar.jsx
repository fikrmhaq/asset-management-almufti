import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Menu, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePermission, useLogout, useSession } from '@/auth/useSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { Breadcrumbs } from './Breadcrumbs';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';

/**
 * Top bar — `07-ui.md` §3, `IMPLEMENTATION_PLAN.md` §16.3.
 *
 * Breadcrumb trail, global search and the user menu.
 *
 * Global search jumps to `/assets?q=` (REQ-SEARCH-001) — it is a shortcut into
 * the asset list's own `q` filter, not a separate search surface, which is why
 * it is hidden from a user without `asset:read`.
 *
 * The user block stays VISIBLE rather than collapsing into a dropdown. Who you
 * are signed in as, and under which role, decides what the rest of the screen
 * will let you do; burying it behind a click to save 200px is the wrong trade in
 * an application where a user may hold one institution's scope and not another's.
 */

/** Initials for the avatar — falls back to the username when no name is set. */
function initialsOf(user) {
  const fromName = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .map((part) => part[0])
    .join('');

  return (fromName || user?.username?.slice(0, 2) || '?').toUpperCase();
}

export function TopBar({ onToggleSidebar }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useSession();
  const logout = useLogout();
  const canSearchAssets = usePermission('asset:read');
  const [query, setQuery] = useState('');
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const searchRef = useRef(null);

  /**
   * Ctrl/⌘-K focuses search.
   *
   * Bound only when the session can actually reach the asset list, so the
   * shortcut never steals a keystroke to focus a field that is not rendered.
   */
  useEffect(() => {
    if (!canSearchAssets) return undefined;

    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [canSearchAssets]);

  const runSearch = (event) => {
    event.preventDefault();
    const term = query.trim();
    if (term) navigate(`/assets?q=${encodeURIComponent(term)}`);
  };

  return (
    <header className="sticky top-0 z-30 flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-background px-3 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        aria-label={t('nav.toggle')}
        className="shrink-0"
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </Button>

      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>

      {canSearchAssets ? (
        <form onSubmit={runSearch} className="hidden items-center md:flex" role="search">
          <label htmlFor="global-search" className="sr-only">
            {t('shell.searchAssets')}
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="global-search"
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('shell.searchAssetsPlaceholder')}
              className="w-56 bg-neutral-50 pr-11 pl-8 lg:w-72"
            />
            {/* The shortcut hint, not a control — clicking it would duplicate
                the focus the surrounding field already offers. */}
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[0.625rem] font-medium text-muted-foreground lg:block"
            >
              Ctrl K
            </kbd>
          </div>
          {/* Submitting is what actually navigates; the button is the visible
              affordance for anyone not pressing Enter. */}
          <Button
            type="submit"
            variant="outline"
            size="icon"
            aria-label={t('common.actions.search')}
            className="ml-2"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      ) : null}

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <ThemeToggle className="hidden sm:flex" />

        <LanguageSwitcher className="hidden sm:inline-flex" />

        <div className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              'bg-brand-50 text-xs font-semibold text-brand-700'
            )}
          >
            {initialsOf(user)}
          </span>

          <div className="hidden min-w-0 text-left sm:block">
            <p className="truncate text-sm leading-tight font-medium">{user?.username}</p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              {user?.roles?.map((role) => role.name).join(', ') || t('shell.noRoles')}
            </p>
          </div>
        </div>

        {/* One control, two presentations. `aria-label` carries the name in
            both, so the label collapsing below `sm` cannot leave an unnamed
            icon button behind. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmingLogout(true)}
          aria-label={t('shell.signOut')}
          className="gap-2 px-2 sm:px-3"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('shell.signOut')}</span>
        </Button>
      </div>

      {/* Signing out is not undoable in the sense that matters — unsaved work is
          lost — so it is confirmed (`07-ui.md` §4.4). */}
      <ConfirmDialog
        open={confirmingLogout}
        onOpenChange={setConfirmingLogout}
        title={t('shell.signOutTitle')}
        description={t('shell.signOutDescription')}
        confirmLabel={t('shell.signOut')}
        loading={logout.isPending}
        onConfirm={() => logout.mutate()}
      />
    </header>
  );
}
