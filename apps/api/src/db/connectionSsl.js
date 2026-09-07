'use strict';

/**
 * TLS for the database connection, derived from the connection string.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `pg` reads `sslmode` out of the connection string. **Sequelize does not.** It
 * parses the URL itself and builds its own client options, and anything it does
 * not recognise — `sslmode`, `channel_binding` — is dropped on the way through.
 *
 * The result is a connection string that works with `pg` directly and fails
 * under Sequelize with `connection is insecure (try using sslmode=require)`,
 * which names the parameter that IS already there. That message sends you
 * looking at the URL, which is the one place the problem is not.
 *
 * So the mode is read here and turned into the `dialectOptions.ssl` Sequelize
 * actually consumes. Both consumers use it: `src/db/sequelize.js` for the
 * running application and `config/sequelize.js` for the migration CLI, because a
 * deployment where migrations connect and the app does not is worse than one
 * where neither does.
 *
 * ── Why it is opt-in ───────────────────────────────────────────────────────
 *
 * Absent `sslmode`, this contributes nothing. The development and test databases
 * are a container on the same host (`docker-compose.dev.yml`) with no TLS at
 * all, and forcing it there would break every local run and the whole database
 * suite to accommodate a managed provider.
 *
 * A hosted Postgres — Neon, Supabase, RDS — puts `sslmode=require` in the string
 * it hands you, so the opt-in happens by pasting the URL, with nothing extra to
 * remember and nothing to set in an environment that does not need it.
 *
 * ── Why the certificate is verified ────────────────────────────────────────
 *
 * `rejectUnauthorized: true`, not the `false` that appears in most hosted-
 * Postgres snippets. `false` accepts ANY certificate, which is encryption
 * without authentication — it stops passive eavesdropping and does nothing about
 * an interception, while looking exactly as secure in the logs.
 *
 * Managed providers present certificates chaining to a public CA, so the honest
 * setting works. `05-infrastructure.md` §12.1 requires TLS on every hop; a
 * connection nobody can verify does not satisfy it.
 *
 * `pg` 8.16 aligned `sslmode=require` with libpq and now treats it as
 * `verify-full`, which is the same position arrived at from the other side.
 */

/** Modes that mean "encrypt this connection". */
const TLS_MODES = Object.freeze(['require', 'verify-ca', 'verify-full']);

/**
 * `dialectOptions` for a connection string, or `{}` when it asks for no TLS.
 *
 * @param {string|undefined} url
 * @returns {{ssl?: {require: true, rejectUnauthorized: boolean}}}
 */
function sslDialectOptions(url) {
  const mode = /[?&]sslmode=([a-z-]+)/i.exec(String(url ?? ''))?.[1]?.toLowerCase();

  if (!mode || !TLS_MODES.includes(mode)) return {};

  return { ssl: { require: true, rejectUnauthorized: true } };
}

module.exports = { TLS_MODES, sslDialectOptions };
