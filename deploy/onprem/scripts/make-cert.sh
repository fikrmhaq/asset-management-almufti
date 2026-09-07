#!/usr/bin/env bash
#
# Issues the TLS certificate for a deployment with NO PUBLIC DOMAIN.
#
#   sudo ./scripts/make-cert.sh assets.example.local 192.168.1.50
#
# TLS is not optional here even on a private network. The refresh cookie is set
# `Secure` in production, and browsers silently drop a `Secure` cookie on a
# plain http:// origin — login appears to work, then every page reload returns
# the user to the login screen, with nothing useful in any log.
#
# If the institution already runs an internal CA (AD Certificate Services, for
# instance), request the certificate from it instead and skip this script. A CA
# the machines already trust means no browser warning and nothing to install.

set -euo pipefail

HOSTNAME_ARG="${1:-}"
IP_ARG="${2:-}"
OUT_DIR="${OUT_DIR:-/srv/asset-management/certs}"
DAYS="${DAYS:-825}"

if [[ -z "$HOSTNAME_ARG" ]]; then
  echo "usage: $0 <hostname> [ip-address]" >&2
  echo "example: $0 assets.example.local 192.168.1.50" >&2
  exit 64
fi

# Both names go in the SAN. The hostname is what users type and what the
# certificate is really for; the IP is a fallback for machines that cannot
# resolve the name yet. A certificate without an IP SAN fails with
# ERR_CERT_COMMON_NAME_INVALID the first time someone types the address.
san="DNS:$HOSTNAME_ARG"
if [[ -n "$IP_ARG" ]]; then
  san="$san,IP:$IP_ARG"
fi

mkdir -p "$OUT_DIR"

echo "==> issuing a $DAYS-day certificate for $san"
openssl req -x509 -nodes -newkey rsa:2048 -days "$DAYS" \
  -keyout "$OUT_DIR/server.key" \
  -out "$OUT_DIR/server.crt" \
  -subj "/CN=$HOSTNAME_ARG" \
  -addext "subjectAltName=$san" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

chmod 600 "$OUT_DIR/server.key"
chmod 644 "$OUT_DIR/server.crt"

expiry="$(openssl x509 -in "$OUT_DIR/server.crt" -noout -enddate | cut -d= -f2)"

cat <<SUMMARY

Certificate: $OUT_DIR/server.crt
Private key: $OUT_DIR/server.key
Expires:     $expiry

PUT THAT DATE IN A CALENDAR. An expired self-signed certificate looks exactly
like a broken server to everyone who uses it.

Next:

  Host Nginx (nginx/site.conf) — copy them where that file expects:
    sudo cp $OUT_DIR/server.crt /etc/ssl/certs/asset-management.crt
    sudo cp $OUT_DIR/server.key /etc/ssl/private/asset-management.key

  TLS container (docker-compose.tls.yml) — set CERT_DIR=$OUT_DIR in .env.

Then install server.crt on the client machines, into the Trusted Root store
(by GPO on Windows, or by hand on each). Users can click through the warning
without it and the app still works correctly — HTTPS is HTTPS — but training
staff to dismiss certificate warnings is a bad habit to hand them along with
the asset registry.

Do NOT enable HSTS in the Nginx config until that installation is done: with an
untrusted certificate, HSTS removes the browser's "Proceed anyway" option and
hard-blocks the site with no way through.
SUMMARY
