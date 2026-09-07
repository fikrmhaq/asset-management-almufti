'use strict';

/** Request schemas for departments — `06-api.md` §3.2, REQ-ORG-003/004. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');

const uuid = z.string().uuid('must be a UUID');

/**
 * `code` is an institution-local label, not the key — Phase 20 (`CR-003`). It
 * was the primary key until migration 040, which is why it is still `VARCHAR(8)`
 * and why the previous version of this file supplied it as `id` on create.
 * Uniqueness is now `(institution_id, code)`, checked in the service.
 */
const departmentBody = {
  name: z.string().trim().min(1, 'is required').max(75),
};

const createDepartment = z
  .object({
    code: z.string().trim().min(1, 'is required').max(8),
    /**
     * Optional: a scoped caller gets their own institution by default
     * (`defaultInstitutionFor`). A system-wide caller may name one, or omit it
     * to create an unassigned department — which is inert for asset-unit
     * assignment until an institution is set.
     */
    institutionId: uuid.optional(),
    ...departmentBody,
  })
  .strict();

/**
 * `institutionId` is NOT updatable (`CR-003` OPEN-6). Moving a department
 * between institutions would invalidate every asset unit assigned to it, and
 * `.strict()` makes the attempt an explicit error rather than a silent no-op.
 */
const updateDepartment = z
  .object({ code: z.string().trim().min(1).max(8), ...departmentBody })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listDepartments = listQuerySchema({
  status: z.enum(['active', 'inactive']).optional(),
  institutionId: uuid.optional(),
  q: z.string().trim().min(1).optional(),
});

const departmentParams = z.object({ id: uuid });

/**
 * Person in charge — Phase 21 (`CR-003`), REQ-ORG-006.
 *
 * `PUT`, not `POST`: there is at most one holder, so the request states who it
 * is rather than adding to a collection. Handing over is the same call as
 * appointing the first one.
 */
const setPic = z.object({ userId: uuid }).strict();

module.exports = {
  createDepartment,
  updateDepartment,
  listDepartments,
  departmentParams,
  setPic,
};
