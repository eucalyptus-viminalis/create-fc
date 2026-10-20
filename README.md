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

Then `clearcast ui` opens the client in your browser. It shows who can post as you, which apps your feed comes from (hide the big one in a click), and the exact node calls behind every view. It shows your own feed, so first run `clearcast login` in a terminal (read what it prints; use a test account). Prefer a terminal? `clearcast feed`, `clearcast casts <name>`, and `clearcast logout` to sign out.

**Just want to try the client?** Point it at our demo node, up until 24 October, then run `clearcast ui`:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/client/install.sh | bash -s -- http://91.99.76.223:3381
```

**Or let your AI agent do it.** Paste this into an agent that can run commands on your computer (Claude Code, Codex and the like). It follows [AGENTS.md](AGENTS.md):

```text
Set up my own Farcaster read node and client with create-fc. Read https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/AGENTS.md and follow it step by step. Check with me before spending money or deleting anything. Never ask me for a seed phrase, private key or API token: when a step needs one, tell me the command to run in my own terminal.
```

Two steps stay with you: creating the Hetzner API token, and `clearcast login` if you want to post. Neither secret should go into a chat.

**Done for now?** Delete the server, volume and firewall so nothing keeps billing. It lists what it will delete and asks you to type the server's name:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner-delete.sh | bash
```

Your app key in `~/.fc-client` survives. Next time, run commands 0 and 1 again, then re-run command 2 with the new IP.

> **There is no npm package.** `npm create fc` / `npx create-fc` run an unrelated package that someone else published in 2022. Use the commands above.

## Seed phrases

`clearcast login` asks for a seed phrase once, to authorize an app key. A seed phrase controls the whole account, so treat it like `rm -rf`:

- Use a **test account**. `node client/scripts/new-test-account.ts` makes one for about $0.20 of ETH on Optimism.
- Only paste a seed phrase into software from developers you trust, after reading the code ([client/src/keys.ts](client/src/keys.ts)).
- Prefer apps that ask your wallet to approve a key (delegated signer authorization), so the phrase never leaves the wallet.
- Run it in your own terminal, never through an AI assistant's shell. Whatever the command prints ends up in the assistant's transcript.

## What's in here

| Path | What |
| --- | --- |
| `provision/` | Command 0: Hetzner server, volume and firewall, and `hetzner-delete.sh` to remove them |
| `node/` | Command 1: Docker, a streamed snapshot load that peaks at 556 GB instead of ~1.5 TB, the official `snapchain.sh`, and `fc-node status` |
| `client/` | Command 2: `clearcast`, a browser client (`clearcast ui`) and CLI in TypeScript with no build step. Reads, writes, gasless app keys, usernames, and filtering by the app that posted |
| `docs/` | Costs and design decisions |
| `AGENTS.md` | Step-by-step instructions for an AI agent running the setup for you |

## Help test it

The first 5 people who run the three commands get $5 USDC to cover the server, whatever they think of it. Want to do it together? Message [@3070.eth](https://farcaster.xyz/3070.eth) for a 30-minute session.

MIT licensed.
