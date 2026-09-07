import { Navigate, useLocation } from 'react-router-dom';

import { useSession, usePermission, useAnyPermission } from './useSession';
import { ForbiddenPage } from '@/pages/ForbiddenPage';

/**
 * Route and action guards — `07-ui.md` §6, `IMPLEMENTATION_PLAN.md` §16.2.
 *
 * Backend authorization remains authoritative (`IMPLEMENTATION_PLAN.md` §32).
 * These decide what is worth showing, not what is allowed.
 */

/**
 * Requires a signed-in session.
 *
 * An anonymous visitor is sent to the login screen with the path they wanted, so
 * signing in returns them there rather than dumping them on the dashboard.
 */
export function RequireAuth({ children }) {
  const { isAuthenticated } = useSession();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

/**
 * Requires a permission code.
 *
 * Renders a `FORBIDDEN` page rather than redirecting. `07-ui.md` §6 is explicit:
 * a direct URL visit to a page the user cannot reach must show why, not a blank
 * screen and not a client-side redirect loop.
 */
/**
 * Route guard.
 *
 * `code` is one permission. `anyOf` is a set of which ONE suffices, for a
 * section whose screens are not all gated the same way — the Reports section
 * since `CR-010`, where the unit inventory requires `asset-unit:read` and the
 * other eight require `report:read`. Gating that route on a single code would
 * hide from a Department PIC the one report they are entitled to.
 *
 * A route admitting `anyOf` is a door, not a decision: the screen behind it is
 * responsible for what the caller may actually open.
 */
export function RequirePermission({ code, anyOf, children }) {
  const codes = anyOf ?? [];
  const allowedByOne = usePermission(code);
  const allowedByAny = useAnyPermission(codes);

  if (anyOf ? !allowedByAny : !allowedByOne) {
    return <ForbiddenPage requiredPermission={code ?? codes.join(', ')} />;
  }

  return children;
}

/**
 * Action guard — renders children only when the code is held.
 *
 * HIDDEN, not disabled (`07-ui.md` §6). A disabled button advertises an action
 * the user will never be able to take and invites them to ask why.
 */
export function Can({ code, fallback = null, children }) {
  const allowed = usePermission(code);
  return allowed ? children : fallback;
}
