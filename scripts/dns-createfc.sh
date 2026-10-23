#!/usr/bin/env bash
# Points createfc.org at GitHub Pages and demo.createfc.org at the demo server, as Cloudflare
# "DNS only" records (no proxy, so GitHub and fc-node can get their own HTTPS certificates).
# Safe to re-run: records that already exist are left alone.
#
# Needs a Cloudflare API token limited to createfc.org with Zone: Read and DNS: Edit.
# Run it in your own terminal, and don't paste the token anywhere else:
#   CF_API_TOKEN=... bash scripts/dns-createfc.sh
set -euo pipefail

ZONE="createfc.org"
DEMO_IP="${DEMO_IP:-91.99.76.223}"
API="https://api.cloudflare.com/client/v4"
: "${CF_API_TOKEN:?Set CF_API_TOKEN to a Cloudflare token with Zone: Read and DNS: Edit on $ZONE}"
command -v jq >/dev/null || { echo "Needs jq (brew install jq)" >&2; exit 1; }

# On an error, show what Cloudflare said and which call it was, then stop.
cf() {
  local out code
  out=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" "$@")
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [[ "$code" != 2* ]]; then
    echo "Cloudflare said $code for: ${*: -1}" >&2
    echo "$out" | jq -r '.errors[]? | "  \(.code): \(.message)"' >&2 2>/dev/null || echo "$out" >&2
    exit 1
  fi
  echo "$out"
}

# Is the token itself good? Account tokens verify under their account; user tokens under /user.
ACCOUNT_ID="${CF_ACCOUNT_ID:-f12e75302a1b3a8053dc954755ffe719}"
status=$(cf "$API/accounts/$ACCOUNT_ID/tokens/verify" | jq -r '.result.status')
echo "token    $status"

zone_id=$(cf "$API/zones?name=$ZONE&account.id=$ACCOUNT_ID" | jq -r '.result[0].id // empty')
[[ -n "$zone_id" ]] || { echo "Couldn't find $ZONE. Does the token have Zone: Read on it?" >&2; exit 1; }

# type name content
RECORDS=(
  "A $ZONE 185.199.108.153"
  "A $ZONE 185.199.109.153"
  "A $ZONE 185.199.110.153"
  "A $ZONE 185.199.111.153"
  "CNAME www.$ZONE eucalyptus-viminalis.github.io"
  "A demo.$ZONE $DEMO_IP"
)

for r in "${RECORDS[@]}"; do
  read -r type name content <<<"$r"
  existing=$(cf "$API/zones/$zone_id/dns_records?type=$type&name=$name" | jq -r --arg c "$content" '.result[] | select(.content == $c) | .id' | head -1)
  if [[ -n "$existing" ]]; then
    echo "exists   $type $name -> $content"
    continue
  fi
  body=$(jq -nc --arg t "$type" --arg n "$name" --arg c "$content" '{type: $t, name: $n, content: $c, ttl: 1, proxied: false}')
  cf -X POST "$API/zones/$zone_id/dns_records" --data "$body" | jq -e '.success' >/dev/null
  echo "added    $type $name -> $content"
done

echo "Done. Check: dig +short $ZONE  and  dig +short demo.$ZONE"
