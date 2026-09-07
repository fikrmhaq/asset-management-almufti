# Handover Sheet — Asset Management System

For the institution's server manager. Everything the system needs, everything it
exposes, and the values we need back from you before installation.

The installation runbook itself is `README.md`.

---

## 1. What this is

A web application for institutional asset management, running entirely on one
server on your network. Four containers:

| Container | Image | Role |
| --- | --- | --- |
| `api` | `asset-management/api` | Express API and the scheduled-job worker, in one Node process |
| `web` | `asset-management/web` | Nginx serving the built React application |
| `postgres` | `postgres:16-alpine` | The database |
| `redis` | `redis:7-alpine` | Sessions and the job queue |

**No external dependencies at run time.** No SMTP, no LDAP or Active Directory,
no cloud storage, no third-party API, no CDN or web fonts. Once the images are
loaded, the server does not need internet access to run the system.

---

## 2. What the server needs

| | |
| --- | --- |
| OS | Linux with Docker Engine 24+ and Compose v2 (Ubuntu 22.04 / 24.04 LTS assumed) |
| Host packages | `docker`, `docker compose`, `nginx`, `cron`, `openssl`, `rsync` |
| Not needed on the host | Node.js, PostgreSQL, Redis — all containerised |
| CPU / RAM | 2 vCPU, 4 GB (15–50 users) |
| Disk | 40 GB to start; attachments drive growth |
| Time | NTP against any reachable source |

---

## 3. Network exposure

Only **80** and **443** are reachable from the network. 80 exists solely to
redirect to 443.

- The web container publishes to `127.0.0.1` only; Nginx in front of it is the
  single entry point.
- **PostgreSQL (5432) and Redis (6379) are not published at all** — they are
  reachable only on the internal Docker network. This is a requirement of the
  system's security design, not a default we can relax. If you need database
  access for tooling or reporting, the answer is an SSH tunnel from an
  administrator's machine, not an opened port.

Outbound: none required. If your policy blocks outbound entirely, that is fine
— we deliver the container images as a file rather than pulling them.

---

## 4. HTTPS is required, including on the LAN

This is the one item worth reading twice.

The application's session cookie is marked `Secure`, so browsers refuse to store
it over plain HTTP. Served over HTTP the system fails in a way that looks like a
bug rather than a configuration problem: **users can log in, and are then thrown
back to the login screen on every page refresh.**

You do **not** need a public domain or a public certificate authority. Either of
these works:

1. **Your internal CA**, if you run one (AD Certificate Services, for example).
   Preferred — the client machines already trust it, so there is no browser
   warning and nothing to install.
2. **A self-signed certificate**, which our `scripts/make-cert.sh` generates in
   seconds. It covers both the hostname and the IP. Client machines should then
   have the certificate installed into their Trusted Root store, ideally by GPO.

Without the trust-store step the system still works correctly — users dismiss a
certificate warning once per browser — but we would rather not teach staff to
click past those.

---

## 5. What persists, and what must be backed up

Three things. Everything else in the containers is disposable and rebuilt on
redeploy.

| State | Location | If it is lost |
| --- | --- | --- |
| Database | Docker volume `postgres-data` | Everything |
| Sessions | Docker volume `redis-data` | All users signed out; no data loss |
| Attachments | Host directory, bind-mounted (e.g. `/srv/asset-management/storage`) | Every uploaded document |

A nightly cron job at 02:00 dumps the database and archives the attachments,
keeping 14 daily and 4 weekly copies.

**The database, its backups and the attachments are on the same disk.** One disk
failure destroys all three at the same moment, so the nightly copy must be
written somewhere else — a second disk, a NAS mount, or another machine over
rsync. Please nominate a target.

---

## 6. Values we need from you

| # | Item | Value |
| --- | --- | --- |
| 1 | Hostname for the application (e.g. `assets.example.local`) | |
| 2 | Can internal DNS hold that record? If not, we distribute `hosts` entries | |
| 3 | Server IP (static or DHCP reservation) | |
| 4 | Ports 80 and 443 available on this host? | |
| 5 | Do you have an internal CA, or should we self-sign? | |
| 6 | How will the certificate reach client machines (GPO / manual)? | |
| 7 | Directory for attachments | |
| 8 | Directory for backups | |
| 9 | Off-box backup target (NAS path or rsync destination) | |
| 10 | Who holds the database password and signing secrets? | |
| 11 | Who will be present for the interactive first-user step? | |
| 12 | How do the container images reach the server (USB / scp / share)? | |
| 13 | NTP source reachable from this host? | |

---

## 7. Operational notes

**Installation is roughly 30 minutes**, plus certificate distribution to client
machines. One step — creating the first administrator account — is interactive
and needs someone at a terminal; the password is typed at a prompt and is never
passed as an argument or an environment variable.

**Health endpoint:** `https://<host>/api/health`. Unauthenticated, reports the
database and Redis separately. Point your existing monitoring at it.

**Logs:** `docker compose logs api`, structured JSON. Application audit history
is separate and lives in the database, visible in the UI.

**Restarting** is safe at any time; the containers are set to restart
automatically with the host.

**Upgrades** arrive as a new image file plus a database migration step. We will
provide the exact commands with each release.

---

## 8. Limitations worth knowing now

Not defects — recorded decisions in the system's design — but each has an
operational consequence for you or your helpdesk:

- **No password reset or self-service password change.** A user who forgets
  their password needs an administrator to set a new one. If your helpdesk
  expects self-service reset, tell us now.
- **Audit log visibility is system-wide** for anyone granted the audit-read
  permission — it is not scoped per institution. Grant it deliberately.
- **Report export is client-side CSV** of the rows currently on screen, not a
  server-side export of a full result set.
- **Attachments are capped at 10 MB** per file, types limited to PDF, JPG, PNG,
  DOCX and XLSX. Both are configurable; raising the size also needs an Nginx
  change, which we would make together.

---

## 9. What we have not been able to test

The application, its containers, database migrations and reference-data seeding
have all been exercised. The **on-premises install itself has not** — there is no
server, hostname or certificate in our development environment, so the Nginx
configuration and the certificate script are written from specification and
reviewed rather than run end to end.

We expect the first install to need one or two adjustments, and the runbook has
a verification step specifically to catch them before users are let in.
