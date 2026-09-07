'use strict';

/**
 * Enumerated types.
 * 04-data-model.md §4.
 *
 * `public.status_enum` is created as documented even though no table column
 * uses it — the physical schema expresses soft deletion as `is_active BOOLEAN`
 * (§1.4). Recorded as an observation in the Phase 1 report, not a silent
 * deviation.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        -- General status for soft-delete pattern
        -- Legacy: soft_delete (0 = active, 1 = inactive)
        CREATE TYPE public.status_enum AS ENUM ('ACTIVE', 'INACTIVE');

        -- Borrowing lifecycle states
        -- Domain: BorrowingStatusEnum
        CREATE TYPE public.borrowing_status AS ENUM (
            'DRAFT',
            'ACTIVE',
            'RETURNED',
            'OVERDUE',
            'CANCELLED'
        );

        -- Asset unit lifecycle states
        -- Domain: AssetLifecycleStateEnum
        CREATE TYPE public.lifecycle_state AS ENUM (
            'REGISTERED',
            'ACTIVE',
            'IN_STORAGE',
            'BORROWED',
            'UNDER_MAINTENANCE',
            'DISPOSED',
            'DEACTIVATED'
        );

        -- Asset condition values
        -- Domain: ConditionEnum
        -- Legacy: integer values in detail_asset_longitudinal.kondisi
        CREATE TYPE public.condition_enum AS ENUM (
            'GOOD',
            'FAIR',
            'POOR',
            'DAMAGED',
            'UNSERVICEABLE'
        );

        -- Configurable attribute data types
        -- Domain: AttributeTypeEnum
        CREATE TYPE ref.attribute_type AS ENUM (
            'TEXT',
            'NUMBER',
            'BOOLEAN',
            'DATE',
            'SELECTION',
            'REFERENCE'
        );

        -- Configurable attribute scope
        -- Domain: AttributeScopeEnum
        CREATE TYPE ref.attribute_scope AS ENUM (
            'ASSET',
            'ASSET_UNIT'
        );

        -- Audit action types
        -- Domain: AuditActionEnum
        CREATE TYPE audit.audit_action AS ENUM (
            'CREATE',
            'UPDATE',
            'DELETE',
            'STATUS_CHANGE'
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DROP TYPE IF EXISTS audit.audit_action;
        DROP TYPE IF EXISTS ref.attribute_scope;
        DROP TYPE IF EXISTS ref.attribute_type;
        DROP TYPE IF EXISTS public.condition_enum;
        DROP TYPE IF EXISTS public.lifecycle_state;
        DROP TYPE IF EXISTS public.borrowing_status;
        DROP TYPE IF EXISTS public.status_enum;
        `,
        { transaction }
      );
    });
  },
};
