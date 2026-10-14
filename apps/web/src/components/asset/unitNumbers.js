/**
 * Unit-number checks that need no server — P4 (`IMPLEMENTATION_PLAN.md` §64.4).
 * Kept apart from `UnitNumberFields.jsx` so that file exports components only.
 */

/** Per-index problems: empty, and repeated in this batch. */
export function localUnitNumberStatus(values) {
  const trimmed = values.map((value) => String(value ?? '').trim());
  const counts = new Map();
  for (const value of trimmed) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return trimmed.map((value) =>
    !value ? 'EMPTY' : counts.get(value) > 1 ? 'DUPLICATE_IN_BATCH' : null
  );
}

/** Whether a batch can be sent: every value present and, per unit, none repeated. */
export const unitNumbersReady = (values, { perUnit = true } = {}) =>
  localUnitNumberStatus(values).every(
    (status) => status === null || (!perUnit && status === 'DUPLICATE_IN_BATCH')
  );
