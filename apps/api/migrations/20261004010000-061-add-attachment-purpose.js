'use strict';

/**
 * Registration photos — REQ-REQUEST-020 (`IMPLEMENTATION_PLAN.md` §67).
 * Creation order #61; conditional procurement moves to `062+`.
 *
 * A registration photo is an ordinary Asset / Asset Unit attachment with a
 * purpose: evidence of what was registered against a request item. It belongs
 * to the asset or unit — no link to the request item, no separate entity, no
 * history table; the attachment audit records it.
 *
 * `purpose` is NULL for every existing and every ordinary attachment: no
 * backfill, no index. The CHECK admits the one purpose and holds it to the JPG /
 * PNG types the application enforces. That a unit is linked to a request item
 * is an application rule — a CHECK cannot see another table.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE public.attachments
            ADD COLUMN purpose VARCHAR(30) NULL,
            ADD CONSTRAINT chk_attachments_purpose CHECK (
                purpose IS NULL
                OR (purpose IN ('REGISTRATION_PHOTO')
                    AND file_type IN ('image/jpeg', 'image/png'))
            );
        `,
        { transaction }
      );
    });
  },

  /** Refuses rather than turns registration evidence into ordinary files. */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          SELECT count(*) INTO held FROM public.attachments WHERE purpose IS NOT NULL;
          IF held > 0 THEN
            RAISE EXCEPTION
              'Migration 061 rollback refused: % attachment(s) carry a purpose (registration photos). Export or remove them deliberately first.', held;
          END IF;
        END $$;

        ALTER TABLE public.attachments
            DROP CONSTRAINT chk_attachments_purpose,
            DROP COLUMN purpose;
        `,
        { transaction }
      );
    });
  },
};
