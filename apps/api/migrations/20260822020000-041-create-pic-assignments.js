'use strict';

/**
 * Phase 21 (`CR-003`) — person in charge (PIC) for Departments and Locations.
 * `04-data-model.md` §5.2.5, §5.3.9; creation order #41. REQ-ORG-006, REQ-LOC-014.
 *
 * A PIC is always a system User (never free text), and the assignment is
 * TEMPORAL: "who is responsible for the TKJ workshop?" and "who was responsible
 * last March?" are both answerable, and the second is not derivable from a
 * single mutable column.
 *
 * ── Shape ──────────────────────────────────────────────────────────────────
 *
 * Modelled directly on `public.asset_unit_locations` (migration 026), which is
 * this repository's existing temporal-assignment pattern: one row per
 * assignment, `is_current` plus a null end date marking the live one, history
 * preserved by never updating a closed row.
 *
 * TWO DELIBERATE STRENGTHENINGS over that table:
 *
 *   1. `uq_*_pic_current` is UNIQUE, where `idx_asset_unit_locations_current` is
 *      a plain index. Two current location rows would be untidy; two current PIC
 *      rows would make "who is responsible" ambiguous — and in Phase 22 that row
 *      decides what a PIC-scoped user may touch. The database refuses it rather
 *      than trusting the service to.
 *
 *   2. `chk_*_pic_current` makes `is_current` and `ended_at` incapable of
 *      disagreeing. A closed assignment that still reads `is_current = true` is
 *      exactly the row that would keep granting access after a handover, so the
 *      two facts are one fact as far as the schema is concerned.
 *
 * `current_pic_user_id` on the parent tables is a DENORMALIZED cache of the live
 * row, maintained in the same transaction — the same trade-off
 * `asset_units.current_location_id` already makes against `asset_unit_locations`.
 * The assignment table stays authoritative.
 *
 * `assigned_by` / `ended_by` record who made the change. They are nullable
 * because a future migration or system process may open an assignment with no
 * acting user, not because the caller is optional.
 *
 * NO AUTHORIZATION IS GRANTED BY THESE TABLES IN THIS PHASE. Phase 22 reads
 * `department_pic_assignments` to narrow asset-unit access; Location PIC is
 * responsibility and history only, and is deliberately never read by the
 * authorization layer (`CR-003` §5.4).
 */

/** Both tables are identical apart from what they hang off. */
const assignmentTable = (table, parentTable, parentColumn, prefix) => `
CREATE TABLE public.${table} (
    id            UUID        NOT NULL DEFAULT gen_random_uuid(),
    ${parentColumn}  UUID        NOT NULL,
    user_id       UUID        NOT NULL,
    is_current    BOOLEAN     NOT NULL DEFAULT true,
    assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at      TIMESTAMPTZ     NULL,
    assigned_by   UUID            NULL,
    ended_by      UUID            NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_${table} PRIMARY KEY (id),
    CONSTRAINT fk_${prefix}_parent
        FOREIGN KEY (${parentColumn}) REFERENCES public.${parentTable}(id),
    CONSTRAINT fk_${prefix}_user
        FOREIGN KEY (user_id) REFERENCES public.users(id),
    CONSTRAINT fk_${prefix}_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES public.users(id),
    CONSTRAINT fk_${prefix}_ended_by
        FOREIGN KEY (ended_by) REFERENCES public.users(id),
    CONSTRAINT chk_${prefix}_dates
        CHECK (ended_at IS NULL OR ended_at >= assigned_at),
    -- is_current and ended_at are one fact, not two that may disagree.
    CONSTRAINT chk_${prefix}_current
        CHECK ((is_current = true  AND ended_at IS NULL)
            OR (is_current = false AND ended_at IS NOT NULL))
);

CREATE INDEX idx_${prefix}_parent ON public.${table}(${parentColumn});
CREATE INDEX idx_${prefix}_user   ON public.${table}(user_id);

-- At most ONE live assignment per department/location.
CREATE UNIQUE INDEX uq_${prefix}_current
    ON public.${table}(${parentColumn}) WHERE is_current = true;

-- "What am I currently responsible for?" — and, for departments, the lookup
-- Phase 22's authorization will run on every request.
CREATE INDEX idx_${prefix}_user_current
    ON public.${table}(user_id) WHERE is_current = true;
`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        assignmentTable('department_pic_assignments', 'departments', 'department_id', 'dept_pic'),
        { transaction }
      );

      await queryInterface.sequelize.query(
        assignmentTable('location_pic_assignments', 'locations', 'location_id', 'loc_pic'),
        { transaction }
      );

      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.departments
            ADD COLUMN current_pic_user_id UUID NULL,
            ADD CONSTRAINT fk_departments_current_pic
                FOREIGN KEY (current_pic_user_id) REFERENCES public.users(id);

        ALTER TABLE public.locations
            ADD COLUMN current_pic_user_id UUID NULL,
            ADD CONSTRAINT fk_locations_current_pic
                FOREIGN KEY (current_pic_user_id) REFERENCES public.users(id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.departments
            DROP CONSTRAINT IF EXISTS fk_departments_current_pic,
            DROP COLUMN IF EXISTS current_pic_user_id;

        ALTER TABLE public.locations
            DROP CONSTRAINT IF EXISTS fk_locations_current_pic,
            DROP COLUMN IF EXISTS current_pic_user_id;

        DROP TABLE IF EXISTS public.location_pic_assignments;
        DROP TABLE IF EXISTS public.department_pic_assignments;
        `,
        { transaction }
      );
    });
  },
};
