import { describe, it, expect } from 'vitest';

import { routeDefinitions } from './routes';

/**
 * Route coverage — `07-ui.md` §5.1, §5.2; `IMPLEMENTATION_PLAN.md` §16.4, §17.
 *
 * Asserts that every Phase 11 route resolves to a real screen rather than the
 * placeholder, and that every route still carries the permission code the API
 * enforces. A screen wired up without its guard, or a placeholder left behind
 * after its phase shipped, is exactly what this catches.
 */

/** Flattens the route tree into `path → route` entries. */
function flatten(routes, prefix = '') {
  const output = [];

  for (const route of routes) {
    const segment = route.index ? '' : (route.path ?? '');
    const path = [prefix, segment].filter(Boolean).join('/').replace(/\/+/g, '/');

    output.push({ path: path || '/', route });
    if (route.children) output.push(...flatten(route.children, path));
  }

  return output;
}

const routes = flatten(routeDefinitions);

/**
 * A layout route and its index child resolve to the same path — `/assets` is
 * both the grouping route and the list, and `/` is both the authenticated shell
 * and the dashboard. The guarded one is the screen, so it wins; falling back to
 * any element, then to the bare route, keeps unguarded paths inspectable too.
 */
const byPath = (path) => {
  const matches = routes.filter((entry) => entry.path === path);

  // A guarded screen declares `code` OR `anyOf` (`CR-010`, `CR-012`). Looking
  // only for `code` used to pick the authenticated shell over the dashboard
  // once `/` became an `anyOf` route, and then report it as unguarded.
  const guarded = (entry) => entry.route.element?.props?.code ?? entry.route.element?.props?.anyOf;

  return (
    matches.find(guarded) ?? matches.find((entry) => entry.route.element) ?? matches[0]
  );
};

/** The placeholder names the phase that will build it; a real screen does not. */
const isPlaceholder = (entry) => JSON.stringify(entry.route.element?.props ?? {}).includes('phase');

const PHASE_12_ROUTES = [
  ['/assets', 'asset:read'],
  ['/assets/new', 'asset:create'],
  ['/assets/:id', 'asset:read'],
  ['/assets/:id/edit', 'asset:update'],
  ['/assets/:id/units/:unitId', 'asset-unit:read'],
  ['/locations', 'location:read'],
  ['/locations/new', 'location:create'],
  ['/locations/:id', 'location:read'],
  ['/locations/:id/floor-plan', 'floor-plan:read'],
];

const PHASE_11_ROUTES = [
  ['/organization/institutions', 'institution:read'],
  ['/organization/institutions/:id', 'institution:read'],
  ['/organization/departments', 'department:read'],
  ['/organization/departments/:id', 'department:read'],
  ['/organization/users', 'user:read'],
  ['/organization/users/:id', 'user:read'],
  ['/organization/roles', 'role:read'],
  ['/organization/roles/:id', 'role:read'],
  ['/classifications', 'classification:read'],
  ['/reference/attribute-definitions', 'attribute-definition:read'],
  ['/reference/lookups', 'measurement-unit:read'],
];

/** `IMPLEMENTATION_PLAN.md` §19.0 — Vendors included, per `DEC-034`. */
const PHASE_13_ROUTES = [
  ['/procurement/suppliers', 'supplier:read'],
  ['/procurement/suppliers/:id', 'supplier:read'],
  ['/procurement/contracts', 'contract:read'],
  ['/procurement/contracts/new', 'contract:create'],
  ['/procurement/contracts/:id', 'contract:read'],
  ['/procurement/contracts/:id/edit', 'contract:update'],
  ['/operations/vendors', 'vendor:read'],
  ['/operations/vendors/:id', 'vendor:read'],
];

/** `IMPLEMENTATION_PLAN.md` §20.0 — no borrowing `/edit`, no transaction edit. */
const PHASE_14_ROUTES = [
  ['/operations/borrowings', 'borrowing:read'],
  ['/operations/borrowings/new', 'borrowing:create'],
  ['/operations/borrowings/:id', 'borrowing:read'],
  ['/operations/transactions', 'transaction:read'],
  ['/operations/transactions/new', 'transaction:create'],
  ['/operations/transactions/:id', 'transaction:read'],
];

/**
 * `IMPLEMENTATION_PLAN.md` §21 — one dynamic report route (`DEC-056`), and the
 * dashboard at `/`, which `CR-012` gave a §5.9 route row of its own (closing
 * `GAP-012`).
 *
 * `/` is listed against `report:read` because that code still opens a card on
 * it. It is no longer the ONLY code that does — `asset-unit:read` opens three
 * — and the assertion below admits any code in the route's `anyOf` set.
 */
const PHASE_15_ROUTES = [
  ['/', 'report:read'],
  ['/', 'asset-unit:read'],
  ['/reports', 'report:read'],
  ['/reports/:report', 'report:read'],
  ['/audit', 'audit-log:read'],
];

const BUILT_ROUTES = [
  ...PHASE_11_ROUTES,
  ...PHASE_12_ROUTES,
  ...PHASE_13_ROUTES,
  ...PHASE_14_ROUTES,
  ...PHASE_15_ROUTES,
];

describe('built routes', () => {
  /**
   * A route declares `code` — one permission — or `anyOf`, a set of which one
   * suffices (`CR-010`). The Reports section uses the second, because the unit
   * inventory requires `asset-unit:read` while its eight neighbours require
   * `report:read`; the code named here must be among them either way.
   */
  const guardsWith = (entry, permission) => {
    const { code, anyOf } = entry.route.element.props;
    return anyOf ? anyOf.includes(permission) : code === permission;
  };

  it.each(BUILT_ROUTES)('%s exists and is guarded by %s', (path, permission) => {
    const entry = byPath(path);

    expect(entry, `${path} is missing from the route table`).toBeDefined();
    expect(guardsWith(entry, permission), `${path} does not require ${permission}`).toBe(true);
  });

  it.each(BUILT_ROUTES)('%s renders a real screen, not a placeholder', (path) => {
    expect(isPlaceholder(byPath(path)), `${path} is still a placeholder`).toBe(false);
  });
});

describe('the route table as a whole', () => {
  it('has no placeholder left anywhere — Phase 15 was the last one', () => {
    const remaining = routes.filter((entry) => entry.route.element && isPlaceholder(entry));

    expect(remaining.map((entry) => entry.path)).toEqual([]);
  });
});

describe('every guarded route', () => {
  it('carries a `{resource}:{action}` permission code', () => {
    const guarded = routes.filter((entry) => entry.route.element?.props?.code);

    expect(guarded.length).toBeGreaterThan(20);
    for (const entry of guarded) {
      expect(entry.route.element.props.code, entry.path).toMatch(/^[a-z-]+:[a-z-]+$/);
    }
  });
});
