#!/usr/bin/env bash
# Run on a disposable Ubuntu release runner with Docker, systemd and free ports 80/443.
set -euo pipefail
umask 022
root=$(mktemp -d /opt/pipi-install-check-XXXXXXXX)
git -c safe.directory="$PWD" archive HEAD | tar --no-same-permissions -x -C "$root"
cd "$root"

# Use a local certificate authority. Leave the installer and all Compose files intact.
cat >deploy/Caddyfile <<'CADDY'
{
  admin off
  default_sni 127.0.0.1
}
https://127.0.0.1 {
  tls internal
  reverse_proxy pipi-phone:8000
}
CADDY
export PIPI_PUBLIC_IP=127.0.0.1 PIPI_ACME_DIRECTORY=https://localhost/test
export CURL_CA_BUNDLE="$root/test-ca.crt"
python3 scripts/install-https.py &
installer=$!
while kill -0 "$installer" 2>/dev/null; do
  proxy=$(docker compose -f compose.yaml -f compose.https.yaml ps -q pipi-https 2>/dev/null || true)
  if [[ -n "$proxy" ]] && docker cp "$proxy:/data/caddy/pki/authorities/local/root.crt" "$CURL_CA_BUNDLE" 2>/dev/null; then
    break
  fi
  sleep 1
done
wait "$installer"

# Ask the same authenticated endpoint the About page uses, through the HTTPS proxy.
origin=https://127.0.0.1
password=$(openssl rand -hex 20)
curl -fsS -c "$root/test.cookies" -H "Origin: $origin" -H 'Content-Type: application/json' \
  -d "{\"displayName\":\"Install check\",\"password\":\"$password\"}" "$origin/api/setup" >/dev/null
curl -fsS -b "$root/test.cookies" "$origin/api/updates/status" |
  python3 -c 'import json,sys; result=json.load(sys.stdin); assert result["workerAvailable"] and result["canUpdate"], result'
