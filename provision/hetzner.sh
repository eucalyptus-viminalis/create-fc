#!/bin/bash
# Command 0: create a Hetzner Cloud server for a Snapchain read node.
#
#   curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner.sh | bash
#
# Needs: the hcloud CLI logged in to a project (hcloud context create fc-node)
# and an SSH key. Creates a cx43 server, a 1000 GB volume and a firewall,
# about $0.16/hour; see docs/Costs.md. Safe to re-run: it reuses what exists.
set -euo pipefail

RAW="${FC_RAW:-https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main}"
NAME="${NAME:-fc-node}"
TYPE="${TYPE:-cx43}"            # 8 shared vCPU, 16 GB RAM
LOCATION="${LOCATION:-fsn1}"
IMAGE="${IMAGE:-ubuntu-24.04}"
VOLUME_GB="${VOLUME_GB:-1000}"  # new accounts may only have 1024 GB of volumes in total

command -v hcloud >/dev/null || { echo "install the hcloud CLI first. macOS: brew install hcloud  Linux: https://github.com/hetznercloud/cli"; exit 1; }
hcloud context active >/dev/null 2>&1 || [ -n "${HCLOUD_TOKEN:-}" ] || {
  echo "hcloud isn't logged in. Make a project and an API token (Read & Write) at console.hetzner.com, then: hcloud context create fc-node"; exit 1; }
hcloud server-type describe "$TYPE" >/dev/null || { echo "unknown server type $TYPE; see: hcloud server-type list"; exit 1; }

SSH_KEY_FILE="${SSH_KEY_FILE:-}"
if [ -z "$SSH_KEY_FILE" ]; then
  for f in ~/.ssh/id_ed25519.pub ~/.ssh/id_ecdsa.pub ~/.ssh/id_rsa.pub; do [ -f "$f" ] && SSH_KEY_FILE=$f && break; done
fi
[ -n "$SSH_KEY_FILE" ] || { echo "no SSH key found. Make one with: ssh-keygen -t ed25519"; exit 1; }

# SSH key
key_name="$NAME-key"
hcloud ssh-key describe "$key_name" >/dev/null 2>&1 \
  || hcloud ssh-key create --name "$key_name" --public-key-from-file "$SSH_KEY_FILE" >/dev/null

# Firewall: SSH, HTTP API, gRPC, and gossip over UDP. Grafana (3000) stays closed.
fw="$NAME-fw"
if ! hcloud firewall describe "$fw" >/dev/null 2>&1; then
  hcloud firewall create --name "$fw" >/dev/null
  for rule in "tcp 22" "tcp 3381" "udp 3382" "tcp 3383"; do
    set -- $rule
    hcloud firewall add-rule "$fw" --direction in --protocol "$1" --port "$2" \
      --source-ips 0.0.0.0/0 --source-ips ::/0 --description "$1/$2" >/dev/null
  done
fi

# Volume first, so it is already attached when the server first boots.
vol="$NAME-data"
hcloud volume describe "$vol" >/dev/null 2>&1 \
  || hcloud volume create --name "$vol" --size "$VOLUME_GB" --location "$LOCATION" >/dev/null

# Server. On first boot it only formats and mounts the volume.
if ! hcloud server describe "$NAME" >/dev/null 2>&1; then
  user_data="$(mktemp)"
  here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
  if [ -n "$here" ] && [ -f "$here/cloud-init.sh" ]; then cp "$here/cloud-init.sh" "$user_data"
  else curl -fsSL "$RAW/provision/cloud-init.sh" -o "$user_data"; fi
  hcloud server create --name "$NAME" --type "$TYPE" --image "$IMAGE" \
    --location "$LOCATION" --ssh-key "$key_name" --firewall "$fw" --volume "$vol" \
    --user-data-from-file "$user_data" >/dev/null
  rm -f "$user_data"
fi

ip="$(hcloud server ip "$NAME")"
cat <<EOF

Server $NAME is up at $ip ($TYPE, ${VOLUME_GB} GB volume, $LOCATION).
It bills by the hour until you delete it; see the end of this message.

Next, command 1 sets up the node (give the server a minute to boot first):

  ssh -o StrictHostKeyChecking=accept-new root@$ip 'curl -fsSL $RAW/node/setup.sh | bash'

Then, once  ssh root@$ip fc-node status  says "in sync", command 2 on this computer:

  curl -fsSL $RAW/client/install.sh | bash -s -- http://$ip:3381

To delete everything and stop billing (it asks before deleting):
  curl -fsSL $RAW/provision/hetzner-delete.sh | bash
EOF
