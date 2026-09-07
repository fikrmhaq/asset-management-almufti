'use strict';

/** `public.user_roles` — 04-data-model.md §5.2.4. Creation order #14. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.user_roles (
            user_id      UUID         NOT NULL,
            role_id      UUID         NOT NULL,
            assigned_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_user_roles PRIMARY KEY (user_id, role_id),
            CONSTRAINT fk_user_roles_user
                FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
            CONSTRAINT fk_user_roles_role
                FOREIGN KEY (role_id) REFERENCES ref.roles(id) ON DELETE CASCADE
        );
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.user_roles;');
  },
};
