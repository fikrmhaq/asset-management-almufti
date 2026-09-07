'use strict';

/** `public.role_permissions` — 04-data-model.md §5.2.5. Creation order #15. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.role_permissions (
            role_id          UUID          NOT NULL,
            permission_code  VARCHAR(100)  NOT NULL,
            assigned_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

            CONSTRAINT pk_role_permissions PRIMARY KEY (role_id, permission_code),
            CONSTRAINT fk_role_permissions_role
                FOREIGN KEY (role_id) REFERENCES ref.roles(id) ON DELETE CASCADE,
            CONSTRAINT fk_role_permissions_permission
                FOREIGN KEY (permission_code) REFERENCES ref.permissions(code) ON DELETE CASCADE
        );

        CREATE INDEX idx_role_permissions_permission ON public.role_permissions(permission_code);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.role_permissions;');
  },
};
