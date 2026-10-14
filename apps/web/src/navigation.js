import {
  ArrowLeftRight,
  Boxes,
  Building,
  Building2,
  ChartColumn,
  ClipboardList,
  FileText,
  FolderTree,
  Hash,
  LayoutDashboard,
  Library,
  MapPin,
  Package,
  Receipt,
  ScrollText,
  ShieldCheck,
  Store,
  Tags,
  Truck,
  Users,
  Warehouse,
  DoorOpen,
  PackageOpen,
  Flag,
  Workflow,
  ClipboardCheck,
  Files,
  Inbox,
  BellDot,
} from 'lucide-react';

import { REPORT_PERMISSIONS } from '@/pages/reports/registry';
import { DASHBOARD_PERMISSIONS } from '@/pages/dashboard/cards';

/**
 * Navigation model — `07-ui.md` §2, `IMPLEMENTATION_PLAN.md` §16.3.
 *
 * The grouping mirrors the module sections every other document uses, so a
 * reader of `02-requirements.md`'s headings already knows where things live.
 *
 * Each entry carries the permission code that reveals it. `07-ui.md` §6 requires
 * items to be HIDDEN, not disabled, when the user holds no `*:read` for that
 * module — a nav full of links that answer 403 is worse than a shorter nav.
 *
 * One declaration drives the sidebar, and the same codes guard the routes
 * (`routes.jsx`), so what is visible and what is reachable cannot drift apart.
 *
 * Every ITEM carries an icon as well as its group. The icon is what a collapsed
 * sidebar has left to identify a destination by — the previous rail showed the
 * first letter of the label, which made Assets and Audit log both "A" and
 * changed meaning entirely when the language did. An icon does neither.
 *
 * Icons are decorative here: the label is always present as the accessible name,
 * visually hidden when the rail is collapsed.
 */
export const NAVIGATION = Object.freeze([
  {
    labelKey: 'nav.groups.dashboard',
    icon: LayoutDashboard,
    items: [
      {
        labelKey: 'nav.items.dashboard',
        to: '/',
        /*
          Any code that opens a dashboard card, not `report:read` alone
          (`CR-012` `DEC-P`). The dashboard is a container of independently
          gated cards, exactly like the Reports section below, and gating the
          container on one of them hid the entire screen from a Department PIC
          who holds `asset-unit:read` and has cards to see.

          `report:read` is not weakened — it still gates precisely the
          institution-wide metrics it always did. It simply stops being the only
          key to the front door.
        */
        anyPermission: DASHBOARD_PERMISSIONS,
        end: true,
        icon: LayoutDashboard,
      },
    ],
  },
  {
    labelKey: 'nav.groups.assets',
    icon: Boxes,
    items: [
      { labelKey: 'nav.items.assets', to: '/assets', permission: 'asset:read', icon: Package },
      /**
       * `CR-005`. Gated by `asset-unit:read`, so every tier sees it — and a
       * Department PIC, who holds no `asset:read`, gets a discovery surface for
       * the units they are responsible for without the Assets entry above.
       *
       * Listed after Assets rather than before it: for the two broader tiers the
       * master registry is still the primary way in, and units are the drill-down.
       */
      {
        labelKey: 'nav.items.assetUnits',
        to: '/asset-units',
        permission: 'asset-unit:read',
        icon: Boxes,
      },
      /**
       * REQ-REQUEST-025. A Room PIC files reports from their rooms; a reviewer
       * works the queue, opened on what is waiting.
       */
      {
        labelKey: 'nav.items.myRooms',
        to: '/unit-reports/my-rooms',
        permission: 'asset-unit-report:create',
        icon: DoorOpen,
      },
      {
        labelKey: 'nav.items.unitReports',
        to: '/unit-reports?status=PENDING',
        permission: 'asset-unit-report:review',
        icon: Flag,
      },
      {
        labelKey: 'nav.items.locations',
        to: '/locations',
        permission: 'location:read',
        icon: MapPin,
      },
      {
        labelKey: 'nav.items.classifications',
        to: '/classifications',
        permission: 'classification:read',
        icon: FolderTree,
      },
    ],
  },
  {
    labelKey: 'nav.groups.procurement',
    icon: FileText,
    items: [
      {
        labelKey: 'nav.items.suppliers',
        to: '/procurement/suppliers',
        permission: 'supplier:read',
        icon: Truck,
      },
      {
        labelKey: 'nav.items.contracts',
        to: '/procurement/contracts',
        permission: 'contract:read',
        icon: FileText,
      },
    ],
  },
  {
    labelKey: 'nav.groups.operations',
    icon: ClipboardList,
    items: [
      {
        labelKey: 'nav.items.vendors',
        to: '/operations/vendors',
        permission: 'vendor:read',
        icon: Store,
      },
      {
        labelKey: 'nav.items.borrowings',
        to: '/operations/borrowings',
        permission: 'borrowing:read',
        icon: ArrowLeftRight,
      },
      {
        labelKey: 'nav.items.transactions',
        to: '/operations/transactions',
        permission: 'transaction:read',
        icon: Receipt,
      },
      // §73: quantity-based stock, issued against requests.
      {
        labelKey: 'nav.items.consumables',
        to: '/consumables',
        permission: 'consumable:read',
        icon: PackageOpen,
      },
    ],
  },
  {
    labelKey: 'nav.groups.organization',
    icon: Building2,
    items: [
      {
        labelKey: 'nav.items.institutions',
        to: '/organization/institutions',
        permission: 'institution:read',
        icon: Building2,
      },
      /**
       * Phase 25 (`CR-006`). Gated on `inventory-code-format:read`, so an
       * institution administrator sees it even though the Institutions entry
       * above is invisible to them — `institution:read` is system-wide-only
       * (`BR-015`), and this is the only route by which their tier reaches the
       * builder at all.
       */
      {
        labelKey: 'nav.items.inventoryCodeFormat',
        to: '/organization/inventory-code-format',
        permission: 'inventory-code-format:read',
        icon: Hash,
      },
      // REQ-REQUEST-023 — gated on its own permission, as above.
      {
        labelKey: 'nav.items.teacherStorageRoom',
        to: '/organization/teacher-storage-room',
        permission: 'teacher-storage-room:read',
        icon: Warehouse,
      },
      {
        labelKey: 'nav.items.departments',
        to: '/organization/departments',
        permission: 'department:read',
        icon: Building,
      },
      {
        labelKey: 'nav.items.users',
        to: '/organization/users',
        permission: 'user:read',
        icon: Users,
      },
      {
        labelKey: 'nav.items.roles',
        to: '/organization/roles',
        permission: 'role:read',
        icon: ShieldCheck,
      },
      /**
       * Phase 36 (`CR-014`). Not shown to a PIC-scoped user: no
       * `workflow-definition:*` code is in the `CR-004` ceiling, so the session
       * never carries it.
       */
      {
        labelKey: 'nav.items.workflows',
        to: '/organization/workflows',
        permission: 'workflow-definition:read',
        icon: Workflow,
      },
      {
        labelKey: 'nav.items.attributeDefinitions',
        to: '/reference/attribute-definitions',
        permission: 'attribute-definition:read',
        icon: Tags,
      },
      {
        labelKey: 'nav.items.lookups',
        to: '/reference/lookups',
        permission: 'measurement-unit:read',
        icon: Library,
      },
    ],
  },
  /**
   * Requests — Phase 37 (`CR-014`), `07-ui.md` §5.10. Hidden from a PIC-scoped
   * user: no request code is in the `CR-004` ceiling. "Awaiting my action"
   * arrives with workflow execution in Phase 38.
   *
   * "All requests" is gated on `request:oversee`, and shows other users'
   * requests only once submitted — a DRAFT stays private (decision E1).
   */
  {
    labelKey: 'nav.groups.requests',
    icon: ClipboardCheck,
    items: [
      {
        labelKey: 'nav.items.myRequests',
        to: '/requests',
        permission: 'request:read',
        end: true,
        icon: Inbox,
      },
      // Phase 38: the steps the caller can act on now (decision F6).
      {
        labelKey: 'nav.items.awaitingRequests',
        to: '/requests/awaiting',
        permission: 'request:read',
        // P5 (§64.5): "Needs my action (N)" — the count of that same list.
        badge: 'actionsNeeded',
        icon: ClipboardCheck,
      },
      // P6 (§64.6): "Updates • 2" — involved requests changed since last seen.
      {
        labelKey: 'nav.items.updatedRequests',
        to: '/requests/updates',
        permission: 'request:read',
        badge: 'updates',
        icon: BellDot,
      },
      {
        labelKey: 'nav.items.allRequests',
        to: '/requests/all',
        permission: 'request:oversee',
        icon: Files,
      },
    ],
  },
  {
    labelKey: 'nav.groups.reportsAudit',
    icon: ScrollText,
    items: [
      {
        labelKey: 'nav.items.reports',
        to: '/reports',
        /*
          Any code that opens a report, not `report:read` alone (`CR-010`).
          A Department PIC holds `asset-unit:read` and can open the unit
          inventory; gating this entry on the old single code hid the section
          from them entirely, which read as a broken permission rather than an
          enforced boundary.
        */
        anyPermission: REPORT_PERMISSIONS,
        icon: ChartColumn,
      },
      {
        labelKey: 'nav.items.auditLog',
        to: '/audit',
        permission: 'audit-log:read',
        icon: ScrollText,
      },
    ],
  },
]);

/** The groups and items a permission set can actually see. */
export function visibleNavigation(permissions) {
  /**
   * An item declares `permission` — one code — or `anyPermission`, a set of
   * which one suffices (`CR-010`). The second exists for a section whose screens
   * are not all gated the same way: Reports holds eight requiring `report:read`
   * and one requiring `asset-unit:read`, and a Department PIC holds only the
   * second.
   */
  const canSee = (item) =>
    item.anyPermission
      ? item.anyPermission.some((code) => permissions.has(code))
      : permissions.has(item.permission);

  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(canSee),
  })).filter((group) => group.items.length > 0);
}
