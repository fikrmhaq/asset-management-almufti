import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getPool } from './helpers/db.js';

/**
 * Behavioural checks: the constraints are not merely present, they actually fire.
 *
 * Every test runs inside a transaction that is rolled back, so this file leaves
 * the database exactly as it found it and does not depend on file ordering.
 * Fixture classification ids are deliberately outside the seeded numeric key
 * space so they cannot collide with the real reference data.
 */

const ROOT_CLASSIFICATION = 'TESTCLS00001';
const LEAF_CLASSIFICATION = 'TESTCLS00002';

let client;

beforeEach(async () => {
  client = await getPool().connect();
  await client.query('BEGIN');
});

afterEach(async () => {
  await client.query('ROLLBACK');
  client.release();
});

/** Minimal referenced rows for the tables under test. */
async function fixtures() {
  const {
    rows: [institution],
  } = await client.query(
    `INSERT INTO public.institutions (name, code, address)
     VALUES ('Test Institution', 'TEST-001', 'Somewhere') RETURNING id`
  );

  const {
    rows: [user],
  } = await client.query(
    `INSERT INTO public.users (username, password_hash, first_name, last_name)
     VALUES ('tester', repeat('x', 60), 'Test', 'User') RETURNING id`
  );

  await client.query(
    `INSERT INTO ref.asset_classifications (id, parent_id, name, origin)
     VALUES ($1, NULL, 'ROOT', 1), ($2, $1, 'LEAF', 1)`,
    [ROOT_CLASSIFICATION, LEAF_CLASSIFICATION]
  );

  const {
    rows: [location],
  } = await client.query(
    `INSERT INTO public.locations (name, classification_id, institution_id)
     VALUES ('Room 1', $1, $2) RETURNING id`,
    [LEAF_CLASSIFICATION, institution.id]
  );

  const {
    rows: [asset],
  } = await client.query(
    `INSERT INTO public.assets (name, classification_id, institution_id)
     VALUES ('Test Asset', $1, $2) RETURNING id`,
    [LEAF_CLASSIFICATION, institution.id]
  );

  const {
    rows: [unit],
  } = await client.query(`INSERT INTO public.asset_units (asset_id) VALUES ($1) RETURNING id`, [
    asset.id,
  ]);

  return { institution, user, location, asset, unit };
}

describe('UUID generation', () => {
  it('generates a UUID primary key when none is supplied', async () => {
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO public.vendors (name) VALUES ('Acme') RETURNING id, created_at, updated_at`
    );

    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.updated_at).toBeInstanceOf(Date);
  });

  it('generates distinct UUIDs across rows', async () => {
    const { rows } = await client.query(
      `INSERT INTO public.vendors (name) VALUES ('A'), ('B'), ('C') RETURNING id`
    );

    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
});

describe('identity columns', () => {
  it('assigns integer identities and rejects an explicit value', async () => {
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO ref.contract_types (name) VALUES ('Purchase') RETURNING id`
    );
    expect(Number.isInteger(row.id)).toBe(true);

    // GENERATED ALWAYS (not BY DEFAULT): an explicit id is refused outright.
    await expect(
      client.query(`INSERT INTO ref.contract_types (id, name) VALUES (999, 'Manual')`)
    ).rejects.toThrow(/cannot insert a non-DEFAULT value into column/i);
  });
});

describe('enum columns', () => {
  it('accepts documented lifecycle values and rejects others', async () => {
    const { unit } = await fixtures();

    await client.query(
      `UPDATE public.asset_units SET lifecycle_state = 'IN_STORAGE' WHERE id = $1`,
      [unit.id]
    );

    await expect(
      client.query(`UPDATE public.asset_units SET lifecycle_state = 'RETIRED' WHERE id = $1`, [
        unit.id,
      ])
    ).rejects.toThrow(/invalid input value for enum/i);
  });

  it('defaults a new asset unit to REGISTERED', async () => {
    const { asset } = await fixtures();
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO public.asset_units (asset_id) VALUES ($1) RETURNING lifecycle_state`,
      [asset.id]
    );

    expect(row.lifecycle_state).toBe('REGISTERED');
  });

  it('defaults a new borrowing to DRAFT', async () => {
    const { institution } = await fixtures();
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO public.borrowings
         (borrower_name, borrower_contact, borrow_date, expected_return_date, institution_id)
       VALUES ('Someone', 'someone@example.test', '2026-01-01', '2026-01-10', $1)
       RETURNING status`,
      [institution.id]
    );

    expect(row.status).toBe('DRAFT');
  });
});

describe('check constraints reject invalid rows', () => {
  it('rejects a self-referencing classification', async () => {
    await expect(
      client.query(
        `INSERT INTO ref.asset_classifications (id, parent_id, name)
         VALUES ('TESTCLS00099', 'TESTCLS00099', 'Self')`
      )
    ).rejects.toThrow(/chk_asset_classifications_no_self_ref/);
  });

  it('rejects a self-referencing location', async () => {
    const { location } = await fixtures();

    await expect(
      client.query(`UPDATE public.locations SET parent_location_id = id WHERE id = $1`, [
        location.id,
      ])
    ).rejects.toThrow(/chk_locations_no_self_ref/);
  });

  /**
   * Phase 27 (`CR-008`). The slash was refused here until the scanned-label
   * address stopped carrying the code in a URL path segment; it is now a
   * supported separator, and this is the shape the change exists for
   * (REQ-UNIT-011).
   */
  it('accepts an inventory code format containing a slash', async () => {
    const { institution } = await fixtures();

    await client.query(`UPDATE public.institutions SET inventory_code_format = $1 WHERE id = $2`, [
      '{NUMBER_COMPOSITION}/{CLASSIFICATION_CODE}/{REGISTRATION_YEAR}',
      institution.id,
    ]);

    const { rows } = await client.query(
      `SELECT inventory_code_format FROM public.institutions WHERE id = $1`,
      [institution.id]
    );

    expect(rows[0].inventory_code_format).toBe(
      '{NUMBER_COMPOSITION}/{CLASSIFICATION_CODE}/{REGISTRATION_YEAR}'
    );
  });

  /**
   * Phase 25 (`CR-006`), narrowed by `CR-008` to everything but the slash. The
   * database's half of the format rule is characters only; what it still stops
   * is anything that cannot survive a URL at all.
   */
  it('rejects an inventory code format containing a space', async () => {
    const { institution } = await fixtures();

    await expect(
      client.query(
        `UPDATE public.institutions SET inventory_code_format = $1 WHERE id = $2`,
        ['{INSTITUTION_CODE} {SEQUENCE}', institution.id]
      )
    ).rejects.toThrow(/chk_institutions_inventory_code_format/);
  });

  it('accepts a well-formed inventory code format, and NULL for an unconfigured one', async () => {
    const { institution } = await fixtures();

    await client.query(`UPDATE public.institutions SET inventory_code_format = $1 WHERE id = $2`, [
      '{INSTITUTION_CODE}-{REGISTRATION_YEAR}-{SEQUENCE}',
      institution.id,
    ]);

    // NULL is the unconfigured state and must stay reachable: clearing a format
    // returns the institution to the application default (REQ-ORG-007).
    await client.query(
      `UPDATE public.institutions SET inventory_code_format = NULL WHERE id = $1`,
      [institution.id]
    );

    const { rows } = await client.query(
      `SELECT inventory_code_format FROM public.institutions WHERE id = $1`,
      [institution.id]
    );

    expect(rows[0].inventory_code_format).toBeNull();
  });

  /**
   * Phase 26 (`CR-007`). A funding source code may be carried into an inventory
   * code, which travels in the address a scanned label resolves to — so the
   * database enforces the same character class as `institutions.code`.
   */
  it('rejects a funding source code that is unsafe in a URL', async () => {
    await expect(
      client.query(`INSERT INTO ref.funding_sources (name, code) VALUES ('Slashed', 'A/B')`)
    ).rejects.toThrow(/chk_funding_sources_code_url_safe/);
  });

  it('accepts a NULL funding source code, which is the pre-assignment state', async () => {
    // The migration deliberately assigns no codes: "Dana Bos" is called "BOS",
    // and no normalization of the name discovers that (`BR-027`).
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO ref.funding_sources (name) VALUES ('Undecided') RETURNING code`
    );

    expect(row.code).toBeNull();
  });

  it('allows many funding sources to await a code, but not two with the same one', async () => {
    await client.query(`INSERT INTO ref.funding_sources (name) VALUES ('Pending A'), ('Pending B')`);

    await client.query(`INSERT INTO ref.funding_sources (name, code) VALUES ('Bos', 'BOS')`);

    await expect(
      client.query(`INSERT INTO ref.funding_sources (name, code) VALUES ('Bos Daerah', 'BOS')`)
    ).rejects.toThrow(/uq_funding_sources_code/);
  });

  it('rejects an expected return date before the borrow date', async () => {
    const { institution } = await fixtures();

    await expect(
      client.query(
        `INSERT INTO public.borrowings
           (borrower_name, borrower_contact, borrow_date, expected_return_date, institution_id)
         VALUES ('Someone', 'contact', '2026-02-01', '2026-01-01', $1)`,
        [institution.id]
      )
    ).rejects.toThrow(/chk_borrowings_return_after_borrow/);
  });

  it('rejects an actual return date before the borrow date', async () => {
    const { institution } = await fixtures();

    await expect(
      client.query(
        `INSERT INTO public.borrowings
           (borrower_name, borrower_contact, borrow_date, expected_return_date,
            actual_return_date, institution_id)
         VALUES ('Someone', 'contact', '2026-02-01', '2026-02-10', '2026-01-01', $1)`,
        [institution.id]
      )
    ).rejects.toThrow(/chk_borrowings_actual_return/);
  });

  it('rejects a zero-byte attachment', async () => {
    const { asset, user } = await fixtures();

    await expect(
      client.query(
        `INSERT INTO public.attachments
           (asset_id, file_name, file_type, file_size, storage_reference, uploaded_by)
         VALUES ($1, 'empty.pdf', 'application/pdf', 0, '/storage/x', $2)`,
        [asset.id, user.id]
      )
    ).rejects.toThrow(/chk_attachments_file_size/);
  });

  it('rejects a zero-byte floor plan', async () => {
    const { location, user } = await fixtures();

    await expect(
      client.query(
        `INSERT INTO public.location_floor_plans
           (location_id, file_name, file_type, file_size, storage_reference, uploaded_by)
         VALUES ($1, 'plan.png', 'image/png', 0, '/storage/x', $2)`,
        [location.id, user.id]
      )
    ).rejects.toThrow(/chk_location_floor_plans_file_size/);
  });

  it('rejects a non-positive contract item quantity', async () => {
    const {
      rows: [supplier],
    } = await client.query(`INSERT INTO public.suppliers (name) VALUES ('S') RETURNING id`);
    const {
      rows: [contract],
    } = await client.query(
      `INSERT INTO public.contracts (contract_number, contract_date, supplier_id)
       VALUES ('C-1', '2026-01-01', $1) RETURNING id`,
      [supplier.id]
    );

    await expect(
      client.query(
        `INSERT INTO public.contract_items (contract_id, asset_name, quantity)
         VALUES ($1, 'Item', 0)`,
        [contract.id]
      )
    ).rejects.toThrow(/chk_contract_items_quantity/);
  });

  it('rejects a negative unit price', async () => {
    const {
      rows: [contract],
    } = await client.query(
      `INSERT INTO public.contracts (contract_number, contract_date)
       VALUES ('C-2', '2026-01-01') RETURNING id`
    );

    await expect(
      client.query(
        `INSERT INTO public.contract_items (contract_id, asset_name, unit_price)
         VALUES ($1, 'Item', -1)`,
        [contract.id]
      )
    ).rejects.toThrow(/chk_contract_items_price/);
  });

  it('rejects a location assignment that ends before it starts', async () => {
    const { unit, location } = await fixtures();

    await expect(
      client.query(
        `INSERT INTO public.asset_unit_locations
           (asset_unit_id, location_id, assigned_at, unassigned_at)
         VALUES ($1, $2, '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [unit.id, location.id]
      )
    ).rejects.toThrow(/chk_asset_unit_locations_dates/);
  });

  it('rejects a history record whose effective period ends before it starts', async () => {
    const { unit, location } = await fixtures();

    await expect(
      client.query(
        // `entry_type` is supplied so this reaches the date CHECK. Without it the
        // row is refused by the NOT NULL first (`CR-012` `DEC-B`), which is
        // correct but would test the wrong constraint — see the suite below.
        `INSERT INTO public.longitudinal_history
           (asset_unit_id, description, condition, location_id, entry_type,
            effective_from, effective_to)
         VALUES ($1, 'note', 'GOOD', $2, 'MANUAL',
                 '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [unit.id, location.id]
      )
    ).rejects.toThrow(/chk_longitudinal_history_dates/);
  });
});

/**
 * History entry provenance — `CR-012` `DEC-A`/`DEC-B`, REQ-COND-006, TC-COND-006.
 *
 * The database half of the guarantee. `applyStateChange` refuses to write
 * without an `entryType`, but a service check alone would leave a raw INSERT —
 * a future migration, a data-repair script, a second writer — able to produce a
 * row with no stated provenance that silently counts as a monthly assessment.
 */
describe('history entry provenance (CR-012)', () => {
  it('refuses a history row that does not say what produced it', async () => {
    const { unit, location } = await fixtures();

    await expect(
      client.query(
        `INSERT INTO public.longitudinal_history
           (asset_unit_id, description, condition, location_id)
         VALUES ($1, 'note', 'GOOD', $2)`,
        [unit.id, location.id]
      )
    ).rejects.toThrow(/entry_type/);
  });

  /**
   * THE COLUMN MUST HAVE NO DEFAULT (`DEC-B`).
   *
   * A `DEFAULT 'MANUAL'` would make the test above pass by filling the value
   * in, so a writer that forgot the column would silently satisfy the monthly
   * assessment requirement on a row indistinguishable from a real assessment.
   * Asserted against the catalog directly, because that is the only place the
   * absence is visible.
   */
  it('has no column default to fall back on', async () => {
    const { rows } = await client.query(
      `SELECT column_default
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'longitudinal_history'
          AND column_name = 'entry_type'`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].column_default).toBeNull();
  });

  it.each(['MANUAL', 'BORROWING', 'SYSTEM'])('accepts %s', async (entryType) => {
    const { unit, location } = await fixtures();

    await expect(
      client.query(
        `INSERT INTO public.longitudinal_history
           (asset_unit_id, description, condition, location_id, entry_type)
         VALUES ($1, 'note', 'GOOD', $2, $3)`,
        [unit.id, location.id, entryType]
      )
    ).resolves.toBeDefined();
  });

  it('refuses a value outside the enumeration', async () => {
    const { unit, location } = await fixtures();

    await expect(
      client.query(
        `INSERT INTO public.longitudinal_history
           (asset_unit_id, description, condition, location_id, entry_type)
         VALUES ($1, 'note', 'GOOD', $2, 'ASSESSMENT')`,
        [unit.id, location.id]
      )
    ).rejects.toThrow(/history_entry_type/);
  });
});

describe('unique constraints reject duplicates', () => {
  it('rejects a duplicate institution code', async () => {
    await client.query(
      `INSERT INTO public.institutions (name, code, address) VALUES ('A', 'DUP', 'x')`
    );

    await expect(
      client.query(`INSERT INTO public.institutions (name, code, address) VALUES ('B', 'DUP', 'y')`)
    ).rejects.toThrow(/uq_institutions_code/);
  });

  it('rejects a duplicate username', async () => {
    await client.query(
      `INSERT INTO public.users (username, password_hash, first_name, last_name)
       VALUES ('dup', repeat('x', 60), 'A', 'B')`
    );

    await expect(
      client.query(
        `INSERT INTO public.users (username, password_hash, first_name, last_name)
         VALUES ('dup', repeat('y', 60), 'C', 'D')`
      )
    ).rejects.toThrow(/uq_users_username/);
  });

  it('rejects the same unit twice in one borrowing', async () => {
    const { institution, unit } = await fixtures();
    const {
      rows: [borrowing],
    } = await client.query(
      `INSERT INTO public.borrowings
         (borrower_name, borrower_contact, borrow_date, expected_return_date, institution_id)
       VALUES ('Someone', 'contact', '2026-01-01', '2026-01-10', $1) RETURNING id`,
      [institution.id]
    );
    await client.query(
      `INSERT INTO public.borrowing_items (borrowing_id, asset_unit_id) VALUES ($1, $2)`,
      [borrowing.id, unit.id]
    );

    await expect(
      client.query(
        `INSERT INTO public.borrowing_items (borrowing_id, asset_unit_id) VALUES ($1, $2)`,
        [borrowing.id, unit.id]
      )
    ).rejects.toThrow(/uq_borrowing_items_borrowing_unit/);
  });

  it('allows at most one floor plan per location', async () => {
    const { location, user } = await fixtures();
    await client.query(
      `INSERT INTO public.location_floor_plans
         (location_id, file_name, file_type, file_size, storage_reference, uploaded_by)
       VALUES ($1, 'plan.png', 'image/png', 100, '/storage/a', $2)`,
      [location.id, user.id]
    );

    await expect(
      client.query(
        `INSERT INTO public.location_floor_plans
           (location_id, file_name, file_type, file_size, storage_reference, uploaded_by)
         VALUES ($1, 'plan2.png', 'image/png', 100, '/storage/b', $2)`,
        [location.id, user.id]
      )
    ).rejects.toThrow(/uq_location_floor_plans_location/);
  });

  it('rejects one attribute value twice for the same asset', async () => {
    const { asset } = await fixtures();
    const {
      rows: [definition],
    } = await client.query(
      `INSERT INTO ref.attribute_definitions (classification_id, name)
       VALUES ($1, 'Colour') RETURNING id`,
      [LEAF_CLASSIFICATION]
    );
    await client.query(
      `INSERT INTO public.asset_attribute_values (asset_id, attribute_definition_id, value_text)
       VALUES ($1, $2, 'red')`,
      [asset.id, definition.id]
    );

    await expect(
      client.query(
        `INSERT INTO public.asset_attribute_values (asset_id, attribute_definition_id, value_text)
         VALUES ($1, $2, 'blue')`,
        [asset.id, definition.id]
      )
    ).rejects.toThrow(/uq_asset_attribute_values_asset_attr/);
  });
});

describe('referential integrity', () => {
  it('rejects a reference to a non-existent parent', async () => {
    await expect(
      client.query(
        `INSERT INTO public.asset_units (asset_id)
         VALUES ('00000000-0000-0000-0000-000000000000')`
      )
    ).rejects.toThrow(/fk_asset_units_asset/);
  });

  it('cascades a contract delete to its items', async () => {
    const {
      rows: [contract],
    } = await client.query(
      `INSERT INTO public.contracts (contract_number, contract_date)
       VALUES ('C-3', '2026-01-01') RETURNING id`
    );
    await client.query(
      `INSERT INTO public.contract_items (contract_id, asset_name) VALUES ($1, 'Item')`,
      [contract.id]
    );

    await client.query(`DELETE FROM public.contracts WHERE id = $1`, [contract.id]);
    const { rows } = await client.query(
      `SELECT 1 FROM public.contract_items WHERE contract_id = $1`,
      [contract.id]
    );

    expect(rows).toHaveLength(0);
  });

  it('cascades a floor plan delete to its areas without touching the locations', async () => {
    const { location, user, institution } = await fixtures();
    const {
      rows: [child],
    } = await client.query(
      `INSERT INTO public.locations (name, classification_id, parent_location_id, institution_id)
       VALUES ('Corner', $1, $2, $3) RETURNING id`,
      [LEAF_CLASSIFICATION, location.id, institution.id]
    );
    const {
      rows: [plan],
    } = await client.query(
      `INSERT INTO public.location_floor_plans
         (location_id, file_name, file_type, file_size, storage_reference, uploaded_by)
       VALUES ($1, 'plan.png', 'image/png', 100, '/storage/a', $2) RETURNING id`,
      [location.id, user.id]
    );
    await client.query(
      `INSERT INTO public.floor_plan_areas (floor_plan_id, location_id, polygon)
       VALUES ($1, $2, '[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1}]'::jsonb)`,
      [plan.id, child.id]
    );

    await client.query(`DELETE FROM public.location_floor_plans WHERE id = $1`, [plan.id]);

    const { rows: areas } = await client.query(`SELECT 1 FROM public.floor_plan_areas`);
    const { rows: locations } = await client.query(`SELECT 1 FROM public.locations WHERE id = $1`, [
      child.id,
    ]);

    expect(areas).toHaveLength(0);
    expect(locations).toHaveLength(1);
  });

  it('restricts deleting a classification still referenced by an asset', async () => {
    await fixtures();

    await expect(
      client.query(`DELETE FROM ref.asset_classifications WHERE id = $1`, [LEAF_CLASSIFICATION])
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it('accepts an audit record whose actor id matches no user', async () => {
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO audit.audit_logs (actor_id, action, entity_type, entity_id, ip_address, metadata)
       VALUES ('11111111-1111-1111-1111-111111111111', 'CREATE', 'Asset', 'abc',
               '192.0.2.10', '{"source":"test"}'::jsonb)
       RETURNING actor_id, ip_address, metadata`
    );

    expect(row.actor_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(row.ip_address).toBe('192.0.2.10');
    expect(row.metadata).toEqual({ source: 'test' });
  });
});

describe('storage types', () => {
  it('stores contract values at 2 decimal places', async () => {
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO public.contracts (contract_number, contract_date, contract_value)
       VALUES ('C-4', '2026-01-01', 1234567890123.45) RETURNING contract_value`
    );

    expect(row.contract_value).toBe('1234567890123.45');
  });

  it('stores attribute values at 4 decimal places', async () => {
    const { asset } = await fixtures();
    const {
      rows: [definition],
    } = await client.query(
      `INSERT INTO ref.attribute_definitions (classification_id, name, attribute_type)
       VALUES ($1, 'Weight', 'NUMBER') RETURNING id`,
      [LEAF_CLASSIFICATION]
    );
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO public.asset_attribute_values (asset_id, attribute_definition_id, value_numeric)
       VALUES ($1, $2, 12.3456) RETURNING value_numeric`,
      [asset.id, definition.id]
    );

    expect(row.value_numeric).toBe('12.3456');
  });

  it('stores a floor plan polygon as queryable JSONB', async () => {
    const { location, user, institution } = await fixtures();
    const {
      rows: [child],
    } = await client.query(
      `INSERT INTO public.locations (name, classification_id, parent_location_id, institution_id)
       VALUES ('Corner', $1, $2, $3) RETURNING id`,
      [LEAF_CLASSIFICATION, location.id, institution.id]
    );
    const {
      rows: [plan],
    } = await client.query(
      `INSERT INTO public.location_floor_plans
         (location_id, file_name, file_type, file_size, storage_reference, uploaded_by)
       VALUES ($1, 'plan.png', 'image/png', 100, '/storage/a', $2) RETURNING id`,
      [location.id, user.id]
    );

    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO public.floor_plan_areas (floor_plan_id, location_id, polygon)
       VALUES ($1, $2, '[{"x":0.1,"y":0.2},{"x":0.9,"y":0.2},{"x":0.9,"y":0.8}]'::jsonb)
       RETURNING polygon, jsonb_array_length(polygon) AS points`,
      [plan.id, child.id]
    );

    expect(row.points).toBe(3);
    expect(row.polygon[0]).toEqual({ x: 0.1, y: 0.2 });
  });
});
