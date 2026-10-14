'use strict';

/**
 * Workflow definitions — Phase 36 (`CR-014` §6.3 – §6.5), REQ-WF-001 – REQ-WF-004,
 * REQ-WF-006, `06-api.md` §12.2.
 *
 * CONFIGURATION ONLY. Nothing here creates a Request, runs a step, or asks who
 * holds a position. A definition says which position acts at each step; turning
 * that into a person — and waiting when nobody holds it — is Phase 38.
 *
 * ── Lifecycle ──────────────────────────────────────────────────────────────
 *
 *     DRAFT ──publish──▶ ACTIVE ──(next version published)──▶ RETIRED
 *
 * Only a DRAFT changes. An ACTIVE or RETIRED definition is immutable, and so are
 * its steps: changing the process means a new version (REQ-WF-003). Per key —
 * (institution, category, requester position) — there is at most one ACTIVE
 * (`uq_wf_def_active`) and at most one DRAFT (`uq_wf_def_draft`, decision D2).
 * No endpoint deletes a definition (D2).
 *
 * ── Concurrency ────────────────────────────────────────────────────────────
 *
 * Every write that depends on the other versions of a key — creating a draft,
 * creating a version, publishing — first takes a transaction-scoped advisory
 * lock on the key, then re-reads. Two concurrent publishes therefore run one
 * after the other, and the second sees the first's result. The two partial
 * unique indexes remain the backstop.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 *
 * Institution-scoped like every other record: out of scope answers `404`. A
 * system-wide creator must name the institution; an institution-scoped one gets
 * their own and may name no other (decision D4). A PIC-scoped caller is refused
 * here as well as by the `CR-004` ceiling, as in `domain/positionAssignments.js`.
 */

const { Op } = require('sequelize');

const { getModels } = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { withTransaction } = require('../db/withTransaction');
const { ValidationError, ConflictError, ForbiddenError, NotFoundError } = require('../errors');
const { organizationScope } = require('../auth/principal');
const { toFindOptions, paginate } = require('../query/listQuery');
const { equals } = require('../query/filtering');
const { scopeFilter, assertCanAccess, assertCanAssignInstitution } = require('./scope');
const { serializeUser } = require('./picAssignments');
const {
  WORKFLOW_TEMPLATES,
  templateOf,
  publicationIssues,
  categoryEligibilityIssue,
} = require('./workflowShape');
const { POSITION_CODES } = require('./schoolPositions');
const { eligibleCategoriesFor } = require('./requestGuidance');

const PERSON = ['id', 'username', 'firstName', 'lastName'];

const INCLUDE = [
  { association: 'steps' },
  { association: 'institution', attributes: ['id', 'name', 'code'] },
  { association: 'creator', attributes: PERSON },
  { association: 'publisher', attributes: PERSON },
];

function serializeStep(step) {
  return {
    id: step.id,
    sequence: step.sequence,
    stepType: step.stepType,
    actorPositionCode: step.actorPositionCode ?? null,
    procurementMode: step.procurementMode ?? null,
    skipIfRequesterIsActor: step.skipIfRequesterIsActor,
  };
}

const sortedSteps = (definition) =>
  [...(definition.steps ?? [])].sort((a, b) => a.sequence - b.sequence);

/**
 * `publishIssues` — for a DRAFT only — is exactly what `publish` would refuse
 * right now, so the editor can show the result per step before asking for
 * confirmation (`07-ui.md` §5.10) without a second copy of the rules in the
 * client. Absent for published versions, which have nothing left to pass.
 */
function serialize(definition, { withSteps = true } = {}) {
  const steps = sortedSteps(definition).map(serializeStep);

  return {
    id: definition.id,
    institutionId: definition.institutionId,
    institution: definition.institution
      ? {
          id: definition.institution.id,
          name: definition.institution.name,
          code: definition.institution.code,
        }
      : undefined,
    category: definition.category,
    requesterPositionCode: definition.requesterPositionCode,
    version: definition.version,
    status: definition.status,
    publishedAt: definition.publishedAt ?? null,
    publishedBy: definition.publishedBy ?? null,
    publisher: serializeUser(definition.publisher),
    retiredAt: definition.retiredAt ?? null,
    createdBy: definition.createdBy ?? null,
    creator: serializeUser(definition.creator),
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    ...(withSteps ? { steps } : { stepCount: steps.length }),
    ...(definition.status === 'DRAFT'
      ? { publishIssues: publicationIssues(definition, steps) }
      : {}),
  };
}

/** `CR-004` ceiling, second layer. @throws {ForbiddenError} */
function assertNotPicScoped(principal) {
  if (!organizationScope(principal).picScoped) return;
  throw new ForbiddenError('A PIC-scoped role may not configure workflows', [
    { issue: 'workflow configuration is an institution-scoped act (CR-004, CR-014)' },
  ]);
}

/**
 * Serialises every write that depends on the other versions of one key.
 * Transaction-scoped: released on commit or rollback.
 */
async function lockKey(key, { sequelize, transaction }) {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext($1))', {
    bind: [`workflow:${key.institutionId}:${key.category}:${key.requesterPositionCode}`],
    transaction,
    type: sequelize.QueryTypes.SELECT,
  });
}

const keyWhere = (key) => ({
  institutionId: key.institutionId,
  category: key.category,
  requesterPositionCode: key.requesterPositionCode,
});

/** D2: at most one DRAFT per key; the answer names it. @throws {ConflictError} */
async function assertNoDraft(key, { models, transaction }) {
  const draft = await models.WorkflowDefinition.findOne({
    where: { ...keyWhere(key), status: 'DRAFT' },
    attributes: ['id', 'version'],
    transaction,
  });
  if (!draft) return;

  throw new ConflictError('A draft already exists for this category and requester context', [
    {
      field: 'draftId',
      issue: `edit or publish draft version ${draft.version} (${draft.id}) first`,
    },
  ]);
}

async function nextVersion(key, { models, transaction }) {
  const highest = await models.WorkflowDefinition.max('version', {
    where: keyWhere(key),
    transaction,
  });
  return (highest ?? 0) + 1;
}

/**
 * Creates each step with `create`, not `bulkCreate`: the audit hooks run per
 * instance, and every step is audited (decision D3).
 */
async function createSteps(definitionId, steps, { models, transaction }) {
  for (const [index, step] of steps.entries()) {
    await models.WorkflowDefinitionStep.create(
      {
        definitionId,
        sequence: index + 1,
        stepType: step.stepType,
        actorPositionCode: step.actorPositionCode ?? null,
        procurementMode: step.stepType === 'PROCURE' ? step.procurementMode : null,
        skipIfRequesterIsActor: step.skipIfRequesterIsActor ?? false,
      },
      { transaction }
    );
  }
}

// --- Reads ------------------------------------------------------------------

const FILTERS = {
  institutionId: (value) => equals('institutionId', value),
  category: (value) => equals('category', value),
  requesterPositionCode: (value) => equals('requesterPositionCode', value),
  status: (value) => equals('status', value),
};

const SORTABLE = ['category', 'requesterPositionCode', 'version', 'status', 'createdAt'];

async function list(params, principal, { models = getModels() } = {}) {
  assertNotPicScoped(principal);

  const options = toFindOptions(params, {
    filters: FILTERS,
    sortable: SORTABLE,
    defaultSort: [
      ['category', 'ASC'],
      ['requesterPositionCode', 'ASC'],
      ['version', 'DESC'],
    ],
  });

  // Scope on top of the caller's filters, never instead of them.
  options.where = { ...options.where, ...scopeFilter(principal) };

  const { rows, pagination } = await paginate(models.WorkflowDefinition, options, {
    include: [{ association: 'steps', attributes: ['id', 'sequence'] }],
    distinct: true,
  });

  return { rows: rows.map((row) => serialize(row, { withSteps: false })), pagination };
}

/** Out of scope answers `404`, never `403` (`06-api.md` §1.4). */
async function getById(id, principal, { models = getModels(), transaction, lock } = {}) {
  const definition = await models.WorkflowDefinition.findByPk(id, { transaction, lock });
  if (!definition) throw new NotFoundError('Workflow definition not found');
  return assertCanAccess(principal, definition, { label: 'Workflow definition' });
}

async function detail(id, principal, { models = getModels() } = {}) {
  assertNotPicScoped(principal);
  await getById(id, principal, { models });

  const definition = await models.WorkflowDefinition.findByPk(id, { include: INCLUDE });
  return serialize(definition);
}

/** The confirmed-flow templates (`CR-014` §6.5). Code constants, never stored. */
function listTemplates() {
  return WORKFLOW_TEMPLATES.map((template) => ({
    key: template.key,
    category: template.category,
    requesterPositionCode: template.requesterPositionCode,
    steps: template.steps.map((step) => ({ ...step })),
  }));
}

/**
 * `GET /workflow-definitions/eligibility` — P2 (§64.2). Which categories each
 * requester position may request at all, from the one map
 * (`requestGuidance.js`), so the configuration screen offers no definition
 * that could never be used. Informational; create and publish enforce it.
 */
function eligibility() {
  return {
    categoriesByPosition: Object.fromEntries(
      POSITION_CODES.map((code) => [code, [...eligibleCategoriesFor(code)]])
    ),
  };
}

// --- Writes -----------------------------------------------------------------

/**
 * The institution a new definition belongs to — decision D4.
 *
 *   system-wide     must name one; there is nothing to default to, and a
 *                   workflow always belongs to exactly one school.
 *   institution     defaults to their own and may name no other.
 */
async function resolveInstitution(principal, supplied, { models }) {
  const scope = organizationScope(principal);

  let institutionId = supplied;
  if (scope.unrestricted) {
    if (!institutionId) {
      throw new ValidationError('Choose the institution this workflow belongs to', [
        {
          field: 'institutionId',
          issue: 'is required for a caller whose role is not scoped to one institution',
        },
      ]);
    }
  } else {
    if (institutionId === undefined || institutionId === null) {
      institutionId = scope.institutionId;
    }
    assertCanAssignInstitution(principal, institutionId);
    if (!institutionId) {
      throw new ValidationError('You belong to no institution', [
        { field: 'institutionId', issue: 'a workflow belongs to an institution' },
      ]);
    }
  }

  const institution = await models.Institution.findByPk(institutionId);
  if (!institution) {
    throw new ValidationError('The institution does not exist', [
      { field: 'institutionId', issue: 'must reference an existing institution' },
    ]);
  }
  if (!institution.isActive) {
    throw new ValidationError('That institution has been deactivated', [
      { field: 'institutionId', issue: 'must not reference a deactivated institution' },
    ]);
  }

  return institution.id;
}

/**
 * `POST /workflow-definitions` — always a DRAFT, from nothing or from a
 * template. A template must be the one for the key named in the body: the key is
 * what the definition is FOR, and a template for another key would silently
 * describe a different process.
 */
async function create(body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);

  let template = null;
  if (body.templateKey) {
    template = templateOf(body.templateKey);
    if (!template) {
      throw new ValidationError('Unknown workflow template', [
        { field: 'templateKey', issue: 'must be one of the confirmed-flow templates' },
      ]);
    }
    if (
      template.category !== body.category ||
      template.requesterPositionCode !== body.requesterPositionCode
    ) {
      throw new ValidationError('That template is for a different category or requester', [
        {
          field: 'templateKey',
          issue: `${template.key} is for ${template.category} requests from ${template.requesterPositionCode}`,
        },
      ]);
    }
  }

  // P2 (§64.2): no draft for a request nobody may make — refused here, early,
  // as well as at publication (`publicationIssues`).
  const ineligible = categoryEligibilityIssue(body);
  if (ineligible) {
    throw new ValidationError('This category cannot be requested by that position', [ineligible]);
  }

  const institutionId = await resolveInstitution(principal, body.institutionId, { models });
  const key = {
    institutionId,
    category: body.category,
    requesterPositionCode: body.requesterPositionCode,
  };

  const id = await withTransaction(
    async (transaction) => {
      await lockKey(key, { sequelize, transaction });
      await assertNoDraft(key, { models, transaction });

      const definition = await models.WorkflowDefinition.create(
        {
          ...key,
          version: await nextVersion(key, { models, transaction }),
          status: 'DRAFT',
          createdBy: principal.userId,
        },
        { transaction }
      );

      if (template) await createSteps(definition.id, template.steps, { models, transaction });

      return definition.id;
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

/**
 * `POST /workflow-definitions/:id/versions` — a new DRAFT copying the steps of a
 * PUBLISHED version (ACTIVE or RETIRED). The source is not changed. Refused
 * while the key already has a draft (D2), and from a draft itself: a draft is
 * edited, not copied.
 */
async function createVersion(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);
  const source = await getById(id, principal, { models });

  if (source.status === 'DRAFT') {
    throw new ConflictError('A draft is edited directly, not copied', [
      { issue: 'a new version is created from a published (ACTIVE or RETIRED) version' },
    ]);
  }

  const key = keyWhere(source);

  const newId = await withTransaction(
    async (transaction) => {
      await lockKey(key, { sequelize, transaction });
      await assertNoDraft(key, { models, transaction });

      const steps = await models.WorkflowDefinitionStep.findAll({
        where: { definitionId: source.id },
        order: [['sequence', 'ASC']],
        transaction,
      });

      const definition = await models.WorkflowDefinition.create(
        {
          ...key,
          version: await nextVersion(key, { models, transaction }),
          status: 'DRAFT',
          createdBy: principal.userId,
        },
        { transaction }
      );

      await createSteps(definition.id, steps, { models, transaction });

      return definition.id;
    },
    { sequelize }
  );

  return detail(newId, principal, { models });
}

/** @throws {ConflictError} unless the definition, re-read under lock, is a DRAFT */
function assertDraft(definition) {
  if (definition.status === 'DRAFT') return;
  throw new ConflictError(`A ${definition.status.toLowerCase()} definition cannot be changed`, [
    {
      field: 'status',
      issue: `version ${definition.version} is ${definition.status}; create a new version to change the process (REQ-WF-003)`,
    },
  ]);
}

/**
 * Field rules a DRAFT's steps must always meet, even incomplete ones. The
 * ORDER of step types, and whether each actor is chosen, are publication rules
 * (`workflowShape.publicationIssues`): a draft may be saved half-arranged, and
 * a template's undecided actor stays empty (D1).
 *
 * @throws {ValidationError}
 */
function assertStepFields(steps) {
  const details = [];

  steps.forEach((step, index) => {
    if (step.sequence !== index + 1) {
      details.push({
        field: `steps.${index}.sequence`,
        issue: `must be ${index + 1}: steps are numbered from 1 in order, with no gaps`,
      });
    }
    if (step.stepType === 'PROCURE' && !step.procurementMode) {
      details.push({
        field: `steps.${index}.procurementMode`,
        issue: 'is required for a PROCURE step (INTERNAL or EXTERNAL)',
      });
    }
    if (step.stepType !== 'PROCURE' && step.procurementMode) {
      details.push({
        field: `steps.${index}.procurementMode`,
        issue: 'only a PROCURE step has a procurement mode',
      });
    }
  });

  if (details.length > 0) throw new ValidationError('The steps are not valid', details);
}

/**
 * `PUT /workflow-definitions/:id/steps` — replaces a DRAFT's ordered step list.
 * Old steps are destroyed and new ones created one by one, so each change is
 * audited (D3).
 */
async function replaceSteps(id, steps, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);
  // A published version answers 409 whatever the body says; re-checked under
  // the row lock below.
  assertDraft(await getById(id, principal, { models }));
  assertStepFields(steps);

  await withTransaction(
    async (transaction) => {
      // Locked, so a concurrent publish cannot activate the version mid-edit.
      const definition = await models.WorkflowDefinition.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      assertDraft(definition);

      const existing = await models.WorkflowDefinitionStep.findAll({
        where: { definitionId: id },
        transaction,
      });
      for (const step of existing) await step.destroy({ transaction });

      await createSteps(id, steps, { models, transaction });
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

/**
 * `POST /workflow-definitions/:id/publish` — REQ-WF-002 – REQ-WF-004.
 *
 * Validates shape, actors and the department rule; then, in one transaction and
 * under the key lock, retires the current ACTIVE version (if any) and activates
 * this one. Retire first: `uq_wf_def_active` is checked per statement.
 *
 * @throws {ValidationError} naming each failing step in `details`
 */
async function publish(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  assertNotPicScoped(principal);
  const found = await getById(id, principal, { models });
  const key = keyWhere(found);

  await withTransaction(
    async (transaction) => {
      await lockKey(key, { sequelize, transaction });

      const definition = await models.WorkflowDefinition.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      assertDraft(definition);

      const steps = await models.WorkflowDefinitionStep.findAll({
        where: { definitionId: id },
        order: [['sequence', 'ASC']],
        transaction,
      });

      const issues = publicationIssues(definition, steps);
      if (issues.length > 0) {
        throw new ValidationError('This workflow cannot be published yet', issues);
      }

      const now = new Date();

      const current = await models.WorkflowDefinition.findAll({
        where: { ...key, status: 'ACTIVE', id: { [Op.ne]: id } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      for (const previous of current) {
        await previous.update({ status: 'RETIRED', retiredAt: now }, { transaction });
      }

      await definition.update(
        { status: 'ACTIVE', publishedAt: now, publishedBy: principal.userId },
        { transaction }
      );
    },
    { sequelize }
  );

  return detail(id, principal, { models });
}

module.exports = {
  list,
  getById,
  detail,
  listTemplates,
  eligibility,
  create,
  createVersion,
  replaceSteps,
  publish,
  serialize,
};
