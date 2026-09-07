# Asset Management System

Centralized system for managing organizational physical assets throughout their
lifecycle — registration, classification, procurement, location, condition,
borrowing, transactions, and organizational responsibility.

The specification in [`docs/`](docs/) is the source of truth for this
implementation. [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) defines the
phase order; [`CLAUDE.md`](CLAUDE.md) defines the working rules.

| Document                                                 | Responsibility                             |
| -------------------------------------------------------- | ------------------------------------------ |
| [`docs/01-product.md`](docs/01-product.md)               | Product scope and capabilities             |
| [`docs/02-requirements.md`](docs/02-requirements.md)     | Functional and non-functional requirements |
| [`docs/03-domain.md`](docs/03-domain.md)                 | Domain model                               |
| [`docs/04-data-model.md`](docs/04-data-model.md)         | PostgreSQL schema                          |
| [`docs/05-infrastructure.md`](docs/05-infrastructure.md) | Runtime, infrastructure, deployment        |
| [`docs/06-api.md`](docs/06-api.md)                       | REST API contract                          |
| [`docs/07-ui.md`](docs/07-ui.md)                         | Frontend architecture                      |

---

## Status

**Complete — all sixteen phases.** The API, the frontend and the supporting
services are built, tested and verified against the specification.

|              |                                                                                 |
| ------------ | ------------------------------------------------------------------------------- |
| Requirements | 170, all traced ([matrix](docs/02-requirements.md#28-requirement-traceability)) |
| Tests        | 1,195 — 356 frontend, 202 backend unit, 637 database/API                        |
| Migrations   | 36, verified through migrate → rollback → re-migrate                            |
| Endpoints    | Every path in [`docs/06-api.md`](docs/06-api.md) §2–§10                         |
| Screens      | Every route in [`docs/07-ui.md`](docs/07-ui.md) §5                              |

Known limitations are listed under [Known limitations](#known-limitations) and
dispositioned in `IMPLEMENTATION_PLAN.md` §39.

---

## Stack

| Layer         | Technology                                                                  |
| ------------- | --------------------------------------------------------------------------- |
| Backend       | Node.js 20+, Express, JavaScript (CommonJS)                                 |
| Frontend      | React 19, Vite, JavaScript (no TypeScript, per `05-infrastructure.md` §3.1) |
| Database      | PostgreSQL 16 (Docker)                                                      |
| Cache / queue | Redis 7 (Docker)                                                            |
| Testing       | Vitest — with Supertest (API) and React Testing Library (web)               |
| Lint / format | ESLint 9 (flat config) + Prettier 3                                         |

---

## Repository layout

```text
asset-management/
├── apps/
│   ├── api/                 Express API
│   │   ├── config/          sequelize-cli connection config
│   │   ├── migrations/      schema migrations, in data-model creation order
│   │   ├── seeders/         idempotent reference-data seeders
│   │   ├── scripts/         operator tools (datastore connectivity check)
│   │   ├── src/
│   │   │   ├── config/      environment schema and fail-fast validation
│   │   │   ├── db/          Sequelize instance, models, associations
│   │   │   ├── errors/      error classes and database error translation
│   │   │   ├── http/        response envelopes
│   │   │   ├── middleware/  validation, security, logging, error handling
│   │   │   ├── query/       pagination, filtering, sorting
│   │   │   └── routes/      health and the /api/v1 mount point
│   │   └── tests/           Vitest + Supertest, plus the schema suite
│   └── web/                 React + Vite frontend
│       └── src/             application source and colocated tests
├── docs/                    specification documents (source of truth)
├── storage/attachments/     uploaded files — bind-mounted into the container
├── docker-compose.dev.yml   postgres, redis, api, web
└── package.json             npm workspaces root
```

---

## Prerequisites

- **Node.js 20+** (developed against 22.x) and npm 10+
- **Docker Desktop** with the Docker Engine running

A native PostgreSQL or Redis installation is _not_ required — both run in
containers. `psql` on the host is not needed either; use
`docker compose exec postgres psql` when you need a shell.

---

## Getting started

```bash
npm install
```

```bash
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead.

Start the datastores:

```bash
npm run docker:up
```

Confirm the backend can reach both:

```bash
npm run check:services
```

Expected output:

```text
OK    postgres   asset_management — PostgreSQL 16.x ...
OK    redis      redis_version:7.x.x
```

If PostgreSQL reports `password authentication failed`, something else is
already listening on the port — most often a native PostgreSQL service bound to
`0.0.0.0:5432`, which shadows the container's mapping so the client silently
reaches the wrong server. Confirm with:

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U asset_app -d asset_management -c "select 1"
```

If that succeeds while `check:services` fails, the container is fine and the host
port is the problem. Move the published port by setting `POSTGRES_PORT` in `.env`
(and matching the port in `DATABASE_URL`), then re-run `npm run docker:up`. This
machine uses `5433` for exactly this reason.

Run the API and frontend with hot reload:

```bash
npm run dev
```

- API — http://localhost:3000
- Frontend — http://localhost:5173

---

## Running everything in Docker

`npm run docker:up` starts only PostgreSQL and Redis, which is the smoother
workflow on Windows. To run the API and frontend as containers too:

```bash
npm run docker:up:all
```

Source directories are bind-mounted, so nodemon and Vite hot reload still apply.

---

## Commands

All commands run from the repository root.

| Command                                     | Purpose                                   |
| ------------------------------------------- | ----------------------------------------- |
| `npm run dev`                               | API + frontend with hot reload            |
| `npm run dev:api` / `npm run dev:web`       | one side only                             |
| `npm start`                                 | API without hot reload                    |
| `npm run build`                             | production frontend build                 |
| `npm test`                                  | all workspace tests (no database needed)  |
| `npm run test:api` / `npm run test:web`     | one workspace                             |
| `npm run test:db`                           | schema verification suite (needs Docker)  |
| `npm run db:migrate`                        | apply migrations                          |
| `npm run db:migrate:status`                 | show applied/pending migrations           |
| `npm run db:migrate:undo:all`               | roll the schema back to empty             |
| `npm run db:seed`                           | run the seeders (idempotent)              |
| `npm run db:seed:undo:all`                  | remove seeded data                        |
| `npm run lint` / `npm run lint:fix`         | ESLint                                    |
| `npm run format` / `npm run format:check`   | Prettier                                  |
| `npm run check:services`                    | verify PostgreSQL and Redis connectivity  |
| `npm run bootstrap`                         | create the first administrator account    |
| `npm run docker:up`                         | start PostgreSQL + Redis                  |
| `npm run docker:up:all`                     | start PostgreSQL + Redis + API + frontend |
| `npm run docker:down`                       | stop containers, keep data                |
| `npm run docker:reset`                      | stop containers **and delete volumes**    |
| `npm run docker:logs` / `npm run docker:ps` | inspect the stack                         |

`npm run docker:reset` destroys the database and Redis volumes. It is the
intended way to start over from an empty database, and it is not reversible.

---

## Configuration

Every variable is documented in [`.env.example`](.env.example) and follows the
`UPPER_SNAKE_CASE` convention in `05-infrastructure.md` §1.2. The API validates
its required variables at startup and exits with a non-zero code when one is
missing, rather than failing later at first use.

`.env` is git-ignored and must never be committed. Production values come from
GitLab CI/CD variables, injected at deploy time (`05-infrastructure.md` §9.2).

The `JWT_*` variables are documented but unused until Phase 3, so they may stay
blank for now.

Inside Docker Compose the `api` service overrides `DATABASE_URL` and `REDIS_URL`
to use the `postgres` and `redis` service hostnames; the values in `.env` target
the ports published to localhost for host-based development.

---

## Database

The schema is defined by [`docs/04-data-model.md`](docs/04-data-model.md) and
built by `sequelize-cli` migrations — 34 tables across the `public`, `ref` and
`audit` schemas, created in the dependency order the data model specifies.

Set it up on a running PostgreSQL container:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Migrations are a deploy step, never a side effect of application boot
(`05-infrastructure.md` §11.2), so nothing runs them automatically.

### Seed data

| Seeder                           | Contents                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| `001-seed-asset-classifications` | 14,738 rows from `rincian_asset.csv` — fixed government reference data |
| `002-seed-system-admin-role`     | one system-wide `System Admin` role                                    |

Both are idempotent and safe to re-run on every deploy. Every other reference
table starts empty and is populated through the admin UI later
(`05-infrastructure.md` §10.3). No user is seeded — the first one comes from a
bootstrap command in Phase 3.

Three classification rows (`202010500200`, `202010500300`, `202010500400`) name
a parent that exists in neither the CSV nor the legacy dump. They are loaded as
root-level records rather than dropped or given an invented parent, and the
seeder logs them on every run so the source-data defect stays visible.

To point the seeder at a CSV elsewhere, set `CLASSIFICATION_CSV_PATH`.

### Psql shell

```bash
docker compose -f docker-compose.dev.yml exec postgres psql -U asset_app -d asset_management
```

Sequelize models describe the migrated schema; they never define it.
`sequelize.sync()` is not called anywhere and must not be — the migrations are
the only thing that changes the database.

---

## API

The API is versioned under `/api/v1` ([`docs/06-api.md`](docs/06-api.md) §1.1).
Two endpoints exist so far; business modules arrive from Phase 3 onward.

| Method | Path                   | Purpose                                                          |
| ------ | ---------------------- | ---------------------------------------------------------------- |
| GET    | `/api/health`          | PostgreSQL and Redis connectivity. `200` healthy, `503` degraded |
| GET    | `/api/v1`              | version descriptor, confirming the prefix is mounted             |
| POST   | `/api/v1/auth/login`   | `{ username, password }` → access token + refresh cookie         |
| POST   | `/api/v1/auth/refresh` | reads the refresh cookie, issues a new access token              |
| POST   | `/api/v1/auth/logout`  | revokes the session                                              |
| GET    | `/api/v1/auth/me`      | current user, roles and effective permissions                    |

Organization and reference resources (`06-api.md` §3–§4), all authenticated and
permission-gated:

| Resource              | Paths                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Institutions          | `/institutions`, `/:id`, `/:id/deactivate`, `/:id/reactivate`                                                                  |
| Departments           | `/departments` … (`:id` is the `VARCHAR(8)` natural key)                                                                       |
| Users                 | `/users` …, plus `/:id/roles` and `/:id/roles/:roleId`                                                                         |
| Roles                 | `/roles` … (hard `DELETE`), plus `/:id/permissions` (`GET`, `PUT`)                                                             |
| Permissions           | `/permissions` — read-only catalog                                                                                             |
| Classifications       | `/classifications`, `/:id`, `/:id/children`, `/:id/path`, `/leaf?q=` — read-only                                               |
| Attribute definitions | `/attribute-definitions` …                                                                                                     |
| Lookups               | `/categories` (read-only), `/measurement-units`, `/contract-types`, `/funding-sources`, `/transaction-types`, `/account-codes` |
| Conditions            | `/reference/conditions` — fixed enum                                                                                           |

Asset core (`06-api.md` §5):

| Resource    | Paths                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Assets      | `/assets` …, `/:id/units`, `/:id/attribute-values`, `/:id/attachments`                          |
| Asset units | `/asset-units/:id` …, `/:id/history` (`GET`, `POST`), `/:id/locations`, `/:id/attribute-values` |
| Locations   | `/locations` …, `/:id/children`, `/:id/units`                                                   |
| Floor plans | `/locations/:id/floor-plan` (`GET`, `PUT`, `DELETE`), `/image`, `/areas` …                      |
| Attachments | `/attachments/:id` (`GET`, `?download=true`, `DELETE`)                                          |

A unit's condition, location and lifecycle state are not editable fields.
`POST /asset-units/:id/history` records all three together in one append-only
entry, closes the previous period and syncs the denormalized columns — because
`LongitudinalHistory` stores them as a single row, moving a unit and changing its
condition are the same write (`06-api.md` §5.2).

Everything under `/api/v1` except `/auth` sits behind the authentication
middleware, so a route cannot be added without a token check by forgetting one.
An unauthenticated request to an unknown versioned path therefore answers `401`
rather than `404` — the same ordering the permission middleware uses for `401`
before `403`.

`/api/health` sits outside the version prefix on purpose: Docker's
`HEALTHCHECK` and Nginx's upstream check poll it, and its path must not move
when the API is versioned.

Every response uses one of three envelopes (§1.4):

```json
{ "data": { } }
{ "data": [ ], "meta": { "page": 1, "pageSize": 20, "total": 134, "totalPages": 7 } }
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [ ] } }
```

A `5xx` response never carries a stack trace, SQL text or a driver message
(`REQ-VAL-006`) — those are logged server-side instead. Each request carries an
`x-request-id` header, echoed back, tying a log line to the request that
produced it.

---

## Authentication

JWT access + refresh pair, per [`docs/05-infrastructure.md`](docs/05-infrastructure.md) §6.

- **Access token** — 15 minutes, sent as `Authorization: Bearer`. Carries
  identity only; roles and permissions are re-read from the database on every
  request, so revoking a role takes effect immediately rather than when the
  token happens to expire.
- **Refresh token** — 7 days, delivered as an `httpOnly`, `SameSite=Strict`
  cookie scoped to `/api/v1/auth`. It never appears in a response body.

Sessions are tracked in Redis. That is what makes logout real: a stateless JWT
stays valid until it expires no matter what the server does, so `REQ-AUTH-003`
cannot be satisfied without it. Logout deletes the session; deactivating a user
revokes all of theirs. The residual exposure is one access-token lifetime.

### First user

No user is seeded — a baked-in default password is a credential risk. Create the
first account once, after deploy:

```bash
npm run bootstrap
```

It prompts for the username and password (never echoed, never taken from an
argument or environment variable) and assigns the seeded System Admin role. It
refuses to run once any user exists; further accounts are created through the
API, where they are authorized and audited.

### Permissions

Permission codes are `{resource}:{action}` and are **generated**, never
hand-written — [`src/auth/permissionCatalog.js`](apps/api/src/auth/permissionCatalog.js)
declares the actions each resource guards, and `ref.permissions` is seeded from
that. `requirePermission()` validates its code against the catalog when the
router is built, so a typo fails at startup rather than silently guarding
nothing. This is what keeps the catalog and the enforced routes from drifting
apart (`06-api.md` §1.3).

A system-wide role lifts organization scope (`REQ-AUTHZ-005`); it does not grant
permissions the role was never given. System Admin can do everything because it
is _granted_ everything, which is visible in `role_permissions` like any other
role — an implicit bypass would not be.

---

## Testing

```bash
npm test
```

Vitest runs both workspaces: the API with Supertest, the frontend with React
Testing Library in jsdom. Neither suite requires Docker — the datastore
connectivity check is a script, not a test, so the suite stays runnable in CI
before any service is provisioned.

```bash
npm run test:db
```

The schema verification suite checks the migrated database against the data
model: every table, column, type, constraint and index, the full
migrate → rollback → re-migrate cycle, and seed correctness and idempotency.

It needs a running PostgreSQL container and uses two databases of its own,
derived from `TEST_DATABASE_URL` (`..._test` and `..._test_cycle`). Both are
dropped and rebuilt on every run, so never point `TEST_DATABASE_URL` at the
development database.

---

## Implementation status

The project is built in phases, and each phase must be completed and approved
before the next begins (`IMPLEMENTATION_PLAN.md` §3).

| Phase | Name                               | Status       |
| ----- | ---------------------------------- | ------------ |
| 0     | Project Foundation                 | **Complete** |
| 1     | Database                           | **Complete** |
| 2     | Backend Foundation                 | **Complete** |
| 3     | Authentication & Authorization     | **Complete** |
| 4     | Organization & Reference API       | **Complete** |
| 5     | Asset Core API                     | **Complete** |
| 6     | Procurement API                    | **Complete** |
| 7     | Operations API                     | **Complete** |
| 8     | Supporting Backend Services        | **Complete** |
| 9     | Frontend Foundation                | **Complete** |
| 10    | Frontend Authentication & Shell    | **Complete** |
| 11    | Frontend Organization & Reference  | **Complete** |
| 12    | Frontend Asset Core                | **Complete** |
| 13    | Frontend Procurement               | **Complete** |
| 14    | Frontend Operations                | **Complete** |
| 15    | Reports & Audit (backend, then UI) | **Complete** |
| 16    | Integration & Hardening            | **Complete** |

Business rules that cross rows — leaf-level classification (`BR-011`), floor-plan
area descendancy (`BR-014`), attribute scope (`BR-009`/`BR-010`), system-wide
role restriction (`BR-015`) — are not expressed as database constraints. The
data model assigns them to the application layer, and that is where they are
enforced, with tests per rule.

---

## Production deployment

The topology is one VPS running Docker Compose behind host-level Nginx
(`docs/05-infrastructure.md` §2). Artifacts:

| File                      | Role                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| `apps/api/Dockerfile`     | API + in-process BullMQ worker, non-root, healthchecked                         |
| `apps/web/Dockerfile`     | Vite build served by Nginx                                                      |
| `docker-compose.prod.yml` | The four services; Postgres and Redis are **not** published to the host (§12.2) |
| `deploy/nginx/app.conf`   | Inside the web container: static assets + `/api` proxy                          |
| `deploy/nginx/site.conf`  | On the host: TLS termination via Let's Encrypt (§12.1)                          |
| `.gitlab-ci.yml`          | `lint → test → build → deploy`, production gated manually (§11.3)               |

Deploying, with the images already built and pushed:

```bash
export API_IMAGE=registry.example/asset-management/api:<sha>
export WEB_IMAGE=registry.example/asset-management/web:<sha>

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml run --rm api npm run db:migrate --workspace apps/api
docker compose -f docker-compose.prod.yml up -d
```

Migrations run as their **own step**, before the new containers serve traffic
(§11.2) — never from application boot.

First deploy only, after migrating:

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run db:seed --workspace apps/api
docker compose -f docker-compose.prod.yml run --rm -it api npm run bootstrap --workspace apps/api
```

`db:seed` loads the 14,738 asset classifications, the permission catalog and the
System Admin role. `bootstrap` creates the first user interactively — no user is
ever seeded, because a default password nobody changes is a real risk (§10.3).

Every variable in `docker-compose.prod.yml` is required and has no development
fallback. The API validates its configuration at boot and exits with the list of
problems rather than starting half-configured.

**Not verified in this repository:** HTTPS/certbot and an actual deployment —
there is no VPS, domain or certificate in the development environment. The
images, the compose stack, the migration and seed steps, the Nginx routing and
the proxied API were all built and exercised locally (Phase 16, §22.8).

---

## Backup and restore

Nightly `pg_dump` plus an attachment archive, run by host cron — not by the
application, because a backup that only runs while the app is healthy is not a
backup (`docs/05-infrastructure.md` §4).

```bash
0 2 * * *  /opt/asset-management/deploy/backup.sh >> /var/log/asset-backup.log 2>&1
```

Retention is 14 daily + 4 weekly. Set `RCLONE_REMOTE` to replicate off the VPS:
file storage and the database live on the same disk, so one failure otherwise
destroys the data, its backups and every attachment together.

Restoring stops the app, reloads the dump, optionally restores attachments, and
verifies `/api/health`:

```bash
./deploy/restore.sh /var/backups/asset-management/daily/db-20260813-020000.sql.gz \
                    /var/backups/asset-management/daily/storage-20260813-020000.tar.gz
```

---

## Known limitations

Each is a deliberate, recorded decision rather than an oversight; the full
disposition is in `IMPLEMENTATION_PLAN.md` §39.

| Area         | Limitation                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attributes   | A `SELECTION` attribute has no stored option list, so it behaves as free text. The data model has nowhere to put one (`GAP-001`).                                   |
| Accounts     | No password change or reset. Unspecified throughout; an administrator sets the initial password (`GAP-004`).                                                        |
| Floor plans  | Areas are redrawn rather than edited vertex by vertex (`GAP-005`).                                                                                                  |
| Asset units  | No endpoint lists units globally, so pickers find a unit through its asset (`GAP-008`).                                                                             |
| Transactions | Nothing marks a transaction type as procurement-originated, so supplier and contract are always offered (`GAP-009`).                                                |
| Borrowings   | An extension creates a new record; nothing links it to the one it continued (`GAP-010`). No date filters on the list — the borrowing _report_ has them (`GAP-011`). |
| Audit        | `audit-log:read` is effectively system-wide: the table has no institution and no join path to one (`DEC-050`).                                                      |
| Dashboard    | Has no specification; it shows only what the report endpoints already answer (`GAP-012`).                                                                           |
| Reports      | Export is client-side CSV of the rows on screen, not a server-side export of the full result set (`DEC-052`).                                                       |
| Frontend     | Reference selectors load at most 100 rows. Adequate for the current data; revisit if a list outgrows it.                                                            |
