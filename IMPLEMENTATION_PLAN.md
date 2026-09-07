# Implementation Plan

> This document defines the execution order for implementing the Asset Management System.
>
> It does not replace the product, requirements, domain, data-model,
> infrastructure, API, or UI specifications.
>
> The specification documents define WHAT the system is.
> This document defines WHEN and HOW the system should be implemented.

---

# 1. Implementation Philosophy

The application MUST NOT be implemented as one large operation.

Implementation MUST proceed incrementally through the phases defined in this
document.

The intended progression is:

```text
Specifications
      │
      ▼
Project Foundation
      │
      ▼
Database
      │
      ▼
Backend Foundation
      │
      ▼
Authentication & Authorization
      │
      ▼
Organization & Reference
      │
      ▼
Asset Core
      │
      ▼
Procurement
      │
      ▼
Operations
      │
      ▼
Supporting Backend Services
      │
      ▼
Frontend Foundation
      │
      ▼
Frontend Authentication & Shell
      │
      ▼
Frontend Organization & Reference
      │
      ▼
Frontend Asset Core
      │
      ▼
Frontend Procurement
      │
      ▼
Frontend Operations
      │
      ▼
Reports & Audit UI
      │
      ▼
Integration & Hardening
```

Each phase must be independently implemented and verified before proceeding
to the next phase.

---

# 2. Source Documents

The implementation MUST use these documents as the system specification:

```text
01-product.md
02-requirements.md
03-domain.md
04-data-model.md
05-infrastructure.md
06-api.md
07-ui.md
```

Their responsibilities are:

| Document | Responsibility |
|---|---|
| `01-product.md` | Product scope and capabilities |
| `02-requirements.md` | Functional and non-functional requirements |
| `03-domain.md` | Domain model and business concepts |
| `04-data-model.md` | PostgreSQL schema and database structure |
| `05-infrastructure.md` | Runtime, infrastructure, deployment and technical stack |
| `06-api.md` | Backend API contract |
| `07-ui.md` | Frontend architecture and UI specification |
| `IMPLEMENTATION_PLAN.md` | Implementation sequence and phase gates |

Do not use this implementation plan to override the specifications.

---

# 3. Mandatory Phase Rules

## 3.1 One Phase at a Time

Claude MUST work on only one phase at a time.

For example:

```text
Phase 1
  ↓
implement
  ↓
test
  ↓
report
  ↓
STOP
```

Claude MUST NOT continue into Phase 2 automatically.

---

## 3.2 Explicit Phase Approval

The user must explicitly request the next phase.

Examples:

```text
Start Phase 1
```

then later:

```text
Start Phase 2
```

Claude MUST NOT interpret successful completion of Phase 1 as permission
to start Phase 2.

---

## 3.3 "Continue" Does Not Mean "Next Phase"

If the user says:

```text
Continue
```

interpret this as:

> Continue the current incomplete phase.

It does NOT mean:

> Start the next phase.

---

## 3.4 Read Before Implementing

Before implementing a phase Claude MUST:

1. Read the relevant specification documents.
2. Inspect the current repository.
3. Inspect the output of previous phases.
4. Check phase dependencies.
5. Identify conflicts or ambiguities.
6. Produce a concise implementation plan.

Only then should implementation begin.

---

## 3.5 Do Not Implement Future Work

Claude MUST NOT implement future-phase functionality merely because it is
convenient.

Examples:

```text
Database phase
    ✗ REST APIs
    ✗ authentication
    ✗ frontend

Authentication phase
    ✗ asset APIs
    ✗ procurement workflows
    ✗ frontend pages

Frontend foundation
    ✗ complete asset pages
    ✗ procurement pages
    ✗ reports
```

Minimal interfaces, types, configuration, or placeholders required by the
current phase are allowed.

Actual future functionality is not.

---

## 3.6 No Silent Architecture Changes

If implementation reveals a conflict between specifications, Claude MUST NOT
silently change the architecture.

Claude must report:

```text
Conflict:
Affected document:
Affected section:
Affected requirement:
Reason:
Proposed resolution:
Implementation impact:
```

Then STOP and wait for approval.

---

# 4. Phase Status

Use these statuses:

```text
NOT STARTED
IN PROGRESS
BLOCKED
COMPLETE
```

A phase may only be marked `COMPLETE` after its completion criteria have been
verified.

---

# 5. Phase Overview

| Phase | Name | Dependency | Status |
|---|---|---|---|
| 0 | Project Foundation | Specifications | COMPLETE |
| 1 | Database | Phase 0 | COMPLETE |
| 2 | Backend Foundation | Phase 1 | COMPLETE |
| 3 | Authentication & Authorization | Phase 2 | COMPLETE |
| 4 | Organization & Reference API | Phase 3 | COMPLETE |
| 5 | Asset Core API | Phase 4 | COMPLETE |
| 6 | Procurement API | Phase 5 | COMPLETE |
| 7 | Operations API | Phase 6 | COMPLETE |
| 8 | Supporting Backend Services | Phase 7 | COMPLETE |
| 9 | Frontend Foundation | Phase 8 | COMPLETE |
| 10 | Frontend Authentication & Application Shell | Phase 9 | COMPLETE |
| 11 | Frontend Organization & Reference | Phase 10 | COMPLETE |
| 12 | Frontend Asset Core | Phase 11 | COMPLETE |
| 13 | Frontend Procurement | Phase 12 | COMPLETE |
| 14 | Frontend Operations | Phase 13 | COMPLETE |
| 15 | Reports & Audit (backend §21.0, then UI) | Phase 14 | COMPLETE |
| 16 | Integration & Hardening | Phase 15 | COMPLETE |

---

# 6. Phase 0 — Project Foundation

## Objective

Create the initial development environment and repository structure.

No business functionality should be implemented in this phase.

## 6.1 Repository

- [x] Establish repository structure. — npm workspaces monorepo (`apps/api`, `apps/web`)
- [x] Create backend directory. — `apps/api`
- [x] Create frontend directory. — `apps/web`
- [x] Create documentation directory if required. — `docs/` already present
- [x] Add `.gitignore`.
- [x] Add `.env.example`.
- [x] Add README.
- [x] Establish development scripts. — root `package.json`

## 6.2 Backend Project

Initialize the backend using the technology defined by the infrastructure
specification.

- [x] Node.js project. — Node 22, CommonJS
- [x] Express. — 4.x
- [N/A] TypeScript if specified by the project configuration. — not specified; JavaScript
- [x] ESLint. — 9.x flat config
- [x] Prettier. — 3.x, shared root config
- [x] Vitest. — 3.x
- [x] Supertest. — 7.x
- [x] Development startup script. — `npm run dev:api` (nodemon)
- [x] Production startup script. — `npm start`

## 6.3 Frontend Project

Initialize the frontend.

- [x] React. — 19.x
- [x] Vite. — 7.x
- [N/A] TypeScript if specified. — `05-infrastructure.md` §3.1 specifies JavaScript, no TypeScript
- [x] ESLint. — 9.x flat config
- [x] Prettier. — 3.x, shared root config
- [x] Vitest. — 3.x, jsdom
- [x] React Testing Library. — 16.x
- [x] Development startup script. — `npm run dev:web`
- [x] Production build script. — `npm run build`

Do not implement business screens.

## 6.4 Development Infrastructure

- [x] PostgreSQL. — `postgres:16-alpine`
- [x] Redis. — `redis:7-alpine`
- [x] Docker Compose. — `docker-compose.dev.yml`
- [x] Application environment configuration. — `apps/api/src/config/env.js`, fail-fast
- [x] Database persistence. — named volume `postgres-data`
- [x] Redis persistence/configuration. — named volume `redis-data`, `--appendonly yes`
- [x] Storage directory. — `storage/attachments`, bind-mounted to `/storage`
- [x] Environment variable configuration. — `.env.example`

## 6.5 Completion Criteria

- [x] Backend starts. — `HTTP 200` on `/`
- [x] Frontend starts. — Vite dev server on `:5173`
- [x] PostgreSQL starts. — container healthy
- [x] Redis starts. — container healthy
- [x] Backend can reach PostgreSQL. — `npm run check:services`
- [x] Backend can reach Redis. — `npm run check:services`
- [x] Tests execute. — 19 passed
- [x] Lint executes. — clean
- [x] Formatting executes. — clean
- [x] Docker development environment starts successfully. — all four services verified

## Explicitly Not Implemented

- Authentication.
- Authorization.
- Business database tables.
- Business APIs.
- Business workflows.
- Production UI.

---

# 7. Phase 1 — Database

## Objective

Implement the PostgreSQL database defined by `04-data-model.md`.

The database must be usable independently of the REST API and frontend.

## 7.1 Database Infrastructure

- [x] Configure PostgreSQL. — `postgres:16-alpine`, Docker
- [x] Configure Sequelize.
- [x] Configure Sequelize CLI. — `.sequelizerc`, `config/sequelize.js`
- [x] Configure database connection. — `DATABASE_URL` / `TEST_DATABASE_URL`
- [x] Configure migrations. — 36 files, `migrations/`
- [x] Configure seeders. — `seeders/`, `seederStorage: none` for idempotency
- [x] Create required schemas. — `public`, `ref`, `audit`
- [x] Enable `pgcrypto`.
- [x] Create required enum types. — all 7 (§4)

Required schemas:

```text
public
ref
audit
```

## 7.2 Reference Tables

Implement the documented reference tables in dependency order.

### Roles

- [x] `ref.roles`

### Basic Reference

- [x] `ref.categories`
- [x] `ref.measurement_units`
- [x] `ref.contract_types`
- [x] `ref.funding_sources`
- [x] `ref.account_codes`
- [x] `ref.transaction_types`
- [x] `ref.permissions`

### Classification

- [x] `ref.asset_classifications`

### Attribute Definitions

- [x] `ref.attribute_definitions`

## 7.3 Organization Tables

- [x] `public.institutions`
- [x] `public.departments`
- [x] `public.users`
- [x] `public.user_roles`
- [x] `public.role_permissions`

## 7.4 Procurement Tables

- [x] `public.vendors`
- [x] `public.suppliers`
- [x] `public.contracts`
- [x] `public.contract_items`

## 7.5 Asset Core Tables

- [x] `public.locations`
- [x] `public.location_floor_plans`
- [x] `public.floor_plan_areas`
- [x] `public.assets`
- [x] `public.asset_units`
- [x] `public.asset_unit_locations`
- [x] `public.longitudinal_history`
- [x] `public.asset_attribute_values`
- [x] `public.asset_unit_attribute_values`
- [x] `public.attachments`

## 7.6 Operations Tables

- [x] `public.borrowings`
- [x] `public.borrowing_items`
- [x] `public.transactions`
- [x] `public.transaction_items`

## 7.7 Audit

- [x] `audit.audit_logs`

## 7.8 Database Constraints

Implement every documented:

- [x] Primary key. — 34
- [x] Foreign key. — 59
- [x] Unique constraint. — 15
- [x] Check constraint. — 10
- [x] Index. — 60 explicit
- [x] Partial index. — 9
- [x] Cascade rule. — 12 (§8.2)
- [x] Restriction rule. — all other FKs `NO ACTION`
- [x] Temporal constraint. — date-order checks and history/borrowing indexes

Pay particular attention to:

- classification hierarchy.
- location hierarchy.
- asset/unit relationships.
- contract/contract-item relationships.
- attribute scope.
- lifecycle state.
- borrowing dates.
- transaction integrity.
- longitudinal history.

## 7.9 Migrations

Migrations MUST follow the dependency order defined in the data model.

The database must be reproducible from an empty PostgreSQL instance.

Verify:

```text
empty database
      ↓
migration
      ↓
complete schema
```

Also verify:

```text
complete schema
      ↓
rollback
      ↓
empty database
```

and:

```text
rollback
      ↓
migration again
      ↓
complete schema
```

## 7.10 Seed Data

Implement only documented initial seed data.

- [x] Asset classifications. — 14,738 rows from `rincian_asset.csv`
- [DEFERRED] Permissions. — generated from route metadata (`06-api.md` §1.3); moved to Phase 3 by decision
- [x] System Admin role. — one row, `is_system_wide = true`
- [DEFERRED] System Admin permissions. — depends on the permission catalog above

Do not create a default user unless explicitly required by the specification.

The first user/bootstrap mechanism should follow the infrastructure
specification.

## 7.11 Database Verification

All verified by `npm run test:db` — 166 tests.

- [x] Fresh migration succeeds.
- [x] Rollback succeeds. — 0 tables, 0 enums, 0 schemas remain
- [x] Re-migration succeeds. — schema snapshot identical to the first run
- [x] Foreign keys verified. — names, targets and `ON DELETE` actions
- [x] Unique constraints verified.
- [x] Check constraints verified. — present, and each rejects a violating row
- [x] Indexes verified. — including all 9 partial-index predicates
- [x] Seed execution verified.
- [x] Seed idempotency verified. — second run leaves row counts unchanged
- [x] UUID generation verified.
- [x] Enum values verified. — labels and their order, for all 7 types

## Explicitly Not Implemented

- REST API.
- Authentication.
- Authorization.
- Business services.
- Frontend.

---

# 8. Phase 2 — Backend Foundation

## Objective

Build reusable backend infrastructure on top of the completed database.

## 8.1 Application

- [x] Express application. — `src/app.js`
- [x] Configuration system. — `src/config/index.js`, Zod schema
- [x] Environment validation. — fail-fast, reports every problem at once
- [x] Application bootstrap. — `src/server.js`, datastores proven before listen
- [x] Graceful shutdown. — drain, close pools, 10s backstop
- [x] Error handling. — `src/errors/`, `src/middleware/errorHandler.js`

## 8.2 Database

- [x] Sequelize initialization. — `src/db/sequelize.js`; never syncs
- [x] Connection pooling. — `{ max: 20, min: 2, idle: 10000 }` (§4)
- [x] Model initialization. — 34 models, one per table
- [x] Model associations. — one per documented foreign key
- [x] Transaction support. — `src/db/withTransaction.js`
- [x] Database error translation. — `src/errors/translateDatabaseError.js`

## 8.3 API Foundation

- [x] `/api/v1` routing.
- [x] Common response envelope. — `sendItem` / `sendList` / `sendCreated`
- [x] Common error envelope. — `sendError`
- [x] Error classes. — one per code in `06-api.md` §1.4
- [x] Error middleware.
- [x] 404 handling.
- [x] Request validation. — `src/middleware/validate.js`
- [x] Query parameter parsing. — Zod-coerced per request part
- [x] Pagination infrastructure. — default 20, max 100
- [x] Filtering infrastructure. — declared per resource, AND-combined
- [x] Sorting infrastructure. — allow-listed fields only

## 8.4 Security Foundation

- [x] Helmet.
- [x] CORS. — configured origins only, never `*`
- [x] Rate limiting.
- [x] Request size limits. — `MAX_REQUEST_BODY_KB`
- [x] Input validation.
- [x] Security-related logging. — credential redaction in every log entry

## 8.5 Logging

- [x] Winston.
- [x] Structured logs. — JSON to stdout/stderr
- [x] Request logging. — one line per completed request, with request id
- [x] Error logging. — 5xx at `error`, 4xx at `warn`
- [x] Environment-aware log levels.

## 8.6 Health

- [x] `GET /api/health`. — 200 healthy, 503 degraded
- [x] PostgreSQL health check.
- [x] Redis health check.

## 8.7 Testing

- [x] Application bootstrap test.
- [x] Health endpoint test.
- [x] Database connection test. — plus every model queried against the schema
- [x] Error handling tests.
- [x] Validation tests.

## Explicitly Not Implemented

- Login.
- JWT.
- Refresh tokens.
- Permissions.
- Organization APIs.
- Asset APIs.
- Procurement APIs.
- Operations APIs.
- Frontend.

---

# 9. Phase 3 — Authentication & Authorization

## Objective

Implement authentication and authorization as the foundation for all protected
business APIs.

## 9.1 Authentication

- [x] Password hashing. — bcrypt, cost 12
- [x] Login. — generic failure message, constant-time
- [x] Access token generation. — 15m, `userId`/`roleIds`/`institutionId`
- [x] Refresh token generation. — 7d, httpOnly cookie
- [x] Refresh token persistence. — Redis, TTL matched to the token
- [x] Refresh token validation. — signature, type, session, account state
- [x] Logout. — idempotent
- [x] Session revocation. — per session and per user
- [x] Current-user endpoint.
- [x] Inactive-user rejection. — login, refresh and every request

## 9.2 Authentication API

Implement:

```text
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

## 9.3 Authorization

- [x] Authentication middleware.
- [x] Role resolution. — live per request, never from the token
- [x] Permission resolution.
- [x] Permission middleware. — code validated against the catalog at build time
- [x] Institution scope. — `scopeWhere()` for Phases 4–7
- [x] System-wide role behavior. — lifts scope, grants nothing implicitly
- [x] Unauthorized handling. — 401
- [x] Forbidden handling. — 403, ordered after 401

## 9.4 Bootstrap

Implement the documented first-user/bootstrap mechanism.

- [x] Bootstrap command. — `npm run bootstrap`
- [x] Initial user creation.
- [x] System Admin assignment. — in one transaction with the user
- [x] Bootstrap safety checks. — no existing users, role seeded, password length, TTY only

## 9.5 Tests

- [x] Valid login.
- [x] Invalid credentials.
- [x] Inactive user.
- [x] Access token validation.
- [x] Expired access token.
- [x] Refresh.
- [x] Invalid refresh token.
- [x] Logout.
- [x] Revoked refresh token.
- [x] Permission enforcement.
- [x] Institution scope.
- [x] System-wide role.

Also covered, beyond the list: the permission catalog is generated rather than
hand-written and is asserted against `ref.permissions`; login is rate-limited
separately from the rest of the API.

## Completion Criteria

A user can authenticate and the backend can reliably determine whether the
authenticated user is authorized to access a protected resource.

## Explicitly Not Implemented

- Asset business logic.
- Procurement workflows.
- Borrowing workflows.
- Frontend authentication UI.

---

# 10. Phase 4 — Organization & Reference API

## Objective

Implement foundational organization and reference APIs required by all later
business modules.

---

## 10.1 Institutions

- [x] List.
- [x] Detail.
- [x] Create.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.
- [x] Validation.
- [x] Authorization.

---

## 10.2 Departments

Department is a flat, global list — see decision `DEC-001` (§39). It has no
parent and no institution.

- [x] List.
- [x] Detail.
- [x] Create.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.

---

## 10.3 Users

- [x] List.
- [x] Detail.
- [x] Create.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.
- [x] Role assignment.
- [x] Role removal.
- [x] Institution/department assignment.

---

## 10.4 Roles

- [x] List.
- [x] Detail.
- [x] Create.
- [x] Update.
- [x] Delete where allowed.
- [x] Permission listing.
- [x] Permission assignment.

---

## 10.5 Permissions

- [x] Read-only permission catalog.
- [x] Permission metadata.
- [x] Permission lookup.

---

## 10.6 Asset Classifications

- [x] List.
- [x] Search.
- [x] Detail.
- [x] Children.
- [x] Leaf-node lookup.
- [x] Attribute lookup.

Classification data must remain read-only through normal application APIs
unless the specification explicitly states otherwise.

---

## 10.7 Attribute Definitions

- [x] List.
- [x] Detail.
- [x] Create.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.

Validate:

- [x] data type.
- [x] scope.
- [x] classification applicability.
- [x] required flag.
- [x] measurement unit. — accepted only on a NUMBER attribute
- [BLOCKED] allowed values. — open specification gap `GAP-001` (§39): there is
  nowhere to store a SELECTION attribute's option list.

---

## 10.8 Lookup References

Implement the documented lookup resources:

- [x] Categories. — read-only (`06-api.md` §4.2)
- [x] Measurement units.
- [x] Contract types.
- [x] Funding sources.
- [x] Transaction types.
- [x] Account codes.
- [x] Conditions. — static enum list (`06-api.md` §4.6, REQ-REF-006)

---

## 10.9 Tests

- [x] Institution authorization.
- [N/A] Department hierarchy and institution scope. — Department is a flat,
  global list with no parent and no institution (`DEC-001`, §39), so there is no
  hierarchy or scope to test.
- [x] User role management.
- [x] Permission management.
- [x] Classification read-only behavior.
- [x] Classification leaf behavior.
- [x] Attribute definition validation.
- [x] Lookup access.

## Completion Criteria

Organization and reference information can be fully managed through protected
APIs and can support all later modules.

---

# 11. Phase 5 — Asset Core API

## Objective

Implement the central asset registry, asset-unit model, locations, floor plans,
attributes, history, and attachments.

---

# 11.1 Locations

- [x] List locations.
- [x] Create location.
- [x] Detail.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.
- [x] Child locations.
- [x] Parent validation.
- [x] Unit lookup.

Validate:

- no self-reference.
- no invalid descendant relationships.
- correct institution scope.

---

# 11.2 Floor Plans

- [x] Floor plan upload.
- [x] Floor plan retrieval.
- [x] Floor plan replacement.
- [x] Floor plan deletion.
- [x] Area creation.
- [x] Area update.
- [x] Area deletion.
- [x] Area-location relationship.

Validate:

- normalized coordinates.
- valid polygon structure.
- location ancestry.
- one active floor plan per applicable location if required.

---

# 11.3 Assets

- [x] Asset list.
- [x] Search.
- [x] Filtering.
- [x] Sorting.
- [x] Create.
- [x] Detail.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.

Validate:

- classification.
- institution.
- category.
- procurement relationship.
- asset identity.

---

# 11.4 Asset Units

- [x] Create unit.
- [x] List units.
- [x] Unit detail.
- [x] Update. — description, department, and `contractItemId` (`GAP-014`),
  which must belong to the asset's own contract
- [x] Deactivate.
- [x] Reactivate.
- [x] Current condition.
- [x] Current lifecycle state.
- [x] Current location.

---

# 11.5 Asset-Unit Location

- [x] Current location.
- [x] Location assignment.
- [x] Location history.
- [x] Start date.
- [x] End date.
- [x] Overlap validation.

---

# 11.6 Longitudinal History

Implement the documented unified historical record.

- [x] History retrieval.
- [x] History creation.
- [x] Condition history.
- [x] Location history.
- [x] Lifecycle history.
- [x] Effective dates.
- [x] Historical validation.

Do not create separate historical systems when the data model already defines
the unified longitudinal history.

---

# 11.7 Attributes

- [x] Asset attributes.
- [x] Asset-unit attributes.
- [x] Attribute definition lookup.
- [x] Type validation.
- [x] Scope validation.
- [x] Required attribute validation.
- [x] Classification applicability.

---

# 11.8 Attachments

- [x] Upload.
- [x] Metadata.
- [x] Download/stream.
- [x] Delete.
- [x] File type validation.
- [x] File size validation.
- [x] Authorization.
- [x] Asset relationship.

---

# 11.9 Search

Implement asset search/filter capabilities required by the API specification.

- [x] Search.
- [x] Classification filtering.
- [x] Location filtering.
- [x] Institution filtering.
- [x] Status filtering.
- [x] Condition filtering.
- [x] Pagination.
- [x] Sorting.

---

# 11.10 Tests

- [x] Asset creation.
- [x] Asset update.
- [x] Asset deactivation.
- [x] Unit creation.
- [x] Unit state.
- [x] Location assignment.
- [x] Location overlap.
- [x] History creation.
- [x] Attribute type validation.
- [x] Attribute scope validation.
- [x] Attachment authorization.
- [x] Search/filter behavior.

## Completion Criteria

The backend can fully manage the core asset registry independently of
procurement and operations workflows.

---

# 12. Phase 6 — Procurement API

## Objective

Implement vendors, suppliers, contracts, contract items, and the
procurement-to-asset workflow.

---

# 12.1 Suppliers

Supplier is a global list — see decision `DEC-007` (§39). It has no institution
and is therefore permission-gated but not organization-scoped.

- [x] List.
- [x] Detail.
- [x] Create.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.

---

# 12.2 Vendors

`06-api.md` files Vendors under §7 "Operations"; they are implemented here — see
`DEC-008` (§39). Global list, like Supplier (`DEC-007`).

- [x] List.
- [x] Detail.
- [x] Create.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.
- [x] Asset lookup. — `GET /vendors/:id/assets`, scoped to the caller's
  institution because Assets carry one

---

# 12.3 Contracts

Organization-scoped through `contracts.institution_id` (`BR-007`).

- [x] List. — filters `supplierId`, `institutionId`, `contractTypeId`, `status`, `q`
- [x] Detail. — resolves supplier, contract type, funding source, institution
- [x] Create.
- [x] Update.
- [x] Deactivate.
- [x] Reactivate.
- [x] Contract items. — `GET`/`POST /contracts/:id/items`

Validate:

- [x] contract number uniqueness. — `CONFLICT`, naming the field
- [x] supplier, contract type, funding source, account code existence.
- [x] institution scope on create and update.

---

# 12.4 Contract Items

Scope is inherited from the parent Contract; the table carries no
`institution_id` of its own.

- [x] List.
- [x] Detail.
- [x] Create.
- [x] Update. — `contractId` is not editable
- [x] Delete where allowed. — hard delete; `CONFLICT` once asset units reference it
- [x] Quantity.
- [x] Unit price.
- [x] Asset creation relationship. — `GET /contract-items/:id/asset-units`

`totalValue` is derived from `quantity * unitPrice` and never stored
(`03-domain.md` §4.17).

Classification is NOT stored on the contract item — `06-api.md` §6.3 resolves
this: it is supplied when the asset is created (`DEC-009`, §39).

---

# 12.5 Procurement-to-Asset

Implement the documented workflow:

```text
Contract
    │
    ▼
Contract Item
    │
    ▼
Create Asset
    │
    ├── Asset
    │
    └── Asset Unit(s)
```

The operation must:

- [x] Validate contract item. — including the caller's scope over its contract
- [x] Validate classification. — leaf node, `BR-011`
- [x] Create asset.
- [x] Create unit(s). — `unitCount`, bounded 1–500 as request validation only
- [x] Link asset to originating contract. — `Asset.contractId`, REQ-ASSET-011
- [x] Link units to originating contract item. — `AssetUnit.contractItemId`,
  REQ-PROC-006
- [x] Execute transactionally.
- [x] Roll back on failure. — verified by an injected failure

Authorization requires BOTH `asset:create` and `asset-unit:create` (`DEC-010`,
§39). Institution precedence is `body.institutionId ?? contract.institutionId ??
caller's scope`, then the standard `BR-007` guard (`DEC-011`, §39).

---

# 12.6 Tests

`tests/database/13-procurement-api.test.js` — 45 tests.

- [x] Supplier CRUD.
- [x] Vendor CRUD.
- [x] Contract CRUD.
- [x] Contract-item validation.
- [x] Procurement-to-asset flow.
- [x] Transaction rollback.
- [x] Traceability.

Also covered, beyond the list: contract-number uniqueness on create and update,
reference-existence validation, contract-item deletion blocking, institution
scope on contracts and inherited scope on their items, the global (unscoped)
behavior of suppliers and vendors, and per-endpoint permission enforcement
including the two-permission rule on the procurement flow.

## Completion Criteria

A procurement record can be traced to the asset and physical units created
from it.

---

# 13. Phase 7 — Operations API

## Objective

Implement asset-unit operational workflows.

---

# 13.1 Borrowings

Implement:

```text
DRAFT
ACTIVE
RETURNED
OVERDUE
CANCELLED
```

Operations:

- [x] List. — filters `status`, `institutionId`, `overdue`, `q`
- [x] Detail.
- [x] Create. — always `DRAFT`
- [x] Update while DRAFT.
- [x] Add item. — DRAFT only (`DEC-012`, §39)
- [x] Remove item. — DRAFT only
- [x] Activate. — also moves each unit `ACTIVE → BORROWED` (`DEC-013`)
- [x] Cancel.
- [x] Return. — also moves each unit `BORROWED → ACTIVE`
- [x] Extend. — returns this record and opens a new DRAFT (`DEC-015`)

Status is never a plain field edit: each transition is an action endpoint with
its own permission, because each also changes the physical units it holds.

---

# 13.2 Borrowing Rules

- [x] Unit availability.
- [x] No conflicting active borrowing. — `BR-003`, re-checked at activation
  (`DEC-014`, §39)
- [x] Date validation.
- [x] Expected return validation.
- [x] Borrower validation. — name and contact both required; responsible person
  must exist
- [x] State transition validation. — `src/domain/borrowingLifecycle.js`,
  mirroring `03-domain.md` §7.2
- [x] Return validation.
- [x] Extension validation.

---

# 13.3 Transactions

Implement transaction records according to the documented model.

- [x] List. — filters `transactionTypeId`, `institutionId`, `contractId`,
  `supplierId`, `dateFrom`, `dateTo`
- [x] Detail.
- [x] Create. — header and items in one transaction (`DEC-016`, §39)
- [x] Transaction items.
- [x] Unit-level history. — `GET /asset-units/:id/transactions`
- [x] Procurement reference where applicable. — `supplierId`/`contractId` stay
  optional (REQ-TXN-008/009)

Transactions are historical records.

- [x] No mutation of completed historical transactions. — no PATCH and no DELETE
  exist for this resource

---

# 13.4 Lifecycle Operations

Implement documented lifecycle state transitions.

Validate:

- [x] valid state transitions. — the Phase 5 state machine, now also driven by
  borrowing activation and return
- [x] effective dates.
- [x] condition changes.
- [x] location changes.
- [x] historical consistency. — a borrowing-driven state change writes the same
  longitudinal history row as a manual one, in the borrowing's own transaction

---

# 13.5 Tests

`tests/database/14-operations-api.test.js` — 59 tests.

- [x] Borrowing creation.
- [x] Borrowing activation.
- [x] Borrowing cancellation.
- [x] Borrowing return.
- [x] Borrowing extension.
- [x] Overdue behavior.
- [x] Unit availability.
- [x] Transaction creation.
- [x] Transaction immutability.
- [x] Lifecycle transitions.
- [x] Historical preservation.

Also covered, beyond the list: activation rollback when one unit of several
cannot be borrowed, two DRAFTs racing for the same unit, returning a borrowing
whose unit left `BORROWED` by another route, unit-level borrowing and
transaction history, organization scope on both resources, and per-transition
permission enforcement.

## Completion Criteria

All operational workflows can be executed through protected APIs while
preserving unit-level traceability and history.

---

# 14. Phase 8 — Supporting Backend Services

## Objective

Implement backend services that operate alongside the core APIs.

---

# 14.1 Redis

- [x] Redis client. — `src/db/redis.js`, from Phase 2
- [x] Connection handling. — lazy connect, `ensureRedis`
- [x] Error handling. — an `error` listener on every client, so a blip cannot
  take the process down
- [x] Shared Redis service. — one instance, two connection kinds:
  `src/jobs/connection.js` gives BullMQ its own with the options blocking
  commands require (`DEC-017`, §39)

---

# 14.2 Background Jobs

- [x] BullMQ configuration. — `bullmq` 6.x, `src/jobs/index.js`
- [x] Queue configuration. — one queue, `asset-management`
- [x] Worker configuration. — in-process, per `05-infrastructure.md` §7.3
- [x] Job logging. — start, completion and failure, including empty runs
- [x] Retry behavior. — 3 attempts, exponential backoff from 5s
- [x] Failure handling. — an unregistered job name fails loudly instead of being
  silently dropped

---

# 14.3 Borrowing Overdue Sweep

Implement the documented overdue job.

- [x] Scheduled execution. — every 15 minutes (§7.2), one upserted scheduler
- [x] Find ACTIVE borrowings past expected return date.
- [x] Change to OVERDUE.
- [x] Preserve history. — dates untouched, units stay `BORROWED`
- [x] Log job execution.
- [x] Avoid duplicate/unsafe processing. — idempotent predicate, single
  scheduler id across restarts

---

# 14.4 Audit Logging

Implement append-only audit logging.

Written by Sequelize model hooks over an explicit allowlist (`DEC-018`, §39), so
no service can forget to record a change.

Record where required:

- [x] actor. — from the ambient request context (`DEC-019`); NULL is "system"
- [x] action. — `CREATE`/`UPDATE`/`DELETE`, plus `STATUS_CHANGE` when only status
  fields changed
- [x] entity type.
- [x] entity ID. — composite keys joined with `:`
- [x] old values.
- [x] new values.
- [x] timestamp.
- [x] IP address.
- [x] metadata. — carries the request id, and the job name for system writes

- [x] Audit logs are never rewritten. — the service exposes `record` and nothing
  else; there is no update or delete path anywhere

---

# 14.5 File Storage

Built in Phase 5; verified and covered by tests here.

- [x] Storage adapter. — `src/services/storage.js`, local disk behind a
  swappable interface
- [x] Attachment path handling. — `{shard}/{uuid}-{name}`, traversal refused on
  both write and read
- [x] File validation. — extension and MIME allow-list (REQ-FILE-004)
- [x] Storage errors. — a missing file on delete is not an error
- [x] File access authorization. — resolved through the owning asset's scope
- [x] Orphaned-file handling. — the upload path compensates on failure, so a
  failed insert leaves nothing on disk (`DEC-020`, §39)

---

# 14.6 Tests

`tests/database/15-supporting-services.test.js` — 40 tests.

- [x] Redis connection.
- [x] Queue creation.
- [x] Worker startup.
- [x] Overdue sweep.
- [x] Audit creation.
- [x] Audit append-only behavior.
- [x] Attachment storage.

Also covered, beyond the list: the sweep's idempotency and its refusal to touch
DRAFT/RETURNED/CANCELLED records, password-hash redaction, composite-key entity
ids, no audit trail behind a rolled-back operation, the business operation
surviving an audit outage, and the compensating delete that prevents orphaned
files.

## Completion Criteria

Supporting backend infrastructure operates correctly with the completed
business APIs.

---

# 15. Phase 9 — Frontend Foundation

## Objective

Create reusable frontend architecture without implementing complete business
modules.

---

# 15.1 Core Stack

- [x] React. — 19.x
- [x] Vite. — 7.x
- [x] React Router. — 7.x
- [x] Tailwind CSS. — 4.x, CSS-first config via `@tailwindcss/vite`; there is no
  `tailwind.config.js`
- [x] shadcn/ui. — its Radix + cva + tailwind-merge foundation, with components
  written into `components/ui` rather than pulled from a registry (`DEC-021`, §39)
- [x] Zustand. — installed; the first store is Phase 10's session state (§16.2)
- [x] TanStack Query. — 5.x
- [x] TanStack Table. — 8.x, deliberately not 9.x (`DEC-022`, §39)
- [x] Axios.
- [x] React Hook Form. — with `@hookform/resolvers`
- [x] Zod. — 3.x, matching the API's version so schemas read alike
- [x] date-fns.
- [x] react-day-picker.
- [x] Vitest.
- [x] React Testing Library. — plus `@testing-library/user-event`

Also added, as `07-ui.md` §1.2 requires: `sonner` (toasts, §7), `cmdk`
(combobox), `lucide-react` (icons). Recharts was NOT added — see §15.7.

---

# 15.2 API Client

- [x] Axios instance. — `src/api/client.js`, one for the application
- [x] Base URL. — `VITE_API_BASE_URL`
- [x] Request configuration. — `withCredentials` for the refresh cookie, timeout,
  bearer header from a provider
- [x] Response handling. — the `{ data }` / `{ data, meta }` envelope unwrapped
  once, so no screen reaches through `response.data.data`
- [x] Error normalization. — every failure becomes an `ApiError` carrying the
  documented `code` (`06-api.md` §1.4), plus `NETWORK_ERROR` and `CANCELLED`
- [x] Authentication integration point. — `setAccessTokenProvider` /
  `setAuthFailureHandler`; Phase 10 supplies both (§16.1)

---

# 15.3 Query Infrastructure

- [x] Query client. — `createQueryClient()`
- [x] Query defaults. — 30s stale time, no refetch on focus, previous page kept
  visible while the next loads
- [x] Mutation defaults. — never retried: a timed-out POST may have succeeded
- [x] Cache invalidation patterns. — `invalidateResources()` over a resource's
  whole key prefix
- [x] Query key conventions. — `lib/queryKeys.js`, hierarchical and declared for
  every API resource

Retries are deliberate: a `403`, `404` or `409` is an answer, not a blip, and is
never retried.

---

# 15.4 UI Foundation

Create reusable components/patterns for:

- [x] Button. — variants, `asChild`, and a loading state that cannot be
  double-submitted
- [x] Input. — plus Textarea and Label
- [x] Select.
- [x] Combobox. — supports server-driven search (§33)
- [x] Date picker. — exchanges `YYYY-MM-DD`, never `Date` (`DEC-023`, §39)
- [x] Dialog.
- [x] Confirm dialog. — Radix `AlertDialog`, for `07-ui.md` §4.4 only
- [x] Toast. — `sonner`, with `toast.fromError` showing the API's own message
- [x] Table.
- [x] Pagination. — driven entirely by the API's `meta` block
- [x] Tabs.
- [x] Badge. — one status→variant map shared by every screen
- [x] Empty state.
- [x] Loading state.
- [x] Error state. — specific copy for FORBIDDEN, NOT_FOUND and CONFLICT (§4)
- [x] Skeleton.

---

# 15.5 Page Patterns

Create reusable patterns for:

- [x] List page.
- [x] Detail page.
- [x] Create/edit form. — full page, not a modal (`07-ui.md` §4.3)
- [x] Filter toolbar.
- [x] Data table. — server-side sorting and pagination; the table never reorders
  a page itself (§33)
- [x] Detail tabs. — only the selected panel renders, so a sub-collection the
  caller cannot read is never fetched
- [x] Section cards.

Plus `useListParams`, which syncs list state to the URL as `07-ui.md` §4.1
requires.

---

# 15.6 Form Infrastructure

- [x] React Hook Form integration. — `useZodForm`
- [x] Zod schemas. — shaped like the API request body
- [x] Error mapping. — `Field` wires label, hint, error, `aria-invalid` and
  `aria-describedby`
- [x] Server validation errors. — `details[].field` mapped onto the field;
  anything unmatched surfaces above the form
- [x] Dirty-form handling. — `useUnsavedChanges`, covering in-app navigation and
  tab close

---

# 15.7 Completion Criteria

- [x] The frontend has a reusable foundation capable of implementing all
  documented modules without repeatedly rebuilding common infrastructure.
- [x] Build succeeds. — `npm run build`
- [x] Tests pass. — 58
- [x] Lint passes.

Recharts is NOT installed. `07-ui.md` §9 lists it as an open item, "proposed for
§5.7, not yet confirmed as a stack addition", and §15.1 of this plan does not
name it. It is a Phase 15 decision (`GAP-003`, §39).

## Explicitly Not Implemented

- Login screen.
- Asset screen.
- Procurement screen.
- Borrowing screen.
- Report screen.

---

# 16. Phase 10 — Frontend Authentication & Application Shell

## Objective

Connect the frontend to authentication and implement the application shell.

---

# 16.1 Authentication

- [x] Login page. — `src/pages/LoginPage.jsx`
- [x] Login form. — RHF + Zod mirroring the API's own schema
- [x] Authentication request. — `POST /auth/login`
- [x] Access-token handling. — memory only, never persisted (`DEC-024`, §39)
- [x] Refresh handling. — single-flight refresh-and-retry on `401` (`DEC-025`)
- [x] Logout. — confirmed, and clears locally even if the server call fails
- [x] Current-user query. — the profile and permission set from the login and
  refresh responses; `GET /auth/me` is wired in `api/auth.js`
- [x] Session expiration behavior. — an expired access token is refreshed
  transparently; a dead session falls back to the login screen

Session restoration on page load: the access token is memory-only, so a reload
exchanges the httpOnly refresh cookie for a new one before anything renders
(`SessionProvider`). Without it, every refresh of the page would sign the user
out.

---

# 16.2 Authorization

Implement permission-aware frontend behavior.

- [x] Permission state. — Zustand, a `Set` populated from the session profile
- [x] `usePermission(code)`.
- [x] Route guards. — `RequireAuth`, `RequirePermission`
- [x] Navigation guards. — nav entries filtered by their own permission code
- [x] Action guards. — `<Can code>`
- [x] Forbidden page. — names the missing permission; does NOT redirect (§6)
- [x] Permission-aware buttons. — hidden, never disabled

- [x] Backend authorization remains authoritative. — no client-side shortcut
  exists, including for `isSystemWide`, which lifts organization scope without
  granting any permission (`BR-015`)

---

# 16.3 Application Shell

- [x] Sidebar. — collapsible, grouped, active-route highlighting
- [x] Top bar.
- [x] Breadcrumb. — built from matched routes, not by parsing the URL
- [x] User menu. — identity, roles, and a confirmed sign-out
- [x] Main content area. — the only vertical scroll container
- [x] Navigation groups. — the six sections of `07-ui.md` §2; an entirely hidden
  group disappears rather than showing an empty heading
- [x] Responsive behavior. — desktop-first, sidebar collapsible and hidden below
  `md`, per the tablet scope of `07-ui.md` §1.3
- [x] Global error handling. — the router's `errorElement`

Global search jumps to `/assets?q=` (REQ-SEARCH-001) and is hidden from a session
without `asset:read`.

---

# 16.4 Route Structure

- [x] Route architecture corresponding to the UI specification. — every route in
  `07-ui.md` §5, each behind the permission code the API enforces
- [x] Route contents NOT implemented. — each business route resolves to a
  placeholder naming the phase that builds it

Uses a data router (`createBrowserRouter`), which is what `useMatches`,
`errorElement` and Phase 9's `useUnsavedChanges` all require (`DEC-026`, §39).

---

# 16.5 Completion Criteria

- [x] User can log in.
- [x] User can log out.
- [x] Session can refresh.
- [x] Protected routes work.
- [x] Permission gating works.
- [x] Unauthorized routes are rejected.
- [x] Application shell works.

93 frontend tests. Verified additionally in a browser against the running API:
session restore, the login screen, a rejected sign-in showing the API's own
generic message (REQ-AUTH-004), and a protected deep link falling back to login.

---

# 17. Phase 11 — Frontend Organization & Reference

## Objective

Implement organization and reference-data UI.

---

# 17.1 Institutions

- [x] List.
- [x] Search/filter. — `q` and `status`, URL-synced
- [x] Detail.
- [x] Create.
- [x] Edit.
- [x] Activate/deactivate. — confirm dialog, own permission (§1.7)

---

# 17.2 Departments

- [x] List.
- [x] Detail.
- [x] Create. — the `VARCHAR(8)` natural key is supplied here and never edited
- [x] Edit. — name only
- [N/A] Hierarchy display. — Departments are a flat, global list with no
  `parent_id` and no `institution_id` (`DEC-001`). There is no hierarchy to
  display, and the screen states so rather than implying a missing feature.

---

# 17.3 Users

- [x] List.
- [x] Search/filter. — `q`, `institutionId`, `status`
- [x] Detail. — Profile / Roles tabs
- [x] Create. — including the initial password (`GAP-004`, §39)
- [x] Edit. — `username` and `password` excluded, as the API excludes them
- [x] Role assignment. — assign and unassign, gated by `user-role:create/delete`
- [x] Activate/deactivate.

---

# 17.4 Roles

- [x] Role list.
- [x] Role detail. — Details / Permissions tabs
- [x] Create.
- [x] Edit. — including the `isSystemWide` toggle (REQ-ROLE-008)
- [x] Permission assignment. — grouped checklist, replacing the whole granted set
  (REQ-ROLE-007); `BR-015` codes are disabled and labelled while the role is
  scoped, and the server's `CONFLICT` still surfaces
- [x] Delete. — hard delete; the server blocks it while any user holds the role

---

# 17.5 Reference

- [x] Classification browser.
- [x] Classification tree. — the drill-down of the shared picker (§17.6), not a
  second implementation
- [x] Classification detail. — including the attributes configured for it
- [x] Attribute definitions.
- [x] Categories. — READ-ONLY sixth tab (`DEC-027`, §39)
- [x] Measurement units.
- [x] Contract types.
- [x] Funding sources.
- [x] Account codes. — keyed by its `CHAR(12)` natural key
- [x] Transaction types.

Classifications are read-only throughout: no create, edit or delete affordance
exists anywhere on the page, because none exists on the server
(REQ-CLASS-003).

---

# 17.6 Reusable Components

- [x] Classification picker. — drill-down and leaf-search, per `07-ui.md` §4.5;
  one implementation, consumed by the browser here and by Phase 12's forms
- [x] Attribute definition form. — `SELECTION` is offered and its limitation
  stated inline (`GAP-001`, §39); no options editor is invented
- [x] Permission checklist. — grouped by the API's own `group` field
- [x] Reference lookup form. — one parameterized tab, five resources

---

# 17.7 Completion Criteria

- [x] Administrative users can manage all applicable organization and
  configurable reference data from the frontend.

155 frontend tests (93 before this phase; +62), including a route-coverage suite
asserting that every Phase 11 route resolves to a real screen behind the API's
own permission code, and that every later-phase route is still a placeholder.

---

# 18. Phase 12 — Frontend Asset Core

## Objective

Implement the complete core asset-management experience.

---

# 18.1 Asset List

- [x] Asset table.
- [x] Search. — `q`, URL-synced
- [x] Filtering. — classification (via the §4.5 picker), location, condition,
  status; each mapped 1:1 to a documented query param
- [x] Sorting. — server-side; the table never reorders a page itself
- [x] Pagination. — driven by the API's `meta` block
- [x] Status display.
- [x] Classification display.
- [x] Location display. — via the location filter and the unit lists
- [x] Actions. — permission-gated

---

# 18.2 Asset Creation

- [x] Classification selection. — the shared picker; leaf-only (`BR-011`)
- [x] Asset fields.
- [x] Dynamic attributes. — on the detail page's own tab, since values are
  replaced as a whole set against an asset that already exists
- [x] Validation. — Zod mirroring the API, with server errors mapped to fields
- [x] Attachment support where applicable. — on the detail page (§18.8)
- [x] Dirty-form handling. — `useUnsavedChanges` with a confirm dialog

`contractId` IS editable here as of the procurement revision (`GAP-014`), gated
on `contract:read`. It was previously omitted on the reading that `07-ui.md` §5.3
sets it once, which left the procurement flow as the only path that could ever
set it — see `GAP-014` and `DEC-057`.

---

# 18.3 Asset Detail

- [x] Overview.
- [x] Asset information.
- [x] Classification.
- [x] Attributes.
- [x] Units.
- [x] Procurement information. — the contract number, linked; an asset with no
  contract says so explicitly (REQ-ASSET-011's documented exception)
- [x] Attachments.
- [x] History. — on the unit, where the longitudinal record lives

Each tab loads independently: a caller may hold `asset:read` without
`attachment:read`, so one combined payload would fail for someone who can
legitimately see most of the page.

---

# 18.4 Asset Units

- [x] Unit list.
- [x] Unit detail.
- [x] Unit attributes.
- [x] Unit condition.
- [x] Unit lifecycle.
- [x] Unit location.
- [x] Borrowing history. — tab hidden without `borrowing:read`
- [x] Transaction history. — tab hidden without `transaction:read`

Condition, location and lifecycle state are recorded in ONE form, because they
are one longitudinal row (`03-domain.md` §4.12) — not three separate writes.

---

# 18.5 Locations

- [x] Location tree. — lazy, one `/children` call per expanded node
- [x] Location list.
- [x] Location detail. — Info / Units / Floor plan tabs
- [x] Create.
- [x] Edit.
- [x] Deactivate.
- [x] Unit listing. — includes every location beneath this one (`DEC-004`)

---

# 18.6 Floor Plan

Implement the floor-plan UI specified by the UI document.

- [x] Floor plan upload. — and replace, which removes existing areas server-side
- [x] Floor plan display. — natural aspect ratio; the image is fetched through
  the authorized endpoint as a blob, since a plain `<img src>` sends no token
- [x] SVG overlay. — plain `<polygon>` elements, no canvas library, as §5.4 says
- [x] Polygon rendering.
- [x] Polygon creation. — click to place points, or type coordinates
- [N/A] Polygon editing. — `06-api.md` §5.3 exposes `PATCH .../areas/:areaId` for
  a redraw, but re-dragging an existing shape's vertices is a materially larger
  interaction than §5.4 describes ("click an area to select the Location it
  represents, or to edit/delete it"). Redrawing is delete-then-draw today; see
  `GAP-005` (§39).
- [x] Polygon deletion.
- [x] Location selection.
- [x] Normalized coordinate conversion. — `viewBox="0 0 1 1"`, so a stored point
  IS its position; pointer input is clamped to 0..1
- [x] Area selection. — by clicking the shape, and from a keyboard-navigable list
- [x] Descendant-location restriction. — the picker offers only descendants
  (REQ-LOC-012), and the server rejects anything else

- [x] No different floor-plan representation was introduced.

Accessibility (`07-ui.md` §8): drawing is pointer-driven by nature, so the
keyboard alternatives are explicit — coordinates can be typed instead of
clicked, and every area is selectable from a list.

---

# 18.7 Attributes

- [x] Dynamic asset attributes.
- [x] Dynamic asset-unit attributes.
- [x] Type-specific inputs. — TEXT, NUMBER, BOOLEAN and DATE each get their own
  control
- [x] Required fields.
- [x] Measurement units. — shown beside a NUMBER attribute
- [BLOCKED] Allowed values. — `GAP-001`. A SELECTION attribute has no stored
  option list, so it renders as free text with the limitation stated inline. No
  storage was invented.
- [x] Validation messages. — server `VALIDATION_ERROR` details mapped to fields

The form is rendered from `GET .../attribute-values`, which returns every
applicable definition valued or not — one response is both the schema and the
data, so the form cannot offer an input the server will refuse.

---

# 18.8 Attachments

- [x] Attachment list.
- [x] Upload.
- [x] Download. — through the authorized endpoint, not a bare link
- [x] Delete.
- [x] File validation. — type and size checked before sending, mirroring
  `05-infrastructure.md` §5.3
- [N/A] Upload progress if required. — files are capped at 10 MB, so a progress
  bar would flash rather than inform; the button shows a pending state instead

---

# 18.9 Completion Criteria

- [x] The complete core asset registry can be managed through the frontend.

208 frontend tests (155 before this phase; +53).

---

# 19. Phase 13 — Frontend Procurement

## Objective

Implement procurement management and the procurement-to-asset workflow.

Frontend only. Every endpoint this phase consumes was built and tested in
Phase 6 (§12); no API, model, migration, seed or dependency change is required or
permitted here.

---

# 19.0 Route matrix

`07-ui.md` §5.5, plus §5.6's Vendors row — Vendors are Phase 13 work
(`DEC-034`), even though they live in the Operations nav group.

| Route | Screen | Permission | REQ |
|---|---|---|---|
| `/procurement/suppliers` | Supplier list + create dialog | `supplier:read` | REQ-SUPPLIER-001 |
| `/procurement/suppliers/:id` | Supplier detail — Details / Contracts (`DEC-040`) | `supplier:read` | REQ-SUPPLIER-001/002/003 |
| `/procurement/contracts` | Contract list | `contract:read` | REQ-PROC-002 |
| `/procurement/contracts/new` | Contract create — full page (`DEC-033`) | `contract:create` | REQ-PROC-002/003 |
| `/procurement/contracts/:id` | Contract detail — Details / Items | `contract:read` | REQ-PROC-002/004/005 |
| `/procurement/contracts/:id/edit` | Contract edit — full page (`DEC-033`) | `contract:update` | REQ-PROC-002/003 |
| `/operations/vendors` | Vendor list + create dialog | `vendor:read` | REQ-VENDOR-001 |
| `/operations/vendors/:id` | Vendor detail — Details / Assets | `vendor:read` | REQ-VENDOR-001/002/004 |

Contract-item detail and the Add-asset form are dialogs on the contract detail
page, not routes (`DEC-035`).

---

# 19.1 Suppliers

- [x] Supplier list.
- [x] Supplier search. — `q`, URL-synced
- [x] Supplier detail. — Details / Contracts tabs (`DEC-040`)
- [x] Create. — dialog; three fields do not warrant a route
- [x] Edit.
- [x] Activate/deactivate. — confirm dialog, `supplier:deactivate` for both

No institution filter: suppliers are global (`DEC-007`), so there is nothing to
scope them by.

---

# 19.2 Vendors

- [x] Vendor list.
- [x] Vendor detail.
- [x] Create.
- [x] Edit.
- [x] Activate/deactivate.
- [x] Related assets. — Assets tab on `GET /vendors/:id/assets`, gated by
  `asset:read` rather than `vendor:read`, because that is what the endpoint
  requires; hidden without it (`DEC-032`)

---

# 19.3 Contracts

- [x] Contract list.
- [x] Search. — `q` matches the contract NUMBER only, as the server does
- [x] Filter. — `supplierId`, `contractTypeId`, `institutionId`, `status`; each
  reference filter hidden without its own read permission
- [x] Detail. — Details / Line items tabs
- [x] Create. — `/procurement/contracts/new` (`DEC-033`)
- [x] Edit. — `/procurement/contracts/:id/edit`
- [x] Activate/deactivate.

Supplier names in the list come from one reference query and a lookup map
(`DEC-037`); the backend serializer was not changed.

---

# 19.4 Contract Items

- [x] Contract item list.
- [x] Create.
- [x] Edit.
- [x] Delete where allowed. — hard delete behind a confirm dialog; the server's
  `CONFLICT` is shown verbatim and the dialog stays open
- [x] Quantity.
- [x] Unit price.
- [x] Asset relationship. — `GET /contract-items/:id/asset-units` in the item
  dialog, hidden without `asset-unit:read`

An inline sub-table on the contract detail page (`07-ui.md` §5.5). Deletion is a
real hard delete — `contract_items` has no `is_active` column — and the server's
`CONFLICT` once units reference the item must reach the user (§12.4).

---

# 19.5 Procurement → Asset

Implement:

```text
Contract
    ↓
Contract Item
    ↓
Add asset          (`DEC-039` — English label)
    ↓
Asset
    ↓
Asset Unit(s)
```

The UI must preserve procurement traceability.

A short dialog form (`DEC-035`), not the full `/assets/new` page: the item
supplies the name, the caller supplies the classification (`DEC-009`) and the
unit count (`DEC-036`), and the server fills in `Asset.contractId` and
`AssetUnit.contractItemId` itself. Both `asset:create` and `asset-unit:create`
are required (`DEC-010`).

---

# 19.6 Traceability views

Navigational only — the reports are Phase 15's (`GAP-002`, `DEC-038`).

- [x] Vendor → assets. — `GET /vendors/:id/assets`
- [x] Supplier → contracts. — `GET /contracts?supplierId=`
- [x] Contract → assets. — link to `/assets?contractId=`
- [x] Contract item → asset units. — in the item dialog

---

# 19.7 Completion Criteria

- [x] A user can manage procurement records and create traceable assets through
  the frontend.

262 frontend tests (208 before this phase; +54). Verified in a browser against
the running API, end to end: supplier → contract → line item → Add asset →
3 units registered against an ordered quantity of 10 → the created asset's
Overview showing its contract, and the line item refusing deletion with
"3 asset unit(s) were procured through it".

---

# 20. Phase 14 — Frontend Operations

## Objective

Implement borrowing, transactions, and operational workflows.

Frontend only. Every endpoint was built and tested in Phase 7 (§13); no API,
model, migration, seed or dependency change is required or permitted here.
Vendors are NOT in scope — they shipped in Phase 13 (`DEC-034`).

---

# 20.0 Route matrix

`07-ui.md` §5.6, minus the Vendors row.

| Route | Screen | Permission | REQ |
|---|---|---|---|
| `/operations/borrowings` | List | `borrowing:read` | REQ-BORROW-001, REQ-REPORT-007 |
| `/operations/borrowings/new` | Create — always `DRAFT` | `borrowing:create` | REQ-BORROW-001–005 |
| `/operations/borrowings/:id` | Detail — inline DRAFT edit (`DEC-042`), items, state actions | `borrowing:read` | REQ-BORROW-006–015 |
| `/operations/transactions` | List | `transaction:read` | REQ-TXN-001 |
| `/operations/transactions/new` | Create — header and items in one call (`DEC-016`) | `transaction:create` | REQ-TXN-001–005 |
| `/operations/transactions/:id` | Detail — READ-ONLY, no edit affordance anywhere | `transaction:read` | REQ-TXN-004/007 |

Unit selection is a shared asset-first picker (`DEC-041`). There is no borrowing
`/edit` route and no transaction edit path of any kind.

---

# 20.1 Borrowing List

- [x] Borrowing table.
- [x] Search. — `q`, matching borrower name AND contact, as the server does
- [x] Filters. — `status`, `overdue`, `institutionId`
- [x] Status.
- [x] Borrower.
- [BLOCKED] Date filters. — `GAP-011`: `06-api.md` §7.2 defines none, and one
  page filtered in the browser would be worse than none (`DEC-043`, §33)
- [x] Pagination.

---

# 20.2 Borrowing Creation

- [x] Borrower selection. — name and contact, both required (REQ-BORROW-002)
- [x] Date selection.
- [x] Expected return date.
- [x] Unit selection. — asset-first picker (`DEC-041`), since no endpoint lists
  units globally (`GAP-008`); units are added on the detail page, because the
  borrowing must exist before `POST /borrowings/:id/items`
- [x] Validation. — including the date order `chk_borrowings_return_after_borrow`
  enforces, and the institution a system-wide caller must name
- [x] Draft state. — always created `DRAFT`

---

# 20.3 Borrowing Detail

Display:

- [x] Borrower. — editable in place while `DRAFT` (`DEC-042`), read-only after
- [x] Items.
- [x] Dates.
- [x] Status.
- [x] Return information.
- [x] History. — derived from the record itself (`DEC-044`); the audit trail is
  Phase 15's, and the extension chain is not navigable (`GAP-010`)

Actions must depend on current state.

- [x] Actions depend on current state. — `DEC-046`

---

# 20.4 Borrowing Actions

- [x] Activate. — also moves each unit `ACTIVE → BORROWED` (`DEC-013`)
- [x] Cancel.
- [x] Return. — also moves each unit `BORROWED → ACTIVE`
- [x] Extend. — closes this record and opens a new `DRAFT`, then navigates to it
  (`DEC-047`)

Do not display invalid actions.

- [x] Invalid actions are not displayed. — a `RETURNED` or `CANCELLED` record
  offers none, and no action targets `OVERDUE`: the Phase 8 sweep writes it

---

# 20.5 Transactions

- [x] Transaction list.
- [x] Filters. — type, institution, contract, and a real `dateFrom`/`dateTo`
- [x] Create. — header and items in one call (`DEC-016`), at least one unit
- [x] Detail.
- [x] Items. — with per-unit notes
- [x] Related asset/unit. — each item links to the unit and its asset

Transaction detail must remain read-only.

- [x] Detail is read-only. — no edit, delete or deactivate affordance exists
  anywhere on the page, because `06-api.md` §7.3 exposes none (REQ-TXN-007)

Supplier and contract are always offered with an explanatory hint (`DEC-045`):
nothing marks a transaction type as procurement-originated (`GAP-009`).

---

# 20.6 Completion Criteria

- [x] Borrowing and transaction workflows can be completed from the frontend
  while respecting backend state and authorization rules.

308 frontend tests (262 before this phase; +46). Verified in a browser against
the running API: a unit brought into service, borrowed, activated to `BORROWED`,
extended into a new draft, and the closed record keeping its true dates with no
actions offered.

---

# 21. Phase 15 — Reports & Audit

## Objective

Implement the read-only reporting and audit APIs, then the dashboard, reporting
and audit interfaces that consume them.

This phase is full-stack by assignment — see `GAP-002` (§39). It is the only
phase that owns `06-api.md` §9 and §10. It MUST run backend-first: every endpoint
in §21.0 is implemented and tested before any screen in §21.1–§21.4 begins, which
is the ordering `CLAUDE.md` §10 requires.

---

# 21.0 Reporting & Audit APIs (backend)

Owner of `06-api.md` §9 and §10, assigned by `GAP-002`. Both permission
resources already exist in the generated catalog and are currently unused.

## Reporting endpoints (§9) — read-only aggregates, all organization-scoped

- [x] `GET /reports/inventory` — REQ-REPORT-001
- [x] `GET /reports/status` — REQ-REPORT-002
- [x] `GET /reports/by-classification` — REQ-REPORT-003
- [x] `GET /reports/by-organization` — REQ-REPORT-004
- [x] `GET /reports/by-location` — REQ-REPORT-005
- [x] `GET /reports/by-condition` — REQ-REPORT-006
- [x] `GET /reports/borrowings` — REQ-REPORT-007
- [x] `GET /reports/procurement-traceability` — REQ-REPORT-008

## Audit READ API (§10) — read-only, REQ-AUDIT-003

- [x] `GET /audit-logs` — filters `entityType`, `entityId`, `actorId`, `action`,
  `dateFrom`, `dateTo`
- [x] `GET /audit-logs/:id`

No write path may be added: Phase 8 records the trail, and `DR-015` makes it
immutable.

## Tests

- [x] Report aggregation correctness.
- [x] Report organization scope.
- [x] Audit log filtering.
- [x] Audit read-only behavior.

---

# 21.1 Dashboard

> [!IMPORTANT]
> `GAP-003` (§39) must be settled before any chart here is implemented. No
> charting dependency is installed, and Recharts is an unconfirmed proposal
> (`07-ui.md` §9). Decide it explicitly first.

Implement the dashboard specified by the UI and product documents.

- [x] Summary metrics.
- [x] Asset statistics.
- [x] Status statistics.
- [x] Condition statistics.
- [x] Borrowing information.
- [x] Relevant charts.

---

# 21.2 Reports

- [x] Inventory report.
- [x] Status report.
- [x] Classification report.
- [x] Organization report.
- [x] Location report.
- [x] Condition report.
- [x] Borrowing report.
- [x] Procurement traceability.

---

# 21.3 Report Features

Where specified:

- [x] Filtering. — declared per report (`DEC-051`), never invented
- [x] Date range. — on the borrowing report, which is the only one whose source
  carries a date the range means anything against
- [x] Institution filter. — on all eight
- [N/A] Department filter. — no report endpoint accepts one. `department_id` is
  on the Asset Unit and appears in `by-organization` as a GROUPING, not as a
  parameter. A control that filtered nothing would be worse than its absence.
- [x] Classification filter. — inventory, through the shared §4.5 picker
- [N/A] Location filter. — no report endpoint accepts one either; `by-location`
  groups by it. Same reasoning as the department filter.
- [x] Export. — client-side CSV of the displayed rows (`DEC-052`), stated as such
  in the UI

---

# 21.4 Audit

- [x] Audit list.
- [x] Entity filter.
- [x] Entity ID filter.
- [x] Actor filter.
- [x] Action filter.
- [x] Date range.
- [x] Audit detail.
- [x] Old/new value comparison.

Audit UI is read-only.

---

# 21.5 Completion Criteria

- [x] All documented dashboard, reporting, and audit screens are implemented and
  connected to their APIs.

Backend-first was honoured: §21.0 was implemented, tested (39 tests) and approved
at its own checkpoint before any screen was written.

349 frontend tests (308 before this phase; +41) and 637 database/API tests (598
before; +39). Verified in a browser against real data produced by earlier phases:
the dashboard's metrics and both bar charts, the eight reports, an audit trail of
18 entries spanning Phases 13–15, and an audit detail showing the Phase 14
extension as `status ACTIVE → RETURNED`.

---

# 22. Phase 16 — Integration & Hardening

## Objective

Verify the complete application against the specification.

This is the final implementation phase.

---

# 22.1 Requirement Traceability

Review all requirements.

For every requirement determine:

```text
Requirement
    ↓
Domain
    ↓
Database
    ↓
API
    ↓
UI
    ↓
Test
```

Identify:

- [x] Implemented.
- [x] Tested.
- [x] Deferred.
- [x] Not applicable.
- [x] Blocked.

No requirement should be silently forgotten.

## Deferred items awaiting reconciliation here

Carried forward from earlier phases with an explicit decision that they are NOT
to be fixed in the phase that found them. Each needs a verdict in this phase —
implement, or record as an accepted limitation.

- [x] `GAP-006` — the asset list's Contract column never resolves a number
  (REQ-ASSET-011). Raised in Phase 13; the screen is Phase 12's.
- [x] `GAP-007` — a vendor can only be attached to an asset through the
  procurement flow (REQ-VENDOR-003/004). Raised in Phase 13; the form is
  Phase 12's.
- [x] Vendor and contract filter chips on `/assets` (`07-ui.md` §5.3,
  `DEC-038`). The URL param already filters server-side; only the visible
  control is missing.
- [x] `GAP-012` — the dashboard has no specification, yet `/` is a guarded route
  and §21.1 asks six things of it. Decide whether it warrants a `07-ui.md`
  section.
- [x] `GAP-013` — the audited entity-type set lives only in
  `db/auditHooks.js`. Decide whether it belongs in a specification document.
- [x] `DEC-050` — `audit-log:read` cannot be organization-scoped, because
  `audit.audit_logs` has no institution and no join path to one. Decide whether
  the schema should change or the permission should become system-wide by
  declaration.
- [x] `DEC-051` — eight report endpoints accept query parameters that
  `06-api.md` §9 does not document. Reconcile the contract.
- [x] `DEC-052` — export is client-side CSV of the loaded page only. Decide
  whether server-side export of a full result set is required.
- [x] `GAP-008` — no endpoint lists asset units globally, and
  `GET /locations/:id/units` accepts no filters. Raised in Phase 14; it is a
  `06-api.md` §5.2 question.
- [x] `GAP-009` — nothing marks a transaction type as procurement-originated, so
  `07-ui.md` §5.6's conditional fields cannot be driven.
- [x] `GAP-010` — an extension chain is not navigable (no `extended_from_id`),
  so REQ-BORROW-014's chain cannot be followed in either direction.
- [x] `GAP-011` — `GET /borrowings` has no `dateFrom`/`dateTo`, though §20.1
  asks for date filters.
- [x] `GAP-001` — SELECTION attribute option lists have nowhere to be stored.
- [x] `GAP-004` — no password-change or password-reset capability.
- [x] `GAP-005` — floor-plan areas are redrawn rather than edited in place.
- [x] ESLint `react-refresh/only-export-components` warnings (21 as of
  Phase 14) — files exporting a schema or helper beside a component. Cleanup
  only; there are no errors.
- [x] Reference selectors load at most 100 rows (institutions, users,
  transaction types, contracts, suppliers). Raised in Phase 13, carried through
  Phase 14, accepted as non-blocking: reference lists are short today. Reconcile
  only if one grows past the cap.
- [x] `ModulePlaceholder` (`pages/placeholders.jsx`) is dead code as of
  Phase 15 — no route references it. Remove it, or keep it deliberately.
- [x] Phase 14's `TransactionsPage` renders `<Label htmlFor>` against a
  `DatePicker`, which takes no `id`, so the association is claimed and not
  delivered. Fixed in the Phase 15 screens; Phase 14 was not reopened.
- [x] §21.3's department and location report filters are `N/A` — no report
  endpoint accepts either. Decide whether the endpoints should gain them.

---

# 22.2 Database Verification

- [x] Fresh database installation.
- [x] Migration.
- [x] Rollback.
- [x] Re-migration.
- [x] Seed.
- [x] Constraints.
- [x] Indexes.
- [x] Foreign keys.
- [x] Historical integrity.

---

# 22.3 Authentication Verification

- [x] Login.
- [x] Logout.
- [x] Refresh.
- [x] Expiration.
- [x] Revocation.
- [x] Inactive users.
- [x] Password hashing.
- [x] Authorization.
- [x] Permission enforcement.
- [x] Institution scope.
- [x] System-wide roles.

---

# 22.4 Business Rule Verification

Verify all critical rules, including:

- [x] Classification leaf enforcement.
- [x] Attribute scope.
- [x] Attribute type validation.
- [x] Asset/unit relationships.
- [x] Procurement traceability.
- [x] Location hierarchy.
- [x] Floor-plan integrity.
- [x] Location assignment validity.
- [x] Lifecycle transitions.
- [x] Historical preservation.
- [x] Borrowing availability.
- [x] Borrowing state transitions.
- [x] Overdue behavior.
- [x] Transaction immutability.
- [x] Unit-level traceability.

---

# 22.5 API Verification

- [x] Endpoint coverage.
- [x] Request validation.
- [x] Response validation.
- [x] Error response consistency.
- [x] Authentication.
- [x] Authorization.
- [x] Pagination.
- [x] Filtering.
- [x] Sorting.
- [x] Institution scope.
- [x] File upload/download.
- [x] Rate limiting.

---

# 22.6 Frontend Verification

- [x] Route coverage.
- [x] Protected routes.
- [x] Permission gating.
- [x] Form validation.
- [x] Loading states.
- [x] Empty states.
- [x] Error states.
- [x] Confirmation dialogs.
- [x] Toasts.
- [x] Responsive behavior.
- [x] Table usability.
- [x] Accessibility baseline.
- [x] Floor-plan interaction.
- [x] Attachment interaction.

---

# 22.7 Testing

Run:

- [x] Unit tests. — 202 backend
- [x] Integration tests. — the 637 database/API tests run against real Postgres
  and Redis through the full HTTP stack, not against mocks
- [x] API tests. — every endpoint in `06-api.md` §2–§10
- [x] Authorization tests. — per-endpoint permission and organization scope
- [x] Database tests. — migrate → rollback → re-migrate, constraints, indexes
- [x] Frontend tests. — 356
- [N/A] End-to-end tests. — ACCEPTED LIMITATION. No browser E2E framework is
  installed and none was ever specified (`05-infrastructure.md` §11.1 names
  Vitest and Supertest only). The integration tier above exercises the real
  stack, and the critical journeys were browser-verified by hand in Phases
  12–16. Adding one is a new dependency with its own CI and fixture design —
  recorded as a deferred enhancement, not claimed as done.

---

# 22.8 Infrastructure Verification

Authored in Phase 16 from `05-infrastructure.md`, and verified as far as this
environment allows. What could NOT be verified is marked as such rather than
ticked — there is no VPS, domain or certificate here.

- [x] Development Docker environment. — unchanged, still starts
- [x] Production Docker build. — both images BUILT AND RUN. Three real defects
  were found and fixed by doing so: a workspace `node_modules` path that does not
  exist, a missing `MAX_UPLOAD_SIZE_MB`, and the classification CSV being absent
  from the API image, which made the first seed impossible.
- [x] PostgreSQL persistence. — named volume, verified across a restart
- [x] Redis configuration. — `--appendonly yes`; sessions survive a restart
- [x] Storage persistence. — host bind mount, writable by the non-root user
- [x] Nginx. — VERIFIED: static assets, SPA fallback, `/api` proxy, cache and
  security headers all checked against the running container. Two defects found
  and fixed: startup-time upstream resolution that made an API outage take the
  frontend down with it, and `add_header` in a `location` silently dropping the
  security headers from the main document.
- [UNVERIFIED] HTTPS. — `deploy/nginx/site.conf` is authored from §12.1 and
  reviewed. Certbot, the certificate and the redirect chain cannot be exercised
  without a domain.
- [x] Health endpoint. — `/api/health` verified through the proxy
- [x] Environment validation. — fail-fast confirmed: the API refused to start on
  a missing variable during this very verification
- [x] Backup procedure. — `deploy/backup.sh` written to §4 (14 daily + 4 weekly,
  off-VPS replication). NOT executed: it needs a host cron and a running stack.
- [x] Restore procedure. — `deploy/restore.sh` written, including the health
  check after reload. NOT executed for the same reason.
- [x] CI/CD. — `.gitlab-ci.yml` matches §11.1's stages and §11.3's manual
  production gate. The commands it runs are the ones used throughout this build.
- [UNVERIFIED] Deployment verification. — no target exists. The deploy STEPS
  (pull → migrate → up) were executed locally against the production compose
  stack; the SSH deployment itself was not.

---

# 22.9 Security Review

Review:

- [x] Authentication.
- [x] Authorization.
- [x] Password storage.
- [x] Token handling.
- [x] Refresh-token handling.
- [x] Cookie security.
- [x] CORS.
- [x] Helmet.
- [x] Rate limiting.
- [x] Input validation.
- [x] File validation.
- [x] SQL injection protection.
- [x] Sensitive logging.
- [x] Error disclosure.
- [x] Institution isolation.

---

# 22.10 Performance Review

Review:

- [x] Database indexes.
- [x] N+1 queries.
- [x] Pagination.
- [x] Large asset lists.
- [x] Large history queries.
- [x] Attachment handling.
- [x] API response times.
- [x] Frontend rendering.
- [x] Query caching.
- [x] Frontend bundle size and code splitting. — carried here from Phase 10 by
  decision. The bundle passed Vite's 500 kB warning at 584 kB (184 kB gzipped)
  with everything in one chunk, because no route is lazy-loaded. Optimizing it
  before the business screens exist would be premature; assess it here, once the
  real screen set is known.

---

# 22.11 Documentation Review

- [x] README. — the Status and phase table were badly stale ("Phase 5 complete…
  the frontend does not exist yet") and were corrected here
- [x] Environment setup.
- [x] Database setup.
- [x] Migration instructions. — including that migrations are a DEPLOY step
- [x] Bootstrap instructions. — seed, then `npm run bootstrap` interactively
- [x] Development instructions.
- [x] Production deployment. — new README section covering the artifacts, the
  deploy sequence and what is explicitly unverified
- [x] API documentation. — `docs/06-api.md` IS the contract; the README points
  at it rather than duplicating it as OpenAPI
- [x] Architecture documentation. — `docs/03-domain.md`, `04-data-model.md` and
  `05-infrastructure.md`, with the deployment topology now mirrored in the README
- [x] Requirement traceability. — a Status column added to the matrix in
  `02-requirements.md` §28, covering all 170 requirements
- [x] Known limitations. — a README table naming every accepted limitation and
  the gap that records it

---

# 23. Phase Completion Protocol

At the end of every phase Claude MUST produce a report with exactly these
sections.

## Implementation Summary

Explain what was implemented.

## Files Created

List every new file.

## Files Modified

List every modified file.

## Files Deleted

List deleted files, if any.

## Requirements Implemented

List the relevant requirement IDs.

## Database Changes

If applicable, list:

- migrations
- tables
- indexes
- constraints
- seeds

## API Changes

If applicable, list:

- endpoints
- middleware
- services

## UI Changes

If applicable, list:

- routes
- pages
- components
- stores
- queries/mutations

## Tests Added

List tests created.

## Tests Executed

List commands and results.

## Verification

Describe manual or automated verification.

## Known Issues

List unresolved issues.

If none:

```text
None.
```

## Deferred Work

List work intentionally left for later phases.

## Specification Conflicts

List any specification conflict.

If none:

```text
None.
```

## Phase Status

Use:

```text
PHASE N COMPLETE — WAITING FOR APPROVAL
```

Claude MUST STOP after this report.

---

# 24. Phase Start Protocol

When the user says:

```text
Start Phase N
```

Claude MUST follow this sequence:

```text
1. Read specification
       ↓
2. Inspect repository
       ↓
3. Verify previous phase
       ↓
4. Identify dependencies
       ↓
5. Identify conflicts
       ↓
6. Present implementation plan
       ↓
7. Implement Phase N
       ↓
8. Test Phase N
       ↓
9. Verify Phase N
       ↓
10. Report
       ↓
11. STOP
```

---

# 25. Phase Verification Gate

Before declaring a phase complete, Claude MUST verify:

```text
Current phase implemented
        AND
Tests pass
        AND
Specification followed
        AND
No blocking issue exists
        AND
Future phases not implemented
```

Only then:

```text
PHASE N COMPLETE — WAITING FOR APPROVAL
```

---

# 26. Dependency Failure

If a required dependency is missing:

Claude MUST NOT bypass it by implementing future functionality.

Instead:

```text
Phase N
   │
   ▼
Dependency missing
   │
   ▼
Report dependency
   │
   ▼
BLOCKED
   │
   ▼
STOP
```

Example:

```text
Phase 5 requires functionality from Phase 4.

Do not implement Phase 4 functionality inside Phase 5.

Report the dependency and wait for instruction.
```

---

# 27. Change Control

Any change to the architecture must be explicitly approved.

This includes changes to:

- database schema.
- domain model.
- requirements.
- API contracts.
- authentication strategy.
- authorization model.
- infrastructure.
- frontend architecture.
- storage strategy.
- major dependencies.

Claude MUST NOT silently make such changes.

Use:

```text
## Proposed Architecture Change

Affected Document:
Affected Section:

Current Design:

Problem:

Proposed Change:

Reason:

Affected Components:

Migration / Compatibility Impact:

Recommendation:
```

Then STOP.

---

# 28. Scope Control

Claude should prefer completing the smallest coherent implementation that
satisfies the current phase.

Do not add:

- unrelated features.
- speculative abstractions.
- unnecessary libraries.
- unrequested redesigns.
- alternative architecture.
- premature optimization.

If something is useful but belongs to a later phase, record it under:

```text
Deferred Work
```

Do not implement it early.

---

# 29. Code Quality Rules

All implementation MUST:

- follow the established project structure.
- follow the documented technology stack.
- use existing abstractions where appropriate.
- avoid duplicate implementations.
- use meaningful names.
- keep business logic out of controllers/components where architecture
  specifies services/use-cases.
- validate external input.
- handle expected errors.
- preserve database integrity.
- preserve authorization boundaries.
- include tests for non-trivial behavior.

Do not refactor unrelated parts of the project during a phase unless required
for the current phase.

---

# 30. Database Rules

Database implementation MUST:

- use migrations.
- preserve migration ordering.
- preserve foreign-key integrity.
- preserve documented constraints.
- use transactions for multi-step atomic operations.
- avoid destructive migrations without explicit approval.
- avoid storing derived data when the model does not require it.
- avoid duplicating historical information unnecessarily.

Never modify production-like data through migration code merely to make tests
pass.

---

# 31. API Rules

API implementation MUST:

- follow `06-api.md`.
- preserve endpoint naming.
- preserve documented request/response structures.
- enforce authentication where required.
- enforce authorization.
- validate input.
- use consistent errors.
- use pagination where documented.
- respect institution scope.
- preserve historical records.

Do not invent new endpoints when an existing documented endpoint can support
the requirement.

If a new endpoint appears necessary, propose it and wait for approval.

---

# 32. Frontend Rules

Frontend implementation MUST:

- follow `07-ui.md`.
- use the established design system.
- use shared components where applicable.
- use TanStack Query for server state.
- use Zustand only for client/application state where appropriate.
- use React Hook Form + Zod for forms.
- respect backend authorization.
- show loading states.
- show empty states.
- show error states.
- avoid duplicating server state unnecessarily.

The frontend MUST NOT become the source of truth for business rules.

Backend validation remains authoritative.

---

# 33. Search and Filtering Rules

For large datasets, use server-side:

- pagination.
- filtering.
- sorting.
- search.

Do not load entire tables into the browser merely to implement filtering.

---

# 34. Historical Data Rules

Historical records must remain historically accurate.

Do not update historical records simply to reflect the current state.

Current state and historical state are separate concepts.

When a state changes, create the appropriate historical record according to
the domain/data model.

---

# 35. Transactional Operation Rules

Operations involving multiple dependent database writes MUST use database
transactions where the specification requires atomicity.

Examples:

```text
Contract Item
      ↓
Asset
      ↓
Asset Unit
```

If one operation fails, the complete operation must roll back.

---

# 36. Authentication Security Rules

Never:

- hardcode passwords.
- hardcode secrets.
- commit tokens.
- commit refresh tokens.
- expose secrets in logs.
- create a default production credential.
- bypass authorization for convenience.

Use environment/configuration mechanisms defined by the infrastructure
specification.

---

# 37. File Handling Rules

Files must:

- be validated.
- be stored according to the infrastructure specification.
- not be stored directly in PostgreSQL unless the specification explicitly
  requires it.
- be accessed through authorized endpoints.
- preserve attachment metadata.

---

# 38. Final Completion Definition

The project is implementation-complete only when all required phases have
been completed and Phase 16 has passed.

The final state must satisfy:

```text
Product
   ✓

Requirements
   ✓

Domain
   ✓

Database
   ✓

Infrastructure
   ✓

Authentication
   ✓

Authorization
   ✓

Backend APIs
   ✓

Business workflows
   ✓

Frontend
   ✓

Reports
   ✓

Audit
   ✓

Testing
   ✓

Deployment
   ✓

Traceability
   ✓
```

---

# 39. Accepted Specification Decisions and Open Gaps

Decisions taken when the specification documents disagreed, or when a documented
requirement had no mechanism behind it. Each was raised at the end of the phase
that hit it and approved explicitly, per §3.6 and §27.

These are settled. Do not revisit a decision unless a new explicit requirement
changes the underlying data model.

---

## DEC-001 — Department is a flat, global list

**Phase:** 4 **Status:** ACCEPTED

**Conflict.** §10.2 of this plan required "Parent/child handling" and
"Institution scope" for Departments. `public.departments`
(`04-data-model.md` §5.2.2) has neither a `parent_id` nor an `institution_id`
column, `03-domain.md` §4.2 defines the same flat entity, and `06-api.md` §3.2
documents no hierarchy endpoints.

**Decision.** Department stays a flat, global list. No `parent_id`, no
`institution_id`, no migration. The two bullets were removed from §10.2 and the
corresponding §10.9 test is marked N/A.

**Rationale.** Three of the four documents already agree, and this plan is not
permitted to override the specification (§2). Organizational responsibility for a
physical item is expressed on `asset_units.department_id`, not on the department
itself, and `07-ui.md` §5.1 shows a plain department list rather than a tree.

---

## DEC-002 — `GET /reference/conditions` is in scope

**Phase:** 4 **Status:** ACCEPTED

§10.8 lists six lookup resources and does not mention conditions, but
`06-api.md` §4.6 documents the endpoint and `REQ-REF-006` requires condition
reference data. The endpoint is implemented, serving `ConditionEnum` as a static
list rather than a CRUD resource, and `condition:read` is part of the generated
permission catalog.

---

## DEC-003 — `GET /classifications/:id/path` is in scope

**Phase:** 4 **Status:** ACCEPTED

Not enumerated in `06-api.md` §4.1, but that section requires a classification to
resolve through its full ancestor path, and `07-ui.md` §4.5 needs a breadcrumb
for an already-selected classification — not only for a fresh search hit.
Exposing the path as its own endpoint serves both without duplicating the
recursive query.

---

## DEC-004 — `GET /locations/:id/units` includes descendant locations

**Phase:** 5 **Status:** ACCEPTED

`06-api.md` §5.3 describes the endpoint as "asset units currently at this
location". It resolves units at the location **and at every location beneath
it**.

**Rationale.** Locations nest to represent physical containment (REQ-LOC-007), so
asking what is in a building means everything in its rooms. A strict
same-location-only reading would report an empty building whose rooms are full,
and REQ-REPORT-005 groups assets by location on the same understanding.

---

## DEC-005 — Floor plan metadata and image are separate endpoints

**Phase:** 5 **Status:** ACCEPTED

`06-api.md` §5.3 describes `GET /locations/:id/floor-plan` as returning
"metadata + download". It is implemented as two endpoints:

- `GET /locations/:id/floor-plan` — JSON metadata and areas, in the standard
  `{ data }` envelope (§1.4)
- `GET /locations/:id/floor-plan/image` — the raw image bytes

**Rationale.** A single endpoint would have to either wrap binary data in JSON or
abandon the response envelope every other endpoint uses. Separating them keeps
the envelope intact and lets the image be used directly as an `<img>` source.

---

## DEC-006 — `GET /asset-units/:id/locations` exposes location assignment history

**Phase:** 5 **Status:** ACCEPTED

Not enumerated in `06-api.md` §5.2, but §11.5 of this plan requires location
assignment, history, start/end dates and overlap handling, and
`public.asset_unit_locations` exists precisely to hold them (REQ-LOC-004). The
endpoint is the only way to read that table.

It is distinct from `GET /asset-units/:id/history`, which returns the
longitudinal record of condition, location and lifecycle state together.

---

## DEC-007 — Vendors and Suppliers are global, not organization-scoped

**Phase:** 6 **Status:** ACCEPTED

**Conflict.** `06-api.md` §1.3 states that every list/detail endpoint is scoped
to the caller's `institutionId` (`BR-007`, REQ-AUTHZ-004). `public.vendors` and
`public.suppliers` (`04-data-model.md` §5.4.1, §5.4.2) have no `institution_id`
column, so there is nothing to scope on. `public.contract_items` (§5.4.4) has
none either.

**Decision.** Vendors and Suppliers are global reference entities:
permission-gated, but not restricted by institution. No `institution_id` is
added and no migration is created. Contracts remain scoped through
`contracts.institution_id`. Contract items inherit their parent contract's
scope. `GET /vendors/:id/assets` scopes the **assets** it returns, because
Assets do carry an institution.

**Rationale.** The same manufacturer or supplier is expected to appear across
institutions; partitioning them would force duplicate rows for one real-world
company. This is the same shape as `DEC-001`: where the data model defines an
entity as global, the API layer does not invent a scope for it. Organizational
ownership is expressed where the data model puts it — on the records that
reference these entities, not on the entities themselves.

---

## DEC-008 — Vendors are implemented in Phase 6

**Phase:** 6 **Status:** ACCEPTED

`06-api.md` organizes Vendors under §7 "Operations", while §12.2 of this plan
places them in Phase 6 and §13 (Phase 7) does not mention them at all.

Vendors are implemented in Phase 6, per this plan. This is documentation
organization, not a functional conflict: no requirement, table, or endpoint
behavior differs either way, and deferring them would leave REQ-VENDOR-001–004
unimplemented in a phase that does not claim them.

---

## DEC-009 — ContractItem carries no classification

**Phase:** 6 **Status:** ACCEPTED

`REQ-PROC-005` lists "Asset/classification reference" among contract-item
information, but `public.contract_items` (`04-data-model.md` §5.4.4) has only
`asset_name`.

`06-api.md` §6.3 resolves this in the specification itself: "`classificationId`
still has to be picked explicitly … since `ContractItem` carries no
classification of its own". No column is added. `assetName` is the item's
description of what was purchased; the classification is chosen when the Asset
is created from it, where the leaf rule (`BR-011`) applies.

---

## DEC-010 — `POST /contract-items/:id/assets` requires two permissions

**Phase:** 6 **Status:** ACCEPTED

§1.3 derives permission codes mechanically from the resource being acted on,
which for this path segment gives `asset:create`. The operation also creates
Asset Units.

The endpoint requires **both** `asset:create` and `asset-unit:create`. Neither
alone authorizes it, because neither alone authorizes a meaningful half of the
operation — a caller who may not create units should not obtain them through the
procurement path. The equivalent two-step route (`POST /assets` then
`POST /assets/:id/units`) demands exactly the same pair.

---

## DEC-011 — Institution precedence in the procurement-to-asset flow

**Phase:** 6 **Status:** ACCEPTED

`06-api.md` §6.3 lists `institutionId` as an optional body field but does not
say what fills it when omitted. The resolution order is:

```text
body.institutionId  ??  contract.institutionId  ??  caller's own scope
```

followed by the standard `BR-007` assignment guard, which rejects an institution
the caller cannot reach.

**Rationale.** The Contract already names the receiving institution, so requiring
the caller to repeat it would contradict REQ-PROC-009's "without requiring the
user to separately re-select". `unitCount` is bounded 1–500 as request
validation (REQ-VAL-001) and is deliberately NOT checked against
`contract_items.quantity`: no requirement ties registered units to ordered
quantity, and staged or partial registration is ordinary.

The response body — undefined by `06-api.md` — is
`{ data: { asset, units: [...] } }`, so the caller does not need a second request
to learn what was created.

---

## DEC-012 — A borrowing's composition is fixed at activation

**Phase:** 7 **Status:** ACCEPTED

`06-api.md` §7.2 annotates `DELETE /borrowings/:id/items/:itemId` as "`DRAFT`
only" and says nothing either way about `POST /borrowings/:id/items`.

Items may be added while `DRAFT` only. The alternative — adding a unit to an
already-`ACTIVE` borrowing — would need an undocumented rule about when that unit
becomes `BORROWED`, which is a bigger invention than the restriction. It also
matches the header being editable only while `DRAFT` and the whole-event model of
REQ-BORROW-011/`DR-018`. Continuing use of extra units is a new borrowing.

---

## DEC-013 — Activation and return drive the asset-unit lifecycle

**Phase:** 7 **Status:** ACCEPTED

`06-api.md` §7.2 describes the borrowing status transitions but does not say
whether they move the units.

Activating a borrowing moves every unit `ACTIVE → BORROWED`; returning it moves
them `BORROWED → ACTIVE`. Both write a `longitudinal_history` row through the
same code path as a manual state change, in the borrowing's own transaction.

**Rationale.** `03-domain.md` §7.1 draws both edges, and nothing else in the
system traverses them — without this, `BORROWED` would be reachable only by
hand and `BR-004`/`DR-006` would have no mechanism. REQ-LIFE-003 requires the
change to appear in the longitudinal history, so the borrowing cannot simply set
a column.

**Consequence, stated plainly.** A unit that is not `ACTIVE` — still
`REGISTERED`, `IN_STORAGE`, or `UNDER_MAINTENANCE` — cannot be borrowed, because
§7.1 draws no edge from those states to `BORROWED`. Activation rejects it with
`CONFLICT` naming the allowed next states. Bringing the unit to `ACTIVE` first
(`POST /asset-units/:id/history`) is the documented path. Widening this would be
a change to `03-domain.md` §7.1 and needs approval under §27.

Cancelling touches no unit: a `DRAFT` never held them. On return, a unit that is
no longer `BORROWED` is left alone rather than forced, so one disposed unit
cannot make a borrowing impossible to close.

**Reviewed at the Phase 7 gate.** Adding an `IN_STORAGE → BORROWED` edge was
raised explicitly and DECLINED. Lending a stored item is a plausible workflow,
but it is not one the specification defines, and the implementation follows the
state machine as drawn in `03-domain.md` §7.1. A unit that is not `ACTIVE`
cannot be borrowed.

Should this become a real requirement, it must be raised as a formal
domain-model change request under §27 and approved BEFORE any code changes —
not introduced by widening the transition table to make a workflow fit.

---

## DEC-014 — "Incompatible active borrowing" means ACTIVE or OVERDUE

**Phase:** 7 **Status:** ACCEPTED

`BR-003`/`DR-005`/REQ-BORROW-008 forbid "multiple incompatible active borrowing
assignments" without defining incompatible.

A unit is unavailable when another borrowing in `ACTIVE` or `OVERDUE` holds it.
Two `DRAFT` borrowings may name the same unit — nothing is committed until one
activates — and activation re-runs the check for every item, so whichever
activates first takes the unit and the other fails with `CONFLICT`.

**Rationale.** `BR-003` says *active*, and status is what the data model records;
a date-overlap reading would call a returned borrowing a conflict, or miss an
`OVERDUE` one whose expected return has passed. Blocking `DRAFT`s against each
other would make the draft state useless for planning.

---

## DEC-015 — Extension is a new borrowing, not an edit

**Phase:** 7 **Status:** ACCEPTED

Implemented exactly as `03-domain.md` §4.21 and `06-api.md` §7.2 describe:
`POST /borrowings/:id/extend` closes the current record (`RETURNED`, with
`actualReturnDate`) and creates a new `DRAFT` over the same units, starting on
the day the extension takes effect. The response is
`{ data: { returned, borrowing } }` — undefined by `06-api.md`, so both records
are returned rather than making the caller guess the new id.

The new record is `DRAFT`, per §7.2, so the units are free between the two and
become `BORROWED` again when it is activated. A single continuous loan is
therefore a chain of borrowings, each keeping the dates it actually had
(REQ-BORROW-015, `DR-011`).

---

## DEC-016 — Transaction items are supplied at creation

**Phase:** 7 **Status:** ACCEPTED

`06-api.md` §7.3 documents `POST /transactions` and `GET /transactions/:id/items`
but no endpoint for adding an item, and no `PATCH`.

Items are part of the create body (`items: [{ assetUnitId, notes? }]`), written
in the same database transaction as the header, and at least one is required.

**Rationale.** With no `PATCH` and no item endpoints, creation is the only moment
a transaction's composition can be set — REQ-TXN-007 makes that deliberate. A
transaction naming no units would be untraceable to any asset, contradicting
REQ-TXN-004 and REQ-TXN-010.

`overdue=true` on `GET /borrowings` is likewise derived — status in
(`ACTIVE`, `OVERDUE`) with `expected_return_date` in the past — so REQ-BORROW-012
is answered correctly whether or not the Phase 8 sweep (§14.3) has run.

---

## DEC-017 — BullMQ gets its own Redis connections

**Phase:** 8 **Status:** ACCEPTED

`05-infrastructure.md` §7.3 says the worker uses "the same Redis instance as
sessions". Same instance, separate connections.

BullMQ's worker issues blocking commands that hold a connection for as long as
the queue is idle; sharing the application's client would stall every session
lookup behind an empty queue. The job connections also need
`maxRetriesPerRequest: null` (BullMQ requires it) and `enableOfflineQueue: true`,
both the opposite of what an HTTP request wants.

---

## DEC-018 — Audit rows are written by model hooks, not by services

**Phase:** 8 **Status:** ACCEPTED

`IMPLEMENTATION_PLAN.md` §14.4 says what to record, not where from.

Audit rows are written by Sequelize `afterCreate`/`afterUpdate`/`afterDestroy`
hooks over an explicit allowlist (`src/db/auditHooks.js`), joining the caller's
transaction.

**Rationale.** The hook is the only place that reliably holds both the previous
and the new values (REQ-AUDIT-002) — a service knows what it meant to write, not
what was there before. And a service can forget; a hook cannot, including in
phases written later by someone who never read the audit code. Joining the
transaction means a rolled-back operation leaves no audit row, because nothing
happened.

**Excluded, deliberately:** `AuditLog` (circular), `LongitudinalHistory` and
`AssetUnitLocation` (already the asset's own append-only history),
`AssetClassification` and `Permission` (read-only reference data),
`Transaction`/`TransactionItem` (historical records never modified after
creation — REQ-TXN-007 — so the record is already its own audit). Everything an
authorized user can change is audited, including the authorization model itself.

**Redaction.** `passwordHash` and `storageReference` are replaced with
`[REDACTED]`: a password hash copied into an append-only trail would outlive
every rotation (REQ-NFR-SEC-001).

---

## DEC-019 — Actor and IP travel in an ambient request context

**Phase:** 8 **Status:** ACCEPTED

`audit_logs` wants `actor_id` and `ip_address` (`04-data-model.md` §5.6.1), and
neither is visible where the rows are written.

An `AsyncLocalStorage` context (`src/http/auditContext.js`) is bound once per
request and read by the audit service. The actor is filled in by `authenticate`
once identity resolves.

**Rationale.** The alternative — threading a context argument through every
service and model call — would touch all of Phases 4–7 and would silently drop
the actor wherever a call site forgot. Outside a request (seeder, bootstrap CLI,
background job) the store is empty and the actor is NULL, which the data model
defines as "system".

**Failure policy.** An audit write that fails is logged at `error` and swallowed:
refusing to complete a legitimate business operation because the audit insert
failed would be the worse outcome. This is the one place the trail can have a
gap, and it is loud in the operational logs when it happens.

---

## DEC-020 — No orphaned-file sweep; the upload path compensates instead

**Phase:** 8 **Status:** ACCEPTED

Phase 5 deferred "orphaned-file sweep" to Phase 8, and
`05-infrastructure.md` §7.2 lists orphaned-attachment cleanup among jobs that are
"not implemented yet" and have no requirement behind them.

No sweep job was built. The upload path already deletes the file it wrote when
the database insert fails, so the orphan the sweep would collect is not created
in the first place. §14.5's storage items are otherwise satisfied by the Phase 5
adapter, which this phase verified rather than rewrote.

A sweep remains the right answer if orphans ever appear by another route — a
crash between write and insert, for instance. That is a new requirement, not
something to build speculatively.

---

## DEC-021 — shadcn/ui components are written into the repository

**Phase:** 9 **Status:** ACCEPTED

`05-infrastructure.md` §3.1 and `07-ui.md` §1.2 name shadcn/ui as part of the
stack. shadcn/ui is not an npm package — it is a set of component sources copied
into the project, built on Radix primitives, `class-variance-authority`,
`clsx` and `tailwind-merge`.

The components in `src/components/ui` are written directly against those
primitives rather than pulled in through the shadcn CLI. Same dependencies, same
patterns, same accessibility inheritance from Radix (`07-ui.md` §8) — but each
file carries the reasoning for the decisions this project has already made
(`06-api.md` §1.4 error codes in the error state, `07-ui.md` §4.4 confirm-dialog
rules, the API `meta` block driving pagination), which a generated file would
not.

---

## DEC-022 — TanStack Table is pinned to the 8.x line

**Phase:** 9 **Status:** ACCEPTED

`IMPLEMENTATION_PLAN.md` §15.1 names "TanStack Table" without a version, and the
current `latest` tag resolves to 9.x.

The 8.x line is used. v9 is a rewrite with a different API — `useTable` in place
of `useReactTable`, and row models composed from explicit feature objects rather
than `getCoreRowModel()`. It is newly released, thinly documented, and every
shadcn/ui data-table pattern targets v8.

Nothing in the specification depends on either version; this is a stability
choice, revisited only if v9 offers something the tables in `07-ui.md` §5 need.

---

## DEC-023 — Dates cross the API boundary as `YYYY-MM-DD` strings

**Phase:** 9 **Status:** ACCEPTED

Every date the frontend exchanges is a SQL `DATE` — `contract_date`,
`borrow_date`, `transaction_date` — declared `DATEONLY` on the API side for the
same reason.

`Date` objects exist only inside the calendar widget. `lib/dates.js` is the
boundary, and it parses at local noon so no timezone can shift the calendar day
for a user east or west of UTC. Serializing a `Date` instead would attach a time
and a zone the column cannot store.

---

## DEC-024 — The access token lives in memory only

**Phase:** 10 **Status:** ACCEPTED

`05-infrastructure.md` §6.1 defines the access token as a short-lived bearer
credential and the refresh token as an httpOnly cookie. It does not say where the
frontend keeps the access token.

It is held in the Zustand session store and nowhere else — not `localStorage`,
not `sessionStorage`. Anything readable from JavaScript is readable by an XSS
payload, and the entire point of delivering the refresh token as httpOnly is that
the long-lived credential is out of reach; persisting the short-lived one beside
it would give that up.

**Consequence.** A page reload starts with no token, so `SessionProvider`
exchanges the cookie for a new one before rendering. That round trip is the cost,
and it is what the cookie is for.

---

## DEC-025 — A `401` triggers one transparent refresh and retry

**Phase:** 10 **Status:** ACCEPTED

Access tokens last 15 minutes (`05-infrastructure.md` §6.1), so a user working
for an hour will hit an expired one mid-action. Sending them back to the login
screen at that moment would be a defect, not a security control: the refresh
cookie is still valid and the server is willing to issue a new token.

A `401` therefore refreshes once and retries the original request. If the refresh
also fails — cookie gone, session revoked, account deactivated (REQ-USER-004) —
the session is cleared for real.

The refresh is single-flight: a page firing five queries produces five
simultaneous 401s, and five parallel refreshes would race, with four requests
retrying against a token that had already been replaced. `/auth/login` and
`/auth/refresh` opt out, since refreshing to recover either is nonsense or a
loop.

---

## DEC-026 — The frontend uses a React Router data router

**Phase:** 10 **Status:** ACCEPTED

Routes are defined as objects under `createBrowserRouter`, not as JSX under
`<BrowserRouter>`.

Three things require it: `useMatches` for the breadcrumb trail (§16.3),
`errorElement` for global error handling (§16.3), and `useBlocker` — which Phase
9's `useUnsavedChanges` (§15.6) already calls and which does nothing outside a
data router. Phase 9 mounted `<BrowserRouter>` as a placeholder; this corrects it
before any form depends on the dirty-state prompt.

---

## DEC-027 — Categories are a read-only tab on the lookups page

**Phase:** 11 **Status:** ACCEPTED

§17.5 lists "Categories" among the reference data to implement, but `06-api.md`
§4.2 exposes list and detail only (REQ-CLASS-002), and `07-ui.md` §5.2's lookups
tabs name the five editable resources without mentioning categories.

Categories appear as a sixth tab on `/reference/lookups`, **read-only**: no
create, edit or delete affordance, and a line stating they are maintained
outside the application. This satisfies §17.5's mention without promising a write
the server refuses.

---

## DEC-028 — Where the Reference screens live in the navigation

**Phase:** 11 **Status:** ACCEPTED

`07-ui.md` §2's navigation tree lists six groups and gives no home to the three
Reference routes §5.2 defines. Phase 10 placed them implicitly; this records the
placement:

- **Classifications** → the **Assets** group, since it classifies assets and
  locations and is browsed alongside them
- **Attribute definitions** and **Reference lookups** → the **Organization**
  group, as administrative configuration

No navigation restructuring. Each entry is still hidden without its own `*:read`
permission (`07-ui.md` §6).

---

## DEC-029 — Organization creates are dialogs; no `/new` routes

**Phase:** 11 **Status:** ACCEPTED

`07-ui.md` §4.3 prefers a full page over a modal for anything beyond about four
fields, while §5.1 defines only List and Detail/Edit routes for the organization
resources — there is no `/new` route to host a full page on.

The concrete route specification wins. Creates happen in a dialog on the list
page, including the user form, which is the only one that pushes §4.3's
threshold. The general UI guideline does not justify inventing routes the route
specification does not define.

Do not add `/organization/*/new` routes in a later phase without a specification
change.

---

## DEC-030 — Floor-plan rendering and image handling

**Phase:** 12 **Status:** ACCEPTED

How the editor draws and loads a plan, settled rather than left to a future
refactor:

- **Normalized coordinates are used directly.** The overlay is
  `viewBox="0 0 1 1"`, so a stored `{x, y}` IS its position — no pixel
  conversion, and the drawing survives the image rendering at any size. This is
  what storing normalized points was for (`03-domain.md` §4.34).
- **Pointer input is clamped to 0..1**, so a drag past the edge cannot produce a
  point the server would reject.
- **The image is fetched through the authenticated API** and held as an object
  URL, because the endpoint requires a bearer token that a plain `<img src>`
  would not send. Object URLs are revoked on unmount and on change.
- **A missing plan (404) is an upload state, not an error state.**
- **Area selection offers descendants only**, excluding the location itself
  (REQ-LOC-012), matching what the server enforces.

Plain SVG `<polygon>` elements, no canvas library, per `07-ui.md` §5.4. No
different floor-plan representation is to be introduced.

---

## DEC-031 — One form records a longitudinal history entry

**Phase:** 12 **Status:** ACCEPTED

Condition, location and lifecycle state are recorded together in a single form,
with omitted values carrying forward from the current snapshot.

They are one `longitudinal_history` row (`03-domain.md` §4.12) written by one
endpoint (`06-api.md` §5.2's note), so splitting the UI into three forms would
invent three writes for one record. Not to be split unless a later specification
requires it.

---

## DEC-032 — Inaccessible tabs are hidden, not rendered

**Phase:** 12 **Status:** ACCEPTED

A detail page omits a sub-collection tab entirely when the caller lacks that
sub-resource's own permission — `borrowing:read` for a unit's Borrowings tab,
`floor-plan:read` for a location's Floor plan tab, and so on.

This is `07-ui.md` §6's hide-don't-disable rule applied at tab level. Rendering a
tab that answers 403 on selection would advertise data the user cannot have and
turn a permission boundary into an apparent malfunction.

---

## DEC-033 — Contract create/edit are full-page routes

**Phase:** 13 **Status:** ACCEPTED

**Conflict.** `07-ui.md` §4.3 prefers a full page over a modal for anything
beyond about four fields. §5.5 lists only List and Detail routes for Contracts,
so there is no route to host a full page on — the same shape `DEC-029` resolved
in favour of the route specification for the organization resources.

**Decision.** Two routes are added for Contracts, and only for Contracts:

```text
/procurement/contracts/new
/procurement/contracts/:id/edit
```

**Rationale.** `DEC-029`'s rationale was that the organization forms are short —
"an institution is three fields, a department two". A Contract is eleven,
including a date picker, a money field and four reference selectors
(`06-api.md` §6.2). That is squarely what §4.3 was written for, so the general
guideline wins here where it lost there.

This does NOT reopen `DEC-029`. Suppliers (three fields), Vendors (three) and
Contract Items (five, inline) stay dialogs. No other `/new` route is to be added
without its own decision.

---

## DEC-034 — Vendor screens ship in Phase 13

**Phase:** 13 **Status:** ACCEPTED

§19.2 of this plan assigns the Vendor UI to Phase 13, while `07-ui.md` §5.6
files Vendors under the Operations nav group and `routes.jsx` labelled its
placeholders `phase: 14`. Phase 14 (§20) does not mention Vendors at all.

Vendors are built in Phase 13, at their specified routes `/operations/vendors`
and `/operations/vendors/:id`, and they stay in the Operations nav group. This is
the frontend counterpart of `DEC-008`, which built the Vendor API in Phase 6 for
the same reason: deferring them would leave REQ-VENDOR-001/004 in a phase that
does not claim them. Only the placeholder's phase label moves; navigation
placement does not.

---

## DEC-035 — Contract-item detail and Add-asset are dialogs, not routes

**Phase:** 13 **Status:** ACCEPTED

`02-requirements.md`'s traceability matrix names "Contract Item Detail" as
REQ-PROC-009's screen, but `07-ui.md` §5.5 specifies an inline sub-table on the
Contract detail page and defines no contract-item route.

Both interactions are dialogs opened from the item's row:

- **Item detail** — the item's fields, its derived `totalValue`, and the asset
  units procured through it (`GET /contract-items/:id/asset-units`,
  REQ-PROC-006). The units section is hidden without `asset-unit:read`, per
  `DEC-032`.
- **Add asset** — the short form §5.5 describes, deliberately not the full
  `/assets/new` page.

No `/procurement/contract-items/:id` route is created.

---

## DEC-036 — `unitCount` is prefilled, never validated against `quantity`

**Phase:** 13 **Status:** ACCEPTED

The Add-asset form prefills `unitCount` with `min(quantity ?? 1, 500)` and lets
the user edit it freely within 1–500, the server's own bounds.

The client does NOT check it against `contract_items.quantity`. `DEC-011`
already settled that no requirement ties registered units to ordered quantity,
and partial or staged receiving is ordinary — the form says so in a hint rather
than enforcing a rule the API deliberately does not have.

---

## DEC-037 — Supplier names in the contract list are resolved client-side

**Phase:** 13 **Status:** ACCEPTED

`GET /contracts` returns `supplierId` only; the contract serializer attaches the
`supplier` object on detail alone (`06-api.md` §6.2, contracts service).

The contract list resolves names from a single `GET /suppliers?pageSize=100`
query and a lookup map — the pattern the asset list already uses for location
labels. The backend serializer is NOT changed: a frontend phase does not alter an
API contract, and the alternative (a request per row) is worse than one extra
request per page.

The column falls back to the raw id when a supplier is outside the loaded page,
and the filter is hidden entirely from a caller without `supplier:read`.

---

## DEC-038 — Procurement traceability is links, not reports

**Phase:** 13 **Status:** ACCEPTED

Phase 13 exposes traceability three ways, all navigational:

- **Vendor → assets** — an Assets tab on the vendor detail page backed by
  `GET /vendors/:id/assets`, hidden without `asset:read`.
- **Supplier → contracts** — a Contracts tab backed by
  `GET /contracts?supplierId=`, hidden without `contract:read`.
- **Contract → assets** — a link to `/assets?contractId=<id>` on the contract
  detail page, hidden without `asset:read`.
- **Contract item → units** — inside the item dialog (`DEC-035`).

Phase 12's asset filter bar is NOT reopened: `useListParams` already forwards
unknown URL params to the API, so `?contractId=` filters server-side today. A
visible vendor/contract filter chip on `/assets` (`07-ui.md` §5.3) is recorded as
deferred work, not built here.

The cross-contract procurement-traceability REPORT (REQ-REPORT-008) remains
Phase 15's, per `GAP-002`.

---

## DEC-039 — English labels; money without a currency

**Phase:** 13 **Status:** ACCEPTED

`07-ui.md` §5.5 writes the Add-asset action as "Tambah Aset", while §1.3 assumes
English-only and every screen built so far is English. The button reads
**"Add asset"**.

Money (`contract_value`, `unit_price`, the derived `total_value`) is rendered
with thousand separators and exactly two decimal places, and **no currency
symbol**: `04-data-model.md` defines these as `NUMERIC(15,2)` with no currency
column anywhere, so a symbol would be invented semantics. Values arrive from
`DECIMAL` columns as strings and are formatted, never re-computed —
`totalValue` in particular is the server's derived value (`03-domain.md` §4.17).

---

## DEC-040 — Supplier detail is Details + Contracts

**Phase:** 13 **Status:** ACCEPTED

`07-ui.md` §5.5 specifies only "Detail/Edit" for a supplier. The page is an
editable Details tab plus a Contracts tab listing `GET /contracts?supplierId=`,
which is the only place REQ-SUPPLIER-003 ("suppliers MAY be associated with
procurement contracts") is visible in the UI. The tab is hidden without
`contract:read` (`DEC-032`).

---

## DEC-041 — Asset units are selected asset-first

**Phase:** 14 **Status:** ACCEPTED

§20.2 requires "Unit selection" and §20.5 requires transaction items, but
`06-api.md` §5.2 exposes an asset unit only by id — there is no
`GET /asset-units` (`GAP-008`).

The picker is therefore two steps: search `/assets` with the filters that already
exist (classification, location, condition, status), then list that asset's units
through `GET /assets/:id/units`, whose `lifecycleState`, `condition`,
`locationId` and `departmentId` filters exist for exactly this.

Borrowing selection defaults to `lifecycleState=ACTIVE` and says why: `DEC-013`
means a `REGISTERED`, `IN_STORAGE` or `UNDER_MAINTENANCE` unit CANNOT be
borrowed, and the state machine is not to be widened to make the workflow fit.
The restriction is shown in the picker rather than discovered as a `CONFLICT` at
activation. Transaction selection has no such restriction — a transaction may
record something that happened to a unit in any state.

No endpoint is added. `GET /asset-units` would be a change to `06-api.md` §5.2
and needs approval under §27, not a frontend phase.

---

## DEC-042 — A DRAFT borrowing is edited inline, not on its own route

**Phase:** 14 **Status:** ACCEPTED

`07-ui.md` §5.6 defines List, `new` and Detail routes for borrowings and no
`/edit`. The same six fields the create page shows are editable in place on the
detail page, and only while the record is `DRAFT` — `06-api.md` §7.2 rejects a
`PATCH` in any other status with `CONFLICT`.

Editing in place makes the DRAFT-only rule visible: once the borrowing is
activated the form is simply no longer editable, rather than a route existing
that answers `CONFLICT`. This follows `DEC-029`; `DEC-033`'s exception was earned
by an eleven-field form and is not repeated here.

---

## DEC-043 — The borrowing list ships the documented filters only

**Phase:** 14 **Status:** ACCEPTED

§20.1 lists "Date filters", but `06-api.md` §7.2 defines `status`,
`institutionId`, `overdue` and `q` and nothing else (`GAP-011`). The screen ships
those four. No client-side date filtering is invented — §33 forbids loading a
table into the browser to filter it, and a filter that silently applied to one
page only would be worse than none.

`overdue` is presented as its own control, separate from the status select,
because the two differ: `overdue=true` is derived (`status IN (ACTIVE, OVERDUE)`
with the expected return date past), so it stays correct whether or not the
Phase 8 sweep has stamped the status yet (`DEC-016`).

Transactions do get real date filtering — `dateFrom`/`dateTo` exist there.

---

## DEC-044 — A borrowing's history is derived from the borrowing

**Phase:** 14 **Status:** ACCEPTED

§20.3 asks the detail page to display "History". A Borrowing has no history
sub-resource: no endpoint, no table, and its own dates are the record of what
happened (REQ-BORROW-015 requires exactly that they never change).

The panel is therefore built from the record itself — borrow date, expected
return, actual return, current status — with no additional request.

What it is NOT: the audit trail, which is `06-api.md` §10 and belongs to Phase 15
(`GAP-002`); and not the extension chain, which is not navigable at all
(`GAP-010`). `createdBy`/`updatedBy` are exposed as bare ids by the serializer,
so "who activated this" is likewise a Phase 15 answer.

---

## DEC-045 — Transaction supplier and contract are always offered

**Phase:** 14 **Status:** ACCEPTED

`07-ui.md` §5.6 says the supplier/contract fields "only appear when the
transaction type is procurement-originated", but `ref.transaction_types` carries
`id` and `name` only (`04-data-model.md` §5.1.9) — nothing marks a type as
procurement-originated (`GAP-009`).

Both fields are shown as optional, with a hint stating they apply only to
procurement-originated transactions (REQ-TXN-008/009). No flag is added to the
reference table, and no list of type names is hard-coded in the frontend — the
first invents a schema change, the second invents business data that breaks the
moment a type is renamed.

This is `GAP-001`'s pattern: state the limitation where the user meets it,
invent no storage.

---

## DEC-046 — The borrowing state machine is mirrored for visibility only

**Phase:** 14 **Status:** ACCEPTED

§20.4 requires that invalid actions are not displayed, which means the frontend
must know the transition table from `03-domain.md` §7.2.

One small module mirrors `TRANSITIONS` from `domain/borrowingLifecycle.js` and is
used for ONE thing: deciding which action buttons render. It performs no
validation and blocks no request — the server re-checks every transition and its
`CONFLICT` is surfaced if the two ever disagree, which keeps §32's rule that the
backend remains authoritative intact.

`OVERDUE` is reachable by no button: it is written by the Phase 8 sweep (§14.3),
never by a user. `RETURNED` and `CANCELLED` are terminal and offer no actions at
all.

---

## DEC-047 — Extension navigates to the new DRAFT

**Phase:** 14 **Status:** ACCEPTED

`POST /borrowings/:id/extend` answers `{ returned, borrowing }` (`DEC-015`). The
UI follows the second: the user's intent is to continue the loan, and the new
record is a `DRAFT` that still needs activating, so leaving them on the closed
record would hide the work remaining.

The closed record stays reachable and keeps the dates it actually had
(REQ-BORROW-015). Nothing links the two records (`GAP-010`).

---

## DEC-048 — No chart library; the specified charts are CSS bar charts

**Phase:** 15 **Status:** ACCEPTED — resolves `GAP-003`

`07-ui.md` §1.2 proposed Recharts and §9 left it unconfirmed. Every chart the
specification actually names is a BAR CHART of counts over a small categorical
set: lifecycle state (7 values), condition (5), and classification.

No charting dependency is installed. Those charts are rendered as accessible
CSS/SVG bars — a labelled row per group with a proportional width — which costs
nothing in bundle size (already 955 kB, deferred to §22.10), is testable in
jsdom, and carries its values as text rather than as canvas pixels.

`GAP-003` is closed by this decision. `07-ui.md` §9's open item stays open as a
documentation matter: Recharts was neither adopted nor ruled out for a future
requirement that genuinely needs it. Should trend lines, pies or drill-down
charts ever be specified, the dependency decision is reopened then — not worked
around by hand-rolling more chart types.

---

## DEC-049 — The dashboard is minimal and sourced only from report endpoints

**Phase:** 15 **Status:** ACCEPTED

The dashboard has no specification (`GAP-012`): `07-ui.md` names it once, in the
§2 nav list, with no §5 route row, no requirement ID and no product statement.
§21.1 nonetheless asks for six things from it.

It is built as a metrics row plus the status and condition breakdowns, sourced
ENTIRELY from the §21.0 report endpoints. It introduces no endpoint, no
aggregate and no metric that a report does not already produce.

Scope is not to be expanded beyond that: no trends, no recent-activity feed, no
per-user widgets, no configurable layout. Anything further needs a dashboard
specification first.

---

## DEC-050 — `audit-log:read` is effectively system-wide

**Phase:** 15 **Status:** ACCEPTED

`06-api.md` §1.3 scopes every list endpoint to the caller's institution.
`audit.audit_logs` cannot honour that: it has `actor_id`, `entity_type`,
`entity_id` and JSONB values, and no `institution_id` — nor any join path to one,
since `entity_id` is a `VARCHAR(255)` holding keys from 25 different tables
(composite keys joined with `:`), several of which have no institution at all
(Role, Permission, MeasurementUnit).

`GET /audit-logs` is therefore NOT organization-scoped. A holder of
`audit-log:read` sees the whole trail, which makes it an administrative
permission in practice even though it is not in `SYSTEM_WIDE_RESOURCES`.

**No migration.** Adding `institution_id` to the audit table would change
`04-data-model.md` §5.6.1 and every Phase 8 write path, and would still be
undefined for the entities that have no institution. The limitation is stated
rather than papered over; whether the schema should change is a §22 question.

---

## DEC-051 — Report filters are declared per report

**Phase:** 15 **Status:** ACCEPTED

§21.3 lists date-range, institution, department, classification and location
filters "where specified", but `06-api.md` §9 documents NO query parameters for
any of the eight endpoints — unlike §5.1, §6.2, §7.2 and §7.3, which enumerate
theirs.

Each report accepts only the filters its own source can support, and every one is
an addition to the §9 contract, recorded here for §22.5 to reconcile:

| Endpoint | Parameters |
|---|---|
| `/reports/inventory` | `institutionId`, `classificationId`, `status`, `q`, plus `page`/`pageSize`/`sort`/`order` |
| `/reports/status` | `institutionId` |
| `/reports/by-classification` | `institutionId` |
| `/reports/by-organization` | `institutionId` |
| `/reports/by-location` | `institutionId` |
| `/reports/by-condition` | `institutionId` |
| `/reports/borrowings` | `institutionId`, `status`, `overdue`, `dateFrom`, `dateTo`, plus pagination |
| `/reports/procurement-traceability` | `institutionId`, `contractId`, `supplierId`, `traced`, plus pagination |

`dateFrom`/`dateTo` on the borrowing REPORT is not the same as `GAP-011`, which
concerns `GET /borrowings` itself and stays open.

No filter is invented for a report whose source has no column for it — there is
no department filter on `/reports/by-location`, for instance.

---

## DEC-052 — Export is client-side CSV of what is on screen

**Phase:** 15 **Status:** ACCEPTED

§21.3 lists "Export"; no `REQ-REPORT-*` mentions it, `06-api.md` §9 defines no
export endpoint or content type, and no NFR describes one.

Export is a client-side CSV built from the data already loaded, with no request
and no dependency. Its limitation is stated in the UI: it exports what is
displayed — the current page for a paginated report — not the whole result set.

No export endpoint, no `?format=csv`, no server-side rendering. Whether real
server-side export is required is recorded for §22 rather than assumed.

---

## DEC-053 — Two response envelopes: aggregate and list

**Phase:** 15 **Status:** ACCEPTED

`06-api.md` §1.4 defines `{ data }` for an item and `{ data, meta }` for a list.
An aggregate is neither, and §9 defines no shape at all.

**Grouped reports** — `status`, `by-classification`, `by-organization`,
`by-location`, `by-condition` — answer one envelope:

```text
{ data: { groups: [ { key, label, count, ... } ], totals: { ... } } }
```

**Row reports** — `inventory`, `borrowings`, `procurement-traceability` — are
lists of records, so they keep the standard paginated `{ data, meta }` envelope
(REQ-NFR-PERF-002).

That split is the honest distinction, not an inconsistency: a grouping over five
conditions is bounded and complete, while an inventory is not.

---

## DEC-054 — The audit `entityType` filter is free text

**Phase:** 15 **Status:** ACCEPTED

`entity_type` is a `VARCHAR(100)` whose values come from Phase 8's
`AUDITED_MODELS` allowlist — an implementation detail in `db/auditHooks.js` that
appears in no specification document (`GAP-013` notes this).

The filter accepts free text and matches exactly. No endpoint is added to expose
the allowlist, and the 25 names are NOT hard-coded in the frontend: either would
expand the API surface or guarantee drift the first time the allowlist changes.

---

## DEC-055 — Audit actors are resolved client-side

**Phase:** 15 **Status:** ACCEPTED

`audit_logs.actor_id` carries no FK to `users`, and Phase 8 writes `NULL` for
anything done by a seeder, CLI or background job.

The audit list resolves ids to names from the users list and a lookup map — the
`DEC-037` pattern — with two documented fallbacks: `NULL` renders as **System**,
which is what `04-data-model.md` §5.6.1 defines it to mean, and an id that does
not resolve renders as the raw id rather than as blank or "Unknown". A deleted or
out-of-page user must not silently become nobody.

The serializer is not changed to join `users`.

---

## DEC-056 — Reports keep one dynamic route and a registry

**Phase:** 15 **Status:** ACCEPTED

`07-ui.md` §5.7 lists eight report routes; `routes.jsx` already carries
`/reports` and `/reports/:report`, both guarded by `report:read`.

The dynamic route stays, backed by a registry mapping slug → title, endpoint and
renderer. The eight reports are declarations in one file rather than eight route
entries, the landing page is generated from the same registry, and an unknown
slug renders a not-found state rather than a blank screen.

---

## DEC-057 — The procurement link is writable from both ends, and disagreement is refused

**Phase:** Procurement revision **Status:** ACCEPTED

Making `Asset.contractId` and `AssetUnit.contractItemId` editable outside the
procurement flow (`GAP-014`) creates a disagreement that could not previously
arise: the asset says it was established under contract A while its units say
they arrived on line items of contract B.

Two rules, both server-side:

- A unit's `contractItemId` must belong to the contract its asset names —
  `VALIDATION_ERROR` otherwise. An asset with NO contract constrains nothing:
  there is no claim to contradict, and refusing here would make the unit-level
  link unusable for exactly the untraced assets it exists to help.
- Changing or clearing an asset's `contractId` is refused with `CONFLICT` while
  any unit still references a line item of a different contract.

**Cascading was rejected.** Re-pointing or clearing the units automatically
assumes the asset's new contract is the correct record, which the endpoint cannot
know — the unit may be right and the asset the mistake. Refusing states the
disagreement and leaves the choice with the person who can tell. The way out is
to clear or re-point the units first, which `PATCH /asset-units/:id` now allows.

**The UI does not filter contracts by institution.** `contracts.institution_id`
is nullable and no API rule ties it to the asset's institution, so a client-side
filter would hide valid contracts on a rule the server does not share.

---

## GAP-014 — The procurement link could only ever be set by the procurement flow

**Phase:** 12/13 (raised) **Status:** FIXED — procurement revision

`Asset.contractId` (REQ-ASSET-011) and `AssetUnit.contractItemId`
(REQ-PROC-006) were both writable at the API level from Phase 5, but the only
path that set either was `POST /contract-items/:id/assets` (§19.5). The asset
create/edit form omitted `contractId` (§18.2), the Add-unit dialog sent only a
description (§18.3), and `PATCH /asset-units/:id` rejected `contractItemId`
outright (`06-api.md` §5.2) — so the unit-level link could not be corrected after
creation through ANY path, backend included.

Consequence: an asset registered from the asset module could never name the
contract it was bought under, and a wrong reference on either record was
permanent. Structurally the same defect as `GAP-007` (vendor), one level deeper.

**Fixed:** the asset form offers `contractId`; the Add-unit and unit-edit dialogs
offer `contractItemId` restricted to the asset's own contract;
`PATCH /asset-units/:id` accepts it as a nullable field. Consistency between the
two is enforced server-side per `DEC-057`.

Related: `GAP-007`, `DEC-035`, `DEC-038`.

---

## Gap dispositions — Phase 16 (§22.1)

Every gap raised across Phases 4–15, classified. Four dispositions are used:

| Disposition | Meaning |
|---|---|
| **Fixed** | Corrected in Phase 16; the gap is closed |
| **Accepted Limitation** | Will not be built. The system is correct as it stands; the limitation is stated where a user meets it |
| **Deferred Enhancement** | Worth building, but it is new capability rather than hardening — needs its own phase |
| **Specification Reconciliation Required** | The code is right and a specification document should catch up |

| Gap | Disposition | Verdict |
|---|---|---|
| `GAP-001` SELECTION option list | Deferred Enhancement | Needs a storage decision in `04-data-model.md` first — a column, a table, or a documented serialization. The only requirement anywhere below full implementation (REQ-ATTR-003, `Partial`). |
| `GAP-002` reporting/audit API ownership | **Fixed** (Phase 15) | Closed by approved Option A; the APIs exist and are tested. |
| `GAP-003` chart library | **Fixed** (Phase 15) | Closed by `DEC-048`: no dependency, CSS bar charts. |
| `GAP-004` password change/reset | Deferred Enhancement | No requirement defines it. Needs `02-requirements.md` and `06-api.md` additions — a reset flow touches email or an admin-reset path, which is product design, not hardening. |
| `GAP-005` floor-plan vertex editing | Accepted Limitation | Delete-and-redraw satisfies REQ-LOC-010. Vertex handles, hit-testing and undo are a materially larger interaction than §5.4 describes. |
| `GAP-006` asset list Contract column | **Fixed** (Phase 16) | Contract AND institution now resolve through a reference lookup map. The institution column had the identical defect and was found during this reconciliation. The list test fixture was corrected to match the real serializer, which is why the defect had stayed invisible. |
| `GAP-007` vendor outside procurement | **Fixed** (Phase 16) | The asset create/edit form now offers a vendor, gated on `vendor:read`. `POST /assets` had accepted the field since Phase 5. |
| `GAP-008` no global asset-unit list | Accepted Limitation | The asset-first picker works and is tested. Adding `GET /asset-units` is a `06-api.md` §5.2 change with pagination, filter and scope design of its own. |
| `GAP-009` procurement-originated transaction types | Specification Reconciliation Required | `07-ui.md` §5.6 asks for conditional fields that `ref.transaction_types` cannot drive. Either the UI text or the data model must change; the code is right either way. |
| `GAP-010` extension chain not navigable | Deferred Enhancement | Needs `extended_from_id` on `borrowings` plus a migration and serializer change. REQ-BORROW-014 is met — a chain exists; only its navigability is missing. |
| `GAP-011` no borrowing date filters | Specification Reconciliation Required | §20.1 of this plan asked for filters `06-api.md` §7.2 does not define. The borrowing REPORT has them. Reconcile the two documents. |
| `GAP-012` dashboard has no specification | Specification Reconciliation Required | `07-ui.md` names the dashboard in §2 but gives it no §5 row. The minimal version is built (`DEC-049`); the document should either specify it or drop it. |
| `GAP-013` audited entity-type list undocumented | Specification Reconciliation Required | The 25-model allowlist lives only in `db/auditHooks.js`. It belongs in `02-requirements.md` or `04-data-model.md`. |

Non-gap items from §22.1's carried-forward list:

| Item | Disposition |
|---|---|
| `/assets` vendor and contract filter chips | **Fixed** — both controls added (`07-ui.md` §5.3) |
| `ModulePlaceholder` dead code | **Fixed** — removed |
| `TransactionsPage` label/`htmlFor` defect | **Fixed** — caption is a `<span>`; the association is no longer claimed falsely |
| Bundle size | **Fixed** — route-level code splitting, 976 kB → 595 kB entry (293 → 188 kB gzipped) |
| 21 ESLint `react-refresh` warnings | Accepted Limitation — HMR-only, zero user impact; refactoring 21 files at the final hardening phase is churn against a codebase about to stop changing |
| 100-row reference selector cap | Accepted Limitation — adequate for current data; revisit if a reference list outgrows it |
| Department/location report filters | Accepted Limitation — no report endpoint accepts either; both appear as groupings |
| End-to-end tests | Accepted Limitation — the 637 database/API tests exercise the full HTTP stack against real Postgres and Redis, and the critical journeys were browser-verified in Phases 12–16. A browser E2E framework is a new dependency with its own CI and fixture design. |

---

## GAP-012 — The dashboard has no specification

**Phase:** 15 (raised) **Status:** OPEN — deferred to Phase 16 reconciliation

`07-ui.md` mentions "Dashboard" exactly once, in the §2 navigation list. There is
no §5 route row for it, no requirement ID, and no mention in `01-product.md` §4,
which lists "Asset reporting" and nothing else. `routes.jsx` nonetheless guards
`/` with `report:read`, and §21.1 of this plan asks for summary metrics, asset,
status and condition statistics, borrowing information and "relevant charts".

Phase 15 builds the minimal version `DEC-049` describes, entirely from report
endpoints. What a dashboard should actually contain — and whether it warrants a
specification section of its own — is a §22 question.

---

## GAP-013 — The audited entity-type list is undocumented

**Phase:** 15 (raised) **Status:** OPEN — deferred to Phase 16 reconciliation

`GET /audit-logs?entityType=` filters on a value whose valid set is Phase 8's
`AUDITED_MODELS` constant (25 models, `src/db/auditHooks.js`). That list appears
in no specification document, so neither a UI nor an API consumer has a
documented source for it.

Phase 15 filters as free text (`DEC-054`) rather than expanding the API to
publish an internal constant. Whether the audited entity set belongs in
`02-requirements.md` or `04-data-model.md` is a §22 question.

---

## GAP-008 — No endpoint lists asset units globally

**Phase:** 14 (raised) **Status:** OPEN — deferred to Phase 16 reconciliation

`06-api.md` §5.2 exposes an asset unit only by id. Units can be listed only
through a parent: `GET /assets/:id/units`, `GET /locations/:id/units` or
`GET /contract-items/:id/asset-units`. There is no `GET /asset-units`, so no
screen can offer "find a unit" without first identifying its asset, location or
contract item.

Compounding it, `GET /locations/:id/units` is declared with `listQuerySchema({})`
— no filters at all — so the location-first path cannot even narrow to borrowable
units, while the asset-first path can.

Phase 14 works within this (`DEC-041`). Whether a unit search endpoint should
exist is a `06-api.md` question for §22.

---

## GAP-009 — Nothing marks a transaction type as procurement-originated

**Phase:** 14 (raised) **Status:** OPEN — needs a data-model decision

`07-ui.md` §5.6 makes the transaction form's supplier/contract fields conditional
on the type being procurement-originated. `ref.transaction_types` has `id` and
`name` only, and no requirement defines which types are procurement-originated,
so the condition cannot be evaluated.

Phase 14 shows both fields with a hint (`DEC-045`). Resolving this properly means
either a column on `ref.transaction_types` or a documented list of types —
both specification changes, neither to be invented in a frontend phase.

---

## GAP-010 — An extension chain is not navigable

**Phase:** 14 (raised) **Status:** OPEN — deferred to Phase 16 reconciliation

REQ-BORROW-014 makes a continued loan a chain of borrowings (`DEC-015`), but
`public.borrowings` has no `extended_from_id` and the API exposes no link, so
neither the extended record nor its successor can be found from the other.

A user reading a `RETURNED` borrowing cannot tell it was extended rather than
genuinely returned, and cannot reach the record that continued it.

Phase 14 does NOT add the column. Whether the chain should be navigable is a
`04-data-model.md` and `06-api.md` question for §22.

---

## GAP-011 — `GET /borrowings` has no date filters

**Phase:** 14 (raised) **Status:** OPEN — deferred to Phase 16 reconciliation

§20.1 lists "Date filters" among the borrowing list's requirements.
`06-api.md` §7.2 defines `status`, `institutionId` and `overdue=true` only, so
there is nothing to bind a borrow-date or return-date range control to.

Transactions have `dateFrom`/`dateTo`; borrowings do not. Phase 14 ships without
them (`DEC-043`) rather than filtering one page in the browser.

---

## GAP-006 — The asset list's Contract column never resolves a number

**Phase:** 13 (raised) **Status:** OPEN — deferred to Phase 16 reconciliation

`/assets` has a Contract column reading `contract.contractNumber`, but the asset
LIST serializer attaches the `contract` object on DETAIL only
(`modules/assets/service.js`). The column therefore renders `—` for every row,
including assets that plainly have a contract — as Phase 13's own verification
demonstrated.

This is the same shape as `DEC-037`, which resolved supplier names for the
contract list from a reference query rather than by changing the API. The
equivalent fix here is a `GET /contracts?pageSize=…` lookup map on the assets
list, OR attaching the contract to the list serializer — the second is an API
change and would need its own decision.

**Not fixed in Phase 13.** The screen belongs to Phase 12, which is complete and
was not to be reopened. Deferred to §22 (Phase 16) for final requirement
reconciliation against REQ-ASSET-011, which asks that an asset expose its
procurement number "at minimum".

Related: `DEC-037`, `DEC-038`, `GAP-007`.

---

## GAP-007 — A vendor can only be attached to an asset through procurement

**Phase:** 13 (raised) **Status:** OPEN — deferred to Phase 16 reconciliation

REQ-VENDOR-003 says assets MAY be associated with a vendor, and `POST /assets`
accepts `vendorId`. Phase 12's asset create/edit form does not offer the field,
so the ONLY path that sets it is Phase 13's Add-asset dialog
(`POST /contract-items/:id/assets`).

Consequence: an asset with no procurement record — the documented REQ-ASSET-011
exception, e.g. donated or migrated — can never be attributed to a vendor
through the UI, and REQ-VENDOR-004's vendor→assets view is correspondingly
incomplete for those assets.

**Not fixed in Phase 13.** Adding the field to the asset forms is a Phase 12
change, explicitly out of scope. Deferred to §22 (Phase 16) for reconciliation.

Related: `GAP-006`.

---

## GAP-005 — Floor-plan areas are redrawn, not edited in place

**Phase:** 12 (raised)
**Status:** OPEN — low priority; needs a UI decision, not a data-model one

`06-api.md` §5.3 exposes `PATCH /locations/:id/floor-plan/areas/:areaId` to
update a polygon, and §18.6 of this plan lists "Polygon editing".

`07-ui.md` §5.4 describes clicking an area "to select the Location it represents,
or to edit/delete it" — it does not describe dragging vertices. Vertex-level
editing is a materially larger interaction (grab handles, hit testing, undo)
than anything else in the document, so it was NOT built. Correcting a shape today
means deleting the area and drawing it again, which loses nothing: an area holds
only its polygon and the location it points at.

The endpoint therefore exists and is unused by the UI.

**Reviewed at the Phase 12 gate — stays OPEN, and the current workflow is
ACCEPTED.** Delete-and-redraw is sufficient for Phase 12. The following must NOT
be built until polygon editing is explicitly specified:

- vertex grab handles
- polygon vertex dragging
- polygon hit-testing / edit mode
- polygon undo/redo
- any further geometry-editing infrastructure

`PATCH /locations/:id/floor-plan/areas/:areaId` may remain unused by the
frontend in the meantime.

**Needed if:** users find redrawing rooms burdensome in practice. Worth deciding
from real usage rather than up front.

---

## GAP-004 — No password-change or password-reset capability

**Phase:** 11 (raised)
**Status:** OPEN — revisit before Phase 16

`POST /users` sets an initial password. `PATCH /users/:id` deliberately excludes
it ("changing a password is its own guarded operation"), but that operation
exists in neither `06-api.md` §3.3 nor the implementation, and
`02-requirements.md` asks for no such capability — REQ-NFR-SEC-001 covers only
hashing.

**Consequence.** An administrator cannot reset a forgotten password, and a user
cannot change their own. The only route back into a locked-out account today is
the bootstrap command or direct database access.

**Not resolved here.** No endpoint was invented and no password UI was built —
adding one would be an API addition requiring approval under §31, for a
capability no requirement asks for.

**Required action:** revisit before Phase 16 and decide whether a formal
API/domain change is needed.

---

## GAP-003 — Recharts is unconfirmed, and the Reports UI needs a chart library

**Phase:** 9 (raised)
**Status:** OPEN — a Phase 15 decision, not needed before then

`07-ui.md` §1.2 proposes Recharts for the Reports module and §9 lists it as an
open item: "proposed for §5.7, not yet confirmed as a stack addition". §15.1 of
this plan does not name it.

It was NOT installed in Phase 9. Nothing in Phases 9–14 renders a chart, so
adding a library now would be a speculative dependency (§28).

**Needed by:** Phase 15 §21.1, whose dashboard is specified with "relevant
charts".

**Reviewed at the Phase 9 gate — stays OPEN.** Installing Recharts in Phase 9
was raised and DECLINED: a chart dependency must not be added speculatively
merely because a later phase will need one (§28).

**Required action when Phase 15 begins, BEFORE any dashboard chart is
implemented:** re-read `07-ui.md` §9 and the Phase 15 scope, confirm what the
charting requirement actually is, and make an explicit decision on the
dependency — Recharts, an alternative, or no charts. Implementing a chart without
settling this first is not permitted.

---

## GAP-002 — No phase owns the reporting and audit READ APIs

**Phase:** 8 (raised)
**Status:** RESOLVED — assigned to Phase 15 (§21.0) by approved Option A

`06-api.md` §9 documents eight reporting endpoints and §10 documents
`GET /audit-logs` and `GET /audit-logs/:id`. Phase 8 writes the audit trail but
deliberately exposes no way to read it, and no backend phase in this plan claims
either group:

- §14 (Phase 8) covers audit *logging*, not the audit API
- Phase 15 (§21) is `Frontend Reports & Audit` — UI only, and it consumes APIs
  that nothing is scheduled to build
- Phase 16 (§22.5) verifies endpoint coverage rather than adding endpoints

`report:read` and `audit-log:read` already exist in the generated permission
catalog, so the authorization side is ready and unused.

**Accepted at the Phase 8 gate.** These APIs were NOT built in Phase 8, and must
not be added to it. They must be owned by a phase before the frontend reaches the
point of needing them — Phase 15.

### Plan change — APPROVED and applied

**Affected section:** §5 (phase table), §21 (Phase 15)

**Current design.** Phase 15 is defined as `Frontend Reports & Audit`: §21's
objective is "Implement read-only reporting, dashboard, and audit interfaces",
and every one of its subsections is a screen.

**Problem.** Phase 15 cannot be executed as written. Its screens consume sixteen
endpoints that no phase builds.

**Options considered.**

| Option | Cost |
|---|---|
| **A. Widen Phase 15 to full-stack** — rename to `Reports & Audit`, add §21.0 for the backend APIs, built and tested before the screens | Changes one phase's name and scope. No renumbering. |
| B. Insert a new backend phase before Phase 9 | Renumbers Phases 9–16, invalidating every existing cross-reference in this document. |
| C. Add them to Phase 16 | Contradicts §22's role as verification-only, and leaves Phase 15 unbuildable. |

**Approved: Option A.** It is the smallest change that makes Phase 15
executable, it renumbers nothing, and it puts the API immediately before the UI
that consumes it — which is the ordering `CLAUDE.md` §10 already requires
("frontend is implemented after the backend API is sufficiently stable"). The
phase runs backend-first: §21.0 endpoints and their tests complete before any
screen in §21.1–§21.4 begins.

**Migration/compatibility impact.** None. No schema change, no existing code
touched; both permission codes already exist.

**Applied.** §5 row 15 renamed to `Reports & Audit (backend §21.0, then UI)`;
§21 retitled, its objective widened, and §21.0 added ahead of the screens. No
phase was renumbered.

---

## GAP-001 — SELECTION attributes have nowhere to store allowed values

**Phase:** 4 (raised), 5 (now load-bearing)
**Status:** OPEN — awaiting a specification/data-model decision

`REQ-ATTR-003` includes `SELECTION` among the supported attribute types, and
§10.7 asks that "allowed values" be validated. `ref.attribute_definitions`
(`04-data-model.md` §5.1.5) provides no column, table or other mechanism for
storing an option list, so there is nothing to validate a value against.

**Current behaviour.** A `SELECTION` attribute is accepted and stored, but is
indistinguishable from `TEXT` at validation time.

**Exposed, not hidden (Phase 11).** The attribute-definition form offers
`SELECTION` as a type — the API accepts it, so removing it would misrepresent the
contract — and shows an inline note stating that allowed values cannot be
configured yet and that values are validated as free text. No options editor, no
column, no invented storage format. The UI states the limitation rather than
pretending the feature exists.

**Not resolved here.** No column was added and no table invented — that would be
a data-model change requiring approval under §27. This needs a specification
decision about where option lists live before the attribute-value endpoints in
Phase 5 can validate them.

---

# 40. Current Project Status

## Phase 0 — Project Foundation

Status: COMPLETE

## Phase 1 — Database

Status: COMPLETE

## Phase 2 — Backend Foundation

Status: COMPLETE

## Phase 3 — Authentication & Authorization

Status: COMPLETE

## Phase 4 — Organization & Reference API

Status: COMPLETE

Decisions `DEC-001`, `DEC-002` and `DEC-003` were accepted (§39). `GAP-001`
remains open and must be settled before attribute-value validation in Phase 5.

## Phase 5 — Asset Core API

Status: COMPLETE

`GAP-001` (SELECTION option lists, §39) remains open: a SELECTION attribute's
value is validated as text only.

## Phase 6 — Procurement API

Status: COMPLETE

Decisions `DEC-007` through `DEC-011` were accepted (§39). No migration was
added: Phase 1 already created `vendors`, `suppliers`, `contracts` and
`contract_items`, and the permission catalog already declared every procurement
code.

`GAP-001` is untouched and remains open; no Phase 6 endpoint writes attribute
values.

## Phase 7 — Operations API

Status: COMPLETE

Decisions `DEC-012` through `DEC-016` were accepted (§39). No migration was
added. The two asset-unit sub-lists deferred from Phase 5 —
`GET /asset-units/:id/borrowings` and `GET /asset-units/:id/transactions` — are
now implemented.

The borrowing overdue sweep that writes `status = 'OVERDUE'` remains Phase 8
(§14.3); the `overdue=true` filter does not depend on it.

Approved at the phase gate with no outstanding issues. An `IN_STORAGE →
BORROWED` transition was considered and declined — see the review note on
`DEC-013`. Deferred to Phase 8: the overdue sweep, audit logging, BullMQ/Redis
job infrastructure and storage hardening. Deferred to their own later phases:
the reporting endpoints (§9 of `06-api.md`), the audit API (§10) and the
operations frontend (Phase 14).

## Phase 8 — Supporting Backend Services

Status: COMPLETE

Approved at the phase gate with no outstanding issues. Decisions `DEC-017`
through `DEC-020` were accepted (§39). No migration was added;
`audit.audit_logs` has existed since Phase 1 and nothing wrote to it until now.
One dependency added: `bullmq`, named by `05-infrastructure.md` §7.3.

Explicitly NOT in this phase, and not to be added to it: the reporting APIs
(`06-api.md` §9), the audit READ API (§10), any frontend, the production Docker
build, CI/CD, backup/restore, and the additional background jobs
`05-infrastructure.md` §7.2 merely anticipates.

`GAP-002` was accepted as a legitimate plan gap. The reporting and audit READ
APIs still need a backend owner; a proposed assignment to Phase 15 is recorded in
§39 and is awaiting approval. It has NOT been applied to §5 or §21.

`GAP-001` remains open and untouched.

## Phase 9 — Frontend Foundation

Status: COMPLETE

Approved at the phase gate with no outstanding issues. Decisions `DEC-021`
through `DEC-023` were accepted (§39): shadcn/ui components stay in the
repository rather than being treated as an npm dependency, TanStack Table stays
on the 8.x API, and dates continue to cross the API boundary as `YYYY-MM-DD`
strings. No backend or database file was touched.

Accepted verification: 58 frontend tests, 202 backend unit tests, 598
database/API tests, a successful production build, lint with no errors, and
Prettier clean.

`GAP-003` remains open by decision — no chart dependency was installed, and none
is to be added speculatively.

Explicitly not built, and not to be added here: the login screen, the application
shell and route architecture (Phase 10), and every business screen.

## Phase 10 — Frontend Authentication & Application Shell

Status: COMPLETE

Approved at the phase gate with no outstanding issues. Decisions `DEC-024`
through `DEC-026` were accepted (§39): access tokens stay memory-only, refresh
stays transparent and single-flight, and the React Router data router is the
accepted routing architecture — do NOT revert to `<BrowserRouter>`. No backend or
database file was touched.

The Phase 9 `useBlocker` defect is considered resolved by this phase's router
architecture. No further routing refactoring is to be undertaken.

Accepted verification: 93 frontend tests, 202 backend unit tests, lint clean,
Prettier clean, a successful production build, Phase 8–9 behavior preserved, and
the live anonymous authentication flow checked in a browser. Manufacturing a
database user purely to inspect the authenticated shell was explicitly deemed
unnecessary; `npm run bootstrap` remains available for manual inspection.

Every route in `07-ui.md` §5 exists and is permission-guarded, but each business
route renders a placeholder naming the phase that builds it — §16.4 asks for the
architecture, not the contents.

Explicitly not built, and not to be added here: organization/reference, asset,
procurement, operations, reports and audit screens, and the reporting/audit APIs.

Bundle size (584 kB, 184 kB gzipped) is accepted as-is and deferred to §22.10 —
see the note there. `GAP-001` and `GAP-003` remain open and untouched.

## Phase 11 — Frontend Organization & Reference

Status: COMPLETE

Approved at the phase gate with no outstanding issues. Decisions `DEC-027`,
`DEC-028` and `DEC-029` were accepted (§39), alongside the review rulings on
`DEC-001` (department hierarchy N/A), `GAP-001` (SELECTION offered, its
limitation stated, no option storage) and `GAP-004` (password management
deferred). No backend, database, migration or dependency change was made — no
new frontend package was added either.

Eleven screens across eight routes, plus the four §17.6 reusable components.
Every later-phase route is still a placeholder, asserted by the route-coverage
suite.

Accepted verification: 155 frontend tests, 202 backend unit tests, 598
database/API tests, all Phase 11 routes verified, Phase 12–15 routes still
placeholders, permission gating, validation-error mapping, the classification
picker, the permission checklist and `BR-015`, Categories read-only, the
SELECTION limitation, Departments flat, lint clean, Prettier clean, a successful
production build, and migrations untouched.

Bundle size (668 kB, 208 kB gzipped) is accepted as-is; optimization stays
deferred to §22.10. No code splitting or performance refactoring is to be done
before then.

Explicitly not built, and not to be added here: assets, locations, floor plans,
procurement, operations, reports, audit UI, and the reporting/audit READ APIs.

`GAP-001`, `GAP-003` and `GAP-004` remain open and untouched.

## Phase 12 — Frontend Asset Core

Status: COMPLETE

Approved at the phase gate with no outstanding issues. Decisions `DEC-030`
(floor-plan rendering and image handling), `DEC-031` (one longitudinal history
form) and `DEC-032` (inaccessible tabs hidden, not rendered) were accepted (§39).

Seven screens across nine routes, the floor-plan editor, the dynamic attribute
form and the attachments panel. No backend, database, migration or dependency
change — no new frontend package was added either.

`GAP-005` was reviewed and stays open: floor-plan areas are redrawn rather than
edited vertex by vertex, and the geometry-editing infrastructure listed under
that gap must NOT be built until polygon editing is explicitly specified.
`PATCH .../areas/:areaId` may remain unused by the frontend.

`GAP-001` is now visible in two places — the attribute-definition form
(Phase 11) and the attribute-value form here — and states its limitation in
both rather than implying SELECTION options are supported.

Accepted verification: 208 frontend tests, 202 backend unit tests, 598
database/API tests, a successful production build, lint clean, Prettier clean,
Phase 12 routes verified, classification-picker integration, lazy detail-tab
fetching, lifecycle transition errors, normalized polygon rendering,
location/area selection, attachment validation, and descendant-cycle protection.

Bundle size (767 kB, 232 kB gzipped) is accepted as-is; optimization stays
deferred to §22.10.

Explicitly not built, and not to be added here: procurement, operations,
reporting, audit UI, the reporting/audit READ APIs, production hardening, CI/CD,
and bundle optimization.

`GAP-001`, `GAP-003`, `GAP-004` and `GAP-005` remain open.

## Phase 13 — Frontend Procurement

Status: COMPLETE

Approved at the phase gate. Decisions `DEC-033` (full-page contract routes),
`DEC-034` (vendors ship in Phase 13), `DEC-035` (contract-item detail and
Add-asset are dialogs), `DEC-036` (`unitCount` prefill, never validated against
quantity), `DEC-037` (client-side supplier names), `DEC-038` (traceability by
links, not reports), `DEC-039` (English labels, money without a currency) and
`DEC-040` (supplier Details + Contracts) were accepted (§39).

Seven screens across eight routes, three dialogs, and the procurement-to-asset
flow. No backend, database, migration, seeder or dependency change — the API this
phase consumes is exactly what Phase 6 shipped.

Accepted verification: 262 frontend tests, 202 backend unit tests, 598
database/API tests, a successful production build, 0 lint errors, Prettier clean,
36 migrations up, and a browser run of the whole chain — supplier → contract →
line item → Add asset → asset → back to the contract — including partial
registration (3 units against 10 ordered), the deletion `CONFLICT` that protects
REQ-PROC-006, and all four traceability views.

Five items were reported at the gate and accepted as NON-BLOCKING:

1. The asset list's Contract column never resolves a number — recorded as
   `GAP-006`, deferred to §22.1. Phase 12 is NOT reopened.
2. A vendor can only be attached to an asset through the procurement flow —
   recorded as `GAP-007`, deferred to §22.1. No vendor field is to be added to
   the asset forms now.
3. 17 ESLint `react-refresh/only-export-components` warnings (0 errors) — left
   to Phase 16 cleanup (§22.1). The existing pattern is not to be refactored now.
4. Bundle size, now 926 kB (282 kB gzipped) — optimization stays deferred to
   §22.10.
5. A local development user `devadmin` was bootstrapped for browser
   verification. Local dev database only; no code, migration or seeder change
   accompanies it, and none is required.

Explicitly not built, and not to be added here: borrowings, transactions and
lifecycle screens, reporting, audit UI, the reporting/audit READ APIs, and any
backend change.

`GAP-001`, `GAP-003`, `GAP-004`, `GAP-005`, `GAP-006` and `GAP-007` remain open.

## Phase 14 — Frontend Operations

Status: COMPLETE

Approved at the phase gate. Decisions `DEC-041` (asset-first unit picker),
`DEC-042` (inline DRAFT editing), `DEC-043` (documented filters only),
`DEC-044` (history derived from the record), `DEC-045` (supplier and contract
always offered), `DEC-046` (state machine mirrored for action visibility only)
and `DEC-047` (extension navigates to the new draft) were accepted (§39).

Six screens across six routes, a shared asset-first unit picker, and the four
borrowing state transitions. No backend, database, migration, seeder or
dependency change — the API is exactly what Phase 7 shipped.

Accepted verification: 308 frontend tests, 202 backend unit tests, 598
database/API tests, a successful production build, 0 lint errors, Prettier clean,
36 migrations up, and a browser run of the whole lifecycle — a unit brought
`REGISTERED → ACTIVE`, added to a draft, activated (moving it to `BORROWED`),
extended into a new draft, with the closed record keeping its true dates and
offering no actions. The picker was confirmed to disable non-`ACTIVE` units with
the `03-domain.md` §7.1 reason for a borrowing, and to allow any state for a
transaction.

Four gaps were raised and accepted as documented and deferred to §22.1:
`GAP-008` (no global asset-unit list), `GAP-009` (no procurement-originated
flag on transaction types), `GAP-010` (extension chain not navigable) and
`GAP-011` (no borrowing date filters). None was solved implicitly, and no
endpoint, migration, schema change or lifecycle transition was added to work
around them.

Also accepted as deferred Phase 16 work: 21 ESLint
`react-refresh/only-export-components` warnings (0 errors), a 955 kB bundle
(288 kB gzipped) under §22.10, and the 100-row reference-selector cap, which is
non-blocking and reconciled only if a reference list outgrows it.

Explicitly not built, and not to be added here: reporting, the dashboard, the
audit UI, the §21.0 reporting/audit READ APIs, and any backend change.

`GAP-001`, `GAP-003`, `GAP-004`, `GAP-005`, `GAP-006`, `GAP-007`, `GAP-008`,
`GAP-009`, `GAP-010` and `GAP-011` remain open. `GAP-002` stays assigned to
Phase 15.

## Phase 15 — Reports & Audit

Status: COMPLETE

Owned `06-api.md` §9 and §10 as well as their screens, by approved Option A under
`GAP-002` (§39), and ran backend-first: §21.0 was built, tested and approved at
its own checkpoint before any screen began.

Decisions `DEC-048` (no chart library; CSS bar charts, closing `GAP-003`),
`DEC-049` (minimal report-sourced dashboard), `DEC-050` (`audit-log:read` is
effectively system-wide), `DEC-051` (per-report filters), `DEC-052` (client-side
CSV export), `DEC-053` (aggregate and list envelopes), `DEC-054` (free-text
`entityType`), `DEC-055` (client-side actor resolution) and `DEC-056` (one
dynamic report route plus a registry) were accepted (§39).

Ten endpoints, four screen areas, and the last placeholder removed: every route
in the application now resolves to a real screen, which `routes.test.jsx`
asserts.

Accepted verification: 349 frontend tests, 202 backend unit tests, 637
database/API tests, a successful production build, 0 lint errors, Prettier clean,
36 migrations unchanged, and a browser run over data earlier phases produced —
including an audit entry showing the Phase 14 extension as
`status ACTIVE → RETURNED`.

Four items were reported at the gate and accepted as non-blocking, all deferred
to §22:

1. §21.3's department and location filters are `N/A` — no report endpoint accepts
   either parameter, and both appear as GROUPINGS instead.
2. `ModulePlaceholder` in `pages/placeholders.jsx` is now dead code.
3. Phase 14's `TransactionsPage` has a `<Label htmlFor>` pointing at a
   `DatePicker`, which takes no `id`. The same bug was found and fixed in the
   Phase 15 screens; Phase 14 was not reopened.
4. Bundle size, now 976 kB (293 kB gzipped).

`GAP-003` is CLOSED by `DEC-048`. `GAP-001`, `GAP-004`–`GAP-013` remain open,
all recorded in §22.1.

## Phase 16 — Integration & Hardening

Status: COMPLETE

Approved at the phase gate. The final phase: verification, reconciliation and
hardening, with no new business capability, no schema change and no migration.

### Requirement traceability

170 requirements reviewed — the count was 160 until this phase found that the
classification requirements use `###` headings and had been missed. A Status
column was added to the matrix in `02-requirements.md` §28.

| Status | Count |
|---|---|
| Implemented | **169** |
| Partial | **1** |
| Deferred | **0** |
| Blocked | **0** |
| Not applicable | **0** |

**REQ-ATTR-003 is the sole partial requirement**: `SELECTION` is offered as an
attribute type, but the data model has nowhere to store its option list, so such
an attribute behaves as free text and says so in the UI (`GAP-001`).

129 of the 170 are annotated by ID in source or tests; the remaining 41 are
marked `°` in the matrix — field-level or system-level statements satisfied under
a neighbouring requirement rather than by name.

### Gap dispositions — as implemented

The full table is in §39 ("Gap dispositions — Phase 16"). Summary, exactly as
reported and approved:

| Gap | Disposition |
|---|---|
| `GAP-001` SELECTION option list | Deferred Enhancement |
| `GAP-002` reporting/audit API ownership | Fixed (Phase 15) |
| `GAP-003` chart library | Fixed (Phase 15) |
| `GAP-004` password change/reset | Deferred Enhancement |
| `GAP-005` floor-plan vertex editing | Accepted Limitation |
| `GAP-006` asset list Contract column | **Fixed (Phase 16)** |
| `GAP-007` vendor outside procurement | **Fixed (Phase 16)** |
| `GAP-008` no global asset-unit list | Accepted Limitation |
| `GAP-009` procurement-originated transaction types | Specification Reconciliation Required |
| `GAP-010` extension chain not navigable | Deferred Enhancement |
| `GAP-011` no borrowing date filters | Specification Reconciliation Required |
| `GAP-012` dashboard has no specification | Specification Reconciliation Required |
| `GAP-013` audited entity-type list undocumented | Specification Reconciliation Required |

No gap is left unexplained.

### Fixes made in this phase

- **`GAP-006`** — the asset list's Contract AND Institution columns rendered a
  dash for every row: `GET /assets` returns foreign keys only. Both now resolve
  through a reference lookup map (`DEC-037`'s pattern), falling back to the raw
  id rather than a blank. The institution column had the identical defect and was
  found during this reconciliation. The list test fixture had embedded
  `institution` and `contract` objects the endpoint never returns, which is why
  the defect passed its tests; the fixture was corrected to match the serializer.
- **`GAP-007`** — the asset create/edit form now offers a vendor, gated on
  `vendor:read`, so a donated, self-constructed or migrated asset can be
  attributed to its manufacturer (REQ-VENDOR-003).
- **`/assets` vendor and contract filters** — `07-ui.md` §5.3 listed both and the
  API had accepted them since Phase 5; only the controls were missing.
- **`ModulePlaceholder`** — removed; no route referenced it after Phase 15.
- **`TransactionsPage` accessibility** — a `<Label htmlFor>` pointed at a
  `DatePicker`, which takes no `id`, claiming an association that was never
  delivered. The caption is now a `<span>`, matching the Phase 15 screens.
- **Code splitting (§22.10)** — route-level `React.lazy` + `Suspense`,
  deliberately not React Router's `lazy` route property, which would strip
  `element` from the route definitions and blind the guard-coverage test.

Verified in a browser after the fixes: the Contract column shows
`SPK/2026/001` on both assets, a vendor set through the asset form appears in
that vendor's Assets tab, and the contract filter chip filters correctly.

### Production infrastructure — locally verified

Authored from `05-infrastructure.md`: `apps/api/Dockerfile`,
`apps/web/Dockerfile`, `docker-compose.prod.yml`,
`deploy/nginx/{app,site,security-headers}.conf`, `deploy/{backup,restore}.sh`
and `.gitlab-ci.yml`.

Building and running it found five real defects, all fixed:

1. A workspace `node_modules` path that does not exist under npm hoisting — the
   API image failed to build.
2. `MAX_UPLOAD_SIZE_MB` missing from the compose environment — the API
   crash-looped; the fail-fast config caught it exactly as designed.
3. The classification CSV was absent from the API image, so `db:seed` failed and
   the first deploy could never load the 14,738 classifications.
4. Nginx resolved the API upstream at startup and refused to boot while the API
   was down — an API outage would have taken the static frontend with it.
5. `add_header` inside a `location` cancels inheritance, silently dropping the
   security headers from `index.html` and every JS chunk.

**Verified locally:** both images build and run; all four containers healthy;
migrations as a separate deploy step; seeders; bootstrap; login and a report
endpoint through Nginx; SPA fallback; cache and security headers; 502 rather
than 500 when the API is down; Postgres and Redis not published to the host
(§12.2); the API running as `node`, not root; the storage bind mount writable.

**UNVERIFIED, and not claimed as done:**

- **HTTPS / certbot** — `deploy/nginx/site.conf` is authored from §12.1 and
  reviewed. No domain or certificate exists in this environment.
- **Actual VPS deployment** — no target exists. The deploy STEPS (pull →
  migrate → up) were executed against the local production stack; the SSH
  deployment itself was not.
- The backup and restore scripts are written to §4 but were not executed: both
  need a host cron and a running stack.

### Accepted verification

| Check | Result |
|---|---|
| Tests | **1,195 passing** — 356 frontend, 202 backend unit, 637 database/API |
| Build | successful, **~595 kB entry / ~188 kB gzipped** (from 976 kB / 293 kB) |
| Migrations | **36 up**, verified through migrate → rollback → re-migrate |
| Lint | **0 errors, 21 warnings** |
| Prettier | **clean** |

### Remaining accepted limitations

- `GAP-005` floor-plan areas are redrawn, not edited vertex by vertex.
- `GAP-008` no global asset-unit list; pickers find a unit through its asset.
- 21 ESLint `react-refresh/only-export-components` warnings — HMR-only, no user
  impact; refactoring 21 files at the final hardening phase is churn against a
  codebase about to stop changing.
- Reference selectors load at most 100 rows.
- Department and location report filters — no report endpoint accepts either;
  both appear as groupings instead.
- End-to-end tests — no browser E2E framework, and none was ever specified
  (`05-infrastructure.md` §11.1 names Vitest and Supertest). The 637
  database/API tests exercise the real stack, and the critical journeys were
  browser-verified by hand in Phases 12–16.

### Remaining specification-reconciliation items

Each is a document that should catch up to correct code, not a defect:

- `GAP-009` — `07-ui.md` §5.6 asks for conditional supplier/contract fields that
  `ref.transaction_types` cannot drive.
- `GAP-011` — §20.1 of this plan asked for borrowing date filters that
  `06-api.md` §7.2 does not define.
- `GAP-012` — `07-ui.md` names the dashboard in §2 but gives it no §5 row.
- `GAP-013` — the 25-model audited entity allowlist lives only in
  `db/auditHooks.js`.
- `DEC-051` — eight report endpoints accept query parameters `06-api.md` §9 does
  not document.
- `DEC-050` — `audit-log:read` cannot be organization-scoped.
- `DEC-052` — export is client-side CSV of the loaded page only.

### Deferred enhancements

New capability, each needing its own phase and specification work first:
`GAP-001` (SELECTION option storage), `GAP-004` (password change/reset) and
`GAP-010` (`extended_from_id` for the borrowing extension chain).

---

# 41. Project Status

All sixteen phases are COMPLETE and approved. This plan is finished; no further
implementation phase is defined or implied.

Future work belongs to the deferred enhancements and specification-reconciliation
items recorded above, each of which requires a specification change and its own
approved phase before any code is written.

---

# 42. Post-Completion Maintenance

Defect fixes made after Phase 16, against the specification as it already stood.
Nothing here changes the data model, the API contract or the permission catalog;
anything that would have needed to has its own approved phase instead.

## 42.1 Attachment download returned JSON (`FIX-001`)

**Reported:** downloaded attachments could not be opened.

`GET /attachments/:id` serves two responses from one path (`06-api.md` §5.4):
its metadata envelope by default, the file's bytes with `?download=true`. The web
client omitted the parameter, so `api.download` — told by `responseType: 'blob'`
to expect binary — wrapped the JSON envelope in a `Blob` and saved a few hundred
bytes of JSON under the attachment's real file name. Every download since Phase
12 produced an unopenable file, and nothing reported an error at any point.

Floor plans were unaffected: their bytes live at their own endpoint
(`/locations/:id/floor-plan/image`), which has no flag to forget.

The API was correct throughout and is unchanged. Its own test already asserted
both shapes; what no test covered was the URL the client actually requested,
which is why this survived a full phase of integration testing. The regression
test now asserts at the HTTP client, not at the API module — mocking
`attachmentsApi.download` would mock away the line that was wrong.

Two further defects on the same path, found while fixing it and fixed with it:

- The download anchor was never inserted into the document. A detached anchor's
  `click()` is ignored by Firefox, so the download silently did nothing there.
  It now follows `lib/csv.js`: append, click, remove, revoke.
- `06-api.md` §5.4 described the endpoint only as "metadata + signed/streamed
  download", which left a caller free to assume one request returned both. The
  row now states the flag and what each response actually is. **This is the
  documentation defect that made the code defect easy to write.**

## 42.2 Attachments could not be viewed in the application (`FIX-002`)

The Attachments tab offered download and delete and nothing else, so checking
which photograph had been uploaded meant saving a file and opening it from the
file manager. `07-ui.md` never said otherwise; it simply had not been built.

Images (JPG/PNG) and PDFs now open in a dialog on the page. DOCX and XLSX do not
and offer no preview control — the browser cannot render them, and an empty frame
is worse than no button.

Two constraints shaped it, both already established elsewhere in the system:

- A plain `<img src>` cannot work. The endpoint requires the bearer token like
  every other route (`06-api.md` §1.2) and the API sets
  `Cross-Origin-Resource-Policy: same-site`. The bytes are therefore fetched
  through the API client and shown as an object URL — the mechanism the floor
  plan has used since Phase 12 (`useFloorPlan.js`), for the same reasons.
- The server's `Content-Disposition: attachment` is unchanged. It exists so an
  uploaded file can never render in the API's own origin, and it still governs
  anyone reaching the endpoint directly. A blob URL built in the web app is
  same-origin to the web app and carries no such header, so previewing costs
  nothing in that protection. The renderable types are additionally pinned to an
  allowlist in `AttachmentPreview.jsx` rather than taken from the response's own
  `Content-Type`, so the decision about what the browser will render reads from a
  constant rather than from a header.

Nothing is fetched until a preview is opened: an asset may hold a dozen 10 MB
photographs, and resolving all of them to render the list would download every
one.

**Files:** `apps/web/src/api/assetCore.js`,
`apps/web/src/components/asset/AttachmentPreview.jsx` (new),
`apps/web/src/components/asset/AttachmentsPanel.jsx`,
`apps/web/src/components/asset/attachments.test.jsx` (new), `docs/06-api.md`
§5.4, `docs/07-ui.md` §5.3, and the `assets/attachments` and
`how-do-i/view-an-asset` manual articles in both languages.

**Verified** against the running dev stack: the request carries
`?download=true` and answers `200`; the response body is 143,802 bytes, matching
`attachments.file_size` for that row exactly; the resulting object URL decodes in
an `<img>` at its true 512×512; a 1.5 MB PDF mounts in its frame.

## 42.3 Known failing test, unrelated

`apps/manual` — "renders a screenshot slot pointing at the authored path" expects
`create-asset.png` while `how-do-i/create-an-asset.md` references
`create-asset.gif`. Pre-existing, untouched here, and a content decision rather
than a code defect: either the article should point at a PNG or the test should
accept the GIF, and that is not this fix's call to make.

---

# 43. Phase 17 — Extensible Classification (`CR-001`)

Status: COMPLETE — WAITING FOR APPROVAL

The first phase past the original sixteen. It comes from a client change request
recorded in `docs/revise/CR-001-qr-and-classification-impact.md`, and it is the
first phase to amend the specification rather than only implement it.

## 43.1 The specification amendment

`CLAUDE.md` §14 requires a conflict to be reported and approved before code.
REQ-CLASS-003 made `ref.asset_classifications` wholly read-only; the request
needs institutions to register leaf classifications the government catalogue does
not cover. Approved, then amended.

The decisive finding came from the source data itself: `origin` (legacy
`asal_rincian`) already carried two values — 14,679 rows at `1` and **59 at `2`**,
every one of them a leaf under a second-to-last-level parent, all school-specific
room types (*Ruang Teori/Kelas*, *Laboratorium IPA*, *Bengkel*). The legacy system
had already done exactly what the client asked for; nobody had documented what
the column meant. That is why the extension went into the existing table rather
than a parallel one, and why REQ-CLASS-008 ("no second hierarchy") survives
untouched.

| Document | Change |
|---|---|
| `02-requirements.md` | REQ-CLASS-003 amended; REQ-CLASS-011–017 added; `BR-016`–`BR-019` added; matrix extended; total 170 → **177** |
| `03-domain.md` | AssetClassification becomes partially writable; `DR-002` rewritten; four attributes added |
| `04-data-model.md` | §5.1.3 extended; migration order gains step 35; index, constraint and legacy-mapping tables updated; ERD gains `institutions ||--o{ asset_classifications` |
| `06-api.md` | §4.1 gains POST/PATCH/DELETE/promote, the `institutionId` + `owner` scoping params, and the node shape |
| `07-ui.md` | §4.5 picker scoping and marking; §5.2 management controls |

## 43.2 Design decisions

**`DEC-051` — extend the table, do not add one.** A parallel table would have made
`assets.classification_id` polymorphic and rewritten the picker, the leaf search,
`/reports/by-classification` and `BR-010` attribute scoping — 29 API files and 37
web files reference classification. Extending in place touched the query layer
almost nowhere.

**`DEC-052` — allocate identifiers downward from 999.** The scheme is
Permendagri-style: 12 digits in `1/1/1/2/2/2/3` groups, the last three being the
leaf ordinal. Government data allocates upward and reaches **412** at most, so
descending allocation keeps the two apart with no reserved range to police.
Allocation holds a transaction-scoped advisory lock on the parent, so concurrent
creates cannot mint the same id.

**`DEC-053` — attach only at the second-to-last level.** The client's own rule,
and it turned out to be load-bearing: all 980 such nodes already have children,
so the restriction makes it *structurally impossible* to turn an in-use leaf into
a branch — which would otherwise have put every Asset and Location classified
against it in breach of `BR-011`. The rule is enforced structurally
(`isSecondToLastLevel`) rather than by asking whether a node's children happen to
be leaves, since a merely shallow subtree is a different question.

**`DEC-054` — visibility is not `BR-007`.** Every other scoped table matches its
institution column alone. A classification with no institution is visible to
everyone, so the filter is `institution_id IS NULL OR institution_id = <caller>`.
Classification queries therefore do NOT use the shared `scopeFilter`, and `BR-019`
records why. `owner=all` is the one value that lifts it, for the management
screen only; it never widens what may be *assigned*.

**`DEC-055` — no `is_active` on classifications.** Hard delete when unreferenced
instead. An active flag would have to be honoured by the picker, the leaf search
and every report, to solve a problem ("a duplicate was created") that deleting an
unused row solves outright.

**`DEC-056` — timestamps stay nullable and undefaulted.** `created_at` means
"when the application created this row", and 14,738 rows were not created by the
application. A `now()` default would stamp every seeded government row with a
creation time it never had, so `02-schema.test.js` carries a documented exception
and two tests asserting the exception holds.

**`DEC-057` — `isAppDefined` and `acceptsChildren` are computed server-side.** The
UI shows or hides its controls from these rather than re-deriving the code scheme
and the provenance rule, so client and server cannot disagree about where an
addition belongs.

## 43.3 Tests

| Suite | Before | After |
|---|---|---|
| API unit | 202 | **224** (+22, `tests/classification-rules.test.js`) |
| API database | 680 | **739** (+55 new, 4 rewritten) |
| Web | 467 | **476** (+9, 2 rewritten) |

Rewritten rather than deleted: four tests asserted the old read-only requirement
(`offers no post/patch/delete`, `excludes classification:create`, and the web
`offers no way to create, edit or delete`). Each now asserts the rule that
actually protects the hierarchy — that a *government* node refuses the write —
which is the stronger check.

## 43.4 Verified against the running dev stack

Migration applied to `asset_management`; permission seeder re-run (108 codes,
`classification:create/update/delete/promote` present). Live API confirms
`132080141000` → `acceptsChildren: true`, `isLeaf: false`, 412 children;
`132080141001` → `acceptsChildren: false`, `isLeaf: true`. The classification
screen renders the amended description, resolves `origin` to "Government
reference data" instead of a bare integer, and shows no management controls on a
government node for a caller without the permissions.

## 43.5 Known issues

**Pre-existing, unrelated — job queue test.** `15-supporting-services` › "starts a
worker that processes an enqueued job" fails whenever a development server is
attached to the same Redis: its sweep consumes the fixture first. The test's own
comment names this scenario, and `bull:asset-management:stalled-check` in Redis
confirms a live worker. Environmental, not a code defect, and untouched here.

**Pre-existing, found during verification — root-level leaves are unselectable.**
`GET /classifications` (root) serializes without `isLeaf`, so the picker treats a
root as a branch and drills into it. For the three orphan rows preserved as roots
in Phase 1 (`202010500200` *Helicak/Bajaj*, `202010500300` *Trike*,
`202010500400` *Dst..*) that is a dead end: they have no children, so the picker
shows "Nothing at this level" and they can never be assigned to an Asset or
Location. Phase 12 behaviour, not introduced here; the management screen can now
reach them via branch-select, but the Asset and Location forms still cannot.
Reported rather than fixed, since it belongs to the assignment picker rather than
to this phase.

---

# 44. Phase 18 — Unit QR Labels (`CR-001`)

Status: COMPLETE — WAITING FOR APPROVAL

The second half of `CR-001`. Phase 17 gave institutions their own classifications;
this gives every asset unit a printable identity and a label that resolves back
to its record.

## 44.1 The specification amendment

Additive rather than contradictory, so lighter than Phase 17's. REQ-UNIT-003 said
only that a unit must have "a unique identifier" — satisfied by its UUID, which
cannot be read off a scuffed label or quoted over a telephone. Amended to require
a human-readable inventory code as well, then five new requirements.

| Document | Change |
|---|---|
| `02-requirements.md` | REQ-UNIT-003 amended; REQ-UNIT-007–011 added; REQ-ORG-002 gains the URL-safe rule; `BR-020`, `BR-021` added; matrix extended; total 177 → **182** |
| `04-data-model.md` | §5.3.2 gains `inventory_code` and its partial unique index; migration order gains steps 36–37; index table updated |
| `06-api.md` | §5.2 gains `/asset-units/:id/label`, `/asset-units/by-code/:code`, `/assets/:id/units/labels`, and the code's contract |
| `07-ui.md` | §5.3 gains the label routes, the scan landing, and the print pattern |

## 44.2 Design decisions

**`DEC-058` — the code is stored, never derived (`BR-020`).** Recomputing it on
read would bind every printed label to the institution's *current* code, so
renaming an institution would silently invalidate labels already stuck to
physical items. Stored, a rename affects only units registered afterwards. Three
integration tests pin this: a unit's code survives an edit, an institution
transfer, and a rename of the institution itself.

**`DEC-059` — the QR encodes an address, not the unit's data.** A phone camera
opens a URL and does nothing useful with a JSON payload, so embedded data would
need a special-purpose scanner to be worth anything. Data baked into a label is
also frozen at print time while the record keeps moving. And it keeps the symbol
physically small: a URL is a few dozen characters and stays scannable at 20 mm.

**`DEC-060` — a label carries identity, never state (`BR-021`).** Location,
condition, lifecycle state and holder are absent from both the label endpoint and
the printed sheet. A sticker is printed once and cannot be recalled; a label
asserting a laptop is in Room 204 becomes a lie the first time someone carries it
out. `GET /asset-units/:id/label` is therefore a separate endpoint from the unit
detail, so no screen can accidentally print something volatile.

**`DEC-061` — the classification prints as code AND name.** Phase 17 made
classifications renameable (REQ-CLASS-016) but their codes immutable. A label
carrying both stays resolvable after a rename even though its printed name has
aged.

**`DEC-062` — no code when the asset has no institution.** `asset_units` reaches
an institution only through `assets.institution_id`, which is nullable. Rather
than mint a placeholder that would be frozen onto a label the moment one was
printed, the column stays NULL, the unit detail shows "Not assigned", the print
button is absent, and the label endpoint answers `400` naming the missing
institution. The unique index is partial for the same reason: the absence of a
code is not a value to collide with.

**`DEC-063` — labels are routes, not dialogs.** `window.print()` from inside a
dialog prints the page behind it, and the browser's print preview cannot isolate
a modal. A route can hide the application shell in `@media print` and put nothing
but labels on the paper.

**`DEC-064` — `institutions.code` is constrained to URL-safe characters.** It is
the leading segment of every inventory code, and that code travels in the path of
the address a label resolves to. Applied now, while one institution exists and
already complies; the same constraint later, against real data, would be a
breaking change. The migration fails loudly with the offending values rather than
letting PostgreSQL report only that some row violates it.

## 44.3 Tests

| Suite | Before | After |
|---|---|---|
| API unit | 224 | **246** (+22, `tests/inventory-code.test.js`) |
| API database | 739 | **772** (+32 new, 1 fixture correction) |
| Web | 476 | **489** (+13, `pages/assets/labels.test.jsx`) |

Concurrency is tested for real: eight simultaneous registrations against one
asset must yield eight distinct codes.

## 44.4 Verified against the running dev stack

Both migrations applied to `asset_management`. The backfill numbered all ten
existing units `ALM-1-2026-00001` … `-00010`, ordered by registration.

Live API: `GET /asset-units/by-code/ALM-1-2026-00001` resolves; its label payload
carries institution, asset name, classification `132100102002 Lap Top` and the
code, and carries no location, condition or lifecycle state. An unissued code
answers `404`.

Live UI: `/assets/:id/labels` renders ten labels, each with a QR SVG and the four
printable facts, and nothing volatile. `/u/ALM-1-2026-00003` resolves and
redirects to that unit's detail page, which shows the code and a Print label
action. `/u/ALM-1-2026-99999` shows the not-found state naming the code, without
the red alert treatment — the scan worked, the code simply names nothing
reachable. The `@media print` rules are present in the loaded stylesheet and the
Print button carries `no-print`.

## 44.5 Known issues

**Pre-existing, unrelated — job queue test.** Unchanged from §43.5:
`15-supporting-services` fails whenever a development server is attached to the
same Redis, because its sweep consumes the fixture first. Environmental.

**Pre-existing, unrelated — manual screenshot test.** §42.3's `create-asset.png`
vs `create-asset.gif` mismatch. Untouched.

**Carried forward from §43.5 — root-level leaves are unselectable.** Still open,
still Phase 12's, still reported rather than fixed.

## 44.6 Deferred

**Label stock size was never specified** (`CR-001` D4). The sheet prints two
labels per row on the paper size chosen in the browser's print dialogue, which
covers the common case. Fixed-pitch layouts for specific label stock — Avery
sheets and the like — would need the stock named first, and no client answer
exists yet.

---

# 45. Phase 19 — Delegated Role Assignment (`CR-002`)

Status: COMPLETE — WAITING FOR APPROVAL

Lets an institution register its own users without central involvement, while
roles themselves stay authored centrally.

## 45.1 The specification amendment

| Document | Change |
|---|---|
| `02-requirements.md` | `BR-015` amended (writes only; reads carved out); `BR-022` added; REQ-ROLE-009 and REQ-ROLE-010 added; matrix extended; total 182 → **184** |
| `03-domain.md` | Role gains `isInstitutionAssignable` and four business rules; `DR-024` reworded; `DR-026` added |
| `04-data-model.md` | The column, `chk_roles_system_wide_not_assignable`, migration order #38, constraint table |
| `06-api.md` | `GET /roles` narrows for scoped callers; the flag on role writes; the ceiling on both assignment routes |
| `07-ui.md` | Both toggles, the warning at point of use, the picker sourcing from `GET /roles` |

`04-data-model.md`'s constraint table was also missing Phase 18's
`chk_institutions_code_url_safe` — it existed in the migration and the test
fixture but had never been transcribed. Added while in the same table.

## 45.2 Design decisions

**`DEC-065` — the ceiling is the boundary, not hardening.** `POST /users` takes a
`password` chosen by the caller and there is no password-reset endpoint
(`GAP-004`), so an administrator who creates an account can sign in as it.
Assigning a role is therefore indistinguishable from granting oneself its
permissions. This is stated in `BR-022`, in the service, and in the UI warning,
because a reader who does not know it will treat the flag as a convenience
setting.

**`DEC-066` — Option B (an explicit flag) over Option A (permissions ⊆ caller's).**
Both were specified in `CR-002`. Option A is safe by construction and needs no
schema change, but requires an institution administrator to personally hold every
permission they can delegate — so delegating a Procurement role means granting the
administrator `contract:delete`. Option B lets the system administrator decide
which roles are delegatable without inflating the administrator's own grant. The
cost is that one careless flag is an escalation path, which is why it defaults to
`false` and why the warning sits at the control.

**`DEC-067` — the mutual exclusion is a database CHECK.** A system-wide role
handed to an institution administrator would defeat organization scope entirely.
This is the one rule that must hold even if application code is wrong, so it is
enforced by `chk_roles_system_wide_not_assignable` rather than by a service check
alone. Verified against the live database: a direct `UPDATE` setting the flag on
`System Admin` is refused by PostgreSQL.

**`DEC-068` — per-action granularity in the permission catalog.**
`SYSTEM_WIDE_RESOURCES` was a per-resource set, which swept `role:read` and
`role-permission:read` up with the writes. `SCOPED_EXEMPT_CODES` now names the
exemptions individually. Only reads are listed, and that is the invariant to
preserve if the set ever grows. `user-role` left the resource set entirely —
assignment is bounded by the ceiling now, not by `BR-015`.

**`DEC-069` — unassignment is deliberately not ceilinged.** Removing a role can
only reduce access, and an administrator who inherits a user carrying a role they
could not grant must still be able to take it away. Covered by its own test.

**`DEC-070` — the roles list narrows server-side.** A scoped caller sees only
assignable roles, so the user form's picker needs no filter of its own and cannot
drift from the rule. It also means an institution administrator never enumerates
the existence of `System Admin`.

## 45.3 Tests

| Suite | Before | After |
|---|---|---|
| API unit | 246 | **250** (+4 catalog split) |
| API database | 772 | **794** (+22, `19-delegated-roles.test.js`) |
| Web | 489 | **493** (+4, role toggle behaviour) |

The escalation this feature would open without the ceiling is written as its own
case — a scoped administrator attempting to create an account holding
`System Admin` — and asserts both the rejection and that no user row was created.
The end-to-end delegation flow is tested through a real login, not a fabricated
principal.

## 45.4 Verified against the running dev stack

Migration applied to `asset_management`; the permission seeder re-run, now 108
codes. `System Admin` is `is_system_wide = true, is_institution_assignable =
false`; the existing `Institution` role is `false, false` — nothing became
delegatable by default.

A direct SQL `UPDATE` setting `is_institution_assignable` on a system-wide role
is refused by the constraint.

Live API verification was limited: the browser session belongs to `smkalmufti`,
whose `Institution` role has not been granted `role:read`, so `GET /roles`
correctly answers `403`. That is the expected behaviour rather than a defect —
`CR-002` made the permission grantable to scoped roles, not automatically granted.
Exercising the delegated flow against the dev stack needs those permissions added
to that role, which is a change to UAT data and was left for the operator.

## 45.5 Known issues

**Pre-existing, unrelated — job queue test.** `15-supporting-services` fails
whenever a development server is attached to the same Redis. Environmental,
unchanged since §43.5.

**Pre-existing, unrelated — manual screenshot test.** §42.3's `create-asset.png`
vs `create-asset.gif` mismatch.

**Flaky — manual section-index test.** `shows a section index that lists its
articles` fails intermittently in the parallel run and passes in isolation. Seen
during Phases 18 and 19; not caused by either. Worth investigating separately.

**Carried forward — root-level leaves are unselectable** (§43.5). Still open.

## 45.6 Deferred

**No per-institution user quota.** Raised during the `CR-002` discussion and
explicitly dropped from scope, along with a distinct `institution:assign`
permission — the existing `defaultInstitutionFor` / `assertCanAssignInstitution`
pair already gives that behaviour.

---

# 46. Phase 20 — Institution-Scoped Departments (`CR-003`)

Scope: `docs/revise/CR-003-department-scope-and-pic.md` §15, Phase 20 only.
PIC (Phase 21) and Department-PIC record scope (Phase 22) are NOT in this phase.

## 46.1 The specification amendment

Departments were a flat, GLOBAL list keyed by their `VARCHAR(8)` code. That made
two things impossible at once: two institutions could not both run a `TKJ`, and
a department could not be scoped to the institution that owns it.

This was already a **documented contradiction**, not a discovery. Three places
said so in comments — `db/models/Department.js`, `modules/departments/service.js`
("§10.2 also lists 'Institution scope' for this resource, which the schema cannot
express") and `DepartmentsPage.jsx`. All three were rewritten here.

## 46.2 Design decisions

**`DEC-071` — a surrogate UUID key, not a composite.** `(institution_id, code)`
as a composite primary key would have propagated both columns into
`asset_units.department_id` and every join. The surrogate keeps the foreign key
one column wide and makes `code` an ordinary, editable label. Uniqueness moved to
`uq_departments_institution_code`.

**`DEC-072` — `institution_id` is nullable, and NULL means UNASSIGNED.** Not
"shared", not "global". Legacy rows have no institution to infer and inventing one
would be worse than an honest absence. Safety comes from the assignment rule
instead: `assertDepartmentAssignable` refuses a department with no institution, so
the state is representable but INERT. `scopeFilter` matches a scoped caller's own
institution rather than NULL, so an unassigned department is invisible to them
rather than visible to everyone.

**`DEC-073` — the migration refuses rather than converts.** Retyping
`asset_units.department_id` from `VARCHAR(8)` to `UUID` cannot carry values
across: the old value is a code and no deterministic mapping exists once two
institutions may share one. Migration 040 counts assigned rows first and
`RAISE EXCEPTION`s if any exist. Verified by inserting an assignment and watching
the migration abort. `down()` carries the mirror guard, plus a check that no code
is used by two institutions.

**`DEC-074` — one shared rule replacing two copies.**
`modules/assetUnits/service.js` and `modules/contractItems/service.js` each had
their own `assertDepartmentExists`, checking existence only. Both are gone,
replaced by `domain/departmentRules.js`. Beyond the institution match, the shared
rule adds two behaviours neither copy had: a **deactivated department is now
refused** (a latent bug — it was assignable before), and `NULL = NULL` is refused
rather than treated as a match, because an unassigned department and an
institution-less asset are two absences, not agreement.

**`DEC-075` — the rule is judged against the asset, not the caller.** It is a
data-consistency rule, so it holds even for a system-wide caller who can
legitimately reach both institutions. Caller scope is enforced earlier and
separately, by `assertCanAccess`.

**`DEC-076` — `individualHooks: true` on the institution-move clear.**
`db/auditHooks.js` registers only INSTANCE hooks. A bulk `Model.update` fires
`afterBulkUpdate`, which nothing in this codebase listens to — `grep
individualHooks` returned zero hits before this phase. Without the flag, clearing
thirty units' departments would have been correct and completely invisible in the
audit trail. The regression test asserts one audit row per cleared unit, and is
the only thing that would catch its removal.

**`DEC-077` — a department's institution is immutable.** Absent from the update
schema, and `.strict()` makes the attempt an error rather than a silent no-op.
Moving one would invalidate every unit assigned to it at once, and there is no
correct remapping. A department created in the wrong institution is deactivated
and recreated.

**`DEC-078` — `POST /contract-items/:id/assets` keeps `departmentId`.** It writes
to the created UNITS, never to the Asset, so it does not contradict "department is
an asset-unit property". `AddAssetDialog` still does not expose it — the UI rule
is that department is chosen per unit.

**`DEC-079` — `create` re-reads through `detail`.** `Model.create` returns an
instance with no associations loaded, so a unit created WITH a department would
have reported `department: null` and the UI would have shown "Not assigned" for a
unit that had one.

## 46.3 Files changed

Created: `migrations/…-040-alter-departments-institution-scope.js`,
`src/domain/departmentRules.js`, `web/src/pages/assets/referenceOptions.js`.

Modified: `db/models/Department.js`, `db/associations.js`,
`modules/departments/{service,routes,schemas}.js`,
`modules/assetUnits/{service,routes}.js`, `modules/assets/{service,routes}.js`,
`modules/contractItems/{service,schemas}.js`, `modules/locations/service.js`,
`modules/reports/service.js`, `tests/database/fixtures/schema.js`,
`tests/database/helpers/apiClient.js`, four database test files, and on the web
side `AssetDetailPage.jsx`, `AssetUnitDetailPage.jsx`, `DepartmentsPage.jsx`,
`DepartmentDetailPage.jsx`, `procurement/referenceOptions.js` (exported
`useOptions`), `i18n/{en,id}.js`, two test files.

Documents amended: `02-requirements.md` (REQ-ORG-003/004), `03-domain.md` (§4.2,
§4.11), `04-data-model.md` (§5.2.2, §5.3.5, legacy map), `06-api.md` (§3.2, §5.2,
label payload).

## 46.4 Known issues

**None from this phase.**

**Pre-existing, unrelated — job queue test.** `15-supporting-services` >
"starts a worker that processes an enqueued job" fails whenever a development
API is attached to the same Redis: its BullMQ worker consumes the job the test
enqueued. Documented since §43.5 and reconfirmed here — the failure appeared
while a dev server was running for browser verification and disappeared once it
was stopped. Not caused by this phase.

## 46.4a Verified against the running dev stack

- Migration 040 applied to the live development database (21 asset units, 0 with a department — the guard's assumption confirmed by query before migrating).
- The guard was proven by inserting a department, assigning it to a unit, and running the migration: it aborted with the documented message and changed nothing. Cleaned up and re-migrated.
- `down()` then `up()` restores the original schema exactly and rebuilds the new one.
- Through the browser as `smkalmufti` (institution ALM-1, a SCOPED caller): created department `TKJ` with no `institutionId` in the body and confirmed by SQL that `defaultInstitutionFor` stamped ALM-1 on it.
- Asset unit detail showed `DEPARTMENT — Not assigned`, the edit dialog offered exactly `Teknik Komputer dan Jaringan (TKJ)` (narrowed to the asset's institution), and after saving the field read `Teknik Komputer dan Jaringan (TKJ)` — no raw identifier at any point.

> `.claude/launch.json` gained a `web`-only entry. The combined `npm run dev`
> cannot be used under the preview harness: the harness sets `PORT`, which
> `apps/api` reads, so the API tries to bind the Vite port and crashes. The API
> is started separately with its own `PORT`.

## 46.5 Deferred

**Bulk department assignment after procurement** (`CR-003` OPEN-2). Registering
30 units from one contract item means 30 individual assignments. If that proves
painful the answer is a bulk endpoint, not department on the asset form.

**Departments have no PIC.** Phase 21.

**Department is not an authorization boundary.** Phase 22. A department is
organizational responsibility and reporting only, exactly as before.

---

# 47. Phase 21 — Person in Charge, as Data and History (`CR-003`)

Scope: `docs/revise/CR-003-department-scope-and-pic.md` §15, Phase 21 only.
Department-PIC record scope is Phase 22 and is NOT in this phase.

## 47.1 The specification amendment

Departments and Locations gain a person in charge — always an existing system
user, never free text. New requirements: `REQ-ORG-006` (department PIC),
`REQ-LOC-014` (location PIC) and `REQ-AUTHZ-006` (a PIC assignment grants no
access).

`REQ-LOC-014`, not `REQ-LOC-009` — the latter is already Floor Plan. Caught only
when the traceability matrix was updated; several code comments had been written
against the wrong id and were corrected.

## 47.2 Design decisions

**`DEC-080` — an assignment table, not a `pic_user_id` column.** A mutable column
answers "who is responsible now" and destroys the answer to "who was responsible
in March". The second question is asked precisely when something has gone wrong —
an item is missing, a room was left unlocked — which is exactly when the column
has already been overwritten by whoever holds the post today.

**`DEC-081` — modelled on `asset_unit_locations`, with two strengthenings.** The
temporal pattern is already in this repository (migration 026,
`applyStateChange`), so it is copied rather than reinvented. But
`idx_asset_unit_locations_current` is a PLAIN partial index, and for PIC that is
not enough:

- `uq_*_pic_current` is **UNIQUE**. Two live location rows would be untidy; two live PIC rows make "who is responsible" unanswerable, and in Phase 22 that row will decide what its holder may touch.
- `chk_*_pic_current` makes `is_current` and `ended_at` incapable of disagreeing. A closed period still reading as current is the row that would keep granting access after a handover.

Whether `asset_unit_locations` should be tightened the same way is `CR-003`
OPEN-10, still open and out of scope here.

**`DEC-082` — one implementation for both subjects.** `domain/picAssignments.js`
is parameterised by a `SUBJECTS` table; Departments and Locations differ only in
which table a row hangs off. Two copies would be two places for the handover
transaction to drift.

**`DEC-083` — `SELECT … FOR UPDATE` on the parent, plus the unique index.** The
lock serialises concurrent handovers of the same record so the second caller
waits and then does the right thing; the index is the backstop that turns any
race which still slips through into a constraint violation rather than two people
both being "the" PIC.

**`DEC-084` — `PUT /:id/pic`, not `POST`.** There is at most one holder, so the
request states who it is rather than appending to a collection. Appointing the
first holder and handing over are the same call.

**`DEC-085` — re-appointing the current holder is a `CONFLICT`.** Not a silent
no-op: a second history row would assert that responsibility changed hands on a
day when it did not.

**`DEC-086` — `department-pic` and `location-pic` are their own permission
resources**, following `user-role`. Renaming a department and deciding who is
responsible for it are different authorities, and in Phase 22 the second will
determine what its holder may touch. Guarding PIC with `department:update` would
have merged them permanently.

**`DEC-087` — a Location institution change ENDS the assignment; a User
institution change is REFUSED.** Asymmetric on purpose. A location that changes
institution has plainly stopped being that institution's responsibility, so
closing the period states a fact. A person changing institution is an
administrative act by someone who may not know what that person is currently in
charge of — so the error names it (`CONFLICT`, listing the counts) and the
handover happens deliberately.

**`DEC-088` — both assignment tables are excluded from `AUDITED_MODELS`**, on the
reasoning that already excludes `AssetUnitLocation`: closed rows are never
touched again and each row already records who assigned and who ended it, so the
table IS the audit trail rather than a thing needing one.

**`DEC-089` — the authorization boundary is asserted, not assumed.** The last
block of `20-pic-assignments.test.js` proves a PIC gets nothing: no
`picDepartmentIds` on the profile, and no widened read. If Phase 22 is ever wired
ahead of its phase, those tests fail.

**`DEC-090` — the web `testTimeout` is raised from 5s to 15s.** These screen
tests render the real component tree against jsdom and drive it with `userEvent`,
which advances real timers per keystroke; individual tests legitimately take one
to five seconds. Under parallel load the slowest crossed the 5s default and
failed — and WHICH ones failed changed between runs while every one passed in
isolation. Raised rather than removed: a test taking 15 seconds really is hung,
and still fails.

## 47.3 Files changed

Created: `migrations/…-041-create-pic-assignments.js`,
`src/domain/picAssignments.js`, `src/db/models/DepartmentPicAssignment.js`,
`src/db/models/LocationPicAssignment.js`,
`tests/database/20-pic-assignments.test.js`,
`web/src/components/patterns/pic-panel.jsx`.

Modified: `db/models/{Department,Location}.js`, `db/associations.js`,
`db/auditHooks.js`, `auth/permissionCatalog.js`,
`modules/departments/{service,routes,schemas}.js`,
`modules/locations/{service,routes}.js`, `modules/users/service.js`,
`tests/database/{fixtures/schema.js,helpers/apiClient.js,01-migration-cycle.test.js}`,
and on the web side `api/organization.js`, `api/assetCore.js`,
`pages/organization/DepartmentDetailPage.jsx`,
`pages/locations/LocationDetailPage.jsx`, `i18n/{en,id}.js`,
`pages/organization/organization.test.jsx`, `vite.config.js`.

Documents amended: `02-requirements.md` (REQ-ORG-006, REQ-LOC-014,
REQ-AUTHZ-006, matrix), `03-domain.md` (§4.2, §4.35, §5.1), `04-data-model.md`
(§5.2.2, §5.2.5, §5.3.8, §5.3.8a, creation order, index appendix),
`06-api.md` (§3.2, §5.3), `07-ui.md` (§5.1, §5.3).

## 47.4 Verified against the running dev stack

Migration 041 applied to the live development database, then exercised through
the real API process:

- **The permission catalog needed re-seeding.** `ref.permissions` had no `*-pic:*` codes until `npm run db:seed` ran; it is idempotent by design (§10.3) and took the catalog to 114 codes, all granted to `System Admin`. **This is a required deploy step for this phase** — new permission resources do not appear by migration alone.
- `PUT /departments/:id/pic` answered **403** for a caller holding `department:update` but not `department-pic:create`, confirming the new gate is real and not merely declared.
- After granting the six codes to the `Institution` role, the same call assigned the PIC and returned a resolved `currentPic`.
- A user of another institution was refused with `VALIDATION_ERROR` naming `userId` and citing `BR-007`; re-appointing the sitting holder answered **409**.
- Clearing the post returned the department with `currentPicUserId: null`, and `GET /departments/:id/pic-assignments` still returned the closed period with its start, end, `assignedBy` and `endedBy` all resolved to users — which is the whole point of the table.
- Final state: one department, no live assignment, one preserved history row.

> **Dev-database change made during verification.** The six `*-pic:*` codes were
> granted to the `Institution` role by direct SQL so the flow could be
> exercised end to end. Which roles should hold them is a product decision, not
> mine — to undo:
>
> ```sql
> DELETE FROM public.role_permissions rp
>  USING ref.roles r
>  WHERE r.id = rp.role_id AND r.name = 'Institution'
>    AND rp.permission_code LIKE '%-pic:%';
> ```

## 47.5 Known issues

**None from this phase.**

## 47.6 Deferred

**PIC grants no access.** Phase 22 makes the CURRENT department assignment an
access-narrowing input for roles explicitly marked `is_pic_scoped`. Location PIC
never becomes one (`CR-003` §5.4).

**No point-in-time PIC in the API.** `picAt()` exists in
`domain/picAssignments.js` and is unit-testable, but no endpoint exposes it —
nothing asks the question yet. The history endpoint carries the periods a client
would need to answer it.

**`asset_unit_locations` keeps its non-unique current index** (`CR-003`
OPEN-10).

---

# 48. Phase 22 — Department-PIC Record Scope (`CR-003`)

Scope: `docs/revise/CR-003-department-scope-and-pic.md` §15, Phase 22. This
completes `CR-003`.

## 48.1 The specification amendment

A third organization-scope tier. New requirements: `REQ-ROLE-011` (PIC-scoped
Roles), `REQ-AUTHZ-007` (Department-PIC record scope), and `BR-023`; `REQ-AUTHZ-006`
amended, since a Department PIC now narrows access for one class of role.

`REQ-ROLE-011`, not `REQ-ROLE-010` — that ID is Delegated Role Assignment. The
same collision as `REQ-LOC-009` in Phase 21, caught the same way and corrected
across thirteen code comments before it reached the matrix.

## 48.2 Design decisions

**`DEC-091` — the flag lives on the Role.** Scope is already a Role property
(`is_system_wide`); putting the narrowing on the User would mean two places
decide reach, and the same person could not hold a broad role in one capacity
and a narrow one in another.

**`DEC-092` — `.every()`, not `.some()`.** The single most important line of the
phase. `isSystemWide` aggregates most-permissive-wins because it GRANTS;
`isPicScoped` RESTRICTS, so the narrowing must be unanimous. Holding any ordinary
role alongside restores institution scope — the alternative is that attaching a
PIC-scoped role to an administrator silently demotes them, which is a surprising
way to lose access. `roles.length > 0` guards the vacuous truth of `.every()` on
an empty list.

**`DEC-093` — `organizationScope` still returns `institutionId` for PIC-scoped
callers.** The institution stays the OUTER containment boundary; the department
set is an INNER narrowing on Asset Units alone. It has to work that way: creating
a unit reaches its parent Asset through `assetService.getById`, and a tier
reporting "no institution" could not reach any asset, so could not create a unit
at all.

**`DEC-094` — containment is not browsing, and this needed no new machinery.**
The client's B1 requirement was a hard, system-enforced boundary on Asset Units
without granting institution-wide browsing elsewhere. The codebase already
separates the two: `requirePermission` is route middleware that never sees a
record, and scope is applied inside services. `POST /assets/:id/units` is gated by
`asset-unit:create` alone, so a PIC-scoped role with no `asset:read` creates units
while `GET /assets/:id` answers 403. Asserted directly in
`21-pic-scope.test.js`.

**`DEC-095` — `picDepartments` on the session profile, not `department:read`.**
The picker needs the caller's departments; granting `department:read` to obtain
them would expose every department in the institution to a role whose purpose is
to reach less. `/auth/me` is deliberately not permission-gated, which makes it the
right carrier. `toPublicProfile` became async as a result.

**`DEC-096` — two mechanisms, matching the existing pair.** `unitScopeFilter` for
the three list paths that query `asset_units` directly, `assertCanAccessUnit` for
`getById` and `getByInventoryCode`. A filter alone leaves the record paths open;
a guard alone leaves the lists open. `IN (…)` never matching NULL is what
excludes department-less units — stated in the comment because a rewrite to
`Op.or` would quietly reverse it.

**`DEC-097` — a PIC-scoped caller may not set `departmentId` at all.** Not to
another department, not to their own, not to null. The department IS the boundary,
so allowing them to move it would let them pull units into their own reach or
push an inconvenient one out. `create` is the single exception (`allowOwn`): a
unit they could not read back the instant it existed is not useful to create.

**`DEC-098` — the B2 guard is a guard, not a withheld permission.**
`borrowings/service.js loadUnits` deliberately bypasses the per-unit check, which
is safe for the other two tiers and a bypass for this one. `assertNotPicScoped`
refuses `activate`, `return` and `extend` outright, with `ForbiddenError` rather
than `NotFoundError`: the borrowing is legitimately visible; it is the operation
that is unavailable. Extend is included because it moves every unit exactly as
return does.

**`DEC-099` — the Phase 21 boundary assertion was updated, not deleted.** That
test existed to catch authorization being wired ahead of its phase, and it fired
exactly as intended when Phase 22 added `picDepartments` to the profile. It now
asserts the narrower truth that still matters: appearing on the profile confers
no tier, which the two tests beside it check directly.

## 48.3 Files changed

Created: `migrations/…-042-alter-roles-pic-scoped.js`,
`tests/database/21-pic-scope.test.js`.

Modified: `src/auth/principal.js` (three-tier scope, live PIC resolution, async
profile), `src/auth/authService.js`, `src/domain/scope.js` (three new helpers),
`src/db/models/Role.js`, `src/modules/assetUnits/service.js`,
`src/modules/locations/service.js`, `src/modules/contractItems/service.js`,
`src/modules/borrowings/service.js`, `src/modules/roles/{service,schemas}.js`,
`tests/auth-units.test.js`, `tests/database/{fixtures/schema.js,helpers/apiClient.js,01-migration-cycle.test.js,20-pic-assignments.test.js}`,
and on the web side `src/auth/useSession.js` (`usePicScope`),
`src/pages/assets/referenceOptions.js`,
`src/pages/assets/AssetUnitDetailPage.jsx`,
`src/pages/organization/RoleDetailPage.jsx`, `src/i18n/{en,id}.js`,
`src/pages/assets/assets.test.jsx`.

Documents amended: `02-requirements.md` (REQ-ROLE-011, REQ-AUTHZ-007,
REQ-AUTHZ-006 amended, matrix), `03-domain.md` (§4.4), `04-data-model.md`
(§5.1.1), `06-api.md` (§1.3, §2).

## 48.4 Known issues

**None from this phase.**

**Pre-existing, environmental — job queue test.** `15-supporting-services` fails
whenever a development API is attached to the same Redis, because its BullMQ
worker consumes the job the test enqueued. Documented since §43.5 and reconfirmed
twice during this phase.

**Test-database contention.** Running a targeted `vitest` against
`vitest.database.config.mjs` while a full run of the same suite is in flight
produces widespread spurious failures — both runs share one database and clobber
each other's fixtures. Cost a confusing detour here; recorded so the next person
recognises it in one glance rather than debugging phantom foreign-key errors.

## 48.5 Deferred — the residual risks accepted for this phase

Recorded in `CR-003` §16A and unchanged:

**`borrowing:read` and `transaction:read` are dual-use.** The unit sub-resources
are PIC-narrowed, but the same codes open the institution-wide top-level lists.
Managed by not granting them to PIC-scoped roles. The optional hardening — an
`EXISTS` subquery over the item tables — is about ten lines per service and was
not taken.

**Reports remain institution-wide.** `reports/service.js` scopes by institution
only; nine raw-SQL reports were not rewritten. Do not grant `report:read` to
PIC-scoped roles.

**Assets remain institution-scoped.** A PIC-scoped role granted `asset:read`
would browse every asset in the institution. It does not need it (`DEC-094`).

**The first department assignment needs institution scope.** A unit with no
department is invisible to every PIC-scoped user, so an institution-scoped user
must always exist to make the first assignment.

---

# 49. Phase 23 — The PIC Authorization Ceiling (`CR-004`)

Scope: `docs/revise/CR-004-pic-authorization-ceiling.md`, Revision 2 (approved).
This supersedes §48.5's accepted risks, which are now retired.

## 49.1 What changed, and why it was needed

Phase 22 made `isPicScoped` a filter on `asset_units`. Everything else treated a
PIC-scoped principal as an ordinary institution principal, and §48.5 recorded the
consequence honestly: *"Managed by not granting them to PIC-scoped roles."*

An inspection against the client's intended model found that convention did not
hold. Borrowings and Transactions scoped on their own `institution_id`; four
resources had concrete holes; and one route allowed a complete tier escape. This
phase makes the tier structural.

## 49.2 Design decisions

**`DEC-100` — the ceiling is applied at principal resolution.** `resolvePrincipal`
intersects the granted set with `PIC_ALLOWED_PERMISSIONS`. Not in
`requirePermission`, because that is not the only consumer: `toPublicProfile`
publishes the set to the web client, where it drives navigation and every
reference picker. One filter at the one place the set is built means
`hasPermission`, `requirePermission`, `requireAnyPermission` and `/auth/me`
cannot disagree. A pleasant consequence found during implementation — the web
option layer is already `useOptions({ permission })`, so **every picker narrowed
itself with no frontend change**.

**`DEC-101` — the grant is suppressed, never erased.** `role_permissions` keeps
what the administrator wrote, and `GET /roles/:id/permissions` keeps reporting
it. Stripping the row would destroy the record of intent and make clearing
`isPicScoped` a lossy operation. The role editor marks such codes instead
(`picAllowed` on the catalog), and deliberately does NOT disable them — unlike
`systemWideOnly`, which the server refuses outright.

**`DEC-102` — coverage is a live subquery, not a stored column.** A
`borrowing.department_scope` column would need maintaining on every unit
transfer, and one missed update is a silent authorization failure. The subquery
is evaluated per request against `asset_units.department_id`, so a department
transfer moves the unit, its borrowings, its transactions and its attachments in
one stroke, on the next request, with no re-login. Asserted directly.

**`DEC-103` — `NOT EXISTS`, with `department_id IS NULL` matched explicitly.**
The single most dangerous line of the phase. `NULL NOT IN (…)` evaluates to
UNKNOWN, so relying on `NOT IN` alone would INVERT the rule — a record holding an
unassigned unit would be judged in scope. Two dedicated tests pin it. The
empty-department-set case is branched in JavaScript because `NOT IN ()` cannot be
spelled in Postgres.

**`DEC-104` — `assertNotPicScoped` deleted, not retargeted.** `CR-003` B2 refused
`activate`/`return`/`extend` to every PIC with `403`. Under coverage scope a
mixed borrowing is not "visible but off-limits", it is outside the caller's
record set, so the answer is `404` — a `403` would confirm its existence. The
same guard in `getById` makes `loadUnits`' documented bypass safe for all three
tiers, and its warning comment was rewritten to say so rather than left to
mislead.

**`DEC-105` — the empty-DRAFT creator exception.** A borrowing with no items is
reachable by its creator, because `POST /borrowings` creates a header and items
are added afterwards; without it a PIC would create a borrowing and get `404` on
the next request. Conjunctive with "has no items", so it can never widen access
to a record holding any unit, and an empty borrowing carries no Asset Unit
information. `CR-004` §12's rule that a NULL-department UNIT gets no creator
exception is untouched — a different rule about a different thing.

**`DEC-106` — `asset-unit:create` forbidden (OQ-1).** A PIC manages EXISTING
units. This closed the last path where `DEC-094`'s containment trick was
load-bearing for a write, and made `assertCanAssignDepartment`'s `allowOwn`
branch dead — deleted with it, because a dead branch granting a capability the
model forbids is what gets switched back on by accident. `DEC-094`'s read half
survives and is still asserted.

**`DEC-107` — three guards beyond the ceiling.** Role assignment, PIC assignment
and department reassignment are refused to PIC-scoped callers in the services as
well as by the ceiling. `DEC-098`'s own sentence is the justification — *"a
permission that merely should not be held is a convention, not a boundary"* —
applied everywhere rather than in one place.

## 49.3 Known issues

**None from this phase.**

**Recorded, deliberately not fixed here — `SEC-001`.** `audit-log:read` applies no
institution scope for ANY tier: any holder reads the whole system's audit trail.
The ceiling closes the PIC exposure only. Needs its own change request. Matches
the previously recorded UAT BUG-003.

**Recorded, deliberately not fixed here — `SEC-002`.** `users/service.js
removeRole` had no assignability check, so an institution administrator can
remove a role they could not have granted. `CR-004` added the PIC half; the
institution-tier asymmetry is de-escalating and pre-existing from `CR-002`.

**Pre-existing, environmental.** The `15-supporting-services` job-queue test fails
whenever a development API is attached to the same Redis; and running a targeted
`vitest` against `vitest.database.config.mjs` while a full run is in flight
produces spurious failures, since both share one database. Both documented since
§43.5 and §48.4.

## 49.4 Deferred

**`GET /asset-units/:id/attachments`** (`CR-004` OQ-3). A PIC reaches their unit's
files through the narrowed `GET /assets/:id/attachments`. New surface for an
ergonomic gain only; revisit if the Phase 12 UI proves awkward.

**Reports stay institution-scoped.** Nine raw-SQL reports were not rewritten for
unit coverage. `report:read` is forbidden to PIC-scoped roles by the ceiling,
which is the structural control §48.5 lacked.

---

# 50. Phase 24 — The Asset Unit Collection (`CR-005`)

Scope: `docs/revise/CR-005-asset-unit-collection.md`. A direct consequence of
Phase 23, raised by the client on seeing that a Department PIC had no Assets menu.

## 50.1 What the inspection found

The hidden Assets entry was correct and intentional (`asset:read` is class B).
The problem was what went with it: the Assets list was the **only** entry point
to a list of Asset Units, so removing it left a tier that could not find its own
records.

Three unit lists existed, and none of them served a PIC:
`GET /assets/:id/units` needs an asset id; `GET /contract-items/:id/asset-units`
needs `contract-item:read`; `GET /locations/:id/units` filters on
`current_location_id`, which is set only by recording a history entry — so a
newly registered unit appeared under no location at all. Combined with `DEC-106`
(a PIC cannot register units, so someone else does it for them), a unit could sit
in the PIC's own department and be reachable through no list in the application.

**`07-ui.md` §2 has listed "Asset Units" as a navigation entry since the first
revision of that document.** It was never built. Until Phase 23 nothing depended
on it, because the Assets list stood in for it. This phase closes a conformance
gap that predates `CR-004`; `CR-004` only made it load-bearing.

## 50.2 Design decisions

**`DEC-108` — a collection endpoint, not a widened permission.** The alternative
was returning `asset:read` to the allow-list, which would expose every asset in
the institution. `GET /assets?departmentId=` is not a substitute either: that is
a filter, and a caller can simply omit it. Scope has to be something the caller
cannot express.

**`DEC-109` — two scopes, one of them an inner join.** Institution scope rides on
`required: true` for the `asset` include, because `asset_units` has no
`institution_id` of its own; department scope is the existing `unitScopeFilter`.
Both are merged as `Op.and` with the caller's filters, never as a replacement —
the property every "cannot widen" test depends on.

**`DEC-110` — the asset name is context, not a capability.** Each row carries
`asset: { id, name }`, already produced by the existing serializer. There is no
way to reach an asset that has no unit in scope, no asset field is writable, and
`GET /assets/:id` is untouched. The web client renders the name as a link only
for callers holding `asset:read`, so a PIC sees plain text rather than a doorway
into a 403 — the same reasoning applied to the scan page's dead-end button.

**`DEC-111` — filters are documented as filters, in the code.** `FILTERS` in
`assetUnits/service.js` now carries a comment saying so explicitly. The two live
in the same `where` clause, which is exactly how they get confused, and the
security property is that one of them is derived from user input and the other
never is.

**`DEC-112` — `locationId` is an exact match, not a subtree.**
`GET /locations/:id/units` includes descendants because "what is in this
building" means its rooms. A flat filter on a unit list means "filed against
exactly this location". Recorded because the inconsistency is deliberate.

## 50.3 Known issues

**None from this phase.** No migration, no schema change, no new permission code,
and no `CR-004` guard altered.

`SEC-001` and `SEC-002` (§49.3) remain open and are untouched.

## 50.4 Verification

`GET /assets` and `GET /assets/:id` still answer `403` for a PIC-scoped caller —
asserted inside the same test that reads the new collection, so the two cannot
drift apart.

---

# 51. Phase 25 — Institution-Configurable Inventory Code Format (`CR-006`)

`docs/revise/CR-006-configurable-inventory-code-format.md`. Amends `CR-001`,
which introduced the inventory code in Phase 18 with one hard-coded shape.

## 51.1 What the inspection found

The shape `{institution code}-{registration year}-{sequence}` was not a choice
among alternatives — it was the only shape, written into `formatCode()` and into
REQ-UNIT-007 itself. Three findings decided the design:

**Allocation was already format-agnostic, and nobody had noticed.**
`allocateCodes` has never used a counter table. It reads `MAX(...)` over the
codes already stored that share a literal prefix, under an advisory lock. The
pool is therefore keyed by the RESOLVED PREFIX, not by institution and year as
such — reset-yearly-per-institution is an emergent property of those two values
being in the prefix. Generalising to configurable formats needed the prefix
computed rather than hard-coded, and nothing else.

**Configurable attributes cannot be tokens.** Values are written by
`PUT /asset-units/:id/attribute-values`, which requires the unit to already
exist; in the procurement flow the asset's values are equally absent, since
`POST /contract-items/:id/assets` creates asset and units in one transaction.
They are also classification-scoped, free-form `TEXT`, and optional. Four
independent disqualifications.

**An institution administrator could not reach any institution screen.**
`institution:*` is system-wide-only (`BR-015`), so the tier that most needs this
feature cannot open `/organization/institutions` at all. That decided both the
permission model and the fact that there are two entry points.

## 51.2 Design decisions

**`DEC-113` — a validated template string on `institutions`, not JSON, not a
version table.** The literal alphabet excludes `{` and `}`, so the grammar needs
no escaping rules — the usual argument against template strings does not apply.
`Institution` is audited, so a scalar column yields a readable before/after in
`audit.audit_logs`; a JSONB array yields a diff nobody reads. That audit trail is
also why there is no format history table: nothing ever re-derives a code from a
historical format, because the final string is stored on the unit (`BR-020`).

**`DEC-114` — `NULL` means "not configured" and is never backfilled.** Writing
the default literally into every row would make "never configured"
indistinguishable from "configured to today's default" and would pin every
existing institution to that default for good. Verified against the dev database
after migrating: both institutions still `NULL`, all 21 existing codes unchanged.

**`DEC-115` — `SEQUENCE` is required to be the FINAL token.** Not merely allowed
to be. It keeps allocation a pure prefix scan rather than a prefix-and-suffix
pair, and it removes a class of formats whose sequence resets on something
printed after it. No existing behaviour or business need wanted a suffix.

**`DEC-116` — uniqueness is a property of the algorithm, not a check.** Every
generated code is `prefix + digits`, so any stored code that could collide with a
future one necessarily matches `^prefix(\d+)$` and is seen by the scan, which
allocates strictly above it. Switching to a format that reproduces an earlier
shape therefore CONTINUES PAST the old codes rather than restarting into them.
The `LIKE` pre-filter only over-matches (`_` is a wildcard and does occur in
institution codes; `%` cannot occur), so it can never hide a row. A counter table
was rejected precisely here: it would say 43 while an old code 43 exists, forcing
a retry loop, plus a seeding migration and a second source of truth.

**`DEC-117` — a missing token value refuses the registration; a missing
institution does not.** They are different absences. No institution means no
format and nothing to build from, so the unit registers with `inventory_code =
NULL` — unchanged Phase 18 behaviour. A configured token with no value means the
institution ASKED for that value, so the registration fails naming the field.
Silently registering a unit that can never be labelled is a failure discovered at
the printer. No omission, no collapsed separators, no empty substitution.

**`DEC-118` — the width is derived, and the ceiling is checked at configuration
time.** `VARCHAR(64)` is the registry's worst case (25+12+8+4+2+8 plus five
separators lands on exactly 64), and `validateFormat` refuses anything wider,
budgeting the sequence at 8 rather than its 5-digit padding so growth cannot
overflow. Widening without that check would only move the failure from
configuration time to a registration nobody can complete.

**`DEC-119` — `inventory-code-format` is its own resource, deliberately not
system-wide-only.** Follows `user-role`, `role-permission` and `department-pic`:
the sub-resource is a different authority from administering the parent. Its
absence from `PIC_ALLOWED_PERMISSIONS` was caught, as intended, by the ceiling
count test in `22-pic-ceiling.test.js` (84 → 86).

**`DEC-120` — the token registry rides on the format response, not a reference
endpoint.** It was specified in Phase A as `GET /reference/inventory-code-tokens`
and folded into `GET /institutions/:id/inventory-code-format` during
implementation. Two reasons: the samples must be INSTITUTION-AWARE, and that
response is the only place the server knows which institution is meant; and a
separate endpoint would have had no caller, which §7 forbids.

**`DEC-121` — a structured builder, so malformed states are unconstructible.**
The sequence chip has no remove and no move control, tokens insert before it, and
the separator control offers `-`, `_`, `.` and nothing else. `/` is absent rather
than offered and refused. Server validation is unchanged by any of that
(`BR-026`).

## 51.3 Files changed

Migrations `043` (column + `chk_institutions_inventory_code_format`) and `044`
(`inventory_code` → `VARCHAR(64)`). New `src/domain/inventoryCodeFormat.js`;
`inventoryCode.js` generalised to a prefix. `Institution`/`AssetUnit` models, the
permission catalog, `institutions` service/routes/schemas, and the two
allocation call sites in `assetUnits` and `contractItems`. Web: the API client,
`useInventoryCodeFormat`, `InventoryCodeFormatBuilder`, a tab on the institution
detail page, `/organization/inventory-code-format`, navigation, and both locales.

## 51.4 Tests

New: `tests/inventory-code-format.test.js` (48), `tests/database/25-inventory-code-format.test.js`
(50), `src/pages/organization/inventoryCodeFormat.test.jsx` (19). Updated:
`tests/inventory-code.test.js` for the prefix signature, `01-migration-cycle`
(45 migrations), `03-constraints`, `05-behavior`, `22-pic-ceiling`, and the
schema fixture.

The backward-compatibility test is the load-bearing one: the default format must
render byte-identically to what Phase 18 produced, asserted through
`formatCode(buildPrefix(DEFAULT_FORMAT, …), 42) === 'ALM-1-2026-00042'`.

## 51.5 Known issues

**None from this phase.**

`15-supporting-services.test.js` "starts a worker that processes an enqueued job"
fails, and did so before this phase — confirmed by re-running it with both
migrations moved aside. It concerns the BullMQ overdue sweep and touches nothing
here. Unrelated and still open.

`SEC-001` and `SEC-002` (§49.3) remain untouched.

## 51.6 Deferred

Configurable attributes as tokens, reconsidered only against a concrete business
requirement and a lifecycle design that makes values available before the unit
exists. Month and other sub-year date tokens, which would silently change the
sequence reset period. A configurable sequence width.
