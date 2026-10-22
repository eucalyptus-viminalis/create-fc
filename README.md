# create-fc

Run your own Farcaster: a Snapchain read node you control, and a small client that reads from it and posts through it. Three commands, no API keys from anyone. You furnish the compute.

## Quickstart

You need: a [Hetzner Cloud](https://console.hetzner.com) project with an API token, the [`hcloud` CLI](https://github.com/hetznercloud/cli) logged in to it (`hcloud context create fc-node`), an SSH key, and Node.js 22.18+.

**0. Create a server.** A cx43 with a 1000 GB volume, about $0.16/hour. Hetzner sometimes sells out of cx43; the script then tries other locations, and then cpx41 (~$0.20/hour), and tells you which it got. See [docs/Costs.md](docs/Costs.md).

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner.sh | bash
```

**1. Set up the read node** on it. Use the IP that command 0 printed. Loading the snapshot takes about 2 hours, and catching up about 4½ more (6 h 20 min in total on our last run). It runs in the background, and `ssh root@<ip> fc-node status` tells you where it's at.

```bash
ssh root@<ip> 'curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/node/setup.sh | bash'
```

**2. Install the client** on your computer, pointed at your node:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/client/install.sh | bash -s -- http://<ip>:3381
```

Then `fameboy ui` opens the client in your browser, on a home screen: your node's health, how busy the network is, what you missed since you last looked, and who else is on your node right now. It also shows who can post as you, which apps your feed comes from (hide the big one in a click), and the exact node calls behind every view. It's your own account, so it starts with a sign-in page: approve in the Farcaster app by scanning a QR code (once an app account is set up, see [Signing in](#signing-in)), or type a seed phrase, which stays on this computer. `fameboy login` does the same in a terminal. Prefer a terminal? `fameboy feed`, `fameboy casts <name>`, and `fameboy logout` to sign out.

**Just want to try the client?** Point it at our demo node, up until 24 October, then run `fameboy ui`:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/client/install.sh | bash -s -- http://91.99.76.223:3381
```

**Or let your AI agent do it.** Paste this into an agent that can run commands on your computer (Claude Code, Codex and the like). It follows [AGENTS.md](AGENTS.md):

```text
Set up my own Farcaster read node and client with create-fc. Read https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/AGENTS.md and follow it step by step. Check with me before spending money or deleting anything. Never ask me for a seed phrase, private key or API token: when a step needs one, tell me the command to run in my own terminal.
```

Two steps stay with you: creating the Hetzner API token, and `fameboy login` if you want to post. Neither secret should go into a chat.

**Done for now?** Delete the server, volume and firewall so nothing keeps billing. It lists what it will delete and asks you to type the server's name:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner-delete.sh | bash
```

Your app key in `~/.fameboy` survives. Next time, run commands 0 and 1 again, then re-run command 2 with the new IP.

> **There is no npm package.** `npm create fc` / `npx create-fc` run an unrelated package that someone else published in 2022. Use the commands above.

## Signing in

`fameboy ui` opens on a sign-in page with two ways in (plus a terminal, and making an account):

- **Approve in the Farcaster app** (recommended). Scan a QR code and approve on your phone; your seed phrase never leaves it. The request comes from an **app account**: the account people see as "@name wants to post on your behalf", and whose name their casts show "via". Set it up once, one of two ways:
  - **On your node, for everyone who uses it.** Run `ssh -t root@<ip> fc-node app-account` and type the account's seed phrase there; fc-companion keeps its custody key on the server. Then make an invite code per friend with `ssh root@<ip> fc-node invite <name>`; they type it once when they sign in. The [share your node guide](https://eucalyptus-viminalis.github.io/create-fc/docs/guide/share-your-node) covers what this puts at risk and why codes.
  - **On this computer only.** Run `fameboy app-account` (or pick "app account" at the end of `fameboy new-account`), which saves that account's custody key on the computer, so use an account made for this. If it has no username yet, setup picks a random color and suggests `@fameboy<color>` (e.g. `@fameboyteal`), trying another color whenever one is taken; press Enter to claim it or type your own. It then offers to give it a display name (by default "fameboy"), picture and bio (by default the fameboy mark and "it's so clear to me now"), so the approval screen looks like an app and not a bare number. There's no shared app account: every copy would need its key, so each names its own. The approval adds the key on chain; add `--sponsor` to pay that fee for the people signing in (the app account needs warps in the Farcaster app).
- **Use your seed phrase.** The same steps as `fameboy login`. It's offered only because the server listens on your computer alone; a fameboy other people reach over the network must never take a phrase.

`fameboy profile --display … --pfp … --bio …` changes your own profile. `fameboy logout` deletes the app key from this computer. `fameboy revoke`, or **sign out** in the page, also revokes it on Farcaster first: the key signs its own removal, so no seed phrase is needed. Keys approved in the Farcaster app live onchain; remove those in the Farcaster app.

## Posting

**post** in the home screen opens a composer: @-mentions from the people you follow, a byte counter (Farcaster counts bytes, and mentions are free), and up to two images. Images upload to the node fameboy uses (your own, or a friend's you share), and the cast links to them there over HTTPS (`https://<ip with dashes>.sslip.io/img/…`, served by Caddy, which needs ports 80 and 443 open). Each person gets 500 MB, each image up to 5 MB, and the node 10 GB in all; the node's owner can change that in `/var/lib/fc-companion/limits.json`. Images live as long as the server does. More in [Images in your casts](https://eucalyptus-viminalis.github.io/create-fc/docs/guide/images).

## Seed phrases

`fameboy login` and the page's seed phrase option ask for a seed phrase once, to authorize an app key. A seed phrase controls the whole account, so treat it like `rm -rf`:

- No account yet? `fameboy new-account` registers one for about $0.20 of ETH on Optimism. Pass `--recovery <address>` with an address you control.
- Only paste a seed phrase into software from developers you trust, after reading the code ([client/src/keys.ts](client/src/keys.ts)).
- Prefer approving a key in your wallet or the Farcaster app (delegated signer authorization), so the phrase never leaves it. In fameboy that's **Approve in the Farcaster app**.
- Run it in your own terminal, never through an AI assistant's shell. Whatever the command prints ends up in the assistant's transcript.

## What's in here

| Path | What |
| --- | --- |
| `provision/` | Command 0: Hetzner server, volume and firewall, and `hetzner-delete.sh` to remove them |
| `node/` | Command 1: Docker, a streamed snapshot load that peaks at 556 GB instead of ~1.5 TB, the official `snapchain.sh`, and `fc-node status` |
| `client/` | Command 2: `fameboy`, a browser client (`fameboy ui`) and CLI in TypeScript with no build step. Reads, writes, gasless app keys, usernames, and filtering by the app that posted |
| `docs/` | Costs and design decisions |
| `AGENTS.md` | Step-by-step instructions for an AI agent running the setup for you |

## Help test it

The first 5 people who run the three commands get $5 USDC to cover the server, whatever they think of it. Want to do it together? Message [@3070.eth](https://farcaster.xyz/3070.eth) for a 30-minute session.

MIT licensed.
