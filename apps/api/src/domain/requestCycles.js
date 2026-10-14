'use strict';

/**
 * The current approval cycle of a request — REQ-REQUEST-018, migration 059.
 *
 * A request returned for revision and resubmitted runs its approval chain again:
 * resubmission copies the newest cycle's step rows into the next cycle. Every
 * earlier cycle stays exactly as it was decided.
 *
 * THE CURRENT CYCLE IS THE HIGHEST — derived, never stored. Every reader of the
 * CURRENT workflow (advancing, acting, registering, closing, the detail's
 * `steps`) goes through this module, so it never sees an earlier cycle's step of
 * the same type. A reader that means HISTORY — former actors (`actedSql`), the
 * events of Request Updates — spans every cycle on purpose and does not.
 *
 * Callers that write hold the request's row lock first, so no cycle can be added
 * between reading the number and reading its rows.
 */

const { getModels } = require('../db/models');

/** The request's newest cycle number, or `null` when it has no steps (a DRAFT). */
async function currentCycle(requestId, { models = getModels(), transaction } = {}) {
  const cycle = await models.RequestStep.max('cycle', { where: { requestId }, transaction });
  return cycle ?? null;
}

/**
 * The current cycle's steps, in sequence. `[]` for a request without steps.
 *
 * @param {object} [options] `where` narrows further (e.g. a step type); `lock`,
 *   `include`, `attributes` pass through.
 */
async function currentSteps(
  requestId,
  { models = getModels(), transaction, lock, where = {}, include, attributes } = {}
) {
  const cycle = await currentCycle(requestId, { models, transaction });
  if (cycle === null) return [];
  return models.RequestStep.findAll({
    where: { ...where, requestId, cycle },
    order: [['sequence', 'ASC']],
    transaction,
    ...(lock ? { lock } : {}),
    ...(include ? { include } : {}),
    ...(attributes ? { attributes } : {}),
  });
}

/** The current cycle's step of `stepType` (PROCURE and REGISTER occur once), or `null`. */
async function currentStep(requestId, stepType, options = {}) {
  const [step] = await currentSteps(requestId, { ...options, where: { stepType } });
  return step ?? null;
}

/** SQL: the newest cycle of the request row aliased `requestRef`. */
function currentCycleSql(requestRef) {
  return `(SELECT max(c.cycle) FROM public.request_steps c WHERE c.request_id = ${requestRef}."id")`;
}

module.exports = { currentCycle, currentSteps, currentStep, currentCycleSql };
