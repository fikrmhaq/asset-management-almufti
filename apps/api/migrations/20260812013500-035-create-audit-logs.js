'use strict';

/**
 * `audit.audit_logs` — 04-data-model.md §5.6.1. Creation order #34.
 *
 * Append-only (REQ-AUDIT-003): no UPDATE or DELETE for ordinary users. Enforced
 * through application access control and database roles, not a trigger.
 *
 * `actor_id` deliberately carries no foreign key — the §5.6.1 DDL defines none.
 * An audit trail that a user deletion could block or cascade would defeat its
 * purpose. (§7.2 labels its index "FK"; the DDL is authoritative.)
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `
        CREATE TABLE audit.audit_logs (
            id           UUID                NOT NULL DEFAULT gen_random_uuid(),
            actor_id     UUID                NULL,
            action       audit.audit_action  NOT NULL,
            entity_type  VARCHAR(100)        NOT NULL,
            entity_id    VARCHAR(255)        NOT NULL,
            timestamp    TIMESTAMPTZ         NOT NULL DEFAULT now(),
            old_values   JSONB               NULL,
            new_values   JSONB               NULL,
            ip_address   INET                NULL,
            metadata     JSONB               NULL,

            CONSTRAINT pk_audit_logs PRIMARY KEY (id)
        );

        CREATE INDEX idx_audit_logs_entity
            ON audit.audit_logs(entity_type, entity_id);
        CREATE INDEX idx_audit_logs_actor
            ON audit.audit_logs(actor_id);
        CREATE INDEX idx_audit_logs_timestamp
            ON audit.audit_logs(timestamp DESC);
        CREATE INDEX idx_audit_logs_action
            ON audit.audit_logs(action);
        `,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS audit.audit_logs;');
  },
};
