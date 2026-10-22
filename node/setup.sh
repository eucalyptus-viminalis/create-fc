#!/bin/bash
# Command 1: turn the server from command 0 into a Snapchain read node.
#
#   curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/node/setup.sh | sudo bash
#
# Run it on the Hetzner server provision/hetzner.sh made; other machines are
# not supported (see docs/adr/002-rented-server-only.md). Safe to run again: it picks up
# where it stopped. The slow part (2-3 h of snapshot, then catching up) runs
# as a systemd job, so you can disconnect. Check on it with: fc-node status
set -euo pipefail

RAW="${FC_RAW:-https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main}"
SNAPCHAIN_RAW="https://raw.githubusercontent.com/farcasterxyz/snapchain/@latest/scripts/snapchain.sh"

[ "$(id -u)" -eq 0 ] || { echo "run as root: curl ... | sudo bash"; exit 1; }

# The node lives in ~/snapchain (snapchain.sh insists). On a Hetzner server
# that's a link to the volume mounted at /srv/snapchain.
DIR=/root/snapchain
if mountpoint -q /srv/snapchain; then
  [ -e "$DIR" ] || ln -s /srv/snapchain "$DIR"
fi
mkdir -p "$DIR"

# ---------------------------------------------------------------- checks
ram_gb=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
free_gb=$(df -BG --output=avail "$DIR/" | tail -1 | tr -dc 0-9)
have_db=$( [ -d "$DIR/.rocks/shard-2" ] && echo yes || echo no )
echo "fc-node setup: ${ram_gb} GB RAM, ${free_gb} GB free in $DIR"
[ "$ram_gb" -ge 15 ] || echo "warning: Snapchain wants 16 GB of RAM; this box has ${ram_gb} GB"
if [ "$have_db" = no ] && [ "$free_gb" -lt 650 ]; then
  echo "error: the database needs ~560 GB and grows; this disk has ${free_gb} GB free"; exit 1
fi

# ------------------------------------------------------ the helper scripts
fetch() { # repo path -> dest; use a local checkout when there is one
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
  if [ -n "$here" ] && [ -f "$here/$(basename "$1")" ]; then cp "$here/$(basename "$1")" "$2"
  else curl -fsSL "$RAW/$1" -o "$2"; fi
  chmod +x "$2"
}
fetch node/load-snapshot.sh /usr/local/bin/fc-load-snapshot
fetch node/fc-node /usr/local/bin/fc-node
mkdir -p /usr/local/lib/fc-companion
fetch node/companion.mjs /usr/local/lib/fc-companion/companion.mjs
fetch node/companion-app-account.mjs /usr/local/lib/fc-companion/app-account.mjs
fetch node/colorcast.mjs /usr/local/lib/fc-companion/colorcast.mjs
fetch node/companion-package.json /usr/local/lib/fc-companion/package.json
fetch node/companion-pnpm-lock.yaml /usr/local/lib/fc-companion/pnpm-lock.yaml
fetch node/companion-install.sh /usr/local/sbin/fc-companion-install

# --------------------------------------------- the job that does the work
cat > /usr/local/sbin/fc-node-setup <<'JOB'
#!/bin/bash
set -euo pipefail
DIR=/root/snapchain
cd "$DIR"
echo "== $(date -u +%FT%TZ) setup starting"

command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
command -v jq >/dev/null || { apt-get update -q && apt-get install -y -q jq; }

# Pre-answer snapchain.sh's two prompts. HUB_OPERATOR_FID only picks which
# weekday the node auto-upgrades; a random one spreads upgrades out.
touch .env
grep -q '^AGREE_NO_REWARDS_FOR_ME=' .env || echo "AGREE_NO_REWARDS_FOR_ME=true" >> .env
grep -q '^HUB_OPERATOR_FID=' .env || echo "HUB_OPERATOR_FID=${OPERATOR_FID:-$((RANDOM * 32 + RANDOM % 32 + 1))}" >> .env

# Stream the snapshot into .rocks (see fc-load-snapshot for why). Skips
# finished shards, so a re-run resumes.
fc-load-snapshot "$DIR"

# The official installer. Not snapchain-bootstrap.sh: that reads /dev/tty,
# which a systemd job doesn't have. `upgrade` ends by following the logs
# forever, so stop it once the node container is up.
curl -fsSL "__SNAPCHAIN_RAW__" -o snapchain.sh
chmod +x snapchain.sh
./snapchain.sh upgrade < /dev/null > /var/log/snapchain-upgrade.log 2>&1 &
up=$!
for _ in $(seq 1 180); do
  docker ps --format '{{.Names}}' | grep -qx snapchain-snapchain-1 && break
  kill -0 "$up" 2>/dev/null || { echo "snapchain.sh upgrade exited early:"; tail -n 40 /var/log/snapchain-upgrade.log; exit 1; }
  sleep 5
done
sleep 10
pkill -P "$up" 2>/dev/null || true
kill "$up" 2>/dev/null || true
echo "== $(date -u +%FT%TZ) node running; catching up from the snapshot"
fc-companion-install || echo "fc-companion didn't start; the node is fine. Re-run command 1 to retry."
JOB
sed -i "s|__SNAPCHAIN_RAW__|$SNAPCHAIN_RAW|" /usr/local/sbin/fc-node-setup
chmod +x /usr/local/sbin/fc-node-setup

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx snapchain-snapchain-1; then
  echo "the node is already running."
  fc-companion-install || true
elif systemctl is-active --quiet fc-node-setup; then
  echo "setup is already running."
else
  systemctl reset-failed fc-node-setup 2>/dev/null || true
  systemd-run --quiet --unit fc-node-setup --setenv OPERATOR_FID="${OPERATOR_FID:-}" \
    --property StandardOutput=append:/var/log/fc-node-setup.log \
    --property StandardError=append:/var/log/fc-node-setup.log \
    /usr/local/sbin/fc-node-setup >/dev/null
  echo "setup started as a background job."
fi

cat <<EOF

The node takes a few hours to load and catch up. You can disconnect now.
  fc-node status     where it's at (snapshot progress, then sync lag)
  fc-node logs       follow the setup log

When fc-node status says "in sync", run command 2 on your own computer.
EOF
