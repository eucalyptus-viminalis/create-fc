#!/bin/bash
# Delete everything provision/hetzner.sh created, so nothing keeps billing.
#
#   curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner-delete.sh | bash
#
# Lists what it will delete and asks you to type the server's name first.
# Pass --yes to skip the question: ... | bash -s -- --yes
# Deleting the volume deletes the node's database. A new node re-syncs from
# scratch, about 8 hours.
set -euo pipefail

NAME="${NAME:-fc-node}"
YES=no
[ "${1:-}" = "--yes" ] && YES=yes

command -v hcloud >/dev/null || { echo "the hcloud CLI isn't installed, so there's nothing this script can reach"; exit 1; }
hcloud context active >/dev/null 2>&1 || [ -n "${HCLOUD_TOKEN:-}" ] || { echo "hcloud isn't logged in: hcloud context create fc-node"; exit 1; }

server="$NAME"; vol="$NAME-data"; fw="$NAME-fw"; key="$NAME-key"
exists() { hcloud "$1" describe "$2" >/dev/null 2>&1; }

found=()
exists server "$server" && found+=("server   $server  $(hcloud server describe "$server" -o format='{{.ServerType.Name}} at {{.PublicNet.IPv4.IP}}')  (billed hourly)")
exists volume "$vol" && found+=("volume   $vol  $(hcloud volume describe "$vol" -o format='{{.Size}} GB')  (billed hourly; holds the node's database)")
exists firewall "$fw" && found+=("firewall $fw  (free)")
exists ssh-key "$key" && found+=("ssh key  $key  (free)")

if [ ${#found[@]} -eq 0 ]; then
  echo "nothing named $NAME* in this Hetzner project. Nothing is billing from create-fc."
  exit 0
fi

echo "This deletes, in the current hcloud project:"
printf '  %s\n' "${found[@]}"
if [ "$YES" != yes ]; then
  ( : < /dev/tty ) 2>/dev/null || { echo "no terminal to confirm on; re-run with: bash -s -- --yes"; exit 1; }
  printf 'type %s to delete them: ' "$server" > /dev/tty
  read -r answer < /dev/tty
  [ "$answer" = "$server" ] || { echo "not deleted."; exit 1; }
fi

# The server first: a volume can't be deleted while it's attached.
exists server "$server" && hcloud server delete "$server" >/dev/null && echo "deleted server $server"
if exists volume "$vol"; then
  for _ in $(seq 1 30); do
    [ -z "$(hcloud volume describe "$vol" -o format='{{if .Server}}{{.Server.Name}}{{end}}')" ] && break
    sleep 2
  done
  hcloud volume delete "$vol" >/dev/null && echo "deleted volume $vol"
fi
exists firewall "$fw" && hcloud firewall delete "$fw" >/dev/null && echo "deleted firewall $fw"
exists ssh-key "$key" && hcloud ssh-key delete "$key" >/dev/null && echo "deleted ssh key $key"

echo "done. Nothing from create-fc is billing in this project now."
echo "Your client's app key in ~/.fc-client still works with any node: point it at a new one with"
echo "  curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/client/install.sh | bash -s -- http://<new ip>:3381"
