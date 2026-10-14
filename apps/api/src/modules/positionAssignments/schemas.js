'use strict';

/**
 * Request schemas for school positions — `06-api.md` §12.1, Phase 35 (`CR-014`).
 *
 * `positionCode` is checked against the authoritative list here, so an unknown
 * code is a `400` before any lookup. Whether a department is required is the
 * domain's decision (`domain/positionAssignments.js`), which reports it against
 * the field.
 */

const { z } = require('zod');

const { POSITION_CODES } = require('../../domain/schoolPositions');

const uuid = z.string().uuid('must be a UUID');

const idParams = z.object({ id: uuid });

const assignPosition = z
  .object({
    positionCode: z.enum(POSITION_CODES),
    departmentId: uuid.nullish(),
  })
  .strict();

const listAssignments = z
  .object({
    current: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  })
  .strict();

module.exports = { idParams, assignPosition, listAssignments };
