'use strict';

/** `public.users` — 04-data-model.md §5.2.3. Creation order #13. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.users (
            id              UUID         NOT NULL DEFAULT gen_random_uuid(),
            username        VARCHAR(25)  NOT NULL,     -- legacy: username
            password_hash   CHAR(60)     NOT NULL,     -- legacy: password
            first_name      VARCHAR(150) NOT NULL,     -- legacy: firstname
            last_name       VARCHAR(150) NOT NULL,     -- legacy: lastname
            contact_info    TEXT         NULL,
            institution_id  UUID         NULL,         -- legacy: instansi_id
            is_active       BOOLEAN      NOT NULL DEFAULT true,  -- legacy: soft_delete
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_users PRIMARY KEY (id),
            CONSTRAINT uq_users_username UNIQUE (username),
            CONSTRAINT fk_users_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id)
        );

        CREATE INDEX idx_users_institution ON public.users(institution_id);
        CREATE INDEX idx_users_active ON public.users(is_active) WHERE is_active = true;
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.users;');
  },
};
