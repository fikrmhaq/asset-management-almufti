import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Application shell — `07-ui.md` §3, `IMPLEMENTATION_PLAN.md` §16.3.
 *
 * Sidebar, top bar, content area.
 *
 * ONE SIDEBAR, TWO BEHAVIOURS. At `md` and above it is a static rail that
 * collapses to icons. Below `md` the same element becomes an overlay drawer over
 * a backdrop. Rendering it twice — a rail and a drawer — would put every
 * navigation link in the document twice, which duplicates every accessible name
 * and lets a keyboard user tab through a menu they cannot see.
 *
 * That is the "usable on tablets, desktop-first" scope of `07-ui.md` §1.3, not a
 * dedicated mobile layout, which §9 lists as an open question rather than a
 * requirement. Nothing here is a mobile-only workflow; it is the same navigation
 * at a width that cannot seat a permanent rail.
 *
 * The main region is the only scroll container, per §3's "no nested scroll
 * regions beyond what's needed for wide tables" — the table wrapper owns the
 * horizontal one.
 */

/** The `md` breakpoint, in the one place that has to agree with Tailwind's. */
const RAIL_MIN_WIDTH = 768;

export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  /**
   * One button, whichever layout is on screen.
   *
   * Below `md` there is no rail to collapse, so the same control opens the
   * drawer instead. A second button that only appears at one width would be a
   * second thing to explain.
   */
  const toggle = useCallback(() => {
    if (globalThis.innerWidth < RAIL_MIN_WIDTH) setDrawerOpen((open) => !open);
    else setCollapsed((value) => !value);
  }, []);

  // A drawer that survives navigation would cover the page the user just asked
  // for. `Sidebar`'s `onNavigate` covers link clicks; this covers everything
  // else that changes the route, including the back button.
  useEffect(() => closeDrawer(), [location.pathname, closeDrawer]);

  // Escape closes the drawer, matching every other overlay in the application.
  useEffect(() => {
    if (!drawerOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeDrawer();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, closeDrawer]);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Backdrop — drawer only, and never on a rail-width screen. */}
      <button
        type="button"
        tabIndex={drawerOpen ? 0 : -1}
        aria-label={t('nav.closeMenu')}
        onClick={closeDrawer}
        className={cn(
          'fixed inset-0 z-40 bg-neutral-900/40 transition-opacity duration-200 md:hidden',
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />

      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 shrink-0 transition-transform duration-200',
          'md:static md:z-auto md:translate-x-0',
          drawerOpen ? 'translate-x-0 shadow-lg' : '-translate-x-full'
        )}
      >
        {/* The drawer always shows labels: the reason to collapse is horizontal
            room on a rail, and a drawer has taken the room already. */}
        <Sidebar collapsed={collapsed && !drawerOpen} onNavigate={closeDrawer} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onToggleSidebar={toggle} />

        <main className="scrollbar-subtle flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[100rem] p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
