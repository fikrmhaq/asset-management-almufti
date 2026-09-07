# On-Premises Deployment

Everything needed to run the Asset Management System on one server inside an
institution's own network — **no public domain, no internet access required at
run time.**

This package is self-contained. The server never needs the source tree, a Git
checkout, Node.js, or a container registry.

| File | What it is |
| --- | --- |
| `docker-compose.prod.yml` | The four services. Postgres and Redis are never published to the network |
| `.env.example` | Every configuration value, with the reasoning. Copy to `.env` |
| `nginx/site.conf` | Host Nginx: TLS termination for a LAN hostname |
| `docker-compose.tls.yml` | Optional alternative — TLS in a container instead of on the host |
| `nginx/tls.conf` | Config for that container |
| `scripts/build-images.sh` / `.ps1` | Run on a machine with the source. Produces one image tarball |
| `scripts/load-images.sh` | Run on the server. Loads that tarball |
| `scripts/make-cert.sh` | Issues the TLS certificate. No public CA involved |
| `scripts/backup.sh` | Nightly database + attachment backup, for host cron |
| `scripts/restore.sh` | The restore path, written down so it can be rehearsed |

`HANDOVER.md` is the sheet to give the institution's server manager: what the
server needs, what they must decide, and what to expect operationally.

---

## Read this first: HTTPS is required, even on a private network

There is no way around it, and it is not a preference.

The refresh-token cookie is set `Secure` whenever `NODE_ENV=production`
(`apps/api/src/routes/v1/auth.js`), and this compose file sets that. Browsers
**silently drop** a `Secure` cookie on a plain `http://` origin. Over HTTP the
system fails like this:

> Login succeeds. The dashboard loads. The user presses F5 — and lands back on
> the login screen. Nothing errors. The server reports "no refresh token",
> because it received none.

Every user hits this within a minute of first use. `scripts/make-cert.sh` issues
a certificate locally in about two seconds, so this costs nothing to get right.

You do **not** need a public domain, a public DNS record, or Let's Encrypt.

---

## What the server needs

| | |
| --- | --- |
| OS | Any Linux with Docker Engine 24+ and Compose v2. Ubuntu 22.04 / 24.04 LTS assumed |
| Host packages | `docker`, `docker compose`, `nginx`, `cron`, `openssl`, `rsync`. No Node, no Postgres, no Redis on the host |
| CPU / RAM | 2 vCPU, 4 GB. Comfortable for 15–50 concurrent users |
| Disk | 40 GB to start. The database is small; attachments are what grow |
| Network | Inbound 80 and 443 only. No outbound access needed once the images are loaded |
| Clock | NTP against any reachable source. Audit timestamps and the overdue sweep both depend on it |

If the server runs Windows, use the containerised TLS front (last section) —
`nginx/site.conf` assumes a Linux host.

---

## Before you start

Decide these six things. `HANDOVER.md` is the form to collect them.

1. **Hostname** — e.g. `assets.almufti.local`. Held by internal DNS, or by a
   `hosts` entry on each client machine. Use a name rather than a bare IP: the
   IP can then change without breaking every bookmark and the certificate.
2. **Server IP** — static, or a DHCP reservation.
3. **Attachment directory** — e.g. `/srv/asset-management/storage`.
4. **Backup directory**, and where the nightly copy goes — a second disk, a NAS
   mount, or another machine over rsync.
5. **Database password** and **two JWT secrets** — generated at install time,
   stored in the institution's password manager.
6. **Who runs the first-user step** — it is interactive, and someone must be at
   a terminal for it.

---

## Install

### 1. Build the images (on a machine with the source, not the server)

```bash
./scripts/build-images.sh
```

On Windows:

```powershell
.\scripts\build-images.ps1
```

This produces `images/asset-management-1.0.0.tar.gz` — roughly 300–500 MB,
containing all four images including `postgres:16-alpine` and `redis:7-alpine`.
The base images matter: a server with no internet cannot pull them, and
`up -d` is where you would discover that.

**The tarball is git-ignored on purpose.** GitHub rejects any file over 100 MB.
Move it to the server by USB, `scp` or a file share — not through the
repository.

### 2. Prepare the server

```bash
sudo mkdir -p /opt/asset-management /srv/asset-management/storage /var/backups/asset-management
```

```bash
sudo chown -R 1000:1000 /srv/asset-management/storage
```

That ownership is load-bearing. The bind mount **hides** the ownership the image
sets, so without it every upload fails with `EACCES` — the container runs as the
unprivileged `node` user, uid 1000.

Copy this package to `/opt/asset-management`, and the image tarball with it.

### 3. Load the images

```bash
./scripts/load-images.sh images/asset-management-1.0.0.tar.gz
```

Never run `docker compose pull` on this deployment. There is no registry behind
these tags, and the pull will fail.

### 4. Issue the certificate

```bash
sudo ./scripts/make-cert.sh assets.almufti.local 192.168.1.50
```

Both the hostname and the IP go into the certificate's SAN. Note the expiry the
script prints and put it in a calendar — an expired self-signed certificate is
indistinguishable from a broken server to everyone who uses it.

If the institution already runs an internal CA, request the certificate from it
instead and skip this step. A CA the machines already trust means no browser
warning at all.

### 5. Configure

```bash
cp .env.example .env && chmod 600 .env
```

Generate the three secrets — run this three times, once for
`POSTGRES_PASSWORD` and once for each JWT secret:

```bash
openssl rand -base64 36 | tr -d '\n'; echo
```

The two JWT secrets **must differ**. The API refuses to start if they match,
because a shared secret would let a refresh token be presented as an access
token.

Then edit `.env`. The values that must change from the template:

```
POSTGRES_PASSWORD=<generated>
DATABASE_URL=postgres://asset_app:<the same value>@postgres:5432/asset_management
JWT_ACCESS_SECRET=<generated>
JWT_REFRESH_SECRET=<a different generated value>
CORS_ORIGIN=https://assets.almufti.local
STORAGE_DIR=/srv/asset-management/storage
BACKUP_DIR=/var/backups/asset-management
BACKUP_MIRROR_DIR=/mnt/nas/asset-management
```

`CORS_ORIGIN` is the exact origin browsers use — `https`, the hostname, and the
port if it is not 443. No trailing slash.

### 6. Set up Nginx

```bash
sudo cp nginx/site.conf /etc/nginx/sites-available/asset-management
```

Replace the placeholder hostname, then enable the site:

```bash
sudo sed -i "s/assets.example.local/assets.almufti.local/g" /etc/nginx/sites-available/asset-management
```

```bash
sudo ln -sf /etc/nginx/sites-available/asset-management /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default
```

```bash
sudo cp /srv/asset-management/certs/server.crt /etc/ssl/certs/asset-management.crt && sudo cp /srv/asset-management/certs/server.key /etc/ssl/private/asset-management.key
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Migrate, seed, and create the first user

In this order. Migrations run as their own step, before anything serves traffic
— never from application boot.

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run db:migrate --workspace apps/api
```

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run db:seed --workspace apps/api
```

Seeding loads the 14,738-row classification catalogue, the permission catalogue,
and the System Admin role. Every seeder is idempotent and safe to re-run.

```bash
docker compose -f docker-compose.prod.yml run --rm -it api npm run bootstrap --workspace apps/api
```

**This one is interactive.** It prompts for the first administrator's username
and password, and never accepts a password from an argument or an environment
variable — both end up in shell history and process listings. No user is ever
seeded, because a default password nobody changes is a real risk.

### 8. Start

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 9. Verify

```bash
curl -k https://assets.almufti.local/api/health
```

Expect `"status":"ok"` with `postgres` and `redis` both `up`. Then open the app
in a browser, sign in as the bootstrap user, and — this is the check that
matters — **press F5.** Staying signed in means TLS and the cookie path are
correct. Being returned to the login screen means the browser is not keeping the
refresh cookie; see Troubleshooting.

### 10. Schedule backups

```bash
sudo crontab -e
```

Add:

```
0 2 * * *  /opt/asset-management/scripts/backup.sh >> /var/log/asset-backup.log 2>&1
```

Then **rehearse a restore** on the server before go-live:

```bash
./scripts/restore.sh /var/backups/asset-management/daily/db-<timestamp>.sql.gz
```

A backup procedure that has never been restored is a hypothesis.

### 11. Prepare the client machines

- Add the hostname to internal DNS, or a `hosts` entry on each machine:
  `192.168.1.50  assets.almufti.local`
- Install `server.crt` into the Trusted Root store — by GPO on Windows, or by
  hand on each machine.

The app works without that installation: users click through the browser warning
once per browser, HTTPS still applies, and the session behaves correctly. But
training staff to dismiss certificate warnings is a bad habit to hand them along
with the asset registry.

**Do not enable HSTS in the Nginx config until the certificate is installed.**
With an untrusted certificate, HSTS removes the browser's "Proceed anyway"
option and hard-blocks the site, and clearing that state means editing
`chrome://net-internals` on every machine.

---

## Day-to-day operations

**Logs**

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

**Health** — `https://<host>/api/health`, unauthenticated, reports Postgres and
Redis separately. Point any existing monitoring at it.

**Restart**

```bash
docker compose -f docker-compose.prod.yml restart api
```

**Database shell**

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U asset_app -d asset_management
```

Postgres is deliberately not published to the network (§12.2). For a GUI client,
reach it over an SSH tunnel from the admin's own machine rather than adding a
`ports:` entry to the compose file.

**Upgrading to a new version** — take a backup first, then:

```bash
./scripts/load-images.sh images/asset-management-1.1.0.tar.gz
```

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run db:migrate --workspace apps/api
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

Set `API_IMAGE` and `WEB_IMAGE` in `.env` to the new tags first.

---

## Troubleshooting

**The API container exits immediately.** The configuration is validated at boot
and every problem is reported at once. `docker compose logs api` names the
variable. Most often it is `CORS_ORIGIN`, or the two JWT secrets being equal.

**Login works, every page reload returns to the login screen.** The refresh
cookie is not reaching the API. In order of likelihood: the site is served over
`http://` rather than `https://`; `CORS_ORIGIN` does not exactly match the
origin in the address bar (trailing slash, missing port, `http` vs `https`);
users reach the app by IP while the certificate and `CORS_ORIGIN` name the
hostname, or the reverse.

**Every upload fails.** The attachment directory is not owned by uid 1000:
`sudo chown -R 1000:1000 /srv/asset-management/storage`.

**Uploads fail only for large files.** `MAX_UPLOAD_SIZE_MB` was raised above 10
without raising `client_max_body_size` in the Nginx config, which is set to
`12m`.

**`docker compose up` cannot find an image.** The tarball was not loaded, or
only the two application images were carried over and the base images are
missing. Re-run `scripts/load-images.sh`.

**Browser shows a certificate warning.** Expected until `server.crt` is
installed in the trust store. If it appears suddenly on machines that were fine,
check the certificate expiry.

**Backups stopped silently.** Check `/var/log/asset-backup.log`. The usual cause
is a NAS mount that dropped — a missing `BACKUP_MIRROR_DIR` is reported as an
error rather than skipped, precisely because it looks identical to a working
setup until you need the backup.

---

## Optional: TLS in a container instead of host Nginx

`05-infrastructure.md` §2 puts Nginx on the host, and that is what step 6 does.
This overlay is an alternative for a Windows host, or for an admin who would
rather have one lifecycle for the whole stack. It is a documented deviation from
the specified topology, not a replacement for it — functionally the two are
equivalent, and you must choose one, since they would fight over ports 80 and
443.

Set `CERT_DIR=/srv/asset-management/certs` in `.env`, skip step 6, and start
with both files:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

---

## Not verified in this repository

The images, the compose stack, the migration and seed steps, and the proxied API
were all built and exercised locally. **An actual on-premises install has not
been performed** — there is no server, hostname or certificate in the
development environment, so `nginx/site.conf`, `nginx/tls.conf` and the
certificate script are written from the specification and reviewed, not run end
to end. Expect to iterate on the first install, and follow step 9 closely.
