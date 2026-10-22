#!/bin/bash
# Command 2: install clearcast, a Farcaster client that talks to your own node.
#
#   curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/client/install.sh | bash -s -- http://<your node>:3381
#
# Needs Node.js 22.18 or newer and git. Installs into ~/.fc-client and puts
# `clearcast` in ~/.local/bin. Run it again to update.
set -euo pipefail

REPO="${FC_REPO:-https://github.com/eucalyptus-viminalis/create-fc}"
NODE_URL="${1:-}"
HOME_DIR="${FC_HOME:-$HOME/.fc-client}"
APP="$HOME_DIR/app"
BIN="$HOME/.local/bin"

[ -n "$NODE_URL" ] || { echo "usage: install.sh http://<your node's IP>:3381"; exit 1; }
command -v git >/dev/null || { echo "git is required"; exit 1; }
command -v node >/dev/null || { echo "Node.js 22.18+ is required: https://nodejs.org"; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "Node.js $(node -v) is too old: clearcast runs TypeScript directly, which needs 22.18+"; exit 1; }

# Is the node reachable before we bother installing?
if ! curl -fsS -m 10 "$NODE_URL/v1/info" >/dev/null; then
  echo "can't reach $NODE_URL/v1/info. Check the address, and that port 3381 is open."; exit 1
fi

mkdir -p "$HOME_DIR" && chmod 700 "$HOME_DIR"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only -q
else git clone -q --depth 1 "$REPO" "$APP"; fi

cd "$APP/client"
if command -v pnpm >/dev/null; then pnpm install --prod --frozen-lockfile --silent
else npx -y pnpm@10.33.0 install --prod --frozen-lockfile --silent; fi

printf '{\n  "node": "%s"\n}\n' "$NODE_URL" > "$HOME_DIR/config.json"

mkdir -p "$BIN"
# Earlier versions installed this as `fc` (which zsh and bash shadow with
# their built-in history command) and then `fcli`. Remove those if ours.
for old in fc fcli; do
  if [ -f "$BIN/$old" ] && grep -q "fc-client/app/client/src/cli.ts" "$BIN/$old"; then rm -f "$BIN/$old"; fi
done
cat > "$BIN/clearcast" <<EOF
#!/bin/sh
exec node "$APP/client/src/cli.ts" "\$@"
EOF
chmod +x "$BIN/clearcast"

echo "installed clearcast into $APP, using the node at $NODE_URL"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "add $BIN to your PATH:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;; esac
echo
"$BIN/clearcast" status
cat <<'EOF'

Open it in your browser:  clearcast ui
In the terminal:          clearcast casts dwr    clearcast help
To post, register an app key (read the warning it prints first):  clearcast login
EOF
