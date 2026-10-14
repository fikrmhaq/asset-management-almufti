'use strict';

/**
 * Attachments — `IMPLEMENTATION_PLAN.md` §11.8, `06-api.md` §5.1/§5.4,
 * REQ-FILE-001–005.
 *
 * An attachment always belongs to an Asset, and may optionally narrow to one of
 * its Units. Access follows the asset's organization scope (REQ-FILE-005), so
 * reaching a file means being able to reach what it documents.
 *
 * PIC-scoped callers are the exception — `CR-004` §6.5. For them the file's
 * ASSET is not reachable, so the Unit decides:
 *
 *   assetUnitId set, unit in their departments   allowed
 *   assetUnitId set, unit elsewhere or unassigned  404
 *   assetUnitId null (an ASSET-level file)        404, and refused on upload
 *
 * The last row is the point. `attachment:*` is on the PIC allow-list because a
 * PIC must document their own units; letting the same codes reach an
 * asset-level file would hand out Asset-wide access off the back of an
 * attachment permission.
 *
 * ── Registration photos (REQ-REQUEST-020, migration 061) ─────────────────
 *
 * An attachment with `purpose: REGISTRATION_PHOTO` is evidence of what was
 * registered against a request item. Same endpoint, same permissions, same
 * scope — all of the above still decides who may upload where. On top of it:
 *
 *   JPG / PNG only        the receipt photos' types (`storage.PHOTO_*`)
 *   a registered target   a unit linked to a request item; for an asset-level
 *                         photo, an asset with at least one such unit
 *
 * Never tied to the REGISTER step's state: the last unit registered closes
 * that step in the same transaction, and its photo comes after. Not proof of
 * receipt — receipt photos are request documents (migration 057).
 */

const { getModels } = require('../../db/models');
const { getSequelize } = require('../../db/sequelize');
const { withTransaction } = require('../../db/withTransaction');
const { Op, literal } = require('sequelize');

const { NotFoundError, ValidationError } = require('../../errors');
const {
  assertCanAccess,
  assertCanAccessUnit,
  assertCanAccessAsset,
  assertAssetWideChange,
  unitDepartmentScope,
} = require('../../domain/scope');
const { organizationScope } = require('../../auth/principal');
const { ATTACHMENT_PURPOSES } = require('../../domain/attachmentPurposes');
const storage = require('../../services/storage');
const assetService = require('../assets/service');

/**
 * Restricts an attachment query to the units a PIC-scoped caller reaches.
 *
 * `{}` for the other two tiers, exactly like `unitScopeFilter` — their scope
 * already came from the owning asset.
 *
 * A subquery rather than a join, following the `buildFilters` precedent in
 * `assets/service.js`: it composes with the caller's own `where` without
 * disturbing the row count.
 */
function unitAttachmentFilter(principal) {
  const scope = organizationScope(principal);
  const departments = unitDepartmentScope(principal);
  if (!departments) return {};

  const ids = [...departments];

  // A caller holding no post reaches no unit. `IN ()` cannot be spelled, and
  // Sequelize renders an empty array as `IN (NULL)`, which matches nothing —
  // which is the correct answer here.
  if (ids.length === 0) return { assetUnitId: { [Op.in]: [] } };

  const sequelize = getSequelize();
  const escaped = ids.map((id) => sequelize.escape(id)).join(', ');

  const ownUnits = {
    assetUnitId: {
      [Op.in]: literal(
        `(SELECT "id" FROM "public"."asset_units" WHERE "department_id" IN (${escaped}))`
      ),
    },
  };
  if (scope.picScoped) return ownUnits;

  /**
   * A department-bound operator (P3, §64.3) reaches the asset itself — it has a
   * unit of theirs — so its asset-level files are theirs to read too; other
   * departments' units' files are not.
   */
  return { [Op.or]: [{ assetUnitId: null }, ownUnits] };
}

function serialize(attachment) {
  return {
    id: attachment.id,
    assetId: attachment.assetId,
    assetUnitId: attachment.assetUnitId ?? null,
    fileName: attachment.fileName,
    fileType: attachment.fileType,
    // BIGINT arrives as a string from the driver; a file size fits a Number.
    fileSize: Number(attachment.fileSize),
    uploadedBy: attachment.uploadedBy,
    // REQ-REQUEST-020: null for an ordinary attachment.
    purpose: attachment.purpose ?? null,
    createdAt: attachment.createdAt,
  };
}

const [REGISTRATION_PHOTO] = ATTACHMENT_PURPOSES;

/**
 * REQ-REQUEST-020: a registration photo's target was registered against a
 * request item — the unit itself, or for an asset-level photo any unit of the
 * asset. Checked after scope, so an unreachable target is still `404`.
 *
 * @throws {ValidationError}
 */
async function assertRegisteredTarget(assetId, assetUnitId, { models }) {
  const linked = assetUnitId
    ? await models.RequestItemUnit.count({ where: { assetUnitId } })
    : await models.RequestItemUnit.count({
        include: [{ association: 'assetUnit', attributes: [], where: { assetId }, required: true }],
      });
  if (linked > 0) return;

  throw new ValidationError('Only a registered asset or unit takes a registration photo', [
    {
      field: 'purpose',
      issue: assetUnitId
        ? 'a registration photo is of a unit registered against a request item'
        : 'a registration photo of the asset needs a unit of it registered against a request item',
    },
  ]);
}

/** Attachments on one asset — REQ-FILE-002. */
async function listForAsset(assetId, principal, { models = getModels() } = {}) {
  await assetService.getById(assetId, principal, { models });

  const rows = await models.Attachment.findAll({
    // The PIC narrowing — `CR-004` §6.5. `assetUnitId IN (…)` excludes BOTH
    // other departments' units and asset-level rows, the latter because
    // `IN (…)` never matches NULL — the same property `DEC-096` relies on, used
    // here for the same reason and not by accident.
    where: { assetId, ...unitAttachmentFilter(principal) },
    order: [['createdAt', 'DESC']],
  });

  return rows.map(serialize);
}

/**
 * Loads an attachment the caller may reach.
 *
 * Scope is resolved through the owning asset, and a miss answers `404` rather
 * than `403` so an out-of-scope file is indistinguishable from a missing one.
 */
async function getById(id, principal, { models = getModels() } = {}) {
  const attachment = await models.Attachment.findByPk(id, {
    include: [{ association: 'asset', attributes: ['id', 'institutionId'] }],
  });

  if (!attachment) throw new NotFoundError('Attachment not found');
  assertCanAccess(principal, attachment.asset, { label: 'Attachment' });

  /**
   * The PIC narrowing — `CR-004` §6.5. Covers `detail`, `download` and `remove`
   * in one place, since all three come through here.
   *
   * An asset-level file (`assetUnitId` null) is refused by the same call:
   * `assertCanAccessUnit` rejects a unit with no department, and `null` here
   * stands for no unit at all. Both answer `404`, which is right — for a PIC
   * neither file exists.
   */
  if (organizationScope(principal).picScoped) {
    const unit = attachment.assetUnitId
      ? await models.AssetUnit.findByPk(attachment.assetUnitId, { attributes: ['id', 'departmentId'] })
      : null;

    assertCanAccessUnit(principal, unit, { label: 'Attachment' });
  } else if (unitDepartmentScope(principal)) {
    // P3 (§64.3): a unit's file, if the unit is theirs; the asset's own file, if
    // the asset is within their reach. Otherwise `404`, like the record itself.
    if (attachment.assetUnitId) {
      const unit = await models.AssetUnit.findByPk(attachment.assetUnitId, {
        attributes: ['id', 'departmentId'],
      });
      assertCanAccessUnit(principal, unit, { label: 'Attachment' });
    } else {
      await assertCanAccessAsset(principal, attachment.asset, { label: 'Attachment' });
    }
  }

  return attachment;
}

const detail = async (id, principal, options) => serialize(await getById(id, principal, options));

async function create(assetId, file, body, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();

  const asset = await assetService.getById(assetId, principal, { models });
  const registrationPhoto = body.purpose === REGISTRATION_PHOTO;
  storage.assertAllowedType(
    file,
    registrationPhoto
      ? {
          label: 'registration photo',
          mimeTypes: storage.PHOTO_MIME_TYPES,
          extensions: storage.PHOTO_EXTENSIONS,
        }
      : { label: 'attachment' }
  );
  // P3 (§64.3): a file on the asset itself concerns every department's units.
  if (!body.assetUnitId) await assertAssetWideChange(principal, asset);

  /**
   * A PIC-scoped caller must file against a unit they hold — `CR-004` §6.5.
   *
   * Required for them and optional for everyone else, which Zod cannot express:
   * the schema has no access to the principal. `ValidationError` rather than
   * `ForbiddenError` because `assetUnitId` is a field the caller controls, which
   * is the same reasoning `assertCanAssignInstitution` follows.
   */
  if (!body.assetUnitId && organizationScope(principal).picScoped) {
    throw new ValidationError('An asset unit is required', [
      {
        field: 'assetUnitId',
        issue:
          'a PIC-scoped role may attach files to its own units only, not to the asset itself',
      },
    ]);
  }

  if (body.assetUnitId) {
    const unit = await models.AssetUnit.findByPk(body.assetUnitId);
    if (!unit || unit.assetId !== assetId) {
      throw new ValidationError('The asset unit does not belong to this asset', [
        { field: 'assetUnitId', issue: 'must be a unit of this asset' },
      ]);
    }

    // Proves the caller may reach the unit, not merely its asset (`CR-004`).
    assertCanAccessUnit(principal, unit, { label: 'Asset unit' });
  }

  if (registrationPhoto) await assertRegisteredTarget(assetId, body.assetUnitId, { models });

  // Sharded by asset id — `05-infrastructure.md` §5.2.
  const stored = await storage.store(file, { shard: assetId });

  try {
    const attachment = await withTransaction(
      async (transaction) =>
        models.Attachment.create(
          {
            assetId,
            assetUnitId: body.assetUnitId ?? null,
            fileName: stored.fileName,
            fileType: file.mimetype,
            fileSize: stored.fileSize,
            storageReference: stored.storageReference,
            uploadedBy: principal.userId,
            purpose: body.purpose ?? null,
          },
          { transaction }
        ),
      { sequelize }
    );

    return serialize(attachment);
  } catch (error) {
    // The row is the record of truth. If it never landed, the file on disk is
    // an orphan, so remove it now rather than leaving it for the Phase 8 sweep.
    await storage.remove(stored.storageReference).catch(() => {});
    throw error;
  }
}

/** Metadata plus the bytes, for streaming to the caller — REQ-FILE-005. */
async function download(id, principal, options = {}) {
  const attachment = await getById(id, principal, options);
  const buffer = await storage.read(attachment.storageReference);

  return { attachment: serialize(attachment), buffer, fileType: attachment.fileType };
}

async function remove(id, principal, options = {}) {
  const models = options.models ?? getModels();
  const sequelize = options.sequelize ?? getSequelize();
  const attachment = await getById(id, principal, { models });
  if (!attachment.assetUnitId) await assertAssetWideChange(principal, attachment.asset);
  const { storageReference } = attachment;

  await withTransaction(async (transaction) => attachment.destroy({ transaction }), { sequelize });

  // After the row is gone, so a failed delete cannot strand a row pointing at a
  // file that no longer exists.
  await storage.remove(storageReference);
}

module.exports = { listForAsset, detail, getById, create, download, remove, serialize };
