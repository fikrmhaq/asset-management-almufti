# Claude Code Project Instructions

## 1. Project Purpose

This repository implements the Asset Management System defined by:

- `01-product.md`
- `02-requirements.md`
- `03-domain.md`
- `04-data-model.md`
- `05-infrastructure.md`
- `06-api.md`
- `07-ui.md`

These documents are the source of truth for the implementation.

---

# 2. Critical Development Rule

## IMPLEMENTATION MUST BE PHASED

Do NOT build the entire application in one process.

The project MUST be implemented incrementally, one phase at a time.

Claude MUST:

1. Understand the complete architecture before implementing.
2. Implement ONLY the currently requested phase.
3. Avoid implementing future phases.
4. Complete and test the current phase.
5. Report what was implemented.
6. Report any unresolved issues or decisions.
7. STOP and wait for explicit user approval before starting the next phase.

Do NOT automatically continue into the next phase.

---

# 3. Source of Truth

The documents have different responsibilities:

- `01-product.md`
  - Product scope
  - Core capabilities
  - Product intent

- `02-requirements.md`
  - Functional requirements
  - Business rules
  - Non-functional requirements
  - Requirement IDs

- `03-domain.md`
  - Domain entities
  - Relationships
  - Domain behavior
  - Bounded contexts

- `04-data-model.md`
  - Physical database schema
  - Tables
  - Columns
  - Constraints
  - Indexes
  - Migration order

- `05-infrastructure.md`
  - Runtime stack
  - Deployment
  - Infrastructure
  - Authentication infrastructure
  - Background jobs

- `06-api.md`
  - REST API contract
  - Endpoints
  - Request/response formats
  - Authorization requirements

- `07-ui.md`
  - Frontend architecture
  - Navigation
  - Screens
  - UI patterns

Do not silently redefine or contradict these documents.

If an implementation issue requires a design change:

1. Identify the conflict.
2. Explain the issue.
3. Propose the change.
4. STOP and ask for approval.

Do not silently modify the architecture.

---

# 4. Phase Discipline

Each phase has:

- Scope
- Dependencies
- Implementation tasks
- Tests
- Validation
- Completion criteria

Claude MUST NOT implement functionality belonging to a later phase simply because it is convenient.

It is acceptable to create minimal interfaces, placeholders, types, or configuration required by the current phase.

It is NOT acceptable to implement the actual functionality of future phases.

---

# 5. Dependency Rule

A phase may depend only on:

- Completed previous phases
- Existing project infrastructure
- The documented architecture

If a dependency is missing:

- Do not work around it by implementing the future phase.
- Report the dependency.
- Ask whether the phase should be adjusted.

---

# 6. Completion Rule

A phase is complete only when:

1. Implementation is finished.
2. Relevant tests pass.
3. Database migrations are verified where applicable.
4. Existing functionality remains working.
5. No known blocking issue remains.
6. The implementation matches the source documents.

At the end of every phase, provide:

### Implementation Summary
- What was implemented

### Files Changed
- Files created
- Files modified

### Tests
- Tests added
- Tests executed
- Results

### Verification
- What was manually verified

### Known Issues
- Remaining problems

### Deferred Work
- Work intentionally left for later phases

### Phase Status
`COMPLETE — WAITING FOR APPROVAL`

Then STOP.

---

# 7. Do Not Optimize for Speed

Correctness and architectural consistency are more important than completing the entire application quickly.

Do not:

- Generate the entire backend at once.
- Generate the entire frontend at once.
- Generate placeholder implementations for every module.
- Create speculative APIs.
- Create database tables that belong to future phases unless required by dependency.
- Implement UI screens before their APIs are ready.

---

# 8. Testing Rule

Every implementation phase MUST include appropriate tests.

Prefer:

- Database migration verification
- Unit tests
- Integration tests
- API tests
- Authorization tests
- Frontend component tests

Tests should correspond to the requirements being implemented.

Use requirement IDs where useful.

Example:

`REQ-AUTH-002`
→ login implementation
→ authentication API test
→ relevant frontend test later

---

# 9. Requirement Traceability

When implementing functionality, identify the relevant:

- REQ
- Domain entity
- Database table
- API endpoint
- UI screen

Do not invent requirement IDs.

The requirement traceability matrix in `02-requirements.md` should remain consistent with the implementation.

---

# 10. No Premature Frontend

The frontend is intentionally implemented after the backend API is sufficiently stable.

Do not build production frontend screens while the corresponding API contract is still being designed.

Frontend implementation should follow `07-ui.md`.

---

# 11. Phase Order

The implementation phases are defined below.

## Phase 0 — Project Foundation

Scope:

- Repository structure
- Backend project initialization
- Frontend project initialization
- Environment configuration
- Basic linting
- Formatting
- Testing infrastructure
- Docker development infrastructure
- Basic project documentation

Do NOT implement business functionality.

---

## Phase 1 — Database

Scope:

- PostgreSQL setup
- Sequelize configuration
- Database schemas
- PostgreSQL extensions
- Enumerated types
- Sequelize migrations
- Reference tables
- Organization tables
- Procurement tables
- Asset Core tables
- Operations tables
- Audit table
- Required indexes and constraints
- Seed/reference data where defined

Follow the table creation order in `04-data-model.md`.

Do NOT implement REST APIs.

Do NOT implement authentication logic.

Do NOT implement frontend.

Database must be independently verifiable before proceeding.

---

## Phase 2 — Backend Foundation

Scope:

- Express application
- Application configuration
- Database connection
- Sequelize models
- Error handling
- Request validation infrastructure
- Logging
- Security middleware
- API versioning
- Common response format
- Testing infrastructure

Do NOT implement complete business modules yet.

---

## Phase 3 — Authentication & Authorization

Scope:

- User authentication
- Password hashing
- JWT access tokens
- Refresh tokens
- Redis session storage
- Login
- Logout
- Refresh
- Current-user endpoint
- Authentication middleware
- Permission middleware
- Institution scope enforcement
- Role/permission resolution

Implement according to `02-requirements.md`, `05-infrastructure.md`, and `06-api.md`.

---

## Phase 4 — Organization & Reference APIs

Scope:

Organization:

- Institutions
- Departments
- Users
- Roles
- Permissions

Reference:

- Classifications
- Attribute definitions
- Measurement units
- Contract types
- Funding sources
- Account codes
- Transaction types

---

## Phase 5 — Asset Core APIs

Scope:

- Locations
- Floor plans
- Floor plan areas
- Assets
- Asset units
- Asset-unit locations
- Longitudinal history
- Asset attributes
- Asset-unit attributes
- Attachments

---

## Phase 6 — Procurement APIs

Scope:

- Vendors
- Suppliers
- Contracts
- Contract items
- Procurement relationships with assets

---

## Phase 7 — Operations APIs

Scope:

- Borrowings
- Borrowing items
- Transactions
- Transaction items
- Lifecycle operations
- Location changes
- Borrow/return operations

---

## Phase 8 — Supporting Backend Services

Scope:

- Audit logging
- Background jobs
- Borrowing overdue sweep
- File storage handling
- Additional backend integration tests
- Operational hardening

---

## Phase 9 — Frontend Foundation

Scope:

- React/Vite setup
- React Router
- Tailwind
- shadcn/ui
- Zustand
- TanStack Query
- TanStack Table
- Axios
- React Hook Form
- Zod
- date-fns
- Frontend testing
- Application layout foundation

Do NOT implement complete business screens.

---

## Phase 10 — Frontend Authentication & Application Shell

Scope:

- Login
- Session handling
- Token refresh
- Logout
- Protected routes
- Permission-aware navigation
- Sidebar
- Top bar
- Breadcrumbs
- Global error handling
- Loading states

---

## Phase 11 — Frontend Organization & Reference

Scope:

- Institutions
- Departments
- Users
- Roles
- Permissions
- Classification browser
- Attribute definitions
- Reference lookup management

---

## Phase 12 — Frontend Asset Management

Scope:

- Asset list
- Asset creation
- Asset editing
- Asset detail
- Asset units
- Unit detail
- Unit history
- Locations
- Floor plans
- Attributes
- Attachments
- Classification picker

---

## Phase 13 — Frontend Procurement

Scope:

- Vendors
- Suppliers
- Contracts
- Contract items
- Procurement workflows

---

## Phase 14 — Frontend Operations

Scope:

- Borrowings
- Borrowing detail
- Return workflow
- Transactions
- Transaction detail
- Lifecycle operations

---

## Phase 15 — Reports & Audit UI

Scope:

- Dashboard
- Asset reports
- Status reports
- Classification reports
- Organization reports
- Location reports
- Condition reports
- Borrowing reports
- Procurement traceability
- Audit log

---

## Phase 16 — Final Integration & Hardening

Scope:

- End-to-end testing
- Requirement traceability verification
- Authorization testing
- Validation testing
- Error handling
- Performance review
- Security review
- Docker production build
- Deployment verification
- Documentation cleanup

---

# 12. Starting a Phase

When the user says:

`Start Phase N`

Claude MUST:

1. Read the relevant source documents.
2. Identify dependencies.
3. Inspect the existing implementation.
4. Create a concise implementation plan.
5. Implement only that phase.
6. Test it.
7. Report the result.
8. STOP.

Do not start another phase automatically.

---

# 13. If the User Says "Continue"

"Continue" means continue the CURRENT phase if it is incomplete.

It does NOT automatically mean start the next phase.

To start another phase, the user must explicitly approve it or say:

`Start Phase N`.

---

# 14. If Requirements Conflict

Never silently choose one interpretation.

Report:

- Conflict
- Affected documents
- Affected requirements
- Recommended resolution
- Implementation impact

Then wait for approval.

---

# 15. Final Principle

The goal is not:

"Generate the application."

The goal is:

"Incrementally implement a verified system from the documented architecture."

Each phase should leave the repository in a working, testable state.

# 16. Phase Gate

A phase may only be considered complete when its completion criteria
are satisfied.

Claude MUST NOT start the next phase automatically.

Before starting a phase, verify:

- Previous phase exists.
- Previous phase passed its tests.
- Required dependencies exist.
- No blocking issue is known.

After completing a phase:

STOP.

Never execute:

"while I'm here..."
"as part of this..."
"for completeness..."
"we should also implement..."

if the work belongs to a later phase.