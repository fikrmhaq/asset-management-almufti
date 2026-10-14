'use strict';

/**
 * The inventory-code preview — P4 (`IMPLEMENTATION_PLAN.md` §64.4),
 * REQ-UNIT-007, REQ-UNIT-012, `06-api.md` §5.2.
 *
 * `POST /inventory-codes/preview` answers, for the unit numbers a registrar has
 * typed so far, "what code would each of these become, and is anything wrong
 * with it?" — before anything is registered.
 *
 * READ-ONLY, AND IT RESERVES NOTHING. No row is written, no lock taken, no
 * number allocated. A code shown here can still be taken by someone else before
 * this registrar submits; the registration's own checks, and the unique index
 * behind them (`BR-020`), stay the only authority.
 *
 * THE SAME INPUTS AS ISSUING. The context comes from `codeContextForAsset` and
 * the parts from `renderParts` — exactly what `allocateCodesForAsset` uses — and
 * the funding source is resolved by the same `resolveFundingSource`, contract
 * mismatch included (migration 056). What a registrar is shown and what is
 * issued cannot drift apart without this file changing.
 *
 * NO "NEXT NUMBER". Unit numbers are free-form (`1.9`, `1.10`, `001-02-03`), so
 * nothing here sorts, increments or suggests one. What is offered instead is the
 * few most recently REGISTERED — by registration time, never by value.
 */

const { Op } = require('sequelize');

const { getModels } = require('../../db/models');
const { ValidationError } = require('../../errors');
const {
  COMPOSITION_TOKEN,
  SEQUENCE_TOKEN,
  TOKENS,
  formatHasSequence,
  formatUsesComposition,
  registrationHint,
  renderParts,
} = require('../../domain/inventoryCodeFormat');
const { assertLeafClassification } = require('../../domain/classificationRules');
const { assertDepartmentAssignable } = require('../../domain/departmentRules');
const {
  assertCanAssignDepartment,
  assertCanAssignInstitution,
  defaultInstitutionFor,
  unitScopeFilter,
} = require('../../domain/scope');
const assetService = require('../assets/service');
const unitService = require('../assetUnits/service');

/** How many recently used unit numbers are offered. */
const RECENT_LIMIT = 5;

/**
 * Rows read to find `RECENT_LIMIT` distinct values. A pattern that leaves a part
 * open (a funding source not chosen yet) can match the same number under two
 * funding sources; reading a few more rows than shown keeps the list full.
 */
const RECENT_SCAN = 50;

/** Per unit number. The order below is the order the checks run in. */
const STATUS = Object.freeze({
  EMPTY: 'EMPTY',
  INVALID: 'INVALID',
  DUPLICATE_IN_BATCH: 'DUPLICATE_IN_BATCH',
  // The unit number is fine, but something the registrar does not type — a
  // funding source, a department — is missing, so no code can be formed yet.
  INCOMPLETE: 'INCOMPLETE',
  ALREADY_ISSUED: 'ALREADY_ISSUED',
  OK: 'OK',
});

const TOKEN_NAMES = new Map(TOKENS.map((token) => [token.id, token.name]));

/**
 * One part as the client renders it. `source` is what separates what the
 * registrar typed from what the institution's format supplies:
 *
 *   UNIT_NUMBER  typed by the registrar, per unit
 *   GENERATED    from the institution, classification, department, funding
 *                source or registration year
 *   ALLOCATED    the sequence, decided only at registration
 *   SEPARATOR    fixed text from the format
 */
function describePart(part) {
  if (part.kind === 'LITERAL') return { source: 'SEPARATOR', text: part.text };

  const source =
    part.tokenId === COMPOSITION_TOKEN
      ? 'UNIT_NUMBER'
      : part.tokenId === SEQUENCE_TOKEN
        ? 'ALLOCATED'
        : 'GENERATED';

  return {
    source,
    tokenId: part.tokenId,
    label: TOKEN_NAMES.get(part.tokenId) ?? part.tokenId,
    text: part.text,
    ...(part.problem ? { issue: part.problem.issue } : {}),
  };
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The asset the units would belong to: an existing one the caller can reach
 * (`404` otherwise — P3, §64.3), or the one a registration is about to create.
 */
async function targetAsset(body, principal, { models }) {
  if (body.assetId) {
    const asset = await assetService.getById(body.assetId, principal, { models });
    return {
      institutionId: asset.institutionId,
      classificationId: asset.classificationId,
      contractId: asset.contractId ?? null,
    };
  }

  const institutionId = defaultInstitutionFor(principal, body.institutionId);
  if (!institutionId) {
    throw new ValidationError('An institution is required', [
      {
        field: 'institutionId',
        issue: 'your account is not attached to one institution, so name the one to preview for',
      },
    ]);
  }
  assertCanAssignInstitution(principal, institutionId);
  await assertLeafClassification(body.classificationId, { models, institutionId });

  // As in registration: a new asset established under a contract item carries
  // that item's contract — which decides the funding-source fallback.
  let contractId = null;
  if (body.contractItemId) {
    const item = await models.ContractItem.findByPk(body.contractItemId);
    if (!item) {
      throw new ValidationError('The contract item does not exist', [
        { field: 'contractItemId', issue: 'must reference an existing contract item' },
      ]);
    }
    contractId = item.contractId;
  }

  return { institutionId, classificationId: body.classificationId, contractId };
}

/**
 * The unit numbers most recently registered for codes of this shape, newest
 * first — at most five, and only from units the caller can reach.
 *
 * "Of this shape" is the format rendered with every known part fixed and the
 * unit number open: for `{NUMBER_COMPOSITION}/{CLASSIFICATION_LEAF_LABEL}/…`,
 * the laptops funded the same way in the same year. A part not known yet (a
 * funding source still to be chosen) and the sequence are left open too.
 *
 * `unitScopeFilter` keeps a Kajur or Toolman to their own department's units
 * (P3), so another Jurusan's numbers are never shown to them.
 */
async function recentUnitNumbers(parts, institutionId, principal, { models }) {
  const pattern = parts
    .map((part) => (part.kind === 'LITERAL' || part.text !== null ? escapeRegex(part.text) : '.+'))
    .join('');

  const rows = await models.AssetUnit.findAll({
    attributes: ['numberComposition', 'inventoryCode', 'createdAt'],
    where: {
      numberComposition: { [Op.ne]: null },
      inventoryCode: { [Op.regexp]: `^${pattern}$` },
      ...unitScopeFilter(principal),
    },
    include: [{ association: 'asset', attributes: [], where: { institutionId }, required: true }],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: RECENT_SCAN,
  });

  const seen = new Set();
  const recent = [];
  for (const row of rows) {
    if (seen.has(row.numberComposition)) continue;
    seen.add(row.numberComposition);
    recent.push({
      unitNumber: row.numberComposition,
      inventoryCode: row.inventoryCode,
      registeredAt: row.createdAt,
    });
    if (recent.length === RECENT_LIMIT) break;
  }
  return recent;
}

/**
 * `POST /inventory-codes/preview`.
 *
 * @param {{assetId?: string, institutionId?: string, classificationId?: string,
 *   contractItemId?: string, departmentId?: string|null, fundingSourceId?: number|null,
 *   unitNumbers: string[]}} body
 */
async function preview(body, principal, { models = getModels() } = {}) {
  const asset = await targetAsset(body, principal, { models });
  const departmentId = body.departmentId ?? null;

  // The department rules registration applies — a Kajur or Toolman previews
  // for their own department only (P3), and never for none.
  assertCanAssignDepartment(principal, departmentId);
  await assertDepartmentAssignable(departmentId, asset, { models });

  /**
   * The funding source, resolved exactly as registration resolves it: the
   * units' own, which must match the asset's contract's, else the contract's.
   * Registration refuses a mismatch or an unknown source outright; the preview
   * reports it against the field instead, so it can be fixed while typing.
   */
  let fundingSource;
  let fundingRefusal = null;
  try {
    fundingSource = (
      await unitService.resolveFundingSource(
        { contractId: asset.contractId, fundingSourceId: body.fundingSourceId },
        { models }
      )
    ).source;
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    fundingRefusal = error;
    fundingSource = null;
  }

  const built = await unitService.codeContextForAsset(asset, {
    models,
    departmentId,
    fundingSource,
  });

  const institution = built?.institution ?? null;
  const hint = registrationHint(institution).numberComposition;
  const unitNumber = {
    required: Boolean(hint.required),
    perUnit: Boolean(hint.perUnit),
    ...(hint.maxLength ? { maxLength: hint.maxLength } : {}),
  };

  // No institution, no format: registration issues no code at all (REQ-UNIT-007).
  if (!built) {
    return {
      generated: false,
      unitNumber,
      parts: [],
      problems: [],
      units: [],
      recentUnitNumbers: [],
    };
  }

  const { format, context } = built;
  const refusals = fundingRefusal ? [fundingRefusal] : built.refusals;
  const refusalDetails = refusals.flatMap((error) => error.details ?? []);

  /**
   * The code with the unit number left open. Its problems — other than the
   * missing unit number itself — are the ones no unit number can fix, and the
   * funding-source refusal, when there is one, stands in for its token's own
   * generic "has none", exactly as registration raises the refusal first.
   */
  const template = renderParts(format, { ...context, numberComposition: null }).parts.map(
    (part) => {
      if (part.tokenId === COMPOSITION_TOKEN) return { ...part, problem: undefined };
      if (part.tokenId === 'FUNDING_SOURCE_CODE' && refusalDetails.length > 0) {
        return { ...part, text: null, problem: refusalDetails[0] };
      }
      return part;
    }
  );

  const partProblems = template
    .filter((part) => part.problem && part.tokenId !== 'FUNDING_SOURCE_CODE')
    .map((part) => part.problem);
  const fundingPartProblem = template.find(
    (part) => part.tokenId === 'FUNDING_SOURCE_CODE' && part.problem
  )?.problem;
  const problems = [
    ...(refusalDetails.length > 0
      ? refusalDetails
      : fundingPartProblem
        ? [fundingPartProblem]
        : []),
    ...partProblems,
  ];
  // A refusal can concern a format without the funding source token — a
  // contract mismatch is refused whatever the format.
  const contextBlocked = problems.length > 0;

  const usesUnitNumber = formatUsesComposition(format);
  const hasSequence = formatHasSequence(format);

  const values = usesUnitNumber ? body.unitNumbers.map((value) => String(value ?? '').trim()) : [];
  const counts = new Map();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const units = values.map((value, index) => {
    if (!value) {
      return {
        index,
        unitNumber: value,
        status: STATUS.EMPTY,
        inventoryCode: null,
        parts: template.map(describePart),
      };
    }

    const rendered = renderParts(format, { ...context, numberComposition: value }).parts.map(
      (part) =>
        part.tokenId === 'FUNDING_SOURCE_CODE' && refusalDetails.length > 0
          ? { ...part, text: null, problem: refusalDetails[0] }
          : part
    );
    const own = rendered.find((part) => part.tokenId === COMPOSITION_TOKEN);
    const base = { index, unitNumber: value, parts: rendered.map(describePart) };

    if (own?.problem) {
      return { ...base, status: STATUS.INVALID, inventoryCode: null, issue: own.problem.issue };
    }
    // With a sequence, one value covers the batch and the sequence separates
    // the units, so a repeat is not a clash.
    if (!hasSequence && counts.get(value) > 1) {
      return { ...base, status: STATUS.DUPLICATE_IN_BATCH, inventoryCode: null };
    }
    if (contextBlocked) return { ...base, status: STATUS.INCOMPLETE, inventoryCode: null };

    // A sequence is decided only when the units are registered.
    const complete = rendered.every((part) => part.text !== null);
    return {
      ...base,
      status: STATUS.OK,
      inventoryCode: complete ? rendered.map((part) => part.text).join('') : null,
    };
  });

  /**
   * Already issued — checked against EVERY unit, not only those the caller can
   * see, because that is what the unique index checks (`BR-020`). Only the fact
   * is returned, never which unit or asset holds the code: registration's own
   * `409` discloses exactly as much.
   */
  const codes = units.filter((unit) => unit.inventoryCode).map((unit) => unit.inventoryCode);
  if (codes.length > 0) {
    const issued = new Set(
      (
        await models.AssetUnit.findAll({
          attributes: ['inventoryCode'],
          where: { inventoryCode: { [Op.in]: codes } },
        })
      ).map((row) => row.inventoryCode)
    );
    for (const unit of units) {
      if (unit.inventoryCode && issued.has(unit.inventoryCode)) unit.status = STATUS.ALREADY_ISSUED;
    }
  }

  return {
    generated: true,
    unitNumber,
    parts: template.map(describePart),
    problems,
    units,
    recentUnitNumbers: usesUnitNumber
      ? await recentUnitNumbers(template, asset.institutionId, principal, { models })
      : [],
  };
}

module.exports = { preview, STATUS, RECENT_LIMIT };
