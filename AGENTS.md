# Instructions for AI agents setting up create-fc

You're helping a person run their own Farcaster: a Snapchain read node on a Hetzner Cloud server, and the fameboy client on their own computer. Follow these steps in order. Each command is safe to re-run.

## Rules

These come before anything below.

1. **Never ask for, accept or handle a seed phrase, recovery phrase, private key or API token.** If the person pastes one into the chat anyway, tell them to treat it as leaked: anyone who can read the transcript can use it. When a step needs a secret, give them the exact command to run **in their own terminal**, and wait for them to say it's done.
2. **Ask before spending money.** Before command 0, tell them it creates a server and volume billed by the hour, about $0.16/hour (about $105/month), until deleted. Wait for a clear yes.
3. **Ask before deleting anything.**
4. **Don't change their Hetzner account, SSH keys or shell configuration** beyond what these steps say.

## Before command 0: check the computer

Run these and fix what's missing. Ask before installing anything.

| Check | If it fails |
| --- | --- |
| `hcloud version` | macOS: `brew install hcloud`. Linux: see https://github.com/hetznercloud/cli |
| `hcloud context active` | The person must do this themselves (see below). |
| `ls ~/.ssh/id_ed25519.pub ~/.ssh/id_ecdsa.pub ~/.ssh/id_rsa.pub` (any one) | Offer to run `ssh-keygen -t ed25519`. |
| `node -v` is 22.18 or newer | Needed for command 2. Point them to https://nodejs.org |
| `git --version` | Needed for command 2. |

If `hcloud context active` fails, stop and tell the person:

> Create a Hetzner Cloud project and an API token with Read & Write access at https://console.hetzner.com (new accounts may need ID verification first). Then run this in your own terminal and paste the token when it asks. Don't paste the token here:
> `hcloud context create fc-node`

Continue when they confirm. Check again with `hcloud context active`.

## Command 0: create the server (after the person says yes to the cost)

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner.sh | bash
```

- Takes about 30 seconds and prints `Server fc-node is up at <ip>`. Note the IP.
- If cx43 is sold out, it tries other locations, then cpx41 (~$0.20/hour all in). Tell the person if it falls back.
- `volumes size limit exceeded`: their account's volume cap is under 1000 GB. Tell them; don't try to work around it.

## Command 1: set up the node

Wait about a minute for the server to boot, then:

```bash
ssh -o StrictHostKeyChecking=accept-new root@<ip> 'curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/node/setup.sh | bash'
```

- Returns in seconds and runs the rest as a background job on the server.
- `REMOTE HOST IDENTIFICATION HAS CHANGED`: a new server reused an old IP. Run `ssh-keygen -R <ip>` and retry. This is expected after deleting and recreating.

Then wait. Check `ssh root@<ip> fc-node status` about every 30 minutes, and tell the person what it says:

1. **About 2 hours:** loading the snapshot. Status shows the shards' progress.
2. **About 4–5 hours:** catching up. Status shows hours behind and an estimate. Reads already work; the newest casts are missing until it's done.
3. **"in sync":** done.

Don't run command 1 again while setup is running. If status says setup stopped, run command 1 again: it resumes.

## Command 2: install the client on the person's computer

This works as soon as the node is catching up; it doesn't need to wait for "in sync".

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/client/install.sh | bash -s -- http://<ip>:3381
```

Then tell the person to run `fameboy ui`, which opens the client in their browser. If `fameboy` isn't found, they should open a new terminal tab, or add `~/.local/bin` to `PATH`.

## Posting: the person does this themselves

The client shows the person's own feed, so it needs them signed in: an app key, and creating one needs the account's seed phrase. Until then `fameboy ui` shows a sign-in page. Tell the person:

> Sign in on the page `fameboy ui` opened: approve in the Farcaster app, or use your seed phrase there (it stays on your computer). Or run `fameboy login` in your own terminal, not through me. Read the warning it prints. No account yet? `fameboy new-account` registers one for about $0.20 of ETH on Optimism.

For the Farcaster-app option, the node needs an app account: an account made for it. People approving see its name, so setup suggests a free `@fameboy<color>` username with a random color (e.g. `@fameboyteal`, checking the fname server and trying another color when one is taken), which they can keep or replace with their own. The person sets it up once on the server, in their own SSH session, so everyone using the node can approve on their phone:

> `ssh -t root@<ip> fc-node app-account`

Anyone can then sign in through the node. If the person wants only friends, `ssh root@<ip> fc-node signin invite` turns on invite codes, and `ssh root@<ip> fc-node invite <friend's name>` makes one per friend; they type it on the sign-in page. (`fameboy app-account` on their own computer still works for that computer alone.)

## Optional: host fameboy for others

Once the node has an app account, it can host fameboy at a web address, so people can use Farcaster through it without installing anything. It costs nothing extra. Offer it, and run it only after they say yes:

```bash
ssh root@<ip> fc-node client
```

It prints the address, `https://<app account's name>.<ip with dashes>.sslip.io`. Tell the person that anyone can sign in there unless they run `fc-node signin invite`, and that every cast made through it says "via" their app account. `fc-node client off` stops it. More: https://createfc.org/docs/guide/host-fameboy

Don't run `fameboy login`, `fameboy app-account`, `fc-node app-account`, `fameboy username` or `fameboy new-account` yourself, and never fill in the sign-in page's seed phrase box. Their output or input includes a seed phrase.

## When they're done

Offer to stop the billing, and run it only after they say yes. It lists what it will delete and needs `--yes` when no terminal is attached:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner-delete.sh | bash -s -- --yes
```

Their app key in `~/.fameboy` survives. A new node takes 6–8 hours to sync again.

## More

- Step by step, with what you need first: https://createfc.org/quickstart/
- Costs: `docs/Costs.md`
- Errors seen in practice: https://createfc.org/troubleshooting/
