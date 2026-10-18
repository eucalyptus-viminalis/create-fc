#!/bin/bash
# First boot on a server made by provision/hetzner.sh: format and mount the
# data volume at /srv/snapchain. Everything else is command 1 (node/setup.sh),
# which you run yourself so you can see what it does.
set -euo pipefail
exec > >(tee -a /var/log/fc-node-setup.log) 2>&1

DATA=/srv/snapchain
# provision/hetzner.sh attaches the volume just after creating the server,
# so wait for it (up to 5 minutes).
for _ in $(seq 1 60); do
  vol=$(ls /dev/disk/by-id/scsi-0HC_Volume_* 2>/dev/null | head -n1 || true)
  [ -n "$vol" ] && break
  sleep 5
done
[ -n "$vol" ] || { echo "no Hetzner volume attached; node/setup.sh will use the boot disk"; exit 0; }

mkdir -p "$DATA"
blkid "$vol" >/dev/null 2>&1 || mkfs.ext4 -q -m 0 "$vol"
grep -q " $DATA " /etc/fstab || echo "$vol $DATA ext4 discard,nofail,defaults 0 0" >> /etc/fstab
mountpoint -q "$DATA" || mount "$DATA"
echo "== $(date -u +%FT%TZ) volume mounted at $DATA ($(df -h --output=size "$DATA" | tail -1 | tr -d ' '))"
