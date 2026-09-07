import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import pg from 'pg';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const { loadDotEnvFiles, API_ROOT } = require('../../../src/config/index.js');

loadDotEnvFiles();

const SEQUELIZE_CLI = path.join(
  path.dirname(require.resolve('sequelize-cli/package.json')),
  'lib',
  'sequelize'
);

/**
 * The suite uses two databases so no test file depends on another's ordering —
 * Vitest does not guarantee file order, and the migrate/rollback cycle is
 * destructive by nature.
 *
 *   main  — migrated and seeded once by globalSetup; asserted against.
 *   cycle — owned exclusively by the migration-cycle test.
 */
export function mainDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env and set it.');
  }
  return url;
}

export function cycleDatabaseUrl() {
  const url = new URL(mainDatabaseUrl());
  url.pathname = `${url.pathname}_cycle`;
  return url.toString();
}

function databaseNameOf(connectionString) {
  return new URL(connectionString).pathname.replace(/^\//, '');
}

function maintenanceUrlFor(connectionString) {
  const url = new URL(connectionString);
  url.pathname = '/postgres';
  return url.toString();
}

/** Creates the database if it does not already exist. */
export async function ensureDatabase(connectionString) {
  const client = new pg.Client({ connectionString: maintenanceUrlFor(connectionString) });
  const database = databaseNameOf(connectionString);
  await client.connect();

  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      database,
    ]);
    if (rowCount === 0) {
      // An identifier cannot be parameterized; the name comes from our own config.
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Drops every managed object, including `SequelizeMeta`, so a run starts from a
 * genuinely empty database — what `IMPLEMENTATION_PLAN.md` §7.9 asks to verify.
 */
export async function resetDatabase(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      DROP SCHEMA IF EXISTS audit CASCADE;
      DROP SCHEMA IF EXISTS ref CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      DROP EXTENSION IF EXISTS "pgcrypto";
    `);
  } finally {
    await client.end();
  }
}

/** Runs a sequelize-cli command against the given database. */
export async function runCli(args, connectionString = mainDatabaseUrl()) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [SEQUELIZE_CLI, ...args], {
    cwd: API_ROOT,
    env: { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: connectionString },
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout, stderr };
}

export const migrate = (url) => runCli(['db:migrate'], url);
export const migrateUndoAll = (url) => runCli(['db:migrate:undo:all'], url);
export const seed = (url) => runCli(['db:seed:all'], url);
export const seedUndoAll = (url) => runCli(['db:seed:undo:all'], url);

const pools = new Map();

export function getPool(connectionString = mainDatabaseUrl()) {
  if (!pools.has(connectionString)) {
    pools.set(connectionString, new pg.Pool({ connectionString, max: 4 }));
  }
  return pools.get(connectionString);
}

export async function query(sql, params = [], connectionString) {
  const { rows } = await getPool(connectionString).query(sql, params);
  return rows;
}

export async function closePools() {
  await Promise.all([...pools.values()].map((pool) => pool.end()));
  pools.clear();
}

/** Counts the objects the migrations own, for empty/complete assertions. */
export async function countManagedObjects(connectionString) {
  const [{ tables }] = await query(
    `SELECT count(*)::int AS tables
       FROM information_schema.tables
      WHERE table_schema IN ('public','ref','audit') AND table_name <> 'SequelizeMeta'`,
    [],
    connectionString
  );
  const [{ enums }] = await query(
    `SELECT count(*)::int AS enums
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname IN ('public','ref','audit')`,
    [],
    connectionString
  );
  const [{ schemas }] = await query(
    `SELECT count(*)::int AS schemas FROM pg_namespace WHERE nspname IN ('ref','audit')`,
    [],
    connectionString
  );
  return { tables, enums, schemas };
}

/**
 * A comparable description of the whole schema: enums, columns, constraints and
 * indexes. Proves migrate → rollback → migrate is deterministic.
 */
export async function schemaSnapshot(connectionString) {
  const columns = await query(
    `SELECT table_schema, table_name, column_name, data_type, udt_schema, udt_name,
            character_maximum_length, numeric_precision, numeric_scale,
            is_nullable, column_default, is_identity
       FROM information_schema.columns
      WHERE table_schema IN ('public','ref','audit') AND table_name <> 'SequelizeMeta'
      ORDER BY table_schema, table_name, column_name`,
    [],
    connectionString
  );

  const constraints = await query(
    `SELECT n.nspname AS schema, c.conname AS name, c.contype AS type,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname IN ('public','ref','audit')
      ORDER BY n.nspname, c.conname`,
    [],
    connectionString
  );

  const indexes = await query(
    `SELECT schemaname AS schema, indexname AS name, indexdef AS definition
       FROM pg_indexes
      WHERE schemaname IN ('public','ref','audit') AND tablename <> 'SequelizeMeta'
      ORDER BY schemaname, indexname`,
    [],
    connectionString
  );

  const enums = await query(
    `SELECT n.nspname AS schema, t.typname AS name,
            array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typtype = 'e'
      GROUP BY n.nspname, t.typname
      ORDER BY n.nspname, t.typname`,
    [],
    connectionString
  );

  return JSON.stringify({ columns, constraints, indexes, enums });
}

/** Normalizes an information_schema column row into the fixture's type notation. */
export function normalizeType(column) {
  switch (column.data_type) {
    case 'USER-DEFINED':
      return `${column.udt_schema}.${column.udt_name}`;
    case 'character varying':
      return `varchar(${column.character_maximum_length})`;
    case 'character':
      return `char(${column.character_maximum_length})`;
    case 'numeric':
      return `numeric(${column.numeric_precision},${column.numeric_scale})`;
    case 'timestamp with time zone':
      return 'timestamptz';
    default:
      return column.data_type;
  }
}
