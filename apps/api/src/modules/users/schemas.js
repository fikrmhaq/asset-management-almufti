'use strict';

/** Request schemas for users — `06-api.md` §3.3, REQ-USER-001/002/003. */

const { z } = require('zod');

const { listQuerySchema } = require('../../query/listQuery');
const { MIN_PASSWORD_LENGTH } = require('../../auth/bootstrapService');

/**
 * The same length floor the bootstrap command applies, so an account created
 * through the API is not weaker than the first one.
 */
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `must be at least ${MIN_PASSWORD_LENGTH} characters`);

/** Widths from `04-data-model.md` §5.2.3. */
const createUser = z
  .object({
    username: z.string().trim().min(1, 'is required').max(25),
    password,
    firstName: z.string().trim().min(1, 'is required').max(150),
    lastName: z.string().trim().min(1, 'is required').max(150),
    contactInfo: z.string().trim().max(500).nullish(),
    institutionId: z.string().uuid('must be a UUID').nullish(),
    roleIds: z.array(z.string().uuid('must be a UUID')).optional(),
  })
  .strict();

/**
 * `username` is deliberately absent: it is the login identifier and appears in
 * audit records, so renaming it would rewrite who did what.
 *
 * `password` is absent too — changing a password is its own guarded operation,
 * not a field edit folded into a general update.
 */
const updateUser = z
  .object({
    firstName: z.string().trim().min(1).max(150),
    lastName: z.string().trim().min(1).max(150),
    contactInfo: z.string().trim().max(500).nullable(),
    institutionId: z.string().uuid('must be a UUID').nullable(),
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });

const listUsers = listQuerySchema({
  institutionId: z.string().uuid('must be a UUID').optional(),
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().min(1).optional(),
});

const userParams = z.object({ id: z.string().uuid('must be a UUID') });

const assignRole = z.object({ roleId: z.string().uuid('must be a UUID') }).strict();

const userRoleParams = z.object({
  id: z.string().uuid('must be a UUID'),
  roleId: z.string().uuid('must be a UUID'),
});

module.exports = {
  createUser,
  updateUser,
  listUsers,
  userParams,
  assignRole,
  userRoleParams,
};
