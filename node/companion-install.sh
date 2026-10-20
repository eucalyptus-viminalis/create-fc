#!/bin/bash
# Installs (or updates) fc-companion next to Snapchain. setup.sh copies this
# to /usr/local/sbin/fc-companion-install and runs it once the node is up.
# Safe to run again.
#
#   - /usr/local/lib/fc-companion/                the service, the app-account setup
#                                                 script and its pinned dependency
#                                                 (setup.sh puts them there)
#   - fc-companion-uptime.timer                   writes Snapchain's start time
#                                                 to /var/lib/fc-companion once a minute
#   - the fc-companion container                  Node 22, host network, port 3390,
#                                                 read-only, no Docker socket
#   - the fc-images container                     Caddy: serves uploaded images over
#                                                 HTTPS at https://<ip with dashes>.sslip.io,
#                                                 with a certificate it gets itself
#                                                 (needs ports 80 and 443 open)
set -euo pipefail

LIB=/usr/local/lib/fc-companion
STATE=/var/lib/fc-companion
for f in companion.mjs app-account.mjs package.json pnpm-lock.yaml; do
  [ -f "$LIB/$f" ] || { echo "fc-companion: $f is missing; re-run command 1"; exit 1; }
done
mkdir -p "$STATE"
# The container runs as the image's "node" user (uid 1000). It reads the app
# account and invites, so they're its own, mode 600.
# Images people upload for their casts, and who uploaded what.
mkdir -p "$STATE/images" "$STATE/ledger" "$STATE/caddy"
chown 1000:1000 "$STATE/images" "$STATE/ledger"
touch "$STATE/invites"
chown 1000:1000 "$STATE/invites"; chmod 600 "$STATE/invites"
[ -f "$STATE/app-account.json" ] && { chown 1000:1000 "$STATE/app-account.json"; chmod 600 "$STATE/app-account.json"; }

# Its one dependency (viem, for phone sign-in), pinned by the lockfile.
# Reinstalled only when the lockfile changes.
want=$(sha256sum "$LIB/pnpm-lock.yaml" | cut -d' ' -f1)
if [ "$(cat "$LIB/node_modules/.lock-sha" 2>/dev/null)" != "$want" ]; then
  echo "fc-companion: installing its dependency (viem)..."
  docker run --rm -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 -v "$LIB:/app" -w /app node:22-alpine \
    sh -c "corepack enable && pnpm install --prod --frozen-lockfile --reporter=silent" >/dev/null
  echo "$want" > "$LIB/node_modules/.lock-sha"
fi

# Uptime: Docker knows when the Snapchain container started. A timer on the
# host reads it, so the companion never needs the Docker socket.
cat > /usr/local/sbin/fc-companion-uptime <<'EOF'
#!/bin/bash
started=$(docker inspect -f '{{.State.StartedAt}}' snapchain-snapchain-1 2>/dev/null) || exit 0
printf '{"startedAt":"%s"}\n' "$started" > /var/lib/fc-companion/snapchain.json.tmp
mv /var/lib/fc-companion/snapchain.json.tmp /var/lib/fc-companion/snapchain.json
EOF
chmod +x /usr/local/sbin/fc-companion-uptime

cat > /etc/systemd/system/fc-companion-uptime.service <<'EOF'
[Unit]
Description=Record when Snapchain started, for fc-companion

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/fc-companion-uptime
EOF
cat > /etc/systemd/system/fc-companion-uptime.timer <<'EOF'
[Unit]
Description=Record when Snapchain started, once a minute

[Timer]
OnBootSec=30
OnUnitActiveSec=60

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now fc-companion-uptime.timer >/dev/null
/usr/local/sbin/fc-companion-uptime

# This server's public address, as a name that resolves to it: sslip.io
# answers 91-99-76-223.sslip.io with 91.99.76.223, so Caddy can get a
# certificate for it with no domain of our own.
ip=$(curl -s -m 3 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || true)
[ -n "$ip" ] || ip=$(hostname -I | awk '{print $1}')
host="${ip//./-}.sslip.io"
IMAGE_BASE="https://$host"

# The service itself. Host network so it reaches Snapchain at 127.0.0.1:3381
# and listens on 3390 directly. It can write only the images and the ledger.
docker rm -f fc-companion >/dev/null 2>&1 || true
docker run -d --name fc-companion --restart unless-stopped --network host \
  --read-only --user node --memory 128m \
  -e IMAGE_BASE="$IMAGE_BASE" \
  -v /usr/local/lib/fc-companion:/app:ro -v /var/lib/fc-companion:/state:ro \
  -v /var/lib/fc-companion/images:/images -v /var/lib/fc-companion/ledger:/ledger \
  node:22-alpine node /app/companion.mjs >/dev/null

# Caddy serves /img/* from the images folder over HTTPS, and nothing else.
cat > "$STATE/Caddyfile" <<CADDY
$host {
	handle /img/* {
		root * /srv
		file_server
		header Cache-Control "public, max-age=31536000, immutable"
		header X-Content-Type-Options nosniff
	}
	handle {
		respond "clearcast images live under /img/" 404
	}
}
CADDY
docker rm -f fc-images >/dev/null 2>&1 || true
docker run -d --name fc-images --restart unless-stopped --network host --memory 128m \
  -v "$STATE/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$STATE/images:/srv/img:ro" -v "$STATE/caddy:/data" \
  caddy:2-alpine >/dev/null
echo "fc-images: serving images at $IMAGE_BASE/img/ (needs ports 80 and 443 open)"

for _ in $(seq 1 20); do
  curl -s -m 2 localhost:3390/v1/companion >/dev/null && { echo "fc-companion running on port 3390."; exit 0; }
  sleep 1
done
echo "fc-companion didn't answer on port 3390. Logs: docker logs fc-companion"
exit 1
