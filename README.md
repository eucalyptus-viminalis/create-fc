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

Then `fcli feed dwr`, `fcli casts <you>`, and, after reading what it prints, `fcli login` to post.

Already have a Linux box with 16 GB RAM and ~700 GB free? Skip command 0 and run command 1 on it.

**Done for now?** Delete the server, volume and firewall so nothing keeps billing. It lists what it will delete and asks you to type the server's name:

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner-delete.sh | bash
```

Your app key in `~/.fc-client` survives. Next time, run commands 0 and 1 again, then re-run command 2 with the new IP.

> **There is no npm package.** `npm create fcli` / `npx create-fc` run an unrelated package that someone else published in 2022. Use the commands above.

## Seed phrases

`fcli login` asks for a seed phrase once, to authorize an app key. A seed phrase controls the whole account, so treat it like `rm -rf`:

- Use a **test account**. `node client/scripts/new-test-account.ts` makes one for about $0.20 of ETH on Optimism.
- Only paste a seed phrase into software from developers you trust, after reading the code ([client/src/keys.ts](client/src/keys.ts)).
- Prefer apps that ask your wallet to approve a key (delegated signer authorization), so the phrase never leaves the wallet.
- Run it in your own terminal, never through an AI assistant's shell. Whatever the command prints ends up in the assistant's transcript.

## What's in here

| Path | What |
| --- | --- |
| `provision/` | Command 0: Hetzner server, volume and firewall, and `hetzner-delete.sh` to remove them |
| `node/` | Command 1: Docker, a streamed snapshot load that peaks at 556 GB instead of ~1.5 TB, the official `snapchain.sh`, and `fc-node status` |
| `client/` | Command 2: `fcli`, a TypeScript CLI with no build step. Reads, writes, gasless app keys, usernames, and filtering by the app that posted |
| `docs/` | Costs and design decisions |

MIT licensed.
