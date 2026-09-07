import { departmentsApi } from '@/api/organization';
import { usePicScope } from '@/auth/useSession';
import { queryKeys } from '@/lib/queryKeys';

import { useOptions } from '../procurement/referenceOptions';

/**
 * Option lists for the asset screens — Phase 20 (`CR-003`).
 *
 * `useOptions` is shared with the contract screens rather than reimplemented:
 * it already reports whether the caller may read the resource at all, so the
 * screen hides the control instead of firing a request that answers 403
 * (`07-ui.md` §6).
 */

/**
 * Departments a unit of this asset may be assigned to — REQ-ORG-004, `BR-007`.
 *
 * FILTERED BY THE ASSET'S INSTITUTION, not merely by the caller's scope. A
 * department must belong to the same institution as the unit's asset, and the
 * server refuses anything else — so offering a picker that can produce a
 * rejected value would be a validation error the user had no way to anticipate.
 * A system-wide caller sees every institution's departments and needs the
 * narrowing most.
 *
 * Nothing is fetched until the asset's institution is known: an asset with no
 * institution cannot take a department at all, and an unfiltered request would
 * return the wrong list rather than none.
 */
export const useDepartmentOptions = (institutionId) => {
  const params = { institutionId, status: 'active', pageSize: 100 };
  const { isPicScoped, picDepartments } = usePicScope();

  const options = useOptions({
    permission: 'department:read',
    keys: queryKeys.departments,
    queryKey: queryKeys.departments.list(params),
    // A PIC-scoped caller reads their departments off the session instead, so
    // there is nothing to fetch and no `department:read` to hold.
    enabled: Boolean(institutionId) && !isPicScoped,
    fetch: () => departmentsApi.list(params),
    toOption: (row) => ({ value: row.id, label: formatDepartment(row) }),
  });

  /**
   * PIC-scoped callers get exactly the departments they hold — Phase 22
   * (`CR-003` §5.7).
   *
   * Not a cosmetic narrowing: the server refuses a unit created in any other
   * department, so offering one would be a rejection the user could not have
   * anticipated. `allowed` is true because they can always choose from this
   * list, whatever permissions they hold.
   */
  if (isPicScoped) {
    return {
      allowed: true,
      rows: picDepartments,
      options: picDepartments.map((row) => ({ value: row.id, label: formatDepartment(row) })),
      isLoading: false,
      labels: new Map(picDepartments.map((row) => [row.id, formatDepartment(row)])),
    };
  }

  return options;
};

/**
 * `Teknik Komputer dan Jaringan (TKJ)` — the name a person recognises, with the
 * code they write on forms.
 *
 * One helper so the unit detail page, the picker and the reports table cannot
 * drift apart; before Phase 20 the unit screen rendered a raw id while the
 * reports page resolved a name, which is exactly that drift.
 */
export function formatDepartment(department) {
  if (!department) return null;
  return department.code ? `${department.name} (${department.code})` : department.name;
}
