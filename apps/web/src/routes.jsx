import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import { RequireAuth, RequirePermission } from '@/auth/guards';
import { AppLayout } from '@/components/shell/AppLayout';
import { LoadingState } from '@/components/ui/states';
import { LoginPage } from '@/pages/LoginPage';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { NotFoundPage, RouteErrorBoundary } from '@/pages/placeholders';
import { REPORT_PERMISSIONS } from '@/pages/reports/registry';
import { DASHBOARD_PERMISSIONS } from '@/pages/dashboard/cards';

const InstitutionsPage = lazy(() =>
  import('@/pages/organization/InstitutionsPage').then((m) => ({ default: m.InstitutionsPage }))
);
const InstitutionDetailPage = lazy(() =>
  import('@/pages/organization/InstitutionDetailPage').then((m) => ({
    default: m.InstitutionDetailPage,
  }))
);
const InventoryCodeFormatPage = lazy(() =>
  import('@/pages/organization/InventoryCodeFormatPage').then((m) => ({
    default: m.InventoryCodeFormatPage,
  }))
);
const DepartmentsPage = lazy(() =>
  import('@/pages/organization/DepartmentsPage').then((m) => ({ default: m.DepartmentsPage }))
);
const DepartmentDetailPage = lazy(() =>
  import('@/pages/organization/DepartmentDetailPage').then((m) => ({
    default: m.DepartmentDetailPage,
  }))
);
const UsersPage = lazy(() =>
  import('@/pages/organization/UsersPage').then((m) => ({ default: m.UsersPage }))
);
const UserDetailPage = lazy(() =>
  import('@/pages/organization/UserDetailPage').then((m) => ({ default: m.UserDetailPage }))
);
const RolesPage = lazy(() =>
  import('@/pages/organization/RolesPage').then((m) => ({ default: m.RolesPage }))
);
const RoleDetailPage = lazy(() =>
  import('@/pages/organization/RoleDetailPage').then((m) => ({ default: m.RoleDetailPage }))
);
const AssetsPage = lazy(() =>
  import('@/pages/assets/AssetsPage').then((m) => ({ default: m.AssetsPage }))
);
const AssetFormPage = lazy(() =>
  import('@/pages/assets/AssetFormPage').then((m) => ({ default: m.AssetFormPage }))
);
const AssetDetailPage = lazy(() =>
  import('@/pages/assets/AssetDetailPage').then((m) => ({ default: m.AssetDetailPage }))
);
const AssetUnitsPage = lazy(() =>
  import('@/pages/assets/AssetUnitsPage').then((m) => ({ default: m.AssetUnitsPage }))
);
const AssetUnitDetailPage = lazy(() =>
  import('@/pages/assets/AssetUnitDetailPage').then((m) => ({ default: m.AssetUnitDetailPage }))
);
const UnitLabelsPage = lazy(() =>
  import('@/pages/assets/UnitLabelsPage').then((m) => ({ default: m.UnitLabelsPage }))
);
const ScanLandingPage = lazy(() =>
  import('@/pages/assets/ScanLandingPage').then((m) => ({ default: m.ScanLandingPage }))
);
const LocationsPage = lazy(() =>
  import('@/pages/locations/LocationsPage').then((m) => ({ default: m.LocationsPage }))
);
const LocationFormPage = lazy(() =>
  import('@/pages/locations/LocationFormPage').then((m) => ({ default: m.LocationFormPage }))
);
const FloorPlanPage = lazy(() =>
  import('@/pages/locations/LocationDetailPage').then((m) => ({ default: m.FloorPlanPage }))
);
const LocationDetailPage = lazy(() =>
  import('@/pages/locations/LocationDetailPage').then((m) => ({ default: m.LocationDetailPage }))
);
const ClassificationsPage = lazy(() =>
  import('@/pages/reference/ClassificationsPage').then((m) => ({ default: m.ClassificationsPage }))
);
const AttributeDefinitionsPage = lazy(() =>
  import('@/pages/reference/AttributeDefinitionsPage').then((m) => ({
    default: m.AttributeDefinitionsPage,
  }))
);
const LookupsPage = lazy(() =>
  import('@/pages/reference/LookupsPage').then((m) => ({ default: m.LookupsPage }))
);
const SuppliersPage = lazy(() =>
  import('@/pages/procurement/SuppliersPage').then((m) => ({ default: m.SuppliersPage }))
);
const SupplierDetailPage = lazy(() =>
  import('@/pages/procurement/SupplierDetailPage').then((m) => ({ default: m.SupplierDetailPage }))
);
const ContractsPage = lazy(() =>
  import('@/pages/procurement/ContractsPage').then((m) => ({ default: m.ContractsPage }))
);
const ContractFormPage = lazy(() =>
  import('@/pages/procurement/ContractFormPage').then((m) => ({ default: m.ContractFormPage }))
);
const ContractDetailPage = lazy(() =>
  import('@/pages/procurement/ContractDetailPage').then((m) => ({ default: m.ContractDetailPage }))
);
const VendorsPage = lazy(() =>
  import('@/pages/operations/VendorsPage').then((m) => ({ default: m.VendorsPage }))
);
const VendorDetailPage = lazy(() =>
  import('@/pages/operations/VendorDetailPage').then((m) => ({ default: m.VendorDetailPage }))
);
const BorrowingsPage = lazy(() =>
  import('@/pages/operations/BorrowingsPage').then((m) => ({ default: m.BorrowingsPage }))
);
const BorrowingFormPage = lazy(() =>
  import('@/pages/operations/BorrowingFormPage').then((m) => ({ default: m.BorrowingFormPage }))
);
const BorrowingDetailPage = lazy(() =>
  import('@/pages/operations/BorrowingDetailPage').then((m) => ({ default: m.BorrowingDetailPage }))
);
const TransactionsPage = lazy(() =>
  import('@/pages/operations/TransactionsPage').then((m) => ({ default: m.TransactionsPage }))
);
const TransactionFormPage = lazy(() =>
  import('@/pages/operations/TransactionFormPage').then((m) => ({ default: m.TransactionFormPage }))
);
const TransactionDetailPage = lazy(() =>
  import('@/pages/operations/TransactionDetailPage').then((m) => ({
    default: m.TransactionDetailPage,
  }))
);
const DashboardPage = lazy(() =>
  import('@/pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const ReportsPage = lazy(() =>
  import('@/pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const ReportPage = lazy(() =>
  import('@/pages/reports/ReportPage').then((m) => ({ default: m.ReportPage }))
);
const AuditPage = lazy(() =>
  import('@/pages/audit/AuditPage').then((m) => ({ default: m.AuditPage }))
);

/**
 * Route architecture — `IMPLEMENTATION_PLAN.md` §16.4, `07-ui.md` §5.
 *
 * Every route in the UI specification exists here, guarded by the same
 * permission code the API enforces (`06-api.md` §1.3) and the sidebar reads
 * (`navigation.js`).
 *
 * As of Phase 15 every one of them resolves to a real screen: the
 * `ModulePlaceholder` that stood in for unbuilt modules from Phase 10 onward is
 * no longer referenced here, and `routes.test.jsx` asserts that none remains.
 *
 * A DATA router (`createBrowserRouter`), not `<BrowserRouter>`, because three
 * things depend on it: `useMatches` for the breadcrumb trail, `errorElement` for
 * the global error boundary (§16.3), and `useBlocker` — which Phase 9's
 * `useUnsavedChanges` (§15.6) calls and which only functions under a data router.
 *
 * CODE SPLITTING (§22.10, Phase 16). Every screen above is `React.lazy`, so a
 * visitor downloads the shell and the one route they asked for rather than all
 * thirty-six. The shell itself — login, forbidden, not-found and the error
 * boundary — stays eager: those are what render when something has gone wrong,
 * and a chunk fetch is the wrong thing to depend on at that moment.
 *
 * Deliberately NOT React Router's own `lazy` route property: that would remove
 * `element` from the route definition, and `routes.test.jsx` reads the
 * permission code off it to prove every route is guarded. Splitting the
 * COMPONENT keeps the guard inspectable and the chunking identical.
 */

/** A route whose screen exists, behind the API's own permission code. */
function screenRoute({ path, permission, anyPermission, element, crumb, index = false }) {
  return {
    ...(index ? { index: true } : { path }),
    handle: crumb ? { crumb } : undefined,
    element: (
      <RequirePermission code={permission} anyOf={anyPermission}>
        <Suspense fallback={<LoadingState rows={4} columns={3} />}>{element}</Suspense>
      </RequirePermission>
    ),
  };
}

export const routeDefinitions = [
  { path: '/login', element: <LoginPage /> },
  { path: '/forbidden', element: <ForbiddenPage /> },

  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: <RouteErrorBoundary />,
    handle: { crumb: 'crumbs.home' },
    children: [
      /**
       * Dashboard — `07-ui.md` §5.9, which `CR-012` wrote. It previously had no
       * route row at all (`GAP-012`, now closed).
       *
       * `anyPermission`, not `report:read`: the dashboard is a container of
       * independently gated cards, and gating the container on one of them hid
       * the whole screen from a Department PIC who holds a real capability
       * inside it. The set is DERIVED from the cards, so a card cannot be added
       * without its permission being admitted. Same mechanism as the Reports
       * section below (`CR-010`).
       */
      screenRoute({
        index: true,
        anyPermission: DASHBOARD_PERMISSIONS,
        element: <DashboardPage />,
      }),

      /**
       * Scan landing — REQ-UNIT-011, two shapes. Inside the protected tree
       * deliberately: the guard already carries `from` in navigation state, so
       * an unauthenticated scan returns here once the user signs in.
       *
       * `/u?c=…` is what a label minted since `CR-008` carries, because a code
       * may contain a slash and a slash cannot cross a path segment — `%2F`
       * there is decoded by the router before it matches, and by proxies before
       * that.
       *
       * `/u/:inventoryCode` stays, permanently. Every label printed before the
       * change carries it, and a sticker cannot be recalled.
       */
      screenRoute({
        path: 'u',
        permission: 'asset-unit:read',
        element: <ScanLandingPage />,
        crumb: 'crumbs.scan',
      }),
      screenRoute({
        path: 'u/:inventoryCode',
        permission: 'asset-unit:read',
        element: <ScanLandingPage />,
        crumb: 'crumbs.scan',
      }),

      /**
       * The Asset Unit collection — `CR-005`.
       *
       * `asset-unit:read`, deliberately NOT `asset:read`: a unit is an
       * operational resource that may be scoped to a Department PIC, while the
       * Asset it belongs to is a master resource they do not administer. This is
       * the only unit list not nested under a parent the caller may be unable to
       * open, which is what makes it a usable discovery surface for that tier.
       */
      screenRoute({
        path: 'asset-units',
        permission: 'asset-unit:read',
        element: <AssetUnitsPage />,
        crumb: 'crumbs.assetUnits',
      }),

      // Asset core — §5.3.
      {
        path: 'assets',
        handle: { crumb: 'crumbs.assets' },
        children: [
          screenRoute({ index: true, permission: 'asset:read', element: <AssetsPage /> }),
          screenRoute({
            path: 'new',
            permission: 'asset:create',
            element: <AssetFormPage />,
            crumb: 'crumbs.new',
          }),
          screenRoute({
            path: ':id',
            permission: 'asset:read',
            element: <AssetDetailPage />,
            crumb: (params) => params.id,
          }),
          screenRoute({
            path: ':id/edit',
            permission: 'asset:update',
            element: <AssetFormPage />,
            crumb: 'crumbs.edit',
          }),
          screenRoute({
            path: ':id/units/:unitId',
            permission: 'asset-unit:read',
            element: <AssetUnitDetailPage />,
            crumb: (params) => params.unitId,
          }),
          // Labels — REQ-UNIT-010. Routes rather than dialogs so `@media print`
          // can hide the shell and leave only labels on the paper.
          screenRoute({
            path: ':id/labels',
            permission: 'asset-unit:read',
            element: <UnitLabelsPage />,
            crumb: 'crumbs.labels',
          }),
          screenRoute({
            path: ':id/units/:unitId/label',
            permission: 'asset-unit:read',
            element: <UnitLabelsPage />,
            crumb: 'crumbs.labels',
          }),
        ],
      },
      {
        path: 'locations',
        handle: { crumb: 'crumbs.locations' },
        children: [
          screenRoute({ index: true, permission: 'location:read', element: <LocationsPage /> }),
          screenRoute({
            path: 'new',
            permission: 'location:create',
            element: <LocationFormPage />,
            crumb: 'crumbs.new',
          }),
          screenRoute({
            path: ':id',
            permission: 'location:read',
            element: <LocationDetailPage />,
            crumb: (params) => params.id,
          }),
          screenRoute({
            path: ':id/floor-plan',
            permission: 'floor-plan:read',
            element: <FloorPlanPage />,
            crumb: 'crumbs.floorPlan',
          }),
        ],
      },
      screenRoute({
        path: 'classifications',
        permission: 'classification:read',
        element: <ClassificationsPage />,
        crumb: 'crumbs.classifications',
      }),

      // Reference — §5.2.
      {
        path: 'reference',
        handle: { crumb: 'crumbs.reference' },
        children: [
          screenRoute({
            path: 'attribute-definitions',
            permission: 'attribute-definition:read',
            element: <AttributeDefinitionsPage />,
            crumb: 'crumbs.attributeDefinitions',
          }),
          screenRoute({
            path: 'lookups',
            permission: 'measurement-unit:read',
            element: <LookupsPage />,
            crumb: 'crumbs.lookups',
          }),
        ],
      },

      // Procurement — §5.5.
      {
        path: 'procurement',
        handle: { crumb: 'crumbs.procurement' },
        children: [
          {
            path: 'suppliers',
            handle: { crumb: 'crumbs.suppliers' },
            children: [
              screenRoute({ index: true, permission: 'supplier:read', element: <SuppliersPage /> }),
              screenRoute({
                path: ':id',
                permission: 'supplier:read',
                element: <SupplierDetailPage />,
                crumb: (params) => params.id,
              }),
            ],
          },
          {
            path: 'contracts',
            handle: { crumb: 'crumbs.contracts' },
            children: [
              screenRoute({ index: true, permission: 'contract:read', element: <ContractsPage /> }),
              // The only `/new` and `/edit` routes outside asset core: eleven
              // fields is what `07-ui.md` §4.3 wants a page for (`DEC-033`).
              screenRoute({
                path: 'new',
                permission: 'contract:create',
                element: <ContractFormPage />,
                crumb: 'crumbs.new',
              }),
              screenRoute({
                path: ':id',
                permission: 'contract:read',
                element: <ContractDetailPage />,
                crumb: (params) => params.id,
              }),
              screenRoute({
                path: ':id/edit',
                permission: 'contract:update',
                element: <ContractFormPage />,
                crumb: 'crumbs.edit',
              }),
            ],
          },
        ],
      },

      // Operations — §5.6.
      {
        path: 'operations',
        handle: { crumb: 'crumbs.operations' },
        children: [
          // Vendors sit in this nav group per §5.6, but are procurement work and
          // were built in Phase 13 with the rest of it (`DEC-034`, `DEC-008`).
          {
            path: 'vendors',
            handle: { crumb: 'crumbs.vendors' },
            children: [
              screenRoute({ index: true, permission: 'vendor:read', element: <VendorsPage /> }),
              screenRoute({
                path: ':id',
                permission: 'vendor:read',
                element: <VendorDetailPage />,
                crumb: (params) => params.id,
              }),
            ],
          },
          {
            path: 'borrowings',
            handle: { crumb: 'crumbs.borrowings' },
            children: [
              screenRoute({
                index: true,
                permission: 'borrowing:read',
                element: <BorrowingsPage />,
              }),
              screenRoute({
                path: 'new',
                permission: 'borrowing:create',
                element: <BorrowingFormPage />,
                crumb: 'crumbs.new',
              }),
              // No `/edit`: a DRAFT is edited in place on its detail page
              // (`DEC-042`), and past DRAFT the API refuses the PATCH.
              screenRoute({
                path: ':id',
                permission: 'borrowing:read',
                element: <BorrowingDetailPage />,
                crumb: (params) => params.id,
              }),
            ],
          },
          {
            path: 'transactions',
            handle: { crumb: 'crumbs.transactions' },
            children: [
              screenRoute({
                index: true,
                permission: 'transaction:read',
                element: <TransactionsPage />,
              }),
              screenRoute({
                path: 'new',
                permission: 'transaction:create',
                element: <TransactionFormPage />,
                crumb: 'crumbs.new',
              }),
              // Read-only, and there is no edit route to add: REQ-TXN-007.
              screenRoute({
                path: ':id',
                permission: 'transaction:read',
                element: <TransactionDetailPage />,
                crumb: (params) => params.id,
              }),
            ],
          },
        ],
      },

      // Organization — §5.1.
      {
        path: 'organization',
        handle: { crumb: 'crumbs.organization' },
        children: [
          {
            path: 'institutions',
            handle: { crumb: 'crumbs.institutions' },
            children: [
              screenRoute({
                index: true,
                permission: 'institution:read',
                element: <InstitutionsPage />,
              }),
              screenRoute({
                path: ':id',
                permission: 'institution:read',
                element: <InstitutionDetailPage />,
                crumb: (params) => params.id,
              }),
            ],
          },
          /**
           * The caller's own institution's code format — Phase 25 (`CR-006`).
           *
           * A sibling of `institutions` rather than a path beneath it, and
           * gated on `inventory-code-format:read` rather than
           * `institution:read`, precisely because the tier that needs it cannot
           * hold `institution:read` at all (`BR-015`).
           */
          screenRoute({
            path: 'inventory-code-format',
            permission: 'inventory-code-format:read',
            element: <InventoryCodeFormatPage />,
            crumb: 'crumbs.inventoryCodeFormat',
          }),
          {
            path: 'departments',
            handle: { crumb: 'crumbs.departments' },
            children: [
              screenRoute({
                index: true,
                permission: 'department:read',
                element: <DepartmentsPage />,
              }),
              screenRoute({
                path: ':id',
                permission: 'department:read',
                element: <DepartmentDetailPage />,
                crumb: (params) => params.id,
              }),
            ],
          },
          {
            path: 'users',
            handle: { crumb: 'crumbs.users' },
            children: [
              screenRoute({ index: true, permission: 'user:read', element: <UsersPage /> }),
              screenRoute({
                path: ':id',
                permission: 'user:read',
                element: <UserDetailPage />,
                crumb: (params) => params.id,
              }),
            ],
          },
          {
            path: 'roles',
            handle: { crumb: 'crumbs.roles' },
            children: [
              screenRoute({ index: true, permission: 'role:read', element: <RolesPage /> }),
              screenRoute({
                path: ':id',
                permission: 'role:read',
                element: <RoleDetailPage />,
                crumb: (params) => params.id,
              }),
            ],
          },
        ],
      },

      // Reports and audit — §5.7, §5.8, consuming the §21.0 APIs.
      {
        path: 'reports',
        handle: { crumb: 'crumbs.reports' },
        children: [
          /*
            Any code that opens a report, not `report:read` alone (`CR-010`).
            The unit inventory requires `asset-unit:read`, which is how a
            Department PIC reaches it while the eight aggregates stay closed.
            Both screens narrow further from here — the landing page filters its
            cards, and `ReportPage` refuses a report the caller cannot open.
          */
          screenRoute({
            index: true,
            anyPermission: REPORT_PERMISSIONS,
            element: <ReportsPage />,
          }),
          // One dynamic route, N registry entries (`DEC-056`).
          screenRoute({
            path: ':report',
            anyPermission: REPORT_PERMISSIONS,
            element: <ReportPage />,
            crumb: (params) => params.report,
          }),
        ],
      },
      screenRoute({
        path: 'audit',
        permission: 'audit-log:read',
        element: <AuditPage />,
        crumb: 'crumbs.audit',
      }),

      { path: '*', element: <NotFoundPage /> },
    ],
  },

  { path: '*', element: <Navigate to="/" replace /> },
];

export function createAppRouter() {
  return createBrowserRouter(routeDefinitions);
}
