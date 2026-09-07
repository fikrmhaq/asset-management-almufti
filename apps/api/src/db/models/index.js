'use strict';

/**
 * Model registry — `IMPLEMENTATION_PLAN.md` §8.2.
 *
 * Loads every model definition in this directory, applies the associations, and
 * returns the registry. Models describe the schema the Phase 1 migrations
 * created; `sequelize.sync()` is never called.
 */

const fs = require('node:fs');
const path = require('node:path');

const { DataTypes } = require('sequelize');

const { getSequelize } = require('../sequelize');
const { applyAssociations } = require('../associations');
const { applyAuditHooks } = require('../auditHooks');

const MODEL_DIR = __dirname;
const INDEX_FILE = path.basename(__filename);

function loadModelDefiners() {
  return fs
    .readdirSync(MODEL_DIR)
    .filter((file) => file.endsWith('.js') && file !== INDEX_FILE)
    .sort()
    .map((file) => ({ file, define: require(path.join(MODEL_DIR, file)) }));
}

/**
 * Builds the model registry for a Sequelize instance.
 *
 * @param {import('sequelize').Sequelize} [sequelize]
 * @returns {Record<string, import('sequelize').ModelStatic<import('sequelize').Model>>}
 */
function buildModels(sequelize = getSequelize()) {
  const models = {};

  for (const { file, define } of loadModelDefiners()) {
    const model = define(sequelize, DataTypes);
    if (!model?.name) {
      throw new Error(`Model file ${file} did not return a Sequelize model.`);
    }
    models[model.name] = model;
  }

  applyAssociations(models);
  // Phase 8, §14.4: any write to an audited model is recorded, without each
  // service having to remember to do it.
  applyAuditHooks(models);

  return models;
}

let registry;

/** Memoized registry bound to the process-wide Sequelize instance. */
function getModels() {
  if (!registry) registry = buildModels();
  return registry;
}

/** Test-only: forgets the memoized registry. */
function resetModels() {
  registry = undefined;
}

/**
 * Trims a `CHAR(n)` natural key read back from PostgreSQL.
 *
 * `ref.asset_classifications.id` and `ref.account_codes.code` are blank-padded
 * to their full width on read, so a value compared or serialized without
 * trimming carries trailing spaces.
 */
function normalizeCharKey(value) {
  return typeof value === 'string' ? value.trim() : value;
}

module.exports = { buildModels, getModels, resetModels, normalizeCharKey };
