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
set -euo pipefail

LIB=/usr/local/lib/fc-companion
STATE=/var/lib/fc-companion
for f in companion.mjs app-account.mjs package.json pnpm-lock.yaml; do
  [ -f "$LIB/$f" ] || { echo "fc-companion: $f is missing; re-run command 1"; exit 1; }
done
mkdir -p "$STATE"
# The container runs as the image's "node" user (uid 1000). It reads the app
# account and invites, so they're its own, mode 600.
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

# The service itself. Host network so it reaches Snapchain at 127.0.0.1:3381
# and listens on 3390 directly.
docker rm -f fc-companion >/dev/null 2>&1 || true
docker run -d --name fc-companion --restart unless-stopped --network host \
  --read-only --user node --memory 128m \
  -v /usr/local/lib/fc-companion:/app:ro -v /var/lib/fc-companion:/state:ro \
  node:22-alpine node /app/companion.mjs >/dev/null

for _ in $(seq 1 20); do
  curl -s -m 2 localhost:3390/v1/companion >/dev/null && { echo "fc-companion running on port 3390."; exit 0; }
  sleep 1
done
echo "fc-companion didn't answer on port 3390. Logs: docker logs fc-companion"
exit 1
