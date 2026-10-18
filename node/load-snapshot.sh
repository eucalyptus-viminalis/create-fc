#!/bin/bash
# Fill a Snapchain read node's database from the public snapshot by streaming,
# so the snapshot never sits on disk.
#
#   sudo ./node/load-snapshot.sh [snapchain dir, default /root/snapchain]
#
# Why: the node's own loader keeps every compressed chunk and every
# uncompressed tar until all shards are unpacked. We estimate that peak at
# ~1.5 TB, against ~550 GB for the finished database. Here each ~70 MB chunk
# is downloaded, gunzipped into one tar stream and deleted, so the peak is
# the database plus a few chunks.
#
# The node only downloads a snapshot when .rocks is empty (src/main.rs), so
# after this it boots straight into catching up. Re-running skips finished
# shards and redoes a partial one.
set -euo pipefail

DIR="${1:-/root/snapchain}"
BASE="${SNAPSHOT_BASE:-https://pub-d352dd8819104a778e20d08888c5a661.r2.dev}"
NET="FARCASTER_NETWORK_MAINNET"
AHEAD=4                       # chunks downloaded in parallel ahead of the one being unpacked
ROCKS="$DIR/.rocks"
STATE="$DIR/.fc-snapshot"     # outside .rocks so the node never sees it
mkdir -p "$ROCKS" "$STATE/tmp"

# stdout carries the tar stream, so every message goes to stderr
log() { echo "$(date -u +%FT%TZ) $*" >&2; }

fetch() {  # url dest: retry a chunk until it arrives whole
  local i
  for i in 1 2 3 4 5 6; do
    curl -fsS --retry 3 -o "$2.part" "$1" && gzip -t "$2.part" 2>/dev/null && mv "$2.part" "$2" && return 0
    log "retry $i: $1"; sleep $((i * 10))
  done
  return 1
}

for shard in 0 1 2; do
  if [ -f "$STATE/shard-$shard.done" ]; then log "shard $shard already loaded"; continue; fi
  rm -rf "$ROCKS/shard-$shard" "$STATE/tmp"/*

  meta="$(curl -fsS "$BASE/$NET/$shard/latest.json")"
  key="$(jq -r .key_base <<<"$meta")"
  mapfile -t chunks < <(jq -r '.chunks[]' <<<"$meta")
  n=${#chunks[@]}
  log "shard $shard: $n chunks from $key"
  start=$(date +%s)

  pid=()
  for ((i = 0; i < n; i++)); do
    # keep AHEAD downloads in flight
    for ((j = i; j < n && j < i + AHEAD; j++)); do
      [ -n "${pid[$j]:-}" ] || { fetch "$BASE/$key/${chunks[$j]}" "$STATE/tmp/$j" & pid[$j]=$!; }
    done
    wait "${pid[$i]}" || { echo "chunk ${chunks[$i]} failed; re-run to resume this shard" >&2; exit 1; }
    gunzip -c "$STATE/tmp/$i"
    rm -f "$STATE/tmp/$i"
    if (( (i + 1) % 100 == 0 )); then
      el=$(( $(date +%s) - start ))
      log "shard $shard: $((i + 1))/$n chunks, ${el}s elapsed, ~$(( el * (n - i - 1) / (i + 1) / 60 )) min left, disk $(df -h --output=used "$DIR" | tail -1 | tr -d ' ')"
    fi
  done | tar -x -C "$ROCKS"
  unset pid

  touch "$STATE/shard-$shard.done"
  log "shard $shard done in $(( ($(date +%s) - start) / 60 )) min; disk used $(df -h --output=used "$DIR" | tail -1 | tr -d ' ')"
done

rm -rf "$STATE/tmp"
log "snapshot loaded into $ROCKS ($(du -sh "$ROCKS" | cut -f1))"
