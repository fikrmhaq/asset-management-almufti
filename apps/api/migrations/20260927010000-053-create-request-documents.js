'use strict';

/**
 * Phase 39 (`CR-014`) — request documents. `04-data-model.md` §5.7.5; creation
 * order #53. REQ-REQUEST-014.
 *
 * One row per file, owned by exactly one request. Deliberately NOT an extension
 * of `public.attachments`, whose `asset_id` is NOT NULL and whose `CR-004` rules
 * are built around the asset/unit pair (`CR-014` `DEC-O`, F10). The file columns
 * mirror `attachments`, and the files go through the same storage service,
 * sharded under the request.
 *
 * `document_type` is `VARCHAR` + a named CHECK (`DEC-Q`, `DEC-U`).
 * `src/domain/requestDocumentTypes.js` is the authoritative list, and
 * `tests/database/33-request-documents.test.js` fails on drift. No type is
 * mandatory: nothing here, or anywhere, requires one (`CR-014` §9).
 *
 * Rows are immutable — there is no `updated_at` and no update endpoint.
 * No cascade from `requests`: requests are never deleted.
 */

const TYPES = `'PROPOSAL', 'SUPPORTING', 'INVOICE', 'RECEIPT', 'BAST', 'OTHER'`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE public.request_documents (
            id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
            request_id         UUID         NOT NULL,
            document_type      VARCHAR(12)  NOT NULL,
            title              VARCHAR(255)     NULL,
            file_name          VARCHAR(255) NOT NULL,
            file_type          VARCHAR(100) NOT NULL,
            file_size          BIGINT       NOT NULL,
            storage_reference  TEXT         NOT NULL,
            uploaded_by        UUID         NOT NULL,
            created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

            CONSTRAINT pk_request_documents PRIMARY KEY (id),
            CONSTRAINT fk_request_documents_request
                FOREIGN KEY (request_id) REFERENCES public.requests(id),
            CONSTRAINT fk_request_documents_uploader
                FOREIGN KEY (uploaded_by) REFERENCES public.users(id),
            CONSTRAINT chk_request_documents_type
                CHECK (document_type IN (${TYPES})),
            CONSTRAINT chk_request_documents_size
                CHECK (file_size > 0)
        );

        CREATE INDEX idx_request_documents_request ON public.request_documents(request_id);
        `,
        { transaction }
      );
    });
  },

  /**
   * Refuses while any document exists: dropping the table would orphan the
   * stored files and discard the record of what was filed.
   */
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        DO $$
        DECLARE held bigint;
        BEGIN
          IF to_regclass('public.request_documents') IS NOT NULL THEN
            SELECT count(*) INTO held FROM public.request_documents;
            IF held > 0 THEN
              RAISE EXCEPTION
                'Migration 053 rollback refused: public.request_documents holds % document(s), each with a stored file. Export or remove them deliberately first.', held;
            END IF;
          END IF;
        END $$;

        DROP TABLE IF EXISTS public.request_documents;
        `,
        { transaction }
      );
    });
  },
};
