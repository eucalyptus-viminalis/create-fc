#!/bin/bash
# Command 1: turn the server from command 0 into a Snapchain read node.
#
#   curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/node/setup.sh | sudo bash
#
# Run it on the Hetzner server provision/hetzner.sh made; other machines are
# not supported (see docs/adr/002-rented-server-only.md). Safe to run again: it picks up
# where it stopped. The slow part (2-3 h of snapshot, then catching up) runs
# as a systemd job, so you can disconnect. Check on it with: fc-node status
#
# Without a node of your own (a NO_NODE=1 server from hetzner.sh), name the
# node to use instead, and it sets up only the companion, image hosting and
# (with fc-node client) hosted fameboy (docs/adr/007-hypersnap-public-node.md):
#
#   curl -fsSL .../node/setup.sh | NODE=https://haatz.quilibrium.com bash
#
# Caddy then answers port 3381 by passing each request on to that node, so
# everything on this server, and anyone pointed at http://<this server>:3381,
# keeps working as if the node were here. NODE is remembered in
# /etc/fc-node.conf, so later runs don't need it.
set -euo pipefail

RAW="${FC_RAW:-https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main}"
SNAPCHAIN_RAW="https://raw.githubusercontent.com/farcasterxyz/snapchain/@latest/scripts/snapchain.sh"
CONF=/etc/fc-node.conf

[ "$(id -u)" -eq 0 ] || { echo "run as root: curl ... | sudo bash"; exit 1; }

# A remote node, from NODE or from an earlier run.
NODE="${NODE:-}"
[ -z "$NODE" ] && [ -f "$CONF" ] && NODE=$(sed -n 's/^NODE=//p' "$CONF" | head -n1)
NODE="${NODE%/}"
if [ -n "$NODE" ]; then
  # It goes into Caddy's config, so only a plain address: scheme, host, optional port.
  [[ "$NODE" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "NODE should look like https://haatz.quilibrium.com, not \"$NODE\""; exit 1; }
  if command -v docker >/dev/null && docker ps -a --format '{{.Names}}' | grep -qx snapchain-snapchain-1; then
    echo "this server runs its own Snapchain node, which already answers on port 3381. NODE is for servers without one (hetzner.sh with NO_NODE=1)."; exit 1
  fi
  curl -fsS -m 15 "$NODE/v1/info" | grep -q shardInfos || { echo "can't read $NODE/v1/info. Is NODE right?"; exit 1; }
else
  # The node lives in ~/snapchain (snapchain.sh insists). On a Hetzner server
  # that's a link to the volume mounted at /srv/snapchain.
  DIR=/root/snapchain
  if mountpoint -q /srv/snapchain; then
    [ -e "$DIR" ] || ln -s /srv/snapchain "$DIR"
  fi
  mkdir -p "$DIR"

  # -------------------------------------------------------------- checks
  ram_gb=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
  free_gb=$(df -BG --output=avail "$DIR/" | tail -1 | tr -dc 0-9)
  have_db=$( [ -d "$DIR/.rocks/shard-2" ] && echo yes || echo no )
  echo "fc-node setup: ${ram_gb} GB RAM, ${free_gb} GB free in $DIR"
  [ "$ram_gb" -ge 15 ] || echo "warning: Snapchain wants 16 GB of RAM; this box has ${ram_gb} GB"
  if [ "$have_db" = no ] && [ "$free_gb" -lt 650 ]; then
    echo "error: the database needs ~560 GB and grows; this disk has ${free_gb} GB free"; exit 1
  fi
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
fetch node/fameboy-name.mjs /usr/local/lib/fc-companion/fameboy-name.mjs
fetch node/companion-package.json /usr/local/lib/fc-companion/package.json
fetch node/companion-pnpm-lock.yaml /usr/local/lib/fc-companion/pnpm-lock.yaml
fetch node/companion-install.sh /usr/local/sbin/fc-companion-install
fetch node/fameboy-install.sh /usr/local/sbin/fc-fameboy-install

# ------------------------------------------------- no node of our own
# Only Docker, the companion and Caddy (which passes :3381 on to NODE): a
# minute or two, so it runs here rather than as a background job.
if [ -n "$NODE" ]; then
  echo "fc-node setup: no node here; reads and writes go to $NODE"
  printf 'NODE=%s\n' "$NODE" > "$CONF"
  command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
  command -v jq >/dev/null || { apt-get update -q && apt-get install -y -q jq; }
  fc-companion-install
  # Hosting fameboy (fc-node client)? Update it too.
  if [ -f /var/lib/fc-fameboy/url ]; then fc-fameboy-install || echo "hosted fameboy didn't restart: fc-node client to retry."; fi
  echo
  fc-node status | sed 's/^/  /' || true
  cat <<EOF

Set up. Next, on this server:
  fc-node app-account   phone sign-in for people using this server (run it in your own SSH session)
  fc-node client        host fameboy here
EOF
  exit 0
fi

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
# Hosting fameboy (fc-node client)? Update it too.
if [ -f /var/lib/fc-fameboy/url ]; then fc-fameboy-install || echo "hosted fameboy didn't restart: fc-node client to retry."; fi
JOB
sed -i "s|__SNAPCHAIN_RAW__|$SNAPCHAIN_RAW|" /usr/local/sbin/fc-node-setup
chmod +x /usr/local/sbin/fc-node-setup

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx snapchain-snapchain-1; then
  # Running already: this run only updated the helpers. Say where things stand
  # instead of the first-run message below.
  echo "the node is already running."
  fc-companion-install || true
  if [ -f /var/lib/fc-fameboy/url ]; then fc-fameboy-install || true; fi
  echo
  echo "Updated. Where things stand:"
  fc-node status | sed 's/^/  /' || true
  exit 0
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
