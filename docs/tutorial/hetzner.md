# Before you start: Hetzner

The three commands work without reading any of this. These pages are for when you want to know what's running on your server, what you just signed, or what to do when something breaks. Every output and timing here is from a real run on 18–19 October 2026.

1. **Before you start: Hetzner** (this page): the account, the API token, and the volume limit.
2. [Command 0: the server](./server): the server, volume and firewall, and what happens when a type is sold out.
3. [Command 1: the read node](./node): why the snapshot is streamed, how long catching up takes, and what the warnings mean.
4. [Command 2: the client](./client): fameboy in your browser and terminal.

## Make a project and a token

Command 0 uses [Hetzner Cloud](https://www.hetzner.com/cloud/) because it bills by the hour and has a clean CLI. Hetzner has no API for creating projects or tokens, so this part happens in the browser:

1. Sign up at [console.hetzner.com](https://console.hetzner.com). New accounts may need ID or payment verification before they can create servers, which can take a while. Do this first.
2. Create a project, then **Security → API tokens → Generate API token** with **Read & Write** access. Hetzner shows it once.
3. In your own terminal, run the command below and paste the token when it asks:

```bash
hcloud context create fc-node
```

The token is saved in plain text in `~/.config/hcloud/cli.toml`. A project used only for this keeps the token's reach small.

::: warning Type the token yourself
Never paste an API token into a chat or an AI assistant. Anyone who can read the transcript can use it.
:::

## New accounts get 1024 GB of volumes

**New accounts can only have 1024 GB of volumes in total**, and Hetzner won't raise that until the account is older: the Limits page says "Your account is too new to request a limit increase." The official Snapchain installer needs about 2 TB, so command 1 loads the database differently and fits in 1000 GB. See [Loading the snapshot](./node#loading-the-snapshot).

## What it costs, and how to stop it

About $0.16 an hour (about $105 a month) for the server, the 1000 GB volume and an IPv4 address, or about $0.20 an hour if the usual server type is sold out. [Costs](../Costs) has the breakdown.

**Powering a server off doesn't stop the bill. Only deleting it does.** This lists what it found, asks you to type `fc-node`, and deletes the server, volume, firewall and SSH key (34 seconds for us):

```bash
curl -fsSL https://raw.githubusercontent.com/eucalyptus-viminalis/create-fc/main/provision/hetzner-delete.sh | bash
```

The volume holds the database, so the next node re-syncs from scratch (6–8 hours). Your app key in `~/.fameboy` survives: point the client at the new node by running command 2 again with the new IP.

Next: [Command 0: the server](./server)
