#!/bin/bash
# Command 0: create a Hetzner Cloud server for a Snapchain read node.
#
#   curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner.sh | bash
#
# Needs: the hcloud CLI logged in to a project (hcloud context create fc-node)
# and an SSH key. Creates a server, a 1000 GB volume and a firewall; see
# docs/Costs.md. Safe to re-run: it reuses what exists.
#
# Server types sell out. It tries cx43 ($0.16/hour all in) in fsn1, nbg1 and
# hel1, then cpx41 (~$0.20/hour) in the same places, and says which it got.
# Set TYPE or LOCATION to pin either one.
#
# NO_NODE=1 makes a small server with no node and no volume, for hosting
# fameboy and its companion against someone else's node, like Hypersnap's
# (docs/adr/007-hypersnap-public-node.md): a cx23 (~$7.80/month with its
# IPv4), else a cax11.
# PRIMARY_IPV4=<id or name> gives the new server an IPv4 address you kept
# (hetzner-delete.sh --keep-ip), so DNS and sslip.io names keep working. The
# server then has to go in that address's location.
set -euo pipefail

RAW="${FC_RAW:-https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main}"
NAME="${NAME:-fc-node}"
NO_NODE="${NO_NODE:-}"
if [ -n "$NO_NODE" ]; then
  TYPES="${TYPE:-cx23 cax11}"        # 2 vCPU, 4 GB RAM, 40 GB disk; cax11 is ARM
else
  TYPES="${TYPE:-cx43 cpx41}"        # both 8 shared vCPU, 16 GB RAM; cx43 is half the price
fi
LOCATIONS="${LOCATION:-fsn1 nbg1 hel1}"
IMAGE="${IMAGE:-ubuntu-24.04}"
VOLUME_GB="${VOLUME_GB:-1000}"  # new accounts may only have 1024 GB of volumes in total
PRIMARY_IPV4="${PRIMARY_IPV4:-}"

command -v hcloud >/dev/null || { echo "install the hcloud CLI first. macOS: brew install hcloud  Linux: https://github.com/hetznercloud/cli"; exit 1; }
hcloud context active >/dev/null 2>&1 || [ -n "${HCLOUD_TOKEN:-}" ] || {
  echo "hcloud isn't logged in. Make a project and an API token (Read & Write) at console.hetzner.com, then: hcloud context create fc-node"; exit 1; }
for t in $TYPES; do hcloud server-type describe "$t" >/dev/null || { echo "unknown server type $t; see: hcloud server-type list"; exit 1; }; done

# A kept address only attaches to a server in its own location, and only when free.
ip_args=()
if [ -n "$PRIMARY_IPV4" ]; then
  hcloud primary-ip describe "$PRIMARY_IPV4" >/dev/null 2>&1 || { echo "no primary IP $PRIMARY_IPV4 in this project; see: hcloud primary-ip list"; exit 1; }
  [ "$(hcloud primary-ip describe "$PRIMARY_IPV4" -o format='{{.Type}}')" = ipv4 ] || { echo "primary IP $PRIMARY_IPV4 isn't an IPv4 address"; exit 1; }
  ip_loc="$(hcloud primary-ip describe "$PRIMARY_IPV4" -o format='{{.Location.Name}}')"
  if [ -n "${LOCATION:-}" ] && [ "$LOCATION" != "$ip_loc" ]; then
    echo "primary IP $PRIMARY_IPV4 is in $ip_loc, so the server has to be too (you set LOCATION=$LOCATION)"; exit 1
  fi
  LOCATIONS="$ip_loc"
  ip_args=(--primary-ipv4 "$PRIMARY_IPV4")
fi

SSH_KEY_FILE="${SSH_KEY_FILE:-}"
if [ -z "$SSH_KEY_FILE" ]; then
  for f in ~/.ssh/id_ed25519.pub ~/.ssh/id_ecdsa.pub ~/.ssh/id_rsa.pub; do [ -f "$f" ] && SSH_KEY_FILE=$f && break; done
fi
[ -n "$SSH_KEY_FILE" ] || { echo "no SSH key found. Make one with: ssh-keygen -t ed25519"; exit 1; }

# SSH key
key_name="$NAME-key"
hcloud ssh-key describe "$key_name" >/dev/null 2>&1 \
  || hcloud ssh-key create --name "$key_name" --public-key-from-file "$SSH_KEY_FILE" >/dev/null

# Firewall: SSH, HTTP API, gossip over UDP, gRPC, fc-companion (3390: uptime,
# who's online and sign-in, for fameboy), and 80/443 for fc-images (Caddy
# serves cast images over HTTPS; 80 is how it gets its certificate).
# Grafana (3000) stays closed. Without a node, 3381 is Caddy passing reads
# and writes on to the remote node, and there's no gossip or gRPC.
fw="$NAME-fw"
rules=("tcp 22" "tcp 80" "tcp 443" "tcp 3381" "udp 3382" "tcp 3383" "tcp 3390")
[ -n "$NO_NODE" ] && rules=("tcp 22" "tcp 80" "tcp 443" "tcp 3381" "tcp 3390")
if ! hcloud firewall describe "$fw" >/dev/null 2>&1; then
  hcloud firewall create --name "$fw" >/dev/null
  for rule in "${rules[@]}"; do
    set -- $rule
    hcloud firewall add-rule "$fw" --direction in --protocol "$1" --port "$2" \
      --source-ips 0.0.0.0/0 --source-ips ::/0 --description "$1/$2" >/dev/null
  done
fi

# Server first: when a type is sold out in a location, Hetzner says
# "error during placement (resource_unavailable)" and nothing is created or
# billed, so we can just try the next option. On first boot the server waits
# for its volume and mounts it.
if [ -n "$PRIMARY_IPV4" ] && hcloud server describe "$NAME" >/dev/null 2>&1; then
  [ "$(hcloud server describe "$NAME" -o format='{{.PublicNet.IPv4.ID}}')" = "$(hcloud primary-ip describe "$PRIMARY_IPV4" -o format='{{.ID}}')" ] \
    || { echo "server $NAME exists already, without primary IP $PRIMARY_IPV4. Delete it first, or leave PRIMARY_IPV4 unset"; exit 1; }
fi
if ! hcloud server describe "$NAME" >/dev/null 2>&1; then
  if [ -n "$PRIMARY_IPV4" ]; then
    assignee="$(hcloud primary-ip describe "$PRIMARY_IPV4" -o format='{{.AssigneeID}}')"
    [ -z "$assignee" ] || [ "$assignee" = 0 ] || { echo "primary IP $PRIMARY_IPV4 is still on server $assignee. Delete that server first (hetzner-delete.sh --keep-ip)"; exit 1; }
  fi
  # Only a full node needs cloud-init: it waits for the volume and mounts it.
  user_data=""
  user_data_args=()
  if [ -z "$NO_NODE" ]; then
    user_data="$(mktemp)"
    here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
    if [ -n "$here" ] && [ -f "$here/cloud-init.sh" ]; then cp "$here/cloud-init.sh" "$user_data"
    else curl -fsSL "$RAW/provision/cloud-init.sh" -o "$user_data"; fi
    user_data_args=(--user-data-from-file "$user_data")
  fi
  made=no
  for type in $TYPES; do
    for loc in $LOCATIONS; do
      if err="$(hcloud server create --name "$NAME" --type "$type" --image "$IMAGE" \
          --location "$loc" --ssh-key "$key_name" --firewall "$fw" \
          ${ip_args[@]+"${ip_args[@]}"} ${user_data_args[@]+"${user_data_args[@]}"} 2>&1 >/dev/null)"; then
        made=yes; break 2
      fi
      case "$err" in
        *resource_unavailable*) echo "$type is sold out in $loc right now; trying the next option" ;;
        *) [ -z "$user_data" ] || rm -f "$user_data"; echo "$err"; exit 1 ;;
      esac
    done
  done
  [ -z "$user_data" ] || rm -f "$user_data"
  [ "$made" = yes ] || { echo "every option is sold out: $TYPES in $LOCATIONS. Try again later, or pick another type: TYPE=ccx23 bash"; exit 1; }
fi
type="$(hcloud server describe "$NAME" -o format='{{.ServerType.Name}}')"
loc="$(hcloud server describe "$NAME" -o format='{{.Location.Name}}')"

if [ -n "$NO_NODE" ]; then
  ip="$(hcloud server ip "$NAME")"
  cat <<EOF

Server $NAME is up at $ip ($type, no node, $loc).
It bills by the hour until you delete it; see the end of this message.

Next, command 1 sets it up against a remote node (give the server a minute to boot first):

  ssh -o StrictHostKeyChecking=accept-new root@$ip 'curl -fsSL $RAW/node/setup.sh | NODE=https://haatz.quilibrium.com bash'

To delete it and stop billing (it asks first; --keep-ip keeps the address):
  curl -fsSL $RAW/provision/hetzner-delete.sh | bash
EOF
  exit 0
fi

# Volume, in the server's location (a volume can only attach to a server in
# the same place), attached straight away.
vol="$NAME-data"
if ! hcloud volume describe "$vol" >/dev/null 2>&1; then
  hcloud volume create --name "$vol" --size "$VOLUME_GB" --server "$NAME" >/dev/null  # lands in the server's location
fi
vol_loc="$(hcloud volume describe "$vol" -o format='{{.Location.Name}}')"
[ "$vol_loc" = "$loc" ] || { echo "volume $vol is in $vol_loc but the server is in $loc. Delete one: hcloud volume delete $vol"; exit 1; }
[ -n "$(hcloud volume describe "$vol" -o format='{{if .Server}}{{.Server.Name}}{{end}}')" ] || hcloud volume attach "$vol" --server "$NAME" >/dev/null

ip="$(hcloud server ip "$NAME")"
cat <<EOF

Server $NAME is up at $ip ($type, ${VOLUME_GB} GB volume, $loc).
It bills by the hour until you delete it; see the end of this message.

Next, command 1 sets up the node (give the server a minute to boot first):

  ssh -o StrictHostKeyChecking=accept-new root@$ip 'curl -fsSL $RAW/node/setup.sh | bash'

Then, once  ssh root@$ip fc-node status  says "in sync", command 2 on this computer:

  curl -fsSL $RAW/client/install.sh | bash -s -- http://$ip:3381

To delete everything and stop billing (it asks before deleting):
  curl -fsSL $RAW/provision/hetzner-delete.sh | bash
EOF
