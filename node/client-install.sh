#!/bin/bash
# Hosts clearcast on this node for people who won't run their own (ADR 003).
# setup.sh copies this to /usr/local/sbin/fc-client-install; run it with
# `fc-node client`. Safe to run again: it updates clearcast and restarts it.
#
#   fc-node client               set up or update, at https://clearcast.<ip with dashes>.sslip.io
#                                (or the domain you set before)
#   fc-node client <domain>      use your own domain; point its A record at this server first
#   fc-node client sslip         go back to the sslip.io address
#   fc-node client off           stop hosting it
#
# What it sets up:
#   - /usr/local/lib/fc-clearcast/     a checkout of create-fc and the client's dependencies
#   - /var/lib/fc-clearcast/           network stats it measures (nothing about people)
#   - the fc-clearcast container       Node 22, host network, read-only, listening on
#                                      127.0.0.1:4748 only, running `clearcast serve`
#   - a site in fc-images' Caddy       https for that address, proxied to 127.0.0.1:4748
#
# People sign in by approving on their phone, vouched for by this node's app
# account (fc-node app-account). Their keys stay in their browsers; this server
# never holds them. Who may sign in: fc-node signin [open|invite].
set -euo pipefail

REPO="${FC_REPO:-https://github.com/eucalyptus-viminalis/create-fc}"
BRANCH="${FC_BRANCH:-main}"
LIB=/usr/local/lib/fc-clearcast
STATE=/var/lib/fc-clearcast
SITES=/var/lib/fc-companion/caddy-sites
PORT=4748

reload_caddy() {
  docker exec fc-images caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
    || { echo "couldn't reload Caddy. Logs: docker logs fc-images"; return 1; }
}

case "${1:-}" in
  off)
    docker rm -f fc-clearcast >/dev/null 2>&1 || true
    rm -f "$SITES/clearcast.caddy" "$STATE/url"
    reload_caddy || true
    echo "clearcast is no longer hosted here. Signed-in people's keys stay in their browsers."
    exit 0 ;;
  sslip) rm -f "$STATE/domain" ;;
  "") ;;
  *)
    domain=$(echo "$1" | tr 'A-Z' 'a-z')
    [[ "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || { echo "\"$1\" isn't a domain name, e.g. clearcast.example.com"; exit 1; } ;;
esac

# Hosting needs the companion: phone sign-in and Caddy both live there.
curl -s -m 3 localhost:3390/v1/companion >/dev/null || { echo "fc-companion isn't running. Re-run command 1 first."; exit 1; }
mkdir -p "$STATE" "$SITES"
chown 1000:1000 "$STATE"

ip=$(curl -s -m 3 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || true)
[ -n "$ip" ] || ip=$(hostname -I | awk '{print $1}')
if [ -n "${domain:-}" ]; then
  # Caddy can only get a certificate once the name points here.
  if ! getent ahostsv4 "$domain" | awk '{print $1}' | grep -qx "$ip"; then
    echo "$domain doesn't point at this server ($ip) yet."
    echo "Add an A record for it with your DNS provider, wait a few minutes, then run this again."
    exit 1
  fi
  echo "$domain" > "$STATE/domain"
fi
host=$(cat "$STATE/domain" 2>/dev/null || echo "clearcast.${ip//./-}.sslip.io")
origin="https://$host"

# ---------------------------------------------------------------- the code
command -v git >/dev/null || { apt-get update -q && apt-get install -y -q git; }
if [ -d "$LIB/.git" ]; then
  git -C "$LIB" fetch -q --depth 1 origin "$BRANCH"
  git -C "$LIB" reset -q --hard FETCH_HEAD
else
  rm -rf "$LIB"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$LIB"
fi
# Its dependencies, pinned by the lockfile. Reinstalled only when it changes.
want=$(sha256sum "$LIB/client/pnpm-lock.yaml" | cut -d' ' -f1)
if [ "$(cat "$STATE/.lock-sha" 2>/dev/null)" != "$want" ]; then
  echo "fc-clearcast: installing its dependencies..."
  docker run --rm -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 -v "$LIB:/app" -w /app/client node:22-alpine \
    sh -c "corepack enable && pnpm install --prod --frozen-lockfile --reporter=silent" >/dev/null
  echo "$want" > "$STATE/.lock-sha"
fi

# ---------------------------------------------------------------- the service
# Host network so it reaches Snapchain (3381) and the companion (3390) on
# 127.0.0.1; it listens on 127.0.0.1:4748, so only Caddy can reach it.
docker rm -f fc-clearcast >/dev/null 2>&1 || true
docker run -d --name fc-clearcast --restart unless-stopped --network host \
  --read-only --user node --memory 384m \
  -e FC_NODE=http://127.0.0.1:3381 -e FC_COMPANION=http://127.0.0.1:3390 -e FC_HOME=/state \
  -v "$LIB:/app:ro" -v "$STATE:/state" \
  node:22-alpine node /app/client/src/cli.ts serve --origin "$origin" --port "$PORT" >/dev/null

# ---------------------------------------------------------------- https
# fc-images' Caddy imports every site in $SITES (companion-install.sh). An
# older fc-images doesn't: reinstalling the companion brings the import.
if ! docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' fc-images 2>/dev/null | grep -q /etc/caddy/sites; then
  echo "updating fc-images so it can serve clearcast..."
  fc-companion-install >/dev/null
fi
cat > "$SITES/clearcast.caddy" <<CADDY
$host {
	reverse_proxy 127.0.0.1:$PORT
	header Strict-Transport-Security "max-age=31536000"
	header Referrer-Policy "same-origin"
}
CADDY
reload_caddy
echo "$origin" > "$STATE/url"

for _ in $(seq 1 20); do
  if curl -s -m 2 "localhost:$PORT/" >/dev/null; then
    echo "clearcast is hosted at $origin"
    echo "The first visit may take a few seconds while Caddy gets its certificate."
    [ "$(cat /var/lib/fc-companion/signin 2>/dev/null)" = invite ] \
      && echo "Sign-in needs an invite code (fc-node invite). To let anyone in: fc-node signin open" \
      || echo "Anyone can sign in with their phone. To require invite codes: fc-node signin invite"
    [ -f /var/lib/fc-companion/app-account.json ] || echo "Phone sign-in is off until you run: fc-node app-account"
    exit 0
  fi
  sleep 1
done
echo "clearcast didn't start. Logs: docker logs fc-clearcast"
exit 1
