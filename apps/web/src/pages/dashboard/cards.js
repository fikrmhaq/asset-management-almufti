/**
 * The dashboard's cards — `07-ui.md` §5.9, `CR-012` `DEC-P`.
 *
 * ── Why a registry ─────────────────────────────────────────────────────────
 *
 * The dashboard is a SET OF CARDS, not a page. Each declares the permission
 * that opens it, and three things read that declaration and must not disagree:
 * the page (which renders only what the caller holds), the navigation entry, and
 * the index route.
 *
 * Deriving `DASHBOARD_PERMISSIONS` from the cards rather than writing it out is
 * what makes a card added without its permission being admitted impossible —
 * the same reason `pages/reports/registry.jsx` derives `REPORT_PERMISSIONS`.
 *
 * ── The gate this replaces ─────────────────────────────────────────────────
 *
 * Both the nav item and the route were gated on `report:read` alone, which hid
 * the dashboard entirely from a Department PIC. The `CR-004` ceiling excludes
 * `report:read` because the eight institution-wide aggregates behind it read
 * assets a PIC cannot reach — true of those, and never true of a card showing a
 * department its own units.
 *
 * That was a boundary drawn in the wrong place, not a boundary to weaken.
 * `report:read` still gates exactly what it gated before; it simply stops being
 * the only key to the front door. This is `CR-010`'s answer for the Reports
 * section, applied to the one other screen that is a container of independently
 * gated things.
 *
 * ── `scoped` ───────────────────────────────────────────────────────────────
 *
 * `false` marks a card a PIC-scoped caller must not see AT ALL, as opposed to
 * one they see narrowed to their own departments. Only the unassigned-units card
 * carries it: those units have no department, `unitScopeFilter` cannot reach a
 * NULL, and the server already answers `null` for that block — so rendering an
 * empty card would advertise the existence of an institution-wide count the
 * caller can neither explain nor act on.
 */

export const DASHBOARD_CARDS = Object.freeze([
  {
    id: 'assessment-coverage',
    permission: 'asset-unit:read',
  },
  {
    id: 'assessment-activity',
    permission: 'asset-unit:read',
  },
  {
    id: 'location-condition',
    permission: 'asset-unit:read',
  },
  {
    id: 'unassigned-units',
    permission: 'asset-unit:read',
    // Institution-scoped and system-wide callers only — see the note above.
    scoped: false,
  },
  {
    /**
     * The figures the dashboard carried before `CR-012`: lifecycle, condition
     * and classification breakdowns, and the borrowing counts. All institution
     * aggregates, all still `report:read`, all still absent for a PIC.
     */
    id: 'institution-metrics',
    permission: 'report:read',
  },
]);

/** Every permission that opens at least one card. */
export const DASHBOARD_PERMISSIONS = [...new Set(DASHBOARD_CARDS.map((card) => card.permission))];

/**
 * The cards a caller may open.
 *
 * @param {(code: string) => boolean} can
 * @param {boolean} isPicScoped
 */
export function visibleCards(can, isPicScoped) {
  return DASHBOARD_CARDS.filter(
    (card) => can(card.permission) && !(isPicScoped && card.scoped === false)
  );
}
