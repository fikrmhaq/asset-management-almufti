'use strict';

/**
 * Request schemas for workflow definitions — `06-api.md` §12.2, Phase 36
 * (`CR-014`).
 *
 * Every field is a closed choice. A step has a type, one position, a
 * procurement mode and a self-skip flag, and nothing else: there is no field in
 * which a condition, expression or fallback could be written (`BR-026`), and
 * `.strict()` refuses one being sent anyway.
 *
 * `actorPositionCode` may be null in a DRAFT (Phase 36 decision D1); publication
 * refuses it. Whether a PROCURE step has its mode, and the numbering, are
 * checked in the domain so the error names the step.
 */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');
const { POSITION_CODES } = require('../../domain/schoolPositions');
const { REQUEST_CATEGORIES } = require('../../domain/requestCategories');
const {
  STEP_TYPES,
  PROCUREMENT_MODES,
  DEFINITION_STATUSES,
  MAX_STEPS,
} = require('../../domain/workflowShape');

const uuid = z.string().uuid('must be a UUID');

const idParams = z.object({ id: uuid });

const listDefinitions = listQuerySchema({
  institutionId: uuid.optional(),
  category: z.enum(REQUEST_CATEGORIES).optional(),
  requesterPositionCode: z.enum(POSITION_CODES).optional(),
  status: z.enum(DEFINITION_STATUSES).optional(),
});

const createDefinition = z
  .object({
    category: z.enum(REQUEST_CATEGORIES),
    requesterPositionCode: z.enum(POSITION_CODES),
    // Required for a system-wide caller, defaulted for everyone else (D4).
    institutionId: uuid.optional(),
    templateKey: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const step = z
  .object({
    sequence: z.number().int().positive(),
    stepType: z.enum(STEP_TYPES),
    actorPositionCode: z.enum(POSITION_CODES).nullable(),
    procurementMode: z.enum(PROCUREMENT_MODES).nullish(),
    skipIfRequesterIsActor: z.boolean().default(false),
  })
  .strict();

const replaceSteps = z
  .object({
    steps: z.array(step).max(MAX_STEPS, `at most ${MAX_STEPS} steps`),
  })
  .strict();

module.exports = { idParams, listDefinitions, createDefinition, replaceSteps };
