import { attributeDefinitionsApi, categoriesApi, lookupApis } from '@/api/reference';
import { departmentsApi, institutionsApi, rolesApi, usersApi } from '@/api/organization';
import { createResourceHooks } from '@/hooks/useResource';
import { queryKeys } from '@/lib/queryKeys';

/**
 * The resource hook sets used by the organization and reference screens —
 * `IMPLEMENTATION_PLAN.md` §17.
 *
 * Declared in one place so a screen imports the hooks for its resource rather
 * than re-binding an endpoint to a cache key, which is exactly where the two
 * would drift.
 */

export const institutions = createResourceHooks({
  api: institutionsApi,
  keys: queryKeys.institutions,
  labelKey: 'resources.institution',
});

export const departments = createResourceHooks({
  api: departmentsApi,
  keys: queryKeys.departments,
  labelKey: 'resources.department',
});

export const users = createResourceHooks({
  api: usersApi,
  keys: queryKeys.users,
  labelKey: 'resources.user',
});

export const roles = createResourceHooks({
  api: rolesApi,
  keys: queryKeys.roles,
  labelKey: 'resources.role',
});

export const attributeDefinitions = createResourceHooks({
  api: attributeDefinitionsApi,
  keys: queryKeys.attributeDefinitions,
  labelKey: 'resources.attributeDefinition',
});

/** Read-only (`06-api.md` §4.2) — the write hooks exist but are never used. */
export const categories = createResourceHooks({
  api: categoriesApi,
  keys: queryKeys.categories,
  labelKey: 'resources.category',
});

/**
 * The five editable lookups — `06-api.md` §4.4, §4.5.
 *
 * `07-ui.md` §5.2 makes them one tabbed page because they share one shape;
 * this is the same list, bound to their cache keys.
 */
export const LOOKUP_RESOURCES = [
  {
    key: 'measurement-units',
    label: 'Measurement units',
    singular: 'Measurement unit',
    permission: 'measurement-unit',
    keyField: 'id',
    hooks: createResourceHooks({
      api: lookupApis['measurement-units'],
      keys: queryKeys.measurementUnits,
      labelKey: 'resources.measurementUnit',
    }),
  },
  {
    key: 'contract-types',
    label: 'Contract types',
    singular: 'Contract type',
    permission: 'contract-type',
    keyField: 'id',
    hooks: createResourceHooks({
      api: lookupApis['contract-types'],
      keys: queryKeys.contractTypes,
      labelKey: 'resources.contractType',
    }),
  },
  {
    key: 'funding-sources',
    label: 'Funding sources',
    singular: 'Funding source',
    permission: 'funding-source',
    keyField: 'id',
    /**
     * A business abbreviation ALONGSIDE the generated key — `CR-007`,
     * REQ-REF-007. Mirrors the server's `fields: ['code']`.
     *
     * Not `naturalKey`, which means something else: there the code IS the key,
     * supplied on create and never edited. This one sits next to an identity
     * key, may be absent on a row that predates the column, and is editable
     * precisely so it can be filled in afterwards.
     */
    businessCode: true,
    hooks: createResourceHooks({
      api: lookupApis['funding-sources'],
      keys: queryKeys.fundingSources,
      labelKey: 'resources.fundingSource',
    }),
  },
  {
    key: 'transaction-types',
    label: 'Transaction types',
    singular: 'Transaction type',
    permission: 'transaction-type',
    keyField: 'id',
    hooks: createResourceHooks({
      api: lookupApis['transaction-types'],
      keys: queryKeys.transactionTypes,
      labelKey: 'resources.transactionType',
    }),
  },
  {
    // Natural key: `CHAR(12)`, supplied on create and never edited.
    key: 'account-codes',
    label: 'Account codes',
    singular: 'Account code',
    permission: 'account-code',
    keyField: 'code',
    naturalKey: true,
    hooks: createResourceHooks({
      api: lookupApis['account-codes'],
      keys: queryKeys.accountCodes,
      labelKey: 'resources.accountCode',
    }),
  },
];
