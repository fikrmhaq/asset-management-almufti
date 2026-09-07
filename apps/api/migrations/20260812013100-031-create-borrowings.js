'use strict';

/** `public.borrowings` — 04-data-model.md §5.5.1. Creation order #30. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.borrowings (
            id                     UUID                    NOT NULL DEFAULT gen_random_uuid(),
            borrower_name          VARCHAR(255)            NOT NULL,     -- legacy: nama_peminjam
            borrower_contact       TEXT                    NOT NULL,     -- legacy: kontak_peminjam
            borrow_date            DATE                    NOT NULL,     -- legacy: tanggal_pinjam
            expected_return_date   DATE                    NOT NULL,     -- legacy: tanggal_kembali
            actual_return_date     DATE                    NULL,
            responsible_person_id  UUID                    NULL,         -- legacy: penanggung_jawab
            institution_id         UUID                    NOT NULL,     -- legacy: instansi_id
            description            TEXT                    NULL,         -- legacy: keterangan
            status                 public.borrowing_status NOT NULL DEFAULT 'DRAFT',
            created_by             UUID                    NULL,
            updated_by             UUID                    NULL,         -- legacy: updater_id
            created_at             TIMESTAMPTZ             NOT NULL DEFAULT now(),
            updated_at             TIMESTAMPTZ             NOT NULL DEFAULT now(),

            CONSTRAINT pk_borrowings PRIMARY KEY (id),
            CONSTRAINT fk_borrowings_responsible
                FOREIGN KEY (responsible_person_id) REFERENCES public.users(id),
            CONSTRAINT fk_borrowings_institution
                FOREIGN KEY (institution_id) REFERENCES public.institutions(id),
            CONSTRAINT fk_borrowings_created_by
                FOREIGN KEY (created_by) REFERENCES public.users(id),
            CONSTRAINT fk_borrowings_updated_by
                FOREIGN KEY (updated_by) REFERENCES public.users(id),
            CONSTRAINT chk_borrowings_return_after_borrow
                CHECK (expected_return_date >= borrow_date),
            CONSTRAINT chk_borrowings_actual_return
                CHECK (actual_return_date IS NULL OR actual_return_date >= borrow_date)
        );

        CREATE INDEX idx_borrowings_institution ON public.borrowings(institution_id);
        CREATE INDEX idx_borrowings_status ON public.borrowings(status);
        CREATE INDEX idx_borrowings_dates ON public.borrowings(borrow_date, expected_return_date);
        CREATE INDEX idx_borrowings_overdue
            ON public.borrowings(expected_return_date)
            WHERE status = 'ACTIVE';
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS public.borrowings;');
  },
};
