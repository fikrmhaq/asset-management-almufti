'use strict';

/**
 * Request read state — P6 (`IMPLEMENTATION_PLAN.md` §64.6), REQ-REQUEST-017.
 * Creation order #58; conditional procurement moves to `059+`.
 *
 * ── request_views ─────────────────────────────────────────────────────────
 *
 * When a user last looked at a Request: one row per (user, request), upserted
 * by `POST /requests/:id/view` only. It is the whole persistent part of Request
 * Updates — the updates themselves are derived from the business tables
 * (steps, links, receipts, documents, close events, the request's own status),
 * so there is no event table and nothing to backfill.
 *
 * READ STATE, NOT A BUSINESS FACT: not audited, and `down()` drops it freely.
 * A user with no row has seen nothing since the configured baseline
 * (`REQUEST_UPDATES_SINCE`), so history before the feature never appears as new.
 *
 * The primary key (user_id, request_id) serves every lookup, which is always
 * "this user's view of these requests". Foreign keys are NO ACTION.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE public.request_views (
          user_id       UUID         NOT NULL,
          request_id    UUID         NOT NULL,
          last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

          CONSTRAINT pk_request_views PRIMARY KEY (user_id, request_id),
          CONSTRAINT fk_request_views_user
              FOREIGN KEY (user_id) REFERENCES public.users(id),
          CONSTRAINT fk_request_views_request
              FOREIGN KEY (request_id) REFERENCES public.requests(id)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE public.request_views;');
  },
};
