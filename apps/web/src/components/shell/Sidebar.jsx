import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { visibleNavigation } from '@/navigation';
import { useSessionStore } from '@/stores/session';
import { BrandMark } from './BrandMark';

/**
 * Sidebar — `07-ui.md` §3, `IMPLEMENTATION_PLAN.md` §16.3.
 *
 * Collapsible, grouped by module, with active-route highlighting.
 *
 * Entries the session holds no `*:read` for are absent, not greyed out
 * (`07-ui.md` §6), and a group with nothing visible in it disappears entirely —
 * an empty "Procurement" heading would still tell the user that a module exists
 * and that they are shut out of it.
 *
 * COLLAPSED STATE. The rail keeps every item and swaps the label for its icon;
 * the label stays in the DOM as the accessible name, so what a screen reader
 * announces does not change with the rail's width. The brand lockup is dropped
 * rather than cropped — see `BrandMark`.
 *
 * The active marker is a brand-blue bar on the leading edge plus a tint. The bar
 * is what survives the collapsed rail, where a tint alone on a 4.5rem column
 * reads as a hover state rather than a location.
 */
export function Sidebar({ collapsed = false, onNavigate }) {
  const { t } = useTranslation();
  const permissions = useSessionStore((state) => state.permissions);
  const groups = visibleNavigation(permissions);

  return (
    <div
      className={cn(
        'flex h-full flex-col border-r border-border bg-card transition-[width] duration-200',
        collapsed ? 'w-sidebar-collapsed' : 'w-sidebar'
      )}
    >
      {/* The brand band is the same height as the top bar, so the logo and the
          breadcrumb sit on one line across the whole application. */}
      <div
        className={cn(
          'flex h-topbar shrink-0 items-center border-b border-border',
          collapsed ? 'justify-center px-2' : 'px-4'
        )}
      >
        {collapsed ? null : (
          <div className="flex min-w-0 flex-col gap-0.5">
            <BrandMark height="h-6" />
            <span className="truncate text-[0.6875rem] leading-none font-medium tracking-wide text-muted-foreground uppercase">
              {t('shell.appName')}
            </span>
          </div>
        )}
      </div>

      <nav
        aria-label={t('nav.mainNavigation')}
        className="scrollbar-subtle flex-1 overflow-y-auto px-2 py-3"
      >
        {groups.map((group, index) => (
          <div key={group.labelKey} className={cn(index > 0 && (collapsed ? 'mt-3' : 'mt-5'))}>
            {collapsed ? (
              // A rule instead of a heading: the group name has nowhere to go
              // on a 4.5rem rail, but the grouping itself is still information.
              index > 0 ? (
                <hr className="mx-2 mb-3 border-t border-border" />
              ) : null
            ) : (
              <p className="px-3 pb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {t(group.labelKey)}
              </p>
            )}

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;

                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      title={collapsed ? t(item.labelKey) : undefined}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center rounded-md text-sm font-medium transition-colors',
                          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                          collapsed ? 'h-9 justify-center px-2' : 'h-9 gap-3 px-3',
                          isActive
                            ? 'bg-brand-50 text-brand-700'
                            : 'text-neutral-700 hover:bg-neutral-100 hover:text-foreground'
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {/* The leading marker. Absolutely positioned so it
                              does not shift the icon or the label. */}
                          <span
                            aria-hidden="true"
                            className={cn(
                              'absolute inset-y-1.5 left-0 w-[3px] rounded-r-full transition-colors',
                              isActive ? 'bg-brand-500' : 'bg-transparent'
                            )}
                          />
                          {Icon ? (
                            <Icon
                              className={cn(
                                'h-4.5 w-4.5 shrink-0 transition-colors',
                                isActive
                                  ? 'text-brand-600'
                                  : 'text-neutral-400 group-hover:text-neutral-600'
                              )}
                              aria-hidden="true"
                            />
                          ) : null}
                          {/* Never removed, only hidden: this is the link's
                              accessible name in both states. */}
                          <span className={cn('truncate', collapsed && 'sr-only')}>
                            {t(item.labelKey)}
                          </span>
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {groups.length === 0 ? (
          <p
            className={cn(
              'px-3 py-2 text-sm text-muted-foreground',
              collapsed && 'text-center text-xs'
            )}
          >
            {collapsed ? '—' : t('nav.noModules')}
          </p>
        ) : null}
      </nav>
    </div>
  );
}
