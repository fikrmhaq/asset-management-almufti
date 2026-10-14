'use strict';

/**
 * `/api/v1` router — `06-api.md` §1.1.
 *
 * Authentication (§2), organization (§3), reference (§4), asset core (§5),
 * procurement (§6), operations (§7), reporting (§9) and audit (§10) are all
 * mounted.
 *
 * Everything past `/auth` sits behind `authenticate`, so a business route cannot
 * be added without a token check by forgetting one — `06-api.md` §1.2 requires a
 * bearer token on every endpoint except login and refresh.
 */

const { Router } = require('express');

const { sendItem } = require('../../http/respond');
const { authenticate } = require('../../middleware/authenticate');
const { operatingScope } = require('../../middleware/operatingScope');
const { authRouter } = require('./auth');

const { institutionsRouter } = require('../../modules/institutions/routes');
const { departmentsRouter } = require('../../modules/departments/routes');
const { usersRouter } = require('../../modules/users/routes');
const { rolesRouter } = require('../../modules/roles/routes');
const { permissionsRouter } = require('../../modules/permissions/routes');
const { classificationsRouter } = require('../../modules/classifications/routes');
const { attributeDefinitionsRouter } = require('../../modules/attributeDefinitions/routes');
const { lookupRouter, referenceRouter } = require('../../modules/lookups/routes');
const { assetsRouter } = require('../../modules/assets/routes');
const { assetUnitsRouter } = require('../../modules/assetUnits/routes');
const { assetUnitReportsRouter } = require('../../modules/assetUnitReports/routes');
const { consumablesRouter } = require('../../modules/consumables/routes');
const { locationsRouter } = require('../../modules/locations/routes');
const { attachmentsRouter } = require('../../modules/attachments/routes');
const { inventoryCodesRouter } = require('../../modules/inventoryCodes/routes');
const { suppliersRouter } = require('../../modules/suppliers/routes');
const { contractsRouter } = require('../../modules/contracts/routes');
const { contractItemsRouter } = require('../../modules/contractItems/routes');
const { vendorsRouter } = require('../../modules/vendors/routes');
const { borrowingsRouter } = require('../../modules/borrowings/routes');
const { transactionsRouter } = require('../../modules/transactions/routes');
const { reportsRouter } = require('../../modules/reports/routes');
const { auditLogsRouter } = require('../../modules/auditLogs/routes');
const {
  schoolPositionsRouter,
  positionAssignmentsRouter,
} = require('../../modules/positionAssignments/routes');
const { workflowDefinitionsRouter } = require('../../modules/workflowDefinitions/routes');
const {
  requestsRouter,
  requestItemsRouter,
  requestStepsRouter,
  requestDocumentsRouter,
  requestItemUnitsRouter,
  requestReceiptsRouter,
} = require('../../modules/requests/routes');

const API_VERSION = 'v1';

function v1Router(options = {}) {
  const router = Router();

  router.get('/', (req, res) => {
    sendItem(res, { version: API_VERSION });
  });

  router.use('/auth', authRouter(options));

  // --- Protected from here down ---------------------------------------------
  const protectedRoutes = Router();
  protectedRoutes.use(authenticate({ config: options.config }));
  // P3 (§64.3): the department-bound operating scope, read from current
  // position assignments, for the scope layer to apply. After authentication,
  // never part of it.
  protectedRoutes.use(operatingScope());

  // Organization (§3)
  protectedRoutes.use('/institutions', institutionsRouter());
  protectedRoutes.use('/departments', departmentsRouter());
  protectedRoutes.use('/users', usersRouter());
  protectedRoutes.use('/roles', rolesRouter());
  protectedRoutes.use('/permissions', permissionsRouter());

  // School positions (§12.1) — Phase 35 (`CR-014`). The user- and
  // department-scoped paths are mounted by their own routers.
  protectedRoutes.use('/school-positions', schoolPositionsRouter());
  protectedRoutes.use('/position-assignments', positionAssignmentsRouter());

  // Workflow definitions (§12.2) — Phase 36 (`CR-014`). Configuration only.
  protectedRoutes.use('/workflow-definitions', workflowDefinitionsRouter());

  // Requests (§12.3) — Phase 37 (`CR-014`). Drafting only.
  protectedRoutes.use('/requests', requestsRouter());
  protectedRoutes.use('/request-items', requestItemsRouter());
  // Phase 38: decisions and acquisition completion.
  protectedRoutes.use('/request-steps', requestStepsRouter());
  // Phase 39: request documents (§12.4).
  protectedRoutes.use('/request-documents', requestDocumentsRouter());
  // Phase 40: removing a registration link (§12.5).
  protectedRoutes.use('/request-item-units', requestItemUnitsRouter());
  // Phase 41: reversing a receipt (§12.6).
  protectedRoutes.use('/request-receipts', requestReceiptsRouter());

  // Reference and classification (§4)
  protectedRoutes.use('/classifications', classificationsRouter());
  protectedRoutes.use('/categories', lookupRouter('categories'));
  protectedRoutes.use('/attribute-definitions', attributeDefinitionsRouter());
  protectedRoutes.use('/measurement-units', lookupRouter('measurement-units'));
  protectedRoutes.use('/contract-types', lookupRouter('contract-types'));
  protectedRoutes.use('/funding-sources', lookupRouter('funding-sources'));
  protectedRoutes.use('/transaction-types', lookupRouter('transaction-types'));
  protectedRoutes.use('/account-codes', lookupRouter('account-codes'));
  protectedRoutes.use('/reference', referenceRouter());

  // Asset core (§5)
  protectedRoutes.use('/assets', assetsRouter());
  protectedRoutes.use('/asset-units', assetUnitsRouter());
  // REQ-REQUEST-025: Room PIC reports and their review.
  protectedRoutes.use('/asset-unit-reports', assetUnitReportsRouter());
  // §73: consumables — quantity-based stock, issued only against request lines.
  protectedRoutes.use('/consumables', consumablesRouter());
  protectedRoutes.use('/locations', locationsRouter());
  protectedRoutes.use('/attachments', attachmentsRouter());
  // P4 (§64.4): read-only inventory-code preview for registration screens.
  protectedRoutes.use('/inventory-codes', inventoryCodesRouter());

  // Procurement (§6). Vendors are documented under §7 "Operations", but the
  // entity belongs to procurement work and is built in this phase
  // (`IMPLEMENTATION_PLAN.md` §12.2, `DEC-008`).
  protectedRoutes.use('/suppliers', suppliersRouter());
  protectedRoutes.use('/contracts', contractsRouter());
  protectedRoutes.use('/contract-items', contractItemsRouter());
  protectedRoutes.use('/vendors', vendorsRouter());

  // Operations (§7.2, §7.3)
  protectedRoutes.use('/borrowings', borrowingsRouter());
  protectedRoutes.use('/transactions', transactionsRouter());

  // Reporting (§9) and audit (§10) — read-only, owned by Phase 15 (`GAP-002`).
  protectedRoutes.use('/reports', reportsRouter());
  protectedRoutes.use('/audit-logs', auditLogsRouter());

  router.use(protectedRoutes);

  return router;
}

module.exports = { v1Router, API_VERSION };
