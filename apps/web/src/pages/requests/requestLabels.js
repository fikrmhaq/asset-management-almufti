/**
 * Shared labels for request screens — Phase 37 (`CR-014`).
 *
 * Categories reuse the workflow screens' constant and i18n keys (decision D5 of
 * Phase 36); positions reuse `positions.codes`, which name the department for
 * a department-bound context ("Kajur — TKJ").
 */

export { REQUEST_CATEGORIES } from '../organization/workflows/constants';

export const STATUS_VARIANT = Object.freeze({
  DRAFT: 'neutral',
  SUBMITTED: 'default',
  // REQ-REQUEST-018: back with the requester, waiting for their revision.
  REVISION_REQUESTED: 'warning',
  APPROVED: 'success',
  PARTIALLY_FULFILLED: 'warning',
  FULFILLED: 'success',
  CLOSED: 'neutral',
  REJECTED: 'destructive',
  CANCELLED: 'neutral',
});

/** "Teacher — common subjects", "Kajur — Teknik Komputer". */
export function contextLabel(t, positionCode, department) {
  return t(`positions.codes.${positionCode}`, {
    department: department?.name ?? department?.code ?? '',
  });
}

export const categoryLabel = (t, category) => t(`workflows.categories.${category}`);
