'use strict';

/** Request schemas for roles — `06-api.md` §3.4, REQ-ROLE-001/007/008. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');

const createRole = z
  .object({
    name: z.string().trim().min(1, 'is required').max(50),
    isSystemWide: z.boolean().default(false),
    // Left without a default so the service can tell "omitted" from "false" and
    // only refuse a scoped caller who actually tried to set it (REQ-ROLE-009).
    isInstitutionAssignable: z.boolean().optional(),
    // Phase 22 (`CR-003`), REQ-ROLE-011.
    isPicScoped: z.boolean().default(false),
  })
  .strict();

const updateRole = z
  .object({
    name: z.string().trim().min(1).max(50),
    isSystemWide: z.boolean(),
    isInstitutionAssignable: z.boolean(),
    isPicScoped: z.boolean(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listRoles = listQuerySchema({ q: z.string().trim().min(1).optional() });

const roleParams = z.object({ id: z.string().uuid('must be a UUID') });

/** PUT replaces the whole granted set, so an empty array is valid and means none. */
const replacePermissions = z.object({ permissionCodes: z.array(z.string().min(1)) }).strict();

module.exports = { createRole, updateRole, listRoles, roleParams, replacePermissions };
