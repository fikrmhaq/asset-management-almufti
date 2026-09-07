import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Permission checklist — `07-ui.md` §5.1.
 *
 * Over a hundred codes, so a flat list is unreadable. They are grouped by the
 * `group` the API already returns with each permission (`06-api.md` §1.3,
 * §3.5) — Organization, Reference, Asset Core, Procurement, Operations, Reports,
 * Audit — which is exactly the grouping §5.1 asks for and means this component
 * keeps no mapping of its own to drift.
 *
 * Institution, Role, Permission and RolePermission management are only
 * meaningful system-wide, and `PUT /roles/:id/permissions` rejects the
 * combination with `CONFLICT`. Those codes are marked and disabled while the
 * role is not system-wide, so the rejection is visible before it is submitted —
 * the server still enforces it.
 *
 * A PIC-scoped role has a SECOND, different restriction — `CR-004` §2. Codes
 * outside `PIC_ALLOWED_PERMISSIONS` are suppressed when the principal is
 * resolved, so granting one to a PIC-scoped role changes nothing. Those are
 * MARKED BUT NOT DISABLED, and the distinction matters:
 *
 *   systemWideOnly   the server REFUSES the grant — disable, or the save fails
 *   picAllowed:false the server ACCEPTS the grant and ignores it — leave it
 *                    tickable, because clearing `isPicScoped` later makes it
 *                    effective, and refusing to store it would lose the
 *                    administrator's intent
 *
 * Without this marking the ceiling would be invisible: an administrator would
 * tick `report:read`, see it saved, and never learn it does nothing.
 *
 * THE CODES THEMSELVES ARE NOT TRANSLATED. `asset-unit:create` is an identifier
 * the API defines and an administrator matches against the documentation;
 * translating it would make it unfindable. The group headings come from the
 * server for the same reason. Everything this component adds around them does
 * translate.
 */

/** Stable group order, matching `07-ui.md` §5.1's own listing. */
const GROUP_ORDER = [
  'Organization',
  'Reference',
  'Asset Core',
  'Procurement',
  'Operations',
  'Reports',
  'Audit',
];

function groupPermissions(permissions) {
  const groups = new Map();

  for (const permission of permissions) {
    const name = permission.group ?? 'Other';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(permission);
  }

  return [...groups.entries()].sort(
    ([a], [b]) =>
      (GROUP_ORDER.indexOf(a) + 1 || Number.MAX_SAFE_INTEGER) -
      (GROUP_ORDER.indexOf(b) + 1 || Number.MAX_SAFE_INTEGER)
  );
}

export function PermissionChecklist({
  permissions = [],
  selected = [],
  onChange,
  isSystemWide = false,
  isPicScoped = false,
  disabled = false,
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupPermissions(permissions), [permissions]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  /** A code that needs a system-wide role and is not going to get one here. */
  const isBlocked = (permission) => permission.systemWideOnly && !isSystemWide;

  /** Granted, stored, and ignored at principal resolution — `CR-004` §2. */
  const isSuppressed = (permission) => isPicScoped && permission.picAllowed === false;

  const toggle = (code, next) => {
    const updated = new Set(selectedSet);
    if (next) updated.add(code);
    else updated.delete(code);
    onChange?.([...updated].sort());
  };

  const toggleGroup = (groupPermissions_, next) => {
    const updated = new Set(selectedSet);
    for (const permission of groupPermissions_) {
      if (isBlocked(permission)) continue;
      if (next) updated.add(permission.code);
      else updated.delete(permission.code);
    }
    onChange?.([...updated].sort());
  };

  if (permissions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('organization.permissions.none')}</p>;
  }

  return (
    <div className="space-y-6">
      {groups.map(([groupName, groupPermissions_]) => {
        const selectable = groupPermissions_.filter((permission) => !isBlocked(permission));
        const allSelected =
          selectable.length > 0 &&
          selectable.every((permission) => selectedSet.has(permission.code));

        return (
          <fieldset key={groupName} className="space-y-2">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-1">
              <legend className="text-sm font-semibold">{groupName}</legend>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  disabled={disabled || selectable.length === 0}
                  onChange={(event) => toggleGroup(groupPermissions_, event.target.checked)}
                  aria-label={t('organization.permissions.selectAllIn', { group: groupName })}
                />
                {t('organization.permissions.selectAll')}
              </label>
            </div>

            <ul className="grid gap-1 sm:grid-cols-2">
              {groupPermissions_.map((permission) => {
                const blocked = isBlocked(permission);
                const suppressed = !blocked && isSuppressed(permission);

                return (
                  <li key={permission.code}>
                    <label
                      className={cn(
                        'flex items-start gap-2 rounded-md p-1.5 text-sm',
                        blocked || suppressed ? 'opacity-60' : 'hover:bg-accent'
                      )}
                    >
                      <Checkbox
                        checked={selectedSet.has(permission.code)}
                        disabled={disabled || blocked}
                        onChange={(event) => toggle(permission.code, event.target.checked)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block font-mono text-xs">{permission.code}</span>
                        <span className="block text-xs text-muted-foreground">
                          {permission.description}
                        </span>
                        {blocked ? (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-warning-foreground">
                            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                            {t('organization.permissions.requiresSystemWide')}
                          </span>
                        ) : null}
                        {suppressed ? (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-warning-foreground">
                            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                            {t('organization.permissions.notEffectiveForPic')}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

export { GROUP_ORDER, groupPermissions };
