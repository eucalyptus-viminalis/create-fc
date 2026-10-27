#!/usr/bin/env bash
# Sends demo.createfc.org to the maintenance page at https://createfc.org/demo/ while the demo
# is moving to Hypersnap (docs/adr/007-hypersnap-public-node.md).
#
# Run it before deleting the demo server, so the name never points at an IP Hetzner may hand
# to someone else. It:
#   1. points the demo A record at 192.0.2.1 (a reserved address nobody can own), proxied
#      through Cloudflare, instead of the server's IP
#   2. adds a Single Redirect rule: demo.createfc.org/* -> https://createfc.org/demo/ (302)
# --undo removes both, leaving demo.createfc.org with no record until it gets a new host.
# Safe to re-run.
#
# Needs a Cloudflare API token limited to createfc.org with Zone: Read, DNS: Edit and
# Single Redirect: Edit. Run it in your own terminal, and don't paste the token anywhere else:
#   CF_API_TOKEN=... bash scripts/demo-maintenance-dns.sh [--undo]
set -euo pipefail

ZONE="createfc.org"
NAME="demo.$ZONE"
PLACEHOLDER_IP="192.0.2.1"
TARGET="https://$ZONE/demo/"
RULE_REF="createfc_demo_maintenance"
API="https://api.cloudflare.com/client/v4"
UNDO=no
[ "${1:-}" = "--undo" ] && UNDO=yes
: "${CF_API_TOKEN:?Set CF_API_TOKEN to a Cloudflare token with Zone: Read, DNS: Edit and Single Redirect: Edit on $ZONE}"
command -v jq >/dev/null || { echo "Needs jq (brew install jq)" >&2; exit 1; }

# Like cf() in dns-createfc.sh, but returns 404s to the caller (a zone with no redirect rules yet).
cf() {
  local out code
  out=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" "$@")
  code=${out##*$'\n'}; out=${out%$'\n'*}
  if [[ "$code" == 404 ]]; then echo '{"result":null}'; return; fi
  if [[ "$code" != 2* ]]; then
    echo "Cloudflare said $code for: ${*: -1}" >&2
    echo "$out" | jq -r '.errors[]? | "  \(.code): \(.message)"' >&2 2>/dev/null || echo "$out" >&2
    exit 1
  fi
  echo "$out"
}

ACCOUNT_ID="${CF_ACCOUNT_ID:-f12e75302a1b3a8053dc954755ffe719}"
zone_id=$(cf "$API/zones?name=$ZONE&account.id=$ACCOUNT_ID" | jq -r '.result[0].id // empty')
[[ -n "$zone_id" ]] || { echo "Couldn't find $ZONE. Does the token have Zone: Read on it?" >&2; exit 1; }

# ---- the redirect rule
phase="$API/zones/$zone_id/rulesets/phases/http_request_dynamic_redirect/entrypoint"
ruleset=$(cf "$phase")
ruleset_id=$(echo "$ruleset" | jq -r '.result.id // empty')
rule_id=$(echo "$ruleset" | jq -r --arg r "$RULE_REF" '.result.rules[]? | select(.ref == $r) | .id' | head -1)
rule=$(jq -nc --arg r "$RULE_REF" --arg h "$NAME" --arg t "$TARGET" '{
  ref: $r,
  description: "demo.createfc.org -> maintenance page (ADR 007)",
  expression: "(http.host eq \"\($h)\")",
  action: "redirect",
  action_parameters: {from_value: {status_code: 302, target_url: {value: $t}, preserve_query_string: false}}
}')

if [ "$UNDO" = yes ]; then
  if [[ -n "$rule_id" ]]; then
    cf -X DELETE "$API/zones/$zone_id/rulesets/$ruleset_id/rules/$rule_id" >/dev/null
    echo "removed  redirect $NAME -> $TARGET"
  else
    echo "absent   redirect $NAME"
  fi
elif [[ -n "$rule_id" ]]; then
  echo "exists   redirect $NAME -> $TARGET"
elif [[ -n "$ruleset_id" ]]; then
  cf -X POST "$API/zones/$zone_id/rulesets/$ruleset_id/rules" --data "$rule" >/dev/null
  echo "added    redirect $NAME -> $TARGET"
else
  cf -X PUT "$phase" --data "$(jq -nc --argjson rule "$rule" '{rules: [$rule]}')" >/dev/null
  echo "added    redirect $NAME -> $TARGET"
fi

# ---- the A record(s) for demo
records=$(cf "$API/zones/$zone_id/dns_records?type=A&name=$NAME" | jq -c '.result[]?')
placeholder_seen=no
while read -r r; do
  [[ -n "$r" ]] || continue
  id=$(echo "$r" | jq -r .id); ip=$(echo "$r" | jq -r .content); proxied=$(echo "$r" | jq -r .proxied)
  if [ "$UNDO" = no ] && [ "$ip" = "$PLACEHOLDER_IP" ] && [ "$proxied" = true ] && [ "$placeholder_seen" = no ]; then
    placeholder_seen=yes
    echo "exists   A $NAME -> $PLACEHOLDER_IP (proxied)"
    continue
  fi
  if [ "$UNDO" = yes ] && [ "$ip" != "$PLACEHOLDER_IP" ]; then
    echo "kept     A $NAME -> $ip (not ours to remove)"
    continue
  fi
  cf -X DELETE "$API/zones/$zone_id/dns_records/$id" >/dev/null
  echo "removed  A $NAME -> $ip"
done <<<"$records"

if [ "$UNDO" = no ] && [ "$placeholder_seen" = no ]; then
  body=$(jq -nc --arg n "$NAME" --arg c "$PLACEHOLDER_IP" '{type: "A", name: $n, content: $c, ttl: 1, proxied: true}')
  cf -X POST "$API/zones/$zone_id/dns_records" --data "$body" | jq -e '.success' >/dev/null
  echo "added    A $NAME -> $PLACEHOLDER_IP (proxied)"
fi

if [ "$UNDO" = yes ]; then
  echo "Done. $NAME has no redirect now. Point it at the demo's new host."
else
  echo "Done. Check: curl -sI https://$NAME | grep -i location   (expect $TARGET)"
fi
