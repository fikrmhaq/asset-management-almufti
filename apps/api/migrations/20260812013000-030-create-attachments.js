'use strict';

/** `public.attachments` — 04-data-model.md §5.3.7. Creation order #29. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.attachments (
            id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
            asset_id           UUID         NOT NULL,
            asset_unit_id      UUID         NULL,
            file_name          VARCHAR(255) NOT NULL,
            file_type          VARCHAR(100) NOT NULL,
            file_size          BIGINT       NOT NULL,
            storage_reference  TEXT         NOT NULL,
            uploaded_by        UUID         NOT NULL,
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_attachments PRIMARY KEY (id),
            CONSTRAINT fk_attachments_asset
                FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE,
            CONSTRAINT fk_attachments_unit
                FOREIGN KEY (asset_unit_id) REFERENCES public.asset_units(id),
            CONSTRAINT fk_attachments_uploaded_by
                FOREIGN KEY (uploaded_by) REFERENCES public.users(id),
            CONSTRAINT chk_attachments_file_size
                CHECK (file_size > 0)
        );

        CREATE INDEX idx_attachments_asset ON public.attachments(asset_id);
        CREATE INDEX idx_attachments_unit ON public.attachments(asset_unit_id);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.attachments;');
  },
};
