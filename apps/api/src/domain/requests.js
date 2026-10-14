'use strict';

/**
 * Request drafting — Phase 37 (`CR-014` §4.4, §5.1, §5.2, §10.2),
 * REQ-REQUEST-001 – REQ-REQUEST-006, REQ-REQUEST-015, `06-api.md` §12.3.
 *
 * Drafting, reading and visibility. Submission, decisions, acquisition
 * completion and cancellation live in `domain/requestWorkflow.js` (Phase 38);
 * nothing here or there registers or receives anything. A request is optional,
 * always (`BR-032`): nothing in this module reads or writes an asset or unit.
 *
 * Phase 38 widened visibility with the two actor clauses (`CR-014` §10.2,
 * decision F9), added `awaiting=me` (F6), the steps and the caller's available
 * actions to the detail, and the destination-only change after submission.
 *
 * ── Rules decided for Phase 37 ─────────────────────────────────────────────
 *
 *   Q1  a quantity is a whole number of Asset Units; no second quantity model.
 *   E1  a DRAFT is private to its requester. Neither `request:oversee` nor a
 *       system-wide role shows another user's DRAFT; oversight begins at
 *       SUBMITTED.
 *   E3  editing is the requester's own DRAFT only.
 *   E4  visibility is requester + oversight; workflow actors come in Phase 38.
 *   E5  items report requested / cancelled / required only.
 *   E8  item lines are 1..n and renumbered after a deletion.
 *   E9  a DRAFT stays editable after its assignment ends; Phase 38 submission
 *       re-checks it.
 *   Guidance is informational. No active workflow never prevents creating or
 *   editing a DRAFT, and an unusual category is allowed.
 *
 * ── The requester context ──────────────────────────────────────────────────
 *
 * The caller acts in one of their OWN, CURRENT school-position assignments. Its
 * position and department are copied onto the request (`DEC-D`) and every later
 * rule reads the copy, so the context survives the assignment ending. For a
 * department-bound position the request's department IS the context's — held by
 * `chk_requests_department_locked` as well as here.
 */

const { Op, literal, fn, col } = require('sequelize');

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { ValidationError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { organizationScope, hasPermission } = require('../auth/principal');
const { toFindOptions, paginate } = require('../query/listQuery');
const { equals } = require('../query/filtering');
const { scopeFilter, canAccessInstitution } = require('./scope');
const { serializeUser } = require('./picAssignments');
const { requiresDepartment, isTeacherPosition } = require('./schoolPositions');
const { REQUEST_CATEGORIES, DEPARTMENT_CATEGORY } = require('./requestCategories');
const {
  typicalCategoriesFor,
  isEligibleCategory,
  assertEligibleCategory,
} = require('./requestGuidance');
const { allocateRequestNumber } = require('./requestNumbers');
const {
  activeActorSql,
  actedSql,
  resubmittedDecideHolderSql,
  resolveHolders,
} = require('./actorResolution');
const {
  STEP_ACTION_PERMISSION,
  TERMINAL_REQUEST_STATUSES,
  EDITABLE_REQUEST_STATUSES,
} = require('./requestStepStates');
const { currentSteps } = require('./requestCycles');
const { mayUpload } = require('./requestDocumentRules');
const { registrationHint } = require('./inventoryCodeFormat');
const {
  OPEN_FULFILMENT_STATUSES,
  isReceivableUnit,
  itemFigures,
} = require('./requestFulfilmentRules');
const receiptConfirmations = require('./requestReceiptConfirmations');
const { submitBlockers } = require('./requestSubmission');
const actionsNeeded = require('./requestActionsNeeded');
const requestUpdates = require('./requestUpdates');
const { issuedByItem } = require('./consumableStock');

const PERSON =['id', 'username', 'firstName', 'lastName'];
const DEPARTMENT = ['id', 'code', 'name'];

// --- Serialization ----------------------------------------------------------

function serializeDepartment(department) {
  return department ? { id: department.id, code: department.code, name: department.name } : null;
}

/**
 * One item with its figures. `counts` — registered / received / pending /
 * blocked (Phase 41, `requestFulfilmentRules`); registered is the number of
 * links (Phase 40, D4), never filtered by the linked units' current state.
 * Registration is not receipt; received counts only active receipts.
 */
function serializeItem(item, counts = {}) {
  const figures = itemFigures(item, counts);
  const required = figures.required;
  const registered = figures.registered;
  return {
    id: item.id,
    requestId: item.requestId,
    lineNo: item.lineNo,
    description: item.description,
    specification: item.specification ?? null,
    // REQ-REQUEST-019: informational; never fetched.
    referenceUrl: item.referenceUrl ?? null,
    quantityRequested: item.quantityRequested,
    quantityCancelled: item.quantityCancelled,
    // E5: derived, never stored. Registered and received arrive in 40 / 41.
    quantityRequired: required,
    // Phase 40: registration.
    quantityRegistered: registered,
    quantityNotYetRegistered: figures.notYetRegistered,
    // Phase 41: receipt, the three shortfalls, and what a close would cancel.
    quantityReceived: figures.received,
    quantityPending: figures.pending,
    quantityBlocked: figures.blocked,
    quantityReceiptNotRecorded: figures.receiptNotRecorded,
    quantityNotYetReceived: figures.notYetReceived,
    quantityCancellableByClose: figures.cancellableByClose,
    quantityCancellableUnregistered: figures.cancellableUnregistered,
    quantityCancellableBlocked: figures.cancellableBlocked,
    measurementUnitId: item.measurementUnitId ?? null,
    measurementUnit: item.measurementUnit
      ? { id: item.measurementUnit.id, name: item.measurementUnit.name }
      : null,
    estimatedUnitPrice: item.estimatedUnitPrice ?? null,
    classificationId: item.classificationId ? item.classificationId.trim() : null,
    classification: item.classification
      ? { id: item.classification.id.trim(), name: item.classification.name }
      : null,
    // §73: a consumable line is issued from stock, never registered or
    // received as units. Its issued quantity is the fulfilment figure.
    consumableId: item.consumableId ?? null,
    consumable: item.consumable
      ? { id: item.consumable.id, name: item.consumable.name, isActive: item.consumable.isActive }
      : null,
    ...(item.consumableId
      ? {
          quantityIssued: figures.received,
          quantityNotYetIssued: figures.notYetReceived,
        }
      : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function serialize(request, { items, counts = {} } = {}) {
  return {
    id: request.id,
    institutionId: request.institutionId,
    requestNumber: request.requestNumber,
    category: request.category,
    title: request.title,
    justification: request.justification ?? null,
    status: request.status,
    requesterUserId: request.requesterUserId,
    requester: serializeUser(request.requester),
    requesterAssignmentId: request.requesterAssignmentId,
    // Whether the context the draft was made in is still held (E9). Shown so
    // the requester knows; submission (Phase 38) is what enforces it.
    requesterAssignmentCurrent: request.requesterAssignment
      ? request.requesterAssignment.isCurrent
      : undefined,
    requesterPositionCode: request.requesterPositionCode,
    requesterDepartmentId: request.requesterDepartmentId ?? null,
    requesterDepartment: serializeDepartment(request.requesterDepartment),
    departmentId: request.departmentId ?? null,
    department: serializeDepartment(request.department),
    destinationLocationId: request.destinationLocationId ?? null,
    // REQ-REQUEST-024: `isActive`, so recording receipt can warn that a
    // deactivated intended location will place nothing.
    destination: request.destination
      ? {
          id: request.destination.id,
          name: request.destination.name,
          isActive: request.destination.isActive,
        }
      : null,
    neededBy: request.neededBy ?? null,
    workflowDefinitionId: request.workflowDefinitionId ?? null,
    submittedAt: request.submittedAt ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    ...(items ? { items: items.map((item) => serializeItem(item, counts[item.id])) } : {}),
  };
}

const HEADER_INCLUDE = [
  { association: 'requester', attributes: PERSON },
  { association: 'requesterAssignment', attributes: ['id', 'isCurrent'] },
  { association: 'requesterDepartment', attributes: DEPARTMENT },
  { association: 'department', attributes: DEPARTMENT },
  { association: 'destination', attributes: ['id', 'name', 'isActive'] },
];

const ITEM_INCLUDE = [
  { association: 'measurementUnit', attributes: ['id', 'name'] },
  { association: 'classification', attributes: ['id', 'name'] },
  { association: 'consumable', attributes: ['id', 'name', 'isActive'] },
];

// --- Authorization helpers --------------------------------------------------

/** `CR-004` ceiling, second layer. @throws {ForbiddenError} */
function assertNotPicScoped(principal) {
  if (!organizationScope(principal).picScoped) return;
  throw new ForbiddenError('A PIC-scoped role may not use requests', [
    { issue: 'requests are outside the PIC permission ceiling (CR-004, CR-014 DEC-P)' },
  ]);
}

/** Oversight: `request:oversee`, or a system-wide role (`CR-014` §10.2 clause 4). */
function oversees(principal) {
  return Boolean(principal?.isSystemWide) || hasPermission(principal, 'request:oversee');
}

/**
 * The rows a caller may see — REQ-REQUEST-015, `CR-014` §10.2.
 *
 *   1. own requests, in any status;
 *   2. requests with an ACTIVE step the caller currently resolves as actor of;
 *   3. requests the caller acted on — recorded in `acted_by_user_id` (F9);
 *   4. with oversight, anyone else's once it has left DRAFT;
 *   5. resubmitted after revision: the current holders of a DECIDE position of
 *      its newest cycle (REQ-REQUEST-018, D10) — so every approver of the
 *      restarted chain can open the request its "resubmitted" update names.
 *
 * A DRAFT is private to its requester (E1): it has no steps, so clauses 2, 3 and
 * 5 cannot reach it either. Merely having held a position grants nothing, and
 * clause 5 lapses with the position. Organization scope applies first; a
 * system-wide role lifts it.
 */
function visibilityWhere(principal, { sequelize = getSequelize() } = {}) {
  const me = sequelize.escape(principal.userId);
  const clauses = [
    { requesterUserId: principal.userId },
    literal(activeActorSql('"Request"', me, undefined, sequelize)),
    literal(actedSql('"Request"', me)),
    literal(resubmittedDecideHolderSql('"Request"', me)),
  ];
  if (oversees(principal)) clauses.push({ status: { [Op.ne]: 'DRAFT' } });
  return { ...scopeFilter(principal), [Op.or]: clauses };
}

/** Clauses 1 and 4 need no query; 2, 3 and 5 are asked of the database. */
async function isVisible(principal, request, { models = getModels(), transaction } = {}) {
  if (!canAccessInstitution(principal, request.institutionId)) return false;
  if (request.requesterUserId === principal.userId) return true;
  if (request.status === 'DRAFT') return false;
  if (oversees(principal)) return true;

  const sequelize = models.Request.sequelize;
  const me = sequelize.escape(principal.userId);
  const [row] = await sequelize.query(
    `SELECT (${activeActorSql('r', me, undefined, sequelize)}
             OR ${actedSql('r', me)}
             OR ${resubmittedDecideHolderSql('r', me)}) AS visible
       FROM public.requests r WHERE r.id = $1`,
    { bind: [request.id], transaction, type: sequelize.QueryTypes.SELECT }
  );
  return Boolean(row?.visible);
}

/** Loads a request the caller can see; anything else is `404` (§12.7). */
async function getVisible(id, principal, { models = getModels(), transaction, lock } = {}) {
  const request = await models.Request.findByPk(id, { transaction, lock });
  if (!request || !(await isVisible(principal, request, { models, transaction }))) {
    throw new NotFoundError('Request not found');
  }
  return request;
}

/**
 * After submission only the destination may change, only on a request that has
 * not ended, and only with `request:update` + `request:oversee` (`CR-014` §10.2,
 * Phase 38). The destination is intent: it never moves a unit (REQ-REQUEST-005),
 * and the change is audited through the model.
 */
function assertDestinationChange(principal, request, body) {
  const fields = Object.keys(body);
  if (fields.some((field) => field !== 'destinationLocationId')) {
    throw new ConflictError('Only the destination can change after submission', [
      { field: 'status', issue: `this request is ${request.status}; it is no longer a draft` },
    ]);
  }
  if (TERMINAL_REQUEST_STATUSES.includes(request.status)) {
    throw new ConflictError('This request has ended', [
      { field: 'status', issue: `a ${request.status} request cannot change` },
    ]);
  }
  if (!hasPermission(principal, 'request:oversee')) {
    throw new ForbiddenError('Changing the destination of a submitted request needs oversight', [
      { issue: 'request:update together with request:oversee is required after submission' },
    ]);
  }
}

/**
 * Only the requester edits: their DRAFT (E3), or their request returned for
 * revision (REQ-REQUEST-018) — the same field rules, plus `assertRevisionLocks`.
 * Visibility is checked first, so an invisible request is still `404`.
 */
function assertOwnEditable(principal, request) {
  if (request.requesterUserId !== principal.userId) {
    throw new ForbiddenError('Only the requester can edit this request', [
      {
        issue:
          'a request is edited only by the person who made it, while it is a draft or returned for revision',
      },
    ]);
  }
  if (!EDITABLE_REQUEST_STATUSES.includes(request.status)) {
    throw new ConflictError('Only a draft or a request returned for revision can be edited', [
      { field: 'status', issue: `this request is ${request.status}` },
    ]);
  }
}

/**
 * What a revision may not change (REQ-REQUEST-018, D5). A returned request
 * resumes on the step snapshot it was submitted with, so nothing that snapshot
 * was chosen by, or resolves its actors from, may move:
 *
 *   category    the snapshot belongs to one (category, requester position)
 *               process; a different category would follow another's steps.
 *   department  fixed when a snapshot step's position is held per department
 *               (KAJUR, TOOLMAN, JURUSAN_TEACHER): changing it would hand that
 *               step to another department's holder. Decided by the FROZEN
 *               steps, never by the requester's position. Otherwise the DRAFT
 *               rules apply unchanged.
 *
 * Sending the stored value again is not a change.
 */
async function assertRevisionLocks(request, body, { models, transaction }) {
  if (body.category !== undefined && body.category !== request.category) {
    throw new ConflictError('The category cannot change during a revision', [
      {
        field: 'category',
        issue:
          'a request returned for revision keeps the process it was submitted under; its category is fixed',
      },
    ]);
  }
  if (body.departmentId === undefined || (body.departmentId ?? null) === (request.departmentId ?? null)) {
    return;
  }
  const steps = await currentSteps(request.id, { models, transaction });
  const bound = steps.find((step) => requiresDepartment(step.actorPositionCode));
  if (bound) {
    throw new ConflictError('The department cannot change during this revision', [
      {
        field: 'departmentId',
        issue: `step ${bound.sequence} is decided by the ${bound.actorPositionCode} of the request's department; the department is fixed`,
      },
    ]);
  }
}

// --- Field rules ------------------------------------------------------------

/**
 * The caller's own, current assignment — REQ-REQUEST-002.
 * @throws {ValidationError}
 */
async function resolveAssignment(principal, assignmentId, { models }) {
  const assignment = await models.PositionAssignment.findByPk(assignmentId);
  const refuse = (issue) =>
    new ValidationError('That requester context cannot be used', [
      { field: 'requesterAssignmentId', issue },
    ]);

  if (!assignment || assignment.userId !== principal.userId) {
    throw refuse('must be one of your own school-position assignments');
  }
  if (!assignment.isCurrent) {
    throw refuse('that assignment has ended; choose one you currently hold');
  }
  if (!assignment.institutionId || !canAccessInstitution(principal, assignment.institutionId)) {
    throw refuse('must belong to your institution');
  }
  return assignment;
}

/** An active department of the request's institution. @throws {ValidationError} */
async function assertDepartment(departmentId, institutionId, { models }) {
  const department = await models.Department.findByPk(departmentId);
  const refuse = (issue) =>
    new ValidationError('That department cannot be used', [{ field: 'departmentId', issue }]);

  if (!department) throw refuse('must reference an existing department');
  if (!department.isActive) throw refuse('must not reference a deactivated department');
  if (department.institutionId !== institutionId) {
    throw refuse("must belong to the request's institution (BR-007)");
  }
}

/**
 * The department a request ends up with — REQ-REQUEST-004.
 *
 *   department-bound context  the context's own department, and nothing else;
 *   any other context         the one supplied (optional), validated;
 *   JURUSAN                   a department is required either way.
 *
 * @param {{positionCode: string, contextDepartmentId: string|null}} context
 * @param {string|null|undefined} supplied undefined = "not in the body"
 * @param {string|null} current the value already stored, for an edit
 */
async function resolveDepartment(context, category, supplied, current, institutionId, { models }) {
  let departmentId;

  if (requiresDepartment(context.positionCode)) {
    if (supplied !== undefined && supplied !== context.contextDepartmentId) {
      throw new ValidationError('The department is fixed by the requester context', [
        {
          field: 'departmentId',
          issue: `a request made as ${context.positionCode} concerns that assignment's department`,
        },
      ]);
    }
    departmentId = context.contextDepartmentId;
  } else {
    departmentId = supplied === undefined ? (current ?? null) : supplied;
    if (supplied) await assertDepartment(supplied, institutionId, { models });
  }

  if (category === DEPARTMENT_CATEGORY && !departmentId) {
    throw new ValidationError('A JURUSAN request must name a department', [
      { field: 'departmentId', issue: 'is required for a JURUSAN request' },
    ]);
  }

  return departmentId;
}

/** An active location of the request's institution. @throws {ValidationError} */
async function assertDestination(locationId, institutionId, { models }) {
  const location = await models.Location.findByPk(locationId);
  const refuse = (issue) =>
    new ValidationError('That destination cannot be used', [
      { field: 'destinationLocationId', issue },
    ]);

  if (!location) throw refuse('must reference an existing location');
  if (!location.isActive) throw refuse('must not reference a deactivated location');
  if (location.institutionId !== institutionId) {
    throw refuse("must belong to the request's institution (BR-007)");
  }
}

/** Item references: an existing unit; a classification this institution may use. */
async function assertItemReferences(body, institutionId, { models }) {
  if (body.measurementUnitId) {
    const unit = await models.MeasurementUnit.findByPk(body.measurementUnitId);
    if (!unit) {
      throw new ValidationError('The measurement unit does not exist', [
        { field: 'measurementUnitId', issue: 'must reference an existing measurement unit' },
      ]);
    }
  }

  if (body.classificationId) {
    // A hint, never required and never a leaf requirement. It must still be a
    // classification this institution can see: global, or its own (BR-019).
    const classification = await models.AssetClassification.findByPk(body.classificationId);
    if (!classification) {
      throw new ValidationError('The classification does not exist', [
        { field: 'classificationId', issue: 'must reference an existing classification' },
      ]);
    }
    if (classification.institutionId && classification.institutionId !== institutionId) {
      throw new ValidationError('That classification belongs to another institution', [
        { field: 'classificationId', issue: 'cannot be used for this request (BR-019)' },
      ]);
    }
  }
}

/**
 * §73 — a line that names a consumable (in `body`, or already on `current`
 * unless `body` clears it). Returns the values the server owns on such a line —
 * its description is the consumable's name and its unit the consumable's unit —
 * or `null` for an asset line.
 *
 * The consumable must be an ACTIVE one of the request's institution. A
 * consumable line takes no classification: that hint is for registering Asset
 * Units, which a consumable line never does.
 */
async function consumableLine(body, current, institutionId, { models, transaction }) {
  const consumableId = body.consumableId !== undefined ? body.consumableId : current?.consumableId;
  if (!consumableId) return null;

  const classificationId =
    body.classificationId !== undefined ? body.classificationId : current?.classificationId;
  if (classificationId) {
    throw new ValidationError('A consumable line has no classification', [
      {
        field: 'classificationId',
        issue: 'a classification is for registering asset units; a consumable is issued from stock',
      },
    ]);
  }

  const consumable = await models.Consumable.findByPk(consumableId, { transaction });
  if (!consumable || consumable.institutionId !== institutionId) {
    throw new ValidationError('The consumable does not exist', [
      { field: 'consumableId', issue: "must reference a consumable of the request's institution" },
    ]);
  }
  // Only a newly named consumable must be active; a line keeps the one it has.
  if (!consumable.isActive && consumableId !== current?.consumableId) {
    throw new ValidationError('The consumable is inactive', [
      { field: 'consumableId', issue: 'must reference an active consumable' },
    ]);
  }
  return {
    consumableId: consumable.id,
    description: consumable.name,
    measurementUnitId: consumable.measurementUnitId,
  };
}

// --- Reads ------------------------------------------------------------------

const FILTERS = {
  status: (value) => equals('status', value),
  category: (value) => equals('category', value),
  departmentId: (value) => equals('departmentId', value),
};

const SORTABLE = ['requestNumber', 'createdAt', 'updatedAt', 'status', 'category', 'title'];

async function list(params, principal, { models = getModels() } = {}) {
  assertNotPicScoped(principal);

  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [['createdAt', 'DESC']],
  });

  const visible = visibilityWhere(principal);
  const mine = params.mine ? { requesterUserId: principal.userId } : {};
  options.where = {
    [Op.and]: [
      options.where,
      visible,
      mine,
      awaitingWhere(params, principal),
      // P6 (§64.6): `updated=me` — involved, with an unseen update.
      requestUpdates.updatedWhere(params, principal),
    ],
  };

  const { rows, pagination } = await paginate(models.Request, options, {
    include: [...HEADER_INCLUDE, { association: 'items', attributes: ['id'] }],
    distinct: true,
  });

  const progress = await progressFor(
    rows.map((row) => row.id),
    { models }
  );
  // P5 (§64.5): what each row needs of the caller, whichever list this is.
  const needed = await actionsNeeded.forRequests(rows, principal, {
    models,
    blockersFor: (request) => submitBlockers(request, { models }),
  });
  // P6 (§64.6): what changed since the caller last looked — independent of
  // the above; a row may have either, both or neither.
  const unseen = await requestUpdates.unseenFor(
    rows.map((row) => row.id),
    principal,
    { models }
  );
  return {
    rows: rows.map((row) => ({
      ...serialize(row),
      actionsNeeded: needed[row.id] ?? [],
      updates: {
        total: unseen[row.id]?.events.length ?? 0,
        events: (unseen[row.id]?.events ?? []).slice(0, requestUpdates.ROW_LIMIT),
      },
      itemCount: (row.items ?? []).length,
      // Phase 41 (D41-6): received / required, from receipts only.
      quantityRequired: progress[row.id]?.required ?? 0,
      quantityReceived: progress[row.id]?.received ?? 0,
    })),
    pagination,
  };
}

/**
 * `GET /requests/attention` — P5 + P6 (§64.5, §64.6): the two navigation
 * counts, each derived on its own. `actionNeeded` is exactly the total of
 * `awaiting=me`; `updated` exactly that of `updated=me`.
 */
async function attention(principal, { models = getModels() } = {}) {
  assertNotPicScoped(principal);
  return requestUpdates.counts(principal, {
    models,
    visibleWhere: visibilityWhere(principal),
    actionNeededWhere: literal(actionsNeeded.actionNeededSql('"Request"', principal)),
  });
}

/**
 * `POST /requests/:id/view` — P6 (§64.6): records that the caller has seen this
 * request now. Only this user and this request; any visible request may be
 * marked, and anything else is `404` like every read.
 */
async function markViewed(id, principal, { models = getModels() } = {}) {
  assertNotPicScoped(principal);
  await getVisible(id, principal, { models });
  await requestUpdates.markViewed(id, principal, { models });
}

/** Required and received per request, for a page of the list (D41-6). */
async function progressFor(requestIds, { models = getModels() } = {}) {
  if (requestIds.length === 0) return {};
  const sequelize = models.Request.sequelize;
  const rows = await sequelize.query(
    `SELECT ri.request_id,
            SUM(ri.quantity_requested - ri.quantity_cancelled)::int AS required,
            COALESCE(SUM(received.count + issued.quantity), 0)::int AS received
       FROM public.request_items ri
       LEFT JOIN LATERAL (
         SELECT count(*) AS count
           FROM public.request_item_units l
           JOIN public.request_item_unit_receipts r
             ON r.request_item_unit_id = l.id AND r.reversed_at IS NULL
          WHERE l.request_item_id = ri.id
       ) received ON true
       -- §73: a consumable line counts what was issued against it.
       LEFT JOIN LATERAL (
         SELECT COALESCE(-SUM(m.quantity), 0) AS quantity
           FROM public.consumable_stock_movements m
          WHERE m.request_item_id = ri.id AND m.movement_type = 'ISSUE'
       ) issued ON true
      WHERE ri.request_id = ANY($1::uuid[])
      GROUP BY ri.request_id`,
    { bind: [requestIds], type: sequelize.QueryTypes.SELECT }
  );
  return Object.fromEntries(
    rows.map((row) => [row.request_id, { required: row.required, received: row.received }])
  );
}

/**
 * `awaiting=me` — "Needs my action" (P5, §64.5, REQ-REQUEST-016): any action the
 * caller needs to take now (`requestActionsNeeded.js`). Its step part is decision
 * F6 unchanged — an ACTIVE step the caller currently resolves as actor of, of a
 * type they hold the permission for; `request:oversee` never substitutes for
 * being the actor. P5 adds SUBMIT, RECEIVE and CLOSE.
 */
function awaitingWhere(params, principal, { sequelize = getSequelize() } = {}) {
  if (params.awaiting !== 'me') return {};
  return literal(actionsNeeded.actionNeededSql('"Request"', principal, { sequelize }));
}

const PERSON_NAME = (user) => (user ? `${user.firstName} ${user.lastName}`.trim() : null);

/**
 * One step for the detail: its copied definition, its state, who acted and in
 * which capacity, and — while ACTIVE — who can act now, live (REQ-WF-005). A
 * vacant step says so (`vacant: true`); it is never skipped (`BR-030`).
 */
async function serializeStep(step, request, principal, { models }) {
  const active = step.state === 'ACTIVE';
  const holders = active ? await resolveHolders(step, request, { models }) : [];
  const permission = STEP_ACTION_PERMISSION[step.stepType];

  return {
    id: step.id,
    cycle: step.cycle,
    sequence: step.sequence,
    stepType: step.stepType,
    actorPositionCode: step.actorPositionCode,
    procurementMode: step.procurementMode ?? null,
    skipIfRequesterIsActor: step.skipIfRequesterIsActor,
    state: step.state,
    skipReason: step.skipReason ?? null,
    comment: step.comment ?? null,
    activatedAt: step.activatedAt ?? null,
    completedAt: step.completedAt ?? null,
    actedByUserId: step.actedByUserId ?? null,
    actedBy: serializeUser(step.actedBy),
    actedAs: step.actedAs
      ? {
          id: step.actedAs.id,
          positionCode: step.actedAs.positionCode,
          department: serializeDepartment(step.actedAs.department),
        }
      : null,
    resolvedActors: holders.map((holder) => ({
      userId: holder.userId,
      name: PERSON_NAME(holder.user),
    })),
    vacant: active && holders.length === 0,
    // Server-decided, so the screen never offers an action the API refuses:
    // actor AND permission, never oversight (`DEC-J`).
    canAct:
      active &&
      Boolean(permission) &&
      hasPermission(principal, permission) &&
      holders.some((holder) => holder.userId === principal.userId),
  };
}

/** What the caller may do to the request itself, per the documented rules. */
function availableActions(
  request,
  principal,
  { anyRegistered = false, figures = [], issuable = false } = {}
) {
  const own = request.requesterUserId === principal.userId;
  const can = (code) => hasPermission(principal, code);
  const overseer = can('request:oversee');
  const terminal = TERMINAL_REQUEST_STATUSES.includes(request.status);

  const revising = request.status === 'REVISION_REQUESTED';

  return {
    edit: own && EDITABLE_REQUEST_STATUSES.includes(request.status) && can('request:update'),
    submit: own && request.status === 'DRAFT' && can('request:submit'),
    // REQ-REQUEST-018: the same submit action, on the frozen snapshot.
    resubmit: own && revising && can('request:submit'),
    discard: own && request.status === 'DRAFT' && can('request:cancel'),
    // Phase 40 (scenario 6d, D9): once any unit is linked, cancel is refused.
    // A request returned for revision cancels as a SUBMITTED one does (D3).
    cancel:
      !anyRegistered &&
      can('request:cancel') &&
      ((own && ['SUBMITTED', 'REVISION_REQUESTED'].includes(request.status)) ||
        (overseer &&
          ['SUBMITTED', 'REVISION_REQUESTED', 'APPROVED'].includes(request.status))),
    changeDestination: request.status !== 'DRAFT' && !terminal && overseer && can('request:update'),
    // Phase 41: the requester only, never oversight (Q2a) — and only when a
    // registered unit can be received now.
    receive:
      own &&
      can('request:receive') &&
      OPEN_FULFILMENT_STATUSES.includes(request.status) &&
      figures.some((f) => f.pending > 0),
    // Phase 41 (D41-2, D41-8): visibility + the code, and only when a close
    // would cancel something.
    close:
      can('request:close') &&
      OPEN_FULFILMENT_STATUSES.includes(request.status) &&
      figures.some((f) => f.cancellableByClose > 0),
    // §73: whoever manages consumable stock, while a consumable line still
    // needs some — never on submission or approval alone.
    issue:
      can('consumable:manage-stock') &&
      OPEN_FULFILMENT_STATUSES.includes(request.status) &&
      issuable,
  };
}

const STEP_INCLUDE = [
  { association: 'actedBy', attributes: PERSON },
  {
    association: 'actedAs',
    attributes: ['id', 'positionCode'],
    include: [{ association: 'department', attributes: DEPARTMENT }],
  },
];

/** A revision decision as the detail shows it: who, as what, when, why, and per item. */
function serializeRevision(step, notes) {
  return {
    stepId: step.id,
    cycle: step.cycle,
    sequence: step.sequence,
    actorPositionCode: step.actorPositionCode,
    requestedBy: serializeUser(step.actedBy),
    actedAs: step.actedAs
      ? {
          id: step.actedAs.id,
          positionCode: step.actedAs.positionCode,
          department: serializeDepartment(step.actedAs.department),
        }
      : null,
    requestedAt: step.completedAt,
    reason: step.comment,
    // The live item id is null once the requester deleted that item (D6); the
    // snapshot keeps the note meaningful.
    itemNotes: notes.map((note) => ({
      id: note.id,
      requestItemId: note.requestItemId ?? null,
      lineNo: note.lineNo,
      itemDescription: note.itemDescription,
      note: note.note,
    })),
  };
}

/**
 * REQ-REQUEST-018: the revision history the detail carries beside `steps`.
 *
 *   revision        the decision that returned the CURRENT cycle — present while
 *                   the request is returned (and after it ended that way)
 *   previousCycles  every earlier cycle, oldest first, exactly as decided, each
 *                   with the revision that ended it
 *
 * A HISTORICAL reader: it spans cycles on purpose. Nothing here is actionable.
 */
async function revisionHistoryFor(request, current, principal, { models }) {
  const cycle = current[0]?.cycle ?? null;
  const earlier =
    cycle && cycle > 1
      ? await models.RequestStep.findAll({
          where: { requestId: request.id, cycle: { [Op.lt]: cycle } },
          include: STEP_INCLUDE,
          order: [
            ['cycle', 'ASC'],
            ['sequence', 'ASC'],
          ],
        })
      : [];

  const returned = [...earlier, ...current].filter((step) => step.state === 'RETURNED');
  const notes =
    returned.length > 0
      ? await models.RequestStepItemNote.findAll({
          where: { requestStepId: returned.map((step) => step.id) },
          order: [
            ['lineNo', 'ASC'],
            ['createdAt', 'ASC'],
          ],
        })
      : [];
  const notesOf = (step) => notes.filter((note) => note.requestStepId === step.id);
  const revisionOf = (steps) => {
    const step = steps.find((entry) => entry.state === 'RETURNED');
    return step ? serializeRevision(step, notesOf(step)) : null;
  };

  const cycles = new Map();
  for (const step of earlier) {
    if (!cycles.has(step.cycle)) cycles.set(step.cycle, []);
    cycles.get(step.cycle).push(step);
  }

  return {
    // When the current cycle began: the submission, or the resubmission.
    cycleStartedAt: current[0]?.createdAt ?? null,
    revision: revisionOf(current),
    previousCycles: await Promise.all(
      [...cycles].map(async ([number, steps]) => ({
        cycle: number,
        startedAt: steps[0].createdAt,
        steps: await Promise.all(
          steps.map((step) => serializeStep(step, request, principal, { models }))
        ),
        revision: revisionOf(steps),
      }))
    ),
  };
}

async function detail(id, principal, { models = getModels() } = {}) {
  assertNotPicScoped(principal);
  await getVisible(id, principal, { models });

  const request = await models.Request.findByPk(id, { include: HEADER_INCLUDE });
  const items = await models.RequestItem.findAll({
    where: { requestId: id },
    include: ITEM_INCLUDE,
    order: [['lineNo', 'ASC']],
  });
  // REQ-REQUEST-018 (D8): `steps` is the CURRENT cycle only — what every
  // action, button and Action Needed reads. Earlier cycles are history.
  const steps = await currentSteps(id, { models, include: STEP_INCLUDE });
  const cycle = steps[0]?.cycle ?? null;

  const serializedSteps = await Promise.all(
    steps.map((step) => serializeStep(step, request, principal, { models }))
  );
  const revisionHistory = await revisionHistoryFor(request, steps, principal, { models });
  const counts = await fulfilmentCounts(
    items.map((item) => item.id),
    { models }
  );
  const figures = items.map((item) => itemFigures(item, counts[item.id]));
  const anyRegistered = figures.some((f) => f.registered > 0);
  const issuable = items.some(
    (item, index) => item.consumableId && figures[index].notYetReceived > 0
  );
  const closeEvents = await models.RequestCloseEvent.findAll({
    where: { requestId: id },
    include: [{ association: 'closer', attributes: PERSON }],
    order: [
      ['closedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const registerStep = serializedSteps.find((step) => step.stepType === 'REGISTER');
  // Phase 39 (H1): the actor of ANY active step may add documents — upload
  // only, never that step's own action.
  const activeActor = serializedSteps.some(
    (step) =>
      step.state === 'ACTIVE' &&
      step.resolvedActors.some((actor) => actor.userId === principal.userId)
  );

  const actions = {
    ...availableActions(request, principal, { anyRegistered, figures, issuable }),
    uploadDocument: mayUpload(principal, request, { activeActor }),
  };
  const blockers =
    actions.submit || actions.resubmit ? await submitBlockers(request, { models }) : null;

  return {
    ...serialize(request, { items, counts }),
    approvedAt: request.approvedAt ?? null,
    closedAt: request.closedAt ?? null,
    closeReason: request.closeReason ?? null,
    steps: serializedSteps,
    // REQ-REQUEST-018: which approval cycle `steps` is, the revision that ended
    // it (while the request is returned), and every earlier cycle as decided.
    cycle,
    ...revisionHistory,
    // Phase 41: every successful close of the remainder, oldest first.
    closeEvents: closeEvents.map((event) => ({
      id: event.id,
      reason: event.reason,
      closedAt: event.closedAt,
      closedBy: serializeUser(event.closer),
    })),
    // Migration 057: the requester's receipt confirmations, oldest first —
    // superseded ones included; they are evidence.
    receiptConfirmations: await receiptConfirmations.listForRequest(id, { models }),
    actions,
    // P1 (§64): everything that would refuse a submission now — the same
    // checks `POST /submit` makes, for whoever may submit (or resubmit, on the
    // frozen snapshot). Informational; the submission re-checks. Absent when
    // neither is offered.
    ...(blockers ? { submitBlockers: blockers } : {}),
    // P5 (§64.5): the caller's needed actions — from the same values the
    // buttons are offered on.
    actionsNeeded: actionsNeeded.fromDetail({
      actions,
      steps: serializedSteps,
      figures,
      submitBlockers: blockers ?? [],
    }),
    // P6 (§64.6): unseen updates since the caller's last view. Reading the
    // detail marks nothing seen — `POST /requests/:id/view` does.
    unseenUpdates: await requestUpdates.forDetail(request, principal, { models }),
    // Phase 40: what the institution's inventory code format asks a registrar
    // to type — the hint `GET /assets/:id` and `GET /contract-items/:id` give.
    // Only for whoever can register now; nobody else needs it.
    ...(registerStep?.canAct
      ? {
          unitRegistration: {
            ...registrationHint(await models.Institution.findByPk(request.institutionId)),
            // P3 (§64.3): a department-bound REGISTER step registers for the
            // request's department only — the dialog shows it fixed.
            departmentFixed: requiresDepartment(registerStep.actorPositionCode),
          },
        }
      : {}),
  };
}

// --- Registration counts (Phase 40) -------------------------------------------

/**
 * Registered = the number of registration links per item (`CR-014` Phase 40
 * D4). Never filtered by the linked unit's current `is_active` or lifecycle
 * state: a link is a historical fact.
 *
 * @returns {Promise<Record<string, number>>} item id → count (absent = 0)
 */
async function registeredCounts(itemIds, { models = getModels(), transaction } = {}) {
  if (itemIds.length === 0) return {};
  const rows = await models.RequestItemUnit.findAll({
    attributes: ['requestItemId', [fn('COUNT', col('id')), 'count']],
    where: { requestItemId: itemIds },
    group: ['requestItemId'],
    raw: true,
    transaction,
  });
  return Object.fromEntries(rows.map((row) => [row.requestItemId, Number(row.count)]));
}

/**
 * Registered / received / pending / blocked per item (Phase 41, §60.3), in one
 * query. Received counts only ACTIVE receipts; pending and blocked split the
 * rest by whether the unit can be received now (D41-1 b).
 *
 * @returns {Promise<Record<string, {registered: number, received: number, pending: number, blocked: number}>>}
 */
async function fulfilmentCounts(itemIds, { models = getModels(), transaction } = {}) {
  if (itemIds.length === 0) return {};
  const sequelize = models.Request.sequelize;
  const rows = await sequelize.query(
    `SELECT l.request_item_id AS item_id, u.is_active, u.lifecycle_state,
            (r.id IS NOT NULL) AS received
       FROM public.request_item_units l
       JOIN public.asset_units u ON u.id = l.asset_unit_id
       LEFT JOIN public.request_item_unit_receipts r
         ON r.request_item_unit_id = l.id AND r.reversed_at IS NULL
      WHERE l.request_item_id = ANY($1::uuid[])`,
    { bind: [itemIds], transaction, type: sequelize.QueryTypes.SELECT }
  );

  const counts = {};
  for (const row of rows) {
    const entry = (counts[row.item_id] ??= { registered: 0, received: 0, pending: 0, blocked: 0 });
    entry.registered += 1;
    if (row.received) entry.received += 1;
    else if (isReceivableUnit({ isActive: row.is_active, lifecycleState: row.lifecycle_state })) {
      entry.pending += 1;
    } else entry.blocked += 1;
  }

  // §73: a consumable line has no links; what was ISSUED is both its handed-over
  // and its received quantity, nothing is pending, and a close cancels the rest.
  const issued = await issuedByItem(itemIds, { models, transaction });
  for (const [itemId, quantity] of Object.entries(issued)) {
    counts[itemId] = { registered: quantity, received: quantity, pending: 0, blocked: 0 };
  }
  return counts;
}

/** §73: whether any consumable has been issued against the request. */
async function hasIssue(requestId, { models = getModels(), transaction } = {}) {
  const movement = await models.ConsumableStockMovement.findOne({
    attributes: ['id'],
    where: { movementType: 'ISSUE' },
    include: [{ association: 'requestItem', attributes: [], where: { requestId }, required: true }],
    transaction,
  });
  return Boolean(movement);
}

/** Whether any unit is linked to any item of the request (scenario 6d). */
async function hasRegistration(requestId, { models = getModels(), transaction } = {}) {
  const link = await models.RequestItemUnit.findOne({
    attributes: ['id'],
    include: [{ association: 'item', attributes: [], where: { requestId }, required: true }],
    transaction,
  });
  return Boolean(link);
}

/**
 * The Request a unit was registered against, for the unit detail (Phase 40 D7)
 * — or `null`. `null` also whenever the caller could not open that Request
 * through `GET /requests/:id`: no `request:read`, PIC-scoped, or not visible
 * (REQ-REQUEST-015). The unit detail never reveals a Request.
 */
async function requestItemReferenceFor(assetUnitId, principal, { models = getModels() } = {}) {
  if (!hasPermission(principal, 'request:read') || organizationScope(principal).picScoped) {
    return null;
  }
  const link = await models.RequestItemUnit.findOne({
    where: { assetUnitId },
    include: [{ association: 'item', include: [{ association: 'request' }] }],
  });
  const request = link?.item?.request;
  if (!request || !(await isVisible(principal, request, { models }))) return null;
  return {
    requestId: request.id,
    requestNumber: request.requestNumber,
    itemId: link.item.id,
    description: link.item.description,
  };
}

/**
 * `GET /requests/guidance` — for each of the caller's current assignments: the
 * typical categories, the department rule, default destinations, and whether an
 * active workflow exists per category. INFORMATIONAL: nothing refuses on it.
 *
 * Default destinations (REQ-REQUEST-005, REQ-REQUEST-023): the caller's active
 * Location PIC rooms of that institution; when there are none and the context is
 * a teacher's, the institution's active Teacher Storage Room, if configured.
 * `defaultDestinationSource` says which. Category plays no part. A default
 * only — the server never fills in a destination.
 */
async function guidance(principal, { models = getModels() } = {}) {
  assertNotPicScoped(principal);

  const assignments = await models.PositionAssignment.findAll({
    where: { userId: principal.userId, isCurrent: true },
    include: [{ association: 'department', attributes: DEPARTMENT }],
    order: [['assignedAt', 'ASC']],
  });

  // The one read of Location PIC (`CR-014` §4.3): a default only.
  const picRooms = await models.LocationPicAssignment.findAll({
    where: { userId: principal.userId, isCurrent: true },
    attributes: ['locationId'],
  });
  const rooms = picRooms.length
    ? await models.Location.findAll({
        where: { id: picRooms.map((row) => row.locationId), isActive: true },
        attributes: ['id', 'name', 'institutionId'],
        order: [['name', 'ASC']],
      })
    : [];

  // REQ-REQUEST-023: each institution's Teacher Storage Room, when active.
  const institutionIds = [...new Set(assignments.map((row) => row.institutionId).filter(Boolean))];
  const storageRooms = new Map();
  if (institutionIds.length) {
    const institutions = await models.Institution.findAll({
      where: { id: institutionIds },
      attributes: ['id'],
      include: [
        {
          association: 'teacherStorageLocation',
          attributes: ['id', 'name'],
          where: { isActive: true },
          required: true,
        },
      ],
    });
    for (const institution of institutions) {
      const room = institution.teacherStorageLocation;
      storageRooms.set(institution.id, { id: room.id, name: room.name });
    }
  }

  const contexts = [];
  for (const assignment of assignments) {
    if (!assignment.institutionId) continue;

    const active = await models.WorkflowDefinition.findAll({
      where: {
        institutionId: assignment.institutionId,
        requesterPositionCode: assignment.positionCode,
        status: 'ACTIVE',
      },
      attributes: ['category'],
    });
    const configured = new Set(active.map((row) => row.category));

    const bound = requiresDepartment(assignment.positionCode);
    const picDestinations = rooms
      .filter((room) => room.institutionId === assignment.institutionId)
      .map((room) => ({ id: room.id, name: room.name }));
    const storageRoom = isTeacherPosition(assignment.positionCode)
      ? storageRooms.get(assignment.institutionId)
      : undefined;
    let defaultDestinationSource = null;
    if (picDestinations.length) defaultDestinationSource = 'LOCATION_PIC';
    else if (storageRoom) defaultDestinationSource = 'TEACHER_STORAGE_ROOM';

    contexts.push({
      assignmentId: assignment.id,
      institutionId: assignment.institutionId,
      positionCode: assignment.positionCode,
      department: serializeDepartment(assignment.department),
      departmentRule: bound ? 'LOCKED' : 'OPTIONAL',
      typicalCategories: [...typicalCategoriesFor(assignment.positionCode)],
      categories: REQUEST_CATEGORIES.map((category) => ({
        category,
        typical: typicalCategoriesFor(assignment.positionCode).includes(category),
        // Enforced (UAT decision, 2026-09-28): the form offers only these.
        eligible: isEligibleCategory(assignment.positionCode, category),
        processConfigured: configured.has(category),
        departmentRequired: bound || category === DEPARTMENT_CATEGORY,
      })),
      defaultDestinations:
        defaultDestinationSource === 'TEACHER_STORAGE_ROOM' ? [storageRoom] : picDestinations,
      defaultDestinationSource,
    });
  }

  return { contexts };
}

// --- Writes -----------------------------------------------------------------

/** `POST /requests` — a DRAFT with its number (E7). */
async function create(body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);

  const assignment = await resolveAssignment(principal, body.requesterAssignmentId, { models });
  const institutionId = assignment.institutionId;
  // The one enforced category rule: some contexts may not request some
  // categories at all (`requestGuidance.js`).
  assertEligibleCategory(assignment.positionCode, body.category);
  const context = {
    positionCode: assignment.positionCode,
    contextDepartmentId: assignment.departmentId ?? null,
  };

  const departmentId = await resolveDepartment(
    context,
    body.category,
    body.departmentId,
    null,
    institutionId,
    { models }
  );
  if (body.destinationLocationId) {
    await assertDestination(body.destinationLocationId, institutionId, { models });
  }

  const id = await withTransaction(
    async (transaction) => {
      const requestNumber = await allocateRequestNumber(institutionId, {
        sequelize,
        transaction,
      });

      const request = await models.Request.create(
        {
          institutionId,
          requestNumber,
          category: body.category,
          title: body.title,
          justification: body.justification ?? null,
          requesterUserId: principal.userId,
          requesterAssignmentId: assignment.id,
          requesterPositionCode: context.positionCode,
          requesterDepartmentId: context.contextDepartmentId,
          departmentId,
          destinationLocationId: body.destinationLocationId ?? null,
          neededBy: body.neededBy ?? null,
          status: 'DRAFT',
          createdBy: principal.userId,
          updatedBy: principal.userId,
        },
        { transaction }
      );
      return request.id;
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

/**
 * Whether a PATCH is the requester editing their own request — a DRAFT (E3), or
 * one returned for revision (REQ-REQUEST-018) — rather than oversight changing
 * the destination of a submitted one. A DRAFT is only ever its requester's.
 */
const isRequesterEdit = (principal, request) =>
  request.status === 'DRAFT' ||
  (EDITABLE_REQUEST_STATUSES.includes(request.status) &&
    request.requesterUserId === principal.userId);

/**
 * `PATCH /requests/:id` — the requester's own DRAFT, every field but the context
 * (E3); their request returned for revision, the same but for the revision locks
 * (REQ-REQUEST-018).
 */
async function update(id, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);
  const found = await getVisible(id, principal, { models });
  if (isRequesterEdit(principal, found)) assertOwnEditable(principal, found);
  else assertDestinationChange(principal, found, body);

  await withTransaction(
    async (transaction) => {
      const request = await getVisible(id, principal, {
        models,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      // After submission: the destination only, with oversight (Phase 38).
      if (!isRequesterEdit(principal, request)) {
        assertDestinationChange(principal, request, body);
        if (body.destinationLocationId) {
          await assertDestination(body.destinationLocationId, request.institutionId, { models });
        }
        await request.update(
          { destinationLocationId: body.destinationLocationId, updatedBy: principal.userId },
          { transaction }
        );
        return;
      }

      assertOwnEditable(principal, request);
      if (request.status === 'REVISION_REQUESTED') {
        await assertRevisionLocks(request, body, { models, transaction });
      }

      // The snapshot, not the live assignment: it may have ended since (E9).
      const context = {
        positionCode: request.requesterPositionCode,
        contextDepartmentId: request.requesterDepartmentId ?? null,
      };
      const category = body.category ?? request.category;
      // Only a CHANGE of category is checked here: a draft saved before the rule
      // existed stays editable, and submission refuses it.
      if (body.category !== undefined) {
        assertEligibleCategory(request.requesterPositionCode, body.category);
      }

      const departmentId = await resolveDepartment(
        context,
        category,
        body.departmentId,
        request.departmentId,
        request.institutionId,
        { models }
      );
      if (body.destinationLocationId) {
        await assertDestination(body.destinationLocationId, request.institutionId, { models });
      }

      const changes = { departmentId, updatedBy: principal.userId };
      for (const field of [
        'category',
        'title',
        'justification',
        'destinationLocationId',
        'neededBy',
      ]) {
        if (body[field] !== undefined) changes[field] = body[field];
      }

      await request.update(changes, { transaction });
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

/** Loads an item and its request for a write; `404` when the request is invisible. */
async function lockItemForWrite(itemId, principal, { models, transaction }) {
  const item = await models.RequestItem.findByPk(itemId, { transaction });
  if (!item) throw new NotFoundError('Request item not found');

  const request = await models.Request.findByPk(item.requestId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!request || !(await isVisible(principal, request, { models, transaction }))) {
    throw new NotFoundError('Request item not found');
  }
  // Items change in a DRAFT and during a revision alike (REQ-REQUEST-018).
  assertOwnEditable(principal, request);

  return { item, request };
}

const ITEM_FIELDS = [
  'description',
  'specification',
  // REQ-REQUEST-019 — normalized by the schema; null clears it.
  'referenceUrl',
  'quantityRequested',
  'measurementUnitId',
  'estimatedUnitPrice',
  'classificationId',
  // §73 — a consumable line; its description and unit follow the consumable.
  'consumableId',
];

/**
 * `POST /requests/:id/items` — the next line of the requester's own DRAFT, or of
 * their request returned for revision (REQ-REQUEST-018).
 */
async function addItem(requestId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);
  const found = await getVisible(requestId, principal, { models });
  assertOwnEditable(principal, found);
  await assertItemReferences(body, found.institutionId, { models });
  const consumable = await consumableLine(body, null, found.institutionId, { models });
  if (!consumable && !body.description) {
    throw new ValidationError('A description is required', [
      { field: 'description', issue: 'is required for an asset line' },
    ]);
  }

  const itemId = await withTransaction(
    async (transaction) => {
      const request = await getVisible(requestId, principal, {
        models,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      assertOwnEditable(principal, request);

      const highest = await models.RequestItem.max('lineNo', {
        where: { requestId },
        transaction,
      });

      const values = { requestId, lineNo: (highest ?? 0) + 1 };
      for (const field of ITEM_FIELDS) values[field] = body[field] ?? null;
      if (consumable) Object.assign(values, consumable);

      const item = await models.RequestItem.create(values, { transaction });
      await request.update({ updatedBy: principal.userId }, { transaction });
      return item.id;
    },
    { sequelize }
  );

  return getItem(itemId, { models });
}

/** `PATCH /request-items/:id`. `quantityCancelled` is not writable (Phase 41). */
async function updateItem(itemId, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);

  await withTransaction(
    async (transaction) => {
      const { item, request } = await lockItemForWrite(itemId, principal, { models, transaction });
      await assertItemReferences(body, request.institutionId, { models });
      const consumable = await consumableLine(body, item, request.institutionId, {
        models,
        transaction,
      });

      const changes = {};
      for (const field of ITEM_FIELDS) if (body[field] !== undefined) changes[field] = body[field];
      if (consumable) Object.assign(changes, consumable);
      await item.update(changes, { transaction });
    },
    { sequelize }
  );

  return getItem(itemId, { models });
}

/**
 * `DELETE /request-items/:id` — removes a line of the requester's own DRAFT and
 * renumbers the rest 1..n (E8). Lines are shifted down one at a time in
 * ascending order, so `uq_request_items_line` never sees two rows on one number,
 * and each move is audited.
 *
 * During a revision (REQ-REQUEST-018, D6) a revision note may name the item.
 * The note is history and stays: its live link is detached first — one audited
 * update per note — and its snapshot of line and description keeps it readable.
 */
async function deleteItem(itemId, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);

  await withTransaction(
    async (transaction) => {
      const { item, request } = await lockItemForWrite(itemId, principal, { models, transaction });

      const notes = await models.RequestStepItemNote.findAll({
        where: { requestItemId: item.id },
        transaction,
      });
      for (const note of notes) await note.update({ requestItemId: null }, { transaction });

      await item.destroy({ transaction });

      const later = await models.RequestItem.findAll({
        where: { requestId: request.id, lineNo: { [Op.gt]: item.lineNo } },
        order: [['lineNo', 'ASC']],
        transaction,
      });
      for (const row of later) await row.update({ lineNo: row.lineNo - 1 }, { transaction });

      await request.update({ updatedBy: principal.userId }, { transaction });
    },
    { sequelize }
  );
}

async function getItem(itemId, { models = getModels() } = {}) {
  const item = await models.RequestItem.findByPk(itemId, { include: ITEM_INCLUDE });
  return serializeItem(item);
}

module.exports = {
  list,
  attention,
  markViewed,
  detail,
  guidance,
  create,
  update,
  addItem,
  updateItem,
  deleteItem,
  visibilityWhere,
  isVisible,
  getVisible,
  assertOwnEditable,
  assertNotPicScoped,
  oversees,
  serialize,
  serializeItem,
  registeredCounts,
  fulfilmentCounts,
  hasRegistration,
  hasIssue,
  availableActions,
  requestItemReferenceFor,
};
