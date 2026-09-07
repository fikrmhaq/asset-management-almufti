import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

import { mainDatabaseUrl } from './helpers/db.js';
import { TABLES } from './fixtures/schema.js';

const require = createRequire(import.meta.url);

const { createSequelize } = require('../../src/db/sequelize.js');
const { buildModels, normalizeCharKey } = require('../../src/db/models/index.js');
const { withTransaction } = require('../../src/db/withTransaction.js');
const { createLogger } = require('../../src/logger.js');
const { loadConfig } = require('../../src/config/index.js');

/**
 * Model layer against the real migrated schema — `IMPLEMENTATION_PLAN.md` §8.2, §8.7.
 *
 * Every model is queried, which is what proves the mapping is right: a wrong
 * table, schema or column name fails here rather than in Phase 4.
 *
 * The suite's globalSetup leaves this database migrated and seeded; these tests
 * only read, apart from transactions that are rolled back.
 */

const silentConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: mainDatabaseUrl(),
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_PATH: './storage/attachments',
  MAX_UPLOAD_SIZE_MB: '10',
  CORS_ORIGIN: 'http://localhost:5173',
  // Required since Phase 3. Values are irrelevant here — this file issues no
  // tokens — but the configuration must be complete to load at all.
  JWT_ACCESS_SECRET: 'model-suite-access-secret-not-for-real-use',
  JWT_REFRESH_SECRET: 'model-suite-refresh-secret-not-for-real-use',
});

let sequelize;
let models;

beforeAll(() => {
  const logger = createLogger(silentConfig);
  logger.silent = true;
  sequelize = createSequelize(silentConfig, logger);
  models = buildModels(sequelize);
});

afterAll(async () => {
  await sequelize.close();
});

describe('database connection', () => {
  it('authenticates against the migrated database', async () => {
    await expect(sequelize.authenticate()).resolves.toBeUndefined();
  });

  it('reports the expected dialect', () => {
    expect(sequelize.getDialect()).toBe('postgres');
  });
});

describe('model registry', () => {
  it('registers one model per table in the data model', () => {
    expect(Object.keys(models)).toHaveLength(Object.keys(TABLES).length);
  });

  it('maps every model to an existing table in the right schema', () => {
    const mapped = Object.values(models)
      .map((model) => {
        const options = model.getTableName();
        const { schema, tableName } = typeof options === 'string' ? {} : options;
        return `${schema}.${tableName}`;
      })
      .sort();

    expect(mapped).toEqual(Object.keys(TABLES).sort());
  });

  it.each(Object.keys(TABLES))('%s is queryable through its model', async (table) => {
    const model = Object.values(models).find((candidate) => {
      const { schema, tableName } = candidate.getTableName();
      return `${schema}.${tableName}` === table;
    });

    // A count exercises the full mapping: schema, table name and quoting.
    await expect(model.count()).resolves.toEqual(expect.any(Number));
  });

  it('maps camelCase attributes onto snake_case columns', () => {
    expect(models.AssetUnit.getAttributes().lifecycleState.field).toBe('lifecycle_state');
    expect(models.Role.getAttributes().isSystemWide.field).toBe('is_system_wide');
    expect(models.Asset.getAttributes().createdAt.field).toBe('created_at');
  });

  /**
   * The model's declared types must match the migrated column — Phase 31.
   *
   * `AssetUnit.departmentId` was declared `STRING(8)` until now, eight
   * migrations after 040 retyped the column to `UUID`. Sequelize passed the
   * value through either way, so nothing broke and nothing complained; the
   * declaration was simply false, and `CR-012`'s coverage reports group by this
   * column throughout. Asserted against the live catalog rather than against a
   * literal, so the two cannot drift apart again silently.
   */
  it('declares attribute types matching the migrated columns', async () => {
    const [column] = await sequelize.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'asset_units'
          AND column_name = 'department_id'`,
      { type: sequelize.QueryTypes.SELECT }
    );

    expect(column.data_type).toBe('uuid');
    expect(models.AssetUnit.getAttributes().departmentId.type.key).toBe('UUID');
  });

  it('declares no timestamps on tables that have none', () => {
    expect(models.Category.getAttributes()).not.toHaveProperty('createdAt');
  });

  it('leaves classification timestamps to the service rather than Sequelize (Phase 17)', () => {
    // The columns exist and are mapped, so an application-defined row can carry
    // them — but `timestamps` stays off. Letting Sequelize manage them would
    // stamp `updated_at` on any row it touches, including the 14,738
    // externally-sourced ones that must never be modified (BR-016).
    const attributes = models.AssetClassification.getAttributes();

    expect(attributes.createdAt.field).toBe('created_at');
    expect(attributes.updatedAt.field).toBe('updated_at');
    expect(attributes.createdAt.allowNull).toBe(true);
    expect(attributes.updatedAt.allowNull).toBe(true);
    expect(models.AssetClassification.options.timestamps).toBe(false);
  });

  it('declares createdAt only on append-only tables', () => {
    expect(models.LongitudinalHistory.getAttributes()).toHaveProperty('createdAt');
    expect(models.LongitudinalHistory.getAttributes()).not.toHaveProperty('updatedAt');
    expect(models.Attachment.getAttributes()).not.toHaveProperty('updatedAt');
  });
});

describe('associations', () => {
  it.each([
    ['AssetClassification', 'parent'],
    ['AssetClassification', 'children'],
    ['AttributeDefinition', 'classification'],
    ['User', 'roles'],
    ['User', 'institution'],
    ['Role', 'permissions'],
    ['Asset', 'units'],
    ['Asset', 'classification'],
    ['Asset', 'contract'],
    ['AssetUnit', 'asset'],
    ['AssetUnit', 'history'],
    ['AssetUnit', 'currentLocation'],
    ['AssetUnit', 'contractItem'],
    ['Location', 'children'],
    ['Location', 'floorPlan'],
    ['LocationFloorPlan', 'areas'],
    ['Contract', 'items'],
    ['Borrowing', 'items'],
    ['Transaction', 'items'],
  ])('%s has a "%s" association', (modelName, association) => {
    expect(models[modelName].associations).toHaveProperty(association);
  });

  it('models the classification hierarchy as a self-association', () => {
    expect(models.AssetClassification.associations.children.target.name).toBe(
      'AssetClassification'
    );
  });

  it('models one floor plan per location, not many', () => {
    expect(models.Location.associations.floorPlan.associationType).toBe('HasOne');
  });

  it('models user roles as many-to-many through the join table', () => {
    const association = models.User.associations.roles;

    expect(association.associationType).toBe('BelongsToMany');
    expect(association.through.model.name).toBe('UserRole');
  });

  it('leaves audit logs with no associations, matching the absent foreign key', () => {
    expect(Object.keys(models.AuditLog.associations)).toEqual([]);
  });

  it('resolves an eager-loaded association against real data', async () => {
    const rows = await models.AssetClassification.findAll({
      where: { parentId: '100000000000' },
      include: [{ association: 'parent' }],
      limit: 1,
    });

    expect(rows).toHaveLength(1);
    expect(normalizeCharKey(rows[0].parent.id)).toBe('100000000000');
    expect(rows[0].parent.name).toBe('ASET');
  });
});

describe('seeded data through the models', () => {
  it('reads the classification count via the model', async () => {
    await expect(models.AssetClassification.count()).resolves.toBe(14738);
  });

  it('reads the seeded System Admin role', async () => {
    const role = await models.Role.findOne({ where: { name: 'System Admin' } });

    expect(role.isSystemWide).toBe(true);
    expect(role.createdAt).toBeInstanceOf(Date);
  });

  it('trims blank-padded CHAR natural keys for comparison', async () => {
    const row = await models.AssetClassification.findByPk('100000000000');

    expect(row.id).toHaveLength(12);
    expect(normalizeCharKey(row.id)).toBe('100000000000');
  });
});

describe('User password protection', () => {
  it('excludes passwordHash by default', () => {
    const excluded = models.User.options.defaultScope.attributes.exclude;

    expect(excluded).toContain('passwordHash');
  });

  it('exposes it only through the explicit withPassword scope', () => {
    const scoped = models.User.scope('withPassword');

    expect(scoped.options.attributes ?? {}).not.toHaveProperty('exclude');
  });
});

describe('derived values', () => {
  it('computes contract item totalValue without storing it', () => {
    const item = models.ContractItem.build({ quantity: 3, unitPrice: '12.50' });

    expect(item.totalValue).toBe('37.50');
    expect(models.ContractItem.getAttributes().totalValue.type.key).toBe('VIRTUAL');
  });

  it('returns null when either factor is missing', () => {
    expect(models.ContractItem.build({ quantity: null, unitPrice: '5.00' }).totalValue).toBeNull();
    expect(models.ContractItem.build({ quantity: 2, unitPrice: null }).totalValue).toBeNull();
  });
});

describe('transaction support (§8.2, REQ-NFR-REL-001)', () => {
  it('commits work that succeeds', async () => {
    const created = await withTransaction(
      async (transaction) => models.Vendor.create({ name: 'Committed Vendor' }, { transaction }),
      { sequelize }
    );

    expect(await models.Vendor.findByPk(created.id)).not.toBeNull();
    await models.Vendor.destroy({ where: { id: created.id } });
  });

  it('rolls the whole operation back when a later step fails (REQ-NFR-REL-002)', async () => {
    const marker = 'Rolled Back Vendor';

    await expect(
      withTransaction(
        async (transaction) => {
          await models.Vendor.create({ name: marker }, { transaction });
          throw new Error('second step failed');
        },
        { sequelize }
      )
    ).rejects.toThrow('second step failed');

    await expect(models.Vendor.count({ where: { name: marker } })).resolves.toBe(0);
  });

  it('joins an existing transaction instead of opening a nested one', async () => {
    await sequelize.transaction(async (outer) => {
      const inner = await withTransaction(async (transaction) => transaction, {
        transaction: outer,
        sequelize,
      });

      expect(inner).toBe(outer);
    });
  });
});
