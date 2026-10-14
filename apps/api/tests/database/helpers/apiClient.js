import { createRequire } from 'node:module';
import request from 'supertest';

import { mainDatabaseUrl } from './db.js';

// Point the process-wide config at the verification database, and lift the rate
// limits, BEFORE the application modules are required — they memoize on first
// load. `loadDotEnvFiles` never overwrites an already-set variable.
process.env.DATABASE_URL = mainDatabaseUrl();
process.env.RATE_LIMIT_MAX = '10000';

const require = createRequire(import.meta.url);

const { getConfig } = require('../../../src/config/index.js');
const { createApp } = require('../../../src/app.js');
const { createLogger } = require('../../../src/logger.js');
const { getModels } = require('../../../src/db/models/index.js');
const { hashPassword } = require('../../../src/auth/password.js');
const { signAccessToken } = require('../../../src/auth/tokens.js');

export const config = getConfig();
export const models = getModels();

const logger = createLogger(config);
logger.silent = true;

export const app = createApp({ config, logger });

/**
 * A caller with an exact permission set.
 *
 * Tokens are signed directly rather than obtained through login: these tests are
 * about authorization decisions, and a login round-trip per case would only add
 * bcrypt cost. `authenticate` still re-resolves the principal from the database,
 * so the roles and grants created here are what actually decide access.
 */
export async function createCaller({
  username,
  permissions = [],
  isSystemWide = false,
  // Phase 22 (`CR-003`), REQ-ROLE-011 — the third scope tier.
  isPicScoped = false,
  institutionId = null,
} = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = username ?? `caller-${suffix}`;

  const user = await models.User.create({
    username: name,
    passwordHash: await hashPassword('caller-password-value'),
    firstName: 'Test',
    lastName: 'Caller',
    institutionId,
    isActive: true,
  });

  const role = await models.Role.create({ name: `role-${suffix}`, isSystemWide, isPicScoped });
  await models.UserRole.create({ userId: user.id, roleId: role.id });

  if (permissions.length > 0) {
    await models.RolePermission.bulkCreate(
      permissions.map((permissionCode) => ({ roleId: role.id, permissionCode }))
    );
  }

  const token = signAccessToken({ userId: user.id, roleIds: [role.id], institutionId }, config);

  return { user, role, token, auth: ['Authorization', `Bearer ${token}`] };
}

/** A caller holding every permission in the catalog. */
export async function createAdminCaller() {
  const { allPermissionCodes } = require('../../../src/auth/permissionCatalog.js');
  return createCaller({ permissions: allPermissionCodes(), isSystemWide: true });
}

export const api = () => request(app);

/**
 * Removes asset-core data in foreign-key dependency order.
 *
 * Order matters: `asset_units.current_location_id` references `locations`, so
 * deleting locations first fails on `fk_asset_units_current_location`.
 */
export async function resetAssetCoreData() {
  // Phase 37 (`CR-014`): requests reference locations (their destination),
  // classifications, users, departments and position assignments, so they go
  // first — items before their requests, since there is no cascade.
  // Phase 38: steps reference requests, users and position assignments.
  // Phase 39: documents reference requests and users.
  await models.RequestDocument.destroy({ where: {} });
  // Phase 41: receipts reference links and users; close events, requests.
  await models.RequestItemUnitReceipt.destroy({ where: {} });
  // Migration 057: confirmations — after the receipts and photos pointing at
  // them, before the requests, locations and users they reference.
  await models.RequestReceiptConfirmation.destroy({ where: {} });
  await models.RequestCloseEvent.destroy({ where: {} });
  // Phase 40: registration links reference request items, asset units and users.
  await models.RequestItemUnit.destroy({ where: {} });
  // P6: read state references requests and users.
  await models.RequestView.destroy({ where: {} });
  // Migration 059: revision notes reference steps and items.
  await models.RequestStepItemNote.destroy({ where: {} });
  await models.RequestStep.destroy({ where: {} });
  // Migration 067 (§73): stock movements reference request items, consumables
  // and users; request items reference consumables.
  await models.ConsumableStockMovement.destroy({ where: {} });
  await models.RequestItem.destroy({ where: {} });
  await models.Consumable.destroy({ where: {} });
  await models.Request.destroy({ where: {} });
  // PIC assignments reference locations and users (`NO ACTION`), so they are
  // cleared before either — Phase 21 (`CR-003`).
  await models.LocationPicAssignment.destroy({ where: {} });
  // Migration 066: unit reports reference units, locations, history and users.
  await models.AssetUnitReport.destroy({ where: {} });
  await models.FloorPlanArea.destroy({ where: {} });
  await models.LocationFloorPlan.destroy({ where: {} });
  await models.Attachment.destroy({ where: {} });
  await models.AssetUnitAttributeValue.destroy({ where: {} });
  await models.AssetAttributeValue.destroy({ where: {} });
  await models.LongitudinalHistory.destroy({ where: {} });
  await models.AssetUnitLocation.destroy({ where: {} });
  await models.AssetUnit.destroy({ where: {} });
  await models.Asset.destroy({ where: {} });
  // Migration 063: an institution's Teacher Storage Room references a location
  // (`NO ACTION`), so it is released before the locations go.
  await models.Institution.update({ teacherStorageLocationId: null }, { where: {} });
  await models.Location.destroy({ where: {} });
  await models.Vendor.destroy({ where: {} });
  await models.Contract.destroy({ where: {} });
}

/**
 * Removes procurement data in foreign-key dependency order.
 *
 * Asset units reference contract items (`fk_asset_units_contract_item`, NO
 * ACTION), and assets reference contracts, so the asset-core reset has to run
 * first. `contract_items` is left to `ON DELETE CASCADE` from its contract.
 */
/**
 * Removes operations data. Runs before the asset-core reset, since borrowing and
 * transaction items reference asset units (`NO ACTION`); the item tables
 * themselves cascade from their headers.
 */
export async function resetOperationsData() {
  await models.BorrowingItem.destroy({ where: {} });
  await models.Borrowing.destroy({ where: {} });
  await models.TransactionItem.destroy({ where: {} });
  await models.Transaction.destroy({ where: {} });
}

export async function resetProcurementData() {
  await models.ContractItem.destroy({ where: {} });
  await models.Contract.destroy({ where: {} });
  await models.Supplier.destroy({ where: {} });
  await models.Vendor.destroy({ where: {} });
}

/**
 * Removes everything these suites create, leaving seeded reference data alone.
 *
 * The seeded `System Admin` role and its permission grants are preserved: other
 * test files assert on them, and Vitest does not guarantee file order, so wiping
 * them here would break those files depending on which ran first.
 */
export async function resetOrganizationData() {
  const { Op } = models.Role.sequelize.Sequelize;

  const seededAdmin = await models.Role.findOne({ where: { name: SYSTEM_ADMIN_ROLE } });
  const keepRoleId = seededAdmin?.id;

  await models.RolePermission.destroy({
    where: keepRoleId ? { roleId: { [Op.ne]: keepRoleId } } : {},
  });
  await models.UserRole.destroy({ where: {} });
  /**
   * PIC references have to be released before the users are — Phase 21
   * (`CR-003`). Both the assignment rows AND the denormalized
   * `current_pic_user_id` on departments and locations point at `users`, so
   * deleting users first violates `fk_departments_current_pic`.
   */
  await models.DepartmentPicAssignment.destroy({ where: {} });
  await models.LocationPicAssignment.destroy({ where: {} });
  // Phase 35 (`CR-014`): position assignments reference users, departments and
  // institutions, so they go before all three.
  // Phase 37: a file that resets only organization data must still release
  // requests before the assignments, users and institutions they reference.
  // Phase 38: steps reference requests, users and position assignments.
  // Phase 39: documents reference requests and users.
  await models.RequestDocument.destroy({ where: {} });
  // Phase 41: receipts reference links and users; close events, requests.
  await models.RequestItemUnitReceipt.destroy({ where: {} });
  // Migration 057: confirmations — after the receipts and photos pointing at
  // them, before the requests, locations and users they reference.
  await models.RequestReceiptConfirmation.destroy({ where: {} });
  await models.RequestCloseEvent.destroy({ where: {} });
  // Phase 40: registration links reference request items, asset units and users.
  await models.RequestItemUnit.destroy({ where: {} });
  await models.RequestStep.destroy({ where: {} });
  // Migration 067 (§73): movements reference items, consumables and users;
  // consumables reference institutions and users.
  await models.ConsumableStockMovement.destroy({ where: {} });
  await models.RequestItem.destroy({ where: {} });
  await models.Consumable.destroy({ where: {} });
  await models.Request.destroy({ where: {} });
  await models.PositionAssignment.destroy({ where: {} });
  // Phase 36 (`CR-014`): workflow definitions reference institutions and users.
  // Their steps go with them (`fk_wf_step_definition` cascades).
  await models.WorkflowDefinition.destroy({ where: {} });
  await models.Department.update({ currentPicUserId: null }, { where: {} });
  await models.Location.update({ currentPicUserId: null }, { where: {} });
  await models.User.destroy({ where: {} });
  await models.Role.destroy({ where: { name: { [Op.ne]: SYSTEM_ADMIN_ROLE } } });
  // Departments BEFORE institutions since Phase 20 (`CR-003`): departments now
  // carry `institution_id`, so clearing institutions first violates
  // `fk_departments_institution`.
  await models.Department.destroy({ where: {} });
  await models.Institution.destroy({ where: {} });
  await models.AttributeDefinition.destroy({ where: {} });
  await models.MeasurementUnit.destroy({ where: {} });
  await models.ContractType.destroy({ where: {} });
  await models.FundingSource.destroy({ where: {} });
  await models.TransactionType.destroy({ where: {} });
  await models.AccountCode.destroy({ where: {} });
}

const SYSTEM_ADMIN_ROLE = 'System Admin';
