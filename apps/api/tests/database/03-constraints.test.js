import { describe, it, expect } from 'vitest';

import { query } from './helpers/db.js';
import {
  PRIMARY_KEYS,
  UNIQUE_CONSTRAINTS,
  CHECK_CONSTRAINTS,
  FOREIGN_KEYS,
} from './fixtures/schema.js';

/** Constraints — 04-data-model.md §5 DDL, §8.1, §8.2. */

const CONTYPE = { p: 'PRIMARY KEY', u: 'UNIQUE', c: 'CHECK', f: 'FOREIGN KEY' };

async function constraintsOfType(type) {
  return query(
    `
    SELECT c.conname AS name,
           n.nspname || '.' || rel.relname AS table,
           fn.nspname || '.' || fref.relname AS referenced,
           c.confdeltype AS on_delete,
           pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = rel.relnamespace
      LEFT JOIN pg_class fref ON fref.oid = c.confrelid
      LEFT JOIN pg_namespace fn ON fn.oid = fref.relnamespace
     WHERE c.contype = $1
       AND n.nspname IN ('public','ref','audit')
       AND rel.relname <> 'SequelizeMeta'
     ORDER BY c.conname
    `,
    [type]
  );
}

const DELETE_ACTION = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};

describe('primary keys', () => {
  it('creates every documented primary key on the right table', async () => {
    const rows = await constraintsOfType('p');
    const actual = Object.fromEntries(rows.map((r) => [r.name, r.table]));

    expect(actual).toEqual(PRIMARY_KEYS);
  });

  it('uses composite keys on the two join tables', async () => {
    const rows = await constraintsOfType('p');
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.definition]));

    expect(byName.pk_user_roles).toBe('PRIMARY KEY (user_id, role_id)');
    expect(byName.pk_role_permissions).toBe('PRIMARY KEY (role_id, permission_code)');
  });
});

describe('unique constraints', () => {
  it('creates exactly the documented unique constraints', async () => {
    const rows = await constraintsOfType('u');

    expect(rows.map((r) => r.name).sort()).toEqual([...UNIQUE_CONSTRAINTS].sort());
  });
});

describe('check constraints (§8.1)', () => {
  it('creates exactly the documented named check constraints', async () => {
    const rows = await constraintsOfType('c');
    // NOT NULL is stored separately in PostgreSQL 16, so every row here is a
    // table-level CHECK — but filter by our naming convention to be explicit.
    const named = rows.map((r) => r.name).filter((name) => name.startsWith('chk_'));

    expect(named.sort()).toEqual([...CHECK_CONSTRAINTS].sort());
  });

  it.each([
    ['chk_asset_classifications_no_self_ref', 'id <> parent_id'],
    ['chk_locations_no_self_ref', 'id <> parent_location_id'],
    ['chk_asset_unit_locations_dates', 'unassigned_at'],
    ['chk_longitudinal_history_dates', 'effective_to'],
    ['chk_attachments_file_size', 'file_size > 0'],
    ['chk_location_floor_plans_file_size', 'file_size > 0'],
    ['chk_contract_items_quantity', 'quantity'],
    ['chk_contract_items_price', 'unit_price'],
    ['chk_borrowings_return_after_borrow', 'expected_return_date'],
    ['chk_borrowings_actual_return', 'actual_return_date'],
    // Phase 25 (`CR-006`), widened by `CR-008`. The character class, not the
    // grammar — a space or a percent must not reach the column, because literal
    // text is carried into an inventory code and that code travels in the
    // address a scanned label resolves to (REQ-UNIT-011). The slash is now
    // among the characters it permits.
    ['chk_institutions_inventory_code_format', 'inventory_code_format'],
    // Phase 26 (`CR-007`). Tolerates NULL, because the business codes are
    // assigned by administrators rather than invented by the migration.
    ['chk_funding_sources_code_url_safe', 'code IS NULL'],
  ])('%s expresses the documented rule', async (name, fragment) => {
    const rows = await constraintsOfType('c');
    const constraint = rows.find((r) => r.name === name);

    expect(constraint, `${name} is missing`).toBeDefined();
    expect(constraint.definition).toContain(fragment);
  });
});

describe('foreign keys', () => {
  it('creates exactly the documented foreign keys, each pointing at the right table', async () => {
    const rows = await constraintsOfType('f');
    const actual = Object.fromEntries(rows.map((r) => [r.name, [r.table, r.referenced]]));
    const expected = Object.fromEntries(
      Object.entries(FOREIGN_KEYS).map(([name, [table, referenced]]) => [name, [table, referenced]])
    );

    expect(actual).toEqual(expected);
  });

  it('applies the documented ON DELETE behaviour (§8.2)', async () => {
    const rows = await constraintsOfType('f');
    const actual = Object.fromEntries(rows.map((r) => [r.name, DELETE_ACTION[r.on_delete]]));
    const expected = Object.fromEntries(
      Object.entries(FOREIGN_KEYS).map(([name, [, , onDelete]]) => [name, onDelete])
    );

    expect(actual).toEqual(expected);
  });

  // 13 since Phase 36 (`CR-014`): `fk_wf_step_definition`, documented in
  // `04-data-model.md` §5.7.2. No endpoint deletes a definition.
  it('cascades from exactly the 13 documented parents', async () => {
    const rows = await constraintsOfType('f');
    const cascading = rows.filter((r) => r.on_delete === 'c').map((r) => r.name);

    expect(cascading.sort()).toEqual(
      [
        'fk_asset_attribute_values_asset',
        'fk_asset_unit_attribute_values_unit',
        'fk_attachments_asset',
        'fk_borrowing_items_borrowing',
        'fk_contract_items_contract',
        'fk_floor_plan_areas_floor_plan',
        'fk_location_floor_plans_location',
        'fk_role_permissions_permission',
        'fk_role_permissions_role',
        'fk_transaction_items_transaction',
        'fk_user_roles_role',
        'fk_user_roles_user',
        'fk_wf_step_definition',
      ].sort()
    );
  });

  it('leaves audit_logs.actor_id without a foreign key (§5.6.1)', async () => {
    const rows = await constraintsOfType('f');
    const auditFks = rows.filter((r) => r.table === 'audit.audit_logs');

    expect(auditFks).toEqual([]);
  });
});

describe('constraint naming (§1.2)', () => {
  it('names every constraint by the documented convention', async () => {
    const rows = await query(`
      SELECT c.conname AS name, c.contype AS type
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
       WHERE n.nspname IN ('public','ref','audit')
         AND rel.relname <> 'SequelizeMeta'
         AND c.contype IN ('p','u','c','f')
    `);

    const prefixes = { p: 'pk_', u: 'uq_', c: 'chk_', f: 'fk_' };
    const misnamed = rows.filter((row) => !row.name.startsWith(prefixes[row.type]));

    expect(misnamed.map((r) => `${CONTYPE[r.type]} ${r.name}`)).toEqual([]);
  });
});
