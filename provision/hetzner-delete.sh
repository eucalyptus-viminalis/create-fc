#!/bin/bash
# Delete everything provision/hetzner.sh created, so nothing keeps billing.
#
#   curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner-delete.sh | bash
#
# Lists what it will delete and asks you to type the server's name first.
# Pass --yes to skip the question: ... | bash -s -- --yes
# Pass --keep-ip to keep the server's IPv4 address, so a new server can take it
# over (hcloud server create --primary-ipv4, in the same location) and DNS, sslip.io names and image links
# keep working. A kept address bills about $0.66 a month until you delete it.
# Deleting the volume deletes the node's database. A new node re-syncs from
# scratch, about 8 hours.
set -euo pipefail

NAME="${NAME:-fc-node}"
YES=no
KEEP_IP=no
for arg in "$@"; do
  case "$arg" in
    --yes) YES=yes ;;
    --keep-ip) KEEP_IP=yes ;;
    *) echo "unknown option $arg (use --yes, --keep-ip)"; exit 1 ;;
  esac
done

command -v hcloud >/dev/null || { echo "the hcloud CLI isn't installed, so there's nothing this script can reach"; exit 1; }
hcloud context active >/dev/null 2>&1 || [ -n "${HCLOUD_TOKEN:-}" ] || { echo "hcloud isn't logged in: hcloud context create fc-node"; exit 1; }

server="$NAME"; vol="$NAME-data"; fw="$NAME-fw"; key="$NAME-key"
exists() { hcloud "$1" describe "$2" >/dev/null 2>&1; }

found=()
exists server "$server" && found+=("server   $server  $(hcloud server describe "$server" -o format='{{.ServerType.Name}} at {{.PublicNet.IPv4.IP}}')  (billed hourly)")
exists volume "$vol" && found+=("volume   $vol  $(hcloud volume describe "$vol" -o format='{{.Size}} GB')  (billed hourly; holds the node's database)")
exists firewall "$fw" && found+=("firewall $fw  (free)")
exists ssh-key "$key" && found+=("ssh key  $key  (free)")
ip_id=""; ip=""
if [ "$KEEP_IP" = yes ] && exists server "$server"; then
  ip_id=$(hcloud server describe "$server" -o format='{{.PublicNet.IPv4.ID}}')
  ip=$(hcloud server describe "$server" -o format='{{.PublicNet.IPv4.IP}}')
fi

if [ ${#found[@]} -eq 0 ]; then
  echo "nothing named $NAME* in this Hetzner project. Nothing is billing from create-fc."
  exit 0
fi

echo "This deletes, in the current hcloud project:"
printf '  %s\n' "${found[@]}"
[ -n "$ip_id" ] && echo "and keeps IPv4 $ip (primary IP $ip_id, about \$0.66 a month until deleted)"
if [ "$YES" != yes ]; then
  ( : < /dev/tty ) 2>/dev/null || { echo "no terminal to confirm on; re-run with: bash -s -- --yes"; exit 1; }
  printf 'type %s to delete them: ' "$server" > /dev/tty
  read -r answer < /dev/tty
  [ "$answer" = "$server" ] || { echo "not deleted."; exit 1; }
fi

# Turn off the address's auto delete before the server goes, or it goes with it.
if [ -n "$ip_id" ]; then
  hcloud primary-ip update "$ip_id" --auto-delete=false >/dev/null
  [ "$(hcloud primary-ip describe "$ip_id" -o format='{{.AutoDelete}}')" = false ] || { echo "couldn't turn off auto delete on $ip; nothing deleted"; exit 1; }
  echo "kept     IPv4 $ip (primary IP $ip_id)"
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

if [ -n "$ip_id" ]; then
  echo "done. Only the kept address bills now (about \$0.66 a month)."
  echo "Give it to a new server in $(hcloud primary-ip describe "$ip_id" -o format='{{.Location.Name}}'): hcloud server create --primary-ipv4 $ip_id --location <that location> ..."
  echo "Or delete it:            hcloud primary-ip delete $ip_id"
else
  echo "done. Nothing from create-fc is billing in this project now."
fi
echo "Your client's app key in ~/.fameboy still works with any node: point it at a new one with"
echo "  curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/client/install.sh | bash -s -- http://<new ip>:3381"
