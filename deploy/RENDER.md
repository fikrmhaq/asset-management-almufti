# Free-tier deployment — Render, Neon and Upstash

A demonstration and UAT environment for 10–15 users, on free tiers only, with no
card required.

This is **not** the production topology. `05-infrastructure.md` §2 describes a
single VPS running `docker-compose.prod.yml` behind Nginx, and that remains what
this system is built for. The two are configured from the same environment
variables, so the application does not know which one it is running on.

| Piece    | Service                     | Free tier                                        |
| -------- | --------------------------- | ------------------------------------------------ |
| API      | Render Web Service (Docker) | 512 MB, sleeps after 15 min idle                 |
| Web      | Render Static Site          | Does not sleep, no request limit                 |
| Postgres | Neon                        | 0.5 GB, always on, **not** deleted after 30 days |
| Redis    | Upstash                     | 10,000 commands/day                              |
| Manual   | Vercel                      | already deployed, separate repository            |

**Why not Render's own Postgres:** its free database is **deleted after 30
days**. Neon's is not. That single fact is what decides the shape of this
deployment.

**Why not Railway:** it is simpler — everything in one project, nothing sleeps —
but it is $5 of credit per month, which four always-on services exhaust in
10–20 days. Good for a demonstration week, wrong for something left running.

## Is it actually free?

Render shows _"All future updates to your Blueprint file will be synced
automatically, which may change your costs"_ on every blueprint. It is a generic
warning about the mechanism, not a reading of this file: a blueprint **can**
declare paid plans, so Render says so before you let one auto-sync.

This one declares `plan: free` on the API, and static sites carry no plan
because they are free. Nothing here bills.

The one number worth knowing: Render's free tier allows **750 instance-hours per
month**, shared across all free web services on the account. A month is ~730
hours, so **one** always-on free service fits with a little headroom — which is
exactly what this blueprint declares. Add a second free web service and keeping
both awake will not fit.

That interacts with the keep-alive in step 7. Pinging the API every 10 minutes
around the clock means it never sleeps and consumes ~730 hours. Still inside the
allowance, with nothing to spare. If you would rather keep the margin, ping only
during the hours you are demonstrating.

Static sites do not consume instance hours at all — only bandwidth, and 100 GB
is far beyond what 15 users browsing an internal tool will move.

> [!NOTE]
> Free-tier terms change. What is stated here was true when this was written;
> check <https://render.com/pricing> before assuming it still holds. Neither
> Neon nor Upstash requires a card for their free tiers either, and neither bills
> by surprise — they stop serving rather than start charging.

---

## Before you start

You need accounts on **Render**, **Neon** and **Upstash**. All three sign in with
GitHub or Google and none asks for a card.

`render.yaml` at the repository root is the blueprint. It declares both Render
services, generates the JWT secrets, and leaves exactly three values to be set by
hand — the two that belong to other providers, and the one URL that does not
exist until the first deploy.

> [!IMPORTANT]
> Render reads `render.yaml` from the repository it is connected to. The parent
> repository is on **GitLab**; Render supports GitLab, but you will be asked to
> authorise it the first time.

---

## 1. Postgres on Neon

1. Create a project. Choose the region closest to your users — **Singapore
   (ap-southeast-1)** for Indonesia.
2. Copy the connection string. It looks like:

```
postgresql://USER:PASSWORD@ep-something-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

**Keep `?sslmode=require`.** Neon refuses unencrypted connections. Keep
`&channel_binding=require` too if Neon included it — it is ignored by this stack
and harmless.

> [!NOTE]
> `pg` reads `sslmode` out of the URL; **Sequelize does not**. It parses the URL
> itself and drops what it does not recognise, so a hosted database refuses it
> with `connection is insecure (try using sslmode=require)` — naming a parameter
> the string already carries.
>
> `src/db/connectionSsl.js` restates it as the `dialectOptions.ssl` Sequelize
> consumes, for both the application and the migration CLI. Nothing to configure;
> it is derived from the connection string. A URL without `sslmode` — the local
> container — is unaffected.

Neon's free tier suspends compute after 5 minutes idle and wakes in well under a
second. That is not the same as Render's 50-second cold start and needs no
workaround.

---

## 2. Redis on Upstash

1. Create a database. Region: **Singapore** again.
2. Copy the connection string from the **Redis** tab — not the REST URL, which
   this application does not use.

```
rediss://default:PASSWORD@apn1-something-12345.upstash.io:6379
```

**`rediss://` — two s.** Upstash is TLS-only. This is worth checking rather than
assuming: with `redis://` the same URL fails, and `ioredis` reports
`Connection is closed.` — a socket error that says nothing about the scheme.

```bash
# Confirms the URL before it goes anywhere near Render.
REDIS_URL='rediss://…' node -e "
const R=require('ioredis');const r=new R(process.env.REDIS_URL,{lazyConnect:true});
r.connect().then(()=>r.ping()).then(p=>{console.log(p);r.disconnect();})
 .catch(e=>{console.log('FAIL',e.message);r.disconnect();});"
```

Redis holds sessions and the BullMQ queue (§6.2, §7.3). 10,000 commands/day is
comfortable for 15 users; the overdue sweep runs every 15 minutes and costs a
handful of commands each time.

---

## 3. Run the migrations

**Before the first deploy, from your own machine.**

`apps/api/Dockerfile` deliberately does not migrate on boot: §11.2 requires
migrations to run once as a deploy step, never as a side effect of application
start, because that races across replicas and makes a rollback ambiguous. Render's
`preDeployCommand` — the natural home for this — is a paid feature, and the free
tier has no shell.

So they run from your laptop, against a database that is publicly reachable:

```bash
DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' npm run db:migrate
```

Then the reference data — the classification catalogue, the permission catalog
and the System Admin role. Every seeder is idempotent and safe to re-run
(§10.3):

```bash
DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' npm run db:seed
```

Verify before going further:

```bash
DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' npm run db:migrate:status
```

Every migration through `048-alter-longitudinal-history-entry-type` should read
`up`.

> [!NOTE]
> Repeat the migrate step after any future deploy that adds one. Nothing on
> Render will do it for you.

---

## 4. Create the Render services

1. Render dashboard → **New** → **Blueprint**.
2. Connect the repository. Render finds `render.yaml` and offers two services.
3. It will ask for the values marked `sync: false`. Supply what you can now:

| Variable       | Value                          |
| -------------- | ------------------------------ |
| `DATABASE_URL` | the Neon string from step 1    |
| `REDIS_URL`    | the Upstash string from step 2 |
| `CORS_ORIGIN`  | leave blank for now — step 5   |

`VITE_API_BASE_URL` is not among them: the blueprint sets it to the relative
`/api/v1`, because the API is proxied onto the web origin (step 5).

4. Apply. The API builds from `apps/api/Dockerfile`; the first build takes
   several minutes because it installs the workspace and copies the 920 kB
   classification CSV.

**The API will not start until `CORS_ORIGIN` is set**, and the deploy will show
as failed. That is expected and correct: `CORS_ORIGIN` is required with no
default, and the config is fail-fast by design (§1.2) — a missing required
variable stops the container rather than starting it with a guess. The log names
the variable. Step 5 supplies it.

If you would rather see a green deploy first, set `CORS_ORIGIN` to the web URL
Render will assign — it is predictable from the service name,
`https://asset-management-web.onrender.com` — and correct it in step 5 if Render
picked something else because the name was taken.

---

## 5. Tell the API which origin the browser uses

One value, and the API starts.

1. Copy the web URL from **asset-management-web** — it deployed successfully, so
   it has one. `https://asset-management-web.onrender.com`.
2. On **asset-management-api** → Environment, set:

   ```
   CORS_ORIGIN = https://asset-management-web.onrender.com
   ```

   No trailing slash. A wildcard is refused by the config (§12.3). Save; Render
   restarts the API, and this time it starts.

There is no second step. `VITE_API_BASE_URL` is `/api/v1` — a **relative** path —
because the API is served on the web app's own origin. The next section is why.

### Why the API is proxied onto the web origin

`render.yaml` gives the static site a rewrite that forwards `/api/*` to the API
service, and the browser therefore only ever talks to one host.

That is not a convenience. **The session depends on it.**

The refresh token is an httpOnly cookie set `SameSite=Strict` (§6.1). A browser
returns such a cookie only when the API host is the **same site** as the page —
and `onrender.com` is on the Public Suffix List, which makes
`asset-management-web.onrender.com` and `asset-management-api.onrender.com`
different _sites_, not merely different origins.

Called directly, the refresh cookie would never be sent back. The symptom is
specific and misleading: **signing in works, and every page reload returns you to
the login screen.** The access token lives in memory and dies with the page; the
cookie that should restore it is silently withheld. Nothing logs an error worth
noticing — the server simply reports no refresh token, because it received none.

Proxying makes the two same-site, so `Strict` keeps working and the CSRF
protection §6.1 chose is preserved rather than traded away for
`SameSite=None`. It also removes cross-origin requests from the browser path
entirely.

> [!IMPORTANT]
> **The rewrite's destination is a literal hostname, and it is not the service
> name.** A blueprint cannot reference another service's URL, so it is written
> out — and Render appends a suffix when the plain name is already taken
> globally, which it was here: the service is `asset-management-api`, its
> hostname is `asset-management-api-10z4.onrender.com`.
>
> Read it off the top of the API's own page in the dashboard. Getting it wrong
> fails in a way that looks like a broken proxy: `/api/...` returns a bare
> `404 Not Found` while every other path still serves the app correctly —
> because the rewrite **is** matching and forwarding to a hostname with nothing
> behind it.
>
> **The wildcard is `*` in the destination, not `:splat`.** Render substitutes
> the whole string captured by `*` in the source. `:splat` is Netlify's spelling
> and Render forwards it verbatim, so the API answers
> `Cannot GET /api/:splat`.

Three failures, three distinct signatures — worth keeping, because they look
alike from the browser:

| `/api/health` returns                                               | Meaning                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `index.html` (200)                                                  | the rewrite is not matching — rule missing, or below the SPA catch-all    |
| bare `404 Not Found`                                                | rewrite matched, destination hostname has nothing behind it               |
| `{"error":{"code":"NOT_FOUND","message":"Cannot GET /api/:splat"}}` | rewrite matched and reached the API, but the wildcard was not substituted |

> The `/api/*` rule must stay **above** the SPA catch-all. Render matches routes
> top down, and `/*` matches API paths too — reversed, every API call is answered
> with `index.html` and fails as a JSON parse error a long way from its cause.

`CORS_ORIGIN` is still required: the config refuses to boot without it, and the
proxy forwards the browser's `Origin` header on writes.

---

## 6. Create the first user

The bootstrap command prompts for a password and never takes one from an
argument or an environment variable — both end up in shell history and process
listings (§10.3). Run it from your machine, against Neon:

```bash
DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' npm run bootstrap
```

It creates the user and assigns the seeded System Admin role. Sign in at the web
URL.

---

## 7. Keep the API awake

A free Render service stops after 15 minutes without a request and takes about
50 seconds to wake. For a demonstration, that first impression is the whole
impression.

Render's own cron jobs are paid, so use an external pinger. **cron-job.org** is
free and needs no card:

- URL: your API's own health endpoint, e.g.
  `https://asset-management-api-10z4.onrender.com/api/health`
- Every 10 minutes

`/api/health` is unauthenticated and checks both datastores (§8.2), so the ping
doubles as an uptime check. Turn it off when you are not demonstrating —
Upstash's daily command budget is finite, and a sleeping service costs nothing.

---

## What to expect, honestly

|                              |                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **First request after idle** | ~50 s. Every request after that is normal.                                                                                                                                           |
| **Uploaded attachments**     | **Lost on every restart, sleep or redeploy.** The free instance has no persistent disk; production gets one from a host bind mount (§5.2). Demonstrate uploads, do not rely on them. |
| **Database**                 | Survives everything. Neon does not expire it.                                                                                                                                        |
| **15 concurrent users**      | Fine. 512 MB and one Node process handle this comfortably; the rate limits in §12.3 are the binding constraint long before the instance is.                                          |
| **The worker**               | Runs in the API process, so it sleeps with it. The overdue sweep catches up on the next wake — the job is idempotent by design.                                                      |

---

## If something fails

**API exits at boot, log names a variable.** The config validates everything at
startup and reports every problem at once (§1.2). The name in the message is the
variable to fix. Most often it is `CORS_ORIGIN`, before step 5.

**`JWT_ACCESS_SECRET: must be at least 32 characters`.** Render's generated
values are normally long enough; if one is not, replace both by hand. They must
also differ from each other, which the config checks separately:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**`connection is insecure (try using sslmode=require)` — and the URL already has
it.** `sslmode` is present but Sequelize dropped it. `src/db/connectionSsl.js`
handles this; if you see it, that module is not being reached — check the URL
actually contains `sslmode=` (a shell can eat the `&` before it if the string is
unquoted).

**`SELF_SIGNED_CERT_IN_CHAIN` or another certificate error.** The certificate
does not chain to a public CA. Verification is deliberate (§12.1) — do not
disable it to make the error go away; find out whose certificate it is.

**Redis socket errors, or `ECONNRESET` on the queue.** `redis://` instead of
`rediss://`.

**Web loads, but every request fails with a CORS message.** `CORS_ORIGIN` does
not match the web origin exactly — check for a trailing slash, or `http` where
the browser used `https`.

**Signing in works, but every page reload returns to the login screen.** The
refresh cookie is not reaching the API. It is `SameSite=Strict`, so the API must
be on the **same site** as the page — check that the `/api/*` rewrite is present,
is listed **above** the SPA catch-all, and names the API's real hostname. If the
bundle is calling the API's own domain directly, this is exactly what happens.

The same thing bites in local development whenever `apps/web/.env` points
`VITE_API_BASE_URL` at one host — a LAN IP, say — while you browse on another,
such as `localhost`. Use one host for both, or nothing will hold a session across
a reload.

**Requests return HTML instead of JSON, failing as a parse error.** The SPA
catch-all is matching `/api/...`. The `/api/*` rewrite must come first.

**Health check fails but the log looks clean.** The API is reaching Postgres and
Redis but one of them is refusing — `/api/health` reports each dependency
separately, so open the URL directly and read which one is `down`.

---

## Without Docker

The same split, if you would rather not build an image: **Vercel** for the web
SPA, Neon and Upstash unchanged, and the API on Render as a **Node** service
rather than a Docker one:

- Build: `npm ci --workspace apps/api --include-workspace-root`
- Start: `node apps/api/src/server.js`

Everything else in this guide applies unchanged. The Docker path is preferred
only because it is the same image production runs, so a problem found here is a
problem found in the real artefact.
